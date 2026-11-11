require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const express = require("express");
const { createMusic } = require("./music");
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
if (!token || !clientId) { console.error("Missing DISCORD_TOKEN or CLIENT_ID."); process.exit(1); }

const commands = [
  new SlashCommandBuilder().setName("join").setDescription("Join your voice channel"),
  new SlashCommandBuilder().setName("leave").setDescription("Leave the voice channel"),
  new SlashCommandBuilder().setName("play").setDescription("Search Spotify or open a Spotify link")
    .addStringOption(o => o.setName("query").setDescription("Song name, artist, or Spotify link").setRequired(true)),
  new SlashCommandBuilder().setName("player").setDescription("Show music player controls"),
  new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback"),
  new SlashCommandBuilder().setName("volume").setDescription("Set volume")
    .addIntegerOption(o => o.setName("value").setDescription("0 to 100").setMinValue(0).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName("help").setDescription("Show Pookie Play commands")
].map(command => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const music = createMusic();

function spotifySearchUrl(query) {
  const value = query.trim();
  const uriMatch = value.match(/^spotify:(track|album|playlist|artist):([a-zA-Z0-9]+)$/);
  if (uriMatch) return "https://open.spotify.com/" + uriMatch[1] + "/" + uriMatch[2];
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "open.spotify.com" || parsed.hostname === "spotify.com" || parsed.hostname.endsWith(".spotify.com")) return parsed.toString();
  } catch (_) {}
  return "https://open.spotify.com/search/" + encodeURIComponent(value);
}

function controlRows(searchUrl) {
  const firstButtons = [];
  if (searchUrl) firstButtons.push(new ButtonBuilder().setLabel("Open Spotify").setStyle(ButtonStyle.Link).setURL(searchUrl));
  firstButtons.push(
    new ButtonBuilder().setCustomId("pookie_pause").setLabel("Pause").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("pookie_resume").setLabel("Resume").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("pookie_skip").setLabel("Skip").setStyle(ButtonStyle.Primary)
  );
  const first = new ActionRowBuilder().addComponents(...firstButtons);
  const second = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pookie_stop").setLabel("Stop").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("pookie_volume_down").setLabel("Volume -").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("pookie_volume_up").setLabel("Volume +").setStyle(ButtonStyle.Secondary)
  );
  return [first, second];
}

client.once("ready", async () => {
  console.log("Logged in as " + client.user.tag);
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    const route = process.env.GUILD_ID ? Routes.applicationGuildCommands(clientId, process.env.GUILD_ID) : Routes.applicationCommands(clientId);
    await rest.put(route, { body: commands });
    console.log("Slash commands registered.");
  } catch (error) { console.error("Command registration failed:", error); }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) {
      const actions = {
        pookie_pause: () => music.pause(interaction.guildId),
        pookie_resume: () => music.resume(interaction.guildId),
        pookie_skip: () => music.skip(interaction.guildId),
        pookie_stop: () => music.stop(interaction.guildId)
      };
      if (interaction.customId === "pookie_volume_down" || interaction.customId === "pookie_volume_up") {
        const value = music.adjustVolume(interaction.guildId, interaction.customId === "pookie_volume_up" ? 10 : -10);
        return interaction.reply({ content: "🔊 Volume: " + value + "%", ephemeral: true });
      }
      const action = actions[interaction.customId];
      if (!action) return;
      const ok = action();
      const messages = {
        pookie_pause: ok ? "⏸️ Playback pause করা হয়েছে।" : "এখন pause করার মতো কোনো অডিও চলছে না।",
        pookie_resume: ok ? "▶️ Playback resume করা হয়েছে।" : "এখন resume করার মতো কোনো অডিও নেই।",
        pookie_skip: ok ? "⏭️ বর্তমান ট্র্যাক skip করা হয়েছে।" : "এখন skip করার মতো কোনো ট্র্যাক নেই।",
        pookie_stop: ok ? "⏹️ Playback বন্ধ করা হয়েছে।" : "এখন কোনো অডিও চলছে না।"
      };
      return interaction.reply({ content: messages[interaction.customId], ephemeral: true });
    }
    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;
    if (name === "help") {
      const embed = new EmbedBuilder().setColor(0x1db954).setTitle("🎧 Pookie Play — Help")
        .setDescription("Spotify search and player controls")
        .addFields(
          { name: "Spotify", value: "/play query — গান খোঁজো বা Spotify লিংক খোলো", inline: false },
          { name: "Player controls", value: "/player অথবা প্লেয়ারের বাটন — Pause, Resume, Skip, Stop, Volume", inline: false },
          { name: "Voice", value: "/join /leave", inline: false }
        ).setFooter({ text: "Spotify search/link only — Spotify audio is not streamed in Discord." });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    if (name === "play") {
      const query = interaction.options.getString("query", true);
      const url = spotifySearchUrl(query);
      const embed = new EmbedBuilder().setColor(0x1db954).setTitle("🎵 Spotify Search")
        .setDescription("[Spotify-তে খুলুন / সার্চ করুন](" + url + ")\n\n**সার্চ:** " + query.slice(0, 250))
        .addFields({ name: "মিউজিক প্লেয়ার", value: "নিচের বাটনগুলো দিয়ে চলমান অডিও নিয়ন্ত্রণ করা যাবে। Spotify-এর অডিও সরাসরি Discord voice-এ বাজানো যাবে না।" });
      return interaction.reply({ embeds: [embed], components: controlRows(url) });
    }
    if (name === "player") {
      const embed = new EmbedBuilder().setColor(0x1db954).setTitle("🎧 Pookie Play Player")
        .setDescription("নিচের বাটন দিয়ে চলমান অডিও নিয়ন্ত্রণ করো। Spotify search/link আলাদা /play কমান্ডে।");
      return interaction.reply({ embeds: [embed], components: controlRows(null) });
    }
    if (name === "join" || name === "leave") {
      if (name === "leave") { music.leave(interaction.guildId); return interaction.reply("👋 Voice channel ছেড়েছি।"); }
      const channel = interaction.member?.voice?.channel;
      if (!channel) return interaction.reply({ content: "আগে একটি voice channel-এ যোগ দাও।", ephemeral: true });
      await interaction.deferReply();
      await music.join(interaction.guildId, channel);
      return interaction.editReply("🎧 Pookie Play voice channel-এ যোগ দিয়েছে।");
    }
    if (name === "pause" || name === "resume" || name === "skip" || name === "stop") {
      const ok = name === "pause" ? music.pause(interaction.guildId) : name === "resume" ? music.resume(interaction.guildId) : name === "skip" ? music.skip(interaction.guildId) : music.stop(interaction.guildId);
      return interaction.reply(ok ? "✅ কমান্ডটি সম্পন্ন হয়েছে।" : "এখন কোনো অডিও চলছে না।");
    }
    if (name === "volume") {
      const value = interaction.options.getInteger("value", true);
      music.volume(interaction.guildId, value);
      return interaction.reply("🔊 Volume: " + value + "%");
    }
  } catch (error) {
    console.error(error);
    const message = error.message?.includes("অন্য voice channel") ? error.message : "কমান্ডটি চালাতে সমস্যা হয়েছে। Bot-এর Connect, Speak এবং Use Application Commands permission পরীক্ষা করো।";
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
  note: "Spotify search/link only. Spotify audio is not streamed in Discord."
}));
app.listen(Number(process.env.PORT || 3000), () => console.log("Dashboard listening."));
client.login(token);
