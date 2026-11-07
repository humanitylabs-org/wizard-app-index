import { test } from "node:test";
import assert from "node:assert/strict";
import { storePage } from "../src/page.js";

// Shapes copied from the live index (apps.aiwizards.com/v1/search): the shell is an interface that
// `uses: [agent-service]`, a capability that the backend `wizard-agent-service` provides under a different id.
const app = (o) => ({ summary: "", publisher: "x", url: "https://example.test", tags: [], installs: 0, provides: [], uses: [], type: "service", ...o });
const LIVE = [
  app({ id: "hermes-agent", name: "Hermes Agent", category: "agent", provides: ["agent"], type: "agent" }),
  app({ id: "wizard-agent-service", name: "Wizard Agent Service", category: "system", provides: ["agent-service"], uses: ["hermes-agent"] }),
  app({ id: "wizard-ux", name: "Wizard Shell", category: "interface", provides: ["shell"], uses: ["agent-service"], type: "view" }),
  app({ id: "defleur-video", name: "DeFleur Video", category: "app", provides: ["video-editing"] }),
];

// Ids of the tiles inside one group section of the rendered page (not the embedded JSON or search rows).
function group(html, key) {
  const m = html.match(new RegExp(`<section class="lgroup" data-group="${key}">([\\s\\S]*?)</section>`));
  return m ? [...m[1].matchAll(/<button class="lapp[^"]*" type="button" data-id="([^"]+)"/g)].map((x) => x[1]) : [];
}

test("an interface that uses a capability is paired with the agent behind it, not listed under Apps", () => {
  const html = storePage(LIVE);
  assert.ok(!group(html, "app").includes("wizard-ux"), "Wizard Shell must not be in Apps");
  assert.deepEqual(group(html, "app"), ["defleur-video"]);
  assert.deepEqual(group(html, "agent"), ["hermes-agent", "wizard-ux"]);
});

test("an interface with no resolvable host is shown under System, never Apps", () => {
  const html = storePage([
    app({ id: "defleur-video", name: "DeFleur Video", category: "app" }),
    app({ id: "lonely-shell", name: "Lonely Shell", category: "interface", uses: ["nothing-provides-this"], type: "view" }),
  ]);
  assert.deepEqual(group(html, "app"), ["defleur-video"]);
  assert.deepEqual(group(html, "system"), ["lonely-shell"]);
});

test("a real app still lists under Apps and an id match wins over a capability match", () => {
  const html = storePage([
    app({ id: "files", name: "Files", category: "app", provides: ["files"] }),
    app({ id: "other", name: "Other", category: "system", provides: ["files"] }),
    app({ id: "files-ui", name: "Files UI", category: "interface", uses: ["files"], type: "view" }),
  ]);
  assert.deepEqual(group(html, "app"), ["files", "files-ui"]);
  assert.deepEqual(group(html, "system"), ["other"]);
});
