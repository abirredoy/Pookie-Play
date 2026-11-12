const OWNER = "abirredoy";
const REPO = "Pookie-Play";
const WORKFLOW = "start-bot.yml";
const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function githubHeaders(token) {
  return {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function getRuns(token) {
  let response;
  try {
    response = await fetch(API_BASE + "/actions/workflows/" + WORKFLOW + "/runs?per_page=20", {
      headers: githubHeaders(token),
      cf: { cacheTtl: 0, cacheEverything: false }
    });
  } catch (cause) {
    const error = new Error("Could not connect to GitHub API: " + (cause?.message || "fetch failed"));
    error.githubDetail = error.message;
    throw error;
  }

  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok) {
    const error = new Error("GitHub API returned HTTP " + response.status);
    error.githubStatus = response.status;
    error.githubMessage = (typeof data.message === "string" && data.message) ||
      raw.slice(0, 500) || response.statusText || "GitHub returned an empty response body";
    error.githubRequestId = response.headers.get("x-github-request-id");
    throw error;
  }
  return Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
}

async function status(request, env) {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (!env.GITHUB_TOKEN) return json({
    state: "setup_required", active: false,
    message: "Cloudflare Worker Secret GITHUB_TOKEN is not configured."
  }, 503);
  try {
    const runs = await getRuns(env.GITHUB_TOKEN);
    const active = runs.find(run => ACTIVE.has(run.status));
    const latest = runs[0] || null;
    return json({
      state: active ? (["queued", "waiting", "requested", "pending"].includes(active.status) ? "starting" : "online") : "offline",
      active: Boolean(active),
      runId: (active || latest)?.id || null,
      runStatus: (active || latest)?.status || null,
      conclusion: active ? null : (latest?.conclusion || null),
      lastRunStartedAt: latest?.run_started_at || latest?.created_at || null,
      lastRunCompletedAt: latest?.completed_at || null
    });
  } catch (error) {
    console.error("[Pookie API] Status error:", error.message, error.githubMessage || error.githubDetail || "");
    return json({
      state: "unknown",
      active: false,
      message: "GitHub API error",
      githubStatus: error.githubStatus || null,
      detail: error.githubMessage || error.githubDetail || error.message || "Unknown error",
      requestId: error.githubRequestId || null
    }, 502);
  }
}

async function start(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const origin = request.headers.get("Origin");
  const requestUrl = new URL(request.url);
  if (!origin || origin !== requestUrl.origin) {
    return json({ error: "এই ওয়েবসাইট থেকেই Start request পাঠাতে হবে।" }, 403);
  }
  if (!env.GITHUB_TOKEN) return json({ error: "Cloudflare Worker Secret GITHUB_TOKEN সেট করা নেই।" }, 503);

  try {
    const runs = await getRuns(env.GITHUB_TOKEN);
    const active = runs.find(run => ACTIVE.has(run.status));
    if (active) {
      return json({ ok: false, alreadyRunning: true, message: "Pookie Play is already running." }, 409);
    }

    const response = await fetch(API_BASE + "/actions/workflows/" + WORKFLOW + "/dispatches", {
      method: "POST",
      headers: { ...githubHeaders(env.GITHUB_TOKEN), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" })
    });
    if (!response.ok) {
      const raw = await response.text();
      let details = {};
      try { details = raw ? JSON.parse(raw) : {}; } catch {}
      const detail = details.message || raw.slice(0, 400) || response.statusText || "Empty response";
      console.error("[Pookie API] Workflow dispatch failed:", response.status, detail);
      return json({
        error: "GitHub Actions Start request ব্যর্থ হয়েছে।",
        githubStatus: response.status,
        detail
      }, 502);
    }
    return json({ ok: true, message: "Start request GitHub Actions-এ পাঠানো হয়েছে।" }, 202);
  } catch (error) {
    console.error("[Pookie API] Start error:", error.message, error.githubMessage || error.githubDetail || "");
    return json({
      error: "GitHub-এর সঙ্গে সংযোগ করা যায়নি।",
      githubStatus: error.githubStatus || null,
      detail: error.githubMessage || error.githubDetail || error.message || "Unknown error"
    }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/status") return status(request, env);
    if (url.pathname === "/api/start") return start(request, env);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Pookie Play Worker is running.", { status: 200 });
  }
};
