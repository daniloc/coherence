// parity.ts — the ONE home of the parity-claim grammar (mirrors boundary.ts).
//
// `parity "<invariant>" over <domain> between <fnA> and <fnB> via test "<oracle>"`
//
// A parity claim declares that two functions are PROJECTIONS OF ONE ENUMERATED DOMAIN
// and must AGREE over it — the generalization of the boundary totality oracle from
// COVERAGE ("the chokepoint handles every member") to AGREEMENT ("f and g read every
// member the same way"). The canonical bug class it exists to kill: a live projection
// and a settled projection of the same tool/message vocabulary drifting apart, often
// across deploy artifacts (a Worker function vs a browser table) where no single
// TypeScript compilation can see both sides.
//
// Capture groups: 1=invariant, 2=domain symbol, 3=fnA, 4=fnB, 5=oracle name.
// Unlike boundary's, the `via test` clause is REQUIRED: agreement is a semantic the
// project must state (what "equal" means between two projections is domain knowledge),
// so a parity claim without an oracle would be an empty attestation.
export const PARITY_RE =
  /^parity\s+"([^"]+)"\s+over\s+(\S+)\s+between\s+(\S+)\s+and\s+(\S+)\s+via test\s+"([^"]+)"$/;

/** A parsed parity claim. */
export interface Parity { inv: string; domain: string; f: string; g: string; oracle: string; }

/** Parse a parity claim, or null if the line is not one. */
export function parseParity(claim: string): Parity | null {
  const m = PARITY_RE.exec(claim);
  return m ? { inv: m[1], domain: m[2], f: m[3], g: m[4], oracle: m[5] } : null;
}
