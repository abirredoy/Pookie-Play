const WORKFLOW = "start-bot.yml";
const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

// Best-effort per-instance throttling. GitHub workflow concurrency is the final duplicate-run guard.
const hits = globalThis.__pookieStartHits || (globalThis.__pookieStartHits = new Map());
const COOLDOWN_MS = 60_000;
const GLOBAL_COOLDOWN_MS = 30_000;
let lastDispatchAt = 0;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }


  // Accept requests only from this website to prevent cross-site button abuse.
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  try {
    if (!origin || !host || new URL(origin).host !== host) {
      return res.status(403).json({ error: "এই ওয়েবসাইট থেকেই Start request পাঠাতে হবে।" });
    }
  } catch {
    return res.status(403).json({ error: "Invalid request origin." });
  }

  const now = Date.now();
  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const previous = hits.get(ip) || 0;
  if (now - previous < COOLDOWN_MS) {
    return res.status(429).json({ error: "এক মিনিট পর আবার চেষ্টা করো।" });
  }
  if (now - lastDispatchAt < GLOBAL_COOLDOWN_MS) {
    return res.status(429).json({ error: "একটি Start request সম্প্রতি পাঠানো হয়েছে। একটু অপেক্ষা করো।" });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(503).json({ error: "সার্ভারে GitHub token সেট করা নেই।" });

  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const base = "https://api.github.com/repos/abirredoy/Pookie-Play";

  try {
    const check = await fetch(base + "/actions/workflows/" + WORKFLOW + "/runs?per_page=10", {
      headers, cache: "no-store"
    });
    const checkData = await check.json().catch(() => ({}));
    if (!check.ok) {
      console.error("[Start] Status check failed:", check.status, checkData.message || "");
      return res.status(502).json({ error: "GitHub থেকে বটের অবস্থা যাচাই করা যাচ্ছে না।" });
    }

    const active = (checkData.workflow_runs || []).find(run => ACTIVE.has(run.status));
    if (active) {
      return res.status(409).json({ ok: false, alreadyRunning: true, message: "Pookie Play is already running." });
    }

    // Reserve cooldown before dispatch to reduce simultaneous public requests.
    hits.set(ip, now);
    lastDispatchAt = now;
    const dispatch = await fetch(base + "/actions/workflows/" + WORKFLOW + "/dispatches", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" })
    });

    if (!dispatch.ok) {
      const errorData = await dispatch.json().catch(() => ({}));
      console.error("[Start] Dispatch failed:", dispatch.status, errorData.message || "");
      return res.status(502).json({ error: "GitHub Actions-এ Start request পাঠানো যায়নি। Token-এর Actions: Read and write permission পরীক্ষা করতে হবে।" });
    }

    return res.status(202).json({ ok: true, message: "Start request পাঠানো হয়েছে। বট চালু হচ্ছে…" });
  } catch (error) {
    console.error("[Start] Unexpected error:", error.message);
    return res.status(502).json({ error: "সার্ভার থেকে GitHub-এ সংযোগ করা যায়নি।" });
  }
};
