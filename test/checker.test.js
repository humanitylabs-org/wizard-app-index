import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { check, passed, failures, composeRisks } from "../src/checker.js";
import { parseRepo, parseRefs, safePath } from "../src/github.js";

const dirReader = (root) => async (p) => {
  const s = safePath(p);
  if (!s) return null;
  try {
    return await readFile(join(root, s), "utf8");
  } catch {
    return null;
  }
};
const memReader = (files) => async (p) => files[p] ?? null;

const FIXTURE = process.env.WIZARD_APP_FIXTURE; // e.g. a local defleur-video checkout

test("a real app repo passes (set WIZARD_APP_FIXTURE)", { skip: !FIXTURE }, async () => {
  const r = await check(dirReader(FIXTURE));
  assert.ok(passed(r.results), failures(r.results).join("; "));
});

const base = {
  "wizard.md": `---\nwizard: 0.2\nid: hello\nname: Hello\ntype: service\nversion: 0.1.0\nsummary: Says hello.\nlicense: MIT\nsource: https://github.com/a/b\nruntime:\n  kind: runtipi\n  config: runtipi/config.json\n  compose: runtipi/docker-compose.yml\nmcp:\n  path: /mcp\n  port: 8799\nskill: SKILL.md\nprovides: [diagnostics]\n---\n\n# Hello\n`,
  "runtipi/config.json": JSON.stringify({ id: "hello", supported_architectures: ["amd64"] }),
  "runtipi/docker-compose.yml": "services:\n  hello:\n    image: x\n    cap_drop: [ALL]\n",
  "SKILL.md": "---\nname: hello\ndescription: say hello\n---\n",
};

test("spoken launch names have bounded strict validation", async () => {
  for (const names of [[], ["Reading Room"], Array(8).fill("😀".repeat(40))]) {
    const files = {...base, "wizard.md": base["wizard.md"].replace("id: hello", "id: hello\nvoice_names: " + JSON.stringify(names))};
    const r = await check(memReader(files));
    assert.ok(passed(r.results), failures(r.results).join("; "));
  }
  for (const names of [null, "reader", {}, [true], [1], [""], [" "], ["x".repeat(41)], Array(9).fill("x"), ["a\nb"]]) {
    const files = {...base, "wizard.md": base["wizard.md"].replace("id: hello", "id: hello\nvoice_names: " + JSON.stringify(names))};
    assert.match(failures((await check(memReader(files))).results).join(), /voice_names valid/);
  }
});

test("needs accepts WAM capabilities and app IDs, not aliases or self declarations", async () => {
  for (const [need, accepted] of [
    ["speech-to-text-engine", true], ["connection-router", true], ["wizard-voice-service", true],
    ["home-network", true], ["credentials:test", true], ["accounts", false],
    ["agent-history", false], ["wizard-agent-history", false], ["invented-engine", false],
  ]) {
    const files = {...base, "wizard.md": base["wizard.md"].replace("provides: [diagnostics]", `provides: [${need}]\nneeds: [${need}]`)};
    const r = await check(memReader(files));
    assert.equal(r.results.find(r => r.rule === "needs known").ok, accepted, need);
  }
});

test("minimal app passes", async () => {
  const r = await check(memReader(base));
  assert.ok(passed(r.results), failures(r.results).join("; "));
  assert.equal(r.data.id, "hello");
});

test("missing wizard.md, skill, or mcp fails", async () => {
  assert.ok(!passed((await check(memReader({}))).results));
  const noSkill = { ...base, "SKILL.md": undefined };
  assert.match(failures((await check(memReader(noSkill))).results).join(), /skill/);
  const noMcp = { ...base, "wizard.md": base["wizard.md"].replace(/mcp:\n  path: \/mcp\n  port: 8799\n/, "") };
  assert.match(failures((await check(memReader(noMcp))).results).join(), /mcp/);
});

test("config id must match wizard id", async () => {
  const r = await check(memReader({ ...base, "runtipi/config.json": JSON.stringify({ id: "other" }) }));
  assert.match(failures(r.results).join(), /config id/);
});

test("host-level container access is refused", async () => {
  for (const bad of [
    "services:\n  a:\n    privileged: true\n",
    "services:\n  a:\n    network_mode: host\n",
    "services:\n  a:\n    volumes: ['/var/run/docker.sock:/var/run/docker.sock']\n",
    "services:\n  a:\n    volumes: ['/:/host']\n",
    "services:\n  a:\n    volumes: ['/etc:/x:ro']\n",
    "services:\n  a:\n    cap_add: [SYS_ADMIN]\n",
    "services:\n  a:\n    pid: host\n",
    "services:\n  a:\n    devices: ['/dev/sda']\n",
  ]) {
    assert.ok(composeRisks(bad).length > 0, bad);
    const r = await check(memReader({ ...base, "runtipi/docker-compose.yml": bad }));
    assert.ok(!passed(r.results), bad);
  }
  // What our own apps legitimately use stays allowed.
  assert.deepEqual(composeRisks("services:\n  f:\n    cap_add: [CHOWN, SETUID, SETGID]\n    volumes: ['${ROOT_FOLDER_HOST}/media:/srv', '${APP_DATA_DIR}/data:/data']\n"), []);
});

test("path traversal is never read", async () => {
  assert.equal(safePath("../etc/passwd"), null);
  assert.equal(safePath("/etc/passwd"), null);
  assert.equal(safePath("a//b"), null);
  assert.equal(safePath("./runtipi/config.json"), "runtipi/config.json");
});

test("repo parsing", () => {
  assert.deepEqual(parseRepo("https://github.com/Owner/Repo.git"), { owner: "Owner", repo: "Repo", key: "github:owner/repo", url: "https://github.com/Owner/Repo" });
  assert.equal(parseRepo("owner/repo").key, "github:owner/repo");
  assert.equal(parseRepo("git@github.com:o/r").key, "github:o/r");
  assert.equal(parseRepo("https://evil.com/o/r"), null);
  assert.equal(parseRepo("o/r/extra"), null);
  assert.equal(parseRepo("o/.."), null);
});

test("ref advertisement parsing", () => {
  const sha = "a".repeat(40);
  const sha2 = "b".repeat(40);
  const txt = `001e# service=git-upload-pack\n0000015${sha} HEAD\0multi_ack symref=HEAD:refs/heads/main agent=x\n003f${sha} refs/heads/main\n003f${sha2} refs/tags/v1\n0000`;
  const r = parseRefs(txt);
  assert.equal(r.head, sha);
  assert.equal(r.symref, "refs/heads/main");
  assert.equal(r.refs["refs/tags/v1"], sha2);
});

test("category is optional and limited to the four shelves", async () => {
  const withCat = (c) => ({ ...base, "wizard.md": base["wizard.md"].replace("type: service\n", `type: service\ncategory: ${c}\n`) });
  assert.ok(passed((await check(memReader(withCat("system")))).results));
  assert.match(failures((await check(memReader(withCat("games")))).results).join(), /category/);
});

test("icon is optional; when set it must exist and be png/jpg", async () => {
  const withIcon = (i, files = {}) => ({ ...base, ...files, "wizard.md": base["wizard.md"].replace("type: service\n", `type: service\nicon: ${i}\n`) });
  const ok = await check(memReader(withIcon("icon.png", { "icon.png": "x" })));
  assert.ok(passed(ok.results), failures(ok.results).join());
  assert.equal(ok.logo, "icon.png");
  assert.match(failures((await check(memReader(withIcon("icon.png")))).results).join(), /icon/);
  assert.match(failures((await check(memReader(withIcon("icon.svg", { "icon.svg": "x" })))).results).join(), /icon/);
});

test("tags are optional, from the purpose list, max 3", async () => {
  const withTags = (t) => ({ ...base, "wizard.md": base["wizard.md"].replace("type: service\n", `type: service\ntags: ${t}\n`) });
  const ok = await check(memReader(withTags("[video, audio]")));
  assert.ok(passed(ok.results), failures(ok.results).join());
  assert.deepEqual(ok.data.tags, ["video", "audio"]);
  assert.match(failures((await check(memReader(withTags("[video, games]")))).results).join(), /tags are from the Wizard purpose list \(games\)/);
  assert.match(failures((await check(memReader(withTags("video")))).results).join(), /purpose list/);
  assert.match(failures((await check(memReader(withTags("[video, audio, data, home]")))).results).join(), /at most 3 tags/);
});

test("home-network is a known need (apps that only work on a home connection)", async () => {
  const { NEEDS } = await import("../src/checker.js");
  assert.ok(NEEDS.has("home-network"));
});

import { idIsName, LEGACY_IDS } from "../src/checker.js";

test("app id is the app's name (kebab-case, wizard- prefix, staging labels); legacy ids frozen", () => {
  for (const [id, name] of [["movies", "Movies"], ["connected-accounts", "Connected accounts"], ["wizard-calendar", "Calendar"],
    ["wizard-files", "Wizard Files"], ["movies-next", "Movies (test)"], ["search-preview", "Search (Oscar preview)"],
    ["agent-philosopher", "Philosopher (agent)"]]) assert.ok(idIsName(id, name), `${id} / ${name}`);
  for (const [id, name] of [["cinequeue", "Movies"], ["popcornbox", "Movies"], ["usuals", "Food"], ["movies", ""]])
    assert.ok(!idIsName(id, name), `${id} / ${name}`);
  assert.ok(LEGACY_IDS.has("wizard-ux") && !LEGACY_IDS.has("popcornbox"));
  for (const id of ["cinequeue", "usuals", "outline-streaming-demo", "wizard-connectors", "voice-outline", "hermes-frontend-3", "smart-home"])
    assert.ok(!LEGACY_IDS.has(id), `${id} has a named successor; do not restore its exception`);
});
