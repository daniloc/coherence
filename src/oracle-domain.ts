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
// The TS/JS arm reads oracle sources through the shared tree-sitter grammar handle
// (phase 2b, arm 4 — the `typescript` compiler-API dependency is gone): the same
// scope/iteration-root resolution the compiler walk performed, re-expressed as node
// walks over the grammar tree. The walks mirror the retired compiler visitors 1:1;
// classification here is scope-dependent (an identifier's verdict depends on how the
// FILE binds it), which is walk-shaped work — the grammar contributes the parse, not
// a capture table.
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Node } from "web-tree-sitter";
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

/** Python test files, by name or path. Exported so redundancy.ts can exclude exactly the
 *  set of files the oracle analyzers read — a second spelling of this convention over there
 *  is the duplicated-domain finding that module exists to report. */
export const isPyTestPath = (p: string) => /(^|\/)test_[^/]*\.py$|_test\.py$/.test(p);

/** A test file (NOT a *.spec.md — those are coherence specs, not runnable tests). */
const isTestFile = (name: string) =>
  name !== "spec.md" && (/\.(test|spec)\.[mc]?[jt]sx?$/.test(name) || isPyTestPath(name));

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

/** parse a source string through the shared typescript grammar (JS/TS both parse fine
 *  for our purposes; a null tree — allocation failure — reads as "no describe here"). */
async function parseTs(src: string): Promise<Node | null> {
  const { parser } = await grammarHandle("typescript");
  const tree = parser.parse(src);
  return tree ? tree.rootNode : null;
}

/** Pre-order walk over named nodes — the same visit order the compiler visitors used. */
function walk(n: Node, fn: (n: Node) => void): void {
  fn(n);
  for (const c of n.namedChildren) if (c) walk(c, fn);
}

/** The named arguments of a call/new expression, comments (grammar "extras") excluded —
 *  the compiler's `node.arguments` never contained trivia, so neither may this. */
function callArgs(call: Node): Node[] {
  const args = call.childForFieldName("arguments");
  if (!args) return [];
  return args.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");
}

const UNESCAPE: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };

/** The cooked text of a string literal or substitution-free template — the compiler's
 *  `.text` decoded escapes, so the fragments+escapes must be reassembled the same way. */
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

/** Is this call_expression a `describe("<name>", …)` (or it.describe / Deno.test-style)? */
function describeName(node: Node): string | null {
  if (node.type !== "call_expression") return null;
  const callee = node.childForFieldName("function");
  const name =
    callee?.type === "identifier" ? callee.text :
    callee?.type === "member_expression" ? (callee.childForFieldName("property")?.text ?? null) :
    null;
  if (name !== "describe") return null;
  const arg0 = callArgs(node)[0];
  return arg0 ? stringText(arg0) : null;
}

/** Find the describe(...) call node whose title === oracleName. First match wins. */
function findDescribe(rootNode: Node, oracleName: string): Node | null {
  let found: Node | null = null;
  const visit = (n: Node) => {
    if (found) return;
    if (describeName(n) === oracleName) { found = n; return; }
    for (const c of n.namedChildren) if (c) visit(c);
  };
  visit(rootNode);
  return found;
}

/** Collect import/require bindings and local declarations in a source file, so we can
 *  resolve whether an iterated identifier is LIVE (imported) or LITERAL (local array). */
interface Scope {
  imported: Set<string>;                 // names bound by an import (live SSOT)
  localArrayConst: Map<string, boolean>; // local const name → true iff initialized to an array/regex literal
  localOther: Set<string>;               // local names bound to something NON-literal (call result, etc.) = live
}

/** unwrap `as const`, `satisfies`, parens down to the wrapped expression. */
function unwrapCasts(e: Node, withSatisfies = true): Node {
  for (let guard = 0; guard < 12; guard++) {
    if (e.type === "parenthesized_expression" || e.type === "as_expression" ||
        (withSatisfies && e.type === "satisfies_expression")) {
      const inner = e.namedChildren.find((c) => !!c && c.type !== "comment");
      if (!inner) break;
      e = inner;
      continue;
    }
    break;
  }
  return e;
}

function buildScope(rootNode: Node): Scope {
  const imported = new Set<string>();
  const localArrayConst = new Map<string, boolean>();
  const localOther = new Set<string>();

  const recordImportClause = (clause: Node) => {
    for (const c of clause.namedChildren) {
      if (!c) continue;
      if (c.type === "identifier") imported.add(c.text); // default import
      else if (c.type === "namespace_import") {
        const id = c.namedChildren.find((x) => x?.type === "identifier");
        if (id) imported.add(id.text);
      } else if (c.type === "named_imports") {
        for (const spec of c.namedChildren) {
          if (spec?.type !== "import_specifier") continue;
          // the LOCAL binding: the alias when present, else the imported name
          const local = spec.childForFieldName("alias") ?? spec.childForFieldName("name");
          if (local) imported.add(local.text);
        }
      }
    }
  };

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

  walk(rootNode, (n) => {
    if (n.type === "import_statement") {
      for (const c of n.namedChildren) {
        if (!c) continue;
        if (c.type === "import_clause") recordImportClause(c);
        // `import X = require("…")`
        if (c.type === "import_require_clause") {
          const id = c.namedChildren.find((x) => x?.type === "identifier");
          if (id) imported.add(id.text);
        }
      }
    }
    if (n.type === "lexical_declaration" || n.type === "variable_declaration") {
      for (const d of n.namedChildren) {
        if (d?.type !== "variable_declarator") continue;
        const name = d.childForFieldName("name");
        if (name?.type !== "identifier") continue;
        const init = d.childForFieldName("value");
        // require("…") destructure/binding → treat as imported (live)
        const callee = init?.type === "call_expression" ? init.childForFieldName("function") : null;
        if (callee?.type === "identifier" && callee.text === "require") { imported.add(name.text); continue; }
        if (isLiteralDomain(init)) localArrayConst.set(name.text, true);
        else localOther.add(name.text); // bound to a call result, member access, etc. → live-ish
      }
    }
  });
  return { imported, localArrayConst, localOther };
}

/** The root identifier an iterated expression hangs off of, plus whether the iterated
 *  expression ITSELF is a literal (array/regex) regardless of any identifier. */
interface IterTarget { root: Node | null; selfLiteral: boolean; text: string; isCall: boolean; }

function iterTargetOf(expr: Node): IterTarget {
  let e: Node = expr;
  // unwrap Object.keys(X) / Object.values(X) / Object.entries(X) / Array.from(X) to X
  const unwrapHelper = (c: Node): Node | null => {
    const callee = c.childForFieldName("function");
    if (callee?.type === "member_expression") {
      const objNode = callee.childForFieldName("object");
      if (objNode?.type === "identifier") {
        const obj = objNode.text, meth = callee.childForFieldName("property")?.text ?? "";
        const arg0 = callArgs(c)[0];
        if (obj === "Object" && (meth === "keys" || meth === "values" || meth === "entries") && arg0) return arg0;
        if (obj === "Array" && meth === "from" && arg0) return arg0;
      }
    }
    return null;
  };
  // peel chained .map/.filter/etc and Object.keys/Array.from wrappers down to the source collection
  for (let guard = 0; guard < 12; guard++) {
    if (e.type === "parenthesized_expression" || e.type === "as_expression" || e.type === "satisfies_expression") {
      const inner = e.namedChildren.find((c) => !!c && c.type !== "comment");
      if (!inner) break;
      e = inner; continue;
    }
    if (e.type === "call_expression") {
      const helper = unwrapHelper(e);
      if (helper) { e = helper; continue; }
      // X.map(...)/X.filter(...) → recurse into X (the receiver is the domain)
      const callee = e.childForFieldName("function");
      if (callee?.type === "member_expression" && CHAIN_METHODS.has(callee.childForFieldName("property")?.text ?? "")) {
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

const CHAIN_METHODS = new Set(["map", "forEach", "flatMap", "filter", "every", "some", "reduce", "reduceRight", "find", "findIndex", "sort"]);
const ITER_METHODS = new Set(["forEach", "map", "flatMap", "filter", "every", "some", "reduce", "reduceRight"]);

interface Loop { domain: Node; }

/** Find every domain-iteration construct anywhere inside `block`. */
function findLoops(block: Node): Loop[] {
  const loops: Loop[] = [];
  walk(block, (n) => {
    // for…of / for…in over a collection (one grammar node covers both forms)
    if (n.type === "for_in_statement") {
      const right = n.childForFieldName("right");
      if (right) loops.push({ domain: right });
    }
    if (n.type === "call_expression") {
      const callee = n.childForFieldName("function");
      if (callee?.type === "member_expression") {
        const meth = callee.childForFieldName("property")?.text ?? "";
        const obj = callee.childForFieldName("object");
        // X.forEach(...) / X.map(...) etc — the RECEIVER is the iterated domain
        if (obj && ITER_METHODS.has(meth)) loops.push({ domain: obj });
        // it.each(X)(...) / test.each(X)(...) / describe.each(X)(...) — the vitest/jest
        // parameterization idiom. The each ARGUMENT is the iterated domain; missing this
        // form misclassifies the most idiomatic totality oracles as NO-ITERATION.
        if (meth === "each" && obj?.type === "identifier" && ["it", "test", "describe"].includes(obj.text)) {
          const arg0 = callArgs(n)[0];
          if (arg0) loops.push({ domain: arg0 });
        }
      }
    }
    // spread of a collection: [...X] (only when X is a collection, not a literal already;
    // object spread `{...X}` was a different compiler node — never a loop, so still not one)
    if (n.type === "spread_element" && n.parent?.type !== "object") {
      const inner = n.namedChildren.find((c) => !!c && c.type !== "comment");
      if (inner && inner.type !== "array") loops.push({ domain: inner });
    }
  });
  return loops;
}

/** Classify a single iterated domain expression against the file scope. */
function classifyDomain(d: Node, scope: Scope): { verdict: "live" | "literal"; detail: string } {
  const t = iterTargetOf(d);
  // an inline array/regex literal as the domain → LITERAL
  if (t.selfLiteral) return { verdict: "literal", detail: `inline ${t.text.slice(0, 40)} literal` };
  // a bare call expression (verifyTotality(), liveTables(), state.storage.sql.exec(...)) → LIVE
  if (t.isCall && !t.root) return { verdict: "live", detail: `call ${t.text.slice(0, 50)}` };
  if (t.root) {
    const name = t.root.text;
    if (scope.imported.has(name)) return { verdict: "live", detail: `imported \`${name}\`` };
    if (scope.localOther.has(name)) return { verdict: "live", detail: `live local \`${name}\` (call/query result)` };
    if (scope.localArrayConst.get(name)) return { verdict: "literal", detail: `same-file const array \`${name}\`` };
    // unknown identifier (param, closure var, anchor symbol passed in) — treat as LIVE:
    // it is NOT a same-file array literal, so it cannot be the sampling-oracle smell.
    if (t.isCall) return { verdict: "live", detail: `call on \`${name}\`` };
    return { verdict: "live", detail: `\`${name}\` (non-literal root)` };
  }
  // a call result with no resolvable root identifier → LIVE (e.g. (await q()).rows)
  if (t.isCall) return { verdict: "live", detail: `call ${t.text.slice(0, 50)}` };
  // anything else we couldn't resolve: be conservative, call it LIVE (avoid false fails)
  return { verdict: "live", detail: `unresolved domain ${t.text.slice(0, 40)}` };
}

/**
 * Analyze one oracle by name. Scans the project's test files for `describe("<name>")`,
 * then classifies the iteration domain of its assertion loops.
 *
 * The block-level verdict: LIVE if ANY loop ranges over a live-derived collection (the
 * oracle's *primary* totality loop is enough — a block may also contain a source-grep
 * `it()`); LITERAL if it has loops but ALL of them iterate literals/local arrays;
 * NO-ITERATION if it has no domain-iteration construct at all.
 */
const FLOOR_MATCHERS = new Set(["toBeGreaterThan", "toBeGreaterThanOrEqual"]);

/** Best-effort: does the oracle assert a lower bound on its domain size? Catches
 *  the vitest/jest floor matchers and a bare `.length`/`.size`/`.count` `>=`/`>`
 *  comparison. A LIVE oracle without one passes vacuously the moment its domain
 *  empties — the false-green class the meta-oracle can't see from liveness alone. */
function hasFloorAssertion(body: Node): boolean {
  const sizeRe = /\.(length|size|count)\b/;
  let found = false;
  walk(body, (n) => {
    if (found) return;
    // A floor matcher whose ASSERTED expression references a domain size, i.e.
    // `expect(domain.length).toBeGreaterThanOrEqual(n)` — not `expect(v).toBeGreaterThan(0)`
    // on some scalar value (which is not a domain-size floor).
    if (n.type === "call_expression") {
      const callee = n.childForFieldName("function");
      if (callee?.type === "member_expression" &&
          FLOOR_MATCHERS.has(callee.childForFieldName("property")?.text ?? "") &&
          sizeRe.test(callee.childForFieldName("object")?.text ?? "")) {
        found = true; return;
      }
    }
    // A bare `.length`/`.size`/`.count` `>=`/`>` comparison.
    if (n.type === "binary_expression") {
      const op = n.childForFieldName("operator")?.text;
      if ((op === ">=" || op === ">") && sizeRe.test(n.text)) { found = true; return; }
    }
  });
  return found;
}


/**
 * Python arm of the meta-oracle — regex-based (no Python AST available here), tuned
 * conservative like the TS unknown-identifier rule: only verdicts that are UNAMBIGUOUS
 * from the source text (an inline list literal as the loop/parametrize domain) read as
 * LITERAL; a name that appears in an import line, a call result, or anything we cannot
 * resolve reads as LIVE — never a false fail. The oracle name must match a
 * `def <name>(` or `class <Name>` exactly (pytest -k will still substring-match for
 * the runner, but analysis anchors exactly, mirroring the TS describe rule).
 */
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The indent block a python anchor owns: `def <name>(` (any indent) or `class <Name>`,
 *  exact-name, decorators included (parametrize domains live there), running to the next
 *  non-blank line at <= the anchor's indent. One spelling of the anchor/indent discipline,
 *  shared by the coverage arm and the parity arm — not two. */
function pyAnchorBlock(src: string, name: string): string | null {
  const lines = src.split("\n");
  const defRe = new RegExp(`^(\\s*)(?:async\\s+)?def\\s+${escRe(name)}\\s*\\(`);
  const clsRe = new RegExp(`^(\\s*)class\\s+${escRe(name)}\\b`);
  let start = -1, indent = "";
  for (let i = 0; i < lines.length; i++) {
    const m = defRe.exec(lines[i]) ?? clsRe.exec(lines[i]);
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

/** Every iterated-domain expression in a python block, textually:
 *  `for X in <domain>:` and `@pytest.mark.parametrize("...", <domain>)`. */
function pyDomains(block: string): string[] {
  const domains: string[] = [];
  let m: RegExpExecArray | null;
  const forRe = /for\s+[\w,\s()]+\s+in\s+([^:]+):/g;
  while ((m = forRe.exec(block))) domains.push(m[1].trim());
  const parRe = /parametrize\(\s*["'][^"']+["']\s*,\s*((?:\[[^\]]*\])|[A-Za-z_][\w.()]*)/g;
  while ((m = parRe.exec(block))) domains.push(m[1].trim());
  return domains;
}

function analyzePythonOracle(src: string, oracleName: string): Omit<OracleAnalysis, "file"> | null {
  const block = pyAnchorBlock(src, oracleName);
  if (block === null) return null;
  const importedNames = new Set<string>();
  for (const l of src.split("\n")) {
    let m = /^from\s+\S+\s+import\s+(.+)$/.exec(l.trim());
    if (m) for (const part of m[1].split(",")) importedNames.add(part.trim().split(/\s+as\s+/).pop()!.trim());
    m = /^import\s+([A-Za-z_][\w.]*)/.exec(l.trim());
    if (m) importedNames.add(m[1].split(".")[0]);
  }
  const domains = pyDomains(block);
  if (domains.length === 0)
    return { verdict: "no-iteration", detail: "no for-in / parametrize over a domain" };
  const classify = (d: string): "live" | "literal" => {
    if (/^[\[(]/.test(d)) return "literal";                 // inline list/tuple literal
    if (/^range\(/.test(d)) return "literal";               // hand-chosen bound
    const root = d.split(/[.([]/)[0].trim();
    if (importedNames.has(root)) return "live";              // imported SSOT
    if (/\(/.test(d)) return "live";                        // call result
    return "live";                                           // unknown name — conservative
  };
  const verdicts = domains.map((d) => ({ d, v: classify(d) }));
  const live = verdicts.find((x) => x.v === "live");
  // floor: a len(...) lower-bound assertion anywhere in the block
  const hasFloor = /len\([^)]*\)\s*>=?\s*\d|assert\s+[^\n]*len\(/.test(block);
  if (live) {
    const detail = hasFloor ? `for-in/parametrize over ${live.d}` : `for-in/parametrize over ${live.d} — no domain floor (vacuous if the domain empties)`;
    return { verdict: "live", detail, hasFloor };
  }
  return { verdict: "literal", detail: `inline ${verdicts[0].d.slice(0, 40)} literal` };
}

// ── the PARITY meta-oracle ────────────────────────────────────────────────────────────
// A `parity "<inv>" over <domain> between <f> and <g> via test "<oracle>"` claim asserts
// two projections AGREE over one enumerated domain. Running the named test proves only
// that whatever the test does passes; this analysis asserts the test has the SHAPE of a
// parity totality: (a) its body ENUMERATES the DECLARED domain symbol (not a hand-copied
// sample list, not some other collection), and (b) it exercises BOTH projections. The
// motivating false oracle was exactly one-sided: it compared two runs of the SAME
// projector (settled vs history-reload) and never touched the live projection — so the
// live/settled divergence class sailed through green.

export type ParityVerdict = "ok" | "not-found" | "no-enumeration" | "one-sided";

export interface ParityAnalysis {
  verdict: ParityVerdict;
  detail: string;
  /** the test file (relative to root) the describe block was found in, if any. */
  file?: string;
}

/** The root NAME a python domain expression hangs off of — the leftmost identifier, after
 *  unwrapping the order/materialize helpers (`sorted(X)`, `list(X)`, …), mirroring what
 *  iterTargetOf does for `Object.keys(X)` / property chains on the TS side. `registry.X`
 *  roots at `registry`, exactly as a TS property chain roots at its leftmost identifier. */
function pyDomainRoot(d: string): string | null {
  let e = d.trim();
  const WRAP = /^(?:sorted|list|set|tuple|frozenset|enumerate|reversed|iter)\s*\(\s*(.*?)\s*\)$/;
  for (let guard = 0; guard < 6; guard++) {
    const m = WRAP.exec(e);
    if (!m) break;
    e = m[1].split(",")[0].trim(); // sorted(X, key=…) → X
  }
  const m = /^([A-Za-z_]\w*)/.exec(e);
  return m ? m[1] : null;
}

/**
 * Python arm of the PARITY meta-oracle — regex/indent grade like analyzePythonOracle, with
 * the TS branch's verdict semantics preserved exactly: (a) some for-in/parametrize domain
 * must ROOT at the declared domain symbol (an inline literal list roots at nothing, so a
 * hand-copied sample reads NO-ENUMERATION, never ok), and (b) both projection names must
 * appear in the oracle's block, else ONE-SIDED. Returns null when the anchor is absent from
 * this file — the caller keeps scanning, and a vanished oracle ends at NOT-FOUND, which is
 * never a pass.
 */
function analyzePythonParity(
  src: string, oracleName: string, domain: string, f: string, g: string,
): Omit<ParityAnalysis, "file"> | null {
  const block = pyAnchorBlock(src, oracleName);
  if (block === null) return null;
  const domains = pyDomains(block);
  const enumerates = domains.some((d) => pyDomainRoot(d) === domain);
  if (!enumerates) {
    const roots = [...new Set(domains)].slice(0, 3);
    return {
      verdict: "no-enumeration",
      detail: domains.length
        ? `iterates ${roots.map((r) => `\`${r.slice(0, 40)}\``).join(", ")} — never the declared domain \`${domain}\``
        : `no domain iteration at all — hand-enumerated cases cannot be a parity totality over \`${domain}\``,
    };
  }
  const missing = [f, g].filter((s) => !new RegExp(`\\b${escRe(s)}\\b`).test(block));
  if (missing.length)
    return {
      verdict: "one-sided",
      detail: `enumerates \`${domain}\` but never exercises ${missing.map((s) => `\`${s}\``).join(" or ")} — a parity oracle must drive BOTH projections`,
    };
  return { verdict: "ok", detail: `enumerates \`${domain}\` and drives both \`${f}\` and \`${g}\`` };
}

export async function analyzeParityOracle(
  cfg: Config, oracleName: string, domain: string, f: string, g: string,
): Promise<ParityAnalysis> {
  const files = await findTestFiles(cfg);
  for (const rel of files) {
    let src: string;
    try { src = await readFile(join(cfg.root, rel), "utf8"); } catch { continue; }
    if (!src.includes(oracleName)) continue; // cheap pre-filter
    if (rel.endsWith(".py")) {
      const py = analyzePythonParity(src, oracleName, domain, f, g);
      if (py) return { ...py, file: rel };
      continue;
    }
    const rootNode = await parseTs(src);
    if (!rootNode) continue;
    const desc = findDescribe(rootNode, oracleName);
    if (!desc) continue;
    const body = callArgs(desc)[1];
    if (!body) return { verdict: "no-enumeration", detail: "describe has no body", file: rel };
    // (a) some iteration construct must range over the DECLARED domain symbol — helper
    // unwraps (Object.keys/values, Array.from, chained .map/.filter, it/test.each) are
    // handled by the same iterTargetOf the coverage meta-oracle uses.
    const loops = findLoops(body);
    const enumerates = loops.some((l) => iterTargetOf(l.domain).root?.text === domain);
    if (!enumerates) {
      const roots = [...new Set(loops.map((l) => iterTargetOf(l.domain).text))].slice(0, 3);
      return {
        verdict: "no-enumeration",
        detail: loops.length
          ? `iterates ${roots.map((r) => `\`${r.slice(0, 40)}\``).join(", ")} — never the declared domain \`${domain}\``
          : `no domain iteration at all — hand-enumerated cases cannot be a parity totality over \`${domain}\``,
        file: rel,
      };
    }
    // (b) both projections must appear in the body — a one-sided oracle proves nothing
    // about agreement. The compiler counted every Identifier node, property names
    // included; the grammar splits those kinds, so every *identifier node type counts.
    const ids = new Set<string>();
    walk(body, (n) => { if (n.type.endsWith("identifier")) ids.add(n.text); });
    const missing = [f, g].filter((s) => !ids.has(s));
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

export async function analyzeOracle(cfg: Config, oracleName: string): Promise<OracleAnalysis> {
  const files = await findTestFiles(cfg);
  for (const rel of files) {
    let src: string;
    try { src = await readFile(join(cfg.root, rel), "utf8"); } catch { continue; }
    if (!src.includes(oracleName)) continue; // cheap pre-filter
    if (rel.endsWith(".py")) {
      const py = analyzePythonOracle(src, oracleName);
      if (py) return { ...py, file: rel };
      continue;
    }
    const rootNode = await parseTs(src);
    if (!rootNode) continue;
    const desc = findDescribe(rootNode, oracleName);
    if (!desc) continue;
    const scope = buildScope(rootNode);
    const body = callArgs(desc)[1];
    if (!body) return { verdict: "no-iteration", detail: "describe has no body", file: rel };
    const loops = findLoops(body);
    if (loops.length === 0) return { verdict: "no-iteration", detail: "no for-of / .forEach / .map / spread over a domain", file: rel };
    const classed = loops.map((l) => classifyDomain(l.domain, scope));
    const live = classed.find((c) => c.verdict === "live");
    if (live) {
      const hasFloor = hasFloorAssertion(body);
      const detail = hasFloor ? live.detail : `${live.detail} — no domain floor (vacuous if the domain empties)`;
      return { verdict: "live", detail, file: rel, hasFloor };
    }
    // every loop is literal
    const lit = classed[0];
    return { verdict: "literal", detail: lit.detail + (classed.length > 1 ? ` (+${classed.length - 1} more, all literal)` : ""), file: rel };
  }
  return { verdict: "not-found", detail: `no describe("${oracleName}") found in any test file`, file: undefined };
}
