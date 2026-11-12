const { requireSession } = require("../lib/control-auth");
const WORKFLOW = "start-bot.yml";
const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  const user = requireSession(req, res);
  if (!user) return;
  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(503).json({ error: "Vercel-এ GITHUB_TOKEN পাওয়া যায়নি। Production Environment Variable পরীক্ষা করে Redeploy করো।" });

  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const base = "https://api.github.com/repos/abirredoy/Pookie-Play";

  try {
    const check = await fetch(base + "/actions/workflows/" + WORKFLOW + "/runs?per_page=10", {
      headers,
      cache: "no-store"
    });
    const checkData = await check.json().catch(() => ({}));
    if (!check.ok) {
      const detail = checkData.message || ("HTTP " + check.status);
      console.error("[Start] Workflow status check failed:", check.status, detail);
      return res.status(502).json({ error: "GitHub-এর রান-স্ট্যাটাস পরীক্ষা করা যায়নি (" + check.status + "): " + detail });
    }

    const active = (checkData.workflow_runs || []).find(run => ACTIVE.has(run.status));
    if (active) {
      return res.status(409).json({
        ok: false,
        alreadyRunning: true,
        message: "Pookie Play is already running!",
        runId: active.id
      });
    }

    const dispatch = await fetch(base + "/actions/workflows/" + WORKFLOW + "/dispatches", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" })
    });

    if (!dispatch.ok) {
      const errorData = await dispatch.json().catch(() => ({}));
      const detail = errorData.message || ("HTTP " + dispatch.status);
      console.error("[Start] GitHub workflow dispatch failed:", dispatch.status, detail, errorData.errors || "");
      let help = "";
      if (dispatch.status === 401 || dispatch.status === 403) {
        help = " Vercel-এর GITHUB_TOKEN-এ Pookie-Play repository-এর Actions: Read and write permission আছে কি না পরীক্ষা করো।";
      } else if (dispatch.status === 404) {
        help = " Token-এ সঠিক Pookie-Play repository access আছে কি না পরীক্ষা করো।";
      } else if (dispatch.status === 422) {
        help = " GitHub workflow-এর workflow_dispatch trigger এবং main branch পরীক্ষা করতে হবে।";
      }
      return res.status(502).json({ error: "GitHub বট চালু করতে পারেনি (" + dispatch.status + "): " + detail + help });
    }

    return res.status(202).json({ ok: true, message: "Start request sent. Bot is starting." });
  } catch (error) {
    console.error("[Start] Unexpected error:", error.message);
    return res.status(502).json({ error: "সার্ভার থেকে GitHub-এ সংযোগ করা যায়নি: " + error.message });
  }
};
