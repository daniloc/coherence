#!/usr/bin/env node
// cli.ts — the coherence harness entrypoint. Run from a project root:
//   node <coherence>/cli.ts graph|overview|docs|verify [--check|--fast|--apply <file>]
// It loads coherence.config.json from the cwd and operates on that project.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { buildGraph } from "./derive.ts";
import { renderOutline } from "./render-outline.ts";
import { renderOverview } from "./render-overview.ts";
import { runVerify, applyVerdicts } from "./verify.ts";
import { onboard } from "./onboard.ts";

const cmd = process.argv[2];
const argv = process.argv.slice(3);
const check = argv.includes("--check");
const fast = argv.includes("--fast");
const applyIdx = argv.indexOf("--apply");
const applyPath = applyIdx >= 0 ? argv[applyIdx + 1] : null;

const cfg = await loadConfig(process.cwd());
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const out = (p: string) => join(cfg.root, cfg.outputDir, p);
const normStamp = (s: string) => s.replace(/<span id="stamp">[^<]*<\/span>/, '<span id="stamp"></span>');
const read = (p: string) => readFile(p, "utf8").catch(() => "");

async function writeOutputs() { await mkdir(join(cfg.root, cfg.outputDir), { recursive: true }); }

async function doGraph(): Promise<string[]> {
  const graph = await buildGraph(cfg);
  const json = JSON.stringify(graph, null, 2);
  const html = renderOutline(graph, cfg, stamp);
  if (check) {
    const stale: string[] = [];
    const nj = (s: string) => s.replace(/"generatedAt":\s*"[^"]*"/, '"generatedAt":""');
    if (nj(json) !== nj(await read(out("graph.json")))) stale.push("graph.json");
    if (normStamp(html) !== normStamp(await read(out("_graph.html")))) stale.push("_graph.html");
    return stale;
  }
  await writeOutputs();
  await writeFile(out("graph.json"), json);
  await writeFile(out("_graph.html"), html);
  const c = graph.nodes.reduce<Record<string, number>>((a, n) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a), {});
  console.log(`graph: ${c.component ?? 0} components, ${c.file ?? 0} files, ${c.symbol ?? 0} symbols`);
  return [];
}

async function doOverview(): Promise<string[]> {
  const graph = await buildGraph(cfg);
  const { html, md } = renderOverview(graph, stamp);
  if (check) {
    const stale: string[] = [];
    if (normStamp(html) !== normStamp(await read(out("_overview.html")))) stale.push("_overview.html");
    if (md + "\n" !== (await read(join(cfg.root, "AGENTS.md")))) stale.push("AGENTS.md");
    return stale;
  }
  await writeOutputs();
  await writeFile(out("_overview.html"), html);
  await writeFile(join(cfg.root, "AGENTS.md"), md + "\n");
  console.log("overview: wrote _overview.html + AGENTS.md");
  return [];
}

if (cmd === "graph") {
  const stale = await doGraph();
  if (check) { console.log(stale.length ? `stale: ${stale.join(", ")}` : "graph current"); process.exit(stale.length ? 1 : 0); }
} else if (cmd === "overview") {
  const stale = await doOverview();
  if (check) { console.log(stale.length ? `stale: ${stale.join(", ")}` : "overview current"); process.exit(stale.length ? 1 : 0); }
} else if (cmd === "docs") {
  const stale = [...(await doOverview()), ...(await doGraph())];
  if (check) { console.log(stale.length ? `stale: ${stale.join(", ")}` : "docs current"); process.exit(stale.length ? 1 : 0); }
} else if (cmd === "verify") {
  if (applyPath) process.exit(await applyVerdicts(cfg, applyPath));
  const graph = await buildGraph(cfg);
  process.exit(await runVerify(cfg, graph, { fast }));
} else if (cmd === "onboard") {
  await onboard(cfg, await buildGraph(cfg));
} else {
  console.error("usage: cli.ts graph|overview|docs|verify [--check|--fast|--apply <file>]");
  process.exit(2);
}
