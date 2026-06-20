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
// We reuse the `typescript` compiler API (a devDep, available at runtime) rather than the
// regex adapter: classifying iteration roots needs real scope/symbol resolution.
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join, relative, basename } from "node:path";
import ts from "typescript";
import type { Config } from "./types.ts";

export type OracleVerdict = "live" | "literal" | "no-iteration" | "not-found";

export interface OracleAnalysis {
  verdict: OracleVerdict;
  /** human-readable detail: the iterated expression + how its root resolved. */
  detail: string;
  /** the test file (relative to root) the describe block was found in, if any. */
  file?: string;
}

/** A test file (NOT a *.spec.md — those are coherence specs, not runnable tests). */
const isTestFile = (name: string) => name !== "spec.md" && /\.(test|spec)\.[mc]?[jt]sx?$/.test(name);

// Dirs that are never source, regardless of the project's graph-`ignore`. We deliberately
// do NOT reuse cfg.ignore: a project commonly excludes its test dir (e.g. "__tests__") from
// the spec GRAPH while that is exactly where the oracle tests we must read live. Reusing the
// graph-ignore here would make every oracle resolve NOT-FOUND and the meta-oracle inert.
const NOISE_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".turbo", ".wrangler", ".next", "coverage", ".coherence"]);

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

/** parse a source string into a TS SourceFile (JS/TS both parse fine for our purposes). */
function parse(src: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TSX);
}

/** Is this CallExpression a `describe("<name>", …)` (or it.describe / Deno.test-style)? */
function describeName(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  const name =
    ts.isIdentifier(callee) ? callee.text :
    ts.isPropertyAccessExpression(callee) ? callee.name.text :
    null;
  if (name !== "describe") return null;
  const arg0 = node.arguments[0];
  if (arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) return arg0.text;
  return null;
}

/** Find the describe(...) call node whose title === oracleName. First match wins. */
function findDescribe(sf: ts.SourceFile, oracleName: string): ts.CallExpression | null {
  let found: ts.CallExpression | null = null;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (describeName(n) === oracleName) { found = n as ts.CallExpression; return; }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** Collect import/require bindings and local declarations in a SourceFile, so we can
 *  resolve whether an iterated identifier is LIVE (imported) or LITERAL (local array). */
interface Scope {
  imported: Set<string>;                 // names bound by an import (live SSOT)
  localArrayConst: Map<string, boolean>; // local const name → true iff initialized to an array/regex literal
  localOther: Set<string>;               // local names bound to something NON-literal (call result, etc.) = live
}

function buildScope(sf: ts.SourceFile): Scope {
  const imported = new Set<string>();
  const localArrayConst = new Map<string, boolean>();
  const localOther = new Set<string>();

  const recordImportClause = (clause: ts.ImportClause) => {
    if (clause.name) imported.add(clause.name.text); // default import
    const nb = clause.namedBindings;
    if (nb) {
      if (ts.isNamespaceImport(nb)) imported.add(nb.name.text);
      else for (const el of nb.elements) imported.add(el.name.text);
    }
  };

  const isLiteralDomain = (init: ts.Expression | undefined): boolean => {
    if (!init) return false;
    // unwrap `as const`, `satisfies`, parens
    let e: ts.Expression = init;
    while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isArrayLiteralExpression(e)) return true;
    if (ts.isRegularExpressionLiteral(e)) return true;
    // `new Set([...])` / `new Map([...])` over a literal is still a hand-list
    if (ts.isNewExpression(e) && e.arguments?.length === 1) {
      let a: ts.Expression = e.arguments[0];
      while (ts.isAsExpression(a) || ts.isParenthesizedExpression(a)) a = a.expression;
      if (ts.isArrayLiteralExpression(a)) return true;
    }
    return false;
  };

  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && n.importClause) recordImportClause(n.importClause);
    // `const X = require("…")` and `import X = require("…")`
    if (ts.isImportEqualsDeclaration(n)) imported.add(n.name.text);
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer;
        // require("…") destructure/binding → treat as imported (live)
        const isRequire = init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "require";
        if (isRequire) { imported.add(d.name.text); continue; }
        if (isLiteralDomain(init)) localArrayConst.set(d.name.text, true);
        else localOther.add(d.name.text); // bound to a call result, member access, etc. → live-ish
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { imported, localArrayConst, localOther };
}

/** The root identifier an iterated expression hangs off of, plus whether the iterated
 *  expression ITSELF is a literal (array/regex) regardless of any identifier. */
interface IterTarget { root: ts.Identifier | null; selfLiteral: boolean; text: string; isCall: boolean; }

function iterTargetOf(expr: ts.Expression, sf: ts.SourceFile): IterTarget {
  let e: ts.Expression = expr;
  // unwrap Object.keys(X) / Object.values(X) / Object.entries(X) / Array.from(X) to X
  const unwrapHelper = (c: ts.CallExpression): ts.Expression | null => {
    const callee = c.expression;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const obj = callee.expression.text, meth = callee.name.text;
      if (obj === "Object" && (meth === "keys" || meth === "values" || meth === "entries") && c.arguments[0]) return c.arguments[0];
      if (obj === "Array" && meth === "from" && c.arguments[0]) return c.arguments[0];
    }
    return null;
  };
  // peel chained .map/.filter/etc and Object.keys/Array.from wrappers down to the source collection
  for (let guard = 0; guard < 12; guard++) {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) { e = e.expression; continue; }
    if (ts.isCallExpression(e)) {
      const helper = unwrapHelper(e);
      if (helper) { e = helper; continue; }
      // X.map(...)/X.filter(...) → recurse into X (the receiver is the domain)
      const callee = e.expression;
      if (ts.isPropertyAccessExpression(callee) && CHAIN_METHODS.has(callee.name.text)) { e = callee.expression; continue; }
      // a bare call like verifyTotality() or query() — the call result IS the domain (live)
      break;
    }
    break;
  }
  const text = e.getText(sf);
  const selfLiteral = ts.isArrayLiteralExpression(e) || ts.isRegularExpressionLiteral(e) ||
    (ts.isNewExpression(e) && !!e.arguments && e.arguments.length === 1 && ts.isArrayLiteralExpression(e.arguments[0]));
  const isCall = ts.isCallExpression(e);
  // find the root identifier: bare Identifier, or the leftmost of a property-access chain
  let root: ts.Identifier | null = null;
  if (ts.isIdentifier(e)) root = e;
  else if (ts.isPropertyAccessExpression(e)) { let p: ts.Expression = e; while (ts.isPropertyAccessExpression(p)) p = p.expression; if (ts.isIdentifier(p)) root = p; }
  else if (ts.isCallExpression(e)) { let c: ts.Expression = e.expression; while (ts.isPropertyAccessExpression(c)) c = c.expression; if (ts.isIdentifier(c)) root = c; }
  else if (ts.isElementAccessExpression(e)) { let p: ts.Expression = e; while (ts.isElementAccessExpression(p) || ts.isPropertyAccessExpression(p)) p = ts.isElementAccessExpression(p) ? p.expression : p.expression; if (ts.isIdentifier(p)) root = p; }
  return { root, selfLiteral, text, isCall };
}

const CHAIN_METHODS = new Set(["map", "forEach", "flatMap", "filter", "every", "some", "reduce", "reduceRight", "find", "findIndex", "sort"]);
const ITER_METHODS = new Set(["forEach", "map", "flatMap", "filter", "every", "some", "reduce", "reduceRight"]);

interface Loop { domain: ts.Expression; }

/** Find every domain-iteration construct anywhere inside `block`. */
function findLoops(block: ts.Node): Loop[] {
  const loops: Loop[] = [];
  const visit = (n: ts.Node) => {
    // for…of / for…in over a collection
    if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && n.expression) loops.push({ domain: n.expression });
    // X.forEach(...) / X.map(...) etc — the RECEIVER is the iterated domain
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ITER_METHODS.has(n.expression.name.text)) {
      loops.push({ domain: n.expression.expression });
    }
    // spread of a collection: [...X] (only when X is a collection, not a literal already)
    if (ts.isSpreadElement(n) && !ts.isArrayLiteralExpression(n.expression)) loops.push({ domain: n.expression });
    ts.forEachChild(n, visit);
  };
  visit(block);
  return loops;
}

/** Classify a single iterated domain expression against the file scope. */
function classifyDomain(d: ts.Expression, scope: Scope, sf: ts.SourceFile): { verdict: "live" | "literal"; detail: string } {
  const t = iterTargetOf(d, sf);
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
export async function analyzeOracle(cfg: Config, oracleName: string): Promise<OracleAnalysis> {
  const files = await findTestFiles(cfg);
  for (const rel of files) {
    let src: string;
    try { src = await readFile(join(cfg.root, rel), "utf8"); } catch { continue; }
    if (!src.includes(oracleName)) continue; // cheap pre-filter
    const sf = parse(src, basename(rel));
    const desc = findDescribe(sf, oracleName);
    if (!desc) continue;
    const scope = buildScope(sf);
    const body = desc.arguments[1];
    if (!body) return { verdict: "no-iteration", detail: "describe has no body", file: rel };
    const loops = findLoops(body);
    if (loops.length === 0) return { verdict: "no-iteration", detail: "no for-of / .forEach / .map / spread over a domain", file: rel };
    const classed = loops.map((l) => classifyDomain(l.domain, scope, sf));
    const live = classed.find((c) => c.verdict === "live");
    if (live) return { verdict: "live", detail: live.detail, file: rel };
    // every loop is literal
    const lit = classed[0];
    return { verdict: "literal", detail: lit.detail + (classed.length > 1 ? ` (+${classed.length - 1} more, all literal)` : ""), file: rel };
  }
  return { verdict: "not-found", detail: `no describe("${oracleName}") found in any test file`, file: undefined };
}
