// evolution.ts — THE EVOLUTION GRAPH, spelled once.
//
// WHY THIS FILE EXISTS. Coherence reads git history in three places and, until this
// module, derived it three times: `decompose` (all-time change-coupling), `drift` (the
// recent trajectory + per-commit line deltas) and `scene` (per-component heat, an inline
// loop with its own hard-coded 200-commit window). Three spellings of ONE derivation,
// identical today and tied together by nothing — which is, verbatim, the finding the
// harness's own `redundancy` advisory reports about other people's code. Fixing it the
// way the advisory prescribes (DERIVE ONE SPELLING FROM THE OTHER — here, from a single
// home) is the point: the git-log framing, the BULK band and the churn window now have
// one definition, so a change to any of them cannot land in two consumers and miss the
// third.
//
// WHY A MEMO AND NOT A CACHE. The duplication was a REDUNDANCY problem, not a performance
// problem, and the two have opposite fixes. A persisted churn cache — a status.json
// section or an artifact under `outputDir` — would key on HEAD, be rewritten by every
// command that touches history, and land in every diff a reader has to review: perpetual
// noise in exchange for a git call the CLI makes at most a handful of times per run. So
// the sharing is IN-PROCESS ONLY: a module-level memo keyed `<root>|<limit>`, valid
// because the CLI is one command per process and HEAD cannot move underneath it. Nothing
// here persists, and nothing here is a source of truth about the past — git is.
//
// THE PURE DERIVATIONS BELOW TAKE A COMMIT ARRAY, following the two-layer test pattern
// decompose.ts already uses (see test/decompose.test.ts's header): the math is a pure
// function of injected commits, and the git plumbing the injection bypasses is driven
// through a real throwaway repo. Injection is blind exactly where path mapping and the
// log parser live, so both layers are needed.
import { spawnSync } from "node:child_process";
import type { Config } from "./types.ts";

/** A commit touching more than this is mechanical (a rename/migration) — noise, not a
 *  concern signal. Load-bearing for every derivation below and for decompose's coupling
 *  math, which is why it lives with the reader rather than with one of its consumers. */
export const BULK = 40;

/** How far back the per-component HEAT window looks. Was an unnamed literal `200` inline
 *  in scene.ts; naming it is the whole reason the third spelling was findable at all. */
export const CHURN_WINDOW = 200;

export interface Commit { hash: string; subject: string; files: string[] }

export interface Delta { added: number; deleted: number }

// ── the in-process memo ───────────────────────────────────────────────────────────────

const logMemo = new Map<string, Commit[]>();
const deltaMemo = new Map<string, Map<string, Delta>>();
const memoKey = (cfg: Config, limit: number) => `${cfg.root}|${limit}`;

/** Drop everything the memo holds. FOR TESTS: a test process is the one place where two
 *  reads of the same root legitimately straddle a new commit, which is exactly the
 *  assumption ("HEAD cannot move mid-run") the memo is allowed to make in the CLI. */
export function _resetEvolutionMemo(): void { logMemo.clear(); deltaMemo.clear(); }

// ── the git reads ─────────────────────────────────────────────────────────────────────

/** EVOLUTION graph, raw: every non-merge commit newest→oldest with its touched files
 *  and subject. Shared by decompose (all-time coupling), drift (recent trajectory),
 *  scene (heat) and mass (net-LOC over time). */
export function readCommitLog(cfg: Config, limit: number): Commit[] {
  const key = memoKey(cfg, limit);
  const hit = logMemo.get(key);
  if (hit) return hit;
  const r = spawnSync("git", ["log", `-n${limit}`, "--no-merges", "--name-only", "--pretty=format:%x00%H%x1f%s"], { cwd: cfg.root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const commits: Commit[] = [];
  if (r.status !== 0) { logMemo.set(key, commits); return commits; }
  let cur: Commit | null = null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("\x00")) { if (cur) commits.push(cur); const [hash, subject] = line.slice(1).split("\x1f"); cur = { hash, subject: subject ?? "", files: [] }; }
    else if (line.trim() && cur) cur.files.push(line.trim());
  }
  if (cur) commits.push(cur);
  logMemo.set(key, commits);
  return commits;
}

/** Per-commit net line delta via a cheap separate `--shortstat` pass, so readCommitLog
 *  stays a pure name-only read. A commit with more deletions than insertions is a PRUNE
 *  — a shrink, not architectural divergence (drift), and a negative bar (mass). */
export function commitDeltas(cfg: Config, limit: number): Map<string, Delta> {
  const key = memoKey(cfg, limit);
  const hit = deltaMemo.get(key);
  if (hit) return hit;
  const r = spawnSync("git", ["log", `-n${limit}`, "--no-merges", "--shortstat", "--pretty=format:%x00%H"], { cwd: cfg.root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const out = new Map<string, Delta>();
  if (r.status !== 0) { deltaMemo.set(key, out); return out; }
  let hash = "";
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("\x00")) hash = line.slice(1).trim();
    else if (hash && line.includes("changed")) {
      const add = /(\d+) insertion/.exec(line), del = /(\d+) deletion/.exec(line);
      out.set(hash, { added: add ? +add[1] : 0, deleted: del ? +del[1] : 0 });
    }
  }
  deltaMemo.set(key, out);
  return out;
}

// ── the pure derivations (commit-array-injectable) ────────────────────────────────────

/** Split `xs` into at most `n` contiguous buckets, order preserved. Fewer than `n` when
 *  the input does not divide evenly — the trajectory renders what exists rather than
 *  padding with a bucket nobody measured. */
export function bucketize<T>(xs: T[], n: number): T[][] {
  if (xs.length === 0) return [];
  const k = Math.max(1, Math.ceil(xs.length / n));
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += k) out.push(xs.slice(i, i + k));
  return out;
}

/** How often each git path was touched, over the commits that carry a concern signal.
 *  The 2…BULK band is the SAME semantic filter decompose's coupling math applies (a
 *  1-file commit has no pairs; a >BULK commit is a mechanical rename/migration), so it
 *  is applied here regardless of how `commits` was sourced. `considered` is the commit
 *  count that survived — reported alongside, because a churn table over three commits
 *  and one over three hundred should never look alike. */
export function fileChurn(commits: Commit[]): { byFile: Map<string, number>; considered: number } {
  const byFile = new Map<string, number>();
  let considered = 0;
  for (const c of commits) {
    if (c.files.length < 2 || c.files.length > BULK) continue;
    considered++;
    for (const f of c.files) byFile.set(f, (byFile.get(f) ?? 0) + 1);
  }
  return { byFile, considered };
}

/** How many recent commits touched each component — the scene's HEAT, extracted from
 *  the loop that was inline there. A commit counts ONCE per component however many of
 *  its files landed in that component (heat is "was this district worked in", not "how
 *  many files moved"), and >BULK commits are excluded like everywhere else. `compOf`
 *  returns null/undefined for a path no component owns; those are dropped. */
export function componentChurn(compOf: (p: string) => string | null | undefined, commits: Commit[]): Map<string, number> {
  const churn = new Map<string, number>();
  for (const c of commits) {
    if (c.files.length > BULK) continue;
    const touched = new Set<string>();
    for (const f of c.files) { const l = compOf(f); if (l) touched.add(l); }
    for (const l of touched) churn.set(l, (churn.get(l) ?? 0) + 1);
  }
  return churn;
}

/** NET line delta per bucket, OLDEST → NEWEST — mass over time. `commits` arrive
 *  newest-first from git, so they are reversed before bucketing; a commit with no entry
 *  in `deltas` (an empty commit, or a shortstat pass that did not reach it) contributes
 *  zero rather than dropping its bucket. Negative buckets are real and are the point: a
 *  release that removed more than it added is the shape a growth ratchet cannot show. */
export function locDeltaSeries(deltas: Map<string, Delta>, commits: Commit[], buckets = 8): number[] {
  const oldestFirst = [...commits].reverse();
  return bucketize(oldestFirst, buckets).map((bucket) =>
    bucket.reduce((sum, c) => { const d = deltas.get(c.hash); return sum + (d ? d.added - d.deleted : 0); }, 0));
}
