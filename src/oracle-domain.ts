// oracle-domain.ts — the META-ORACLE. A `boundary "<inv>" at <sym> via test "<oracle>"`
// claim already checks (a) the chokepoint symbol exists and (b) the named oracle test
// passes. Those two say NOTHING about whether the oracle is a REAL totality check: a test
// that loops a hand-written array (or a name-regex, or no domain at all) passes, looks
// total, and proves NOTHING about completeness. This module is the third assertion — it
// reads the oracle's OWN source and classifies HOW it iterates its domain:
//
//   LIVE         — its primary assertion loop ranges over a LIVE-derived collection: an
//                  imported binding (a registry/SSOT), a call result (verifyXTotality(),
//                  a DB/PRAGMA query), member access on an import, or the anchor symbol
//                  itself. Completeness is pinned to the live domain → a real totality.
//   LITERAL      — it loops an ArrayExpression / RegExp literal, or a SAME-FILE const
//                  array (`const PATTERNS = [...]`). A sampling oracle wearing the
//                  totality label: the hand-list drifts from the domain silently.
//   NO-ITERATION — it never loops a domain at all (a pure source-grep like
//                  `src.not.toMatch(...)`, or a fixed list of hand-enumerated `it()`
//                  blocks). Asserts a SOURCE PROPERTY, not domain coverage.
//
// LIVE passes the meta-oracle. LITERAL and NO-ITERATION are FALSE oracles for a
// `via test` claim → the boundary fails until the domain is derived from the live SSOT
// (or, for a legitimate source-property guard, re-declared with `via guard` — see verify).
//
// SHAPE (the declarative baseline). Everything a LANGUAGE contributes lives in one row of
// ORACLE_LANGUAGES below — query text, regex sources, wrapper-name lists, detail
// templates: data, never functions (the pack-purity rule). Everything that DECIDES lives
// once, below the table, and is language-blind: the verdict lattices, the conservative
// unknown-identifier rule, the floor semantics, the detail rendering. Between the two sit
// the mechanism-owned EXTRACTION STRATEGIES the rows name by grade — "grammar-query"
// resolves a row's tree-sitter queries into DomainRefs and a Scope (node walks ported 1:1
// from the retired compiler visitors; the 898-comparison gate proved the walk, and the
// query port was re-gated the same way); "indent-regex" resolves a row's regex fields the
// way the retired python analyzers did, quirks preserved on purpose (d-3aa0cbff kept
// python at this grade; this table is the re-open condition it named). Cooked-string
// title matching is likewise a named strategy: escape decoding is language-blind.
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { Query, type Node, type Parser } from "web-tree-sitter";
import { grammarHandle } from "./adapters/tree-sitter.ts";
import type { Config } from "./types.ts";

export type OracleVerdict = "live" | "literal" | "no-iteration" | "not-found";

export interface OracleAnalysis {
  verdict: OracleVerdict;
  /** human-readable detail: the iterated expression + how its root resolved. */
  detail: string;
  /** the test file (relative to root) the describe block was found in, if any. */
  file?: string;
  /**
   * Whether the oracle asserts a lower bound on its domain size. Only meaningful
   * when verdict === "live": a LIVE domain is necessary but NOT sufficient — a
   * live-derived collection that can silently shrink to empty (a schema
   * projection whose shape changed, an `.options`/registry that collapsed) makes
   * the assertion loop range over nothing and pass VACUOUSLY. A floor
   * (`expect(domain.length).toBeGreaterThanOrEqual(n)`, or a `.length >= n`
   * check) turns that collapse into a loud failure. Heuristic, best-effort.
   */
  hasFloor?: boolean;
}

// ── ORACLE_LANGUAGES: the per-language oracle data ───────────────────────────────────
// One row per language; a row carries ONLY query text, regex/string fields, and the
// names of mechanism-owned strategies. How each domain CLASSIFIES — and every verdict —
// is decided once, below, from the DomainRefs the row's grade strategy extracts.

/** Why one iterated domain classified the way it did. The classifier (one, language-
 *  blind) emits these; a row's detailTemplates renders them, so a language can vary its
 *  phrasing without owning any verdict logic (python phrases every live reason the same
 *  way; typescript phrases each resolution). Placeholders: {expr} the iterated
 *  expression's display text, {expr40}/{expr50} the same truncated, {root} the resolved
 *  root identifier. */
export type OracleDetailReason =
  | "inline-literal" // the domain is itself an array/list/regex literal
  | "call"           // a bare call result with no resolvable root — live by definition
  | "imported"       // roots at an imported binding (the live SSOT)
  | "live-local"     // roots at a local bound to a call/query result
  | "const-array"    // roots at a same-file const array/regex literal — the hand-list
  | "call-root"      // a call hanging off an unknown root — conservatively live
  | "opaque-root"    // an unknown identifier (param, closure, anchor symbol) — live
  | "unresolved";    // nothing resolvable at all — conservatively live

interface OracleLanguageCommon {
  /** How this language's test files are recognized, by name or path. */
  testFilePattern: RegExp;
  /** Transparent wrappers root resolution sees through — names only, never functions
   *  (TS: `Object.keys(X)` → X for the coverage AND parity arms; python: `sorted(X)` → X
   *  for the parity arm — the coverage arm never unwrapped, and still does not). */
  unwrapCalls: string[];
  /** Rendering for each classification reason — see OracleDetailReason. */
  detailTemplates: Record<OracleDetailReason, string>;
  /** Detail when the anchor block iterates no domain at all. */
  noIterationDetail: string;
  /** Detail when the anchor exists but has no body (only the query grade can see one). */
  emptyAnchorDetail?: string;
  /** Appended when >1 domains all classify literal ({n} = how many more). A row without
   *  one reports only the first literal domain, as the python arm always has. */
  multiLiteralSuffix?: string;
}

/** A language read at query grade: a shared tree-sitter grammar plus capture patterns.
 *  Capture classes — anchor: `anchor.call`/`anchor.fn`/`anchor.args` (a named test
 *  block; the title is arg 0, matched cooked); scope: `scope.import` (a name bound by an
 *  import — live), `scope.specifier` (a named-import specifier; alias wins over name),
 *  `scope.name`+`scope.decl` (a local declarator, classified literal-vs-live from its
 *  initializer); iteration: `for.stmt`+`for.domain`, `iter.call`+`iter.recv`+
 *  `iter.method`, `each.call`+`each.recv`+`each.args`, `spread.el`; floor: any match is
 *  a domain-size lower bound. A row contributes patterns, never verdict logic. */
export interface QueryOracleLanguage extends OracleLanguageCommon {
  grade: "grammar-query";
  grammar: string;
  /** Title comparison strategy, from the closed set the mechanism owns: "cooked-string"
   *  decodes escapes/template fragments before comparing — escape decoding is
   *  language-blind, so it is mechanism, named here rather than carried as code. */
  titleMatch: "cooked-string";
  anchorQuery: string;
  scopeQuery: string;
  iterationQuery: string;
  floorQuery: string;
  /** Receiver methods peeled while resolving a chain to its source collection. */
  chainMethods: string[];
  /** A spread whose HOST node is one of these types is not domain iteration (object
   *  spread never was); one whose inner expression is one of these is a literal already.
   *  Node-type names are data here so the mechanism never hardcodes a grammar's. */
  spreadNotHost: string[];
  spreadNotInner: string[];
}

/** A language read at regex/indent grade (no grammar; d-3aa0cbff declared the grade).
 *  anchorPatterns anchor a named block exactly ({name} = the escaped oracle name;
 *  capture 1 = the block's indent); domainPatterns each capture one iterated-domain
 *  expression; importPatterns bind live names; literalDomainPatterns mark a domain
 *  expression as a hand-list; floorPattern is the domain-size lower bound. */
export interface RegexOracleLanguage extends OracleLanguageCommon {
  grade: "indent-regex";
  anchorPatterns: string[];
  domainPatterns: RegExp[];
  importPatterns: { fromImport: RegExp; plainImport: RegExp };
  literalDomainPatterns: RegExp[];
  floorPattern: RegExp;
}

export type OracleLanguageSpec = QueryOracleLanguage | RegexOracleLanguage;

export const ORACLE_LANGUAGES: { typescript: QueryOracleLanguage; python: RegexOracleLanguage } = {
  typescript: {
    grade: "grammar-query",
    grammar: "typescript",
    testFilePattern: /\.(test|spec)\.[mc]?[jt]sx?$/,
    titleMatch: "cooked-string",
    // A named test block: describe("<title>", body) — bare or as a member property
    // (`x.describe(...)`); the title must be a cooked string, matched by the mechanism.
    anchorQuery: `
      (call_expression
        function: [
          (identifier) @anchor.fn
          (member_expression property: (property_identifier) @anchor.fn)
        ]
        arguments: (arguments) @anchor.args
        (#eq? @anchor.fn "describe")) @anchor.call
    `,
    // What binds a name in the file: imports in every clause form (live), and local
    // declarators (their initializer decides literal-vs-live, mechanism-side).
    scopeQuery: `
      (import_statement (import_clause (identifier) @scope.import))
      (import_statement (import_clause (namespace_import (identifier) @scope.import)))
      (import_statement (import_clause (named_imports (import_specifier) @scope.specifier)))
      (import_statement (import_require_clause (identifier) @scope.import))
      (lexical_declaration (variable_declarator name: (identifier) @scope.name) @scope.decl)
      (variable_declaration (variable_declarator name: (identifier) @scope.name) @scope.decl)
    `,
    // What iteration looks like: for-of/for-in (one grammar node covers both), a
    // receiver-iterating method call, the it/test/describe `.each` parameterization
    // idiom (the each ARGUMENT is the domain; missing this form misclassifies the most
    // idiomatic totality oracles as NO-ITERATION), and spread of a collection.
    iterationQuery: `
      (for_in_statement right: (_) @for.domain) @for.stmt
      (call_expression
        function: (member_expression object: (_) @iter.recv property: (property_identifier) @iter.method)
        (#any-of? @iter.method "forEach" "map" "flatMap" "filter" "every" "some" "reduce" "reduceRight")) @iter.call
      (call_expression
        function: (member_expression object: (identifier) @each.recv property: (property_identifier) @each.method)
        arguments: (arguments) @each.args
        (#eq? @each.method "each")
        (#any-of? @each.recv "it" "test" "describe")) @each.call
      (spread_element) @spread.el
    `,
    // A domain-size lower bound: a floor matcher whose ASSERTED expression references a
    // size (`expect(domain.length).toBeGreaterThanOrEqual(n)` — not `toBeGreaterThan(0)`
    // on some scalar), or a bare `.length`/`.size`/`.count` `>=`/`>` comparison.
    floorQuery: `
      (call_expression
        function: (member_expression object: (_) @floor.target property: (property_identifier) @floor.matcher)
        (#any-of? @floor.matcher "toBeGreaterThan" "toBeGreaterThanOrEqual")
        (#match? @floor.target "\\\\.(length|size|count)\\\\b"))
      ((binary_expression operator: [">=" ">"]) @floor.compare
        (#match? @floor.compare "\\\\.(length|size|count)\\\\b"))
    `,
    unwrapCalls: ["Object.keys", "Object.values", "Object.entries", "Array.from"],
    chainMethods: ["map", "forEach", "flatMap", "filter", "every", "some", "reduce", "reduceRight", "find", "findIndex", "sort"],
    spreadNotHost: ["object"],
    spreadNotInner: ["array"],
    detailTemplates: {
      "inline-literal": "inline {expr40} literal",
      "call": "call {expr50}",
      "imported": "imported `{root}`",
      "live-local": "live local `{root}` (call/query result)",
      "const-array": "same-file const array `{root}`",
      "call-root": "call on `{root}`",
      "opaque-root": "`{root}` (non-literal root)",
      "unresolved": "unresolved domain {expr40}",
    },
    noIterationDetail: "no for-of / .forEach / .map / spread over a domain",
    emptyAnchorDetail: "describe has no body",
    multiLiteralSuffix: " (+{n} more, all literal)",
  },
  python: {
    grade: "indent-regex",
    testFilePattern: /(^|\/)test_[^/]*\.py$|_test\.py$/,
    // `def <name>(` (async allowed, any indent) or `class <Name>`, exact-name — pytest
    // -k will still substring-match for the runner, but analysis anchors exactly,
    // mirroring the TS describe rule. Capture 1 is the indent the block runs to.
    anchorPatterns: ["^(\\s*)(?:async\\s+)?def\\s+{name}\\s*\\(", "^(\\s*)class\\s+{name}\\b"],
    // `for X in <domain>:` and `@pytest.mark.parametrize("...", <domain>)`.
    domainPatterns: [
      /for\s+[\w,\s()]+\s+in\s+([^:]+):/,
      /parametrize\(\s*["'][^"']+["']\s*,\s*((?:\[[^\]]*\])|[A-Za-z_][\w.()]*)/,
    ],
    importPatterns: {
      fromImport: /^from\s+\S+\s+import\s+(.+)$/,
      plainImport: /^import\s+([A-Za-z_][\w.]*)/,
    },
    // An inline list/tuple literal, or a hand-chosen `range(...)` bound.
    literalDomainPatterns: [/^[\[(]/, /^range\(/],
    // A len(...) lower-bound assertion anywhere in the block.
    floorPattern: /len\([^)]*\)\s*>=?\s*\d|assert\s+[^\n]*len\(/,
    unwrapCalls: ["sorted", "list", "set", "tuple", "frozenset", "enumerate", "reversed", "iter"],
    // Regex grade resolves no local scope, so it phrases every live reason identically
    // (tuned conservative like the TS unknown-identifier rule: only an UNAMBIGUOUS
    // hand-list reads literal — never a false fail) and every literal reason as the
    // inline hand-list it is. live-local/const-array are unreachable at this grade;
    // their entries keep the table total by verdict kind.
    detailTemplates: {
      "inline-literal": "inline {expr40} literal",
      "call": "for-in/parametrize over {expr}",
      "imported": "for-in/parametrize over {expr}",
      "live-local": "for-in/parametrize over {expr}",
      "const-array": "inline {expr40} literal",
      "call-root": "for-in/parametrize over {expr}",
      "opaque-root": "for-in/parametrize over {expr}",
      "unresolved": "for-in/parametrize over {expr}",
    },
    noIterationDetail: "no for-in / parametrize over a domain",
  },
};

/** Python test files, by name or path. Exported so redundancy.ts can exclude exactly the
 *  set of files the oracle analyzers read — a second spelling of this convention over there
 *  is the duplicated-domain finding that module exists to report. */
export const isPyTestPath = (p: string) => ORACLE_LANGUAGES.python.testFilePattern.test(p);

/** A test file (NOT a *.spec.md — those are coherence specs, not runnable tests). */
const isTestFile = (name: string) =>
  name !== "spec.md" && Object.values(ORACLE_LANGUAGES).some((row) => row.testFilePattern.test(name));

/** The language row that reads one discovered test file. */
const rowFor = (rel: string): OracleLanguageSpec =>
  Object.values(ORACLE_LANGUAGES).find((row) => row.testFilePattern.test(rel)) ?? ORACLE_LANGUAGES.typescript;

// Dirs that are never source, regardless of the project's graph-`ignore`. We deliberately
// do NOT reuse cfg.ignore: a project commonly excludes its test dir (e.g. "__tests__") from
// the spec GRAPH while that is exactly where the oracle tests we must read live. Reusing the
// graph-ignore here would make every oracle resolve NOT-FOUND and the meta-oracle inert.
// Exported because redundancy.ts needs the SAME list and a second copy of it is exactly the
// duplicated-domain finding that module exists to report (it flagged the copy, so the copy died).
export const NOISE_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".turbo", ".wrangler", ".next", "coverage", ".coherence"]);

/** Locate candidate test files under root, skipping only true build/VCS noise. */
async function findTestFiles(cfg: Config): Promise<string[]> {
  const ignore = NOISE_DIRS;
  const out: string[] = [];
  async function visit(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".") || ignore.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await visit(p);
      else if (isTestFile(e.name)) out.push(relative(cfg.root, p));
    }
  }
  await visit(cfg.root);
  return out;
}

// ── the language-blind spine: what a grade strategy must extract ─────────────────────
// One iterated domain, reduced to what classification needs. `root` is the leftmost
// identifier the coverage arm resolves against scope; `parityRoot` is the leftmost
// identifier after unwrapCalls peel (identical at query grade; the regex grade's
// coverage arm never unwrapped and still does not — that asymmetry is the OLD contract).
interface DomainRef {
  /** display text for details (query grade: the unwrapped expression; regex grade: raw). */
  text: string;
  root: string | null;
  parityRoot: string | null;
  selfLiteral: boolean;
  isCall: boolean;
}

/** Import/local bindings resolved for one file, so the classifier can decide whether an
 *  iterated identifier is LIVE (imported / call result) or LITERAL (local hand-list). */
interface Scope {
  imported: Set<string>;                 // names bound by an import (live SSOT)
  localArrayConst: Map<string, boolean>; // local const name → true iff initialized to an array/regex literal
  localOther: Set<string>;               // local names bound to something NON-literal (call result, etc.) = live
}

/** Everything both verdict lattices consume for one found anchor. */
interface AnchorView {
  /** The anchor exists but owns no body node (query grade only). */
  emptyAnchor?: boolean;
  domains: DomainRef[];
  scope: Scope;
  hasFloor: boolean;
  /** Does the anchor's block exercise this name? (parity's both-projections check). */
  mentions: (name: string) => boolean;
}

const EMPTY_SCOPE: Scope = { imported: new Set(), localArrayConst: new Map(), localOther: new Set() };

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Resolve one oracle anchor in one file through the row's grade strategy. */
function anchorView(row: OracleLanguageSpec, src: string, oracleName: string): Promise<AnchorView | null> | AnchorView | null {
  return row.grade === "grammar-query" ? queryAnchorView(row, src, oracleName) : regexAnchorView(row, src, oracleName);
}

// ── the "grammar-query" strategy ─────────────────────────────────────────────────────
// Runs a row's queries over the shared tree-sitter grammar handle and resolves the
// captures into DomainRefs/Scope. The expression resolution below (cast unwrapping,
// leftmost-root walking, cooked strings) mirrors the retired compiler visitors 1:1 —
// classification is scope-dependent, which is walk-shaped work; the grammar contributes
// the parse and the row contributes the patterns, never the verdicts.

interface QueryHandles { parser: Parser; anchor: Query; scope: Query; iteration: Query; floor: Query }
const queryHandleCache = new Map<string, Promise<QueryHandles>>();
function queryHandles(row: QueryOracleLanguage): Promise<QueryHandles> {
  let cached = queryHandleCache.get(row.grammar);
  if (!cached) {
    cached = (async () => {
      const { language, parser } = await grammarHandle(row.grammar);
      return {
        parser,
        anchor: new Query(language, row.anchorQuery),
        scope: new Query(language, row.scopeQuery),
        iteration: new Query(language, row.iterationQuery),
        floor: new Query(language, row.floorQuery),
      };
    })();
    queryHandleCache.set(row.grammar, cached);
  }
  return cached;
}

/** Pre-order among pattern anchors: by start, outermost first on ties — the same visit
 *  order the retired walk (and the compiler visitors before it) produced. */
const preorder = (a: Node, b: Node) => a.startIndex - b.startIndex || b.endIndex - a.endIndex;

/** Pre-order walk over named nodes (parity's identifier collection still walks). */
function walk(n: Node, fn: (n: Node) => void): void {
  fn(n);
  for (const c of n.namedChildren) if (c) walk(c, fn);
}

/** Named children minus comments — the grammar names trivia as nodes; the compiler's
 *  `node.arguments` never contained trivia, so neither may any argument list here. */
const nonComment = (n: Node): Node[] => n.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");

/** The named arguments of a call/new expression, comments excluded. */
function callArgs(call: Node): Node[] {
  const args = call.childForFieldName("arguments");
  return args ? nonComment(args) : [];
}

const UNESCAPE: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };

/** The "cooked-string" strategy: the cooked text of a string literal or substitution-free
 *  template — the compiler's `.text` decoded escapes, so fragments+escapes reassemble the
 *  same way. Language-blind (escape decoding owes nothing to the grammar), so mechanism. */
function stringText(node: Node): string | null {
  if (node.type !== "string" && node.type !== "template_string") return null;
  if (node.type === "template_string" && node.namedChildren.some((c) => c?.type === "template_substitution")) return null;
  let out = "";
  for (const c of node.namedChildren) {
    if (!c) continue;
    if (c.type === "string_fragment") out += c.text;
    else if (c.type === "escape_sequence") { const e = c.text.slice(1); out += UNESCAPE[e] ?? e; }
  }
  return out;
}

/** First anchor (pre-order) whose cooked title === oracleName. */
function findAnchor(anchor: Query, rootNode: Node, oracleName: string): { call: Node; args: Node } | null {
  const hits: { call: Node; args: Node }[] = [];
  for (const m of anchor.matches(rootNode)) {
    let call: Node | undefined, args: Node | undefined;
    for (const c of m.captures) {
      if (c.name === "anchor.call") call = c.node;
      else if (c.name === "anchor.args") args = c.node;
    }
    if (call && args) hits.push({ call, args });
  }
  hits.sort((a, b) => preorder(a.call, b.call));
  for (const h of hits) {
    const title = nonComment(h.args)[0];
    if (title && stringText(title) === oracleName) return h;
  }
  return null;
}

/** unwrap `as const`, `satisfies`, parens down to the wrapped expression. */
function unwrapCasts(e: Node, withSatisfies = true): Node {
  for (let guard = 0; guard < 12; guard++) {
    if (e.type === "parenthesized_expression" || e.type === "as_expression" ||
        (withSatisfies && e.type === "satisfies_expression")) {
      const inner = nonComment(e)[0];
      if (!inner) break;
      e = inner;
      continue;
    }
    break;
  }
  return e;
}

function buildScope(scope: Query, rootNode: Node): Scope {
  const imported = new Set<string>();
  const localArrayConst = new Map<string, boolean>();
  const localOther = new Set<string>();

  const isLiteralDomain = (init: Node | null): boolean => {
    if (!init) return false;
    const e = unwrapCasts(init);
    if (e.type === "array") return true;
    if (e.type === "regex") return true;
    // `new Set([...])` / `new Map([...])` over a literal is still a hand-list
    if (e.type === "new_expression") {
      const args = callArgs(e);
      if (args.length === 1 && unwrapCasts(args[0], /*withSatisfies*/ false).type === "array") return true;
    }
    return false;
  };

  for (const m of scope.matches(rootNode)) {
    let name: Node | undefined, decl: Node | undefined;
    for (const c of m.captures) {
      if (c.name === "scope.import") imported.add(c.node.text);
      else if (c.name === "scope.specifier") {
        // the LOCAL binding: the alias when present, else the imported name
        const local = c.node.childForFieldName("alias") ?? c.node.childForFieldName("name");
        if (local) imported.add(local.text);
      } else if (c.name === "scope.name") name = c.node;
      else if (c.name === "scope.decl") decl = c.node;
    }
    if (!name || !decl) continue;
    const init = decl.childForFieldName("value");
    // require("…") destructure/binding → treat as imported (live)
    const callee = init?.type === "call_expression" ? init.childForFieldName("function") : null;
    if (callee?.type === "identifier" && callee.text === "require") { imported.add(name.text); continue; }
    if (isLiteralDomain(init)) localArrayConst.set(name.text, true);
    else localOther.add(name.text); // bound to a call result, member access, etc. → live-ish
  }
  return { imported, localArrayConst, localOther };
}

/** The root identifier an iterated expression hangs off of, plus whether the iterated
 *  expression ITSELF is a literal (array/regex) regardless of any identifier. */
interface IterTarget { root: Node | null; selfLiteral: boolean; text: string; isCall: boolean; }

function iterTargetOf(expr: Node, row: QueryOracleLanguage): IterTarget {
  let e: Node = expr;
  const unwrap = new Set(row.unwrapCalls);
  const chain = new Set(row.chainMethods);
  // unwrap the row's transparent helpers (Object.keys(X) / Array.from(X) / …) to X
  const unwrapHelper = (c: Node): Node | null => {
    const callee = c.childForFieldName("function");
    if (callee?.type === "member_expression") {
      const objNode = callee.childForFieldName("object");
      if (objNode?.type === "identifier") {
        const key = `${objNode.text}.${callee.childForFieldName("property")?.text ?? ""}`;
        const arg0 = callArgs(c)[0];
        if (unwrap.has(key) && arg0) return arg0;
      }
    }
    return null;
  };
  // peel chained .map/.filter/etc and helper wrappers down to the source collection
  for (let guard = 0; guard < 12; guard++) {
    if (e.type === "parenthesized_expression" || e.type === "as_expression" || e.type === "satisfies_expression") {
      const inner = nonComment(e)[0];
      if (!inner) break;
      e = inner; continue;
    }
    if (e.type === "call_expression") {
      const helper = unwrapHelper(e);
      if (helper) { e = helper; continue; }
      // X.map(...)/X.filter(...) → recurse into X (the receiver is the domain)
      const callee = e.childForFieldName("function");
      if (callee?.type === "member_expression" && chain.has(callee.childForFieldName("property")?.text ?? "")) {
        const obj = callee.childForFieldName("object");
        if (obj) { e = obj; continue; }
      }
      // a bare call like verifyTotality() or query() — the call result IS the domain (live)
      break;
    }
    break;
  }
  const text = e.text;
  const args = e.type === "new_expression" ? callArgs(e) : [];
  const selfLiteral = e.type === "array" || e.type === "regex" ||
    (e.type === "new_expression" && args.length === 1 && args[0].type === "array");
  const isCall = e.type === "call_expression";
  // find the root identifier: bare identifier, or the leftmost of a member-access chain
  let root: Node | null = null;
  if (e.type === "identifier") root = e;
  else if (e.type === "member_expression") {
    let p: Node | null = e;
    while (p && p.type === "member_expression") p = p.childForFieldName("object");
    if (p?.type === "identifier") root = p;
  } else if (e.type === "call_expression") {
    let c: Node | null = e.childForFieldName("function");
    while (c && c.type === "member_expression") c = c.childForFieldName("object");
    if (c?.type === "identifier") root = c;
  } else if (e.type === "subscript_expression") {
    let p: Node | null = e;
    while (p && (p.type === "subscript_expression" || p.type === "member_expression")) p = p.childForFieldName("object");
    if (p?.type === "identifier") root = p;
  }
  return { root, selfLiteral, text, isCall };
}

/** Every domain-iteration construct inside `block`, in the visit order the retired walk
 *  produced (pre-order among the constructs' own nodes). */
function findLoops(row: QueryOracleLanguage, iteration: Query, block: Node): Node[] {
  const hits: { anchor: Node; domain: Node }[] = [];
  for (const m of iteration.matches(block)) {
    const cap = (name: string) => m.captures.find((c) => c.name === name)?.node;
    const forStmt = cap("for.stmt");
    if (forStmt) {
      const d = cap("for.domain");
      if (d) hits.push({ anchor: forStmt, domain: d });
      continue;
    }
    const iterCall = cap("iter.call");
    if (iterCall) {
      // X.forEach(...) / X.map(...) etc — the RECEIVER is the iterated domain
      const d = cap("iter.recv");
      if (d) hits.push({ anchor: iterCall, domain: d });
      continue;
    }
    const eachCall = cap("each.call");
    if (eachCall) {
      // it.each(X)(...) — the each ARGUMENT is the iterated domain
      const args = cap("each.args");
      const d = args ? nonComment(args)[0] : undefined;
      if (d) hits.push({ anchor: eachCall, domain: d });
      continue;
    }
    const spread = cap("spread.el");
    if (spread) {
      // spread of a collection: [...X] — but never object spread, and not a literal already
      if (spread.parent && row.spreadNotHost.includes(spread.parent.type)) continue;
      const inner = nonComment(spread)[0];
      if (inner && !row.spreadNotInner.includes(inner.type)) hits.push({ anchor: spread, domain: inner });
    }
  }
  hits.sort((a, b) => preorder(a.anchor, b.anchor));
  return hits.map((h) => h.domain);
}

async function queryAnchorView(row: QueryOracleLanguage, src: string, oracleName: string): Promise<AnchorView | null> {
  const h = await queryHandles(row);
  // JS/TS both parse fine for our purposes; a null tree (allocation failure) reads as
  // "no anchor here", exactly as the parse helper always has.
  const tree = h.parser.parse(src);
  if (!tree) return null;
  const found = findAnchor(h.anchor, tree.rootNode, oracleName);
  if (!found) return null;
  const body = nonComment(found.args)[1];
  if (!body) return { emptyAnchor: true, domains: [], scope: EMPTY_SCOPE, hasFloor: false, mentions: () => false };
  const domains = findLoops(row, h.iteration, body).map((d): DomainRef => {
    const t = iterTargetOf(d, row);
    const root = t.root?.text ?? null;
    return { text: t.text, root, parityRoot: root, selfLiteral: t.selfLiteral, isCall: t.isCall };
  });
  const scope = buildScope(h.scope, tree.rootNode);
  const hasFloor = h.floor.matches(body).length > 0;
  // The compiler counted every Identifier node, property names included; the grammar
  // splits those kinds, so every *identifier node type counts.
  let ids: Set<string> | null = null;
  const mentions = (name: string): boolean => {
    if (!ids) {
      ids = new Set<string>();
      walk(body, (n) => { if (n.type.endsWith("identifier")) ids!.add(n.text); });
    }
    return ids.has(name);
  };
  return { domains, scope, hasFloor, mentions };
}

// ── the "indent-regex" strategy ──────────────────────────────────────────────────────
// Resolves a row's regex fields the way the retired python analyzers did: the anchor
// owns the indent block below it (decorators included — parametrize domains live
// there), domains read out textually, and imports are the only scope. Quirks are the
// contract, preserved on purpose — see d-3aa0cbff for the grade ruling.

/** The indent block a row's anchor patterns own: first line matching any pattern
 *  (pattern order per line), running to the next non-blank line at <= the anchor's
 *  indent, decorators above included. One spelling of the anchor/indent discipline,
 *  shared by the coverage arm and the parity arm — not two. */
function indentBlock(row: RegexOracleLanguage, src: string, name: string): string | null {
  const lines = src.split("\n");
  const patterns = row.anchorPatterns.map((p) => new RegExp(p.replaceAll("{name}", () => escRe(name))));
  let start = -1, indent = "";
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null = null;
    for (const re of patterns) { m = re.exec(lines[i]); if (m) break; }
    if (m) { start = i; indent = m[1]; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (!l.startsWith(indent + " ") && !l.startsWith(indent + "\t")) { end = i; break; }
  }
  let decoStart = start;
  while (decoStart > 0 && lines[decoStart - 1].trim().startsWith("@")) decoStart--;
  return lines.slice(decoStart, end).join("\n");
}

/** Every iterated-domain expression in a block, textually, in pattern order. */
function regexDomains(row: RegexOracleLanguage, block: string): string[] {
  const domains: string[] = [];
  for (const p of row.domainPatterns) {
    const re = new RegExp(p.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) domains.push(m[1].trim());
  }
  return domains;
}

/** Names bound by an import line — the live SSOT side of the regex-grade scope. */
function regexImports(row: RegexOracleLanguage, src: string): Set<string> {
  const imported = new Set<string>();
  for (const l of src.split("\n")) {
    let m = row.importPatterns.fromImport.exec(l.trim());
    if (m) for (const part of m[1].split(",")) imported.add(part.trim().split(/\s+as\s+/).pop()!.trim());
    m = row.importPatterns.plainImport.exec(l.trim());
    if (m) imported.add(m[1].split(".")[0]);
  }
  return imported;
}

/** The root NAME a regex-grade domain expression hangs off of for the PARITY arm — the
 *  leftmost identifier after unwrapping the row's order/materialize helpers
 *  (`sorted(X)`, `list(X)`, …), mirroring what the query grade's resolution does for
 *  `Object.keys(X)` / property chains. `registry.X` roots at `registry`, exactly as a
 *  property chain roots at its leftmost identifier. */
function regexParityRoot(row: RegexOracleLanguage, d: string): string | null {
  let e = d.trim();
  const WRAP = new RegExp(`^(?:${row.unwrapCalls.join("|")})\\s*\\(\\s*(.*?)\\s*\\)$`);
  for (let guard = 0; guard < 6; guard++) {
    const m = WRAP.exec(e);
    if (!m) break;
    e = m[1].split(",")[0].trim(); // sorted(X, key=…) → X
  }
  const m = /^([A-Za-z_]\w*)/.exec(e);
  return m ? m[1] : null;
}

function regexAnchorView(row: RegexOracleLanguage, src: string, oracleName: string): AnchorView | null {
  const block = indentBlock(row, src, oracleName);
  if (block === null) return null;
  const domains = regexDomains(row, block).map((d): DomainRef => ({
    text: d,
    // the coverage root never unwrapped at this grade (only parity does) — old contract
    root: (d.split(/[.([]/)[0] ?? "").trim() || null,
    parityRoot: regexParityRoot(row, d),
    selfLiteral: row.literalDomainPatterns.some((re) => re.test(d)),
    isCall: /\(/.test(d),
  }));
  return {
    domains,
    scope: { imported: regexImports(row, src), localArrayConst: new Map(), localOther: new Set() },
    hasFloor: row.floorPattern.test(block),
    mentions: (name: string) => new RegExp(`\\b${escRe(name)}\\b`).test(block),
  };
}

// ── the verdict lattices: written once, language-blind ───────────────────────────────

/** Classify a single iterated domain against the file scope. The rule order IS the
 *  contract — in particular the conservative unknown-identifier rule: a name that is
 *  not provably a same-file hand-list (param, closure var, the anchor symbol passed in)
 *  reads LIVE, because it cannot be the sampling-oracle smell — never a false fail. */
function classifyDomain(d: DomainRef, scope: Scope): { verdict: "live" | "literal"; reason: OracleDetailReason; ref: DomainRef } {
  if (d.selfLiteral) return { verdict: "literal", reason: "inline-literal", ref: d };
  // a bare call expression (verifyTotality(), state.storage.sql.exec(...)) → LIVE
  if (d.isCall && !d.root) return { verdict: "live", reason: "call", ref: d };
  if (d.root) {
    if (scope.imported.has(d.root)) return { verdict: "live", reason: "imported", ref: d };
    if (scope.localOther.has(d.root)) return { verdict: "live", reason: "live-local", ref: d };
    if (scope.localArrayConst.get(d.root)) return { verdict: "literal", reason: "const-array", ref: d };
    if (d.isCall) return { verdict: "live", reason: "call-root", ref: d };
    return { verdict: "live", reason: "opaque-root", ref: d };
  }
  // anything else we couldn't resolve: be conservative, call it LIVE (avoid false fails)
  return { verdict: "live", reason: "unresolved", ref: d };
}

/** Render a row's template for one classified domain. */
function renderDetail(template: string, ref: DomainRef): string {
  return template
    .replaceAll("{expr40}", ref.text.slice(0, 40))
    .replaceAll("{expr50}", ref.text.slice(0, 50))
    .replaceAll("{expr}", ref.text)
    .replaceAll("{root}", ref.root ?? "");
}

/** A LIVE oracle without a floor passes vacuously the moment its domain empties — the
 *  false-green class the meta-oracle can't see from liveness alone. Same words in every
 *  language: the vacuity is language-blind. */
const NO_FLOOR_SUFFIX = " — no domain floor (vacuous if the domain empties)";

/**
 * Analyze one oracle by name. Scans the project's test files for the oracle's anchor
 * (a `describe("<name>")` block, a `def <name>(`, …, per the language row), then
 * classifies the iteration domain of its assertion loops.
 *
 * The block-level verdict: LIVE if ANY loop ranges over a live-derived collection (the
 * oracle's *primary* totality loop is enough — a block may also contain a source-grep
 * `it()`); LITERAL if it has loops but ALL of them iterate literals/local arrays;
 * NO-ITERATION if it has no domain-iteration construct at all.
 */
export async function analyzeOracle(cfg: Config, oracleName: string): Promise<OracleAnalysis> {
  const files = await findTestFiles(cfg);
  for (const rel of files) {
    let src: string;
    try { src = await readFile(join(cfg.root, rel), "utf8"); } catch { continue; }
    if (!src.includes(oracleName)) continue; // cheap pre-filter
    const row = rowFor(rel);
    const view = await anchorView(row, src, oracleName);
    if (!view) continue;
    if (view.emptyAnchor) return { verdict: "no-iteration", detail: row.emptyAnchorDetail ?? row.noIterationDetail, file: rel };
    if (view.domains.length === 0) return { verdict: "no-iteration", detail: row.noIterationDetail, file: rel };
    const classed = view.domains.map((d) => classifyDomain(d, view.scope));
    const live = classed.find((c) => c.verdict === "live");
    if (live) {
      const base = renderDetail(row.detailTemplates[live.reason], live.ref);
      return { verdict: "live", detail: view.hasFloor ? base : base + NO_FLOOR_SUFFIX, file: rel, hasFloor: view.hasFloor };
    }
    // every loop is literal
    const lit = classed[0];
    const more = row.multiLiteralSuffix && classed.length > 1
      ? row.multiLiteralSuffix.replaceAll("{n}", String(classed.length - 1))
      : "";
    return { verdict: "literal", detail: renderDetail(row.detailTemplates[lit.reason], lit.ref) + more, file: rel };
  }
  return { verdict: "not-found", detail: `no describe("${oracleName}") found in any test file`, file: undefined };
}

// ── the PARITY meta-oracle ────────────────────────────────────────────────────────────
// A `parity "<inv>" over <domain> between <f> and <g> via test "<oracle>"` claim asserts
// two projections AGREE over one enumerated domain. Running the named test proves only
// that whatever the test does passes; this analysis asserts the test has the SHAPE of a
// parity totality: (a) its body ENUMERATES the DECLARED domain symbol (not a hand-copied
// sample list, not some other collection), and (b) it exercises BOTH projections. The
// motivating false oracle was exactly one-sided: it compared two runs of the SAME
// projector (settled vs history-reload) and never touched the live projection — so the
// live/settled divergence class sailed through green. Verdict semantics are identical at
// every grade: an inline literal roots at nothing, so a hand-copied sample reads
// NO-ENUMERATION, never ok; a vanished oracle ends at NOT-FOUND, which is never a pass.

export type ParityVerdict = "ok" | "not-found" | "no-enumeration" | "one-sided";

export interface ParityAnalysis {
  verdict: ParityVerdict;
  detail: string;
  /** the test file (relative to root) the describe block was found in, if any. */
  file?: string;
}

export async function analyzeParityOracle(
  cfg: Config, oracleName: string, domain: string, f: string, g: string,
): Promise<ParityAnalysis> {
  const files = await findTestFiles(cfg);
  for (const rel of files) {
    let src: string;
    try { src = await readFile(join(cfg.root, rel), "utf8"); } catch { continue; }
    if (!src.includes(oracleName)) continue; // cheap pre-filter
    const row = rowFor(rel);
    const view = await anchorView(row, src, oracleName);
    if (!view) continue;
    if (view.emptyAnchor) return { verdict: "no-enumeration", detail: row.emptyAnchorDetail ?? row.noIterationDetail, file: rel };
    // (a) some iteration construct must range over the DECLARED domain symbol — helper
    // unwraps (the row's unwrapCalls, chained receivers) are resolved by the same
    // strategy the coverage meta-oracle uses.
    const enumerates = view.domains.some((d) => d.parityRoot === domain);
    if (!enumerates) {
      const roots = [...new Set(view.domains.map((d) => d.text))].slice(0, 3);
      return {
        verdict: "no-enumeration",
        detail: view.domains.length
          ? `iterates ${roots.map((r) => `\`${r.slice(0, 40)}\``).join(", ")} — never the declared domain \`${domain}\``
          : `no domain iteration at all — hand-enumerated cases cannot be a parity totality over \`${domain}\``,
        file: rel,
      };
    }
    // (b) both projections must appear in the body — a one-sided oracle proves nothing
    // about agreement.
    const missing = [f, g].filter((s) => !view.mentions(s));
    if (missing.length)
      return {
        verdict: "one-sided",
        detail: `enumerates \`${domain}\` but never exercises ${missing.map((s) => `\`${s}\``).join(" or ")} — a parity oracle must drive BOTH projections`,
        file: rel,
      };
    return { verdict: "ok", detail: `enumerates \`${domain}\` and drives both \`${f}\` and \`${g}\``, file: rel };
  }
  return { verdict: "not-found", detail: `no describe("${oracleName}") found in any test file` };
}
