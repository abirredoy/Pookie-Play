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
      player: null,
      queue: [],
      current: null,
      currentFallback: { tracks: [], soundcloudTried: false, query: "" },
      fallbackByEncoded: new Map(),
      currentQuery: "",
      volume: 70,
      mode: "off",
      seedIndex: 0,
      busy: false,
      recovering: false
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

  function encodedOf(eventTrack) {
    if (typeof eventTrack === "string") return eventTrack;
    return eventTrack?.encoded || null;
  }

  function saveFallbacks(s, track, tracks, query) {
    if (!track?.encoded) return;
    s.fallbackByEncoded.set(track.encoded, {
      tracks: tracks.filter(item => item?.encoded && item.encoded !== track.encoded),
      soundcloudTried: false,
      query
    });
  }

  function enqueueSearchResults(s, tracks, query, front = false) {
    if (!tracks.length) return null;
    const primary = tracks[0];
    saveFallbacks(s, primary, tracks.slice(1), query);
    if (front) s.queue.unshift(primary);
    else s.queue.push(primary);
    return primary;
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

  function normalizePublicLink(raw) {
    let parsed;
    try { parsed = new URL(String(raw).trim()); } catch { throw new Error("শুধু সঠিক ওয়েব লিংক দাও (https://...)।"); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("শুধু public HTTP/HTTPS লিংক সমর্থিত।");
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\\./, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
        /^(127\\.|10\\.|192\\.168\\.|169\\.254\\.|0\\.)/.test(host) ||
        /^172\\.(1[6-9]|2[0-9]|3[0-1])\\./.test(host) || host === "::1") {
      throw new Error("Private/local network link চালানো যাবে না।");
    }

    // Convert ordinary public Google Drive share links to its public download endpoint.
    if (host === "drive.google.com") {
      const match = parsed.pathname.match(/\\/file\\/d\\/([a-zA-Z0-9_-]+)/);
      const id = match?.[1] || parsed.searchParams.get("id");
      if (id) return "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(id);
    }
    return parsed.toString();
  }

  function isKnownMediaLink(raw) {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\\./, "");
    const knownHosts = [
      "youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com",
      "soundcloud.com", "on.soundcloud.com", "vimeo.com", "player.vimeo.com",
      "twitch.tv", "clips.twitch.tv", "bandcamp.com", "drive.google.com",
      "dropbox.com", "dl.dropboxusercontent.com", "archive.org", "streamable.com"
    ];
    const mediaPath = /\\.(mp3|m4a|aac|wav|flac|ogg|opus|mp4|m4v|webm|mov|mkv)(?:$|\\?)/i.test(u.pathname);
    return knownHosts.some(domain => host === domain || host.endsWith("." + domain)) || mediaPath;
  }

  async function resolve(rawLink, node) {
    if (!node) throw new Error("এখন কোনো Lavalink server সংযুক্ত নেই।");
    const link = normalizePublicLink(rawLink);
    if (!isKnownMediaLink(link)) {
      throw new Error("এই ওয়েবসাইটের সাধারণ পেজ Voice Channel-এ সরাসরি বাজানো যায় না। Direct audio/video file বা YouTube/SoundCloud/Vimeo/Twitch/Bandcamp/Public Drive media link দাও।");
    }
    // Link-only: resolve the exact URL. Never search by title or substitute another track.
    return await tryResolve(link, node);
  }

  async function playNext(guildId) {
    const s = get(guildId);
    if (!s.player || s.busy) return false;
    s.busy = true;
    let failedTrack = null;
    try {
      const track = s.queue.shift();
      if (!track) {
        s.current = null;
        s.currentFallback = { tracks: [], soundcloudTried: false, query: "" };
        return false;
      }

      s.current = track;
      s.currentFallback = s.fallbackByEncoded.get(track.encoded) ||
        { tracks: [], soundcloudTried: false, query: s.currentQuery };
      s.fallbackByEncoded.delete(track.encoded);

      console.log("[Music] Starting:", track.info?.title || "untitled",
        "| source:", track.info?.sourceName || "unknown",
        "| fallback candidates:", s.currentFallback.tracks.length);

      // Apply volume before playback so the first audio frames use the selected level.
      await s.player.setGlobalVolume(s.volume * 10);
      await s.player.playTrack({ track: { encoded: track.encoded } });
      return true;
    } catch (error) {
      failedTrack = s.current;
      console.error("[Music] Could not start track:", error?.message || error);
    } finally {
      s.busy = false;
    }

    if (failedTrack) {
      await recoverTrack(guildId, "playTrack request failed", failedTrack.encoded);
    } else if (s.queue.length) {
      return playNext(guildId);
    }
    return false;
  }

  async function recoverTrack(guildId, detail, eventTrack) {
    const s = get(guildId);
    if (!s.current) {
      console.log("[Music] Ignoring failure event; no active track.");
      return;
    }

    const eventEncoded = encodedOf(eventTrack);
    if (eventEncoded && s.current.encoded !== eventEncoded) {
      console.log("[Music] Ignoring stale failure event for a previous track.");
      return;
    }
    if (s.recovering) {
      console.log("[Music] Ignoring duplicate track failure event.");
      return;
    }

    s.recovering = true;
    const failedTrack = s.current;
    const fallback = s.currentFallback || { tracks: [], soundcloudTried: false, query: s.currentQuery };
    console.error("[Music] Track failed:", detail || "unknown error",
      "|", failedTrack?.info?.title || "unknown track");

    try {
      // Search results after the first one are fallback candidates, not extra songs in the queue.
      const nextCandidate = fallback.tracks.shift();
      if (nextCandidate) {
        s.fallbackByEncoded.set(nextCandidate.encoded, fallback);
        s.queue.unshift(nextCandidate);
        console.log("[Music] Trying next search result:", nextCandidate.info?.title || "untitled");
      }

      s.current = null;
      s.currentFallback = { tracks: [], soundcloudTried: false, query: "" };
    } finally {
      s.recovering = false;
    }

    await playNext(guildId);
  }

  function attachEvents(guildId, player) {
    player.on("start", event => {
      console.log("[Music] Playback started:", event.track?.info?.title || event.track || "unknown track");
    });

    player.on("end", event => {
      console.log("[Music] Track ended:", event.reason);
      const s = get(guildId);
      const eventEncoded = encodedOf(event.track);
      if (eventEncoded && s.current?.encoded !== eventEncoded) {
        console.log("[Music] Ignoring stale end event.");
        return;
      }
      if (event.reason === "FINISHED") {
        s.current = null;
        s.currentFallback = { tracks: [], soundcloudTried: false, query: "" };
        playNext(guildId).catch(console.error);
      } else if (event.reason === "LOAD_FAILED") {
        recoverTrack(guildId, "Lavalink reported LOAD_FAILED", event.track).catch(console.error);
      }
    });

    player.on("exception", event =>
      recoverTrack(guildId, event.exception || event.error, event.track).catch(console.error));
    player.on("stuck", event =>
      recoverTrack(guildId, event, event.track).catch(console.error));
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
      s.fallbackByEncoded.clear();
      if (s.player) await shoukaku.leaveVoiceChannel(id);
      states.delete(id);
    },
    async play(id, channel, query) {
      await join(id, channel);
      const s = get(id);
      const tracks = await resolve(query, s.player.node);
      if (!tracks.length) {
        throw new Error("এই লিংক থেকে public playable audio পাওয়া যায়নি। Direct media link দাও; login/DRM-এ আটকানো লিংক চলবে না।");
      }

      const isDirectUrl = /^https?:\/\//i.test(query);
      const wasIdle = !s.current && s.queue.length === 0;
      s.currentQuery = query;

      const primary = tracks[0];
      saveFallbacks(s, primary, tracks.slice(1), query);

      if (isDirectUrl && s.current && s.player) {
        s.queue.unshift(primary);
        await s.player.stopTrack();
        s.current = null;
        s.currentFallback = { tracks: [], soundcloudTried: false, query: "" };
        await playNext(id);
        return { track: primary, queued: false, queueLength: s.queue.length };
      }

      // One requested song adds one queue item. Other search hits are used only if it fails.
      s.queue.push(primary);
      if (wasIdle) await playNext(id);
      return { track: primary, queued: !wasIdle, queueLength: s.queue.length };
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
      s.currentFallback = { tracks: [], soundcloudTried: false, query: "" };
      return playNext(id);
    },
    async stop(id) {
      const s = get(id);
      if (!s.player) return false;
      s.queue = [];
      s.current = null;
      s.currentFallback = { tracks: [], soundcloudTried: false, query: "" };
      s.fallbackByEncoded.clear();
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
