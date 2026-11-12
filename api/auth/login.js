const crypto = require("node:crypto");
const { setCookie } = require("../_lib/auth");

module.exports = (req, res) => {
  if (req.method !== "GET") return res.status(405).end();
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID;
  const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) return res.status(500).send("Discord OAuth environment variables are not configured.");
  const state = crypto.randomBytes(24).toString("hex");
  setCookie(res, "pookie_oauth_state", state, 600);
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  res.redirect(302, url.toString());
};