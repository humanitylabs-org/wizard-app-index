// Public store page: aiwizards.com/wizard-apps. Server-rendered from the index (no client framework),
// grouped into shelves by wizard.md `category`. Fonts and wordmark come from aiwizards.com itself.

const SHELVES = [
  ["agent", "Agents", "The AI agent that does the work."],
  ["interface", "Interfaces", "Ways to talk to your agent."],
  ["app", "Apps", "Things your agent can do for you."],
  ["system", "System Apps", "Shared building blocks other apps use."],
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function card(a) {
  const initial = esc((a.name || a.id || "?").slice(0, 1).toUpperCase());
  const logo = a.logo ? `<img src="${esc(a.logo)}" alt="" loading="lazy" width="56" height="56">` : `<span class="mono">${initial}</span>`;
  return `<a class="card" href="${esc(a.url)}" rel="noopener" data-search="${esc(`${a.name} ${a.summary} ${a.publisher} ${(a.provides || []).join(" ")}`.toLowerCase())}">
  <div class="icon">${logo}</div>
  <div class="body">
    <h3>${esc(a.name)}</h3>
    <p>${esc(a.summary)}</p>
    <div class="meta"><span>${esc(a.publisher)}</span><span>v${esc(a.version)}</span></div>
  </div>
</a>`;
}

export function storePage(apps) {
  const by = Object.fromEntries(SHELVES.map(([k]) => [k, []]));
  for (const a of apps) (by[a.category] || by.app).push(a);
  const shelves = SHELVES.filter(([k]) => by[k].length)
    .map(([k, title, sub]) => `<section class="shelf" id="${k}">
  <div class="shelf-head"><h2>${title}</h2><p>${sub}</p></div>
  <div class="grid">${by[k].map(card).join("\n")}</div>
</section>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wizard Apps | AI Wizards</title>
<meta name="description" content="Every app you can install on your Wizard. Each one is its own open repo with a wizard.md, found automatically.">
<style>
@font-face{font-family:"AIW Sora";src:url("/assets/fonts/sora-latin-variable.woff2") format("woff2");font-weight:400 800;font-display:swap}
:root{--ink:#12111f;--soft:#626275;--paper:#f8f7ff;--line:#e7e2f4;--violet:#7c3dff;--radius:14px;--font:"AIW Sora",Inter,system-ui,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font);-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--line);background:#fff}
header .wrap{display:flex;align-items:center;justify-content:space-between;height:68px}
header img{width:148px;height:auto;display:block}
header a.home{color:var(--soft);text-decoration:none;font-size:14px}
.hero{padding:56px 0 24px}
.hero h1{font-size:clamp(32px,5vw,48px);line-height:1.08;margin:0 0 12px;letter-spacing:-.02em}
.hero p{color:var(--soft);font-size:17px;line-height:1.55;max-width:620px;margin:0}
.search{margin:28px 0 8px}
.search input{width:100%;max-width:420px;height:48px;border:1px solid var(--line);border-radius:12px;padding:0 16px;font:inherit;font-size:16px;background:#fff;color:var(--ink)}
.search input:focus{outline:2px solid var(--violet);outline-offset:1px}
.shelf{padding:28px 0 8px}
.shelf-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.shelf-head h2{font-size:22px;margin:0}
.shelf-head p{margin:0;color:var(--soft);font-size:14px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.grid{grid-template-columns:1fr}.hero{padding-top:36px}.shelf-head{display:block}.shelf-head p{margin-top:4px}}
html,body{overflow-x:hidden}
.card{display:flex;gap:14px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:16px;color:inherit;text-decoration:none;min-height:44px;transition:border-color .15s,box-shadow .15s}
.card:hover{border-color:var(--violet);box-shadow:0 10px 30px rgba(20,16,51,.08)}
.icon{flex:0 0 56px;width:56px;height:56px;border-radius:12px;overflow:hidden;background:#f1edff;border:1px solid var(--line);display:grid;place-items:center}
.icon img{width:100%;height:100%;object-fit:cover}
.mono{font-weight:700;font-size:22px;color:var(--violet)}
.body{flex:1;min-width:0}
.card h3{margin:2px 0 4px;font-size:16px}
.card p{margin:0 0 10px;color:var(--soft);font-size:14px;line-height:1.45}
.meta{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:12px;color:var(--soft)}
.meta span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.meta span+span::before{content:"·";margin-right:10px}
.empty{display:none;color:var(--soft);padding:24px 0}
footer{border-top:1px solid var(--line);margin-top:48px;padding:28px 0 40px;color:var(--soft);font-size:14px;line-height:1.6}
footer code{background:#fff;border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:13px}
footer a{color:var(--violet)}
</style>
</head>
<body>
<header><div class="wrap"><a href="/" aria-label="AI Wizards home"><img src="/assets/ai-wizards-wordmark.png" alt="AI Wizards"></a><a class="home" href="/">aiwizards.com</a></div></header>
<main class="wrap">
  <section class="hero">
    <h1>Wizard Apps</h1>
    <p>Everything you can install on your Wizard. Each app is its own open repo, and new apps show up here automatically when they're published.</p>
    <div class="search"><input id="q" type="search" placeholder="Search apps" aria-label="Search apps" autocomplete="off"></div>
  </section>
  ${shelves}
  <p class="empty" id="empty">No apps match that search.</p>
</main>
<footer><div class="wrap">
  <strong>Publish your own.</strong> Add a <code>wizard.md</code> to a public GitHub repo, tag it <code>wizard-app</code>, and it appears here within minutes.
  Search the same list with the API at <a href="https://apps.aiwizards.com">apps.aiwizards.com</a>.
</div></footer>
<script>
const q=document.getElementById("q"),cards=[...document.querySelectorAll(".card")],shelves=[...document.querySelectorAll(".shelf")],empty=document.getElementById("empty");
q.addEventListener("input",()=>{const t=q.value.trim().toLowerCase();let any=false;
cards.forEach(c=>{const m=!t||c.dataset.search.includes(t);c.style.display=m?"":"none";any=any||m});
shelves.forEach(s=>{s.style.display=[...s.querySelectorAll(".card")].some(c=>c.style.display!=="none")?"":"none"});
empty.style.display=any?"none":"block"});
</script>
</body>
</html>`;
}
