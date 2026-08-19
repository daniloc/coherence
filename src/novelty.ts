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
//
// Every language is counted through its GRAMMAR (phase 2b, arm 2): a per-language
// query names the surface shapes — exported declarations, string-literal unions, enum
// bodies, keyed tables, `Literal[…]` aliases — and one mechanism extracts names and
// members from the captured nodes. The TS side previously used the compiler API and
// ported clean, per the pre-registered conjecture d-a5ca8273; the python side was
// line-anchored regex, and its port's deltas were enumerated at the gate. Precision
// over recall still: a missed exotic form under-counts one surface item, while
// counting garbage would poison the alarm this feeds. And it does feed one —
// signal.ts wires scanSurface/surfaceSignals/noveltyVerdict into the zero-anchor
// growth gate (`needs-decision` under --check, the regulator's require-decision
// rule): the exact blind spot the module exists to close.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Query, type Node } from "web-tree-sitter";
import { grammarHandle } from "./adapters/tree-sitter.ts";
import type { Config } from "./types.ts";

/** What one source file contributes to the behavioral surface: its exported symbol
 *  names, and its enumerated domains (exported string-literal unions and enums, plus
 *  top-level `Record<…>`-annotated const tables — export NOT required for tables). */
export interface FileSurface { exports: Set<string>; domains: Map<string, Set<string>>; }

// ── the per-language surface data (queries, not scanners) ────────────────────────────
// Capture classes: `export` — a name node added to exports; `domain.name`+`domain.body`
// — an enumerated domain and the node its members are read from; `table.name`+
// `table.obj` — a keyed table (counted whether or not exported) and its object node;
// `lit.name`+`lit.body` — a Literal-style alias. Member extraction is one mechanism
// below; a language contributes patterns, never verdict logic.
interface SurfaceLanguage {
  ext: RegExp;
  grammar: string;
  query: string;
  /** exports whose names match are dropped (python's `_` convention). */
  privateName?: RegExp;
}

const SURFACE_LANGUAGES: SurfaceLanguage[] = [
  {
    ext: /\.[mc]?[jt]sx?$/i,
    grammar: "typescript",
    query: `
      (export_statement declaration: (function_declaration name: (identifier) @export))
      (export_statement declaration: (generator_function_declaration name: (identifier) @export))
      (export_statement declaration: (class_declaration name: (type_identifier) @export))
      (export_statement declaration: (abstract_class_declaration name: (type_identifier) @export))
      (export_statement declaration: (interface_declaration name: (type_identifier) @export))
      (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @export)))
      (export_statement declaration: (type_alias_declaration name: (type_identifier) @export))
      (export_statement declaration: (enum_declaration name: (identifier) @export))
      (export_statement declaration: (type_alias_declaration name: (type_identifier) @domain.name value: (union_type) @domain.body))
      (export_statement declaration: (enum_declaration name: (identifier) @domain.name body: (enum_body) @domain.body))
      (program (lexical_declaration (variable_declarator name: (identifier) @table.name type: (type_annotation (_) @_ty) value: (object) @table.obj
        (#match? @_ty "Record\\s*<"))))
      (program (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @table.name type: (type_annotation (_) @_ty) value: (object) @table.obj
        (#match? @_ty "Record\\s*<")))))
      (program (lexical_declaration (variable_declarator name: (identifier) @table.name value: (satisfies_expression (object) @table.obj (_) @_ty)
        (#match? @_ty "Record\\s*<"))))
      (program (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @table.name value: (satisfies_expression (object) @table.obj (_) @_ty)
        (#match? @_ty "Record\\s*<")))))
      (program (lexical_declaration (variable_declarator name: (identifier) @table.name value: (as_expression (object) @table.obj (_) @_ty)
        (#match? @_ty "Record\\s*<"))))
      (program (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @table.name value: (as_expression (object) @table.obj (_) @_ty)
        (#match? @_ty "Record\\s*<")))))
    `,
  },
  {
    ext: /\.py$/i,
    grammar: "python",
    privateName: /^_/,
    query: `
      (module (function_definition name: (identifier) @export))
      (module (decorated_definition (function_definition name: (identifier) @export)))
      (module (class_definition name: (identifier) @export))
      (module (decorated_definition (class_definition name: (identifier) @export)))
      (module (expression_statement (assignment left: (identifier) @export)))
      (class_definition name: (identifier) @domain.name superclasses: (argument_list) @_bases body: (block) @domain.body
        (#match? @_bases "(Int|Str)?(Enum|Flag)"))
      (module (expression_statement (assignment left: (identifier) @table.name right: (dictionary) @table.obj)))
      (module (expression_statement (assignment left: (identifier) @lit.name right: (subscript value: (_) @_lv) @lit.body
        (#match? @_lv "Literal"))))
    `,
  },
];

/** Top-level member names of a captured domain/table node, by node type. One mechanism
 *  for every language: the node kind, not the language, decides how members read out. */
function membersOf(node: Node): string[] {
  const out: string[] = [];
  switch (node.type) {
    case "union_type": {
      // string-literal union alternatives, flattened; ≥2 enforced by the caller
      const walk = (n: Node): void => {
        for (const c of n.namedChildren) {
          if (!c) continue;
          if (c.type === "union_type") walk(c);
          else if (c.type === "literal_type" && c.namedChildren[0]?.type === "string")
            out.push(c.namedChildren[0].text.slice(1, -1));
        }
      };
      walk(node);
      return out;
    }
    case "enum_body":
      for (const c of node.namedChildren) {
        const name = c?.childForFieldName?.("name") ?? (c?.type === "property_identifier" || c?.type === "string" ? c : null);
        if (name) out.push(name.type === "string" ? name.text.slice(1, -1) : name.text);
        else if (c && (c.type === "property_identifier" || c.type === "enum_assignment"))
          out.push((c.childForFieldName("name") ?? c).text);
      }
      return out;
    case "object":
      for (const c of node.namedChildren) {
        if (!c) continue;
        if (c.type === "pair" || c.type === "method_definition") {
          const key = c.childForFieldName("name") ?? c.childForFieldName("key");
          if (key) out.push(key.type === "string" ? key.text.slice(1, -1) : key.text);
        } else if (c.type === "shorthand_property_identifier") out.push(c.text);
      }
      return out;
    case "block": // python enum body: NAME = value assignments at body level
      for (const c of node.namedChildren) {
        if (c?.type !== "expression_statement") continue;
        const a = c.namedChildren[0];
        if (a?.type !== "assignment") continue;
        const left = a.childForFieldName("left");
        if (left?.type === "identifier" && /^[A-Za-z]/.test(left.text)) out.push(left.text);
      }
      return out;
    case "dictionary":
      for (const c of node.namedChildren) {
        if (c?.type !== "pair") continue;
        const key = c.childForFieldName("key");
        if (key?.type === "string") out.push(key.text.replace(/^[rbuf]*["']/i, "").replace(/["']$/, ""));
      }
      return out;
    case "subscript": // Literal["a", "b"]
      for (const c of node.namedChildren)
        if (c?.type === "string") out.push(c.text.replace(/^["']/, "").replace(/["']$/, ""));
      return out;
    default:
      return out;
  }
}

const surfaceQueryCache = new Map<string, Promise<{ parser: import("web-tree-sitter").Parser; query: Query }>>();
function surfaceHandle(lang: SurfaceLanguage): Promise<{ parser: import("web-tree-sitter").Parser; query: Query }> {
  let cached = surfaceQueryCache.get(lang.grammar);
  if (!cached) {
    cached = grammarHandle(lang.grammar).then(({ language, parser }) => ({ parser, query: new Query(language, lang.query) }));
    surfaceQueryCache.set(lang.grammar, cached);
  }
  return cached;
}

/** The surface of one source string, read through the file's grammar. A file no
 *  language claims contributes nothing (unknown extensions were never surface). */
export async function surfaceOfSource(src: string, fileName = "x.ts"): Promise<FileSurface> {
  const exports = new Set<string>();
  const domains = new Map<string, Set<string>>();
  const lang = SURFACE_LANGUAGES.find((l) => l.ext.test(fileName));
  if (!lang) return { exports, domains };
  const { parser, query } = await surfaceHandle(lang);
  const tree = parser.parse(src);
  if (!tree) return { exports, domains };
  const put = (name: string, members: Iterable<string>) => {
    const set = domains.get(name) ?? new Set<string>();
    for (const m of members) set.add(m);
    if (set.size) domains.set(name, set);
  };
  for (const match of query.matches(tree.rootNode)) {
    const by = new Map(match.captures.map((c) => [c.name, c.node]));
    const exp = by.get("export");
    if (exp && !(lang.privateName?.test(exp.text))) exports.add(exp.text);
    const domainName = by.get("domain.name"), domainBody = by.get("domain.body");
    if (domainName && domainBody && !(lang.privateName?.test(domainName.text))) {
      const members = membersOf(domainBody);
      // a union needs ≥2 string alternatives to be a domain; other bodies count as-is
      if (members.length >= (domainBody.type === "union_type" ? 2 : 1)) put(domainName.text, members);
    }
    const tableName = by.get("table.name"), tableObj = by.get("table.obj");
    if (tableName && tableObj) {
      const keys = membersOf(tableObj);
      if (keys.length) put(tableName.text, keys);
    }
    const litName = by.get("lit.name"), litBody = by.get("lit.body");
    if (litName && litBody && !(lang.privateName?.test(litName.text))) {
      exports.add(litName.text);
      const members = membersOf(litBody);
      if (members.length >= 2) put(litName.text, members);
    }
  }
  return { exports, domains };
}

/** Whether a path is a test file (excluded from the surface proxies). Python spellings
 *  mirror oracle-domain's: test_*.py / *_test.py by basename, anywhere in the tree. */
export const isTestPath = (p: string) =>
  /\.(test|spec)\.[mc]?[jt]sx?$/.test(p) || /(^|\/)__tests__\//.test(p) ||
  /(^|\/)test_[^/]*\.py$/.test(p) || /_test\.py$/.test(p);

/** Scan the surface of a set of files under one tree root; missing files (added or
 *  removed on the other side of the range) are simply absent. Exports and domains are
 *  keyed by NAME, merged across files, so a file move reads as churn — not novelty. */
export async function scanSurface(root: string, files: Iterable<string>): Promise<FileSurface> {
  const exports = new Set<string>();
  const domains = new Map<string, Set<string>>();
  for (const rel of files) {
    if (!/\.([mc]?[jt]sx?|py)$/.test(rel) || isTestPath(rel)) continue;
    let src: string;
    try { src = await readFile(join(root, rel), "utf8"); } catch { continue; }
    const s = await surfaceOfSource(src, rel);
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
