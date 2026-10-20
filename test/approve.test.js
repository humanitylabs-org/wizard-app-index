// Install approval relay: create -> open -> submit -> poll once -> result, plus every refusal.
// D1 is a real SQLite (node:sqlite) loaded with the real migration; crypto is WebCrypto in, stock openssl out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash } from "node:crypto";
import worker from "../src/index.js";
import { APPROVE_TTL, LABEL_PREFIX, LIMITS, PAGE_CSP, pruneApprovals } from "../src/approve.js";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0004_os_approvals.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { prepare: (sql) => stmt(sql), raw: db };
}

const dir = mkdtempSync(join(tmpdir(), "approve-"));
const keyPath = join(dir, "box.key");
execFileSync("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:3072", "-out", keyPath]);
const PUB = execFileSync("openssl", ["pkey", "-in", keyPath, "-pubout", "-outform", "DER"]).toString("base64");

const b64u = (b) => b.toString("base64url");
const sha = (s) => createHash("sha256").update(s).digest("hex");
let ipSeq = 0;
function call(env, path, body, { method = "POST", ip, origin, ctype = "application/json" } = {}) {
  const headers = { "cf-connecting-ip": ip || `198.51.100.${ipSeq++ % 250}` };
  if (ctype) headers["content-type"] = ctype;
  if (origin) headers.origin = origin;
  return worker.fetch(new Request(`https://www.aiwizards.com${path}`,
    { method, headers, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }), env);
}
async function newReq(env, extra = {}) {
  const cap = b64u(randomBytes(32)), pickup = b64u(randomBytes(32));
  const id = sha(cap);
  const r = await call(env, "/os-approve/api/create", { id, pickup_hash: sha(pickup), pubkey: PUB, host: "demo", user: "dana",
    needs: ["docker_group", "tailscale_operator"], attempt: 1, ...extra });
  return { cap, pickup, id, r };
}
async function encrypt(id, text) {
  const key = await crypto.subtle.importKey("spki", Buffer.from(PUB, "base64"), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "RSA-OAEP", label: new TextEncoder().encode(LABEL_PREFIX + id) }, key, new TextEncoder().encode(text));
  return Buffer.from(ct).toString("base64");
}
function opensslDecrypt(id, ctB64) {  // exactly what the box runs
  const f = join(dir, `ct-${id.slice(0, 8)}`);
  writeFileSync(f, Buffer.from(ctB64, "base64"));
  return execFileSync("openssl", ["pkeyutl", "-decrypt", "-inkey", keyPath, "-in", f, "-pkeyopt", "rsa_padding_mode:oaep",
    "-pkeyopt", "rsa_oaep_md:sha256", "-pkeyopt", "rsa_mgf1_md:sha256",
    "-pkeyopt", `rsa_oaep_label:${Buffer.from(LABEL_PREFIX + id).toString("hex")}`]).toString();
}

test("happy path: browser ciphertext decrypts with openssl on the box, handed over exactly once", async () => {
  const env = { DB: fakeD1() };
  const { cap, pickup, id, r } = await newReq(env);
  assert.equal(r.status, 201);
  const made = await r.json();
  assert.equal(made.ttl, APPROVE_TTL);
  let o = await (await call(env, "/os-approve/api/open", { cap })).json();
  assert.equal(o.state, "pending"); assert.equal(o.user, "dana"); assert.equal(o.pubkey, PUB);
  assert.deepEqual(o.needs, ["docker_group", "tailscale_operator"]);
  assert.equal((await (await call(env, "/os-approve/api/poll", { id, pickup })).json()).state, "pending");
  const secret = "correct horse battery";  // a fixture, not a real password
  const ct = await encrypt(id, secret);
  assert.equal((await call(env, "/os-approve/api/submit", { cap, ct })).status, 200);
  assert.equal((await call(env, "/os-approve/api/submit", { cap, ct })).status, 409, "single use");
  const p = await (await call(env, "/os-approve/api/poll", { id, pickup })).json();
  assert.equal(p.state, "submitted");
  assert.equal(opensslDecrypt(id, p.ct), secret);
  const row = env.DB.raw.prepare("SELECT ct, state FROM os_approvals WHERE id = ?").get(id);
  assert.equal(row.ct, null, "ciphertext deleted on fetch"); assert.equal(row.state, "picked_up");
  const again = await (await call(env, "/os-approve/api/poll", { id, pickup })).json();
  assert.equal(again.state, "picked_up"); assert.equal(again.ct, undefined, "never handed out twice");
  o = await (await call(env, "/os-approve/api/open", { cap })).json();
  assert.equal(o.pubkey, null);
  assert.equal((await call(env, "/os-approve/api/result", { id, pickup, outcome: "wrong_password" })).status, 200);
  assert.equal((await (await call(env, "/os-approve/api/open", { cap })).json()).state, "wrong_password");
  assert.equal((await call(env, "/os-approve/api/result", { id, pickup, outcome: "approved" })).status, 409, "outcome is final");
});

test("ciphertext is bound to its request id (label): it does not decrypt as another request", async () => {
  const env = { DB: fakeD1() };
  const a = await newReq(env), b = await newReq(env);
  const ct = await encrypt(a.id, "x-fixture");
  assert.throws(() => opensslDecrypt(b.id, ct));
});

test("wrong pickup secret, unknown capability, malformed input are refused without detail", async () => {
  const env = { DB: fakeD1() };
  const { cap, id } = await newReq(env);
  assert.equal((await call(env, "/os-approve/api/poll", { id, pickup: b64u(randomBytes(32)) })).status, 404);
  assert.equal((await call(env, "/os-approve/api/open", { cap: b64u(randomBytes(32)) })).status, 404);
  assert.equal((await call(env, "/os-approve/api/open", { cap: "short" })).status, 404);
  assert.equal((await call(env, "/os-approve/api/submit", { cap, ct: "!!" })).status, 400);
  assert.equal((await call(env, "/os-approve/api/submit", { cap, ct: Buffer.alloc(100).toString("base64") })).status, 400);
  assert.equal((await call(env, "/os-approve/api/open", "{not json")).status, 404);
  assert.equal((await call(env, "/os-approve/api/open", { cap }, { ctype: "text/plain" })).status, 415);
  assert.equal((await call(env, "/os-approve/api/open", { cap }, { method: "GET", ctype: null })).status, 405);
  assert.equal((await call(env, "/os-approve/api/open", "x".repeat(9000))).status, 404);
});

test("create validates key size, names, needs; duplicate ids conflict", async () => {
  const env = { DB: fakeD1() };
  const sk = join(dir, "small.key");
  execFileSync("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:1024", "-out", sk]);
  const small = execFileSync("openssl", ["pkey", "-in", sk, "-pubout", "-outform", "DER"]).toString("base64");
  assert.equal((await newReq(env, { pubkey: small })).r.status, 400);
  assert.equal((await newReq(env, { pubkey: "AAAA" })).r.status, 400);
  assert.equal((await newReq(env, { user: "dana; rm -rf /" })).r.status, 400);
  assert.equal((await newReq(env, { host: "<b>" })).r.status, 400);
  assert.equal((await newReq(env, { needs: ["everything"] })).r.status, 400);
  const ok = await newReq(env);
  assert.equal(ok.r.status, 201);
  const dup = await call(env, "/os-approve/api/create", { id: ok.id, pickup_hash: sha("x"), pubkey: PUB, host: "h", user: "u", needs: [] });
  assert.equal(dup.status, 409);
});

test("expired: page says expired, submit is 410, box sees expired; prune deletes it", async () => {
  const env = { DB: fakeD1() };
  const { cap, pickup, id } = await newReq(env);
  env.DB.raw.prepare("UPDATE os_approvals SET expires_at = ?").run(Math.floor(Date.now() / 1000) - 7200);
  assert.equal((await (await call(env, "/os-approve/api/open", { cap })).json()).state, "expired");
  assert.equal((await call(env, "/os-approve/api/submit", { cap, ct: await encrypt(id, "x") })).status, 410);
  assert.equal((await (await call(env, "/os-approve/api/poll", { id, pickup })).json()).state, "expired");
  await pruneApprovals(env);
  assert.equal(env.DB.raw.prepare("SELECT count(*) n FROM os_approvals").get().n, 0);
});

test("cancel removes the request; the link stops working", async () => {
  const env = { DB: fakeD1() };
  const { cap, pickup, id } = await newReq(env);
  assert.equal((await call(env, "/os-approve/api/cancel", { id, pickup })).status, 200);
  assert.equal((await call(env, "/os-approve/api/open", { cap })).status, 404);
});

test("rate limits per client: submit brute force is capped", async () => {
  const env = { DB: fakeD1() };
  const { cap } = await newReq(env);
  const codes = [];
  for (let i = 0; i < LIMITS.submit[0] + 2; i++) codes.push((await call(env, "/os-approve/api/submit", { cap, ct: "!!" }, { ip: "203.0.113.9" })).status);
  assert.equal(codes.at(-1), 429);
  const keys = env.DB.raw.prepare("SELECT key FROM os_approval_rate").all().map((r) => r.key).join(" ");
  assert.ok(!keys.includes("203.0.113.9"), "raw IPs never stored");
});

test("cross-site browser calls are refused; page ships a strict CSP and no-store", async () => {
  const env = { DB: fakeD1() };
  const { cap } = await newReq(env);
  assert.equal((await call(env, "/os-approve/api/open", { cap }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await call(env, "/os-approve/api/open", { cap }, { origin: "https://www.aiwizards.com" })).status, 200);
  const pre = await call(env, "/os-approve/api/open", null, { method: "OPTIONS", ctype: null });
  assert.equal(pre.status, 405); assert.equal(pre.headers.get("access-control-allow-origin"), null);
  const page = await call(env, "/os-approve", null, { method: "GET", ctype: null });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-security-policy"), PAGE_CSP);
  assert.match(PAGE_CSP, /script-src 'self'/); assert.doesNotMatch(PAGE_CSP, /unsafe/);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  const html = await page.text();
  assert.match(html, /never saved/); assert.doesNotMatch(html, /<script>/);
  const js = await (await call(env, "/os-approve/app.js", null, { method: "GET", ctype: null })).text();
  assert.match(js, /history\.replaceState/); assert.match(js, /RSA-OAEP/);
  assert.ok(js.includes(LABEL_PREFIX), "page and box use the same OAEP label");
});
