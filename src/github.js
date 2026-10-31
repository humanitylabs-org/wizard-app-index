// Reading public GitHub repos without an API token.
// Commit resolution uses git's smart-HTTP ref advertisement and file reads use
// raw.githubusercontent.com at the pinned commit, so neither touches the REST API rate limit.
// Only the crawler's topic search uses the REST API (optional GITHUB_TOKEN raises its limit).

const UA = "wizard-app-index (+https://apps.aiwizards.com)";
const MAX_FILE = 512 * 1024;
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

export function parseRepo(input) {
  if (!input || typeof input !== "string") return null;
  let s = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  s = s.replace(/^git@github\.com:/i, "").replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "");
  const parts = s.split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!NAME.test(owner) || !NAME.test(repo) || repo === "." || repo === "..") return null;
  return { owner, repo, key: `github:${owner}/${repo}`.toLowerCase(), url: `https://github.com/${owner}/${repo}` };
}

// A renamed or transferred repo: github.com answers the old name with a 301 to the current one (git still serves
// the old name, so without this the index would list one app twice). No REST API call. Returns the current repo,
// or null when the name is current or GitHub did not say.
export async function currentName(r) {
  let res;
  try {
    res = await fetch(r.url, { method: "HEAD", redirect: "manual", headers: { "User-Agent": UA } });
  } catch {
    return null;
  }
  if (res.status !== 301 && res.status !== 308) return null;
  const to = parseRepo((res.headers.get("location") || "").split(/[?#]/)[0]);
  return to && to.key !== r.key ? to : null;
}

// Parse a git-upload-pack ref advertisement into {head, symref, refs}.
export function parseRefs(text) {
  const refs = {};
  let symref = null;
  for (const line of text.split("\n")) {
    const m = /([0-9a-f]{40}) ([^\0\s]+)(?:\0(.*))?/.exec(line);
    if (!m) continue;
    refs[m[2]] = m[1];
    if (m[3]) {
      const sr = /symref=HEAD:(\S+)/.exec(m[3]);
      if (sr) symref = sr[1];
    }
  }
  return { head: refs.HEAD ?? null, symref, refs };
}

export async function resolveCommit(r, ref) {
  const res = await fetch(`${r.url}.git/info/refs?service=git-upload-pack`, { headers: { "User-Agent": "git/2.45 " + UA } });
  if (res.status === 401 || res.status === 404) return { error: "repo not found or not public" };
  if (!res.ok) return { error: `GitHub returned ${res.status}` };
  const { head, symref, refs } = parseRefs(await res.text());
  if (ref) {
    const sha = refs[`refs/heads/${ref}`] ?? refs[`refs/tags/${ref}`];
    return sha ? { sha, ref } : { error: `ref ${ref} not found` };
  }
  if (!head) return { error: "repo is empty" };
  return { sha: head, ref: symref ? symref.replace(/^refs\/heads\//, "") : null };
}

export function safePath(p) {
  const s = String(p ?? "").replace(/^\.\//, "");
  if (!s || s.startsWith("/") || s.split("/").some((x) => x === ".." || x === "")) return null;
  return s;
}

export function fileReader(r, sha) {
  const cache = new Map();
  return async (path) => {
    const p = safePath(path);
    if (!p) return null;
    if (cache.has(p)) return cache.get(p);
    const res = await fetch(`https://raw.githubusercontent.com/${r.owner}/${r.repo}/${sha}/${p.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { "User-Agent": UA },
    });
    let text = null;
    if (res.ok) {
      const len = Number(res.headers.get("content-length") || 0);
      if (len <= MAX_FILE) {
        text = await res.text();
        if (text.length > MAX_FILE) text = null;
      }
    }
    cache.set(p, text);
    return text;
  };
}

// One page of a topic search. Returns {total, items:[{full_name, archived, private}], incomplete}.
export async function searchTopic(query, page, token) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=100&page=${page}`;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": UA, "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) return { rateLimited: true };
  if (!res.ok) return { error: `search ${res.status}` };
  const d = await res.json();
  return { total: d.total_count ?? 0, items: d.items ?? [], incomplete: Boolean(d.incomplete_results) };
}
