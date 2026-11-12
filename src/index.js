require("dotenv").config();
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
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
  new SlashCommandBuilder().setName("play").setDescription("Play a song from YouTube or SoundCloud")
    .addStringOption(o => o.setName("query").setDescription("Song name or YouTube/SoundCloud link").setRequired(true)),
  new SlashCommandBuilder().setName("player").setDescription("Show music player controls"),
  new SlashCommandBuilder().setName("queue").setDescription("Show the music queue"),
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
      { name: "Nazha-SG1", url: "sg-1.nazha.online:443", auth: "https://discord.gg/XeSCnk57ZF", secure: true },
      { name: "Nazha-SG2", url: "sg-2.nazha.online:443", auth: "https://discord.gg/XeSCnk57ZF", secure: true },
      { name: "Nazha-SG3", url: "sg-3.nazha.online:443", auth: "https://discord.gg/XeSCnk57ZF", secure: true },
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

function controlRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pookie_pause").setLabel("Pause").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pookie_resume").setLabel("Resume").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("pookie_skip").setLabel("Skip").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("pookie_stop").setLabel("Stop").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pookie_volume_down").setLabel("Volume -").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("pookie_volume_set").setLabel("Set Volume 0–100").setStyle(ButtonStyle.Primary),
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
    if (interaction.isModalSubmit() && interaction.customId === "pookie_volume_modal") {
      if (!interaction.guildId) return;
      const raw = interaction.fields.getTextInputValue("volume_value").trim();
      if (!/^\\d{1,3}$/.test(raw) || Number(raw) < 0 || Number(raw) > 100) {
        return interaction.reply({ content: "০ থেকে ১০০-এর মধ্যে সংখ্যা দাও।", ephemeral: true });
      }
      const value = await music.volume(interaction.guildId, Number(raw));
      return interaction.reply({ content: "🔊 Volume সেট হয়েছে: " + value + "%", ephemeral: true });
    }

    if (interaction.isButton()) {
      if (!interaction.guildId) return;
      if (interaction.customId === "pookie_volume_set") {
        const modal = new ModalBuilder().setCustomId("pookie_volume_modal").setTitle("Set Music Volume");
        const field = new TextInputBuilder().setCustomId("volume_value").setLabel("Volume (0–100)").setStyle(TextInputStyle.Short).setPlaceholder("যেমন 37").setRequired(true).setMinLength(1).setMaxLength(3);
        modal.addComponents(new ActionRowBuilder().addComponents(field));
        return interaction.showModal(modal);
      }
      if (interaction.customId === "pookie_volume_down" || interaction.customId === "pookie_volume_up") {
        const value = await music.adjustVolume(interaction.guildId, interaction.customId === "pookie_volume_up" ? 10 : -10);
        return interaction.reply({ content: "🔊 Volume: " + value + "%", ephemeral: true });
      }
      const actions = {
        pookie_pause: () => music.pause(interaction.guildId),
        pookie_resume: () => music.resume(interaction.guildId),
        pookie_skip: () => music.skip(interaction.guildId),
        pookie_stop: () => music.stop(interaction.guildId)
      };
      const action = actions[interaction.customId];
      if (!action) return;
      const ok = await action();
      const messages = {
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
        .setDescription("YouTube প্রথমে চেষ্টা করবে; না পেলে SoundCloud-এ খুঁজবে।")
        .addFields(
          { name: "Music", value: "/play query — গান চালাও\n/queue — Queue দেখো\n/join /leave — Voice control", inline: false },
          { name: "Autoplay", value: "/mode viral | bangla | global | mixed | off\n/autoplay enabled:true|false", inline: false },
          { name: "Controls", value: "/pause /resume /skip /stop /volume value এবং Player buttons", inline: false }
        ).setFooter({ text: "YouTube playback may still be limited by YouTube availability or regional restrictions." });
      return interaction.reply({ embeds: [embed], ephemeral: true });
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
        .setFooter({ text: "Autoplay: " + data.mode });
      return interaction.reply({ embeds: [embed] });
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
  playback: "YouTube search/playback with SoundCloud fallback"
}));
app.listen(Number(process.env.PORT || 3000), () => console.log("Dashboard listening."));
client.login(token).catch(error => { console.error("Discord login failed:", error); process.exit(1); });
