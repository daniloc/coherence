// novelty.ts — the novelty-vs-anchor advisory.
//
// The gap this closes: `verify` checks DECLARED claims and `log` diffs the DECLARED
// ledger, but nothing applied pressure to DECLARE when new load-bearing surface
// appeared. A large feature can land with zero new invariants/boundaries and the tree
// reads "✓ coherent · no structural change" throughout — the exact condition under
// which a real consumer shipped a 3,500-line surface carrying 14 bugs. This module
// contrasts BEHAVIORAL SURFACE ADDED across a ref range against ANCHORS ADDED in the
// same range and raises an advisory when surface runs ahead of anchors.
//
// Surface proxies (deliberately tractable and explainable, not exhaustive), all from a
// TS-AST scan of only the files git reports CHANGED in the range, at each ref:
//   · net-new exported symbols   — exported functions/consts/classes/types/enums. The
//     scan is AST-native rather than graph-derived on purpose: the graph's language
//     adapter parses `.ts` only, but real drift surface lives in `.tsx` too (the
//     motivating consumer's per-tool lookup tables were in a React component file);
//   · net-new union variants / enum members / keyed-table keys — exported string-
//     literal unions and enums, plus `Record<…>`-annotated top-level const tables
//     WHETHER OR NOT exported (a module-local keyed table is exactly the implicit-
//     domain projection surface this advisory exists to catch);
//   · LOC added/deleted          — git numstat, code extensions only, ignore-dirs out.
// Test files are excluded: tests are evidence, not surface.
//
// The verdict self-qualifies (the churn proviso): a REFACTOR is high line-churn with
// low net-new exports/variants, a FEATURE is net-new surface — when churn dominates
// the alarm carries "(disregard if recent work was mostly refactor)". Advisory only:
// like why-lint, it never changes the exit code.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import type { Config } from "./types.ts";

/** What one source file contributes to the behavioral surface: its exported symbol
 *  names, and its enumerated domains (exported string-literal unions and enums, plus
 *  top-level `Record<…>`-annotated const tables — export NOT required for tables). */
export interface FileSurface { exports: Set<string>; domains: Map<string, Set<string>>; }

/** Pure (AST only) — the surface of one source string. */
export function surfaceOfSource(src: string, fileName = "x.ts"): FileSurface {
  const exports = new Set<string>();
  const domains = new Map<string, Set<string>>();
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const isExported = (n: ts.Node): boolean =>
    !!(ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
  const put = (name: string, members: Iterable<string>) => {
    const set = domains.get(name) ?? new Set<string>();
    for (const m of members) set.add(m);
    if (set.size) domains.set(name, set);
  };

  for (const stmt of sf.statements) {
    const exported = isExported(stmt);
    // type X = "a" | "b" | …  (string-literal union — an enumerated domain)
    if (ts.isTypeAliasDeclaration(stmt)) {
      if (exported) exports.add(stmt.name.text);
      if (exported && ts.isUnionTypeNode(stmt.type)) {
        const members: string[] = [];
        for (const t of stmt.type.types)
          if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) members.push(t.literal.text);
        if (members.length >= 2) put(stmt.name.text, members);
      }
    }
    if (ts.isEnumDeclaration(stmt)) {
      if (exported) { exports.add(stmt.name.text); put(stmt.name.text, stmt.members.map((m) => m.name.getText(sf))); }
    }
    if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) && stmt.name && exported)
      exports.add(stmt.name.text);
    // const T: Record<K, V> = { … } (or `… satisfies Record<…>`) — a keyed lookup table.
    // Counted whether or not exported: a module-local table keyed by an implicit domain
    // is precisely the projection surface that drifts (the motivating consumer's
    // TOOL_KIND/READ_SUMMARY tables were local to a component file).
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        if (exported) exports.add(d.name.text);
        if (!d.initializer) continue;
        let init: ts.Expression = d.initializer;
        let recordTyped = !!(d.type && /\bRecord\s*</.test(d.type.getText(sf)));
        while (ts.isSatisfiesExpression(init) || ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) {
          if ((ts.isSatisfiesExpression(init) || ts.isAsExpression(init)) && /\bRecord\s*</.test(init.type.getText(sf)))
            recordTyped = true;
          init = init.expression;
        }
        if (!recordTyped || !ts.isObjectLiteralExpression(init)) continue;
        const keys: string[] = [];
        for (const p of init.properties) {
          if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isShorthandPropertyAssignment(p)) && p.name)
            keys.push(ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(sf));
        }
        if (keys.length) put(d.name.text, keys);
      }
    }
  }
  return { exports, domains };
}

/** Whether a path is a test file (excluded from the surface proxies). */
export const isTestPath = (p: string) => /\.(test|spec)\.[mc]?[jt]sx?$/.test(p) || /(^|\/)__tests__\//.test(p);

/** Scan the surface of a set of files under one tree root; missing files (added or
 *  removed on the other side of the range) are simply absent. Exports and domains are
 *  keyed by NAME, merged across files, so a file move reads as churn — not novelty. */
export async function scanSurface(root: string, files: Iterable<string>): Promise<FileSurface> {
  const exports = new Set<string>();
  const domains = new Map<string, Set<string>>();
  for (const rel of files) {
    if (!/\.[mc]?[jt]sx?$/.test(rel) || isTestPath(rel)) continue;
    let src: string;
    try { src = await readFile(join(root, rel), "utf8"); } catch { continue; }
    const s = surfaceOfSource(src, rel);
    for (const e of s.exports) exports.add(e);
    for (const [name, members] of s.domains) {
      const set = domains.get(name) ?? new Set<string>();
      for (const m of members) set.add(m);
      domains.set(name, set);
    }
  }
  return { exports, domains };
}

export interface NoveltySignals {
  newExports: string[];       // labels new in `after`
  removedExports: number;
  newVariants: number;        // net-new members across unions/enums/keyed tables
  newDomains: string[];       // "Name (+n)" display strings for domains that grew/appeared
  locAdded: number;
  locDeleted: number;
  anchorsAdded: number;       // invariants + boundary claims + parity claims added
  componentsAdded: number;
}

/** Diff the surface proxies. `before`/`after` cover the CHANGED files only —
 *  sufficient, since an unchanged file cannot move the delta. */
export function surfaceSignals(
  before: FileSurface, after: FileSurface,
  loc: { added: number; deleted: number },
  anchors: { anchorsAdded: number; componentsAdded: number },
): NoveltySignals {
  const newExports = [...after.exports].filter((s) => !before.exports.has(s)).sort();
  const removedExports = [...before.exports].filter((s) => !after.exports.has(s)).length;
  let newVariants = 0;
  const newDomains: string[] = [];
  for (const [name, aft] of after.domains) {
    const bef = before.domains.get(name) ?? new Set<string>();
    const added = [...aft].filter((m) => !bef.has(m)).length;
    if (added > 0) { newVariants += added; newDomains.push(`${name} (+${added}${bef.size ? "" : ", new"})`); }
  }
  return {
    newExports, removedExports, newVariants, newDomains: newDomains.sort(),
    locAdded: loc.added, locDeleted: loc.deleted,
    anchorsAdded: anchors.anchorsAdded, componentsAdded: anchors.componentsAdded,
  };
}

export interface NoveltyVerdict {
  level: "quiet" | "outpacing" | "alarm";
  surface: number;
  proviso: boolean; // churn dominates net-new — self-qualify
}

export const NOVELTY_DEFAULTS = { minSurface: 8, minLoc: 400, ratio: 12 };

/** The advisory decision — pure. ALARM: surface (or raw LOC) landed with ZERO anchors.
 *  OUTPACING: anchors were added but surface outgrew them by `ratio`. The proviso fires
 *  when the signal is churn-shaped: the alarm rode on LOC alone, or deletions track
 *  additions (a rewrite/move, not growth). */
export function noveltyVerdict(sig: NoveltySignals, cfgN?: Config["novelty"]): NoveltyVerdict {
  const { minSurface, minLoc, ratio } = { ...NOVELTY_DEFAULTS, ...(cfgN ?? {}) };
  const surface = sig.newExports.length + sig.newVariants;
  let level: NoveltyVerdict["level"] = "quiet";
  if (sig.anchorsAdded === 0 && (surface >= minSurface || sig.locAdded >= minLoc)) level = "alarm";
  else if (sig.anchorsAdded > 0 && surface >= minSurface && surface > sig.anchorsAdded * ratio) level = "outpacing";
  const proviso = level !== "quiet" && (surface < minSurface || sig.locDeleted * 2 >= sig.locAdded);
  return { level, surface, proviso };
}

const PROVISO =
  "(disregard if recent work was mostly refactor — line churn dominates net-new surface)";

/** Render the advisory section (after the ledger diff). Advisory: returns nothing,
 *  never affects the exit code. */
export function renderNovelty(sig: NoveltySignals, v: NoveltyVerdict): void {
  console.log(`\n  NOVELTY vs ANCHORS — behavioral surface added vs claims added\n`);
  const ex = sig.newExports;
  const sample = ex.slice(0, 8).join(", ") + (ex.length > 8 ? `, … (+${ex.length - 8} more)` : "");
  console.log(`  surface: +${ex.length} exported symbol(s)${ex.length ? ` [${sample}]` : ""}`);
  if (sig.newVariants) console.log(`           +${sig.newVariants} union/enum variant(s) & table key(s) [${sig.newDomains.join(", ")}]`);
  console.log(`           +${sig.locAdded}/-${sig.locDeleted} LOC (code files)`);
  console.log(`  anchors: +${sig.anchorsAdded} (invariants + boundary/parity claims)` +
    (sig.componentsAdded ? ` · +${sig.componentsAdded} component(s)` : ""));
  if (v.level === "alarm") {
    console.log(`\n  ◀ ADVISORY — significant new surface, NO new anchors.`);
    console.log(`    ${v.surface} net-new surface item(s) and +${sig.locAdded} LOC landed without a single new`);
    console.log(`    invariant, boundary, or parity claim. New load-bearing surface that nothing`);
    console.log(`    anchors is exactly where drift lives — declare what must hold, or confirm`);
    console.log(`    the existing claims genuinely cover it.`);
    if (v.proviso) console.log(`    ${PROVISO}`);
  } else if (v.level === "outpacing") {
    console.log(`\n  ◀ ADVISORY — new surface is outpacing new anchors (${v.surface} surface vs ${sig.anchorsAdded} anchor(s)).`);
    if (v.proviso) console.log(`    ${PROVISO}`);
  } else {
    console.log(`\n  ✓ anchors are keeping pace with new surface.`);
  }
}
