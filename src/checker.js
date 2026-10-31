// wizard.md checker for the index. Mirrors humanitylabs-org/wizard-os tools/check_wizard_md.py
// (spec v0.1/v0.2) rule for rule, plus a container-safety pass on the Runtipi compose file.
// Input is a function that reads a file from the repo at a pinned commit.
import { parse as parseYaml, parseAllDocuments } from "yaml";
import dependencies from "./known_dependencies.json" with { type: "json" };

export function knownDependencies() {
  const known = new Set(NEEDS);
  for (const app of dependencies.apps) {
    if (app.app) {
      known.add(app.app);
      for (const capability of app.provides || []) known.add(capability);
    }
  }
  return known;
}

export const TYPES = new Set(["agent", "service", "view", "external"]);
export const CATEGORIES = new Set(["agent", "interface", "app", "system"]);
// Purposes for store browsing (wizard.md `tags`). Fixed list so the store can show one row per purpose.
export const TAGS = new Set(["video", "audio", "photos", "writing", "research", "finance", "productivity", "communication", "developer", "automation", "security", "data", "home", "learning"]);
export const MAX_TAGS = 3;
export const NEEDS = new Set(["mic", "system-audio", "camera", "notifications", "files", "home-network"]);
const SPECS = new Set([0.1, 0.2]);
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
// The app id is the app's name in kebab-case (Connected accounts -> connected-accounts), optionally "wizard-"
// prefixed, or a staging copy of it (movies-next, search-preview; "Philosopher (agent)" -> agent-philosopher).
// Apps listed before this rule keep listing; each moves to its name with a release that sets renamed_from.
// Never add to this list.
export const LEGACY_IDS = new Set(["cinequeue", "usuals", "outline-streaming-demo", "wizard-connectors", "voice-outline",
  "mizel", "hermes-frontend-3", "smart-home", "wizard-ux"]);
const STAGING = /\s*\((?:[^()]*\s)?(test|preview|next|beta|alpha|agent|demo)\)\s*$/i;
export const kebab = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export function idIsName(id, name) {
  const m = STAGING.exec(String(name ?? ""));
  const base = kebab(String(name ?? "").replace(STAGING, ""));
  if (!base) return false;
  const ok = new Set([base, `wizard-${base}`]);
  for (const b of [...ok]) {
    for (const s of ["next", "preview", "test"]) ok.add(`${b}-${s}`);
    if (m) { ok.add(`${b}-${m[1].toLowerCase()}`); ok.add(`${m[1].toLowerCase()}-${b}`); }
  }
  return ok.has(String(id));
}
const NPUB = /^npub1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/;
const VERSION = /^\d+\.\d+\.\d+([-+.][\w.]+)?$/;

export function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) throw new Error("no YAML front matter");
  const data = parseYaml(m[1]);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("front matter is not a mapping");
  return data;
}

export function body(text) {
  return text.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

// Things a public, unreviewed app must never ask for. The host is the owner's whole Wizard.
export function composeRisks(composeText) {
  const risks = [];
  let doc;
  try {
    doc = parseAllDocuments(composeText)[0]?.toJS() ?? {};
  } catch (e) {
    return [`compose does not parse: ${e.message}`];
  }
  const services = doc && typeof doc.services === "object" ? doc.services : {};
  for (const [name, s] of Object.entries(services || {})) {
    if (!s || typeof s !== "object") continue;
    if (s.privileged) risks.push(`${name}: privileged`);
    for (const k of ["network_mode", "pid", "ipc", "userns_mode", "uts"]) {
      if (String(s[k] ?? "").toLowerCase() === "host") risks.push(`${name}: ${k}: host`);
    }
    const caps = (s.cap_add || []).map((c) => String(c).toUpperCase().replace(/^CAP_/, ""));
    for (const c of caps) if (["ALL", "SYS_ADMIN", "SYS_MODULE", "SYS_PTRACE", "SYS_RAWIO", "NET_ADMIN", "DAC_READ_SEARCH", "BPF", "PERFMON"].includes(c)) risks.push(`${name}: cap_add ${c}`);
    if (s.devices && s.devices.length) risks.push(`${name}: host devices`);
    for (const opt of s.security_opt || []) if (/unconfined/i.test(String(opt))) risks.push(`${name}: security_opt ${opt}`);
    for (const v of s.volumes || []) {
      const src = typeof v === "string" ? v.split(":")[0] : String(v?.source ?? "");
      if (/docker\.sock|containerd\.sock|podman\.sock/.test(src)) risks.push(`${name}: mounts the container runtime socket`);
      else if (src === "/" || /^\/(etc|root|boot|proc|sys|dev|var\/run|run|home|usr|lib|bin|sbin)(\/|$)/.test(src)) risks.push(`${name}: mounts host path ${src}`);
    }
  }
  return risks;
}

// Rule 14 (spec/WIZARD_MD.md "Packaging"): how an app's containers come to exist.
export const PACKAGES = new Set(["source", "build", "image"]);
const DIGEST = /@sha256:[0-9a-f]{64}$/;
const VARX = /\$\{[A-Za-z_][A-Za-z0-9_]*(?::?-([^}]*))?\}/g;
const COMPILE = /\b(npm|yarn|pnpm|bun) run build\b|\bcargo\b|\bgo build\b|\bmake\b|\bgcc\b|\bg\+\+|\brustc\b/;
const resolved = (img) => String(img ?? "").replace(VARX, (_, d) => d ?? "");
// Normalize a repo-relative path; null when it climbs out of the repo or is absolute.
export function inside(...parts) {
  const out = [];
  for (const seg of parts.join("/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return parts.some((p) => String(p).startsWith("/")) ? null : out.join("/");
}
const hashLocked = (text) => {
  if (text == null) return false;
  const reqs = text.replace(/\\\n/g, " ").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  return reqs.length > 0 && reqs.every((l) => l.includes("--hash="));
};
export async function dockerfileProblems(read, file, ctx) {
  const text = await read(file);
  if (text == null) return [`no Dockerfile at ${file}`];
  const lines = text.replace(/\\\n/g, " ").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const args = {}, copies = {}, stages = new Set(), bad = [];
  for (const ln of lines) {
    let m = ln.match(/^ARG\s+([A-Za-z_]\w*)=(\S+)/i);
    if (m) args[m[1]] = m[2];
    m = ln.match(/^(?:COPY|ADD)\s+(?:--\S+\s+)*(\S+)\s+(\S+)$/i);
    if (m) copies[m[2].endsWith("/") ? `${m[2].replace(/\/+$/, "")}/${m[1].split("/").pop()}` : m[2]] = m[1];
  }
  for (const ln of lines) {
    let m = ln.match(/^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i);
    if (m) {
      const img = m[1].replace(/\$\{?([A-Za-z_]\w*)\}?/g, (_, v) => args[v] ?? "");
      if (!stages.has(img.toLowerCase()) && img !== "scratch" && !DIGEST.test(img)) bad.push(`FROM ${m[1]} is not pinned by digest`);
      if (m[2]) stages.add(m[2].toLowerCase());
      continue;
    }
    if (!/^RUN\b/i.test(ln)) continue;
    if (COMPILE.test(ln)) bad.push(`compiles or bundles on the box: ${ln.slice(0, 80)}`);
    for (const part of ln.split(/&&|;/)) {
      if (!part.includes("pip install") || part.includes("--require-hashes")) continue;
      const reqs = [...part.matchAll(/(?:-r|--requirement)\s+(\S+)/g)].map((x) => x[1]);
      let ok = reqs.length > 0;
      for (const r of reqs) {
        const p = inside(ctx, (copies[r] ?? r).replace(/^\/+/, ""));
        if (!p || !hashLocked(await read(p))) ok = false;
      }
      if (!ok) bad.push(`pip install is not hash-locked: ${part.trim().slice(0, 80)}`);
    }
  }
  return bad;
}
export async function packagingProblems(read, pkg, composeText) {
  if (!PACKAGES.has(pkg)) return [`runtime.package must be source, build or image, not ${JSON.stringify(pkg)}`];
  let doc;
  try {
    doc = parseAllDocuments(composeText)[0]?.toJS() ?? {};
  } catch (e) {
    return [`compose does not parse: ${e.message}`];
  }
  const services = Object.entries((doc && doc.services) || {}).filter(([, s]) => s && typeof s === "object");
  const builds = services.filter(([, s]) => s.build);
  const bad = [];
  let mounted = false;
  for (const [n, s] of services) {
    if (!s.build && !DIGEST.test(resolved(s.image))) bad.push(`${n}: image ${JSON.stringify(s.image ?? null)} is not pinned by digest (name@sha256:...)`);
    for (const v of s.volumes || []) {
      const [src, opts] = typeof v === "string" ? [v.split(":")[0], v.split(":").slice(2).join(",")] : [String(v?.source ?? ""), v?.read_only ? "ro" : ""];
      if (!src.startsWith("${APP_SOURCE_DIR}")) continue;
      mounted = true;
      if (!opts.split(",").includes("ro")) bad.push(`${n}: \${APP_SOURCE_DIR} must be mounted read-only (:ro)`);
    }
  }
  const names = builds.map(([n]) => n).join(", ");
  if (pkg === "source") {
    if (builds.length) bad.push(`source apps build nothing; remove build: from ${names}`);
    if (!mounted) bad.push("source apps mount their code: add ${APP_SOURCE_DIR}[/subdir]:/app:ro to a service");
  } else if (pkg === "image") {
    if (builds.length) bad.push(`image apps use their published image; remove build: from ${names}`);
  } else {
    if (!builds.length) bad.push("build apps need a build: section (context relative to the repo root)");
    for (const [n, s] of builds) {
      const b = typeof s.build === "string" ? { context: s.build } : s.build;
      const raw = String(b.context ?? ".");
      const ctx = /\$\{/.test(raw) ? null : inside(raw);
      if (ctx == null) { bad.push(`${n}: build.context ${JSON.stringify(raw)} must be a path inside the repo`); continue; }
      const df = inside(ctx, String(b.dockerfile ?? "Dockerfile"));
      if (df == null || (ctx && !df.startsWith(`${ctx}/`))) { bad.push(`${n}: build.dockerfile must stay inside the context`); continue; }
      for (const p of await dockerfileProblems(read, df, ctx)) bad.push(`${n}: ${p}`);
    }
  }
  return bad;
}

// read(path) -> Promise<string|null>; returns [{rule, ok, detail}], plus the parsed data.
export async function check(read) {
  const out = [];
  const rule = (name, ok, detail = "") => out.push({ rule: name, ok: Boolean(ok), detail: String(detail ?? "") });
  const text = await read("wizard.md");
  if (text == null) {
    rule("wizard.md present", false, "no wizard.md at the repo root");
    return { results: out, data: null };
  }
  rule("wizard.md present", true);
  let d;
  try {
    d = frontMatter(text);
  } catch (e) {
    rule("front matter parses", false, e.message);
    return { results: out, data: null };
  }
  rule("front matter parses", true);
  if (Object.hasOwn(d, "voice_names")) {
    const ns = d.voice_names;
    rule("voice_names valid", Array.isArray(ns) && ns.length <= 8 && ns.every(n =>
      typeof n === "string" && n.trim().length > 0 && [...n].length <= 40 && !/[\x00-\x1f\x7f]/.test(n)),
      "at most 8 nonblank strings, each at most 40 characters, without controls");
  }
  rule("spec version known", SPECS.has(Number(d.wizard)) && typeof d.wizard === "number", d.wizard);
  rule("id valid", ID.test(String(d.id ?? "")), d.id);
  rule("id is the app's name", idIsName(d.id, d.name) || LEGACY_IDS.has(String(d.id)),
    `id ${d.id} should be ${kebab(String(d.name ?? "").replace(STAGING, "")) || "the name"} in kebab-case`);
  if (Object.hasOwn(d, "renamed_from")) {
    const rf = typeof d.renamed_from === "string" ? [d.renamed_from] : d.renamed_from;
    rule("renamed_from lists earlier app ids", Array.isArray(rf) && rf.length > 0 && rf.every((x) => typeof x === "string" && ID.test(x) && x !== d.id),
      "a list of the app's earlier ids, not its own id");
  }
  const t = d.type;
  rule("type valid", TYPES.has(t), t);
  rule("version valid", VERSION.test(String(d.version ?? "")), d.version);
  const s = String(d.summary ?? "");
  rule("summary 1-140 chars", s.length > 0 && s.length <= 140, `${s.length} chars`);
  rule("license and source", Boolean(d.license) && Boolean(d.source));
  const rt = d.runtime || {};
  const files = {};
  for (const key of ["config", "compose"]) {
    const p = rt[key];
    const content = p ? await read(String(p)) : null;
    files[key] = content;
    rule(`runtime.${key} exists`, content != null, p);
  }
  let config = null;
  if (files.config != null) {
    try {
      config = JSON.parse(files.config);
      const now = Date.now();
      const bad = ["created_at", "updated_at"].filter((k) => typeof config[k] === "number" && config[k] > now);
      rule("runtipi config id matches", config.id === d.id, `${config.id} vs ${d.id}`);
      rule("runtipi timestamps not in future", bad.length === 0, bad.join(", "));
    } catch (e) {
      rule("runtipi config parses", false, e.message);
    }
  }
  if (["agent", "service", "external"].includes(t)) {
    const m = d.mcp || {};
    rule("mcp declared", Boolean(m.path) && Boolean(m.port), JSON.stringify(m));
  }
  let skillText = null;
  if (t !== "view") {
    const sk = d.skill;
    let ok = false;
    let detail = String(sk ?? "");
    skillText = sk ? await read(String(sk)) : null;
    if (skillText != null) {
      try {
        const sfm = frontMatter(skillText);
        ok = Boolean(sfm.name) && Boolean(sfm.description);
        detail = sfm.name ?? "";
      } catch (e) {
        detail = e.message;
      }
    }
    rule("skill ships with name+description", ok, detail);
  }
  if (t === "view") {
    const v = d.view || {};
    rule("view declared", Boolean(v.path) && Boolean(v.port), JSON.stringify(v));
  }
  const bad = (d.needs || []).filter((n) => !knownDependencies().has(n) && !String(n).startsWith("credentials:"));
  rule("needs known", bad.length === 0, bad.join(", "));
  if (d.provides != null) {
    const pv = d.provides;
    const badp = (Array.isArray(pv) ? pv : [pv]).filter((p) => !ID.test(String(p)));
    rule("provides are slot ids", Array.isArray(pv) && badp.length === 0, badp.join(", "));
  }
  if (d.category != null) rule("category is agent, interface, app or system", CATEGORIES.has(d.category), d.category);
  if (d.tags != null) {
    const tg = Array.isArray(d.tags) ? d.tags : [d.tags];
    const badt = tg.filter((x) => !TAGS.has(x));
    rule("tags are from the Wizard purpose list", Array.isArray(d.tags) && badt.length === 0, badt.join(", "));
    rule(`at most ${MAX_TAGS} tags`, tg.length <= MAX_TAGS, `${tg.length} tags`);
  }
  if (d.publisher != null) rule("publisher is an npub", NPUB.test(String(d.publisher)), d.publisher);
  if (files.compose != null) {
    const risks = composeRisks(files.compose);
    rule("container asks for no host-level access", risks.length === 0, risks.join("; "));
    if (rt.package != null) {
      const probs = await packagingProblems(read, String(rt.package), files.compose);
      rule(`packaging (${rt.package}) follows the rules`, probs.length === 0, probs.join("; "));
    }
  }
  // Store logo: Runtipi's metadata/logo.jpg next to config.json, if the repo has one.
  let logo = null;
  if (d.icon != null) {
    const ip = String(d.icon);
    const ok = /\.(png|jpe?g)$/i.test(ip) && (await read(ip)) != null;
    rule("icon exists (png/jpg)", ok, ip);
    if (ok) logo = ip;
  }
  if (!logo && rt.config) {
    const dir = String(rt.config).includes("/") ? String(rt.config).replace(/\/[^/]*$/, "") : "";
    for (const cand of [dir ? `${dir}/metadata/logo.jpg` : "metadata/logo.jpg", "metadata/logo.jpg", "logo.jpg"]) {
      if ((await read(cand)) != null) { logo = cand; break; }
    }
  }
  return { results: out, data: d, config, body: body(text), logo };
}

export const passed = (results) => results.length > 0 && results.every((r) => r.ok);
export const failures = (results) => results.filter((r) => !r.ok).map((r) => (r.detail ? `${r.rule} (${r.detail})` : r.rule));
