import { test } from "node:test";
import assert from "node:assert/strict";
import { checkImages, composeImages, parseImage, resolveVars } from "../src/images.js";
import { keepListing, pendingRetry } from "../src/index.js";

const H = (o = {}) => ({ get: (k) => o[k.toLowerCase()] ?? null });
const res = (status, body = {}, headers = {}) => ({ status, ok: status < 300, headers: H(headers), json: async () => body });
const compose = (...images) => "services:\n" + images.map((img, i) => `  s${i}:\n    image: ${img}\n`).join("");

// A tiny fake registry: ghcr-style bearer challenge, then manifests by repo:ref.
function registry(manifests, { tokenStatus = 200 } = {}) {
  const calls = [];
  const fetcher = async (url, opts = {}) => {
    calls.push([opts.method || "GET", url]);
    if (url.startsWith("https://auth.example/token")) return tokenStatus === 200 ? res(200, { token: "t" }) : res(tokenStatus);
    const m = /^https:\/\/([^/]+)\/v2\/(.+)\/(manifests|blobs)\/(.+)$/.exec(url);
    if (!opts.headers?.Authorization) return res(401, {}, { "www-authenticate": 'Bearer realm="https://auth.example/token",service="r",scope="repository:x:pull"' });
    const hit = manifests[`${m[1]}/${m[2]}:${m[4]}`];
    if (hit === undefined) return res(404);
    if (typeof hit === "number") return res(hit);
    return res(200, hit.body, { "content-type": hit.type });
  };
  return { fetcher, calls };
}
const INDEX = "application/vnd.oci.image.index.v1+json";
const multi = (...archs) => ({ type: INDEX, body: { manifests: archs.map((a) => ({ platform: { os: "linux", architecture: a } })) } });

test("parseImage normalises docker references", () => {
  assert.deepEqual(parseImage("nginx"), { registry: "docker.io", host: "registry-1.docker.io", repository: "library/nginx", reference: "latest" });
  assert.equal(parseImage("ghcr.io/o/a:1.2").repository, "o/a");
  assert.equal(parseImage("ghcr.io/o/a:1.2").reference, "1.2");
  assert.equal(parseImage("localhost:5000/a:b").registry, "localhost:5000");
  const pinned = parseImage("python:3.12-alpine@sha256:" + "a".repeat(64));
  assert.equal(pinned.repository, "library/python");
  assert.equal(pinned.reference, "sha256:" + "a".repeat(64));
  assert.equal(parseImage("Bad/UPPER"), null);
});

test("variables: defaults resolve, bare variables cannot", () => {
  assert.deepEqual(resolveVars("ghcr.io/o/a:${TAG:-1}"), { value: "ghcr.io/o/a:1", unresolved: false });
  assert.equal(resolveVars("ghcr.io/${OWNER}/a").unresolved, true);
});

test("composeImages skips build services and flags pull_policy never", () => {
  const imgs = composeImages("services:\n  a:\n    image: x:1\n    build: .\n  b:\n    image: y:1\n    pull_policy: never\n  c:\n    image: z:1\n");
  assert.deepEqual(imgs.map((i) => [i.service, i.never]), [["b", true], ["c", false]]);
});

test("published multi-arch image passes; missing tag and missing arch fail", async () => {
  const { fetcher } = registry({ "ghcr.io/o/a:1": multi("amd64", "arm64"), "ghcr.io/o/b:1": multi("amd64") });
  assert.equal((await checkImages(compose("ghcr.io/o/a:1"), ["amd64", "arm64"], { fetcher })).ok, true);
  const gone = await checkImages(compose("ghcr.io/o/a:2"), [], { fetcher });
  assert.match(gone.missing[0], /not published or not public/);
  const arm = await checkImages(compose("ghcr.io/o/b:1"), ["amd64", "arm64"], { fetcher });
  assert.match(arm.missing[0], /no arm64 build/);
});

test("anonymous token refused (package private or never pushed) counts as missing", async () => {
  const { fetcher } = registry({}, { tokenStatus: 403 });
  const r = await checkImages(compose("ghcr.io/o/private:1"), [], { fetcher });
  assert.equal(r.ok, false);
  assert.equal(r.transient.length, 0);
  assert.match(r.missing[0], /not public/);
});

test("registry outage is transient, never missing", async () => {
  const { fetcher } = registry({ "ghcr.io/o/a:1": 503 });
  const r = await checkImages(compose("ghcr.io/o/a:1"), [], { fetcher });
  assert.deepEqual([r.missing.length, r.transient.length], [0, 1]);
  const down = await checkImages(compose("ghcr.io/o/a:1"), [], { fetcher: async () => { throw new TypeError("network"); } });
  assert.deepEqual([down.missing.length, down.transient.length], [0, 1]);
});

test("Docker Hub is checked with HEAD only (no pull-limit cost)", async () => {
  const { fetcher, calls } = registry({ "registry-1.docker.io/library/nginx:1": multi("amd64") });
  assert.equal((await checkImages(compose("nginx:1"), ["arm64"], { fetcher })).ok, true);
  assert.ok(calls.filter(([, u]) => u.includes("/manifests/")).every(([m]) => m === "HEAD"));
});

test("keepListing: a pending new commit never replaces or delists the installable one", () => {
  const prev = { listed: 1, commit_sha: "old" };
  assert.equal(keepListing(prev, "new", { missing: ["x"], transient: [] }), true);
  assert.equal(keepListing(prev, "old", { missing: [], transient: ["503"] }), true);
  assert.equal(keepListing(prev, "old", { missing: ["gone"], transient: [] }), false);   // its own image vanished
  assert.equal(keepListing(null, "new", { missing: ["x"], transient: [] }), false);    // never listed: stay unlisted
});

test("pendingRetry backs off from 10 min to 6 h and stops after 7 days", () => {
  const t = 1_000_000;
  assert.deepEqual(pendingRetry(undefined, t), { reason: `image-pending:${t}`, at: t + 600 });
  assert.equal(pendingRetry(t - 2 * 86400, t).at, t + 6 * 3600);
  assert.equal(pendingRetry(t - 8 * 86400, t), null);
});
