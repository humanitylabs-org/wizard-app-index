// Image availability gate: an app is installable only if every image its compose names can be pulled
// anonymously, for every architecture it declares. Speaks the OCI distribution API to any registry
// (GHCR, Docker Hub, Quay, GCR mirrors...). Never needs publisher credentials.
import { parseAllDocuments } from "yaml";

const ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const INDEX_TYPES = new Set(["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"]);
const TIMEOUT_MS = 8000;
const H0 = { get: () => null };

// ${VAR:-default} / ${VAR-default} take their default; a bare ${VAR} cannot be resolved by the index.
export function resolveVars(s) {
  let unresolved = false;
  const out = String(s).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}/g, (_, _n, def) => {
    if (def === undefined) { unresolved = true; return ""; }
    return def;
  });
  return { value: out, unresolved };
}

// Images a box will pull: services with image: and no build: (build/source apps build or mount locally).
export function composeImages(composeText) {
  let doc;
  try { doc = parseAllDocuments(composeText)[0]?.toJS() ?? {}; } catch { return []; }
  const out = [];
  for (const [name, svc] of Object.entries(doc.services || {})) {
    if (!svc || typeof svc !== "object" || svc.build != null || svc.image == null) continue;
    const { value, unresolved } = resolveVars(svc.image);
    out.push({ service: name, image: value, unresolved, never: svc.pull_policy === "never" });
  }
  return out;
}

// Docker reference -> {registry, repository, reference}. Mirrors docker's normalisation.
export function parseImage(ref) {
  let rest = String(ref).trim();
  let registry = "docker.io";
  const slash = rest.indexOf("/");
  if (slash > 0) {
    const first = rest.slice(0, slash);
    if (first.includes(".") || first.includes(":") || first === "localhost") { registry = first; rest = rest.slice(slash + 1); }
  }
  let reference = "latest";
  const at = rest.indexOf("@");
  let tag = null;
  if (at >= 0) { reference = rest.slice(at + 1); rest = rest.slice(0, at); }
  // name:tag@digest pulls by digest; the tag is informational.
  const colon = rest.lastIndexOf(":");
  if (colon > rest.lastIndexOf("/")) { tag = rest.slice(colon + 1); if (at < 0) reference = tag; rest = rest.slice(0, colon); }
  if (at < 0 && !tag) tag = "latest";
  if (registry === "docker.io" && !rest.includes("/")) rest = `library/${rest}`;
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/.test(rest) || !reference) return null;
  return { registry, host: registry === "docker.io" ? "registry-1.docker.io" : registry, repository: rest, reference, tag };
}

function challenge(header) {
  const m = /^Bearer\s+(.*)$/i.exec(header || "");
  if (!m) return null;
  const p = {};
  for (const [, k, v] of m[1].matchAll(/([a-zA-Z]+)="([^"]*)"/g)) p[k] = v;
  return p.realm ? p : null;
}

async function get(fetcher, url, headers = {}, method = "GET") {
  return fetcher(url, { method, headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// One authenticated request against a registry, doing the anonymous bearer-token dance when asked.
async function registryRequest(fetcher, img, path, method, tokens) {
  const url = `https://${img.host}/v2/${img.repository}/${path}`;
  const headers = { Accept: ACCEPT };
  const cached = tokens.get(`${img.host}/${img.repository}`);
  if (cached) headers.Authorization = `Bearer ${cached}`;
  let res = await get(fetcher, url, headers, method);
  if (res.status === 401 && !cached) {
    const c = challenge(res.headers.get("www-authenticate"));
    if (!c) return res;
    const q = new URLSearchParams();
    if (c.service) q.set("service", c.service);
    q.set("scope", c.scope || `repository:${img.repository}:pull`);
    const t = await get(fetcher, `${c.realm}?${q}`);
    // Registries answer 401/403 to an anonymous token request for a private or missing repository.
    if (!t.ok) return { status: t.status === 401 || t.status === 403 ? 404 : t.status, headers: t.headers, json: async () => ({}) };
    const body = await t.json().catch(() => ({}));
    const token = body.token || body.access_token;
    if (!token) return res;
    tokens.set(`${img.host}/${img.repository}`, token);
    res = await get(fetcher, url, { ...headers, Authorization: `Bearer ${token}` }, method);
  }
  return res;
}

// Docker Hub rate-limits anonymous registry calls per IP, and Worker egress IPs are shared, so a 429 says
// nothing about the image. Its web API answers the same question (and lists architectures) on separate limits.
async function hubFallback(fetcher, img) {
  const base = `https://hub.docker.com/v2/repositories/${img.repository}`;
  const r = await get(fetcher, img.tag ? `${base}/tags/${encodeURIComponent(img.tag)}` : base, { Accept: "application/json" });
  if (r.status === 404 && img.tag && img.reference !== img.tag) {
    // Digest pin whose tag has since moved: the digest stays pullable while the repository exists.
    const repo = await get(fetcher, base, { Accept: "application/json" });
    return repo.status === 200 ? { status: 200 } : { status: repo.status };
  }
  if (r.status !== 200) return { status: r.status };
  const body = await r.json().catch(() => ({}));
  return { status: 200, archs: img.reference === img.tag ? (body.images || []).map((i) => i.architecture) : null };
}

const normArch = (a) => ({ x86_64: "amd64", aarch64: "arm64", arm64v8: "arm64" }[a] || a);

// -> {ok, missing: [detail], transient: [detail]}. missing = definitely not pullable; transient = registry
// unreachable/limited, decide later (never delist a working app because a registry hiccuped).
export async function checkImages(composeText, architectures = [], { fetcher = fetch } = {}) {
  const missing = [], transient = [];
  const tokens = new Map();
  const want = [...new Set((architectures || []).map(normArch))];
  for (const { service, image, unresolved, never } of composeImages(composeText)) {
    if (unresolved) { missing.push(`${service}: image ${image || "?"} uses a variable with no default`); continue; }
    if (never) { missing.push(`${service}: pull_policy: never needs an image preloaded by hand; publish ${image} to a public registry`); continue; }
    const img = parseImage(image);
    if (!img) { missing.push(`${service}: ${image} is not a valid image reference`); continue; }
    try {
      // Docker Hub rate-limits anonymous calls per IP and Worker egress IPs are shared, so ask Google's
      // pull-through Docker Hub mirror first; it serves the same manifests without Hub's limits.
      const hub = img.registry === "docker.io";
      const probe = hub ? { ...img, host: "mirror.gcr.io" } : img;
      let res = await registryRequest(fetcher, probe, `manifests/${img.reference}`, "GET", tokens);
      let archsOnly = null;
      if (hub && res.status !== 200) {
        // Mirror miss: Hub itself (HEAD is free of pull quota), then Hub's web API. Inconclusive is transient.
        const head = await registryRequest(fetcher, img, `manifests/${img.reference}`, "HEAD", tokens).catch(() => ({ status: 0 }));
        if (head.status === 200) res = { status: 200, headers: H0 };
        else {
          const fb = await hubFallback(fetcher, img).catch(() => ({ status: 0 }));
          // The mirror missed and Hub's own API says no such tag/repository: that is authoritative.
          res = fb.status === 200 ? { status: 200, headers: H0 } : fb.status === 404 ? { status: 404 } : { status: head.status === 429 || fb.status === 429 ? 429 : 0 };
          archsOnly = fb.archs || null;
        }
        if (res.status === 200 && !archsOnly) { if (want.length) continue; }
      }
      if (res.status === 404 || res.status === 401 || res.status === 403) { missing.push(`${image}: not published or not public`); continue; }
      if (res.status === 429 || res.status >= 500 || !res.status) { transient.push(`${image}: registry answered ${res.status || "nothing"}`); continue; }
      if (res.status !== 200) { missing.push(`${image}: registry answered ${res.status}`); continue; }
      if (archsOnly) {
        const have = new Set(archsOnly.map(normArch));
        const lack = want.filter((a) => !have.has(a));
        if (lack.length) missing.push(`${image}: no ${lack.join(", ")} build (supported_architectures promises it)`);
        continue;
      }
      if (!want.length || res.headers === H0) continue;
      const type = (res.headers.get("content-type") || "").split(";")[0].trim();
      const body = await res.json().catch(() => null);
      if (!body) { transient.push(`${image}: unreadable manifest`); continue; }
      let have;
      if (INDEX_TYPES.has(type) || Array.isArray(body.manifests)) {
        have = new Set((body.manifests || []).filter((m) => (m.platform?.os ?? "linux") === "linux").map((m) => normArch(m.platform?.architecture)));
      } else {
        const digest = body.config?.digest;
        if (!digest) { transient.push(`${image}: manifest has no config`); continue; }
        const cfg = await registryRequest(fetcher, probe, `blobs/${digest}`, "GET", tokens);
        if (cfg.status !== 200) { transient.push(`${image}: config blob answered ${cfg.status}`); continue; }
        have = new Set([normArch((await cfg.json().catch(() => ({}))).architecture)]);
      }
      const lack = want.filter((a) => !have.has(a));
      if (lack.length) missing.push(`${image}: no ${lack.join(", ")} build (supported_architectures promises it)`);
    } catch (e) {
      transient.push(`${image}: ${e?.name === "TimeoutError" ? "registry timed out" : String(e?.message || e)}`);
    }
  }
  return { ok: !missing.length && !transient.length, missing, transient };
}
