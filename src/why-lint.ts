// why-lint.ts — the `## why` discipline. Two advisory checks, both grounded in the
// graph the harness already holds:
//
//   (1) mechanism-restatement: a sentence that names an anchored chokepoint/oracle
//       SYMBOL alongside an oracle-VERB ("iterates", "totality", "fails the build")
//       is prose re-deriving the WHAT — already carried by the boundary claim.
//
//   (2) anchored-paragraph: in invariant-bearing specs, every paragraph of `## why`
//       should anchor to a declared invariant (mention it by name), and every
//       declared invariant should be anchored by some paragraph. Unanchored
//       paragraphs are narrative drift; unanchored invariants are rationale debt
//       (the boundary claim records the WHAT, but the WHY of that specific
//       invariant — the bug it kills, the rejected alternative — is missing).
//       The doctrine: spec, enforcement, and rationale can't drift, because the
//       rationale is keyed to the same invariant names enforcement is keyed to.
//
// Both are advisory: prose quality, not a hard gate. Together they apply pressure
// on the right axis (CONTENT, keyed to the invariant set) rather than the wrong
// one (character count, which would flatten the load signal — a spec carrying
// thirteen boundaries earns more bytes than one carrying one).
import type { Graph, GraphNode } from "./types.ts";
import { allBoundaries } from "./structural.ts";

const ORACLE_VERB =
  /\b(iterates?|totality|enumerates?|fails (the )?(build|suite)|double-entry|keyset|reconcil\w*|asserts? every|every .*(must|fails))\b/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Split a paragraph into sentences, tolerating `.**`, `.)`, `."`, etc. — a sentence
 *  end may carry closing punctuation between the terminator and the whitespace.
 *  The naive `(?<=[.!?])\s+` split misses these and fuses what reads as two sentences
 *  into one, which both makes findings hard to read and produces false positives when
 *  a bold anchor lead-in (`**name.**`) absorbs the next sentence's prose. */
const splitSentences = (s: string) => s.split(/(?<=[.!?][)\]*"'`]*)\s+/);

/** Strip a leading bold-anchor `**X.**` (and the space after it) from a paragraph
 *  before sentence-splitting. The bold lead-in IS the anchoring mechanism — it keys
 *  the paragraph to a declared invariant — so it must not itself be flagged as
 *  mechanism-restating prose. Without this, every anchored paragraph trips the check
 *  on its own anchor (the anchor name is the symbol; the invariant name often contains
 *  an oracle-verb like "totality"). */
const stripAnchorLead = (s: string) => s.replace(/^\*\*[^*]+\*\*\s*/, "");

/** Normalize for fuzzy anchor matching: lowercase, treat `/`, `-`, `_`, and runs of
 *  whitespace as a single space. Lets "facet/kernel-column collision" match "facet
 *  kernel column collision" without forcing a specific punctuation in prose. */
const normalize = (s: string) => s.toLowerCase().replace(/[\/\-_]+/g, " ").replace(/\s+/g, " ").trim();

interface MechanismFinding { component: string; sentence: string; sym: string; }
interface AnchorFinding { component: string; kind: "unanchored-paragraph" | "unanchored-invariant"; text: string; }

/** (1) Sentences that name an anchored symbol alongside an oracle-verb — the prose
 *  is restating the mechanism the boundary claim already carries. */
function checkMechanismRestatement(graph: Graph): MechanismFinding[] {
  const boundaries = allBoundaries(graph);
  const symbols = new Set<string>();
  for (const b of boundaries.values()) { symbols.add(b.chokepoint); if (b.oracle) symbols.add(b.oracle); }
  if (!symbols.size) return [];
  const symRe = new RegExp(`\\b(${[...symbols].map(escapeRe).join("|")})\\b`);

  const findings: MechanismFinding[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== "component" || !n.why) continue;
    // Split paragraphs first so a sentence can't bleed across a paragraph break,
    // then strip each paragraph's bold-anchor lead-in (the anchoring mechanism is
    // not itself "mechanism-restating prose") before sentence-splitting.
    for (const para of n.why.split(/\n\s*\n/)) {
      for (const raw of splitSentences(stripAnchorLead(para.trim()))) {
        const s = raw.trim();
        if (!s || !ORACLE_VERB.test(s)) continue;
        const m = symRe.exec(s);
        if (m) findings.push({ component: n.label, sentence: s.replace(/\s+/g, " ").slice(0, 140), sym: m[1] });
      }
    }
  }
  return findings;
}

/** (2) For each component with `## invariants`, reconcile `## why` paragraphs
 *  against the invariant set in BOTH directions: an unanchored paragraph is
 *  narrative drift; an unanchored invariant is missing rationale. Parenthetical
 *  paragraphs (those starting with `(`) are exempt as meta-framing — they don't
 *  claim to anchor anything. A component without invariants is exempt entirely
 *  (free-form rationale is fine where the spec isn't carrying named properties). */
function checkAnchoredParagraphs(node: GraphNode): AnchorFinding[] {
  const out: AnchorFinding[] = [];
  if (node.kind !== "component" || !node.why || !node.invariants?.length) return out;

  const invariants = node.invariants.map((raw) => ({ raw, norm: normalize(raw) }));
  const paragraphs = node.why.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const matched = new Set<string>();
  for (const para of paragraphs) {
    if (para.startsWith("(")) continue; // meta/framing
    const normPara = normalize(para);
    const hits = invariants.filter(({ norm }) => normPara.includes(norm));
    if (!hits.length) {
      const preview = para.replace(/\s+/g, " ").slice(0, 120) + (para.length > 120 ? "…" : "");
      out.push({ component: node.label, kind: "unanchored-paragraph", text: preview });
    } else for (const h of hits) matched.add(h.raw);
  }
  for (const { raw } of invariants) {
    if (!matched.has(raw)) out.push({ component: node.label, kind: "unanchored-invariant", text: raw });
  }
  return out;
}

export function whyLint(graph: Graph, mode: "report" | "check"): number {
  const mech = checkMechanismRestatement(graph);
  const anchor: AnchorFinding[] = [];
  for (const n of graph.nodes) anchor.push(...checkAnchoredParagraphs(n));

  console.log("\n  ## WHY LINT — prose restating derivable mechanism (anchored symbol + oracle-verb)\n");
  if (!mech.length) console.log("  ✓ no ## why sentence restates an anchored chokepoint/oracle mechanism.\n");
  else {
    for (const f of mech) console.log(`  · ${f.component}: names anchored "${f.sym}" with an oracle-verb\n      "${f.sentence}…"`);
    console.log(`\n  ${mech.length} sentence(s) — the WHAT is derivable (the boundary claim anchors it); keep ## why for the non-derivable WHY.\n`);
  }

  console.log("  ## WHY LINT — paragraph ↔ invariant anchoring (invariant-bearing specs)\n");
  if (!anchor.length) console.log("  ✓ every ## why paragraph anchors to a declared invariant, and every invariant is anchored.\n");
  else {
    const byComp = new Map<string, AnchorFinding[]>();
    for (const f of anchor) (byComp.get(f.component) ?? byComp.set(f.component, []).get(f.component)!).push(f);
    for (const [comp, fs] of byComp) {
      console.log(`  · ${comp}:`);
      for (const f of fs) {
        if (f.kind === "unanchored-paragraph") console.log(`      paragraph anchors no declared invariant\n        "${f.text}"`);
        else console.log(`      invariant "${f.text}" has no ## why paragraph (the WHY of this specific boundary isn't recorded)`);
      }
    }
    const p = anchor.filter((f) => f.kind === "unanchored-paragraph").length;
    const i = anchor.filter((f) => f.kind === "unanchored-invariant").length;
    console.log(`\n  ${p} unanchored paragraph(s), ${i} unanchored invariant(s) — pair rationale to the invariant set in both directions.`);
  }
  console.log("  Advisory — prose quality, not a hard gate.\n");

  return mode === "check" && (mech.length || anchor.length) ? 1 : 0;
}
