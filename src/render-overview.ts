// render-overview.ts — Graph → AGENTS.md (agent map) + _overview.html (human page).
// Consumes the derived Graph only — no second walk (the duplication is gone).
import type { Graph, GraphNode } from "./types.ts";

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function tree(graph: Graph): string[] {
  // reconstruct a folder tree from file paths; mark node dirs (components) with ●
  const nodeDirs = new Set(graph.nodes.filter((n) => n.kind === "component").map((n) => n.id.slice(2)));
  const files = graph.nodes.filter((n) => n.kind === "file").map((n) => n.path!).sort();
  type T = { dirs: Record<string, T>; files: string[] };
  const rootT: T = { dirs: {}, files: [] };
  for (const f of files) {
    const parts = f.split("/");
    let cur = rootT;
    for (let i = 0; i < parts.length - 1; i++) cur = (cur.dirs[parts[i]] ??= { dirs: {}, files: [] });
    cur.files.push(parts[parts.length - 1]);
  }
  const out: string[] = [`${graph.root}/`];
  function walk(t: T, prefix: string, dirPath: string) {
    const dirNames = Object.keys(t.dirs).sort();
    const entries = [...dirNames.map((d) => ({ d, dir: true })), ...t.files.sort().map((f) => ({ d: f, dir: false }))];
    entries.forEach((e, i) => {
      const last = i === entries.length - 1;
      const branch = last ? "└─ " : "├─ ";
      const full = dirPath ? `${dirPath}/${e.d}` : e.d;
      if (e.dir) { out.push(`${prefix}${branch}${e.d}/${nodeDirs.has(full) ? "  ●" : ""}`); walk(t.dirs[e.d], prefix + (last ? "   " : "│  "), full); }
      else out.push(`${prefix}${branch}${e.d}`);
    });
  }
  walk(rootT, "", "");
  return out;
}

export function renderOverview(graph: Graph, stamp: string): { html: string; md: string } {
  const comps = graph.nodes.filter((n) => n.kind === "component");
  const root = comps.find((c) => c.id === "c:.") ?? comps[0];
  const childrenOf = (pid: string) => graph.nodes.filter((n) => n.parent === pid);
  const counts = graph.nodes.reduce<Record<string, number>>((a, n) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a), {});
  const treeLines = tree(graph);
  const b = graph.bindings;

  // ── markdown (agent map) ──
  const md: string[] = [`# ${graph.root} — map for agents`, "", "> Generated from the spec tree by the coherence harness. Do not edit by hand.", "", root?.sub ?? "", "", "## Components", ""];
  for (const c of comps) {
    md.push(`### ${c.label}  \`${c.id.slice(2)}\``);
    if (c.sub) md.push(c.sub);
    if (c.why) md.push("", `_why:_ ${c.why.replace(/\n+/g, " ")}`);
    if (c.claims?.length) { md.push("", "_works when:_"); for (const cl of c.claims) md.push(`- ${cl}`); }
    const files = childrenOf(c.id);
    if (files.length) md.push("", `_files:_ ${files.map((f) => `\`${f.label}\``).join(", ")}`);
    md.push("");
  }
  if (b) {
    md.push("## Bindings", "");
    md.push(`- entry: \`${b.meta.entry}\`${b.meta.compat ? ` (compat \`${b.meta.compat}\`)` : ""}`);
    for (const e of b.entities) md.push(`- entity binding: \`${e.name}\` → class \`${e.className}\``);
    for (const s of b.stores) md.push(`- store: \`${s.binding}\` (${s.sub})`);
    for (const [k, v] of Object.entries(b.vars)) md.push(`- var: \`${k}\` = \`${v}\``);
    md.push("");
  }
  md.push("## Structure", "", "```", ...treeLines, "```", "");

  // ── html (human page) ──
  const section = (c: GraphNode) => {
    const files = childrenOf(c.id);
    return `<section class="card"><h2>${esc(c.label)} <span class="path">${esc(c.id.slice(2))}</span></h2>
      ${c.sub ? `<p class="intent">${esc(c.sub)}</p>` : ""}
      ${c.why ? `<div class="why"><span class="wl">why</span> ${esc(c.why.replace(/\n+/g, " "))}</div>` : ""}
      ${c.claims?.length ? `<h3>works when</h3><ul class="mono">${c.claims.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${files.length ? `<h3>files</h3><ul class="mono">${files.map((f) => `<li>${esc(f.label)} <span class="dim">${esc(f.sub ?? "")}</span></li>`).join("")}</ul>` : ""}
    </section>`;
  };
  const bindingsHtml = b ? `<section class="card"><h2>Bindings</h2><table>
    <tr><th>entry</th><td><code>${esc(b.meta.entry)}</code> ${esc(b.meta.compat)}</td></tr>
    ${b.entities.map((e) => `<tr><th>entity</th><td><code>${esc(e.name)}</code> → <code>${esc(e.className)}</code></td></tr>`).join("")}
    ${b.stores.map((s) => `<tr><th>store</th><td><code>${esc(s.binding)}</code> · ${esc(s.sub)}</td></tr>`).join("")}
    ${Object.entries(b.vars).map(([k, v]) => `<tr><th>var</th><td><code>${esc(k)}</code> = <code>${esc(String(v))}</code></td></tr>`).join("")}
  </table></section>` : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(graph.root)} — overview</title>
<style>
  :root { color-scheme: light dark; --line: color-mix(in oklab, currentColor 15%, transparent); --dim: color-mix(in oklab, currentColor 55%, transparent); }
  body { margin: 0 auto; max-width: 70ch; padding: 1.5rem; font: 15px/1.6 system-ui, sans-serif; }
  h1 { margin: 0 0 .25rem; } .lede { color: var(--dim); margin: 0 0 1.5rem; }
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 1rem 1.25rem; margin: 1rem 0; }
  .card h2 { margin: 0 0 .25rem; font-size: 1.15rem; } .path { font: .8rem ui-monospace, monospace; color: var(--dim); }
  .intent { margin: .25rem 0 .5rem; } h3 { font-size: .75rem; text-transform: uppercase; color: var(--dim); margin: .75rem 0 .25rem; }
  ul { margin: 0; padding-left: 1.1rem; } ul.mono li { font: .85rem ui-monospace, monospace; } .dim { color: var(--dim); font-size: .85em; }
  .why { border-left: 2px solid #c79b2a; padding-left: .6rem; font: 13.5px/1.5 system-ui; color: var(--dim); margin: .35rem 0; }
  .why .wl { font: 600 .62rem system-ui; text-transform: uppercase; color: #c79b2a; margin-right: .4rem; }
  table { border-collapse: collapse; } th { text-align: left; padding: .2rem .75rem .2rem 0; color: var(--dim); font-weight: 500; vertical-align: top; }
  pre { font: .85rem ui-monospace, monospace; background: color-mix(in oklab, currentColor 5%, transparent); padding: 1rem; border-radius: 8px; overflow-x: auto; }
  footer { color: var(--dim); font-size: .8rem; margin-top: 2rem; }
</style></head><body>
  <h1>${esc(graph.root)}</h1><p class="lede">${esc(root?.sub ?? "")}</p>
  <p style="color:var(--dim);font-size:.85rem">${counts.component ?? 0} components · ${counts.file ?? 0} files · ${counts.symbol ?? 0} symbols</p>
  ${comps.map(section).join("")}
  ${bindingsHtml}
  <section class="card"><h2>Structure</h2><pre>${esc(treeLines.join("\n"))}</pre><p style="color:var(--dim);font-size:.85rem">● marks a node (a folder with a <code>*.spec.md</code>).</p></section>
  <footer>Generated at <span id="stamp">${esc(stamp)}</span> — do not edit; run the harness.</footer>
</body></html>
`;
  return { html, md: md.join("\n") };
}
