// doctrine.ts — the small, versioned law the regulator is allowed to apply.
//
// A regulator without an explicit doctrine is only a pile of heuristics with an exit
// code.  This registry is deliberately smaller than the harness: v1 names the two facts
// for which the project already has live observations and concrete remedies.  Adding a
// rule is therefore a contract change, not another conditional hidden in a formatter.

export const DOCTRINE_ID = "anti-entropy/v1" as const;

export const REGULATION_POTENTIAL = Object.freeze([
  "refuse",
  "require-decision",
  "redirect",
  "release",
] as const);

export type RegulationAction = typeof REGULATION_POTENTIAL[number];

export interface DoctrineCommand {
  name: string;
  args: readonly string[];
  /** The selector appends `--host <reading.host>`; the sensor never authors shell argv. */
  hostScoped?: true;
}

export interface DoctrineRule {
  id: string;
  invariant: string;
  sensor: string;
  /** The one response a violated observation contributes to the ordered potential. */
  response: Exclude<RegulationAction, "refuse" | "release">;
  remedy: string;
  /** Present only when doctrine can prescribe a mechanical repair without judging prose. */
  command?: DoctrineCommand;
}

/**
 * Order is API in both arrays.  Potential order decides which class of obligation wins;
 * rule order is the byte-stable tie-break inside a class.  Neither may be supplied by a
 * project config: allowing local weights would make the law disappear exactly where it
 * became inconvenient.
 */
export const ANTI_ENTROPY_DOCTRINE: {
  id: typeof DOCTRINE_ID;
  version: 1;
  maxim: string;
  scope: string;
  potential: typeof REGULATION_POTENTIAL;
  rules: readonly DoctrineRule[];
  limits: readonly string[];
} = Object.freeze({
  id: DOCTRINE_ID,
  version: 1,
  maxim: "dissolve > declare > infer",
  scope: "the shared working tree, evaluated only by the live rules below",
  potential: REGULATION_POTENTIAL,
  rules: Object.freeze([
    Object.freeze({
      id: "canonical-lifecycle-control",
      invariant: "the repository has one canonical runnable lifecycle control",
      sensor: "inspectLifecycleHook",
      response: "redirect" as const,
      remedy: "install the canonical five-event lifecycle control",
      command: Object.freeze({ name: "hooks", args: Object.freeze(["install"]), hostScoped: true as const }),
    }),
    Object.freeze({
      id: "significant-growth-needs-address",
      invariant: "significant behavioral growth acquires an anchor or patch-specific decision",
      sensor: "analyzeChange",
      response: "require-decision" as const,
      remedy: "add an invariant/boundary/parity anchor; otherwise record why the existing contract is sufficient",
    }),
  ]),
  limits: Object.freeze([
    "v1 does not prove that the change is correct or that its anchors are semantically adequate",
    "v1 observes a shared worktree and cannot attribute mixed changes to one agent",
    "v1 does not yet fold verification freshness, premise expiry, or maintenance cadence into its potential",
  ]),
});

/** A data-only representation for the CLI and other hosts. */
export function doctrineDocument(): object {
  return {
    ...ANTI_ENTROPY_DOCTRINE,
    potential: [...ANTI_ENTROPY_DOCTRINE.potential],
    rules: ANTI_ENTROPY_DOCTRINE.rules.map((rule) => ({
      ...rule,
      ...(rule.command ? { command: { ...rule.command, args: [...rule.command.args] } } : {}),
    })),
    limits: [...ANTI_ENTROPY_DOCTRINE.limits],
  };
}

export function formatDoctrine(json = false): string[] {
  if (json) return [JSON.stringify(doctrineDocument(), null, 2)];
  const lines = [
    `ANTI-ENTROPY DOCTRINE ${ANTI_ENTROPY_DOCTRINE.id}`,
    `  ${ANTI_ENTROPY_DOCTRINE.maxim}`,
    `  scope: ${ANTI_ENTROPY_DOCTRINE.scope}`,
    `  potential: ${ANTI_ENTROPY_DOCTRINE.potential.join(" > ")}`,
    "",
  ];
  for (const rule of ANTI_ENTROPY_DOCTRINE.rules) {
    lines.push(`  ${rule.id}`, `    ${rule.invariant}`, `    violation → ${rule.response}: ${rule.remedy}`);
  }
  lines.push("", "  limits:");
  for (const limit of ANTI_ENTROPY_DOCTRINE.limits) lines.push(`    · ${limit}`);
  return lines;
}
