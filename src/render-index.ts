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

/** THE BASE UNIT of the whole page. Every x, y, width, height, gutter and row in this
 *  figure is a multiple of it; so is the page's vertical rhythm. Text baselines sit at the
 *  half unit, which is where a 10.5px face centres in a 24px row. */
const U = 8;
/** ONE type size inside the figure — the page's `--t3`. Weight and tone carry every other
 *  distinction, which is what keeps the whole document to three sizes. */
const FS = 10.5;
/** Monospace advance as a fraction of font-size. Slightly over the 0.6 of the faces in the
 *  stack, so a reserved column is never narrower than the text in it. */
const CH = 0.61;
const ROW = 3 * U, BOX_H = 4 * U, HEAD_H = 3 * U;
/** Widths snap to TWO units, so a box's centre line — where its bus drops — is itself on the
 *  grid rather than at a half unit. */
const snap2 = (n: number) => Math.ceil(n / (2 * U)) * 2 * U;
/** The one column every band head's note starts in — three bands, ONE alignment line. */
const NOTE_X = 12 * U;

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
 *  One shape, used on a crossing and once again in the legend. */
const diamond = (x: number, y: number, fill: string) =>
  `<path d="M${x},${y} l4.5,-4.5 l4.5,4.5 l-4.5,4.5 Z" fill="${fill}"/>`;

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

/** A band's chrome: a rule across the figure, a name, and a count. Three redundant markers
 *  for one division, because the tint is the one that does not survive a bad printer. */
function bandHead(y: number, w: number, label: string, note: string): string {
  return `<path d="M0,${y} H${w}" stroke="var(--fg)" stroke-width="1" fill="none"/>`
    + `<g class="bandh"><text x="${U}" y="${y + 2 * U}" class="bn">${esc(label)}</text>`
    + `<text x="${NOTE_X}" y="${y + 2 * U}" class="lg dim">${esc(note)}</text></g>`;
}

/**
 * THE DIAGRAM. Returns null when there is no crossing data at all — the caller then says so
 * in one line rather than drawing an empty frame, because a picture of nothing is the
 * green-by-absence this page exists to refuse.
 */
function diagram(cs: readonly IndexCrossing[], comps: readonly IndexComponent[]):
  { svg: string; w: number; h: number; reading: MapReading } | null {
  if (!cs.length) return null;
  const r = readMap(cs);

  // ── THE LATTICE. Nothing here is tuned to a project: a box is as wide as the longest
  // region name, a gutter as wide as the longest guard that runs through one.
  const nameOf = (c: IndexCrossing) => c.present ? c.sym : `${c.sym} DANGLING`;
  // A crossing carries its organ's DIRECTORY, not its label — that is the id the roster keys
  // its own rows by, and two components may share a label while no two share a directory.
  const dirByLabel = new Map<string, string>();
  for (const c of comps) if (!dirByLabel.has(c.label)) dirByLabel.set(c.label, c.dir);
  const boxed = [...r.spine, ...r.sinks, ...r.supply.map((s) => s.source)];
  const BOX_W = snap2(Math.max(...boxed.map((n) => textW(n))) + 2 * U);
  const promoW = r.promotions.flatMap((p) => p.guards).map((c) => textW(nameOf(c)));
  // THE GUTTER holds the longest guard that runs through one, PLUS the space its security
  // diamond takes — sized without it, a marked name overhangs into the next stage's column.
  const GUT = Math.max(6 * U, snap2(Math.max(0, ...promoW) + 6 * U));
  const PITCH = BOX_W + GUT;
  const stageL = (i: number) => i * PITCH;                       // a stage box's left edge
  const stageX = (i: number) => i * PITCH + BOX_W / 2;           // …and its centre, the bus
  const idxOf = new Map(r.spine.map((s, i) => [s, i]));

  // SINKS SIT UNDER THE STAGE THAT GRABS THEM, pushed right only far enough not to overlap.
  // The reach's label and its drop share one x — the sink box's own text edge — so the
  // guards landing on a resource read as one left-aligned column above it.
  const sinkX = new Map<string, number>();
  let cursor = -Infinity;
  for (const s of r.sinks) {
    const want = stageX(Math.max(...r.reaches.filter((x) => x.sink === s).map((x) => idxOf.get(x.stage)!)));
    cursor = Math.max(want, cursor + BOX_W + 2 * U);
    sinkX.set(s, cursor);
  }
  const dropX = (s: string) => sinkX.get(s)! - BOX_W / 2 + U;
  const width = Math.max(
    r.spine.length ? stageL(r.spine.length - 1) + BOX_W : 0,
    ...[...sinkX.values()].map((x) => x + BOX_W / 2),
    40 * U);

  // ── THE VERTICAL. Three bands, top to bottom, each only as tall as its contents.
  const supplyY = 0;
  const supplyH = r.supply.length
    ? HEAD_H + U + r.supply.reduce((n, s) => n + Math.max(BOX_H, s.guards.length * ROW), 0) + U : 0;

  const spineY = supplyY + supplyH;
  // Lane 0 is the box centre line, so the spine reads as ONE unbroken run; a second guard on
  // the same promotion hangs below it as a visibly parallel alternate, and a stage-SKIPPING
  // promotion goes below all of those, clear of every box.
  const adjLanes = Math.max(1, ...r.promotions.filter((p) => !p.skip).map((p) => p.guards.length));
  const skipCount = r.promotions.filter((p) => p.skip).reduce((n, p) => n + p.guards.length, 0);
  const laneMax = adjLanes - 1 + skipCount;
  const boxTop = spineY + HEAD_H;
  const centreY = boxTop + BOX_H / 2;
  const laneY = (k: number) => centreY + k * ROW;
  const spineH = HEAD_H + BOX_H + (laneMax ? laneMax * ROW + U : 0) + U;

  const resY = spineY + spineH;
  const reachTop = resY + HEAD_H + U;   // clear of the band head's own baseline
  const reachY = (i: number) => reachTop + i * ROW + ROW / 2;
  const sinkTop = r.reaches.length ? reachY(r.reaches.length - 1) + ROW / 2 + U : reachTop;
  const resH = r.sinks.length ? HEAD_H + U + r.reaches.length * ROW + U + BOX_H + U : 0;

  const asideY = resY + resH;
  const asideH = r.aside.length ? HEAD_H + U + r.aside.length * ROW + U : 0;
  const legY = asideY + asideH + U;

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
  // A LABEL KNOCKS OUT WHAT IT CROSSES. Reach labels sit above their own run and a run may
  // pass under another stage's bus; a name interrupted by a hairline is a name misread.
  const label = (x: number, y: number, c: IndexCrossing, promo: boolean) => {
    const t = nameOf(c);
    const cls = `gn${promo ? " pr" : ""}${c.tier === 1 ? " t1" : ""}${broken(c) ? " bad" : ""}`;
    return `<rect class="knock" x="${x - 4}" y="${y - 20}" width="${snap2(textW(t))}" height="12"/>`
      + `<text x="${x}" y="${y - U}" class="${cls}">${esc(t)}</text>`;
  };
  /** THE SELECTION RING — a drawn box around the guard's name, hidden until selected. A MARK,
   *  not a hue, so a selection survives a black-and-white printer. */
  const ring = (x: number, y: number, c: IndexCrossing) =>
    `<rect class="ring" x="${x - U}" y="${y - 20}" width="${snap2(textW(nameOf(c)) + 2 * U)}" height="${2 * U}" fill="none" stroke="var(--fg)" stroke-width="1.5"/>`;
  /** One crossing is one selectable object, whatever shape it took. */
  const cx = (c: IndexCrossing, kind: string, body: string) => {
    const dir = c.owner === null ? undefined : dirByLabel.get(c.owner);
    const heat = c.heat === null ? "heat unrecorded" : `heat ${(c.heat * 100).toFixed(1)}%`;
    return `<g class="cx" data-sym="${esc(c.sym)}"${dir ? ` data-owner="${esc(dir)}"` : ""} tabindex="0" role="button">`
      + `<title>${esc(`${nameOf(c)} — ${kind}: ${c.from} to ${c.to}, ${TIER_NAME[c.tier] ?? `tier-${c.tier}`}${c.security ? ", security" : ""}, ${heat}`)}</title>`
      + body + `</g>`;
  };

  const chrome: string[] = [], groups: string[] = [];

  // ── SUPPLY: A STRIP, NOT A PATH ─────────────────────────────────────────────────────
  // The one thing this figure refuses to draw as an arrow. `config → public-web` as a line
  // in the path asserts a sequence, and there is none: it is read wherever it is read.
  if (r.supply.length) {
    chrome.push(`<rect x="0" y="${supplyY + HEAD_H}" width="${width}" height="${supplyH - HEAD_H}" fill="var(--flat)"/>`);
    chrome.push(bandHead(supplyY, width, "supply", `ambient — reaches the path, and is not a step in it`));
    let y = supplyY + HEAD_H + U;
    for (const s of r.supply) {
      const h = Math.max(BOX_H, s.guards.length * ROW);
      chrome.push(`<rect x="0" y="${y}" width="${BOX_W}" height="${BOX_H}" fill="none" stroke="var(--dim)" stroke-width="1"/>`
        + `<text x="${U}" y="${y + BOX_H / 2 + 4}" class="rn dim">${esc(s.source)}</text>`);
      s.guards.forEach((c, k) => {
        const gy = y + k * ROW + ROW / 2 + 4;
        const gx = BOX_W + 2 * U;
        groups.push(cx(c, "supply", (c.security ? diamond(gx, gy - 4, toneOf(c, false)) : "")
          + `<text x="${gx + 3 * U}" y="${gy}" class="gn${c.tier === 1 ? " t1" : ""}${broken(c) ? " bad" : ""}">${esc(nameOf(c))}</text>`
          + `<text x="${gx + 3 * U + snap2(textW(nameOf(c)) + 2 * U)}" y="${gy}" class="lg dim">${esc(`read by ${c.to}`)}</text>`
          + ring(gx + 3 * U, gy + U, c)
          + `<rect x="0" y="${gy - 2 * U}" width="${width}" height="${ROW}" fill="none" pointer-events="all"/>`));
      });
      y += h;
    }
  }

  // ── THE SPINE ───────────────────────────────────────────────────────────────────────
  chrome.push(bandHead(spineY, width, "spine",
    r.spine.length > 1
      ? `a request enters at ${r.spine[0]} and is promoted rightward by a named guard`
      : `one stage — nothing here is promoted anywhere`));
  r.spine.forEach((s, i) => {
    chrome.push(`<rect x="${stageL(i)}" y="${boxTop}" width="${BOX_W}" height="${BOX_H}" fill="none" stroke="var(--fg)" stroke-width="1.5"/>`
      + `<text x="${stageL(i) + U}" y="${centreY + 4}" class="rn">${esc(s)}</text>`);
  });

  let skipLane = adjLanes;
  for (const p of r.promotions) {
    const i = idxOf.get(p.from)!, j = idxOf.get(p.to)!;
    p.guards.forEach((c, k) => {
      const st = strokeOf(c, true), tone = toneOf(c, true);
      if (!p.skip) {
        // THE STEP ITSELF, on the box centre line when it is the first guard on this
        // promotion — which is what makes the spine one continuous run rather than N arrows.
        const y = laneY(k), a = stageL(i) + BOX_W, b = stageL(j);
        groups.push(cx(c, "promotion",
          (k ? `<path d="M${a},${centreY} V${y}" ${st}/>` : "")
          + `<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" ${st}/>`
          + headX(b, y, 1, tone)
          + (c.security ? diamond(a + U, y - 4, tone) : "")
          + label(a + (c.security ? 4 * U : U), y, c, true) + ring(a + (c.security ? 4 * U : U), y, c)
          + `<rect x="${a}" y="${y - ROW / 2}" width="${b - a}" height="${ROW}" fill="none" pointer-events="all"/>`));
      } else {
        // A STAGE-SKIPPING PROMOTION is a bypass: it leaves its stage, runs below every box
        // it passes, and lands on the one it reaches. It is still a step, so it is still
        // drawn at full strength — it just cannot ride the centre line.
        const y = laneY(skipLane++), a = stageX(i), b = stageL(j) + U;
        groups.push(cx(c, "promotion (skips a stage)",
          `<path d="M${a},${boxTop + BOX_H} V${y} H${b} V${boxTop + BOX_H + U}" ${st}/>`
          + headY(b, boxTop + BOX_H, -1, tone)
          + (c.security ? diamond(a + U, y - 4, tone) : "")
          + label(a + (c.security ? 4 * U : U), y, c, true) + ring(a + (c.security ? 4 * U : U), y, c)
          + `<rect x="${Math.min(a, b)}" y="${y - ROW / 2}" width="${Math.abs(b - a)}" height="${ROW}" fill="none" pointer-events="all"/>`));
      }
    });
  }

  // ── THE RESOURCES ───────────────────────────────────────────────────────────────────
  // A reach drops out of its stage, runs to the resource, and stops. The resource box is
  // drawn ONCE however many stages grab it — duplicating it would turn one shared thing into
  // several, which is the fact this band exists to state.
  if (r.sinks.length) {
    chrome.push(bandHead(resY, width, "resources",
      `grabbed at a stage and reached no further — a resource box is drawn once, however many stages hold it`));
    for (const s of r.sinks) {
      const x = sinkX.get(s)! - BOX_W / 2;
      chrome.push(`<rect x="${x}" y="${sinkTop}" width="${BOX_W}" height="${BOX_H}" fill="none" stroke="var(--dim)" stroke-width="1"/>`
        + `<text x="${x + U}" y="${sinkTop + BOX_H / 2 + 4}" class="rn dim">${esc(s)}</text>`);
    }
    // ONE BUS PER STAGE, from the box down to the last lane that leaves it: the vertical is
    // what says "everything on these lanes is held by THIS stage".
    const lastLane = new Map<string, number>();
    r.reaches.forEach((x, i) => lastLane.set(x.stage, i));
    for (const [stage, i] of lastLane) {
      chrome.push(`<path d="M${stageX(idxOf.get(stage)!)},${boxTop + BOX_H} V${reachY(i)}" stroke="var(--dim)" stroke-width="1" fill="none"/>`);
    }
    r.reaches.forEach((x, i) => {
      const c = x.c, y = reachY(i), st = strokeOf(c, false), tone = toneOf(c, false);
      const a = stageX(idxOf.get(x.stage)!), b = dropX(x.sink);
      groups.push(cx(c, "reach",
        `<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" ${st}/>`
        + `<path d="M${b},${y} V${sinkTop}" ${st}/>`
        + headY(b, sinkTop, 1, tone)
        + `<rect x="${a - U / 2}" y="${y - U / 2}" width="${U}" height="${U}" fill="${tone}"/>`
        + (c.security ? diamond(b - U - 4, y - 4, tone) : "")
        + label(b, y, c, false) + ring(b, y, c)
        + `<rect x="0" y="${y - ROW / 2}" width="${width}" height="${ROW}" fill="none" pointer-events="all"/>`));
    });
  }

  // ── THE ASIDE ───────────────────────────────────────────────────────────────────────
  if (r.aside.length) {
    chrome.push(bandHead(asideY, width, "aside",
      `on neither the spine nor an ambient source — listed, never dropped`));
    r.aside.forEach((c, k) => {
      const y = asideY + HEAD_H + U + k * ROW + ROW / 2 + 4;
      groups.push(cx(c, "unplaced", (c.security ? diamond(U, y - 4, toneOf(c, false)) : "")
        + `<text x="${4 * U}" y="${y}" class="gn${broken(c) ? " bad" : ""}">${esc(nameOf(c))}</text>`
        + `<text x="${4 * U + snap2(textW(nameOf(c)) + 2 * U)}" y="${y}" class="lg dim">${esc(`${c.from} to ${c.to}`)}</text>`
        + ring(4 * U, y + U, c)
        + `<rect x="0" y="${y - 2 * U}" width="${width}" height="${ROW}" fill="none" pointer-events="all"/>`));
    });
  }

  // ── THE LEGEND. It names only what is on the page: a treatment with no subjects here
  // would be teaching a vocabulary this project does not use. The heat scale prints its own
  // ENDPOINTS, so the reader can check the encoding against the crossings table rather than
  // taking "line weight = heat" on faith.
  // IT IS A GRID, NOT A FLOW. Packing legend items end to end put every label at its own x
  // and cost the page six alignment lines for nine words — a legend that teaches the
  // encodings while breaking the one rule the figure is built on. Two fixed columns, one
  // sample edge and one label edge, however many items there turn out to be.
  const leg: string[] = [];
  const items: { draw: (x: number, y: number) => string; text: string; w: number }[] = [];
  const sample = (draw: (x: number, y: number) => string, text: string, w: number) =>
    void items.push({ draw, text, w });
  const rule = (x: number, y: number, w: number, tone: string, d: string) =>
    `<line x1="${x}" y1="${y}" x2="${x + 4 * U}" y2="${y}" stroke="${tone}" stroke-width="${w}"${d ? ` stroke-dasharray="${d}"` : ""}/>`;
  if (r.promotions.length) sample((x, y) => rule(x, y, 4, "var(--fg)", ""), "promotion — a trust stage change, and the line to follow", 4 * U);
  if (r.reaches.length) sample((x, y) => rule(x, y, 1.5, "var(--dim)", ""), "reach — a resource grabbed there, going no further", 4 * U);
  if (r.supply.length) sample((x, y) => `<rect x="${x}" y="${y - 2 * U}" width="${4 * U}" height="${2 * U}" fill="var(--flat)" stroke="var(--rule)"/>`, "supply — ambient, and deliberately not an arrow", 4 * U);
  for (const t of [...new Set(cs.map((c) => c.tier))].sort()) {
    sample((x, y) => rule(x, y, t === 1 ? 3 : 1.5, `var(--${t === 1 ? "fg" : "dim"})`, DASH[t] ?? DASH[3]),
      `${TIER_NAME[t] ?? `tier-${t}`}${t === 1 ? " — drawn solid and at full strength" : ""}`, 4 * U);
  }
  if (cs.some((c) => c.security)) sample((x, y) => diamond(x + 4, y, "var(--fg)"), "security crossing", 2 * U);
  if (!heats.length) {
    sample((x, y) => rule(x, y, 1, "var(--dim)", ""), "line weight — heat UNRECORDED, every line is a hairline for that reason", 4 * U);
  } else {
    const lo = Math.min(...heats), hi = Math.max(...heats);
    sample((x, y) => [lo, (lo + hi) / 2, hi].map((h, i) => rule(x, y - U + i * U, weight(h), "var(--dim)", "")).join(""),
      `line weight = change heat, ${(lo * 100).toFixed(1)}% to ${(hi * 100).toFixed(1)}%`
      + (heats.length < cs.length ? " (hairline = unrecorded, not cold)" : ""), 4 * U);
  }
  const LEG_W = snap2(Math.max(...items.map((i) => i.w + textW(i.text))) + 4 * U);
  const legCols = Math.max(1, Math.floor(width / LEG_W));
  const legRows = Math.ceil(items.length / legCols);
  items.forEach((it, i) => {
    const x = (i % legCols) * LEG_W, y = legY + 2 * U + Math.floor(i / legCols) * 3 * U;
    leg.push(it.draw(x, y), `<text x="${x + 6 * U}" y="${y + 4}" class="lg dim">${esc(it.text)}</text>`);
  });
  const height = legY + 2 * U + legRows * 3 * U;

  const svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="the trust spine, its resources and its ambient supply">`
    + chrome.join("") + groups.join("") + leg.join("") + `</svg>`;
  return { svg, w: width, h: height, reading: r };
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

  // THE FIGURE SCALES. It is emitted at its natural width and capped there, but it is free
  // to shrink to the column — which is only possible now that the hit areas are the SVG's
  // own elements. The old absolutely-positioned overlay pinned the picture to one pixel
  // size, and that is the layout constraint the script bought its way out of.
  const figure = d
    ? `<div class="figure" style="--fw:${d.w}px">${d.svg}</div>`
    : `<p class="none"><b>NO CROSSING DIAGRAM.</b> ${a
      ? "The atlas record holds no crossings, so there are no regions to draw and none are invented."
      : "No atlas reading is recorded here — the shape is UNREAD, not absent."}${mp.zones.length ? "" : " No <code>## zones</code> are declared either."}</p>`;

  // ONE SUMMARY LINE, and its first clause is THE ACCOUNTING: the three classes and their
  // sum. It is there so a reader can check that the split dropped nothing — a picture that
  // silently loses a crossing to a class it does not draw is the failure mode of the whole
  // idea, and this is the one number that catches it.
  const bits: string[] = [];
  if (d) {
    const r = d.reading;
    const parts = [
      r.promotions.reduce((n, p) => n + p.guards.length, 0) && `<b>${r.promotions.reduce((n, p) => n + p.guards.length, 0)}</b> promotion(s)`,
      r.reaches.length && `<b>${r.reaches.length}</b> reach(es)`,
      r.supply.reduce((n, s) => n + s.guards.length, 0) && `<b>${r.supply.reduce((n, s) => n + s.guards.length, 0)}</b> supply`,
      r.aside.length && `<span class="warn">! <b>${r.aside.length}</b> aside</span>`,
    ].filter(Boolean) as string[];
    bits.push(`${parts.join(" + ")} = <b>${mp.crossings.shown.length}</b>${mp.crossings.withheld ? ` of ${mp.crossings.total}` : ""} crossing(s) drawn`);
    bits.push(`<b>${r.regions.length}</b> region(s), <b>${r.spine.length}</b> on the spine`);
  }
  if (a) {
    bits.push(`${a.tiers.enshrined} enshrined / ${a.tiers.checked} checked / ${a.tiers.convention} convention`);
    const bad = [
      a.dangling && `<span class="alarm">!! ${a.dangling} dangling</span>`,
      a.drift && `<span class="warn">! ${a.drift} drift</span>`,
      a.overclaimed && `<span class="alarm">!! ${a.overclaimed} over-claimed</span>`,
      a.tier3Security.length && `<span class="alarm">!! ${a.tier3Security.length} unmanaged security crossing(s)</span>`,
      a.hazards.length && `<span class="warn">! ${a.hazards.length} inference hazard(s)</span>`,
    ].filter(Boolean) as string[];
    bits.push(bad.length ? bad.join(" · ") : "no dangling, drift or over-claim");
    bits.push(`<span class="dim">read ${day(a.at)}</span>${a.stale ? ' <span class="warn">! stale</span>' : ""}`);
  }
  // WITH NO PICTURE THERE IS STILL A SUMMARY. An empty rule between two rules would be a
  // blank where a reading belongs, which is the shape this page refuses everywhere else.
  if (!d) bits.push(`<b>${mp.components.length}</b> component(s) <span class="dim">·</span> <b>${mp.gatesTotal}</b> gate(s) <span class="dim">·</span> <b>${mp.crossings.total}</b> crossing(s) recorded`);
  // THE SELECTION HINT RIDES THE SUMMARY LINE rather than taking a line of its own. It is a
  // caption on the picture above it, and a page with a seven-object budget does not spend
  // one of them on instructions.
  const hint = d
    ? ` <span class="dim">·</span> <span class="dim">click a guard or an organ below</span> <span class="clear" data-clear tabindex="0" role="button">show all</span>`
    : "";
  // WHERE THE SHAPE DOES NOT FIT THE READING, THE PAGE SAYS SO IN ONE LINE rather than
  // drawing something that implies an order nobody declared. A cyclic region graph, sources
  // that tie, a spine one stage long: each states itself here and the figure above stops
  // pretending. This is the whole reason the split is allowed to be an inference.
  const degen = d && d.reading.notes.length
    ? `<p class="degen warn">${d.reading.notes.map((n) => `<span>${esc(n)}</span>`).join("")}</p>` : "";
  const summary = `<p class="sum">${bits.join(" <span class=\"dim\">·</span> ")}${hint}</p>${degen}`;

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

/* ── the figure ─────────────────────────────────────────────────────────────────────────
   IT SCALES. The SVG is emitted at its natural width and never drawn wider, but it is free
   to shrink to the column — which the pixel-positioned hotspot overlay used to forbid. */
.figure { margin: 0 0 calc(2*var(--u)); }
.figure svg { display: block; width: 100%; height: auto; max-width: var(--fw); }
svg text { font: 400 10.5px ui-monospace, SFMono-Regular, Menlo, monospace; fill: var(--fg); }
svg text.rn { font-weight: 700; letter-spacing: .04em; }
svg text.bn { font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
/* THE CLASS IS THE TONE. A promotion is the spine's own line and prints at full strength; a
   reach, a supply and an aside are subordinate and print dim. Both survive greyscale, which
   is why the distinction is tone and geometry rather than hue. */
svg text.gn { fill: var(--dim); }
svg text.gn.pr { fill: var(--fg); }
svg text.gn.bad { fill: var(--alarm); }
svg text.gn.t1 { font-weight: 700; }
svg text.dim, svg text.lg { fill: var(--dim); }
svg .knock { fill: var(--bg); }
/* A DEGENERACY IS A SENTENCE, not a missing picture: a cyclic region graph or a spine one
   stage long says so here, in the reader's way, immediately under the figure it explains. */
.degen { margin: var(--u) 0 0; font-size: var(--t2); max-width: 88ch; }
.degen span { display: block; border-left: 3px solid var(--warn); padding-left: calc(2*var(--u));
              margin-bottom: var(--u); }
.sum { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
       padding: var(--u) 0; margin: 0; font-size: var(--t2); }
.clear { cursor: pointer; user-select: none; border: 1px solid var(--rule); padding: 0 var(--u);
         margin-left: var(--u); }

/* ── SELECTION: real listeners on the real elements ─────────────────────────────────────
   THE HIGHLIGHT IS NOT COLOUR: the unselected rows fade (a TONE change, which is what
   greyscale preserves) and the selected one gains a drawn RING around its name. Either one
   alone would survive a black-and-white printer; the pair is unmistakable. */
.cx, .chip, .oname[data-org], .clear { cursor: pointer; }
.cx .ring { display: none; }
.cx.on .ring { display: block; }
.figure.sel .cx, .figure.sel .bandh { opacity: .22; }
.figure.sel .cx.on, .figure.sel .bandh.on { opacity: 1; }
.cx:focus-visible { outline: 1px solid var(--fg); }
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
.roster { margin-top: calc(3*var(--u)); }
.band { margin-bottom: calc(3*var(--u)); }
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
.org { border-left: 3px solid transparent; padding: calc(2*var(--u)) 0 calc(2*var(--u)) calc(2*var(--u));
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
  .figure svg { max-width: 100%; height: auto; }
  .hint { display: none; }
  /* A SELECTION IS SCREEN STATE, and paper has none: every crossing comes back to full
     weight and every owner line prints, so the paper copy is the whole document however
     the reader left the screen. */
  .figure.sel .cx, .figure.sel .bandh { opacity: 1 !important; }
  .cx .ring { display: none !important; }
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
    // the roster row is the only place the organ's sentence lives.
    var ownerDir = dir;
    if (sym !== null) {
      var g = map.querySelector('.cx[data-sym="' + CSS.escape(sym) + '"]');
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
