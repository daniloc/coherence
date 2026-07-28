// promise-model.ts — the CONTRACT for the PROMISE GRAPH: the layer where the subject is
// not code but OBLIGATIONS — components making guarantees at their perimeters and relying
// on one another's guarantees. Two halves join here: derivation (src/promise.ts — spec
// grammar + graph + status + git → PromiseModel) and rendering (src/render-contract.ts —
// PromiseModel → one self-contained _contract.html). The text ledger (`coherence review`)
// prints from the same model.
//
// Axioms, in order of authority:
//
//   0. CONCEPTUAL COUPLING ONLY — the spec imposes a shape the artifact never depends on.
//      Remove the harness and the project builds, runs, ships identically; only the
//      KNOWING is lost. The shape can be ambitious because it is removable.
//   1. THE SPEC IS THE PRIMARY OBJECT — the picture is drawn entirely from declared
//      shape. Code contributes exactly two things: MEASURES (mass, as the denominator
//      honesty requires) and VERDICTS (conformance, breaches, freshness). Code
//      contributes ZERO geometry.
//   2. DECLARED TOPOLOGY — zones come from a `## zones` section (declared order = trust
//      order, `inside` = nesting); a gate's `crossing <from> -> <to>` states what the
//      boundary separates; `lives in <zone>` states residence. Nothing spatial is ever
//      invented: an element with no declared place renders as UNPLACED — visible
//      pressure to declare, never a guess. There is no layout file.
//   3. ONE ENFORCED GRADE — every gate carries a single ordinal confidence grade
//      (A best … U unassessed). U is rendered ink, never a blank: the unassessed
//      water still prints. The grade is a total function of recorded signals — no
//      free-text hedging, no vibes.
//   4. DOUBLE-ENTRY RELIANCE — every cross-component reliance (an import edge) is
//      either COVERED by a declared gate on the wall it crosses or NAKED. Every gate
//      lists its reliants. A weakened promise is simultaneously a degraded asset in
//      every reliant — one fact, two postings.
//   5. THE DIFF IS A LEDGER — review renders as typed events from a CLOSED vocabulary,
//      each with its blast (who holds the degraded asset), never as prose or pixels
//      alone. Changed files outside the graph are counted, not dropped.
//   6. STEADY STATE IS QUIET — a fully graded, fresh, covered network shows almost
//      nothing; every mark that does appear must be actionable. Absence (naked
//      reliance, unaccounted mass, undeclared residence) is FOREGROUND.
export interface PromiseModel {
  root: string;
  intent: string;             // the entry component's one-line intent
  generatedAt: string;        // ISO stamp of this derivation
  head: string | null;
  dirty: boolean;
  zones: Zone[];              // declared order IS trust order (most-trusted first)
  components: PromiseComponent[]; // spec-tree order (dir sort, entry "." first)
  review: Review | null;      // non-null = derived against a base ref
}

/** A declared trust region from `## zones`. Order of declaration is the canonical
 *  trust order; `inside` nests one zone within another (both facts render literally). */
export interface Zone {
  name: string;               // the zone's identifier, referenced by crossings/residence
  intent: string;             // the one-line description after the colon ("" if bare)
  inside: string | null;      // declared containment, or null for a root zone
}

export interface PromiseComponent {
  label: string;
  dir: string;                // component dir relative to root ("." = entry)
  intent: string;
  zone: string | null;        // `lives in <zone>` residence — null renders as
                              // UNDECLARED RESIDENCE (exposure, not an error)
  gates: PromiseGate[];       // the guarantees this component makes (its liabilities)
  relies: Reliance[];         // the guarantees it consumes (its assets) — one per
                              // imported component, derived from actual imports
  mass: { files: number; lines: number };      // what exists (the denominator)
  accounted: { files: number; lines: number }; // the subset ANY claim names — the
                              // trial balance: mass − accounted = unaccounted, always shown
  change?: "added" | "removed"; // review only: whole component appeared/vanished
}

/** One guarantee at a perimeter. The gate is the atomic promise: an invariant, enforced
 *  at a chokepoint, by an oracle, across a declared crossing, at a graded confidence. */
export interface PromiseGate {
  inv: string;
  chokepoint: string;
  verb: "test" | "guard" | "";
  oracle: string;
  crossing: { from: string; to: string } | null; // declared topology; null = UNPLACED
                              // (the gate exists but the spec hasn't said what it
                              // separates — rendered as perimeter pressure)
  grade: Grade;
  verdict: "pass" | "fail" | "stale" | "unknown";
  freshest?: string;          // ISO stamp of the newest pass, if any
  reliants: string[];         // dirs of components whose reliance this gate covers —
                              // the double-entry posting (sorted, deduped)
}

/** The enforced ordinal. A total function of recorded signals (promise.ts documents the
 *  exact doctrine); the renderer treats it as opaque and ordinal. U prints, always. */
export type Grade =
  | "A"   // machine oracle, passing at HEAD — fresh, analyzed strength
  | "B"   // machine oracle, passing but stale — an aging green
  | "C"   // human-judged (via guard) or oracle declared with no verdict yet
  | "D"   // declared, never verified — a promise with no evidence
  | "U";  // unassessed — the record shows a skip (dialect gap): the claim exists
          // but the harness could not even read it. Rendered, never blank.

/** One reliance edge: this component imports `to`. Covered iff a declared gate sits on
 *  the wall the edge crosses; NAKED is a first-class finding, not an absence. */
export interface Reliance {
  to: string;                 // the relied-upon component's dir
  crossing: { from: string; to: string } | null; // zones crossed (from both residences);
                              // null when either residence is undeclared (exposure)
  via: string | null;         // the covering gate's inv — null = NAKED (cross-zone
                              // reliance with no declared gate on that wall)
}

// ── the review ledger ──────────────────────────────────────────────────────────────────

export interface Review {
  base: string;               // base ref, short
  events: PromiseEvent[];     // the closed-vocabulary ledger, most severe first
  outside: { added: number; removed: number; changed: number }; // changed files the
                              // graph does not own — counted, never dropped
}

/** The CLOSED event vocabulary. Every contract-relevant change between base and head is
 *  exactly one of these; nothing else may claim to be a review finding.
 *    covered    — a gate now exists that didn't (a promise made)
 *    placed     — an existing gate's crossing was declared (unplaced → placed: the
 *                 promise finally states what it separates)
 *    withdrawn  — a gate that existed is gone (a promise withdrawn)
 *    promoted   — a gate's grade rose (with from/to and the reason)
 *    demoted    — a gate's grade fell (the alarm case; blast = reliants)
 *    naked      — a reliance is newly uncovered (new import crossing an ungated wall,
 *                 or its gate vanished)
 *    sealed     — a reliance that was NOT covered (naked, or unassessable under
 *                 undeclared residence) is now covered — coverage gains always leave
 *                 a ledger trace
 *    arrived    — a component appeared
 *    razed      — a component vanished (its gates report withdrawn individually too)
 *    rezoned    — a component's declared residence changed
 */
export interface PromiseEvent {
  kind: "covered" | "placed" | "withdrawn" | "promoted" | "demoted"
      | "naked" | "sealed" | "arrived" | "razed" | "rezoned";
  comp: string;               // the component dir the event belongs to
  inv?: string;               // the gate's invariant, for gate events
  from?: string;              // prior state (grade, zone, …) — event-kind specific
  to?: string;                // new state
  detail: string;             // one plain sentence, bulletin register — carries the
                              // reason (e.g. "oracle went stale — green aging, 2 commits")
  blast: string[];            // dirs holding a degraded asset because of this event
                              // (sorted; empty when nothing relies on it)
}

/** The renderer's exact signature (src/render-contract.ts implements this). One COMPLETE
 *  self-contained HTML document: inline CSS/JS, embedded model JSON, zero external
 *  resources. The standing anatomy is canonical (zone bands in declared order, components
 *  in spec-tree order, one fixed pose per component); a review model additionally renders
 *  the ledger with untouched rows receded. No coordinate exists that a human could not
 *  rederive from the committed spec text. */
export type RenderContract = (model: PromiseModel, stamp: string) => string;

/** The ledger's text form (`coherence review` prints this; promise.ts implements).
 *  Deterministic, plain, one event per line group — the bulletin register. */
export type FormatLedger = (model: PromiseModel) => string;
