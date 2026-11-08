// The product name people read is "WizardOS", one word (wizard-os#436).
// Code comments, ids, URLs and paths are not user-visible and stay as they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { storePage } from "../src/page.js";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// Lines a person or their agent can read: drop whole-line // comments and SQL/TOML comments.
const visible = (text) => text.split("\n").filter((l) => !/^\s*(\/\/|--|#)/.test(l));

test("the store page spells the product name WizardOS", () => {
  const html = storePage([]);
  assert.ok(!html.includes("Wizard OS"), "store page still says 'Wizard OS'");
  assert.match(html, /Install WizardOS/);
});

test("the install approval page, installer messages and Android onboarding spell it WizardOS", () => {
  for (const f of ["src/approve.js", "src/index.js", "src/page.js", "android.md"]) {
    const bad = visible(src(f)).filter((l) => l.includes("Wizard OS"));
    assert.deepEqual(bad, [], `${f} still shows "Wizard OS"`);
  }
  assert.match(src("src/approve.js"), /<title>Approve your WizardOS install<\/title>/);
  assert.match(src("src/index.js"), /WizardOS installer is unavailable right now/);
});
