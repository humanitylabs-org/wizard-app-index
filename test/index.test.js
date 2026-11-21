import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildSearch, installHash, tagsOf, indexRepo, siblingRecheckStmt, delistMovedSiblings, sweepMoved, movedTo, MOVED_SWEEP } from "../src/index.js";
import { currentName, parseRepo } from "../src/github.js";

const P = (s) => new URLSearchParams(s);

test("install dedupe hash is sha256(day|ip|key), never the raw ip", async () => {
  const h = await installHash("2026-10-10", "203.0.113.7", "github:o/r");
  assert.equal(h, createHash("sha256").update("2026-10-10|203.0.113.7|github:o/r").digest("hex"));
  assert.ok(!h.includes("203.0.113.7"));
  assert.notEqual(h, await installHash("2026-10-11", "203.0.113.7", "github:o/r"));
  assert.notEqual(h, await installHash("2026-10-10", "203.0.113.7", "github:o/other"));
});

test("search: default name order, installs selected", () => {
  const s = buildSearch(P(""));
  assert.match(s.sql, /AS installs/);
  assert.match(s.sql, /ORDER BY a\.name COLLATE NOCASE LIMIT/);
  assert.deepEqual(s.binds, [21, 0]);
});

test("search: tag filter ANDs with others", () => {
  const s = buildSearch(P("tag=video&category=app&limit=5&offset=10"));
  assert.match(s.sql, /a\.key IN \(SELECT key FROM app_tags WHERE tag = \?\) AND a\.category = \?/);
  assert.deepEqual(s.binds, ["video", "app", 6, 10]);
});

test("search: q keeps bm25 unless sort is given; sort values", () => {
  assert.match(buildSearch(P("q=video")).sql, /ORDER BY bm25\(/);
  assert.match(buildSearch(P("q=video&sort=popular")).sql, /ORDER BY installs DESC, a\.name/);
  assert.match(buildSearch(P("sort=new")).sql, /ORDER BY a\.first_seen DESC/);
  assert.match(buildSearch(P("sort=name&q=x")).sql, /ORDER BY a\.name COLLATE NOCASE LIMIT/);
  assert.match(buildSearch(P("sort=bogus")).sql, /ORDER BY a\.name COLLATE NOCASE LIMIT/);
  assert.match(buildSearch(P("sort=__proto__")).sql, /ORDER BY a\.name COLLATE NOCASE LIMIT/);
});

test("tagsOf keeps only known tags, deduped; missing = []", () => {
  assert.deepEqual(tagsOf({}), []);
  assert.deepEqual(tagsOf({ tags: ["audio", "audio", "nope"] }), ["audio"]);
});

test("currentName follows GitHub's rename redirect, nothing else", async () => {
  const real = globalThis.fetch;
  const answer = { "https://github.com/o/old": [301, "https://github.com/o/new"], "https://github.com/o/new": [200, null],
                   "https://github.com/o/case": [301, "https://github.com/O/Case"], "https://github.com/o/gone": [404, null],
                   "https://github.com/o/away": [301, "https://example.com/x/y"] };
  globalThis.fetch = async (url, opts) => {
    assert.equal(opts.redirect, "manual");
    const [status, loc] = answer[url];
    return { status, headers: { get: (h) => (h === "location" ? loc : null) } };
  };
  try {
    assert.deepEqual((await currentName(parseRepo("o/old")))?.key, "github:o/new");
    assert.equal(await currentName(parseRepo("o/new")), null);
    assert.equal(await currentName(parseRepo("o/case")), null);   // same repo, other letter case
    assert.equal(await currentName(parseRepo("o/gone")), null);
    assert.equal(await currentName(parseRepo("o/away")), null);
  } finally {
    globalThis.fetch = real;
  }
});

test("indexRepo: a renamed repo delists its old name and indexes the current one", async () => {
  const real = globalThis.fetch;
  const ran = [];
  const env = { DB: { prepare: (sql) => ({ bind: (...b) => ({ sql, b }) }), batch: async (s) => { ran.push(...s); return []; } } };
  globalThis.fetch = async (url) => {
    if (url === "https://github.com/o/old") return { status: 301, headers: { get: () => "https://github.com/o/new" } };
    if (url === "https://github.com/o/new") return { status: 200, headers: { get: () => null } };
    return { ok: false, status: 404, headers: { get: () => null }, text: async () => "" };   // git refs: repo gone
  };
  try {
    const rep = await indexRepo(env, parseRepo("o/old"), { via: "publish" });
    assert.equal(rep.renamed_from_repo, "o/old");
    assert.equal(rep.repo, "o/new");
    const delisted = ran.filter((s) => /UPDATE apps SET listed = 0/.test(s.sql)).map((s) => s.b[1]);
    assert.deepEqual(delisted, ["github:o/old", "github:o/new"]);   // old name always; new only because its git 404s here
    assert.ok(ran.some((s) => /INTO checks/.test(s.sql) && s.b[0] === "github:o/old" && s.b[1].includes("renamed to o/new")));
  } finally {
    globalThis.fetch = real;
  }
});

test("siblingRecheckStmt queues the other listed repos of the same app id, once an hour at most (#829)", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_init.sql", "0002_category.sql", "0003_tags_installs.sql", "0004_os_approvals.sql"]) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const env = { DB: { prepare: (sql) => ({ bind: (...b) => ({ run: () => db.prepare(sql).run(...b) }) }) } };
  const add = (owner, repo, id, checked, listed = 1) =>
    db.prepare("INSERT INTO apps (key, host, owner, repo, repo_url, commit_sha, app_id, name, summary, type, version, manifest, found_via, first_seen, checked_at, listed) VALUES (?, 'github', ?, ?, ?, 'x', ?, ?, 's', 'app', '1', '{}', 'crawl', 0, ?, ?)")
      .run(`github:${owner}/${repo}`.toLowerCase(), owner, repo, `https://github.com/${owner}/${repo}`, id, id, checked, listed);
  const t = 2_000_000;
  add("humanitylabs-org", "photos", "photos", t);
  add("oscarhenrycollins", "photos", "photos", t - 3 * 86400);   // moved; its listing is days old
  add("someone", "photos", "photos", t - 60);                   // a second publisher checked a minute ago
  add("old", "photos", "photos", t - 9 * 86400, 0);             // already delisted
  add("oscarhenrycollins", "mail", "mail", t - 9 * 86400);       // another app
  siblingRecheckStmt(env, "github:humanitylabs-org/photos", "photos", t).run();
  const q = db.prepare("SELECT key, full, reason, added_at FROM queue ORDER BY key").all().map((r) => ({ ...r }));
  assert.deepEqual(q, [{ key: "github:oscarhenrycollins/photos", full: "oscarhenrycollins/photos", reason: "recheck", added_at: t }]);
});

// A D1-like env over node:sqlite with the real migrations (#32).
async function sqliteEnv() {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync, readdirSync } = await import("node:fs");
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const stmt = (sql, b = []) => ({ bind: (...x) => stmt(sql, x), run: () => db.prepare(sql).run(...b), first: () => db.prepare(sql).get(...b) ?? null, all: () => ({ results: db.prepare(sql).all(...b) }) });
  const env = { DB: { prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => s.run()) } };
  const add = (owner, repo, id, checked, listed = 1) => {
    const key = `github:${owner}/${repo}`.toLowerCase();
    db.prepare("INSERT INTO apps (key, host, owner, repo, repo_url, commit_sha, app_id, name, summary, type, version, manifest, found_via, first_seen, checked_at, listed) VALUES (?, 'github', ?, ?, ?, 'x', ?, ?, 's', 'app', '1', '{}', 'crawl', 0, ?, ?)")
      .run(key, owner, repo, `https://github.com/${owner}/${repo}`, id, id, checked, listed);
    db.prepare("INSERT INTO apps_fts (key, name, summary, body, provides, owner) VALUES (?, ?, 's', '', '', ?)").run(key, id, owner);
  };
  return { db, env, add };
}
const redirects = (map) => async (url, opts) => {
  assert.equal(opts?.method, "HEAD");
  const loc = map[url];
  return { status: loc ? 301 : 200, headers: { get: (h) => (h === "location" ? loc ?? null : null) } };
};

test("delistMovedSiblings: a listed repo whose GitHub name redirects to the checked one is delisted at once (#32)", async () => {
  const { db, env, add } = await sqliteEnv();
  const t = 2_000_000;
  add("humanitylabs-org", "photos", "photos", t);
  add("oscarhenrycollins", "photos", "photos", t - 60);           // moved, checked only a minute ago: no waiting
  add("someone", "photos", "photos", t - 9 * 86400);             // a real second publisher: no redirect
  add("elsewhere", "photos", "photos", t - 9 * 86400);           // redirects, but to another repo: its own recheck handles it
  add("oscarhenrycollins", "mail", "mail", t - 9 * 86400);        // another app
  const real = globalThis.fetch;
  globalThis.fetch = redirects({ "https://github.com/oscarhenrycollins/photos": "https://github.com/humanitylabs-org/photos",
    "https://github.com/elsewhere/photos": "https://github.com/x/photos", "https://github.com/oscarhenrycollins/mail": "https://github.com/humanitylabs-org/photos" });
  try {
    const moved = await delistMovedSiblings(env, parseRepo("humanitylabs-org/photos"), "photos", t);
    assert.deepEqual(moved, ["oscarhenrycollins/photos"]);
  } finally {
    globalThis.fetch = real;
  }
  const listed = db.prepare("SELECT key FROM apps WHERE listed = 1 ORDER BY key").all().map((r) => r.key);
  assert.deepEqual(listed, ["github:elsewhere/photos", "github:humanitylabs-org/photos", "github:oscarhenrycollins/mail", "github:someone/photos"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM apps_fts WHERE key = 'github:oscarhenrycollins/photos'").get().n, 0);
  const chk = db.prepare("SELECT ok, failures FROM checks WHERE key = 'github:oscarhenrycollins/photos'").get();
  assert.equal(chk.ok, 0);
  assert.equal(movedTo(JSON.parse(chk.failures)), "humanitylabs-org/photos");
});

test("sweepMoved: one pass over all listings delists redirecting keys, queues the new name, then stays done (#32)", async () => {
  const { db, env, add } = await sqliteEnv();
  const t = 2_000_000;
  for (let i = 0; i < 12; i++) add("o", `app${String(i).padStart(2, "0")}`, `app${i}`, t);
  add("oscarhenrycollins", "sovereignty", "sovereignty", t);
  add("zz", "gone", "gone", t, 0);   // already delisted: not probed
  const real = globalThis.fetch;
  const probed = [];
  const inner = redirects({ "https://github.com/oscarhenrycollins/sovereignty": "https://github.com/humanitylabs-org/sovereignty" });
  globalThis.fetch = async (url, opts) => { probed.push(url); return inner(url, opts); };
  try {
    let r = await sweepMoved(env, undefined, t);
    assert.equal(r.cursor, "github:o/app09");
    assert.deepEqual(r.moved, []);
    r = await sweepMoved(env, r.cursor, t);
    assert.equal(r.cursor, "done");
    assert.deepEqual(r.moved, ["oscarhenrycollins/sovereignty"]);
    assert.equal(probed.length, 13);
    assert.deepEqual(await sweepMoved(env, "done", t), { cursor: "done", moved: [] });
    assert.equal(probed.length, 13);
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(db.prepare("SELECT value FROM crawl_state WHERE name = ?").get(MOVED_SWEEP).value, "done");
  assert.equal(db.prepare("SELECT listed FROM apps WHERE key = 'github:oscarhenrycollins/sovereignty'").get().listed, 0);
  assert.deepEqual({ ...db.prepare("SELECT key, full, reason FROM queue").get() }, { key: "github:humanitylabs-org/sovereignty", full: "humanitylabs-org/sovereignty", reason: "recheck" });
});

test("movedTo reads where a renamed listing went; other failures say nothing", () => {
  assert.equal(movedTo(["renamed to humanitylabs-org/photos"]), "humanitylabs-org/photos");
  assert.equal(movedTo(["repo not found or not public"]), null);
  assert.equal(movedTo(null), null);
});
