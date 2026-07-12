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

/** A test file (NOT a *.spec.md — those are coherence specs, not runnable tests). */
const isTestFile = (name: string) =>
  name !== "spec.md" && (/\.(test|spec)\.[mc]?[jt]sx?$/.test(name) || /^test_.*\.py$|_test\.py$/.test(name));

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
    // it.each(X)(...) / test.each(X)(...) / describe.each(X)(...) — the vitest/jest
    // parameterization idiom. The each ARGUMENT is the iterated domain; missing this
    // form misclassifies the most idiomatic totality oracles as NO-ITERATION.
    if (
      ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "each" && ts.isIdentifier(n.expression.expression) &&
      ["it", "test", "describe"].includes(n.expression.expression.text) && n.arguments[0]
    ) {
      loops.push({ domain: n.arguments[0] });
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
const FLOOR_MATCHERS = new Set(["toBeGreaterThan", "toBeGreaterThanOrEqual"]);

/** Best-effort: does the oracle assert a lower bound on its domain size? Catches
 *  the vitest/jest floor matchers and a bare `.length`/`.size`/`.count` `>=`/`>`
 *  comparison. A LIVE oracle without one passes vacuously the moment its domain
 *  empties — the false-green class the meta-oracle can't see from liveness alone. */
function hasFloorAssertion(body: ts.Node): boolean {
  const sizeRe = /\.(length|size|count)\b/;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    // A floor matcher whose ASSERTED expression references a domain size, i.e.
    // `expect(domain.length).toBeGreaterThanOrEqual(n)` — not `expect(v).toBeGreaterThan(0)`
    // on some scalar value (which is not a domain-size floor).
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        FLOOR_MATCHERS.has(n.expression.name.text) && sizeRe.test(n.expression.expression.getText())) {
      found = true; return;
    }
    // A bare `.length`/`.size`/`.count` `>=`/`>` comparison.
    if (ts.isBinaryExpression(n) &&
        (n.operatorToken.kind === ts.SyntaxKind.GreaterThanEqualsToken ||
         n.operatorToken.kind === ts.SyntaxKind.GreaterThanToken) &&
        sizeRe.test(n.getText())) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(body);
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
function analyzePythonOracle(src: string, oracleName: string): Omit<OracleAnalysis, "file"> | null {
  const lines = src.split("\n");
  // exact anchor: def <name>( at any indent, or class <Name>
  const defRe = new RegExp(`^(\\s*)(?:async\\s+)?def\\s+${oracleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`);
  const clsRe = new RegExp(`^(\\s*)class\\s+${oracleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  let start = -1, indent = "";
  for (let i = 0; i < lines.length; i++) {
    const m = defRe.exec(lines[i]) ?? clsRe.exec(lines[i]);
    if (m) { start = i; indent = m[1]; break; }
  }
  if (start < 0) return null;
  // block: from the anchor to the next non-blank line at <= the anchor's indent
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (!l.startsWith(indent + " ") && !l.startsWith(indent + "\t")) { end = i; break; }
  }
  // decorators above the anchor belong to it (parametrize domains live there)
  let decoStart = start;
  while (decoStart > 0 && lines[decoStart - 1].trim().startsWith("@")) decoStart--;
  const block = lines.slice(decoStart, end).join("\n");
  const importedNames = new Set<string>();
  for (const l of lines) {
    let m = /^from\s+\S+\s+import\s+(.+)$/.exec(l.trim());
    if (m) for (const part of m[1].split(",")) importedNames.add(part.trim().split(/\s+as\s+/).pop()!.trim());
    m = /^import\s+([A-Za-z_][\w.]*)/.exec(l.trim());
    if (m) importedNames.add(m[1].split(".")[0]);
  }
  // domains: for X in <domain>:  |  @pytest.mark.parametrize("...", <domain>)
  const domains: string[] = [];
  let m: RegExpExecArray | null;
  const forRe = /for\s+[\w,\s()]+\s+in\s+([^:]+):/g;
  while ((m = forRe.exec(block))) domains.push(m[1].trim());
  const parRe = /parametrize\(\s*["'][^"']+["']\s*,\s*((?:\[[^\]]*\])|[A-Za-z_][\w.()]*)/g;
  while ((m = parRe.exec(block))) domains.push(m[1].trim());
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

export async function analyzeParityOracle(
  cfg: Config, oracleName: string, domain: string, f: string, g: string,
): Promise<ParityAnalysis> {
  const files = await findTestFiles(cfg);
  for (const rel of files) {
    if (rel.endsWith(".py")) continue; // TS/JS only (the parity form is TS-first for now)
    let src: string;
    try { src = await readFile(join(cfg.root, rel), "utf8"); } catch { continue; }
    if (!src.includes(oracleName)) continue; // cheap pre-filter
    const sf = parse(src, basename(rel));
    const desc = findDescribe(sf, oracleName);
    if (!desc) continue;
    const body = desc.arguments[1];
    if (!body) return { verdict: "no-enumeration", detail: "describe has no body", file: rel };
    // (a) some iteration construct must range over the DECLARED domain symbol — helper
    // unwraps (Object.keys/values, Array.from, chained .map/.filter, it/test.each) are
    // handled by the same iterTargetOf the coverage meta-oracle uses.
    const loops = findLoops(body);
    const enumerates = loops.some((l) => iterTargetOf(l.domain, sf).root?.text === domain);
    if (!enumerates) {
      const roots = [...new Set(loops.map((l) => iterTargetOf(l.domain, sf).text))].slice(0, 3);
      return {
        verdict: "no-enumeration",
        detail: loops.length
          ? `iterates ${roots.map((r) => `\`${r.slice(0, 40)}\``).join(", ")} — never the declared domain \`${domain}\``
          : `no domain iteration at all — hand-enumerated cases cannot be a parity totality over \`${domain}\``,
        file: rel,
      };
    }
    // (b) both projections must appear in the body — a one-sided oracle proves nothing
    // about agreement.
    const ids = new Set<string>();
    const visit = (n: ts.Node): void => { if (ts.isIdentifier(n)) ids.add(n.text); ts.forEachChild(n, visit); };
    visit(body);
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
