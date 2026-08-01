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
// this floor was written — and refusing it would train people to reset the record instead
// of reading the refusal. The complementary gate already exists: coverage reds any
// component whose claims ALL vanished, so a collapse that stays green requires every
// component to keep one, which is exactly what pruning looks like. A project that wants
// the count itself pinned can pin it as a `measures` dimension in `mass`.
//
// SCOPED RUNS CANNOT TRIP THE FLOOR, structurally: the floor reads the DERIVED GRAPH,
// which is always full-tree — `--staged`/`--since` narrow which components are EVALUATED,
// never what is derived. A reading taken above the scoping seam needs no scope exemption.
import { stat } from "node:fs/promises";
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
