const { clearCookie } = require("../_lib/auth");
module.exports = (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  clearCookie(res, "pookie_session");
  res.status(200).json({ ok: true });
};