// render-outline.ts — Graph → the linear, collapsible outline (_graph.html).
// Pure renderer over the derived Graph. No walking, no platform/language knowledge.
import type { Config, Graph, GraphNode } from "./types.ts";

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function splitHowItWorks(md: string): { how: string; rest: string } {
  const lines = md.split("\n");
  const s = lines.findIndex((l) => /^##\s+how it works\s*$/i.test(l));
  if (s < 0) return { how: "", rest: md };
  let e = lines.length;
  for (let j = s + 1; j < lines.length; j++) if (/^##\s+/.test(lines[j])) { e = j; break; }
  return { how: lines.slice(s + 1, e).join("\n").trim(), rest: [...lines.slice(0, s), ...lines.slice(e)].join("\n").trim() };
}

function mdToHtml(md: string): string {
  const inline = (s: string) => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  let out = "";
  for (const block of md.split(/\n{2,}/)) {
    const t = block.trim();
    if (!t) continue;
    const h = /^#{2,4}\s+(.+)$/.exec(t);
    if (h) { out += `<div class="ph">${inline(h[1])}</div>`; continue; }
    if (/^\d+\.\s+/.test(t)) { out += `<ol>${t.split("\n").filter((l) => /^\d+\.\s+/.test(l)).map((l) => `<li>${inline(l.replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`; continue; }
    if (/^[-*]\s+/.test(t)) { out += `<ul class="pl">${t.split("\n").filter((l) => /^[-*]\s+/.test(l)).map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`; continue; }
    out += `<p>${inline(t.replace(/\n/g, " "))}</p>`;
  }
  return out;
}

export function renderOutline(graph: Graph, cfg: Config, stamp: string): string {
  const ENTRY = `c:${cfg.entryDir}`;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const childrenOf = (pid: string | null) => graph.nodes.filter((n) => (n.parent || null) === (pid || null));
  const ownerComp = (id: string): string => { let c: string | null = id; while (c) { const n = byId.get(c); if (n && !n.parent) return c; c = n?.parent || null; } return id; };
  const isTooling = (p?: string) => !!p && cfg.tooling.some((t) => p.startsWith(t));

  const fileDeps = (id: string) => { const g: Record<string, string[]> = {}; for (const e of graph.edges) if (e.source === id) (g[e.kind] ??= []).push(byId.get(e.target)?.label || e.target); return g; };
  const compDeps = (cid: string) => { const set = new Map<string, string>(); for (const e of graph.edges) { if (ownerComp(e.source) !== cid) continue; const t = byId.get(e.target); if (t && (t.kind === "component" || t.kind === "infra") && t.id !== cid) set.set(t.id, t.label); } return [...set.values()]; };

  const openLink = (n: GraphNode) => n.path && n.kind !== "component"
    ? `<a class="open label" data-path="${esc(n.path)}"${n.line ? ` data-line="${n.line}"` : ""}>${esc(n.label)}</a>`
    : `<span class="label">${esc(n.label)}</span>`;
  const badges = (n: GraphNode) => { let b = ""; if (n.id === ENTRY) b += `<span class="badge entry">entry</span>`; if (n.claimed) b += `<span class="badge ok">claimed</span>`; if (n.kind === "infra") b += `<span class="badge infra">infra</span>`; return b; };

  function node(n: GraphNode): string {
    const kids = childrenOf(n.id);
    const body: string[] = [];
    if (n.kind === "component" && n.sub) body.push(`<div class="intent">${esc(n.sub)}</div>`);
    if (n.prose) body.push(`<div class="prose">${mdToHtml(n.prose)}</div>`);
    if (n.why) body.push(`<div class="why"><span class="wl">why</span>${mdToHtml(n.why)}</div>`);
    if (n.claims?.length) body.push(`<div class="claims"><div class="ch">works when</div>${n.claims.map((c) => `<div class="claim">${esc(c)}${/\bresponds\b/.test(c) ? ` <span class="tier live">live</span>` : ` <span class="tier fast">fast</span>`}</div>`).join("")}</div>`);
    if (n.kind === "component") { const cd = compDeps(n.id); if (cd.length) body.push(`<div class="dep"><span class="dk">depends on</span> ${cd.map(esc).join(", ")}</div>`); }
    if (n.kind === "file") { const g = fileDeps(n.id); for (const k of ["imports", "binds", "calls"]) if (g[k]) body.push(`<div class="dep"><span class="dk ${k}">${k}</span> ${g[k].map(esc).join(", ")}</div>`); }

    let kidsHtml = "";
    if (n.kind === "component") {
      const depth = (p?: string) => (p ? p.split("/").length : 0);
      const app = kids.filter((k) => !isTooling(k.path)).sort((a, b) => depth(a.path) - depth(b.path) || a.label.localeCompare(b.label));
      const tool = kids.filter((k) => isTooling(k.path));
      kidsHtml = app.map(node).join("");
      if (tool.length) kidsHtml += `<details class="toolgroup"><summary><span class="dot k-file"></span><span class="muted">tooling · ${tool.length}</span></summary><div class="body">${tool.map(node).join("")}</div></details>`;
    } else kidsHtml = kids.map(node).join("");
    if (kidsHtml) body.push(`<div class="kids">${kidsHtml}</div>`);

    const sub = (n.kind === "file" || n.kind === "symbol") && n.sub ? `<span class="sub">${esc(n.sub)}</span>` : "";
    const row = `<span class="dot k-${n.kind}"></span>${openLink(n)}${sub}${badges(n)}`;
    if (body.length) { const open = n.id === ENTRY ? " open" : ""; return `<details class="node ${n.kind}"${open}><summary>${row}</summary><div class="body">${body.join("")}</div></details>`; }
    return `<div class="node leaf ${n.kind}"><span class="pad"></span>${row}</div>`;
  }

  const entry = byId.get(ENTRY);
  let lede = "";
  if (entry?.prose) { const sp = splitHowItWorks(entry.prose); lede = sp.how; entry.prose = sp.rest || undefined; }

  const tops = childrenOf(null).filter((n) => n.kind === "component" || n.kind === "infra")
    .sort((a, b) => (a.id === ENTRY ? -1 : b.id === ENTRY ? 1 : 0) || (a.kind === b.kind ? 0 : a.kind === "component" ? -1 : 1));
  const tree = tops.map(node).join("");
  const counts = graph.nodes.reduce<Record<string, number>>((a, n) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a), {});

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(graph.root)} — structure</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in oklab, currentColor 14%, transparent); --dim: color-mix(in oklab, currentColor 50%, transparent); --dimmer: color-mix(in oklab, currentColor 35%, transparent); }
  * { box-sizing: border-box; } body { margin: 0; font: 14px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; max-width: 860px; }
  header { display: flex; gap: 1rem; align-items: baseline; padding: .8rem 1rem; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: Canvas; flex-wrap: wrap; }
  header h1 { font: 600 1rem system-ui; margin: 0; } header .meta { color: var(--dim); font-size: .8rem; } header .spacer { flex: 1; }
  button, select { font: .8rem system-ui; padding: .25rem .5rem; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
  main { padding: .5rem 1rem 4rem; }
  details.node > summary, .toolgroup > summary { list-style: none; cursor: pointer; padding: .12rem 0; display: flex; align-items: center; gap: .4rem; }
  details.node > summary::-webkit-details-marker, .toolgroup > summary::-webkit-details-marker { display: none; }
  details.node > summary::before, .toolgroup > summary::before { content: "▸"; color: var(--dim); width: .9em; display: inline-block; transition: transform .12s; flex: none; }
  details.node[open] > summary::before, .toolgroup[open] > summary::before { transform: rotate(90deg); }
  details.node > summary:hover { background: color-mix(in oklab, currentColor 7%, transparent); border-radius: 5px; }
  .toolgroup > summary { opacity: .65; }
  .node.leaf { display: flex; align-items: center; gap: .4rem; padding: .12rem 0; } .node.leaf .pad { width: .9em; flex: none; }
  .body { margin-left: .9em; padding-left: .55rem; border-left: 1px solid var(--line); } .kids { margin-top: .1rem; }
  .label { font-weight: 500; } details.component > summary .label, .leaf.infra .label { font: 600 14px system-ui; }
  .sub { color: var(--dimmer); font-size: .8rem; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--dimmer); }
  .k-component { background: #4cae6a; } .k-file { background: var(--dim); } .k-symbol { background: transparent; border: 1px solid var(--dimmer); }
  .k-infra { background: #4f86b3; } .k-external { background: transparent; border: 1px dashed var(--dimmer); }
  .badge { font: .68rem system-ui; padding: 0 .4em; border-radius: 4px; border: 1px solid var(--line); color: var(--dim); }
  .badge.ok { color: #4cae6a; } .badge.entry { color: #c79b2a; } .badge.infra { color: #4f86b3; }
  .claims { margin: .1rem 0 .25rem; } .ch { font: .68rem system-ui; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); }
  .claim { color: var(--dim); font-size: .85rem; } .tier { font: .62rem system-ui; color: var(--dimmer); } .tier.live { color: #c79b2a; }
  .dep { font-size: .85rem; color: var(--dim); margin: .05rem 0; } .dk { font: .68rem system-ui; text-transform: uppercase; color: var(--dimmer); margin-right: .35rem; }
  .dk.binds { color: #4f86b3; } .dk.calls { color: #c79b2a; }
  a.open { color: inherit; text-decoration: none; cursor: pointer; } a.open:hover { text-decoration: underline; text-underline-offset: 2px; }
  .intent { font: 13.5px/1.5 system-ui; margin: .15rem 0 .4rem; }
  .prose { font: 13px/1.55 system-ui; color: var(--dim); margin: .1rem 0 .5rem; max-width: 68ch; } .prose p { margin: .3rem 0; }
  .prose .ph { font: 600 .78rem system-ui; color: var(--dimmer); text-transform: uppercase; margin: .6rem 0 .15rem; } .prose ul.pl { margin: .25rem 0; padding-left: 1.1rem; } .prose code { font-size: .88em; }
  .muted { color: var(--dim); font: 600 13px system-ui; }
  .lede { border: 1px solid var(--line); border-left: 3px solid #4cae6a; border-radius: 8px; padding: .7rem 1rem; margin: .3rem 0 1.2rem; max-width: 74ch; font: 13.5px/1.55 system-ui; }
  .lede .lt { font: 600 .72rem system-ui; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); margin-bottom: .4rem; } .lede ol { margin: .35rem 0; padding-left: 1.4rem; } .lede li { margin: .25rem 0; } .lede p { margin: .4rem 0 0; color: var(--dim); }
  .why { font: 13px/1.55 system-ui; margin: .15rem 0 .5rem; padding: .25rem 0 .25rem .6rem; border-left: 2px solid #c79b2a; max-width: 68ch; }
  .why .wl { font: 600 .62rem system-ui; text-transform: uppercase; letter-spacing: .06em; color: #c79b2a; margin-right: .5rem; } .why p { display: inline; margin: 0; color: var(--dim); }
</style></head>
<body>
  <header><h1>${esc(graph.root)}</h1><span class="meta">${counts.component ?? 0} components · ${counts.file ?? 0} files · ${counts.symbol ?? 0} symbols</span><span class="spacer"></span><button id="expand">expand all</button><button id="collapse">collapse all</button><label>editor <select id="editor"><option value="zed">Zed</option><option value="cursor">Cursor</option><option value="vscode">VS Code</option></select></label></header>
  <main>${lede ? `<section class="lede"><div class="lt">How it works · a request's path</div>${mdToHtml(lede)}</section>` : ""}${tree}</main>
  <footer style="padding:1rem;color:var(--dimmer);font-size:.75rem">Generated at <span id="stamp">${esc(stamp)}</span> — do not edit; run the harness.</footer>
<script>
  const ABS = ${JSON.stringify(graph.absRoot)};
  const sel = document.getElementById("editor"); sel.value = localStorage.getItem("hoist.editor") || "zed";
  function applyEditor(){ const ed = sel.value; for (const a of document.querySelectorAll("a.open")) a.href = ed + "://file/" + ABS + "/" + a.dataset.path + (a.dataset.line ? ":" + a.dataset.line : ""); }
  sel.onchange = () => { localStorage.setItem("hoist.editor", sel.value); applyEditor(); }; applyEditor();
  for (const s of document.querySelectorAll("details.node > summary")) s.addEventListener("click", (e) => { const a = e.target.closest("a.open"); if (a && a.href) { e.preventDefault(); location.href = a.href; } });
  document.getElementById("expand").onclick = () => document.querySelectorAll("details.node").forEach((d) => (d.open = true));
  document.getElementById("collapse").onclick = () => document.querySelectorAll("details.node").forEach((d) => (d.open = d.querySelector("summary .badge.entry") ? true : false));
</script>
</body></html>
`;
}
