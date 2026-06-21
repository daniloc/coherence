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
import { renderClaude, spliceBlock, extractBlock, CLAUDE_BEGIN, CLAUDE_END } from "./render-claude.ts";
import { runVerify, applyVerdicts } from "./verify.ts";
import { onboard } from "./onboard.ts";
import { decompose } from "./decompose.ts";
import { drift } from "./drift.ts";
import { scaffold } from "./scaffold.ts";

const cmd = process.argv[2];
const argv = process.argv.slice(3);
const check = argv.includes("--check");
const fast = argv.includes("--fast");
const applyIdx = argv.indexOf("--apply");
const applyPath = applyIdx >= 0 ? argv[applyIdx + 1] : null;

// Exit AFTER stdout has drained. `process.exit()` terminates the process before
// asynchronously-buffered writes flush when stdout is a pipe or file (it only
// writes synchronously to a TTY) — so `coherence verify > file`, `| cat`, or any
// CI capture silently lost the entire report AND surfaced a spurious nonzero exit
// from the interrupted write. Writing an empty chunk and awaiting its callback
// guarantees the buffer flushed before we exit, identically in every stdout mode.
const exit = async (code: number): Promise<never> => {
  await new Promise<void>((res) => process.stdout.write("", () => res()));
  process.exit(code);
};

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

async function doClaude(): Promise<string[]> {
  const graph = await buildGraph(cfg);
  const block = renderClaude(graph, stamp);
  const path = join(cfg.root, "CLAUDE.md");
  const existing = await read(path);
  const current = extractBlock(existing);
  // Strip the timestamp line so a re-run isn't reported stale just for the clock.
  const normBlock = (s: string) => s.replace(/<sub>Generated at [^<]*<\/sub>/, "<sub>Generated at</sub>");
  if (check) {
    // Absent markers can't be "stale" — flag them so CI reports the file isn't wired up.
    if (current === null) return ["CLAUDE.md (no coherence fence markers)"];
    return normBlock(current) !== normBlock(block) ? ["CLAUDE.md"] : [];
  }
  if (!existing) {
    console.log(`claude: no CLAUDE.md at ${path}. Create one and add a fenced block:\n\n${CLAUDE_BEGIN}\n${CLAUDE_END}\n\nThe generated component map + invariant table go between the markers; your authored prose (why-essays, conventions) goes outside them.`);
    return [];
  }
  const spliced = spliceBlock(existing, block);
  if (spliced === null) {
    console.log(`claude: CLAUDE.md has no coherence fence markers. Add this pair where the generated block should live (e.g. just after the project intro):\n\n${CLAUDE_BEGIN}\n${CLAUDE_END}\n\nEverything between them is owned by \`coherence claude\`; everything outside stays authored. File left untouched.`);
    return [];
  }
  await writeFile(path, spliced);
  console.log("claude: wrote generated block into CLAUDE.md");
  return [];
}

if (cmd === "graph") {
  const stale = await doGraph();
  if (check) { console.log(stale.length ? `stale: ${stale.join(", ")}` : "graph current"); await exit(stale.length ? 1 : 0); }
} else if (cmd === "overview") {
  const stale = await doOverview();
  if (check) { console.log(stale.length ? `stale: ${stale.join(", ")}` : "overview current"); await exit(stale.length ? 1 : 0); }
} else if (cmd === "docs") {
  const stale = [...(await doOverview()), ...(await doGraph())];
  if (check) { console.log(stale.length ? `stale: ${stale.join(", ")}` : "docs current"); await exit(stale.length ? 1 : 0); }
} else if (cmd === "claude") {
  const stale = await doClaude();
  if (check) { console.log(stale.length ? `stale: ${stale.join(", ")}` : "CLAUDE.md current"); await exit(stale.length ? 1 : 0); }
} else if (cmd === "verify") {
  if (applyPath) await exit(await applyVerdicts(cfg, applyPath));
  const graph = await buildGraph(cfg);
  await exit(await runVerify(cfg, graph, { fast }));
} else if (cmd === "onboard") {
  await onboard(cfg, await buildGraph(cfg));
} else if (cmd === "decompose") {
  await exit(await decompose(cfg, await buildGraph(cfg)));
} else if (cmd === "drift") {
  await exit(await drift(cfg, await buildGraph(cfg)));
} else if (cmd === "scaffold") {
  await exit(await scaffold(cfg, argv[0], argv[1]));
} else {
  console.error("usage: coherence <graph|overview|docs|claude|verify|decompose|drift|scaffold|onboard> [--check|--fast|--apply <file>]");
  await exit(2);
}
