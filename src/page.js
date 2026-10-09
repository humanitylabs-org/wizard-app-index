// Public store page: aiwizards.com/wizard-apps. Server-rendered from the index, grouped by wizard.md `category`.
// Styled with the Wizard UX tokens (wizard-ux web/core/base.css): dark space background, nebula glow,
// glass panels, violet accents, gradient launcher tiles, system font stack.

const SHELVES = [
  ["agent", "Agents", "The AI agent that does the work."],
  ["interface", "Interfaces", "Ways to talk to your agent."],
  ["app", "Apps", "Things your agent can do for you."],
  ["system", "System Apps", "Shared building blocks other apps use."],
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function card(a) {
  const initial = esc((a.name || a.id || "?").slice(0, 1).toUpperCase());
  const icon = a.logo ? `<img src="${esc(a.logo)}" alt="" loading="lazy" width="60" height="60">` : `<span class="mono">${initial}</span>`;
  const search = `${a.name} ${a.summary} ${a.publisher} ${(a.provides || []).join(" ")}`.toLowerCase();
  return `<a class="card" href="${esc(a.url)}" rel="noopener" data-search="${esc(search)}">
  <div class="icon">${icon}</div>
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
  const live = SHELVES.filter(([k]) => by[k].length);
  const shelves = live
    .map(([k, title, sub]) => `<section class="shelf" id="${k}">
  <div class="shelf-head"><h2>${title}</h2><p>${sub}</p></div>
  <div class="grid">${by[k].map(card).join("\n")}</div>
</section>`)
    .join("\n");
  const chips = live.map(([k, title]) => `<a class="chip" href="#${k}">${title}<b>${by[k].length}</b></a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#05030c">
<meta name="color-scheme" content="dark">
<title>Wizard Apps | AI Wizards</title>
<meta name="description" content="Every app you can install on your Wizard. Each one is its own open repo with a wizard.md, found automatically.">
<style>
:root{--bg:#05030c;--ink:#f3efff;--ink-2:#b9b0d8;--ink-3:#7d74a3;--line:rgba(205,190,255,.13);--line-2:rgba(205,190,255,.24);
--glass:rgba(18,12,38,.58);--glass-2:rgba(28,19,58,.72);--violet:#8f63ff;--violet-2:#b99bff;--pink:#ff5ccf;--ease:cubic-bezier(.2,.9,.25,1);color-scheme:dark}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{background:var(--bg)}
body{margin:0;min-height:100vh;color:var(--ink);font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden;background:var(--bg)}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
background:radial-gradient(60% 50% at 12% 0%,rgba(110,60,255,.22),transparent 70%),radial-gradient(50% 45% at 100% 30%,rgba(255,70,200,.10),transparent 70%),radial-gradient(70% 40% at 40% 100%,rgba(60,120,255,.12),transparent 70%)}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
header{position:sticky;top:0;z-index:10;background:rgba(8,5,18,.72);border-bottom:1px solid rgba(205,190,255,.08);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
header .wrap{display:flex;align-items:center;justify-content:space-between;height:56px}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-weight:650;letter-spacing:.01em}
.brand i{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;font-style:normal;color:#fff;background:linear-gradient(140deg,#6b46ff,#c04dff);box-shadow:0 6px 20px rgba(122,77,255,.35)}
header nav a{color:var(--ink-3);text-decoration:none;font-size:14px;padding:8px 10px;border-radius:8px}
header nav a:hover{color:var(--ink-2);background:rgba(205,190,255,.08)}
.hero{padding:56px 0 8px}
.hero h1{font-size:clamp(34px,5.5vw,52px);line-height:1.04;margin:0 0 14px;letter-spacing:-.025em;font-weight:720;
background:linear-gradient(120deg,#fff 30%,var(--violet-2) 70%,var(--pink));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{color:var(--ink-2);font-size:17px;max-width:600px;margin:0}
.tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:26px 0 6px}
.search{position:relative;flex:1 1 320px;max-width:420px}
.search svg{position:absolute;left:14px;top:50%;width:18px;height:18px;transform:translateY(-50%);color:var(--ink-2)}
.search input{width:100%;height:46px;padding:0 16px 0 42px;border-radius:14px;border:1px solid var(--line-2);background:var(--glass);color:var(--ink);font:inherit;font-size:16px;backdrop-filter:blur(10px)}
.search input::placeholder{color:var(--ink-3)}
.search input:focus{outline:none;border-color:var(--violet);box-shadow:0 0 0 3px rgba(143,99,255,.25)}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:rgba(205,190,255,.05);color:var(--ink-2);text-decoration:none;font-size:13px}
.chip b{font-weight:600;color:var(--ink-3)}
.chip:hover{border-color:var(--line-2);color:var(--ink)}
.shelf{padding:30px 0 4px;scroll-margin-top:72px}
.shelf-head{margin-bottom:14px}
.shelf-head h2{font-size:20px;font-weight:650;margin:0 0 2px}
.shelf-head p{margin:0;color:#968dbb;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.grid{grid-template-columns:1fr}.hero{padding-top:36px}header nav{display:none}.chip{min-height:44px}.search{flex-basis:100%;max-width:none}}
.card{display:flex;gap:14px;align-items:flex-start;min-height:44px;padding:16px;border-radius:18px;color:inherit;text-decoration:none;
background:var(--glass);border:1px solid var(--line);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:transform .25s var(--ease),border-color .2s,background .2s}
.card:hover{transform:translateY(-2px);border-color:var(--line-2);background:var(--glass-2)}
.card:focus-visible{outline:2px solid var(--violet);outline-offset:2px}
.icon{flex:0 0 60px;width:60px;height:60px;border-radius:16px;overflow:hidden;display:grid;place-items:center;background:linear-gradient(140deg,#6b46ff,#c04dff);box-shadow:0 8px 24px rgba(0,0,0,.35)}
.icon img{width:100%;height:100%;object-fit:cover;display:block}
.mono{font-weight:700;font-size:24px;color:#fff}
.body{flex:1;min-width:0}
.card h3{margin:2px 0 4px;font-size:16px;font-weight:650}
.card p{margin:0 0 10px;color:var(--ink-2);font-size:14px;line-height:1.45}
.meta{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:12px;color:#968dbb}
.meta span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.empty{display:none;color:var(--ink-3);padding:28px 0}
footer{margin-top:56px;padding:28px 0 calc(40px + env(safe-area-inset-bottom));border-top:1px solid var(--line);color:var(--ink-3);font-size:14px;line-height:1.65}
footer strong{color:var(--ink)}
footer code{font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink-2);background:rgba(205,190,255,.08);border:1px solid var(--line-2);border-radius:6px;padding:2px 6px}
footer a{color:var(--violet-2)}
@media (prefers-reduced-motion:reduce){.card{transition:none}.card:hover{transform:none}}
</style>
</head>
<body>
<header><div class="wrap">
  <a class="brand" href="/" aria-label="AI Wizards home"><i>✦</i>AI Wizards</a>
  <nav><a href="#agent">Agents</a><a href="#system">System</a><a href="https://apps.aiwizards.com">API</a></nav>
</div></header>
<main class="wrap">
  <section class="hero">
    <h1>Wizard Apps</h1>
    <p>Everything you can install on your Wizard. Each app is its own open repo, and new apps show up here automatically when they're published.</p>
    <div class="tools">
      <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" type="search" placeholder="Search apps" aria-label="Search apps" autocomplete="off"></label>
      <div class="chips">${chips}</div>
    </div>
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
