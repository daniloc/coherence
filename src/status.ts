// status.ts — the persistent run record (`.coherence/status.json`). Every instrument
// FILES A REPORT instead of only printing one: verify records per-claim verdicts +
// coverage, atlas its tier grades, drift its trajectory. Anything human-facing (the
// panel, a future render, a `jq` one-liner) reads the record — health that used to
// evaporate at process exit.
//
// Every section stamps its own provenance (ISO time + short commit + dirty flag)
// because staleness IS health information: a green from ten commits ago is an amber
// fact, and the fast/full tiers age independently. The record is the last known
// truth, honestly dated — never a claim about the present.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Config } from "./types.ts";

export interface ClaimRecord {
  node: string;            // declaring component's label
  claim: string;           // the claim line, verbatim
  kind: "pass" | "fail" | "skip";
  detail?: string;
  at: string;              // ISO time of the run that produced this verdict
  commit: string | null;   // short HEAD at that run (null: not a git repo)
  tier: "fast" | "full";   // which verify tier produced it
  // ── HISTORY, as a STICKY BIT AND A COUNTER rather than a log. The question worth
  // answering is "has this claim EVER been observed red?", and a claim that has been
  // green for fifty runs and never once red is either an excellent invariant or a check
  // that cannot fail — the two are indistinguishable without this, and only one of them
  // is worth keeping. A full log would answer it too and grow without bound; these do
  // not, and they survive the record being rewritten every run.
  everFailed?: boolean;    // sticky: true once this claim has been seen to fail, forever
  lastFailAt?: string;     // when that last happened (ISO) — staleness is information
  lastFailCommit?: string | null;
  runs?: number;           // how many runs have evaluated it (a skip does not count)
}

export interface VerifySection {
  at: string; commit: string | null; dirty: boolean;
  tier: "fast" | "full";
  scope: string[] | null;  // component labels of a --staged/--since run; null = full tree
  lastFastAt?: string;     // the two tiers age independently — track each
  lastFullAt?: string;
  // HOW the executable tier was resolved this run: true = one batched whole-suite report
  // (config.testBatch), absent/false = the per-claim runner. Deliberately RUN-level, not
  // per-claim: VerifySection is rewritten whole every run, so this field has no interaction
  // with mergeClaimRecords' sticky-history rules — a per-claim marker would ride through
  // the skip-doesn't-clobber branch and start describing a verdict from a previous run.
  // A verdict is a verdict; this is provenance about the instrument, like `commit`/`dirty`.
  batched?: boolean;
  // WHAT IT COSTS TO KEEP THE CLAIMS TRUE — the run's holding-cost vector: the total, plus the
  // most expensive claims with the ms and WHICH CLOCK produced it ("report" = the runner's own
  // per-test duration, "wall" = verify's clock around the claim; they are different
  // measurements and are never blended).
  //
  // RUN-LEVEL, and rewritten whole every run — deliberately NOT a field on ClaimRecord. The
  // argument at the `batched` field above applies verbatim: mergeClaimRecords' skip-carry
  // branch keeps a PREVIOUS run's verdict when this run only skipped a claim, so a per-claim
  // `ms` would ride through that branch and start describing a run that is not this one. A
  // verdict is a verdict; a timing is provenance about the instrument, like `commit`/`dirty`.
  cost?: { totalMs: number; claims: Array<{ node: string; claim: string; ms: number; source: "wall" | "report" }> };
  claims: ClaimRecord[];
  // coverage + invariant totals are STATIC graph facts (claims/why presence), so they
  // are always full-tree even on a scoped run; only the gap list needs run evidence.
  coverage: { components: number; claimed: number; withWhy: number; symbols: number; documented: number };
  invariants: { total: number; anchored: number; gaps: Array<{ comp: string; inv: string }> };
  narrative: { statements: number; unchanged: number; pending: number; broken: number } | null;
  jobs: number;
  failures: number;
}

export interface AtlasSection {
  at: string; commit: string | null;
  tiers: { enshrined: number; checked: number; convention: number };
  // `heat` is the crossing's churn share (0..1) — how much of the recent history touched the
  // file(s) defining this chokepoint. OPTIONAL because it is genuinely unmeasurable for some
  // crossings (no graph symbol, no history), and an unmeasurable temperature must read as
  // absent, not as cold. It grades NOTHING: `atlas --check` never reads it.
  crossings: Array<{ sym: string; from: string; to: string; tier: number; security: boolean; note: string; translates: string; present: boolean; pending: boolean; heat?: number }>;
  drift: string[];         // spec chokepoints with no transition entry
  dangling: string[];      // mapped symbols no longer in source
  overclaimed: string[];   // `enshrined` markers with no backing `via guard`
  tier3Security: string[]; // the headline — unmanaged security crossings
  // INFERENCE HAZARDS — tier-3 crossings with heat over the floor: an undeclared junction
  // with traffic through it. OPTIONAL because a record written before v0.20.0 has no such
  // field and must still parse; a consumer that never heard of hazards reads the rest
  // unchanged. Like `heat`, it grades nothing — `atlas --check` never reads it.
  hazards?: string[];
}

export interface DriftSection {
  at: string; commit: string | null;
  devCommits: number;
  locality: number[];      // trajectory windows, oldest → newest
  spread: number[];
  seams: Array<[string, number]>;
  verdict: string;
}

/** What the mass ratchet measured, and what it was measured AGAINST. `baseline` is per
 *  dimension and optional because a key can be new — the record has to be able to say
 *  "measured, never pinned" without inventing a number. `series` is the net-LOC-per-
 *  window shape the report prints; absent on a `--check`, which does not read history. */
export interface MassSection {
  at: string; commit: string | null; dirty: boolean;
  dims: Array<{ key: string; value: number; unit?: string; baseline?: number }>;
  series?: { locDelta: number[] };
}

/** The READ-side cost record: the context closure of a change over the recent window —
 *  what a reader must load to modify one thing safely. `mass` says how much machine there
 *  is; this says how much of it one change makes you hold.
 *
 *  `considered` is the SAMPLE SIZE and is not optional, for evolution.ts:139-140's reason:
 *  a median over three commits and one over three hundred should never look alike, and a
 *  stored median with no count is a number a consumer cannot weigh.
 *
 *  Lines are measured against the CURRENT tree — an approximation for historical commits,
 *  named in the report that produced them. `series` is median closure FILES per window,
 *  oldest → newest. Not yet read by the panel; the energy-strip follow-up owns that. */
export interface EconomySection {
  at: string; commit: string | null; dirty: boolean;
  considered: number;
  medianFiles: number; medianLines: number;
  p90Files: number; p90Lines: number;
  series: number[];
}

export interface StatusRecord { version: 1; verify?: VerifySection; atlas?: AtlasSection; drift?: DriftSection; mass?: MassSection; economy?: EconomySection }

export const statusPath = (cfg: Config) => join(cfg.root, ".coherence", "status.json");

export async function readStatus(cfg: Config): Promise<StatusRecord> {
  try { return JSON.parse(await readFile(statusPath(cfg), "utf8")) as StatusRecord; } catch { return { version: 1 }; }
}

async function writeStatus(cfg: Config, rec: StatusRecord): Promise<void> {
  await mkdir(join(cfg.root, ".coherence"), { recursive: true });
  await writeFile(statusPath(cfg), JSON.stringify(rec, null, 2) + "\n");
}

/** Short HEAD + dirty flag — the provenance every section stamps itself with. */
export function gitStamp(root: string): { commit: string | null; dirty: boolean } {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return { commit: null, dirty: false };
  const d = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  return { commit: r.stdout.trim(), dirty: d.status === 0 && d.stdout.trim().length > 0 };
}

/**
 * Merge a run's fresh claim verdicts over the previous record.
 * - scope null (a full-tree run): the fresh set REPLACES the record, so claims that
 *   vanished from the specs vanish from the record (no ghost rows).
 * - scoped (--staged/--since): only the evaluated components' entries are replaced;
 *   out-of-scope records ride through untouched — their own stamps keep aging.
 * - A SKIP never clobbers a real verdict. Under --fast the executable tier skips, and
 *   overwriting last week's oracle PASS with "skipped (--fast)" would erase the last
 *   known truth; the old verdict is kept, its stamp saying how old it is. A skip only
 *   lands where nothing real exists underneath (dialect gaps, never-run claims).
 */
export function mergeClaimRecords(prev: ClaimRecord[], fresh: ClaimRecord[], scope: Set<string> | null): ClaimRecord[] {
  const key = (c: ClaimRecord) => `${c.node} ${c.claim}`;
  const prevBy = new Map(prev.map((c) => [key(c), c]));
  const out: ClaimRecord[] = [];
  if (scope) for (const c of prev) if (!scope.has(c.node)) out.push(c);
  for (const c of fresh) {
    const old = prevBy.get(key(c));
    // A skip never clobbers a real verdict (see above) — but it must not clobber the
    // HISTORY either, so the sticky fields are carried across both branches.
    const kept = c.kind === "skip" && old && old.kind !== "skip" ? { ...old } : { ...c };
    const failedNow = c.kind === "fail";
    kept.everFailed = (old?.everFailed ?? false) || failedNow;
    if (failedNow) { kept.lastFailAt = c.at; kept.lastFailCommit = c.commit; }
    else if (old?.lastFailAt) { kept.lastFailAt = old.lastFailAt; kept.lastFailCommit = old.lastFailCommit; }
    kept.runs = (old?.runs ?? 0) + (c.kind === "skip" ? 0 : 1);
    out.push(kept);
  }
  return out;
}

/** What runVerify hands the record-keeper (already computed for its own report). */
export interface VerifyReport {
  tier: "fast" | "full";
  scope: string[] | null;
  batched?: boolean;       // the executable tier resolved from ONE batched suite report
  sigs: Array<{ kind: "pass" | "fail" | "skip"; claim: string; node: string; detail?: string }>;
  coverage: VerifySection["coverage"];
  invTotal: number;
  invGaps: Array<{ comp: string; inv: string }>;
  narrative: VerifySection["narrative"];
  jobs: number;
  failures: number;
  cost?: VerifySection["cost"];   // the run's holding-cost vector (run-level — see the field)
}

export async function recordVerify(cfg: Config, r: VerifyReport): Promise<void> {
  const prev = await readStatus(cfg);
  const { commit, dirty } = gitStamp(cfg.root);
  const at = new Date().toISOString();
  const fresh: ClaimRecord[] = r.sigs.map((s) => ({ node: s.node, claim: s.claim, kind: s.kind, detail: s.detail, at, commit, tier: r.tier }));
  const scopeSet = r.scope ? new Set(r.scope) : null;
  const claims = mergeClaimRecords(prev.verify?.claims ?? [], fresh, scopeSet);
  // Scoped runs are authoritative only for the components they touched: their gap list
  // replaces the touched components' prior gaps and inherits the rest.
  const gaps = scopeSet && prev.verify
    ? [...prev.verify.invariants.gaps.filter((g) => !scopeSet.has(g.comp)), ...r.invGaps]
    : r.invGaps;
  prev.verify = {
    at, commit, dirty, tier: r.tier, scope: r.scope,
    batched: r.batched ? true : undefined,
    // Assigned from THIS run's report only — never merged with the previous record's vector.
    // A cost table that carried rows from two different runs would be a ranking of nothing.
    cost: r.cost,
    lastFastAt: r.tier === "fast" ? at : prev.verify?.lastFastAt,
    lastFullAt: r.tier === "full" ? at : prev.verify?.lastFullAt,
    claims,
    coverage: r.coverage,
    invariants: { total: r.invTotal, anchored: Math.max(0, r.invTotal - gaps.length), gaps },
    narrative: r.narrative,
    jobs: r.jobs,
    failures: r.failures,
  };
  await writeStatus(cfg, prev);
}

export async function recordAtlas(cfg: Config, s: Omit<AtlasSection, "at" | "commit">): Promise<void> {
  const prev = await readStatus(cfg);
  prev.atlas = { at: new Date().toISOString(), commit: gitStamp(cfg.root).commit, ...s };
  await writeStatus(cfg, prev);
}

export async function recordDrift(cfg: Config, s: Omit<DriftSection, "at" | "commit">): Promise<void> {
  const prev = await readStatus(cfg);
  prev.drift = { at: new Date().toISOString(), commit: gitStamp(cfg.root).commit, ...s };
  await writeStatus(cfg, prev);
}

export async function recordMass(cfg: Config, s: Omit<MassSection, "at" | "commit" | "dirty">): Promise<void> {
  const prev = await readStatus(cfg);
  const { commit, dirty } = gitStamp(cfg.root);
  prev.mass = { at: new Date().toISOString(), commit, dirty, ...s };
  await writeStatus(cfg, prev);
}

export async function recordEconomy(cfg: Config, s: Omit<EconomySection, "at" | "commit" | "dirty">): Promise<void> {
  const prev = await readStatus(cfg);
  const { commit, dirty } = gitStamp(cfg.root);
  prev.economy = { at: new Date().toISOString(), commit, dirty, ...s };
  await writeStatus(cfg, prev);
}
