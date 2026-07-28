// boundary.ts — the ONE home of the boundary-claim grammar.
//
// A boundary invariant is either a named property:
//
//   boundary "fail-closed writes" at applyWritePolicy via test "write policy totality"
//
// or a structured property whose oracle can prove the same shape mechanically:
//
//   boundary unique(event_id) at unified_events via dbt schema
//
// Keep parsing and rendering here. Every consumer receives the same tagged invariant
// and oracle data instead of independently guessing at syntax.

const IDENTIFIER = String.raw`[A-Za-z_]\w*`;
const STRUCTURED_INVARIANT =
  String.raw`(?:unique\(${IDENTIFIER}(?:\s*,\s*${IDENTIFIER})*\)|not_null\(${IDENTIFIER}\))`;
const ORACLE =
  String.raw`(?:(?:test|guard)\s+"[^"]+"|shadow|dbt\s+test\s+"[^"]+"|dbt\s+schema)`;

// Capture groups: 1=invariant token, 2=chokepoint, 3=complete optional oracle clause.
export const BOUNDARY_RE = new RegExp(
  String.raw`^boundary\s+("[^"]+"|${STRUCTURED_INVARIANT})\s+at\s+(\S+)(?:\s+via\s+(${ORACLE}))?$`,
);

export type BoundaryInvariant =
  | { kind: "named"; name: string }
  | { kind: "unique"; columns: string[] }
  | { kind: "not_null"; column: string };

export type BoundaryOracle =
  | { kind: "none" }
  | { kind: "test"; name: string }
  | { kind: "guard"; name: string }
  | { kind: "shadow" }
  | { kind: "dbt-test"; name: string }
  | { kind: "dbt-schema" };

export interface Boundary {
  invariant: BoundaryInvariant;
  chokepoint: string;
  oracle: BoundaryOracle;
}

const parseInvariant = (token: string): BoundaryInvariant => {
  if (token.startsWith('"')) return { kind: "named", name: token.slice(1, -1) };
  const match = /^(unique|not_null)\(([^)]+)\)$/.exec(token)!;
  const columns = match[2].split(",").map((column) => column.trim()).sort();
  return match[1] === "unique"
    ? { kind: "unique", columns }
    : { kind: "not_null", column: columns[0] };
};

const parseOracle = (clause: string | undefined): BoundaryOracle => {
  if (!clause) return { kind: "none" };
  if (clause === "shadow") return { kind: "shadow" };
  if (clause === "dbt schema") return { kind: "dbt-schema" };
  const named = /^(test|guard|dbt test)\s+"([^"]+)"$/.exec(clause)!;
  if (named[1] === "dbt test") return { kind: "dbt-test", name: named[2] };
  return { kind: named[1] as "test" | "guard", name: named[2] };
};

/** Parse a boundary claim, or null if the line is not one. */
export function parseBoundary(claim: string): Boundary | null {
  const match = BOUNDARY_RE.exec(claim);
  if (!match) return null;
  return {
    invariant: parseInvariant(match[1]),
    chokepoint: match[2],
    oracle: parseOracle(match[3]),
  };
}

/** Stable invariant identity used by coverage and the structural ledger. */
export function boundaryInvariantName(boundary: Boundary): string {
  const invariant = boundary.invariant;
  if (invariant.kind === "named") return invariant.name;
  if (invariant.kind === "unique") return `unique(${invariant.columns.join(", ")})`;
  return `not_null(${invariant.column})`;
}

/** Render the invariant exactly as it appears in boundary syntax. */
export function formatBoundaryInvariant(boundary: Boundary): string {
  const name = boundaryInvariantName(boundary);
  return boundary.invariant.kind === "named" ? `"${name}"` : name;
}

/** Render only the optional `via …` arm of a parsed boundary. */
export function formatBoundaryVia(boundary: Boundary): string {
  const oracle = boundary.oracle;
  if (oracle.kind === "none") return "";
  if (oracle.kind === "shadow") return " via shadow";
  if (oracle.kind === "dbt-schema") return " via dbt schema";
  if (oracle.kind === "dbt-test") return ` via dbt test "${oracle.name}"`;
  return ` via ${oracle.kind} "${oracle.name}"`;
}

/** Render a complete boundary claim from normalized data. */
export function formatBoundary(boundary: Boundary): string {
  return `boundary ${formatBoundaryInvariant(boundary)} at ${boundary.chokepoint}${formatBoundaryVia(boundary)}`;
}

/** Reader-facing label for the oracle column in generated views. */
export function boundaryOracleLabel(boundary: Boundary): string {
  const oracle = boundary.oracle;
  if (oracle.kind === "none") return "";
  if (oracle.kind === "shadow") return "shadow";
  if (oracle.kind === "dbt-schema") return "dbt schema";
  if (oracle.kind === "dbt-test") return `dbt test: ${oracle.name}`;
  return oracle.name;
}

/** Exact external test/guard name, when this oracle has one. */
export function boundaryOracleName(boundary: Boundary): string {
  return "name" in boundary.oracle ? boundary.oracle.name : "";
}
