const crypto = require("node:crypto");
const { setCookie } = require("../../lib/control-auth");

module.exports = (req, res) => {
  if (req.method !== "GET") return res.status(405).end();
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID;
  const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    console.error("[OAuth] Missing environment variable:", !clientId ? "DISCORD_OAUTH_CLIENT_ID" : "DISCORD_OAUTH_REDIRECT_URI");
    return res.status(500).send("Discord OAuth setup is incomplete. Check the Production environment variables and redeploy.");
  }
  const state = crypto.randomBytes(24).toString("hex");
  setCookie(res, "pookie_oauth_state", state, 600);
  setCookie(res, "pookie_start_intent", req.query.start === "1" ? "1" : "0", 600);
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  res.redirect(302, url.toString());
};
