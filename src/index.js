require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const express = require("express");
const { createMusic } = require("./music");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID. Copy .env.example to .env and fill them in.");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder().setName("join").setDescription("Join your voice channel"),
  new SlashCommandBuilder().setName("leave").setDescription("Leave the voice channel"),
  new SlashCommandBuilder().setName("play").setDescription("Play a YouTube URL or search")
    .addStringOption(o => o.setName("query").setDescription("YouTube URL or search terms").setRequired(true)),
  new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue"),
  new SlashCommandBuilder().setName("queue").setDescription("Show the current queue"),
  new SlashCommandBuilder().setName("volume").setDescription("Set volume").addIntegerOption(o => o.setName("value").setDescription("0 to 100").setMinValue(0).setMaxValue(100).setRequired(true))
].map(c => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const music = createMusic();
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(clientId, process.env.GUILD_ID)
      : Routes.applicationCommands(clientId);
    await rest.put(route, { body: commands });
    console.log("Slash commands registered.");
  } catch (e) { console.error("Command registration failed:", e); }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    const name = interaction.commandName;
    if (name === "join") {
      const channel = interaction.member?.voice?.channel;
      if (!channel) return interaction.reply({ content: "আগে একটি voice channel-এ যোগ দাও।", ephemeral: true });
      music.join(interaction.guildId, channel);
      return interaction.reply("Pookie Play voice channel-এ যোগ দিয়েছে।");
    }
    if (name === "leave") { music.leave(interaction.guildId); return interaction.reply("Voice channel ছেড়েছি।"); }
    if (name === "play") {
      await interaction.deferReply();
      const channel = interaction.member?.voice?.channel;
      if (!channel) return interaction.editReply("আগে একটি voice channel-এ যোগ দাও।");
      music.join(interaction.guildId, channel);
      const result = await music.play(interaction.guildId, interaction.options.getString("query", true));
      return interaction.editReply(result);
    }
    if (name === "pause") { music.pause(interaction.guildId); return interaction.reply("Playback paused."); }
    if (name === "resume") { music.resume(interaction.guildId); return interaction.reply("Playback resumed."); }
    if (name === "skip") { music.skip(interaction.guildId); return interaction.reply("Skipped."); }
    if (name === "stop") { music.stop(interaction.guildId); return interaction.reply("Playback stopped."); }
    if (name === "queue") return interaction.reply(music.queueText(interaction.guildId));
    if (name === "volume") { music.volume(interaction.guildId, interaction.options.getInteger("value", true)); return interaction.reply("Volume updated."); }
  } catch (e) {
    console.error(e);
    const msg = "কমান্ডটি চালাতে সমস্যা হয়েছে। Bot permissions ও voice connection পরীক্ষা করো।";
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: msg, ephemeral: true }).catch(()=>{});
    else await interaction.reply({ content: msg, ephemeral: true }).catch(()=>{});
  }
});

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.get("/api/status", (_req, res) => res.json({
  bot: client.isReady() ? client.user.tag : "Offline",
  connectedGuilds: client.guilds.cache.size,
  note: "Local starter dashboard. Add secure OAuth before public deployment."
}));
app.listen(Number(process.env.PORT || 3000), () => console.log("Dashboard listening."));
client.login(token);
