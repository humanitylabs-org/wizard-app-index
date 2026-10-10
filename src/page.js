// Public store page: aiwizards.com/wizard-apps. Server-rendered from the index as a Wizard UX launcher
// (wizard-ux web/styles.css: .search, .lgroup, .lgrid, .lapp, .lrow, .sheet, .st-row; core/base.css tokens).
// Groups come from wizard.md `category`; an interface sits in a paired cell next to the agent/app it `uses`.
// Filtering, sorting, search and the detail sheet run client-side over the embedded list (it is small).

const GROUPS = [
  ["agent", "Agents"],
  ["app", "Apps"],
  ["system", "System"],
];
const INSTALL = "curl -fsSL aiwizards.com/os.sh | bash";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const headless = (a) => a.type !== "view";
const seen = (a) => Number(a.first_seen) || Number(a.checked_at) || 0;

function icon(a) {
  const initial = esc((a.name || a.id || "?").slice(0, 1).toUpperCase());
  return a.logo ? `<img src="${esc(a.logo)}" alt="" loading="lazy" width="56" height="56">` : `<span class="mono">${initial}</span>`;
}

function tile(a) {
  return `<button class="lapp${headless(a) ? " headless" : ""}" type="button" data-id="${esc(a.id)}" data-tags="${esc((a.tags || []).join(" "))}">
<span class="ic">${icon(a)}</span><span class="nm">${esc(a.name)}</span>${a.installs > 0 ? `<small class="dl">↓ ${esc(a.installs)}</small>` : ""}</button>`;
}

// A grid cell: one app, or an agent/app with the interfaces that open it, joined by a wire.
function cell(a, ifaces) {
  const all = [a, ...ifaces];
  const keys = `data-pop="${Math.max(...all.map((x) => x.installs || 0))}" data-new="${Math.max(...all.map(seen))}" data-name="${esc(a.name.toLowerCase())}"`;
  if (!ifaces.length) return `<div class="cell" ${keys}>${tile(a)}</div>`;
  return `<div class="cell lpair n${Math.min(all.length, 4)}" ${keys}>${all.map(tile).join("")}</div>`;
}

function row(a) {
  const search = `${a.name} ${a.id} ${a.summary} ${a.publisher} ${(a.provides || []).join(" ")} ${(a.tags || []).join(" ")}`.toLowerCase();
  return `<button class="lrow" type="button" data-id="${esc(a.id)}" data-tags="${esc((a.tags || []).join(" "))}" data-search="${esc(search)}" data-pop="${a.installs || 0}" data-new="${seen(a)}" data-name="${esc(a.name.toLowerCase())}">
<span class="ic${headless(a) ? " headless" : ""}">${icon(a)}</span><span class="nm">${esc(a.name)}<small>${esc(a.summary)}</small></span></button>`;
}

// Which listed app an interface belongs next to: a direct agent/app it uses, else the agent at the end
// of its `uses` chain (interface -> service -> agent, max 4 hops), else any listed non-interface it uses.
function hostFor(a, byId) {
  const direct = (a.uses || []).map((u) => byId[u]).filter((x) => x && x.category !== "interface");
  const main = direct.find((x) => x.category === "agent" || x.category === "app");
  if (main) return main.id;
  let cur = a;
  for (let i = 0; i < 4 && cur; i++) {
    const next = (cur.uses || []).map((u) => byId[u]).find(Boolean);
    if (!next) break;
    if (next.category === "agent") return next.id;
    cur = next;
  }
  return direct[0]?.id || null;
}

export function storePage(apps) {
  const byId = Object.fromEntries(apps.map((a) => [a.id, a]));
  const by = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
  const ifacesOf = {};
  for (const a of apps) {
    if (a.category === "interface") {
      const h = hostFor(a, byId);
      if (h) {
        (ifacesOf[h] ||= []).push(a);
        continue;
      }
      by.app.push(a);
    } else (by[a.category] || by.app).push(a);
  }
  const groups = GROUPS.filter(([k]) => by[k].length)
    .map(([k, title]) => `<section class="lgroup" data-group="${k}"><h4>${title}</h4>
<div class="lgrid">${by[k].map((a) => cell(a, ifacesOf[a.id] || [])).join("\n")}</div></section>`)
    .join("\n");

  const counts = {};
  for (const a of apps) for (const t of a.tags || []) counts[t] = (counts[t] || 0) + 1;
  const tagChips = Object.entries(counts)
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([t, n]) => `<button class="chip" type="button" data-tag="${esc(t)}">${esc(t)}<b>${n}</b></button>`)
    .join("");

  const data = Object.fromEntries(apps.map((a) => [a.id, { id: a.id, name: a.name, summary: a.summary, logo: a.logo, url: a.url, tags: a.tags || [], installs: a.installs || 0, uses: a.uses || [], headless: headless(a) }]));
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, "");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#05030c">
<meta name="color-scheme" content="dark">
<title>Wizard Apps | AI Wizards</title>
<meta name="description" content="Open apps for your Wizard. Each one is its own repo with a wizard.md, found automatically.">
<style>
:root{--bg:#05030c;--ink:#f3efff;--ink-2:#b9b0d8;--ink-3:#7d74a3;--line:rgba(205,190,255,.13);--line-2:rgba(205,190,255,.24);
--glass:rgba(18,12,38,.58);--glass-2:rgba(28,19,58,.72);--violet:#8f63ff;--violet-2:#b99bff;--pink:#ff5ccf;--cyan:#3fe0ff;--green:#4ff0b0;
--ease:cubic-bezier(.2,.9,.25,1);--spring:cubic-bezier(.34,1.45,.5,1);--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color-scheme:dark}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
input{font:inherit;color:inherit}
svg{display:block}
html{background:var(--bg)}
body{margin:0;min-height:100vh;color:var(--ink);font:15px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden;background:var(--bg)}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
background:radial-gradient(60% 50% at 12% 0%,rgba(110,60,255,.22),transparent 70%),radial-gradient(50% 45% at 100% 30%,rgba(255,70,200,.10),transparent 70%),radial-gradient(70% 40% at 40% 100%,rgba(60,120,255,.12),transparent 70%)}
.wrap{max-width:920px;margin:0 auto;padding:0 18px}
header{position:sticky;top:0;z-index:10;background:rgba(8,5,18,.72);border-bottom:1px solid rgba(205,190,255,.08);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
header .wrap{display:flex;align-items:center;height:52px}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-weight:650;letter-spacing:.01em}
.brand i{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;font-style:normal;color:#fff;background:linear-gradient(140deg,#6b46ff,#c04dff);box-shadow:0 6px 20px rgba(122,77,255,.35)}
.hero{padding:30px 0 4px}
.hero h1{font-size:clamp(32px,5vw,46px);line-height:1.05;margin:0 0 6px;letter-spacing:-.025em;font-weight:720;
background:linear-gradient(120deg,#fff 30%,var(--violet-2) 70%,var(--pink));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{color:var(--ink-2);font-size:16px;margin:0}
.cmd{display:flex;align-items:center;gap:8px;max-width:440px;margin:16px 0 0;padding:6px 6px 6px 12px;border-radius:15px;background:var(--glass);border:1px solid var(--line)}
.cmd code{flex:1;min-width:0;font:12px/1.3 var(--mono);color:var(--ink-2);white-space:nowrap;overflow-x:auto;scrollbar-width:none;user-select:all;-webkit-user-select:all}
.cmd code::-webkit-scrollbar{display:none}
.lbl{display:block;margin:16px 2px 6px;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.lbl+.cmd{margin-top:0}
.copy{flex:0 0 auto;height:32px;padding:0 11px;border-radius:10px;font-size:13px;font-weight:650;background:rgba(143,99,255,.22);color:var(--ink)}
.copy:hover{background:rgba(143,99,255,.34)}
.copy.ok{background:rgba(79,240,176,.18);color:var(--green)}
.search{height:50px;margin:22px 0 10px;border-radius:17px;display:flex;align-items:center;gap:10px;padding:0 15px;background:rgba(205,190,255,.08);border:1px solid var(--line-2)}
.search:focus-within{border-color:var(--violet);box-shadow:0 0 0 3px rgba(143,99,255,.22)}
.search svg{width:18px;height:18px;fill:none;stroke:var(--ink-3);stroke-width:2.2;stroke-linecap:round;flex:0 0 auto}
.search input{flex:1;min-width:0;height:100%;background:none;border:0;outline:none;font-size:16px}
.search input::placeholder{color:var(--ink-3)}
.search input::-webkit-search-cancel-button{display:none}
.bar{display:flex;align-items:center;gap:6px;overflow-x:auto;scrollbar-width:none;overscroll-behavior-x:contain;margin:0 -18px;padding:2px 18px;scroll-padding:0 18px}
.bar::-webkit-scrollbar{display:none}
.bar::after{content:"";flex:0 0 12px}
.chips{display:contents}
@media(min-width:600px){.bar{overflow:visible;margin:0;padding:2px 0;gap:10px}.bar::after{display:none}.chips{flex:1;min-width:0;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px 26px 2px 0;scroll-padding:0 34px 0 0;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 30px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 30px),transparent)}.chips::-webkit-scrollbar{display:none}}
.chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:99px;font-size:13px;white-space:nowrap;background:rgba(205,190,255,.08);border:1px solid var(--line-2);color:var(--ink-2)}
.chip b{font-weight:650;font-size:11.5px;color:var(--ink-3)}
.chip:hover{color:var(--ink)}
.chip.on{background:rgba(143,99,255,.28);border-color:rgba(185,155,255,.5);color:var(--ink)}
.chip.on b{color:var(--violet-2)}
.sort{flex:0 0 auto;display:flex;gap:2px;margin-left:auto;padding:3px;border-radius:99px;background:rgba(205,190,255,.06);border:1px solid var(--line-2)}
.sort button{height:26px;padding:0 9px;border-radius:99px;font-size:12px;font-weight:650;color:var(--ink-3);white-space:nowrap}
.sort button.on{background:rgba(205,190,255,.14);color:var(--ink)}
.lgroup{margin:22px 0 4px}
.lgroup h4{margin:0 4px 12px;font-size:11px;font-weight:850;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.lgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px 6px}
@media(min-width:600px){.lgrid{grid-template-columns:repeat(6,1fr);gap:18px 10px}}
@media(min-width:900px){.lgrid{grid-template-columns:repeat(8,1fr)}}
.cell{display:flex;min-width:0}
.lapp{position:relative;flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px;padding:4px 0;text-align:center;border-radius:16px}
.lapp:focus-visible,.lrow:focus-visible,.chip:focus-visible,.copy:focus-visible,.sort button:focus-visible,.x:focus-visible{outline:2px solid var(--violet);outline-offset:2px}
.ic{position:relative;width:56px;height:56px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(145deg,#6b46ff,#c04dff);box-shadow:0 8px 20px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.22);transition:transform 160ms var(--spring)}
.ic img{width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block}
.mono{font-weight:750;font-size:23px;color:#fff}
.lapp:active .ic{transform:scale(.9)}
@media(hover:hover){.lapp:hover .ic{transform:translateY(-2px)}}
.headless .ic,.ic.headless{box-shadow:none;outline:1.5px dashed rgba(205,190,255,.5);outline-offset:3px}
.lapp .nm{font-size:11.5px;line-height:1.2;color:var(--ink-2);max-width:min(100%,84px);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.lapp .dl{margin-top:-3px;font-size:10px;font-weight:650;color:var(--ink-3)}
@media(min-width:600px){.ic{width:62px;height:62px;border-radius:20px}.lapp .nm{font-size:12.5px;max-width:96px}}
.lpair{gap:6px;padding:4px 6px 2px;border-radius:22px;background:rgba(205,190,255,.05);box-shadow:inset 0 0 0 1px var(--line);grid-column:span 2}
.lpair.n3{grid-column:span 3}
.lpair.n4{grid-column:span 4}
.lpair .lapp{padding:8px 0 6px}
.lpair .lapp+.lapp::before{content:"";position:absolute;top:35px;left:calc(-50% + 26px);width:calc(100% - 58px);height:2px;border-radius:2px;background:linear-gradient(90deg,var(--violet-2),var(--cyan));opacity:.85}
@media(min-width:600px){.lpair{gap:10px}.lpair .lapp+.lapp::before{top:38px;left:calc(-50% + 27px);width:calc(100% - 64px)}}
.lapp.dim{opacity:.32}
.rows{display:none;margin:10px 0 0}
.lrow{display:flex;align-items:center;gap:12px;width:100%;padding:9px 6px;border-radius:14px;text-align:left}
.lrow:hover,.lrow:active{background:rgba(205,190,255,.1)}
.lrow .ic{width:38px;height:38px;border-radius:12px;flex:0 0 auto;box-shadow:none}
.lrow .ic.headless{outline-offset:2px}
.lrow .mono{font-size:16px}
.lrow .nm{flex:1;min-width:0;font-size:15px;font-weight:600}
.lrow .nm small{display:block;font-size:12px;font-weight:500;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.searching .rows{display:block}
.searching .lgroup{display:none!important}
.none{display:none;padding:30px 10px;text-align:center;color:var(--ink-3)}
footer{margin-top:48px;padding:20px 0 calc(32px + env(safe-area-inset-bottom));border-top:1px solid rgba(205,190,255,.08);font-size:13px;color:var(--ink-3)}
footer a{color:var(--ink-2);text-decoration:none}
footer a:hover{color:var(--violet-2)}
.scrim{position:fixed;inset:0;z-index:44;background:rgba(3,1,10,.55);opacity:0;pointer-events:none;transition:opacity 300ms;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.open .scrim{opacity:1;pointer-events:auto}
.sheet{position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:46;max-height:calc(100% - 60px);overflow-y:auto;padding:0 16px 16px;border-radius:30px;
background:linear-gradient(180deg,rgba(26,16,56,.92),rgba(12,7,28,.96));border:1px solid rgba(205,190,255,.18);-webkit-backdrop-filter:blur(26px) saturate(1.5);backdrop-filter:blur(26px) saturate(1.5);
box-shadow:0 30px 80px rgba(0,0,0,.6);transform:translateY(calc(100% + 40px));opacity:0;visibility:hidden;transition:transform 480ms var(--ease),opacity 260ms,visibility 0s 480ms}
.open .sheet{transform:none;opacity:1;visibility:visible;transition:transform 480ms var(--ease),opacity 260ms}
@media(min-width:600px){.sheet{left:50%;right:auto;top:50%;bottom:auto;width:420px;transform:translate(-50%,-46%) scale(.97)}.open .sheet{transform:translate(-50%,-50%)}.grip{visibility:hidden}}
.grip{width:40px;height:4px;border-radius:99px;background:rgba(205,190,255,.3);margin:9px auto 6px}
.sh-top{display:flex;align-items:center;gap:14px;padding:6px 0 12px}
.sh-top .ic{flex:0 0 auto;width:60px;height:60px;border-radius:19px}
.sh-top h2{flex:1;min-width:0;margin:0;font-size:20px;font-weight:700;letter-spacing:-.01em}
.sh-top h2 small{display:block;margin-top:3px;font-size:14px;font-weight:450;line-height:1.35;color:var(--ink-2);letter-spacing:0}
.x{flex:0 0 auto;align-self:flex-start;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(205,190,255,.1);color:var(--ink-2)}
.x svg{width:14px;height:14px;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}
.st-row{width:100%;display:flex;align-items:center;gap:10px;min-height:52px;padding:10px 12px;margin-bottom:8px;border-radius:18px;background:var(--glass);border:1px solid var(--line);color:var(--ink);text-decoration:none}
.st-row .k{flex:0 0 48px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.st-row .v{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:6px}
.st-row code{flex:1;min-width:0;font:13px/1.3 var(--mono);color:var(--ink-2);overflow-x:auto;white-space:nowrap;scrollbar-width:none;user-select:all;-webkit-user-select:all}
.st-row code::-webkit-scrollbar{display:none}
.st-row.link b{flex:1;font-weight:600}
.st-row.link span{color:var(--ink-3);font-size:18px}
a.st-row.link:hover{border-color:var(--line-2);background:var(--glass-2)}
.pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:99px;font-size:12.5px;background:rgba(205,190,255,.08);border:1px solid var(--line);color:var(--ink-2);white-space:nowrap}
button.pill:hover{border-color:var(--line-2);color:var(--ink)}
.pill img,.pill i{width:16px;height:16px;border-radius:5px;object-fit:cover;font-style:normal;font-size:10px;font-weight:800;display:grid;place-items:center;color:#fff;background:linear-gradient(145deg,#6b46ff,#c04dff)}
@media (prefers-reduced-motion:reduce){.ic,.sheet,.scrim{transition:none!important}}
</style>
</head>
<body>
<header><div class="wrap"><a class="brand" href="/" aria-label="AI Wizards home"><i>✦</i>AI Wizards</a></div></header>
<main class="wrap" id="main">
  <section class="hero">
    <h1>Wizard Apps</h1>
    <p>Open apps for your Wizard.</p>
    <span class="lbl" id="os-l">Install Wizard OS</span>
    <div class="cmd" role="group" aria-labelledby="os-l"><code>${esc(INSTALL)}</code><button class="copy" type="button" data-copy="${esc(INSTALL)}">Copy</button></div>
  </section>
  <label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></svg>
  <input id="q" type="search" placeholder="Search apps" aria-label="Search apps" autocomplete="off" spellcheck="false"></label>
  <div class="bar" role="toolbar" aria-label="Filter and sort">
    <div class="chips"><button class="chip on" type="button" data-tag="">All<b>${apps.length}</b></button>${tagChips}</div>
    <div class="sort" role="group" aria-label="Sort"><button type="button" data-sort="pop" class="on">Popular</button><button type="button" data-sort="new">New</button><button type="button" data-sort="name">A-Z</button></div>
  </div>
  ${groups}
  <div class="rows" id="rows">${apps.map(row).join("\n")}</div>
  <p class="none" id="none">No apps match.</p>
</main>
<footer><div class="wrap">API: <a href="https://apps.aiwizards.com">apps.aiwizards.com</a></div></footer>
<div class="scrim" id="scrim"></div>
<div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-n" tabindex="-1"></div>
<script type="application/json" id="apps">${json}</script>
<script>
(function(){
var A=JSON.parse(document.getElementById("apps").textContent),d=document,body=d.body,main=d.getElementById("main");
var q=d.getElementById("q"),rows=d.getElementById("rows"),none=d.getElementById("none"),sheet=d.getElementById("sheet"),scrim=d.getElementById("scrim");
var tag="",sort="pop",last=null;
function E(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function has(el){return !tag||(" "+el.dataset.tags+" ").indexOf(" "+tag+" ")>=0}
function cmp(a,b){if(sort==="name")return a.dataset.name<b.dataset.name?-1:a.dataset.name>b.dataset.name?1:0;var k=sort==="new"?"new":"pop";return (+b.dataset[k])-(+a.dataset[k])||(a.dataset.name<b.dataset.name?-1:1)}
function order(box,sel){[].slice.call(box.querySelectorAll(sel)).sort(cmp).forEach(function(n){box.appendChild(n)})}
function apply(){
  var t=q.value.trim().toLowerCase(),any=false;
  d.querySelectorAll(".lgrid").forEach(function(g){order(g,":scope>.cell")});order(rows,":scope>.lrow");
  if(t){main.classList.add("searching");
    rows.querySelectorAll(".lrow").forEach(function(r){var m=has(r)&&r.dataset.search.indexOf(t)>=0;r.style.display=m?"":"none";any=any||m});
  }else{main.classList.remove("searching");
    d.querySelectorAll(".lgroup").forEach(function(g){var gv=false;
      g.querySelectorAll(".cell").forEach(function(c){var v=false;c.querySelectorAll(".lapp").forEach(function(a){var m=has(a);a.classList.toggle("dim",!m);v=v||m});c.style.display=v?"":"none";gv=gv||v});
      g.style.display=gv?"":"none";any=any||gv});
  }
  none.style.display=any?"none":"block";
}
q.addEventListener("input",apply);
d.querySelectorAll(".chip").forEach(function(c){c.addEventListener("click",function(){tag=c.dataset.tag;c.scrollIntoView({block:"nearest",inline:"nearest",behavior:"smooth"});d.querySelectorAll(".chip").forEach(function(x){x.classList.toggle("on",x===c)});apply()})});
d.querySelectorAll(".sort button").forEach(function(b){b.addEventListener("click",function(){sort=b.dataset.sort;d.querySelectorAll(".sort button").forEach(function(x){x.classList.toggle("on",x===b)});apply()})});
function ic(a,cls){return '<span class="ic'+(cls||"")+'">'+(a.logo?'<img src="'+E(a.logo)+'" alt="">':'<span class="mono">'+E((a.name||a.id||"?").charAt(0).toUpperCase())+'</span>')+'</span>'}
function copy(btn){var s=btn.dataset.copy,done=function(){btn.textContent="Copied";btn.classList.add("ok");setTimeout(function(){btn.textContent="Copy";btn.classList.remove("ok")},1600)};
  if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(s).then(done,fallback);else fallback();
  function fallback(){var ta=d.createElement("textarea");ta.value=s;ta.style.position="fixed";ta.style.opacity="0";body.appendChild(ta);ta.select();try{d.execCommand("copy");done()}catch(e){}ta.remove()}}
function open(id){var a=A[id];if(!a)return;if(!body.classList.contains("open"))last=d.activeElement;
  var uses=a.uses.map(function(u){var x=A[u];return x?'<button class="pill" type="button" data-open="'+E(u)+'">'+(x.logo?'<img src="'+E(x.logo)+'" alt="">':'<i>'+E(x.name.charAt(0))+'</i>')+E(x.name)+'</button>':'<span class="pill">'+E(u)+'</span>'}).join("");
  var tags=a.tags.map(function(t){return '<span class="pill">'+E(t)+'</span>'}).join("")+(a.installs>0?'<span class="pill">↓ '+E(a.installs)+'</span>':"");
  sheet.innerHTML='<div class="grip"></div><div class="sh-top">'+ic(a,a.headless?" headless":"")+'<h2 id="sh-n">'+E(a.name)+'<small>'+E(a.summary)+'</small></h2><button class="x" type="button" aria-label="Close"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2 2 12"/></svg></button></div>'
   +(tags?'<div class="st-row"><span class="k">Tags</span><span class="v">'+tags+'</span></div>':"")
   +(uses?'<div class="st-row"><span class="k">Uses</span><span class="v">'+uses+'</span></div>':"")
   +'<div class="st-row"><code>wam install '+E(a.id)+'</code><button class="copy" type="button" data-copy="wam install '+E(a.id)+'">Copy</button></div>'
   +'<a class="st-row link" href="'+E(a.url)+'" target="_blank" rel="noopener"><b>Source</b><span aria-hidden="true">↗</span></a>';
  body.classList.add("open");sheet.scrollTop=0;sheet.querySelector(".x").focus({preventScroll:true});}
function close(){if(!body.classList.contains("open"))return;body.classList.remove("open");if(last&&last.focus)last.focus({preventScroll:true})}
d.addEventListener("click",function(e){var t=e.target.closest("[data-copy]");if(t){copy(t);return}
  t=e.target.closest(".lapp,.lrow,[data-open]");if(t){open(t.dataset.open||t.dataset.id);return}
  if(e.target.closest(".x")||e.target===scrim)close()});
d.addEventListener("keydown",function(e){if(e.key==="Escape"){if(body.classList.contains("open"))close();else if(d.activeElement===q&&q.value){q.value="";apply()}}});
apply();
})();
</script>
</body>
</html>`;
}
