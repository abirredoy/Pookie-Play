require("dotenv").config();
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType,
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
  new SlashCommandBuilder().setName("search").setDescription("Search songs by name and choose one to play")
    .addStringOption(o => o.setName("query").setDescription("Song name or artist").setRequired(true)),
  new SlashCommandBuilder().setName("play").setDescription("Play a song or a saved List Slot")
    .addStringOption(o => o.setName("query").setDescription("Song name or song link").setRequired(false))
    .addIntegerOption(o => o.setName("list").setDescription("Play saved List Slot 1-10").setMinValue(1).setMaxValue(10).setRequired(false)),
  new SlashCommandBuilder().setName("list").setDescription("Manage your 10 saved List Queue slots")
    .addSubcommand(s => s.setName("add").setDescription("Save a song in a numbered slot")
      .addIntegerOption(o => o.setName("slot").setDescription("Slot number 1-10").setMinValue(1).setMaxValue(10).setRequired(true))
      .addStringOption(o => o.setName("query").setDescription("Song name or song link").setRequired(true)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a saved slot")
      .addIntegerOption(o => o.setName("slot").setDescription("Slot number 1-10").setMinValue(1).setMaxValue(10).setRequired(true)))
    .addSubcommand(s => s.setName("show").setDescription("Show saved List slots"))
    .addSubcommand(s => s.setName("clear").setDescription("Clear all 10 List Queue slots")),

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
  new SlashCommandBuilder().setName("commandchannel").setDescription("Set the only channel where bot commands are allowed")
    .addSubcommand(s => s.setName("set").setDescription("Choose the command channel")
      .addChannelOption(o => o.setName("channel").setDescription("Text channel for all bot commands").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName("show").setDescription("Show the current command channel"))
    .addSubcommand(s => s.setName("clear").setDescription("Remove the command channel restriction")),
  new SlashCommandBuilder().setName("controlroles").setDescription("Manage roles allowed to control Pookie Play")
    .addSubcommand(s => s.setName("show").setDescription("Show all control roles"))
    .addSubcommand(s => s.setName("add").setDescription("Add a role allowed to control the bot")
      .addRoleOption(o => o.setName("role").setDescription("Role to allow").setRequired(true)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a role from bot control")
      .addRoleOption(o => o.setName("role").setDescription("Role to remove").setRequired(true))),
  new SlashCommandBuilder().setName("start").setDescription("Show Pookie Play controls and Control Panel"),
  new SlashCommandBuilder().setName("help").setDescription("Show Pookie Play commands"),
  new SlashCommandBuilder().setName("audionode").setDescription("Manage Pookie Play audio servers")
    .addSubcommand(s => s.setName("list").setDescription("Show audio nodes, online status and ping"))
    .addSubcommand(s => s.setName("add").setDescription("Securely add your own Lavalink server"))
    .addSubcommand(s => s.setName("remove").setDescription("Remove an added audio node")
      .addStringOption(o => o.setName("node").setDescription("Audio node to remove").setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName("test").setDescription("Test node connection and YouTube search")
      .addStringOption(o => o.setName("node").setDescription("Audio node to test").setRequired(false).setAutocomplete(true)))
    .addSubcommand(s => s.setName("use").setDescription("Select an audio node for new voice connections")
      .addStringOption(o => o.setName("node").setDescription("Audio node name").setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName("auto").setDescription("Automatically choose the best available node"))
    .addSubcommand(s => s.setName("refresh").setDescription("Refresh the public node directory and ping checks")),
].map(command => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

// Audio Node Manager. Only Lavalink v4 nodes are admitted because this bot uses Shoukaku v4.
const audioNodeConfigs = new Map();
const audioNodeHealth = new Map();
let selectedAudioNode = "auto";

function addAudioNodeConfig(config) {
  const host = String(config.host || "").trim();
  const port = Number(config.port || 2333);
  const auth = String(config.auth || "").trim();
  if (!host || !auth || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!/^[a-zA-Z0-9.-]+$/.test(host) || /(^localhost$|\.local$)/i.test(host)) return null;
  const ipv4 = host.split(".");
  if (ipv4.length === 4 && ipv4.every(part => /^\d+$/.test(part))) {
    const octets = ipv4.map(Number);
    if (octets.some(n => n < 0 || n > 255) || octets[0] === 10 || octets[0] === 127 ||
      octets[0] === 0 || (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)) return null;
  }
  const key = host.toLowerCase() + ":" + port;
  if (audioNodeConfigs.has(key)) {
    const existing = audioNodeConfigs.get(key);
    existing.auth = auth;
    existing.secure = Boolean(config.secure);
    existing.source = config.source || existing.source;
    return existing;
  }
  let name = String(config.name || "Public-Node").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60);
  const usedNames = new Set([...audioNodeConfigs.values()].map(item => item.name));
  const baseName = name;
  let suffix = 2;
  while (usedNames.has(name)) name = baseName.slice(0, 54) + "-" + suffix++;
  const saved = { name, host, port, auth, secure: Boolean(config.secure), source: config.source || "Public directory" };
  audioNodeConfigs.set(key, saved);
  return saved;
}

function parseAudioHostPort(value, defaultPort) {
  const raw = String(value || "").trim().replace(/^wss?:[/][/]/i, "").replace(/^https?:[/][/]/i, "").split("/")[0];
  if (!raw) return null;
  try {
    const parsed = new URL("http://" + raw);
    return { host: parsed.hostname, port: Number(parsed.port || defaultPort) };
  } catch {
    return { host: raw, port: Number(defaultPort) };
  }
}

const configuredPublic = process.env.LAVALINK_HOST && process.env.LAVALINK_PASSWORD
  ? addAudioNodeConfig({
      name: "CloudeWave-Public",
      ...parseAudioHostPort(process.env.LAVALINK_HOST, process.env.LAVALINK_PORT || 2336),
      auth: process.env.LAVALINK_PASSWORD,
      secure: process.env.LAVALINK_SECURE === "true",
      source: "Existing bot configuration"
    })
  : null;

if (!configuredPublic) {
  addAudioNodeConfig({ name: "CloudeWave-Public", host: "lavalink.cloudewave.in", port: 2336, auth: "cloudewave.in", secure: false, source: "CloudeWave public node" });
}
addAudioNodeConfig({ name: "TriniumHost-V4", host: "lavalink.triniumhost.indevs.in", port: 4333, auth: "free", secure: false, source: "TriniumHost public node" });
addAudioNodeConfig({ name: "TriniumHost-V4-SSL", host: "lavalink-v4.triniumhost.indevs.in", port: 443, auth: "free", secure: true, source: "TriniumHost public node" });

function audioNodeScore(node) {
  const ping = audioNodeHealth.get(node.name)?.ping;
  return Number.isFinite(ping) ? ping : 5000;
}

const initialAudioNodes = [...audioNodeConfigs.values()].map(node => ({
  name: node.name,
  url: node.host + ":" + node.port,
  auth: node.auth,
  secure: node.secure
}));

const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), initialAudioNodes, {
  moveOnDisconnect: true,
  reconnectTries: 5,
  reconnectInterval: 5,
  nodeResolver: nodes => {
    const available = [...nodes.values()].filter(node => node.state === 1);
    if (!available.length) return undefined;
    if (selectedAudioNode !== "auto") {
      const chosen = available.find(node => node.name === selectedAudioNode);
      if (chosen) return chosen;
    }
    return available.sort((a, b) => audioNodeScore(a) - audioNodeScore(b))[0];
  }
});

async function checkAudioNode(nodeConfig) {
  const protocol = nodeConfig.secure ? "https" : "http";
  const started = Date.now();
  try {
    const response = await fetch(protocol + "://" + nodeConfig.host + ":" + nodeConfig.port + "/v4/info", {
      headers: { Authorization: nodeConfig.auth, "User-Agent": "PookiePlay-AudioNodeManager/1.0" },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    await response.body?.cancel().catch(() => {});
    const ping = Date.now() - started;
    audioNodeHealth.set(nodeConfig.name, { online: true, ping, checkedAt: Date.now(), error: null });
    if (!shoukaku.nodes.has(nodeConfig.name)) {
      shoukaku.addNode({
        name: nodeConfig.name,
        url: nodeConfig.host + ":" + nodeConfig.port,
        auth: nodeConfig.auth,
        secure: nodeConfig.secure
      });
    }
    return true;
  } catch (error) {
    audioNodeHealth.set(nodeConfig.name, {
      online: false, ping: null, checkedAt: Date.now(),
      error: String(error?.message || error).slice(0, 90)
    });
    return false;
  }
}

async function refreshAudioNodes(discover = false) {
  if (discover) {
    const directories = [
      "https://raw.githubusercontent.com/Austayo/lavalink-list/main/nodes.json",
      "https://raw.githubusercontent.com/stackryze/lavalink-list/main/nodes.json",
      "https://raw.githubusercontent.com/AjieDev/lavalink-list/master/nodes.json",
      "https://raw.githubusercontent.com/creavitehq/lavalink-list-2/main/nodes.json",
      "https://raw.githubusercontent.com/dawgcodes/lavalink-list-1/main/nodes.json"
    ];
    const directoryResults = await Promise.allSettled(directories.map(async url => {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Directory HTTP " + response.status);
      const payload = await response.json();
      const entries = Array.isArray(payload) ? payload
        : Array.isArray(payload?.nodes) ? payload.nodes
        : Array.isArray(payload?.data) ? payload.data : [];
      let added = 0;
      for (const entry of entries) {
        if (String(entry.restVersion || entry.version || "").toLowerCase() !== "v4") continue;
        const node = addAudioNodeConfig({
          name: "Community-" + String(entry.identifier || entry.host || "Node"),
          host: entry.host,
          port: entry.port || 2333,
          auth: entry.password,
          secure: entry.secure,
          source: "Community Lavalink directory"
        });
        if (node) added++;
      }
      return added;
    }));
    console.log("[Audio Nodes] Public directories checked:", directoryResults.map(result => result.status).join(", "));
  }

  const configs = [...audioNodeConfigs.values()];
  for (let i = 0; i < configs.length; i += 6) {
    await Promise.allSettled(configs.slice(i, i + 6).map(checkAudioNode));
  }
  const online = configs.filter(config => audioNodeHealth.get(config.name)?.online).length;
  console.log("[Audio Nodes] Health check complete:", online + "/" + configs.length, "REST endpoints online.");
  return { total: configs.length, online };
}

async function loadAudioNodeSettings() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return;
  const url = "https://api.github.com/repos/" + repo + "/contents/data/audio-node-settings.json";
  const response = await fetch(url, { headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  if (response.status === 404) return;
  if (!response.ok) throw new Error("Could not load Audio Node settings: HTTP " + response.status);
  const file = await response.json();
  const saved = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  selectedAudioNode = saved?.mode === "manual" && typeof saved.nodeName === "string" ? saved.nodeName : "auto";
  console.log("[Audio Nodes] Loaded selection mode:", selectedAudioNode);
}

async function saveAudioNodeSettings(mode, nodeName = null) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error("GitHub storage is unavailable; Audio Node selection cannot be saved.");
  const url = "https://api.github.com/repos/" + repo + "/contents/data/audio-node-settings.json";
  const headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const current = await fetch(url, { headers });
  let sha;
  if (current.ok) sha = (await current.json()).sha;
  else if (current.status !== 404) throw new Error("Could not read Audio Node settings: HTTP " + current.status);
  const saved = { mode, nodeName: mode === "manual" ? nodeName : null };
  const body = {
    message: "Update Pookie Play Audio Node selection",
    content: Buffer.from(JSON.stringify(saved, null, 2) + "\n").toString("base64"),
    branch: process.env.GITHUB_REF_NAME || "main"
  };
  if (sha) body.sha = sha;
  const response = await fetch(url, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("Could not save Audio Node settings: HTTP " + response.status + " " + (await response.text()).slice(0, 250));
  selectedAudioNode = mode === "manual" ? nodeName : "auto";
}

shoukaku.on("ready", name => console.log("[Lavalink] Connected:", name));
shoukaku.on("error", (name, error) => console.error("[Lavalink] Error:", name, error));
shoukaku.on("close", (name, code, reason) => console.warn("[Lavalink] Closed:", name, code, reason));
const playerMessages = new Map();
const commandChannels = new Map();
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
    embed.setFooter(playerStatusFooter(q, "Playback started"));
    if (info.uri) embed.setURL(info.uri);
    const existing = playerMessages.get(guildId);
    if (existing?.size) {
      for (const message of [...existing]) {
        try { await message.edit({ embeds: [embed], components: controlRows(q) }); }
        catch (error) {
          if (error?.code === 10008) existing.delete(message);
          else console.warn("[Player card] Track refresh failed:", error?.message || error);
        }
      }
      if (existing.size) return;
    }
    const message = await channel.send({ embeds: [embed], components: controlRows(q) });
    rememberPlayerMessage(guildId, message);
  } catch (error) {
    console.error("[Player message] Could not post track card:", error?.message || error);
  }
}, async guildId => {
  await refreshPlayerCards(guildId, "Playback stopped");
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
    console.warn("[Permissions] GitHub persistence is unavailable; control roles cannot be saved.");
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
  for (const [guildId, value] of Object.entries(saved)) {
    const ids = Array.isArray(value) ? value : (typeof value === "string" && value ? [value] : []);
    controlRoles.set(guildId, new Set(ids));
  }
  console.log("[Permissions] Loaded control roles for", controlRoles.size, "server(s).");
}

async function loadCommandChannels() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    console.warn("[Command Channel] GitHub persistence unavailable; channel restriction cannot be saved.");
    return;
  }
  const url = "https://api.github.com/repos/" + repo + "/contents/data/command-channels.json";
  const response = await fetch(url, { headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  if (response.status === 404) return;
  if (!response.ok) throw new Error("Could not load command channels: HTTP " + response.status);
  const file = await response.json();
  const saved = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  for (const [guildId, channelId] of Object.entries(saved)) if (typeof channelId === "string" && channelId) commandChannels.set(guildId, channelId);
  console.log("[Command Channel] Loaded settings for", commandChannels.size, "server(s).");
}

async function saveCommandChannel(guildId, channelId) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error("GitHub storage is unavailable. Start the bot through GitHub Actions.");
  const url = "https://api.github.com/repos/" + repo + "/contents/data/command-channels.json";
  const headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const current = await fetch(url, { headers });
  let saved = {};
  let sha;
  if (current.ok) {
    const file = await current.json();
    sha = file.sha;
    saved = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  } else if (current.status !== 404) throw new Error("Could not read command channel settings: HTTP " + current.status);
  if (channelId) saved[guildId] = channelId;
  else delete saved[guildId];
  const body = { message: "Update Pookie Play command channel", content: Buffer.from(JSON.stringify(saved, null, 2) + "\n").toString("base64"), branch: process.env.GITHUB_REF_NAME || "main" };
  if (sha) body.sha = sha;
  const response = await fetch(url, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("Could not save command channel: HTTP " + response.status + " " + (await response.text()).slice(0, 250));
  if (channelId) commandChannels.set(guildId, channelId);
  else commandChannels.delete(guildId);
}

function commandChannelAllowed(interaction) {
  const allowed = commandChannels.get(interaction.guildId);
  return !allowed || interaction.channelId === allowed;
}

function isServerAdmin(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    (interaction.guild?.ownerId && interaction.user?.id === interaction.guild.ownerId));
}

async function saveControlRoles(guildId, roleIds) {
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
  saved[guildId] = roleIds;
  const body = {
    message: "Update Pookie Play control roles",
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
    throw new Error("Could not save control roles to GitHub: HTTP " + response.status + " " + detail.slice(0, 300));
  }
  controlRoles.set(guildId, new Set(roleIds));
}

function hasControlPermission(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (interaction.guild?.ownerId && interaction.user?.id === interaction.guild.ownerId) return true;
  const roleIds = controlRoles.get(interaction.guildId) || new Set();
  if (!roleIds.size) return true;
  const memberRoles = interaction.member?.roles;
  if (memberRoles?.cache) return [...roleIds].some(roleId => memberRoles.cache.has(roleId));
  return Array.isArray(memberRoles) && memberRoles.some(roleId => roleIds.has(roleId));
}

function getControlRoleMentions(guildId) {
  const ids = [...(controlRoles.get(guildId) || new Set())];
  return ids.length ? ids.map(id => "<@&" + id + ">").join(", ") : "No role restriction is configured";
}

function playerStatusFooter(q, status = "Ready") {
  const repeat = q.repeat === "track" ? "Song" : q.repeat === "queue" ? "Queue" : "OFF";
  return { text: "📜 List: " + (q.listMode ? "ON" : "OFF") + " • 📻 Similar-track radio: " + (q.listMode ? "OFF" : "ON") + " • Repeat: " + repeat + "\n📍 Status: " + String(status).slice(0, 130) };
}

function setPlayerStats(embed, q = {}) {
  const current = q.current || {};
  const mode = q.listMode ? "List" : "Similar-track radio";
  const playbackStatus = current.title ? (q.paused ? "Paused" : "Playing") : (q.node && q.node !== "Disconnected" ? "Stopped" : "Disconnected");
  embed.setFields(
    { name: "🎧 Source", value: String(current.sourceName || "Unknown"), inline: true },
    { name: "🔊 Volume", value: String(Number.isFinite(q.volume) ? q.volume : 100) + "%", inline: true },
    { name: "🔁 Repeat", value: String(q.repeat || "off").toUpperCase(), inline: true },
    { name: "🎚️ Playback", value: mode + " • " + playbackStatus, inline: true },
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
      button("seek_back", "⏪ -5s"),
      button(q.paused ? "resume" : "pause", q.paused ? "▶️ Play" : "⏸️ Pause", q.paused ? ButtonStyle.Success : ButtonStyle.Primary),
      button("seek_forward", "⏩ +5s"),
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
      button("list_toggle", q.listMode ? "📜 List: ON" : "📜 List: OFF", q.listMode ? ButtonStyle.Success : ButtonStyle.Secondary),
      button("random_next", "🎲 Random Play", ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      button("join", "🔊 Join Voice", ButtonStyle.Success),
      button("leave", "🚪 Leave Voice", ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("🎛️ Control Panel").setStyle(ButtonStyle.Link).setURL("https://script.google.com/macros/s/AKfycbyaVy62ftAMSxCg2JfLrwWtSuMvZCbY99nsZ9gT4fZbZ2Bg2EfoDIoHWQhx6jwFH-nH/exec")
    )
  ];
}

function rememberPlayerMessage(guildId, message) {
  if (!playerMessages.has(guildId)) playerMessages.set(guildId, new Set());
  playerMessages.get(guildId).add(message);
}

async function refreshPlayerCards(guildId, status = "Player status synchronized") {
  const messages = playerMessages.get(guildId);
  if (!messages?.size) return;
  const q = music.getQueue(guildId);
  const title = q.current?.title || (q.node !== "Disconnected" ? "Nothing is playing" : "Bot is not connected to a voice channel");
  for (const message of [...messages]) {
    try {
      const embed = message.embeds?.[0] ? EmbedBuilder.from(message.embeds[0]) : new EmbedBuilder().setColor(0x5865f2);
      embed.setTitle(q.current ? "🎶 Now Playing" : (q.node !== "Disconnected" ? "⏹️ Player Stopped" : "🔌 Player Disconnected"))
        .setDescription(q.current ? "**" + String(q.current.title).slice(0, 240) + "**\n" + String(q.current.author || "Unknown artist").slice(0, 180) : "**" + title + "**");
      setPlayerStats(embed, q);
      embed.setFooter(playerStatusFooter(q, status));
      if (q.current?.uri) embed.setURL(q.current.uri);
      await message.edit({ embeds: [embed], components: controlRows(q) });
    } catch (error) {
      if (error?.code === 10008) messages.delete(message);
      else console.warn("[Player card] Refresh failed:", error?.message || error);
    }
  }
}

async function requireVoice(interaction) {
  const channel = interaction.member?.voice?.channel;
  if (!channel) throw new Error("Join a voice channel first.");
  return channel;
}

client.once("ready", async () => {
  console.log("Logged in as " + client.user.tag);
  refreshAudioNodes(true).catch(error => console.error("[Audio Nodes] Initial discovery failed:", error));
  const audioNodeHealthTimer = setInterval(() => refreshAudioNodes(false).catch(error => console.error("[Audio Nodes] Health refresh failed:", error)), 120000);
  audioNodeHealthTimer.unref?.();
  const audioNodeDirectoryTimer = setInterval(() => refreshAudioNodes(true).catch(error => console.error("[Audio Nodes] Directory refresh failed:", error)), 600000);
  audioNodeDirectoryTimer.unref?.();
  try { await loadControlRoles(); }
  catch (error) { console.error("[Permissions] Failed to load role settings:", error); }
  try { await loadCommandChannels(); }
  catch (error) { console.error("[Command Channel] Failed to load settings:", error); }
  try { await loadListStorage(); }
  catch (error) { console.error("[List Queue] Failed to load saved slots:", error); }
  try { await loadAudioNodeSettings(); }
  catch (error) { console.error("[Audio Nodes] Failed to load saved selection:", error); }
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    // Keep one canonical command scope (global). Remove guild-scoped copies
    // from every server this bot is currently in to prevent duplicate slash commands.
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    const guildIds = [...client.guilds.cache.keys()];
    const cleanup = await Promise.allSettled(guildIds.map(guildId =>
      rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] })
    ));
    const removed = cleanup.filter(result => result.status === "fulfilled").length;
    const failed = cleanup.length - removed;
    console.log("[Commands] Global commands registered. Cleared guild-specific command sets:", removed + "/" + guildIds.length);
    if (failed) console.warn("[Commands] Could not clear guild-specific commands for", failed, "server(s).");
  } catch (error) { console.error("Command registration failed:", error); }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) {
      if (!interaction.guildId) return;
      if (!commandChannelAllowed(interaction)) return interaction.reply({ content: "⛔ Player controls are available only in the configured Command Channel: <#" + commandChannels.get(interaction.guildId) + ">.", ephemeral: true });
      if (!hasControlPermission(interaction)) {
        return interaction.reply({ content: "⛔ You are not allowed to control Pookie Play. Required role(s): " + getControlRoleMentions(interaction.guildId), ephemeral: true });
      }
      const id = interaction.customId.replace("pookie_", "");
      if (/^search_[0-4]$/.test(id)) {
        const results = searchResults.get(interaction.guildId);
        const index = Number(id.split("_")[1]);
        const selected = results?.[index];
        if (!selected) return interaction.reply({ content: "This search result has expired. Run /search again.", ephemeral: true });
        const channel = await requireVoice(interaction);
        await interaction.deferUpdate();
        // Reuse the search-result message as the live player card so controls appear
        // on the same message as soon as the selected track starts.
        rememberPlayerMessage(interaction.guildId, interaction.message);
        await music.playResolved(interaction.guildId, channel, selected, interaction.channelId);
        const q = music.getQueue(interaction.guildId);
        const info = selected.info || {};
        const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎶 Now Playing")
          .setDescription("**" + String(info.title || "Unknown track").slice(0, 240) + "**\\n" + String(info.author || "Unknown artist").slice(0, 180));
        setPlayerStats(embed, q);
        embed.setFooter(playerStatusFooter(q, "Playback started"));
        if (info.uri) embed.setURL(info.uri);
        await interaction.message.edit({ embeds: [embed], components: controlRows(q) });
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
        rememberPlayerMessage(interaction.guildId, interaction.message);
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
        seek_back: () => music.seekRelative(interaction.guildId, -5000),
        seek_forward: () => music.seekRelative(interaction.guildId, 5000),
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
        success = ["repeat_cycle", "list_toggle", "volume_down", "volume_up", "leave"].includes(id) ? true : result !== false;
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
        list_toggle: result ? "List: ON • playing saved List only" : "List: OFF • similar-track radio resumed",
        random_next: "Random track selected",
        seek_back: "Seeked backward by 5 seconds", seek_forward: "Seeked forward by 5 seconds",
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
      rememberPlayerMessage(interaction.guildId, interaction.message);
      await refreshPlayerCards(interaction.guildId, status);
      return updated;
    }
    if (interaction.isAutocomplete()) {
      if (interaction.commandName !== "audionode") return interaction.respond([]);
      const focused = interaction.options.getFocused().toLowerCase();
      const focusedSubcommand = interaction.options.getSubcommand(false);
      const choices = [...audioNodeConfigs.values()]
        .filter(node => {
          const isRemovableCustomNode = focusedSubcommand === "remove" &&
            (node.source === "Pookie Server" || node.source === "Manually added");
          const isOnline = audioNodeHealth.get(node.name)?.online === true;
          return (isRemovableCustomNode || isOnline) && node.name.toLowerCase().includes(focused);
        })
        .sort((a, b) => {
          const ah = audioNodeHealth.get(a.name);
          const bh = audioNodeHealth.get(b.name);
          const aOnline = ah?.online === true;
          const bOnline = bh?.online === true;
          if (aOnline !== bOnline) return aOnline ? -1 : 1;
          if (aOnline && bOnline) return (ah.ping ?? 999999) - (bh.ping ?? 999999);
          return a.name.localeCompare(b.name);
        })
        .slice(0, 25)
        .map(node => {
          const health = audioNodeHealth.get(node.name);
          const pingLabel = health?.online
            ? `🟢 ${node.name} — ${health.ping} ms`
            : health?.checkedAt
              ? `🔴 ${node.name} — Offline`
              : `🟡 ${node.name} — Checking...`;
          return { name: pingLabel.slice(0, 100), value: node.name };
        });
      return interaction.respond(choices);
    }
    if (interaction.isModalSubmit() && interaction.customId === "pookie_audionode_add") {
      if (!isServerAdmin(interaction)) return interaction.reply({ content: "Only the Server Owner or an Administrator can add an audio node.", ephemeral: true });
      const nodeName = interaction.fields.getTextInputValue("node_name").trim() || "Pookie-Server";
      const endpoint = interaction.fields.getTextInputValue("node_endpoint").trim();
      const portText = interaction.fields.getTextInputValue("node_port").trim();
      const password = interaction.fields.getTextInputValue("node_password");
      let host; let port; let secure;
      try {
        if (/^(https?|wss?):\/\//i.test(endpoint)) {
          const parsed = new URL(endpoint);
          if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol) || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("Use only the server base URL, without a path.");
          host = parsed.hostname;
          secure = parsed.protocol === "https:" || parsed.protocol === "wss:";
          port = Number(portText || parsed.port || (secure ? 443 : 2333));
        } else {
          const parsed = parseAudioHostPort(endpoint, portText || 2333);
          if (!parsed) throw new Error("Enter a valid host or HTTPS URL.");
          host = parsed.host; port = Number(portText || parsed.port); secure = false;
        }
      } catch (error) { return interaction.reply({ content: "❌ Invalid server address: " + error.message, ephemeral: true }); }
      if (!password.trim()) return interaction.reply({ content: "❌ Server password is required.", ephemeral: true });
      const added = addAudioNodeConfig({ name: nodeName, host, port, auth: password, secure, source: "Manually added" });
      if (!added) return interaction.reply({ content: "❌ Invalid server details. Check the host, port and address.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const online = await checkAudioNode(added);
      return interaction.editReply(online
        ? "✅ **" + added.name + "** was added and is reachable. Run `/audionode test` to test YouTube search, then `/audionode use` to select it."
        : "⚠️ **" + added.name + "** was added for this bot session, but it is currently offline or the password is incorrect. Check `/audionode list` and try again.");
    }
    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;

    if (name === "commandchannel") {
      if (!isServerAdmin(interaction)) return interaction.reply({ content: "⛔ Only the Server Owner or an Administrator can configure the Command Channel.", ephemeral: true });
      const sub = interaction.options.getSubcommand();
      if (sub === "show") {
        const channelId = commandChannels.get(interaction.guildId);
        return interaction.reply({ content: channelId ? "📍 Command Channel: <#" + channelId + ">" : "ℹ️ No Command Channel is configured.", ephemeral: true });
      }
      if (sub === "set") {
        const channel = interaction.options.getChannel("channel", true);
        await interaction.deferReply({ ephemeral: true });
        await saveCommandChannel(interaction.guildId, channel.id);
        return interaction.editReply("✅ Command Channel set to " + channel.toString() + ". All bot commands and player controls are now restricted to this channel.");
      }
      if (sub === "clear") {
        await interaction.deferReply({ ephemeral: true });
        await saveCommandChannel(interaction.guildId, null);
        return interaction.editReply("✅ Command Channel restriction removed. Commands can now be used in any channel.");
      }
    }

    if (!commandChannelAllowed(interaction)) {
      return interaction.reply({ content: "⛔ Bot commands are restricted to the configured Command Channel: <#" + commandChannels.get(interaction.guildId) + ">.", ephemeral: true });
    }

    if (name === "help") {
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play — Help")
        .setDescription("Search and play music from YouTube, YouTube Music, and SoundCloud.")
        .addFields(
          { name: "Music", value: "/search query — Search and play a selected track\\n/play query — Play a track\n/queue — View the queue\n/join /leave — Voice controls", inline: false },
          { name: "Playback", value: "When you play a track, Pookie Play automatically finds related music. Turn List ON to play only saved List slots; turn it OFF to resume similar-track radio.", inline: false },
          { name: "List tools", value: "/list add slot query — Save a track in one of 10 slots\n/list show /list remove /list clear\n/play list — Play a saved List slot\n/queue /shuffle /remove /move /clearqueue /repeat /seek /nowplaying", inline: false },
          { name: "Controls", value: "/pause /resume /skip /stop /volume value and Player buttons", inline: false },
          { name: "Admin", value: "/controlroles show — View allowed roles\n/controlroles add role — Add a control role\n/controlroles remove role — Remove a control role\n/audionode add — Add a private server using a secure modal\n/audionode list / refresh — View status and ping\n/audionode test — Test server and YouTube search\n/audionode use node / remove node / auto", inline: false }
        ).setFooter({ text: "Sources: YouTube • YouTube Music • SoundCloud (when available)." });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (name === "audionode") {
      if (!isServerAdmin(interaction)) {
        return interaction.reply({ content: "Only the Server Owner or an Administrator can change the global Audio Node selection.", ephemeral: true });
      }
      const sub = interaction.options.getSubcommand();
      if (sub === "add") {
        const modal = new ModalBuilder().setCustomId("pookie_audionode_add").setTitle("Add Lavalink Audio Server");
        const nameInput = new TextInputBuilder().setCustomId("node_name").setLabel("Server name").setStyle(TextInputStyle.Short).setPlaceholder("Pookie-Server").setRequired(false).setMaxLength(50);
        const endpointInput = new TextInputBuilder().setCustomId("node_endpoint").setLabel("Server URL or host").setStyle(TextInputStyle.Short).setPlaceholder("https://xxxx.trycloudflare.com").setRequired(true).setMaxLength(200);
        const portInput = new TextInputBuilder().setCustomId("node_port").setLabel("Port (leave blank for automatic)").setStyle(TextInputStyle.Short).setPlaceholder("443 for HTTPS tunnel, 2333 for direct").setRequired(false).setMaxLength(5);
        const passwordInput = new TextInputBuilder().setCustomId("node_password").setLabel("Lavalink password").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200);
        modal.addComponents(new ActionRowBuilder().addComponents(nameInput), new ActionRowBuilder().addComponents(endpointInput), new ActionRowBuilder().addComponents(portInput), new ActionRowBuilder().addComponents(passwordInput));
        return interaction.showModal(modal);
      }
      if (sub === "remove") {
        const nodeName = interaction.options.getString("node", true);
        const config = [...audioNodeConfigs.values()].find(node => node.name === nodeName);
        if (!config || !["Pookie Server", "Manually added"].includes(config.source)) return interaction.reply({ content: "That node is not a manually added server.", ephemeral: true });
        const key = config.host.toLowerCase() + ":" + config.port;
        audioNodeConfigs.delete(key); audioNodeHealth.delete(config.name);
        if (shoukaku.nodes.has(config.name)) shoukaku.removeNode(config.name);
        if (selectedAudioNode === config.name) await saveAudioNodeSettings("auto");
        return interaction.reply({ content: "🗑️ Removed **" + config.name + "** from this bot session. Automatic mode is active if it was selected.", ephemeral: true });
      }
      if (sub === "test") {
        await interaction.deferReply({ ephemeral: true });
        const requested = interaction.options.getString("node");
        const configs = requested ? [...audioNodeConfigs.values()].filter(node => node.name === requested) : [...audioNodeConfigs.values()].filter(node => node.source === "Pookie Server" || node.source === "Manually added");
        if (!configs.length) return interaction.editReply("No custom audio server found. Add one with `/audionode add` first.");
        const reports = [];
        for (const config of configs) {
          const online = await checkAudioNode(config);
          if (!online) { reports.push("🔴 **" + config.name + "** — Offline / password rejected."); continue; }
          try {
            const protocol = config.secure ? "https" : "http";
            const url = protocol + "://" + config.host + ":" + config.port + "/v4/loadtracks?identifier=" + encodeURIComponent("ytsearch:lofi music");
            const response = await fetch(url, { headers: { Authorization: config.auth, "User-Agent": "PookiePlay-AudioNodeTest/1.0" }, signal: AbortSignal.timeout(12000) });
            if (!response.ok) throw new Error("HTTP " + response.status);
            const result = await response.json();
            const tracks = Array.isArray(result.tracks) ? result.tracks : [];
            reports.push(tracks.length ? "🟢 **" + config.name + "** — Online; YouTube search returned " + tracks.length + " track(s)." : "🟡 **" + config.name + "** — Online, but YouTube search returned no tracks (" + String(result.loadType || "unknown") + ").");
          } catch (error) { reports.push("🟡 **" + config.name + "** — REST reachable, YouTube test failed: " + String(error.message || error).slice(0, 100)); }
        }
        return interaction.editReply(reports.join("\n").slice(0, 1900) + "\n\nFor the final audio check, join a voice channel and run `/play query`.");
      }
      if (sub === "list" || sub === "refresh") {
        await interaction.deferReply({ ephemeral: true });
        await refreshAudioNodes(true);
        const preferred = shoukaku.getIdealNode()?.name;
        // Keep offline directory entries internally for future health checks, but never show them.
        const onlineConfigs = [...audioNodeConfigs.values()]
          .filter(config => audioNodeHealth.get(config.name)?.online === true);
        const rows = onlineConfigs.map(config => {
          const health = audioNodeHealth.get(config.name);
          const liveNode = shoukaku.nodes.get(config.name);
          const connected = liveNode?.state === 1;
          const status = connected ? "🟢 Connected" : "🟡 Online";
          const ping = Number.isFinite(health?.ping) ? health.ping + " ms API ping" : "Ping unavailable";
          const selected = selectedAudioNode === config.name ? " • MANUAL" : (selectedAudioNode === "auto" && preferred === config.name ? " • AUTO PICK" : "");
          return status + " **" + config.name + "** — " + ping + selected;
        });
        rows.sort((a, b) => {
          const aOnline = a.startsWith("🟢") || a.startsWith("🟡") ? 0 : 1;
          const bOnline = b.startsWith("🟢") || b.startsWith("🟡") ? 0 : 1;
          if (aOnline !== bOnline) return aOnline - bOnline;
          const aPing = Number(a.match(/— (\d+) ms API ping/)?.[1] ?? 999999);
          const bPing = Number(b.match(/— (\d+) ms API ping/)?.[1] ?? 999999);
          return aPing - bPing;
        });
        const description = rows.join("\n").slice(0, 3900) || "🔴 No public Lavalink v4 audio servers are online right now. Try /audionode refresh again later.";
        const embed = new EmbedBuilder().setColor(0x5865f2)
          .setTitle("🎛️ Pookie Play — Audio Node Manager")
          .setDescription(description)
          .setFooter({ text: "Showing online Lavalink v4 servers only • Sorted by lowest API ping • AUTO selects the best connected node." });
        return interaction.editReply({ embeds: [embed] });
      }
      if (sub === "auto") {
        await interaction.deferReply({ ephemeral: true });
        await saveAudioNodeSettings("auto");
        const best = shoukaku.getIdealNode()?.name;
        return interaction.editReply("✅ Audio Node mode set to AUTO. " + (best ? "Current best connected node: **" + best + "**." : "No node is connected yet; the bot will use the first healthy node when one becomes available.") + " This selection is saved. The best connected node is re-evaluated on every new /join.");
      }
      if (sub === "use") {
        const nodeName = interaction.options.getString("node", true);
        const liveNode = shoukaku.nodes.get(nodeName);
        if (!liveNode || liveNode.state !== 1) {
          return interaction.reply({ content: "That node is not connected yet. Run /audionode refresh and choose a connected node.", ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        await saveAudioNodeSettings("manual", nodeName);
        const activePlayers = [...shoukaku.players.values()];
        const moveResults = await Promise.allSettled(activePlayers.map(player => player.move(nodeName)));
        const moved = moveResults.filter(result => result.status === "fulfilled" && result.value === true).length;
        const failed = moveResults.filter(result => result.status === "rejected" || result.value === false).length;
        return interaction.editReply("✅ Selected **" + nodeName + "**. " +
          (activePlayers.length ? "Moved " + moved + " active player(s)" + (failed ? "; " + failed + " could not be moved." : ".") : "New /join connections will use this node.") +
          " The selection is saved. Use /audionode auto to return to automatic best-node selection.");
      }
    }

    if (name === "controlroles") {
      const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
        (interaction.guild?.ownerId && interaction.user?.id === interaction.guild.ownerId);
      const sub = interaction.options.getSubcommand();
      if (sub !== "show" && !isAdmin) {
        return interaction.reply({ content: "⛔ Only the Server Owner or an Administrator can change the control-role list.", ephemeral: true });
      }
      if (sub === "show") {
        const ids = [...(controlRoles.get(interaction.guildId) || new Set())];
        if (!ids.length) return interaction.reply({ content: "📋 No control roles are configured. While the list is empty, all members can control the bot.", ephemeral: true });
        return interaction.reply({ content: "📋 **Pookie Play Control Role List**\n" + ids.map((id, i) => (i + 1) + ". <@&" + id + ">").join("\n"), ephemeral: true });
      }
      const role = interaction.options.getRole("role", true);
      const ids = [...(controlRoles.get(interaction.guildId) || new Set())];
      if (sub === "add") {
        if (ids.includes(role.id)) return interaction.reply({ content: "ℹ️ " + role.toString() + " is already in the Control Role List.", ephemeral: true });
        ids.push(role.id);
        await interaction.deferReply({ ephemeral: true });
        await saveControlRoles(interaction.guildId, ids);
        return interaction.editReply("✅ " + role.toString() + " was added. Members with this role can now control Pookie Play.");
      }
      if (sub === "remove") {
        if (!ids.includes(role.id)) return interaction.reply({ content: "ℹ️ " + role.toString() + " is not in the Control Role List.", ephemeral: true });
        const updated = ids.filter(id => id !== role.id);
        await interaction.deferReply({ ephemeral: true });
        await saveControlRoles(interaction.guildId, updated);
        return interaction.editReply("🗑️ " + role.toString() + " was removed from the Control Role List.");
      }
    }

    if (!hasControlPermission(interaction)) {
      return interaction.reply({ content: "⛔ You are not allowed to control Pookie Play. Required role(s): " + getControlRoleMentions(interaction.guildId), ephemeral: true });
    }

    if (name === "search") {
      const query = interaction.options.getString("query", true);
      const channel = await requireVoice(interaction);
      await interaction.deferReply();
      await music.join(interaction.guildId, channel);
      music.setTextChannel(interaction.guildId, interaction.channelId);
      const tracks = await music.searchTracks(interaction.guildId, query);
      if (!tracks.length) return interaction.editReply("🔎 No tracks found for **" + query + "**. Try a different search.");
      const results = tracks.slice(0, 5);
      searchResults.set(interaction.guildId, results);
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🔎 Search Results")
        .setDescription("**" + query.slice(0, 150) + "** — Choose a track using the buttons below.")
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
        return interaction.reply({ content: "Choose one option: provide query to play a track, or list: 1-10 to play a saved List slot.", ephemeral: true });
      }
      const channel = await requireVoice(interaction);
      await interaction.deferReply();
      if (listSlot !== null) {
        const result = await music.playList(interaction.guildId, channel, listSlot, interaction.channelId);
        return interaction.editReply("🎶 Playing **" + result.track.info.title + "** from List Slot " + result.slot + ". The remaining saved slots will play in order.");
      }
      const result = await music.play(interaction.guildId, channel, query, interaction.channelId);
      await refreshPlayerCards(interaction.guildId, result.queued ? "Track added to queue" : "Playback started");
      return interaction.editReply(result.queued
        ? "➕ **" + result.track.info.title + "** was added to the queue."
        : "🎶 Starting **" + result.track.info.title + "**. A Player card is being posted.");
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
        return interaction.editReply("💾 **" + result.track.info.title + "** was saved to List Slot " + result.slot + ". (" + result.count + "/10)");
      }
      if (sub === "remove") {
        const slot = interaction.options.getInteger("slot", true);
        const result = await music.removeList(interaction.guildId, slot);
        if (!result) return interaction.reply({ content: "This slot is empty.", ephemeral: true });
        await persistListStorage();
        return interaction.reply("🗑️ Removed **" + result.info.title + "** from List Slot " + slot + ".");
      }
      if (sub === "show") {
        const slots = music.getListSlots(interaction.guildId);
        const lines = Array.from({length:10}, (_,i) => {
          const found = slots.find(item => item.slot === i+1);
          return (i+1) + ". " + (found ? found.info.title : "— Empty —");
        });
        const q = music.getQueue(interaction.guildId);
        return interaction.reply("**🎵 List Queue (" + slots.length + "/10)**\n" + lines.map(line => line.slice(0, 140)).join("\n") + "\nList Mode: " + (q.listMode ? "ON" : "OFF"));
      }
      if (sub === "clear") {
        const count = music.clearList(interaction.guildId);
        await persistListStorage();
        return interaction.reply("🧹 Cleared " + count + " saved List slot(s).");
      }
      if (sub === "mode") {
        const enabled = interaction.options.getBoolean("enabled", true);
        if (enabled) await requireVoice(interaction);
        const channel = interaction.member?.voice?.channel;
        if (enabled && !channel) throw new Error("Join a voice channel before enabling List Mode.");
        if (enabled) {
          await music.join(interaction.guildId, channel);
          music.setTextChannel(interaction.guildId, interaction.channelId);
        }
        const active = await music.setListMode(interaction.guildId, enabled);
        return interaction.reply(active
          ? "🔟 List Mode is ON. Saved slots will play in order. Similar-track radio is OFF."
          : "List Mode is OFF. Saved List slots will no longer play automatically.");
      }
    }

    if (name === "join") {
      const channel = await requireVoice(interaction);
      await interaction.deferReply();
      if (selectedAudioNode === "auto") await refreshAudioNodes(false);
      await music.join(interaction.guildId, channel);
      await refreshPlayerCards(interaction.guildId, "Connected to voice channel");
      return interaction.editReply("🎧 Pookie Play joined your voice channel.");
    }

    if (name === "leave") {
      await music.leave(interaction.guildId);
      await refreshPlayerCards(interaction.guildId, "Disconnected from voice channel");
      return interaction.reply("👋 Pookie Play left the voice channel.");
    }


    if (name === "queue") {
      const data = music.getQueue(interaction.guildId);
      const current = data.current ? "**Now Playing:** " + data.current.title : "Nothing is playing.";
      const upcoming = data.tracks.slice(0, 10).map((t, i) => (i + 1) + ". " + t.title).join("\n");
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎵 Pookie Play Queue")
        .setDescription(current + (upcoming ? "\n\n**Up Next:**\n" + upcoming : "\n\nQueue is empty."))
        .setFooter({ text: "List: " + (data.listMode ? "ON" : "OFF") + " • Similar-track radio: " + (data.listMode ? "OFF" : "ON") + " • Repeat: " + data.repeat });
      return interaction.reply({ embeds: [embed] });
    }

    if (name === "nowplaying") {
      const data = music.getQueue(interaction.guildId);
      if (!data.current) return interaction.reply("Nothing is currently playing.");
      const info = data.current;
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎶 Now Playing")
        .setDescription("**" + info.title + "**\n" + (info.author || "Unknown artist"))
        .addFields({name:"Repeat",value:data.repeat,inline:true});
      if (info.uri) embed.setURL(info.uri);
      await interaction.reply({embeds:[embed],components:controlRows(data)});
      rememberPlayerMessage(interaction.guildId, await interaction.fetchReply());
      return;
    }

    if (name === "shuffle") {
      const count = music.shuffle(interaction.guildId);
      return interaction.reply(count > 1 ? "🔀 Shuffled " + count + " upcoming track(s)." : "There are not enough upcoming tracks to shuffle.");
    }

    if (name === "clearqueue") {
      const count = music.clearQueue(interaction.guildId);
      return interaction.reply("🧹 Removed " + count + " upcoming track(s). The current track will continue.");
    }

    if (name === "remove") {
      const position = interaction.options.getInteger("position", true);
      const removed = music.remove(interaction.guildId, position);
      return interaction.reply(removed ? "➖ Removed: **" + removed.title + "**" : "No track exists at that queue position.");
    }

    if (name === "move") {
      const from = interaction.options.getInteger("from", true);
      const to = interaction.options.getInteger("to", true);
      return interaction.reply(music.move(interaction.guildId, from, to)
        ? "↕️ Queue position updated."
        : "Invalid position or track not found in the queue.");
    }

    if (name === "repeat") {
      const mode = interaction.options.getString("mode", true);
      music.setRepeat(interaction.guildId, mode);
      return interaction.reply("🔁 Repeat mode: **" + mode + "**");
    }

    if (name === "seek") {
      const seconds = interaction.options.getInteger("seconds", true);
      const result = await music.seek(interaction.guildId, seconds * 1000);
      return interaction.reply(result === false ? "Nothing is currently playing." : "⏩ Seeked to " + seconds + " seconds.");
    }

    if (name === "start") {
      const data = music.getQueue(interaction.guildId);
      const title = data.current?.title || "No track is playing yet";
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play Control Panel")
        .setDescription("**" + title + "**\nUse /play to start music. Player controls remain available below.");
      setPlayerStats(embed, data);
      embed.setFooter(playerStatusFooter(data, data.current ? "Player ready" : "Waiting for /play"));
      await interaction.reply({ embeds: [embed], components: controlRows(data) });
      rememberPlayerMessage(interaction.guildId, await interaction.fetchReply());
      return;
    }

    if (name === "player") {
      const data = music.getQueue(interaction.guildId);
      const title = data.current?.title || "Nothing is playing";
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("🎧 Pookie Play Player")
        .setDescription("**" + title + "**\\nAutoplay: " + data.mode);
      await interaction.reply({ embeds: [embed], components: controlRows(data) });
      rememberPlayerMessage(interaction.guildId, await interaction.fetchReply());
      return;
    }

    if (["pause", "resume", "skip", "stop"].includes(name)) {
      const ok = await music[name](interaction.guildId);
      await refreshPlayerCards(interaction.guildId, name === "stop" ? "Playback stopped" : (name === "pause" ? "Playback paused" : name === "resume" ? "Playback resumed" : "Track skipped"));
      const labels = { pause: "Pause", resume: "Resume", skip: "Skip", stop: "Stop" };
      return interaction.reply(ok ? "✅ " + labels[name] + " completed." : "Nothing is currently playing.");
    }

    if (name === "volume") {
      const value = interaction.options.getInteger("value", true);
      const actual = await music.volume(interaction.guildId, value);
      await refreshPlayerCards(interaction.guildId, "Volume updated");
      return interaction.reply("🔊 Volume: " + actual + "%");
    }
  } catch (error) {
    console.error("[Interaction]", error);
    const message = error.message || "Something went wrong while running this command.";
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
