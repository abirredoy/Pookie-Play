function languageHint(info = {}) {
  const text = String((info.title || "") + " " + (info.author || ""));
  if (/[\u0980-\u09FF]/.test(text)) return "Bangla";
  if (/[\u0900-\u097F]/.test(text)) return "Hindi";
  if (/[\u0600-\u06FF]/.test(text)) return "Arabic";
  return "";
}

function normalizeUserQuery(query) {
  const q = String(query || "").trim();
  const key = q.toLowerCase();
  const presets = {
    bangla: "Bangla songs popular hits",
    "বাংলা": "Bangla songs popular hits",
    hindi: "Hindi songs popular hits",
    হিন্দি: "Hindi songs popular hits",
    global: "global international popular songs",
    worldwide: "global international popular songs",
    english: "English international songs",
    korean: "Korean K-pop songs",
    kpop: "K-pop songs",
    arabic: "Arabic songs",
    japanese: "Japanese songs"
  };
  return presets[key] || q;
}

function createMusic(shoukaku, onTrackStart = async () => {}) {
  const states = new Map();
  const get = (id) => {
    if (!states.has(id)) states.set(id, {
      player: null, queue: [], current: null, lastPlayed: null, currentQuery: "", fallbackTried: false, volume: 100,
      muted: false, paused: false, previousVolume: 100, textChannelId: null, mode: "auto", repeat: "off", history: [], seedIndex: 0, busy: false, recovering: false,
      listSlots: {}, listMode: false, listCurrentSlot: null, listOrder: [], autoSimilarTo: null
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
      if (/open\.spotify\.com\/track\//i.test(url)) {
        endpoint = "https://open.spotify.com/oembed?url=" + encodeURIComponent(url);
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
    let searchQuery = normalizeUserQuery(query);
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
    // Try YouTube first (primary music source), then SoundCloud as fallback.
    const yt = await tryResolve("ytsearch:" + searchQuery, node);
    if (yt.length) return yt;
    const sc = await tryResolve("scsearch:" + searchQuery, node);
    if (sc.length) return sc;
    const bc = await tryResolve("bcsearch:" + searchQuery, node);
    if (bc.length) return bc;
    return [];
  }
  async function findAutoplayTrack(s, similarTo = null) {
    if (!s.player?.node) return null;
    const recent = new Set([s.current, s.lastPlayed, ...s.history.slice(0, 8)]
      .map(t => String(t?.info?.title || "").toLowerCase()).filter(Boolean));
    const info = similarTo?.info || null;
    const artist = String(info?.author || "").split(/[,&|]/)[0].trim();
    const title = String(info?.title || "").trim();
    const language = info ? languageHint(info) : "";
    const queries = info
      ? [
          artist ? artist + " songs" : "",
          "songs similar to " + title + (artist ? " " + artist : ""),
          artist ? "artists similar to " + artist + " popular songs" : ""
        ].filter(Boolean)
      : [
          "popular hit songs",
          "trending pop music hits",
          "popular Hindi songs",
          "popular Bangla songs",
          "popular English songs",
          "popular K-pop songs"
        ];
    if (language && info) queries.unshift(language + " songs similar to " + title + " " + artist);
    for (const query of queries) {
      console.log("[AutoPlay] Searching:", query);
      const tracks = await resolve(query, s.player.node);
      const fresh = tracks.filter(t => {
        const name = String(t.info?.title || "").toLowerCase();
        return name && !recent.has(name);
      });
      if (fresh.length) return fresh[Math.floor(Math.random() * Math.min(fresh.length, 5))];
    }
    return null;
  }

  async function findRandomTrack(s) {
    if (!s.player?.node) return null;
    const recent = new Set([s.current, s.lastPlayed, ...s.history.slice(0, 12)]
      .map(t => String(t?.info?.title || "").toLowerCase()).filter(Boolean));
    // Pick across languages and genres, not just tracks similar to the current song.
    const queries = [
      "popular Bangla modern songs",
      "Bangla folk and baul songs",
      "Bangla band rock songs",
      "Bangla rap hip hop songs",
      "Bangla romantic songs",
      "Bangla adhunik classic songs",
      "Bangla dance and party songs",
      "popular Hindi Bollywood songs",
      "Hindi indie pop songs",
      "Hindi rap hip hop songs",
      "Hindi romantic songs",
      "English pop hits",
      "English rock hits",
      "funk music hits",
      "disco funk dance music",
      "R&B soul hits",
      "hip hop rap hits",
      "electronic dance music hits",
      "K-pop hits",
      "Arabic pop hits",
      "Japanese J-pop hits",
      "Latin pop hits"
    ];
    // Randomize the order so consecutive presses can move between styles/languages.
    for (let i = queries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queries[i], queries[j]] = [queries[j], queries[i]];
    }
    for (const query of queries.slice(0, 6)) {
      console.log("[Random Next] Searching:", query);
      const tracks = await resolve(query, s.player.node);
      const fresh = tracks.filter(t => {
        const name = String(t.info?.title || "").toLowerCase();
        return name && !recent.has(name);
      });
      if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)];
    }
    return null;
  }

  async function playNext(guildId) {
    const s = get(guildId);
    if (!s.player || s.busy) return false;
    s.busy = true;
    let retry = false;
    try {
      if (!s.queue.length && s.mode === "auto" && !s.listMode) {
        // With no current track, start a random station pick. After a track ends,
        // autoSimilarTo is set to that finished track so the next pick is related.
        const seed = s.autoSimilarTo;
        s.autoSimilarTo = null;
        const candidate = seed
          ? await findAutoplayTrack(s, seed)
          : await findRandomTrack(s);
        if (candidate) s.queue.push(candidate);
      }
      const track = s.queue.shift();
      if (!track) { s.current = null; return false; }
      s.current = track;
      console.log("[Music] Using Lavalink node:", s.player.node?.name || "unknown");
      console.log("[Music] Starting:", track.info?.title || "untitled", "| source:", track.info?.sourceName || "unknown");
      await s.player.playTrack({ track: { encoded: track.encoded } });
      s.paused = false;
      await s.player.setGlobalVolume(s.volume);
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

  function titleMatchScore(a, b) {
    const clean = value => String(value || "").toLowerCase()
      .replace(/\\[[^\\]]*\\]|\\([^)]*\\)/g, " ")
      .replace(/[^\\p{L}\\p{N}]+/gu, " ")
      .split(/\\s+/).filter(word => word.length > 1);
    const left = new Set(clean(a));
    const right = new Set(clean(b));
    if (!left.size || !right.size) return 0;
    let common = 0;
    for (const word of left) if (right.has(word)) common++;
    return common / Math.max(left.size, right.size);
  }

  async function findSoundCloudFallback(track, node) {
    if (!track?.info || !node) return null;
    const title = String(track.info.title || "").trim();
    const author = String(track.info.author || "").trim();
    if (!title) return null;
    const query = "scsearch:" + title + (author ? " " + author : "");
    const candidates = await tryResolve(query, node);
    const ranked = candidates
      .filter(candidate => candidate.info?.sourceName === "soundcloud")
      .map(candidate => ({ candidate, score: titleMatchScore(title, candidate.info?.title) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score < 0.60) {
      console.warn("[Music] No sufficiently close SoundCloud match found for failed YouTube track:", title);
      return null;
    }
    console.log("[Music] Found close SoundCloud fallback:", best.candidate.info.title, "| match:", best.score.toFixed(2));
    return best.candidate;
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
    let fallback = null;
    try {
      // GitHub-hosted runners can be blocked by YouTube's login/anti-bot checks.
      // Try SoundCloud only when its title closely matches the failed YouTube track.
      if (String(failedTrack?.info?.sourceName || "").toLowerCase() === "youtube") {
        fallback = await findSoundCloudFallback(failedTrack, s.player?.node);
      }
      s.current = null;
      if (fallback) s.queue.unshift(fallback);
    } finally {
      s.recovering = false;
    }
    await playNext(guildId);
  }

  function attachEvents(guildId, player) {
    player.on("start", event => {
      console.log("[Music] Playback started:", event.track?.info?.title || "unknown track");
      const s = get(guildId);
      onTrackStart(guildId, s.current || event.track, {
        textChannelId: s.textChannelId, volume: s.volume, repeat: s.repeat, mode: s.mode
      }).catch(error => console.error("[Player message]", error));
    });
    player.on("end", event => {
      console.log("[Music] Track ended:", event.reason);
      if (event.reason === "FINISHED") {
        const s = get(guildId);
        const finished = s.current;
        if (finished) {
          s.lastPlayed = finished;
          s.history.unshift(finished);
          s.history = s.history.slice(0, 25);
          if (!s.listMode) {
            if (s.mode === "auto") {
              if (s.repeat === "track") s.queue.unshift(finished);
              else s.autoSimilarTo = finished;
            } else if (s.repeat === "track") {
              s.queue.unshift(finished);
            } else if (s.repeat === "queue") {
              s.queue.push(finished);
            } else if (s.repeat === "shuffle") {
              s.queue.push(finished);
              for (let i = s.queue.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]];
              }
            }
          }
        }
        s.current = null;
        if (s.listMode) {
          const slots = s.listOrder.length
            ? s.listOrder
            : Object.keys(s.listSlots).map(Number).filter(n => n >= 1 && n <= 10 && s.listSlots[n]).sort((a, b) => a - b);
          let nextSlot = null;
          if (s.repeat === "track") {
            nextSlot = s.listCurrentSlot;
          } else {
            const currentIndex = slots.indexOf(Number(s.listCurrentSlot));
            if (currentIndex >= 0 && currentIndex < slots.length - 1) nextSlot = slots[currentIndex + 1];
            else if (s.repeat === "queue" || s.repeat === "shuffle") {
              if (s.repeat === "shuffle") {
                s.listOrder = slots.slice();
                for (let i = s.listOrder.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [s.listOrder[i], s.listOrder[j]] = [s.listOrder[j], s.listOrder[i]];
                }
                if (s.listOrder.length > 1 && s.listOrder[0] === s.listCurrentSlot) {
                  [s.listOrder[0], s.listOrder[1]] = [s.listOrder[1], s.listOrder[0]];
                }
              }
              nextSlot = s.listOrder[0] ?? slots[0] ?? null;
            }
          }
          if (nextSlot && s.listSlots[nextSlot]) {
            s.listCurrentSlot = nextSlot;
            s.queue = [s.listSlots[nextSlot]];
            playNext(guildId).catch(console.error);
          } else {
            s.listMode = false;
            s.listCurrentSlot = null;
            s.listOrder = [];
            s.queue = [];
            console.log("[List Mode] Playlist finished.");
          }
        } else if (s.mode === "auto" || s.queue.length > 0 || s.repeat === "track" || s.repeat === "queue" || s.repeat === "shuffle") {
          playNext(guildId).catch(console.error);
        }
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
    await player.setGlobalVolume(s.volume);
    console.log("[Music] Joined voice channel in guild", guildId);
    return player;
  }

  return {
    join,
    setTextChannel(id, channelId) { get(id).textChannelId = channelId; },
    async leave(id) {
      const s = get(id);
      s.queue = [];
      s.current = null;
      s.history = [];
      if (s.player) await shoukaku.leaveVoiceChannel(id);
      states.delete(id);
    },
    async add(id, channel, query, textChannelId) {
      const s = get(id);
      if (s.mode !== "queue") throw new Error("আগে /mode type:Queue Mode চালু করো। Auto Mode-এ /add ব্যবহার করা যাবে না।");
      if (s.listMode) throw new Error("List Mode চালু আছে। সাধারণ Queue-তে গান দিতে আগে /list mode enabled:false করো।");
      await join(id, channel);
      if (textChannelId) s.textChannelId = textChannelId;
      const tracks = await resolve(query, s.player.node);
      if (!tracks.length) throw new Error("এই নাম বা লিংকের গানটি পাওয়া যায়নি। অন্য নাম বা সরাসরি song link দিয়ে চেষ্টা করো।");
      const wasIdle = !s.current;
      s.queue.push(tracks[0]);
      if (wasIdle) await playNext(id);
      return { track: tracks[0], queued: !wasIdle, queueLength: s.queue.length };
    },
    async play(id, channel, query, textChannelId) {
      await join(id, channel);
      const s = get(id);
      if (s.listMode) { s.listMode = false; s.listCurrentSlot = null; s.listOrder = []; s.mode = "auto"; }
      if (textChannelId) s.textChannelId = textChannelId;
      const tracks = await resolve(query, s.player.node);
      if (!tracks.length) throw new Error("YouTube ও SoundCloud—কোনো সোর্স থেকেই গানটি পাওয়া যায়নি। অন্য নাম বা সরাসরি audio link দিয়ে চেষ্টা করো।");
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

      if (s.mode === "auto") {
        // Radio mode plays the requested track first, then discovers related tracks itself.
        s.queue = [tracks[0]];
      } else {
        // One /play request adds one selected track; users control the rest of the queue.
        s.queue.push(tracks[0]);
      }
      if (wasIdle) await playNext(id);
      return { track: tracks[0], queued: !wasIdle, queueLength: s.queue.length };
    },
    async searchTracks(id, query) {
      const s = get(id);
      if (!s.player?.node) throw new Error("আগে voice channel-এ যোগ দাও।");
      return (await resolve(query, s.player.node)).slice(0, 10);
    },
    async playResolved(id, channel, track, textChannelId) {
      await join(id, channel);
      const s = get(id);
      if (s.listMode) { s.listMode = false; s.listCurrentSlot = null; s.listOrder = []; }
      s.mode = "auto";
      if (textChannelId) s.textChannelId = textChannelId;
      s.queue = [track];
      s.currentQuery = String(track.info?.title || "");
      s.fallbackTried = false;
      if (s.current && s.player) {
        await s.player.stopTrack();
        s.current = null;
      }
      await playNext(id);
      return { track, queued: false, queueLength: s.queue.length };
    },
    async pause(id) {
      const s = get(id);
      if (!s.player || !s.current) return false;
      await s.player.setPaused(true);
      s.paused = true;
      return true;
    },
    async resume(id) {
      const s = get(id);
      if (!s.player || !s.current) return false;
      await s.player.setPaused(false);
      s.paused = false;
      return true;
    },
    async skip(id) {
      const s = get(id);
      if (!s.player || !s.current) return false;
      const skipped = s.current;
      s.history.unshift(skipped);
      s.history = s.history.slice(0, 25);
      if (s.listMode) {
        let order = s.listOrder.length
          ? s.listOrder.slice()
          : Object.keys(s.listSlots).map(Number).sort((a,b)=>a-b);
        const currentIndex = order.indexOf(Number(s.listCurrentSlot));
        let next = currentIndex >= 0 ? order[currentIndex + 1] : null;
        if (!next && (s.repeat === "queue" || s.repeat === "shuffle")) {
          if (s.repeat === "shuffle") {
            order = Object.keys(s.listSlots).map(Number).sort((a,b)=>a-b);
            for (let i = order.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [order[i], order[j]] = [order[j], order[i]];
            }
            if (order.length > 1 && order[0] === Number(s.listCurrentSlot)) {
              [order[0], order[1]] = [order[1], order[0]];
            }
            s.listOrder = order;
          }
          next = order[0] ?? null;
        }
        await s.player.stopTrack();
        s.current = null;
        if (!next || !s.listSlots[next]) {
          s.listMode = false;
          s.listCurrentSlot = null;
          s.listOrder = [];
          s.queue = [];
          return false;
        }
        s.listCurrentSlot = next;
        s.queue = [s.listSlots[next]];
        return playNext(id);
      }
      if (s.mode === "auto") {
        s.lastPlayed = skipped;
        s.queue = [];
      }
      await s.player.stopTrack();
      s.current = null;
      return playNext(id);
    },
    async previous(id) {
      const s = get(id);
      if (!s.player || !s.current || !s.history.length) return false;
      const previousTrack = s.history.shift();
      s.queue.unshift(s.current);
      s.queue.unshift(previousTrack);
      await s.player.stopTrack();
      s.current = null;
      s.fallbackTried = false;
      return playNext(id);
    },
    async stop(id) {
      const s = get(id);
      if (!s.player) return false;
      s.queue = [];
      s.current = null;
      s.repeat = "off";
      s.listMode = false;
      s.listCurrentSlot = null;
      s.listOrder = [];
      await s.player.stopTrack();
      return true;
    },
    async volume(id, value) {
      const s = get(id);
      s.volume = Math.max(0, Math.min(100, value));
      if (s.player) await s.player.setGlobalVolume(s.volume);
      return s.volume;
    },
    async adjustVolume(id, delta) {
      const s = get(id);
      const before = s.volume;
      const after = await this.volume(id, before + delta);
      return { before, after, volume: after };
    },
    async toggleMute(id) {
      const s = get(id);
      if (!s.muted) {
        s.previousVolume = s.volume;
        s.muted = true;
        await this.volume(id, 0);
      } else {
        s.muted = false;
        await this.volume(id, s.previousVolume);
      }
      return { muted: s.muted, volume: s.volume };
    },
    cycleMode(id) { const s = get(id); s.mode = s.mode === "auto" ? "queue" : "auto"; return s.mode; },
    async seekRelative(id, delta) {
      const s = get(id);
      if (!s.player || !s.current) return false;
      const position = Number(s.player.position || 0);
      return this.seek(id, position + delta);
    },
    async setMode(id, mode) {
      const s = get(id);
      s.mode = mode === "auto" ? "auto" : "queue";
      if (s.mode === "auto") {
        s.listMode = false;
        s.listCurrentSlot = null;
        s.listOrder = [];
        s.queue = [];
        s.autoSimilarTo = null;
        if (s.player && !s.current) await playNext(id);
      }
      return s.mode;
    },
    getMode(id) { return get(id).mode; },
    async addList(id, channel, slot, query, textChannelId) {
      const s = get(id);
      const n = Number(slot);
      if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error("List Slot অবশ্যই 1 থেকে 10-এর মধ্যে হতে হবে।");
      if (s.listSlots[n]) throw new Error("List Slot " + n + " আগে থেকেই ভর্তি। অন্য Slot বেছে নাও অথবা আগে remove করো।");
      await join(id, channel);
      if (textChannelId) s.textChannelId = textChannelId;
      const tracks = await resolve(query, s.player.node);
      if (!tracks.length) throw new Error("এই গানটি পাওয়া যায়নি। অন্য নাম বা লিংক দিয়ে চেষ্টা করো।");
      s.listSlots[n] = tracks[0];
      return { slot: n, track: tracks[0], count: Object.keys(s.listSlots).length };
    },
    async removeList(id, slot) {
      const s = get(id), n = Number(slot);
      if (!s.listSlots[n]) return null;
      const removed = s.listSlots[n];
      delete s.listSlots[n];
      if (s.listMode && s.listCurrentSlot === n) {
        s.listMode = false;
        s.listCurrentSlot = null;
        s.listOrder = [];
        if (s.player && s.current) { await s.player.stopTrack(); s.current = null; }
      }
      return { slot: n, info: removed.info };
    },
    clearList(id) {
      const s = get(id), count = Object.keys(s.listSlots).length;
      s.listSlots = {};
      s.listMode = false;
      s.listCurrentSlot = null;
      s.listOrder = [];
      return count;
    },
    getListSlots(id) {
      const s = get(id);
      return Object.keys(s.listSlots).map(Number).sort((a,b)=>a-b).map(slot => ({ slot, info: s.listSlots[slot].info }));
    },
    exportListSlots() {
      const out = {};
      for (const [guildId, s] of states) {
        const slots = {};
        for (const [slot, track] of Object.entries(s.listSlots || {})) {
          if (track?.encoded) slots[slot] = { encoded: track.encoded, info: track.info || {} };
        }
        if (Object.keys(slots).length) out[guildId] = slots;
      }
      return out;
    },
    loadListSlots(saved = {}) {
      for (const [guildId, slots] of Object.entries(saved || {})) {
        const s = get(guildId);
        s.listSlots = {};
        for (const [slot, track] of Object.entries(slots || {})) {
          const n = Number(slot);
          if (Number.isInteger(n) && n >= 1 && n <= 10 && track?.encoded) s.listSlots[n] = track;
        }
      }
    },
    async setListMode(id, enabled) {
      const s = get(id);
      if (!enabled) {
        s.listMode = false;
        s.listCurrentSlot = null;
        s.listOrder = [];
        s.queue = [];
        s.autoSimilarTo = s.current || s.autoSimilarTo;
        if (s.player && !s.current) await playNext(id);
        return false;
      }
      const slots = Object.keys(s.listSlots).map(Number).sort((a,b)=>a-b);
      if (!slots.length) throw new Error("List খালি। আগে /list add দিয়ে গান যোগ করো।");
      if (!s.player) throw new Error("আগে voice channel-এ যোগ দাও।");
      s.mode = "queue";
      s.listMode = true;
      s.listOrder = slots.slice();
      if (s.repeat === "shuffle") {
        for (let i = s.listOrder.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [s.listOrder[i], s.listOrder[j]] = [s.listOrder[j], s.listOrder[i]];
        }
      }
      s.listCurrentSlot = s.listOrder[0];
      s.queue = [s.listSlots[s.listCurrentSlot]];
      if (s.current) await s.player.stopTrack();
      s.current = null;
      await playNext(id);
      return true;
    },
    async playList(id, channel, slot, textChannelId) {
      const s = get(id), n = Number(slot);
      if (!s.listSlots[n]) throw new Error("List Slot " + n + " খালি। আগে /list add দিয়ে গান রাখো।");
      await join(id, channel);
      if (textChannelId) s.textChannelId = textChannelId;
      s.mode = "queue";
      s.listMode = true;
      s.listOrder = Object.keys(s.listSlots).map(Number).sort((a,b)=>a-b);
      if (s.repeat === "shuffle") {
        for (let i = s.listOrder.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [s.listOrder[i], s.listOrder[j]] = [s.listOrder[j], s.listOrder[i]];
        }
      }
      s.listCurrentSlot = n;
      if (s.repeat === "shuffle") {
        s.listOrder = [n, ...s.listOrder.filter(slot => slot !== n)];
      }
      s.queue = [s.listSlots[n]];
      if (s.current) await s.player.stopTrack();
      s.current = null;
      await playNext(id);
      return { slot: n, track: s.listSlots[n] };
    },
    async randomNext(id) {
      const s = get(id);
      if (!s.player) return false;
      s.listMode = false;
      s.listCurrentSlot = null;
      s.listOrder = [];
      s.mode = "auto";
      const candidate = await findRandomTrack(s);
      if (!candidate) return false;
      if (s.current) {
        s.history.unshift(s.current);
        s.history = s.history.slice(0, 25);
        s.lastPlayed = s.current;
      }
      s.queue.unshift(candidate);
      if (s.current) await s.player.stopTrack();
      s.current = null;
      return playNext(id);
    },
    async seek(id, position) {
      const s = get(id);
      if (!s.player || !s.current) return false;
      const duration = Number(s.current.info?.length || 0);
      const target = Math.max(0, Math.min(Number(position) || 0, duration || Number(position) || 0));
      await s.player.seekTo(target);
      return target;
    },
    shuffle(id) {
      const s = get(id);
      for (let i = s.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]];
      }
      return s.queue.length;
    },
    remove(id, index) {
      const s = get(id);
      const n = Number(index) - 1;
      if (!Number.isInteger(n) || n < 0 || n >= s.queue.length) return null;
      return s.queue.splice(n, 1)[0]?.info || null;
    },
    move(id, from, to) {
      const s = get(id);
      const a = Number(from) - 1, b = Number(to) - 1;
      if (![a,b].every(Number.isInteger) || a < 0 || b < 0 || a >= s.queue.length || b >= s.queue.length) return false;
      const [track] = s.queue.splice(a, 1);
      s.queue.splice(b, 0, track);
      return true;
    },
    clearQueue(id) {
      const s = get(id);
      const count = s.queue.length;
      s.queue = [];
      return count;
    },
    setRepeat(id, mode) {
      const s = get(id);
      s.repeat = ["off", "track", "queue", "shuffle"].includes(mode) ? mode : "off";
      if (s.listMode && s.repeat === "shuffle") {
        const slots = Object.keys(s.listSlots).map(Number).sort((a,b)=>a-b);
        s.listOrder = [Number(s.listCurrentSlot), ...slots.filter(n => n !== Number(s.listCurrentSlot))];
        for (let i = s.listOrder.length - 1; i > 1; i--) {
          const j = 1 + Math.floor(Math.random() * i);
          [s.listOrder[i], s.listOrder[j]] = [s.listOrder[j], s.listOrder[i]];
        }
      } else if (s.listMode) {
        s.listOrder = Object.keys(s.listSlots).map(Number).sort((a,b)=>a-b);
      } else if (s.repeat === "shuffle") {
        for (let i = s.queue.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]];
        }
      }
      return s.repeat;
    },
    getQueue(id) {
      const s = get(id);
      return { current: s.current?.info || null, tracks: s.queue.map(t => t.info), mode: s.mode, listMode: s.listMode, listCurrentSlot: s.listCurrentSlot, listSlots: Object.keys(s.listSlots).length, repeat: s.repeat, volume: s.volume, muted: s.muted, paused: s.paused, node: s.player?.node?.name || "Disconnected", connected: Boolean(s.player), history: s.history.map(t => t.info) };
    }
  };
}

module.exports = { createMusic };
