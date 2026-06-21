// drift.ts — the architectural-direction view (the derivative of decompose).
//
// decompose answers "is the decomposition wise RIGHT NOW" — a snapshot. But the
// thing an operator watching an agent needs is DIRECTION: across the recent
// edits, is the codebase converging (one concern → one home, an anti-entropic
// response to perturbation) or decohering (concerns smearing across boundaries)?
// You cannot read that from a graph; it only appears on a clock. So drift takes
// the EVOLUTION graph decompose already reads, projects today's component map
// back over recent history, and renders the trajectory: LOCALITY and SPREAD over
// time, the hot seam being churned now, and the recent stream of architectural
// gestures. Advisory — it sees the SHAPE of each edit (how many components it
// spanned), not its intent (chokepoint vs guard); it names direction, you judge.
//
// One shape it CAN distinguish: a PRUNE — a net-removal commit. Deleting a feature
// across N components is a one-time shrink, not divergence, so prunes are excluded
// from the trajectory and the seam, and the verdict is weighted by the recent
// gesture mix rather than the SPREAD slope alone (a single cross-cutting add or a
// deletion shouldn't read as a smearing trend).
import { spawnSync } from "node:child_process";
import type { Config, Graph } from "./types.ts";
import { BULK, componentMap, readCommitLog } from "./decompose.ts";

const HIST = 400;   // recent commits to read — direction, not all-time archaeology
const WINDOWS = 8;  // trajectory buckets, oldest → newest
const RECENT = 12;  // gestures listed
const SPARK = "▁▂▃▄▅▆▇█";

function spark(vals: number[], lo: number, hi: number): string {
  if (hi <= lo) return SPARK[0].repeat(vals.length);
  return vals.map((v) => SPARK[Math.max(0, Math.min(SPARK.length - 1, Math.round(((v - lo) / (hi - lo)) * (SPARK.length - 1))))]).join("");
}
const arrow = (first: number, last: number, eps: number): string => last > first + eps ? "▲" : last < first - eps ? "▼" : "▬";

interface Window { locality: number; spread: number }
type Kind = "converge" | "couple" | "smear" | "prune";
interface Gesture { hash: string; subject: string; comps: string[]; kind: Kind }

// Per-commit net line delta via a cheap separate --shortstat pass, so readCommitLog
// (shared with decompose) stays untouched. A commit with more deletions than
// insertions is a PRUNE — a shrink, not architectural divergence.
function commitDeltas(cfg: Config, limit: number): Map<string, { added: number; deleted: number }> {
  const r = spawnSync("git", ["log", `-n${limit}`, "--no-merges", "--shortstat", "--pretty=format:%x00%H"], { cwd: cfg.root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const out = new Map<string, { added: number; deleted: number }>();
  if (r.status !== 0) return out;
  let hash = "";
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("\x00")) hash = line.slice(1).trim();
    else if (hash && line.includes("changed")) {
      const add = /(\d+) insertion/.exec(line), del = /(\d+) deletion/.exec(line);
      out.set(hash, { added: add ? +add[1] : 0, deleted: del ? +del[1] : 0 });
    }
  }
  return out;
}

function bucketize<T>(xs: T[], n: number): T[][] {
  if (xs.length === 0) return [];
  const k = Math.max(1, Math.ceil(xs.length / n));
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += k) out.push(xs.slice(i, i + k));
  return out;
}

function analyze(cfg: Config, graph: Graph) {
  const { compOf } = componentMap(cfg, graph);
  // newest → oldest from git; reverse to oldest → newest for the trajectory.
  const log = readCommitLog(cfg, HIST).filter((c) => c.files.length <= BULK).reverse();
  const deltas = commitDeltas(cfg, HIST);

  // distinct components each commit touched (the unit of both metrics + gestures)
  const enriched = log.map((c) => {
    const comps = [...new Set(c.files.map(compOf).filter((x): x is string => !!x))];
    const mapped = c.files.filter((f) => compOf(f)).length;
    const d = deltas.get(c.hash);
    const prune = !!d && d.deleted > d.added; // net removal — a shrink, not divergence
    return { ...c, comps, mapped, prune };
  }).filter((c) => c.comps.length > 0);

  // DEVELOPMENT commits drive the trajectory + seam; prunes (one-time removals) are
  // excluded so deleting a feature across components doesn't read as decoherence.
  const dev = enriched.filter((c) => !c.prune);

  // TRAJECTORY: per window, LOCALITY (pairwise co-change staying in one component,
  // the same measure decompose reports) and SPREAD (avg distinct components/commit).
  const windows: Window[] = bucketize(dev, WINDOWS).map((bucket) => {
    let within = 0, cross = 0, spreadSum = 0, n = 0;
    for (const c of bucket) {
      const fc = c.files.map(compOf).filter((x): x is string => !!x);
      for (let a = 0; a < fc.length; a++) for (let b = a + 1; b < fc.length; b++) (fc[a] === fc[b] ? within++ : cross++);
      spreadSum += c.comps.length; n++;
    }
    return { locality: within + cross > 0 ? within / (within + cross) : 1, spread: n ? spreadSum / n : 0 };
  });

  // HOT SEAM: the cross-boundary pair churned most in the most-recent third of
  // DEVELOPMENT — where the agent is actively working across a boundary right now.
  const recentCut = dev.slice(Math.floor(dev.length * 2 / 3));
  const seam = new Map<string, number>();
  for (const c of recentCut) {
    const fc = [...new Set(c.files.map(compOf).filter((x): x is string => !!x))];
    for (let a = 0; a < fc.length; a++) for (let b = a + 1; b < fc.length; b++) { const key = [fc[a], fc[b]].sort().join("  ⇄  "); seam.set(key, (seam.get(key) ?? 0) + 1); }
  }
  const seams = [...seam.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  // GESTURES: newest commits classified by SHAPE — a prune (net removal) first,
  // else by component SPAN.
  const gestures: Gesture[] = enriched.slice(-RECENT).reverse().map((c) => ({
    hash: c.hash.slice(0, 7), subject: c.subject, comps: c.comps,
    kind: c.prune ? "prune" : c.comps.length === 1 ? "converge" : c.comps.length === 2 ? "couple" : "smear",
  }));

  return { windows, seams, gestures, commits: enriched.length, devCommits: dev.length, prunes: enriched.length - dev.length };
}

export async function drift(cfg: Config, graph: Graph): Promise<number> {
  const a = analyze(cfg, graph);
  console.log(`direction — architectural trajectory (where is the agent driving?)`);
  if (a.devCommits < 4) { console.log(`  only ${a.devCommits} mapped development commits in the last ${HIST} — not enough history to read a direction.`); return 0; }
  const pruneNote = a.prunes ? ` · ${a.prunes} prune${a.prunes === 1 ? "" : "s"} excluded` : "";
  console.log(`  ${a.devCommits} development commits · ${a.windows.length} windows · oldest → newest${pruneNote}`);
  console.log("");

  const loc = a.windows.map((w) => w.locality), spr = a.windows.map((w) => w.spread);
  const locA = arrow(loc[0], loc[loc.length - 1], 0.03), sprA = arrow(spr[0], spr[spr.length - 1], 0.15);
  const verdictLoc = locA === "▲" ? "converging" : locA === "▼" ? "decohering" : "flat";
  const verdictSpr = sprA === "▲" ? "widening" : sprA === "▼" ? "narrowing" : "flat";
  console.log(`  LOCALITY   ${spark(loc, 0, 1)}   ${(loc[0] * 100).toFixed(0)}% → ${(loc[loc.length - 1] * 100).toFixed(0)}%   ${locA} ${verdictLoc}`);
  console.log(`             co-change staying inside one component (rising = wiser)`);
  console.log(`  SPREAD     ${spark(spr, Math.min(...spr), Math.max(...spr))}   ${spr[0].toFixed(1)} → ${spr[spr.length - 1].toFixed(1)}   ${sprA} ${verdictSpr}`);
  console.log(`             distinct components touched per commit (falling = concerns localizing)`);
  console.log("");

  if (a.seams.length) {
    console.log("  hot seam  (cross-boundary churn in the most recent third — where work crosses a boundary now)");
    for (const [pair, n] of a.seams) console.log(`    ${String(n).padStart(4)}×  ${pair}`);
    console.log("");
  }

  const glyph: Record<Kind, string> = { converge: "●", couple: "○", smear: "✕", prune: "−" };
  const tagOf: Record<Kind, string> = { converge: "converge", couple: "couple  ", smear: "smear   ", prune: "prune   " };
  console.log("  recent gestures  (newest first — by SHAPE coherence can see; − = net removal)");
  for (const g of a.gestures) {
    const subj = g.subject.length > 52 ? g.subject.slice(0, 51) + "…" : g.subject;
    console.log(`    ${glyph[g.kind]} ${tagOf[g.kind]} ${g.hash}  ${subj.padEnd(52)} [${g.comps.join(", ")}]`);
  }
  console.log("");

  // GESTURE MIX over the listed window — the shape distribution, so the verdict
  // isn't read off the SPREAD slope alone.
  const mix: Record<Kind, number> = { converge: 0, couple: 0, smear: 0, prune: 0 };
  for (const g of a.gestures) mix[g.kind]++;
  console.log(`  gesture mix (recent ${a.gestures.length}): ${mix.converge} converge · ${mix.couple} couple · ${mix.smear} smear · ${mix.prune} prune`);
  console.log("");

  // VERDICT — combine the two derivatives, WEIGHTED by the gesture mix. A widening
  // SPREAD with few actual smears is cross-cutting/one-off work, not a smearing trend.
  const devGestures = a.gestures.filter((g) => g.kind !== "prune");
  const smearRate = devGestures.length ? devGestures.filter((g) => g.kind === "smear").length / devGestures.length : 0;
  const converging = locA === "▲" || (locA === "▬" && sprA === "▼");
  const decohering = locA === "▼" || (locA === "▬" && sprA === "▲");
  const dir = converging ? "toward convergence (an anti-entropic response)"
    : decohering && smearRate >= 0.4 ? "toward divergence — smears dominate recent work; watch for a block-list forming"
    : decohering ? "toward wider SPREAD, but recent gestures are mostly converge/couple — likely cross-cutting or one-off work, not a smearing trend; read the seam, not the slope"
    : "flat — no clear ordering pressure either way";
  const seamNote = a.seams.length ? ` Hot seam: ${a.seams[0][0]} — if that pair keeps co-changing, it's a candidate to collapse into one home.` : "";
  console.log(`  verdict: LOCALITY ${verdictLoc}, SPREAD ${verdictSpr} over ${a.devCommits} development commits (prunes excluded) — the agent is driving ${dir}.${seamNote}`);
  console.log("");
  console.log("  (advisory — direction, not a grade; coherence sees gesture SHAPE, not intent. A");
  console.log("   chokepoint-building edit and a guard-scattering edit can look alike here — read");
  console.log("   the diff at the seam. Whether each invariant is anchored is `coherence verify`.)");
  return 0;
}
