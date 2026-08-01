// render-index.ts — IndexModel → one self-contained `_index.html`.
//
// A PURE FUNCTION OF THE MODEL. `index.json` is written beside this page, so every figure
// rendered here is checkable against a file a `jq` one-liner can read; the render invents
// nothing, reads no clock (the stamp arrives in the model) and touches no disk.
//
// ── THE FORM, AND WHY IT IS THIS AUSTERE ──────────────────────────────────────────────
//
// The reference points are a SPEC SHEET, `git log --graph`, and an instrument readout —
// not a dashboard and not a marketing page. Concretely, and each of these is a constraint
// rather than a taste:
//
//   · MONOSPACE THROUGHOUT, system stack. Everything on this page is tabular — counts
//     against denominators, grades, tiers, commit ids — and a proportional face breaks the
//     column alignment that makes a table readable at a glance.
//   · HAIRLINE RULES AND WHITESPACE do the separating. No cards, no rounding, no shadows,
//     no gradients, no animation. A border-radius is an invitation to add a second one.
//   · COLOUR IS DATA ENCODING ONLY, NEVER DECORATION, and the palette is four values:
//     foreground, dim, warn, alarm. Nothing else may use them.
//   · IT MUST READ PRINTED IN GREYSCALE. That is the actual test of the previous rule: if
//     a distinction disappears without colour, it was never encoded. So every coloured
//     thing ALSO carries its distinction as text — the grade letter, the tier number, the
//     word `FAIL`, and a leading MARK column (`!` attention, `!!` alarm) that survives any
//     desaturation. Colour reinforces; it never carries.
//   · LIGHT AND DARK ARE BOTH FIRST-CLASS via `prefers-color-scheme`. Neither is the
//     "real" one with the other bolted on.
import type {
  IndexModel, IndexEntry, Darkness, Capped, IndexGate, IndexComponent, SourceRead,
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

// ── the sources strip ─────────────────────────────────────────────────────────────────

/** WHAT WAS READ, AND WHAT WAS NOT — first, above every view, because it is the frame
 *  every number below sits in. An unread source makes its section EMPTY, and an empty
 *  section that does not announce why reads as health. */
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

// ── I. MAP ────────────────────────────────────────────────────────────────────────────

function componentsTable(cs: IndexComponent[]): string {
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

function crossingsSection(m: IndexModel["map"]): string {
  if (!m.atlas) {
    return `<p class="none">No atlas reading is recorded. Either this project declares no <code>atlas</code> config, or <code>coherence atlas</code> has never run here. <b>This table is empty because nothing was read, not because there are no crossings.</b></p>`;
  }
  const a = m.atlas;
  const flags = `<p class="dim">Recorded ${day(a.at)}${a.stale ? ' <span class="warn">— at another commit; this is the last known reading, not the present one</span>' : ""} · `
    + `tiers ${a.tiers.enshrined} enshrined / ${a.tiers.checked} totality-checked / ${a.tiers.convention} convention · `
    + `${a.drift} drift · ${a.dangling} dangling · ${a.overclaimed} over-claimed · ${a.hazards.length} inference hazard(s)</p>`;
  const row = (c: IndexModel["map"]["crossings"]["shown"][number]) => {
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

// ── II. JOURNAL ───────────────────────────────────────────────────────────────────────

function entryList(c: Capped<IndexEntry>, sev: Sev, noun: string, emptyLine: string): string {
  if (!c.total) return `<p class="none">${esc(emptyLine)}</p>`;
  const one = (e: IndexEntry) => `<article class="entry ${e.news ? `news ${sev}` : "old"}">
    <div class="meta"><span class="${e.news ? sev : "dim"}">${e.news ? "NEW" : "standing"}</span>
      <span class="dim">${day(e.at)} · ${esc(e.agent)} · ${esc(e.commit ?? "no-commit")} · ${esc(e.id)}</span></div>
    <div class="chose">${esc(e.chose)}</div>
    ${e.because ? `<div class="because"><span class="lbl">because</span> ${esc(e.because)}</div>` : ""}
    ${e.over.length ? `<div class="because"><span class="lbl">over</span> ${e.over.map(esc).join(" <span class=\"dim\">·</span> ")}</div>` : ""}
    ${e.couldBe.length ? `<div class="because"><span class="lbl">could be</span> ${e.couldBe.map(esc).join(" <span class=\"dim\">·</span> ")}</div>` : ""}
    ${e.discriminatedBy ? `<div class="because"><span class="lbl">settled by</span> ${esc(e.discriminatedBy)}</div>` : ""}
  </article>`;
  return c.shown.map(one).join("") + tail(c, noun);
}

// ── III. TRAJECTORY ───────────────────────────────────────────────────────────────────

function structuralSection(m: IndexModel): string {
  const t = m.trajectory;
  if (!t.structural) {
    return `<p class="none">No structural diff: ${esc(t.structuralWhy ?? "no frame to compare against.")}</p>`;
  }
  const s = t.structural;
  if (!s.changes && !s.claimDelta.length) {
    return `<p class="none">The invariant/boundary set is UNCHANGED across this frame. Whatever the agents did, they did it without adding, removing or rewiring a single anchor — which is either careful work inside existing boundaries, or growth that acquired no enforcement. <code>coherence signal</code> is the verb that distinguishes them.</p>`;
  }
  const lines: string[] = [];
  const block = (title: string, sev: Sev, rows: string[], c: Capped<unknown>, noun: string) => {
    if (!c.total) return;
    lines.push(`<tr class="head"><th colspan="2">${esc(title)} <span class="dim">(${c.total})</span></th></tr>`);
    for (const r of rows) lines.push(`<tr>${mark(sev)}<td>${r}</td></tr>`);
    if (c.withheld) lines.push(`<tr><td></td><td class="withheld">… ${c.withheld} more ${esc(noun)} not shown</td></tr>`);
  };
  block("components removed", "alarm", s.componentsRemoved.shown.map(esc), s.componentsRemoved, "component(s)");
  block("invariants removed", "alarm", s.invRemoved.shown.map((x) => `<span class="k">${esc(x.inv)}</span> <span class="dim">${esc(x.comp)}</span>`), s.invRemoved, "invariant(s)");
  block("boundary anchors removed", "alarm", s.boundaryRemoved.shown.map((x) => `<span class="k">${esc(x.inv)}</span> <span class="dim">at ${esc(x.chokepoint)} · ${esc(x.comp)}</span>`), s.boundaryRemoved, "anchor(s)");
  block("boundaries rewired", "warn", s.boundaryRewired.shown.map((x) => `<span class="k">${esc(x.inv)}</span><div class="dim sub">${esc(x.before)} → ${esc(x.after)}</div>`), s.boundaryRewired, "boundary(s)");
  block("components added", "quiet", s.componentsAdded.shown.map(esc), s.componentsAdded, "component(s)");
  block("invariants added", "quiet", s.invAdded.shown.map((x) => `<span class="k">${esc(x.inv)}</span> <span class="dim">${esc(x.comp)}</span>`), s.invAdded, "invariant(s)");
  block("boundary anchors added", "quiet", s.boundaryAdded.shown.map((x) => `<span class="k">${esc(x.inv)}</span> <span class="dim">at ${esc(x.chokepoint)} · ${esc(x.comp)}</span>`), s.boundaryAdded, "anchor(s)");

  const claims = s.claimDelta.length
    ? `<p class="dim">${s.claimDelta.reduce((n, c) => n + c.added + c.removed, 0)} non-boundary claim change(s) across ${s.claimDelta.length} component(s): `
      + s.claimDelta.map((c) => `${esc(c.comp)} +${c.added}/−${c.removed}`).join(" · ") + "</p>"
    : "";
  return `<p class="lede"><b>${s.changes}</b> structural change(s), <b class="${s.losses ? "alarm" : ""}">${s.losses}</b> loss(es) — a removed invariant, boundary anchor, parity anchor or component.</p>`
    + `<table class="grid ledger"><tbody>${lines.join("")}</tbody></table>${claims}`;
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
main { max-width: 108ch; margin: 0 auto; padding: 2.2rem 1.4rem 5rem; }
h1 { font-size: 1.05rem; font-weight: 700; margin: 0; letter-spacing: .02em; }
h2 { font-size: .78rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
     margin: 3.2rem 0 .2rem; padding-bottom: .35rem; border-bottom: 1px solid var(--fg); }
h3 { font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
     color: var(--dim); margin: 1.8rem 0 .4rem; }
p { margin: .4rem 0; }
code { font: inherit; }
b { font-weight: 700; }
.dim { color: var(--dim); }
.warn { color: var(--warn); }
.alarm { color: var(--alarm); }
.mono { font-variant-ligatures: none; }
.sub { font-size: .92em; font-weight: 400; }
.lede { color: var(--dim); margin: .1rem 0 1.4rem; }
.rule { border: 0; border-top: 1px solid var(--rule); margin: 1.6rem 0; }

/* the masthead */
.head { display: flex; flex-wrap: wrap; gap: .5rem 1.4rem; align-items: baseline;
        border-bottom: 1px solid var(--fg); padding-bottom: .6rem; }
.head .stamp { color: var(--dim); font-size: .92em; }

/* the frame banner — a strip, not a card: one rule top and bottom, no fill, no radius */
.frame { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
         padding: .7rem 0; margin: 1.4rem 0 0; }
.frame .kind { font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }

/* tables — the whole page is one */
table.grid { width: 100%; border-collapse: collapse; margin: .5rem 0 .2rem; }
table.grid th { text-align: left; font-weight: 400; color: var(--dim); font-size: .92em;
                padding: .25rem .7rem .3rem 0; border-bottom: 1px solid var(--rule); white-space: nowrap; }
table.grid td { padding: .32rem .7rem .32rem 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
table.grid tr:last-child td { border-bottom: 0; }
table.grid td.n, table.grid th.n { text-align: right; padding-right: 1rem; white-space: nowrap; }
table.grid td.k { font-weight: 700; }
table.grid td.g { letter-spacing: .06em; white-space: nowrap; }
table.grid tr.head th { padding-top: 1rem; border-bottom: 1px solid var(--rule); color: var(--fg);
                        font-weight: 700; letter-spacing: .1em; text-transform: uppercase; font-size: .74rem; }
/* THE MARK COLUMN: the severity encoding that survives greyscale and a black-and-white
   printer. Colour on this page only ever REINFORCES what this column already says. */
td.mk { width: 2.2ch; padding-right: .5rem; font-weight: 700; text-align: left; }
td.mk.warn { color: var(--warn); }
td.mk.alarm { color: var(--alarm); }
.scroll { overflow-x: auto; }

/* journal entries */
.entry { border-top: 1px solid var(--rule); padding: .7rem 0 .7rem .9rem; border-left: 1px solid transparent; }
.entry.news.alarm { border-left: 2px solid var(--alarm); }
.entry.news.warn { border-left: 2px solid var(--warn); }
.entry.news.quiet { border-left: 2px solid var(--dim); }
.entry.old { padding-left: .9rem; opacity: .78; }
.entry .meta { font-size: .92em; letter-spacing: .04em; }
.entry .meta > span:first-child { font-weight: 700; margin-right: .6rem; }
.entry .chose { margin: .25rem 0; }
.entry .because { color: var(--dim); margin: .15rem 0; }
.entry .lbl { display: inline-block; min-width: 11ch; color: var(--dim); font-size: .88em;
              letter-spacing: .1em; text-transform: uppercase; }

.worst { margin: .35rem 0 .1rem; color: var(--dim); font-size: .94em; }
.withheld { color: var(--dim); font-size: .94em; margin: .35rem 0; }
.collapsed { color: var(--dim); margin: .3rem 0 .6rem; }
.none { color: var(--dim); border-left: 1px solid var(--rule); padding-left: .9rem; margin: .6rem 0; }
.series { letter-spacing: .1em; }
.lbl-inline { display: inline-block; min-width: 22ch; letter-spacing: .1em; text-transform: uppercase; font-size: .88em; }

footer { margin-top: 3.5rem; padding-top: .8rem; border-top: 1px solid var(--rule);
         color: var(--dim); font-size: .92em; }

@media print {
  :root { --bg: #fff; --fg: #000; --dim: #555; --rule: rgba(0,0,0,.35); --warn: #000; --alarm: #000; }
  body { font-size: 10px; }
  .entry.old { opacity: 1; }
  h2 { page-break-after: avoid; }
}
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
 *  disk, no network, and nothing on it that `index.json` does not already hold. */
export function renderIndex(m: IndexModel): string {
  const f = m.frame;
  const t = m.trajectory;
  const j = m.journal;

  const frameLine = f.kind === "first"
    ? `<span class="kind warn">first look</span> <span class="dim">— nothing to frame against.</span>`
    // The cursor's ref IS a commit id, so repeating it in parentheses would be furniture.
    : `<span class="kind">since</span> <b>${esc(f.ref ?? "")}</b>${f.commit && f.commit !== f.ref ? ` <span class="dim">(${esc(f.commit)})</span>` : ""}`
      + `<span class="dim"> · ${f.commits ?? "?"} commit(s) to HEAD · anything written before ${f.at ? day(f.at) : "?"} is standing, not news</span>`;

  const empty = m.empty
    ? `<p class="none"><b>There is nothing to show.</b> No component spec derived, no journal entries, and no git history to read.
       This is not a clean bill of health — it is an absence of evidence, and the page says so rather than rendering
       empty tables that would look like one. <code>coherence verify</code> prints the adoption ladder for this state.</p>`
    : "";

  const massBlock = t.mass
    ? `<p><span class="lbl-inline dim">net LOC per window</span> <span class="series">${esc(spark(t.mass.series))}</span>
       <span class="dim">oldest → newest, ${t.mass.series.length} windows, net ${t.mass.series.reduce((a, b) => a + b, 0)} lines ·
       recorded ${day(t.mass.at)}${t.mass.stale ? " at another commit" : ""}</span></p>`
    : `<p class="none">No mass series recorded. <code>coherence mass</code> has not run here, so the background growth trend this frame sits inside is UNREAD — not flat.</p>`;

  const driftBlock = t.drift
    ? `<p><span class="lbl-inline dim">locality</span> <span class="series">${esc(spark(t.drift.locality))}</span>
        ${esc(t.drift.localityArrow)} <span class="dim">${(t.drift.locality[0] * 100).toFixed(0)}% → ${(t.drift.locality[t.drift.locality.length - 1] * 100).toFixed(0)}% · co-change staying inside one component</span></p>
       <p><span class="lbl-inline dim">spread</span> <span class="series">${esc(spark(t.drift.spread))}</span>
        ${esc(t.drift.spreadArrow)} <span class="dim">${t.drift.spread[0].toFixed(1)} → ${t.drift.spread[t.drift.spread.length - 1].toFixed(1)} · distinct components per commit</span></p>
       <p class="dim">${esc(t.drift.verdict)} — recorded ${day(t.drift.at)}${t.drift.stale ? ", at another commit; the last known direction, not the present one" : ""}.</p>`
    : `<p class="none">No drift reading recorded. <code>coherence drift</code> has not run here, so the architectural direction is UNREAD — not flat.</p>`;

  const locBlock = t.loc
    ? `<p class="dim">Across the frame: <b>+${t.loc.added}</b> / <b>−${t.loc.deleted}</b> lines of code (net ${t.loc.added - t.loc.deleted}). Code lines are context, never the subject — the ledger above is.</p>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.project)} — index</title>
<style>${STYLE}</style></head>
<body><main>

<div class="head">
  <h1>${esc(m.project)}</h1>
  <span class="stamp">${esc(m.head.commit ?? "no commit")}${m.head.dirty ? " +dirty" : ""} · ${esc(m.generatedAt)}</span>
</div>
<p class="lede">${esc(m.intent)}</p>

<div class="frame">${frameLine}
  <div class="dim">${esc(f.why)}</div>
</div>

${empty}

<h3>sources</h3>
<div class="scroll">${sourcesTable(m.sources)}</div>

<h2>I · map — the structures as they stand</h2>
${m.map.zones.length
  ? `<p class="dim">zones, in declared order (declared order IS trust order): ${m.map.zones.map((z) => `<b>${esc(z.name)}</b>${z.inside ? ` <span class="dim">inside ${esc(z.inside)}</span>` : ""}`).join(" · ")}</p>`
  : `<p class="dim">No <code>## zones</code> declared, so no gate on this page can state what it separates and no reliance can be judged naked.</p>`}
<div class="scroll">${componentsTable(m.map.components)}</div>

<h3>gates — invariant → chokepoint → grade</h3>
<div class="scroll">${gatesTable(m.map.gates, m.map.gatesClean, m.map.gatesTotal)}</div>

<h3>crossings — where trust changes hands</h3>
<div class="scroll">${crossingsSection(m.map)}</div>

<h3>trust — the four darknesses, never merged</h3>
${trustSection(m.map.darknesses)}

<h2>II · journal — what the agents decided</h2>
<p class="lede">${j.totals.records} record(s) across ${j.totals.sessions} session(s)${j.totals.unreadable ? ` · <span class="alarm">${j.totals.unreadable} unreadable line(s) skipped</span>` : ""} ·
  <b>${j.news.blocked}</b> new impasse(s), <b>${j.news.open}</b> new open question(s), <b>${j.news.decisions}</b> new decision(s) in this frame.</p>

<h3>blocked — what an agent could not do <span class="dim">(${j.totals.blocked})</span></h3>
<p class="dim">First, deliberately. An agent recording that it could not do something is the highest-value line on this page, and no gate anywhere will ever report it.</p>
${entryList(j.blocked, "alarm", "impasse(s)", "No agent recorded an impasse. Either nothing blocked them, or nobody reached for `coherence blocked` — those are different facts and this record cannot tell them apart.")}

<h3>open questions <span class="dim">(${j.totals.open})</span></h3>
${entryList(j.open, "warn", "open question(s)", "No open conjectures. Nothing was noticed and left unchased — or nothing surprising was noticed.")}

<h3>standing decisions <span class="dim">(${j.totals.decisions})</span></h3>
${entryList(j.decisions, "quiet", "decision(s)", "No standing decisions recorded.")}

<p class="dim">Settled, collapsed to counts: ${j.settled.resolved} resolved · ${j.settled.dismissed} dismissed unanswered · ${j.settled.retracted} retracted${f.kind === "first" ? "" : ` · ${j.settled.inFrame} of those settled inside this frame`}.</p>

<h2>III · trajectory — movement at the level of the abstraction</h2>
<p class="lede">Not a commit list. What this frame did to the invariant/boundary set — the diff of the design, not of the code.</p>
${structuralSection(m)}
${locBlock}

<h3>the background trend</h3>
${massBlock}
${driftBlock}

<footer>
  Generated by <code>coherence index</code> at <span id="stamp">${esc(m.generatedAt)}</span> from the model beside it (<code>index.json</code>).
  Every figure here is a reading something else already took — this page derives nothing of its own.
  Do not edit by hand; re-run the harness.
</footer>
</main></body></html>
`;
}
