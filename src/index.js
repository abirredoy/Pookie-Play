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
  new SlashCommandBuilder().setName("search").setDescription("Search songs by name and choose one to play")
    .addStringOption(o => o.setName("query").setDescription("Song name or artist").setRequired(true)),
  new SlashCommandBuilder().setName("play").setDescription("Play a song or a saved List Slot")
    .addStringOption(o => o.setName("query").setDescription("Song name or song link").setRequired(false))
    .addIntegerOption(o => o.setName("list").setDescription("Play saved List Slot 1-10").setMinValue(1).setMaxValue(10).setRequired(false)),
  new SlashCommandBuilder().setName("add").setDescription("Add a song to List Mode without replacing the current track")
    .addStringOption(o => o.setName("query").setDescription("Song name or song link").setRequired(true)),
  new SlashCommandBuilder().setName("list").setDescription("Manage your 10 saved List Queue slots")
    .addSubcommand(s => s.setName("add").setDescription("Save a song in a numbered slot")
      .addIntegerOption(o => o.setName("slot").setDescription("Slot number 1-10").setMinValue(1).setMaxValue(10).setRequired(true))
      .addStringOption(o => o.setName("query").setDescription("Song name or song link").setRequired(true)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a saved slot")
      .addIntegerOption(o => o.setName("slot").setDescription("Slot number 1-10").setMinValue(1).setMaxValue(10).setRequired(true)))
    .addSubcommand(s => s.setName("show").setDescription("Show saved List slots"))
    .addSubcommand(s => s.setName("clear").setDescription("Clear all 10 List Queue slots"))
    .addSubcommand(s => s.setName("mode").setDescription("Turn serial List Mode on or off")
      .addBooleanOption(o => o.setName("enabled").setDescription("Enable serial List Mode").setRequired(true))),
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
      .addChoices({name:"Off",value:"off"},{name:"Current track",value:"track"},{name:"Queue",value:"queue"},{name:"Shuffle playlist",value:"shuffle"})),
  new SlashCommandBuilder().setName("seek").setDescription("Jump to a position in the current track")
    .addIntegerOption(o => o.setName("seconds").setDescription("Position in seconds").setMinValue(0).setRequired(true)),


  new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue"),
  new SlashCommandBuilder().setName("volume").setDescription("Set volume")
    .addIntegerOption(o => o.setName("value").setDescription("0 to 100").setMinValue(0).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName("controlrole").setDescription("Choose the role allowed to control Pookie Play")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(o => o.setName("role").setDescription("Role allowed to control the bot").setRequired(true)),
  new SlashCommandBuilder().setName("start").setDescription("Show Pookie Play controls and Control Panel"),
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
const playerMessages = new Map();
const searchResults = new Map();
const music = createMusic(shoukaku, async (guildId, track, state) => {
  try {
    const channel = state.textChannelId ? await client.channels.fetch(state.textChannelId) : null;
    if (!channel || !channel.isTextBased()) return;
    const info = track.info || {};
    const q = music.getQueue(guildId);
    const embed = new EmbedBuilder().setColor(0x5865f2)
      .setTitle("🎶 Now Playing")
      .setDescription("**" + String(info.title || "Unknown track").slice(0, 240) + "**\\n" + String(info.author || "Unknown artist").slice(0, 180));
    setPlayerStats(embed, q);
    embed.setFooter({ text: "🤖 Auto Mode: " + (state.mode === "auto" ? "ON" : "OFF") + " • 📜 Queue Mode: " + (state.mode === "queue" ? "ON" : "OFF") + "\\n📍 Status: Player ready" });
    if (info.uri) embed.setURL(info.uri);
    const message = await channel.send({ embeds: [embed], components: controlRows(q) });
    playerMessages.set(guildId, message);
  } catch (error) {
    console.error("[Player message] Could not post track card:", error?.message || error);
  }
});
const listStoragePath = "data/list-queues.json";
let listSaveChain = Promise.resolve();

async function loadListStorage() {
  const repo = process.env.GITHUB_REPOSITORY;
  const ghToken = process.env.GITHUB_TOKEN;
  if (!repo || !ghToken) {
    console.warn("[List Queue] GitHub storage unavailable; saved slots will be session-only.");
    return;
  }
  const url = "https://api.github.com/repos/" + repo + "/contents/" + listStoragePath;
  const response = await fetch(url, { headers: { Authorization: "Bearer " + ghToken, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  if (response.status === 404) return;
  if (!response.ok) throw new Error("Could not load List Queue storage: HTTP " + response.status);
  const file = await response.json();
  const saved = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  music.loadListSlots(saved);
  console.log("[List Queue] Loaded saved slots for", Object.keys(saved).length, "server(s).");
}

function persistListStorage() {
  listSaveChain = listSaveChain.then(async () => {
    const repo = process.env.GITHUB_REPOSITORY;
    const ghToken = process.env.GITHUB_TOKEN;
    if (!repo || !ghToken) throw new Error("GitHub storage unavailable; cannot persist List Queue.");
    const url = "https://api.github.com/repos/" + repo + "/contents/" + listStoragePath;
    const headers = { Authorization: "Bearer " + ghToken, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    const current = await fetch(url, { headers });
    let sha;
    if (current.ok) sha = (await current.json()).sha;
    else if (current.status !== 404) throw new Error("Could not read List Queue storage: HTTP " + current.status);
    const body = {
      message: "Save Pookie Play List Queue slots",
      content: Buffer.from(JSON.stringify(music.exportListSlots(), null, 2) + "\n").toString("base64"),
      branch: process.env.GITHUB_REF_NAME || "main"
    };
    if (sha) body.sha = sha;
    const response = await fetch(url, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error("Could not save List Queue: HTTP " + response.status + " " + (await response.text()).slice(0, 250));
  });
  return listSaveChain;
}

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
  return { text: "🤖 Auto Mode: " + auto + " • 📜 Queue Mode: " + queue + " • 🔟 List Mode: " + (q.listMode ? "ON" : "OFF") + " • Repeat: " + repeat + "\n📍 Status: " + String(status).slice(0, 130) };
}

function setPlayerStats(embed, q = {}) {
  const current = q.current || {};
  const mode = q.listMode ? "List" : q.mode === "auto" ? "Auto" : "Queue";
  embed.setFields(
    { name: "🎧 Source", value: String(current.sourceName || "Unknown"), inline: true },
    { name: "🔊 Volume", value: String(Number.isFinite(q.volume) ? q.volume : 100) + "%", inline: true },
    { name: "🔁 Repeat", value: String(q.repeat || "off").toUpperCase(), inline: true },
    { name: "🎚️ Playback", value: mode + (q.paused ? " • Paused" : " • Playing"), inline: true },
    { name: "📜 Upcoming", value: String(q.tracks?.length ?? 0) + " tracks", inline: true },
    { name: "🖥️ Audio Node", value: String(q.node || "Disconnected"), inline: true }
  );
  return embed;
}

function controlRows(q = {}) {
  const button = (id, label, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId("pookie_" + id).setLabel(label).setStyle(style);
  return [
    new ActionRowBuilder().addComponents(
      button("previous", "⏮️ Previous"),
      button(q.paused ? "resume" : "pause", q.paused ? "▶️ Play" : "⏸️ Pause", q.paused ? ButtonStyle.Success : ButtonStyle.Primary),
      button("skip", "⏭️ Next", ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      button("volume_down", "🔉 Volume −"),
      button("volume_up", "🔊 Volume +"),
      button("repeat_cycle",
        q.repeat === "track" ? "🔂 Loop: Song" :
        q.repeat === "queue" ? "🔁 Loop: List" :
        q.repeat === "shuffle" ? "🔀 Loop: Mix" : "➡️ Loop: Off",
        q.repeat === "off" ? ButtonStyle.Secondary : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      button("auto_toggle", q.mode === "auto" ? "🤖 Auto Mode: ON" : "🤖 Auto Mode: OFF", q.mode === "auto" ? ButtonStyle.Success : ButtonStyle.Secondary),
      button("list_toggle", q.listMode ? "📜 List Mode: ON" : "📜 List Mode: OFF", q.listMode ? ButtonStyle.Success : ButtonStyle.Secondary),
      button("random_next", "🎲 Random Play", ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      button("join", "🔊 Join Voice", ButtonStyle.Success),
      button("leave", "🚪 Leave Voice", ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("🎛️ Control Panel").setStyle(ButtonStyle.Link).setURL("https://script.google.com/macros/s/AKfycbzXzjqmb3XpOX45KDlIWarLwGJb9fkLZuBi9APK1IUgq4A97gqbR1PhvAbvE6PhleLu/exec")
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
  try { await loadListStorage(); }
  catch (error) { console.error("[List Queue] Failed to load saved slots:", error); }
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
      if (/^search_[0-4]$/.test(id)) {
        const results = searchResults.get(interaction.guildId);
        const index = Number(id.split("_")[1]);
        const selected = results?.[index];
        if (!selected) return interaction.reply({ content: "এই Search result আর পাওয়া যাচ্ছে না। আবার /search করো।", ephemeral: true });
        const channel = await requireVoice(interaction);
        await interaction.deferUpdate();
        const started = await music.playResolved(interaction.guildId, channel, selected, interaction.channelId);
        const embed = new EmbedBuilder().setColor(0x57f287).setTitle("🎶 গান নির্বাচন করা হয়েছে")
          .setDescription("**" + String(selected.info?.title || "Unknown track") + "**\\n" + String(selected.info?.author || "Unknown artist"));
        if (selected.info?.uri) embed.setURL(selected.info.uri);
        await interaction.message.edit({ embeds: [embed], components: [] });
        return;
      }
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
        setPlayerStats(embed, q);
        embed.setFooter(playerStatusFooter(q, status));
        const updated = await interaction.update({ embeds: [embed], components: controlRows(q) });
        playerMessages.set(interaction.guildId, interaction.message);
        return updated;
      }
      const simpleActions = {
        join: async () => {
          const channel = await requireVoice(interaction);
          const player = await music.join(interaction.guildId, channel);
          music.setTextChannel(interaction.guildId, interaction.channelId);
          return player;
        },
        leave: () => music.leave(interaction.guildId),
        previous: () => music.previous(interaction.guildId),
        pause: () => music.pause(interaction.guildId),
        resume: () => music.resume(interaction.guildId),
        skip: () => music.skip(interaction.guildId),
        volume_down: () => music.adjustVolume(interaction.guildId, -10),
        volume_up: () => music.adjustVolume(interaction.guildId, 10),
        repeat_cycle: () => {
          const order = ["off", "track", "queue", "shuffle"];
          const current = order.indexOf(data.repeat || "off");
          return music.setRepeat(interaction.guildId, order[(current + 1) % order.length]);
        },
        auto_toggle: () => music.setMode(interaction.guildId, data.mode === "auto" ? "queue" : "auto"),
        list_toggle: async () => (await music.setListMode(interaction.guildId, !data.listMode), !data.listMode),
        random_next: async () => {
          const channel = await requireVoice(interaction);
          await music.join(interaction.guildId, channel);
          music.setTextChannel(interaction.guildId, interaction.channelId);
          return music.randomNext(interaction.guildId);
        }
      };
      const action = simpleActions[id];
      if (!action) return;
      await interaction.deferUpdate();
      let result;
      let success = false;
      let actionError = "";
      try {
        result = await action();
        success = ["repeat_cycle", "auto_toggle", "list_toggle", "volume_down", "volume_up", "leave"].includes(id) ? true : result !== false;
      } catch (error) {
        actionError = String(error?.message || error || "Unknown error");
        console.error("[Player button] Action failed:", id, error);
      }
      const labels = {
        join: "Joined your voice channel", leave: "Left the voice channel",
        previous: "Previous track", pause: "Playback paused",
        resume: "Playback resumed", skip: "Next track selected",
        stop: "Playback stopped", volume_down: "Volume: " + (result?.before ?? "?") + "% → " + (result?.after ?? "?") + "%",
        volume_up: "Volume: " + (result?.before ?? "?") + "% → " + (result?.after ?? "?") + "%",
        mute: result?.muted ? "Mute: ON" : "Mute: OFF",
        shuffle: "Queue shuffled", clearqueue: "Upcoming queue cleared",
        repeat_cycle: "Loop: " + ({off:"OFF",track:"SONG",queue:"LIST",shuffle:"MIX"}[result] || "OFF"),
        auto_toggle: result === "auto" ? "Auto Mode: ON" : "Auto Mode: OFF",
        list_toggle: result ? "List Mode: ON" : "List Mode: OFF",
        random_next: "Random track selected",
        seek_back: "Seeked back 10 seconds", seek_forward: "Seeked forward 10 seconds",
        restart: "Track restarted", vol25: "Volume: 25%", vol50: "Volume: 50%",
        vol75: "Volume: 75%", vol100: "Volume: 100%", leave: "Disconnected from voice channel"
      };
      const q = music.getQueue(interaction.guildId);
      const status = success ? (labels[id] || "Action completed") : (actionError || (id === "random_next" ? "No random track found — check Lavalink/search source" : "Action failed — check voice connection or queue"));
      const embed = interaction.message.embeds[0]
        ? EmbedBuilder.from(interaction.message.embeds[0])
        : new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play");
      setPlayerStats(embed, q);
      embed.setFooter(playerStatusFooter(q, status));
      const updated = await interaction.message.edit({ embeds: [embed], components: controlRows(q) });
      if (id === "leave") playerMessages.delete(interaction.guildId);
      else playerMessages.set(interaction.guildId, interaction.message);
      return updated;
    }
    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;

    if (name === "help") {
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play — Help")
        .setDescription("YouTube, YouTube Music ও SoundCloud থেকে গান খুঁজে চালানোর চেষ্টা করবে।")
        .addFields(
          { name: "Music", value: "/search query — গান খুঁজে পছন্দেরটি চালাও\\n/play query — গান চালাও\n/queue — Queue দেখো\n/join /leave — Voice control", inline: false },
          { name: "Playback modes", value: "/mode auto অথবা queue — Auto Mode ও List Mode একসঙ্গে চালু হবে না", inline: false },
          { name: "Queue tools", value: "/add query — Queue Mode-এ গান যোগ করো\n/list add slot query — ১০টি List Slot-এ গান রাখো\n/list list /list remove /list clear /list mode\n/play list — List Slot নম্বর দিয়ে চালাও\n/queue /shuffle /remove /move /clearqueue /repeat /seek /nowplaying", inline: false },
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

    if (name === "search") {
      const query = interaction.options.getString("query", true);
      const channel = await requireVoice(interaction);
      await interaction.deferReply();
      await music.join(interaction.guildId, channel);
      music.setTextChannel(interaction.guildId, interaction.channelId);
      const tracks = await music.searchTracks(interaction.guildId, query);
      if (!tracks.length) return interaction.editReply("🔎 **" + query + "**-এর কোনো গান পাওয়া যায়নি। অন্যভাবে লিখে চেষ্টা করো।");
      const results = tracks.slice(0, 5);
      searchResults.set(interaction.guildId, results);
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🔎 Search Results")
        .setDescription("**" + query.slice(0, 150) + "** — নিচের বাটনে পছন্দের গানটি বেছে নাও।")
        .addFields(results.map((track, i) => ({
          name: (i + 1) + ". " + String(track.info?.title || "Unknown track").slice(0, 180),
          value: String(track.info?.author || "Unknown artist").slice(0, 100) + (track.info?.uri ? "\\n" + track.info.uri : ""),
          inline: false
        })));
      const row = new ActionRowBuilder().addComponents(results.map((track, i) =>
        new ButtonBuilder().setCustomId("pookie_search_" + i).setLabel("Play " + (i + 1)).setStyle(i === 0 ? ButtonStyle.Success : ButtonStyle.Primary)
      ));
      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    if (name === "play") {
      const listSlot = interaction.options.getInteger("list");
      const query = interaction.options.getString("query");
      if ((listSlot === null) === (!query)) {
        return interaction.reply({ content: "একটি বেছে নাও: গান চালাতে query দাও অথবা List Slot চালাতে list: 1-10 দাও।", ephemeral: true });
      }
      const channel = await requireVoice(interaction);
      await interaction.deferReply();
      if (listSlot !== null) {
        const result = await music.playList(interaction.guildId, channel, listSlot, interaction.channelId);
        return interaction.editReply("🎶 List Slot " + result.slot + " থেকে **" + result.track.info.title + "** চালু হচ্ছে। List Mode-এ পরের Slot-গুলোও সিরিয়াল অনুযায়ী বাজবে।");
      }
      const result = await music.play(interaction.guildId, channel, query, interaction.channelId);
      return interaction.editReply(result.queued
        ? "➕ **" + result.track.info.title + "** Queue-তে যোগ হয়েছে। গান শুরু হলে নতুন Player card আসবে।"
        : "🎶 **" + result.track.info.title + "** চালু হচ্ছে। নতুন Player card পাঠানো হচ্ছে।");
    }

    if (name === "list") {
      const sub = interaction.options.getSubcommand();
      if (sub === "add") {
        const slot = interaction.options.getInteger("slot", true);
        const query = interaction.options.getString("query", true);
        const channel = await requireVoice(interaction);
        await interaction.deferReply();
        const result = await music.addList(interaction.guildId, channel, slot, query, interaction.channelId);
        await persistListStorage();
        return interaction.editReply("💾 **" + result.track.info.title + "** List Slot " + result.slot + "-এ সংরক্ষিত হয়েছে। (" + result.count + "/10)");
      }
      if (sub === "remove") {
        const slot = interaction.options.getInteger("slot", true);
        const result = await music.removeList(interaction.guildId, slot);
        if (!result) return interaction.reply({ content: "এই Slot খালি।", ephemeral: true });
        await persistListStorage();
        return interaction.reply("🗑️ List Slot " + slot + " থেকে **" + result.info.title + "** সরানো হয়েছে।");
      }
      if (sub === "show") {
        const slots = music.getListSlots(interaction.guildId);
        const lines = Array.from({length:10}, (_,i) => {
          const found = slots.find(item => item.slot === i+1);
          return (i+1) + ". " + (found ? found.info.title : "— খালি —");
        });
        const q = music.getQueue(interaction.guildId);
        return interaction.reply("**🎵 List Queue (" + slots.length + "/10)**\n" + lines.map(line => line.slice(0, 140)).join("\n") + "\nList Mode: " + (q.listMode ? "ON" : "OFF"));
      }
      if (sub === "clear") {
        const count = music.clearList(interaction.guildId);
        await persistListStorage();
        return interaction.reply("🧹 List Queue-এর " + count + "টি Slot খালি করা হয়েছে।");
      }
      if (sub === "mode") {
        const enabled = interaction.options.getBoolean("enabled", true);
        if (enabled) await requireVoice(interaction);
        const channel = interaction.member?.voice?.channel;
        if (enabled && !channel) throw new Error("List Mode চালাতে আগে voice channel-এ যোগ দাও।");
        if (enabled) {
          await music.join(interaction.guildId, channel);
          music.setTextChannel(interaction.guildId, interaction.channelId);
        }
        const active = await music.setListMode(interaction.guildId, enabled);
        return interaction.reply(active
          ? "🔟 List Mode ON। Slot অনুযায়ী গান সিরিয়ালভাবে বাজবে। AutoPlay OFF।"
          : "List Mode OFF। বর্তমান গান শেষ হলে আর List Slot নিজে থেকে চলবে না।");
      }
    }

    if (name === "add") {
      if (music.getMode(interaction.guildId) !== "queue") {
        return interaction.reply({ content: "📻 আগে Queue Mode চালু করো: `/mode type:Queue Mode`। Auto Mode আলাদা radio system।", ephemeral: true });
      }
      const query = interaction.options.getString("query", true);
      const channel = await requireVoice(interaction);
      await interaction.deferReply();
      const result = await music.add(interaction.guildId, channel, query, interaction.channelId);
      return interaction.editReply(result.queued
        ? "➕ **" + result.track.info.title + "** Queue-তে যোগ হয়েছে। আগের গান শেষ হলে এটি বাজবে।"
        : "🎶 **" + result.track.info.title + "** Queue-তে যোগ করে চালু করা হচ্ছে।");
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


    if (name === "queue") {
      const data = music.getQueue(interaction.guildId);
      const current = data.current ? "**এখন বাজছে:** " + data.current.title : "এখন কিছু বাজছে না।";
      const upcoming = data.tracks.slice(0, 10).map((t, i) => (i + 1) + ". " + t.title).join("\n");
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎵 Pookie Play Queue")
        .setDescription(current + (upcoming ? "\n\n**পরের গানগুলো:**\n" + upcoming : "\n\nQueue খালি।"))
        .setFooter({ text: "Auto Mode: " + (data.mode === "auto" ? "ON" : "OFF") + " • List Mode: " + (data.listMode ? "ON" : "OFF") + " • Repeat: " + data.repeat });
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

    if (name === "start") {
      const data = music.getQueue(interaction.guildId);
      const title = data.current?.title || "এখনো কোনো গান চলছে না";
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play Control Panel")
        .setDescription("**" + title + "**\\n/play কমান্ড দিয়ে গান চালাও। নিচের বাটনগুলো গান চলুক বা না চলুক এখানেই থাকবে।");
      setPlayerStats(embed, data);
      embed.setFooter(playerStatusFooter(data, data.current ? "Player ready" : "Waiting for /play"));
      return interaction.reply({ embeds: [embed], components: controlRows(data) });
    }

    if (name === "player") {
      const data = music.getQueue(interaction.guildId);
      const title = data.current?.title || "কোনো গান চলছে না";
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play Player")
        .setDescription("**" + title + "**\\nAutoplay: " + data.mode);
      return interaction.reply({ embeds: [embed], components: controlRows(data) });
    }

    if (["pause", "resume", "skip", "stop"].includes(name)) {
      const ok = await music[name](interaction.guildId);
      const labels = { pause: "Pause", resume: "Resume", skip: "Skip", stop: "Stop" };
      return interaction.reply(ok ? "✅ " + labels[name] + " সম্পন্ন হয়েছে।" : "এখন কোনো গান চলছে না।");
    }

    if (name === "volume") {
      const value = interaction.options.getInteger("value", true);
      const actual = await music.volume(interaction.guildId, value);
      const savedMessage = playerMessages.get(interaction.guildId);
      if (savedMessage?.embeds?.[0]) {
        const q = music.getQueue(interaction.guildId);
        const embed = EmbedBuilder.from(savedMessage.embeds[0]);
        setPlayerStats(embed, q);
        await savedMessage.edit({ embeds: [embed], components: controlRows(q) }).catch(error =>
          console.warn("[Player card] Could not refresh volume display:", error?.message || error));
      }
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
