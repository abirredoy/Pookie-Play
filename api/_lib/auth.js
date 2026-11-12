const crypto = require("node:crypto");

function cookieMap(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(raw.split(";").map(part => {
    const i = part.indexOf("=");
    return i < 0 ? ["", ""] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
  }).filter(([k]) => k));
}
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters.");
  return value;
}
function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}
function setCookie(res, name, value, maxAge) {
  const cookie = name + "=" + encodeURIComponent(value) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
  res.setHeader("Set-Cookie", cookie);
}
function clearCookie(res, name) {
  setCookie(res, name, "", 0);
}
function issueSession(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, username: user.username, exp: Date.now() + 7 * 86400000 })).toString("base64url");
  return payload + "." + sign(payload);
}
function readSession(req) {
  try {
    const token = cookieMap(req).pookie_session;
    if (!token) return null;
    const [payload, signature] = token.split(".");
    if (!payload || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}
function isAllowed(id) {
  const allowed = [process.env.OWNER_DISCORD_IDS, process.env.CONTROL_ALLOWED_IDS]
    .filter(Boolean).join(",").split(/[ ,]+/).filter(Boolean);
  return allowed.includes(String(id));
}
function requireSession(req, res) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: "লগইন করো।" });
    return null;
  }
  if (!isAllowed(session.id)) {
    res.status(403).json({ error: "তোমার Start Bot ব্যবহারের অনুমতি নেই।" });
    return null;
  }
  return session;
}
module.exports = { cookieMap, setCookie, clearCookie, issueSession, readSession, isAllowed, requireSession };