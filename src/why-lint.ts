// why-lint.ts — the `## why` discipline (P3 companion). A boundary's ## why should
// carry the NON-DERIVABLE rationale, not restate the mechanism the boundary claim
// already anchors. This flags a ## why sentence that names an already-anchored
// chokepoint/oracle SYMBOL alongside an oracle-VERB ("iterates", "totality", "fails the
// build") — i.e. prose re-deriving the WHAT instead of the WHY. Advisory: it correlates
// two things the harness already holds (the why prose + the boundary claims).
import type { Graph } from "./types.ts";
import { allBoundaries } from "./structural.ts";

const ORACLE_VERB =
  /\b(iterates?|totality|enumerates?|fails (the )?(build|suite)|double-entry|keyset|reconcil\w*|asserts? every|every .*(must|fails))\b/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function whyLint(graph: Graph, mode: "report" | "check"): number {
  const boundaries = allBoundaries(graph);
  const symbols = new Set<string>();
  for (const b of boundaries.values()) { symbols.add(b.chokepoint); if (b.oracle) symbols.add(b.oracle); }
  const symRe = symbols.size ? new RegExp(`\\b(${[...symbols].map(escapeRe).join("|")})\\b`) : null;

  const findings: { component: string; sentence: string; sym: string }[] = [];
  if (symRe)
    for (const n of graph.nodes) {
      if (n.kind !== "component" || !n.why) continue;
      for (const raw of n.why.split(/(?<=[.!?])\s+/)) {
        const s = raw.trim();
        if (!s || !ORACLE_VERB.test(s)) continue;
        const m = symRe.exec(s);
        if (m) findings.push({ component: n.label, sentence: s.replace(/\s+/g, " ").slice(0, 140), sym: m[1] });
      }
    }

  console.log("\n  ## WHY LINT — prose restating derivable mechanism (anchored symbol + oracle-verb)\n");
  if (!findings.length) {
    console.log("  ✓ no ## why sentence restates an anchored chokepoint/oracle mechanism.\n");
    return 0;
  }
  for (const f of findings) console.log(`  · ${f.component}: names anchored "${f.sym}" with an oracle-verb\n      "${f.sentence}…"`);
  console.log(`\n  ${findings.length} sentence(s) — the WHAT is derivable (the boundary claim anchors it); keep ## why for the non-derivable WHY.`);
  console.log("  Advisory — prose quality, not a hard gate.\n");
  return mode === "check" ? 1 : 0;
}
