// redundancy.ts — the UNDECLARED-parity detector.
//
// `parity "<inv>" over <domain> between <f> and <g> via test "<oracle>"` is the declared
// form: someone already SUSPECTED two projections should agree and wrote it down. The
// defect class that actually costs time is the complement — nobody declared anything and
// two things that should have agreed quietly didn't. Two decoders for one byte encoding
// reading 56,317 and 158 violations of the same property is not caught by any claim,
// because no claim existed; the DISAGREEMENT was the whole signal, and it took a human
// noticing that a number looked absurd.
//
// Redundancy is the only detector that reaches unknown-unknowns, because a divergence
// between two independent computations is informative WITHOUT any prior claim about the
// value. So this module hunts, from source alone, for places where the project spells out
// the SAME ENUMERATED DOMAIN more than once, and reports them as candidate parity pairs.
//
// WHY DOMAINS AND NOT SHAPES OR CLONES. Three strategies were available:
//   · signature twins — two functions with the same parameter/return types. Rejected:
//     `(s: string) => string` is not evidence of anything in a TypeScript codebase.
//   · token-stream clone detection — finds copy-paste. Rejected: copy-paste is a
//     maintenance smell; it is not a divergence RISK, and the ranking would be dominated
//     by boilerplate.
//   · duplicated enumerated domains — a set of string tokens written out twice. Chosen:
//     it is exactly the undeclared shape of a parity claim, and it carries a free second
//     signal — if the two sets are UNEQUAL the transcription has already drifted, which
//     is a finding with no declaration and no oracle behind it.
//
// A "site" is anywhere the source spells a set of tokens out loud: a string-literal union,
// an enum, an interface's members, an object/Record literal's keys, a switch's case labels,
// an if-chain of `x === "lit"` comparisons, an array/Set of string literals, the first
// column of a markdown table, or a bracketed `a|b|c` alternation inside a string or regex.
// Markdown counts on purpose: a hand-kept doc table transcribing a code table is the one
// duplication NO compiler will ever see, and this repo's own README says so in prose.
//
// THE DISCRIMINATOR — what keeps this from being a wall of noise — is that two sites the
// TYPE SYSTEM already ties together are not findings. `const T: Record<OracleVerdict, X>`
// is checked by tsc: the keys must be exactly the union, so the union and the table cannot
// drift. That pair is tier-1 (enshrined) and coherence has nothing to add. Only sites with
// NO type link between them are reported. Test files are excluded for the same reason from
// the other direction: a hand-copied domain inside an oracle is already the boundary
// meta-oracle's job (oracle-domain.ts), not a second detector's.
//
// Output is ADVISORY and RANKED. It gates nothing and always exits 0. A wall of low-value
// pairs is worse than nothing, so the default report is capped and every suppression is
// counted out loud — `--all` shows the unfiltered tail so the precision can be judged
// rather than trusted.
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import type { Config, Graph } from "./types.ts";
import { parseParity } from "./parity.ts";
import { isTestPath } from "./novelty.ts";
import { readJournal } from "./decisions.ts";
import { raiseFindings, formatRaise, type Finding } from "./raise.ts";
// Imported, not re-typed: the first dogfood run of this very detector flagged the copy of
// this list that used to live here against oracle-domain.ts's original — 10 shared tokens,
// tied together by nothing. Deriving one side from the other is the fix the report asks for.
import { NOISE_DIRS } from "./oracle-domain.ts";

/** How a domain was spelled out at one site. */
export type SiteKind =
  | "union"       // type X = "a" | "b" | …
  | "enum"        // enum X { A, B }
  | "shape"       // interface / type-literal member names
  | "table"       // object-literal keys (a Record / lookup table)
  | "switch"      // switch case labels
  | "compare"     // an if-chain of `x === "lit"` — a dispatch written as control flow
  | "list"        // an array / Set of string literals
  | "md-table"    // the first column of a markdown table
  | "alternation" // a bracketed `a|b|c` inside a string or regex literal

/** One place the source enumerates a set of tokens. */
export interface DomainSite {
  name: string;
  kind: SiteKind;
  file: string;
  line: number;
  keys: string[];
  /**
   * The named type an annotation ties this site to (`Record<OracleVerdict, X>` → the key
   * type; `: ToolName[]` → the element type). When one site IS the type another links to,
   * or both link to the same type, tsc is already the oracle and the pair is suppressed —
   * that is the whole difference between a finding and a compiler-enforced fact.
   */
  typeLink: string | null;
}

/** Prose sites can never be compiler-checked; a code↔prose pair is weighted for it. */
const isProse = (k: SiteKind) => k === "md-table" || k === "alternation";

// ── TypeScript sites ──────────────────────────────────────────────────────────────────

/** Generic containers that are not themselves a domain — unwrap to the type INSIDE. For
 *  `Record<K, V>` the domain is K (the value type is not what the keys must agree with).
 *  `Omit`/`Pick` matter as much as `Record`: `const DEFAULTS: Omit<Config, "root">` IS
 *  compiler-checked against `Config`, and missing that unwrap made the pair a false
 *  positive on the first dogfood run. */
const CONTAINERS = new Set(["Record", "Partial", "Readonly", "Required", "Array", "ReadonlyArray", "Set", "ReadonlySet", "Map", "ReadonlyMap", "Promise", "Omit", "Pick", "Exclude", "Extract", "NonNullable"]);

/** The named type an annotation ties a site to, or null. */
export function typeLinkOf(t: ts.TypeNode | undefined, depth = 0): string | null {
  if (!t || depth > 6) return null;
  if (ts.isArrayTypeNode(t)) return typeLinkOf(t.elementType, depth + 1);
  if (ts.isParenthesizedTypeNode(t)) return typeLinkOf(t.type, depth + 1);
  if (!ts.isTypeReferenceNode(t) || !ts.isIdentifier(t.typeName)) return null;
  const name = t.typeName.text;
  if (CONTAINERS.has(name)) return typeLinkOf(t.typeArguments?.[0], depth + 1);
  return name;
}

/** Bracketed `(a|b|c)` / `<a|b|c>` alternations — an enumerated domain written as text.
 *  The brackets are load-bearing: without them every prose sentence containing a pipe
 *  would qualify. Parts must be short, word-shaped tokens. */
export function alternationsIn(text: string): string[][] {
  const out: string[][] = [];
  for (const m of text.matchAll(/[(<]([^()<>|]+(?:\|[^()<>|]+){2,})[)>]/g)) {
    const parts = m[1].split("|").map((p) => p.trim());
    if (parts.every((p) => /^[A-Za-z][A-Za-z0-9_. -]{0,31}$/.test(p))) out.push([...new Set(parts)]);
  }
  return out;
}

const MIN_KEYS = 3;

/** Pure (AST only) — every domain site in one TypeScript/JavaScript source. */
export function sitesOfSource(src: string, file = "x.ts"): DomainSite[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: DomainSite[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const push = (name: string, kind: SiteKind, keys: string[], n: ts.Node, typeLink: string | null = null) => {
    const uniq = [...new Set(keys)].sort();
    if (uniq.length >= MIN_KEYS) sites.push({ name, kind, file, line: lineOf(n), keys: uniq, typeLink });
  };
  // `x === "lit"` chains are collected per compared-expression, because a dispatch is
  // spread over an if-chain by construction. Keyed by ENCLOSING FUNCTION as well as by
  // expression text: grouping `e.kind` file-wide fused two unrelated `e`s in promise.ts on
  // the first dogfood run and manufactured a divergence out of the collision.
  const compares = new Map<string, { keys: string[]; node: ts.Node; text: string }>();
  const fnScopeOf = (n: ts.Node): number => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent)
      if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) || ts.isMethodDeclaration(p)) return p.getStart(sf);
    return -1;
  };

  const propName = (p: ts.ObjectLiteralElementLike): string | null =>
    p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name))
      ? (ts.isIdentifier(p.name) ? p.name.text : p.name.text)
      : null;

  const visit = (n: ts.Node): void => {
    // type X = "a" | "b" | … — the canonical enumerated domain
    if (ts.isTypeAliasDeclaration(n) && ts.isUnionTypeNode(n.type)) {
      const members = n.type.types.flatMap((t) => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? [t.literal.text] : []));
      if (members.length === n.type.types.length) push(n.name.text, "union", members, n);
    }
    if (ts.isEnumDeclaration(n)) push(n.name.text, "enum", n.members.map((m) => m.name.getText(sf).replace(/^["']|["']$/g, "")), n);
    // interface / type-literal members — a shape is an enumerated domain of field names
    if (ts.isInterfaceDeclaration(n))
      push(n.name.text, "shape", n.members.flatMap((m) => (m.name && ts.isIdentifier(m.name) ? [m.name.text] : [])), n);
    if (ts.isTypeAliasDeclaration(n) && ts.isTypeLiteralNode(n.type))
      push(n.name.text, "shape", n.type.members.flatMap((m) => (m.name && ts.isIdentifier(m.name) ? [m.name.text] : [])), n);
    // an ANONYMOUS type literal on a property (`novelty?: { minSurface?: number; … }`) is
    // still a domain — and its defaults table lives elsewhere, untyped, free to drift. Name
    // it `<Owner>.<prop>` so the report says where it is.
    if (ts.isPropertySignature(n) && n.type && ts.isTypeLiteralNode(n.type) && n.name && ts.isIdentifier(n.name)) {
      const owner = ts.isInterfaceDeclaration(n.parent) ? n.parent.name.text : "";
      push(`${owner ? owner + "." : ""}${n.name.text}`, "shape", n.type.members.flatMap((m) => (m.name && ts.isIdentifier(m.name) ? [m.name.text] : [])), n);
    }
    // const T: Record<…> = { … } / [ "a", "b" ] / new Set([…]) — tables and lists
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      let init: ts.Expression = n.initializer;
      let link = typeLinkOf(n.type);
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) {
        if ((ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) && !link) link = typeLinkOf(init.type);
        init = init.expression;
      }
      if (ts.isNewExpression(init) && init.arguments?.length === 1) {
        let a: ts.Expression = init.arguments[0];
        while (ts.isAsExpression(a) || ts.isParenthesizedExpression(a)) a = a.expression;
        init = a;
      }
      if (ts.isObjectLiteralExpression(init))
        push(n.name.text, "table", init.properties.flatMap((p) => { const k = propName(p); return k ? [k] : []; }), n, link);
      else if (ts.isArrayLiteralExpression(init) && init.elements.length && init.elements.every((e) => ts.isStringLiteral(e)))
        push(n.name.text, "list", init.elements.map((e) => (e as ts.StringLiteral).text), n, link);
    }
    // switch (x) { case "a": … }
    if (ts.isSwitchStatement(n)) {
      const labels = n.caseBlock.clauses.flatMap((c) => (ts.isCaseClause(c) && ts.isStringLiteral(c.expression) ? [c.expression.text] : []));
      push(n.expression.getText(sf).slice(0, 40), "switch", labels, n);
    }
    // x === "lit" — a dispatch chain is a domain spelled as control flow
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(n.operatorToken.kind)) {
      const [lit, other] = ts.isStringLiteral(n.left) ? [n.left, n.right] : ts.isStringLiteral(n.right) ? [n.right, n.left] : [null, null];
      if (lit && other && (ts.isIdentifier(other) || ts.isPropertyAccessExpression(other))) {
        const text = other.getText(sf).slice(0, 40);
        const key = `${fnScopeOf(n)}::${text}`;
        const e = compares.get(key) ?? { keys: [], node: n, text };
        e.keys.push(lit.text);
        compares.set(key, e);
      }
    }
    // bracketed alternations inside string / regex literals
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isRegularExpressionLiteral(n)) {
      const text = ts.isRegularExpressionLiteral(n) ? n.getText(sf) : n.text;
      for (const parts of alternationsIn(text)) push(`alternation@${lineOf(n)}`, "alternation", parts, n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const e of compares.values()) push(e.text, "compare", e.keys, e.node);
  return sites;
}

// ── markdown sites ────────────────────────────────────────────────────────────────────

/** Strip inline markdown so a table cell yields the token it names. */
const plainCell = (s: string) =>
  s.replace(/\\\|/g, "|").replace(/`([^`]*)`/g, "$1").replace(/\*\*?([^*]*)\*\*?/g, "$1")
   .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();

/** Split a markdown row on UNESCAPED pipes (cells legitimately contain `\|`). */
const cells = (row: string) => row.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(plainCell);

/** Pure — domain sites in one markdown document: table first columns, plus bracketed
 *  alternations in inline code. A hand-kept doc table is exactly the transcription no
 *  compilation can see. */
export function sitesOfMarkdown(text: string, file = "README.md"): DomainSite[] {
  const lines = text.split("\n");
  const sites: DomainSite[] = [];
  let heading = file;
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const h = /^#{1,6}\s+(.+?)\s*$/.exec(l);
    if (h) { heading = h[1].slice(0, 40); continue; }
    // a table: header row, a `| --- |` rule, then body rows
    if (l.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|[\s:|-]*-[\s:|-]*\|\s*$/.test(lines[i + 1])) {
      const keys: string[] = [];
      let j = i + 2;
      for (; j < lines.length && lines[j].trim().startsWith("|"); j++) {
        const c = cells(lines[j])[0];
        if (c) keys.push(c);
      }
      const uniq = [...new Set(keys)].sort();
      if (uniq.length >= MIN_KEYS) sites.push({ name: heading, kind: "md-table", file, line: i + 1, keys: uniq, typeLink: null });
      i = j - 1;
      continue;
    }
    for (const m of l.matchAll(/`([^`]+)`/g))
      for (const parts of alternationsIn(m[1].replace(/\\\|/g, "|")))
        sites.push({ name: `alternation@${i + 1}`, kind: "alternation", file, line: i + 1, keys: [...parts].sort(), typeLink: null });
  }
  return sites.filter((s) => s.keys.length >= MIN_KEYS);
}

// ── the walk ──────────────────────────────────────────────────────────────────────────

const CODE_RE = /\.[mc]?[jt]sx?$/;
/** Generated artifacts restate the graph by construction — they are output, not a second
 *  hand-kept spelling of the domain, so a pair against them would be pure noise. */
const GENERATED = new Set(["AGENTS.md", "graph.json", "CHANGELOG.md"]);

export async function collectSites(cfg: Config): Promise<DomainSite[]> {
  const ignore = new Set([...NOISE_DIRS, ...(cfg.ignore ?? []), cfg.outputDir]);
  const out: DomainSite[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".") || ignore.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { await visit(p); continue; }
      const rel = relative(cfg.root, p);
      // Tests are evidence, not a second spelling of the domain: a hand-copied list inside
      // an oracle is the boundary meta-oracle's finding (oracle-domain.ts), not this one's.
      if (isTestPath(rel) || GENERATED.has(e.name)) continue;
      const src = await readFile(p, "utf8").catch(() => null);
      if (src === null) continue;
      if (CODE_RE.test(e.name)) out.push(...sitesOfSource(src, rel));
      else if (e.name.endsWith(".md")) out.push(...sitesOfMarkdown(src, rel));
    }
  };
  await visit(cfg.root);
  return out;
}

// ── pairing and ranking ───────────────────────────────────────────────────────────────

export interface RedundancyPair {
  a: DomainSite; b: DomainSite;
  shared: string[];
  onlyA: string[]; onlyB: string[];
  /** shared tokens that appear at NO other site — the two sites own this vocabulary. */
  exclusive: number;
  score: number;
}

export interface Suppressed { typeLinked: number; declared: number; belowScore: number; }

export interface RedundancyOpts {
  minShared?: number;   // tokens two sites must share before they are even a candidate
  containment?: number; // fraction of the SMALLER set the overlap must cover
  minScore?: number;    // ranking floor for the default report
  maxDf?: number;       // a token at more than this many sites is vocabulary, not a domain
  top?: number;         // how many pairs the default report prints
}
// `Required<RedundancyOpts>`, not a bare object literal: the first dogfood run flagged this
// table against the interface above it (5 shared keys, tied by nothing). The annotation makes
// tsc the oracle, which is the tier-1 fix — and the pair now suppresses as compiler-enforced.
export const REDUNDANCY_DEFAULTS: Required<RedundancyOpts> = { minShared: 3, containment: 0.7, minScore: 3.5, maxDf: 6, top: 10 };

const siteId = (s: DomainSite) => `${s.file}#${s.kind}:${s.name}@${s.line}`;

// ── stable identity, for the journal ──────────────────────────────────────────────────
//
// `siteId` above is a WITHIN-RUN key: it separates two sites during pairing, and the line
// is in it because two sites can otherwise be indistinguishable inside one file. That is
// exactly the wrong key to write down. A question raised about a pair has to survive an
// unrelated edit ten lines above it, so identity drops the line — the same call `cli.ts`
// makes when it strips `data-line` before comparing graph.json, and for the same reason:
// a line number is a navigation aid, never structure.

/** The site's name with any POSITIONAL suffix replaced by a digest of its own tokens.
 *
 *  Alternation sites are named `alternation@<line>` — the line is INSIDE the name, so
 *  dropping the `@line` from the id is not enough. Two ways to fix it and only one works:
 *  stripping the suffix outright fuses every alternation in a file into one key (two real
 *  findings collapse, and the second is swallowed), while digesting the token set keeps
 *  them apart and does not move when the file does. A changed token set IS a different
 *  enumeration, so re-keying on it is the honest behaviour rather than a leak. */
export function stableSiteName(s: DomainSite): string {
  const m = /^(.*)@\d+$/.exec(s.name);
  if (!m) return s.name;
  return `${m[1]}#${createHash("sha256").update(s.keys.join(" ")).digest("hex").slice(0, 6)}`;
}

/** A site, as a thing a reader can go and find: file, how it was spelled, what it is
 *  called. No line, no token count, no score. */
export const siteSubject = (s: DomainSite): string => `${s.file}#${s.kind}:${stableSiteName(s)}`;

/** THE PAIR'S IDENTITY IS THE PAIR OF SITES, sorted so A|B and B|A are one question.
 *
 *  Everything else the report prints about a pair is excluded on purpose, and the score is
 *  the one that matters: `df` is computed over the WHOLE TREE, so a token appearing in one
 *  more unrelated file re-ranks every pair in the repo. A key holding the score would open
 *  a fresh question on an edit that touched neither site. */
export const pairSubject = (p: RedundancyPair): string =>
  [siteSubject(p.a), siteSubject(p.b)].sort().join("|");

/**
 * Pure — pair the sites and rank them. `declared` is the set of symbol names any parity
 * claim already names (domain / fnA / fnB): a declared agreement is not a finding, which
 * is the point of the whole command.
 *
 * The score is deliberately small and explainable:
 *   |shared| × (0.35 + 0.65·distinctness) × mediumW × fileW × divergenceW
 * where distinctness is the fraction of shared tokens that appear at NO third site (two
 * sites owning a private vocabulary is the strong case; tokens scattered everywhere are
 * project idiom), mediumW favours code↔prose (no compiler can ever check it), fileW
 * discounts same-file pairs, and divergenceW rewards sets that ALREADY disagree — a
 * transcription that has drifted is a finding on its own evidence.
 */
export function pairSites(sites: DomainSite[], declared: Set<string>, opts: RedundancyOpts = {}): { pairs: RedundancyPair[]; suppressed: Suppressed } {
  const o = { ...REDUNDANCY_DEFAULTS, ...opts };
  const suppressed: Suppressed = { typeLinked: 0, declared: 0, belowScore: 0 };

  // COLLAPSE FIRST. A site the compiler ties to another site's type (`Record<Verdict, X>`
  // where `Verdict` is right there) is a PROJECTION of that domain, not a second spelling
  // of it — tsc cannot let the two drift. Folding it away before anything else does two
  // jobs: it can never be reported, and it stops diluting the rarity of the domain's own
  // tokens (three sites holding a token instead of two made the true pair look like
  // common vocabulary and sank it below the floor). The key-overlap guard keeps a mere
  // NAME collision from swallowing an unrelated site.
  const byName = new Map<string, DomainSite[]>();
  for (const s of sites) (byName.get(s.name) ?? byName.set(s.name, []).get(s.name)!).push(s);
  const live = sites.filter((s) => {
    if (!s.typeLink || s.typeLink === s.name) return true;
    const anchors = byName.get(s.typeLink) ?? [];
    const tied = anchors.some((t) => {
      const ks = new Set(t.keys);
      return s.keys.filter((k) => ks.has(k)).length / Math.min(s.keys.length, t.keys.length) >= o.containment;
    });
    if (tied) suppressed.typeLinked++;
    return !tied;
  });

  const df = new Map<string, number>();
  for (const s of live) for (const k of s.keys) df.set(k, (df.get(k) ?? 0) + 1);

  // inverted index over the tokens that could still discriminate — candidate pairs come
  // only from a shared token, so this stays linear in the number of co-occurrences.
  const byToken = new Map<string, DomainSite[]>();
  for (const s of live)
    for (const k of s.keys)
      if ((df.get(k) ?? 0) <= o.maxDf) (byToken.get(k) ?? byToken.set(k, []).get(k)!).push(s);

  const seen = new Set<string>();
  const pairs: RedundancyPair[] = [];

  for (const group of byToken.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const [a, b] = [group[i], group[j]];
      const ia = siteId(a), ib = siteId(b);
      if (ia === ib) continue;
      const key = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const bs = new Set(b.keys);
      const shared = a.keys.filter((k) => bs.has(k) && (df.get(k) ?? 0) <= o.maxDf);
      if (shared.length < o.minShared) continue;
      if (shared.length / Math.min(a.keys.length, b.keys.length) < o.containment) continue;

      // Two projections of a type declared OUTSIDE the scanned tree (a .d.ts, a dependency)
      // survive the collapse above because no anchor site exists — but tsc still ties them.
      if (a.typeLink && a.typeLink === b.typeLink) { suppressed.typeLinked++; continue; }
      // someone already wrote the parity claim.
      if (declared.has(a.name) || declared.has(b.name)) { suppressed.declared++; continue; }

      const exclusive = shared.filter((k) => (df.get(k) ?? 0) === 2).length;
      const distinctness = exclusive / shared.length;
      const onlyA = a.keys.filter((k) => !bs.has(k));
      const onlyB = b.keys.filter((k) => !a.keys.includes(k));
      // A comparison chain or a switch legitimately reads only PART of a domain: a code
      // path that handles three of five cases is control flow, not drift. So a clean
      // subset on the partial side earns NO divergence bonus — only extras it holds that
      // the domain does not (the direction that means something actually moved).
      const partial = (s: DomainSite) => s.kind === "compare" || s.kind === "switch";
      const subsetExpected =
        (partial(a) && !onlyA.length && !!onlyB.length) || (partial(b) && !onlyB.length && !!onlyA.length);
      const mediumW = isProse(a.kind) !== isProse(b.kind) ? 1.25 : 1;
      // Two INTERFACES sharing field names is ordinary type modelling, and tsc enforces
      // each one at its own construction sites — weak evidence. An interface against an
      // untyped object literal is the opposite: an options type and its DEFAULTS table,
      // one derived and one written by hand, with nothing making them agree. That is the
      // "constant transcribed in two places" case by name.
      const kinds = [a.kind, b.kind];
      const kindW = kinds.every((k) => k === "shape") ? 0.6
        : kinds.includes("shape") && kinds.includes("table") ? 1.3 : 1;
      const fileW = a.file === b.file ? 0.75 : 1;
      const divergeW = (onlyA.length || onlyB.length) && !subsetExpected ? 1.4 : 1;
      const score = shared.length * (0.35 + 0.65 * distinctness) * mediumW * kindW * fileW * divergeW;
      pairs.push({ a, b, shared, onlyA, onlyB, exclusive, score: Math.round(score * 100) / 100 });
    }
  }
  pairs.sort((x, y) => y.score - x.score || y.shared.length - x.shared.length);
  suppressed.belowScore = pairs.filter((p) => p.score < o.minScore).length;
  return { pairs, suppressed };
}

/** The symbol names any parity claim already names — those pairs are declared, not found. */
export function declaredParitySymbols(graph: Graph): Set<string> {
  const out = new Set<string>();
  for (const n of graph.nodes)
    if (n.kind === "component")
      for (const c of n.claims ?? []) { const p = parseParity(c); if (p) { out.add(p.domain); out.add(p.f); out.add(p.g); } }
  return out;
}

// ── render ────────────────────────────────────────────────────────────────────────────

const where = (s: DomainSite) => `${s.file}:${s.line}  ${s.kind} \`${s.name}\``;
const list = (xs: string[], n = 8) => xs.slice(0, n).map((x) => `"${x}"`).join(", ") + (xs.length > n ? `, … (+${xs.length - n})` : "");

/** THE REPORTING FLOOR, in one place. The render shows these and — separately — these are
 *  the only pairs allowed to become journal entries. Sharing the function rather than
 *  restating the filter is the point: "raise only what the advisory already reports" has
 *  to be enforced by construction, or the two copies drift and raising quietly widens. */
export function shownPairs(pairs: RedundancyPair[], opts: RedundancyOpts = {}): RedundancyPair[] {
  const o = { ...REDUNDANCY_DEFAULTS, ...opts };
  return pairs.filter((p) => p.score >= o.minScore).slice(0, o.top);
}

export function renderRedundancy(pairs: RedundancyPair[], suppressed: Suppressed, siteCount: number, opts: RedundancyOpts = {}): string {
  const o = { ...REDUNDANCY_DEFAULTS, ...opts };
  const shown = shownPairs(pairs, o);
  const out: string[] = ["\n  REDUNDANCY — the same enumerated domain, spelled more than once, declared nowhere\n"];
  out.push(`  ${siteCount} domain site(s) scanned · ${pairs.length} overlapping pair(s) · ${shown.length} above the reporting floor (score ≥ ${o.minScore})`);
  out.push(`  suppressed: ${suppressed.typeLinked} compiler-enforced (a type ties the two sites together) · ` +
    `${suppressed.declared} already carrying a parity claim · ${suppressed.belowScore} below the floor` +
    (suppressed.belowScore ? " (--all to see them)" : ""));
  // THE DENOMINATOR DECIDES WHICH SENTENCE THIS IS. With zero sites there is no ✓ to be
  // had: "nothing duplicated" and "nothing read" produce the identical finding, and only
  // the population separates them. The report says which one it is — `drift`'s "only 0
  // mapped development commits" and `economy`'s "no closures to measure" already do.
  if (!siteCount) {
    out.push("\n  no domain sites to compare: 0 site(s) found — nothing in this tree spells an");
    out.push("  enumerated domain out loud (or the walk reached no files at all).\n");
    return out.join("\n");
  }
  if (!shown.length) {
    out.push(`\n  ✓ no undeclared duplicated domain above the floor (${siteCount} site(s) and ${pairs.length} overlapping pair(s) examined).\n`);
    return out.join("\n");
  }
  out.push("");
  for (const [i, p] of shown.entries()) {
    out.push(`  ${String(i + 1).padStart(2)}. score ${p.score.toFixed(2)}  ·  ${p.shared.length} shared token(s), ${p.exclusive} of them found nowhere else`);
    out.push(`      A  ${where(p.a)}`);
    out.push(`      B  ${where(p.b)}`);
    out.push(`      shared: ${list(p.shared)}`);
    if (p.onlyA.length) out.push(`      ✗ only in A: ${list(p.onlyA)}`);
    if (p.onlyB.length) out.push(`      ✗ only in B: ${list(p.onlyB)}`);
    if (p.onlyA.length || p.onlyB.length)
      out.push(`      → the two spellings ALREADY disagree. Either the difference is intended (say so), or one side drifted.`);
    else
      out.push(`      → identical today, tied together by nothing. Declare a parity claim, or derive one side from the other.`);
    out.push("");
  }
  out.push("  These are CANDIDATES, not defects. The finding is that two independent spellings exist");
  out.push("  with nothing keeping them equal — derive one from the other (best), or declare:");
  out.push('    parity "<what must agree>" over <domain> between <fnA> and <fnB> via test "<oracle>"\n');
  return out.join("\n");
}

// ── raising ───────────────────────────────────────────────────────────────────────────

/** A pair, as a QUESTION. The render already forms this suspicion and then throws it away
 *  by printing it — "either the difference is intended (say so), or one side drifted" is a
 *  conjecture with two candidates, verbatim, scrolled past once per run forever.
 *
 *  The observation carries line numbers and a score because it is a SNAPSHOT of what was
 *  seen; identity comes from `pairSubject`, which carries neither. Separating the two is
 *  what lets the sentence be useful and the key be stable at the same time. */
export function pairFindings(pairs: RedundancyPair[]): Finding[] {
  return pairs.map((p) => {
    const diverged = p.onlyA.length > 0 || p.onlyB.length > 0;
    return {
      advisory: "redundancy",
      subject: pairSubject(p),
      // A LABEL, not a paragraph. The lines, the kinds, the exclusivity count and the
      // token diff all belong below, in `because`, which is uncapped — that is the same
      // split `LABEL_SOFT_MAX` exists to enforce, and the journal warns when a `chose`
      // starts reading as rationale. It warned here, three times, on the first raise.
      observation:
        `${p.a.file} \`${p.a.name}\` and ${p.b.file} \`${p.b.name}\` spell one`
        + ` ${p.shared.length}-token domain, tied together by nothing`
        + (diverged ? " — and it has ALREADY drifted" : ""),
      because:
        `A is ${p.a.kind} at ${p.a.file}:${p.a.line}; B is ${p.b.kind} at ${p.b.file}:${p.b.line}.`
        + ` ${p.exclusive} of the ${p.shared.length} shared token(s) appear at no third site, so this is a`
        + " private vocabulary rather than project idiom — the case where a divergence would mean"
        + " something. Nothing in the type system and no parity claim keeps the two equal, so the only"
        + " thing holding them together today is that somebody remembered."
        + (p.onlyA.length ? ` Only in A: ${list(p.onlyA, 6)}.` : "")
        + (p.onlyB.length ? ` Only in B: ${list(p.onlyB, 6)}.` : ""),
      couldBe: diverged
        ? [
          "one side drifted — a token was added or renamed at one spelling and not at the other,"
          + " and there was nothing there to notice",
          "the difference is intended — the two sites describe overlapping but deliberately"
          + " different domains, and nobody wrote that down",
        ]
        : [
          "they agree today by maintenance, not by construction — the next edit to either one is"
          + " free to break it silently",
        ],
      discriminatedBy:
        `put the two token sets side by side. If one is derivable from the other, DERIVE it and the`
        + ` pair stops existing — that is the tier-1 fix and it needs no claim. If they must agree`
        + ` but cannot be derived, declare it: parity "<what must agree>" over <domain> between`
        + ` <fnA> and <fnB> via test "<oracle>". If they must NOT agree, the pairing is this`
        + ` detector's mistake — say so in the parity claim's absence by dismissing this question.`,
      files: p.a.file === p.b.file ? [p.a.file] : [p.a.file, p.b.file],
    };
  });
}

export interface RedundancyCmdOpts extends RedundancyOpts { all?: boolean; raise?: boolean; raiseCap?: number; session?: string; agent?: string }

/** The `coherence redundancy` command. Advisory: always returns 0. */
export async function redundancy(cfg: Config, graph: Graph, opts: RedundancyCmdOpts = {}): Promise<number> {
  const { all, raise: doRaise, raiseCap, session, agent, ...thresholds } = opts;
  const sites = await collectSites(cfg);
  // `base` is the project's floor. `eff` is what the RENDER uses, and `--all` drops the
  // floor to zero there so the precision of the tail can be judged rather than trusted.
  const base: RedundancyOpts = { ...(cfg.redundancy ?? {}), ...thresholds };
  const eff: RedundancyOpts = { ...base, ...(all ? { minScore: 0, top: Number.MAX_SAFE_INTEGER } : {}) };
  const { pairs, suppressed } = pairSites(sites, declaredParitySymbols(graph), eff);
  console.log(renderRedundancy(pairs, suppressed, sites.length, eff));

  // RAISING READS `base`, NEVER `eff`. `--all` exists to expose the tail below the floor,
  // and the tail is precisely what must not become questions — a flag whose job is to show
  // more must not also mean write more, or the one command a curious person runs first is
  // the one that fills their journal.
  const report = raiseFindings(cfg, readJournal(cfg).records, pairFindings(shownPairs(pairs, base)), {
    enabled: doRaise, cap: raiseCap, session, agent,
  });
  for (const line of formatRaise(report)) console.log(line);
  return 0;
}
