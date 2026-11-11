require("dotenv").config();
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");
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
  new SlashCommandBuilder().setName("files").setDescription("List uploaded audio files"),
  new SlashCommandBuilder().setName("playfile").setDescription("Play an uploaded audio file")
    .addStringOption(o => o.setName("filename").setDescription("Exact filename from /files").setRequired(true)),
  new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue"),
  new SlashCommandBuilder().setName("queue").setDescription("Show the current queue"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current track"),
  new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the upcoming queue"),
  new SlashCommandBuilder().setName("loop").setDescription("Set loop mode")
    .addStringOption(o => o.setName("mode").setDescription("Loop mode").setRequired(true)
      .addChoices({ name: "Off", value: "off" }, { name: "Current track", value: "track" }, { name: "Queue", value: "queue" })),
  new SlashCommandBuilder().setName("remove").setDescription("Remove a song from the queue")
    .addIntegerOption(o => o.setName("position").setDescription("Queue position").setMinValue(1).setRequired(true)),
  new SlashCommandBuilder().setName("volume").setDescription("Set volume")
    .addIntegerOption(o => o.setName("value").setDescription("0 to 100").setMinValue(0).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName("help").setDescription("Show Pookie Play commands")
].map(command => command.toJSON());

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
  } catch (error) { console.error("Command registration failed:", error); }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const name = interaction.commandName;
  try {
    if (name === "help") {
      const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle("🎧 Pookie Play — Help")
        .setDescription("Music controls for your voice channel")
        .addFields(
          { name: "Playback", value: "`/play` `/playfile` `/files` `/pause` `/resume` `/skip` `/stop`", inline: false },
          { name: "Queue", value: "`/queue` `/shuffle` `/remove position`", inline: false },
          { name: "Other", value: "`/nowplaying` `/loop off|track|queue` `/volume 0-100` `/join` `/leave`", inline: false }
        ).setFooter({ text: "Pookie Play • YouTube search and links" });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    if (name === "files") {
      const files = music.listFiles();
      const body = files.length ? "🎵 **Available audio files:**\n" + files.map(file => "• `" + file + "`").join("\n") : "এখনো কোনো অডিও ফাইল যোগ করা হয়নি। GitHub-এর assets/audio ফোল্ডারে নিজের বা ব্যবহারের অনুমতি থাকা MP3/OGG/WAV ফাইল যোগ করো।";
      return interaction.reply(body);
    }
    if (name === "playfile") {
      const channel = interaction.member?.voice?.channel;
      if (!channel) return interaction.reply({ content: "আগে একটি voice channel-এ যোগ দাও।", ephemeral: true });
      await interaction.deferReply();
      await music.join(interaction.guildId, channel);
      const result = await music.playFile(interaction.guildId, interaction.options.getString("filename", true), interaction.user.username);
      return interaction.editReply(result);
    }
    if (name === "join" || name === "play") {
      const channel = interaction.member?.voice?.channel;
      if (!channel) return interaction.reply({ content: "আগে একটি voice channel-এ যোগ দাও।", ephemeral: true });
      await interaction.deferReply();
      await music.join(interaction.guildId, channel);
      if (name === "join") return interaction.editReply("🎧 Pookie Play voice channel-এ যোগ দিয়েছে।");
      const result = await music.play(interaction.guildId, interaction.options.getString("query", true), interaction.user.username);
      return interaction.editReply(result);
    }
    if (name === "leave") {
      music.leave(interaction.guildId);
      return interaction.reply("👋 Voice channel ছেড়েছি এবং queue বন্ধ করেছি।");
    }
    if (name === "pause") {
      const ok = music.pause(interaction.guildId);
      return interaction.reply(ok ? "⏸️ গান pause করা হয়েছে।" : "এখন কোনো গান চলছে না।");
    }
    if (name === "resume") {
      const ok = music.resume(interaction.guildId);
      return interaction.reply(ok ? "▶️ গান আবার চালু হয়েছে।" : "গানটি resume করা যায়নি।");
    }
    if (name === "skip") {
      const ok = music.skip(interaction.guildId);
      return interaction.reply(ok ? "⏭️ পরের গানে যাচ্ছি।" : "এখন skip করার মতো গান নেই।");
    }
    if (name === "stop") {
      music.stop(interaction.guildId);
      return interaction.reply("⏹️ Playback বন্ধ এবং queue খালি করা হয়েছে।");
    }
    if (name === "queue") {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle("🎶 Pookie Play Queue").setDescription(music.queueText(interaction.guildId).slice(0, 4000))] });
    }
    if (name === "nowplaying") {
      const item = music.current(interaction.guildId);
      if (!item) return interaction.reply("এখন কোনো গান চলছে না।");
      const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle("🎵 এখন চলছে").setDescription(`**${item.title}**`)
        .addFields({ name: "Requested by", value: item.requestedBy || "Unknown", inline: true },
          { name: "Loop", value: music.loop(interaction.guildId), inline: true });
      return interaction.reply({ embeds: [embed] });
    }
    if (name === "shuffle") {
      const count = music.shuffle(interaction.guildId);
      return interaction.reply(count > 1 ? `🔀 Queue-এর ${count}টি গান shuffle করা হয়েছে।` : "Shuffle করার মতো পর্যাপ্ত গান নেই।");
    }
    if (name === "loop") {
      const mode = interaction.options.getString("mode", true);
      music.setLoop(interaction.guildId, mode);
      return interaction.reply(`🔁 Loop mode: **${mode}**`);
    }
    if (name === "remove") {
      const removed = music.remove(interaction.guildId, interaction.options.getInteger("position", true));
      return interaction.reply(removed ? `🗑️ **${removed.title}** queue থেকে সরানো হয়েছে।` : "এই position-এ কোনো গান নেই।");
    }
    if (name === "volume") {
      music.volume(interaction.guildId, interaction.options.getInteger("value", true));
      return interaction.reply("🔊 Volume update করা হয়েছে।");
    }
  } catch (error) {
    console.error(error);
    const message = error.message?.includes("অন্য voice channel")
      ? error.message
      : "কমান্ডটি চালাতে সমস্যা হয়েছে। Bot-এর Connect, Speak এবং Use Application Commands permission পরীক্ষা করো।";
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
  note: "Local starter dashboard. Add secure OAuth before public deployment."
}));
app.listen(Number(process.env.PORT || 3000), () => console.log("Dashboard listening."));
client.login(token);
