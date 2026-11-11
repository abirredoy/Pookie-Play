const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, NoSubscriberBehavior } = require("@discordjs/voice");
const play = require("play-dl");

function createMusic() {
  const states = new Map();
  function state(id) {
    if (!states.has(id)) {
      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
      const s = { connection: null, player, queue: [], current: null, volume: 70, loop: "off", skipRequested: false, stopRequested: false };
      player.on(AudioPlayerStatus.Idle, () => {
        if (s.stopRequested) { s.stopRequested = false; s.current = null; return; }
        if (s.loop === "track" && s.current && !s.skipRequested) s.queue.unshift(s.current);
        s.skipRequested = false;
        s.current = null;
        next(id).catch(console.error);
      });
      states.set(id, s);
    }
    return states.get(id);
  }

  async function join(guildId, channel) {
    const s = state(guildId);
    if (s.connection) {
      if (s.connection.joinConfig.channelId !== channel.id) throw new Error("আমি ইতিমধ্যে অন্য voice channel-এ আছি।");
      return s.connection;
    }
    const connection = joinVoiceChannel({
      channelId: channel.id, guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true
    });
    s.connection = connection;
    connection.subscribe(s.player);
    connection.on(VoiceConnectionStatus.Disconnected, () => { s.connection = null; });
    try { await entersState(connection, VoiceConnectionStatus.Ready, 20_000); }
    catch (error) { connection.destroy(); s.connection = null; throw error; }
    return connection;
  }

  async function next(guildId) {
    const s = state(guildId);
    const item = s.queue.shift();
    if (!item) { s.current = null; return; }
    s.current = item;
    try {
      const stream = await play.stream(item.url);
      const resource = createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: true });
      resource.volume.setVolume(s.volume / 100);
      s.player.play(resource);
    } catch (error) {
      console.error("Playback error:", error);
      s.current = null;
      await next(guildId);
    }
  }

  async function playQuery(guildId, query, requestedBy) {
    const s = state(guildId);
    let item;
    if (play.yt_validate(query)) {
      item = { url: query, title: query, requestedBy };
    } else {
      const results = await play.search(query, { limit: 1 });
      if (!results.length) return "কোনো YouTube ফলাফল পাওয়া যায়নি।";
      item = { url: results[0].url, title: results[0].title || query, requestedBy };
    }
    s.queue.push(item);
    if (![AudioPlayerStatus.Playing, AudioPlayerStatus.Buffering, AudioPlayerStatus.Paused].includes(s.player.state.status) && !s.current) await next(guildId);
    return `🎵 **${item.title}** queue-তে যোগ হয়েছে।`;
  }

  return {
    join,
    leave(id) {
      const s = states.get(id);
      if (s?.connection) s.connection.destroy();
      if (s) s.player.stop(true);
      states.delete(id);
    },
    play: playQuery,
    pause(id) { return state(id).player.pause(); },
    resume(id) { return state(id).player.unpause(); },
    skip(id) {
      const s = state(id);
      if (!s.current) return false;
      s.skipRequested = true;
      return s.player.stop(true);
    },
    stop(id) {
      const s = state(id);
      s.queue = [];
      s.loop = "off";
      s.stopRequested = true;
      s.player.stop(true);
    },
    volume(id, value) {
      const s = state(id);
      s.volume = value;
      const resource = s.player.state.resource;
      if (resource.volume) resource.volume.setVolume(value / 100);
    },
    shuffle(id) {
      const q = state(id).queue;
      for (let i = q.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [q[i], q[j]] = [q[j], q[i]];
      }
      return q.length;
    },
    setLoop(id, mode) { state(id).loop = mode; return mode; },
    remove(id, position) {
      const q = state(id).queue;
      if (position < 1 || position > q.length) return null;
      return q.splice(position - 1, 1)[0];
    },
    current(id) { return state(id).current; },
    loop(id) { return state(id).loop; },
    queueText(id) {
      const s = state(id);
      const lines = [];
      if (s.current) lines.push(`▶️ **এখন চলছে:** ${s.current.title}`);
      if (s.queue.length) lines.push("", "**পরের গানগুলো:**", ...s.queue.slice(0, 10).map((item, i) => `${i + 1}. ${item.title}`));
      if (s.queue.length > 10) lines.push(`…আরও ${s.queue.length - 10}টি গান`);
      lines.push("", `🔁 Loop: ${s.loop} · 🔊 Volume: ${s.volume}%`);
      return lines.join("\n");
    }
  };
}
module.exports = { createMusic };
