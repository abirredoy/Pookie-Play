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
      player: null, queue: [], current: null, currentQuery: "", fallbackTried: false, volume: 70,
      mode: "off", seedIndex: 0, busy: false, recovering: false
    });
    return states.get(id);
  };

  function extractTracks(result) {
    if (!result) return [];
    if (Array.isArray(result.tracks)) return result.tracks;
    if (result.loadType === "search" && Array.isArray(result.data)) return result.data;
    if (result.loadType === "track" && result.data) return [result.data];
    if (result.loadType === "playlist" && Array.isArray(result.data?.tracks)) {
      return result.data.tracks.map(item => item.track || item).filter(Boolean);
    }
    return [];
  }

  async function tryResolve(identifier, node) {
    try {
      const result = await node.rest.resolve(identifier);
      const tracks = extractTracks(result);
      console.log("[Music] Search", identifier.slice(0, 90),
        "| loadType:", result?.loadType || "none",
        "| tracks:", tracks.length,
        "| detail:", result?.data?.message || result?.data?.cause || result?.message || "none");
      return tracks;
    } catch (error) {
      console.error("[Music] Search failed:", identifier.slice(0, 90),
        "|", error?.message || error,
        "| status:", error?.status || error?.statusCode || "unknown");
      return [];
    }
  }

  async function linkMetadata(url) {
    try {
      let endpoint;
      if (/open\.spotify\.com\/(track|album|playlist)\//i.test(url)) {
        endpoint = "https://open.spotify.com/oembed?url=" + encodeURIComponent(url);
      } else if (/(youtube\.com\/watch|youtu\.be\/)/i.test(url)) {
        endpoint = "https://www.youtube.com/oembed?url=" + encodeURIComponent(url) + "&format=json";
      } else return "";
      const response = await fetch(endpoint, { headers: { "User-Agent": "PookiePlay/1.0" }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) return "";
      const data = await response.json();
      return [String(data.title || "").trim(), String(data.author_name || "").trim()].filter(Boolean).join(" ");
    } catch (error) {
      console.warn("[Music] Link metadata unavailable:", error?.message || error);
      return "";
    }
  }

  async function resolve(query, node) {
    if (!node) {
      console.error("[Music] No Lavalink node available for search.");
      return [];
    }
    let searchQuery = query;
    if (/^https?:\/\//i.test(query)) {
      const direct = await tryResolve(query, node);
      if (direct.length) return direct;
      searchQuery = await linkMetadata(query);
      if (!searchQuery) {
        console.warn("[Music] Could not read song details from supplied link.");
        return [];
      }
      console.log("[Music] Resolved link metadata to:", searchQuery);
    }
    const yt = await tryResolve("ytsearch:" + searchQuery, node);
    if (yt.length) return yt;
    const ytm = await tryResolve("ytmsearch:" + searchQuery, node);
    if (ytm.length) return ytm;
    const sc = await tryResolve("scsearch:" + searchQuery, node);
    if (sc.length) return sc;
    return [];
  }
  async function playNext(guildId) {
    const s = get(guildId);
    if (!s.player || s.busy) return false;
    s.busy = true;
    let retry = false;
    try {
      if (!s.queue.length && s.mode !== "off") {
        const seeds = MODE_SEEDS[s.mode] || MODE_SEEDS.mixed;
        const query = seeds[s.seedIndex++ % seeds.length];
        s.currentQuery = query;
        const tracks = await resolve(query, s.player.node);
        if (tracks.length) s.queue.push(...tracks.slice(0, 5));
      }
      const track = s.queue.shift();
      if (!track) { s.current = null; return false; }
      s.current = track;
      s.fallbackTried = false;
      console.log("[Music] Starting:", track.info?.title || "untitled", "| source:", track.info?.sourceName || "unknown");
      await s.player.playTrack({ track: { encoded: track.encoded } });
      await s.player.setGlobalVolume(s.volume * 10);
      return true;
    } catch (error) {
      console.error("[Music] Could not start track; moving to next result:", error?.message || error);
      s.current = null;
      retry = s.queue.length > 0;
    } finally {
      s.busy = false;
    }
    if (retry) return playNext(guildId);
    return false;
  }

  async function recoverTrack(guildId, detail, eventTrack) {
    const s = get(guildId);
    if (!s.current) {
      console.log("[Music] Ignoring failure event; no active track.");
      return;
    }
    if (eventTrack?.encoded && s.current.encoded !== eventTrack.encoded) {
      console.log("[Music] Ignoring stale failure event for a previous track.");
      return;
    }
    if (s.recovering) {
      console.log("[Music] Ignoring duplicate track failure event.");
      return;
    }
    s.recovering = true;
    const failedTrack = s.current;
    console.error("[Music] Track failed:", detail || "unknown error");
    try {
      if (failedTrack?.info?.sourceName === "youtube" && !s.fallbackTried) {
        s.fallbackTried = true;
        const info = failedTrack.info;
        const rawTitle = String(info.title || "");
        const fallbackQuery = rawTitle.split(/[|–—]/)[0].replace(/\s*\([^)]*\)\s*$/, "").trim();
        if (fallbackQuery) {
          console.log("[Music] YouTube failed; trying clean SoundCloud title:", fallbackQuery);
          let fallbackTracks = await tryResolve("scsearch:" + fallbackQuery, s.player?.node);
          if (!fallbackTracks.length && info.author) {
            fallbackTracks = await tryResolve("scsearch:" + fallbackQuery + " " + info.author, s.player?.node);
          }
          const soundcloudTrack = fallbackTracks.find(track => track.info?.sourceName === "soundcloud") || fallbackTracks[0];
          if (soundcloudTrack) {
            s.queue.unshift(soundcloudTrack);
            console.log("[Music] SoundCloud fallback found:", soundcloudTrack.info?.title || "untitled");
          } else {
            console.warn("[Music] SoundCloud fallback found no track.");
          }
        }
      }
      s.current = null;
    } finally {
      s.recovering = false;
    }
    await playNext(guildId);
  }

  function attachEvents(guildId, player) {
    player.on("start", event => {
      console.log("[Music] Playback started:", event.track?.info?.title || "unknown track");
    });
    player.on("end", event => {
      console.log("[Music] Track ended:", event.reason);
      if (event.reason === "FINISHED") {
        const s = get(guildId);
        s.current = null;
        playNext(guildId).catch(console.error);
      }
    });
    player.on("exception", event => recoverTrack(guildId, event.exception || event.error, event.track).catch(console.error));
    player.on("stuck", event => recoverTrack(guildId, event, event.track).catch(console.error));
  }

  async function join(guildId, channel) {
    const s = get(guildId);
    if (s.player) {
      const connection = shoukaku.connections?.get(guildId);
      const connectedChannelId = connection?.channelId;
      if (connectedChannelId && connectedChannelId !== channel.id) {
        throw new Error("আমি ইতিমধ্যে অন্য voice channel-এ আছি। আগে /leave ব্যবহার করো।");
      }
      if (connection) return s.player;
      // Recover if the local player exists but Shoukaku has lost its voice connection.
      s.player = null;
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
      const isDirectUrl = /^https?:\/\//i.test(query);
      const wasIdle = !s.current;
      s.currentQuery = query;
      s.fallbackTried = false;

      // A supplied URL is an explicit version choice: put it first and start it now.
      if (isDirectUrl && s.current && s.player) {
        s.queue.unshift(...tracks.slice(0, 1));
        await s.player.stopTrack();
        s.current = null;
        await playNext(id);
        return { track: tracks[0], queued: false, queueLength: s.queue.length };
      }

      s.queue.push(...tracks);
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
