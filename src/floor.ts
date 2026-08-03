// floor.ts — the NON-VACUITY FLOOR and the adoption on-ramp: one reading of the derived
// verification surface, answered two ways depending on what the record remembers.
//
// THE DEFECT THIS CLOSES (measured twice, 2026-07-31): gut `buildGraph` to return an
// empty graph and `verify` printed `claims: 0 · 0 green · 0 red · 0 skipped` and
// `✓ coherent`, exit 0. Every claim-defended verdict in a project silently rests on the
// graph deriving non-empty, and nothing checked that premise. It is the instrument-check-
// first idiom (test/commands.test.ts checks its AST scanner finds a plausible dispatch
// BEFORE trusting any set comparison) applied to verify itself: before grading claims,
// prove there is a surface to grade.
//
// A repo with a gutted deriver and a repo that never adopted the harness produce the
// IDENTICAL observation — zero components, zero claims. What separates them is MEMORY:
// `.coherence/status.json` remembers how many claims the last run graded. So one reading
// (readSurface) feeds two answers:
//   · remembered > 0, surface empty  → REFUSE (vacuityRefusal). A verification surface
//     does not vanish because the work is done; it vanishes when derivation breaks.
//   · nothing remembered, no claims  → the ON-RAMP (adoptionLadder): name the adoption
//     state and print THE ONE NEXT ACTION, re-runnable, one rung per run.
//
// WHAT THE FLOOR DELIBERATELY DOES NOT CATCH: a PARTIAL collapse (27 → 3) where every
// component still carries at least one claim. That shape is observationally identical to
// deliberate spec pruning — this repo pruned green trivialities from its own spec the day
// this floor was written, and evicted two whole components in the same release — and
// refusing it would train people to reset the record instead of reading the refusal.
//
// AND THE COMPLEMENT IS WEAKER THAN THIS COMMENT USED TO CLAIM. It said coverage reds any
// component whose claims all vanished, "so a collapse that stays green requires every
// component to keep one". That holds only when the component NODE SURVIVES with zero
// claims — a broken spec parse. Coverage iterates the DERIVED graph, so a component the
// WALK dropped entirely is invisible to it: there is no node left to red. Measured
// 2026-07-31 with an ignore/glob-bug simulacrum (one component removed from what the walk
// discovers): the record remembered 2 claims, the run printed `claims: 1 · 1 green` and
// `✓ coherent` exit 0 with `components 1/1 claimed`, and the record was laundered down to
// 1 claim in the same run — so a gradual N→1 collapse never accumulates toward this floor
// at all. Each step looks like one pruned component.
//
// THAT HOLE IS NAMED RATHER THAN CLOSED, and deliberately. A vanished node is exactly what
// deleting a component's spec produces, and deletion must stay free — a gate that punishes
// removal teaches people to stop removing, which is the same argument
// `ratchetVacuityRefusal` makes below for partial shrinkage. THE MITIGATION IS A PIN, not
// a gate: a `measures` dimension in `config.mass` whose command counts the population
// (component nodes or claim lines in the derived graph) makes the shrink a RATCHET
// finding — reviewable, waivable by re-pinning with a diff, and answering the question
// this floor cannot: not "is there anything left?" but "is there as much as there was?".
//
// AND THAT PIN IS NOW WIRED IN THIS REPO, which it was not when the paragraph above was
// written (2026-08-03: an audit found coherence ran 2 of the 7 gates it ships, and the
// sharpest instance was this comment prescribing a mitigation the config did not carry).
// `coherence.config.json` declares `mass.measures` = graph-components + graph-claims,
// both from `scripts/graph-population.mjs`, which DERIVES the graph rather than reading
// the committed artifact — a probe that read `public/graph.json` would report the
// pre-collapse population and pin the collapse as no-change. Pinned at 4 components / 29
// claims and checked per-push. Verified by simulating the exact defect this paragraph
// describes (ignoring `adapters`, so one component leaves the walk): `mass --check`
// printed `measure|graph-components 3 ← 4  -1` and `measure|graph-claims 26 ← 29  -3`
// under "6 dimension(s) SHRANK since the pin (never a failure) — re-pin to bank it".
// A finding a human re-pins with a diff, which is exactly what was specified.
//
// SCOPED RUNS CANNOT TRIP THE FLOOR, structurally: the floor reads the DERIVED GRAPH,
// which is always full-tree — `--staged`/`--since` narrow which components are EVALUATED,
// never what is derived. A reading taken above the scoping seam needs no scope exemption.
//
// THE SAME READING, GENERALIZED (2026-07-31, the same day as the graph floor above). A verdict has two halves: the POPULATION an
// instrument examined and what it found there. Drop the population and `0 of 0` renders
// exactly like `0 of 500` — "I looked and found nothing wrong" becomes indistinguishable
// from "I did not look". Two more shapes of that defect live here beside the graph floor,
// because they are one doctrine and not three:
//   · `ratchetVacuityRefusal` — the BASELINED ratchets (mass, conventions, lint-sinks) hold
//     the same memory/reading pair verify does, with the baseline playing status.json's
//     part. Each supplies its OWN denominator: mass counts graph files+symbols, while
//     lint-sinks never sees a graph at all (it reads scanSources), so "the graph has no
//     claims" is the wrong instrument for it. The rule is shared; the reading is not.
//   · `Unrunnable` — green-by-absence wearing the opposite face. An instrument that cannot
//     run must say WHY in a sentence; a stack trace is a report that failed to say what was
//     and was not measured, which is the same defect with the sign flipped.
//   · `readJsonOrRefuse` — the same defect ONE LAYER DOWN, in the memory every floor above
//     reads. Every one of these gates is a comparison between a live reading and a
//     REMEMBERED one, and each remembered one lives in a JSON file that was loaded by
//     `catch → return default`. That catch cannot tell "the file is not there" from "the
//     file is there and I could not read it", so a single unparseable byte turned every
//     floor on this page off.
import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config, Graph } from "./types.ts";
import type { StatusRecord } from "./status.ts";

/** The derived surface vs the remembered one. `remembered` is the prior record's claim-row
 *  count; null means no verify section has ever been filed (a genuinely new project). */
export interface SurfaceReading {
  components: number;        // component nodes in the (always full-tree) derived graph
  claims: number;            // claim lines those components carry, summed
  remembered: number | null; // prior record's claim rows; null = no record at all
  rememberedAt?: string;
  rememberedCommit?: string | null;
}

export function readSurface(graph: Graph, prior: StatusRecord): SurfaceReading {
  const comps = graph.nodes.filter((n) => n.kind === "component");
  return {
    components: comps.length,
    claims: comps.reduce((n, c) => n + (c.claims?.length ?? 0), 0),
    remembered: prior.verify ? prior.verify.claims.length : null,
    rememberedAt: prior.verify?.at,
    rememberedCommit: prior.verify?.commit,
  };
}

/**
 * THE FLOOR — the refusal, or null when the run may proceed to grading.
 *
 * Refuses exactly when the record remembers a non-empty surface (≥1 claim row) and the
 * derived graph carries ZERO claims — whether because it derived zero components (the
 * gutted-deriver shape) or components stripped of every claim (a broken spec parse).
 * The refusal is a run failure that must be printed and exited 1 WITHOUT filing a
 * record: a refusal that overwrote the memory it refused against would refuse only once.
 */
export function vacuityRefusal(s: SurfaceReading): string[] | null {
  if (!s.remembered || s.claims > 0) return null;
  const when = s.rememberedAt ? ` on ${s.rememberedAt.slice(0, 10)}` : "";
  const at = s.rememberedCommit ? ` at ${s.rememberedCommit}` : "";
  return [
    `✗ [floor] the derived graph is EMPTY of claims — ${s.components} component(s), 0 claims —`,
    `  but the record (.coherence/status.json) remembers ${s.remembered} claim(s)${at}${when}.`,
    `  A verification surface does not vanish because the work is done; it vanishes when`,
    `  DERIVATION breaks. Refusing to grade this run — zero claims over a remembered`,
    `  surface would report success over nothing.`,
    `  · derivation broken?  check what the walk consumes: coherence.config.json`,
    `    (\`ignore\`, \`codeExt\`), the *.spec.md files, and buildGraph (src/derive.ts).`,
    `  · genuinely removed every spec?  delete the \`verify\` section of`,
    `    .coherence/status.json — the next run then reads as adoption from zero, not as`,
    `    success. That deletion is deliberate friction: it leaves a diff a reviewer sees.`,
  ];
}

// ── the baselined ratchets ────────────────────────────────────────────────────────────

/**
 * ONE RATCHET'S READING, as the shared rule needs it. Every field is supplied by the
 * ratchet itself, because no two of them measure the same population: `mass` reads the
 * derived graph, `conventions` and `lint-sinks` read `scanSources` and never see a graph.
 * A single predicate over one of those (verify's "the graph has no claims") would guard
 * one ratchet and silently exempt the other two.
 */
export interface RatchetReading {
  /** the command, as a reader types it. */
  ratchet: string;
  /** the pinned file, as a path a reader can open. */
  baseline: string;
  /** the population this run examined. ZERO is the whole subject. */
  live: number;
  /** what `live` counts — "source file(s) scanned", "graph file(s) + symbol(s)". */
  unit: string;
  /** THE BASELINE'S OWN EVIDENCE that the population was once non-empty. It plays
   *  status.json's part above: the ratchet's memory. It need not be in the same unit as
   *  `live` (a pinned sink implies a file it was found in), because it answers a strictly
   *  weaker question — was there ever anything here — and a lower bound answers it. */
  pinned: number;
  /** what `pinned` counts — "reviewed interpolation site(s)", "pinned dimension(s)". */
  pinnedUnit: string;
}

/**
 * THE RATCHET FLOOR — the refusal, or null when the run may proceed.
 *
 * Refuses exactly when the live population is EMPTY while the baseline remembers a
 * non-empty one, at both seams: `--check` must not report "held" over nothing, and
 * `--update-baseline` must not pin nothing over something. The two failures compound —
 * a `held` that also prescribes re-pinning is an instrument talking an operator into
 * banking its own breakage as the new floor, which is measured, not hypothetical
 * (2026-07-31: a gutted `buildGraph` made `mass --check` print "✓ mass ratchet held" and
 * "4 dimension(s) SHRANK — re-pin to bank it", and the pin that followed zeroed four
 * dimensions and dropped a fifth).
 *
 * WHAT THIS DELIBERATELY DOES NOT CATCH — and it is the same line the graph floor draws
 * twenty lines up: PARTIAL shrinkage. Deletion is real work and must stay free; a ratchet
 * that punishes removal teaches people to stop removing. The discriminator is TOTAL
 * COLLAPSE, which no amount of ordinary pruning reaches, because a project that still has
 * one file still has a denominator.
 */
export function ratchetVacuityRefusal(r: RatchetReading, seam: "check" | "update"): string[] | null {
  if (r.live > 0 || r.pinned <= 0) return null;
  return [
    `✗ [floor] ${r.ratchet} examined NOTHING this run — 0 ${r.unit} — but ${r.baseline}`,
    `  pins ${r.pinned} ${r.pinnedUnit}, measured over a population that was not empty.`,
    `  A population does not vanish because the work is done; it vanishes when the READING`,
    `  breaks. Refusing to ${seam === "check" ? "grade" : "pin"} this run — ${seam === "check"
      ? `a ratchet "held" over zero is success`
      : `pinning zero over a live baseline banks the break as`}`,
    `  ${seam === "check"
      ? `reported over nothing, and the shrinkage it would report next invites re-pinning it.`
      : `the new floor, and every later run then reads the project's own mass as GROWTH.`}`,
    `  · reading broken?  check what this ratchet consumes: coherence.config.json`,
    `    (\`ignore\`, \`codeExt\`, \`sources\`, \`entryDir\`), and whether the tree is where`,
    `    you think it is — a ratchet run from the wrong cwd reads an empty project.`,
    `  · genuinely emptied the project?  delete ${r.baseline} — the next run then pins`,
    `    from zero, and that deletion leaves a diff a reviewer sees. That friction is`,
    `    deliberate: it is the one act that must not be a side effect.`,
  ];
}

// ── instruments that cannot run ───────────────────────────────────────────────────────

/**
 * AN INSTRUMENT THAT CANNOT RUN, carrying the sentence an operator needs instead of the
 * stack that produced it. Thrown from the seam that KNOWS what is missing (it is the only
 * place that can name the requirement), rendered by the CLI, which is the only place that
 * owns an exit code.
 *
 * WHY A TYPED THROW AND NOT A PRE-CHECK AT EACH CALLER. A pre-check is a second spelling
 * of the requirement, one per caller, and the third caller added next month is the one
 * that forgets — the same drift this repo's command registry exists to end. The throw
 * keeps the requirement stated ONCE, at the seam that discovers it, and the renderer is
 * total over every command by construction rather than by review.
 */
export class Unrunnable extends Error {
  /** The whole report, line by line, exactly as the operator should read it. A field and
   *  not a constructor parameter property: this tree runs under node's type-STRIPPING
   *  loader, which refuses `constructor(readonly x)` outright. */
  report: string[];
  constructor(report: string[]) {
    super(report[0]?.replace(/^\s*[✗·]\s*/, "") ?? "instrument cannot run");
    this.name = "Unrunnable";
    this.report = report;
  }
}

// ── the memory the floors read ────────────────────────────────────────────────────────

/**
 * WHAT A PERSISTENT READER MUST BE ABLE TO SAY ABOUT ITS OWN FILE. Absence and
 * unreadability are DIFFERENT FACTS and the caller is the only place that knows what each
 * one means for it, so each supplies its own sentences — the same argument
 * `RatchetReading` makes for the ratchets: the rule is shared, the reading is not.
 */
export interface JsonMemory {
  /** the file as a reader types it — a path, relative to the project root. */
  label: string;
  /** what the file IS, one clause: "the run record every non-vacuity floor reads". */
  what: string;
  /** what its ABSENCE legitimately means. This is the state the reader must keep
   *  supporting unchanged: first run, adoption, no baseline pinned yet. */
  absentMeans: string;
  /** what silently degrading it to the default would COST — the specific gate that goes
   *  quiet — LINE BY LINE, because this is rendered into a terminal report and a
   *  paragraph handed to a wrapper is a paragraph nobody reads. Written as the
   *  consequence, not as the mechanism: an operator needs to know what stopped being
   *  checked, not which catch block swallowed it. */
  consequence: string[];
}

/**
 * READ A JSON FILE THAT MAY LEGITIMATELY BE ABSENT AND MAY NEVER LEGITIMATELY BE GARBAGE.
 *
 * ABSENT → null, and the caller does exactly what it did before: defaults, no baseline,
 * a fresh record. That state is ordinary and every floor here depends on it staying
 * ordinary — it is what adoption, a first run and an unpinned ratchet all look like.
 *
 * PRESENT AND UNPARSEABLE → `Unrunnable`. There is no reading of an unparseable file that
 * makes it an empty one. A crashed write, a merge conflict left in place, a truncated
 * checkout: all of them are defects, and all of them used to be answered with the same
 * silence as absence — which is how ONE unparseable byte in `.coherence/status.json`
 * disarmed the vacuity floor, the six guarded generators and the ratchets at once, and
 * then, because the run went on to FILE A FRESH RECORD over the corpse, kept them
 * disarmed for every run after it. Where `.coherence/` is untracked there was not even a
 * diff to notice.
 *
 * IT REFUSES BEFORE ANYTHING IS WRITTEN, and that ordering is the whole fix rather than a
 * detail of it. A reader that repaired the file by overwriting it would convert a
 * one-run failure into a permanent one, silently — the same reason `vacuityRefusal`
 * files no record and the ratchet floor refuses the pin as well as the check.
 */
export async function readJsonOrRefuse<T>(path: string, m: JsonMemory): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    // ENOENT (and ENOTDIR, the same absence one directory up) is the ONLY absence. A
    // permission error or a directory in the file's place is a file that EXISTS and could
    // not be read — unreadable, not missing, and it takes the refusal below.
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw new Unrunnable(unreadable(m, "CANNOT BE READ", code ?? (e as Error).message));
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Unrunnable(unreadable(m, "DOES NOT PARSE AS JSON", (e as Error).message));
  }
}

const unreadable = (m: JsonMemory, fault: string, detail: string): string[] => [
  `✗ [floor] ${m.label} EXISTS and ${fault}:`,
  `      ${detail}`,
  `  It is ${m.what}.`,
  `  AN UNREADABLE MEMORY IS NOT AN EMPTY ONE. Reading it as absent would mean:`,
  ...m.consequence.map((l) => `    ${l}`),
  `  Refusing to run. NOTHING has been written — the file is byte-for-byte as it was.`,
  `  A run that "repaired" it by overwriting it would turn one broken run into every`,
  `  run after it, silently, and leave no diff where the file is untracked.`,
  `  · a crashed write, a truncated checkout, a merge conflict left in the file?`,
  `    restore it — \`git checkout -- ${m.label}\` where it is tracked — or fix`,
  `    the syntax by hand. Neither is something a run may do on your behalf.`,
  `  · genuinely starting over?  DELETE ${m.label}. An ABSENT one is legitimate`,
  `    (${m.absentMeans}); an unparseable one never is. Deleting it is`,
  `    one deliberate act that leaves a trace — which defaulting past it was not.`,
];

// A claim an oracle can red: the executable forms, plus `conforms to` (a word is a
// contract whose commitments may carry oracles — the benefit of the doubt goes to the
// dictionary rather than nagging a conformer). Everything else (`exists`, `imports`,
// `typechecks`, `lives in`) can only fail structurally, never against behavior.
const ORACLE_BACKED = /^passes test\s+"|\svia\s+(test|guard)\s+"|^conforms to\s+/;
const LADDER_LIST_CAP = 8;

export interface AdoptionState {
  rung: 1 | 2 | 3 | 4 | 5;
  /** rungs 1–3: zero claims — the on-ramp. Not an error, but never "✓ coherent" either. */
  onramp: boolean;
  lines: string[];
}

/**
 * THE ON-RAMP — which rung of the adoption ladder this project stands on, or null once
 * it has graduated (oracle-backed claims + at least one recorded refutation). Re-runnable
 * by design: each run names the state and prints THE ONE NEXT ACTION, so `verify` walks
 * a bare repo up one step at a time instead of dumping a checklist.
 *
 * This is what replaced `coherence onboard` (evicted 2026-07-31, v0.22.x): a repo with
 * zero specs and a repo with a gutted graph produced identical output, so the same code
 * path now answers both — by knowing, via the record, which one it is looking at.
 */
export async function adoptionLadder(cfg: Config, graph: Graph): Promise<AdoptionState | null> {
  const comps = graph.nodes.filter((n) => n.kind === "component");
  const claims = comps.flatMap((c) => (c.claims ?? []).map((cl) => ({ node: c.label, claim: cl })));
  const refutations = comps.reduce((n, c) => n + (c.refutations?.length ?? 0), 0);

  if (claims.length === 0) {
    const hasConfig = await stat(join(cfg.root, "coherence.config.json")).then(() => true, () => false);
    if (!hasConfig) return { rung: 1, onramp: true, lines: [
      `○ adoption — step 1: no coherence.config.json at the project root.`,
      `  Write one. The minimal shape (every field has a default; state what differs):`,
      `    { "codeExt": ["ts"], "typecheck": ["npm", "run", "typecheck"],`,
      `      "ignore": ["node_modules", ".git", "dist"] }`,
      `  Then re-run \`coherence verify\` — it names the next step.`,
    ] };
    if (comps.length === 0) return { rung: 2, onramp: true, lines: [
      `○ adoption — step 2: config present, but no *.spec.md names a boundary.`,
      `  Name ONE. Do not guess at boundaries — measure where they already are:`,
      `    coherence decompose    where concerns actually live (locality + the smells)`,
      `    coherence economy      what a reader must load to change one thing safely`,
      `    coherence redundancy   one domain spelled twice — a boundary asking to exist`,
      `  Write <dir>/<name>.spec.md for the ONE component those reports agree on`,
      `  (\`coherence scaffold component <name>\` emits the skeleton), and re-run.`,
    ] };
    return { rung: 3, onramp: true, lines: [
      `○ adoption — step 3: ${comps.length} component spec(s), zero claims. Not an error.`,
      `  Leave \`## works when\` empty until something breaks: the first claim should be`,
      `  born from an incident, not conjectured. "typechecks" and "<entry> exists" are`,
      `  green trivialities — they make the ladder look climbed while defending nothing.`,
      `  When the first incident lands, pin what failed:`,
      `    coherence scaffold invariant <name>   the paste-in kit (invariant + claim + why)`,
    ] };
  }

  const bare = claims.filter((c) => !ORACLE_BACKED.test(c.claim));
  if (bare.length === claims.length) {
    const lines = [
      `○ adoption — step 4: ${claims.length} claim(s), none backed by an oracle.`,
      `  Every claim here can only fail structurally (\`via test\` / \`via guard\` /`,
      `  \`passes test\` appear nowhere) — nothing red-flags a behavioral break:`,
    ];
    for (const c of bare.slice(0, LADDER_LIST_CAP)) lines.push(`    · [${c.node}] ${c.claim}`);
    if (bare.length > LADDER_LIST_CAP) lines.push(`    · … and ${bare.length - LADDER_LIST_CAP} more (not shown)`);
    lines.push(`  Give ONE invariant an oracle: \`coherence scaffold invariant <name>\`.`);
    return { rung: 4, onramp: false, lines };
  }

  if (refutations === 0) return { rung: 5, onramp: false, lines: [
    `○ adoption — step 5: oracles declared, none ever observed failing (no \`## refutations\`).`,
    `  A green claim and an unfalsifiable one are indistinguishable from outside. Break`,
    `  one chokepoint on purpose, watch verify go red BY NAME, restore, and record it:`,
    `    ## refutations   →   <invariant>: <what was broken> -> <what was seen>`,
    `  After the first refutation this ladder never prints again.`,
  ] };

  return null;
}
