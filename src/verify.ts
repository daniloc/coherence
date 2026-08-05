// verify.ts — the coherence engine: deterministic claim verifiers + the narrative
// evidence chain (emits inference jobs for a subagent) + coverage meta-claims
// (what auto-generates, why is human-authored). Config-driven; consumes the Graph.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Config, Graph } from "./types.ts";
import { CLAIM_FORMS, proveSerialRunnerCanFail, type ClaimCtx } from "./phrasebook.ts";
import { ownerOf, refutedInvariants } from "./walk.ts";
import { claimKey } from "./boundary.ts";
import { recordVerify, readStatus, indexClaimRecords } from "./status.ts";
import { readJournal } from "./decisions.ts";
import { raiseFindings, formatRaise, type Finding } from "./raise.ts";
import { isDocumented } from "./derive.ts";
import { readSurface, vacuityRefusal, adoptionLadder } from "./floor.ts";
// The SAME history read `atlas` heat uses — and the same one, not a second one: the
// evolution memo is keyed `<root>|<limit>`, so a run that already measured heat pays
// nothing here, and a change to the window or the concern band lands in both at once.
import { readCommitLog, fileChurn, gitPrefix, rebaseCommits, CHURN_WINDOW } from "./evolution.ts";
import {
  resolveBatchFormat, runTestBatch, readReportFile, selectOracleMode, serialCostLines,
  type BatchOutcome, type OracleAccess,
} from "./test-batch.ts";

const hashOf = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const jobsPath = (cfg: Config) => join(cfg.root, ".coherence", "verify-jobs.json");
const narrPath = (cfg: Config) => join(cfg.root, "narrative.json");

async function evidence(root: string, addrs: string[]) {
  const parts: string[] = [], missing: string[] = [];
  for (const a of addrs) if (a.startsWith("file:")) { const p = a.slice(5); try { parts.push(`--- ${p} ---\n${(await readFile(join(root, p), "utf8")).slice(0, 6000)}`); } catch { missing.push(a); } }
  return { text: parts.join("\n\n"), missing };
}

/** record subagent verdicts (the mechanical notary; judge ≠ notary, axiom #5). */
export async function applyVerdicts(cfg: Config, verdictsPath: string): Promise<number> {
  const verdicts = JSON.parse(await readFile(verdictsPath, "utf8")) as Array<{ id: string; supported: boolean; reason: string; corrected?: string | null }>;
  const jobs = JSON.parse(await readFile(jobsPath(cfg), "utf8")) as Array<{ id: string; currentHash: string }>;
  const narr = JSON.parse(await readFile(narrPath(cfg), "utf8")) as { statements: any[] };
  let ok = 0, drift = 0;
  for (const v of verdicts) {
    const st = narr.statements.find((s) => s.id === v.id); const job = jobs.find((j) => j.id === v.id);
    if (!st || !job) continue;
    if (v.supported) { st.verifiedHash = job.currentHash; st.status = "ok"; delete st.drift; delete st.suggested; ok++; }
    else { st.status = "drifted"; st.drift = v.reason; if (v.corrected) st.suggested = v.corrected; drift++; }
  }
  await writeFile(narrPath(cfg), JSON.stringify(narr, null, 2) + "\n");
  console.log(`applied ${verdicts.length} verdict(s): ${ok} confirmed · ${drift} drifted`);
  for (const s of narr.statements) if (s.status === "drifted") console.log(`  ✗ [${s.id}] DRIFT — ${s.drift}`);
  return drift === 0 ? 0 : 1;
}

// Advisories exist to be READ. A 17-line dump every run is scrolled past, so the lists
// are capped — but the overflow is always ANNOUNCED, never silently dropped: a truncated
// list that looks complete is worse than no list.
const ADVISORY_LIST_CAP = 8;
/** How many claims of the holding-cost vector reach `.coherence/status.json`. The record
 *  exists to be READ (the panel's energy strip, a `jq` one-liner), and the readable part of
 *  a cost ranking is its head — the tail is a per-claim timing dump that would grow the
 *  record by a row per claim to show nothing. */
const COST_RECORD_CAP = 5;
/** A doc gap is HOT once its defining file appears in this share of recent concern commits.
 *  It is an annotation floor, not a filter: every gap is still emitted as a job, and 5% is
 *  simply the point below which "somebody was near this lately" stops being a claim. */
const HOT_DOC_FLOOR = 0.05;
/**
 * Rank doc gaps HOTTEST-FIRST by the churn share of the file that defines them — the same
 * `fileChurn` reading `atlas` grades crossings' heat against.
 *
 * WHY THE JOB LIST HAS AN ORDER AT ALL. Undocumented symbols come out of the graph in walk
 * order, which is alphabetical by path and says nothing about anything. A list of ninety
 * `[doc]` jobs in that order is a list nobody works from the top of; the first one worth
 * writing is the symbol in the file half the recent history touched, because that is the
 * one somebody is about to read.
 *
 * ZERO-CHURN GAPS KEEP THEIR SOURCE ORDER: `Array.prototype.sort` is required to be stable
 * (ECMA-262), so a project with no git history — every share 0 — gets exactly the list it
 * got before this ranking existed, rather than a set that reshuffles between runs.
 */
export function rankDocGaps<T extends { path?: string }>(
  gaps: T[], byFile: Map<string, number>, considered: number,
): Array<T & { share: number }> {
  const share = (p?: string) => (p != null && considered ? (byFile.get(p) ?? 0) / considered : 0);
  return gaps.map((g) => ({ ...g, share: share(g.path) })).sort((a, b) => b.share - a.share);
}

function listCapped<T>(items: T[], line: (t: T) => string): void {
  for (const t of items.slice(0, ADVISORY_LIST_CAP)) console.log(line(t));
  const rest = items.length - ADVISORY_LIST_CAP;
  if (rest > 0) console.log(`  · … and ${rest} more (not shown)`);
}

// ── the three advisories, as QUESTIONS ────────────────────────────────────────────────
//
// Each of these already forms a suspicion and then discards it by printing it. `raise.ts`
// holds the mechanism and the identity doctrine; what lives here is the domain half — what
// the finding IS, what could account for it, and the test that would settle it. Written as
// free functions rather than inline so they are testable without running a whole verify.
//
// IDENTITY IS THE CLAIM (or the invariant) AND THE NODE THAT DECLARES IT. Everything else
// the advisory prints is excluded, and the run count is the excluded field that matters:
// "green for 14 runs" changes every run by construction, and it is the most tempting one
// to include because it is what makes the finding feel urgent. It goes in the SENTENCE,
// where volatility is free.

/** A claim that is green every run and that nobody has ever watched fail. Neither signal
 *  is worth much alone — a claim that has never been red may simply be a good invariant,
 *  and one with no refutation may simply be young — but together they are the honest
 *  suspect list, which is exactly the shape of a conjecture. */
/** How much a missing refutation should WORRY you, by the shape of the claim's evidence.
 *
 *  MEASURED, NOT REASONED. The first real `verify --raise` ever run against hoist spent its
 *  three-question budget like this: one genuinely valuable question (the `served responses
 *  are shaped` boundary, never watched fail), one marginal, and one on
 *  `README.md exists at root — 146 run(s), never observed failing`. The list was emitted in
 *  DERIVATION order, so the cap — which exists precisely because attention is the scarce
 *  resource — was spent on the least informative finding in an 81-item list.
 *
 *  THE RANKING IS BY WHETHER A REFUTATION WOULD TEACH ANYTHING, and the three tiers fall
 *  out of what the claim's evidence actually is:
 *
 *    ORACLE-BACKED (`via test`, `via guard`, `passes test`, `conforms to`) ranks highest,
 *    because this is where VACUOUS GREEN lives. An oracle can stop testing what it names
 *    and nothing says so — this project has found that exact defect repeatedly, including
 *    one oracle satisfied by a different error thrown earlier than the one under test, and
 *    a `.rejects.toThrow()` passing on a why-gate rather than the seal it claimed to guard.
 *    An unrefuted oracle is a claim whose instrument has never been checked.
 *
 *    BOUNDARY-ONLY (a crossing with no executable oracle) ranks next: it names a real
 *    chokepoint, so the property matters, but the evidence is anchoring rather than
 *    execution and its failure mode is narrower.
 *
 *    STRUCTURAL (`X exists at …`, `X imports …`) ranks LAST, and this is the tier the
 *    incident was about. Such a claim can be broken — delete the file — but doing so
 *    demonstrates nothing except that `stat` works. Its greenness was never in doubt and a
 *    refutation would be theatre. Note the run count argues the same way and is deliberately
 *    NOT used: 146 runs green says the claim is stable, not that it is informative, and
 *    ranking on it would put the oldest trivia first.
 *
 *  This orders the printed list too, not just the raise queue — the reader of a capped list
 *  deserves the same triage as the queue that spends the budget. */
export function neverRedRank(claim: string): number {
  if (/\svia\s+(test|guard)\s+"|^passes test\s+"|^conforms to\s+/.test(claim)) return 3;
  if (/^boundary\s+"/.test(claim)) return 2;
  if (/^\S+\s+(exists at|imports)\b/.test(claim)) return 0;
  return 1;
}

export function neverRedFinding(node: string, claim: string, runs: number): Finding {
  return {
    advisory: "never-red",
    subject: `${node}::${claim}`,
    // The run count belongs HERE, not in the subject: it is the urgency, and urgency is
    // the most volatile thing about this finding.
    observation: `[${node}] ${claim} — green on all ${runs} run(s), and never watched fail`,
    because:
      "nothing has ever made this claim fail, and nobody has ever tried. A green claim and an"
      + " unfalsifiable one are indistinguishable from outside, so the evidence this claim offers"
      + " is currently unbounded above and unbounded below.",
    couldBe: [
      "the invariant is genuinely hard to break — the chokepoint makes the illegal state"
      + " unrepresentable, and green is the honest answer",
      // Explicitly marked because this generated candidate IS the apparatus hypothesis;
      // write-time safety never rests on a lexical guess about "the test itself".
      "[instrument] the oracle is vacuous — the test itself asserts something that cannot fail, over an empty"
      + " domain, through a regex that never matches, or past a guard that is never reached",
    ],
    discriminatedBy:
      "break the chokepoint: make the illegal state this claim forbids, run the oracle, and record"
      + " what it said. If it goes RED, the claim is load-bearing and the only gap was that nobody"
      + " had tried — write the observed negative control into `## refutations` and this question is"
      + " answered. If it stays GREEN, the oracle is not testing the claim, and what needs fixing is"
      + " the oracle.",
  };
}

/** A claim that is expensive to KEEP TRUE. Every claim is a standing bill: the oracle behind
 *  it runs on every verify, forever, and one claim taking a quarter of the whole tier is a
 *  fact about the design of that oracle, not about the code it guards. This is the WEAKEST
 *  finding the harness raises — an expensive claim can be entirely correct, and often the
 *  honest answer is "the domain really is that big" — so it never displaces a correctness
 *  question (see the raise order below).
 *
 *  IDENTITY IS THE CLAIM AND ITS NODE, WITH NO NUMBER IN IT. The millisecond reading is the
 *  most volatile thing here — it moves with machine load, cache state and the pool's mood —
 *  so it lives in the sentence, exactly like never-red's run count. */
export function costFinding(node: string, claim: string, ms: number, totalMs: number): Finding {
  const share = totalMs > 0 ? Math.round((ms / totalMs) * 100) : 0;
  return {
    advisory: "holding-cost",
    subject: `${node}::${claim}`,
    observation: `[${node}] ${claim} — ${(ms / 1000).toFixed(2)}s to verify, ${share}% of the whole claim tier`,
    because:
      "this claim is not verified once; it is verified on every run, forever. What it costs to"
      + " hold true is paid by every commit, every pre-commit hook and every CI job for as long"
      + " as the claim stands — and a tier that gets slow enough stops being run at all, which"
      + " is how a green harness quietly becomes an unrun one.",
    couldBe: [
      "the domain genuinely is that large — the oracle enumerates a real live domain and the"
      + " cost is the honest price of totality over it",
      "the oracle re-does shared setup per case (a pool boot, a fixture build, a network or"
      + " filesystem round trip inside the loop) that could be hoisted out of it",
      "the reading is an artifact of HOW it was timed — a pooled runner reports in-worker time,"
      + " which is not this claim's share of the suite's wall clock",
    ],
    discriminatedBy:
      "time the oracle alone, twice: once as it stands and once with its per-case setup hoisted"
      + " out of the loop. If the cost tracks the domain's size, it is the honest price of totality"
      + " and the finding closes as such. If it collapses when the setup moves, the cost was"
      + " apparatus, not evidence, and the oracle is what needs fixing — the claim is fine.",
  };
}

/** A named invariant with no observed negative control. Broader and weaker than never-red
 *  — it says nothing about how the claim has behaved — so it is raised LAST and only for
 *  invariants never-red did not already name. */
export function refutationFinding(comp: string, inv: string): Finding {
  return {
    advisory: "refutation",
    subject: `${comp}::${inv}`,
    observation: `invariant "${inv}" (${comp}) has never been observed failing — no entry in \`## refutations\``,
    because:
      "the spec asserts this property and something enforces it, but no one has recorded watching"
      + " the enforcement go red. Until they have, the oracle's grip on the invariant is asserted"
      + " rather than demonstrated.",
    couldBe: [
      "nobody has got to it — the invariant is young and the refutation is simply owed",
      "the chokepoint cannot actually be broken from outside, and there is no negative control to"
      + " run: the property is structural and the refutation should say THAT",
    ],
    discriminatedBy:
      `break what enforces "${inv}", run its oracle, and write the result into \`## refutations\` as`
      + " `<invariant>: <what was broken> -> <what was seen>`. If the break cannot be expressed, that"
      + " is itself the finding and belongs in the same place.",
  };
}

/** A claim on a kind the project flagged. The project decided this category is one it
 *  distrusts; the advisory prints it every run and then forgets it. */
export function warnedKindFinding(node: string, claim: string, kind: string, why?: string): Finding {
  return {
    advisory: "warned-kind",
    // The KIND is not in the subject. If the claim is re-kinded it stops being warned and
    // never re-raises anyway, so including it would only add a way for the key to move.
    subject: `${node}::${claim}`,
    // The project's `why` can run to a paragraph — planetizer's does — so it goes in
    // `because`, never in the title. A `chose` that carries the rationale is the exact
    // thing `LABEL_SOFT_MAX` warns about.
    observation: `[${node}] ${claim} — declared \`[${kind}]\`, a kind this project flags`,
    because:
      `the project declared "${kind}" a category worth reporting on every use. That declaration is a`
      + " standing suspicion about every claim carrying it, and this is one of them."
      + (why ? ` The project's own words: ${why}` : ""),
    couldBe: [
      "the claim really does pin a value — it will go red when the subject gets BETTER, and what it"
      + " needs is a band derived from the bar rather than a point taken from today's reading",
      "the kind is mis-declared — the claim asserts a structural or mathematical property and the"
      + ` \`[${kind}]\` tag is a leftover from when it was measured`,
    ],
    discriminatedBy:
      "ask the question the kind exists for: would this assertion go red if the subject got BETTER?"
      + " If yes it is a value-pin — replace the point with a band derived from the bar, and say what"
      + " the bar is. If no, the kind is wrong and the claim should carry the one it actually is.",
  };
}

export interface VerifyOpts {
  fast?: boolean; only?: Set<string>;
  raise?: boolean; raiseCap?: number; session?: string; agent?: string;
  /** `--from-report <file>`: resolve the executable tier from a report the project ALREADY
   *  produced, instead of running the suite. Implies batch mode even with no `testBatch`
   *  configured — the flag IS the opt-in, and the caller is asserting the file is current. */
  fromReport?: string;
  /** `--serial-oracles`: demand the per-claim profile — one full test-pool boot PER CLAIM.
   *  Never implicit; this flag (or `config.oracleExecution: "serial"`) is the only way in. */
  serial?: boolean;
}

export async function runVerify(cfg: Config, graph: Graph, opts: VerifyOpts): Promise<number> {
  const root = cfg.root;
  // THE NON-VACUITY FLOOR, checked before anything is graded — the instrument-check-first
  // idiom (test/commands.test.ts proves its AST scanner reads a plausible dispatch BEFORE
  // trusting any set comparison) applied to verify itself: a graph that derived EMPTY of
  // claims against a record that remembers a surface is a broken instrument, not a clean
  // bill. Refuse WITHOUT filing a record — a refusal that overwrote the memory it refused
  // against would refuse exactly once. Scoped runs cannot trip this: the graph is always
  // derived full-tree, so `--staged`/`--since` narrowing changes nothing the floor reads.
  const surface = readSurface(graph, await readStatus(cfg));
  const refusal = vacuityRefusal(surface);
  if (refusal) { for (const l of refusal) console.log(l); return 1; }
  // A MISCONFIGURED BATCH FORMAT FAILS THE RUN — it does not fall back. Reverting to the
  // per-claim path here would produce a correct-looking green that took thirty minutes,
  // and nobody diagnoses a typo they were never told about. Checked before any work so the
  // failure costs one line instead of a whole verify.
  const fmt = resolveBatchFormat(cfg);
  if ("error" in fmt) {
    console.log(`✗ ${fmt.error}`);
    console.log(`  fix config.testBatchFormat (or remove it — "vitest-json" is the default).`);
    return 1;
  }
  const batchFormat = fmt.format;
  // Collected per advisory rather than in one list, so the concat below can state the
  // PRIORITY explicitly. The cap is per run, so under it the order is the whole policy.
  const neverRed: Finding[] = [], warnedKind: Finding[] = [], refutation: Finding[] = [], cost: Finding[] = [];
  // Which invariants never-red already named — the refutation advisory is a superset of it
  // and would otherwise raise the same question twice under two keys.
  const neverRedInvariants = new Set<string>();
  // Invariants ANCHORED by a `boundary "<name>" ...` claim, per component label. The
  // coverage gate fails any `## invariants` entry that nothing anchors (the ratchet).
  const anchored = new Map<string, Set<string>>();
  let tc: { pass: boolean; detail: string } | null = null;
  const typecheck = () => {
    if (tc) return tc;
    const r = spawnSync(cfg.typecheck[0], cfg.typecheck.slice(1), { cwd: root, encoding: "utf8", timeout: 120000 });
    const tail = ((r.stderr || "") + (r.stdout || "")).split("\n").filter(Boolean).slice(-3).join(" | ");
    tc = r.status === 0 ? { pass: true, detail: "" } : { pass: false, detail: tail.slice(0, 200) };
    return tc;
  };

  // ── BATCHED ORACLE EXECUTION (config.testBatch). Memoized and LAZY, exactly like
  // `typecheck` above: the suite runs at most once per verify, and only if some executable
  // claim actually asks. So `--fast` (whole executable tier skipped) and a project with no
  // test-backed claims never pay for it, and configuring the feature cannot slow anything
  // down. A SCOPED run (--staged/--since) still runs the batch WHOLE and resolves only the
  // in-scope claims from it — one boot is already cheaper than three scoped per-claim boots.
  //
  // The mode is decided ONCE, up front (selectOracleMode), and the serial per-claim profile
  // is not reachable without naming it. Resolution itself stays LAZY and memoized, exactly
  // like `typecheck`: a `--fast` run or a project with no executable claims never triggers
  // any of this, which is also why a REFUSAL cannot fire on a project the feature does not
  // concern.
  const mode = selectOracleMode(cfg, { fromReport: opts.fromReport, serial: opts.serial });
  // How many claims the serial path would charge for — approximate on purpose (a `conforms
  // to` word expands to an unknown number), and used only in the cost framing. Lazy because
  // the in-scope component list is built further down, and this is only ever needed from
  // inside the thunk (i.e. after it exists).
  const executableish = () => comps.reduce((n, c) => n + (c.claims ?? []).filter((cl) =>
    /^passes test\s+"/.test(cl) || /\svia\s+(test|guard)\s+"/.test(cl) || /^conforms to\s+/.test(cl)).length, 0);
  let access: OracleAccess | null = null;
  let batchEngaged = false;
  let refused = false;
  const oracles = (): OracleAccess => {
    if (access) return access;
    // EVERY serial grant passes through here, and the CANARY runs first: before trusting
    // the per-claim runner with any verdict, ask it to fail a test that provably exists
    // nowhere. A runner that passes the canary cannot filter by name — every green it
    // would produce is green-by-absence (the exact vacuity the batch path already closes
    // structurally) — so it is REFUSED, exactly like a mode with no runner at all.
    // Once per verify by construction: oracles() is memoized.
    const grantSerial = (why: string): OracleAccess => {
      if (cfg.test && cfg.test.length) {
        const c = proveSerialRunnerCanFail(cfg, root);
        if (!c.proven) {
          refused = true;
          console.log(`✗ [oracles] the serial runner CANNOT FAIL: it passed "${c.canary}" — a test that`);
          console.log(`  provably exists nowhere. A runner that cannot red a vanished oracle offers no`);
          console.log(`  evidence when it greens a real one. Make config.test exit nonzero on an unknown`);
          console.log(`  name, or set config.testMatch to demand positive evidence of the run, or batch`);
          console.log(`  (config.testBatch / --from-report), where absence is structurally observable.`);
          return { report: null, serialAllowed: false };
        }
      }
      for (const l of serialCostLines(executableish(), why)) console.log(l);
      return { report: null, serialAllowed: true };
    };
    const engage = (out: BatchOutcome, what: string): OracleAccess => {
      if (out.report) {
        batchEngaged = true;
        console.log(`oracles: ${what} — report parsed (${batchFormat}), ${out.note}; resolving every executable claim from it`);
        return { report: out.report, serialAllowed: false };
      }
      // NEVER A SILENT DEGRADE. Falling back is legitimate; falling back invisibly is not.
      // The fallback is also the one remaining route to the serial profile that nobody typed,
      // so it states the cost in full rather than just the reason.
      console.log(`  ! oracles: ${what} FAILED — ${out.note}`);
      console.log(`  ! FALLING BACK to the serial per-claim runner (config.test).`);
      return grantSerial("batch fallback");
    };
    if (mode.kind === "from-report") {
      console.log(`oracles: reading an existing report — ${mode.file} (running no tests)`);
      access = engage(readReportFile(root, mode.file, batchFormat), `--from-report ${mode.file}`);
    } else if (mode.kind === "batch") {
      console.log(`oracles: batched — running the whole suite ONCE${mode.derived ? " (command derived from config.test)" : ""}: ${mode.cmd.join(" ")}`);
      access = engage(runTestBatch(mode.cmd, root, batchFormat), "the batch run");
    } else if (mode.kind === "serial") {
      access = grantSerial(mode.why);
    } else {
      // REFUSE. Fail closed and loud: no batch available, no report handed over, and nobody
      // asked for the slow profile. Silently running it would be the one outcome this
      // release exists to make unreachable.
      refused = true;
      console.log(`✗ [oracles] cannot run the executable tier, and will not silently run it the slow way.`);
      for (const l of mode.lines) console.log(l ? `  ${l}` : "");
      access = { report: null, serialAllowed: false };
    }
    return access;
  };
  // `ms`/`msSource` are the claim's HOLDING COST — what it costs, per run, to keep this claim
  // true. Two sources, and which one answered is recorded rather than blended: "report" is the
  // runner's own per-test duration (the only honest reading for a batch-resolved claim, whose
  // wall time here is a map lookup), "wall" is verify's own clock around evalClaim (the only
  // reading available for everything else — a typecheck, a fetch, a serial runner boot).
  type Sig = { kind: "pass" | "fail" | "skip"; claim: string; node: string; detail?: string; declaredKind?: string; ms?: number; msSource?: "wall" | "report" };
  // Undeclared (the default) leaves the whole mechanism off: kinds are neither required
  // nor checked, and every existing spec in the world parses unchanged.
  const kindPolicy = cfg.claimKinds;
  // The claim grammar is a declarative registry (src/phrasebook.ts): an ordered list of
  // ClaimForms, first match wins (the order IS the historical precedence). evalClaim is now
  // a thin loop — build the per-claim context, find the first matching form, adapt its
  // ClaimResult into a Sig. A line matching NO form still skips as a dialect gap. The
  // boundary + `conforms to` forms anchor invariants via ctx.anchor so the coverage gate
  // sees them (including boundaries reached transitively through a dictionary word).
  const evalClaim = async (claim: string, nodeDir: string, node: string, declaredKind?: string): Promise<Sig> => {
    // The kind arrives ALREADY SEPARATED, stripped by parseSpec (src/walk.ts) at the single
    // parse site. It is deliberately NOT re-parsed here: `claim` is the bare text, identical
    // to what 0.10.0 saw, so every form's grammar, the coverage ratchet, and the status
    // record's identity are untouched. What a kind MEANS is the project's business
    // (config.claimKinds); an unknown one is red because a typo must not grade as unkinded.
    if (kindPolicy && declaredKind && !kindPolicy[declaredKind])
      return { kind: "fail", claim, node, declaredKind,
        detail: `unknown claim kind "${declaredKind}" — config.claimKinds declares: ${Object.keys(kindPolicy).join(", ")}` };
    const ctx: ClaimCtx = {
      cfg, graph, root, nodeDir, node, fast: !!opts.fast, typecheck, wordStack: [], oracles,
      anchor: (inv) => { let set = anchored.get(node); if (!set) { set = new Set(); anchored.set(node, set); } set.add(inv); },
    };
    for (const form of CLAIM_FORMS) {
      const m = form.match(claim);
      if (m) { const r = await form.evaluate(ctx, m); return { kind: r.kind, claim, node, detail: r.detail, declaredKind, ms: r.ms }; }
    }
    return { kind: "skip", claim, node, detail: "no verifier (dialect gap)", declaredKind };
  };

  // `only` (verify --staged/--since) scopes the run to the components whose dirs
  // changed — the edit-loop affordance. The boundary-anchoring + coverage gates below
  // then cover exactly the touched components, so a fast scoped check still fails on a
  // touched-but-broken invariant. Symbol resolution for boundary claims stays GLOBAL
  // (a touched chokepoint's oracle may name a symbol defined elsewhere).
  const comps = graph.nodes.filter((n) => n.kind === "component" && (!opts.only || opts.only.has(n.id.slice(2))));
  const compDirs = graph.nodes.filter((n) => n.kind === "component").map((n) => n.id.slice(2));
  // Scope the (advisory) symbol-doc coverage to the touched components too, so a
  // staged run doesn't dump every undocumented symbol in the repo as a job.
  const symbols = graph.nodes.filter((n) => {
    if (n.kind !== "symbol") return false;
    if (!opts.only) return true;
    const owner = n.path == null ? null : ownerOf(n.path, compDirs);
    return owner !== null && opts.only.has(owner);   // an unowned symbol is in no scope
  });
  // A SCOPED RUN THAT EVALUATES NOTHING SAYS SO, and never says "✓ coherent". A verdict
  // has two halves — the population examined and what was found there — and dropping the
  // population makes `0 of 0` render exactly like `0 of 500`. Reached when the scope set
  // names no component the graph carries, which is what a fabricated scope entry looked
  // like before `ownerOf` could return null (a healthy tree, one unowned root-level file
  // changed, `verify --staged` → `scoped to 1 changed component(s): .` over a component
  // that does not exist, `claims: 0`, `✓ coherent`, exit 0).
  //
  // NOT A REFUSAL. An empty scope is ordinary — the caller may legitimately hand us one —
  // so this is the sentence cli.ts already prints for "no changed file maps to a
  // component", exit 0. The floor above still guards the case that is NOT ordinary: a
  // derived graph gone empty against a record that remembers a surface.
  if (opts.only && comps.length === 0) {
    console.log(`verify (scoped): the scope names no component in the derived graph — nothing to check.`);
    return 0;
  }
  const sigs: Sig[] = [];
  // THE CLOCK RUNS AROUND EVERY CLAIM, and the form's own reading OUTRANKS it when there is
  // one. Wall time here is the honest cost of a typecheck, a fetch or a serial runner boot;
  // it is a lie for a batch-resolved claim, where the whole suite already ran once and this
  // measurement would be a map lookup. So: report ms if the form supplied it, wall otherwise,
  // and the record says which — a cost table that silently mixes the two is unreadable.
  for (const c of comps) {
    const dir = c.id.slice(2);
    const diskDir = dir === "." ? root : join(root, dir);
    for (const cl of c.claims || []) {
      const t0 = performance.now();
      const sg = await evalClaim(cl, diskDir, c.label, (c as any).claimKinds?.[cl]);
      const wall = performance.now() - t0;
      if (sg.ms == null) { sg.ms = wall; sg.msSource = "wall"; }
      else sg.msSource = "report";
      sigs.push(sg);
    }
  }
  const red = sigs.filter((s) => s.kind === "fail").length;
  console.log(`claims: ${sigs.length} · ${sigs.filter((s) => s.kind === "pass").length} green · ${red} red · ${sigs.filter((s) => s.kind === "skip").length} skipped`);
  for (const s of sigs) if (s.kind !== "pass") console.log(`  ${s.kind === "fail" ? "✗" : "·"} [${s.node}] ${s.claim}${s.detail ? ` — ${s.detail}` : ""}`);

  // ── KINDS. Advisory by design: adoption is gradual, so an unkinded claim in a project
  // that HAS declared kinds is reported, never failed. A `warn` kind is listed every time
  // it is used — that tier exists to make a category the project distrusts impossible to
  // use quietly, not impossible to use.
  if (kindPolicy) {
    const warnKinds = new Set(Object.entries(kindPolicy).filter(([, v]) => v.policy === "warn").map(([k]) => k));
    const warned = sigs.filter((s) => s.declaredKind && warnKinds.has(s.declaredKind));
    const unkinded = sigs.filter((s) => !s.declaredKind);
    console.log(`kinds: ${sigs.length - unkinded.length}/${sigs.length} declared` + (warned.length ? ` · ${warned.length} on a warned kind` : ""));
    // Grouped by kind, so the project's `why` is stated ONCE. Repeating a paragraph of
    // rationale per claim is how the rationale stops being read.
    for (const k of warnKinds) {
      const of = warned.filter((s) => s.declaredKind === k);
      if (!of.length) continue;
      const why = kindPolicy[k]?.why;
      console.log(`  ! kind "${k}" — ${of.length} claim(s)${why ? `: ${why}` : ""}`);
      listCapped(of, (s) => `      [${s.node}] ${s.claim}`);
      for (const s of of) warnedKind.push(warnedKindFinding(s.node, s.claim, k, why));
    }
    listCapped(unkinded, (s) => `  · [${s.node}] ${s.claim} — no kind declared (advisory)`);
  }

  // ── REFUTATIONS. A claim nobody has watched fail is not evidence. `## refutations`
  // records the observed negative control per invariant; this reports the gap. Advisory:
  // the harness cannot know whether an unrefuted claim is lazy or merely young.
  //
  // The per-invariant list appears only once the project has declared its FIRST
  // refutation. Before that the count alone is the message: an advisory that prints
  // a line per invariant on a project that has never used the feature is a nag, and a
  // nag that fires every run on every project is one people learn to scroll past.
  {
    const invs: string[] = [], refs: string[] = [];
    for (const c of comps) { for (const i of (c as any).invariants || []) invs.push(i); for (const r of (c as any).refutations || []) refs.push(r); }
    if (invs.length) {
      const refuted = refutedInvariants(refs);
      const missing = invs.filter((i) => !refuted.has(i));
      console.log(`refutations: ${invs.length - missing.length}/${invs.length} invariants carry an observed negative control`
        + (refs.length ? "" : " — none declared; see README `## refutations`"));
      // THE `refs.length` GATE IS THE REPORTING FLOOR, and raising honours it exactly.
      // Before a project has declared its first refutation the count alone is the message
      // — printing a line per invariant on a project that has never used the feature is a
      // nag. Raising a QUESTION per invariant there would be the same nag with an id, and
      // on a spec-heavy repo it is the single biggest source of first-run volume.
      if (refs.length) {
        listCapped(missing, (i) => `  · [refutation] "${i}" — never observed failing (advisory)`);
        for (const c of comps) {
          for (const i of ((c as any).invariants ?? []) as string[]) {
            if (!refuted.has(i)) refutation.push(refutationFinding(c.label, i));
          }
        }
      }
    }
  }

  // ── THE DECORATION FILTER. Neither signal is worth much alone: a claim that has never
  // been red may simply be a good invariant, and a claim with no recorded refutation may
  // simply be young. TOGETHER they are the honest suspect list — nothing has ever made
  // this fail, and nobody has ever tried. Advisory, and deliberately quiet when the
  // record is new (a first run has no history to report).
  {
    const prior = await readStatus(cfg);
    // claimKey, not the raw string: a raw-keyed history lookup here made the checker with
    // the richest failure record read as never-red the run after its boundary was annotated
    // with a `crossing` clause (the record held the pre-annotation claim text).
    const hist = indexClaimRecords(prior.verify?.claims || []);
    const seasoned = sigs.filter((sg) => {
      const h = hist.get(claimKey(sg.node, sg.claim));
      return h && (h.runs ?? 0) >= 3 && !h.everFailed;
    });
    if (seasoned.length) {
      const refs = new Set<string>();
      for (const c of comps) for (const i of refutedInvariants((c as any).refutations)) refs.add(i);
      const bare = seasoned.filter((sg) => { const m = /^boundary\s+"([^"]+)"/.exec(sg.claim); return !m || !refs.has(m[1]); });
      if (bare.length) {
        bare.sort((a, b) => neverRedRank(b.claim) - neverRedRank(a.claim));
        console.log(`never red: ${bare.length} claim(s) green every run so far, with no recorded refutation`);
        listCapped(bare, (sg) => {
          const h = hist.get(claimKey(sg.node, sg.claim))!;
          return `  · [never-red] [${sg.node}] ${sg.claim} — ${h.runs} run(s), never observed failing`;
        });
        for (const sg of bare) {
          neverRed.push(neverRedFinding(sg.node, sg.claim, hist.get(claimKey(sg.node, sg.claim))!.runs ?? 0));
          const m = /^boundary\s+"([^"]+)"/.exec(sg.claim);
          if (m) neverRedInvariants.add(`${sg.node}::${m[1]}`);
        }
      }
    }
  }

  // ── HOLDING COST. The work ledger's other half: verification says whether the claims are
  // true, this says what it costs to KEEP them true, every run, forever. The instrument is
  // per-claim `ms` (see Sig) and the report is deliberately a TOP-N, not a table — the point
  // is the tail that dominates, not a per-claim timing dump nobody reads.
  //
  // THE FLOOR IS THE SAME PHILOSOPHY AS THE REFUTATIONS FLOOR: an advisory that fires on every
  // project on every run is one people learn to scroll past. On a fast suite there is nothing
  // to say, so it says nothing — no "cost: 0.1s" line, no reassurance. It speaks only when the
  // tier costs a noticeable second in aggregate, or when a single claim is heavy enough to be
  // worth a name on its own.
  const totalMs = sigs.reduce((n, s) => n + (s.ms ?? 0), 0);
  const COST_TOTAL_FLOOR_MS = 1000, COST_CLAIM_FLOOR_MS = 250;
  // Most expensive first — the report's top-5 and the record's stored vector are both slices
  // of this one ordering, so the panel can never disagree with the console about what is
  // expensive.
  const timed = sigs.filter((s) => s.ms != null).sort((a, b) => (b.ms as number) - (a.ms as number));
  {
    const loud = totalMs >= COST_TOTAL_FLOOR_MS || timed.some((s) => (s.ms as number) >= COST_CLAIM_FLOOR_MS);
    if (timed.length && loud) {
      // WORDED AGAINST A MEASURED FACT, not a guess: the total is a SUM OF PER-CLAIM COSTS
      // and a pooled runner overlaps them, so it is NOT the suite's wall clock. Measured on a
      // 4-file vitest suite sleeping 800ms per file: wall 1.04s, sum 3.21s — a 3.1x overshoot,
      // because each worker's ~800ms is a truthful reading of the same wall seconds. Calling
      // this "took 3.2s" would be the instrument lying about what it measured.
      console.log(`holding cost: ${(totalMs / 1000).toFixed(1)}s across ${timed.length} claim(s) — summed per-claim cost of keeping them true, per run (a pooled runner overlaps some of it)`);
      for (const s of timed.slice(0, 5))
        console.log(`  · [cost] [${s.node}] ${s.claim.length > 60 ? s.claim.slice(0, 59) + "…" : s.claim} — ${(s.ms as number).toFixed(0)}ms (${s.msSource})`);
    }
    // A claim raised for cost is one that is BOTH expensive in absolute terms and a large
    // share of the bill: a whole second is the floor below which nobody should be asked a
    // question, and a quarter of the tier is what makes one claim the answer to "why is this
    // slow". Both, because a 1.1s claim in a 40s tier is not the story, and a 25% share of a
    // 0.2s tier is not a cost.
    for (const s of timed)
      if ((s.ms as number) >= Math.max(COST_TOTAL_FLOOR_MS, totalMs * 0.25))
        cost.push(costFinding(s.node, s.claim, s.ms as number, totalMs));
  }

  // ── RAISING. One call, after every advisory has spoken, because the cap is per RUN and
  // a per-advisory cap would let three detectors open nine questions between them while
  // each believed it was being modest.
  //
  // THE ORDER IS THE POLICY, since under the cap only the head of this list is written:
  //   1. never-red     — green every run AND never watched fail. Two independent weak
  //                      signals agreeing is the honest suspect list.
  //   2. warned-kind   — the project itself declared this category suspect. One claim, one
  //                      concrete question, and the answer changes what the claim asserts.
  //   3. refutation    — every invariant lacking a negative control. Broadest, weakest, and
  //                      a strict superset of never-red's boundary claims, so it drops the
  //                      ones already asked about rather than asking the same thing twice.
  //   4. holding-cost  — the weakest signal there is, and LAST on purpose: an expensive claim
  //                      may be perfectly correct, so "costly to keep true" must never outrank
  //                      a question about whether something is true at all. Cost is a question
  //                      about the apparatus; the three above are questions about the record.
  {
    const findings = [
      ...neverRed, ...warnedKind,
      ...refutation.filter((f) => !neverRedInvariants.has(f.subject)),
      ...cost,
    ];
    const report = raiseFindings(cfg, readJournal(cfg).records, findings, {
      enabled: opts.raise, cap: opts.raiseCap, session: opts.session, agent: opts.agent,
    });
    for (const line of formatRaise(report)) console.log(line);
  }

  const jobs: Array<Record<string, any>> = [];
  let narr: { statements: any[] } | null = null;
  try { narr = JSON.parse(await readFile(narrPath(cfg), "utf8")); } catch { /* none */ }
  let broken = 0;
  if (narr?.statements) {
    let unchanged = 0, pending = 0;
    for (const st of narr.statements) {
      const { text, missing } = await evidence(root, st.evidence);
      if (missing.length) { broken++; st.status = "broken"; console.log(`  ✗ [narrative ${st.id}] broken evidence: ${missing.join(", ")}`); continue; }
      const h = hashOf(text);
      if (h === st.verifiedHash) { unchanged++; st.status = "ok"; continue; }
      st.status = "pending"; pending++;
      jobs.push({ kind: "verify-statement", id: st.id, statement: st.statement, evidenceFiles: st.evidence.filter((e: string) => e.startsWith("file:")).map((e: string) => e.slice(5)), currentHash: h });
    }
    await writeFile(narrPath(cfg), JSON.stringify(narr, null, 2) + "\n");
    console.log(`narrative: ${narr.statements.length} statements · ${unchanged} unchanged · ${pending} need verification · ${broken} broken`);
  }

  // Coverage gates NODE-CONTRACT completeness (does each node carry claims + a why),
  // NOT symbol-doc exhaustiveness. Per-symbol prose is advisory: forcing a docblock on
  // every export produces stale busywork and a perpetually-red baseline that trains
  // contributors to ignore the gate. Undocumented symbols still surface as jobs.
  const compGaps = comps.filter((c) => !(c.claims && c.claims.length));
  const docGaps = symbols.filter((s) => !isDocumented(s));
  const whyGaps = comps.filter((c) => !c.why || !String(c.why).trim());
  console.log(`coverage: components ${comps.length - compGaps.length}/${comps.length} claimed, ${comps.length - whyGaps.length}/${comps.length} with why · symbols ${symbols.length - docGaps.length}/${symbols.length} documented (advisory)`);
  for (const c of compGaps) { console.log(`  ✗ [coverage] component "${c.label}" has no claims`); jobs.push({ kind: "generate-claims", id: c.id, name: c.label }); }
  for (const c of whyGaps) { console.log(`  ✗ [coverage] component "${c.label}" states no rationale (why)`); jobs.push({ kind: "author-why", id: c.id, name: c.label }); }
  // advisory only — emitted as jobs, never gated, but ORDERED: hottest defining file first,
  // so the top of a ninety-job list is the symbol somebody is about to read. The git read is
  // guarded because a docs-complete project must not spawn one to rank an empty list.
  if (docGaps.length) {
    const { byFile, considered } = fileChurn(rebaseCommits(readCommitLog(cfg, CHURN_WINDOW), gitPrefix(cfg)));
    for (const s of rankDocGaps(docGaps, byFile, considered)) {
      // `hot` is ADDITIVE in verify-jobs.json: an older consumer ignores a field it does not
      // know, and a cold gap carries no field at all rather than a `hot: 0` that would read
      // as a measurement of coldness.
      jobs.push({ kind: "generate-doc", id: s.id, file: s.path, line: s.line, name: s.label, ...(s.share >= HOT_DOC_FLOOR ? { hot: s.share } : {}) });
    }
    console.log(`  · [advisory] ${docGaps.length} symbol(s) undocumented (not gated)`);
  }
  // RATCHET coverage: a named invariant with no `boundary` claim is a property the spec
  // asserts but nothing enforces/anchors — fail it, the way a boundary shipped without
  // its totality oracle should fail loud rather than rot silently.
  const invGaps: { comp: string; inv: string }[] = [];
  for (const c of comps) for (const inv of c.invariants ?? []) if (!anchored.get(c.label)?.has(inv)) invGaps.push({ comp: c.label, inv });
  for (const g of invGaps) { console.log(`  ✗ [coverage] invariant "${g.inv}" (${g.comp}) is not anchored by a boundary claim`); jobs.push({ kind: "anchor-invariant", comp: g.comp, inv: g.inv }); }
  const totalInv = comps.reduce((n, c) => n + (c.invariants?.length ?? 0), 0);
  if (totalInv) console.log(`invariants: ${totalInv - invGaps.length}/${totalInv} anchored by a boundary claim`);
  const covGaps = compGaps.length + whyGaps.length + invGaps.length;

  const verifyJobs = jobs.filter((j) => j.kind === "verify-statement");
  const genJobs = jobs.filter((j) => j.kind === "generate-doc" || j.kind === "generate-claims");
  const authorJobs = jobs.filter((j) => j.kind === "author-why");
  if (jobs.length) {
    await mkdir(join(root, ".coherence"), { recursive: true });
    await writeFile(jobsPath(cfg), JSON.stringify(jobs, null, 2) + "\n");
    console.log(`\n=== JOBS — ${jobs.length} (dispatch a subagent) · .coherence/verify-jobs.json ===`);
    if (verifyJobs.length) { console.log(`\n VERIFY (evidence changed — judge if the statement still holds):`); console.log(`   → write .coherence/verify-verdicts.json, then re-run with --apply .coherence/verify-verdicts.json`); for (const j of verifyJobs) console.log(`   [${j.id}] "${j.statement}"`); }
    if (genJobs.length) { console.log(`\n GENERATE — the WHAT (derivable; write into source, re-run):`); for (const j of genJobs) console.log(j.kind === "generate-doc" ? `   [doc] ${j.name} at ${j.file}:${j.line}${j.hot ? ` (hot: ${Math.round(j.hot * 100)}% of recent commits)` : ""}` : `   [claims] component "${j.name}" — add a ## works when block`); }
    if (authorJobs.length) { console.log(`\n AUTHOR — the WHY (NOT derivable — do not fabricate; needs a human/attested author):`); for (const j of authorJobs) console.log(`   [why] component "${j.name}" — states no rationale`); }
  }

  // A REFUSED executable tier is a run failure in its own right. The claims it could not
  // run merely SKIPPED, so without this the run would exit 0 having verified nothing
  // executable — a silent pass, which is the exact shape of failure this release removes.
  const failures = red + broken + covGaps + (refused ? 1 : 0);
  // THE ADOPTION LADDER — the floor's other face (src/floor.ts). Zero claims with nothing
  // remembered is the ON-RAMP, not an error and not "✓ coherent": name the state, print
  // THE ONE NEXT ACTION, exit 0 — a bare repo must be able to adopt without fighting the
  // gate, and its coverage gaps ARE the on-ramp state rather than failures. Rungs 4–5
  // (claims that cannot fail / never observed failing) ride along AFTER the normal
  // verdict: there they are the next action, never a verdict override.
  const ladder = await adoptionLadder(cfg, graph);
  const onramp = !!ladder && ladder.onramp && red === 0 && broken === 0 && !refused;
  if (onramp) {
    console.log("");
    for (const l of ladder!.lines) console.log(l);
  } else {
    console.log(failures === 0 ? (verifyJobs.length ? `\n• ${verifyJobs.length} verification job(s) pending` : "\n✓ coherent") : `\n✗ ${failures} coherence failure(s) — ${red} claim · ${broken} broken · ${covGaps} coverage${refused ? " · 1 executable tier refused (see [oracles] above)" : ""}`);
    if (ladder) { console.log(""); for (const l of ladder.lines) console.log(l); }
  }

  // File the report (`.coherence/status.json`) — the run record the panel (and any
  // other consumer) reads. Coverage + invariant TOTALS are static full-tree graph
  // facts, so a scoped run still records them honestly; per-claim verdicts and the
  // gap list merge inside recordVerify (scoped runs replace only what they touched).
  // A failed write must never fail the verify itself (read-only checkout, etc.).
  try {
    const allComps = graph.nodes.filter((n) => n.kind === "component");
    const allSymbols = graph.nodes.filter((n) => n.kind === "symbol");
    await recordVerify(cfg, {
      tier: opts.fast ? "fast" : "full",
      scope: opts.only ? comps.map((c) => c.label) : null,
      batched: batchEngaged,
      sigs,
      coverage: {
        components: allComps.length,
        claimed: allComps.filter((c) => c.claims && c.claims.length).length,
        withWhy: allComps.filter((c) => c.why && String(c.why).trim()).length,
        symbols: allSymbols.length,
        documented: allSymbols.filter(isDocumented).length,
      },
      invTotal: allComps.reduce((n, c) => n + (c.invariants?.length ?? 0), 0),
      invGaps,
      narrative: narr?.statements
        ? { statements: narr.statements.length, unchanged: narr.statements.filter((s: any) => s.status === "ok").length, pending: narr.statements.filter((s: any) => s.status === "pending").length, broken }
        : null,
      jobs: jobs.length,
      // The on-ramp files failures: 0 — its coverage gaps are the adoption state the
      // ladder just named, and a record that said "failed" beside an exit-0 run would
      // hand the panel two verdicts for one run.
      failures: onramp ? 0 : failures,
      // The HOLDING-COST vector, top-N rather than every claim: the record is read by the
      // panel, which shows the head of it, and a per-claim timing dump would double the size
      // of status.json to carry a tail nobody displays. `source` rides along per row because
      // a report ms and a wall ms are not the same measurement (see Sig).
      cost: { totalMs, claims: timed.slice(0, COST_RECORD_CAP).map((s) => ({ node: s.node, claim: s.claim, ms: s.ms as number, source: s.msSource ?? "wall" })) },
    });
  } catch { /* the record is best-effort; the console report already happened */ }
  return onramp || failures === 0 ? 0 : 1;
}
