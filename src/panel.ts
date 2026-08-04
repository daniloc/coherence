// panel.ts — the operator's instrument panel: a zero-dependency TUI over the graph +
// the status record. Three altitudes in one screen: the MASTHEAD (identity, the
// enforcement-ladder tier bar, claim lights, freshness, drift arrows), the COMPONENT
// LIST (one row per node, worst-light-wins), and the DRILL-IN (the invariant →
// chokepoint → oracle table with per-row verdicts, plus a pager for the ## why).
//
// Honesty rules the lights: a verdict from another commit degrades to STALE (shown
// with its age, never re-badged green); a tier-skip renders as "not run", not as
// health; dialect-gap skips get their own mark (a typo'd verb must not vanish);
// `via guard` rows carry a "needs human eye" tag because the meta-oracle never
// analyzed them. The panel re-RUNS nothing in-process — it spawns the CLI (r/R keys,
// watch mode), lets the child file its report, and re-reads the record. That keeps
// judge and notary separate and the TUI's stdout clean.
//
// Rendering is a PURE function (model + ui + size → lines) so it tests on node:test
// like everything else; the interactive loop is a thin shell of raw-mode keypresses,
// alternate-screen repaints, and a debounced recursive fs.watch (phase 3).
import { spawn } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import * as readline from "node:readline";
import type { Config, Graph } from "./types.ts";
import { buildGraph } from "./derive.ts";
import { parseBoundary, claimKey } from "./boundary.ts";
import { readStatus, gitStamp, indexClaimRecords, type StatusRecord, type ClaimRecord } from "./status.ts";
import { spark, arrow } from "./drift.ts";

// ── the model: graph + record → what the panel shows ──────────────────────────────

export type LightKind = "pass" | "fail" | "stale" | "skip" | "none";

export interface Light {
  kind: LightKind;
  detail?: string;
  age?: string;            // "42s" / "5m" / "3d" — from the record's own stamp
  commit?: string | null;
  gap?: boolean;           // dialect-gap skip: a claim line no form recognized
}

export interface BoundaryRow { inv: string; chokepoint: string; verb: string; oracle: string; light: Light }
export interface PlainRow { claim: string; light: Light }

export interface CompRow {
  label: string; dir: string; intent: string; why: string;
  boundaries: BoundaryRow[];   // the invariant table
  unanchored: string[];        // ## invariants nothing anchors (the ratchet's reds)
  plain: PlainRow[];           // every non-boundary claim
  counts: Record<LightKind, number>;
  light: LightKind;            // worst-wins summary for the list row
}

export interface PanelModel {
  root: string; intent: string;
  head: string | null; dirty: boolean;
  comps: CompRow[];
  totals: Record<LightKind, number>;
  gaps: number;                // dialect-gap skips across the tree
  verify?: { at: string; tier: string; lastFastAt?: string; lastFullAt?: string; failures: number; jobs: number; commit: string | null; coverage: { components: number; claimed: number; withWhy: number }; invariants: { total: number; anchored: number } };
  /** `heat` is the atlas's per-crossing churn share, hottest first — the map's temperature.
   *  Absent (not zero) for a record whose crossings carry no reading. */
  atlas?: { at: string; tiers: { enshrined: number; checked: number; convention: number }; tier3Security: string[]; flags: number; heat?: Array<{ sym: string; heat: number }> };
  drift?: { at: string; locality: number[]; spread: number[]; verdict: string };
  /** THE WORK LEDGER'S OTHER HALF: what the last verify paid to keep the claims true, and the
   *  single most expensive claim. Straight from `status.verify.cost` — the panel re-runs
   *  nothing and times nothing itself (see the module header's contract). */
  cost?: { totalMs: number; top?: { node: string; claim: string; ms: number } };
}

/** How many rows the masthead occupies — 3, plus the ENERGY strip when the record carries
 *  cost or heat. Shared by the renderer and the interactive scroll math, which must agree
 *  about where the body starts or the cursor drifts out of the window by a row. */
export function mastheadHeight(m: PanelModel): number {
  return m.cost || (m.atlas?.heat && m.atlas.heat.length) ? 4 : 3;
}

export function humanAge(iso: string, now: Date): string {
  const s = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const isGapSkip = (r: ClaimRecord) => r.kind === "skip" && !!r.detail?.includes("dialect gap");

/** How many crossings the energy strip's heat spark covers — the hot head of the map, sized
 *  to a glyph run that still reads as a shape at masthead density. */
const PANEL_HEAT_N = 8;

/** A claim's light from its record. A PASS taken at another commit is STALE — last
 *  known green, honestly aged — never re-badged as current. FAIL/SKIP keep their kind
 *  (a fail from an old commit is still the worst known truth). */
export function lightFor(rec: ClaimRecord | undefined, head: string | null, now: Date): Light {
  if (!rec) return { kind: "none" };
  const age = humanAge(rec.at, now);
  const stale = head !== null && rec.commit !== null && rec.commit !== head;
  if (rec.kind === "pass" && stale) return { kind: "stale", detail: rec.detail, age, commit: rec.commit };
  return { kind: rec.kind, detail: rec.detail, age, commit: rec.commit, gap: isGapSkip(rec) || undefined };
}

const zeroCounts = (): Record<LightKind, number> => ({ pass: 0, fail: 0, stale: 0, skip: 0, none: 0 });

export function buildModel(graph: Graph, status: StatusRecord, head: { commit: string | null; dirty: boolean }, now: Date): PanelModel {
  const comps = graph.nodes.filter((n) => n.kind === "component");
  const rootNode = comps.find((c) => c.id === "c:.") ?? comps[0];
  // Keyed by claimKey (the branded identity), NEVER the raw string: a record written
  // before a boundary gained its `crossing` clause must still light the annotated row.
  const recBy = indexClaimRecords(status.verify?.claims ?? []);
  // Unanchored invariants: the record's gap list when a verify has run (authoritative —
  // it sees anchoring through `conforms to` words); a static parse as the cold-start
  // fallback so a never-verified tree still shows its ratchet reds.
  const gapsByComp = new Map<string, string[]>();
  if (status.verify) {
    for (const g of status.verify.invariants.gaps) gapsByComp.set(g.comp, [...(gapsByComp.get(g.comp) ?? []), g.inv]);
  } else {
    for (const c of comps) {
      const anchored = new Set((c.claims ?? []).map(parseBoundary).filter(Boolean).map((b) => b!.inv));
      const gaps = (c.invariants ?? []).filter((i) => !anchored.has(i));
      if (gaps.length) gapsByComp.set(c.label, gaps);
    }
  }

  const totals = zeroCounts();
  let gapCount = 0;
  const rows: CompRow[] = comps.map((c) => {
    const boundaries: BoundaryRow[] = [];
    const plain: PlainRow[] = [];
    const counts = zeroCounts();
    for (const claim of c.claims ?? []) {
      const light = lightFor(recBy.get(claimKey(c.label, claim)), head.commit, now);
      counts[light.kind]++; totals[light.kind]++;
      if (light.gap) { gapCount++; }
      const b = parseBoundary(claim);
      if (b) boundaries.push({ ...b, light });
      else plain.push({ claim, light });
    }
    const unanchored = gapsByComp.get(c.label) ?? [];
    const light: LightKind =
      counts.fail || unanchored.length ? "fail"
      : counts.stale ? "stale"
      : counts.pass ? "pass"
      : counts.skip || counts.none ? "none"
      : "none";
    return { label: c.label, dir: c.id.slice(2), intent: c.sub ?? "", why: c.why ?? "", boundaries, unanchored, plain, counts, light };
  });

  const v = status.verify;
  const a = status.atlas;
  const d = status.drift;
  return {
    root: graph.root, intent: rootNode?.sub ?? "",
    head: head.commit, dirty: head.dirty,
    comps: rows, totals, gaps: gapCount,
    verify: v && {
      at: v.at, tier: v.tier, lastFastAt: v.lastFastAt, lastFullAt: v.lastFullAt,
      failures: v.failures, jobs: v.jobs, commit: v.commit,
      coverage: { components: v.coverage.components, claimed: v.coverage.claimed, withWhy: v.coverage.withWhy },
      invariants: { total: v.invariants.total, anchored: v.invariants.anchored },
    },
    atlas: a && {
      at: a.at, tiers: a.tiers, tier3Security: a.tier3Security,
      flags: a.drift.length + a.dangling.length + a.overclaimed.length,
      // Hottest crossings first. Crossings with NO reading are dropped rather than sorted as
      // zero — an unmeasurable crossing is not a cold one, and the strip must not imply it is.
      heat: (() => {
        const h = a.crossings.filter((c) => typeof c.heat === "number").map((c) => ({ sym: c.sym, heat: c.heat as number }));
        return h.length ? h.sort((x, y) => y.heat - x.heat).slice(0, PANEL_HEAT_N) : undefined;
      })(),
    },
    drift: d && d.locality.length ? { at: d.at, locality: d.locality, spread: d.spread, verdict: d.verdict } : undefined,
    // The record's cost vector is already ranked (verify writes it most-expensive-first), so
    // `top` is its head — no re-ranking, no re-timing.
    cost: v?.cost && { totalMs: v.cost.totalMs, top: v.cost.claims[0] ? { node: v.cost.claims[0].node, claim: v.cost.claims[0].claim, ms: v.cost.claims[0].ms } : undefined },
  };
}

// ── the frame: pure render (model + ui + size → lines) ────────────────────────────

export interface UIState {
  view: "list" | "comp" | "why";
  cursor: number;              // selected component index
  scroll: number;              // body scroll offset (list or detail)
  whyScroll: number;
  watch: boolean;
  running: string | null;      // label of the child run in flight
  stream: string[];            // recent event lines, newest last
}

export const initialUI = (watchOn: boolean): UIState =>
  ({ view: "list", cursor: 0, scroll: 0, whyScroll: 0, watch: watchOn, running: null, stream: [] });

// Styling: tiny ANSI helpers, disabled wholesale for tests / non-TTY output. Padding
// happens on plain text BEFORE color wrapping so escape codes never skew widths.
// Exported for the journal stream (journal.ts), which is the panel's sibling TUI: two
// hand-rolled ANSI helpers is two chances for the padding-before-color rule to be
// forgotten in one of them.
export const sty = (colors: boolean) => {
  const w = (code: string) => (s: string) => colors ? `\x1b[${code}m${s}\x1b[0m` : s;
  return { red: w("31"), grn: w("32"), yel: w("33"), mag: w("35"), cyn: w("36"), dim: w("2"), bold: w("1"), inv: w("7") };
};
export type Sty = ReturnType<typeof sty>;

export const clip = (s: string, w: number) => s.length <= w ? s : (w <= 1 ? s.slice(0, w) : s.slice(0, w - 1) + "…");
export const padE = (s: string, w: number) => clip(s, w).padEnd(w);

const GLYPH: Record<LightKind, string> = { pass: "●", fail: "✗", stale: "◐", skip: "·", none: "○" };
function glyph(l: Light, S: Sty): string {
  if (l.gap) return S.mag("?");
  switch (l.kind) {
    case "pass": return S.grn("●");
    case "fail": return S.red("✗");
    case "stale": return S.yel("◐");
    case "skip": return S.dim("·");
    default: return S.dim("○");
  }
}

export function wrapText(text: string, w: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const words = para.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
    let line = "";
    for (const wd of words) {
      if (line && line.length + 1 + wd.length > w) { out.push(line); line = wd; }
      else line = line ? `${line} ${wd}` : wd;
    }
    if (line) out.push(line);
    out.push("");
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/** The enforcement ladder as one bar: enshrined █ · totality-checked ▓ · convention ░. */
function tierBar(t: { enshrined: number; checked: number; convention: number }, width: number, S: Sty): string {
  const total = t.enshrined + t.checked + t.convention;
  if (!total) return S.dim("░".repeat(width));
  const cells = (n: number) => Math.round((n / total) * width);
  let e = cells(t.enshrined), c = cells(t.checked);
  let v = Math.max(0, width - e - c);
  return S.cyn("█".repeat(e)) + S.grn("▓".repeat(c)) + (t.convention ? S.yel("░".repeat(v)) : S.dim("░".repeat(v)));
}

function masthead(m: PanelModel, S: Sty, cols: number, now: Date): string[] {
  const head = m.head ? `${m.head}${m.dirty ? "*" : ""}` : "no git";
  const t = m.totals;
  const claimBits = [
    S.grn(`●${t.pass}`),
    t.fail ? S.red(`✗${t.fail}`) : S.dim("✗0"),
    t.stale ? S.yel(`◐${t.stale}`) : null,
    S.dim(`·${t.skip + t.none} not run`),
    m.gaps ? S.mag(`?${m.gaps} dialect gap${m.gaps === 1 ? "" : "s"}`) : null,
  ].filter(Boolean).join(" ");
  const v = m.verify;
  const fresh = v
    ? `fast ${v.lastFastAt ? humanAge(v.lastFastAt, now) : "never"} · full ${v.lastFullAt ? humanAge(v.lastFullAt, now) : "never"}`
    : "never verified — press r";
  const inv = v ? `invariants ${v.invariants.anchored}/${v.invariants.total} anchored` : "";
  const cov = v ? `why ${v.coverage.withWhy}/${v.coverage.components}` : "";
  const l1 = ` ${S.bold(m.root)}  ${S.dim(clip(m.intent, Math.max(10, cols - m.root.length - 4)))}`;
  const l2 = ` ${S.dim(`@${head}`)}  claims ${claimBits}  ${S.dim("|")}  ${fresh}${inv ? `  ${S.dim("|")}  ${inv}` : ""}${cov ? ` · ${cov}` : ""}`;
  const parts: string[] = [];
  if (m.atlas) {
    const a = m.atlas;
    const sec = a.tier3Security.length ? S.red(` ${a.tier3Security.length} TIER-3 SECURITY`) : "";
    const flags = a.flags ? S.yel(` ${a.flags} flag(s)`) : "";
    parts.push(`atlas ${tierBar(a.tiers, 16, S)} ${S.cyn(`${a.tiers.enshrined}`)}/${S.grn(`${a.tiers.checked}`)}/${S.yel(`${a.tiers.convention}`)}${sec}${flags} ${S.dim(humanAge(a.at, now))}`);
  } else parts.push(S.dim("atlas: not run (a)"));
  if (m.drift) {
    const d = m.drift;
    const la = arrow(d.locality[0], d.locality[d.locality.length - 1], 0.03);
    const sa = arrow(d.spread[0], d.spread[d.spread.length - 1], 0.15);
    parts.push(`drift LOC ${spark(d.locality, 0, 1)}${la} SPR ${sa} ${S.dim(humanAge(d.at, now))}`);
  } else parts.push(S.dim("drift: not run (d)"));
  const l3 = ` ${parts.join(`  ${S.dim("|")}  `)}`;
  // ── THE ENERGY STRIP — the work ledger at masthead altitude: what the claims cost to hold
  // true, and where the map is hot. PRESENT ONLY WHEN THERE IS DATA. There is deliberately no
  // "energy: not run" placeholder like atlas/drift carry: those name a command the operator
  // can press (a/d); cost and heat are BYPRODUCTS of runs they already have keys for, so a nag
  // row would advertise a button that does not exist.
  const energy: string[] = [];
  if (m.cost) {
    const top = m.cost.top;
    energy.push(`cost ${fmtMs(m.cost.totalMs)}${top ? ` ${S.dim("·")} top ${S.yel(fmtMs(top.ms))} ${clip(top.node, 18)}` : ""}`);
  }
  const heat = m.atlas?.heat;
  if (heat && heat.length) {
    const max = Math.max(...heat.map((h) => h.heat));
    energy.push(`heat ${S.mag(spark(heat.map((h) => h.heat), 0, max))} ${clip(heat[0].sym, 22)} ${S.dim(`${Math.round(heat[0].heat * 100)}%`)}`);
  }
  const l4 = ` ${S.dim("energy")}  ${energy.join(`  ${S.dim("|")}  `)}`;
  return energy.length ? [l1, l2, l3, l4] : [l1, l2, l3];
}

/** Milliseconds at a glance: seconds once it is worth a second, otherwise raw ms. */
const fmtMs = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;

function listBody(m: PanelModel, ui: UIState, S: Sty, cols: number): string[] {
  const nameW = Math.min(22, Math.max(8, ...m.comps.map((c) => c.label.length)));
  return m.comps.map((c, i) => {
    const sel = i === ui.cursor;
    const cnt = [
      c.counts.pass ? `●${c.counts.pass}` : "",
      c.counts.fail ? `✗${c.counts.fail}` : "",
      c.counts.stale ? `◐${c.counts.stale}` : "",
      c.counts.skip + c.counts.none ? `·${c.counts.skip + c.counts.none}` : "",
    ].filter(Boolean).join(" ");
    const invN = c.boundaries.length + c.unanchored.length;
    const tail = `${invN ? `${invN} inv` : ""}${c.unanchored.length ? `(${c.unanchored.length} UNANCHORED)` : ""}`.padStart(18);
    const intentW = Math.max(8, cols - nameW - 34);
    const plain = ` ${GLYPH[c.light]} ${padE(c.label, nameW)} ${padE(c.intent, intentW)} ${cnt.padStart(10)}${tail}`;
    if (sel) return S.inv(padE(plain, cols));
    // colorize just the glyph on unselected rows
    const g = glyph({ kind: c.light }, S);
    return ` ${g} ${padE(c.label, nameW)} ${S.dim(padE(c.intent, intentW))} ${cnt.padStart(10)}${c.unanchored.length ? S.red(tail) : S.dim(tail)}`;
  });
}

function compBody(c: CompRow, S: Sty, cols: number): string[] {
  const L: string[] = [];
  L.push(` ${S.bold(c.label)}  ${S.dim(c.dir)}`);
  if (c.intent) L.push(` ${clip(c.intent, cols - 2)}`);
  L.push("");
  if (c.boundaries.length || c.unanchored.length) {
    L.push(` ${S.dim("INVARIANTS — boundary anatomy (invariant → chokepoint → oracle)")}`);
    const invW = Math.min(34, Math.max(12, ...c.boundaries.map((b) => b.inv.length + 2), ...c.unanchored.map((u) => u.length + 2)));
    const symW = Math.min(26, Math.max(10, ...c.boundaries.map((b) => b.chokepoint.length)));
    for (const b of c.boundaries) {
      const oracle = b.oracle ? `via ${b.verb} "${b.oracle}"` : "(no oracle)";
      const eye = b.verb === "guard" ? S.yel(" ⚑ human eye") : "";
      const age = b.light.age ? S.dim(` ${b.light.age}`) : "";
      const fail = b.light.kind === "fail" && b.light.detail ? ` ${S.red(clip(b.light.detail, Math.max(10, cols - 40)))}` : "";
      L.push(` ${glyph(b.light, S)} ${padE(`"${b.inv}"`, invW)} at ${padE(b.chokepoint, symW)} ${clip(oracle, Math.max(12, cols - invW - symW - 24))}${eye}${age}`);
      if (fail) L.push(`     ${fail}`);
    }
    for (const u of c.unanchored) L.push(` ${S.red("!")} ${padE(`"${u}"`, invW)} ${S.red("UNANCHORED — no boundary claim anchors this invariant")}`);
    L.push("");
  }
  if (c.plain.length) {
    L.push(` ${S.dim("CLAIMS (works when)")}`);
    for (const p of c.plain) {
      const note = p.light.kind === "fail" && p.light.detail ? ` ${S.red(`— ${clip(p.light.detail, 60)}`)}`
        : p.light.gap ? ` ${S.mag("— dialect gap (no verifier; typo'd verb?)")}`
        : p.light.kind === "skip" && p.light.detail ? ` ${S.dim(`— ${clip(p.light.detail, 48)}`)}`
        : p.light.kind === "stale" ? ` ${S.yel(`— green @ ${p.light.commit ?? "?"} (${p.light.age})`)}`
        : "";
      L.push(` ${glyph(p.light, S)} ${clip(p.claim, cols - 8)}${note}`);
    }
    L.push("");
  }
  L.push(` ${S.dim(c.why ? "[w] read the why" : "no ## why authored — the rationale is missing (AUTHOR job)")}`);
  return L;
}

/** Assemble one full frame. Pure: no IO, no globals — testable, replayable. */
export function renderFrame(m: PanelModel, ui: UIState, size: { cols: number; rows: number }, colors: boolean, now: Date = new Date()): string[] {
  const S = sty(colors);
  const cols = Math.max(60, size.cols);
  const rows = Math.max(14, size.rows);
  const head = masthead(m, S, cols, now);
  const sep = S.dim("─".repeat(cols));

  let body: string[];
  if (ui.view === "why") {
    const c = m.comps[ui.cursor];
    const text = c?.why || "(no ## why authored for this component)";
    body = [` ${S.bold(`${c?.label ?? ""} — why`)}`, "", ...wrapText(text, cols - 4).map((l) => `  ${l}`)];
  } else if (ui.view === "comp") {
    const c = m.comps[ui.cursor];
    body = c ? compBody(c, S, cols) : [" (no component)"];
  } else {
    body = m.comps.length ? listBody(m, ui, S, cols) : [S.dim(" no components — no *.spec.md found under this root")];
  }

  const streamH = 3;
  const bodyH = rows - head.length - 2 /*seps*/ - streamH - 1 /*keybar*/;
  const scroll = ui.view === "why" ? ui.whyScroll : ui.scroll;
  const windowed = body.slice(scroll, scroll + Math.max(1, bodyH));
  while (windowed.length < Math.max(1, bodyH)) windowed.push("");
  const more = body.length > scroll + bodyH ? S.dim(` ↓ ${body.length - scroll - bodyH} more`) : "";
  if (more) windowed[windowed.length - 1] = more;

  const stream = ui.stream.slice(-streamH).map((l) => S.dim(clip(` ${l}`, cols)));
  while (stream.length < streamH) stream.unshift("");

  const run = ui.running ? S.yel(` ▶ ${ui.running}…`) : "";
  const keys = ui.view === "list"
    ? `[↑↓] move [⏎] open [r] fast [R] full [a]tlas [d]rift [space] watch:${ui.watch ? "on" : "off"} [q]uit`
    : ui.view === "comp"
      ? `[↑↓] scroll [w]hy [esc] back [r] fast [R] full [q]uit`
      : `[↑↓] scroll [esc] back [q]uit`;
  const keybar = S.dim(` ${keys}`) + run;

  return [...head, sep, ...windowed, sep, ...stream, keybar].map((l) => clipAnsi(l, cols, colors));
}

// Truncation that tolerates ANSI: colored lines are built pre-clipped, so this is a
// final guard for plain lines only; colored lines pass through untouched.
const clipAnsi = (l: string, w: number, colors: boolean) => (colors || l.includes("\x1b") ? l : clip(l, w));

// ── the interactive loop (+ watch mode) ────────────────────────────────────────────

export interface PanelOpts { watch: boolean; once: boolean }

export async function runPanel(cfg: Config, opts: PanelOpts): Promise<number> {
  let graph = await buildGraph(cfg);
  let status = await readStatus(cfg);
  let model = buildModel(graph, status, gitStamp(cfg.root), new Date());

  const tty = !!process.stdout.isTTY && !!process.stdin.isTTY;
  if (opts.once || !tty) {
    // Static snapshot: the same frame, printed once (colors only on a real TTY).
    const lines = renderFrame(model, initialUI(false), { cols: process.stdout.columns ?? 100, rows: 9999 }, !!process.stdout.isTTY);
    console.log(lines.filter((l, i, a) => l.trim() !== "" || (i > 0 && a[i - 1].trim() !== "")).join("\n"));
    return 0;
  }

  const ui = initialUI(opts.watch);
  const size = () => ({ cols: process.stdout.columns ?? 100, rows: process.stdout.rows ?? 32 });
  const draw = () => {
    const lines = renderFrame(model, ui, size(), true);
    process.stdout.write("\x1b[H" + lines.map((l) => l + "\x1b[K").join("\n") + "\x1b[J");
  };
  const push = (l: string) => { ui.stream.push(`${new Date().toTimeString().slice(0, 8)} ${l}`); if (ui.stream.length > 50) ui.stream.shift(); };

  const claimKeyMap = (m: PanelModel) => {
    const map = new Map<string, LightKind>();
    for (const c of m.comps) { for (const b of c.boundaries) map.set(`${c.label} → boundary "${b.inv}"`, b.light.kind); for (const p of c.plain) map.set(`${c.label} → ${p.claim}`, p.light.kind); }
    return map;
  };

  const reload = async () => {
    try { graph = await buildGraph(cfg); } catch { /* keep last good graph mid-edit */ }
    status = await readStatus(cfg);
    const prev = claimKeyMap(model);
    model = buildModel(graph, status, gitStamp(cfg.root), new Date());
    ui.cursor = Math.min(ui.cursor, Math.max(0, model.comps.length - 1));
    // what flipped — the diff view an operator actually wants after a run
    const flips: string[] = [];
    for (const [k, kind] of claimKeyMap(model)) { const was = prev.get(k); if (was && was !== kind) flips.push(`${was}→${kind} ${k}`); }
    return flips;
  };

  // Child runs: spawn the same CLI (argv[1] — dist/cli.js installed, src/cli.ts from
  // source) so the child files its status report and this process just re-reads it.
  const cliPath = process.argv[1];
  let pending: { args: string[]; label: string } | null = null;
  const runChild = (args: string[], label: string) => {
    if (ui.running) { pending = { args, label }; return; }
    ui.running = label;
    push(`${label}: coherence ${args.join(" ")}`);
    draw();
    let out = "";
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: cfg.root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      void (async () => {
        ui.running = null;
        graceUntil = Date.now() + 1000; // swallow the run's trailing fs events
        const flips = await reload();
        const tail = out.split("\n").map((s) => s.trim()).filter(Boolean).pop() ?? "";
        push(`${label} ${code === 0 ? "✓" : "✗"} ${clip(tail, 70)}${flips.length ? ` · flips: ${flips.slice(0, 2).join("; ")}${flips.length > 2 ? ` +${flips.length - 2}` : ""}` : ""}`);
        draw();
        if (pending) { const p = pending; pending = null; runChild(p.args, p.label); }
      })();
    });
  };

  // Watch (phase 3): recursive fs.watch, debounced; changes trigger the scoped fast
  // tier (verify --fast --staged — exactly the pre-commit tier, on just what changed).
  // Two anti-feedback measures, because a verify run WRITES files:
  //   1. The harness's own writes (.coherence/, outputDir, narrative.json, AGENTS.md,
  //      *.tsbuildinfo) are excluded by path.
  //   2. Events are DROPPED while a child run is in flight and for a grace window
  //      after it closes — the project's typecheck may write artifacts the panel
  //      cannot enumerate (`wrangler types` regenerates worker-configuration.d.ts,
  //      tsc writes .tsbuildinfo), and re-triggering on those is an infinite loop.
  //      The cost is a missed mid-run edit; the next keystroke-save re-triggers.
  const ignore = new Set([...cfg.ignore, ".coherence"]);
  const selfWrites = new Set(["narrative.json", "AGENTS.md", "CLAUDE.md"]);
  const watched = (rel: string) => {
    if (!rel) return false;
    const norm = rel.replace(/\\/g, "/");
    if (norm.split("/").some((p) => ignore.has(p))) return false;
    if (selfWrites.has(norm) || norm.endsWith(".tsbuildinfo")) return false;
    if (norm === cfg.outputDir || norm.startsWith(cfg.outputDir + "/")) return false;
    return true;
  };
  let watcher: FSWatcher | null = null;
  let deb: ReturnType<typeof setTimeout> | null = null;
  let changed = new Set<string>();
  let graceUntil = 0; // drop events until this time — trailing writes from a child run
  try {
    watcher = watch(cfg.root, { recursive: true }, (_ev, fn) => {
      const rel = fn ? String(fn) : "";
      if (!ui.watch || ui.running || Date.now() < graceUntil || !watched(rel)) return;
      changed.add(rel);
      if (deb) clearTimeout(deb);
      deb = setTimeout(() => {
        const n = changed.size; changed = new Set();
        push(`watch: ${n} path(s) changed`);
        runChild(["verify", "--fast", "--staged"], "watch");
      }, 350);
    });
  } catch {
    ui.watch = false;
    push("watch unavailable on this platform — use r/R to run manually");
  }

  // Terminal in, terminal out: alternate screen + hidden cursor + raw keypresses.
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise<number>((resolve) => {
    const quit = () => {
      watcher?.close();
      if (deb) clearTimeout(deb);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[?25h\x1b[?1049l");
      resolve(0);
    };
    process.on("SIGTERM", quit);
    process.stdout.on("resize", draw);
    process.stdin.on("keypress", (_ch: string, key: { name?: string; ctrl?: boolean; shift?: boolean } = {}) => {
      const k = key.name ?? "";
      if (k === "q" || (key.ctrl && k === "c")) return quit();
      const maxCursor = Math.max(0, model.comps.length - 1);
      if (ui.view === "list") {
        if (k === "down" || k === "j") ui.cursor = Math.min(maxCursor, ui.cursor + 1);
        else if (k === "up" || k === "k") ui.cursor = Math.max(0, ui.cursor - 1);
        else if (k === "return" || k === "right") { ui.view = "comp"; ui.scroll = 0; }
        else if (k === "space") ui.watch = !ui.watch;
        else if (k === "a") runChild(["atlas"], "atlas");
        else if (k === "d") runChild(["drift"], "drift");
        // keep the cursor visible in the window
        // masthead (3, or 4 with the energy strip) + 2 separators + 3 stream rows + keybar —
        // derived rather than hard-coded so the strip's appearance cannot shift the window
        // out from under the cursor.
        const bodyH = Math.max(1, (size().rows) - mastheadHeight(model) - 2 - 3 - 1);
        if (ui.cursor < ui.scroll) ui.scroll = ui.cursor;
        if (ui.cursor >= ui.scroll + bodyH) ui.scroll = ui.cursor - bodyH + 1;
      } else if (ui.view === "comp") {
        if (k === "escape" || k === "left" || k === "backspace") { ui.view = "list"; ui.scroll = 0; }
        else if (k === "w") { ui.view = "why"; ui.whyScroll = 0; }
        else if (k === "down" || k === "j") ui.scroll++;
        else if (k === "up" || k === "k") ui.scroll = Math.max(0, ui.scroll - 1);
      } else if (ui.view === "why") {
        if (k === "escape" || k === "left" || k === "backspace" || k === "w") ui.view = "comp";
        else if (k === "down" || k === "j") ui.whyScroll++;
        else if (k === "up" || k === "k") ui.whyScroll = Math.max(0, ui.whyScroll - 1);
      }
      if (k === "r" && !key.shift) runChild(["verify", "--fast"], "verify --fast");
      else if (k === "r" && key.shift) runChild(["verify"], "verify (full)");
      draw();
    });
    push(ui.watch ? "watching — edits trigger the fast tier (space to pause)" : "watch off — r/R to run");
    draw();
  });
}
