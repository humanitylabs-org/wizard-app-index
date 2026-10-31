import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildSearch, installHash, tagsOf, indexRepo } from "../src/index.js";
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
