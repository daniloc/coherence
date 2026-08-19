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
//
// PYTHON GRADE. On `.py` files the same two contexts are read out of f-strings: a
// single-line f"…" / f'…' / f-triple-quoted literal is the unit, and each `{expr}`
// inside it is a candidate site (`{{` escapes are not; `!r` conversions, `:>10` format
// specs and the `=` debug suffix are stripped so the EXPRESSION is what the safe
// regexes grade). The JS sql signal — the `"${expr}"` double-quote wrap — does not
// survive translation, because the f-string's delimiters consume the quotes; SQL-ish
// is instead read off the literal's own text (a SQL statement shape: select…from,
// insert into, …), while the HTML signal is byte-for-byte the JS one, a markup tag on
// the line. Multi-line triple-quoted f-strings are invisible — this scanner is
// line-based and the python path follows its grain — and `str.format` / `%`-formatting
// are deliberately skipped: their expressions live OUTSIDE the literal (in call args /
// the right operand), so a line-regex would pin `{}` or `%s` as the site and the
// safe-pattern regexes would have no expression to grade. Precision over recall: a
// wall of unmatched-placeholder candidates is worse than silence.
import { join } from "node:path";
import { Query } from "web-tree-sitter";
import type { Config } from "./types.ts";
import { grammarHandle } from "./adapters/tree-sitter.ts";
import { scanSources, readBaseline, writeBaseline } from "./sidecar.ts";
import { ratchetVacuityRefusal, type RatchetReading } from "./floor.ts";

// Defaults: a value routed through quoteIdent()/an ALL_CAPS constant (SQL), or
// escapeXml/escapeAttr/.toFixed/a numeric/styling constant (HTML), is inert.
const DEFAULT_SAFE_SQL = "^(quoteIdent\\(|[A-Z][A-Z0-9_]*$)";
const DEFAULT_SAFE_HTML = "(^|[^.\\w])(escapeXml|escapeAttr)\\(|\\.toFixed\\(|^[A-Z][A-Z0-9_]*$|^-?\\d";
const HTML_TAG = /<\/?[a-zA-Z!]/;            // a markup tag on the line → HTML context
// A SQL statement shape in the literal's own text — the stand-in for the JS `"${expr}"`
// quoting signal in languages whose delimiters consume it. Verb pairs, not lone keywords.
const SQL_TEXT = /\b(?:select\s.*\bfrom\b|insert\s+into\b|update\s+\S+\s+set\b|delete\s+from\b|create\s+(?:table|index|view)\b|drop\s+(?:table|index|view)\b|alter\s+table\b)/i;
const BASELINE = "sinks-baseline.json";

// ── the per-language sink data (phase 2b: queries, not scanners) ─────────────────────
// Each language contributes CAPTURES and signals, never verdict logic: @str is the
// string-ish container, @expr one interpolation node inside it. The grammar decides
// what is a real interpolation, so `${}` inside a plain string, a comment, or a test
// fixture's code-as-string is no longer a site — the regex scanners this replaced
// matched line TEXT and over-reported exactly those (every baseline delta at the swap
// was enumerated as that class). SQL context is either `quote-wrap` (the interpolation
// is immediately double-quote-wrapped — the SQLite-identifier signal quoting can carry)
// or `text-shape` (the literal's own text carries a statement shape, for languages
// whose string delimiters consume the quotes). HTML stays a line signal in every
// language. The safe-pattern config grades the bare expression identically throughout.
interface SinkLanguage {
  ext: string;
  grammar: string;
  query: string;
  sql: "quote-wrap" | "text-shape";
  /** Container-text gate, a PATTERN not a predicate (pack purity: data, never code) —
   *  e.g. python: only f-prefixed strings interpolate meaningfully for this ratchet. */
  acceptString?: RegExp;
}
export const SINK_LANGUAGES: SinkLanguage[] = [
  { ext: ".ts", grammar: "typescript", sql: "quote-wrap",
    query: "(template_string (template_substitution) @expr) @str" },
  { ext: ".py", grammar: "python", sql: "text-shape",
    query: "(string (interpolation) @expr) @str",
    acceptString: /^[rbu]*f/i },
  { ext: ".rb", grammar: "ruby", sql: "text-shape",
    query: "(string (interpolation) @expr) @str" },
];

/** The bare expression of one interpolation node: the grammar's expression field where
 *  the language has one (python — this is what drops `!r` conversions, `:>10` format
 *  specs, and the 3.8 `=` debug suffix), else the node text minus its delimiters. */
function interpolationExpr(node: import("web-tree-sitter").Node): string {
  const field = node.childForFieldName("expression");
  if (field) return field.text.trim();
  const text = node.text;
  const lead = text.startsWith("${") || text.startsWith("#{") ? 2 : 1;
  return text.slice(lead, text.endsWith("}") ? -1 : undefined).trim();
}

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

/** THIS RATCHET'S OWN DENOMINATOR — the SOURCE FILES it scanned, and nothing about a
 *  graph. `lintSinks(cfg, mode)` never receives one: it reads `scanSources(cfg)` directly,
 *  so the verify floor's "the graph carries no claims" predicate would guard `mass` and
 *  silently exempt this. Each ratchet supplies its own reading; floor.ts owns the rule.
 *
 *  The pinned side is the reviewed SITES, a different unit on purpose. It answers only the
 *  weaker question the rule asks — was the population ever non-empty — and a pinned site
 *  is proof of a file it was found in, which is all the lower bound needs to be. */
const sinkReading = (cfg: Config, files: number, pinnedSites: number): RatchetReading => ({
  ratchet: "lint-sinks",
  baseline: join(cfg.outputDir, BASELINE),
  live: files, unit: "source file(s) scanned",
  pinned: pinnedSites, pinnedUnit: "reviewed interpolation site(s)",
});

export async function lintSinks(cfg: Config, mode: "report" | "check" | "update"): Promise<number> {
  const safeSql = new RegExp(cfg.sinks?.safeSql ?? DEFAULT_SAFE_SQL);
  const safeHtml = new RegExp(cfg.sinks?.safeHtml ?? DEFAULT_SAFE_HTML);
  const { src } = await scanSources(cfg);

  const findings: Finding[] = [];
  const queries = new Map<string, { parser: import("web-tree-sitter").Parser; query: Query }>();
  for (const { rel, text } of src) {
    const lang = SINK_LANGUAGES.find((l) => rel.endsWith(l.ext));
    if (!lang) continue;
    let handle = queries.get(lang.ext);
    if (!handle) {
      const { language, parser } = await grammarHandle(lang.grammar);
      handle = { parser, query: new Query(language, lang.query) };
      queries.set(lang.ext, handle);
    }
    const tree = handle.parser.parse(text);
    if (!tree) continue;
    const lines = text.split("\n");
    for (const match of handle.query.matches(tree.rootNode)) {
      const str = match.captures.find((c) => c.name === "str")?.node;
      const interp = match.captures.find((c) => c.name === "expr")?.node;
      if (!str || !interp) continue;
      if (lang.acceptString && !lang.acceptString.test(str.text)) continue;
      const isSql = lang.sql === "quote-wrap"
        ? text[interp.startIndex - 1] === '"' && text[interp.endIndex] === '"'
        : SQL_TEXT.test(str.text);
      const row = interp.startPosition.row;
      if (!isSql && !HTML_TAG.test(lines[row] ?? "")) continue;
      const expr = interpolationExpr(interp);
      if (!expr) continue;
      const context = isSql ? "sql-ident" : "html-value";
      if (!(isSql ? safeSql : safeHtml).test(expr)) {
        findings.push({ context, file: rel, expr, line: row + 1 });
      }
    }
  }

  const current = new Map<string, Finding>();
  for (const x of findings) if (!current.has(keyOf(x))) current.set(keyOf(x), x);

  if (mode === "update") {
    // The pin is the seam that outlives the run — refuse to write an empty reading over a
    // baseline that remembers a non-empty one (floor.ts states the rule and why).
    const prior = await readBaseline<string[]>(cfg, BASELINE);
    const refusal = prior ? ratchetVacuityRefusal(sinkReading(cfg, src.length, prior.length), "update") : null;
    if (refusal) { for (const l of refusal) console.error(l); console.error(""); return 1; }
    const base = [...current.keys()].sort();
    const p = await writeBaseline(cfg, BASELINE, base);
    console.log(`Pinned ${base.length} reviewed interpolation site(s) to ${p}`);
    return 0;
  }

  const bySql = [...current.values()].filter((x) => x.context === "sql-ident").length;
  const byHtml = [...current.values()].filter((x) => x.context === "html-value").length;
  console.log("\n  INJECTION-SURFACE LINT — raw interpolation into SQL-identifier / HTML contexts\n");
  console.log(`  SQL identifier ("\${expr}"): ${bySql}    HTML value (\${expr} in markup): ${byHtml}    total reviewed surface: ${current.size}`);
  console.log(`  across ${src.length} source file(s) scanned — the population this surface was read over.`);
  console.log("  Each must be a validated identifier / escapeXml'd value; --check fails on a NEW site.\n");

  if (mode !== "check") return 0;
  const base = await readBaseline<string[]>(cfg, BASELINE);
  if (!base) { console.error("  --check: no baseline. Run with --update-baseline first."); return 2; }

  // BEFORE ANY VERDICT: zero files scanned yields zero novel sites, so every branch below
  // would report the ratchet holding over a scan that never happened.
  const refusal = ratchetVacuityRefusal(sinkReading(cfg, src.length, base.length), "check");
  if (refusal) { for (const l of refusal) console.error(l); console.error(""); return 1; }
  const { moved, novel } = reconcile(base, current.values());
  if (novel.length) {
    console.error(`  ✗ injection ratchet FAILED — ${novel.length} new raw interpolation site(s):`);
    for (const x of novel) console.error(`    - [${x.context}] ${x.file}:${x.line}  \${${x.expr}}`);
    console.error("\n  Make it safe (validated identifier / quoteIdent / escapeXml), or — if reviewed and safe — re-pin with --update-baseline.\n");
    if (moved.length) console.error(`  (${moved.length} further site(s) only MOVED — see the report above; they are not counted as new.)`);
    return 1;
  }
  console.log(`  ✓ injection ratchet held — no new raw interpolation sites (${current.size} live site(s) across ${src.length} source file(s) examined).`);
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
