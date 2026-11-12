const WORKFLOW = "start-bot.yml";
const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).end();
  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(503).json({ state: "setup_required", message: "GitHub token is not configured." });
  try {
    const url = "https://api.github.com/repos/abirredoy/Pookie-Play/actions/workflows/" + WORKFLOW + "/runs?per_page=10";
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      cache: "no-store"
    });
    if (!response.ok) throw new Error("GitHub status request failed: HTTP " + response.status);
    const data = await response.json();
    const runs = data.workflow_runs || [];
    const active = runs.find(run => ACTIVE.has(run.status));
    const latest = runs[0] || null;
    const selected = active || latest;
    const now = Date.now();
    const start = selected ? new Date(selected.run_started_at || selected.created_at).getTime() : null;
    const end = selected?.completed_at ? new Date(selected.completed_at).getTime() : null;
    const durationMs = selected ? Math.max(0, (end || now) - start) : null;
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({
      state: active ? (active.status === "queued" || active.status === "waiting" || active.status === "requested" ? "starting" : "online") : "offline",
      active: Boolean(active),
      runId: selected?.id || null,
      runStatus: selected?.status || null,
      startedAt: selected?.run_started_at || selected?.created_at || null,
      completedAt: active ? null : (latest?.completed_at || null),
      durationMs,
      conclusion: active ? null : (latest?.conclusion || null),
      lastRunStartedAt: latest?.run_started_at || latest?.created_at || null,
      lastRunCompletedAt: latest?.completed_at || null,
      lastRunDurationMs: latest?.run_started_at && latest?.completed_at
        ? new Date(latest.completed_at).getTime() - new Date(latest.run_started_at).getTime() : null
    });
  } catch (error) {
    console.error("[Status]", error.message);
    res.status(502).json({ state: "unknown", message: "GitHub থেকে বটের অবস্থা পাওয়া যাচ্ছে না।" });
  }
};