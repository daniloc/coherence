// calibration.ts — test economy's predicted context against what agents actually read.
//
// `economy` measures a structural neighbourhood, not cognition. Calling that neighbourhood
// "what a reader must load" remains a conjecture until observed read sets and outcomes can
// disagree with it. Claude-compatible PostToolUse hooks append explicit file reads to a
// TRANSIENT trace; Stop snapshots the trace against the patch and its predicted one-hop
// closure. `coherence calibrate --outcome clean|defect` labels the same sample later.
//
// This is deliberately a LOWER BOUND. Shell pipelines, editor buffers and remembered
// context are not guessed from command strings. A narrow honest observation is more useful
// than a complete-looking fiction.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Config, Graph } from "./types.ts";
import { buildGraph } from "./derive.ts";
import { changedBetween } from "./structural.ts";
import { importAdjacency } from "./economy.ts";
import { patchFingerprint } from "./signal.ts";
import { readTrace, type ReadEvent as TraceEvent } from "./read-trace.ts";
export { hookReadCandidates, recordHookReads, readTrace, type ReadEvent } from "./read-trace.ts";

export type CalibrationOutcome = "unknown" | "clean" | "defect";
export type CalibrationAttribution = "session-writes" | "worktree-union";

export interface CalibrationSample {
  id: string;
  at: string;
  session: string;
  patch: string;
  changed: string[];
  predicted: string[];
  observed: string[];
  outcome: CalibrationOutcome;
  attribution?: CalibrationAttribution; // absent in pre-attribution samples = worktree union
}

export interface CalibrationStats {
  samples: number;
  labeled: number;
  defects: number;
  meanPredictedCoverage: number;
  meanObservedOutside: number;
  defectRateWithMisses: number | null;
  defectRateWithoutMisses: number | null;
  sharedWorktreeSamples: number;
}

const samplesDir = (cfg: Config) => join(cfg.root, ".coherence", "calibration");
const samplesPath = (cfg: Config, session: string) => join(samplesDir(cfg), `${slug(session)}.jsonl`);
const slug = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "unknown";

/** Economy's code-file prediction, made explicit and independently testable. Specs are
 * omitted from calibration until hook traces can distinguish reading a spec from receiving
 * its generated projection; counting either as the other would manufacture misses. */
export function predictedReadSet(graph: Graph, changed: Iterable<string>): Set<string> {
  const files = new Set(graph.nodes.filter((n) => n.kind === "file").map((n) => n.path ?? n.label));
  const adj = importAdjacency(graph);
  const out = new Set<string>();
  for (const path of changed) {
    if (!files.has(path)) continue;
    out.add(path);
    for (const n of adj.get(path) ?? []) if (files.has(n)) out.add(n);
  }
  return out;
}

const sampleId = (session: string, patch: string) =>
  "r-" + createHash("sha256").update(`${session}\0${patch}`).digest("hex").slice(0, 12);

/** Separate the host observation from git fallback so the attribution rule is a pure,
 * testable contract. Writes win whenever the host supplies them; mixing them with the
 * worktree union would silently charge one agent for another agent's patch. */
export function calibrationPaths(
  trace: TraceEvent[],
  worktreeChanged: Iterable<string>,
): { changed: string[]; observed: string[]; attribution: CalibrationAttribution } {
  const writes = [...new Set(trace.filter((e) => e.mode === "write").map((e) => e.path))].sort();
  return {
    changed: writes.length ? writes : [...new Set(worktreeChanged)].sort(),
    observed: [...new Set(trace.filter((e) => e.mode !== "write").map((e) => e.path))].sort(),
    attribution: writes.length ? "session-writes" : "worktree-union",
  };
}

/** Append a snapshot. Re-labeling appends the same id with a new outcome; readers take the
 * latest row, preserving append-only history without reporting one patch twice. */
export async function recordCalibrationSample(
  cfg: Config,
  session: string,
  outcome: CalibrationOutcome = "unknown",
  graph?: Graph,
  now = new Date().toISOString(),
): Promise<CalibrationSample | null> {
  const trace = readTrace(cfg, session);
  // A host with write-bearing PostToolUse hooks gives per-agent attribution. Older/other
  // hosts fall back loudly to the shared worktree domain; formatCalibration names this
  // observational ceiling rather than pretending the union belongs to one agent.
  const { changed, observed, attribution } = calibrationPaths(trace, changedBetween(cfg, "HEAD", null));
  if (!changed.length || !observed.length) return null;
  const patch = await patchFingerprint(cfg, "HEAD", changed);
  const predicted = [...predictedReadSet(graph ?? await buildGraph(cfg), changed)].sort();
  const sample: CalibrationSample = {
    id: sampleId(session, patch), at: now, session, patch, changed, predicted, observed, outcome, attribution,
  };
  mkdirSync(samplesDir(cfg), { recursive: true });
  appendFileSync(samplesPath(cfg, session), JSON.stringify(sample) + "\n");
  return sample;
}

export function readCalibrationSamples(cfg: Config): CalibrationSample[] {
  const latest = new Map<string, CalibrationSample>();
  if (!existsSync(samplesDir(cfg))) return [];
  for (const file of readdirSync(samplesDir(cfg)).filter((f) => f.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(join(samplesDir(cfg), file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const s = JSON.parse(line) as CalibrationSample;
        if (typeof s.id === "string" && Array.isArray(s.predicted) && Array.isArray(s.observed)) latest.set(s.id, s);
      } catch { /* counted nowhere: malformed calibration is no evidence */ }
    }
  }
  return [...latest.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

const ratio = (n: number, d: number) => d ? n / d : 0;
export function calibrationStats(samples: CalibrationSample[]): CalibrationStats {
  const rows = samples.map((s) => {
    const predicted = new Set(s.predicted), observed = new Set(s.observed);
    const overlap = [...predicted].filter((p) => observed.has(p)).length;
    const outside = [...observed].filter((p) => !predicted.has(p)).length;
    return { s, coverage: ratio(overlap, predicted.size), outside: ratio(outside, observed.size), misses: overlap < predicted.size };
  });
  const labeled = rows.filter((r) => r.s.outcome !== "unknown");
  const withMisses = labeled.filter((r) => r.misses), withoutMisses = labeled.filter((r) => !r.misses);
  const defectRate = (r: typeof rows): number | null => r.length ? r.filter((x) => x.s.outcome === "defect").length / r.length : null;
  return {
    samples: rows.length,
    labeled: labeled.length,
    defects: labeled.filter((r) => r.s.outcome === "defect").length,
    meanPredictedCoverage: rows.length ? rows.reduce((n, r) => n + r.coverage, 0) / rows.length : 0,
    meanObservedOutside: rows.length ? rows.reduce((n, r) => n + r.outside, 0) / rows.length : 0,
    defectRateWithMisses: defectRate(withMisses),
    defectRateWithoutMisses: defectRate(withoutMisses),
    sharedWorktreeSamples: samples.filter((x) => !x.attribution || x.attribution === "worktree-union").length,
  };
}

const pct = (n: number | null) => n === null ? "—" : `${Math.round(n * 100)}%`;
export function formatCalibration(samples: CalibrationSample[]): string[] {
  const s = calibrationStats(samples);
  const lines = ["ECONOMY CALIBRATION — predicted one-hop context vs observed explicit file reads"];
  if (!s.samples) return [...lines, "  no samples yet — the PostToolUse hook supplies reads; label an outcome with `coherence calibrate --outcome clean|defect`."];
  lines.push(`  ${s.samples} patch sample(s) · ${s.labeled} labeled · ${s.defects} defect(s)`);
  lines.push(`  mean predicted closure observed: ${pct(s.meanPredictedCoverage)}`);
  lines.push(`  mean observed reads outside prediction: ${pct(s.meanObservedOutside)}`);
  lines.push(`  defect rate with predicted files unread: ${pct(s.defectRateWithMisses)}`);
  lines.push(`  defect rate with full predicted coverage: ${pct(s.defectRateWithoutMisses)}`);
  lines.push(`  attribution: ${s.sharedWorktreeSamples} sample(s) used the shared worktree union; the rest used explicit session writes.`);
  lines.push("  lower bound: shell/editor/remembered reads are not inferred; correlation is not causation.");
  return lines;
}

export async function calibrate(
  cfg: Config,
  opts: { outcome?: CalibrationOutcome; session?: string; graph?: Graph } = {},
): Promise<number> {
  if (opts.outcome) {
    const session = opts.session ?? process.env.COHERENCE_SESSION ?? "unknown";
    const sample = await recordCalibrationSample(cfg, session, opts.outcome, opts.graph);
    if (!sample) {
      console.error(`no calibration sample recorded for session ${session}: this patch has no captured explicit file reads`);
      return 2;
    }
    console.log(`${sample.id}  ${sample.outcome} outcome for patch ${sample.patch}\n`);
  }
  for (const line of formatCalibration(readCalibrationSamples(cfg))) console.log(line);
  return 0;
}
