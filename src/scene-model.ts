// scene-model.ts — the CONTRACT between the scene's two halves: derivation
// (src/scene.ts — graph + status record + git → SceneModel) and rendering
// (src/render-scene.ts — SceneModel → one self-contained _scene.html).
//
// The scene is the perceptual layer: the project given a persistent spatial BODY a
// human can become acquainted with, so change is perceived against a familiar place
// rather than read as propositions. The design commitments this contract encodes:
//
//   1. STABLE GEOGRAPHY — `lot` positions come from a persisted layout file and are
//      append-only: a component, once placed, NEVER moves; new components take the
//      next vacant lot. Familiarity is the entire mechanism — the human perceives
//      change only against a scene that otherwise holds still. Lot coordinates are
//      AXIAL HEX coordinates (q=x, r=y): each component is a hexagonal DISTRICT on
//      a hex grid. The persisted spiral sequence is unchanged — reinterpreting the
//      same (x,y) pairs as axial coords keeps every placement distinct and stable.
//   2. HONEST MASS — visual size maps to code reality, not spec count, split into its
//      two physical dimensions: DENSITY IS BREADTH (each FILE is one triangular piece
//      in the district's top-face lattice — many files read as packed sprawl) and
//      HEIGHT IS DEPTH (each piece extrudes into a tower ∝ its own LINE count,
//      normalized scene-wide — a district is a skyline: monolith towers vs low
//      suburb at a glance; a 200-line test is a real structure, not a stub). Symbol
//      count is the declaration surface — a card/tooltip datum, NOT the height driver.
//      An unclaimed tall tower reads as exactly what it is: a dark unpowered skyscraper.
//      A claim blesses at most ONE file, matched by PATH — a bare basename that matches
//      several files in a component blesses NONE of them (never over-report coverage).
//   3. THE WIREFRAME IS THE SPEC — claimed surface sits inside the amber blueprint
//      envelope; mass NO claim covers renders outside/dark (conspicuous absence —
//      a scene that only draws what's known is the prettiest way to lie).
//   4. MATERIAL IS THE LADDER — a gate's construction encodes its enforcement tier,
//      derived from the boundary claims alone (NO atlas dependency).
//   5. LIGHT IS VERIFICATION — illumination comes from the status record's recency;
//      a neglected district goes dark. HEAT is recent churn from git.
//   6. THE DIFF IS SPATIAL — a code review renders as change against the SAME stable
//      geography instead of text: new structures rise (accented), removed structures
//      stand as ghost wireframes on their reserved lots, grown/shrunk towers show
//      their former height, and the unchanged city recedes. Diff entries (`change`,
//      `prevSymbols`/`prevLines`, model.diff) are present only when the scene was
//      derived against a base ref; a plain scene carries none of them. Two review
//      honesty rules: BODY EDITS REGISTER (a content change with an unchanged symbol
//      set is still `changed` — a reviewer cannot accept blindness to prose), and the
//      map NEVER SILENTLY TRUNCATES — changed files outside the graph (scripts, CI,
//      docs) are counted in diff.outside and surfaced, not dropped.
export interface SceneModel {
  root: string;
  intent: string;             // the entry component's one-line intent
  generatedAt: string;        // ISO stamp of this derivation
  head: string | null;        // short HEAD at derivation (null: not a git repo)
  dirty: boolean;
  grid: { cols: number; rows: number };  // lot-grid extents (0-based, row-major bounds)
  components: SceneComponent[];
  verify: { lastFastAt?: string; lastFullAt?: string; failures: number } | null; // null = never verified
  diff: SceneDiff | null;                // non-null = a REVIEW scene; change flags populated
}

export interface SceneDiff {
  base: string;               // the base ref, short
  outside: { added: number; removed: number; changed: number }; // changed files the graph
                              // does NOT own (scripts, CI, docs) — counted so the scene can
                              // say "N changes outside the map" instead of lying by omission
}

export interface SceneComponent {
  label: string;
  dir: string;                // component dir relative to root ("." = entry)
  intent: string;
  why: string;                // the authored rationale ("" if missing — itself a visible gap)
  lot: { x: number; y: number };          // persisted geography (axial hex q,r) — never moves once assigned
  mass: { files: number; symbols: number };    // honest size of what exists
  claimed: { files: number; symbols: number }; // the subset ANY claim names (the wireframe)
  pieces: ScenePiece[];       // ONE per file, sorted by label (stable within-district
                              // geography) — the triangular towers inside the district
  change?: "added" | "removed"; // diff scenes only: the whole district is new, or it
                              // exists only in the base (rendered as a ghost district
                              // on its reserved lot — geography is append-only, so the
                              // lot is still there). Removed districts carry their
                              // BASE pieces/mass so the ghost has honest shape.
  unclaimedSample: string[];  // up to ~12 uncovered file/symbol names, for the tooltip
  gates: SceneGate[];         // the boundary claims — drawn as gates into the structure
  unanchored: string[];       // ## invariants with no anchoring boundary claim (red flags)
  light: SceneLight;
  heat: number;               // 0..1 — share of recent commits touching this component
  links: string[];            // dirs of OTHER components this one's files import (adjacency)
}

export interface SceneLight {
  level: "lit" | "dim" | "dark";  // lit: fresh passes at current HEAD · dim: passes exist
                                  // but stale (older commit) · dark: nothing ever verified
  fails: number;              // failing claim records (each renders as a red flare)
  stale: number;              // pass records taken at another commit
  freshest?: string;          // ISO stamp of the newest pass record, if any
}

/** One triangular tower: a FILE inside its district. `claimed` mirrors deriveClaimed's
 *  file logic — a claim names this file by PATH, blessing at most one file (an ambiguous
 *  bare basename blesses none) — so the tower-level view sums exactly to
 *  `claimed.files` / `mass.files`. */
export interface ScenePiece {
  label: string;              // the file's display label
  path: string;               // repo-relative path — the diff key and the full name
  lines: number;              // the file's line count — the tower's HEIGHT (honest mass)
  symbols: number;            // this file's declaration surface — card/tooltip datum
  claimed: boolean;           // a claim names this file → renders inside the blueprint
  change?: PieceChange;       // diff scenes only; absent = unchanged
  prevSymbols?: number;       // former declaration surface when change="changed" and it moved
  prevLines?: number;         // former height when change="changed" and the size moved
}

/** added/removed = the file itself. "changed" = the file differs from base AT ALL —
 *  symbol set moved OR content moved (body edits register; a reviewer cannot accept
 *  blindness to prose). prevLines/prevSymbols carry the base measurements when they
 *  differ, so the renderer can mark former heights. */
export type PieceChange = "added" | "removed" | "changed";

export interface SceneGate {
  inv: string;                // the invariant this gate enforces
  chokepoint: string;
  verb: "test" | "guard" | "";     // "" = boundary declared with no oracle
  oracle: string;
  // Material encodes the enforcement ladder, derived from claims + verdicts only:
  //   steel    — has an oracle and its last verdict was a pass (totality-checked)
  //   scaffold — no oracle, no verdict yet, or the verdict is stale (holding by
  //              memory/an aging green — visibly temporary construction)
  //   breached — the last verdict is a FAIL (render loudly; a gate that isn't holding)
  material: "steel" | "scaffold" | "breached";
  verdict: "pass" | "fail" | "stale" | "unknown";
  humanEye: boolean;          // via guard: the meta-oracle never analyzed it — flag it
}

/** The renderer's exact signature (src/render-scene.ts implements this). Returns a
 *  COMPLETE self-contained HTML document: inline CSS/JS, embedded model JSON, zero
 *  external resources (no CDN, no fonts, no fetches). The view is an isometric
 *  TURNTABLE: client-side controls rotate the whole field in 60° steps around the
 *  plaza (0,0) — rotation is view state only and never touches the geography. */
export type RenderScene = (model: SceneModel, stamp: string) => string;
