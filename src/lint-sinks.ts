// lint-sinks.ts — the interpolation-surface ratchet (was mnemion's injection-lint.mjs).
// Surfaces every raw interpolation into a dangerous context (SQL identifier / HTML
// value), baselines the reviewed set, and RATCHETS: a NEW raw site fails `--check`. It
// doesn't prove the baselined sites safe — it makes the surface visible and
// append-only-with-review. The SAFE-by-construction patterns are config (`sinks`); the
// two contexts and the baseline live in the harness.
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

interface Finding { context: string; file: string; expr: string; line: number }
const keyOf = (x: Finding) => `${x.context}|${x.file}|${x.expr}`;

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
  const baseSet = new Set(base);
  const novel = [...current.values()].filter((x) => !baseSet.has(keyOf(x)));
  if (novel.length) {
    console.error(`  ✗ injection ratchet FAILED — ${novel.length} new raw interpolation site(s):`);
    for (const x of novel) console.error(`    - [${x.context}] ${x.file}:${x.line}  \${${x.expr}}`);
    console.error("\n  Make it safe (validated identifier / quoteIdent / escapeXml), or — if reviewed and safe — re-pin with --update-baseline.\n");
    return 1;
  }
  console.log("  ✓ injection ratchet held — no new raw interpolation sites.");
  const byFile: Record<string, number> = {};
  let stale = 0;
  for (const k of base) { const f = k.split("|")[1] ?? "?"; byFile[f] = (byFile[f] ?? 0) + 1; if (!current.has(k)) stale++; }
  console.log(`\n  Baselined debt: ${base.length} reviewed site(s) tolerated (toward zero):`);
  for (const [f, c] of Object.entries(byFile).sort((a, z) => z[1] - a[1])) console.log(`    ${String(c).padStart(3)}  ${f}`);
  if (stale) console.log(`  (${stale} baselined site(s) no longer in code — re-pin with --update-baseline to drop them)`);
  console.log("");
  return 0;
}
