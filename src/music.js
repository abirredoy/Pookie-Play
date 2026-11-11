const { joinVoiceChannel, createAudioPlayer, AudioPlayerStatus, VoiceConnectionStatus, entersState, NoSubscriberBehavior } = require("@discordjs/voice");

function createMusic() {
  const states = new Map();
  function state(id) {
    if (!states.has(id)) {
      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
      states.set(id, { connection: null, player, volume: 70 });
    }
    return states.get(id);
  }
  async function join(guildId, channel) {
    const s = state(guildId);
    if (s.connection) {
      if (s.connection.joinConfig.channelId !== channel.id) throw new Error("আমি ইতিমধ্যে অন্য voice channel-এ আছি।");
      return s.connection;
    }
    const connection = joinVoiceChannel({ channelId: channel.id, guildId, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: true });
    s.connection = connection;
    connection.subscribe(s.player);
    connection.on(VoiceConnectionStatus.Disconnected, () => { s.connection = null; });
    try { await entersState(connection, VoiceConnectionStatus.Ready, 20000); }
    catch (error) { connection.destroy(); s.connection = null; throw error; }
    return connection;
  }
  return {
    join,
    leave(id) {
      const s = states.get(id);
      if (!s) return;
      if (s.player.state.status !== AudioPlayerStatus.Idle) s.player.stop(true);
      if (s.connection) s.connection.destroy();
      states.delete(id);
    },
    pause(id) { return state(id).player.pause(); },
    resume(id) { return state(id).player.unpause(); },
    skip(id) {
      const s = state(id);
      if (s.player.state.status === AudioPlayerStatus.Idle) return false;
      return s.player.stop(true);
    },
    stop(id) {
      const s = state(id);
      if (s.player.state.status === AudioPlayerStatus.Idle) return false;
      return s.player.stop(true);
    },
    volume(id, value) {
      const s = state(id);
      s.volume = Math.max(0, Math.min(100, value));
      const resource = s.player.state.resource;
      if (resource?.volume) resource.volume.setVolume(s.volume / 100);
      return s.volume;
    },
    adjustVolume(id, delta) {
      const s = state(id);
      return this.volume(id, s.volume + delta);
    }
  };
}
module.exports = { createMusic };
