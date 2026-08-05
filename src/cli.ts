#!/usr/bin/env node
// cli.ts — the coherence harness entrypoint. Run from a project root:
//   node <coherence>/cli.ts <command> [options]     # no args prints every command
// It loads coherence.config.json from the cwd and operates on that project.
//
// THE COMMAND LIST IS NOT SPELLED HERE. Which verbs exist, what each takes and what each
// is for live in src/commands.ts; the usage banner and README.md's command index are both
// derived from it, and test/commands.test.ts reads the `cmd === "…"` chain below out of
// this file's AST and asserts it matches the registry exactly. Adding a branch here without
// a registry entry (or the reverse) fails the suite.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { buildGraph } from "./derive.ts";
import { renderOutline } from "./render-outline.ts";
import { renderOverview } from "./render-overview.ts";
import { renderClaude, spliceBlock, extractBlock, resolveClaudeMdPath, CLAUDE_BEGIN, CLAUDE_END } from "./render-claude.ts";
import { renderCommandsBlock, renderPhrasebookBlock, usageBanner, commandFor, COMMANDS_BEGIN, COMMANDS_END, PHRASEBOOK_BEGIN, PHRASEBOOK_END } from "./commands.ts";
import { runVerify, applyVerdicts } from "./verify.ts";
import { decompose } from "./decompose.ts";
import { drift } from "./drift.ts";
import { scaffold } from "./scaffold.ts";
import { structuralLog, changedFiles, affectedComponents } from "./structural.ts";
import { lintSinks } from "./lint-sinks.ts";
import { conventions } from "./conventions.ts";
import { mass } from "./mass.ts";
import { atlas } from "./atlas.ts";
import { contracts } from "./contracts.ts";
import { whyLint } from "./why-lint.ts";
import { runPanel } from "./panel.ts";
import { buildPromiseModel } from "./promise.ts";
import { renderContract } from "./render-contract.ts";
import { readStatus } from "./status.ts";
import { readSurface, vacuityRefusal, Unrunnable } from "./floor.ts";
import { CLAIM_FORMS, loadDictionary } from "./phrasebook.ts";
import { appendDecision, renderJournal, readJournal, resolvableConjecture, compactJournal } from "./decisions.ts";
import { runJournal } from "./journal.ts";
import {
  closeExperiment, createExperiment, experimentStats, readExperiments, renderExperiments,
  ExperimentLedgerError,
  type ExperimentActionResult, type ExperimentCriterionResult, type ExperimentLedger,
} from "./experiment.ts";
import { recordObservation, formatObserved } from "./observed.ts";
import { printHooks, reportHooks, checkHooks, installHooks, uninstallHooks, runHook } from "./hooks.ts";
import type { HookHost } from "./control.ts";
import { redundancy } from "./redundancy.ts";
import { prose } from "./prose.ts";
import { economy } from "./economy.ts";
import { signal } from "./signal.ts";
import { regulate } from "./regulate.ts";
import { formatDoctrine } from "./doctrine.ts";
import { contextFromProject, renderContext } from "./context.ts";
import { premise } from "./premise.ts";
import { calibrate, type CalibrationOutcome } from "./calibration.ts";
import { buildIndexModel, INDEX_HTML, INDEX_JSON } from "./index-model.ts";
import { renderIndex, formatIndexSummary } from "./render-index.ts";

const cmd = process.argv[2];
const argv = process.argv.slice(3);
const check = argv.includes("--check");
const fast = argv.includes("--fast");
const strict = argv.includes("--strict");
const applyIdx = argv.indexOf("--apply");
const applyPath = applyIdx >= 0 ? argv[applyIdx + 1] : null;
const sinceIdx = argv.indexOf("--since");
const since = sinceIdx >= 0 ? argv[sinceIdx + 1] : null;
// `--over` is REPEATABLE on purpose: a decision with three rejected alternatives is
// a better record than one with a comma-joined string nobody can split reliably.
// `--could-be` is repeatable for the same reason as `--over`, and for one more: the
// count of candidates IS the signal. One candidate is a hunch dressed as an inquiry.
const VALUED = new Set(["--since", "--apply", "--over", "--because", "--agent", "--job", "--file", "--for", "--session", "--branch",
  "--could-be", "--discriminated-by", "--as",
  "--value", "--baseline", "--threshold", "--unit", "--why", "--raise-cap", "--symbol", "--outcome", "--host",
  "--context", "--action", "--success", "--hypothesis", "--action-result", "--result"]);
const many = (flag: string): string[] => argv.reduce<string[]>((acc, a, i) => (a === flag && argv[i + 1] !== undefined ? [...acc, argv[i + 1]] : acc), []);
const one = (flag: string): string | null => { const v = many(flag); return v.length ? v[v.length - 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1] ?? ""));
// `--raise` lets an ADVISORY open a conjecture instead of printing one. Opt-in, never a
// default: raising WRITES to the journal, and an advisory that mutates the record as a
// side effect of a read-only report is a surprise — and a surprising write is how a
// mechanism gets switched off wholesale instead of tuned. It also keeps the pre-commit
// path, which runs `verify` for its printed output, from raising anything.
const raise = argv.includes("--raise");
const raiseCapArg = one("--raise-cap");
const raiseCap = raiseCapArg !== null && Number.isFinite(Number(raiseCapArg)) ? Number(raiseCapArg) : undefined;

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

// AN INSTRUMENT THAT CANNOT RUN REPORTS; IT DOES NOT CRASH. Every command below is a
// top-level `await`, so a throw out of any of them reached the operator as a stack trace
// and a `Node.js vX` banner — measured for `log` and `signal` in a tree that is not a git
// repository, which is a shallow CI clone or a source export, not an exotic state. A
// crash is a report that failed to say what was and was not measured; that is the same
// defect as green-by-absence, so it is answered at the same seam.
//
// TOTAL BY CONSTRUCTION: this catches every `Unrunnable` from every command, present and
// future, instead of one pre-check per caller that the next caller forgets. Exit 2 — the
// code this CLI already uses for "could not run" (`--check` with no baseline, an unknown
// verb) as distinct from 1, "ran and failed". Anything NOT an Unrunnable is a genuine
// defect in the harness and keeps its stack, because that stack is the report.
const renderUnrunnable = (e: unknown): void => {
  if (!(e instanceof Unrunnable)) { console.error(e); process.exit(1); }
  for (const line of e.report) console.error(line);
  process.exit(2);
};
process.on("uncaughtException", renderUnrunnable);
process.on("unhandledRejection", renderUnrunnable);

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

// The THIRD owned block: README.md's command index, spliced from the COMMAND registry with
// the same machinery CLAUDE.md's block uses (one splicer, two marker pairs). Part of `docs`
// and therefore of `docs --check`, which is the whole point — a generated block nothing
// verifies is WORSE than a hand-kept one, because it reads as authoritative while being one
// forgotten regeneration behind. That is the silent-no-op defect this harness hunts, and
// shipping a fresh instance of it inside the harness would be embarrassing.
//
// OPT-IN BY MARKERS, exactly like CLAUDE.md: no README, or a README without the fence pair,
// means the file is not owned — NOT that it is stale. The difference matters because `docs
// --check` runs in every consuming project, and a gate that fails on a file the project
// never opted into is a gate that gets switched off. It is not SILENT about the skip
// though: the write path says which case it took, so a missing marker pair looks like a
// missing marker pair rather than like success.
async function doCommands(): Promise<string[]> {
  const path = join(cfg.root, "README.md");
  const existing = await read(path);
  const block = renderCommandsBlock();
  const current = extractBlock(existing, { begin: COMMANDS_BEGIN, end: COMMANDS_END });
  if (check) {
    // No normalization, and none is needed: the block is a pure function of the registry —
    // no clock, no absolute path. An exact compare is a gate with no holes in it.
    if (!existing || current === null) return [];
    return current !== block ? ["README.md"] : [];
  }
  if (!existing) { console.log("commands: no README.md at the project root — nothing to own."); return []; }
  const spliced = current === null ? null : spliceBlock(existing, block, { begin: COMMANDS_BEGIN, end: COMMANDS_END });
  if (spliced === null) {
    console.log(`commands: README.md has no command-index markers. Add this pair where the derived index should live:\n\n${COMMANDS_BEGIN}\n${COMMANDS_END}\n\nEverything between them is owned by \`coherence docs\`; the authored per-command prose stays outside. File left untouched.`);
    return [];
  }
  await writeFile(path, spliced);
  console.log("commands: wrote the derived command index into README.md");
  return [];
}

// The FOURTH owned block: README.md's claim-form table, derived from the CLAIM_FORMS
// registry with the same machinery as the command index above — one splicer, its own
// marker pair, opt-in by markers, part of `docs` and `docs --check`. Same defect class,
// same fix: the hand-kept table was 8 forms while the registry carried 9.
async function doPhrasebook(): Promise<string[]> {
  const path = join(cfg.root, "README.md");
  const existing = await read(path);
  const block = renderPhrasebookBlock();
  const current = extractBlock(existing, { begin: PHRASEBOOK_BEGIN, end: PHRASEBOOK_END });
  if (check) {
    if (!existing || current === null) return [];
    return current !== block ? ["README.md (phrasebook)"] : [];
  }
  if (!existing) return []; // doCommands already reported the missing README
  const spliced = current === null ? null : spliceBlock(existing, block, { begin: PHRASEBOOK_BEGIN, end: PHRASEBOOK_END });
  if (spliced === null) {
    console.log(`phrasebook: README.md has no claim-form markers. Add this pair where the derived table should live:\n\n${PHRASEBOOK_BEGIN}\n${PHRASEBOOK_END}\n\nEverything between them is owned by \`coherence docs\`; the authored per-form notes stay outside. File left untouched.`);
    return [];
  }
  await writeFile(path, spliced);
  console.log("phrasebook: wrote the derived claim-form table into README.md");
  return [];
}

// THE FLOOR GUARDS THE GENERATORS, NOT JUST THE GRADER. `verify` refuses to grade an
// empty derivation; these commands WRITE the map, and writing a blank one is the same
// failure with a longer fuse. The incident that forced this: a mutation test gutted
// buildGraph, `contract` ran against the claimless graph and wrote promise.json with 13
// gates degraded to "unknown" — then the SOURCE was reverted, which does not re-run the
// generator, so the artifacts survived the mutation and read to the next reviewer as
// history silently vanishing (the exact signature of a claim-key erasure bug). It cost a
// real investigation to prove it was not one. A generator that overwrites a good map with
// a blank one launders a broken deriver into a committed diff.
//
// APPLIED TO `--check` TOO, deliberately, with no exemption to rot: a staleness report is
// a DIAGNOSIS, and "4 artifacts stale" sends a reader to regenerate when the truth is that
// derivation is broken. Same reading, same refusal, one less way to be misled.
//
// MATCHED THROUGH `commandFor`, which resolves ALIASES too. This read `c.name === cmd`,
// so a writing command that acquired a second spelling would have walked past the floor
// under it — no current victim (`resolve`, the only alias, writes nothing), and exactly
// the shape of thing that is cheap now and a silent hole later.
if (commandFor(cmd)?.writesArtifacts) {
  const refusal = vacuityRefusal(readSurface(await buildGraph(cfg), await readStatus(cfg)));
  if (refusal) { for (const l of refusal) console.log(l); await exit(1); }
}

if (cmd === "graph") {
  const stale = await doGraph();
  if (check) { console.log(stale.length ? `stale: ${stale.join(", ")}` : "graph current"); await exit(stale.length ? 1 : 0); }
} else if (cmd === "overview") {
  const stale = await doOverview();
  if (check) { console.log(stale.length ? `stale: ${stale.join(", ")}` : "overview current"); await exit(stale.length ? 1 : 0); }
} else if (cmd === "docs") {
  const stale = [...(await doOverview()), ...(await doGraph()), ...(await doCommands()), ...(await doPhrasebook())];
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
    if (!only.size) {
      // THE FLOOR APPLIES HERE TOO: a gutted deriver leaves a graph with no components,
      // which maps NO changed file to a component — and this early exit would then grade
      // the evisceration "nothing to check", exit 0. Same reading, same refusal.
      const refusal = vacuityRefusal(readSurface(graph, await readStatus(cfg)));
      if (refusal) { for (const l of refusal) console.log(l); await exit(1); }
      console.log(`verify (scoped): no changed files map to a component — nothing to check.`); await exit(0);
    }
    console.log(`verify (scoped to ${only.size} changed component(s)): ${[...only].join(", ")}`);
  }
  await exit(await runVerify(cfg, graph, {
    fast, only, raise, raiseCap, session: one("--session") ?? undefined, agent: one("--agent") ?? undefined,
    // `--from-report <file>`: the executable tier resolves from a report the project already
    // produced (an outer gate's suite run) instead of coherence running the suite again.
    fromReport: one("--from-report") ?? undefined,
    // `--serial-oracles`: demand one full test-pool boot PER CLAIM. Never implicit.
    serial: argv.includes("--serial-oracles"),
  }));
} else if (cmd === "log") {
  // The temporal ledger: what did refA → refB do to the invariant/boundary set.
  await exit(await structuralLog(cfg, positional[0] ?? "HEAD", positional[1] ?? null, strict));
} else if (cmd === "signal") {
  // Make novelty's zero-anchor alarm part of the CURRENT patch's acceptance function.
  // The only waiver is an explicit decision bound to a fingerprint of the patch bytes.
  const attest = argv.includes("--attest-no-invariant");
  await exit(await signal(cfg, undefined, {
    since: since ?? undefined,
    check,
    attestBecause: attest ? (one("--because") ?? "") : undefined,
    session: one("--session") ?? undefined,
    agent: one("--agent") ?? undefined,
  }));
} else if (cmd === "regulate") {
  // The first explicit regulator surface. It only reads; --check changes the exit code,
  // never the observation or the selected action. Hook delivery is deliberately a later
  // rollout step, after this selector has earned trust under direct use.
  const json = argv.includes("--json");
  const allowed = new Set(["--check", "--since", "--json", "--host"]);
  const badFlags = argv.filter((arg) => arg.startsWith("--") && !allowed.has(arg));
  const sinceCount = argv.filter((arg) => arg === "--since").length;
  const hostCount = argv.filter((arg) => arg === "--host").length;
  const invalidSince = sinceIdx >= 0 && (!since || since.startsWith("--"));
  const hostArg = one("--host");
  const invalidHost = hostCount > 0 && (hostArg !== "claude" && hostArg !== "codex");
  const badShape = positional.length > 0 || invalidSince || sinceCount > 1 || hostCount > 1 || invalidHost;
  if (badFlags.length || badShape) {
    const usage = "usage: coherence regulate [--check] [--since <ref>] [--host <claude|codex>] [--json]";
    const message = badFlags.length
      ? `unsupported flag(s) for regulate: ${badFlags.join(", ")}`
      : "regulate accepts no positional arguments, one --since value, and one claude|codex --host";
    if (json) console.log(JSON.stringify({ error: message, usage }, null, 2));
    else { console.error(message); console.error(usage); }
    await exit(2);
  }
  await exit(await regulate(cfg, undefined, {
    since: since ?? undefined,
    check,
    json,
    host: hostArg === "claude" || hostArg === "codex" ? hostArg : undefined,
  }));
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
} else if (cmd === "conjecture") {
  // ABDUCTION AS A FIRST-CLASS ENTRY. `decide` records a choice and `blocked` records an
  // impasse; this records a QUESTION — a number that surprised someone, the explanations
  // that could account for it, and the test that would tell them apart.
  //
  // `--could-be` is OPTIONAL and `--discriminated-by` is NOT, which is the opposite of
  // what it looks like it should be. Candidates are optional because the one that matters
  // most gets added for you (see `withInstrumentCandidate`). The discriminating test is
  // required because without it this is a complaint: a surprising number with no way to
  // settle it is exactly the entry that sits in a journal forever being re-noticed.
  // "unknown — no test comes to mind" is a legal and honest value; a missing flag is not.
  const observation = positional[0];
  const discriminatedBy = one("--discriminated-by");
  if (!observation || !discriminatedBy) {
    console.error('usage: coherence conjecture "<the surprising observation>" \\');
    console.error('         --could-be "<candidate explanation>" [--could-be ...] \\');
    console.error('         --discriminated-by "<the test that would separate them>" \\');
    console.error('         [--because "<why it is surprising>"] [--agent X] [--job Y] [--session S] [--file p]');
    console.error("");
    console.error('  --could-be is optional: "the instrument is wrong" is added for you when you do not');
    console.error("  name it. It is the highest-prior explanation for a surprising measurement and the");
    console.error("  one people skip — doubt the thing that produced the number before the thing it describes.");
    console.error('  --discriminated-by is required. "unknown" is a legal answer; leaving it out is not.');
    await exit(2);
  }
  const rec = appendDecision(cfg, {
    kind: "conjecture", chose: observation!, because: one("--because") ?? "",
    couldBe: many("--could-be"), discriminatedBy: discriminatedBy!,
    agent: one("--agent") ?? undefined, job: one("--job") ?? undefined,
    session: one("--session") ?? undefined, files: many("--file"),
  });
  console.log(`${rec.id}  conjecture  [${rec.agent} · ${rec.commit ?? "no-commit"}${rec.dirty ? "+dirty" : ""}]`);
  for (const c of rec.couldBe ?? []) console.log(`  could be: ${c}`);
  // Hand back the exact line that closes it. The id is the friction; printing the whole
  // command removes the excuse for leaving the question open.
  console.log(`  settle it with:  coherence resolved ${rec.id} --because "<what the test showed>" --as "<which candidate won>"`);
  await exit(0);
} else if (cmd === "observed") {
  // THE TRIGGER. The band lives in the PROJECT — a tracked-metric table that knows what
  // a notable move is, because that is domain knowledge this harness does not have. What
  // was missing was what happens NEXT: a crossed threshold printed to a terminal and was
  // gone, and there was no state at all for "moved, unexplained, not yet chased". One
  // call per row per run turns that state into an open conjecture that outlives the
  // session. Mechanism, dedupe and the case analysis are in observed.ts.
  //
  // THE EXIT CODE IS 0 FOR EVERY OBSERVATION — outside band, inside band, opened,
  // deduped, all of it. This gates nothing, exactly like the rest of the journal.
  // A MALFORMED INVOCATION IS NOT AN OBSERVATION, and it exits 2 with the other usage
  // errors: `--value banana` is not a metric within its band, and reporting it as one
  // would be a command that exits 0 and does nothing — the defect this harness hunts.
  const metric = positional[0];
  const nums = (["--value", "--baseline", "--threshold"] as const).map((f) => {
    const raw = one(f);
    return raw === null ? null : Number(raw);
  });
  if (!metric || nums.some((n) => n === null || !Number.isFinite(n))) {
    console.error('usage: coherence observed "<label>" --value <n> --baseline <n> --threshold <n> \\');
    console.error('         [--unit "<s>"] [--why "<explanation>"] [--agent A] [--job J] [--session S] [--file p]');
    console.error("");
    console.error("  --threshold is the project's own bar: the smallest move in this metric worth saying");
    console.error("  out loud. It is domain knowledge and it stays on your side of the seam.");
    console.error("  Outside the band with no --why opens a conjecture. WITH --why, the explanation is");
    console.error("  recorded instead — and if a question was already open for this label, it closes it.");
    console.error("  At most ONE open conjecture per label, however many runs report the same excursion.");
    await exit(2);
  }
  const [value, baseline, threshold] = nums as [number, number, number];
  const v = recordObservation(cfg, {
    metric: metric!, value, baseline, threshold,
    unit: one("--unit") ?? undefined, why: one("--why") ?? undefined,
  }, {
    agent: one("--agent") ?? undefined, job: one("--job") ?? undefined,
    session: one("--session") ?? undefined, files: many("--file"),
  });
  for (const line of formatObserved(v)) console.log(line);
  await exit(0);
} else if (cmd === "resolved" || cmd === "resolve") {
  // A resolution is an APPEND that points at the conjecture, exactly as a retraction
  // points at a decision — same mechanism, same cross-file reach, so the agent that
  // settles a question need not be the one that raised it.
  const id = positional[0];
  const because = one("--because");
  if (!id || !because) {
    console.error('usage: coherence resolved <id> --because "<what the discriminating test showed>" [--as "<which candidate won>"]');
    await exit(2);
  }
  // The rule (and its two distinct refusals) lives in decisions.ts, not here — see
  // `resolvableConjecture`. The CLI only prints what it is handed.
  const target = resolvableConjecture(readJournal(cfg).records, id!);
  if ("error" in target) { for (const line of target.error) console.error(line); await exit(2); }
  const rec = appendDecision(cfg, {
    kind: "resolution", chose: one("--as") ?? `(resolved: ${id})`, because: because!,
    supersedes: id!, agent: one("--agent") ?? undefined, job: one("--job") ?? undefined,
    session: one("--session") ?? undefined,
  });
  console.log(`${rec.id}  resolves ${id}`);
  await exit(0);
} else if (cmd === "dismiss") {
  // THE ESCAPE VALVE, and it has to be exactly as cheap as `resolved` or it does not work.
  // Once an advisory can raise, questions arrive faster than anyone answers them; the only
  // defence against a noisy one is a one-line way to make it go away PERMANENTLY. If that
  // line is even slightly harder to reach for than the one that answers a question, the
  // noise stays and the whole `--open` list gets skipped instead.
  //
  // IT IS NOT A RESOLUTION. `--because` here carries why this is not worth chasing, which
  // is a different fact from what a discriminating test showed — and the render keeps them
  // in different sections so a reader is never told an unanswered question has an answer.
  const id = positional[0];
  const because = one("--because");
  if (!id || !because) {
    console.error('usage: coherence dismiss <id> --because "<why this is not worth chasing>"');
    console.error("");
    console.error("  Not a resolution: it records that nobody intends to find the answer, and it renders");
    console.error("  in its own section saying so. A dismissed question never raises again — which is the");
    console.error("  point, and the reason `--because` is required rather than optional.");
    await exit(2);
  }
  const target = resolvableConjecture(readJournal(cfg).records, id!, "dismiss");
  if ("error" in target) { for (const line of target.error) console.error(line); await exit(2); }
  const rec = appendDecision(cfg, {
    kind: "dismissal", chose: `(dismissed: ${id})`, because: because!,
    supersedes: id!, agent: one("--agent") ?? undefined, job: one("--job") ?? undefined,
    session: one("--session") ?? undefined,
  });
  console.log(`${rec.id}  dismisses ${id} — it will not be raised again`);
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
  // ONE WRITE LIVES UNDER THE READ COMMAND, and it is the write whose entire contract is
  // that it changes nothing this command prints. `--compact` folds session files git ALREADY
  // HOLDS into one per (branch, month) — the motivating failure was ~20 new `.jsonl` files in
  // a single day, which is not a diff anybody reads. It tidies the working tree; it does not
  // edit the record, because the originals stay in history for `git log --follow`.
  if (argv.includes("--compact")) {
    const { code, lines } = compactJournal(cfg);
    for (const line of lines) (code === 0 ? console.log : console.error)(line);
    await exit(code);
  }
  // The read half — the artifact. Scope it to one job or one agent when five of them
  // ran; unscoped it is every decision the repo has ever recorded.
  const { text } = renderJournal(cfg, {
    job: one("--job"), agent: one("--agent"), session: one("--session"), branch: one("--branch"),
    sessions: argv.includes("--sessions"), markdown: argv.includes("--md"), brief: argv.includes("--brief"),
    // `--open` is the standing list of what this project noticed and did not chase.
    open: argv.includes("--open"),
  });
  console.log(text);
  // A HUMAN at a terminal learns the settled render has a live sibling; a pipe (an
  // agent, a script, an --md artifact) gets exactly the record and nothing else — a
  // permanent footer in piped output would be furniture in every consumer's parse.
  if (process.stdout.isTTY && !argv.includes("--md"))
    console.log("live: coherence journal — this record as a stream (⏎ drills in, c lists the open conjectures)\n");
  await exit(0);
} else if (cmd === "journal") {
  // The LIVE read over the same record `decisions` settles: entries as they land, and a
  // surf over the history — the merged timeline, or one session's stream. On a TTY it is
  // interactive; on a pipe (or --once) it prints a chronological snapshot and exits;
  // --follow is the line-mode tail. It renders and never writes, so it takes no floor.
  await exit(await runJournal(cfg, {
    follow: argv.includes("--follow"), once: argv.includes("--once"),
    job: one("--job"), agent: one("--agent"), session: one("--session"), branch: one("--branch"),
  }));
} else if (cmd === "experiment" || cmd === "plan") {
  // A plan becomes useful evidence only when its prediction is frozen before the work and
  // every declared criterion is answered afterward. The ledger derives the outcome; this
  // parser never accepts a caller-authored success/failure label.
  const json = argv.includes("--json");
  const action = positional[0] ?? "inspect";
  const explicitSession = one("--session");
  const writerSession = explicitSession ?? process.env.COHERENCE_SESSION ?? process.env.CODEX_THREAD_ID ?? null;
  const usage = [
    'usage: coherence experiment create "<hypothesis>" --context <path> --action "<step>" --success "<criterion>" --session S [--json]',
    "       coherence experiment inspect [<id>] [--open] [--session S] [--json]",
    "       coherence experiment close <id> --action-result 'a1=followed::EVIDENCE' --result 's1=met::EVIDENCE' --session S [--json]",
  ];
  const fail = async (message: string): Promise<never> => {
    if (json) console.log(JSON.stringify({ error: message, usage }, null, 2));
    else { console.error(message); for (const line of usage) console.error(line); }
    return await exit(2);
  };
  const allowed = new Map<string, Set<string>>([
    ["create", new Set(["--context", "--action", "--success", "--session", "--agent", "--job", "--json"])],
    ["inspect", new Set(["--open", "--session", "--json"])],
    ["close", new Set(["--action-result", "--result", "--session", "--agent", "--job", "--json"])],
  ]);
  if (!allowed.has(action)) await fail(`invalid experiment action: ${action}`);
  const badFlags = argv.filter((arg) => arg.startsWith("--") && !allowed.get(action)!.has(arg));
  if (badFlags.length) await fail(`unsupported flag(s) for experiment ${action}: ${badFlags.join(", ")}`);
  const valuedByAction = new Map<string, Set<string>>([
    ["create", new Set(["--context", "--action", "--success", "--session", "--agent", "--job"])],
    ["inspect", new Set(["--session"])],
    ["close", new Set(["--action-result", "--result", "--session", "--agent", "--job"])],
  ]);
  const missingValues = argv.filter((arg, index) => valuedByAction.get(action)!.has(arg)
    && (argv[index + 1] === undefined || argv[index + 1].startsWith("--")));
  if (missingValues.length) await fail(`missing value for: ${[...new Set(missingValues)].join(", ")}`);
  const repeatedSingletons = ["--session", "--agent", "--job"].filter((flag) =>
    argv.filter((arg) => arg === flag).length > 1);
  if (repeatedSingletons.length) await fail(`repeatable identity is ambiguous: ${repeatedSingletons.join(", ")}`);

  const parseResult = <T extends string>(raw: string, statuses: readonly T[], label: string): { id: string; status: T; evidence: string } => {
    const equal = raw.indexOf("=");
    const evidenceAt = raw.indexOf("::", equal + 1);
    const id = equal < 1 ? "" : raw.slice(0, equal).trim();
    const status = evidenceAt < 0 ? "" : raw.slice(equal + 1, evidenceAt).trim();
    const evidence = evidenceAt < 0 ? "" : raw.slice(evidenceAt + 2).trim();
    if (!id || !statuses.includes(status as T) || !evidence) {
      throw new ExperimentLedgerError(`${label} must be id=${statuses.join("|")}::NONEMPTY_EVIDENCE`);
    }
    return { id, status: status as T, evidence };
  };

  try {
    if (action === "create") {
      if (positional.length !== 2 || !writerSession) await fail("experiment create requires one hypothesis and an exact host session");
      const ownerSession = writerSession as string; // guarded above; async `fail` prevents TS control-flow narrowing
      const opened = createExperiment(cfg, {
        session: ownerSession,
        hypothesis: positional[1],
        predictedContext: many("--context"),
        actions: many("--action"),
        criteria: many("--success"),
        agent: one("--agent") ?? (process.env.CODEX_THREAD_ID ? "codex" : undefined),
        job: one("--job") ?? undefined,
      });
      if (json) console.log(JSON.stringify(opened, null, 2));
      else {
        console.log(`OPEN ${opened.id}  owner ${opened.session}`);
        console.log(`  hypothesis: ${opened.hypothesis}`);
        for (const item of opened.actions) console.log(`  action ${item.id}: ${item.text}`);
        for (const item of opened.criteria) console.log(`  success ${item.id}: ${item.text}`);
        const actionArgs = opened.actions.map((item) => `--action-result '${item.id}=unknown::EVIDENCE'`).join(" ");
        const criterionArgs = opened.criteria.map((item) => `--result '${item.id}=unknown::EVIDENCE'`).join(" ");
        console.log(`  close: coherence experiment close ${opened.id} ${actionArgs} ${criterionArgs} --session ${opened.session}`);
      }
      await exit(0);
    }

    if (action === "inspect") {
      if (positional.length > 2) await fail("experiment inspect accepts at most one experiment id");
      // Inspection is the merged fleet view unless the caller explicitly narrows it.
      // Ambient host identity is for attributing writes, not hiding other agents' loops.
      const opts = { id: positional[1] ?? null, session: explicitSession, openOnly: argv.includes("--open") };
      if (json) {
        const ledger = readExperiments(cfg);
        const selected = ledger.experiments.filter((experiment) =>
          (!opts.id || experiment.opened.id === opts.id)
          && (!opts.session || experiment.opened.session === opts.session || experiment.closed?.assessor.session === opts.session)
          && (!opts.openOnly || !experiment.closed));
        const scoped: ExperimentLedger = {
          records: selected.flatMap((experiment) => [experiment.opened, ...(experiment.closed ? [experiment.closed] : [])]),
          experiments: selected,
          open: selected.filter((experiment) => !experiment.closed),
          closed: selected.filter((experiment) => !!experiment.closed),
        };
        console.log(JSON.stringify({ experiments: selected, stats: experimentStats(scoped) }, null, 2));
      } else console.log(renderExperiments(cfg, opts).text);
      await exit(0);
    }

    if (positional.length !== 2 || !writerSession) await fail("experiment close requires one id and an exact assessor session");
    const assessorSession = writerSession as string; // guarded above; async `fail` prevents TS control-flow narrowing
    const actionResults = many("--action-result").map((raw) =>
      parseResult(raw, ["followed", "revised", "skipped", "unknown"] as const, "--action-result")) as ExperimentActionResult[];
    const criterionResults = many("--result").map((raw) =>
      parseResult(raw, ["met", "unmet", "unknown"] as const, "--result")) as ExperimentCriterionResult[];
    const closed = closeExperiment(cfg, {
      experiment: positional[1], session: assessorSession, actionResults, criterionResults,
      agent: one("--agent") ?? (process.env.CODEX_THREAD_ID ? "codex" : undefined),
      job: one("--job") ?? undefined,
    });
    if (json) console.log(JSON.stringify(closed, null, 2));
    else console.log(`${closed.outcome.toUpperCase()} ${closed.experiment}  ${closed.id}`);
    await exit(0);
  } catch (error) {
    if (!(error instanceof ExperimentLedgerError)) throw error;
    await fail(error.problems.join("; "));
  }
} else if (cmd === "hooks") {
  // The first control interface. `--check` remains the terse gate spelling; status keeps
  // the installation bit and runtime observation visible without conflating them. A bare
  // command remains Claude for compatibility; Codex is always an explicit host selection.
  const json = argv.includes("--json");
  const action = check ? "check" : (positional[0] ?? "print");
  const allowed = new Map<string, Set<string>>([
    ["check", new Set(["--check", "--json", "--host", "--session"])],
    ["status", new Set(["--json", "--host", "--session"])],
    ["install", new Set(["--json", "--host", "--session"])],
    ["uninstall", new Set(["--json", "--host", "--session"])],
    ["print", new Set(["--host"])],
  ]);
  const usage = "usage: coherence hooks [status|install|uninstall|print] [--check]"
    + " [--host <claude|codex>] [--session <id>] [--json]";
  const actionFlags = allowed.get(action);
  const badFlags = actionFlags
    ? argv.filter((arg) => arg.startsWith("--") && !actionFlags.has(arg))
    : [];
  const missingValues = ["--host", "--session"].filter((flag) =>
    argv.some((arg, index) => arg === flag
      && (argv[index + 1] === undefined || argv[index + 1]!.startsWith("--"))));
  const repeatedValues = ["--host", "--session"].filter((flag) =>
    argv.filter((arg) => arg === flag).length > 1);
  const hostArg = one("--host");
  const session = one("--session");
  const invalidHost = hostArg !== null && hostArg !== "claude" && hostArg !== "codex";
  const invalidSession = session === "" || session === "unknown";
  const badShape = !allowed.has(action)
    || (action === "check" && !check)
    || positional.length > 1
    || (check && positional.length > 0);
  if (badShape || badFlags.length || missingValues.length || repeatedValues.length || invalidHost || invalidSession) {
    const message = badShape ? `invalid hooks action: ${positional.join(" ") || action}`
      : badFlags.length ? `unsupported flag(s) for hooks ${action}: ${badFlags.join(", ")}`
      : missingValues.length ? `missing value for: ${missingValues.join(", ")}`
      : repeatedValues.length ? `repeated hooks selector: ${repeatedValues.join(", ")}`
      : invalidHost ? `invalid hook host: ${hostArg}; expected claude or codex`
      : "--session requires a non-empty, non-unknown id";
    if (json) console.log(JSON.stringify({ error: message, usage }, null, 2));
    else { console.error(message); console.error(usage); }
    await exit(2);
  }
  const host = (hostArg ?? "claude") as HookHost;
  if (action === "check") await exit(checkHooks(cfg, json, host, session));
  if (action === "status") await exit(reportHooks(cfg, json, host, session));
  if (action === "install") await exit(await installHooks(cfg, json, host, session));
  if (action === "uninstall") await exit(await uninstallHooks(cfg, json, host, session));
  if (action === "print") { printHooks(cfg, host); await exit(0); }
} else if (cmd === "hook") {
  // The hook BODY, so nothing has to be written to disk or kept in sync with a script.
  await exit(await runHook(cfg, positional[0] ?? ""));
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
} else if (cmd === "mass") {
  // How much machine there is, pinned: lines (total + per component), files, symbols,
  // dependency counts, and the project's own `measures`. Same ratchet mechanics as
  // conventions; baseline in <outputDir>/mass-baseline.json. `--raise` turns a growth
  // excursion into an open question instead of a line that scrolls past.
  const mode = argv.includes("--update-baseline") ? "update" : check ? "check" : "report";
  await exit(await mass(cfg, await buildGraph(cfg), mode, {
    raise, raiseCap, session: one("--session") ?? undefined, agent: one("--agent") ?? undefined,
  }));
} else if (cmd === "atlas") {
  // Trust-graded manifold; tiers derived from boundary claims, charts/crossings from config.
  // `--raise` opens an INFERENCE HAZARD (a tier-3 crossing with change traffic through it)
  // as a question instead of a line. Hazards never enter the --check verdict either way.
  await exit(await atlas(cfg, await buildGraph(cfg), check ? "check" : "render", {
    raise, raiseCap, session: one("--session") ?? undefined, agent: one("--agent") ?? undefined,
  }));
} else if (cmd === "index") {
  // THE INDEX: the one artifact addressed to the HUMAN who has been away. The other three
  // browser renders are complete dumps of one moment — every component, every claim, every
  // edge — and they go unread because a complete picture carries no attention budget and no
  // delta. This is three views and no more (MAP · JOURNAL · TRAJECTORY), each framed
  // against what the reader last saw, and it derives NOTHING: every figure on the page is a
  // reading the graph, the promise model, the run record or the journals already took.
  //
  // `index.json` is written FIRST-CLASS beside the page, and not as a debugging courtesy:
  // the render is a pure function of it (so nothing on the page is unverifiable), and its
  // `head` is the CURSOR the next run frames "since I last looked" against.
  const graph = await buildGraph(cfg);
  const model = await buildIndexModel(cfg, graph, { since, stamp });
  await writeOutputs();
  await writeFile(out(INDEX_JSON), JSON.stringify(model, null, 2) + "\n");
  await writeFile(out(INDEX_HTML), renderIndex(model));
  for (const line of formatIndexSummary(model, join(cfg.outputDir, INDEX_HTML))) console.log(line);
  await exit(0);
} else if (cmd === "panel") {
  // The operator's instrument panel: a live TUI over the graph + the status record
  // (`.coherence/status.json`). Watch mode re-runs the fast tier on change; --once
  // prints a static snapshot (also what non-TTY stdout gets).
  await exit(await runPanel(cfg, { watch: !argv.includes("--no-watch"), once: argv.includes("--once") }));
} else if (cmd === "contract") {
  // The PROMISE GRAPH: derive the PromiseModel (declared zones, graded gates, the reliance
  // double-entry) and render one self-contained _contract.html; also emit promise.json for
  // agents/tools. It embeds live grades, so it is always regenerated (no --check).
  const graph = await buildGraph(cfg);
  const model = await buildPromiseModel(cfg, graph, await readStatus(cfg));
  await writeOutputs();
  await writeFile(out("promise.json"), JSON.stringify(model, null, 2));
  await writeFile(out("_contract.html"), renderContract(model, stamp));
  console.log(`contract: ${model.components.length} component(s), ${model.zones.length} zone(s) → _contract.html`);
  await exit(0);
} else if (cmd === "context") {
  // A task packet, not a repo dump. Explicit selectors compose with a Git-derived scope.
  const scope = argv.includes("--staged") ? "staged" : argv.includes("--changed") ? "changed" : undefined;
  const symbols = many("--symbol");
  if (!positional.length && !symbols.length && !scope) {
    console.error("usage: coherence context [<file>...] [--symbol <name>] [--changed|--staged]");
    await exit(2);
  }
  const packet = contextFromProject(cfg, await buildGraph(cfg), { files: positional, symbols, scope });
  console.log(renderContext(packet));
  await exit(0);
} else if (cmd === "contracts") {
  // Producer/consumer contracts across deploy artifacts + the uncovered cross-artifact
  // surface detector. Charts analog: artifacts/contracts are config data, mechanism here.
  await exit(await contracts(cfg, await buildGraph(cfg), check ? "check" : "render"));
} else if (cmd === "redundancy") {
  // Advisory: the UNDECLARED half of parity — one enumerated domain spelled in two places
  // with nothing keeping the spellings equal. Ranked, capped, gates nothing (--all uncaps).
  // `--raise` turns the ranked pairs above the DEFAULT floor into open conjectures — never
  // the tail `--all` exposes, which is there to be judged, not recorded.
  await exit(await redundancy(cfg, await buildGraph(cfg), {
    all: argv.includes("--all"), raise, raiseCap,
    session: one("--session") ?? undefined, agent: one("--agent") ?? undefined,
  }));
} else if (cmd === "prose") {
  // Advisory: redundancy's argument applied to the surface redundancy does not scan —
  // duplicated PROSE across reading surfaces, labeled IDENTICAL vs DIVERGED (the rot
  // signal). Ranked, capped, gates nothing (--all uncaps; --raise uses the default floor).
  await exit(await prose(cfg, {
    all: argv.includes("--all"), raise, raiseCap,
    session: one("--session") ?? undefined, agent: one("--agent") ?? undefined,
  }));
} else if (cmd === "economy") {
  // Advisory: the READ side of the ledger — the context closure of a change, i.e. what a
  // reader must load to modify one thing safely. decompose/drift/mass all measure the WRITE
  // side; this is the other axis, and it always exits 0 (a closure is a cost, not a defect).
  await exit(await economy(cfg, await buildGraph(cfg), {
    raise, raiseCap, session: one("--session") ?? undefined, agent: one("--agent") ?? undefined,
  }));
} else if (cmd === "premise") {
  await exit(await premise(cfg, await buildGraph(cfg), check ? "check" : "report"));
} else if (cmd === "calibrate") {
  const raw = one("--outcome");
  if (raw !== null && raw !== "clean" && raw !== "defect") {
    console.error("usage: coherence calibrate [--outcome <clean|defect>] [--session <id>]");
    await exit(2);
  }
  await exit(await calibrate(cfg, {
    outcome: raw as CalibrationOutcome | undefined,
    session: one("--session") ?? undefined,
    graph: raw === null ? undefined : await buildGraph(cfg),
  }));
} else if (cmd === "why-lint") {
  // Advisory: ## why prose restating a mechanism a boundary claim already anchors.
  await exit(whyLint(await buildGraph(cfg), check ? "check" : "report"));
} else if (cmd === "doctrine") {
  const json = argv.includes("--json");
  const badFlags = argv.filter((arg) => arg.startsWith("--") && arg !== "--json");
  if (positional.length || badFlags.length) {
    const usage = "usage: coherence doctrine [--json]";
    const message = badFlags.length
      ? `unsupported flag(s) for doctrine: ${badFlags.join(", ")}`
      : "doctrine accepts no positional arguments";
    if (json) console.log(JSON.stringify({ error: message, usage }, null, 2));
    else { console.error(message); console.error(usage); }
    await exit(2);
  }
  for (const line of formatDoctrine(json)) console.log(line);
  await exit(0);
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
  // DERIVED, not spelled. This banner was the list's third home and the source of
  // v0.14.0's only merge conflict — two branches hand-editing one `<a|b|c>` literal. There
  // is no command-name string literal left in it: every line comes from the COMMAND
  // registry (src/commands.ts), which the totality oracle holds equal to the dispatch above.
  for (const line of usageBanner()) console.error(line);
  await exit(2);
}
