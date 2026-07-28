// boundary.ts — the ONE home of the boundary-claim grammar.
//
// `boundary "<invariant>" at <chokepoint>
//   [via test "<oracle>" | via guard "<oracle>" | via shadow | via dbt test "<oracle>"]`
//
// This regex used to live (identically, in intent) at three sites — structural.ts,
// verify.ts, and render-claude.ts — and the render-claude copy drifted: it matched
// `via test` only, so `via guard` boundaries silently vanished from the generated
// CLAUDE.md invariants table. One exported regex + one parser is the structural fix:
// the grammar cannot drift again because it has nowhere else to live.
//
// Capture groups: 1=invariant, 2=chokepoint symbol, 3=verb (test|guard),
// 4=external oracle name, 5=built-in `shadow` oracle, 6=dbt test name.
// The `via …` clause is optional; groups 3–6 are undefined when absent.
export const BOUNDARY_RE = /^boundary\s+"([^"]+)"\s+at\s+(\S+)(?:\s+via (?:(test|guard)\s+"([^"]+)"|(shadow)|dbt\s+test\s+"([^"]+)"))?$/;

export type BoundaryOracle =
  | { kind: "none" }
  | { kind: "test"; name: string }
  | { kind: "guard"; name: string }
  | { kind: "shadow" }
  | { kind: "dbt-test"; name: string };

/** A parsed boundary claim with an explicit oracle state — no optional string pairs. */
export interface Boundary {
  inv: string;
  chokepoint: string;
  oracle: BoundaryOracle;
}

/** Parse a boundary claim, or null if the line is not one. */
export function parseBoundary(claim: string): Boundary | null {
  const m = BOUNDARY_RE.exec(claim);
  if (!m) return null;
  let oracle: BoundaryOracle = { kind: "none" };
  if (m[3]) oracle = { kind: m[3] as "test" | "guard", name: m[4] };
  else if (m[5]) oracle = { kind: "shadow" };
  else if (m[6]) oracle = { kind: "dbt-test", name: m[6] };
  return { inv: m[1], chokepoint: m[2], oracle };
}

/** Render only the optional `via …` arm of a parsed boundary. */
export function formatBoundaryVia(boundary: Boundary): string {
  const oracle = boundary.oracle;
  if (oracle.kind === "none") return "";
  if (oracle.kind === "shadow") return " via shadow";
  if (oracle.kind === "dbt-test") return ` via dbt test "${oracle.name}"`;
  return ` via ${oracle.kind} "${oracle.name}"`;
}

/** Reader-facing label for the oracle column in generated views. */
export function boundaryOracleLabel(boundary: Boundary): string {
  const oracle = boundary.oracle;
  if (oracle.kind === "none") return "";
  if (oracle.kind === "shadow") return "shadow";
  if (oracle.kind === "dbt-test") return `dbt test: ${oracle.name}`;
  return oracle.name;
}

/** Exact external test/guard name, when this oracle has one. */
export function boundaryOracleName(boundary: Boundary): string {
  return "name" in boundary.oracle ? boundary.oracle.name : "";
}
