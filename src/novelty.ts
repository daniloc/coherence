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
import { grammarHandle, withTree } from "./adapters/tree-sitter.ts";
import type { Config } from "./types.ts";

/** What one source file contributes to the behavioral surface: its exported symbol
 *  names, and its enumerated domains (exported string-literal unions and enums, plus
 *  top-level `Record<…>`-annotated const tables — export NOT required for tables). */
export interface FileSurface { exports: Set<string>; domains: Map<string, Set<string>>; }

// ── the per-language surface data (queries, not scanners — and CAPTURE-COMPLETE) ─────
// Pack purity: a row carries query text and regex fields only — no functions, and no
// grammar vocabulary left behind in the mechanism (the old `membersOf` switched on six
// grammar node types; its knowledge now lives in the queries as member captures).
// Capture classes, aggregated by the one mechanism below:
//   `@export`                    — a name node added to exports;
//   `@domain.name`+`@domain.member` — an enumerated body (TS/python enums): one match
//                                  per member, the same name capture in each;
//   `@table.name`+`@table.key`   — a keyed table (counted whether or not exported);
//   `@lit.name`+`@lit.member`    — a string-literal domain (TS unions, python
//                                  `Literal[…]`); the ≥2-member floor is mechanism.
// A class may also capture `<cls>.body` when the grammar splits members across
// matches — TS unions nest left-associatively ((("a"|"b")|"c")|"d"), so a direct-child
// pattern sees one LEVEL only and web-tree-sitter 0.26 has no wildcard-depth operator.
// The union members therefore arrive through two patterns: the outermost level rides
// the anchored alias pattern (same-match `@lit.name`), and each deeper level fires the
// UNION-PARENTED pattern `(union_type (union_type (literal_type …)))` — the exact
// chain shape, so a union sitting under a non-union node (an object-type field, a
// generic argument) matches neither pattern, preserving the old union-edges-only walk.
// Those deeper matches carry no name; the mechanism attaches them to the enclosing
// captured `@lit.body` by byte range.
interface SurfaceLanguage {
  ext: RegExp;
  grammar: string;
  query: string;
  /** exports whose names match are dropped (python's `_` convention). */
  privateName?: RegExp;
}

// The object-member alternation shared by the six TS table forms: pair keys, method
// names, shorthand properties — direct children of the table's object literal only.
const TS_TABLE_MEMBERS =
  `(object [(pair key: (_) @table.key) (method_definition name: (_) @table.key) (shorthand_property_identifier) @table.key])`;

export const SURFACE_LANGUAGES: SurfaceLanguage[] = [
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
      (export_statement declaration: (type_alias_declaration name: (type_identifier) @lit.name value: (union_type) @lit.body))
      (export_statement declaration: (type_alias_declaration name: (type_identifier) @lit.name value: (union_type (literal_type (string) @lit.member))))
      (union_type (union_type (literal_type (string) @lit.member)))
      (export_statement declaration: (enum_declaration name: (identifier) @domain.name
        body: (enum_body [(property_identifier) @domain.member (string) @domain.member (enum_assignment name: (_) @domain.member)])))
      (program (lexical_declaration (variable_declarator name: (identifier) @table.name type: (type_annotation (_) @_ty) value: ${TS_TABLE_MEMBERS}
        (#match? @_ty "Record\\s*<"))))
      (program (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @table.name type: (type_annotation (_) @_ty) value: ${TS_TABLE_MEMBERS}
        (#match? @_ty "Record\\s*<")))))
      (program (lexical_declaration (variable_declarator name: (identifier) @table.name value: (satisfies_expression ${TS_TABLE_MEMBERS} (_) @_ty)
        (#match? @_ty "Record\\s*<"))))
      (program (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @table.name value: (satisfies_expression ${TS_TABLE_MEMBERS} (_) @_ty)
        (#match? @_ty "Record\\s*<")))))
      (program (lexical_declaration (variable_declarator name: (identifier) @table.name value: (as_expression ${TS_TABLE_MEMBERS} (_) @_ty)
        (#match? @_ty "Record\\s*<"))))
      (program (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @table.name value: (as_expression ${TS_TABLE_MEMBERS} (_) @_ty)
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
      (class_definition name: (identifier) @domain.name superclasses: (argument_list) @_bases
        body: (block (expression_statement (assignment left: (identifier) @domain.member)))
        (#match? @_bases "(Int|Str)?(Enum|Flag)") (#match? @domain.member "^[A-Za-z]"))
      (module (expression_statement (assignment left: (identifier) @table.name right: (dictionary (pair key: (string) @table.key)))))
      (module (expression_statement (assignment left: (identifier) @lit.name right: (subscript value: (_) @_lv subscript: (string) @lit.member)
        (#match? @_lv "Literal"))))
    `,
  },
];

// ── the one mechanism: aggregate captures by CLASS, never by grammar node type ───────
// Floors and privacy are POLICY, shared by every language: a string-literal domain
// needs ≥2 alternatives to be a domain; enum bodies and keyed tables count from one;
// a module-local `_TABLE = {…}` still counts (tables were never privacy-filtered).
const MEMBER_FLOOR: Record<string, number> = { domain: 1, table: 1, lit: 2 };
const PRIVATE_EXEMPT = new Set(["table"]);

/** One generic unquote for a captured string node: strip letter prefixes (python's
 *  r/b/u/f) plus one quote each side. A no-op on unquoted member text (identifiers,
 *  numbers, computed keys), so every member capture funnels through it. */
const unquote = (text: string): string =>
  text.replace(/^[A-Za-z]*["']/, "").replace(/["']$/, "");

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
  // Aggregation state: members per (class, name) across matches; captured body spans;
  // members whose match carried no name (the grammar split them off — TS union levels).
  const collected = new Map<string, Map<string, Set<string>>>();
  const bodies: Array<{ cls: string; name: string; start: number; end: number }> = [];
  const strays: Array<{ cls: string; start: number; text: string }> = [];
  const membersFor = (cls: string, name: string): Set<string> => {
    let per = collected.get(cls);
    if (!per) collected.set(cls, (per = new Map()));
    let set = per.get(name);
    if (!set) per.set(name, (set = new Set()));
    return set;
  };
  withTree(parser, src, null, (tree) => {
  for (const match of query.matches(tree.rootNode)) {
    let name: { cls: string; text: string } | undefined;
    let body: { cls: string; node: Node } | undefined;
    const members: Array<{ cls: string; node: Node }> = [];
    for (const c of match.captures) {
      if (c.name === "export") {
        if (!(lang.privateName?.test(c.node.text))) exports.add(c.node.text);
      } else if (c.name.endsWith(".name")) name = { cls: c.name.slice(0, -".name".length), text: c.node.text };
      else if (c.name.endsWith(".body")) body = { cls: c.name.slice(0, -".body".length), node: c.node };
      else if (c.name.endsWith(".member") || c.name.endsWith(".key"))
        members.push({ cls: c.name.replace(/\.(member|key)$/, ""), node: c.node });
    }
    if (name) {
      if (!PRIVATE_EXEMPT.has(name.cls) && lang.privateName?.test(name.text)) continue;
      const set = membersFor(name.cls, name.text);
      for (const m of members) set.add(unquote(m.node.text));
      if (body) bodies.push({ cls: body.cls, name: name.text, start: body.node.startIndex, end: body.node.endIndex });
    } else {
      for (const m of members) strays.push({ cls: m.cls, start: m.node.startIndex, text: unquote(m.node.text) });
    }
  }
  return null;
  });
  // A stray belongs to the same-class body whose byte range contains it; one no body
  // claims was never domain surface (a function-signature union, a non-exported alias).
  for (const s of strays) {
    const home = bodies.find((b) => b.cls === s.cls && s.start >= b.start && s.start < b.end);
    if (home) membersFor(home.cls, home.name).add(s.text);
  }
  for (const [cls, per] of collected) {
    const floor = MEMBER_FLOOR[cls] ?? 1;
    for (const [name, members] of per) {
      if (members.size < floor) continue;
      const set = domains.get(name) ?? new Set<string>();
      for (const m of members) set.add(m);
      domains.set(name, set);
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
