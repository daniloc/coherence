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

// ── I. THE MAP, AS A MATRIX SCHEMATIC ─────────────────────────────────────────────────
//
// EVERY CROSSING GETS ITS OWN ROW. Regions are the COLUMNS — vertical bus bars in layer
// order, `browser-client → public-web → authed-user → {patient, storage, meter} →
// {public-egress, model-provider}` on the project this was built against, so left-to-right
// is still the direction trust travels. A crossing is one horizontal run on its own row,
// from its source bar to its target bar. Nothing here is derived: `from`, `to`, `sym`,
// `tier`, `security`, `present`, `heat` and `owner` are all fields the atlas record and the
// spec tree already filed, and the ONLY computed thing is where to put them.
//
// ── WHY THIS AND NOT A BOX-AND-ARROW DAG ──────────────────────────────────────────────
//
// The previous layout was regions-as-boxes with arrows between them, and it could not hold
// four things at once: uniform nodes, even gutters, orthogonal routing, and CLUSTERING BY
// ORGAN. Organs cut ACROSS the region layering — on the project this was built against six
// components own fourteen crossings whose region pairs share no grouping at all — so an
// organ bracket over a layered picture is a bounding box around scattered labels.
//
// One row per crossing fixes all four by construction:
//   · ROWS GROUP BY ORGAN CONTIGUOUSLY, in the roster's own order, so the two objects on
//     this tab read down in the same sequence and a band is a plain run of rows.
//   · A RUN CANNOT BE OBSTRUCTED. The old layout needed reserved lanes for layer-skipping
//     crossings, and four of them ended up as dashed rails under the figure whose risers
//     coincided — they read as attached to nothing. A row belongs to one crossing, so its
//     endpoints are always visibly its own.
//   · EVERY GUARD NAME LANDS ON ONE VERTICAL ALIGNMENT LINE, which is the thing a greedy
//     collision-avoiding label placer can never give you.
//
// The layering relaxation is still bounded by the region count, so a CYCLE in the crossing
// graph terminates with an honest (if arbitrary) column order rather than hanging: a cyclic
// trust graph is a real shape.

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
const ROW = 3 * U, BAND_H = 3 * U, HEAD_H = 3 * U, LEG_H = 5 * U;
/** Widths snap to TWO units, so a column's centre line — where its bus bar runs — is itself
 *  on the grid rather than at a half unit. */
const snap2 = (n: number) => Math.ceil(n / (2 * U)) * 2 * U;

const textW = (s: string, fs: number = FS) => s.length * fs * CH;

/** TIER → LINE TREATMENT, and the ordering is the point: the stronger the guarantee, the
 *  more continuous the line. It carries in greyscale, which colour would not. */
const DASH: Record<number, string> = { 1: "", 2: "7 4", 3: "1.5 3" };
const TIER_NAME: Record<number, string> = { 1: "enshrined", 2: "totality-checked", 3: "convention" };

/** An arrowhead as a filled triangle, apex on the target, pointing along ±x only — this
 *  figure has no diagonal in it. Drawn rather than `marker-end` so it inherits the edge's
 *  own colour without a marker definition per colour. */
function head(x: number, y: number, dir: 1 | -1, fill: string): string {
  const b = x - dir * U;
  return `<path d="M${x},${y} L${b},${y - 4} L${b},${y + 4} Z" fill="${fill}"/>`;
}

/** THE SECURITY MARK — a drawn diamond, never a hue, so it survives a greyscale printer.
 *  One shape, used on the row and once again in the legend. */
const diamond = (x: number, y: number, fill: string) =>
  `<path d="M${x},${y} l4.5,-4.5 l4.5,4.5 l-4.5,4.5 Z" fill="${fill}"/>`;

/** ONE ORGAN'S STRETCH OF THE PERIMETER: a contiguous run of rows, in the roster's order.
 *  `dir` is the component directory — the id the roster keys its own row by, so selecting a
 *  band and selecting a roster row are the same act. Null when nothing owns these. */
interface Band { label: string; dir: string | null; rows: IndexCrossing[] }
/**
 * THE DIAGRAM. Returns null when there is no crossing data at all — the caller then says
 * so in one line rather than drawing an empty frame, because a picture of nothing is the
 * green-by-absence this page exists to refuse.
 *
 * `comps` is the roster's own component list, already ordered perimeter-first. It is here
 * ONLY to fix the band order: the figure and the roster must read down in the same
 * sequence, and deriving a second order from the crossings would be a second spelling of
 * the same fact.
 */
function diagram(cs: readonly IndexCrossing[], comps: readonly IndexComponent[]):
  { svg: string; regions: string[]; w: number; h: number } | null {
  if (!cs.length) return null;

  // ── THE ROWS, GROUPED INTO ORGAN BANDS ──────────────────────────────────────────────
  // Band order is the roster's. WITHIN a band the strongest tier leads and heat breaks the
  // rest, so the one enshrined crossing on a project sits at the top of its organ's stretch
  // instead of being lost among thirteen checked ones.
  const owned = new Map<string, IndexCrossing[]>();
  for (const c of cs) {
    const k = c.owner ?? "";
    (owned.get(k) ?? owned.set(k, []).get(k)!).push(c);
  }
  const rank = (a: IndexCrossing, b: IndexCrossing) =>
    a.tier - b.tier || (b.heat ?? -1) - (a.heat ?? -1) || a.sym.localeCompare(b.sym);

  const bands: Band[] = [];
  for (const comp of comps) {
    const rows = owned.get(comp.label);
    if (!rows?.length) continue;
    owned.delete(comp.label);          // two components may share a label; the first claims it
    bands.push({ label: comp.label, dir: comp.dir, rows: [...rows].sort(rank) });
  }
  // WHATEVER IS LEFT IS UNOWNED, and it gets a band that says so rather than being folded
  // into somebody else's stretch — the roster's rule about inventing an owner, drawn.
  const orphans = [...owned.values()].flat().sort(rank);
  if (orphans.length) bands.push({ label: "no organ owns these", dir: null, rows: orphans });

  const rowOf = new Map<IndexCrossing, number>();
  bands.flatMap((b) => b.rows).forEach((c, i) => rowOf.set(c, i));
  // A ROW CARRIES ITS ORGAN'S DIRECTORY, not its label — that is the id the roster keys its
  // own rows by, and two components may share a label while no two share a directory.
  const dirOf = new Map<IndexCrossing, string | null>();
  for (const b of bands) for (const c of b.rows) dirOf.set(c, b.dir);

  // ── THE COLUMNS ─────────────────────────────────────────────────────────────────────
  // Layer = longest path from a source, relaxed at most |regions| times: a DAG converges
  // long before that, and a cycle stops at the bound instead of looping forever.
  const regions: string[] = [];
  for (const c of cs) for (const r of [c.from, c.to]) if (!regions.includes(r)) regions.push(r);

  const layer = new Map(regions.map((r) => [r, 0]));
  for (let it = 0; it < regions.length; it++) {
    let moved = false;
    for (const c of cs) {
      if (c.from === c.to) continue;
      const a = layer.get(c.from)!, b = layer.get(c.to)!;
      if (b <= a) { layer.set(c.to, a + 1); moved = true; }
    }
    if (!moved) break;
  }
  const depth = Math.max(...regions.map((r) => layer.get(r)!)) + 1;

  // WITHIN a layer, order by the mean row of the crossings that touch the region, so a
  // column sits beside the rows that use it and the runs stay short. Ties break on the
  // name: the page is a PURE FUNCTION of the model, and an order that depended on anything
  // else would make it not one.
  const meanRow = (r: string) => {
    const rs = cs.filter((c) => c.from === r || c.to === r).map((c) => rowOf.get(c)!);
    return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
  };
  const cols: string[] = [];
  for (let j = 0; j < depth; j++) {
    cols.push(...regions.filter((r) => layer.get(r) === j)
      .map((r) => ({ r, k: meanRow(r) }))
      .sort((a, b) => a.k - b.k || a.r.localeCompare(b.r)).map((z) => z.r));
  }
  const colAt = new Map(cols.map((r, i) => [r, i]));

  // ── THE LATTICE ─────────────────────────────────────────────────────────────────────
  // Two reserved columns and then N region columns of ONE width. Every number below is a
  // multiple of the base unit, and none of them is tuned to a project: the guard column is
  // as wide as the longest guard name, the region pitch as wide as the longest region name.
  const nameOf = (c: IndexCrossing) => c.present ? c.sym : `${c.sym} DANGLING`;
  const GUARD_W = snap2(Math.max(...cs.map((c) => textW(nameOf(c)))) + 6 * U);
  const COL_W = snap2(Math.max(...cols.map((r) => textW(r))) + 2 * U);
  const x0 = U + GUARD_W;                       // left edge of the region field
  const width = x0 + cols.length * COL_W + U;
  const barX = (r: string) => x0 + colAt.get(r)! * COL_W + COL_W / 2;

  const yTop = U + HEAD_H + U;
  let yCur = yTop;
  const bandY = new Map<Band, number>();
  for (const b of bands) { bandY.set(b, yCur); yCur += BAND_H + b.rows.length * ROW; }
  const fieldEnd = yCur;
  const height = fieldEnd + U + LEG_H;
  const rowY = (c: IndexCrossing) => {
    const b = bands.find((x) => x.rows.includes(c))!;
    return bandY.get(b)! + BAND_H + b.rows.indexOf(c) * ROW + ROW / 2;
  };

  // ── THE ENCODINGS ───────────────────────────────────────────────────────────────────
  // HEAT IS LINE WEIGHT and it has to be SEEN. A linear map of a range whose ends differ by
  // sixty-fold puts every cold crossing inside a pixel of every other, which is how a
  // declared encoding becomes an inert one; the exponent spreads the bottom of the range
  // where all the crossings actually are. Anchored at 1 so an unrecorded heat is a hairline
  // and is legended as unrecorded rather than cold.
  const heats = cs.map((c) => c.heat).filter((h): h is number => h !== null);
  const maxHeat = Math.max(0, ...heats);
  const weight = (h: number | null) =>
    h === null || maxHeat <= 0 ? 1 : +(1 + 4 * Math.pow(h / maxHeat, 0.6)).toFixed(2);
  // TIER IS TONE AND TREATMENT TOGETHER, and the rare tier is the loud one. An enshrined
  // crossing draws solid at full strength with its name in bold; everything weaker draws
  // broken and dim. Thirteen dashed lines against one solid one is the reading — the
  // previous spelling made the field of dashes the default and the strongest crossing the
  // thing you had to hunt for.
  const colourOf = (c: IndexCrossing) =>
    !c.present || (c.tier === 3 && c.security) ? "var(--alarm)" : c.tier === 1 ? "var(--fg)" : "var(--dim)";

  // ── THE DRAWING ─────────────────────────────────────────────────────────────────────
  const tints: string[] = [], bars: string[] = [], heads: string[] = [], rows: string[] = [];

  // Region columns: a bus bar the full height of the row field, and the region's name over
  // it. The bar is what lets the eye drop from a name to any row without a ruler.
  for (const r of cols) {
    const x = barX(r);
    bars.push(`<path d="M${x},${yTop - U} V${fieldEnd}" stroke="var(--rule)" stroke-width="1" fill="none"/>`);
    heads.push(`<text x="${x}" y="${U + HEAD_H - U}" class="rn" text-anchor="middle">${esc(r)}</text>`);
  }
  heads.push(`<path d="M0,${yTop - U} H${width}" stroke="var(--fg)" stroke-width="1" fill="none"/>`);

  bands.forEach((b, i) => {
    const y = bandY.get(b)!, h = BAND_H + b.rows.length * ROW;
    // THE BAND IS A TINT, A RULE AND A NAME — three redundant markers, because the tint is
    // the one that does not survive a bad printer.
    if (i % 2 === 1) tints.push(`<rect x="0" y="${y}" width="${width}" height="${h}" fill="var(--flat)"/>`);
    tints.push(`<path d="M0,${y} H${width}" stroke="var(--rule)" stroke-width="1" fill="none"/>`);
    const sel = b.dir === null ? "" : ` data-org="${esc(b.dir)}" tabindex="0" role="button"`;
    tints.push(`<g class="bandh"${sel}>`
      + `<rect x="0" y="${y}" width="${width}" height="${BAND_H}" fill="none" pointer-events="all"/>`
      + `<text x="${U}" y="${y + 2 * U}" class="bn">${esc(b.label)}</text>`
      + `<text x="${x0 - 2 * U}" y="${y + 2 * U}" class="dim" text-anchor="end">${b.rows.length}</text></g>`);
  });

  for (const c of cs) {
    const y = rowY(c), col = colourOf(c), w = weight(c.heat), dash = DASH[c.tier] ?? DASH[3];
    const stroke = `stroke="${col}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""} fill="none"`;
    const a = barX(c.from), b = barX(c.to);
    const g: string[] = [];

    // THE RUN. Horizontal, on the row's own centre line, from source bar to target bar — a
    // filled square where it leaves, an arrowhead where it lands. A crossing that ends where
    // it began cannot be a run, so it draws the smallest orthogonal loop that closes.
    if (c.from === c.to) {
      g.push(`<path d="M${a},${y} h${2 * U} v${U} h${-2 * U}" ${stroke}/>`, head(a, y + U, -1, col));
    } else {
      g.push(`<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" ${stroke}/>`, head(b, y, b > a ? 1 : -1, col));
    }
    g.push(`<rect x="${a - U / 2}" y="${y - U / 2}" width="${U}" height="${U}" fill="${col}"/>`);
    // THE LEADER ties the name column to the run. Without it the two halves of a row are
    // two objects a reader has to join by eye, which is the complaint this layout answers.
    // EVERY LEADER STARTS AT ONE X, not at the end of its own name: a ragged set of start
    // points is a second, accidental alignment line running down the middle of the figure.
    g.push(`<path d="M${x0 - 2 * U},${y} H${a - U}" stroke="var(--rule)" stroke-width="1" stroke-dasharray="1 3" fill="none"/>`);
    if (c.security) g.push(diamond(U + 4, y, col));
    g.push(`<text x="${4 * U}" y="${y + 4}" class="gn${c.tier === 1 ? " t1" : ""}" fill="${c.present ? col : "var(--alarm)"}">${esc(nameOf(c))}</text>`);
    // THE SELECTION RING — a drawn box around the guard's name, hidden until selected. It is
    // a MARK, not a hue, so a selection survives a black-and-white printer and a reader who
    // cannot separate the four palette values.
    g.push(`<rect class="ring" x="${U / 2}" y="${y - U}" width="${GUARD_W}" height="${2 * U}" fill="none" stroke="var(--fg)" stroke-width="1.5"/>`);
    // …and the whole row is the hit area. A row IS the crossing here, so anything narrower
    // would be a target the picture does not draw.
    g.push(`<rect x="0" y="${y - ROW / 2}" width="${width}" height="${ROW}" fill="none" pointer-events="all"/>`);
    const heat = c.heat === null ? "heat unrecorded" : `heat ${(c.heat * 100).toFixed(1)}%`;
    rows.push(`<g class="cx" data-sym="${esc(c.sym)}"${dirOf.get(c) ? ` data-owner="${esc(dirOf.get(c)!)}"` : ""} tabindex="0" role="button">`
      + `<title>${esc(`${nameOf(c)} — ${c.from} → ${c.to}, ${TIER_NAME[c.tier] ?? `tier-${c.tier}`}${c.security ? ", security" : ""}, ${heat}`)}</title>`
      + g.join("") + `</g>`);
  }

  // ── THE LEGEND. It only names what is on the page: a treatment with no subjects here
  // would be teaching a vocabulary this project does not use. The heat scale prints its own
  // ENDPOINTS, so the reader can check the encoding against the crossings table instead of
  // taking "line weight = heat" on faith.
  const leg: string[] = [];
  let lx = U, ly = fieldEnd + U + 2 * U;
  const sample = (draw: (x: number) => string, label: string, w: number) => {
    if (lx + w + textW(label) + 3 * U > width) { lx = U; ly += 2 * U; }
    leg.push(draw(lx), `<text x="${lx + w + U}" y="${ly + 4}" class="lg dim">${esc(label)}</text>`);
    lx += Math.ceil((w + U + textW(label) + 3 * U) / U) * U;
  };
  for (const t of [...new Set(cs.map((c) => c.tier))].sort()) {
    const nm = TIER_NAME[t] ?? `tier-${t}`;
    sample((x) => `<line x1="${x}" y1="${ly}" x2="${x + 3 * U}" y2="${ly}" stroke="var(--${t === 1 ? "fg" : "dim"})" stroke-width="${t === 1 ? 3 : 1.5}"${DASH[t] ? ` stroke-dasharray="${DASH[t]}"` : ""}/>`,
      `${nm}${t === 1 ? " — drawn solid and at full strength" : ""}`, 3 * U);
  }
  if (cs.some((c) => c.security)) sample((x) => diamond(x + 4, ly, "var(--fg)"), "security crossing", 2 * U);
  if (!heats.length) {
    sample((x) => `<line x1="${x}" y1="${ly}" x2="${x + 3 * U}" y2="${ly}" stroke="var(--dim)" stroke-width="1"/>`,
      "line weight — heat UNRECORDED, every line is a hairline for that reason", 3 * U);
  } else {
    const lo = Math.min(...heats), hi = Math.max(...heats);
    sample((x) => [lo, (lo + hi) / 2, hi].map((h, i) =>
      `<line x1="${x}" y1="${ly - U + i * U}" x2="${x + 3 * U}" y2="${ly - U + i * U}" stroke="var(--dim)" stroke-width="${weight(h)}"/>`).join(""),
      `line weight = change heat, ${(lo * 100).toFixed(1)}% to ${(hi * 100).toFixed(1)}%`
      + (heats.length < cs.length ? " (hairline = unrecorded, not cold)" : ""), 3 * U);
  }
  const legH = ly + 2 * U - height;

  const svg = `<svg viewBox="0 0 ${width} ${height + Math.max(0, legH)}" width="${width}" height="${height + Math.max(0, legH)}" role="img" aria-label="crossings diagram">`
    + tints.join("") + bars.join("") + heads.join("") + rows.join("") + leg.join("") + `</svg>`;
  return { svg, regions, w: width, h: height + Math.max(0, legH) };
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

  // ONE SUMMARY LINE. Everything else on this tab is behind a term in the strip below it.
  const bits: string[] = [];
  if (d) {
    bits.push(`<b>${d.regions.length}</b> region(s)`);
    bits.push(`<b>${mp.crossings.shown.length}</b>${mp.crossings.withheld ? ` of ${mp.crossings.total}` : ""} crossing(s) drawn`);
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
    ? ` <span class="dim">·</span> <span class="dim">click a row, a band or an organ below</span> <span class="clear" data-clear tabindex="0" role="button">show all</span>`
    : "";
  const summary = `<p class="sum">${bits.join(" <span class=\"dim\">·</span> ")}${hint}</p>`;

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
svg text.gn { fill: var(--dim); }
svg text.gn.t1 { font-weight: 700; }
svg text.dim, svg text.lg { fill: var(--dim); }
.sum { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
       padding: var(--u) 0; margin: 0; font-size: var(--t2); }
.clear { cursor: pointer; user-select: none; border: 1px solid var(--rule); padding: 0 var(--u);
         margin-left: var(--u); }

/* ── SELECTION: real listeners on the real elements ─────────────────────────────────────
   THE HIGHLIGHT IS NOT COLOUR: the unselected rows fade (a TONE change, which is what
   greyscale preserves) and the selected one gains a drawn RING around its name. Either one
   alone would survive a black-and-white printer; the pair is unmistakable. */
.cx, .bandh, .chip, .oname[data-org], .clear { cursor: pointer; }
.cx .ring { display: none; }
.cx.on .ring { display: block; }
.figure.sel .cx, .figure.sel .bandh { opacity: .22; }
.figure.sel .cx.on, .figure.sel .bandh.on { opacity: 1; }
.cx:focus-visible, .bandh:focus-visible { outline: 1px solid var(--fg); }
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
