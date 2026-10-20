// One-time Wizard OS install approval relay: www.aiwizards.com/os-approve (not advertised anywhere).
//
// A box whose owner has no passwordless sudo needs administrator rights once. Its installer makes an ephemeral RSA
// key pair, a random capability and a random pickup secret, and registers {sha256(capability), sha256(pickup),
// public key} here. The owner opens https://www.aiwizards.com/os-approve#<capability>; the page encrypts the server
// password in the browser to the box's public key (RSA-OAEP-SHA256, label bound to the request id) and posts only the
// ciphertext. The box polls with its pickup secret, receives the ciphertext ONCE (it is deleted on fetch), decrypts
// it in memory, runs `sudo` once and reports a sanitized outcome (approved / wrong_password / not_sudoer / failed).
//
// The relay cannot decrypt anything. Capabilities are only ever sent in POST bodies (never in a URL or header), so
// they cannot land in request logs; bodies are never logged. Rows expire after 30 minutes and are deleted by the
// cron an hour later. Single use: a request accepts one submission; a retry is a brand new request.
// Threat model: see README.md "Install approval relay".

export const APPROVE_TTL = 30 * 60; // seconds a link stays usable
export const LABEL_PREFIX = "wizard-os-approve/v1:"; // OAEP label = LABEL_PREFIX + id (binds ciphertext to request)
const MAX_BODY = 8192;
const NEEDS = new Set(["packages", "docker", "docker_group", "linger", "runtipi", "tailscale", "tailscale_operator"]);
const OUTCOMES = new Set(["approved", "wrong_password", "not_sudoer", "failed"]);
const HEX64 = /^[0-9a-f]{64}$/;
const CAP = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url without padding
const NAME = /^[A-Za-z0-9._-]{1,64}$/;
// Fixed windows: [max requests, window seconds] per client IP and scope. Raw IPs are never stored.
export const LIMITS = { create: [20, 3600], open: [120, 600], submit: [10, 600], box: [3000, 3600] };

const nowS = () => Math.floor(Date.now() / 1000);
const SEC = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "strict-transport-security": "max-age=31536000",
  "x-frame-options": "DENY",
};
const out = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...SEC } });

export async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function limited(env, request, scope) {
  const [max, win] = LIMITS[scope];
  const w = Math.floor(nowS() / win);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const key = await sha256hex(`${scope}|${w}|${ip}`);
  const row = await env.DB.prepare(
    "INSERT INTO os_approval_rate (key, win, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count",
  ).bind(key, w * win + win).first();
  return (row?.count ?? 0) > max;
}

async function body(request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function b64bytes(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// An RSA-OAEP public key (SPKI DER, base64) of 3072 or 4096 bits; anything else is refused.
export async function validPubkey(b64) {
  if (typeof b64 !== "string" || b64.length > 1200) return false;
  const der = b64bytes(b64);
  if (!der) return false;
  try {
    const k = await crypto.subtle.importKey("spki", der, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"]);
    return [3072, 4096].includes(k.algorithm.modulusLength);
  } catch {
    return false;
  }
}

const live = (row) => row && row.expires_at > nowS();

async function create(env, request) {
  if (await limited(env, request, "create")) return out({ error: "too many requests" }, 429);
  const b = await body(request);
  if (!b) return out({ error: "bad request" }, 400);
  const needs = Array.isArray(b.needs) ? [...new Set(b.needs)] : [];
  const attempt = Number.isInteger(b.attempt) ? b.attempt : 1;
  if (!HEX64.test(b.id || "") || !HEX64.test(b.pickup_hash || "") || !NAME.test(b.host || "") ||
      !NAME.test(b.user || "") || needs.length > NEEDS.size || !needs.every((n) => NEEDS.has(n)) ||
      attempt < 1 || attempt > 9 || !(await validPubkey(b.pubkey))) {
    return out({ error: "bad request" }, 400);
  }
  const t = nowS();
  const r = await env.DB.prepare(
    "INSERT OR IGNORE INTO os_approvals (id, pickup_hash, pubkey, host, user, needs, attempt, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(b.id, b.pickup_hash, b.pubkey, b.host, b.user, JSON.stringify(needs), attempt, t, t + APPROVE_TTL).run();
  if (!r.meta?.changes) return out({ error: "exists" }, 409);
  return out({ id: b.id, expires_at: t + APPROVE_TTL, ttl: APPROVE_TTL }, 201);
}

async function byCap(env, b) {
  if (!b || !CAP.test(b.cap || "")) return null;
  const id = await sha256hex(b.cap);
  return await env.DB.prepare("SELECT * FROM os_approvals WHERE id = ?").bind(id).first();
}

async function open(env, request) {
  if (await limited(env, request, "open")) return out({ error: "too many requests" }, 429);
  const row = await byCap(env, await body(request));
  if (!row) return out({ error: "not found" }, 404);
  const expired = !live(row) && row.state === "pending";
  return out({
    id: row.id, host: row.host, user: row.user, needs: JSON.parse(row.needs || "[]"), attempt: row.attempt,
    expires_at: row.expires_at, state: expired ? "expired" : row.state, pubkey: row.state === "pending" ? row.pubkey : null,
  });
}

async function submit(env, request) {
  if (await limited(env, request, "submit")) return out({ error: "too many requests" }, 429);
  const b = await body(request);
  const row = await byCap(env, b);
  if (!row) return out({ error: "not found" }, 404);
  if (!live(row)) return out({ error: "expired" }, 410);
  if (row.state !== "pending") return out({ error: "already used" }, 409);
  const ct = b64bytes(b.ct);
  if (!ct || ![384, 512].includes(ct.length)) return out({ error: "bad request" }, 400);
  const r = await env.DB.prepare("UPDATE os_approvals SET ct = ?, state = 'submitted' WHERE id = ? AND state = 'pending'")
    .bind(b.ct, row.id).run();
  if (!r.meta?.changes) return out({ error: "already used" }, 409);
  return out({ state: "submitted" });
}

async function boxRow(env, request) {
  if (await limited(env, request, "box")) return [null, null, out({ error: "too many requests" }, 429)];
  const b = await body(request);
  if (!b || !HEX64.test(b.id || "") || typeof b.pickup !== "string" || b.pickup.length < 32 || b.pickup.length > 128) {
    return [null, null, out({ error: "bad request" }, 400)];
  }
  const row = await env.DB.prepare("SELECT * FROM os_approvals WHERE id = ?").bind(b.id).first();
  if (!row || (await sha256hex(b.pickup)) !== row.pickup_hash) return [null, null, out({ error: "not found" }, 404)];
  return [row, b, null];
}

// The box: pending / expired, or the ciphertext exactly once (deleted from the relay as it is handed over).
async function poll(env, request) {
  const [row, , err] = await boxRow(env, request);
  if (err) return err;
  if (row.state === "submitted") {
    const r = await env.DB.prepare("UPDATE os_approvals SET ct = NULL, state = 'picked_up' WHERE id = ? AND state = 'submitted' RETURNING id")
      .bind(row.id).first();
    if (r) return out({ state: "submitted", ct: row.ct });
    return out({ state: "picked_up" });
  }
  if (row.state === "pending" && !live(row)) return out({ state: "expired" });
  return out({ state: row.state, expires_at: row.expires_at });
}

// The box reports a sanitized outcome so the owner's page can say what happened. Never a password or an error text.
async function result(env, request) {
  const [row, b, err] = await boxRow(env, request);
  if (err) return err;
  if (!OUTCOMES.has(b.outcome)) return out({ error: "bad request" }, 400);
  if (row.state !== "picked_up") return out({ error: "not picked up" }, 409);
  await env.DB.prepare("UPDATE os_approvals SET state = ? WHERE id = ? AND state = 'picked_up'").bind(b.outcome, row.id).run();
  return out({ state: b.outcome });
}

// The box withdraws its request (install finished another way, or a newer link replaced it).
async function cancel(env, request) {
  const [row, , err] = await boxRow(env, request);
  if (err) return err;
  await env.DB.prepare("DELETE FROM os_approvals WHERE id = ?").bind(row.id).run();
  return out({ state: "cancelled" });
}

export const pruneApprovals = (env) => Promise.all([
  env.DB.prepare("DELETE FROM os_approvals WHERE expires_at < ?").bind(nowS() - 3600).run(),
  env.DB.prepare("DELETE FROM os_approval_rate WHERE win < ?").bind(nowS()).run(),
]);

export const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Approve your Wizard OS install</title>
<link rel="stylesheet" href="/os-approve/app.css"></head><body><main>
<h1>Approve your Wizard OS install</h1>
<p id="lead">Checking this link…</p>
<div id="box" hidden>
<p>Your agent is installing Wizard OS on your server <b id="host"></b> for the account <b id="user"></b>. A few one-time
setup steps need administrator rights: <span id="needs"></span>.</p>
<p>Enter the password of <b id="user2"></b> on that server (the one <code>sudo</code> asks for). It is encrypted
right here in your browser to a key only that server holds, used once for this setup, and never saved. Your agent
never sees it and it does not go into your chat.</p>
<label for="pw">Server password for <span id="user3"></span></label>
<input id="pw" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false">
<button id="go" type="button">Approve install</button>
<p class="small">This link works once and expires at <span id="exp"></span>. Not expecting this? Close this page;
nothing changes on your server.</p>
</div>
<p id="msg" role="status"></p>
</main><script src="/os-approve/app.js"></script></body></html>
`;

const CSS = `body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f6f5f2;color:#1d1d1f}
main{max-width:34rem;margin:3rem auto;padding:1.5rem;background:#fff;border-radius:12px;box-shadow:0 1px 4px #0002}
h1{font-size:1.4rem;margin-top:0}label{display:block;margin-top:1rem;font-weight:600}
input{width:100%;box-sizing:border-box;font-size:1.1rem;padding:.6rem;margin:.4rem 0 1rem;border:1px solid #bbb;border-radius:8px}
button{font-size:1.05rem;padding:.7rem 1.2rem;border:0;border-radius:8px;background:#3b2bd1;color:#fff;cursor:pointer}
button:disabled{opacity:.5}.small{font-size:.85rem;color:#666}#msg{font-weight:600}code{background:#eee;padding:0 .2rem}
`;

const JS = String.raw`(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const cap = location.hash.slice(1);
history.replaceState(null, "", location.pathname);  // the capability leaves the address bar at once
const NAMES = {packages: "system packages", docker: "Docker", docker_group: "Docker access for your account",
  linger: "keeping your apps running after logout", runtipi: "the app runtime", tailscale: "Tailscale",
  tailscale_operator: "Tailscale access for your account"};
const api = async (p, b) => { const r = await fetch("/os-approve/api/" + p, {method: "POST",
  headers: {"content-type": "application/json"}, body: JSON.stringify(b), cache: "no-store", referrerPolicy: "no-referrer"});
  let j = {}; try { j = await r.json(); } catch (e) {} return [r.status, j]; };
const say = (t) => { $("msg").textContent = t; };
const DONE = {approved: "Approved. Your server is finishing the install; you can close this page and go back to your agent.",
  wrong_password: "That password was not accepted by your server. Ask your agent for the install status: it shows a fresh link to try again.",
  not_sudoer: "This account is not allowed to use sudo on your server, so a password cannot approve it. Ask your agent for the install status: it shows what an administrator needs to run.",
  failed: "Your server could not finish this step. Ask your agent for the install status for the details.",
  expired: "This link has expired. Ask your agent for the install status: it shows a fresh link.",
  picked_up: "Your server received the approval and is checking it…", submitted: "Sent. Waiting for your server to pick it up…"};
let id = null;
async function watch() {
  for (let i = 0; i < 300; i++) {
    const [s, j] = await api("open", {cap});
    if (s === 200 && DONE[j.state] && j.state !== "submitted" && j.state !== "picked_up") { say(DONE[j.state]); return; }
    if (s === 200) say(DONE[j.state] || ""); 
    await new Promise((r) => setTimeout(r, 2000));
  }
}
async function start() {
  if (!/^[A-Za-z0-9_-]{43}$/.test(cap)) { $("lead").textContent = "This link is incomplete. Copy the whole link from your agent's message, including everything after the # sign."; return; }
  const [s, j] = await api("open", {cap});
  if (s !== 200) { $("lead").textContent = s === 429 ? "Too many tries; wait a few minutes and reload." : "This link is not valid (it may have been replaced by a newer one). Ask your agent for the install status: it shows the current link."; return; }
  id = j.id;
  if (j.state !== "pending") { $("lead").textContent = ""; say(DONE[j.state] || "This link was already used."); if (j.state === "submitted" || j.state === "picked_up") watch(); return; }
  $("lead").textContent = "";
  for (const k of ["host"]) $(k).textContent = j.host;
  for (const k of ["user", "user2", "user3"]) $(k).textContent = j.user;
  $("needs").textContent = (j.needs || []).map((n) => NAMES[n] || n).join(", ") || "host setup";
  $("exp").textContent = new Date(j.expires_at * 1000).toLocaleTimeString();
  $("box").hidden = false; $("pw").focus();
  const key = await crypto.subtle.importKey("spki", Uint8Array.from(atob(j.pubkey), (c) => c.charCodeAt(0)),
    {name: "RSA-OAEP", hash: "SHA-256"}, false, ["encrypt"]);
  const go = async () => {
    const pw = $("pw").value;
    if (!pw) { say("Enter the password first."); return; }
    if (new TextEncoder().encode(pw).length > 256) { say("That password is too long."); return; }
    $("go").disabled = true; $("pw").disabled = true; say("Encrypting and sending…");
    const ct = new Uint8Array(await crypto.subtle.encrypt({name: "RSA-OAEP",
      label: new TextEncoder().encode("wizard-os-approve/v1:" + id)}, key, new TextEncoder().encode(pw)));
    $("pw").value = "";
    let bin = ""; for (const b of ct) bin += String.fromCharCode(b);
    const [s2, j2] = await api("submit", {cap, ct: btoa(bin)});
    if (s2 === 200) { $("box").hidden = true; say(DONE.submitted); watch(); }
    else { say(s2 === 410 ? DONE.expired : s2 === 409 ? "This link was already used." : "Sending failed (" + (j2.error || s2) + "). Reload and try again.");
      $("go").disabled = false; $("pw").disabled = false; }
  };
  $("go").addEventListener("click", go);
  $("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}
start().catch(() => say("Something went wrong loading this page. Reload it, or ask your agent for the install status."));
})();
`;

const API = { create, open, submit, poll, result, cancel };

// Returns a Response for /os-approve paths, or null.
export async function handleApprove(request, env, path) {
  if (path === "/os-approve" && (request.method === "GET" || request.method === "HEAD")) {
    return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP, ...SEC } });
  }
  if (path === "/os-approve/app.js" && request.method === "GET") {
    return new Response(JS, { headers: { "content-type": "text/javascript; charset=utf-8", ...SEC } });
  }
  if (path === "/os-approve/app.css" && request.method === "GET") {
    return new Response(CSS, { headers: { "content-type": "text/css; charset=utf-8", ...SEC } });
  }
  const m = /^\/os-approve\/api\/([a-z]+)$/.exec(path);
  if (m && API[m[1]]) {
    if (request.method !== "POST") return out({ error: "method not allowed" }, 405);
    if (!(request.headers.get("content-type") || "").startsWith("application/json")) return out({ error: "json only" }, 415);
    // Browser calls must come from this page (no cross-site use); the box's curl sends no Origin.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return out({ error: "forbidden" }, 403);
    return await API[m[1]](env, request);
  }
  if (path.startsWith("/os-approve")) return out({ error: "not found" }, 404);
  return null;
}
