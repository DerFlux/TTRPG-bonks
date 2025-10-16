// functions/api/save-canvas.js
/**
 * POST /api/save-canvas
 * Body: { path: "src/site/canvas/tir.positions.json", data: {...}, message?: "...", auth?: "password" }
 *
 * Required env vars:
 * - GITHUB_TOKEN   (PAT with Contents: read & write)
 * - GITHUB_OWNER   (e.g. "DerFlux")
 * - GITHUB_REPO    (e.g. "TTRPG-bonks")
 * - GITHUB_BRANCH  (e.g. "main")
 * Optional:
 * - SAVE_PASSWORD  (simple shared secret; if set, requests must include matching `auth`)
 * - COMMITTER_NAME (default "Canvas Bot")
 * - COMMITTER_EMAIL (default "bot@local")
 */

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== "POST") {
    return respond({ error: "Method Not Allowed" }, 405, { Allow: "POST" });
  }
  return onRequestPost(context);
}

export async function onRequestPost({ request, env }) {
  try {
    const { path, data, message, auth } = await request.json();

    // Optional password gate
    const required = env.SAVE_PASSWORD;
    if (required && auth !== required) {
      return respond({ error: "Unauthorized" }, 401);
    }

    if (!path || !data) return respond({ error: "Missing 'path' or 'data'." }, 400);

    const owner  = env.GITHUB_OWNER;
    const repo   = env.GITHUB_REPO;
    const branch = env.GITHUB_BRANCH || "main";
    const token  = env.GITHUB_TOKEN;
    if (!owner || !repo || !token) {
      return respond({ error: "Server not configured (OWNER/REPO/TOKEN)." }, 500);
    }

    const api = "https://api.github.com";
    const filePath = String(path).replace(/^\/+/, "");

    // get current SHA (if exists)
    const metaUrl = `${api}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`;
    let sha = null;
    const meta = await fetch(metaUrl, {
      headers: {
        "authorization": `Bearer ${token}`,
        "user-agent": "canvas-uploader",
        "accept": "application/vnd.github+json"
      }
    });
    if (meta.status === 200) {
      const json = await meta.json();
      sha = json.sha;
    } else if (meta.status !== 404) {
      const txt = await meta.text().catch(() => "");
      return respond({ error: `Fetch meta failed ${meta.status} ${txt}` }, 502);
    }

    // commit contents
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
    const putUrl = `${api}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`;
    const body = {
      message: message || `chore(canvas): update ${filePath}`,
      content,
      branch,
      ...(sha ? { sha } : {}),
      committer: {
        name: env.COMMITTER_NAME || "Canvas Bot",
        email: env.COMMITTER_EMAIL || "bot@local"
      }
    };
    const put = await fetch(putUrl, {
      method: "PUT",
      headers: {
        "authorization": `Bearer ${token}`,
        "user-agent": "canvas-uploader",
        "accept": "application/vnd.github+json",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!put.ok) {
      const txt = await put.text().catch(() => "");
      return respond({ error: `GitHub update failed: ${put.status} ${txt}` }, 502);
    }
    const result = await put.json();
    return respond({
      ok: true,
      committed: {
        path: filePath,
        branch,
        sha: result?.content?.sha || null,
        url: result?.content?.html_url || null
      }
    });
  } catch (err) {
    return respond({ error: String(err?.message || err) }, 500);
  }
}

function respond(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra
    }
  });
}
