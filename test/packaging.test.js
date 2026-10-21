import { test } from "node:test";
import assert from "node:assert/strict";
import { check, packagingProblems } from "../src/checker.js";

const read = (files) => async (p) => files[p] ?? null;
const PY = `python:3.12-alpine@sha256:${"a".repeat(64)}`;
const SOURCE = `services:\n  demo:\n    image: ${PY}\n    volumes: ['\${APP_SOURCE_DIR}/app:/app:ro', '\${APP_DATA_DIR}:/data']\n`;
const probs = (pkg, compose, files = {}) => packagingProblems(read(files), pkg, compose);

test("source app with a pinned official base and a read-only code mount passes", async () => {
  assert.deepEqual(await probs("source", SOURCE), []);
});

test("unknown package type fails", async () => {
  assert.match((await probs("docker", SOURCE))[0], /source, build or image/);
});

test("floating tags fail for every package type, env defaults included", async () => {
  for (const img of ["python:3.12-alpine", "ghcr.io/x/demo:latest", "${IMG:-ghcr.io/x/demo:0.1.0}"]) {
    assert.match((await probs("image", `services: {demo: {image: "${img}"}}`)).join(), /not pinned by digest/, img);
  }
  assert.deepEqual(await probs("image", `services: {demo: {image: "\${IMG:-ghcr.io/x/d@sha256:${"b".repeat(64)}}"}}`), []);
});

test("source apps mount their code read-only and build nothing", async () => {
  assert.match((await probs("source", SOURCE.replace(":/app:ro", ":/app"))).join(), /read-only/);
  assert.match((await probs("source", `services: {demo: {image: "${PY}"}}`)).join(), /mount their code/);
  assert.match((await probs("source", `${SOURCE}    build: .\n`)).join(), /remove build:/);
  assert.match((await probs("image", `${SOURCE}    build: .\n`)).join(), /remove build:/);
});

test("build app with pinned base and hash-locked pip passes", async () => {
  const files = {
    "app/Dockerfile": `FROM ${PY}\nCOPY requirements.txt /r.txt\nRUN apk add --no-cache ffmpeg && pip install --no-cache-dir -r /r.txt\n`,
    "app/requirements.txt": `pyyaml==6.0.3 \\\n    --hash=sha256:${"c".repeat(64)}\n`,
  };
  assert.deepEqual(await probs("build", "services:\n  demo:\n    build: {context: app}\n", files), []);
});

test("build app rejects unpinned base, unlocked pip and compile steps", async () => {
  const files = { Dockerfile: "FROM python:3.12-slim AS base\nFROM base\nRUN pip install PyYAML==6.0.3\nRUN npm ci && npm run build\n" };
  const out = (await probs("build", "services: {demo: {build: .}}", files)).join("\n");
  assert.match(out, /FROM python:3.12-slim is not pinned/);
  assert.doesNotMatch(out, /FROM base /);
  assert.match(out, /pip install is not hash-locked/);
  assert.match(out, /compiles or bundles/);
});

test("build context and dockerfile stay inside the repo", async () => {
  for (const ctx of ["/etc", "..", "${APP_SOURCE_DIR}"]) {
    assert.match((await probs("build", `services: {demo: {build: {context: "${ctx}"}}}`)).join(), /inside the repo/, ctx);
  }
  assert.match((await probs("build", `services: {demo: {build: {context: app, dockerfile: ../../x}}}`)).join(), /inside the context/);
  assert.match((await probs("build", SOURCE)).join(), /need a build:/);
});

test("check() applies rule 14 only when runtime.package is declared", async () => {
  const wiz = (pkg) => `---\nwizard: 0.2\nid: demo\nname: Demo\ntype: service\nversion: 0.1.0\nsummary: Demo.\nlicense: MIT\nsource: https://github.com/a/b\nruntime:\n  kind: runtipi\n  config: runtipi/config.json\n  compose: runtipi/docker-compose.yml\n${pkg}mcp: {path: /mcp, port: 8080}\nskill: SKILL.md\n---\n`;
  const files = (pkg) => ({
    "wizard.md": wiz(pkg),
    "runtipi/config.json": JSON.stringify({ id: "demo" }),
    "runtipi/docker-compose.yml": "services: {demo: {image: ghcr.io/x/demo:latest}}\n",
    "SKILL.md": "---\nname: demo\ndescription: d\n---\n",
  });
  const legacy = await check(read(files("")));
  assert.ok(!legacy.results.some((r) => r.rule.startsWith("packaging")));
  const declared = await check(read(files("  package: image\n")));
  const r = declared.results.find((x) => x.rule.startsWith("packaging"));
  assert.equal(r.ok, false);
  assert.match(r.detail, /not pinned by digest/);
});
