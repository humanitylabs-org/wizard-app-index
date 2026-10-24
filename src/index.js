// Wizard App Index: discovery for Wizard apps. It is a cache, not the source of truth:
// every listing is re-derived from the app's own repo at a pinned commit, so the whole
// database can be dropped and rebuilt. Publishing only *notifies* the index; nothing in a
// publish request is trusted, the index always reads the repo itself.
import { check, passed, failures, TAGS } from "./checker.js";
import { parseRepo, resolveCommit, fileReader, searchTopic } from "./github.js";
import { storePage } from "./page.js";
import { handleApprove, pruneApprovals } from "./approve.js";

const TOPICS = ["wizard-app", "wizard-ai"]; // wizard-ai only during the transition
const RECHECK_AFTER = 7 * 24 * 3600; // re-verify listings weekly
const PUBLISH_COOLDOWN = 60; // seconds; same repo+commit
const QUEUE_BATCH = 25; // repo checks per cron run (each is ~4 subrequests)
const SWEEP_START = Date.UTC(2026, 8, 1) / 1000; // the wizard-app topic did not exist before this

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data, null, 2) + "\n", {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": status === 200 ? "public, max-age=30" : "no-store", ...extra },
  });
const now = () => Math.floor(Date.now() / 1000);
const parseJSON = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};

function row2app(r, full = false) {
  const a = {
    repo: `${r.owner}/${r.repo}`,
    publisher: r.owner,
    publisher_npub: r.publisher_npub || null,
    id: r.app_id,
    name: r.name,
    summary: r.summary,
    type: r.type,
    category: r.category,
    version: r.version,
    logo: r.logo ? `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${r.commit_sha}/${r.logo}` : null,
    url: r.repo_url,
    provides: parseJSON(r.provides, []),
    architectures: parseJSON(r.architectures, []),
    install: { git: r.repo_url, commit: r.commit_sha },
    uses: parseJSON(r.uses, []),
    needs: parseJSON(r.needs, []),
    tags: parseJSON(r.tags, []),
    installs: Number(r.installs) || 0,
    checked_at: r.checked_at,
  };
  if (full) {
    Object.assign(a, { license: r.license, uses: parseJSON(r.uses, []), needs: parseJSON(r.needs, []), ref: r.ref, found_via: r.found_via, first_seen: r.first_seen, listed: Boolean(r.listed), manifest: parseJSON(r.manifest, {}) });
  }
  return a;
}

export const tagsOf = (d) => [...new Set((Array.isArray(d.tags) ? d.tags : []).filter((x) => TAGS.has(x)))];

// Check one repo at its current commit and write the result. Returns a publish report.
export const categoryOf = (d) => (["agent", "interface", "app", "system"].includes(d.category) ? d.category : d.type === "agent" ? "agent" : "app");

export async function indexRepo(env, r, { via, ref } = {}) {
  const c = await resolveCommit(r, ref);
  const t = now();
  if (c.error) {
    await env.DB.batch([
      env.DB.prepare("INSERT OR REPLACE INTO checks (key, commit_sha, ok, failures, checked_at) VALUES (?, NULL, 0, ?, ?)").bind(r.key, JSON.stringify([c.error]), t),
      env.DB.prepare("UPDATE apps SET listed = 0, checked_at = ? WHERE key = ?").bind(t, r.key),
      env.DB.prepare("DELETE FROM apps_fts WHERE key = ?").bind(r.key),
      env.DB.prepare("DELETE FROM app_slots WHERE key = ?").bind(r.key),
      env.DB.prepare("DELETE FROM app_tags WHERE key = ?").bind(r.key),
    ]);
    return { repo: `${r.owner}/${r.repo}`, listed: false, failures: [c.error] };
  }
  const res = await check(fileReader(r, c.sha));
  const ok = passed(res.results);
  const fails = failures(res.results);
  const stmts = [env.DB.prepare("INSERT OR REPLACE INTO checks (key, commit_sha, ok, failures, checked_at) VALUES (?, ?, ?, ?, ?)").bind(r.key, c.sha, ok ? 1 : 0, JSON.stringify(fails), t)];
  if (!ok) {
    // A failing new commit delists the repo; the last passing record stays for history.
    stmts.push(env.DB.prepare("UPDATE apps SET listed = 0, checked_at = ? WHERE key = ?").bind(t, r.key));
    stmts.push(env.DB.prepare("DELETE FROM apps_fts WHERE key = ?").bind(r.key));
    stmts.push(env.DB.prepare("DELETE FROM app_slots WHERE key = ?").bind(r.key));
    stmts.push(env.DB.prepare("DELETE FROM app_tags WHERE key = ?").bind(r.key));
    await env.DB.batch(stmts);
    return { repo: `${r.owner}/${r.repo}`, commit: c.sha, listed: false, failures: fails, results: res.results };
  }
  const d = res.data;
  const provides = Array.isArray(d.provides) ? d.provides.map(String) : [];
  const tags = tagsOf(d);
  const archs = Array.isArray(res.config?.supported_architectures) ? res.config.supported_architectures : [];
  stmts.push(
    env.DB.prepare(
      `INSERT INTO apps (key, host, owner, repo, repo_url, commit_sha, ref, app_id, name, summary, type, version, license, publisher_npub, provides, uses, needs, architectures, manifest, found_via, first_seen, checked_at, listed, category, logo, tags)
       VALUES (?, 'github', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET owner=excluded.owner, repo=excluded.repo, repo_url=excluded.repo_url, commit_sha=excluded.commit_sha, ref=excluded.ref,
         app_id=excluded.app_id, name=excluded.name, summary=excluded.summary, type=excluded.type, version=excluded.version, license=excluded.license,
         publisher_npub=excluded.publisher_npub, provides=excluded.provides, uses=excluded.uses, needs=excluded.needs, architectures=excluded.architectures,
         manifest=excluded.manifest, checked_at=excluded.checked_at, listed=1, category=excluded.category, logo=excluded.logo, tags=excluded.tags`
    ).bind(
      r.key, r.owner, r.repo, r.url, c.sha, c.ref, String(d.id), String(d.name ?? d.id), String(d.summary), String(d.type), String(d.version),
      d.license ? String(d.license) : null, d.publisher ? String(d.publisher) : null, JSON.stringify(provides), JSON.stringify(d.uses ?? []),
      JSON.stringify(d.needs ?? []), JSON.stringify(archs), JSON.stringify(d), via, t, t, categoryOf(d), res.logo, JSON.stringify(tags)
    ),
    env.DB.prepare("DELETE FROM apps_fts WHERE key = ?").bind(r.key),
    env.DB.prepare("INSERT INTO apps_fts (key, name, summary, body, provides, owner) VALUES (?, ?, ?, ?, ?, ?)").bind(
      r.key, String(d.name ?? d.id), String(d.summary), String(res.body ?? "").slice(0, 8000), provides.join(" "), r.owner
    ),
    env.DB.prepare("DELETE FROM app_slots WHERE key = ?").bind(r.key),
    ...provides.map((p) => env.DB.prepare("INSERT OR IGNORE INTO app_slots (key, slot) VALUES (?, ?)").bind(r.key, p)),
    env.DB.prepare("DELETE FROM app_tags WHERE key = ?").bind(r.key),
    ...tags.map((g) => env.DB.prepare("INSERT OR IGNORE INTO app_tags (key, tag) VALUES (?, ?)").bind(r.key, g)),
    env.DB.prepare("DELETE FROM queue WHERE key = ?").bind(r.key)
  );
  await env.DB.batch(stmts);
  return { repo: `${r.owner}/${r.repo}`, commit: c.sha, listed: true, id: d.id, version: String(d.version), failures: [] };
}

function ftsQuery(q) {
  const terms = String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return terms.slice(0, 8).map((t) => `"${t}"*`).join(" ");
}

const SORTS = { popular: "installs DESC, a.name COLLATE NOCASE", new: "a.first_seen DESC, a.key", name: "a.name COLLATE NOCASE" };
const WITH_INSTALLS = "COALESCE((SELECT count FROM installs i WHERE i.key = a.key), 0) AS installs";

// Pure: URLSearchParams -> {sql, binds}. Filters AND together; an explicit sort wins over bm25 / id order.
export function buildSearch(p) {
  const limit = Math.min(Math.max(parseInt(p.get("limit") || "20", 10) || 20, 1), 50);
  const offset = Math.min(Math.max(parseInt(p.get("offset") || "0", 10) || 0, 0), 10000);
  const where = ["a.listed = 1"];
  const binds = [];
  let from = "apps a";
  let order = SORTS.name;
  const q = ftsQuery(p.get("q") || "");
  if (q) {
    from = "apps_fts f JOIN apps a ON a.key = f.key";
    where.push("apps_fts MATCH ?");
    binds.push(q);
    order = "bm25(apps_fts, 0, 10.0, 5.0, 1.0, 4.0, 2.0)";
  }
  if (p.get("slot")) {
    where.push("a.key IN (SELECT key FROM app_slots WHERE slot = ?)");
    binds.push(p.get("slot"));
  }
  if (p.get("tag")) {
    where.push("a.key IN (SELECT key FROM app_tags WHERE tag = ?)");
    binds.push(p.get("tag"));
  }
  if (p.get("id")) {
    // Exact install name. Several publishers may use the same id; oldest listing first.
    where.push("a.app_id = ?");
    binds.push(p.get("id"));
    order = "a.first_seen, a.key";
  }
  if (p.get("category")) {
    where.push("a.category = ?");
    binds.push(p.get("category"));
  }
  if (p.get("type")) {
    where.push("a.type = ?");
    binds.push(p.get("type"));
  }
  if (p.get("publisher")) {
    where.push("a.owner = ? COLLATE NOCASE");
    binds.push(p.get("publisher"));
  }
  if (p.get("arch")) {
    where.push("(a.architectures = '[]' OR EXISTS (SELECT 1 FROM json_each(a.architectures) WHERE value = ?))");
    binds.push(p.get("arch"));
  }
  if (Object.hasOwn(SORTS, p.get("sort") || "")) order = SORTS[p.get("sort")];
  const sql = `SELECT a.*, ${WITH_INSTALLS} FROM ${from} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`;
  return { sql, binds: [...binds, limit + 1, offset], limit, offset };
}

async function search(env, url) {
  const { sql, binds, limit, offset } = buildSearch(url.searchParams);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  const more = results.length > limit;
  return json({ apps: results.slice(0, limit).map((r) => row2app(r)), next_offset: more ? offset + limit : null });
}

async function tags(env) {
  const { results } = await env.DB.prepare(
    "SELECT t.tag AS id, COUNT(*) AS count FROM app_tags t JOIN apps a ON a.key = t.key WHERE a.listed = 1 GROUP BY t.tag ORDER BY count DESC, id"
  ).all();
  return json({ tags: results.map((x) => ({ id: x.id, count: x.count })) });
}

// ---------------------------------------------------------------- anonymous install counts

const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

// sha256 hex of "day|ip|key". Only the hash is stored, and only for 2 days (dedupe window).
export async function installHash(day, ip, key) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${day}|${ip}|${key}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function recordInstall(env, request) {
  const body = (request.headers.get("content-type") || "").includes("json") ? await request.json().catch(() => ({})) : {};
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id || id.length > 64) return json({ error: "send {\"id\": \"app-id\", \"repo\": \"owner/name\"}" }, 400);
  let row = null;
  const r = typeof body.repo === "string" ? parseRepo(body.repo) : null;
  if (r) row = await env.DB.prepare("SELECT key FROM apps WHERE key = ? AND app_id = ? AND listed = 1").bind(r.key, id).first();
  // No repo, or it is not a listing of this id: count it for the oldest listing with that id.
  if (!row) row = await env.DB.prepare("SELECT key FROM apps WHERE app_id = ? AND listed = 1 ORDER BY first_seen, key LIMIT 1").bind(id).first();
  if (!row) return json({ error: "unknown app id" }, 404, { "cache-control": "no-store" });
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const d = utcDay();
  const hash = await installHash(d, ip, row.key);
  const seen = await env.DB.prepare("INSERT OR IGNORE INTO install_seen (day, hash) VALUES (?, ?)").bind(d, hash).run();
  if (seen.meta?.changes) {
    await env.DB.prepare("INSERT INTO installs (key, count) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET count = count + 1").bind(row.key).run();
  }
  const c = await env.DB.prepare("SELECT count FROM installs WHERE key = ?").bind(row.key).first();
  return json({ ok: true, installs: c?.count ?? 0 }, 200, { "cache-control": "no-store" });
}

const pruneInstallSeen = (env) => env.DB.prepare("DELETE FROM install_seen WHERE day < ?").bind(utcDay(Date.now() - 86400000)).run();

async function publish(env, request) {
  let body = {};
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("json")) body = await request.json().catch(() => ({}));
  else if (ct.includes("form")) body = Object.fromEntries(await request.formData());
  // Plain {repo}, or a GitHub webhook payload (push / repository events). The payload is only a hint.
  const input = body.repo || body.repository?.full_name || body.repository?.html_url;
  const r = parseRepo(input);
  if (!r) return json({ error: "send {\"repo\": \"owner/name\"} for a public GitHub repo" }, 400);
  const ref = typeof body.ref === "string" && !body.repository ? body.ref.replace(/^refs\/heads\//, "") : undefined;
  if (request.headers.get("x-github-event") === "ping") return json({ ok: true, repo: `${r.owner}/${r.repo}`, note: "webhook connected; push to publish" });
  const last = await env.DB.prepare("SELECT c.commit_sha, c.ok, c.failures, c.checked_at FROM checks c WHERE c.key = ?").bind(r.key).first();
  if (last && now() - last.checked_at < PUBLISH_COOLDOWN && !ref) {
    const c = await resolveCommit(r);
    if (c.sha && c.sha === last.commit_sha) {
      return json({ repo: `${r.owner}/${r.repo}`, commit: last.commit_sha, listed: Boolean(last.ok), failures: parseJSON(last.failures, []), cached: true });
    }
  }
  const report = await indexRepo(env, r, { via: "publish", ref });
  return json(report, report.listed ? 200 : 422);
}

async function getApp(env, owner, repo) {
  const r = parseRepo(`${owner}/${repo}`);
  if (!r) return json({ error: "bad repo" }, 400);
  const row = await env.DB.prepare(`SELECT a.*, ${WITH_INSTALLS} FROM apps a WHERE a.key = ?`).bind(r.key).first();
  const chk = await env.DB.prepare("SELECT commit_sha, ok, failures, checked_at FROM checks WHERE key = ?").bind(r.key).first();
  if (!row && !chk) return json({ error: "not indexed; POST /v1/publish to add it" }, 404);
  return json({ ...(row ? row2app(row, true) : { repo: `${r.owner}/${r.repo}`, listed: false }), last_check: chk ? { commit: chk.commit_sha, ok: Boolean(chk.ok), failures: parseJSON(chk.failures, []), checked_at: chk.checked_at } : null });
}

async function stats(env) {
  const a = await env.DB.prepare("SELECT COUNT(*) AS listed FROM apps WHERE listed = 1").first();
  const q = await env.DB.prepare("SELECT COUNT(*) AS queued FROM queue").first();
  const s = await env.DB.prepare("SELECT name, value FROM crawl_state").all();
  return json({ listed: a.listed, queued: q.queued, crawl: Object.fromEntries(s.results.map((x) => [x.name, x.value])) });
}

// ---------------------------------------------------------------- crawler (fallback discovery)

const day = (s) => new Date(s * 1000).toISOString().slice(0, 10);

async function enqueue(env, names, reason) {
  const t = now();
  const stmts = [];
  for (const full of names) {
    const r = parseRepo(full);
    if (r) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO queue (key, full, reason, added_at) VALUES (?, ?, ?, ?)").bind(r.key, `${r.owner}/${r.repo}`, reason, t));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return stmts.length;
}

// Collect every repo in a query, splitting the created-date window when a slice exceeds
// GitHub search's 1,000-result cap. Budget-limited; returns {names, done}.
async function sliceSearch(topic, from, to, budget, token) {
  const names = [];
  const stack = [[from, to]];
  while (stack.length && budget.calls > 0) {
    const [a, b] = stack.pop();
    const q = `topic:${topic} fork:true created:${day(a)}..${day(b)}`;
    budget.calls--;
    const first = await searchTopic(q, 1, token);
    if (first.rateLimited) return { names, done: false, rateLimited: true };
    if (first.error) return { names, done: false, error: first.error };
    if (first.total > 1000 && b - a > 86400) {
      const mid = a + Math.floor((b - a) / 2 / 86400) * 86400;
      stack.push([mid + 86400, b], [a, mid]);
      continue;
    }
    names.push(...first.items.filter((i) => !i.archived && !i.private).map((i) => i.full_name));
    for (let page = 2; page <= Math.min(10, Math.ceil(first.total / 100)) && budget.calls > 0; page++) {
      budget.calls--;
      const r = await searchTopic(q, page, token);
      if (r.rateLimited || r.error) return { names, done: false, rateLimited: r.rateLimited };
      names.push(...r.items.filter((i) => !i.archived && !i.private).map((i) => i.full_name));
    }
  }
  return { names, done: stack.length === 0 };
}

async function crawl(env) {
  const token = env.GITHUB_TOKEN || null;
  const budget = { calls: token ? 25 : 8 };
  const t = now();
  const state = Object.fromEntries((await env.DB.prepare("SELECT name, value FROM crawl_state").all()).results.map((x) => [x.name, x.value]));
  const set = (k, v) => env.DB.prepare("INSERT OR REPLACE INTO crawl_state (name, value) VALUES (?, ?)").bind(k, String(v));
  const writes = [];
  let found = 0;
  // 1) Recently pushed repos carrying a topic (fast path for updates).
  for (const topic of TOPICS) {
    const since = Number(state[`pushed:${topic}`] || SWEEP_START);
    const q = `topic:${topic} fork:true pushed:>=${new Date((since - 3600) * 1000).toISOString().slice(0, 19)}Z`;
    if (budget.calls <= 0) break;
    budget.calls--;
    const r = await searchTopic(q, 1, token);
    if (r.rateLimited || r.error) break;
    found += await enqueue(env, r.items.filter((i) => !i.archived && !i.private).map((i) => i.full_name), "crawl:pushed");
    if (r.total <= 100) writes.push(set(`pushed:${topic}`, t));
  }
  // 2) Full sweep in created-date slices (catches repos tagged without a new push). Restarts when complete.
  for (const topic of TOPICS) {
    if (budget.calls <= 0) break;
    const cursor = Number(state[`sweep:${topic}`] || SWEEP_START);
    const end = Math.min(cursor + 30 * 86400, t);
    const res = await sliceSearch(topic, cursor, end, budget, token);
    found += await enqueue(env, res.names, "crawl:sweep");
    if (res.done) writes.push(set(`sweep:${topic}`, end >= t ? SWEEP_START : end + 86400));
  }
  // 3) Stale listings get re-verified so deleted or broken repos drop out.
  const stale = await env.DB.prepare("SELECT owner, repo FROM apps WHERE listed = 1 AND checked_at < ? ORDER BY checked_at LIMIT 50").bind(t - RECHECK_AFTER).all();
  found += await enqueue(env, stale.results.map((x) => `${x.owner}/${x.repo}`), "recheck");
  writes.push(set("last_crawl", t), set("last_crawl_found", found));
  if (writes.length) await env.DB.batch(writes);
  // 4) Work the queue.
  const batch = await env.DB.prepare("SELECT key, full, reason FROM queue ORDER BY added_at LIMIT ?").bind(QUEUE_BATCH).all();
  let listed = 0;
  for (const item of batch.results) {
    const full = item.full;
    const r = parseRepo(full);
    await env.DB.prepare("DELETE FROM queue WHERE key = ?").bind(item.key).run();
    if (!r) continue;
    const known = await env.DB.prepare("SELECT checked_at FROM checks WHERE key = ?").bind(r.key).first();
    if (item.reason !== "recheck" && known && t - known.checked_at < 3600) continue; // checked recently
    try {
      const rep = await indexRepo(env, r, { via: "crawl" });
      if (rep.listed) listed++;
    } catch (e) {
      console.log("index failed", full, String(e));
    }
  }
  return { found, processed: batch.results.length, listed };
}

const HOME = `Wizard App Index — find Wizard apps. The app repos are the source of truth; this index can be rebuilt from them.

GET  /v1/search?q=video&category=&tag=&slot=&type=&publisher=&arch=amd64&id=&sort=popular|new|name&limit=20&offset=0
GET  /v1/tags                        purpose tags in use: {tags:[{id,count}]}
POST /v1/installs {"id":"app-id","repo":"owner/name"}   anonymous install count (+1 per app, client, UTC day)
GET  /v1/apps/{owner}/{repo}        full record + last check result (also shows why a repo is not listed)
POST /v1/publish {"repo":"owner/name"}   check the repo now and list it if its wizard.md passes
     (also accepts a GitHub webhook: Payload URL https://apps.aiwizards.com/v1/publish, content type JSON, push events)
GET  /v1/stats

Publish: add wizard.md (spec: humanitylabs-org/wizard-os spec/WIZARD_MD.md) at the repo root, make the repo public,
tag it with the topic wizard-app, then POST /v1/publish or wait for the crawler. Installs pin to the checked commit.
`;

// One-line Wizard OS install: aiwizards.com/os.sh serves get.sh from the public wizard-app-manager repo (one source).
const OS_SH_SRC = "https://raw.githubusercontent.com/humanitylabs-org/wizard-app-manager/main/get.sh";
// Agent instructions for the same install (unlisted link, no homepage button: "Set me up with Wizard OS by following the instructions at https://aiwizards.com/os.md"), same one source.
const OS_MD_SRC = "https://raw.githubusercontent.com/humanitylabs-org/wizard-app-manager/main/os.md";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    // No CORS for the approval relay: only its own page (same origin) and the box (no browser) may call it.
    if (request.method === "OPTIONS" && path.startsWith("/os-approve")) return new Response(null, { status: 405 });
    if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" } });
    try {
      if (path === "/os-approve" || path.startsWith("/os-approve/")) {
        return await handleApprove(request, env, path);
      }
      if ((path === "/wizard-apps" || path === "/store") && (request.method === "GET" || request.method === "HEAD")) {
        const { results } = await env.DB.prepare(`SELECT a.*, ${WITH_INSTALLS} FROM apps a WHERE a.listed = 1 ORDER BY a.name COLLATE NOCASE`).all();
        return new Response(storePage(results.map((r) => ({ ...row2app(r), first_seen: r.first_seen }))), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60",
            "content-security-policy": "default-src 'none'; img-src 'self' https://raw.githubusercontent.com; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
        });
      }
      if (path === "/os.sh" && (request.method === "GET" || request.method === "HEAD")) {
        const r = await fetch(OS_SH_SRC, { cf: { cacheTtl: 300, cacheEverything: true } });
        if (!r.ok) return new Response("echo 'Wizard OS installer is unavailable right now; try again in a minute' >&2; exit 1\n", { status: 502, headers: { "content-type": "text/x-shellscript; charset=utf-8" } });
        return new Response(await r.text(), { headers: { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "public, max-age=300" } });
      }
      if (path === "/os.md" && (request.method === "GET" || request.method === "HEAD")) {
        const r = await fetch(OS_MD_SRC, { cf: { cacheTtl: 300, cacheEverything: true } });
        if (!r.ok) return new Response("Wizard OS install instructions are unavailable right now; try again in a minute.\n", { status: 502, headers: { "content-type": "text/markdown; charset=utf-8" } });
        return new Response(await r.text(), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } });
      }
      if (path === "/" && request.method === "GET") return new Response(HOME, { headers: { "content-type": "text/plain; charset=utf-8" } });
      if (path === "/v1/search" && request.method === "GET") return await search(env, url);
      if (path === "/v1/stats" && request.method === "GET") return await stats(env);
      if (path === "/v1/tags" && request.method === "GET") return await tags(env);
      if (path === "/v1/installs" && request.method === "POST") return await recordInstall(env, request);
      if (path === "/v1/publish" && request.method === "POST") return await publish(env, request);
      const m = /^\/v1\/apps\/([^/]+)\/([^/]+)$/.exec(path);
      if (m && request.method === "GET") return await getApp(env, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      return json({ error: "not found" }, 404);
    } catch (e) {
      console.log("error", String(e?.stack || e));
      return json({ error: "internal error" }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(crawl(env).then((r) => console.log("crawl", JSON.stringify(r))));
    ctx.waitUntil(pruneInstallSeen(env));
    ctx.waitUntil(pruneApprovals(env));
  },
};
