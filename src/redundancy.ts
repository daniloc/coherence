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
// Every site is read through the file's GRAMMAR (phase 2b, arm 3): a per-language query
// names the forms that count — module-level dict literals, Enum class bodies, list/tuple/
// set constants of plain string literals, match-case / if-elif chains on the python side;
// unions, enums, shapes, tables, switches and comparison chains on the TS side — and ONE
// capture-class mechanism turns captured nodes into sites for every language. The TS side previously walked
// the compiler API (syntax only — it never consulted a type checker, so `typeLink` reads
// identically off the grammar's annotation nodes); the python side was a line scan. The
// precision discipline survives the port: a form the query does not name (a comprehension,
// a computed key, a dict()/frozenset() constructor call) yields NO site rather than a
// wrong one, because python has no compiler behind it — the typeLink suppression that
// quietly absorbs the TS false positives can never fire on a .py pair, so every python
// site the ranker sees must have earned its precision upstream.
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
import { Query, type Node } from "web-tree-sitter";
import { grammarHandle, withTree } from "./adapters/tree-sitter.ts";
import type { Config, Graph } from "./types.ts";
import { parseParity } from "./parity.ts";
import { isTestPath } from "./novelty.ts";
import { readJournal } from "./decisions.ts";
import { raiseFindings, formatRaise, type Finding } from "./raise.ts";
// Imported, not re-typed: the first dogfood run of this very detector flagged the copy of
// this list that used to live here against oracle-domain.ts's original — 10 shared tokens,
// tied together by nothing. Deriving one side from the other is the fix the report asks for.
import { NOISE_DIRS, isPyTestPath } from "./oracle-domain.ts";

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

// ── the per-language site data (queries, not scanners) ────────────────────────────────
// CAPTURE-COMPLETE: a built-in pack carries ONLY query text and the names of
// mechanism-owned strategies — never functions, and no grammar vocabulary survives in
// the shared mechanism. Site patterns name the enumerating forms (`*.decl` carries the
// reported line, `*.name` the reported name, `*.body` the node members aggregate under).
// Member patterns put the per-grammar walking INTO the query: each pairs one
// member-grade capture with the HOLDER node it is a direct child of
// (`@shape.member`+`@shape.of`, `@table.key`+`@table.of`, `@list.item`+`@list.of`,
// `@enum.member`+`@enum.of`, `@switch.label`+`@switch.labelof`, `@union.member` and
// `@union.alt` under their unions), so the mechanism aggregates per site by CAPTURE
// CLASS and captured-node identity, never by node type. `.lit`-suffixed members are
// string literals; the generic unquoting they need is mechanism, selected by the pack's
// `strings` strategy name. The `@cmp.*` patterns spell exactly the comparison forms the
// retired scanners accepted — the python CMP regexes became the anchored
// `comparison_operator` shapes below (operators, bare-quote requirement and
// chain-middle matches included); `@peel.*` name the wrapper layers a TS initializer
// hides under; `@scope` every node that opens a function scope, so chain GROUPING (still
// mechanism — it is policy) reads scopes off captures by position, never by node-type
// name. `@skip` / `@interp` / `@lit.sub` mark the nodes the retired walks filtered
// (comments, f-string interpolations, template substitutions) for identity-dropping —
// the capture-side residue of kids().

interface SiteLanguage {
  grammar: string;
  query: string;
  /** How a captured string literal yields its token — a mechanism-owned unquoting
   *  strategy by NAME (pack purity: data, never code): `cooked` decodes escape
   *  sequences (the retired TS compiler walk read cooked text); `raw` strips the quote
   *  runs and any prefix but leaves escapes alone (what the retired python scan saw). */
  strings: "cooked" | "raw";
  /** How `@cmp` captures group into chains: `operand` keys every comparison match
   *  directly (the TS grade — whole operand nodes); `condition` mirrors the retired
   *  python line scan — at most one comparison per if/elif condition, name-first
   *  (`x == "lit"`) shapes preferred over lit-first, exactly as CMP_A outranked CMP_B. */
  compare: "operand" | "condition";
}

export const SITE_LANGUAGES: Record<"typescript" | "python", SiteLanguage> = {
  typescript: {
    grammar: "typescript",
    strings: "cooked",
    compare: "operand",
    query: `
      (type_alias_declaration name: (type_identifier) @union.name value: (union_type) @union.body) @union.decl
      (enum_declaration name: (identifier) @enum.name body: (enum_body) @enum.body) @enum.decl
      (interface_declaration name: (type_identifier) @shape.name body: (interface_body) @shape.body) @shape.decl
      (type_alias_declaration name: (type_identifier) @shape.name value: (object_type) @shape.body) @shape.decl
      (property_signature name: (property_identifier) @nested.name type: (type_annotation (object_type) @nested.body)) @nested.decl
      (variable_declarator name: (identifier) @var.name value: (_) @var.init) @var.decl
      (switch_statement body: (switch_body) @switch.body) @switch.decl
      (binary_expression left: [(identifier) (member_expression)] @cmp.expr operator: ["===" "!==" "==" "!="] right: (string) @cmp.lit) @cmp
      (binary_expression left: (string) @cmp.lit operator: ["===" "!==" "==" "!="] right: [(identifier) (member_expression)] @cmp.expr) @cmp
      (string) @lit.text
      (template_string) @lit.text
      (regex) @lit.raw
      (union_type (_) @union.alt) @union.altof
      (union_type (literal_type (string) @union.member)) @union.memberof
      (enum_body (property_identifier) @enum.member) @enum.of
      (enum_body (string) @enum.member.lit) @enum.of
      (enum_body (enum_assignment name: (property_identifier) @enum.member)) @enum.of
      (enum_body (enum_assignment name: (string) @enum.member.lit)) @enum.of
      (interface_body [(property_signature name: (property_identifier) @shape.member) (method_signature name: (property_identifier) @shape.member)]) @shape.of
      (object_type [(property_signature name: (property_identifier) @shape.member) (method_signature name: (property_identifier) @shape.member)]) @shape.of
      (interface_declaration name: (type_identifier) @nested.owner body: (interface_body (property_signature name: (property_identifier) type: (type_annotation (object_type))) @nested.owned))
      (variable_declarator type: (type_annotation (_) @var.type)) @var.typed
      (as_expression (_) @peel.item) @peel.as
      (satisfies_expression (_) @peel.item) @peel.sat
      (parenthesized_expression (_) @peel.item) @peel.paren
      (new_expression arguments: (arguments (_) @peel.item)) @peel.new
      (object) @table.body
      (object (pair key: (property_identifier) @table.key)) @table.of
      (object (pair key: (number) @table.key)) @table.of
      (object (pair key: (string) @table.key.lit)) @table.of
      (object (method_definition name: (property_identifier) @table.key)) @table.of
      (object (method_definition name: (number) @table.key)) @table.of
      (object (method_definition name: (string) @table.key.lit)) @table.of
      (object (shorthand_property_identifier) @table.key) @table.of
      (array) @list.body
      (array (string) @list.item) @list.of
      (array (_) @list.alt) @list.of
      (switch_statement value: (parenthesized_expression (_) @switch.subject)) @switch.subjof
      (switch_body (switch_case value: (string) @switch.label)) @switch.labelof
      (template_string (template_substitution) @lit.sub)
      [(function_declaration) (generator_function_declaration) (function_expression) (generator_function) (arrow_function) (method_definition)] @scope
      (comment) @skip
    `,
  },
  python: {
    grammar: "python",
    strings: "raw",
    compare: "condition",
    query: `
      (module (class_definition name: (identifier) @enum.name superclasses: (argument_list) @enum.bases (#match? @enum.bases "^\\\\(\\\\s*(enum\\\\s*\\\\.\\\\s*)?(Enum|IntEnum|StrEnum|Flag|IntFlag)\\\\s*\\\\)$") body: (block) @enum.body) @enum.decl)
      (module (decorated_definition (class_definition name: (identifier) @enum.name superclasses: (argument_list) @enum.bases (#match? @enum.bases "^\\\\(\\\\s*(enum\\\\s*\\\\.\\\\s*)?(Enum|IntEnum|StrEnum|Flag|IntFlag)\\\\s*\\\\)$") body: (block) @enum.body) @enum.decl))
      (module (expression_statement (assignment left: (identifier) @var.name right: [(dictionary) (list) (tuple) (set)] @var.init) @var.decl))
      (match_statement body: (block) @switch.body) @switch.decl
      (if_statement condition: (_) @cmp.cond) @cmp.clause
      (elif_clause condition: (_) @cmp.cond) @cmp.clause
      ((block (expression_statement (assignment left: (identifier) @enum.member (#match? @enum.member "^[A-Za-z]")))) @enum.of)
      (dictionary) @table.body
      (dictionary (pair key: (string) @table.key.lit)) @table.of
      [(list) (tuple) (set)] @list.body
      ((list (string) @list.item) @list.of (#match? @list.item "^(\\"(?!\\"\\")|'(?!''))"))
      ((tuple (string) @list.item) @list.of (#match? @list.item "^(\\"(?!\\"\\")|'(?!''))"))
      ((set (string) @list.item) @list.of (#match? @list.item "^(\\"(?!\\"\\")|'(?!''))"))
      (list (_) @list.alt) @list.of
      (tuple (_) @list.alt) @list.of
      (set (_) @list.alt) @list.of
      (match_statement subject: (_) @switch.subject) @switch.subjof
      (block (case_clause . (case_pattern (string) @switch.label) . (block))) @switch.labelof
      (block (case_clause . (case_pattern (union_pattern) @switch.union) . (block))) @switch.labelof
      (union_pattern (string) @switch.ulabel) @switch.unionof
      (union_pattern (_) @switch.ualt) @switch.unionof
      ((comparison_operator . [(identifier) (attribute)] @cmp.cand.expr . operators: ["==" "!="] . (string) @cmp.cand.lit) @cmp.cand (#match? @cmp.cand.lit "^[\\"']"))
      ((comparison_operator (_) . [(identifier) (attribute)] @cmp.cand.expr . operators: ["==" "!="] . (string) @cmp.cand.lit) @cmp.cand (#match? @cmp.cand.lit "^[\\"']"))
      ((comparison_operator . (string) @cmp.cand.lit . operators: ["==" "!="] . [(identifier) (attribute)] @cmp.cand.expr) @cmp.cand (#match? @cmp.cand.lit "^[\\"']"))
      ((comparison_operator (_) . (string) @cmp.cand.lit . operators: ["==" "!="] . [(identifier) (attribute)] @cmp.cand.expr) @cmp.cand (#match? @cmp.cand.lit "^[\\"']"))
      (string (interpolation) @interp)
      (function_definition) @scope
      (comment) @skip
    `,
  },
};

// Loaded once at module evaluation — the adapter factory's own top-level-await pattern.
// The extractors below stay SYNC on purpose: tests and the spec's boundary claim address
// them as plain functions, so the async grammar load happens here, never per call.
const SITE_HANDLES = await (async () => {
  const load = async (l: SiteLanguage) => {
    const { language, parser } = await grammarHandle(l.grammar);
    return { parser, query: new Query(language, l.query) };
  };
  const [typescript, python] = await Promise.all([load(SITE_LANGUAGES.typescript), load(SITE_LANGUAGES.python)]);
  return { typescript, python };
})();

/** Named children minus comments — the grammar names comments as nodes; the retired
 *  compiler AST never surfaced them, and no member list should count one. */
const kids = (n: Node): Node[] => n.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");

const lineOf = (n: Node) => n.startPosition.row + 1;

// ── TypeScript sites ──────────────────────────────────────────────────────────────────

/** Generic containers that are not themselves a domain — unwrap to the type INSIDE. For
 *  `Record<K, V>` the domain is K (the value type is not what the keys must agree with).
 *  `Omit`/`Pick` matter as much as `Record`: `const DEFAULTS: Omit<Config, "root">` IS
 *  compiler-checked against `Config`, and missing that unwrap made the pair a false
 *  positive on the first dogfood run. */
const CONTAINERS = new Set(["Record", "Partial", "Readonly", "Required", "Array", "ReadonlyArray", "Set", "ReadonlySet", "Map", "ReadonlyMap", "Promise", "Omit", "Pick", "Exclude", "Extract", "NonNullable"]);

/** The named type an annotation ties a site to, or null. Mirrors the retired compiler
 *  walk exactly, including its one oddity: `as const` reads as a TypeReference named
 *  `const`, so two as-const twins carry the same link and suppress as they always did. */
export function typeLinkOf(t: Node | null | undefined, depth = 0): string | null {
  if (!t || depth > 6) return null;
  if (t.type === "array_type" || t.type === "parenthesized_type") return typeLinkOf(kids(t)[0], depth + 1);
  if (t.type === "type_identifier") return CONTAINERS.has(t.text) ? null : t.text; // bare `Record` (no args) linked nothing before either
  if (t.type === "generic_type") {
    const name = t.childForFieldName("name");
    if (name?.type !== "type_identifier") return null; // a qualified `ns.Thing` never linked
    if (!CONTAINERS.has(name.text)) return name.text;
    const args = t.childForFieldName("type_arguments");
    return typeLinkOf(args ? kids(args)[0] : undefined, depth + 1);
  }
  return null;
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

// ── the mechanism: one capture-class engine for every grammar ─────────────────────────
// Everything below aggregates CAPTURED NODES by class name and node identity — it never
// asks a node its type. The one sanctioned exception is `typeLinkOf` above (the brief's
// own carve-out: typeLink reads TS annotation nodes, and only ever runs on `@var.type` /
// `@peel.item` captures no other language emits).

/** `cooked` strategy — literal content with quotes/backticks off and escape sequences
 *  resolved: the retired compiler walk read cooked text, and a `"\\"` key must stay the
 *  same token. */
const cook = (s: Node) => s.text.slice(1, -1).replace(
  /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g,
  (_, uB, u4, x2, ch) => uB || u4 || x2
    ? String.fromCodePoint(parseInt(uB ?? u4 ?? x2, 16))
    : ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<string, string>)[ch] ?? ch,
);

/** `raw` strategy — the quote runs (and any r/b/f-style prefix) off, escapes left raw:
 *  what the retired python line scan captured. Text-only, so it needs no grammar. */
const rawCook = (s: Node): string => {
  const start = /^[A-Za-z]*("""|'''|"|')/.exec(s.text)?.[0].length ?? 1;
  const end = /("""|'''|"|')$/.exec(s.text)?.[1].length ?? 1;
  return s.text.slice(start, s.text.length - end);
};

// The `condition` compare strategy's spelling of one captured comparison — the retired
// scanner's OWN patterns, applied to the captured operands so its artifacts survive the
// port exactly: the literal is the first quoted span of the string node's text (so
// `"a'b"` still reads as `a`), and the expression is the word-dot run nearest the
// operator (so `a.b().c == "x"` still reads as `c`). Text-only — no grammar names.
const quotedSpan = (t: string) => /["']([^"']*)["']/.exec(t)?.[1];
const leadRun = (t: string) => /^[A-Za-z_][\w.]*/.exec(t)?.[0];
const tailRun = (t: string) => /[A-Za-z_][\w.]*$/.exec(t)?.[0];

const within = (n: Node, outer: Node) => n.startIndex >= outer.startIndex && n.endIndex <= outer.endIndex;
const byStart = (a: Node, b: Node) => a.startIndex - b.startIndex;

/** Pure (grammar grade) — every domain site one language's query finds in one source.
 *  Only the forms the query names become sites; everything else is deliberately silence. */
function grammarSites(langKey: keyof typeof SITE_LANGUAGES, src: string, file: string): DomainSite[] {
  const lang = SITE_LANGUAGES[langKey];
  const { parser, query } = SITE_HANDLES[langKey];
  return withTree(parser, src, [] as DomainSite[], (tree) => {
  const cookStr = lang.strings === "cooked" ? cook : rawCook;
  const matches = query.matches(tree.rootNode);

  const sites: DomainSite[] = [];
  const push = (name: string, kind: SiteKind, keys: string[], line: number, typeLink: string | null = null) => {
    const uniq = [...new Set(keys)].sort();
    if (uniq.length >= MIN_KEYS) sites.push({ name, kind, file, line, keys: uniq, typeLink });
  };

  // ── pass 1: aggregate member-grade captures by class and holder identity ──
  const held = new Map<string, Map<number, Node[]>>();
  const addHeld = (cls: string, holder: Node, n: Node) => {
    const m = held.get(cls) ?? held.set(cls, new Map()).get(cls)!;
    const a = m.get(holder.id);
    if (a) a.push(n); else m.set(holder.id, [n]);
  };
  const heldBy = (cls: string, holderId: number): Node[] => held.get(cls)?.get(holderId) ?? [];
  /** member class → the holder class its pattern pairs it with */
  const HELD: [string, string][] = [
    ["union.alt", "union.altof"], ["union.member", "union.memberof"],
    ["enum.member", "enum.of"], ["enum.member.lit", "enum.of"],
    ["shape.member", "shape.of"],
    ["table.key", "table.of"], ["table.key.lit", "table.of"],
    ["list.item", "list.of"], ["list.alt", "list.of"],
    ["switch.label", "switch.labelof"], ["switch.union", "switch.labelof"],
    ["switch.ulabel", "switch.unionof"], ["switch.ualt", "switch.unionof"],
    ["switch.subject", "switch.subjof"],
    ["var.type", "var.typed"],
  ];
  const skips = new Set<number>();          // @skip — comments, dropped by identity
  const interps: Node[] = [];               // @interp — f-string interpolations
  const litSubs: Node[] = [];               // @lit.sub — template substitutions
  const scopes: Node[] = [];                // @scope — function-scope openers
  const nestedOwner = new Map<number, string>();
  const peels = new Map<number, { cls: "as" | "sat" | "paren" | "new"; items: Node[] }>();
  const tableBodies = new Set<number>();
  const listBodies = new Set<number>();
  const cands: { node: Node; expr: Node; lit: Node }[] = [];

  for (const match of matches) {
    const by = new Map(match.captures.map((c) => [c.name, c.node]));
    if (by.has("skip")) { skips.add(by.get("skip")!.id); continue; }
    if (by.has("interp")) { interps.push(by.get("interp")!); continue; }
    if (by.has("lit.sub")) { litSubs.push(by.get("lit.sub")!); continue; }
    if (by.has("scope")) { scopes.push(by.get("scope")!); continue; }
    if (by.has("table.body")) { tableBodies.add(by.get("table.body")!.id); continue; }
    if (by.has("list.body")) { listBodies.add(by.get("list.body")!.id); continue; }
    if (by.has("nested.owner")) { nestedOwner.set(by.get("nested.owned")!.id, by.get("nested.owner")!.text); continue; }
    if (by.has("cmp.cand")) { cands.push({ node: by.get("cmp.cand")!, expr: by.get("cmp.cand.expr")!, lit: by.get("cmp.cand.lit")! }); continue; }
    if (by.has("peel.item")) {
      for (const cls of ["as", "sat", "paren", "new"] as const) {
        const outer = by.get(`peel.${cls}`);
        if (!outer) continue;
        const p = peels.get(outer.id) ?? peels.set(outer.id, { cls, items: [] }).get(outer.id)!;
        p.items.push(by.get("peel.item")!);
        break;
      }
      continue;
    }
    for (const [m, h] of HELD)
      if (by.has(m) && by.has(h)) { addHeld(m, by.get(h)!, by.get(m)!); break; }
  }
  for (const p of peels.values()) p.items.sort(byStart);
  const nonSkip = (n: Node) => !skips.has(n.id);
  const noInterp = (n: Node) => !interps.some((i) => within(i, n));

  // `x === "lit"` chains are collected per compared-expression, because a dispatch is
  // spread over an if-chain by construction. Keyed by ENCLOSING FUNCTION as well as by
  // expression text: grouping `e.kind` file-wide fused two unrelated `e`s in promise.ts on
  // the first dogfood run and manufactured a divergence out of the collision. The scope is
  // read POSITIONALLY off the innermost `@scope` capture containing the node — the walk by
  // ancestor node type moved into the query.
  const compares = new Map<string, { keys: string[]; line: number; text: string }>();
  const scopeKeyOf = (n: Node): string => {
    let best: Node | null = null;
    for (const s of scopes)
      if (s.startIndex <= n.startIndex && n.endIndex <= s.endIndex)
        if (!best || s.startIndex > best.startIndex || (s.startIndex === best.startIndex && s.endIndex < best.endIndex)) best = s;
    return best ? String(best.startIndex) : "-1";
  };

  // ── pass 2: site matches, in match order ──
  for (const match of matches) {
    const by = new Map(match.captures.map((c) => [c.name, c.node]));
    // type X = "a" | "b" | … — the canonical enumerated domain (every alternative a
    // string). Reachability walks the captured holder/alt graph: an alternative counts
    // only if its union is the body or another reachable alternative — which is exactly
    // the retired flat() recursion, minus the node-type test it used to need.
    if (by.has("union.body")) {
      const body = by.get("union.body")!;
      const seen = new Set<number>([body.id]);
      const queue = [body.id];
      const leaves: Node[] = [];
      while (queue.length) {
        const h = queue.pop()!;
        for (const a of heldBy("union.alt", h)) {
          if (!nonSkip(a) || seen.has(a.id)) continue;
          seen.add(a.id);
          if (heldBy("union.alt", a.id).some(nonSkip)) queue.push(a.id);
          else leaves.push(a);
        }
      }
      const members = [...seen].flatMap((id) => heldBy("union.member", id));
      if (members.length === leaves.length)
        push(by.get("union.name")!.text, "union", members.map(cookStr), lineOf(by.get("union.decl")!));
    } else if (by.has("enum.body")) {
      const bodyId = by.get("enum.body")!.id;
      const keys = [
        ...heldBy("enum.member", bodyId).map((m) => m.text),
        ...heldBy("enum.member.lit", bodyId).map(cookStr),
      ];
      push(by.get("enum.name")!.text, "enum", keys, lineOf(by.get("enum.decl")!));
    // interface / type-literal members — a shape is an enumerated domain of field names
    } else if (by.has("shape.body")) {
      push(by.get("shape.name")!.text, "shape", heldBy("shape.member", by.get("shape.body")!.id).map((m) => m.text), lineOf(by.get("shape.decl")!));
    // an ANONYMOUS type literal on a property (`novelty?: { minSurface?: number; … }`) is
    // still a domain — and its defaults table lives elsewhere, untyped, free to drift. Name
    // it `<Owner>.<prop>` so the report says where it is (`@nested.owner` captures the
    // owning interface's name; a type-alias literal owns nothing, as before).
    } else if (by.has("nested.body")) {
      const decl = by.get("nested.decl")!;
      const owner = nestedOwner.get(decl.id) ?? "";
      push(`${owner ? owner + "." : ""}${by.get("nested.name")!.text}`, "shape", heldBy("shape.member", by.get("nested.body")!.id).map((m) => m.text), lineOf(decl));
    // const T: Record<…> = { … } / [ "a", "b" ] / new Set([…]) — tables and lists. The
    // initializer is unwrapped through the captured `@peel.*` layers (as / satisfies /
    // parens collect the type link; a single-argument `new` unwraps once, then peels only
    // as/parens, linklessly — the retired walk's exact two-phase shape).
    } else if (by.has("var.decl") && by.has("var.init")) {
      const decl = by.get("var.decl")!;
      let link = typeLinkOf((heldBy("var.type", decl.id).filter(nonSkip))[0]);
      let init = by.get("var.init")!;
      for (;;) {
        const p = peels.get(init.id);
        if (!p || p.cls === "new") break;
        const items = p.items.filter(nonSkip);
        if (p.cls !== "paren" && !link)
          // one non-comment child means `as const` — the only `as` the grammar gives no
          // named type node (measured; journal d-…): the retired children-scan for the
          // `const` token becomes a count.
          link = items[1] ? typeLinkOf(items[1]) : items.length === 1 ? "const" : null;
        if (!items[0]) break;
        init = items[0];
      }
      const pn = peels.get(init.id);
      if (pn?.cls === "new") {
        const args = pn.items.filter(nonSkip);
        if (args.length === 1) {
          let a = args[0];
          for (;;) {
            const q = peels.get(a.id);
            if (!q || (q.cls !== "as" && q.cls !== "paren")) break;
            const inner = q.items.filter(nonSkip)[0];
            if (!inner) break;
            a = inner;
          }
          init = a;
        }
      }
      if (tableBodies.has(init.id)) {
        const keys = [
          ...heldBy("table.key", init.id).map((k) => k.text),
          ...heldBy("table.key.lit", init.id).flatMap((k) => {
            if (!noInterp(k)) return [];        // an interpolated key is not a token
            const v = cookStr(k);
            return v ? [v] : [];                // an empty key names nothing
          }),
        ];
        push(by.get("var.name")!.text, "table", keys, lineOf(decl), link);
      } else if (listBodies.has(init.id)) {
        // EVERY element must be a plain string literal, or no site: items are the
        // query-accepted strings, alts every non-comment element — equal counts or silence.
        const items = heldBy("list.item", init.id);
        const alts = heldBy("list.alt", init.id).filter(nonSkip);
        if (alts.length && items.length === alts.length)
          push(by.get("var.name")!.text, "list", items.map(cookStr), lineOf(decl), link);
      }
    // switch (x) { case "a": … } / match x: / case "lit": — a dispatch written as case
    // analysis. A python union pattern (`case "a" | "b":`) counts only when every branch
    // is a string; guards, captures and comma patterns never captured, so they yield
    // nothing, as before.
    } else if (by.has("switch.body")) {
      const decl = by.get("switch.decl")!;
      const bodyId = by.get("switch.body")!.id;
      const subject = heldBy("switch.subject", decl.id).filter(nonSkip).sort(byStart)[0];
      const keys = heldBy("switch.label", bodyId).filter(noInterp).map(cookStr);
      for (const u of heldBy("switch.union", bodyId)) {
        const ul = heldBy("switch.ulabel", u.id);
        if (heldBy("switch.ualt", u.id).filter(nonSkip).length === ul.length)
          for (const l of ul) keys.push(cookStr(l));
      }
      push((subject?.text ?? "").slice(0, 40), "switch", keys, lineOf(decl));
    // x === "lit" — a dispatch chain is a domain spelled as control flow (operand grade:
    // every captured comparison is a chain entry)
    } else if (by.has("cmp")) {
      const n = by.get("cmp")!;
      const text = by.get("cmp.expr")!.text.slice(0, 40);
      const key = `${scopeKeyOf(n)}::${text}`;
      const e = compares.get(key) ?? { keys: [], line: lineOf(n), text };
      e.keys.push(cookStr(by.get("cmp.lit")!));
      compares.set(key, e);
    // if/elif x == "lit" — condition grade: at most ONE comparison per clause counts, the
    // first name-first candidate if any (else the first lit-first one) — the retired
    // scanner's CMP_A-over-CMP_B priority, read off capture positions.
    } else if (by.has("cmp.cond")) {
      const clause = by.get("cmp.clause")!;
      const cond = by.get("cmp.cond")!;
      const inCond = cands.filter((c) => within(c.node, cond));
      const nameFirst = inCond.filter((c) => c.expr.startIndex < c.lit.startIndex).sort((x, y) => x.expr.startIndex - y.expr.startIndex);
      const litFirst = inCond.filter((c) => c.lit.startIndex < c.expr.startIndex).sort((x, y) => x.lit.startIndex - y.lit.startIndex);
      const pick = nameFirst[0] ?? litFirst[0];
      if (!pick) continue;
      const expr = pick.expr.startIndex < pick.lit.startIndex ? tailRun(pick.expr.text) : leadRun(pick.expr.text);
      const lit = quotedSpan(pick.lit.text);
      // the retired guard was a truthiness test, so a clause whose WINNING literal reads
      // empty (`char == '"'` — the quoted-span artifact) contributed nothing; keep that.
      if (!expr || !lit) continue;
      const key = `${scopeKeyOf(clause)}::${expr}`;
      const e = compares.get(key) ?? { keys: [], line: lineOf(clause), text: expr.slice(0, 40) };
      e.keys.push(lit);
      compares.set(key, e);
    // bracketed alternations inside string / regex literals (templates only when they
    // hold no substitution — a `${…}` means the text is not an enumeration)
    } else if (by.has("lit.text")) {
      const n = by.get("lit.text")!;
      if (litSubs.some((s) => within(s, n))) continue;
      for (const parts of alternationsIn(cookStr(n))) push(`alternation@${lineOf(n)}`, "alternation", parts, lineOf(n));
    } else if (by.has("lit.raw")) {
      const n = by.get("lit.raw")!;
      for (const parts of alternationsIn(n.text)) push(`alternation@${lineOf(n)}`, "alternation", parts, lineOf(n));
    }
  }
  for (const e of compares.values()) push(e.text, "compare", e.keys, e.line);
  return sites;
  });
}

/** Pure (grammar only) — every domain site in one TypeScript/JavaScript source. */
export function sitesOfSource(src: string, file = "x.ts"): DomainSite[] {
  return grammarSites("typescript", src, file);
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

// ── python sites ──────────────────────────────────────────────────────────────────────

/** Pure (grammar grade) — domain sites in one python source, through the same
 *  capture-class engine as every other language. Only the forms the query names become
 *  sites; everything else is deliberately silence (see header). The retired scan's
 *  acceptances survive in the pack, not in code: the Enum base-list regex is the
 *  `@enum.bases` #match? predicate, "plain string literal" is the bare-quote #match? on
 *  `@list.item`, and the CMP_A/CMP_B comparison patterns are the anchored
 *  `@cmp.cand` shapes (their spelling artifacts kept by the `condition` strategy). */
export function sitesOfPython(src: string, file = "x.py"): DomainSite[] {
  return grammarSites("python", src, file);
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
      // isPyTestPath is IMPORTED from there, not respelled — same file set, one spelling.
      if (isTestPath(rel) || isPyTestPath(rel) || GENERATED.has(e.name)) continue;
      const src = await readFile(p, "utf8").catch(() => null);
      if (src === null) continue;
      if (CODE_RE.test(e.name)) out.push(...sitesOfSource(src, rel));
      else if (e.name.endsWith(".py")) out.push(...sitesOfPython(src, rel));
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
  return `${m[1]}#${createHash("sha256").update(s.keys.join("\u0000")).digest("hex").slice(0, 6)}`;
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
