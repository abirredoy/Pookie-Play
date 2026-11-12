const MODE_SEEDS = {
  viral: ["viral popular songs 2026", "top hits 2026", "most popular songs"],
  bangla: ["Bangla viral songs", "Bangladesh top songs", "popular Bangla hits"],
  global: ["global top hits", "worldwide viral songs", "global popular music"],
  mixed: ["Bangla and global hits", "international viral songs", "Bangladesh popular songs"]
};

function createMusic(shoukaku) {
  const states = new Map();
  const get = (id) => {
    if (!states.has(id)) states.set(id, {
      player: null, queue: [], current: null, volume: 70,
      mode: "off", seedIndex: 0, busy: false
    });
    return states.get(id);
  };

  async function resolve(query, node) {
    const direct = /^https?:\/\//i.test(query);
    if (direct) {
      const result = await node.rest.resolve(query);
      if (result?.tracks?.length) return result.tracks;
    }
    const yt = await node.rest.resolve("ytsearch:" + query).catch(() => null);
    if (yt?.tracks?.length) return yt.tracks;
    const sc = await node.rest.resolve("scsearch:" + query).catch(() => null);
    if (sc?.tracks?.length) return sc.tracks;
    return [];
  }

  async function playNext(guildId) {
    const s = get(guildId);
    if (!s.player || s.busy) return false;
    s.busy = true;
    try {
      if (!s.queue.length && s.mode !== "off") {
        const seeds = MODE_SEEDS[s.mode] || MODE_SEEDS.mixed;
        const query = seeds[s.seedIndex++ % seeds.length];
        const tracks = await resolve(query, s.player.node);
        if (tracks.length) s.queue.push(tracks[0]);
      }
      const track = s.queue.shift();
      if (!track) { s.current = null; return false; }
      s.current = track;
      await s.player.playTrack({ track: { encoded: track.encoded } });
      await s.player.setGlobalVolume(s.volume * 10);
      return true;
    } catch (error) {
      console.error("[Music] Next track failed:", error);
      s.current = null;
      return false;
    } finally {
      s.busy = false;
    }
  }

  function attachEvents(guildId, player) {
    player.on("end", event => {
      if (event.reason === "FINISHED") playNext(guildId).catch(console.error);
    });
    player.on("exception", event => {
      console.error("[Music] Track exception:", event.exception || event.error);
      playNext(guildId).catch(console.error);
    });
    player.on("stuck", () => {
      console.warn("[Music] Track stuck; trying next track.");
      playNext(guildId).catch(console.error);
    });
  }

  async function join(guildId, channel) {
    const s = get(guildId);
    if (s.player) {
      if (s.player.connection.channelId !== channel.id) {
        throw new Error("আমি ইতিমধ্যে অন্য voice channel-এ আছি।");
      }
      return s.player;
    }
    const player = await shoukaku.joinVoiceChannel({
      guildId,
      channelId: channel.id,
      shardId: channel.guild.shardId ?? 0,
      deaf: true
    });
    s.player = player;
    attachEvents(guildId, player);
    await player.setGlobalVolume(s.volume * 10);
    console.log("[Music] Joined voice channel in guild", guildId);
    return player;
  }

  return {
    join,
    async leave(id) {
      const s = get(id);
      s.queue = [];
      s.current = null;
      if (s.player) await shoukaku.leaveVoiceChannel(id);
      states.delete(id);
    },
    async play(id, channel, query) {
      await join(id, channel);
      const s = get(id);
      const tracks = await resolve(query, s.player.node);
      if (!tracks.length) throw new Error("YouTube বা SoundCloud-এ এই গানটি পাওয়া যায়নি। অন্য নাম দিয়ে চেষ্টা করো।");
      const wasIdle = !s.current;
      s.queue.push(...tracks.slice(0, 10));
      if (wasIdle) await playNext(id);
      return { track: tracks[0], queued: !wasIdle, queueLength: s.queue.length };
    },
    async pause(id) {
      const s = get(id);
      if (!s.player || !s.current) return false;
      await s.player.setPaused(true);
      return true;
    },
    async resume(id) {
      const s = get(id);
      if (!s.player || !s.current) return false;
      await s.player.setPaused(false);
      return true;
    },
    async skip(id) {
      const s = get(id);
      if (!s.player || !s.current) return false;
      await s.player.stopTrack();
      s.current = null;
      return playNext(id);
    },
    async stop(id) {
      const s = get(id);
      if (!s.player) return false;
      s.queue = [];
      s.current = null;
      await s.player.stopTrack();
      return true;
    },
    async volume(id, value) {
      const s = get(id);
      s.volume = Math.max(0, Math.min(100, value));
      if (s.player) await s.player.setGlobalVolume(s.volume * 10);
      return s.volume;
    },
    async adjustVolume(id, delta) {
      const s = get(id);
      return this.volume(id, s.volume + delta);
    },
    setMode(id, mode) {
      const s = get(id);
      s.mode = mode;
      s.seedIndex = 0;
      return s.mode;
    },
    getMode(id) { return get(id).mode; },
    getQueue(id) {
      const s = get(id);
      return { current: s.current?.info || null, tracks: s.queue.map(t => t.info), mode: s.mode };
    }
  };
}

module.exports = { createMusic };
