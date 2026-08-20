// static-oracles.ts — the zero-execution existence floor for named Vitest oracles.
//
// A renamed test is a source-name failure, not a test-outcome failure. `verify --fast`
// can therefore reject a name that no current conventional test declaration owns without
// starting Vitest. A complete current scan proves absolute absence; independently, a
// concrete owner on a test path changed from Git HEAD proves that this edit removed the
// owner even when unrelated dynamic registration keeps global absence unknown. This
// module deliberately proves only EXISTENCE: a found name remains skipped in the fast
// tier, because source text is not evidence that the test passed.
//
// The floor is conservative. Literal declarations produce Vitest-style full names;
// dynamic titles, parameterized declarations, damaged parses, unreadable files, and
// unsupported Vitest modifier forms make absence UNKNOWN rather than red. Positive
// evidence still wins over incompleteness: a literal matching declaration exists even
// when another declaration in the project is dynamic. This is deliberately a
// direct-declaration grade, not a claim to execute or solve arbitrary registration code;
// projects whose runtime registry is assembled beyond that grade can disable the floor.
import { lstat, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { Query, type Node } from "web-tree-sitter";
import { grammarHandle, withTree } from "./adapters/tree-sitter.ts";
import { cookedStringText, ORACLE_LANGUAGES } from "./oracle-domain.ts";
import { matchesVitestOracleName } from "./test-batch.ts";
import type { Config } from "./types.ts";

export interface StaticOracleIndex {
  /** Literal runner-style names: `[...describeTitles, testTitle].join(" ")`. */
  fullNames: string[];
  /** Concrete owners in tracked conventional test paths changed from Git HEAD, carrying
   *  enough current-path state to distinguish deletion/complete loss from an uncertain
   *  dynamic rewrite in the same file. */
  priorOwners?: Array<{
    file: string;
    fullName: string;
    current: "complete" | "incomplete" | "deleted";
  }>;
  /** Reasons this scan cannot prove global absence. Empty means absence is decidable. */
  incomplete: string[];
  files: number;
}

export type StaticOracleResolution =
  | { state: "found"; matches: string[] }
  | { state: "absent"; priorMatches?: Array<{ file: string; fullName: string }> }
  | { state: "unknown"; detail: string };

interface StaticQueryHandle {
  parser: Awaited<ReturnType<typeof grammarHandle>>["parser"];
  query: Query;
}

// Query objects own wasm-side allocations just as Trees do. Trees are bounded by
// `withTree`; the one immutable query is deliberately cached for process lifetime, the
// same ownership model oracle-domain.ts uses for its query bundle. A verify loop therefore
// does not allocate one immortal Query per run.
let staticQueryHandle: Promise<StaticQueryHandle> | null = null;
function queryHandle(): Promise<StaticQueryHandle> {
  if (!staticQueryHandle) staticQueryHandle = (async () => {
    const row = ORACLE_LANGUAGES.typescript;
    if (!row.staticNameQuery) throw new Error("the TypeScript language pack has no static Vitest name query");
    const handle = await grammarHandle(row.grammar);
    return { parser: handle.parser, query: new Query(handle.language, row.staticNameQuery) };
  })();
  return staticQueryHandle;
}

/** Resolve one claim through the exact matcher batch reports use. Current ownership wins;
 *  loss of a concrete tracked HEAD owner is claim-local absence; only a name with neither
 *  form of evidence yields to the current scan's global incompleteness. */
export function resolveStaticOracle(index: StaticOracleIndex, name: string): StaticOracleResolution {
  const matches = index.fullNames.filter((fullName) => matchesVitestOracleName(fullName, name));
  if (matches.length) return { state: "found", matches };
  const priorMatches = (index.priorOwners ?? [])
    .filter((owner) => owner.current !== "incomplete"
      && matchesVitestOracleName(owner.fullName, name));
  if (priorMatches.length) return {
    state: "absent",
    priorMatches: priorMatches.map(({ file, fullName }) => ({ file, fullName })),
  };
  if (index.incomplete.length) {
    const shown = index.incomplete.slice(0, 3);
    const more = index.incomplete.length - shown.length;
    return {
      state: "unknown",
      detail: `${shown.join("; ")}${more ? `; +${more} more incomplete source site(s)` : ""}`,
    };
  }
  return { state: "absent" };
}

const TEST_ROOTS = new Set(["it", "test"]);
const SUITE_ROOTS = new Set(["describe", "suite"]);
const STATIC_TEST_MODIFIERS = new Set([
  "skip", "only", "concurrent", "sequential", "fails", "todo", "skipIf", "runIf",
]);
const STATIC_SUITE_MODIFIERS = new Set([
  "skip", "only", "concurrent", "sequential", "shuffle", "skipIf", "runIf",
]);
const DYNAMIC_MODIFIERS = new Set(["each", "for"]);
const VITEST_CONFIG_PATH = /(^|\/)(?:vite\.config|vitest\.(?:config|workspace))\.[mc]?[jt]s$/;
const VITEST_DEFAULT_EXCLUDED_DIRS = new Set(["node_modules", ".git"]);

const nonComment = (n: Node): Node[] =>
  n.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");

function descendants(node: Node, type: string, out: Node[] = []): Node[] {
  if (node.type === type) out.push(node);
  for (const child of node.namedChildren) if (child) descendants(child, type, out);
  return out;
}

/** Flatten a direct/member/wrapper callee. `it.skipIf(flag)(...)` becomes
 *  `{ segments: ["it", "skipIf"], invoked: true }`; the invocation bit lets us refuse
 *  unknown function-producing wrappers rather than mistaking them for modifiers. */
function calleeShape(node: Node): { segments: string[]; invoked: boolean } | null {
  if (node.type === "identifier" || node.type === "property_identifier")
    return { segments: [node.text], invoked: false };
  if (node.type === "member_expression") {
    const object = node.childForFieldName("object");
    const property = node.childForFieldName("property");
    if (!object || !property) return null;
    const left = calleeShape(object);
    if (!left) return null;
    return { segments: [...left.segments, property.text], invoked: left.invoked };
  }
  if (node.type === "call_expression") {
    const fn = node.childForFieldName("function");
    const inner = fn ? calleeShape(fn) : null;
    return inner ? { segments: inner.segments, invoked: true } : null;
  }
  if (node.type === "parenthesized_expression") {
    const child = nonComment(node)[0];
    return child ? calleeShape(child) : null;
  }
  return null;
}

function sameNode(a: Node | null, b: Node): boolean {
  return !!a && a.type === b.type && a.startIndex === b.startIndex && a.endIndex === b.endIndex;
}

function isCalleeBuilder(call: Node): boolean {
  const parent = call.parent;
  return !!parent && parent.type === "call_expression"
    && sameNode(parent.childForFieldName("function"), call);
}

type SemanticRoot = "test" | "suite";
interface Bindings {
  aliases: Map<string, SemanticRoot>;
  namespaces: Set<string>;
  foreignNamespaces: Set<string>;
  importedValues: Set<string>;
  blocked: Set<string>;
  incomplete: string[];
}

function semanticOf(name: string): SemanticRoot | null {
  if (TEST_ROOTS.has(name)) return "test";
  if (SUITE_ROOTS.has(name)) return "suite";
  return null;
}

type AliasTarget = { kind: "semantic"; semantic: SemanticRoot } | { kind: "namespace" };

/** Resolve only assignment shapes whose Vitest meaning is exact. Anything richer stays
 *  incomplete below: executing an initializer to discover an alias would defeat the
 *  static floor's trust boundary. */
function simpleAliasTarget(
  value: Node | null,
  aliases: Map<string, SemanticRoot>,
  namespaces: Set<string>,
  blocked: Set<string>,
): AliasTarget | null {
  if (!value) return null;
  if (value.type === "identifier") {
    if (blocked.has(value.text)) return null;
    const semantic = aliases.get(value.text) ?? semanticOf(value.text);
    if (semantic) return { kind: "semantic", semantic };
    if (namespaces.has(value.text)) return { kind: "namespace" };
    return null;
  }
  if (value.type === "member_expression") {
    const object = value.childForFieldName("object");
    const property = value.childForFieldName("property");
    if (object?.type === "identifier" && property && namespaces.has(object.text)) {
      const semantic = semanticOf(property.text);
      if (semantic) return { kind: "semantic", semantic };
    }
  }
  return null;
}

function referencesKnownDsl(
  value: Node | null,
  aliases: Map<string, SemanticRoot>,
  namespaces: Set<string>,
  foreignNamespaces: Set<string>,
  blocked: Set<string>,
): boolean {
  if (!value) return false;
  const ids = value.type === "identifier"
    ? [value.text]
    : descendants(value, "identifier").map((node) => node.text);
  return ids.some((name) => aliases.has(name) || namespaces.has(name)
    || foreignNamespaces.has(name) || (!blocked.has(name) && semanticOf(name) !== null));
}

function importedBindings(
  file: string,
  imports: Array<{ node: Node; source: Node }>,
  locals: Array<{ node: Node; name: Node }>,
  parameters: Node[],
): Bindings {
  const aliases = new Map<string, SemanticRoot>();
  const namespaces = new Set<string>();
  const foreignNamespaces = new Set<string>();
  const importedValues = new Set<string>();
  const blocked = new Set<string>();
  const incomplete: string[] = [];
  for (const { node, source } of imports) {
    const moduleName = cookedStringText(source);
    const vitest = moduleName === "vitest";
    // A default import named `test` from node:test (common in this repository) shadows
    // the Vitest global just as surely as a named import does. It must never manufacture
    // positive Vitest evidence from a different runner's declaration.
    const clause = node.namedChildren.find((n) => n?.type === "import_clause");
    if (!vitest && !clause)
      incomplete.push(lineDetail(file, node,
        `side-effect import ${JSON.stringify(moduleName ?? "unknown")} executes during test registration and may declare tests`));
    const defaultImport = clause?.namedChildren.find((n) => n?.type === "identifier")?.text;
    if (!vitest && defaultImport) importedValues.add(defaultImport);
    if (defaultImport && semanticOf(defaultImport)) {
      if (vitest) aliases.set(defaultImport, semanticOf(defaultImport) as SemanticRoot);
      else {
        blocked.add(defaultImport);
        incomplete.push(lineDetail(file, node,
          `${JSON.stringify(defaultImport)} is supplied by non-Vitest import ${JSON.stringify(moduleName ?? "unknown")}; its runtime DSL provenance is unknown`));
      }
    }
    for (const specifier of descendants(node, "import_specifier")) {
      const imported = specifier.childForFieldName("name")?.text ?? "";
      const local = specifier.childForFieldName("alias")?.text ?? imported;
      const semantic = semanticOf(imported);
      if (!vitest && local) importedValues.add(local);
      if (!semantic || !local) continue;
      if (vitest) aliases.set(local, semantic);
      else {
        blocked.add(local);
        incomplete.push(lineDetail(file, specifier,
          `${JSON.stringify(local)} is supplied by non-Vitest import ${JSON.stringify(moduleName ?? "unknown")}; it may be a fixture-extended Vitest DSL`));
      }
    }
    for (const ns of descendants(node, "namespace_import")) {
      const local = nonComment(ns).find((n) => n.type === "identifier")?.text;
      if (vitest && local) namespaces.add(local);
      else if (local) {
        foreignNamespaces.add(local);
        importedValues.add(local);
      }
    }
  }
  // A local declaration shadows a Vitest global. Counting `const test = helper` as a
  // Vitest declaration would be a false positive; following `const check = test.extend`
  // would require scope-aware alias evaluation. Both forms are therefore blocked and
  // make zero-match absence unknown for this first, precision-first grade.
  for (const { node, name } of [...locals].sort((a, b) => a.node.startIndex - b.node.startIndex)) {
    const names = descendants(name, "identifier").map((n) => n.text);
    if (name.type === "identifier") names.push(name.text);
    const value = node.childForFieldName("value");
    let shadowed = false;
    for (const local of new Set(names)) {
      if (semanticOf(local)) {
        blocked.add(local);
        aliases.delete(local);
        namespaces.delete(local);
        foreignNamespaces.delete(local);
        shadowed = true;
        incomplete.push(lineDetail(file, node, `local declaration shadows Vitest global ${JSON.stringify(local)}`));
      } else if (aliases.has(local) || namespaces.has(local) || foreignNamespaces.has(local)) {
        blocked.add(local);
        aliases.delete(local);
        namespaces.delete(local);
        foreignNamespaces.delete(local);
        shadowed = true;
        incomplete.push(lineDetail(file, node, `local declaration shadows known Vitest binding ${JSON.stringify(local)}`));
      }
    }
    const local = name.type === "identifier" ? name.text : null;
    const target = !shadowed && local ? simpleAliasTarget(value, aliases, namespaces, blocked) : null;
    if (local && target?.kind === "semantic") aliases.set(local, target.semantic);
    else if (local && target?.kind === "namespace") namespaces.add(local);
    else if (referencesKnownDsl(value, aliases, namespaces, foreignNamespaces, blocked))
      incomplete.push(lineDetail(file, node, "local alias/extension of the Vitest DSL is unsupported"));
  }
  for (const parameter of parameters) {
    const names = parameter.type === "identifier"
      ? [parameter.text]
      : descendants(parameter, "identifier").map((n) => n.text);
    for (const name of new Set(names)) {
      if (!semanticOf(name) && !aliases.has(name) && !namespaces.has(name) && !foreignNamespaces.has(name)) continue;
      blocked.add(name);
      aliases.delete(name);
      namespaces.delete(name);
      foreignNamespaces.delete(name);
      incomplete.push(lineDetail(file, parameter, `parameter shadows Vitest binding ${JSON.stringify(name)}`));
    }
  }
  return { aliases, namespaces, foreignNamespaces, importedValues, blocked, incomplete };
}

function declarationOf(fn: Node, bindings: Bindings):
  { semantic: SemanticRoot; modifiers: string[]; invoked: boolean } | null {
  const shape = calleeShape(fn);
  if (!shape || !shape.segments.length) return null;
  let semantic: SemanticRoot | null = null;
  let offset = 1;
  const first = shape.segments[0];
  if (!bindings.blocked.has(first)) semantic = bindings.aliases.get(first) ?? semanticOf(first);
  if (!semantic && bindings.namespaces.has(first) && shape.segments.length > 1) {
    semantic = semanticOf(shape.segments[1]);
    offset = 2;
  }
  return semantic ? { semantic, modifiers: shape.segments.slice(offset), invoked: shape.invoked } : null;
}

function foreignNamespaceDsl(fn: Node, bindings: Bindings): boolean {
  const shape = calleeShape(fn);
  return !!shape && shape.segments.length > 1
    && bindings.foreignNamespaces.has(shape.segments[0])
    && semanticOf(shape.segments[1]) !== null;
}

interface SuiteSite { title: string | null; start: number; end: number }
interface TestSite { title: string; start: number; call: Node }
interface Span { start: number; end: number }

function lineDetail(file: string, node: Node, why: string): string {
  return `${file}:${node.startPosition.row + 1} ${why}`;
}

const FUNCTION_NODES = new Set([
  "arrow_function", "function_expression", "function_declaration",
  "generator_function", "generator_function_declaration", "method_definition",
]);
function functionAncestors(node: Node): Node[] {
  const out: Node[] = [];
  for (let parent = node.parent; parent; parent = parent.parent)
    if (FUNCTION_NODES.has(parent.type)) out.push(parent);
  return out;
}

function spanContains(span: Span, index: number): boolean {
  return span.start <= index && index < span.end;
}

/** cookedStringText intentionally carries the meta-oracle's historical decoder grade.
 *  The static floor needs a stricter posture: if that decoder cannot exactly mirror a
 *  JavaScript escape, do not index the wrong runtime name and later false-red the right
 *  one. Basic single-character escapes are exact; hex/unicode/legacy forms stay unknown. */
function staticLiteralTitle(node: Node | undefined): { value: string | null; escapeUnknown: boolean } {
  if (!node || node.type !== "string") return { value: null, escapeUnknown: false };
  const escapes = descendants(node, "escape_sequence");
  const escapeUnknown = escapes.some((escape) => !/^\\(?:[ntrbfv0'"\\/])$/.test(escape.text));
  return { value: escapeUnknown ? null : cookedStringText(node), escapeUnknown };
}

function scanSource(
  file: string,
  calls: Array<{ call: Node; fn: Node; args: Node }>,
  imports: Array<{ node: Node; source: Node }>,
  locals: Array<{ node: Node; name: Node }>,
  parameters: Node[],
):
  { fullNames: string[]; incomplete: string[] } {
  const bindings = importedBindings(file, imports, locals, parameters);
  const suites: SuiteSite[] = [];
  const tests: TestSite[] = [];
  const testCallbacks: Span[] = [];
  const recognizedCalls = new Set<string>();
  const incomplete: string[] = [...bindings.incomplete];

  for (const { call, fn, args } of calls) {
    if (isCalleeBuilder(call)) continue; // inner half of skipIf/each/etc., not a declaration
    if (foreignNamespaceDsl(fn, bindings)) {
      incomplete.push(lineDetail(file, call,
        "namespace-imported test DSL may be fixture-extended; its Vitest provenance is unknown"));
      continue;
    }
    const declaration = declarationOf(fn, bindings);
    if (!declaration) continue;
    recognizedCalls.add(`${call.startIndex}:${call.endIndex}`);
    const modifiers = declaration.modifiers;
    const allowed = declaration.semantic === "test" ? STATIC_TEST_MODIFIERS : STATIC_SUITE_MODIFIERS;
    const dynamic = modifiers.some((m) => DYNAMIC_MODIFIERS.has(m));
    const unsupported = modifiers.some((m) => !allowed.has(m) && !DYNAMIC_MODIFIERS.has(m));
    // A function-producing call is supported only for the wrappers whose returned
    // function preserves the literal title. `each`/`for` are deliberately dynamic.
    const wrapper = declaration.invoked ? modifiers.at(-1) : undefined;
    const unsupportedWrapper = declaration.invoked
      && wrapper !== "skipIf" && wrapper !== "runIf" && wrapper !== "each" && wrapper !== "for";
    const argv = nonComment(args);
    const titleNode = argv[0];
    const title = staticLiteralTitle(titleNode);
    const literal = title.value;

    if (declaration.semantic === "test") {
      const callback = argv[1];
      if (callback?.type === "arrow_function" || callback?.type === "function_expression")
        testCallbacks.push({ start: callback.startIndex, end: callback.endIndex });
    }

    if (dynamic || unsupported || unsupportedWrapper || literal === null) {
      const why = dynamic ? "parameterized Vitest title is dynamic"
        : unsupported || unsupportedWrapper ? `unsupported Vitest declaration form ${JSON.stringify(call.text.slice(0, 80))}`
        : title.escapeUnknown ? "Vitest title uses an escape this static grade cannot decode exactly"
        : "Vitest title is not a string literal";
      incomplete.push(lineDetail(file, call, why));
    }

    if (declaration.semantic === "suite") {
      const callback = argv[1];
      const callbackIsStatic = callback?.type === "arrow_function" || callback?.type === "function_expression";
      if (!callbackIsStatic) {
        incomplete.push(lineDetail(file, call, "suite body is not an inline function"));
        continue;
      }
      suites.push({
        title: dynamic || unsupported || unsupportedWrapper || literal === null ? null : literal,
        start: callback.startIndex,
        end: callback.endIndex,
      });
      continue;
    }
    if (!dynamic && !unsupported && !unsupportedWrapper && literal !== null)
      tests.push({ title: literal, start: call.startIndex, call });
  }

  // An imported function invoked while the file/suite is REGISTERING may itself declare
  // tests. Its names are outside this file and its suite prefix depends on the call site,
  // so zero local matches cannot prove absence. Calls inside an actual test callback are
  // ordinary subject execution and deliberately do not poison the population.
  const suiteCallbackKeys = new Set(suites.map((suite) => `${suite.start}:${suite.end}`));
  for (const { call, fn } of calls) {
    if (recognizedCalls.has(`${call.startIndex}:${call.endIndex}`) || isCalleeBuilder(call)) continue;
    const shape = calleeShape(fn);
    const registrationLoad = fn.type === "import" || shape?.segments[0] === "require";
    const importedRegistrar = !!shape && bindings.importedValues.has(shape.segments[0]);
    if (!registrationLoad && !importedRegistrar) continue;
    if (testCallbacks.some((callback) => spanContains(callback, call.startIndex))) continue;
    const ancestors = functionAncestors(call);
    if (ancestors.length && !ancestors.every((ancestor) =>
      suiteCallbackKeys.has(`${ancestor.startIndex}:${ancestor.endIndex}`))) continue;
    incomplete.push(lineDetail(file, call,
      `${registrationLoad ? "module load" : "imported call"} ${JSON.stringify(call.text.slice(0, 80))} executes during test registration and may declare runtime-owned tests`));
  }

  const fullNames: string[] = [];
  for (const test of tests) {
    const runtimeHelper = functionAncestors(test.call)
      .find((fn) => !suiteCallbackKeys.has(`${fn.startIndex}:${fn.endIndex}`));
    if (runtimeHelper) {
      incomplete.push(lineDetail(file, test.call,
        `test ${JSON.stringify(test.title)} is declared inside a runtime helper; its suite ancestry depends on where that helper executes`));
      continue;
    }
    const parents = suites
      .filter((suite) => suite.start <= test.start && test.start < suite.end)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    if (parents.some((suite) => suite.title === null)) {
      incomplete.push(`${file} dynamic/unsupported suite ancestry obscures test ${JSON.stringify(test.title)}`);
      continue;
    }
    fullNames.push([...parents.map((suite) => suite.title as string), test.title].join(" "));
  }
  return { fullNames, incomplete };
}

interface ScannedStaticSource {
  fullNames: string[];
  incomplete: string[];
  parseError: boolean;
}

function scanSourceText(
  parser: StaticQueryHandle["parser"],
  query: Query,
  file: string,
  source: string,
): ScannedStaticSource | null {
  return withTree(parser, source, null as ScannedStaticSource | null, (tree) => {
    const calls = new Map<string, { call: Node; fn: Node; args: Node }>();
    const imports = new Map<string, { node: Node; source: Node }>();
    const locals = new Map<string, { node: Node; name: Node }>();
    const parameters = new Map<string, Node>();
    for (const match of query.matches(tree.rootNode)) {
      const capture = (name: string) => match.captures.find((c) => c.name === name)?.node;
      const call = capture("static.call"), fn = capture("static.fn"), args = capture("static.args");
      if (call && fn && args) calls.set(`${call.startIndex}:${call.endIndex}`, { call, fn, args });
      const node = capture("static.import"), sourceNode = capture("static.import-source");
      if (node && sourceNode) imports.set(`${node.startIndex}:${node.endIndex}`, { node, source: sourceNode });
      const binding = capture("static.binding"), bindingName = capture("static.binding-name");
      if (binding && bindingName) locals.set(`${binding.startIndex}:${binding.endIndex}`, { node: binding, name: bindingName });
      const parameter = capture("static.parameter");
      if (parameter) parameters.set(`${parameter.startIndex}:${parameter.endIndex}`, parameter);
    }
    const result = scanSource(file, [...calls.values()], [...imports.values()], [...locals.values()], [...parameters.values()]);
    const parseError = tree.rootNode.hasError;
    if (parseError) result.incomplete.push(`${file} contains a TypeScript/JavaScript parse error`);
    return { ...result, parseError };
  });
}

function gitText(cwd: string, args: string[]): string | null {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && typeof result.stdout === "string" ? result.stdout : null;
}

/** Read concrete owners from tracked conventional test paths changed from HEAD.
 *  No Git repository or no commit means no transition evidence, not an incomplete scan.
 *  A config root may be a subdirectory of the worktree; the pathspec and returned names
 *  are translated through the Git top level before source is parsed. */
function headConcreteOwners(
  cfg: Config,
  parser: StaticQueryHandle["parser"],
  query: Query,
): Array<{ file: string; fullName: string }> {
  const gitRoot = gitText(cfg.root, ["rev-parse", "--show-toplevel"])?.trim();
  const shownPrefix = gitText(cfg.root, ["rev-parse", "--show-prefix"])?.trim();
  if (!gitRoot || shownPrefix === undefined) return [];
  const rootPrefix = shownPrefix.replace(/\/$/, "");
  const scoped = rootPrefix ? ["--", rootPrefix] : [];
  const changedText = gitText(gitRoot, ["diff", "--name-only", "--no-renames", "-z", "HEAD", ...scoped]);
  if (changedText === null) return []; // unborn HEAD or unreadable repository
  const changed = new Set(changedText.split("\0").filter(Boolean));
  if (!changed.size) return [];
  const tree = gitText(gitRoot, ["ls-tree", "-r", "-z", "HEAD", ...scoped]);
  if (tree === null) return [];
  const row = ORACLE_LANGUAGES.typescript;
  const owners: Array<{ file: string; fullName: string }> = [];
  for (const record of tree.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type] = record.slice(0, tab).split(" ");
    const repoPath = record.slice(tab + 1);
    if (!changed.has(repoPath) || type !== "blob" || !mode.startsWith("100")) continue;
    const file = rootPrefix
      ? repoPath.startsWith(`${rootPrefix}/`) ? repoPath.slice(rootPrefix.length + 1) : null
      : repoPath;
    if (!file || !row.testFilePattern.test(file)
      || file.split("/").some((segment) => VITEST_DEFAULT_EXCLUDED_DIRS.has(segment))) continue;
    const source = gitText(gitRoot, ["show", `HEAD:${repoPath}`]);
    if (source === null) continue;
    const scanned = scanSourceText(parser, query, file, source);
    if (!scanned || scanned.parseError) continue;
    owners.push(...scanned.fullNames.map((fullName) => ({ file, fullName })));
  }
  return [...new Map(owners.map((owner) => [`${owner.file}\0${owner.fullName}`, owner])).values()]
    .sort((a, b) => a.file.localeCompare(b.file) || a.fullName.localeCompare(b.fullName));
}

async function filesystemTestPaths(cfg: Config): Promise<{ paths: string[]; incomplete: string[] }> {
  const paths: string[] = [];
  const incomplete: string[] = [];
  const row = ORACLE_LANGUAGES.typescript;
  // Vitest v4's default collection excludes node_modules and .git, not arbitrary build
  // directories or cfg.ignore (which shapes the spec graph, not the test runner). Walk dot
  // directories too. tinyglobby's default dot posture is narrower, but over-collecting a
  // literal declaration can only keep a fast claim skipped; omitting one can false-red it,
  // and an explicit custom include may collect dot paths. Visible custom collection config
  // is detected below and makes absence UNKNOWN.
  async function visit(dir: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) {
      incomplete.push(`${relative(cfg.root, dir) || "."} cannot be listed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    for (const entry of entries) {
      if (VITEST_DEFAULT_EXCLUDED_DIRS.has(entry.name)) continue;
      const absolute = join(dir, entry.name);
      const path = relative(cfg.root, absolute);
      // Following either kind of symlink can escape cfg.root or cycle. Until traversal
      // owns realpath containment and cycle detection, preserve the possible collection
      // as UNKNOWN and never read through the link.
      if (entry.isSymbolicLink()) {
        incomplete.push(`${path} is a symlink; Vitest may collect through it but the static oracle scan does not follow it`);
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (row.testFilePattern.test(entry.name) || VITEST_CONFIG_PATH.test(path))
        paths.push(path);
    }
  }
  await visit(cfg.root);
  return { paths, incomplete };
}

/** Build the ephemeral oracle-name node from the current TS/JS test-source tree. Vitest
 *  does not treat .gitignore as a collection rule, so neither may this floor: the current
 *  filesystem under Vitest v4's default node_modules/.git exclusions is the population. Adding a
 *  claim and test is coherent before staging, a rename reds immediately, and a present
 *  gitignored test still owns its runtime name. Read/traversal failures make the result
 *  incomplete. */
export async function indexStaticVitestOracles(cfg: Config): Promise<StaticOracleIndex> {
  const row = ORACLE_LANGUAGES.typescript;
  const discovered = await filesystemTestPaths(cfg);
  const paths = discovered.paths.filter((path) =>
    row.testFilePattern.test(path)
    && !path.split("/").some((segment) => VITEST_DEFAULT_EXCLUDED_DIRS.has(segment)));

  let parser: StaticQueryHandle["parser"];
  let query: Query;
  try {
    ({ parser, query } = await queryHandle());
  } catch (error) {
    return {
      fullNames: [], files: paths.length,
      incomplete: [`cannot initialize the static Vitest parser: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const fullNames: string[] = [];
  const incomplete: string[] = [...discovered.incomplete];
  // V1's complete population contract is Vitest's conventional *.test/spec names under
  // its default root and exclusions. Recognizable custom collection or root/workspace
  // config changes that population, and executing config to learn arbitrary imported or
  // dynamic values would violate this command's zero-execution promise.
  // Keep the result UNKNOWN instead. Likewise, zero conventional candidates cannot prove
  // there are zero tests: it is exactly the shape of a custom-named-only project.
  if (!paths.length)
    incomplete.push("no conventional *.test/spec TS/JS files were found; a custom Vitest include cannot be ruled out");
  for (const file of discovered.paths.filter((path) => VITEST_CONFIG_PATH.test(path))) {
    try {
      const source = await readFile(join(cfg.root, file), "utf8");
      const collectionKey = source.match(/\b(includeSource|include|exclude|root|projects|workspace)\s*(?::|=)/)?.[1];
      if (collectionKey)
        incomplete.push(`${file} declares custom Vitest collection/root config (${collectionKey}); static test ownership is not complete`);
      else if (/(^|\/)vitest\.workspace\.[mc]?[jt]s$/.test(file))
        incomplete.push(`${file} is a Vitest workspace config; static traversal cannot prove all project roots remain under the declared root`);
    } catch (error) {
      incomplete.push(`${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let files = 0;
  const currentFileState = new Map<string, "complete" | "incomplete">();
  for (const file of paths.sort()) {
    let source: string;
    try { source = await readFile(join(cfg.root, file), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; // disappeared after enumeration
      incomplete.push(`${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
      currentFileState.set(file, "incomplete");
      continue;
    }
    files++;
    const scanned = scanSourceText(parser, query, file, source);
    if (!scanned) {
      incomplete.push(`${file} could not be parsed`);
      currentFileState.set(file, "incomplete");
      continue;
    }
    currentFileState.set(file, scanned.incomplete.length ? "incomplete" : "complete");
    fullNames.push(...scanned.fullNames);
    incomplete.push(...scanned.incomplete);
  }
  const priorOwners = await Promise.all(headConcreteOwners(cfg, parser, query).map(async (owner) => {
    const scanned = currentFileState.get(owner.file);
    if (scanned) return { ...owner, current: scanned } as const;
    try {
      await lstat(join(cfg.root, owner.file));
      return { ...owner, current: "incomplete" } as const;
    } catch (error) {
      return {
        ...owner,
        current: (error as NodeJS.ErrnoException).code === "ENOENT" ? "deleted" : "incomplete",
      } as const;
    }
  }));
  return {
    fullNames: [...new Set(fullNames)].sort(),
    priorOwners,
    incomplete: [...new Set(incomplete)],
    files,
  };
}

/** Convert a static existence reading into the fast-tier claim verdict. */
export function staticFastVerdict(index: StaticOracleIndex, name: string, skippedAs: string):
  { kind: "fail" | "skip"; detail: string } {
  const resolution = resolveStaticOracle(index, name);
  if (resolution.state === "absent") return {
    kind: "fail",
    detail: `test "${name}" — VANISHED ORACLE (static): `
      + (resolution.priorMatches?.length
        ? `tracked Git HEAD concretely owned this name at ${resolution.priorMatches[0].file} as ${JSON.stringify(resolution.priorMatches[0].fullName)}, but the current source no longer does. `
        : "no matching direct declaration was found within the conventional Vitest TS/JS grade. ")
      + `No test was run. If tests are assembled by an unsupported runtime registry, set config.staticOracleExistence to false or use verify --from-report with a fresh report; otherwise repair the stale oracle name.`,
  };
  if (resolution.state === "unknown") return {
    kind: "skip",
    detail: `${skippedAs} — static oracle existence UNKNOWN: ${resolution.detail}`,
  };
  return { kind: "skip", detail: `${skippedAs} — static oracle exists; execution still skipped` };
}
