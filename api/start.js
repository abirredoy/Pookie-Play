const { requireSession } = require("./_lib/auth");
const WORKFLOW = "start-bot.yml";
const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  const user = requireSession(req, res);
  if (!user) return;
  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(503).json({ error: "GitHub token সেট করা হয়নি।" });
  const headers = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const base = "https://api.github.com/repos/abirredoy/Pookie-Play";
  try {
    const check = await fetch(base + "/actions/workflows/" + WORKFLOW + "/runs?per_page=10", { headers, cache: "no-store" });
    if (!check.ok) throw new Error("Could not check current workflow state (HTTP " + check.status + ").");
    const data = await check.json();
    const active = (data.workflow_runs || []).find(run => ACTIVE.has(run.status));
    if (active) return res.status(409).json({ ok: false, alreadyRunning: true, message: "Pookie Play is already running!", runId: active.id });
    const dispatch = await fetch(base + "/actions/workflows/" + WORKFLOW + "/dispatches", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" })
    });
    if (!dispatch.ok) throw new Error("GitHub could not start the workflow (HTTP " + dispatch.status + ").");
    res.status(202).json({ ok: true, message: "Start request sent. Bot is starting." });
  } catch (error) {
    console.error("[Start]", error.message);
    res.status(502).json({ error: "বট চালু করার অনুরোধ পাঠানো যায়নি। GitHub Token-এর Actions permission পরীক্ষা করো।" });
  }
};