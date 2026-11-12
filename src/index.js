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
  new SlashCommandBuilder().setName("mode").setDescription("Set automatic music discovery mode")
    .addStringOption(o => o.setName("type").setDescription("Choose an autoplay style").setRequired(true)
      .addChoices(
        { name: "Viral / Popular", value: "viral" },
        { name: "Bangladesh Trending", value: "bangla" },
        { name: "Global Trending", value: "global" },
        { name: "Bangla + Global Mix", value: "mixed" },
        { name: "Off", value: "off" }
      )),
  new SlashCommandBuilder().setName("autoplay").setDescription("Turn automatic music selection on or off")
    .addBooleanOption(o => o.setName("enabled").setDescription("Enable autoplay").setRequired(true)),
  new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue"),
  new SlashCommandBuilder().setName("volume").setDescription("Set volume")
    .addIntegerOption(o => o.setName("value").setDescription("0 to 100").setMinValue(0).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName("controlrole").setDescription("Choose the role allowed to control Pookie Play")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(o => o.setName("role").setDescription("Role allowed to control the bot").setRequired(true)),
  new SlashCommandBuilder().setName("help").setDescription("Show Pookie Play commands")
].map(command => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
// Community-hosted Lavalink v4 nodes (free, best-effort; availability can change).
// A private/local node can still be supplied through LAVALINK_HOST + LAVALINK_PASSWORD.
const nodes = process.env.LAVALINK_HOST && process.env.LAVALINK_PASSWORD
  ? [{
      name: "Custom-Lavalink",
      url: process.env.LAVALINK_HOST,
      auth: process.env.LAVALINK_PASSWORD,
      secure: process.env.LAVALINK_SECURE === "true"
    }]
  : [
      { name: "Nazha-Global", url: "lavalink.nazha.online:443", auth: "nazhafreelava", secure: true },
      { name: "Vinster", url: "freelavalinkvinster.in:443", auth: "youshallnotpass", secure: true }
    ];
const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
  moveOnDisconnect: true,
  reconnectTries: 5,
  reconnectInterval: 5
});
shoukaku.on("ready", name => console.log("[Lavalink] Connected:", name));
shoukaku.on("error", (name, error) => console.error("[Lavalink] Error:", name, error));
shoukaku.on("close", (name, code, reason) => console.warn("[Lavalink] Closed:", name, code, reason));
const music = createMusic(shoukaku);
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

function controlRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pookie_previous").setLabel("Previous").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pookie_pause").setLabel("Pause").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pookie_resume").setLabel("Resume").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("pookie_skip").setLabel("Next").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("pookie_stop").setLabel("Stop").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pookie_volume_down").setLabel("Volume -").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pookie_volume_up").setLabel("Volume +").setStyle(ButtonStyle.Secondary)
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
      if (interaction.customId === "pookie_volume_down" || interaction.customId === "pookie_volume_up") {
        const value = await music.adjustVolume(interaction.guildId, interaction.customId === "pookie_volume_up" ? 10 : -10);
        const embed = interaction.message.embeds[0]
          ? EmbedBuilder.from(interaction.message.embeds[0])
          : new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play Player");
        return interaction.update({
          embeds: [embed.setFooter({ text: "Volume: " + value + "%" })],
          components: controlRows()
        });
      }
      const actions = {
        pookie_previous: () => music.previous(interaction.guildId),
        pookie_pause: () => music.pause(interaction.guildId),
        pookie_resume: () => music.resume(interaction.guildId),
        pookie_skip: () => music.skip(interaction.guildId),
        pookie_stop: () => music.stop(interaction.guildId)
      };
      const action = actions[interaction.customId];
      if (!action) return;
      const ok = await action();
      const messages = {
        pookie_previous: "⏮️ আগের গান চালানো হয়েছে।",
        pookie_pause: "⏸️ গান pause করা হয়েছে।",
        pookie_resume: "▶️ গান resume করা হয়েছে।",
        pookie_skip: "⏭️ পরের গান চালানোর চেষ্টা করছি।",
        pookie_stop: "⏹️ গান ও queue বন্ধ করা হয়েছে।"
      };
      return interaction.reply({ content: ok ? messages[interaction.customId] : "এখন কোনো গান চলছে না।", ephemeral: true });
    }

    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;

    if (name === "help") {
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play — Help")
        .setDescription("YouTube, YouTube Music ও SoundCloud থেকে গান খুঁজে চালানোর চেষ্টা করবে।")
        .addFields(
          { name: "Music", value: "/play query — গান চালাও\n/queue — Queue দেখো\n/join /leave — Voice control", inline: false },
          { name: "Autoplay", value: "/mode viral | bangla | global | mixed | off\n/autoplay enabled:true|false", inline: false },
          { name: "Queue tools", value: "/shuffle /remove /move /clearqueue /repeat /seek /nowplaying", inline: false },
          { name: "Controls", value: "/pause /resume /skip /stop /volume value এবং Player buttons", inline: false },
          { name: "Admin", value: "/controlrole role — কোন Role বট নিয়ন্ত্রণ করবে সেট করো (Manage Server permission প্রয়োজন)", inline: false }
        ).setFooter({ text: "Sources: YouTube • YouTube Music • SoundCloud (যেটি পাওয়া যায়)।" });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (name === "controlrole") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "⛔ এই সেটিং বদলাতে Manage Server permission লাগবে।", ephemeral: true });
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
      const result = await music.play(interaction.guildId, channel, query);
      const info = result.track.info;
      const embed = new EmbedBuilder().setColor(0x5865f2)
        .setTitle(result.queued ? "➕ Queue-তে যোগ হয়েছে" : "🎶 এখন বাজছে")
        .setDescription("**" + (info.title || query).slice(0, 240) + "**\n" + (info.author || "Unknown artist"))
        .addFields(
          { name: "Source", value: info.sourceName || "Audio source", inline: true },
          { name: "Queue", value: String(result.queueLength), inline: true }
        );
      if (info.uri) embed.setURL(info.uri);
      return interaction.editReply({ embeds: [embed], components: controlRows() });
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

    if (name === "mode") {
      const mode = interaction.options.getString("type", true);
      music.setMode(interaction.guildId, mode);
      const labels = { viral: "Viral / Popular", bangla: "Bangladesh Trending", global: "Global Trending", mixed: "Bangla + Global Mix", off: "Off" };
      return interaction.reply(mode === "off"
        ? "⚪ Autoplay বন্ধ করা হয়েছে।"
        : "🎧 Autoplay mode: **" + labels[mode] + "**। Queue খালি হলে এই ধরনের গান নিজে থেকে খুঁজে চালাবে।");
    }

    if (name === "autoplay") {
      const enabled = interaction.options.getBoolean("enabled", true);
      if (enabled && music.getMode(interaction.guildId) === "off") music.setMode(interaction.guildId, "mixed");
      if (!enabled) music.setMode(interaction.guildId, "off");
      return interaction.reply(enabled
        ? "🔁 Autoplay চালু। বর্তমান mode: " + music.getMode(interaction.guildId)
        : "⏹️ Autoplay বন্ধ।");
    }

    if (name === "queue") {
      const data = music.getQueue(interaction.guildId);
      const current = data.current ? "**এখন বাজছে:** " + data.current.title : "এখন কিছু বাজছে না।";
      const upcoming = data.tracks.slice(0, 10).map((t, i) => (i + 1) + ". " + t.title).join("\n");
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎵 Pookie Play Queue")
        .setDescription(current + (upcoming ? "\n\n**পরের গানগুলো:**\n" + upcoming : "\n\nQueue খালি।"))
        .setFooter({ text: "Autoplay: " + data.mode + " • Repeat: " + data.repeat });
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
