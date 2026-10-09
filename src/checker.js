// wizard.md checker for the index. Mirrors humanitylabs-org/wizard-os tools/check_wizard_md.py
// (spec v0.1/v0.2) rule for rule, plus a container-safety pass on the Runtipi compose file.
// Input is a function that reads a file from the repo at a pinned commit.
import { parse as parseYaml, parseAllDocuments } from "yaml";

export const TYPES = new Set(["agent", "service", "view", "external"]);
export const CATEGORIES = new Set(["agent", "interface", "app", "system"]);
export const NEEDS = new Set(["mic", "system-audio", "camera", "notifications", "files"]);
const SPECS = new Set([0.1, 0.2]);
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
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
  rule("spec version known", SPECS.has(Number(d.wizard)) && typeof d.wizard === "number", d.wizard);
  rule("id valid", ID.test(String(d.id ?? "")), d.id);
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
  const bad = (d.needs || []).filter((n) => !NEEDS.has(n) && !String(n).startsWith("credentials:"));
  rule("needs known", bad.length === 0, bad.join(", "));
  if (d.provides != null) {
    const pv = d.provides;
    const badp = (Array.isArray(pv) ? pv : [pv]).filter((p) => !ID.test(String(p)));
    rule("provides are slot ids", Array.isArray(pv) && badp.length === 0, badp.join(", "));
  }
  if (d.category != null) rule("category is agent, interface, app or system", CATEGORIES.has(d.category), d.category);
  if (d.publisher != null) rule("publisher is an npub", NPUB.test(String(d.publisher)), d.publisher);
  if (files.compose != null) {
    const risks = composeRisks(files.compose);
    rule("container asks for no host-level access", risks.length === 0, risks.join("; "));
  }
  // Store logo: Runtipi's metadata/logo.jpg next to config.json, if the repo has one.
  let logo = null;
  if (rt.config) {
    const dir = String(rt.config).includes("/") ? String(rt.config).replace(/\/[^/]*$/, "") : "";
    for (const cand of [dir ? `${dir}/metadata/logo.jpg` : "metadata/logo.jpg", "metadata/logo.jpg", "logo.jpg"]) {
      if ((await read(cand)) != null) { logo = cand; break; }
    }
  }
  return { results: out, data: d, config, body: body(text), logo };
}

export const passed = (results) => results.length > 0 && results.every((r) => r.ok);
export const failures = (results) => results.filter((r) => !r.ok).map((r) => (r.detail ? `${r.rule} (${r.detail})` : r.rule));
