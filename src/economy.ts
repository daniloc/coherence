// economy.ts — THE READ SIDE OF THE WORK LEDGER: the CONTEXT CLOSURE of a change.
//
// WHY THIS FILE EXISTS. Everything else here measures the WRITE side. `decompose` grades
// how well co-change stays inside one component; `drift` shows which way that grade is
// moving; `mass` pins how much machine there is. All three answer "what did changing this
// cost to WRITE". None of them answers the question a reader of an agent-built repo pays
// for every single day: TO CHANGE ONE THING SAFELY, HOW MUCH DO I HAVE TO LOAD FIRST?
//
// That is a different quantity and it moves independently. A repo can hold perfect
// locality — every commit inside one component — and still demand that a modifier read
// nine files, because the component's own files all reach through one hub. Locality is a
// property of the boundary; closure is a property of the neighbourhood inside it.
//
// THE DEFINITION, and every part of it is a choice this module has to defend:
//
//   closure(commit) = the commit's touched files that the GRAPH knows
//                   ∪ their direct import neighbours, BOTH DIRECTIONS
//                   ∪ the spec files of the components those files belong to
//
// BOTH DIRECTIONS is the load-bearing half. A safe modifier must know what the touched
// file depends on (or the edit is written against imagined behaviour) AND who depends on
// the touched file (or the edit is a silent breaking change). An importers-only or
// imports-only closure measures half a reading and would report a hub as cheap.
//
// TWO APPROXIMATIONS, BOTH NAMED IN THE REPORT ITSELF (mass.ts:250-258's precedent — a
// number whose universe is not the reader's must say so on the line):
//
//   1. LINE COUNTS COME FROM THE CURRENT TREE. A file's size two hundred commits ago is
//      knowable — one `git show` per file per commit — and the advisory does not turn on
//      it. What it turns on is the RANK: which changes demanded the most context, and
//      which files sit in everybody's closure. Those survive the approximation.
//   2. THE UNIVERSE IS THE GRAPH. A commit that touched only docs, config or a lockfile
//      contributes NO closure — absence, not a zero. A zero would say "this change was
//      free to read", which is a claim about a change this instrument never saw.
//
// IT IS AN ADVISORY AND IT ALWAYS EXITS 0. Closure is a COST, not a defect: a project
// whose specs are worth reading has a larger closure than one with no specs at all, and
// the second is not healthier. What the numbers are for is the trend and the outliers.
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { Config, Graph } from "./types.ts";
import { BULK, bucketize, gitPrefix, readCommitLog, rebaseCommits, type Commit } from "./evolution.ts";
import { componentMap } from "./decompose.ts";
import { fileStats } from "./tree.ts";
import { findSpec } from "./walk.ts";
import { recordEconomy } from "./status.ts";
import { readJournal } from "./decisions.ts";
import { raiseFindings, formatRaise, type Finding } from "./raise.ts";
import { spark } from "./drift.ts";

/** History window. Matches drift's and mass's — the same recent past, read ONCE per process
 *  through the shared evolution memo (`<root>|400`), so a session that ran either of those
 *  pays no second git call here. Closure is a TRAJECTORY instrument, not all-time
 *  archaeology: 400 commits is ~50 concern-carrying ones per trend bucket. */
const HIST = 400;
const BUCKETS = 8;      // trajectory windows, oldest → newest
const TOP_COMMITS = 5;  // worst closures listed
const TOP_FILES = 8;    // read-side hubs listed
const TOP_COMPS = 5;    // components listed in the per-component table
/** A file in HALF the recent closures is a read-side hub: nearly every change makes you
 *  load it. High on purpose — this floor decides what becomes a QUESTION in the journal,
 *  and a hub advisory that fires at 20% is a list, not a finding. */
const HUB_SHARE_FLOOR = 0.5;
/** No hub finding below this many closures. A path in 2 of 3 commits is 67% and means
 *  nothing; the share only becomes a claim once there is a sample behind it. */
const MIN_CONSIDERED = 12;

// ── the pure layer (commit-injectable, per decompose.ts's `analyze` seam) ──────────────

/**
 * The import graph as an UNDIRECTED adjacency map over file paths. Both endpoints must be
 * file nodes (`f:`-prefixed) — the exact filter decompose.ts:77 applies — so external
 * modules and infra bindings never enter a closure: `node:fs` is not something a reader
 * loads to make a change safely.
 */
export function importAdjacency(graph: Graph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => { (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b); };
  for (const e of graph.edges) {
    if (e.kind !== "imports" || !e.source.startsWith("f:") || !e.target.startsWith("f:")) continue;
    const s = e.source.slice(2), t = e.target.slice(2);
    if (s === t) continue;
    link(s, t);
    link(t, s);   // both directions: a modifier must know its dependents as well as its dependencies
  }
  return adj;
}

/** One commit's reading cost. `members` is the CODE-file set only; `comps` names the
 *  components whose specs were added on top, so the two halves of `files`/`lines` stay
 *  separable by anything that reads a Closure later. */
export interface Closure {
  hash: string; subject: string;
  files: number; lines: number;
  members: Set<string>; comps: string[];
}

/**
 * The closure of one commit, or NULL when nothing it touched is in the graph.
 *
 * NULL, NOT AN EMPTY CLOSURE. A commit that moved only the README contributes no reading
 * cost this instrument can speak about, and folding it in as a 0 would drag every median
 * toward a number describing changes the graph never saw.
 *
 * `commit.files` arrive ALREADY REBASED to cfg.root (evolution.ts's `rebaseCommits`), so
 * the paths compare directly against graph paths — the v0.19.1 subdirectory regression,
 * which read a measured 0% where the design wanted a true share or nothing at all.
 */
export function closureOf(
  c: Commit,
  adj: Map<string, Set<string>>,
  fileSet: Set<string>,
  fileComp: Map<string, string>,
  linesOf: (path: string) => number,
  specLinesOf: (label: string) => number | undefined,
): Closure | null {
  const members = new Set<string>();
  for (const f of c.files) if (fileSet.has(f)) members.add(f);
  if (!members.size) return null;
  // The neighbours of what was TOUCHED — not the transitive closure of the neighbourhood.
  // One hop is what a modifier actually reads; two hops is the whole repo on any real graph.
  for (const f of [...members]) for (const n of adj.get(f) ?? []) if (fileSet.has(n)) members.add(n);
  const comps: string[] = [];
  for (const m of members) { const l = fileComp.get(m); if (l && !comps.includes(l)) comps.push(l); }
  const specComps = comps.filter((l) => specLinesOf(l) !== undefined);
  let lines = 0;
  for (const m of members) lines += linesOf(m);
  for (const l of specComps) lines += specLinesOf(l) ?? 0;
  return { hash: c.hash, subject: c.subject, files: members.size + specComps.length, lines, members, comps };
}

/** Median + p90 over the closure set. p90 is the `ceil(0.9n) - 1`th value of the ascending
 *  sort — a real observation rather than an interpolation, so every number the report
 *  prints is a closure that actually happened. */
export function economyStats(cs: Closure[]): { medianFiles: number; medianLines: number; p90Files: number; p90Lines: number } {
  const asc = (f: (c: Closure) => number) => cs.map(f).sort((a, b) => a - b);
  const median = (v: number[]) => (!v.length ? 0 : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2);
  const p90 = (v: number[]) => (!v.length ? 0 : v[Math.max(0, Math.ceil(0.9 * v.length) - 1)]);
  const f = asc((c) => c.files), l = asc((c) => c.lines);
  return { medianFiles: median(f), medianLines: median(l), p90Files: p90(f), p90Lines: p90(l) };
}

/** Median closure FILES per window, OLDEST → NEWEST. Closures arrive newest-first from git
 *  and are reversed before bucketing — the same orientation locDeltaSeries uses, because a
 *  trend that reads right-to-left in one report and left-to-right in another is a trap. */
export function closureSeries(cs: Closure[], buckets = BUCKETS): number[] {
  const oldestFirst = [...cs].reverse();
  return bucketize(oldestFirst, buckets).map((b) => {
    const v = b.map((c) => c.files).sort((a, x) => a - x);
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  });
}

/** How many closures each path appears in — the read-side hub count. Cheap enough that the
 *  table renders unconditionally; the raise findings are a slice of this same map, so what
 *  is printed and what becomes a question can never describe different files. */
export function fileAttribution(cs: Closure[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cs) for (const m of c.members) out.set(m, (out.get(m) ?? 0) + 1);
  return out;
}

/**
 * A read-side hub as a QUESTION. The subject is the BARE PATH — no count, no share, no rank
 * — so a second run after ten more commits does not mint a second question about the same
 * file (raise.ts's identity doctrine: a key carrying a magnitude is the volatile-identity
 * failure, spelled out).
 */
export function economyFindings(attr: Map<string, number>, considered: number): Finding[] {
  if (considered < MIN_CONSIDERED) return [];
  return [...attr.entries()]
    .filter(([, n]) => n / considered >= HUB_SHARE_FLOOR)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path, n]) => ({
      advisory: "economy",
      subject: path,
      observation: `${path} appears in ${n} of ${considered} recent commits' reading closures — nearly every change requires loading it`,
      because:
        "Closure is the READ-side price of a change: what a modifier must hold in their head"
        + " to touch one thing safely. A file in half the closures is a file every concern"
        + " pays for, and that is either a decision somebody made or one nobody did.",
      couldBe: [
        "it is a DECLARED hub — the spec frames it as shared vocabulary, and the cost is the honest price of giving one thing one home",
        "it is a MISSING ABSTRACTION — many unrelated concerns reach through it because the join was never extracted",
      ],
      discriminatedBy:
        `read this file's import edges in graph.json and the \`## why\` of the component that owns it.`
        + ` If the spec names it a hub, record that and dismiss this — the cost is bought.`
        + ` If its importers reach through it for UNRELATED concerns, that is decompose's missing-abstraction`
        + ` smell with a read-side price tag: extract the interface and re-run \`coherence economy\` to see the closure fall.`,
      files: [path],
    }));
}

// ── the command ───────────────────────────────────────────────────────────────────────

export interface EconomyOpts { raise?: boolean; raiseCap?: number; session?: string; agent?: string }

export async function economy(
  cfg: Config, graph: Graph, opts: EconomyOpts = {},
  commits = rebaseCommits(readCommitLog(cfg, HIST), gitPrefix(cfg)),
): Promise<number> {
  // The 2…BULK concern band, applied AFTER the rebase: a repo-wide sweep that touched three
  // files inside a subdirectory root is a three-file commit from that root's point of view
  // (evolution.ts:116). Filtering before the rebase would judge it by somebody else's size.
  const band = commits.filter((c) => c.files.length >= 2 && c.files.length <= BULK);

  const fileNodes = graph.nodes.filter((n) => n.kind === "file");
  const fileSet = new Set(fileNodes.map((n) => n.path ?? n.label));
  const { fileComp } = componentMap(cfg, graph);
  const adj = importAdjacency(graph);

  const stats = await fileStats(cfg, fileNodes);
  const linesOf = (p: string) => stats.get(p)?.lines ?? 0;

  // SPEC CONTEXT at its real size: one findSpec + read per component per run. Keyed by the
  // component LABEL, which is what `fileComp` yields — a component whose files were
  // re-labelled by `config.components` sub-components simply has no spec entry, and the
  // closure is code-only for it. Absent, not zero.
  const specLines = new Map<string, number>();
  for (const n of graph.nodes) {
    if (n.kind !== "component") continue;
    const dir = n.id.slice(2);
    const p = await findSpec(join(cfg.root, dir === "." ? "" : dir));
    if (!p) continue;
    const text = await readFile(p, "utf8").catch(() => null);
    if (text === null) continue;
    let lines = 0;
    for (const ch of text) if (ch === "\n") lines++;
    specLines.set(n.label, lines);
  }
  const specLinesOf = (label: string) => specLines.get(label);

  const closures: Closure[] = [];
  for (const c of band) {
    const cl = closureOf(c, adj, fileSet, fileComp, linesOf, specLinesOf);
    if (cl) closures.push(cl);
  }
  const considered = closures.length;

  const head = "\n  ECONOMY — the context closure of a change (what a reader loads to change one thing safely)\n";
  if (!considered) {
    console.log(head);
    console.log(`  no closures to measure: nothing in the last ${HIST} commits' concern band (2–${BULK} files) touched a file the graph knows.`);
    console.log("  (advisory — closure is a cost, not a verdict; the metric surfaces, you judge)\n");
    return 0;
  }

  const s = economyStats(closures);
  const series = closureSeries(closures);
  const attr = fileAttribution(closures);

  const pad = (x: unknown, n: number) => String(x).padEnd(n);
  const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  console.log(head);
  console.log(`  ${considered} concern commits analyzed (2–${BULK} files each, last ${HIST}) · closure = touched graph files`);
  console.log(`  + direct import neighbors (both directions) + the owning components' specs\n`);
  console.log(`  closure per commit    median ${num(s.medianFiles)} files / ${num(s.medianLines)} lines · p90 ${num(s.p90Files)} files / ${num(s.p90Lines)} lines`);
  if (series.length) {
    const lo = Math.min(...series), hi = Math.max(...series);
    console.log(`  trend (median files)  ${spark(series, lo, hi)}   oldest → newest over ${series.length} windows`);
  }

  const worst = [...closures].sort((a, b) => b.files - a.files || b.lines - a.lines).slice(0, TOP_COMMITS);
  console.log("\n  worst closures  (the most context a single change demanded)");
  for (const c of worst) console.log(`    ${c.hash.slice(0, 7)}  ${pad(c.subject.slice(0, 52), 52)}   ${c.files} files / ${c.lines} lines`);

  const hubs = [...attr.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_FILES);
  console.log("\n  files in most closures  (read-side hubs — everything needs these)");
  for (const [path, n] of hubs) console.log(`    ${String(n).padStart(4)}/${considered}  ${path}`);

  // Per-component: how often the component was IN a closure, and how big those closures were.
  // A component whose every edit drags nine files is the read-side reading of a smeared concern.
  const byComp = new Map<string, { touches: number; files: number }>();
  for (const c of closures) for (const l of c.comps) {
    const e = byComp.get(l) ?? { touches: 0, files: 0 };
    e.touches++; e.files += c.files;
    byComp.set(l, e);
  }
  const comps = [...byComp.entries()].sort((a, b) => b[1].touches - a[1].touches || a[0].localeCompare(b[0])).slice(0, TOP_COMPS);
  if (comps.length) {
    // `c:`-stripped for the same reason mass.ts:83-88 strips it from a baseline key: a label
    // a reader has to type is a PLACE, never the graph's internal node id leaking into a
    // report people quote at each other.
    const width = Math.max(8, ...comps.map(([l]) => l.replace(/^c:/, "").length));
    console.log("\n  mean closure by component  (most-touched first)");
    for (const [l, e] of comps) console.log(`    ${String(e.touches).padStart(4)}×  ${pad(l.replace(/^c:/, ""), width)}  ${(e.files / e.touches).toFixed(1)} files`);
  }

  console.log("\n  lines measured against the CURRENT tree, an approximation for historical commits;");
  console.log("  files outside the graph (docs, config) are not counted — the closure is the graph's view.");
  console.log("  (advisory — closure is a cost, not a verdict; the metric surfaces, you judge)");

  // swallowed on purpose: the series side-car is best-effort persistence for an ADVISORY —
  // a failed write (read-only checkout, missing dir) must not fail the report it decorates.
  await recordEconomy(cfg, { considered, ...s, series }).catch(() => {});

  const report = raiseFindings(cfg, readJournal(cfg).records, economyFindings(attr, considered), {
    enabled: opts.raise, cap: opts.raiseCap, session: opts.session, agent: opts.agent,
  });
  const raised = formatRaise(report);
  if (raised.length) console.log("");
  for (const line of raised) console.log(line);
  console.log("");
  return 0;
}
