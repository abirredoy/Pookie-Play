require("dotenv").config();
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits
} = require("discord.js");
const express = require("express");
const { Shoukaku, Connectors } = require("shoukaku");
const { createMusic } = require("./music");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID.");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder().setName("join").setDescription("Join your voice channel"),
  new SlashCommandBuilder().setName("leave").setDescription("Leave the voice channel"),
  new SlashCommandBuilder().setName("play").setDescription("Play a song using Spotify links or song names")
    .addStringOption(o => o.setName("query").setDescription("Song name or Spotify track link").setRequired(true)),
  new SlashCommandBuilder().setName("player").setDescription("Show music player controls"),
  new SlashCommandBuilder().setName("queue").setDescription("Show the music queue"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current track"),
  new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle upcoming tracks"),
  new SlashCommandBuilder().setName("clearqueue").setDescription("Clear upcoming tracks"),
  new SlashCommandBuilder().setName("remove").setDescription("Remove a track from the queue")
    .addIntegerOption(o => o.setName("position").setDescription("Queue position (starts at 1)").setMinValue(1).setRequired(true)),
  new SlashCommandBuilder().setName("move").setDescription("Move a track in the queue")
    .addIntegerOption(o => o.setName("from").setDescription("Current position").setMinValue(1).setRequired(true))
    .addIntegerOption(o => o.setName("to").setDescription("New position").setMinValue(1).setRequired(true)),
  new SlashCommandBuilder().setName("repeat").setDescription("Set repeat mode")
    .addStringOption(o => o.setName("mode").setDescription("Repeat mode").setRequired(true)
      .addChoices({name:"Off",value:"off"},{name:"Current track",value:"track"},{name:"Queue",value:"queue"})),
  new SlashCommandBuilder().setName("seek").setDescription("Jump to a position in the current track")
    .addIntegerOption(o => o.setName("seconds").setDescription("Position in seconds").setMinValue(0).setRequired(true)),
  new SlashCommandBuilder().setName("mode").setDescription("Switch between Auto Mode and Queue Mode")
    .addStringOption(o => o.setName("type").setDescription("Playback mode").setRequired(true)
      .addChoices({ name: "Auto Mode", value: "auto" }, { name: "Queue Mode", value: "queue" })),
  new SlashCommandBuilder().setName("autoplay").setDescription("Turn automatic music selection on or off")
    .addBooleanOption(o => o.setName("enabled").setDescription("Enable autoplay").setRequired(true)),
  new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue"),
  new SlashCommandBuilder().setName("volume").setDescription("Set volume")
    .addIntegerOption(o => o.setName("value").setDescription("0 to 100").setMinValue(0).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName("controlrole").setDescription("Choose the role allowed to control Pookie Play")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(o => o.setName("role").setDescription("Role allowed to control the bot").setRequired(true)),
  new SlashCommandBuilder().setName("help").setDescription("Show Pookie Play commands")
].map(command => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
// Pookie Play connects to CloudeWave's shared public Lavalink v4 node.
// This node is community-shared and is intended for testing; availability is not guaranteed.
if (!process.env.LAVALINK_HOST || !process.env.LAVALINK_PASSWORD) {
  console.error("Missing private Lavalink configuration (LAVALINK_HOST / LAVALINK_PASSWORD).");
  process.exit(1);
}
const nodes = [{
  name: "CloudeWave-Public",
  url: process.env.LAVALINK_HOST,
  auth: process.env.LAVALINK_PASSWORD,
  secure: process.env.LAVALINK_SECURE === "true"
}];
const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
  moveOnDisconnect: true,
  reconnectTries: 5,
  reconnectInterval: 5
});
shoukaku.on("ready", name => console.log("[Lavalink] Connected:", name));
shoukaku.on("error", (name, error) => console.error("[Lavalink] Error:", name, error));
shoukaku.on("close", (name, code, reason) => console.warn("[Lavalink] Closed:", name, code, reason));
const music = createMusic(shoukaku, async (guildId, track, state) => {
  try {
    const channel = state.textChannelId ? await client.channels.fetch(state.textChannelId) : null;
    if (!channel || !channel.isTextBased()) return;
    const info = track.info || {};
    const embed = new EmbedBuilder().setColor(0x5865f2)
      .setTitle("🎶 Now Playing")
      .setDescription("**" + String(info.title || "Unknown track").slice(0, 240) + "**\\n" + String(info.author || "Unknown artist").slice(0, 180))
      .addFields(
        { name: "🎧 Source", value: String(info.sourceName || "Audio source"), inline: true },
        { name: "🔊 Volume", value: String(state.volume) + "%", inline: true },
        { name: "🔁 Repeat", value: state.repeat, inline: true }
      )
      .setFooter({ text: "🤖 Auto Mode: " + (state.mode === "auto" ? "ON" : "OFF") + " • 📜 Queue Mode: " + (state.mode === "queue" ? "ON" : "OFF") + "\n📍 Status: Player ready" });
    if (info.uri) embed.setURL(info.uri);
    await channel.send({ embeds: [embed], components: controlRows(music.getQueue(guildId)) });
  } catch (error) {
    console.error("[Player message] Could not post track card:", error?.message || error);
  }
});
const controlRoles = new Map();

async function loadControlRoles() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    console.warn("[Permissions] GitHub persistence is unavailable; /controlrole cannot be saved.");
    return;
  }
  const url = "https://api.github.com/repos/" + repo + "/contents/data/control-roles.json";
  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
  });
  if (response.status === 404) return;
  if (!response.ok) throw new Error("Could not load saved control roles from GitHub: HTTP " + response.status);
  const file = await response.json();
  const saved = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  for (const [guildId, roleId] of Object.entries(saved)) controlRoles.set(guildId, roleId);
  console.log("[Permissions] Loaded saved control roles:", controlRoles.size);
}

async function saveControlRole(guildId, roleId) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error("GitHub storage is not available. Start the bot through its GitHub Actions workflow.");
  const url = "https://api.github.com/repos/" + repo + "/contents/data/control-roles.json";
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const current = await fetch(url, { headers });
  let saved = {};
  let sha;
  if (current.ok) {
    const file = await current.json();
    sha = file.sha;
    saved = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  } else if (current.status !== 404) {
    throw new Error("Could not read role settings from GitHub: HTTP " + current.status);
  }
  saved[guildId] = roleId;
  const body = {
    message: "Save Pookie Play control role",
    content: Buffer.from(JSON.stringify(saved, null, 2) + "\n").toString("base64"),
    branch: process.env.GITHUB_REF_NAME || "main"
  };
  if (sha) body.sha = sha;
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error("Could not save control role to GitHub: HTTP " + response.status + " " + detail.slice(0, 300));
  }
  controlRoles.set(guildId, roleId);
}

function hasControlPermission(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const roleId = controlRoles.get(interaction.guildId);
  if (!roleId) return true; // Until the owner configures a role, preserve current bot behavior.
  const memberRoles = interaction.member?.roles;
  if (memberRoles?.cache) return memberRoles.cache.has(roleId);
  return Array.isArray(memberRoles) && memberRoles.includes(roleId);
}

function playerStatusFooter(q, status = "Ready") {
  const auto = q.mode === "auto" ? "ON" : "OFF";
  const queue = q.mode === "queue" ? "ON" : "OFF";
  const repeat = q.repeat === "track" ? "Song" : q.repeat === "queue" ? "Queue" : "OFF";
  return { text: "🤖 Auto Mode: " + auto + " • 📜 Queue Mode: " + queue + " • Repeat: " + repeat + "\n📍 Status: " + String(status).slice(0, 130) };
}

function controlRows(q = {}) {
  const button = (id, label, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId("pookie_" + id).setLabel(label).setStyle(style);
  const active = ButtonStyle.Danger;
  const inactive = ButtonStyle.Primary;
  return [
    new ActionRowBuilder().addComponents(
      button("previous", "⏮️ Previous"), button("pause", "⏸️ Pause"),
      button("resume", "▶️ Resume", ButtonStyle.Secondary),
      button("skip", "⏭️ Next", ButtonStyle.Primary), button("stop", "⏹️ Stop", ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      button("volume_down", "🔉 Volume −"), button("volume_up", "🔊 Volume +"),
      button("mute", q.muted ? "🔊 Unmute" : "🔇 Mute", q.muted ? active : inactive),
      button("shuffle", "🔀 Shuffle"), button("clearqueue", "🧹 Clear Queue", ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      button("repeat_off", "➡️ Repeat Off", inactive),
      button("repeat_track", "🔂 Repeat Song", q.repeat === "track" ? active : inactive),
      button("repeat_queue", "🔁 Repeat Queue", q.repeat === "queue" ? active : inactive),
      button("autoplay", "🤖 Auto Mode", q.mode === "auto" ? active : inactive),
      button("queue_mode", "📜 Queue Mode", q.mode === "queue" ? active : inactive)
    ),
    new ActionRowBuilder().addComponents(
      button("seek_back", "⏪ −10 sec"), button("seek_forward", "⏩ +10 sec"),
      button("restart", "🔄 Restart"), button("random_next", "🎲 Random Next"),
      button("nowplaying", "🎵 Now Playing", ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      button("queue", "📜 Queue", ButtonStyle.Primary), button("leave", "👋 Leave VC", ButtonStyle.Danger)
    )
  ];
}
async function requireVoice(interaction) {
  const channel = interaction.member?.voice?.channel;
  if (!channel) throw new Error("আগে একটি voice channel-এ যোগ দাও।");
  return channel;
}

client.once("ready", async () => {
  console.log("Logged in as " + client.user.tag);
  try { await loadControlRoles(); }
  catch (error) { console.error("[Permissions] Failed to load role settings:", error); }
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(clientId, process.env.GUILD_ID)
      : Routes.applicationCommands(clientId);
    await rest.put(route, { body: commands });
    console.log("Slash commands registered.");
  } catch (error) { console.error("Command registration failed:", error); }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) {
      if (!interaction.guildId) return;
      if (!hasControlPermission(interaction)) {
        return interaction.reply({ content: "⛔ Pookie Play নিয়ন্ত্রণ করার অনুমতি তোমার নেই। নির্ধারিত Role লাগবে।", ephemeral: true });
      }
      const id = interaction.customId.replace("pookie_", "");
      const data = music.getQueue(interaction.guildId);
      if (id === "queue" || id === "nowplaying") {
        const q = music.getQueue(interaction.guildId);
        const status = id === "queue"
          ? "Queue viewed • " + q.tracks.length + " upcoming track(s)"
          : (q.current ? "Now playing: " + q.current.title : "Nothing is playing");
        const embed = interaction.message.embeds[0]
          ? EmbedBuilder.from(interaction.message.embeds[0])
          : new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play");
        if (id === "queue") {
          const upcoming = q.tracks.slice(0, 15).map((t, i) => (i + 1) + ". " + t.title).join("\n");
          embed.setDescription((q.current ? "**Now Playing:** " + q.current.title : "Nothing is playing") +
            (upcoming ? "\n\n**Up Next:**\n" + upcoming : "\n\nQueue is empty."));
        } else if (q.current) {
          embed.setDescription("**" + q.current.title + "**\n" + (q.current.author || "Unknown artist"));
        }
        embed.setFooter(playerStatusFooter(q, status));
        return interaction.update({ embeds: [embed], components: controlRows(q) });
      }
      const simpleActions = {
        previous: () => music.previous(interaction.guildId),
        pause: () => music.pause(interaction.guildId),
        resume: () => music.resume(interaction.guildId),
        skip: () => music.skip(interaction.guildId),
        stop: () => music.stop(interaction.guildId),
        volume_down: () => music.adjustVolume(interaction.guildId, -10),
        volume_up: () => music.adjustVolume(interaction.guildId, 10),
        mute: () => music.toggleMute(interaction.guildId),
        shuffle: () => music.shuffle(interaction.guildId),
        clearqueue: () => music.clearQueue(interaction.guildId),
        repeat_off: () => music.setRepeat(interaction.guildId, "off"),
        repeat_track: () => music.setRepeat(interaction.guildId, "track"),
        repeat_queue: () => music.setRepeat(interaction.guildId, "queue"),
        autoplay: () => music.setMode(interaction.guildId, data.mode === "auto" ? "queue" : "auto"),
        queue_mode: () => music.setMode(interaction.guildId, data.mode === "queue" ? "auto" : "queue"),
        random_next: () => music.randomNext(interaction.guildId),
        seek_back: () => music.seekRelative(interaction.guildId, -10000),
        seek_forward: () => music.seekRelative(interaction.guildId, 10000),
        restart: () => music.seek(interaction.guildId, 0),
        vol25: () => music.volume(interaction.guildId, 25),
        vol50: () => music.volume(interaction.guildId, 50),
        vol75: () => music.volume(interaction.guildId, 75),
        vol100: () => music.volume(interaction.guildId, 100),
        leave: () => music.leave(interaction.guildId)
      };
      const action = simpleActions[id];
      if (!action) return;
      await interaction.deferUpdate();
      let result;
      let success = false;
      try {
        result = await action();
        success = ["shuffle", "clearqueue", "repeat_off", "repeat_track", "repeat_queue", "autoplay", "queue_mode", "volume_down", "volume_up", "mute", "vol25", "vol50", "vol75", "vol100", "leave"].includes(id)
          ? true : result !== false;
      } catch (error) {
        console.error("[Player button] Action failed:", id, error);
      }
      const labels = {
        previous: "Previous track", pause: "Playback paused",
        resume: "Playback resumed", skip: "Next track selected",
        stop: "Playback stopped", volume_down: "Volume: " + (result?.before ?? "?") + "% → " + (result?.after ?? "?") + "%",
        volume_up: "Volume: " + (result?.before ?? "?") + "% → " + (result?.after ?? "?") + "%",
        mute: result?.muted ? "Mute: ON" : "Mute: OFF",
        shuffle: "Queue shuffled", clearqueue: "Upcoming queue cleared",
        repeat_off: "Repeat: OFF", repeat_track: "Repeat: SONG", repeat_queue: "Repeat: QUEUE",
        autoplay: result === "auto" ? "Auto Mode: ON • Queue Mode: OFF" : "Auto Mode: OFF • Queue Mode: ON",
        queue_mode: result === "queue" ? "Queue Mode: ON • Auto Mode: OFF" : "Queue Mode: OFF • Auto Mode: ON",
        random_next: "Random related track selected",
        seek_back: "Seeked back 10 seconds", seek_forward: "Seeked forward 10 seconds",
        restart: "Track restarted", vol25: "Volume: 25%", vol50: "Volume: 50%",
        vol75: "Volume: 75%", vol100: "Volume: 100%", leave: "Disconnected from voice channel"
      };
      const q = music.getQueue(interaction.guildId);
      const status = success ? (labels[id] || "Action completed") : "Action failed — check voice connection or queue";
      const embed = interaction.message.embeds[0]
        ? EmbedBuilder.from(interaction.message.embeds[0])
        : new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play");
      embed.setFooter(playerStatusFooter(q, status));
      return interaction.message.edit({ embeds: [embed], components: id === "leave" ? [] : controlRows(q) });
    }
    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;

    if (name === "help") {
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play — Help")
        .setDescription("YouTube, YouTube Music ও SoundCloud থেকে গান খুঁজে চালানোর চেষ্টা করবে।")
        .addFields(
          { name: "Music", value: "/play query — গান চালাও\n/queue — Queue দেখো\n/join /leave — Voice control", inline: false },
          { name: "Playback modes", value: "/mode auto অথবা queue — Auto Mode ও Queue Mode একসঙ্গে চালু হবে না", inline: false },
          { name: "Queue tools", value: "/shuffle /remove /move /clearqueue /repeat /seek /nowplaying", inline: false },
          { name: "Controls", value: "/pause /resume /skip /stop /volume value এবং Player buttons", inline: false },
          { name: "Admin", value: "/controlrole role — কোন Role বট নিয়ন্ত্রণ করবে সেট করো (Administrator permission প্রয়োজন)", inline: false }
        ).setFooter({ text: "Sources: YouTube • YouTube Music • SoundCloud (যেটি পাওয়া যায়)।" });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (name === "controlrole") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "⛔ শুধু Server Owner বা Administrator এই সেটিং বদলাতে পারবে।", ephemeral: true });
      }
      const role = interaction.options.getRole("role", true);
      await interaction.deferReply({ ephemeral: true });
      await saveControlRole(interaction.guildId, role.id);
      return interaction.editReply("✅ " + role.toString() + " এখন Pookie Play নিয়ন্ত্রণ করতে পারবে। Role না থাকা সদস্যরা কমান্ড ও Player Button ব্যবহার করতে পারবে না।");
    }

    if (!hasControlPermission(interaction)) {
      return interaction.reply({ content: "⛔ Pookie Play নিয়ন্ত্রণ করার অনুমতি তোমার নেই। নির্ধারিত Role লাগবে।", ephemeral: true });
    }

    if (name === "play") {
      const query = interaction.options.getString("query", true);
      const channel = await requireVoice(interaction);
      await interaction.deferReply();
      const result = await music.play(interaction.guildId, channel, query, interaction.channelId);
      return interaction.editReply(result.queued
        ? "➕ **" + result.track.info.title + "** Queue-তে যোগ হয়েছে। গান শুরু হলে নতুন Player card আসবে।"
        : "🎶 **" + result.track.info.title + "** চালু হচ্ছে। নতুন Player card পাঠানো হচ্ছে।");
    }

    if (name === "join") {
      const channel = await requireVoice(interaction);
      await interaction.deferReply();
      await music.join(interaction.guildId, channel);
      return interaction.editReply("🎧 Pookie Play voice channel-এ যোগ দিয়েছে।");
    }

    if (name === "leave") {
      await music.leave(interaction.guildId);
      return interaction.reply("👋 Voice channel ছেড়েছি।");
    }

    if (name === "mode" || name === "autoplay") {
      const selectedMode = name === "mode"
        ? interaction.options.getString("type", true)
        : (interaction.options.getBoolean("enabled", true) ? "auto" : "queue");
      const enabled = selectedMode === "auto";
      await interaction.deferReply({ ephemeral: true });
      if (enabled) {
        const channel = await requireVoice(interaction);
        await music.join(interaction.guildId, channel);
        music.setTextChannel(interaction.guildId, interaction.channelId);
      }
      await music.setMode(interaction.guildId, selectedMode);
      return interaction.editReply(enabled
        ? "Auto Mode: ON. Related tracks will play continuously."
        : "Queue Mode: ON. Only tracks added to the queue will play.");
    }

    if (name === "queue") {
      const data = music.getQueue(interaction.guildId);
      const current = data.current ? "**এখন বাজছে:** " + data.current.title : "এখন কিছু বাজছে না।";
      const upcoming = data.tracks.slice(0, 10).map((t, i) => (i + 1) + ". " + t.title).join("\n");
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎵 Pookie Play Queue")
        .setDescription(current + (upcoming ? "\n\n**পরের গানগুলো:**\n" + upcoming : "\n\nQueue খালি।"))
        .setFooter({ text: "Auto Mode: " + (data.mode === "auto" ? "ON" : "OFF") + " • Queue Mode: " + (data.mode === "queue" ? "ON" : "OFF") + " • Repeat: " + data.repeat });
      return interaction.reply({ embeds: [embed] });
    }

    if (name === "nowplaying") {
      const data = music.getQueue(interaction.guildId);
      if (!data.current) return interaction.reply("এখন কোনো গান চলছে না।");
      const info = data.current;
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎶 এখন বাজছে")
        .setDescription("**" + info.title + "**\n" + (info.author || "Unknown artist"))
        .addFields({name:"Repeat",value:data.repeat,inline:true});
      if (info.uri) embed.setURL(info.uri);
      return interaction.reply({embeds:[embed],components:controlRows()});
    }

    if (name === "shuffle") {
      const count = music.shuffle(interaction.guildId);
      return interaction.reply(count > 1 ? "🔀 Queue shuffle করা হয়েছে (" + count + "টি গান)।" : "Shuffle করার মতো পর্যাপ্ত গান নেই।");
    }

    if (name === "clearqueue") {
      const count = music.clearQueue(interaction.guildId);
      return interaction.reply("🧹 Queue থেকে " + count + "টি upcoming গান সরানো হয়েছে। বর্তমান গান চলতে থাকবে।");
    }

    if (name === "remove") {
      const position = interaction.options.getInteger("position", true);
      const removed = music.remove(interaction.guildId, position);
      return interaction.reply(removed ? "➖ সরানো হয়েছে: **" + removed.title + "**" : "ওই position-এ কোনো গান নেই।");
    }

    if (name === "move") {
      const from = interaction.options.getInteger("from", true);
      const to = interaction.options.getInteger("to", true);
      return interaction.reply(music.move(interaction.guildId, from, to)
        ? "↕️ Queue position পরিবর্তন করা হয়েছে।"
        : "Position ভুল অথবা Queue-তে ওই গান নেই।");
    }

    if (name === "repeat") {
      const mode = interaction.options.getString("mode", true);
      music.setRepeat(interaction.guildId, mode);
      return interaction.reply("🔁 Repeat mode: **" + mode + "**");
    }

    if (name === "seek") {
      const seconds = interaction.options.getInteger("seconds", true);
      const result = await music.seek(interaction.guildId, seconds * 1000);
      return interaction.reply(result === false ? "এখন কোনো গান চলছে না।" : "⏩ " + seconds + " সেকেন্ডে নেওয়া হয়েছে।");
    }

    if (name === "player") {
      const data = music.getQueue(interaction.guildId);
      const title = data.current?.title || "কোনো গান চলছে না";
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play Player")
        .setDescription("**" + title + "**\nAutoplay: " + data.mode);
      return interaction.reply({ embeds: [embed], components: controlRows() });
    }

    if (["pause", "resume", "skip", "stop"].includes(name)) {
      const ok = await music[name](interaction.guildId);
      const labels = { pause: "Pause", resume: "Resume", skip: "Skip", stop: "Stop" };
      return interaction.reply(ok ? "✅ " + labels[name] + " সম্পন্ন হয়েছে।" : "এখন কোনো গান চলছে না।");
    }

    if (name === "volume") {
      const value = interaction.options.getInteger("value", true);
      const actual = await music.volume(interaction.guildId, value);
      return interaction.reply("🔊 Volume: " + actual + "%");
    }
  } catch (error) {
    console.error("[Interaction]", error);
    const message = error.message || "কমান্ডটি চালাতে সমস্যা হয়েছে।";
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
  }
});

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.get("/api/status", (_req, res) => res.json({
  bot: client.isReady() ? client.user.tag : "Offline",
  connectedGuilds: client.guilds.cache.size,
  lavalinkNodes: [...shoukaku.nodes.values()].map(n => ({ name: n.name, state: n.state })),
  playback: "YouTube + YouTube Music + SoundCloud search"
}));
app.listen(Number(process.env.PORT || 3000), () => console.log("Dashboard listening."));
client.login(token).catch(error => { console.error("Discord login failed:", error); process.exit(1); });
