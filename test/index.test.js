import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildSearch, installHash, tagsOf } from "../src/index.js";

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
