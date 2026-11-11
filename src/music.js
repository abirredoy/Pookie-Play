const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, NoSubscriberBehavior } = require("@discordjs/voice");
const play = require("play-dl");

function createMusic() {
  const states = new Map();
  function state(id) {
    if (!states.has(id)) states.set(id, { connection: null, player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } }), queue: [], volume: 70 });
    return states.get(id);
  }
  async function join(guildId, channel) {
    const s = state(guildId);
    if (s.connection) return s.connection;
    s.connection = joinVoiceChannel({ channelId: channel.id, guildId, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: true });
    s.connection.subscribe(s.player);
    s.connection.on(VoiceConnectionStatus.Disconnected, () => { s.connection = null; });
    await entersState(s.connection, VoiceConnectionStatus.Ready, 20_000);
    s.player.on(AudioPlayerStatus.Idle, () => next(guildId).catch(console.error));
    return s.connection;
  }
  async function next(guildId) {
    const s = state(guildId);
    const item = s.queue.shift();
    if (!item) return;
    try {
      const stream = await play.stream(item.url);
      const resource = createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: true });
      resource.volume.setVolume(s.volume / 100);
      s.player.play(resource);
    } catch (e) {
      console.error("Playback error:", e);
      await next(guildId);
    }
  }
  async function playQuery(guildId, query) {
    const s = state(guildId);
    let url = query;
    if (!play.yt_validate(query)) {
      const results = await play.search(query, { limit: 1 });
      if (!results.length) return "কোনো YouTube ফলাফল পাওয়া যায়নি।";
      url = results[0].url;
    }
    s.queue.push({ url });
    if (s.player.state.status !== AudioPlayerStatus.Playing && s.player.state.status !== AudioPlayerStatus.Buffering) await next(guildId);
    return "গানটি queue-তে যোগ হয়েছে।";
  }
  return {
    join,
    leave(id) { const s = states.get(id); if (s?.connection) s.connection.destroy(); states.delete(id); },
    play: playQuery,
    pause(id) { state(id).player.pause(); },
    resume(id) { state(id).player.unpause(); },
    skip(id) { state(id).player.stop(true); },
    stop(id) { const s = state(id); s.queue = []; s.player.stop(true); },
    volume(id, v) { state(id).volume = v; },
    queueText(id) { const q = state(id).queue; return q.length ? q.map((x,i)=>`${i+1}. ${x.url}`).join("\n") : "Queue খালি।"; }
  };
}
module.exports = { createMusic };
