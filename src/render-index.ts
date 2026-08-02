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
//   · NO SCRIPT. The tabs are `:target`, the disclosures are checkbox + `~`, the journal's
//     click-to-reveal is a radio group. The page is a document: it works with scripting
//     off, nothing on it can execute, and the hash makes a tab linkable — which is what the
//     brief asked for and what `:target` natively IS.
//   · MONOSPACE THROUGHOUT, four colour values (fg / dim / warn / alarm), hairline rules,
//     no cards, no rounding, no shadows, no gradients, no animation beyond show/hide.
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

// ── I. THE MAP, AS A DIAGRAM ──────────────────────────────────────────────────────────
//
// THE ENERGY MONITOR. Regions are boxes, crossings are arrows, and every channel the
// atlas graded is drawn with its guard's name on it. Nothing here is derived: `from`,
// `to`, `sym`, `tier`, `security`, `present` and `heat` are all fields the atlas record
// already filed, and the ONLY computed thing is where to put them.
//
// THE LAYOUT IS A LAYERED DAG — longest path from a source — because that is what the
// crossing set of a real system is: `browser-client → public-web → authed-user →
// {patient, storage, meter} → {public-egress, model-provider}` on the project this was
// built against. Reading left to right IS reading the drivetrain. The relaxation is
// bounded by the region count so a CYCLE in the crossing graph terminates with an honest
// (if arbitrary) layering rather than hanging: a cyclic trust graph is a real shape.

/** Monospace advance as a fraction of font-size. Slightly over the 0.6 of the faces in the
 *  stack, so a label's background plate is never narrower than the text on it. */
const CH = 0.61;
const BOX_FS = 11, EDGE_FS = 10;
const PAD_X = 11, MIN_H = 26, PORT = 15, ROW_GAP = 30, MIN_GAP = 120, EDGE_PAD = 14;
const LANE = 17, LEGEND_H = 26, JUT = 16, LABEL_H = 15;

const textW = (s: string, fs: number) => s.length * fs * CH;

/** TIER → LINE TREATMENT, and the ordering is the point: the stronger the guarantee, the
 *  more continuous the line. It carries in greyscale, which colour would not. */
const DASH: Record<number, string> = { 1: "", 2: "7 4", 3: "1.5 3" };
const TIER_NAME: Record<number, string> = { 1: "enshrined", 2: "totality-checked", 3: "convention" };

interface Rect { x: number; y: number; w: number; h: number }
const hits = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** An arrowhead as a filled triangle, apex on the target. Drawn rather than `marker-end`
 *  so it inherits the edge's own colour without a marker definition per colour. */
function head(x: number, y: number, dx: number, dy: number, fill: string): string {
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n, uy = dy / n, bx = x - ux * 8, by = y - uy * 8;
  const px = -uy * 3.6, py = ux * 3.6;
  return `<path d="M${x.toFixed(1)},${y.toFixed(1)} L${(bx + px).toFixed(1)},${(by + py).toFixed(1)} L${(bx - px).toFixed(1)},${(by - py).toFixed(1)} Z" fill="${fill}"/>`;
}

/** One clickable rectangle over a guard's label plate, in the SVG's own pixel coordinates.
 *  The overlay is how an arrow becomes selectable with no script: `<label>` is not valid
 *  inside SVG, so the hit areas are HTML positioned on top of it at the same numbers the
 *  layout already computed to place the text. */
interface Hot { sym: string; x: number; y: number; w: number; h: number }

/**
 * THE DIAGRAM. Returns null when there is no crossing data at all — the caller then says
 * so in one line rather than drawing an empty frame, because a picture of nothing is the
 * green-by-absence this page exists to refuse.
 */
function diagram(cs: readonly IndexCrossing[]): { svg: string; regions: string[]; hots: Hot[]; w: number; h: number } | null {
  if (!cs.length) return null;

  const regions: string[] = [];
  for (const c of cs) for (const r of [c.from, c.to]) if (!regions.includes(r)) regions.push(r);

  // LAYERS. Relaxed at most |regions| times: a DAG converges long before that, and a cycle
  // stops at the bound instead of looping forever.
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
  const cols: string[][] = Array.from({ length: depth }, () => []);
  for (const r of regions) cols[layer.get(r)!].push(r);

  // ORDER WITHIN A COLUMN — the barycentre of the sources already placed, so edges cross as
  // little as the data allows. Ties break on the name: the page is a PURE FUNCTION of the
  // model, and an order that depended on anything else would make it not one.
  const order = new Map<string, number>();
  for (let j = 0; j < depth; j++) {
    const bary = (r: string) => {
      const ps = cs.filter((c) => c.to === r && order.has(c.from)).map((c) => order.get(c.from)!);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.MAX_SAFE_INTEGER;
    };
    cols[j] = cols[j].map((r) => ({ r, k: bary(r) }))
      .sort((a, b) => a.k - b.k || a.r.localeCompare(b.r)).map((z) => z.r);
    cols[j].forEach((r, i) => order.set(r, i));
  }

  const outs = new Map<string, IndexCrossing[]>(), ins = new Map<string, IndexCrossing[]>();
  for (const c of cs) {
    (outs.get(c.from) ?? outs.set(c.from, []).get(c.from)!).push(c);
    (ins.get(c.to) ?? ins.set(c.to, []).get(c.to)!).push(c);
  }

  // A BOX IS AS TALL AS THE GUARDED PATHS THROUGH IT. Ports never crowd, and the height
  // says something true rather than being decoration.
  const colW = cols.map((col) => Math.max(66, ...col.map((r) => Math.ceil(textW(r, BOX_FS)) + 2 * PAD_X)));
  const H = new Map(regions.map((r) =>
    [r, Math.max(MIN_H, Math.max(outs.get(r)?.length ?? 0, ins.get(r)?.length ?? 0) * PORT + 6)]));
  const wOf = (r: string) => colW[layer.get(r)!];

  // THE COLUMN GAP IS SET BY THE LONGEST GUARD NAME, not by a constant: the arrow labels
  // live in the gaps, and a gap narrower than its labels would either overlap them or push
  // them onto somebody else's line. Tuning a fixed number to one project is how a layout
  // stops being a function of the data.
  const colGap = Math.max(MIN_GAP, Math.ceil(Math.max(...cs.map((c) => textW(c.sym, EDGE_FS)))) + 34);
  const colX: number[] = [];
  for (let j = 0, x = EDGE_PAD; j < depth; j++) { colX.push(x); x += colW[j] + colGap; }
  const width = colX[depth - 1] + colW[depth - 1] + EDGE_PAD;

  const colH = cols.map((col) => col.reduce((s, r) => s + H.get(r)!, 0) + ROW_GAP * Math.max(0, col.length - 1));
  const contentH = Math.max(...colH);
  const selfs = cs.filter((c) => c.from === c.to);
  const top = EDGE_PAD + (selfs.length ? 26 : 0);

  const X = new Map<string, number>(), Y = new Map<string, number>();
  for (let j = 0; j < depth; j++) {
    let y = top + (contentH - colH[j]) / 2;
    for (const r of cols[j]) { X.set(r, colX[j]); Y.set(r, y); y += H.get(r)! + ROW_GAP; }
  }
  const cy = (r: string) => Y.get(r)! + H.get(r)! / 2;

  const outY = new Map<IndexCrossing, number>(), inY = new Map<IndexCrossing, number>();
  for (const [r, list] of outs) {
    [...list].sort((a, b) => cy(a.to) - cy(b.to) || a.sym.localeCompare(b.sym))
      .forEach((c, i, all) => outY.set(c, Y.get(r)! + H.get(r)! * (i + 1) / (all.length + 1)));
  }
  for (const [r, list] of ins) {
    [...list].sort((a, b) => cy(a.from) - cy(b.from) || a.sym.localeCompare(b.sym))
      .forEach((c, i, all) => inY.set(c, Y.get(r)! + H.get(r)! * (i + 1) / (all.length + 1)));
  }

  // A CROSSING THAT SKIPS A LAYER (or runs backwards, or sideways) takes a lane below the
  // diagram rather than a straight line through somebody else's box.
  const bypass = cs.filter((c) => c.from !== c.to && layer.get(c.to)! !== layer.get(c.from)! + 1);
  const laneY = new Map(bypass.map((c, i) => [c, top + contentH + 20 + i * LANE]));
  const height = top + contentH + (bypass.length ? 20 + bypass.length * LANE : 8) + LEGEND_H;

  const maxHeat = Math.max(0, ...cs.map((c) => c.heat ?? 0));
  const weight = (c: IndexCrossing) =>
    c.heat === null || maxHeat <= 0 ? 1 : +(1 + 3.6 * (c.heat / maxHeat)).toFixed(2);
  // COLOUR ONLY REINFORCES. A dangling chokepoint and an unmanaged tier-3 security crossing
  // are the two states the atlas itself calls out; both also carry it in text on the label.
  const colourOf = (c: IndexCrossing) =>
    !c.present || (c.tier === 3 && c.security) ? "var(--alarm)" : "var(--fg)";

  const occupied: Rect[] = regions.map((r) =>
    ({ x: X.get(r)! - 4, y: Y.get(r)! - 4, w: wOf(r) + 8, h: H.get(r)! + 8 }));

  // EVERY PIECE OF ONE CROSSING WEARS THAT CROSSING'S CLASS — `<g class="cx cx-SYM">` — so
  // "highlight these, dim the rest" is a handful of CSS rules rather than per-element
  // bookkeeping. It is TWO groups per crossing, not one, because the z-order is load
  // bearing: every edge draws beneath every box, every label plate draws above them, and
  // fusing the two layers would let a late arrow cross an early guard's name.
  const edgeGroups: string[] = [], labelGroups: string[] = [];
  const hots: Hot[] = [];
  for (const c of cs) {
    const edges: string[] = [], labels: string[] = [];
    const col = colourOf(c), w = weight(c), dash = DASH[c.tier] ?? DASH[3];
    const stroke = `stroke="${col}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""} fill="none"`;
    let ax = 0, ay = 0;

    if (c.from === c.to) {
      const x1 = X.get(c.from)! + wOf(c.from) * 0.32, x2 = X.get(c.from)! + wOf(c.from) * 0.68;
      const yb = Y.get(c.from)!, yt = yb - 18;
      edges.push(`<path d="M${x1},${yb} V${yt} H${x2} V${yb}" ${stroke}/>`, head(x2, yb, 0, 1, col));
      ax = X.get(c.from)! + wOf(c.from) / 2; ay = yt - 10;
    } else if (bypass.includes(c)) {
      const x1 = X.get(c.from)! + wOf(c.from), y1 = outY.get(c)!;
      const x2 = X.get(c.to)!, y2 = inY.get(c)!, by = laneY.get(c)!;
      edges.push(`<path d="M${x1},${y1.toFixed(1)} H${x1 + JUT} V${by} H${x2 - JUT} V${y2.toFixed(1)} H${x2}" ${stroke}/>`,
        head(x2, y2, 1, 0, col));
      ax = (x1 + JUT + x2 - JUT) / 2; ay = by;
    } else {
      const x1 = X.get(c.from)! + wOf(c.from), y1 = outY.get(c)!;
      const x2 = X.get(c.to)!, y2 = inY.get(c)!;
      edges.push(`<line x1="${x1}" y1="${y1.toFixed(1)}" x2="${x2}" y2="${y2.toFixed(1)}" ${stroke}/>`,
        head(x2, y2, x2 - x1, y2 - y1, col));
      ax = (x1 + x2) / 2; ay = (y1 + y2) / 2;
    }

    // THE GUARD'S NAME LABELS THE ARROW, placed greedily off the anchor until it collides
    // with nothing already drawn. Deterministic, so the SVG stays a function of the model.
    const txt = c.present ? c.sym : `${c.sym} DANGLING`;
    const lw = textW(txt, EDGE_FS) + (c.security ? 15 : 0) + 9;
    let ly = ay;
    for (const d of [0, -LABEL_H, LABEL_H, -2 * LABEL_H, 2 * LABEL_H, -3 * LABEL_H, 3 * LABEL_H, -4 * LABEL_H, 4 * LABEL_H]) {
      ly = ay + d;
      if (!occupied.some((o) => hits(o, { x: ax - lw / 2, y: ly - LABEL_H / 2, w: lw, h: LABEL_H }))) break;
    }
    occupied.push({ x: ax - lw / 2, y: ly - LABEL_H / 2, w: lw, h: LABEL_H });
    const lx = ax - lw / 2, lt = ly - LABEL_H / 2;
    labels.push(`<rect x="${lx.toFixed(1)}" y="${lt.toFixed(1)}" width="${lw.toFixed(1)}" height="${LABEL_H}" fill="var(--bg)"/>`
      + (c.security ? `<path d="M${(lx + 5).toFixed(1)},${ly.toFixed(1)} l4.5,-4.5 l4.5,4.5 l-4.5,4.5 Z" fill="${col}"/>` : "")
      + `<text x="${(lx + (c.security ? 15 : 5)).toFixed(1)}" y="${(ly + 3.5).toFixed(1)}" class="el" fill="${c.present ? col : "var(--alarm)"}">${esc(txt)}</text>`);
    // THE SELECTION RING — a drawn box around the guard's name. It is a MARK, not a hue,
    // so a selection is still visible on a black-and-white printer and to a reader who
    // cannot separate the four palette values. Hidden until its radio is checked.
    labels.push(`<rect class="ring" x="${(lx - 2.5).toFixed(1)}" y="${(lt - 2.5).toFixed(1)}" width="${(lw + 5).toFixed(1)}" height="${LABEL_H + 5}" fill="none" stroke="var(--fg)" stroke-width="1.5"/>`);
    hots.push({ sym: c.sym, x: lx - 2.5, y: lt - 2.5, w: lw + 5, h: LABEL_H + 5 });
    const g = `cx cx-${slug(c.sym)}`;
    edgeGroups.push(`<g class="${g}">${edges.join("")}</g>`);
    labelGroups.push(`<g class="${g}">${labels.join("")}</g>`);
  }

  const boxes = regions.map((r) =>
    `<rect x="${X.get(r)}" y="${Y.get(r)}" width="${wOf(r)}" height="${H.get(r)}" fill="var(--bg)" stroke="var(--fg)" stroke-width="1"/>`
    + `<text x="${X.get(r)! + wOf(r) / 2}" y="${(cy(r) + 4).toFixed(1)}" class="bl" text-anchor="middle">${esc(r)}</text>`).join("");

  // THE LEGEND ONLY NAMES WHAT IS ON THE PAGE. A treatment with no subjects here would be
  // teaching a vocabulary this project does not use.
  const seenTiers = [...new Set(cs.map((c) => c.tier))].sort();
  const leg: string[] = [];
  let lgx = EDGE_PAD;
  const ly0 = height - LEGEND_H / 2;
  for (const t of seenTiers) {
    const label = TIER_NAME[t] ?? `tier-${t}`;
    leg.push(`<line x1="${lgx}" y1="${ly0}" x2="${lgx + 24}" y2="${ly0}" stroke="var(--fg)" stroke-width="2"${DASH[t] ? ` stroke-dasharray="${DASH[t]}"` : ""}/>`,
      `<text x="${lgx + 29}" y="${ly0 + 3.5}" class="el dim">${esc(label)}</text>`);
    lgx += 29 + textW(label, EDGE_FS) + 20;
  }
  if (cs.some((c) => c.security)) {
    leg.push(`<path d="M${lgx + 5},${ly0} l4.5,-4.5 l4.5,4.5 l-4.5,4.5 Z" fill="var(--fg)"/>`,
      `<text x="${lgx + 20}" y="${ly0 + 3.5}" class="el dim">security crossing</text>`);
    lgx += 20 + textW("security crossing", EDGE_FS) + 20;
  }
  const heatText = cs.every((c) => c.heat === null)
    ? "line weight — heat UNRECORDED, every line is thin for that reason"
    : `line weight = change heat${cs.some((c) => c.heat === null) ? " (thinnest = unrecorded, not cold)" : ""}`;
  leg.push(`<text x="${lgx}" y="${ly0 + 3.5}" class="el dim">${esc(heatText)}</text>`);

  const svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="crossings diagram">`
    + edgeGroups.join("") + boxes + labelGroups.join("") + leg.join("") + `</svg>`;
  return { svg, regions, hots, w: width, h: height };
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
// them. What it is NOT is a table: an intent line squeezed into a cell wraps to four words
// per line and stops being readable, so the prose gets its own row at its own measure and
// the numbers go beside the NAME where they are a caption rather than a column.
//
// THE ORDER IS THE TEACHING. Perimeter first — the components that own a trust crossing,
// most-held first — then the interior, which owns none. See index-model.ts's sort.

/** The compact numbers beside an organ's name. Small enough to read as a caption, and each
 *  still carries the denominator that makes it mean anything. */
function organNums(c: IndexComponent): string {
  const grades = (["A", "B", "C", "D", "U"] as const)
    .filter((g) => c.grades[g] > 0).map((g) => `${c.grades[g]}${g}`).join(" ");
  return [
    `${c.files}f`,
    `${c.lines}L`,
    `${c.gates} gate(s)${grades ? ` ${grades}` : ""}`,
    `${c.witnessed}/${c.invariants} witnessed`,
    c.naked ? `<span class="warn">! ${c.naked} naked</span>` : "",
    c.breaches ? `<span class="alarm">!! ${c.breaches} breach(es)</span>` : "",
  ].filter(Boolean).join(' <span class="dim">·</span> ');
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
    ? `<label for="g-${slug(sym)}" class="chip chip-${slug(sym)}">${esc(sym)}</label>`
    : `<span class="chip held" title="held back by the crossings cap — it is in the table below, not on the picture">${esc(sym)}</span>`;

  const row = (c: IndexComponent) => {
    const sev: Sev = c.breaches > 0 ? "alarm" : c.naked > 0 || c.invariants > c.anchored ? "warn" : "quiet";
    const name = c.guards.length
      ? `<label for="o-${slug(c.dir)}" class="oname">${esc(c.label)}</label>`
      : `<span class="oname flat">${esc(c.label)}</span>`;
    return `<div class="org org-${slug(c.dir)}">`
      + `<div class="ohead"><span class="omk ${sev}">${MARK[sev]}</span>${name}`
      + `<span class="odir dim">${esc(c.dir)}</span>`
      + `<span class="onum dim">${organNums(c)}</span></div>`
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

  const band = (label: string, note: string, xs: IndexComponent[]) => xs.length
    ? `<div class="band"><div class="bhead">${esc(label)} <span class="dim">${esc(note)}</span> <span class="ct">${xs.length}</span></div>${xs.map(row).join("")}</div>`
    : "";

  return `<div class="roster">`
    + (mp.atlas && mp.crossings.total
      ? band("perimeter", "owns a trust crossing — most held first", perimeter)
        + band("interior", "owns none", interior)
      : `<div class="band">${cs.map(row).join("")}</div>`)
    + split + `</div>`;
}

/** THE MAP TAB. Six objects: the figure, one summary line, the ORGAN ROSTER, one drill
 *  strip — plus the masthead and the tab bar that every tab shares. */
function mapTab(m: IndexModel): string {
  const mp = m.map;
  const d = diagram(mp.crossings.shown);
  const a = mp.atlas;

  // THE HOTSPOTS. One `<label>` per guard, absolutely positioned over the plate the layout
  // already computed for that guard's name — the only way to make an arrow clickable
  // without script, because `<label>` is not valid inside SVG. The coordinates are the
  // SVG's own pixels and the SVG is emitted at its natural size, so they cannot drift.
  const hot = (h: { sym: string; x: number; y: number; w: number; h: number }) =>
    `<label for="g-${slug(h.sym)}" class="hot" style="left:${h.x.toFixed(1)}px;top:${h.y.toFixed(1)}px;width:${h.w.toFixed(1)}px;height:${h.h}px" title="${esc(h.sym)} — who owns this crossing"></label>`;

  const figure = d
    ? `<div class="figure"><div class="fwrap" style="width:${d.w}px;height:${d.h}px">${d.svg}${d.hots.map(hot).join("")}</div></div>`
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
    ? ` <span class="dim">·</span> <span class="dim">click a guard, or an organ below</span> <label for="sel-all" class="clear">show all</label>`
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

  // THE SELECTION GROUP — one radio per selectable organ and one per drawn guard, plus the
  // reset that is checked in the markup. They must PRECEDE the figure and the roster: the
  // whole mechanism is `#id:checked ~ .figure` / `~ .roster`, and a sibling combinator only
  // looks forwards. One group, not two, because the selection is ONE thing at a time —
  // checkboxes would allow "web and auth and Patient", for which "dim the rest" means
  // nothing.
  const drawn = new Set(mp.crossings.shown.map((c) => c.sym));
  const radios = `<input type="radio" name="orgsel" id="sel-all" class="tog" checked>`
    + mp.components.filter((c) => c.guards.length).map((c) => `<input type="radio" name="orgsel" id="o-${slug(c.dir)}" class="tog msel">`).join("")
    + mp.crossings.shown.map((c) => `<input type="radio" name="orgsel" id="g-${slug(c.sym)}" class="tog msel">`).join("");

  // WHO OWNS THE SELECTED ARROW, one line per guard, revealed by that guard's radio. This
  // is the second direction of the join: the diagram alone can say where a crossing runs
  // and never which organ holds it.
  const owners = mp.crossings.shown.map((c) => {
    const who = c.owner
      ? `<b>${esc(c.owner)}</b> <span class="dim">owns this crossing —</span> ${esc(c.from)} <span class="dim">&rarr;</span> ${esc(c.to)}<span class="dim">, tier-${c.tier}${c.security ? ", security" : ""}</span>`
      : `<span class="warn">! no organ owns this crossing.</span> <span class="dim">${esc(c.ownerWhy ?? "")}</span>`;
    return `<p class="own own-${slug(c.sym)}"><span class="lbl">${esc(c.sym)}</span> ${who}</p>`;
  }).join("");

  return radios + figure + summary + owners + roster(mp, drawn) + `<div class="drill">${strip}`
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
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0e0f11; --fg: #d6d9de; --dim: #868d97; --rule: rgba(255,255,255,.17);
          --warn: #cf9a37; --alarm: #e2726b; --flat: rgba(255,255,255,.045); }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 13px/1.55 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  -webkit-font-smoothing: antialiased;
}
main { max-width: 1180px; margin: 0 auto; padding: 1.6rem 1.4rem 5rem; overflow-x: hidden; }
h1 { font-size: 1.05rem; font-weight: 700; margin: 0; letter-spacing: .02em; }
p { margin: .4rem 0; }
code { font: inherit; }
b { font-weight: 700; }
.dim { color: var(--dim); }
.warn { color: var(--warn); }
.alarm { color: var(--alarm); }
.fgb { color: var(--fg); font-weight: 700; }
.mono { font-variant-ligatures: none; }
.sub { font-size: .92em; font-weight: 400; }

/* ── the masthead: a title, a status MARK, and nothing else ─────────────────────────── */
.mast { border-bottom: 1px solid var(--fg); padding-bottom: .5rem; }
.top { display: flex; flex-wrap: wrap; gap: .4rem 1.2rem; align-items: baseline; }
.badge { cursor: pointer; border: 1px solid var(--rule); padding: 0 .5rem; letter-spacing: .04em;
         font-size: .92em; user-select: none; }
.badge::after { content: " \\25B8"; }
#x-src:checked ~ .top .badge::after { content: " \\25BE"; }
.tabs { display: flex; flex-wrap: wrap; gap: .2rem 1.6rem; align-items: baseline; margin-top: .7rem; }
.tabs a { color: var(--dim); text-decoration: none; letter-spacing: .18em; font-size: .8rem;
          font-weight: 700; padding-bottom: .15rem; border-bottom: 2px solid transparent; }
.tabs .stamp { margin-left: auto; color: var(--dim); font-size: .88em; letter-spacing: 0; }

/* ── tabs: :target, so a tab is a linkable URL and no script is needed ──────────────── */
/* A TAB IS A HASH, so the browser scrolls the section into view — and would scroll the
   masthead off the top, taking the title, the honesty mark and the tab bar with it. The
   margin is larger than the page's own offset, so the scroll clamps to zero and switching
   tabs never moves the reader. */
.view { display: none; padding-top: 1.4rem; scroll-margin-top: 100vh; }
.view:target { display: block; }
body:not(:has(.view:target)) #map { display: block; }
body:not(:has(.view:target)) .tabs a[href="#map"],
body:has(#map:target) .tabs a[href="#map"],
body:has(#journal:target) .tabs a[href="#journal"],
body:has(#trajectory:target) .tabs a[href="#trajectory"] { color: var(--fg); border-bottom-color: var(--fg); }

/* ── the disclosure: a hidden control, a one-line strip of terms, panels below ──────── */
.tog { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.drill { margin-top: 1.4rem; border-top: 1px solid var(--rule); padding-top: .7rem;
         display: flex; flex-wrap: wrap; gap: .3rem 1.5rem; align-items: baseline; }
.term { cursor: pointer; user-select: none; letter-spacing: .08em; text-transform: uppercase;
        font-size: .76rem; font-weight: 700; }
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

/* ── the figure ─────────────────────────────────────────────────────────────────────── */
.figure { overflow-x: auto; margin: 0 0 1rem; }
.figure svg { display: block; }
.fwrap { position: relative; }
svg text.bl { font: 700 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: var(--fg); }
svg text.el { font: 400 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
svg text.el.dim { fill: var(--dim); }
.sum { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding: .5rem 0; margin: 0; }
.clear { cursor: pointer; user-select: none; border: 1px solid var(--rule); padding: 0 .45rem;
         margin-left: .6rem; font-size: .88em; }

/* ── SELECTION: one radio group over organs AND guards, no script ───────────────────────
   The hit areas for the arrows are HTML labels laid over the SVG at the same pixel
   coordinates the layout used to place each guard's name — <label> is not valid inside SVG,
   and this is the only way an arrow becomes clickable in a document with no script.
   THE HIGHLIGHT IS NOT COLOUR: the unselected crossings fade (a TONE change, which is what
   greyscale preserves) and the selected one gains a drawn RING around its name. Either one
   alone would survive a black-and-white printer; the pair is unmistakable. */
.hot { position: absolute; cursor: pointer; }
.hot:focus-visible { outline: 1px solid var(--fg); outline-offset: 1px; }
.cx .ring { display: none; }
#map:has(.msel:checked) .cx { opacity: .13; }
.own { display: none; border-left: 3px solid var(--fg); padding-left: .8rem; margin: .5rem 0 0; }
.own .lbl { display: inline-block; min-width: 18ch; font-weight: 700; }

/* ── the ORGAN ROSTER: one block, N rows, the prose at its own measure ──────────────────
   NOT a table. An intent line in a cell wraps to four words and stops being prose, which
   is the whole reason this exists — so the sentence gets its own row and its own measure,
   and the numbers sit beside the name as a caption. */
.roster { margin-top: 1.5rem; }
.band { margin-bottom: 1.1rem; }
.bhead { display: flex; flex-wrap: wrap; gap: 0 .8rem; align-items: baseline;
         font-size: .76rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
         border-bottom: 1px solid var(--fg); padding-bottom: .25rem; margin-bottom: .5rem; }
.bhead .dim { font-weight: 400; letter-spacing: .04em; text-transform: none; font-size: .95em; }
.bhead .ct { margin-left: auto; font-weight: 400; color: var(--dim); }
.org { border-left: 3px solid transparent; padding: .45rem 0 .55rem .7rem;
       border-bottom: 1px solid var(--rule); }
.org:last-child { border-bottom: 0; }
.ohead { display: flex; flex-wrap: wrap; gap: 0 .8rem; align-items: baseline; }
.omk { width: 2ch; font-weight: 700; }
.omk.warn { color: var(--warn); }
.omk.alarm { color: var(--alarm); }
.oname { font-weight: 700; cursor: pointer; }
.oname.flat { cursor: default; }
label.oname { text-decoration: underline; text-underline-offset: 3px;
              text-decoration-color: var(--rule); }
.odir { font-size: .9em; }
.onum { font-size: .9em; margin-left: auto; text-align: right; }
/* THE POINT OF THE WHOLE BLOCK. A readable measure, not a column: ~78 characters is where
   monospace prose stops being a shape and starts being a sentence. */
.ointent { max-width: 78ch; margin: .3rem 0 0 2ch; }
.ochips { margin: .35rem 0 0 2ch; display: flex; flex-wrap: wrap; gap: .25rem .4rem; }
.chip { border: 1px solid var(--rule); padding: 0 .4rem; font-size: .88em; cursor: pointer;
        user-select: none; }
.chip.held { cursor: default; color: var(--dim); border-style: dashed; }
.rsplit { border-top: 1px solid var(--rule); padding-top: .55rem; max-width: 82ch; }

/* ── the timeline ───────────────────────────────────────────────────────────────────── */
.tl { margin-top: 1.4rem; }
.lanes { border-left: 1px solid var(--rule); border-right: 1px solid var(--rule); }
.lrow { display: grid; grid-template-columns: 13ch 5ch 1fr; align-items: center;
        border-bottom: 1px solid var(--rule); }
.lrow:last-child { border-bottom: 0; }
.lrow .ln { font-size: .76rem; letter-spacing: .1em; text-transform: uppercase; font-weight: 700;
            padding-left: .4rem; white-space: nowrap; }
.lrow.fr { border-bottom: 0; }
.fr .track { height: 17px; }
.fr .tc { position: absolute; top: 0; font-size: .82em; color: var(--fg); white-space: nowrap; }
.fr .tc.right { transform: translateX(-100%); }
.lrow .ct { color: var(--dim); font-size: .9em; text-align: right; padding-right: .8rem; }
.track { position: relative; height: 30px; }
.axis .track { height: 18px; }
.axis .t0, .axis .t1 { position: absolute; top: 1px; color: var(--dim); font-size: .84em; white-space: nowrap; }
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
.detail { margin-top: 1rem; border-top: 1px solid var(--rule); padding-top: .8rem; max-width: 92ch; min-height: 7rem; }
.detail .d { display: none; }
.tl:has(.tog:checked) .hint { display: none; }
.detail .meta { font-size: .9em; letter-spacing: .04em; margin-bottom: .35rem; }
.detail .meta > span { margin-right: .8rem; }
.detail .meta > span:first-child { font-weight: 700; }
.detail .chose { margin: .25rem 0; }
.detail .because { color: var(--dim); margin: .2rem 0; }
.detail .lbl { display: inline-block; min-width: 11ch; color: var(--dim); font-size: .88em;
               letter-spacing: .1em; text-transform: uppercase; }

/* ── tables (drill-down only; nothing tabular is above the fold) ─────────────────────── */
table.grid { width: 100%; border-collapse: collapse; margin: .5rem 0 .2rem; }
table.grid th { text-align: left; font-weight: 400; color: var(--dim); font-size: .92em;
                padding: .25rem .7rem .3rem 0; border-bottom: 1px solid var(--rule); white-space: nowrap; }
table.grid td { padding: .32rem .7rem .32rem 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
table.grid tr:last-child td { border-bottom: 0; }
table.grid td.n, table.grid th.n { text-align: right; padding-right: 1rem; white-space: nowrap; }
table.grid td.k { font-weight: 700; }
table.grid td.g { letter-spacing: .06em; white-space: nowrap; }
/* THE MARK COLUMN: the severity encoding that survives greyscale and a black-and-white
   printer. Colour in these tables only ever REINFORCES what this column already says. */
td.mk { width: 2.2ch; padding-right: .5rem; font-weight: 700; text-align: left; }
td.mk.warn { color: var(--warn); }
td.mk.alarm { color: var(--alarm); }
td.ev { width: 2ch; font-weight: 700; }
td.evk { width: 11ch; color: var(--dim); font-size: .9em; letter-spacing: .08em; text-transform: uppercase; }
.scroll { overflow-x: auto; }
.worst { margin: .35rem 0 .1rem; color: var(--dim); font-size: .94em; }
.withheld { color: var(--dim); font-size: .94em; margin: .35rem 0; }
.collapsed { color: var(--dim); margin: .3rem 0 .6rem; }
.none { color: var(--dim); border-left: 1px solid var(--rule); padding-left: .9rem; margin: .6rem 0; }
.series { letter-spacing: .1em; }
.lbl-inline { display: inline-block; min-width: 21ch; letter-spacing: .1em; text-transform: uppercase; font-size: .88em; }
.trend { margin-top: 1.6rem; border-top: 1px solid var(--rule); padding-top: .7rem; }
.trend > div { margin: .2rem 0; }
footer { margin-top: 3.5rem; padding-top: .8rem; border-top: 1px solid var(--rule);
         color: var(--dim); font-size: .92em; }

/* ── PRINT IS THE WHOLE DOCUMENT. Hiding two thirds of the page on paper would make the
      greyscale test a test of one tab. Everything opens; nothing is lost to a fold. ──── */
@media print {
  :root { --bg: #fff; --fg: #000; --dim: #555; --rule: rgba(0,0,0,.35); --warn: #000; --alarm: #000; }
  body { font-size: 10px; }
  main { max-width: none; }
  .view, .panel, .detail .d, .own { display: block !important; }
  .view { page-break-before: always; }
  .tabs, .term, .badge, .clear { display: none; }
  .figure svg { max-width: 100%; height: auto; }
  .hint { display: none; }
  /* A SELECTION IS SCREEN STATE, and paper has none: every crossing comes back to full
     weight and every owner line prints, so the paper copy is the whole document however
     the reader left the screen. The hotspots go with it — the SVG is scaled to the page
     and pixel-positioned overlays would no longer sit on their own labels. */
  #map:has(.msel:checked) .cx { opacity: 1 !important; }
  .hot { display: none; }
  .org { break-inside: avoid; }
}
`;

/**
 * THE SELECTION RULES — one small block of CSS per selectable organ and per drawn guard.
 *
 * GENERATED, because the join is per-project data and a static stylesheet cannot name
 * `verifySession`. It follows the page's existing rule exactly (`#e-<id>:checked ~ .detail
 * .d-<id>` for journal records): a rule is emitted ONLY for something the page actually
 * carries, so a control can never point at nothing.
 *
 * BOTH DIRECTIONS FALL OUT OF ONE RADIO GROUP. Selecting an organ un-dims the crossings it
 * owns and rings their names; selecting a guard un-dims that one, rings it, marks its chip,
 * marks its owner's row in the roster and reveals the sentence naming that owner. There is
 * no third mechanism and no script — `:checked` plus the sibling combinator is the whole of
 * it, which is why it survives with scripting off.
 */
function selectionRules(m: IndexModel): string {
  const mp = m.map;
  const drawn = new Set(mp.crossings.shown.map((c) => c.sym));
  // guard → the DIR of the component that owns it, inverted from the roster's own `guards`
  // arrays rather than looked up by label: two components may share a label, and no page
  // element is keyed by one.
  const dirOf = new Map<string, string>();
  for (const c of mp.components) for (const g of c.guards) dirOf.set(g, c.dir);

  const out: string[] = [];
  const SEL = "border-left-color:var(--fg)";
  const ON = "opacity:1";

  for (const c of mp.components) {
    const gs = c.guards.filter((g) => drawn.has(g));
    if (!gs.length) continue;
    const id = `#o-${slug(c.dir)}:checked`;
    out.push(`${gs.map((g) => `${id} ~ .figure .cx-${slug(g)}`).join(",")}{${ON}}`);
    out.push(`${gs.map((g) => `${id} ~ .figure .cx-${slug(g)} .ring`).join(",")}{display:block}`);
    out.push(`${id} ~ .roster .org-${slug(c.dir)}{${SEL}}`);
    out.push(`${id} ~ .roster .org-${slug(c.dir)} .chip{border-color:var(--fg);font-weight:700}`);
  }

  for (const x of mp.crossings.shown) {
    const t = slug(x.sym), id = `#g-${t}:checked`;
    out.push(`${id} ~ .figure .cx-${t}{${ON}}`);
    out.push(`${id} ~ .figure .cx-${t} .ring{display:block}`);
    out.push(`${id} ~ .own-${t}{display:block}`);
    out.push(`${id} ~ .roster .chip-${t}{border-color:var(--fg);font-weight:700}`);
    const d = dirOf.get(x.sym);
    if (d !== undefined) out.push(`${id} ~ .roster .org-${slug(d)}{${SEL}}`);
  }
  return out.join("\n");
}

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
  const dyn = [...ids].map((id) => `#e-${id}:checked ~ .detail .d-${id}{display:block}`).join("\n")
    + "\n" + selectionRules(m);

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
</main></body></html>
`;
}
