// render-index.ts — IndexModel → one self-contained `_index.html`.
//
// A PURE FUNCTION OF THE MODEL. `index.json` is written beside this page, so every figure
// rendered here is checkable against a file a `jq` one-liner can read; the render invents
// nothing, reads no clock (the stamp arrives in the model) and touches no disk.
//
// ── THE FORM, AND THE FAILURE IT WAS REWRITTEN AFTER ──────────────────────────────────
//
// The first version of this page was briefed as a SPEC SHEET — dense, tabular, monospace —
// and it delivered exactly that: every table on one scroll, three staleness sentences above
// the fold, 401 lines of rendered wall. The verdict on it was "it teaches nothing, it
// structures nothing, it's an assault." The brief was the defect, not the implementation:
// MINIMALIST MEANS FEW THINGS, NOT SMALL TYPE AT MAXIMUM DENSITY. A page optimised for
// information per square inch is optimised against teaching.
//
// THE REFERENCE IS NOW THE PRIUS ENERGY MONITOR. A hybrid drivetrain is explained with no
// documentation at all by three boxes — engine, battery, wheels — and arrows between them
// that light up as power flows. You learn the STRUCTURE by watching it operate. Five
// objects, one glance. That is what the MAP is now, and the data was already there:
// `map.crossings` is regions, arrows, a NAMED GUARD on each arrow, the guard's strength
// (`tier`) and the current through it (`heat`).
//
// ── THE RULES ─────────────────────────────────────────────────────────────────────────
//
//   · THREE TABS, ONE VISIBLE. Map · Journal · Trajectory. The other two are `display:none`
//     — genuinely hidden, not merely below the fold.
//   · AT MOST SEVEN PRIMARY OBJECTS PER TAB ON FIRST PAINT. Every tab here paints five:
//     masthead, tab bar, the figure, one summary line, one drill strip. If a tab cannot get
//     under seven the level of abstraction is wrong, not the font size.
//   · NO PARAGRAPH OF PROSE ABOVE THE FOLD, ANYWHERE. Sentences are drill-down. The three
//     STALE/UNREAD sentences that used to open the page are now a MARK beside the title;
//     the sentences are one click away and are not lost.
//   · THREE LEVELS MAXIMUM: glance → open one thing → read the sentence. A fourth level
//     belongs in `_graph.html`.
//   · NO NETWORK, EVER. That is the invariant the old "no script" rule was really buying:
//     one file, no second request, nothing to fetch. It is now stated directly — no `http:`,
//     no `src=`, no `@import`, no `fetch(` — and INLINE SCRIPT IS ALLOWED, because the
//     scriptless spelling of "click an arrow" was absolutely-positioned `<label>` hotspots
//     laid over the SVG at pre-computed pixel rects, and THAT CONSTRAINED THE LAYOUT: every
//     interactive thing had to stay where a computed rectangle said. The listeners are now
//     on the real SVG elements. The tabs stay `:target` and the disclosures stay
//     checkbox + `~`: those cost the layout nothing, so nothing is gained by moving them.
//     Selection is the only scripted behaviour, and its OFF state is the whole figure —
//     scripting off degrades to "no highlight", never to a page that hides its content.
//   · MONOSPACE THROUGHOUT, four colour values (fg / dim / warn / alarm), hairline rules,
//     no cards, no rounding, no shadows, no gradients, no animation beyond show/hide.
//   · A MODULAR GRID, base unit 8px. Node widths, column pitch, row height, band height,
//     gutters and the page's own vertical rhythm are all multiples of it, and the figure
//     routes ORTHOGONALLY ONLY — horizontal runs on rows, vertical bus bars on columns.
//   · THREE TYPE SIZES, no more (`--t1` prose, `--t2` figures, `--t3` micro-labels). Weight
//     and tone carry every other distinction.
//   · IT MUST READ PRINTED IN GREYSCALE. That is the actual test of the colour rule. So
//     `tier` is LINE TREATMENT (solid → dashed → dotted, continuity falling with the
//     strength of the guarantee), `security` is a drawn MARK on the arrow, `heat` is LINE
//     WEIGHT, severity is a leading `!`/`!!` text column, and print opens every tab and
//     every panel so the paper copy is the whole document.
import type {
  IndexModel, IndexEntry, IndexMark, IndexCrossing, Darkness, Capped, IndexGate,
  IndexComponent, SourceRead,
} from "./index-model.ts";

const esc = (s: unknown) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** SEVERITY, as a text mark first and a colour second. The mark is the encoding; the class
 *  is the reinforcement. Greyscale legibility is a property of this function. */
type Sev = "quiet" | "warn" | "alarm";
const MARK: Record<Sev, string> = { quiet: "", warn: "!", alarm: "!!" };
const mark = (s: Sev) => `<td class="mk ${s}">${MARK[s]}</td>`;

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

/** A count over its denominator — the ONE way a number appears on this page. `null` total
 *  is UNMEASURABLE and renders as such: `0 of 0` and `0 of 500` must never look alike. */
const over = (n: number, d: number | null, unit: string) =>
  d === null ? `<span class="alarm">UNMEASURED</span> <span class="dim">(${esc(unit)})</span>`
    : `<b>${n}</b><span class="dim">/${d} ${esc(unit)}</span> <span class="dim">${pct(n, d)}</span>`;

/** The withheld tail, stated. NEVER silently truncated — a shortened list that looks
 *  complete is the defect this whole harness hunts. */
const tail = (c: Capped<unknown>, noun: string) =>
  c.withheld > 0 ? `<p class="withheld">… ${c.withheld} more ${esc(noun)} not shown (${c.total} in total). They are not lost; the cap is on your attention, not on the record.</p>` : "";

const SPARK = "▁▂▃▄▅▆▇█";
const spark = (vals: number[]): string => {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  if (!(hi > lo)) return SPARK[0].repeat(vals.length);
  return vals.map((v) => SPARK[Math.max(0, Math.min(7, Math.round(((v - lo) / (hi - lo)) * 7)))]).join("");
};

const day = (iso: string) => esc(iso.slice(0, 10));

/** A DOM id, from a journal record id. The page generates one CSS rule per revealable
 *  entry, so anything that reaches a selector is reduced to a safe alphabet first. */
const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");

// ── LEVEL TWO: the disclosure ─────────────────────────────────────────────────────────
//
// THE ONLY WAY DETAIL APPEARS ON THIS PAGE. A hidden checkbox, a label that carries the
// COUNT (so the closed state still states the size of what it hides), and a panel revealed
// by the sibling combinator. No script, and the closed state is the default in the markup
// rather than something applied after load.

/** The clickable term. Lives in a one-line strip with its siblings, so N disclosures cost
 *  the reader ONE object rather than N. */
const tog = (id: string, label: string, count: string, sev: Sev = "quiet") =>
  `<input type="checkbox" id="x-${id}" class="tog"><label for="x-${id}" class="term ${sev}">${MARK[sev]}${MARK[sev] ? " " : ""}${esc(label)} <span class="ct">${esc(count)}</span></label>`;

/** The panel it opens. Must be a following sibling of the input — that is the whole
 *  mechanism, and it is why the strip and the panels share one parent. */
const panel = (id: string, body: string) => `<div class="panel p-${id}">${body}</div>`;

// ── the sources strip, now behind the badge ───────────────────────────────────────────

/** WHAT WAS READ, AND WHAT WAS NOT. This used to be the first thing on the page and it
 *  cost the reader three sentences before a single structure appeared. It is now the
 *  MARK beside the title — the information is not lost, it has stopped being first. */
function sourcesTable(sources: SourceRead[]): string {
  const row = (s: SourceRead) => {
    const sev: Sev = !s.ok ? "alarm" : s.stale ? "warn" : "quiet";
    const state = !s.ok ? "UNREAD" : s.stale ? "STALE" : "read";
    return `<tr>${mark(sev)}<td class="k">${esc(s.name)}</td><td class="${sev}">${state}</td>`
      + `<td class="dim">${s.at ? `${day(s.at)} ` : ""}${s.commit ? `<span class="mono">${esc(s.commit)}</span> ` : ""}${esc(s.detail)}</td></tr>`;
  };
  return `<table class="grid"><thead><tr><th></th><th>source</th><th>state</th><th>what it holds — or why it could not be read</th></tr></thead>
    <tbody>${sources.map(row).join("")}</tbody></table>`;
}

// ── I. THE MAP, AS A SPINE YOU CAN TRACE ──────────────────────────────────────────────
//
// TWO REWRITES WERE REJECTED BEFORE THIS ONE, and neither failed at rendering. The first
// was a layered box-and-arrow DAG; the second a matrix, one crossing per row, perfectly
// aligned. The verdict on the matrix was "it's just a bunch of lines — what does it even
// mean that config connects to public-web? it reveals nothing." That is the real defect and
// it is in the DATA MODEL, not the layout: `atlas.transitions` has ONE relation type doing
// THREE different jobs, and both pictures drew all three as identical arrows. A reader could
// not tell a STEP from a GRAB, so there was nothing to trace.
//
// ── THE THREE JOBS, AND HOW THEY ARE TOLD APART ───────────────────────────────────────
//
// Classify every region by its degree in the crossing graph:
//     SOURCE  never a destination     SPINE  both an origin and a destination
//     SINK    never an origin
// The SPINE is the longest simple path from a source; ties on length break on the total
// HEAT along the path, because the entry is where traffic actually enters. Then every
// crossing is exactly one of:
//
//   PROMOTION  both ends on the spine, forwards. A request is promoted from one trust stage
//              to the next BY A NAMED GUARD. This is the line the eye follows.
//   REACH      from a spine stage to a region off the spine. A resource grabbed at that
//              stage. It TERMINATES — reaches do not compose, so they hang below the spine
//              and end on a resource box drawn ONCE and shared.
//   SUPPLY     from a source that is NOT the entry. Ambient environment injected sideways.
//              IT IS NOT DRAWN AS AN ARROW AT ALL. Drawing `config → public-web` as an arrow
//              in the path asserts a sequence that does not exist, and asserting it is
//              precisely what made the last two figures say nothing.
//   ASIDE      whatever those three cannot hold — a back edge, a self-loop, a chain hanging
//              off a sink. It is listed, and the figure says why it could not be placed.
//
// The three classes separate by TONE and GEOMETRY, not by hue: a promotion runs along the
// spine's own centre line in `--fg`; a reach drops orthogonally into the resource band in
// `--dim`; supply has no line. Tier stays LINE TREATMENT, heat stays LINE WEIGHT, security
// stays a drawn diamond — so all of it still survives a greyscale printer.
//
// THIS SPLIT IS DERIVED, NOT RECORDED. The atlas does not carry a `kind`, so the figure
// infers it from degree. That is honest and it is also the reason a project whose trust
// graph is cyclic, or has no spine at all, gets a SENTENCE saying so rather than a picture
// that implies an order nobody declared. Every degenerate shape below states itself.

/** THE BASE UNIT of the whole page. Every column track, row track and wire offset in the
 *  figure is a multiple of it; so is the page's vertical rhythm. */
const U = 8;
/** ONE type size inside the figure — the page's `--t3`. Weight and tone carry every other
 *  distinction, which is what keeps the whole document to three sizes. */
const FS = 10.5;
/** Monospace advance as a fraction of font-size. Slightly over the 0.6 of the faces in the
 *  stack, so a reserved column is never narrower than the text in it. USED FOR TRACK SIZING
 *  ONLY: since the substrate became a CSS grid, a mis-estimate here degrades to a label
 *  overflowing its fixed cell (which the browser paints legibly over the knockout) instead
 *  of shifting every coordinate downstream of it — the drift the old all-SVG figure had. */
const CH = 0.61;
/** The vertical rhythm: a band head, a stage/resource box, one wire row, and where the wire
 *  crosses that row (label above, clearance below). All multiples of U, so every connector
 *  endpoint the SVG emits lands on the same lattice the CSS tracks are cut from. */
const HEAD_H = 3 * U, BOX_H = 6 * U, WROW = 4 * U, WIRE_Y = 3 * U, SEP = 3 * U;
/** Widths snap to TWO units, so a box's centre line — where its bus drops — is itself on the
 *  grid rather than at a half unit. */
const snap2 = (n: number) => Math.ceil(n / (2 * U)) * 2 * U;

const textW = (s: string, fs: number = FS) => s.length * fs * CH;

/** TIER → LINE TREATMENT, and the ordering is the point: the stronger the guarantee, the
 *  more continuous the line. It carries in greyscale, which colour would not. */
const DASH: Record<number, string> = { 1: "", 2: "7 4", 3: "1.5 3" };
const TIER_NAME: Record<number, string> = { 1: "enshrined", 2: "totality-checked", 3: "convention" };

/** An arrowhead as a filled triangle, apex on the target. Drawn rather than `marker-end` so
 *  it inherits the edge's own colour without a marker definition per colour. */
const headX = (x: number, y: number, dir: 1 | -1, fill: string) =>
  `<path d="M${x},${y} L${x - dir * U},${y - 4} L${x - dir * U},${y + 4} Z" fill="${fill}"/>`;
const headY = (x: number, y: number, dir: 1 | -1, fill: string) =>
  `<path d="M${x},${y} L${x - 4},${y - dir * U} L${x + 4},${y - dir * U} Z" fill="${fill}"/>`;

/** THE SECURITY MARK — a drawn diamond, never a hue, so it survives a greyscale printer.
 *  One shape, worn by a crossing's label and once again in the legend. It is a `::before`
 *  on the `sec` class (a rotated square in `currentColor`): TEXT-LEVEL ink, like a glyph —
 *  it rides the label, inherits its tone (a broken security crossing's diamond goes alarm
 *  with it), and adds no layout edge of its own to the lattice. */
const SEC = "sec";

/** THE READING the figure draws: which crossings are steps, which are grabs, which are
 *  ambient, and — where the shape does not support the reading — the sentence that says so.
 *  Exported because it is the claim being made, and a claim ought to be testable without
 *  parsing an SVG. */
export interface MapReading {
  /** Every region named by a crossing, in first-appearance order. */
  regions: string[];
  /** The traceable path: ordered trust stages, entry first. Empty only when there are no
   *  crossings at all. */
  spine: string[];
  /** One entry per ORDERED PAIR of spine stages that is crossed, in spine order. `guards` is
   *  every chokepoint managing that same promotion — two guards on one crossing are two
   *  parallel lanes, not one arrow with two names. */
  promotions: { from: string; to: string; skip: boolean; guards: IndexCrossing[] }[];
  /** Resource grabs, grouped by the sink they land on (which is why the labels above a
   *  resource box form one left-aligned column). */
  reaches: { c: IndexCrossing; stage: string; sink: string }[];
  /** Sinks in left-to-right placement order. */
  sinks: string[];
  /** Ambient sources and what they inject. Never drawn as a step. */
  supply: { source: string; guards: IndexCrossing[] }[];
  /** What the three bands cannot hold. Drawn as a list, never silently dropped. */
  aside: IndexCrossing[];
  /** One line per way this project's shape does not fit the reading. Rendered verbatim. */
  notes: string[];
}

/** Strongest first, then hottest — so the one enshrined crossing leads its lane group and a
 *  reader meets the guarantee before the volume. */
const rank = (a: IndexCrossing, b: IndexCrossing) =>
  a.tier - b.tier || (b.heat ?? -1) - (a.heat ?? -1) || a.sym.localeCompare(b.sym);

/**
 * THE DERIVATION. A pure function of the crossing list — no config, no heuristic on names.
 *
 * The spine search is an exhaustive longest-SIMPLE-path walk, which is exponential in the
 * worst case, so it runs on a fixed step budget. A budget that runs out does not hang and
 * does not lie: it keeps the longest path it found and says in a note that the spine is a
 * lower bound. On any region graph of a size a human would read, the budget is never touched.
 */
export function readMap(cs: readonly IndexCrossing[]): MapReading {
  const regions: string[] = [];
  for (const c of cs) for (const r of [c.from, c.to]) if (!regions.includes(r)) regions.push(r);

  const out = new Map<string, string[]>(regions.map((r) => [r, []]));
  const indeg = new Map<string, number>(regions.map((r) => [r, 0]));
  for (const c of cs) {
    if (c.from === c.to) continue;                       // a self-loop is not a step anywhere
    const o = out.get(c.from)!;
    if (!o.includes(c.to)) { o.push(c.to); indeg.set(c.to, indeg.get(c.to)! + 1); }
  }
  const heatBetween = (a: string, b: string) =>
    cs.reduce((s, c) => (c.from === a && c.to === b ? s + (c.heat ?? 0) : s), 0);

  const sources = regions.filter((r) => indeg.get(r) === 0);
  const notes: string[] = [];

  // ── THE SPINE ───────────────────────────────────────────────────────────────────────
  let budget = 40_000;
  const longestFrom = (start: string) => {
    let bestPath: string[] = [], bestHeat = 0;
    const path: string[] = [], seen = new Set<string>();
    const walk = (r: string, heat: number) => {
      if (budget-- <= 0) return;
      path.push(r); seen.add(r);
      if (path.length > bestPath.length || (path.length === bestPath.length && heat > bestHeat)) {
        bestPath = [...path]; bestHeat = heat;
      }
      // A SINK CANNOT BE A STAGE. The longest path in the raw graph always ends by falling
      // into a resource — on the project this was built against that made `public-egress` a
      // trust stage and `Patient` a promotion, which is exactly the confusion between a step
      // and a grab this figure exists to undo. A stage is a region that is BOTH an origin
      // and a destination; the walk may only extend through those.
      for (const n of [...out.get(r)!].sort()) if (!seen.has(n) && out.get(n)!.length) walk(n, heat + heatBetween(r, n));
      path.pop(); seen.delete(r);
    };
    walk(start, 0);
    return { path: bestPath, heat: bestHeat };
  };

  // WITH NO SOURCE AT ALL every region is reached from another — a cycle — and there is no
  // entry to start from. The walk still runs, from every region, and the page says the start
  // was chosen rather than found.
  const cyclic = regions.length > 0 && sources.length === 0;
  const starts = sources.length ? sources : [...regions].sort();
  const cands = starts.map((s) => ({ s, ...longestFrom(s) }))
    .sort((a, b) => b.path.length - a.path.length || b.heat - a.heat || a.s.localeCompare(b.s));
  const spine = cands[0]?.path ?? [];
  const at = new Map(spine.map((r, i) => [r, i]));

  // ── THE CLASSIFICATION ──────────────────────────────────────────────────────────────
  const ambient = new Set(sources.filter((r) => r !== spine[0]));
  const promo = new Map<string, IndexCrossing[]>();
  const reachOf = new Map<string, IndexCrossing[]>();     // sink → its grabs
  const supplyOf = new Map<string, IndexCrossing[]>();
  const aside: IndexCrossing[] = [];
  for (const c of cs) {
    const i = at.get(c.from), j = at.get(c.to);
    const put = (m: Map<string, IndexCrossing[]>, k: string) =>
      (m.get(k) ?? m.set(k, []).get(k)!).push(c);
    if (ambient.has(c.from)) put(supplyOf, c.from);
    else if (i !== undefined && j !== undefined && j > i) put(promo, `${i}:${j}`);
    else if (i !== undefined && j === undefined) put(reachOf, c.to);
    else aside.push(c);
  }

  const promotions = [...promo.entries()]
    .map(([k, guards]) => {
      const [i, j] = k.split(":").map(Number);
      return { from: spine[i], to: spine[j], skip: j > i + 1, i, j, guards: [...guards].sort(rank) };
    })
    .sort((a, b) => a.i - b.i || a.j - b.j)
    .map(({ from, to, skip, guards }) => ({ from, to, skip, guards }));

  // SINKS ARE ORDERED BY THE STAGE THAT GRABS THEM, latest-reaching last, so the resource
  // band reads left-to-right in the same direction as the spine above it.
  const stageIdx = (sink: string, pick: (xs: number[]) => number) =>
    pick(reachOf.get(sink)!.map((c) => at.get(c.from)!));
  const sinks = [...reachOf.keys()].sort((a, b) =>
    stageIdx(a, (xs) => Math.max(...xs)) - stageIdx(b, (xs) => Math.max(...xs))
    || stageIdx(a, (xs) => xs.reduce((s, x) => s + x, 0) / xs.length)
     - stageIdx(b, (xs) => xs.reduce((s, x) => s + x, 0) / xs.length)
    || a.localeCompare(b));
  const reaches = sinks.flatMap((sink) =>
    [...reachOf.get(sink)!].sort(rank).map((c) => ({ c, stage: c.from, sink })));

  const supply = [...supplyOf.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([source, guards]) => ({ source, guards: [...guards].sort(rank) }));

  // ── WHERE THE READING DOES NOT FIT, THE PAGE SAYS SO ────────────────────────────────
  if (cyclic) {
    notes.push(`No region is a pure source: every one of these ${regions.length} is reached from another, so this trust graph is CYCLIC and has no entry. The spine below starts at ${spine[0]} because it is the longest path found, not because a request begins there.`);
  }
  const tied = cands.filter((c) =>
    c.path.length === cands[0].path.length && c.heat === cands[0].heat);
  if (tied.length > 1) {
    notes.push(`${tied.length} sources tie on both path length and heat (${tied.map((t) => t.s).join(", ")}). ${spine[0]} was taken alphabetically — the entry here is a coin toss, not a reading.`);
  }
  if (spine.length === 1) {
    notes.push(`NOTHING IS PROMOTED. No crossing leaves ${spine[0]} for a region that leads anywhere else, so the spine is one stage long and every crossing on this project terminates. That is a real shape, not a missing measurement.`);
  }
  if (budget <= 0) {
    notes.push(`The spine search hit its step budget on this region graph, so the path drawn is the longest one FOUND and a longer one may exist. Nothing else on the figure is affected.`);
  }
  if (aside.length) {
    notes.push(`${aside.length} crossing(s) are on neither the spine nor an ambient source — a back edge, a self-loop, or a chain hanging off a resource. They are listed under ASIDE rather than folded into a band that would misdescribe them.`);
  }
  return { regions, spine, promotions, reaches, sinks, supply, aside, notes };
}

/**
 * THE DIAGRAM. Returns null when there is no crossing data at all — the caller then says so
 * in one line rather than drawing an empty frame, because a picture of nothing is the
 * green-by-absence this page exists to refuse.
 *
 * ── THE SUBSTRATE, AND THE FAILURE IT REPLACED ────────────────────────────────────────
 * This used to be one hand-computed SVG: every box, label and caption at a pixel x derived
 * from this file's own text-width estimate, beside a roster laid out by CSS — two
 * coordinate systems, hand-synced, and every review found them drifted (node widths varying
 * with label length, captions 8px off the figures they named, 42 distinct left edges on one
 * tab at full width). The substrate is now ONE LATTICE: a fixed-track CSS grid whose track
 * list is emitted here, once. Boxes and labels are HTML grid items — the browser measures
 * the text, sets the baselines and paints any overflow harmlessly over the knockout — and
 * the SVG draws CONNECTORS ONLY, as an absolutely-positioned overlay whose coordinates are
 * prefix-sums of the SAME track list. There is no second coordinate system left to drift.
 */
function diagram(cs: readonly IndexCrossing[], comps: readonly IndexComponent[]):
  { html: string; w: number; reading: MapReading } | null {
  if (!cs.length) return null;
  const r = readMap(cs);

  const nameOf = (c: IndexCrossing) => c.present ? c.sym : `${c.sym} DANGLING`;
  // A crossing carries its organ's DIRECTORY, not its label — that is the id the roster keys
  // its own rows by, and two components may share a label while no two share a directory.
  const dirByLabel = new Map<string, string>();
  for (const c of comps) if (!dirByLabel.has(c.label)) dirByLabel.set(c.label, c.dir);

  // ── THE COLUMN TRACKS. Nothing here is tuned to a project: every box column is as wide
  // as the longest region name, every spine gutter as wide as the longest guard that runs
  // through one (plus its security diamond). SINKS ARE QUANTISED TO COLUMNS — under the
  // latest stage that grabs them, pushed right only past an occupied column — so a
  // resource's box, its reach labels and its drop all share ONE column edge instead of each
  // finding its own x, which is where most of the 42 stray left edges came from.
  const boxed = [...r.spine, ...r.sinks, ...r.supply.map((s) => s.source)];
  const BOX_W = snap2(Math.max(...boxed.map((n) => textW(n))) + 2 * U);
  const promoW = r.promotions.filter((p) => !p.skip).flatMap((p) => p.guards)
    .map((c) => textW(nameOf(c)) + (c.security ? 2 * U : 0));
  const GUT = Math.max(6 * U, snap2(Math.max(0, ...promoW) + 3 * U));

  const idxOf = new Map(r.spine.map((s, i) => [s, i]));
  const sinkCol = new Map<string, number>();
  let cur = -1;
  for (const s of r.sinks) {
    const want = Math.max(...r.reaches.filter((x) => x.sink === s).map((x) => idxOf.get(x.stage)!));
    cur = Math.max(want, cur + 1);
    sinkCol.set(s, cur);
  }
  const nCols = Math.max(r.spine.length, r.sinks.length ? Math.max(...sinkCol.values()) + 1 : 1);
  const colTracks: number[] = [];
  for (let i = 0; i < nCols; i++) {
    // Between stages the separator is a GUTTER (a promotion runs through it); past the last
    // stage it is only a GAP — sizing those trailing separators like gutters would spread
    // the resource band with room no guard will ever use.
    if (i > 0) colTracks.push(i < r.spine.length ? GUT : SEP);
    colTracks.push(BOX_W);
  }
  // An ambient strip beside a single-column lattice would leave its labels no track to
  // live in, so the degenerate shape gets one.
  if (r.supply.length && nCols === 1) colTracks.push(GUT);
  const colLeft: number[] = [];
  { let x = 0; colTracks.forEach((t, i) => { if (i % 2 === 0) colLeft.push(x); x += t; }); }
  const width = colTracks.reduce((a, b) => a + b, 0);
  const busX = (i: number) => colLeft[i] + BOX_W / 2;
  /** Box column i's 1-based grid line — the one translation between lattice and CSS. */
  const gcol = (i: number) => 2 * i + 1;

  // ── THE ROW TRACKS, appended band by band. `topOf` is the same prefix-sum the grid
  // resolves its own tracks to, which is what entitles the SVG overlay to draw at these
  // y's without ever measuring the rendered page.
  const rowH: number[] = [];
  const row = (h: number) => { rowH.push(h); return rowH.length; };
  const topOf = (ri: number) => rowH.slice(0, ri - 1).reduce((a, b) => a + b, 0);

  const cells: string[] = [];
  const wires: string[] = [];
  const cell = (ri: number | string, ci: number | string, cls: string, body: string, extra = "") =>
    cells.push(`<div class="${cls}" style="grid-row:${ri};grid-column:${ci}"${extra}>${body}</div>`);
  /** A band's chrome: a rule across the figure, a name, a note — one grid row, and the
   *  note column is a stylesheet constant (`--notex`) shared with the legend, so three
   *  band notes and every legend caption sit on ONE alignment line. */
  const bh = (ri: number, label: string, note: string) =>
    cell(ri, "1 / -1", "bh", `<span class="bn">${esc(label)}</span><span class="lg dim">${esc(note)}</span>`);

  // ── THE ENCODINGS ───────────────────────────────────────────────────────────────────
  // HEAT IS LINE WEIGHT and it has to be SEEN. A linear map of a range whose ends differ by
  // sixty-fold puts every cold crossing inside a pixel of every other; the exponent spreads
  // the bottom of the range, where the crossings actually are. Anchored at 1 so an
  // unrecorded heat is a hairline and is legended as unrecorded rather than cold. A
  // PROMOTION then draws two units heavier than a reach at the same heat — the class is the
  // constant, the heat is the slope, and neither reading destroys the other.
  const heats = cs.map((c) => c.heat).filter((h): h is number => h !== null);
  const maxHeat = Math.max(0, ...heats);
  const weight = (h: number | null, promo = false) =>
    +((h === null || maxHeat <= 0 ? 1 : 1 + 3 * Math.pow(h / maxHeat, 0.6)) + (promo ? 2 : 0)).toFixed(2);
  // TONE IS THE CLASS: a promotion is the figure's own line and draws at full strength; a
  // reach is subordinate and draws dim. A broken chokepoint overrides both.
  const broken = (c: IndexCrossing) => !c.present || (c.tier === 3 && c.security);
  const toneOf = (c: IndexCrossing, promo: boolean) =>
    broken(c) ? "var(--alarm)" : promo ? "var(--fg)" : "var(--dim)";
  const strokeOf = (c: IndexCrossing, promo: boolean) => {
    const d = DASH[c.tier] ?? DASH[3];
    return `stroke="${toneOf(c, promo)}" stroke-width="${weight(c.heat, promo)}"`
      + `${d ? ` stroke-dasharray="${d}"` : ""} fill="none"`;
  };
  /** The selection pair — `data-sym` lights this crossing, `data-owner` ties it to its
   *  organ's roster row. BOTH the label and the wire carry it (an organ selection must
   *  light its wires, not only its label texts); only the LABEL is the focusable control,
   *  which is what keeps one crossing one tab stop instead of two. */
  const symAttrs = (c: IndexCrossing) => {
    const dir = c.owner === null ? undefined : dirByLabel.get(c.owner);
    return ` data-sym="${esc(c.sym)}"${dir ? ` data-owner="${esc(dir)}"` : ""}`;
  };
  const attrsOf = (c: IndexCrossing, kind: string) => {
    const heat = c.heat === null ? "heat unrecorded" : `heat ${(c.heat * 100).toFixed(1)}%`;
    const title = `${nameOf(c)} — ${kind}: ${c.from} to ${c.to}, ${TIER_NAME[c.tier] ?? `tier-${c.tier}`}${c.security ? ", security" : ""}, ${heat}`;
    return `${symAttrs(c)} tabindex="0" role="button" title="${esc(title)}"`;
  };
  // A LABEL KNOCKS OUT WHAT IT CROSSES — its `.lbl` span carries the page background, so a
  // run passing under another stage's drop never strikes through a name. The browser sizes
  // the knockout to the text; the old hand-computed `knock` rects are gone by construction.
  const lbl = (c: IndexCrossing) => `<span class="lbl${c.security ? ` ${SEC}` : ""}">${esc(nameOf(c))}</span>`;
  const glCls = (c: IndexCrossing, promo: boolean) =>
    `gl${promo ? " pr" : ""}${c.tier === 1 ? " t1" : ""}${broken(c) ? " bad" : ""}`;

  // ── SUPPLY: A STRIP, NOT A PATH ─────────────────────────────────────────────────────
  // The one thing this figure refuses to draw as an arrow. `config → public-web` as a line
  // in the path asserts a sequence, and there is none: it is read wherever it is read.
  if (r.supply.length) {
    bh(row(HEAD_H), "supply", "ambient — reaches the path, and is not a step in it");
    const flatFrom = row(U);
    for (const s of r.supply) {
      const first = rowH.length + 1;
      for (const c of s.guards) {
        cell(row(WROW), nCols > 1 ? "2 / -1" : "2 / 3", `${glCls(c, false)} srow gut`,
          lbl(c) + `<span class="lg dim">${esc(`read by ${c.to}`)}</span>`, attrsOf(c, "supply"));
      }
      cells.push(`<div class="fbox" style="grid-row:${first} / ${rowH.length + 1};grid-column:1;align-self:center;height:${Math.min(BOX_H, s.guards.length * WROW)}px">${esc(s.source)}</div>`);
    }
    // The tint that marks the band ambient. It is the one non-positioned cell, so it paints
    // UNDER the wire overlay instead of over it.
    cells.push(`<div class="flat" style="grid-row:${flatFrom} / ${rowH.length + 1};grid-column:1 / -1"></div>`);
    row(SEP);
  }

  // ── THE SPINE ───────────────────────────────────────────────────────────────────────
  bh(row(HEAD_H), "spine",
    r.spine.length > 1
      ? `a request enters at ${r.spine[0]} and is promoted rightward by a named guard`
      : `one stage — nothing here is promoted anywhere`);
  row(2 * U);
  const rStage = row(BOX_H);
  r.spine.forEach((s, i) => cell(rStage, gcol(i), "fbox stage", esc(s)));
  const stageTop = topOf(rStage), centreY = stageTop + BOX_H / 2, boxBot = stageTop + BOX_H;

  // Lane 0 is the box centre line, so the spine reads as ONE unbroken run; a second guard on
  // the same promotion gets a wire row of its own below, visibly parallel, and a
  // stage-SKIPPING promotion goes below all of those, clear of every box.
  const adjLanes = Math.max(1, ...r.promotions.filter((p) => !p.skip).map((p) => p.guards.length));
  const laneRows = Array.from({ length: adjLanes - 1 }, () => row(WROW));
  const skipRows = r.promotions.filter((p) => p.skip).flatMap((p) => p.guards.map(() => row(WROW)));
  const laneWireY = (k: number) => k === 0 ? centreY : topOf(laneRows[k - 1]) + WIRE_Y;

  let skipIdx = 0;
  for (const p of r.promotions) {
    const i = idxOf.get(p.from)!, j = idxOf.get(p.to)!;
    p.guards.forEach((c, k) => {
      const st = strokeOf(c, true), tone = toneOf(c, true);
      if (!p.skip) {
        // THE STEP ITSELF, on the box centre line when it is the first guard on this
        // promotion — which is what makes the spine one continuous run rather than N arrows.
        const y = laneWireY(k), a = colLeft[i] + BOX_W, b = colLeft[j];
        wires.push(`<g class="cx"${symAttrs(c)}>`
          + (k ? `<path d="M${a},${centreY} V${y}" ${st}/>` : "")
          + `<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" ${st}/>`
          + headX(b, y, 1, tone) + `</g>`);
        cell(k === 0 ? rStage : laneRows[k - 1], 2 * i + 2, `${glCls(c, true)} gut${k === 0 ? " l0" : " wl"}`,
          lbl(c), attrsOf(c, "promotion"));
      } else {
        // A STAGE-SKIPPING PROMOTION is a bypass: it leaves its stage, runs below every box
        // it passes, and lands on the one it reaches. It is still a step, so it is still
        // drawn at full strength — it just cannot ride the centre line.
        const y = topOf(skipRows[skipIdx++]) + WIRE_Y;
        const a = busX(i), b = colLeft[j] + U;
        wires.push(`<g class="cx"${symAttrs(c)}>`
          + `<path d="M${a},${boxBot} V${y} H${b} V${boxBot + U}" ${st}/>`
          + headY(b, boxBot, -1, tone) + `</g>`);
        cell(skipRows[skipIdx - 1], `${gcol(i)} / ${gcol(j) + 1}`, `${glCls(c, true)} wl`,
          `<span style="padding-left:${BOX_W / 2 + 2 * U}px">${lbl(c)}</span>`, attrsOf(c, "promotion (skips a stage)"));
      }
    });
  }

  // ── THE RESOURCES ───────────────────────────────────────────────────────────────────
  // A reach drops out of its stage, runs to the resource, and stops. The resource box is
  // drawn ONCE however many stages grab it — duplicating it would turn one shared thing into
  // several, which is the fact this band exists to state.
  if (r.sinks.length) {
    row(SEP);
    bh(row(HEAD_H), "resources",
      "grabbed at a stage and reached no further — a resource box is drawn once, however many stages hold it");
    row(2 * U);
    const reachRows = r.reaches.map(() => row(WROW));
    row(U);
    const rSink = row(BOX_H);
    const sinkTop = topOf(rSink);
    for (const s of r.sinks) cell(rSink, gcol(sinkCol.get(s)!), "fbox", esc(s));
    // ONE BUS PER STAGE, from the box down to the last lane that leaves it: the vertical is
    // what says "everything on these lanes is held by THIS stage".
    const lastLane = new Map<string, number>();
    r.reaches.forEach((x, i) => lastLane.set(x.stage, i));
    for (const [stage, i] of lastLane) {
      wires.push(`<path d="M${busX(idxOf.get(stage)!)},${boxBot} V${topOf(reachRows[i]) + WIRE_Y}" stroke="var(--dim)" stroke-width="1" fill="none"/>`);
    }
    r.reaches.forEach((x, i) => {
      const c = x.c, y = topOf(reachRows[i]) + WIRE_Y, st = strokeOf(c, false), tone = toneOf(c, false);
      const a = busX(idxOf.get(x.stage)!), b = colLeft[sinkCol.get(x.sink)!] + U;
      wires.push(`<g class="cx"${symAttrs(c)}>`
        + `<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" ${st}/>`
        + `<path d="M${b},${y} V${sinkTop}" ${st}/>`
        + headY(b, sinkTop, 1, tone)
        + `<rect x="${a - U / 2}" y="${y - U / 2}" width="${U}" height="${U}" fill="${tone}"/></g>`);
      // The label's text starts ON the sink's own column edge — the same padding the box
      // text wears — so the guards landing on a resource read as one left-aligned column
      // above it. The full-width cell is the hit area, the old pointer-events rect as HTML.
      cell(reachRows[i], "1 / -1", `${glCls(c, false)} wl`,
        `<span style="padding-left:${b}px">${lbl(c)}</span>`, attrsOf(c, "reach"));
    });
  }

  // ── THE ASIDE ───────────────────────────────────────────────────────────────────────
  if (r.aside.length) {
    row(SEP);
    bh(row(HEAD_H), "aside", "on neither the spine nor an ambient source — listed, never dropped");
    row(U);
    for (const c of r.aside) {
      cell(row(WROW), "1 / -1", `${glCls(c, false)} srow`,
        lbl(c) + `<span class="lg dim">${esc(`${c.from} to ${c.to}`)}</span>`, attrsOf(c, "unplaced"));
    }
  }
  const height = rowH.reduce((a, b) => a + b, 0);

  // ── THE LEGEND. It names only what is on the page: a treatment with no subjects here
  // would be teaching a vocabulary this project does not use. The heat scale prints its own
  // ENDPOINTS, so the reader can check the encoding against the crossings table rather than
  // taking "line weight = heat" on faith. AND IT CARRIES THE TIER COUNTS: the legend is
  // where the tier line-treatments are explained, so the number of crossings at each tier
  // belongs on the same line — one home, not a legend here and a summary repeating it above.
  const tierCount = new Map<number, number>();
  for (const c of cs) tierCount.set(c.tier, (tierCount.get(c.tier) ?? 0) + 1);
  const leg: string[] = [];
  const sam = (inner: string) => `<svg viewBox="0 0 48 24" width="48" height="24" aria-hidden="true">${inner}</svg>`;
  const lrule = (w: number, tone: string, d: string, y = 12) =>
    `<line x1="0" y1="${y}" x2="48" y2="${y}" stroke="${tone}" stroke-width="${w}"${d ? ` stroke-dasharray="${d}"` : ""}/>`;
  const item = (sample: string, text: string) =>
    leg.push(`<div class="li"><span class="ls">${sample}</span><span class="lg dim">${esc(text)}</span></div>`);
  if (r.promotions.length) item(sam(lrule(4, "var(--fg)", "")), "promotion — a trust stage change, and the line to follow");
  if (r.reaches.length) item(sam(lrule(1.5, "var(--dim)", "")), "reach — a resource grabbed there, going no further");
  if (r.supply.length) item(`<span class="flat-s"></span>`, "supply — ambient, and deliberately not an arrow");
  for (const t of [...new Set(cs.map((c) => c.tier))].sort()) {
    const n = tierCount.get(t)!;
    item(sam(lrule(t === 1 ? 3 : 1.5, `var(--${t === 1 ? "fg" : "dim"})`, DASH[t] ?? DASH[3])),
      `${TIER_NAME[t] ?? `tier-${t}`} — ${n} crossing${n === 1 ? "" : "s"}${t === 1 ? ", drawn solid and at full strength" : ""}`);
  }
  if (cs.some((c) => c.security)) item(`<span class="${SEC}"></span>`, "security crossing");
  if (!heats.length) {
    item(sam(lrule(1, "var(--dim)", "")), "line weight — heat UNRECORDED, every line is a hairline for that reason");
  } else {
    const lo = Math.min(...heats), hi = Math.max(...heats);
    item(sam([lo, (lo + hi) / 2, hi].map((h, i) => lrule(weight(h), "var(--dim)", "", 4 + i * 8)).join("")),
      `line weight = change heat, ${(lo * 100).toFixed(1)}% to ${(hi * 100).toFixed(1)}%`
      + (heats.length < cs.length ? " (hairline = unrecorded, not cold)" : ""));
  }

  // The wire overlay and the cells resolve their geometry from the SAME track lists — the
  // grid templates below and the viewBox above are two spellings of one prefix-sum. `--pz`
  // is the print scale: paper cannot scroll, so the lattice zooms to a page there and
  // nowhere else.
  const svg = `<svg class="wires" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="the trust spine, its resources and its ambient supply">${wires.join("")}</svg>`;
  const html = `<div class="fgrid" style="grid-template-columns:${colTracks.map((t) => `${t}px`).join(" ")};grid-template-rows:${rowH.map((t) => `${t}px`).join(" ")};width:${width}px;--pz:${Math.min(1, 720 / width).toFixed(3)}">${svg}${cells.join("")}</div>`
    + `<div class="leg">${leg.join("")}</div>`;
  return { html, w: width, reading: r };
}

// ── the MAP's drill-downs ─────────────────────────────────────────────────────────────

function componentsTable(cs: IndexComponent[]): string {
  if (!cs.length) return `<p class="none">No component derived from the spec tree.</p>`;
  const row = (c: IndexComponent) => {
    const sev: Sev = c.breaches > 0 ? "alarm"
      : c.naked > 0 || (c.invariants > c.anchored) ? "warn" : "quiet";
    const grades = (["A", "B", "C", "D", "U"] as const)
      .filter((g) => c.grades[g] > 0).map((g) => `${c.grades[g]}${g}`).join(" ") || "—";
    return `<tr>${mark(sev)}<td class="k">${esc(c.label)}<div class="dim sub">${esc(c.dir)}</div></td>`
      + `<td>${c.zone ? esc(c.zone) : '<span class="warn">undeclared</span>'}</td>`
      + `<td class="n">${c.files}</td><td class="n">${c.lines}</td>`
      + `<td class="n">${c.accountedFiles}<span class="dim">/${c.files}</span></td>`
      + `<td class="n">${c.claims}</td>`
      + `<td class="n">${c.gates}</td><td class="g">${esc(grades)}</td>`
      + `<td class="n">${c.anchored}<span class="dim">/${c.invariants}</span></td>`
      + `<td class="n">${c.witnessed}<span class="dim">/${c.invariants}</span></td>`
      + `<td class="n">${c.symbols - c.undocumented}<span class="dim">/${c.symbols}</span></td>`
      + `<td class="n ${c.naked ? "warn" : "dim"}">${c.naked || "—"}</td></tr>`;
  };
  return `<table class="grid"><thead><tr><th></th><th>component</th><th>zone</th>
      <th class="n">files</th><th class="n">lines</th><th class="n">claimed</th><th class="n">claims</th>
      <th class="n">gates</th><th>grades</th><th class="n">anchored</th><th class="n">witnessed</th>
      <th class="n">documented</th><th class="n">naked</th></tr></thead>
    <tbody>${cs.map(row).join("")}</tbody></table>`;
}

function gatesTable(g: Capped<IndexGate>, clean: number, total: number): string {
  if (!total) return `<p class="none">No gates. No <code>boundary "…" at &lt;chokepoint&gt;</code> claim exists in this tree, so nothing here is anchored to an oracle — the map has structure and no enforcement.</p>`;
  const row = (x: IndexGate) => {
    const sev: Sev = x.verdict === "fail" ? "alarm" : x.grade === "U" || x.grade === "D" ? "warn" : "quiet";
    return `<tr>${mark(sev)}<td class="k">${esc(x.inv)}<div class="dim sub">${esc(x.comp)}</div></td>`
      + `<td class="mono">${esc(x.chokepoint)}</td>`
      + `<td class="mono dim">${x.oracle ? `${esc(x.verb)} "${esc(x.oracle)}"` : "—"}</td>`
      + `<td class="g ${x.grade === "U" || x.grade === "D" ? "warn" : ""}">${x.grade}</td>`
      + `<td class="${x.verdict === "fail" ? "alarm" : x.verdict === "pass" ? "" : "dim"}">${esc(x.verdict === "fail" ? "FAIL" : x.verdict)}</td>`
      + `<td class="dim">${x.crossing ? `${esc(x.crossing.from)} → ${esc(x.crossing.to)}` : '<span class="warn">unplaced</span>'}</td>`
      + `<td class="n dim">${x.reliants || "—"}</td>`
      + `<td class="${x.witnessed ? "dim" : "warn"}">${x.witnessed ? "yes" : "no"}</td></tr>`;
  };
  const collapsed = `<p class="collapsed">${clean} of ${total} gate(s) have a machine oracle that ran and passed (grade A or B) — collapsed to this count. The ${g.total} below are everything else: a breach, a human-judged or unverdicted C, a never-verified D, or an unreadable U.</p>`;
  if (!g.total) return collapsed;
  return collapsed + `<table class="grid"><thead><tr><th></th><th>invariant</th><th>chokepoint</th><th>oracle</th>
      <th>grade</th><th>verdict</th><th>crossing</th><th class="n">reliants</th><th>witnessed</th></tr></thead>
    <tbody>${g.shown.map(row).join("")}</tbody></table>` + tail(g, "gate(s)");
}

function crossingsTable(m: IndexModel["map"]): string {
  if (!m.atlas) {
    return `<p class="none">No atlas reading is recorded. Either this project declares no <code>atlas</code> config, or <code>coherence atlas</code> has never run here. <b>This table is empty because nothing was read, not because there are no crossings.</b></p>`;
  }
  const a = m.atlas;
  const flags = `<p class="dim">Recorded ${day(a.at)}${a.stale ? ' <span class="warn">— at another commit; this is the last known reading, not the present one</span>' : ""} · `
    + `tiers ${a.tiers.enshrined} enshrined / ${a.tiers.checked} totality-checked / ${a.tiers.convention} convention · `
    + `${a.drift} drift · ${a.dangling} dangling · ${a.overclaimed} over-claimed · ${a.hazards.length} inference hazard(s)</p>`;
  const row = (c: IndexCrossing) => {
    const sev: Sev = c.tier === 3 && c.security ? "alarm" : c.tier === 3 || !c.present ? "warn" : "quiet";
    return `<tr>${mark(sev)}<td class="mono">${esc(c.sym)}</td>`
      + `<td class="dim">${esc(c.from)} → ${esc(c.to)}</td>`
      + `<td class="g ${c.tier === 3 ? "warn" : ""}">tier-${c.tier}</td>`
      + `<td>${c.security ? "security" : '<span class="dim">—</span>'}</td>`
      + `<td class="n dim">${c.heat === null ? "—" : `${Math.round(c.heat * 100)}%`}</td>`
      + `<td class="${c.present ? "dim" : "alarm"}">${c.present ? "in source" : "DANGLING"}</td></tr>`;
  };
  const table = m.crossings.total
    ? `<table class="grid"><thead><tr><th></th><th>chokepoint</th><th>crossing</th><th>tier</th><th>kind</th><th class="n">heat</th><th>source</th></tr></thead>
        <tbody>${m.crossings.shown.map(row).join("")}</tbody></table>` + tail(m.crossings, "crossing(s)")
    : `<p class="none">The atlas record holds no crossings.</p>`;
  return flags + table;
}

/** THE TRUST READING. Four darknesses, named separately and never merged — a single "dark
 *  region" number would average four different problems with four different repairs into
 *  one figure that prescribes nothing. Unwitnessed leads: it is the only reading here that
 *  separates a green claim from an unfalsifiable one. */
function trustSection(ds: Darkness[]): string {
  const row = (d: Darkness) => {
    const share = d.total === null ? 1 : d.dark / d.total;
    const sev: Sev = d.total === null ? "alarm" : share >= 0.5 ? "warn" : "quiet";
    const worst = d.worst.total
      ? `<div class="worst">${d.worst.shown.map((w) => `<div>${esc(w)}</div>`).join("")}`
        + (d.worst.withheld ? `<div class="withheld">… ${d.worst.withheld} more of ${d.worst.total} not shown</div>` : "")
        + "</div>"
      : "";
    return `<tr>${mark(sev)}<td class="k">${esc(d.label)}<div class="dim sub">${esc(d.what)}</div>${worst}</td>`
      + `<td class="n">${over(d.dark, d.total, d.unit)}`
      + (d.unmeasurable ? `<div class="dim sub">${esc(d.unmeasurable)}</div>` : "")
      + `</td></tr>`;
  };
  return `<table class="grid trust"><thead><tr><th></th><th>darkness</th><th class="n">dark of examined</th></tr></thead>
    <tbody>${ds.map(row).join("")}</tbody></table>`;
}

// ── THE ORGAN ROSTER ──────────────────────────────────────────────────────────────────
//
// THE DIAGRAM SHOWS THE PLUMBING. `authed-user`, `storage`, `public-egress` are true and
// they teach nothing about what the system IS — they are the names of regions, not of
// things. The meaning lives one level down, in the components, and every project already
// names AND describes them: "Meter — a windowed counter, one bare Durable Object per scope
// name…", "handout — the doctor-facing Health Evidence Review…". That is the best
// human-written prose in the whole system and the Index was hiding it behind a drill-down.
//
// SO THE ROSTER IS ONE BLOCK, NOT N. Fourteen components are fourteen rows and ONE object;
// the ≤7-per-tab rule is about objects a reader must orient among, and a list is one of
// them. What it is NOT is a table of prose: an intent line squeezed into a cell wraps to
// four words per line and stops being readable, so the sentence gets its own grid row at
// its own measure — and everything that is NOT prose gets a real column.
//
// FIXED COLUMNS, NOT A FLEX ROW. Every row lays out on the same `ch`-based template, so the
// eye has a vertical line to follow: mark, name, directory, then five right-aligned metric
// columns in tabular figures. Nothing here is content-sized, because a content-sized column
// is a column that agrees with itself on one row and no other.
//
// THE ORDER IS THE TEACHING. Perimeter first — the components that own a trust crossing,
// most-held first — then the interior, which owns none. See index-model.ts's sort.

/** THE METRIC COLUMNS, in order, and the caption each one gets in the band head. The
 *  captions are why the values can be bare: `4/17` under `witnessed` says what
 *  `4/17 witnessed` said on every row, once. */
const NUM_COLS = ["files", "lines", "gates / grades", "witnessed", ""] as const;

/** One organ's numbers, one cell per column. The last is the FLAG cell: it is what the
 *  leading `!` on the row means, spelled out — a severity mark whose reason is not on the
 *  page is a mark the reader has to guess at. */
function organNums(c: IndexComponent): string[] {
  const grades = (["A", "B", "C", "D", "U"] as const)
    .filter((g) => c.grades[g] > 0).map((g) => `${c.grades[g]}${g}`).join(" ");
  const flags = [
    c.breaches ? `<span class="alarm">!! ${c.breaches} breach(es)</span>` : "",
    c.naked ? `<span class="warn">! ${c.naked} naked</span>` : "",
    c.invariants > c.anchored ? `<span class="warn">! ${c.invariants - c.anchored} unanchored</span>` : "",
  ].filter(Boolean);
  return [
    String(c.files),
    String(c.lines),
    `${c.gates}${grades ? ` <span class="dim">${grades}</span>` : ""}`,
    `${c.witnessed}<span class="dim">/${c.invariants}</span>`,
    flags.join(" "),
  ];
}

/**
 * THE ROSTER. `drawn` is the set of guards the diagram actually rendered — the crossings
 * list is capped, so a component can own a guard that is not on the picture. Such a chip is
 * plain text rather than a control: the timeline's `shown`/`held` rule, applied here. A page
 * that advertises a reveal it cannot perform is a dead click, and this page does not have
 * those.
 */
function roster(mp: IndexModel["map"], drawn: ReadonlySet<string>): string {
  const cs = mp.components;
  if (!cs.length) return `<p class="none">No component derived from the spec tree, so there are no organs to list.</p>`;

  const perimeter = cs.filter((c) => c.guards.length > 0);
  const interior = cs.filter((c) => c.guards.length === 0);

  const chip = (sym: string) => drawn.has(sym)
    ? `<span class="chip" data-sym="${esc(sym)}" tabindex="0" role="button">${esc(sym)}</span>`
    : `<span class="chip held" title="held back by the crossings cap — it is in the table below, not on the picture">${esc(sym)}</span>`;

  const row = (c: IndexComponent) => {
    const sev: Sev = c.breaches > 0 ? "alarm" : c.naked > 0 || c.invariants > c.anchored ? "warn" : "quiet";
    const name = c.guards.length
      ? `<span class="oname" data-org="${esc(c.dir)}" tabindex="0" role="button">${esc(c.label)}</span>`
      : `<span class="oname flat">${esc(c.label)}</span>`;
    return `<div class="org" data-dir="${esc(c.dir)}">`
      + `<span class="omk ${sev}">${MARK[sev]}</span>${name}`
      + `<span class="odir dim">${esc(c.dir)}</span>`
      + `<span class="onum">${organNums(c).map((n) => `<span>${n}</span>`).join("")}</span>`
      + (c.intent
        ? `<p class="ointent">${esc(c.intent)}</p>`
        : `<p class="ointent dim">This component's spec declares no intent line, so it has no sentence of its own here — the one thing on this page nothing else can supply.</p>`)
      + (c.guards.length ? `<div class="ochips">${c.guards.map(chip).join("")}</div>` : "")
      + `</div>`;
  };

  // THE HONEST SENTENCE ABOUT THE INTERIOR. It is a READING, not a finding: a crossing is
  // where trust changes hands, and a component that never takes that transfer has a
  // contract which is entirely internal. Calling that a gap would be inventing a defect.
  // With no atlas record at all the split is UNREAD and says so — 0 of N owning a crossing
  // and N of N never measured must not be the same sentence.
  const split = !mp.atlas
    ? `<p class="dim rsplit"><b>The perimeter is UNREAD.</b> No atlas reading is recorded here, so nothing can be said about which of these ${cs.length} components owns a trust crossing. They are listed in spec-tree order and NONE of them has been shown to be interior.</p>`
    : !mp.crossings.total
      ? `<p class="dim rsplit">The atlas ran and graded <b>no crossings</b>, so no component owns one. All ${cs.length} are interior by that reading — which is a statement about the atlas config as much as about the code.</p>`
      : `<p class="dim rsplit"><b>${interior.length}</b> of ${cs.length} own no graded crossing. Their contract is entirely INTERNAL — a crossing is where trust changes hands, and these never take that transfer. That is a reading of the shape, not a gap to close.</p>`;

  // THE BAND HEAD IS THE COLUMN HEAD. It rides the same template as the rows below it, so
  // the captions sit exactly over the figures they name and the numbers can be bare.
  const band = (label: string, note: string, xs: IndexComponent[]) => xs.length
    ? `<div class="band"><div class="bhead"><span class="omk"></span>`
      + `<span class="bname">${esc(label)} <span class="ct">${xs.length}</span></span>`
      + `<span class="dim bnote">${esc(note)}</span>`
      + `<span class="onum dim">${NUM_COLS.map((n) => `<span>${esc(n)}</span>`).join("")}</span></div>`
      + xs.map(row).join("") + `</div>`
    : "";

  // WHAT THE LEADING MARK MEANS, said once — and only when something on the page wears one.
  // A severity glyph whose reason is not on the page is a glyph the reader has to guess at;
  // a key for a glyph that is not on the page is the legend rule broken the other way.
  const marked = cs.some((c) => c.breaches > 0 || c.naked > 0 || c.invariants > c.anchored);
  const key = marked
    ? `<p class="rkey dim"><span class="warn">!</span> an invariant with no anchor, or a naked sink `
      + `<span class="dim">·</span> <span class="alarm">!!</span> a breached gate `
      + `<span class="dim">·</span> the rightmost column says which, per organ</p>`
    : "";

  return `<div class="roster">` + key
    + (mp.atlas && mp.crossings.total
      ? band("perimeter", "owns a trust crossing — most held first", perimeter)
        + band("interior", "owns none", interior)
      // WITH NO PERIMETER READING there is still a head, because the head is what CAPTIONS the
      // metric columns — and a column of bare figures with no caption is worse than no column.
      // It names no split: "spec-tree order" is the only order that was actually taken.
      : band("components", "in spec-tree order — the perimeter is unread", cs))
    + split + `</div>`;
}

/** THE MAP TAB. Six objects: the figure, one summary line, the ORGAN ROSTER, one drill
 *  strip — plus the masthead and the tab bar that every tab shares. */
function mapTab(m: IndexModel): string {
  const mp = m.map;
  const d = diagram(mp.crossings.shown, mp.components);
  const a = mp.atlas;

  // THE FIGURE RIDES ITS OWN LATTICE and scrolls in its own container when it must —
  // never scaled down, because a label that shrinks with the column stops being readable
  // exactly when the figure gets interesting.
  const figure = d
    ? `<div class="figure">${d.html}</div>`
    : `<p class="none"><b>NO CROSSING DIAGRAM.</b> ${a
      ? "The atlas record holds no crossings, so there are no regions to draw and none are invented."
      : "No atlas reading is recorded here — the shape is UNREAD, not absent."}${mp.zones.length ? "" : " No <code>## zones</code> are declared either."}</p>`;

  // ── THE STRIP. This used to be ONE SENTENCE — six unrelated readings concatenated with
  // middle dots, which could neither wrap nor align, and rewording it never helped because
  // prose was the wrong material. Now: label/value pairs on uniform column stops, tabular
  // figures, real plurals (`14 crossings`, never `14 crossing(s)`). Its first four cells
  // are still THE ACCOUNTING — promotions + reaches + supply = crossings drawn — so a
  // reader can check the split dropped nothing, which is the one number that catches the
  // failure mode of the whole idea. The tier histogram lives in the legend beside the line
  // treatments it explains; provenance is the masthead badge and is not repeated here; and
  // HEALTH IS SILENT AT ZERO — "no dangling, drift or over-claim" printed on every run is
  // wallpaper, invisible the one time it matters. Only the non-zero readings print, marked.
  const stats: string[] = [];
  const stat = (v: string, l: string, sev: Sev = "quiet") =>
    stats.push(`<div class="stat"><span class="sv${sev === "quiet" ? "" : ` ${sev}`}">${MARK[sev] ? `${MARK[sev]} ` : ""}${v}</span><span class="sl dim">${esc(l)}</span></div>`);
  if (d) {
    const r = d.reading;
    const promo = r.promotions.reduce((n, p) => n + p.guards.length, 0);
    const amb = r.supply.reduce((n, s) => n + s.guards.length, 0);
    stat(String(promo), promo === 1 ? "promotion" : "promotions");
    stat(String(r.reaches.length), r.reaches.length === 1 ? "reach" : "reaches");
    stat(String(amb), "supply");
    if (r.aside.length) stat(String(r.aside.length), "aside", "warn");
    stat(`${mp.crossings.shown.length}${mp.crossings.withheld ? ` <span class="dim">of ${mp.crossings.total}</span>` : ""}`,
      mp.crossings.shown.length === 1 ? "crossing drawn" : "crossings drawn");
    stat(String(r.regions.length), r.regions.length === 1 ? "region" : "regions");
    stat(String(r.spine.length), r.spine.length === 1 ? "spine stage" : "spine stages");
  } else {
    // WITH NO PICTURE THERE IS STILL A STRIP. A blank between two rules would be a reading
    // withheld, which is the shape this page refuses everywhere else.
    stat(String(mp.components.length), mp.components.length === 1 ? "component" : "components");
    stat(String(mp.gatesTotal), mp.gatesTotal === 1 ? "gate" : "gates");
    stat(String(mp.crossings.total), mp.crossings.total === 1 ? "crossing recorded" : "crossings recorded");
  }
  if (a) {
    if (a.dangling) stat(String(a.dangling), "dangling", "alarm");
    if (a.drift) stat(String(a.drift), "drift", "warn");
    if (a.overclaimed) stat(String(a.overclaimed), "over-claimed", "alarm");
    if (a.tier3Security.length) stat(String(a.tier3Security.length),
      a.tier3Security.length === 1 ? "unmanaged security crossing" : "unmanaged security crossings", "alarm");
    if (a.hazards.length) stat(String(a.hazards.length),
      a.hazards.length === 1 ? "inference hazard" : "inference hazards", "warn");
  }
  // `show all` HAS A PLACE — the strip's last stop — instead of hanging off a sentence. It
  // wakes to full tone only while a selection is active, the one time it has work to do.
  // The words-as-caption hint is gone with the sentence: the guard labels, chips and organ
  // names are visibly interactive instead (cursor, hover underline, focus ring).
  const clear = d
    ? `<div class="stat"><span class="clear" data-clear tabindex="0" role="button">show all</span></div>`
    : "";
  // WHERE THE SHAPE DOES NOT FIT THE READING, THE PAGE SAYS SO IN ONE LINE rather than
  // drawing something that implies an order nobody declared. A cyclic region graph, sources
  // that tie, a spine one stage long: each states itself here and the figure above stops
  // pretending. This is the whole reason the split is allowed to be an inference.
  const degen = d && d.reading.notes.length
    ? `<p class="degen warn">${d.reading.notes.map((n) => `<span>${esc(n)}</span>`).join("")}</p>` : "";
  const summary = `<div class="strip">${stats.join("")}${clear}</div>${degen}`;

  const strip = tog("comp", "components", String(mp.components.length))
    + tog("gates", "gates", mp.gates.total ? `${mp.gates.total} of ${mp.gatesTotal} listed` : String(mp.gatesTotal),
      mp.gates.shown.some((g) => g.verdict === "fail") ? "alarm" : "quiet")
    + tog("cross", "crossings", String(mp.crossings.total))
    + tog("trust", "trust", String(mp.darknesses.length),
      mp.darknesses.some((x) => x.total === null) ? "alarm" : mp.darknesses.some((x) => x.total !== null && x.dark / x.total >= 0.5) ? "warn" : "quiet")
    + (mp.zones.length ? tog("zones", "zones", String(mp.zones.length)) : "");

  const zones = mp.zones.length
    ? panel("zones", `<p class="dim">Declared order IS trust order.</p><p>${mp.zones.map((z) => `<b>${esc(z.name)}</b>${z.inside ? ` <span class="dim">inside ${esc(z.inside)}</span>` : ""}`).join(" <span class=\"dim\">·</span> ")}</p>`)
    : "";

  // WHO OWNS THE SELECTED CROSSING, one line per guard, revealed when that guard is picked.
  // This is the second direction of the join: the diagram alone can say where a crossing
  // runs and never which organ holds it.
  const drawn = new Set(mp.crossings.shown.map((c) => c.sym));
  const owners = mp.crossings.shown.map((c) => {
    const who = c.owner
      ? `<b>${esc(c.owner)}</b> <span class="dim">owns this crossing —</span> ${esc(c.from)} <span class="dim">&rarr;</span> ${esc(c.to)}<span class="dim">, tier-${c.tier}${c.security ? ", security" : ""}</span>`
      : `<span class="warn">! no organ owns this crossing.</span> <span class="dim">${esc(c.ownerWhy ?? "")}</span>`;
    return `<p class="own" data-own="${esc(c.sym)}"><span class="lbl">${esc(c.sym)}</span> ${who}</p>`;
  }).join("");

  return figure + summary + owners + roster(mp, drawn) + `<div class="drill">${strip}`
    + panel("comp", `<div class="scroll">${componentsTable(mp.components)}</div>`)
    + panel("gates", `<div class="scroll">${gatesTable(mp.gates, mp.gatesClean, mp.gatesTotal)}</div>`)
    + panel("cross", `<div class="scroll">${crossingsTable(mp)}</div>`)
    + panel("trust", `<div class="scroll">${trustSection(mp.darknesses)}</div>`)
    + zones + `</div>`;
}

// ── II. THE JOURNAL, AS A TIMELINE ────────────────────────────────────────────────────
//
// MARKS ON A TIME AXIS, one lane per kind, newest right — not a list of paragraphs. The
// sentences are LEVEL THREE: click a mark, read one record. `blocked` reads loudest (it is
// the top lane, the largest mark and the only alarm-coloured one) because an agent saying
// it could not do something is the highest-value line here and no gate will ever report it.
//
// EVERY standing record gets a mark, not just the ones whose text survived the cap — see
// `IndexMark`. A withheld mark is a hairline tick and is not clickable, so the timeline
// never advertises a reveal it cannot perform.

const LANES = [
  { key: "blocked", label: "blocked", noun: "impasse(s)", sev: "alarm" as Sev },
  { key: "open", label: "question", noun: "open question(s)", sev: "warn" as Sev },
  { key: "decision", label: "decision", noun: "decision(s)", sev: "quiet" as Sev },
] as const;

/** One record's sentences, revealed by its radio. This is the ONLY prose on the page and
 *  it is three clicks deep from the first paint: tab → mark → read. */
function detailOf(e: IndexEntry, lane: (typeof LANES)[number]): string {
  const line = (lbl: string, body: string) => `<div class="because"><span class="lbl">${lbl}</span> ${body}</div>`;
  return `<div class="d d-${slug(e.id)}">
    <div class="meta"><span class="${lane.sev}">${lane.label.toUpperCase()}</span>
      <span class="${e.news ? "fgb" : "dim"}">${e.news ? "NEW IN FRAME" : "standing"}</span>
      <span class="dim">${day(e.at)} · ${esc(e.agent)} · ${esc(e.commit ?? "no-commit")} · ${esc(e.id)}</span></div>
    <div class="chose">${esc(e.chose)}</div>
    ${e.because ? line("because", esc(e.because)) : ""}
    ${e.over.length ? line("over", e.over.map(esc).join(" <span class=\"dim\">·</span> ")) : ""}
    ${e.couldBe.length ? line("could be", e.couldBe.map(esc).join(" <span class=\"dim\">·</span> ")) : ""}
    ${e.discriminatedBy ? line("settled by", esc(e.discriminatedBy)) : ""}
  </div>`;
}

function journalTab(m: IndexModel): string {
  const j = m.journal, f = m.frame;
  const shown = new Map<string, { e: IndexEntry; lane: (typeof LANES)[number] }>();
  for (const l of LANES) {
    const c = l.key === "blocked" ? j.blocked : l.key === "open" ? j.open : j.decisions;
    for (const e of c.shown) shown.set(e.id, { e, lane: l });
  }

  const headline = `<p class="sum"><b>${j.totals.records}</b> record(s) <span class="dim">across ${j.totals.sessions} session(s)</span>`
    + `${j.totals.unreadable ? ` <span class="alarm">!! ${j.totals.unreadable} unreadable line(s) skipped</span>` : ""}`
    + ` <span class="dim">·</span> in this frame: <b class="${j.news.blocked ? "alarm" : ""}">${j.news.blocked}</b> impasse(s), <b class="${j.news.open ? "warn" : ""}">${j.news.open}</b> question(s), <b>${j.news.decisions}</b> decision(s)`
    + ` <span class="dim">·</span> <span class="dim">settled: ${j.settled.resolved} resolved, ${j.settled.dismissed} dismissed unanswered, ${j.settled.retracted} retracted</span></p>`;

  if (!j.marks.length) {
    return headline + `<p class="none">No journal here. Nothing recorded what the agents decided or where they got stuck — the most valuable half of this page has no source. <code>coherence decide</code> and <code>coherence blocked</code> are the verbs.</p>`;
  }

  const times = j.marks.map((x) => Date.parse(x.at)).filter((n) => Number.isFinite(n));
  const t0 = Math.min(...times), t1 = Math.max(...times);
  // Clamped inside the track: a mark at 0% or 100% is half outside its own lane, and the
  // frame rule at the very edge would be invisible exactly when it matters most.
  const at = (iso: string) => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t) || !(t1 > t0)) return 50;
    return 1.5 + ((t - t0) / (t1 - t0)) * 97;
  };

  const cutAt = f.at && Date.parse(f.at) >= t0 && Date.parse(f.at) <= t1 ? at(f.at) : null;
  const cut = cutAt === null ? "" : `<span class="cut" style="left:${cutAt.toFixed(2)}%"></span>`;

  const dot = (x: IndexMark, lane: (typeof LANES)[number]) => {
    const cls = `mkr ${lane.key}${x.news ? " new" : ""}${x.shown ? "" : " held"}`;
    const t = `${lane.label} · ${day(x.at)}${x.news ? " · NEW" : ""}${x.shown ? "" : " · text withheld by the cap"}`;
    const style = `left:${at(x.at).toFixed(2)}%`;
    return x.shown
      ? `<label for="e-${slug(x.id)}" class="${cls}" style="${style}" title="${esc(t)}"></label>`
      : `<span class="${cls}" style="${style}" title="${esc(t)}"></span>`;
  };

  const lanes = LANES.map((l) => {
    const mine = j.marks.filter((x) => x.lane === l.key);
    const total = l.key === "blocked" ? j.totals.blocked : l.key === "open" ? j.totals.open : j.totals.decisions;
    return `<div class="lrow"><span class="ln ${l.sev}">${MARK[l.sev]}${MARK[l.sev] ? " " : ""}${esc(l.label)}</span>`
      + `<span class="ct">${total}</span>`
      + `<span class="track">${cut}${mine.map((x) => dot(x, l)).join("")}</span></div>`;
  }).join("");

  // THE FRAME GETS ITS OWN ROW so its label never collides with an axis date — and it is
  // above the lanes because "everything right of this is news" is the sentence the reader
  // needs BEFORE they read the marks, not after.
  const frameRow = cutAt === null ? ""
    : `<div class="lrow fr"><span class="ln"></span><span class="ct"></span><span class="track">`
      + `<span class="tc${cutAt > 50 ? " right" : ""}" style="left:${cutAt.toFixed(2)}%">${f.kind === "first" ? "frame" : `since ${esc(f.ref ?? "")}`} \u2192</span>`
      + `</span></div>`;
  const axis = `<div class="lrow axis"><span class="ln"></span><span class="ct"></span>`
    + `<span class="track"><span class="t0">${day(new Date(t0).toISOString())}</span>`
    + `<span class="t1">${day(new Date(t1).toISOString())}</span></span></div>`;

  const radios = [...shown.keys()].map((id) => `<input type="radio" name="jsel" id="e-${slug(id)}" class="tog">`).join("");
  const details = [...shown.values()].map(({ e, lane }) => detailOf(e, lane)).join("");

  const withheld = j.marks.filter((x) => !x.shown).length;
  const hint = `<p class="hint dim">Click a mark to read one record <span class="dim">·</span> ${j.marks.length - withheld} of ${j.marks.length} carry their text here${withheld ? " (a hairline tick does not)" : ""}</p>`;

  const heldStrip = withheld
    ? `<div class="drill">${tog("rec", "what the cap held back", String(withheld))}`
      + panel("rec", LANES.map((l) => tail(l.key === "blocked" ? j.blocked : l.key === "open" ? j.open : j.decisions, l.noun)).join("")
        + `<p class="dim">Every withheld record is in <code>.coherence/decisions/</code> and is plotted above as a tick — nothing here is a gap in the timeline.</p>`)
      + `</div>`
    : "";

  return headline + `<div class="tl">${radios}<div class="lanes">${frameRow}${lanes}${axis}</div>`
    + `<div class="detail">${hint}${details}</div></div>` + heldStrip;
}

// ── III. THE TRAJECTORY ───────────────────────────────────────────────────────────────
//
// WHAT MOVED, IN THE MAP'S OWN VOCABULARY. Every boundary event names a chokepoint, and a
// chokepoint is the symbol that labels an arrow on the Map — so the region pair is looked
// up and printed beside it, and the two tabs describe the same objects with the same words.
// Never a commit list: code lines are context here, never the subject.

function trajectoryTab(m: IndexModel): string {
  const t = m.trajectory, s = t.structural;
  const bySym = new Map(m.map.crossings.shown.map((c) => [c.sym, c]));
  const where = (chokepoint: string) => {
    const c = bySym.get(chokepoint);
    return c ? `<span class="dim">${esc(c.from)} → ${esc(c.to)}</span>` : "";
  };

  const loc = t.loc ? ` <span class="dim">·</span> <span class="dim">+${t.loc.added} / −${t.loc.deleted} lines of code, which is context and not the subject</span>` : "";
  const headline = s
    ? `<p class="sum"><b class="${s.changes ? "" : "dim"}">${s.changes}</b> structural change(s) <span class="dim">·</span> <b class="${s.losses ? "alarm" : "dim"}">${s.losses}</b> loss(es) <span class="dim">— a removed invariant, anchor, parity anchor or component</span>${loc}</p>`
    : `<p class="sum"><span class="warn">! no structural diff</span> <span class="dim">— ${esc(t.structuralWhy ?? "no frame to compare against.")}</span></p>`;

  const rows: string[] = [];
  const ev = (glyph: string, sev: Sev, kind: string, body: string) =>
    rows.push(`<tr>${mark(sev)}<td class="ev">${glyph}</td><td class="evk">${esc(kind)}</td><td>${body}</td></tr>`);
  const block = <T,>(c: Capped<T>, glyph: string, sev: Sev, kind: string, one: (x: T) => string, noun: string) => {
    for (const x of c.shown) ev(glyph, sev, kind, one(x));
    if (c.withheld) rows.push(`<tr><td></td><td></td><td></td><td class="withheld">… ${c.withheld} more ${esc(noun)} not shown (${c.total} in total)</td></tr>`);
  };

  if (s) {
    block(s.componentsRemoved, "−", "alarm", "component", (x) => `<b>${esc(x)}</b>`, "component(s)");
    block(s.invRemoved, "−", "alarm", "invariant", (x) => `<b>${esc(x.inv)}</b> <span class="dim">${esc(x.comp)}</span>`, "invariant(s)");
    block(s.boundaryRemoved, "−", "alarm", "anchor", (x) => `<b class="mono">${esc(x.chokepoint)}</b> ${where(x.chokepoint)} <span class="dim">— ${esc(x.inv)}</span>`, "anchor(s)");
    block(s.boundaryRewired, "~", "warn", "rewired", (x) => `<b>${esc(x.inv)}</b><div class="dim sub">${esc(x.before)} → ${esc(x.after)}</div>`, "boundary(s)");
    block(s.componentsAdded, "+", "quiet", "component", (x) => `<b>${esc(x)}</b>`, "component(s)");
    block(s.invAdded, "+", "quiet", "invariant", (x) => `<b>${esc(x.inv)}</b> <span class="dim">${esc(x.comp)}</span>`, "invariant(s)");
    block(s.boundaryAdded, "+", "quiet", "anchor", (x) => `<b class="mono">${esc(x.chokepoint)}</b> ${where(x.chokepoint)} <span class="dim">— ${esc(x.inv)}</span>`, "anchor(s)");
  }

  const claims = s && s.claimDelta.length
    ? `<p class="dim">${s.claimDelta.reduce((n, c) => n + c.added + c.removed, 0)} non-boundary claim change(s): `
      + s.claimDelta.map((c) => `${esc(c.comp)} +${c.added}/−${c.removed}`).join(" · ") + "</p>"
    : "";

  const events = !s
    ? `<p class="none">Nothing can be said about movement: there is no earlier state to diff against.</p>`
    : rows.length
      ? `<div class="scroll"><table class="grid events"><tbody>${rows.join("")}</tbody></table></div>${claims}`
      : `<p class="none"><b>NOTHING MOVED.</b> No invariant, anchor, parity anchor or component was added, removed or rewired in this frame.</p>`;

  const note = s && !rows.length
    ? `<div class="drill">${tog("note", "what an empty ledger means", "1")}`
      + panel("note", `<p>Whatever the agents did, they did it without touching a single anchor — which is either careful work inside existing boundaries, or growth that acquired no enforcement. <code>coherence signal</code> is the verb that distinguishes them: it makes novelty's zero-anchor alarm part of the current patch's acceptance function.</p>`)
      + `</div>`
    : "";

  // THE BACKGROUND TREND — three sparklines in one strip, one object. Each null carries its
  // own reason: "nothing moved" and "nothing was read" are different facts.
  const trend: string[] = [];
  trend.push(t.mass
    ? `<div><span class="lbl-inline dim">net LOC per window</span> <span class="series">${esc(spark(t.mass.series))}</span> <span class="dim">${t.mass.series.length} windows, net ${t.mass.series.reduce((a, b) => a + b, 0)} · read ${day(t.mass.at)}${t.mass.stale ? ", at another commit" : ""}</span></div>`
    : `<div><span class="lbl-inline dim">net LOC per window</span> <span class="warn">! UNREAD</span> <span class="dim">— <code>coherence mass</code> has not run here, so the background growth trend is unread, not flat</span></div>`);
  if (t.drift) {
    trend.push(`<div><span class="lbl-inline dim">locality</span> <span class="series">${esc(spark(t.drift.locality))}</span> ${esc(t.drift.localityArrow)} <span class="dim">${(t.drift.locality[0] * 100).toFixed(0)}% → ${(t.drift.locality[t.drift.locality.length - 1] * 100).toFixed(0)}% · co-change staying inside one component</span></div>`);
    trend.push(`<div><span class="lbl-inline dim">spread</span> <span class="series">${esc(spark(t.drift.spread))}</span> ${esc(t.drift.spreadArrow)} <span class="dim">${t.drift.spread[0].toFixed(1)} → ${t.drift.spread[t.drift.spread.length - 1].toFixed(1)} · distinct components per commit</span></div>`);
    trend.push(`<div class="dim">${esc(t.drift.verdict)} — read ${day(t.drift.at)}${t.drift.stale ? ", at another commit; the last known direction, not the present one" : ""}.</div>`);
  } else {
    trend.push(`<div><span class="lbl-inline dim">locality / spread</span> <span class="warn">! UNREAD</span> <span class="dim">— <code>coherence drift</code> has not run here, so the architectural direction is unread, not flat</span></div>`);
  }

  return headline + events + note + `<div class="trend">${trend.join("")}</div>`;
}

// ── the page ──────────────────────────────────────────────────────────────────────────

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #fbfbfa; --fg: #17191d; --dim: #6a7078; --rule: rgba(0,0,0,.16);
  --warn: #8a5300; --alarm: #a3161d; --flat: rgba(0,0,0,.035);
  /* THE BASE UNIT, and the three type sizes. There is no fourth: weight and tone carry
     every other distinction, which is the only way monospace stays a lattice. */
  --u: 8px;
  --t1: 15px; --t2: 12.5px; --t3: 10.5px;
  /* THE NOTE COLUMN: the one x every band-head note and every legend caption starts in.
     Three bands and a legend, ONE alignment line. */
  --notex: calc(12*var(--u));
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0e0f11; --fg: #d6d9de; --dim: #868d97; --rule: rgba(255,255,255,.17);
          --warn: #cf9a37; --alarm: #e2726b; --flat: rgba(255,255,255,.05); }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  /* 15/24 — the line box IS three base units, so body prose sits on the same grid the
     figure is drawn on. */
  font: var(--t1)/1.6 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}
/* THE SIDE PADDING IS THREE UNITS, not two, because the roster's selected-row rule hangs
   into the margin — at two it landed under the overflow clip and a selection lost its mark. */
main { max-width: 1184px; margin: 0 auto; padding: calc(3*var(--u)) calc(3*var(--u)) calc(10*var(--u)); overflow-x: hidden; }
h1 { font-size: var(--t1); font-weight: 700; margin: 0; letter-spacing: .04em; }
p { margin: var(--u) 0; }
code { font: inherit; }
b { font-weight: 700; }
.dim { color: var(--dim); }
.warn { color: var(--warn); }
.alarm { color: var(--alarm); }
.fgb { color: var(--fg); font-weight: 700; }
.mono { font-variant-ligatures: none; }
.sub { font-size: var(--t2); font-weight: 400; }

/* ── the masthead: a title, a status MARK, and nothing else ─────────────────────────── */
.mast { border-bottom: 1px solid var(--fg); padding-bottom: var(--u); }
.top { display: flex; flex-wrap: wrap; gap: var(--u) calc(2*var(--u)); align-items: baseline; }
.badge { cursor: pointer; border: 1px solid var(--rule); padding: 0 var(--u); letter-spacing: .06em;
         font-size: var(--t3); user-select: none; }
.badge::after { content: " \\25B8"; }
#x-src:checked ~ .top .badge::after { content: " \\25BE"; }
.tabs { display: flex; flex-wrap: wrap; gap: var(--u) calc(3*var(--u)); align-items: baseline; margin-top: var(--u); }
.tabs a { color: var(--dim); text-decoration: none; letter-spacing: .18em; font-size: var(--t3);
          font-weight: 700; padding-bottom: 2px; border-bottom: 2px solid transparent; }
.tabs .stamp { margin-left: auto; color: var(--dim); font-size: var(--t2); letter-spacing: 0; }

/* ── tabs: :target, so a tab is a linkable URL and no script is needed ──────────────── */
/* A TAB IS A HASH, so the browser scrolls the section into view — and would scroll the
   masthead off the top, taking the title, the honesty mark and the tab bar with it. The
   margin is larger than the page's own offset, so the scroll clamps to zero and switching
   tabs never moves the reader. */
.view { display: none; padding-top: calc(3*var(--u)); scroll-margin-top: 100vh; }
.view:target { display: block; }
body:not(:has(.view:target)) #map { display: block; }
body:not(:has(.view:target)) .tabs a[href="#map"],
body:has(#map:target) .tabs a[href="#map"],
body:has(#journal:target) .tabs a[href="#journal"],
body:has(#trajectory:target) .tabs a[href="#trajectory"] { color: var(--fg); border-bottom-color: var(--fg); }

/* ── the disclosure: a hidden control, a one-line strip of terms, panels below ──────── */
.tog { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.drill { margin-top: calc(3*var(--u)); border-top: 1px solid var(--rule); padding-top: calc(2*var(--u));
         display: flex; flex-wrap: wrap; gap: var(--u) calc(3*var(--u)); align-items: baseline; }
.term { cursor: pointer; user-select: none; letter-spacing: .12em; text-transform: uppercase;
        font-size: var(--t3); font-weight: 700; }
.term::after { content: " \\25B8"; font-weight: 400; }
.term .ct { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--dim); }
.tog:focus-visible + .term { outline: 1px solid var(--fg); outline-offset: 2px; }
.panel { display: none; width: 100%; order: 99; margin-top: .4rem; }
#x-src:checked ~ .p-src, #x-comp:checked ~ .p-comp, #x-gates:checked ~ .p-gates,
#x-cross:checked ~ .p-cross, #x-trust:checked ~ .p-trust, #x-zones:checked ~ .p-zones,
#x-rec:checked ~ .p-rec, #x-note:checked ~ .p-note { display: block; }
#x-comp:checked ~ .term[for="x-comp"]::after, #x-gates:checked ~ .term[for="x-gates"]::after,
#x-cross:checked ~ .term[for="x-cross"]::after, #x-trust:checked ~ .term[for="x-trust"]::after,
#x-zones:checked ~ .term[for="x-zones"]::after, #x-rec:checked ~ .term[for="x-rec"]::after,
#x-note:checked ~ .term[for="x-note"]::after { content: " \\25BE"; }

/* ── the figure: ONE LATTICE ─────────────────────────────────────────────────────────────
   The boxes and labels are HTML items on a fixed-track CSS grid; the SVG draws CONNECTORS
   ONLY, absolutely positioned over the same tracks. Both take their geometry from the one
   track list the render emits, so there is no second coordinate system to drift — and the
   browser, not this file, measures the text and sets the baselines. */
.figure { margin: calc(2*var(--u)) 0 calc(4*var(--u)); overflow-x: auto; }
.fgrid { position: relative; display: grid; }
.fgrid .wires { position: absolute; left: 0; top: 0; }
/* Cells are positioned so they paint ABOVE the wire overlay; the supply tint is the one
   deliberate exception — static, so it stays UNDER the wires. */
.fgrid > div { position: relative; min-width: 0; }
.fgrid > .flat { position: static; background: var(--flat); }
.bh { display: grid; grid-template-columns: var(--notex) 1fr; align-items: baseline;
      border-top: 1px solid var(--fg); padding-top: calc(var(--u)/2); white-space: nowrap; }
.bn { font-size: var(--t3); font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
.lg { font-size: var(--t3); }
/* Box text and reach labels share ONE stop per column: border + padding = the base unit,
   whatever the border's weight. */
.fbox { border: 1px solid var(--dim); color: var(--dim); display: flex; align-items: center;
        padding: 0 calc(var(--u) - 1px); font-size: var(--t3); font-weight: 700;
        white-space: nowrap; letter-spacing: .04em; }
.fbox.stage { border: 1.5px solid var(--fg); color: var(--fg); padding: 0 calc(var(--u) - 1.5px); }
/* THE GUARD LABELS. The tone IS the class: a promotion is the spine's own line and prints
   at full strength; a reach, a supply and an aside are subordinate and print dim. A broken
   chokepoint overrides both. All of it survives greyscale, which hue would not. */
.gl { font-size: var(--t3); line-height: calc(2*var(--u)); white-space: nowrap; cursor: pointer; }
.gl .lbl { color: var(--dim); background: var(--bg); padding: 1px 6px 1px 4px; margin-left: -4px; }
.gl.pr .lbl { color: var(--fg); }
.gl.bad .lbl { color: var(--alarm); }
.gl.t1 .lbl { font-weight: 700; }
.gl.gut { padding-left: calc(2*var(--u)); }
.gl.l0 { align-self: start; padding-top: 2px; }
/* Supply and aside rows are LINES OF TEXT, centred by their line box — not flex, so the
   label and its note stay inline-level and add no layout edges of their own. No wire ever
   crosses these rows, so their labels carry no knockout: a background here would punch a
   page-coloured pill through the supply tint. */
.gl.srow { line-height: calc(4*var(--u)); }
.gl.srow .lbl { background: none; }
.gl.srow .lg { margin-left: calc(2*var(--u)); }
.sec::before { content: ""; display: inline-block; width: 7px; height: 7px;
               background: currentColor; transform: rotate(45deg); margin: 0 6px 1px 2px; }
/* The diamond HANGS — the label pulls left by exactly the mark's footprint, so a guarded
   NAME sits on the same column stop as an unguarded one, and the mark reads as a bullet
   in the gutter instead of pushing its name off the lattice. */
.gl .lbl.sec { margin-left: -19px; }
/* ── the legend: the same two columns as a band head, one sample edge, one caption edge */
.leg { margin-top: calc(3*var(--u)); display: grid; row-gap: var(--u); }
.li { display: grid; grid-template-columns: var(--notex) 1fr; align-items: center; }
.li .ls { display: block; }
.li svg { display: block; }
.flat-s { display: block; width: 48px; height: 16px; background: var(--flat);
          border: 1px solid var(--rule); }
/* A DEGENERACY IS A SENTENCE, not a missing picture: a cyclic region graph or a spine one
   stage long says so here, in the reader's way, immediately under the figure it explains. */
.degen { margin: var(--u) 0 0; font-size: var(--t2); max-width: 88ch; }
.degen span { display: block; border-left: 3px solid var(--warn); padding-left: calc(2*var(--u));
              margin-bottom: var(--u); }
.sum { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
       padding: var(--u) 0; margin: 0; font-size: var(--t2); }
/* ── the strip: the summary as READINGS ON COLUMN STOPS, never a sentence ──────────────
   Uniform tracks, so every value and every caption starts on the same stops row after row;
   health cells appear ONLY non-zero, in their own severity. */
.strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(17*var(--u)), 1fr));
         gap: calc(2*var(--u)) calc(3*var(--u)); align-items: baseline;
         border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
         padding: calc(2*var(--u)) 0; margin: 0 0 calc(3*var(--u)); }
.stat { display: grid; row-gap: 2px; justify-items: start; }
.sv { font-size: var(--t1); font-weight: 700; font-variant-numeric: tabular-nums; }
.sv.warn { color: var(--warn); }
.sv.alarm { color: var(--alarm); }
.sl { font-size: var(--t3); letter-spacing: .08em; text-transform: uppercase; }
.clear { cursor: pointer; user-select: none; border: 1px solid var(--rule); color: var(--dim);
         padding: 2px var(--u); font-size: var(--t3); letter-spacing: .08em;
         text-transform: uppercase; }
/* The control wakes when there is a selection to clear — the one time it has work to do. */
.figure.sel ~ .strip .clear { color: var(--fg); border-color: var(--fg); }

/* ── SELECTION: real listeners on the real elements ─────────────────────────────────────
   THE HIGHLIGHT IS NOT COLOUR: the unselected crossings fade (a TONE change, which is what
   greyscale preserves) and the selected one gains a drawn RING around its name. Either one
   alone would survive a black-and-white printer; the pair is unmistakable. And the controls
   LOOK like controls — cursor, hover underline, focus ring — which is what let the "click a
   guard" caption be deleted rather than reworded. */
.chip, .oname[data-org], .clear { cursor: pointer; }
.figure.sel .cx, .figure.sel .gl, .figure.sel .bh { opacity: .22; }
.figure.sel .cx.on, .figure.sel .gl.on { opacity: 1; }
.gl.on .lbl { outline: 1.5px solid var(--fg); outline-offset: 2px; }
.gl:hover .lbl { text-decoration: underline; text-underline-offset: 3px; }
.oname[data-org]:hover { text-decoration-color: var(--fg); }
.chip:not(.held):hover { border-color: var(--fg); }
.gl:focus-visible { outline: 1px solid var(--fg); }
.chip:focus-visible, .oname:focus-visible, .clear:focus-visible { outline: 1px solid var(--fg); outline-offset: 2px; }
.own { display: none; border-left: 3px solid var(--fg); padding-left: calc(2*var(--u));
       margin: var(--u) 0 0; font-size: var(--t2); }
.own.on { display: block; }
.own .lbl { display: inline-block; min-width: 18ch; font-weight: 700; }

/* ── the ORGAN ROSTER: fixed columns, and the prose at its own measure ──────────────────
   ONE TEMPLATE for the band head and every row under it, in ch units so the columns are
   the same width on every row rather than the width of whatever landed in them. The
   sentence is the exception and it is deliberate: an intent line in a 20ch cell wraps to
   four words and stops being prose, so it takes its own grid row at its own measure. */
.roster { margin-top: calc(4*var(--u)); }
.band { margin-bottom: calc(4*var(--u)); }
.bhead, .org {
  display: grid;
  grid-template-columns: 3ch minmax(14ch, max-content) 1fr max-content;
  grid-template-areas: "mk name dir nums" ". intent intent intent" ". chips chips chips";
  column-gap: calc(2*var(--u)); align-items: baseline;
}
/* The band head carries the ROWS' font size, never its own: a ch resolves against the
   element's own size, so a smaller head would silently shift every column it captions. */
.bhead { font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
         border-bottom: 1px solid var(--fg); padding-bottom: var(--u); }
.bhead .bname { grid-area: name; white-space: nowrap; font-size: var(--t3); }
.bhead .bnote { grid-area: dir; font-weight: 400; letter-spacing: .04em; text-transform: none;
                font-size: var(--t3); }
/* No tracking on the captions: letter-spacing adds a trailing sliver AFTER the last glyph,
   which pushes a right-aligned caption off the column of figures it is naming. */
.bhead .onum { color: var(--dim); letter-spacing: 0; }
.bhead .ct { font-weight: 400; color: var(--dim); }
.org { border-left: 3px solid transparent; padding: calc(3*var(--u)) 0 calc(3*var(--u)) calc(2*var(--u));
       margin-left: calc(-2*var(--u) - 3px); border-bottom: 1px solid var(--rule); row-gap: var(--u); }
.org:last-of-type { border-bottom: 0; }
.org.on { border-left-color: var(--fg); }
.omk { grid-area: mk; font-weight: 700; }
.omk.warn { color: var(--warn); }
.omk.alarm { color: var(--alarm); }
.oname { grid-area: name; font-weight: 700; }
.oname[data-org] { text-decoration: underline; text-underline-offset: 3px;
                   text-decoration-color: var(--rule); }
.odir { grid-area: dir; font-size: var(--t2); }
/* THE METRICS: their own fixed sub-grid, right-aligned, in tabular figures — so a column of
   numbers is a column, and the band head's captions sit over the figures they name. */
.onum { grid-area: nums; display: grid; font-size: var(--t2);
        grid-template-columns: 6ch 8ch 16ch 12ch 15ch; column-gap: calc(2*var(--u));
        text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
/* THE POINT OF THE WHOLE BLOCK. A readable measure, not a column: ~78 characters is where
   monospace prose stops being a shape and starts being a sentence. */
.ointent { grid-area: intent; max-width: 78ch; margin: 0; }
.ochips { grid-area: chips; display: flex; flex-wrap: wrap; gap: var(--u); }
.chip { border: 1px solid var(--rule); padding: 0 var(--u); font-size: var(--t2);
        user-select: none; }
.chip.held { cursor: default; color: var(--dim); border-style: dashed; }
.chip.on, .org.on .chip { border-color: var(--fg); font-weight: 700; }
.rkey { font-size: var(--t2); margin: 0 0 var(--u); }
.rsplit { border-top: 1px solid var(--rule); padding-top: calc(2*var(--u)); max-width: 82ch;
          font-size: var(--t2); }

/* ── the timeline ───────────────────────────────────────────────────────────────────── */
.tl { margin-top: calc(3*var(--u)); }
.lanes { border-left: 1px solid var(--rule); border-right: 1px solid var(--rule); }
.lrow { display: grid; grid-template-columns: 13ch 5ch 1fr; align-items: center;
        border-bottom: 1px solid var(--rule); }
.lrow:last-child { border-bottom: 0; }
.lrow .ln { font-size: var(--t3); letter-spacing: .12em; text-transform: uppercase; font-weight: 700;
            padding-left: var(--u); white-space: nowrap; }
.lrow.fr { border-bottom: 0; }
.fr .track { height: calc(2*var(--u)); }
.fr .tc { position: absolute; top: 0; font-size: var(--t3); color: var(--fg); white-space: nowrap; }
.fr .tc.right { transform: translateX(-100%); }
.lrow .ct { color: var(--dim); font-size: var(--t2); text-align: right; padding-right: var(--u); }
.track { position: relative; height: calc(4*var(--u)); }
.axis .track { height: calc(3*var(--u)); }
.axis .t0, .axis .t1 { position: absolute; top: 1px; color: var(--dim); font-size: var(--t3); white-space: nowrap; }
.axis .t0 { left: 0; }
.axis .t1 { right: 0; }
.cut { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px dashed var(--fg); }
.mkr { position: absolute; top: 50%; transform: translate(-50%, -50%); background: currentColor; }
.mkr.blocked { color: var(--alarm); width: 9px; height: 9px; }
.mkr.open { color: var(--warn); width: 7px; height: 7px; }
.mkr.decision { color: var(--dim); width: 6px; height: 6px; }
label.mkr { cursor: pointer; }
.mkr.new { outline: 1px solid var(--fg); outline-offset: 2px; }
.mkr.held { background: none; border-left: 1px solid currentColor; width: 0; height: 11px; outline: 0; }
.detail { margin-top: calc(2*var(--u)); border-top: 1px solid var(--rule); padding-top: calc(2*var(--u));
          max-width: 92ch; min-height: calc(14*var(--u)); }
.detail .d { display: none; }
.tl:has(.tog:checked) .hint { display: none; }
.detail .meta { font-size: var(--t2); letter-spacing: .04em; margin-bottom: var(--u); }
.detail .meta > span { margin-right: calc(2*var(--u)); }
.detail .meta > span:first-child { font-weight: 700; }
.detail .chose { margin: var(--u) 0; }
.detail .because { color: var(--dim); margin: var(--u) 0; }
.detail .lbl { display: inline-block; min-width: 11ch; color: var(--dim); font-size: var(--t3);
               letter-spacing: .12em; text-transform: uppercase; }
.hint { font-size: var(--t2); }

/* ── tables (drill-down only; nothing tabular is above the fold) ─────────────────────── */
table.grid { width: 100%; border-collapse: collapse; margin: var(--u) 0; font-size: var(--t2); }
table.grid th { text-align: left; font-weight: 400; color: var(--dim); font-size: var(--t3);
                letter-spacing: .08em; text-transform: uppercase;
                padding: 0 calc(2*var(--u)) var(--u) 0; border-bottom: 1px solid var(--rule); white-space: nowrap; }
table.grid td { padding: var(--u) calc(2*var(--u)) var(--u) 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
table.grid tr:last-child td { border-bottom: 0; }
table.grid td.n, table.grid th.n { text-align: right; padding-right: calc(2*var(--u)); white-space: nowrap; }
table.grid td.k { font-weight: 700; }
table.grid td.g { letter-spacing: .06em; white-space: nowrap; }
/* THE MARK COLUMN: the severity encoding that survives greyscale and a black-and-white
   printer. Colour in these tables only ever REINFORCES what this column already says. */
td.mk { width: 3ch; padding-right: var(--u); font-weight: 700; text-align: left; }
td.mk.warn { color: var(--warn); }
td.mk.alarm { color: var(--alarm); }
td.ev { width: 2ch; font-weight: 700; }
td.evk { width: 11ch; color: var(--dim); font-size: var(--t3); letter-spacing: .08em; text-transform: uppercase; }
.scroll { overflow-x: auto; }
.worst { margin: var(--u) 0 0; color: var(--dim); }
.withheld { color: var(--dim); margin: var(--u) 0; }
.collapsed { color: var(--dim); margin: var(--u) 0; font-size: var(--t2); }
.none { color: var(--dim); border-left: 1px solid var(--rule); padding-left: calc(2*var(--u)); margin: var(--u) 0; }
.series { letter-spacing: .1em; }
.lbl-inline { display: inline-block; min-width: 21ch; letter-spacing: .12em; text-transform: uppercase; font-size: var(--t3); }
.trend { margin-top: calc(4*var(--u)); border-top: 1px solid var(--rule); padding-top: calc(2*var(--u));
         font-size: var(--t2); }
.trend > div { margin: var(--u) 0; }
footer { margin-top: calc(7*var(--u)); padding-top: calc(2*var(--u)); border-top: 1px solid var(--rule);
         color: var(--dim); font-size: var(--t2); max-width: 92ch; }

/* ── PRINT IS THE WHOLE DOCUMENT. Hiding two thirds of the page on paper would make the
      greyscale test a test of one tab. Everything opens; nothing is lost to a fold. ──── */
@media print {
  :root { --bg: #fff; --fg: #000; --dim: #444; --rule: rgba(0,0,0,.35); --warn: #000; --alarm: #000;
          --flat: rgba(0,0,0,.06); --t1: 11px; --t2: 10px; --t3: 9px; }
  main { max-width: none; }
  .view, .panel, .detail .d, .own { display: block !important; }
  .view { page-break-before: always; }
  .tabs, .term, .badge, .clear { display: none; }
  /* Paper cannot scroll, so the lattice ZOOMS to the page — html and wires together, one
     scale, because they are one coordinate system. --pz is emitted per figure. */
  .figure { overflow: visible; }
  .fgrid { zoom: var(--pz, 1); }
  .hint { display: none; }
  /* A SELECTION IS SCREEN STATE, and paper has none: every crossing comes back to full
     weight and every owner line prints, so the paper copy is the whole document however
     the reader left the screen. */
  .figure.sel .cx, .figure.sel .gl, .figure.sel .bh { opacity: 1 !important; }
  .gl.on .lbl { outline: none !important; }
  .org, .band { break-inside: avoid; }
}
`;

/**
 * THE SELECTION — the page's ONE piece of script, and the reason it is allowed.
 *
 * The scriptless spelling of this was a radio group spanning organs and guards, one
 * generated CSS rule per pair, and a `<label>` hotspot per guard absolutely positioned over
 * the SVG at a rect the layout had computed. It worked; what it cost was the LAYOUT, because
 * every interactive thing had to stay where a pixel rectangle said it was — the picture
 * could not scale, could not reflow, and the guard names had to be placed where the hit
 * areas were rather than where the grid wanted them.
 *
 * This is the whole replacement: one listener, one selected key, two directions of the same
 * join. It is GENERIC — it names no symbol, so unlike the generated rules it cannot fall out
 * of step with the data. Nothing here reads the network, the clock or storage; with script
 * off the page loses the highlight and keeps every mark, every sentence and every number.
 */
const SCRIPT = `
(function () {
  var map = document.getElementById("map");
  if (!map) return;
  var fig = map.querySelector(".figure");
  var sel = null;

  function apply() {
    if (fig) fig.classList.toggle("sel", sel !== null);
    var sym = sel && sel.kind === "sym" ? sel.key : null;
    var dir = sel && sel.kind === "org" ? sel.key : null;
    map.querySelectorAll("[data-sym]").forEach(function (el) {
      var own = el.getAttribute("data-owner");
      el.classList.toggle("on", sel === null ? false
        : sym !== null ? el.getAttribute("data-sym") === sym : own !== null && own === dir);
    });
    // A GUARD SELECTS ITS ORGAN'S ROW TOO — that is the second direction of the join, and
    // the roster row is the only place the organ's sentence lives. The owner is read off
    // the guard's LABEL: the wires carry data-sym alone, and only the label knows its organ.
    var ownerDir = dir;
    if (sym !== null) {
      var g = map.querySelector('[data-owner][data-sym="' + CSS.escape(sym) + '"]');
      ownerDir = g ? g.getAttribute("data-owner") : null;
    }
    map.querySelectorAll(".org").forEach(function (el) {
      el.classList.toggle("on", ownerDir !== null && el.getAttribute("data-dir") === ownerDir);
    });
    map.querySelectorAll("[data-org]").forEach(function (el) {
      el.classList.toggle("on", ownerDir !== null && el.getAttribute("data-org") === ownerDir);
    });
    map.querySelectorAll(".own").forEach(function (el) {
      el.classList.toggle("on", sym !== null && el.getAttribute("data-own") === sym);
    });
  }

  function pick(el) {
    if (el.hasAttribute("data-clear")) { sel = null; apply(); return; }
    var kind = el.hasAttribute("data-sym") ? "sym" : "org";
    var key = el.getAttribute(kind === "sym" ? "data-sym" : "data-org");
    // Clicking the selected thing again clears it: the way out must be the way in.
    sel = sel && sel.kind === kind && sel.key === key ? null : { kind: kind, key: key };
    apply();
  }

  function hit(t) {
    return t && t.closest ? t.closest("[data-sym],[data-org],[data-clear]") : null;
  }
  map.addEventListener("click", function (e) {
    var el = hit(e.target);
    if (el) pick(el);
  });
  map.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var el = hit(e.target);
    if (el) { e.preventDefault(); pick(el); }
  });
})();
`;

/**
 * THE SAME MODEL AT THE TERMINAL — what `coherence index` prints after writing the page.
 *
 * It lives beside the HTML render because it is the SECOND rendering of ONE model, and
 * keeping them apart is how the two start disagreeing about a number. It is deliberately
 * a pointer, not a summary of the report: the page is the artifact, and a terminal digest
 * complete enough to substitute for it would be a third view nobody asked for.
 *
 * NO HEALTH GLYPH IS REACHABLE FROM HERE, ever — not on a rich project and not on an empty
 * one. The Index states readings and grades nothing, so a ✓ would be an assertion this
 * command has no standing to make (test/vacuity.test.ts enumerates every command against a
 * project where nothing can honestly be pronounced healthy).
 */
export function formatIndexSummary(m: IndexModel, htmlPath: string): string[] {
  const out: string[] = [];
  const f = m.frame;
  const ref = f.commit && f.commit !== f.ref ? `${f.ref} (${f.commit})` : `${f.ref}`;
  out.push(`index: ${m.project} — frame ${f.kind === "first" ? "FIRST LOOK (nothing to compare against)" : `since ${ref}, ${f.commits ?? "?"} commit(s)`}`);
  if (m.empty) {
    out.push("  NOTHING TO SHOW — no gates, no journal, no history. That is an absence of evidence,");
    out.push("  not a clean bill of health, and the page says so instead of rendering empty tables.");
  } else {
    const mp = m.map;
    out.push(`  map         ${mp.components.length} component(s) · ${mp.gatesTotal} gate(s), ${mp.gatesClean} machine-checked and passing (collapsed) · ${mp.crossings.total} crossing(s)`);
    const dark = mp.darknesses.map((d) => `${d.label} ${d.total === null ? "UNMEASURED" : `${d.dark}/${d.total}`}`).join(" · ");
    out.push(`  trust       ${dark}`);
    out.push(`  journal     ${m.journal.news.blocked} new impasse(s) · ${m.journal.news.open} new question(s) · ${m.journal.news.decisions} new decision(s)  [${m.journal.totals.records} record(s)]`);
    out.push(m.trajectory.structural
      ? `  trajectory  ${m.trajectory.structural.changes} structural change(s), ${m.trajectory.structural.losses} loss(es) to the invariant/boundary set`
      : `  trajectory  no structural diff — ${m.trajectory.structuralWhy ?? "no frame"}`);
  }
  // UNREAD and STALE both belong at the terminal, and STALE is not a lesser case of it:
  // it is the state that silently reshapes the page above (a record filed at another
  // commit degrades every verdict it carries), so a reader who only ever sees this digest
  // must still be told which readings are from the present and which are from memory.
  for (const s of m.sources.filter((x) => !x.ok)) out.push(`  UNREAD      ${s.name} — ${s.detail.split(/(?<=\.)\s/)[0]}`);
  for (const s of m.sources.filter((x) => x.ok && x.stale)) {
    out.push(`  STALE       ${s.name} — recorded ${s.at ? s.at.slice(0, 10) : "?"} at ${s.commit ?? "?"}, not at HEAD. Last known truth, honestly dated.`);
  }
  out.push(`  → ${htmlPath}`);
  return out;
}

/** THE PAGE. One self-contained document, a pure function of the model: no clock, no
 *  disk, no network, no script, and nothing on it that `index.json` does not already hold. */
export function renderIndex(m: IndexModel): string {
  const f = m.frame;

  // THE HONESTY LAYER AS A MARK. It used to be three sentences at the top of the page,
  // before the reader saw a single structure. It is now `!!` and a count; the sentences are
  // one click away and are still the first thing the terminal digest prints.
  const unread = m.sources.filter((s) => !s.ok).length;
  const stale = m.sources.filter((s) => s.ok && s.stale).length;
  const badgeSev: Sev = unread ? "alarm" : stale ? "warn" : "quiet";
  const badgeText = unread || stale
    ? [unread && `${MARK.alarm} ${unread} unread`, stale && `${MARK.warn} ${stale} stale`].filter(Boolean).join(" · ")
    : `${m.sources.length} sources read`;

  const frameChip = f.kind === "first"
    ? `<span class="warn">first look</span> <span class="dim">— nothing to frame against</span>`
    : `<span class="dim">since</span> <b>${esc(f.ref ?? "")}</b> <span class="dim">· ${f.commits ?? "?"} commit(s)</span>`;

  const empty = m.empty
    ? `<p class="none"><b>There is nothing to show.</b> No component spec derived, no journal entries, and no git history to read. This is not a clean bill of health — it is an absence of evidence. <code>coherence verify</code> prints the adoption ladder for this state.</p>`
    : "";

  // ONE CSS RULE PER REVEALABLE RECORD. Generated from the same capped lists the page
  // renders, so a rule can never name an entry the page does not carry.
  const ids = new Set<string>();
  for (const c of [m.journal.blocked, m.journal.open, m.journal.decisions]) for (const e of c.shown) ids.add(slug(e.id));
  const dyn = [...ids].map((id) => `#e-${id}:checked ~ .detail .d-${id}{display:block}`).join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.project)} — index</title>
<style>${STYLE}${dyn ? `\n${dyn}\n` : ""}</style></head>
<body><main>

<header class="mast">
  <input type="checkbox" id="x-src" class="tog">
  <div class="top">
    <h1>${esc(m.project)}</h1>
    <label for="x-src" class="badge ${badgeSev}">${esc(badgeText)}</label>
  </div>
  <div class="tabs">
    <a href="#map">MAP</a><a href="#journal">JOURNAL</a><a href="#trajectory">TRAJECTORY</a>
    <span class="stamp">${frameChip} <span class="dim">· ${esc(m.head.commit ?? "no commit")}${m.head.dirty ? " +dirty" : ""} · ${esc(m.generatedAt)}</span></span>
  </div>
  <div class="panel p-src">
    <p class="dim">${esc(m.intent)}</p>
    <p class="dim"><b>frame</b> — ${esc(f.why)}</p>
    <div class="scroll">${sourcesTable(m.sources)}</div>
  </div>
</header>

${empty}

<section class="view" id="map">${mapTab(m)}</section>
<section class="view" id="journal">${journalTab(m)}</section>
<section class="view" id="trajectory">${trajectoryTab(m)}</section>

<footer>
  Generated by <code>coherence index</code> at <span id="stamp">${esc(m.generatedAt)}</span> from the model beside it (<code>index.json</code>).
  Every figure here is a reading something else already took — this page derives nothing of its own.
  Do not edit by hand; re-run the harness.
</footer>
</main><script>${SCRIPT}</script></body></html>
`;
}
