import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { indexRepo, buildSearch } from "../src/index.js";
import { parseRepo } from "../src/github.js";

// Exercise the production SQL against disposable SQLite. GitHub replies are
// explicit test fixtures; this never publishes to the live index.
function database() {
  const db = new DatabaseSync(":memory:");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((p) => p.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const env = { DB: {
    prepare(sql) { return { bind(...values) { return { sql, values }; } }; },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const result = statements.map(({ sql, values }) => db.prepare(sql).run(...values));
        db.exec("COMMIT");
        return result;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  } };
  return { db, env };
}

for (const [oldId, id, name] of [
  ["hermes-frontend-3", "hermes-desktop-in-browser", "Hermes Desktop in Browser"],
  ["smart-home", "home-assistant", "Home Assistant"],
]) {
  test(`${oldId}: republishing a renamed id replaces one repo row; a repo redirect also lists it once`, async () => {
    const { db, env } = database();
    const actualFetch = globalThis.fetch;
    const old = parseRepo(`oscarhenrycollins/${oldId}`);
    const canonical = parseRepo(`oscarhenrycollins/${id}`);
    const sha = "a".repeat(40);
    let redirected = false;
    const files = {
      "wizard.md": `---\nwizard: 0.2\nid: ${id}\nrenamed_from: [${oldId}]\nname: ${name}\ntype: view\nversion: 1.0.0\nsummary: Rename fixture.\nlicense: MIT\nsource: ${old.url}\nruntime:\n  kind: runtipi\n  config: runtipi/config.json\n  compose: runtipi/docker-compose.yml\nview:\n  path: /\n  port: 8080\n---\n`,
      "runtipi/config.json": JSON.stringify({ id, supported_architectures: ["amd64", "arm64"] }),
      "runtipi/docker-compose.yml": `services:\n  ${id}:\n    image: fixture:1\n    cap_drop: [ALL]\n`,
    };
    globalThis.fetch = async (url, options) => {
      if (options?.method === "HEAD") {
        return new Response(null, { status: redirected && url === old.url ? 301 : 200,
          headers: redirected && url === old.url ? { location: canonical.url } : {} });
      }
      if (url.endsWith(".git/info/refs?service=git-upload-pack")) {
        return new Response(`${sha} HEAD\0symref=HEAD:refs/heads/main\n${sha} refs/heads/main\n`);
      }
      for (const repo of [old, canonical]) {
        const prefix = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${sha}/`;
        if (url.startsWith(prefix)) {
          const text = files[decodeURIComponent(url.slice(prefix.length))];
          return new Response(text ?? "missing fixture", { status: text == null ? 404 : 200 });
        }
      }
      throw new Error(`unexpected fixture fetch: ${url}`);
    };
    try {
      // Seed a historical listing at the existing repo key, then re-publish.
      assert.equal((await indexRepo(env, old, { via: "fixture" })).listed, true);
      db.prepare("UPDATE apps SET app_id = ?, version = 'old' WHERE key = ?").run(oldId, old.key);
      const report = await indexRepo(env, old, { via: "fixture" });
      assert.equal(report.id, id);
      assert.equal(report.listed, true);
      assert.equal(db.prepare("SELECT count(*) AS n FROM apps WHERE listed = 1").get().n, 1);
      assert.equal(db.prepare("SELECT count(*) AS n FROM apps WHERE listed = 1 AND app_id = ?").get(oldId).n, 0);
      assert.equal(db.prepare("SELECT count(*) AS n FROM apps_fts").get().n, 1);
      // If the repo itself is renamed later, GitHub's redirect retires the old row.
      redirected = true;
      const renamed = await indexRepo(env, old, { via: "fixture" });
      assert.equal(renamed.renamed_from_repo, `oscarhenrycollins/${oldId}`);
      assert.equal(renamed.repo, `oscarhenrycollins/${id}`);
      const query = buildSearch(new URLSearchParams({ id }));
      const listed = db.prepare(query.sql).all(...query.binds);
      assert.equal(listed.length, 1);
      assert.equal(listed[0].key, canonical.key);
      assert.equal(db.prepare("SELECT count(*) AS n FROM apps_fts").get().n, 1);
      assert.equal(db.prepare("SELECT listed FROM apps WHERE key = ?").get(old.key).listed, 0);
    } finally {
      globalThis.fetch = actualFetch;
      db.close();
    }
  });
}
