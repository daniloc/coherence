// boundary.ts — the ONE home of the boundary-claim grammar.
//
// `boundary "<invariant>" at <chokepoint> [crossing <zone> -> <zone>] [via (test|guard) "<oracle>"]`
//
// This regex used to live (identically, in intent) at three sites — structural.ts,
// verify.ts, and render-claude.ts — and the render-claude copy drifted: it matched
// `via test` only, so `via guard` boundaries silently vanished from the generated
// CLAUDE.md invariants table. One exported regex + one parser is the structural fix:
// the grammar cannot drift again because it has nowhere else to live.
//
// The OPTIONAL `crossing <from> -> <to>` clause states what wall (which pair of declared
// trust zones) this gate sits on — the PROMISE GRAPH's topology axiom (a gate declares
// what it separates). It is purely declarative: verify ignores it (a crossing is not a
// runtime check), scene/atlas/structural read only the fields they already read, and every
// pre-crossing spec parses UNCHANGED because both the crossing clause and the via clause
// are optional and independently absent. The clause sits BETWEEN chokepoint and via, so a
// gate may declare a crossing with or without an oracle, in any combination.
//
// Capture groups: 1=invariant, 2=chokepoint symbol, 3=crossing-from, 4=crossing-to,
// 5=verb (test|guard), 6=oracle name. Groups 3/4 are undefined when the crossing clause is
// absent; groups 5/6 are undefined when the via clause is absent.
export const BOUNDARY_RE =
  /^boundary\s+"([^"]+)"\s+at\s+(\S+)(?:\s+crossing\s+(\S+)\s+->\s+(\S+))?(?:\s+via (test|guard)\s+"([^"]+)")?$/;

/** A parsed boundary claim. `verb`/`oracle` are `""` when the claim has no `via` clause;
 *  `crossing` is null when it declares no `crossing <from> -> <to>` wall. */
export interface Boundary {
  inv: string;
  chokepoint: string;
  verb: string;
  oracle: string;
  crossing: { from: string; to: string } | null;
}

/** Parse a boundary claim, or null if the line is not one. */
export function parseBoundary(claim: string): Boundary | null {
  const m = BOUNDARY_RE.exec(claim);
  if (!m) return null;
  return {
    inv: m[1],
    chokepoint: m[2],
    verb: m[5] ?? "",
    oracle: m[6] ?? "",
    crossing: m[3] && m[4] ? { from: m[3], to: m[4] } : null,
  };
}

/** The crossing clause is PURELY DECLARATIVE (topology, never a runtime check) — so it must
 *  not leak into verify-record identity. Records are keyed on the verbatim claim string, and
 *  without this normalization, ANNOTATING an existing boundary with a crossing orphans its
 *  prior verdict (the post-crossing claim no longer matches the pre-crossing record key —
 *  every such gate silently drops from its earned grade on pure annotation). This
 *  reconstructs the canonical claim WITHOUT the crossing clause; non-boundary claims pass
 *  through verbatim. Two claims that collide after stripping share inv+chokepoint+verb+oracle
 *  — genuinely the same gate. Applied on BOTH sides of every record lookup (store + read);
 *  verify still WRITES the raw claim — normalization is strictly a lookup concern. */
export function normalizeBoundaryClaim(claim: string): string {
  const m = BOUNDARY_RE.exec(claim);
  if (!m || !(m[3] && m[4])) return claim;   // not a boundary, or no crossing → verbatim
  return `boundary "${m[1]}" at ${m[2]}${m[5] ? ` via ${m[5]} "${m[6]}"` : ""}`;
}

/** The BRAND that makes raw-string record lookup a compile error. Only `claimKey` can mint
 *  one, so a `Map<ClaimKey, …>` cannot be probed with `` `${node} ${claim}` `` — the exact
 *  bypass that let mergeClaimRecords/panel/verify forget a claim's failure history on pure
 *  crossing annotation while scene/promise remembered it. */
declare const CLAIM_KEY_BRAND: unique symbol;
export type ClaimKey = string & { readonly [CLAIM_KEY_BRAND]: true };

/** The ONE record-lookup key EVERY consumer of `status.verify.claims` uses (store AND read)
 *  — the promise graph, the panel, the merge, and verify's decoration filter —
 *  so a pre-crossing record matches a post-crossing claim and vice versa. Returns the
 *  branded `ClaimKey`: there is no other way to mint one. */
export const claimKey = (node: string, claim: string): ClaimKey =>
  `${node} ${normalizeBoundaryClaim(claim)}` as ClaimKey;
