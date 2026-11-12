const { cookieMap, clearCookie, setCookie, issueSession, isAllowed } = require("../../lib/control-auth");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).end();
  const cookies = cookieMap(req);
  const wantsStart = cookies.pookie_start_intent === "1";
  const state = req.query.state;
  if (!state || !cookies.pookie_oauth_state || state !== cookies.pookie_oauth_state) {
    clearCookie(res, "pookie_oauth_state");
    clearCookie(res, "pookie_start_intent");
    return res.redirect(302, "/control/?error=oauth_state");
  }
  clearCookie(res, "pookie_oauth_state");
  clearCookie(res, "pookie_start_intent");
  if (req.query.error || !req.query.code) return res.redirect(302, "/control/?error=oauth_denied");
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID;
  const clientSecret = process.env.DISCORD_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[OAuth] One or more Discord OAuth Production variables are missing.");
    return res.status(500).send("Discord OAuth setup is incomplete. Check Production environment variables and redeploy.");
  }
  try {
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: req.query.code,
      redirect_uri: redirectUri
    });
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    });
    if (!tokenResponse.ok) throw new Error("Discord token exchange failed.");
    const token = await tokenResponse.json();
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: "Bearer " + token.access_token }
    });
    if (!userResponse.ok) throw new Error("Discord user lookup failed.");
    const user = await userResponse.json();
    if (!isAllowed(user.id)) return res.redirect(302, "/control/?error=not_allowed");
    setCookie(res, "pookie_session", issueSession(user), 604800);
    return res.redirect(302, wantsStart ? "/control/?start=1" : "/control/");
  } catch (error) {
    console.error("[OAuth]", error.message);
    return res.redirect(302, "/control/?error=oauth_failed");
  }
};
