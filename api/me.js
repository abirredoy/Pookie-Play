const { readSession, isAllowed } = require("../lib/control-auth");
module.exports = (req, res) => {
  if (req.method !== "GET") return res.status(405).end();
  const session = readSession(req);
  if (!session) return res.status(200).json({ loggedIn: false, allowed: false });
  res.status(200).json({
    loggedIn: true,
    allowed: isAllowed(session.id),
    user: { id: session.id, username: session.username }
  });
};