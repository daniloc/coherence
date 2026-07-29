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
import { renderClaude, spliceBlock, extractBlock, resolveClaudeMdPath, CLAUDE_BEGIN, CLAUDE_END } from "./render-claude.ts";
import { runVerify, applyVerdicts } from "./verify.ts";
import { onboard } from "./onboard.ts";
import { decompose } from "./decompose.ts";
import { drift } from "./drift.ts";
import { scaffold } from "./scaffold.ts";
import { structuralLog, changedFiles, affectedComponents } from "./structural.ts";
import { lintSinks } from "./lint-sinks.ts";
import { conventions } from "./conventions.ts";
import { atlas } from "./atlas.ts";
import { contracts } from "./contracts.ts";
import { whyLint } from "./why-lint.ts";
import { runPanel } from "./panel.ts";
import { buildSceneModel, deriveBaseModel, mergeSceneDiff, symbolSetsByFile, diffTally, fileStats, graphPaths, deriveOutside } from "./scene.ts";
import { renderScene } from "./render-scene.ts";
import { buildPromiseModel, derivePromiseBase, buildReview, formatLedger, graphFilePaths } from "./promise.ts";
import { renderContract } from "./render-contract.ts";
import { readStatus } from "./status.ts";
import { CLAIM_FORMS, loadDictionary } from "./phrasebook.ts";
import { appendDecision, renderJournal, readJournal } from "./decisions.ts";
import { printHooks, checkHooks, runHook } from "./hooks.ts";
import { redundancy } from "./redundancy.ts";

const cmd = process.argv[2];
const argv = process.argv.slice(3);
const check = argv.includes("--check");
const fast = argv.includes("--fast");
const strict = argv.includes("--strict");
const applyIdx = argv.indexOf("--apply");
const applyPath = applyIdx >= 0 ? argv[applyIdx + 1] : null;
const sinceIdx = argv.indexOf("--since");
const since = sinceIdx >= 0 ? argv[sinceIdx + 1] : null;
const diffIdx = argv.indexOf("--diff");
const diffRef = diffIdx >= 0 ? argv[diffIdx + 1] : null;
// `--over` is REPEATABLE on purpose: a decision with three rejected alternatives is
// a better record than one with a comma-joined string nobody can split reliably.
const VALUED = new Set(["--since", "--apply", "--diff", "--over", "--because", "--agent", "--job", "--file", "--for", "--session", "--branch"]);
const many = (flag: string): string[] => argv.reduce<string[]>((acc, a, i) => (a === flag && argv[i + 1] !== undefined ? [...acc, argv[i + 1]] : acc), []);
const one = (flag: string): string | null => { const v = many(flag); return v.length ? v[v.length - 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1] ?? ""));

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
// `_graph.html` also embeds the ABSOLUTE root in `const ABS = "..."` (it powers the
// local editor:// deep-links). Like the timestamp, that's machine-specific, so blank it
// for the freshness comparison — otherwise the committed file only ever matches the one
// machine that generated it and `--check` is perpetually stale across dev ↔ CI.
// Symbol `data-line` attrs are the third volatile field: any edit that adds/removes
// lines shifts every symbol below it, so a comment-only or above-the-symbol change
// would fail the gate despite NOT changing the graph's shape. Line numbers are a
// navigation aid, never structure, so strip them too — the gate then fails ONLY on
// real structural drift (nodes/edges/claims/boundaries), and committed graph diffs
// stop being polluted with line churn. See the same strip in `nj` for graph.json.
const normGraphHtml = (s: string) => normStamp(s)
  .replace(/const ABS = "[^"]*"/, 'const ABS = ""')
  .replace(/ data-line="\d+"/g, '');
const read = (p: string) => readFile(p, "utf8").catch(() => "");

async function writeOutputs() { await mkdir(join(cfg.root, cfg.outputDir), { recursive: true }); }

async function doGraph(): Promise<string[]> {
  const graph = await buildGraph(cfg);
  const json = JSON.stringify(graph, null, 2);
  const html = renderOutline(graph, cfg, stamp);
  if (check) {
    const stale: string[] = [];
    // Normalize the volatile fields so the gate compares only the derived graph's
    // SHAPE: generatedAt (clock), absRoot (absolute checkout path), and "line" (a
    // navigation aid — any line-shifting edit moves every symbol below it without
    // changing structure; gating on it produces false-positive staleness and noisy
    // diffs). What remains is nodes/edges/claims/boundaries — the things that matter.
    const nj = (s: string) => s
      .replace(/"generatedAt":\s*"[^"]*"/, '"generatedAt":""')
      .replace(/"absRoot":\s*"[^"]*"/, '"absRoot":""')
      .replace(/"line":\s*\d+/g, '"line":0');
    if (nj(json) !== nj(await read(out("graph.json")))) stale.push("graph.json");
    if (normGraphHtml(html) !== normGraphHtml(await read(out("_graph.html")))) stale.push("_graph.html");
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
  const { html, md } = renderOverview(graph, stamp, await loadDictionary(cfg, graph));
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
  // The authored CLAUDE.md may live OUTSIDE cfg.root (e.g. a repo root above a
  // sub-package). resolveClaudeMdPath honors cfg.claudeMdPath when set.
  const path = resolveClaudeMdPath(cfg);
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
  // Edit-loop scoping: --staged (working changes vs HEAD + untracked) or --since <ref>
  // restricts verify to the components whose dirs changed — fast reconciliation of just
  // what you touched, instead of the whole tree.
  let only: Set<string> | undefined;
  if (argv.includes("--staged") || since) {
    only = await affectedComponents(cfg, graph, changedFiles(cfg, since));
    if (!only.size) { console.log(`verify (scoped): no changed files map to a component — nothing to check.`); await exit(0); }
    console.log(`verify (scoped to ${only.size} changed component(s)): ${[...only].join(", ")}`);
  }
  await exit(await runVerify(cfg, graph, { fast, only }));
} else if (cmd === "log") {
  // The temporal ledger: what did refA → refB do to the invariant/boundary set.
  await exit(await structuralLog(cfg, positional[0] ?? "HEAD", positional[1] ?? null, strict));
} else if (cmd === "decide" || cmd === "blocked") {
  // The write half of the decision journal. Deliberately the cheapest thing in the
  // CLI to call: one shell line, no server, no session. Anything an agent has to set
  // up before it can log is a thing it will skip while it is busy.
  const chose = positional[0];
  const because = one("--because");
  if (!chose || !because) {
    console.error(cmd === "decide"
      ? 'usage: coherence decide "<what you chose>" --over "<alternative>" [--over ...] --because "<why>" [--agent X] [--job Y] [--file p]'
      : 'usage: coherence blocked "<what you could not do>" --because "<why>" [--agent X] [--job Y]');
    await exit(2);
  }
  const rec = appendDecision(cfg, {
    kind: cmd === "decide" ? "decision" : "blocked",
    chose: chose!, over: many("--over"), because: because!,
    agent: one("--agent") ?? undefined, job: one("--job") ?? undefined,
    session: one("--session") ?? undefined, files: many("--file"),
  });
  console.log(`${rec.id}  ${rec.kind}  [${rec.agent} · ${rec.commit ?? "no-commit"}${rec.dirty ? "+dirty" : ""}]`);
  await exit(0);
} else if (cmd === "retract") {
  // A retraction is an APPEND, never an edit. History is refuted here, not rewritten —
  // an entry that quietly changed its mind is indistinguishable from one that was
  // always right, and the difference is the whole value of the journal.
  const id = positional[0];
  const because = one("--because");
  if (!id || !because) { console.error('usage: coherence retract <id> --because "<what refuted it>" [--for "<what replaced it>"]'); await exit(2); }
  const known = readJournal(cfg).records.some((r) => r.id === id);
  if (!known) { console.error(`no decision ${id} in the journal — run \`coherence decisions\` to see the ids`); await exit(2); }
  const rec = appendDecision(cfg, {
    kind: "retraction", chose: one("--for") ?? `(withdrawn: ${id})`, because: because!,
    supersedes: id!, agent: one("--agent") ?? undefined, job: one("--job") ?? undefined,
    session: one("--session") ?? undefined,
  });
  console.log(`${rec.id}  retracts ${id}`);
  await exit(0);
} else if (cmd === "decisions") {
  // The read half — the artifact. Scope it to one job or one agent when five of them
  // ran; unscoped it is every decision the repo has ever recorded.
  const { text } = renderJournal(cfg, {
    job: one("--job"), agent: one("--agent"), session: one("--session"), branch: one("--branch"),
    sessions: argv.includes("--sessions"), markdown: argv.includes("--md"), brief: argv.includes("--brief"),
  });
  console.log(text);
  await exit(0);
} else if (cmd === "hooks") {
  if (check) await exit(checkHooks(cfg));
  printHooks(cfg);
  await exit(0);
} else if (cmd === "hook") {
  // The hook BODY, so nothing has to be written to disk or kept in sync with a script.
  await exit(await runHook(cfg, positional[0] ?? ""));
} else if (cmd === "onboard") {
  await onboard(cfg, await buildGraph(cfg));
} else if (cmd === "decompose") {
  await exit(await decompose(cfg, await buildGraph(cfg)));
} else if (cmd === "drift") {
  await exit(await drift(cfg, await buildGraph(cfg)));
} else if (cmd === "scaffold") {
  await exit(await scaffold(cfg, positional[0], positional[1]));
} else if (cmd === "lint-sinks") {
  // Interpolation-surface ratchet. Mechanism in the harness; SAFE patterns + scoped
  // sources in config; baseline in <outputDir>/sinks-baseline.json.
  const mode = argv.includes("--update-baseline") ? "update" : check ? "check" : "report";
  await exit(await lintSinks(cfg, mode));
} else if (cmd === "conventions") {
  // Guard-vs-contract detector + growth ratchet. Reuses the graph's boundary claims.
  const mode = argv.includes("--update-baseline") ? "update" : check ? "check" : "report";
  await exit(await conventions(cfg, await buildGraph(cfg), mode));
} else if (cmd === "atlas") {
  // Trust-graded manifold; tiers derived from boundary claims, charts/crossings from config.
  await exit(await atlas(cfg, await buildGraph(cfg), check ? "check" : "render"));
} else if (cmd === "panel") {
  // The operator's instrument panel: a live TUI over the graph + the status record
  // (`.coherence/status.json`). Watch mode re-runs the fast tier on change; --once
  // prints a static snapshot (also what non-TTY stdout gets).
  await exit(await runPanel(cfg, { watch: !argv.includes("--no-watch"), once: argv.includes("--once") }));
} else if (cmd === "scene") {
  // The persistent spatial BODY: derive the SceneModel (append-only geography, honest
  // mass, live light/heat) and render one self-contained _scene.html; also emit
  // scene.json for agents/tools. No --check — the scene embeds live light/heat, so it
  // is a dashboard, always regenerated (the STABLE part, the lots, persists in
  // <outputDir>/scene-layout.json, which is meant to be committed).
  //   --diff <ref>: a REVIEW scene — derive the base tree's model from a throwaway git
  //   worktree and merge, so change renders against the SAME geography (added/removed/
  //   changed against the base ref) instead of as text.
  const graph = await buildGraph(cfg);
  // Head content stats (tower heights) read ONCE and reused for both the model and the diff.
  const headStats = await fileStats(cfg, graph.nodes.filter((n) => n.kind === "file"));
  let model = await buildSceneModel(cfg, graph, await readStatus(cfg), headStats);
  let tail = "";
  if (diffRef) {
    let base;
    try {
      base = await deriveBaseModel(cfg, diffRef);
    } catch (e) {
      console.error(`scene --diff: ${(e as Error).message}`);
      await exit(1);
    }
    // Count the change OUTSIDE the graph (scripts/CI/docs) BEFORE the merge, then thread it
    // in — the map never silently truncates.
    const outside = deriveOutside(cfg, base!.ref, graphPaths(model, base!.model));
    const headEnd = { syms: symbolSetsByFile(graph), stats: headStats };
    model = mergeSceneDiff(model, base!.model, headEnd, base!.end, base!.ref, outside);
    const t = diffTally(model);
    const o = outside.added + outside.removed + outside.changed;
    const outTail = o ? `, ${o} outside the map` : "";
    tail = ` (diff vs ${base!.ref}: +${t.added} −${t.removed} ~${t.changed} files${outTail})`;
  }
  await writeOutputs();
  await writeFile(out("scene.json"), JSON.stringify(model, null, 2));
  await writeFile(out("_scene.html"), renderScene(model, stamp));
  console.log(`scene: ${model.components.length} lot(s) on a ${model.grid.cols}×${model.grid.rows} grid → _scene.html${tail}`);
  await exit(0);
} else if (cmd === "contract") {
  // The PROMISE GRAPH: derive the PromiseModel (declared zones, graded gates, the reliance
  // double-entry) and render one self-contained _contract.html; also emit promise.json for
  // agents/tools. Like the scene it embeds live grades, so it is always regenerated (no --check).
  const graph = await buildGraph(cfg);
  const model = await buildPromiseModel(cfg, graph, await readStatus(cfg));
  await writeOutputs();
  await writeFile(out("promise.json"), JSON.stringify(model, null, 2));
  await writeFile(out("_contract.html"), renderContract(model, stamp));
  console.log(`contract: ${model.components.length} component(s), ${model.zones.length} zone(s) → _contract.html`);
  await exit(0);
} else if (cmd === "review") {
  // The contract diffed against a base ref: derive the base tree's PromiseModel from a
  // throwaway worktree, diff, and print the event LEDGER to stdout; also write promise.json/
  // _contract.html with `review` populated so the render carries the same ledger.
  const ref = positional[0];
  if (!ref) { console.error("usage: coherence review <ref>"); await exit(2); }
  const graph = await buildGraph(cfg);
  const status = await readStatus(cfg);
  const headModel = await buildPromiseModel(cfg, graph, status);
  let base;
  try {
    base = await derivePromiseBase(cfg, ref!, status);
  } catch (e) {
    console.error(`review: ${(e as Error).message}`);
    await exit(1);
  }
  // Count the change OUTSIDE the contract (files no component owns at either end).
  const owned = new Set([...graphFilePaths(graph), ...base!.ownedPaths]);
  const outside = deriveOutside(cfg, base!.ref, owned);
  const model = buildReview(headModel, base!.model, base!.ref, outside);
  console.log(formatLedger(model));
  await writeOutputs();
  await writeFile(out("promise.json"), JSON.stringify(model, null, 2));
  await writeFile(out("_contract.html"), renderContract(model, stamp));
  await exit(0);
} else if (cmd === "contracts") {
  // Producer/consumer contracts across deploy artifacts + the uncovered cross-artifact
  // surface detector. Charts analog: artifacts/contracts are config data, mechanism here.
  await exit(await contracts(cfg, await buildGraph(cfg), check ? "check" : "render"));
} else if (cmd === "redundancy") {
  // Advisory: the UNDECLARED half of parity — one enumerated domain spelled in two places
  // with nothing keeping the spellings equal. Ranked, capped, gates nothing (--all uncaps).
  await exit(await redundancy(cfg, await buildGraph(cfg), { all: argv.includes("--all") }));
} else if (cmd === "why-lint") {
  // Advisory: ## why prose restating a mechanism a boundary claim already anchors.
  await exit(whyLint(await buildGraph(cfg), check ? "check" : "report"));
} else if (cmd === "phrasebook") {
  // The claim grammar, rendered straight from the CLAIM_FORMS registry — the generated
  // authority behind the README's hand-kept table. A line matching no form is SKIPPED
  // (dialect gap), never red — so a typo'd verb is a silent no-op; check verify's skipped count.
  console.log("The claim phrasebook — the `## works when` grammar (src/phrasebook.ts).");
  console.log("First match wins; the order below is the precedence. A line matching none is skipped (dialect gap).\n");
  for (const f of CLAIM_FORMS) {
    console.log(`● ${f.name}  [${f.tier}]`);
    console.log(`    grammar: ${f.grammar}`);
    console.log(`    example: ${f.example}`);
  }
  await exit(0);
} else {
  console.error("usage: coherence <graph|overview|docs|claude|verify|panel|scene|contract|review|log|decide|blocked|retract|decisions|hooks|hook|decompose|drift|scaffold|onboard|lint-sinks|conventions|atlas|contracts|redundancy|why-lint|phrasebook> [options]");
  console.error("  decide \"<chose>\" --over \"<alt>\" --because \"<why>\"   log one decision (append-only; gates nothing)");
  console.error("  blocked \"<what>\" --because \"<why>\"                 log what you could NOT do — first-class, not a footnote");
  console.error("  retract <id> --because \"<what refuted it>\"          withdraw a decision by appending, never by editing");
  console.error("  decisions [--job|--agent|--session|--branch|--sessions|--md|--brief]  the MERGED timeline; --brief clips rationales for scanning");
  console.error("  hooks [--check]                                     print the hooks block; --check asks whether it has ever FIRED");
  console.error("  panel [--no-watch | --once]                  live TUI over the graph + status record");
  console.error("  scene [--diff <ref>]                         persistent isometric worksite (_scene.html); --diff renders a review vs <ref>");
  console.error("  contract                                     the promise graph — graded gates + reliance ledger (_contract.html)");
  console.error("  review <ref>                                 diff the contract vs <ref>; print the event ledger");
  console.error("  verify [--fast] [--staged | --since <ref>]   scope to changed components");
  console.error("  log [<refA> [<refB>]] [--strict]             structural diff of the invariant/boundary set");
  console.error("  scaffold <boundary|component|invariant|parity> <name>");
  console.error("  lint-sinks | conventions [--check | --update-baseline]   ratchets (baseline in <outputDir>)");
  console.error("  atlas [--check]   trust-manifold render + drift gate     why-lint [--check]   ## why prose lint");
  console.error("  contracts [--check]   producer/consumer contracts across deploy artifacts + uncovered-surface detector");
  console.error("  redundancy [--all]    ADVISORY: one enumerated domain spelled twice with no parity claim tying the spellings together");
  await exit(2);
}
