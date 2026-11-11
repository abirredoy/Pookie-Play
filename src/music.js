const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, NoSubscriberBehavior } = require("@discordjs/voice");
const play = require("play-dl");
const fs = require("node:fs");
const path = require("node:path");
const AUDIO_DIR = path.join(process.cwd(), "assets", "audio");
const AUDIO_EXTENSIONS = new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a"]);

function createMusic() {
  const states = new Map();

  function state(id) {
    if (!states.has(id)) {
      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
      const s = {
        connection: null, player, queue: [], current: null,
        volume: 70, loop: "off", skipRequested: false, stopRequested: false
      };
      player.on(AudioPlayerStatus.Idle, () => {
        if (s.stopRequested) {
          s.stopRequested = false;
          s.current = null;
          return;
        }
        if (s.current && !s.skipRequested) {
          if (s.loop === "track") s.queue.unshift(s.current);
          else if (s.loop === "queue") s.queue.push(s.current);
        }
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
      if (s.connection.joinConfig.channelId !== channel.id) {
        throw new Error("আমি ইতিমধ্যে অন্য voice channel-এ আছি।");
      }
      return s.connection;
    }
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true
    });
    s.connection = connection;
    connection.on("debug", (message) => console.log("[Voice Debug]", message));
    connection.on("stateChange", (oldState, newState) => {
      console.log(`[Voice] ${oldState.status} -> ${newState.status}`);
    });
    connection.subscribe(s.player);
    connection.on(VoiceConnectionStatus.Disconnected, () => { s.connection = null; });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      connection.destroy();
      s.connection = null;
      throw error;
    }
    return connection;
  }

  async function next(guildId) {
    const s = state(guildId);
    const item = s.queue.shift();
    if (!item) {
      s.current = null;
      return;
    }
    s.current = item;
    s.lastError = null;
    try {
      let resource;
      if (item.filePath) {
        resource = createAudioResource(item.filePath, { inlineVolume: true });
      } else {
        const stream = await play.stream(item.url);
        resource = createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: true });
      }
      resource.volume?.setVolume(s.volume / 100);
      s.player.play(resource);
    } catch (error) {
      console.error("YouTube playback error:", error);
      s.lastError = error.message || "অজানা অডিও সমস্যা";
      s.current = null;
    }
  }

  async function playQuery(guildId, query, requestedBy) {
    const s = state(guildId);
    let item;
    const validation = play.yt_validate(query);
    if (validation === "video") {
      let title = query;
      try {
        const info = await play.video_info(query);
        title = info.video_details?.title || query;
      } catch (_) {}
      item = { url: query, title, requestedBy };
    } else if (validation === "playlist") {
      const playlist = await play.playlist_info(query, { incomplete: true });
      const videos = await playlist.all_videos();
      const validVideos = videos.filter(video => video.url).slice(0, 50);
      if (!validVideos.length) return "এই YouTube playlist-এ চালানোর মতো গান পাওয়া যায়নি।";
      for (const video of validVideos) {
        s.queue.push({
          url: video.url,
          title: video.title || "YouTube track",
          requestedBy
        });
      }
      if (!s.current && ![AudioPlayerStatus.Playing, AudioPlayerStatus.Buffering, AudioPlayerStatus.Paused].includes(s.player.state.status)) {
        await next(guildId);
      }
      return `📃 YouTube playlist থেকে ${validVideos.length}টি গান queue-তে যোগ হয়েছে।`;
    } else if (/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(query)) {
      return "এই YouTube link-টি চিনতে পারিনি। একটি public video বা playlist link দাও।";
    } else {
      const results = await play.search(query, { limit: 1 });
      if (!results.length) return "কোনো YouTube ফলাফল পাওয়া যায়নি।";
      item = {
        url: results[0].url,
        title: results[0].title || query,
        requestedBy
      };
    }

    s.queue.push(item);
    if (!s.current && ![AudioPlayerStatus.Playing, AudioPlayerStatus.Buffering, AudioPlayerStatus.Paused].includes(s.player.state.status)) {
      await next(guildId);
      if (s.lastError) {
        return "⚠️ গানটি Queue-তে যোগ হয়েছে, কিন্তু YouTube অডিও পাওয়া যায়নি। GitHub Actions-এর লগে playback error দেখো।";
      }
    }
    return `🎵 **${item.title}** queue-তে যোগ হয়েছে।`;
  }

  function listFiles() {
    if (!fs.existsSync(AUDIO_DIR)) return [];
    return fs.readdirSync(AUDIO_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map(entry => entry.name).sort((a, b) => a.localeCompare(b));
  }

  async function playFile(guildId, filename, requestedBy) {
    const s = state(guildId);
    const safeName = path.basename(filename);
    if (safeName !== filename || !AUDIO_EXTENSIONS.has(path.extname(safeName).toLowerCase())) return "এই ফাইলের নাম বা ফরম্যাট গ্রহণযোগ্য নয়।";
    const filePath = path.join(AUDIO_DIR, safeName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return "এই অডিও ফাইলটি assets/audio ফোল্ডারে পাওয়া যায়নি। আগে GitHub-এ ফাইলটি যোগ করো।";
    s.queue.push({ filePath, title: safeName, requestedBy });
    if (!s.current && ![AudioPlayerStatus.Playing, AudioPlayerStatus.Buffering, AudioPlayerStatus.Paused].includes(s.player.state.status)) {
      await next(guildId);
      if (s.lastError) return "⚠️ অডিও ফাইলটি চালু হয়নি: " + s.lastError;
    }
    return "🎵 **" + safeName + "** queue-তে যোগ হয়েছে।";
  }

  return {
    join,
    leave(id) {
      const s = states.get(id);
      if (!s) return;
      s.queue = [];
      s.loop = "off";
      s.stopRequested = s.player.state.status !== AudioPlayerStatus.Idle;
      if (s.player.state.status !== AudioPlayerStatus.Idle) s.player.stop(true);
      if (s.connection) s.connection.destroy();
      states.delete(id);
    },
    play: playQuery,
    playFile,
    listFiles,
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
      s.stopRequested = s.player.state.status !== AudioPlayerStatus.Idle;
      if (s.player.state.status !== AudioPlayerStatus.Idle) s.player.stop(true);
      else s.current = null;
    },
    volume(id, value) {
      const s = state(id);
      s.volume = value;
      const resource = s.player.state.resource;
      if (resource?.volume) resource.volume.setVolume(value / 100);
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
      if (s.queue.length) {
        lines.push("", "**পরের গানগুলো:**",
          ...s.queue.slice(0, 10).map((item, i) => `${i + 1}. ${item.title}`));
      }
      if (s.queue.length > 10) lines.push(`…আরও ${s.queue.length - 10}টি গান`);
      lines.push("", `🔁 Loop: ${s.loop} · 🔊 Volume: ${s.volume}%`);
      return lines.join("\n");
    }
  };
}

module.exports = { createMusic };
