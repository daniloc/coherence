// lint-sinks.ts — the interpolation-surface ratchet (was mnemion's injection-lint.mjs).
// Surfaces every raw interpolation into a dangerous context (SQL identifier / HTML
// value), baselines the reviewed set, and RATCHETS: a NEW raw site fails `--check`. It
// doesn't prove the baselined sites safe — it makes the surface visible and
// append-only-with-review. The SAFE-by-construction patterns are config (`sinks`); the
// two contexts and the baseline live in the harness.
//
// The baseline is a CACHED REVIEW, and a cached fact that goes stale on a rename is
// premise rot one layer down: keying a site by its file path meant a refactor
// manufactured false alarms in proportion to how much code it moved. `reconcile` below
// re-addresses moved sites without letting a copied one through.
import type { Config } from "./types.ts";
import { scanSources, readBaseline, writeBaseline } from "./sidecar.ts";

// Defaults: a value routed through quoteIdent()/an ALL_CAPS constant (SQL), or
// escapeXml/escapeAttr/.toFixed/a numeric/styling constant (HTML), is inert.
const DEFAULT_SAFE_SQL = "^(quoteIdent\\(|[A-Z][A-Z0-9_]*$)";
const DEFAULT_SAFE_HTML = "(^|[^.\\w])(escapeXml|escapeAttr)\\(|\\.toFixed\\(|^[A-Z][A-Z0-9_]*$|^-?\\d";
const INTERP = /\$\{([^{}]+)\}/g;          // non-nested ${...}
const SQL_INTERP = /"\$\{([^{}]+)\}"/g;     // "${expr}" — SQLite double-quoted identifier
const HTML_TAG = /<\/?[a-zA-Z!]/;            // a markup tag on the line → HTML context
const BASELINE = "sinks-baseline.json";

export interface Finding { context: string; file: string; expr: string; line: number }
const keyOf = (x: Finding) => `${x.context}|${x.file}|${x.expr}`;
/** The move-invariant half of a key: what the sink IS, minus where it currently lives. */
const addrOf = (x: { context: string; expr: string }) => `${x.context}|${x.expr}`;

// A baseline key is `context|file|expr`. Split on the FIRST TWO delimiters only —
// `expr` routinely contains `|` (`a || b`), and mis-splitting it would silently
// re-address the entry, which is the bug this whole file is defending against.
function parseKey(k: string): Finding | null {
  const i = k.indexOf("|"), j = k.indexOf("|", i + 1);
  if (i < 0 || j < 0) return null;
  return { context: k.slice(0, i), file: k.slice(i + 1, j), expr: k.slice(j + 1), line: 0 };
}

export interface Move { from: string; to: Finding }
export interface Reconciled { moved: Move[]; novel: Finding[] }

/** Split the current sites against the baseline into MOVES and genuinely NOVEL sites.
 *
 *  The baseline addresses a site by `context|file|expr`, so relocating a file re-addresses
 *  every sink inside it. That turns a refactor into a pile of false security alarms — and a
 *  ratchet whose alarms are routinely wrong is a ratchet reviewers learn to wave through.
 *
 *  A move is a **matched disappearance**: an unmatched current site is a move only if some
 *  baselined site with the same `context|expr` has VANISHED from the live set, and each
 *  vanished entry absorbs exactly ONE unmatched site. Count is therefore conserved per
 *  `context|expr` — a site that was COPIED (the original still live) finds nothing to
 *  absorb it and stays novel, so the ratchet cannot be laundered by duplicating an
 *  already-reviewed expression into a new and more dangerous file.
 *
 *  What this deliberately does NOT promise: when several byte-identical sites share one
 *  `context|expr`, WHICH new path inherits which vanished review is arbitrary (paths are
 *  paired in sorted order for determinism, not for meaning). The guarantee is the count —
 *  n vanished sites absorb n relocations and the n+1st is novel. It is also, honestly, a
 *  loosening: a site that moved into a genuinely more exposed file no longer FAILS the
 *  check. It is reported by name, from → to, so the fact stays readable rather than
 *  silent; that is the trade for not crying wolf on every refactor. */
export function reconcile(baseline: string[], current: Iterable<Finding>): Reconciled {
  const sites = [...current];
  const live = new Set(sites.map(keyOf));
  const baseSet = new Set(baseline);

  // Baselined sites that are no longer live, bucketed by move-invariant address.
  const vanished = new Map<string, string[]>();
  for (const k of baseline) {
    if (live.has(k)) continue;
    const p = parseKey(k);
    if (!p) continue;
    const bucket = vanished.get(addrOf(p));
    if (bucket) bucket.push(p.file); else vanished.set(addrOf(p), [p.file]);
  }
  for (const b of vanished.values()) b.sort(); // deterministic pairing

  const moved: Move[] = [], novel: Finding[] = [];
  for (const x of sites) {
    if (baseSet.has(keyOf(x))) continue;
    const from = vanished.get(addrOf(x))?.shift();
    if (from !== undefined) moved.push({ from, to: x }); else novel.push(x);
  }
  return { moved, novel };
}

export async function lintSinks(cfg: Config, mode: "report" | "check" | "update"): Promise<number> {
  const safeSql = new RegExp(cfg.sinks?.safeSql ?? DEFAULT_SAFE_SQL);
  const safeHtml = new RegExp(cfg.sinks?.safeHtml ?? DEFAULT_SAFE_HTML);
  const { src } = await scanSources(cfg);

  const findings: Finding[] = [];
  for (const { rel, text } of src) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trimStart();
      if (t.startsWith("//") || t.startsWith("*")) continue;
      for (const m of line.matchAll(SQL_INTERP)) {
        const expr = m[1].trim();
        if (!safeSql.test(expr)) findings.push({ context: "sql-ident", file: rel, expr, line: i + 1 });
      }
      if (HTML_TAG.test(line)) {
        for (const m of line.matchAll(INTERP)) {
          const expr = m[1].trim();
          if (line.includes(`"\${${m[1]}}"`)) continue; // the SQL-ident form, already handled
          if (!safeHtml.test(expr)) findings.push({ context: "html-value", file: rel, expr, line: i + 1 });
        }
      }
    }
  }

  const current = new Map<string, Finding>();
  for (const x of findings) if (!current.has(keyOf(x))) current.set(keyOf(x), x);

  if (mode === "update") {
    const base = [...current.keys()].sort();
    const p = await writeBaseline(cfg, BASELINE, base);
    console.log(`Pinned ${base.length} reviewed interpolation site(s) to ${p}`);
    return 0;
  }

  const bySql = [...current.values()].filter((x) => x.context === "sql-ident").length;
  const byHtml = [...current.values()].filter((x) => x.context === "html-value").length;
  console.log("\n  INJECTION-SURFACE LINT — raw interpolation into SQL-identifier / HTML contexts\n");
  console.log(`  SQL identifier ("\${expr}"): ${bySql}    HTML value (\${expr} in markup): ${byHtml}    total reviewed surface: ${current.size}`);
  console.log("  Each must be a validated identifier / escapeXml'd value; --check fails on a NEW site.\n");

  if (mode !== "check") return 0;
  const base = await readBaseline<string[]>(cfg, BASELINE);
  if (!base) { console.error("  --check: no baseline. Run with --update-baseline first."); return 2; }
  const { moved, novel } = reconcile(base, current.values());
  if (novel.length) {
    console.error(`  ✗ injection ratchet FAILED — ${novel.length} new raw interpolation site(s):`);
    for (const x of novel) console.error(`    - [${x.context}] ${x.file}:${x.line}  \${${x.expr}}`);
    console.error("\n  Make it safe (validated identifier / quoteIdent / escapeXml), or — if reviewed and safe — re-pin with --update-baseline.\n");
    if (moved.length) console.error(`  (${moved.length} further site(s) only MOVED — see the report above; they are not counted as new.)`);
    return 1;
  }
  console.log("  ✓ injection ratchet held — no new raw interpolation sites.");
  if (moved.length) {
    console.log(`\n  ${moved.length} baselined site(s) MOVED — same sink, new address, not new risk:`);
    for (const m of moved) console.log(`    ~ [${m.to.context}] ${m.from} → ${m.to.file}:${m.to.line}  \${${m.to.expr}}`);
    console.log("  A move is not a new site, but it IS a relocation worth a glance — the debt table below still\n  lists the old paths until you re-pin with --update-baseline.");
  }
  const byFile: Record<string, number> = {};
  let stale = 0;
  for (const k of base) { const f = parseKey(k)?.file ?? "?"; byFile[f] = (byFile[f] ?? 0) + 1; if (!current.has(k)) stale++; }
  console.log(`\n  Baselined debt: ${base.length} reviewed site(s) tolerated (toward zero):`);
  for (const [f, c] of Object.entries(byFile).sort((a, z) => z[1] - a[1])) console.log(`    ${String(c).padStart(3)}  ${f}`);
  if (stale) console.log(`  (${stale} baselined site(s) no longer in code — re-pin with --update-baseline to drop them)`);
  console.log("");
  return 0;
}
