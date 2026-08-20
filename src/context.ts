// context.ts — the task-addressable READ side of coherence.
//
// `economy` measures how large a historical change's candidate context surface was. This
// module answers the operational question underneath that metric: given the file(s) or
// symbol(s) in front of me, what is the smallest useful packet the graph can name NOW?
//
// The split is deliberate. `contextFor` is a pure projection over a Graph + journal record
// array: callers can inject an exact staged path set, hooks can reuse it, and tests need no
// repository. `contextFromProject` is the thin I/O edge that obtains changed/staged paths
// and the merged journal. Keeping Git out of the projection makes an empty result mean
// "the graph found no context", never "a hidden git command happened to fail".
//
// This is an ADDRESSING instrument, not a proof of sufficient reading. Imports are one hop,
// test relevance is inferred, and journal prose is matched lexically. Those limits travel in
// every result and render; a heuristic that does not name its universe becomes false
// confidence, which is the exact failure this command exists to resist.
import { basename, isAbsolute, relative, resolve as resolvePath } from "node:path";
import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import type { Config, Graph, GraphNode } from "./types.ts";
import { parseBoundary } from "./boundary.ts";
import { parseParity } from "./parity.ts";
import { changedFiles } from "./structural.ts";
import { readJournal, resolve as resolveJournal, type DecisionRecord } from "./decisions.ts";

export type ContextPathScope = "changed" | "staged";

/** Explicit path/symbol selectors. `changedFiles` is injectable so a hook can pass the
 * exact per-change domain it already computed instead of making this module rediscover it. */
export interface ContextRequest {
  files?: readonly string[];
  symbols?: readonly string[];
  changedFiles?: readonly string[];
}

export interface ProjectContextRequest extends ContextRequest {
  /** Add paths read from Git: `changed` = worktree vs HEAD + untracked; `staged` = index. */
  scope?: ContextPathScope;
}

export interface ContextOptions {
  /** Override only the heuristic; useful to projects whose test naming is non-standard. */
  isTestPath?: (path: string) => boolean;
  /** Root-relative files known to exist in the repository even when the source graph does
   * not model them. `contextFromProject` supplies this; pure callers may inject a snapshot. */
  repositoryFiles?: readonly string[];
}

export interface ContextSymbol {
  name: string;
  path: string;
  line?: number;
  kind?: string;
}

export interface ContextComponent {
  name: string;
  dir: string;
  intent: string | null;
  why: string | null;
  invariants: string[];
}

export interface ContextObligation {
  component: string;
  kind: "boundary" | "parity" | "claim";
  claim: string;
  invariant?: string;
  chokepoints: string[];
  oracles: string[];
}

export interface ContextImport {
  from: string;
  to: string;
  external: boolean;
}

export interface ContextTest {
  path: string;
  reason: "selected" | "direct importer" | "direct import" | "same owning component";
}

export interface ContextJournalEntry {
  id: string;
  at: string;
  agent: string;
  chose: string;
  because: string;
  files: string[];
  matchedBy: string[];
}

export interface ContextSurface {
  path: string;
  /** `repository` means the path resolved as a repository surface but has no file node. */
  source: "graph" | "repository";
  /** Null is deliberate: directory proximity is not evidence of graph ownership. */
  graphOwner: string | null;
}

export interface ContextResult {
  selection: {
    files: string[];
    requestedSymbols: ContextSymbol[];
    declaredSymbols: ContextSymbol[];
    surfaces: ContextSurface[];
    unresolvedFiles: string[];
    unresolvedSymbols: string[];
  };
  components: ContextComponent[];
  obligations: ContextObligation[];
  imports: ContextImport[];
  importers: ContextImport[];
  tests: ContextTest[];
  journal: {
    decisions: ContextJournalEntry[];
    blocked: ContextJournalEntry[];
    openConjectures: ContextJournalEntry[];
  };
  limitations: string[];
}

export interface ContextRenderOptions {
  /** UTF-8 byte ceiling for the route-first projection. Omit for the legacy full render. */
  maxBytes?: number;
  /** Force the unbounded legacy render, even when a caller carries a default byte limit. */
  expand?: boolean;
}

export interface ContextWithholding {
  reason: "byte budget" | "same-component test cap" | "bounded entry excerpt";
  items: number;
  bytes: number;
}

export interface ContextRenderProjection {
  text: string;
  mode: "unbounded" | "bounded";
  maxBytes: number | null;
  renderedBytes: number;
  withheldItems: number;
  withheldBytes: number;
  withholding: ContextWithholding[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const unique = (xs: Iterable<string>) => [...new Set(xs)].sort(cmp);
const nodePath = (n: GraphNode) => n.path ?? (n.kind === "file" ? n.id.slice(2) : "");

/** Graph paths are slash-normalized and root-relative. Accepting an absolute path under
 * `absRoot` is a convenience for editor integrations; an absolute path outside the root
 * stays absolute and therefore becomes an explicit unresolved selector. */
export function normalizeContextPath(graph: Graph, raw: string): string {
  let p = raw.trim();
  if (isAbsolute(p)) {
    const rel = relative(resolvePath(graph.absRoot), resolvePath(p));
    if (rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel)) p = rel;
  }
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

/** Default only; the limitation is carried in the result. Excluding `*.spec.md` matters:
 * those are coherence component specs, not test files despite the suffix. */
export function looksLikeTestPath(path: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  if (p.endsWith(".spec.md")) return false;
  return /(^|\/)(__tests__|test|tests)(\/|$)/.test(p) || /\.(test|spec)\.[^/]+$/.test(p);
}

function symbolView(n: GraphNode): ContextSymbol {
  return { name: n.label, path: n.path ?? "", ...(n.line === undefined ? {} : { line: n.line }), ...(n.sub ? { kind: n.sub } : {}) };
}

function symbolCmp(a: ContextSymbol, b: ContextSymbol): number {
  return cmp(a.name, b.name) || cmp(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0);
}

function componentOfFile(file: GraphNode, nodes: Map<string, GraphNode>): GraphNode | undefined {
  const parent = file.parent ? nodes.get(file.parent) : undefined;
  return parent?.kind === "component" ? parent : undefined;
}

function claimReferences(claim: string, symbols: Set<string>, pathTerms: string[]): boolean {
  const b = parseBoundary(claim);
  if (b && symbols.has(b.chokepoint)) return true;
  const p = parseParity(claim);
  if (p && [p.domain, p.f, p.g].some((s) => symbols.has(s))) return true;
  const text = claim.toLowerCase();
  for (const term of pathTerms) if (term.length >= 3 && text.includes(term.toLowerCase())) return true;
  for (const term of symbols) if (referenceInText(text, term)) return true;
  return false;
}

function obligation(component: string, claim: string): ContextObligation {
  const b = parseBoundary(claim);
  if (b) return {
    component, kind: "boundary", claim, invariant: b.inv,
    chokepoints: [b.chokepoint], oracles: b.oracle ? [b.oracle] : [],
  };
  const p = parseParity(claim);
  if (p) return {
    component, kind: "parity", claim, invariant: p.inv,
    chokepoints: [p.f, p.g], oracles: [p.oracle],
  };
  return { component, kind: "claim", claim, chokepoints: [], oracles: [] };
}

function obligationCmp(a: ContextObligation, b: ContextObligation): number {
  return cmp(a.component, b.component) || cmp(a.kind, b.kind) || cmp(a.claim, b.claim);
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** A named structural referent should match as a token, not as a syllable in an unrelated
 * word (`seal` must not match `sealed`). Paths and phrases use literal containment. */
function referenceInText(lowerText: string, raw: string): boolean {
  const term = raw.trim().toLowerCase();
  if (term.length < 3) return false;
  if (/[\s/\\.]/.test(term)) return lowerText.includes(term.replace(/\\/g, "/"));
  return new RegExp(`(^|[^a-z0-9_$])${escapeRe(term)}(?=$|[^a-z0-9_$])`, "i").test(lowerText);
}

function journalEntry(rec: DecisionRecord, selectedFiles: Set<string>, terms: string[], graph: Graph): ContextJournalEntry | null {
  const matches: string[] = [];
  for (const f of rec.files ?? []) {
    const normalized = normalizeContextPath(graph, f);
    if (selectedFiles.has(normalized)) matches.push(`file:${normalized}`);
  }
  const text = [rec.chose, rec.because, ...rec.over, ...(rec.couldBe ?? []), rec.discriminatedBy ?? ""]
    .join("\n").toLowerCase().replace(/\\/g, "/");
  for (const term of terms) if (referenceInText(text, term)) matches.push(`text:${term}`);
  const matchedBy = unique(matches);
  return matchedBy.length ? {
    id: rec.id, at: rec.at, agent: rec.agent, chose: rec.chose, because: rec.because,
    files: unique((rec.files ?? []).map((f) => normalizeContextPath(graph, f))), matchedBy,
  } : null;
}

function journalCmp(a: ContextJournalEntry, b: ContextJournalEntry): number {
  return cmp(a.at, b.at) || cmp(a.id, b.id) || cmp(a.agent, b.agent);
}

/** Pure, deterministic context projection. No filesystem, no Git, no clock. */
export function contextFor(
  graph: Graph,
  request: ContextRequest,
  records: readonly DecisionRecord[] = [],
  options: ContextOptions = {},
): ContextResult {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const fileNodes = graph.nodes.filter((n) => n.kind === "file" && nodePath(n));
  const filesByPath = new Map(fileNodes.map((n) => [normalizeContextPath(graph, nodePath(n)), n]));
  const symbolNodes = graph.nodes.filter((n) => n.kind === "symbol");
  const repositoryFiles = new Set((options.repositoryFiles ?? [])
    .map((p) => normalizeContextPath(graph, p)).filter(Boolean));

  const rawFiles = unique([...(request.files ?? []), ...(request.changedFiles ?? [])].map((p) => normalizeContextPath(graph, p)).filter(Boolean));
  const selectedGraphFiles = new Set(rawFiles.filter((p) => filesByPath.has(p)));
  const selectedFiles = new Set(rawFiles.filter((p) => filesByPath.has(p) || repositoryFiles.has(p)));
  const unresolvedFiles = rawFiles.filter((p) => !selectedFiles.has(p));

  const wantedSymbols = unique((request.symbols ?? []).map((s) => s.trim()).filter(Boolean));
  const requestedSymbolNodes = symbolNodes.filter((n) => wantedSymbols.includes(n.label));
  for (const n of requestedSymbolNodes) if (n.path) {
    const p = normalizeContextPath(graph, n.path);
    if (filesByPath.has(p)) {
      selectedGraphFiles.add(p);
      selectedFiles.add(p);
    }
  }
  const unresolvedSymbols = wantedSymbols.filter((name) => !requestedSymbolNodes.some((n) => n.label === name));
  const selected = unique(selectedFiles);

  const declaredSymbolNodes = symbolNodes.filter((n) => n.path && selectedGraphFiles.has(normalizeContextPath(graph, n.path)));
  const requestedSymbols = requestedSymbolNodes.map(symbolView).sort(symbolCmp);
  const declaredSymbols = declaredSymbolNodes.map(symbolView).sort(symbolCmp);

  const ownerNodes = new Map<string, GraphNode>();
  for (const path of selectedGraphFiles) {
    const owner = componentOfFile(filesByPath.get(path)!, nodes);
    if (owner) ownerNodes.set(owner.id, owner);
  }
  const components = [...ownerNodes.values()].map((n): ContextComponent => ({
    name: n.label, dir: n.id.slice(2), intent: n.sub ?? null, why: n.why ?? null,
    invariants: unique(n.invariants ?? []),
  })).sort((a, b) => cmp(a.name, b.name) || cmp(a.dir, b.dir));
  const surfaces = selected.map((path): ContextSurface => {
    const file = filesByPath.get(path);
    const owner = file ? componentOfFile(file, nodes) : undefined;
    return { path, source: file ? "graph" : "repository", graphOwner: owner?.label ?? null };
  });

  // Claims owned by selected files' components are relevant by ownership. Claims elsewhere
  // are included only when they explicitly name a selected file/symbol structural referent.
  const structuralSymbols = new Set([...wantedSymbols, ...declaredSymbolNodes.map((n) => n.label)]);
  const uniqueBasenames = new Map<string, number>();
  for (const p of new Set([...filesByPath.keys(), ...repositoryFiles]))
    uniqueBasenames.set(basename(p), (uniqueBasenames.get(basename(p)) ?? 0) + 1);
  const pathTerms = unique([...selected, ...selected.map((p) => basename(p)).filter((b) => uniqueBasenames.get(b) === 1)]);
  const obligations: ContextObligation[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== "component") continue;
    const owned = ownerNodes.has(n.id);
    for (const claim of n.claims ?? []) if (owned || claimReferences(claim, structuralSymbols, pathTerms))
      obligations.push(obligation(n.label, claim));
  }
  obligations.sort(obligationCmp);

  const imports: ContextImport[] = [], importers: ContextImport[] = [];
  const directImports = new Set<string>(), directImporters = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== "imports") continue;
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    if (!source || source.kind !== "file") continue;
    const from = normalizeContextPath(graph, nodePath(source));
    if (selectedGraphFiles.has(from) && target) {
      const external = target.kind !== "file";
      const to = external ? target.label : normalizeContextPath(graph, nodePath(target));
      imports.push({ from, to, external });
      if (!external) directImports.add(to);
    }
    if (target?.kind === "file") {
      const to = normalizeContextPath(graph, nodePath(target));
      if (selectedGraphFiles.has(to)) {
        importers.push({ from, to, external: false });
        directImporters.add(from);
      }
    }
  }
  const importCmp = (a: ContextImport, b: ContextImport) => cmp(a.from, b.from) || cmp(a.to, b.to) || Number(a.external) - Number(b.external);
  imports.sort(importCmp); importers.sort(importCmp);

  const isTest = options.isTestPath ?? looksLikeTestPath;
  const ownerIds = new Set(ownerNodes.keys());
  const testReasons = new Map<string, ContextTest["reason"]>();
  const priority: Record<ContextTest["reason"], number> = {
    selected: 0, "direct importer": 1, "direct import": 2, "same owning component": 3,
  };
  const addTest = (path: string, reason: ContextTest["reason"]) => {
    if (!isTest(path)) return;
    const before = testReasons.get(path);
    if (!before || priority[reason] < priority[before]) testReasons.set(path, reason);
  };
  for (const p of selected) addTest(p, "selected");
  for (const p of directImporters) addTest(p, "direct importer");
  for (const p of directImports) addTest(p, "direct import");
  for (const n of fileNodes) {
    const p = normalizeContextPath(graph, nodePath(n));
    if (n.parent && ownerIds.has(n.parent)) addTest(p, "same owning component");
  }
  const tests = [...testReasons].map(([path, reason]) => ({ path, reason })).sort((a, b) => cmp(a.path, b.path));

  const journalTerms = unique([
    ...pathTerms,
    ...structuralSymbols,
    ...components.map((c) => c.name),
    ...obligations.flatMap((o) => [o.invariant ?? "", ...o.chokepoints, ...o.oracles]),
  ].filter(Boolean));
  // `resolve` intentionally lets the last duplicate id win. Canonicalize first so an
  // injected record set renders identically regardless of filesystem/collector order;
  // the final session key matches readJournal's total ordering.
  const canonicalRecords = [...records].sort((a, b) => cmp(a.at, b.at) || cmp(a.id, b.id)
    || cmp(a.session ?? "", b.session ?? ""));
  const resolved = resolveJournal(canonicalRecords);
  const match = (r: DecisionRecord) => journalEntry(r, selectedFiles, journalTerms, graph);
  const decisions = resolved.standing.filter((r) => r.kind === "decision").map(match).filter((x): x is ContextJournalEntry => x !== null).sort(journalCmp);
  const blocked = resolved.blocked.map(match).filter((x): x is ContextJournalEntry => x !== null).sort(journalCmp);
  const openConjectures = resolved.open.map(match).filter((x): x is ContextJournalEntry => x !== null).sort(journalCmp);

  const limitations = [
    `Graph snapshot only (${graph.generatedAt || "timestamp unavailable"}); repository surfaces outside it resolve as selections but cannot contribute graph ownership, symbols, or import edges.`,
    "Imports/importers are static graph edges one hop from the selected files; dynamic and transitive dependencies are not inferred.",
    "Test relevance is inferred from test-like paths plus selection, direct import edges, and component ownership; custom runners may disagree.",
    "Journal file matches are exact and prose matches are lexical structural-reference matches, not semantic relevance judgments.",
    "Only standing decisions, addressable blocked entries, and unresolved conjectures are shown; retracted, resolved, and dismissed records are intentionally omitted.",
    ...(surfaces.some((s) => s.source === "repository")
      ? [`${surfaces.filter((s) => s.source === "repository").length} selected repository surface(s) have no source-graph file node; graph ownership is explicitly unavailable.`]
      : []),
    ...(unresolvedFiles.length || unresolvedSymbols.length
      ? [`${unresolvedFiles.length + unresolvedSymbols.length} selector(s) did not resolve in this graph and are listed explicitly above.`]
      : []),
  ];

  return {
    selection: { files: selected, requestedSymbols, declaredSymbols, surfaces, unresolvedFiles, unresolvedSymbols },
    components, obligations, imports, importers, tests,
    journal: { decisions, blocked, openConjectures }, limitations,
  };
}

/** Read paths from Git without conflating staged with all working-tree changes. */
export function gitContextPaths(cfg: Config, scope: ContextPathScope): string[] {
  if (scope === "changed") return unique(changedFiles(cfg, null));
  const env = { ...process.env };
  for (const key of ["GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_PREFIX"])
    delete env[key];
  const result = spawnSync("git", ["diff", "--cached", "--name-only", "--relative"], {
    cwd: cfg.root, encoding: "utf8", env,
  });
  if (result.status !== 0) throw new Error(`cannot read staged paths: ${(result.stderr || "git diff failed").trim()}`);
  return unique((result.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean));
}

function pathInsideRoot(root: string, path: string): boolean {
  if (!path || isAbsolute(path)) return false;
  const rel = relative(resolvePath(root), resolvePath(root, path));
  return rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel);
}

/** Establish the repository-wide selection domain at the I/O edge. Git contributes tracked
 * and ordinary untracked files (including tracked deletions); explicit ignored/generated
 * artifacts are admitted when their standing path is a file or symlink. The pure projector
 * receives only these names and never turns a plausible path into evidence of existence. */
export function repositoryContextPaths(
  cfg: Config,
  graph: Graph,
  candidates: readonly string[] = [],
): string[] {
  const env = { ...process.env };
  for (const key of ["GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_PREFIX"])
    delete env[key];
  const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: cfg.root, encoding: "utf8", env,
  });
  const paths = new Set<string>();
  if (listed.status === 0) for (const raw of (listed.stdout || "").split("\0")) {
    const path = normalizeContextPath(graph, raw);
    if (path && pathInsideRoot(cfg.root, path)) paths.add(path);
  }
  for (const raw of candidates) {
    const path = normalizeContextPath(graph, raw);
    if (!pathInsideRoot(cfg.root, path)) continue;
    try {
      const stat = lstatSync(resolvePath(cfg.root, path));
      if (stat.isFile() || stat.isSymbolicLink()) paths.add(path);
    } catch {
      // A missing explicit path still resolves when Git listed it as tracked; otherwise the
      // projector will keep it in `unresolvedFiles`, which is the loud and honest state.
    }
  }
  return unique(paths);
}

/** Thin project edge for a CLI or per-change hook. Explicit selectors and Git-derived paths
 * compose: asking for `--staged --symbol seal` does not silently discard either domain. */
export function contextFromProject(
  cfg: Config,
  graph: Graph,
  request: ProjectContextRequest = {},
  options: ContextOptions = {},
): ContextResult {
  const scoped = request.scope ? gitContextPaths(cfg, request.scope) : [];
  const changed = [...(request.changedFiles ?? []), ...scoped];
  const candidates = [...(request.files ?? []), ...changed];
  const repositoryFiles = repositoryContextPaths(cfg, graph, candidates);
  return contextFor(graph, {
    files: request.files,
    symbols: request.symbols,
    changedFiles: changed,
  }, readJournal(cfg).records, {
    ...options,
    repositoryFiles: unique([...repositoryFiles, ...(options.repositoryFiles ?? [])]),
  });
}

const show = (xs: string[]) => xs.length ? xs.map((x) => `\`${x}\``).join(", ") : "(none)";

/** The original complete render remains the expansion path. It intentionally does not cap
 * component prose or same-owner tests: callers which omit a budget asked for full history. */
function renderContextUnbounded(result: ContextResult): string {
  const L: string[] = [
    "CONTEXT — task-addressed graph packet",
    "",
    `Files: ${show(result.selection.files)}`,
  ];
  if (result.selection.requestedSymbols.length)
    L.push(`Requested symbols: ${show(result.selection.requestedSymbols.map((s) => `${s.name} (${s.path}${s.line ? `:${s.line}` : ""})`))}`);
  if (result.selection.unresolvedFiles.length) L.push(`Unresolved files: ${show(result.selection.unresolvedFiles)}`);
  if (result.selection.unresolvedSymbols.length) L.push(`Unresolved symbols: ${show(result.selection.unresolvedSymbols)}`);
  const ownershipAbsent = result.selection.surfaces.filter((s) => s.source === "repository" || s.graphOwner === null);
  if (ownershipAbsent.length) {
    L.push("", "Repository surfaces without graph ownership");
    for (const surface of ownershipAbsent)
      L.push(`  ${surface.path} — ${surface.source === "repository" ? "outside source graph; " : "source-graph file; "}graph ownership unavailable`);
  }

  L.push("", "Owning components");
  if (!result.components.length) L.push("  (none resolved)");
  for (const c of result.components) {
    L.push(`  ${c.name} [${c.dir}] — ${c.intent ?? "(intent undeclared)"}`);
    L.push(`    why: ${c.why ?? "(why undeclared)"}`);
    L.push(`    invariants: ${c.invariants.length ? c.invariants.join(" · ") : "(none declared)"}`);
  }

  L.push("", "Claims / anchors");
  if (!result.obligations.length) L.push("  (none relevant)");
  for (const o of result.obligations) {
    const detail = [o.chokepoints.length ? `chokepoint ${o.chokepoints.join(" + ")}` : "", o.oracles.length ? `oracle ${o.oracles.join(" + ")}` : ""].filter(Boolean).join(" · ");
    L.push(`  [${o.component} · ${o.kind}] ${o.claim}${detail ? ` — ${detail}` : ""}`);
  }

  L.push("", "Direct imports");
  if (!result.imports.length) L.push("  (none)");
  for (const e of result.imports) L.push(`  ${e.from} → ${e.to}${e.external ? " (external)" : ""}`);
  L.push("", "Direct importers");
  if (!result.importers.length) L.push("  (none)");
  for (const e of result.importers) L.push(`  ${e.from} → ${e.to}`);

  L.push("", "Relevant tests");
  if (!result.tests.length) L.push("  (none inferred)");
  for (const t of result.tests) L.push(`  ${t.path} — ${t.reason}`);

  L.push("", "Journal decisions");
  if (!result.journal.decisions.length) L.push("  (none matched)");
  for (const d of result.journal.decisions) {
    L.push(`  ${d.id} · ${d.agent} — ${d.chose}`);
    L.push(`    because: ${d.because}`);
  }
  L.push("", "Blocked");
  if (!result.journal.blocked.length) L.push("  (none matched)");
  for (const d of result.journal.blocked) {
    L.push(`  ${d.id} · ${d.agent} — ${d.chose}`);
    L.push(`    because: ${d.because}`);
  }
  L.push("", "Open conjectures");
  if (!result.journal.openConjectures.length) L.push("  (none matched)");
  for (const d of result.journal.openConjectures) {
    L.push(`  ${d.id} · ${d.agent} — ${d.chose}`);
    L.push(`    discriminate: ${d.because}`);
  }

  L.push("", "Limitations");
  for (const limitation of result.limitations) L.push(`  - ${limitation}`);
  return L.join("\n") + "\n";
}

type WithholdingReason = ContextWithholding["reason"];
interface ContextRenderUnit { text: string; excerptBytes: number }
interface ContextRenderBody { text: string; excerptBytes?: number }

const BOUNDED_JOURNAL_LANE = 4;
const BOUNDED_OBLIGATIONS = 4;
const BOUNDED_SAME_COMPONENT_TESTS = 4;
const BOUNDED_ENTRY_BYTES = 320;
const BOUNDED_TITLE = "CONTEXT — task-addressed repository packet\n";
const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

function addWithholding(
  target: Map<WithholdingReason, ContextWithholding>,
  reason: WithholdingReason,
  items: number,
  bytes: number,
): void {
  if (!items && !bytes) return;
  const before = target.get(reason);
  target.set(reason, {
    reason,
    items: (before?.items ?? 0) + items,
    bytes: (before?.bytes ?? 0) + bytes,
  });
}

function boundedExcerpt(raw: string): { text: string; withheldBytes: number } {
  const text = raw.replace(/\s+/g, " ").trim();
  if (byteLength(text) <= BOUNDED_ENTRY_BYTES) return { text, withheldBytes: 0 };
  const room = BOUNDED_ENTRY_BYTES - byteLength("…");
  let prefix = "";
  for (const char of text) {
    if (byteLength(prefix + char) > room) break;
    prefix += char;
  }
  return { text: prefix + "…", withheldBytes: byteLength(text) - byteLength(prefix) };
}

function excerptBody(prefix: string, raw: string): ContextRenderBody {
  const excerpt = boundedExcerpt(raw);
  return { text: prefix + excerpt.text, excerptBytes: excerpt.withheldBytes };
}

function groupedUnits(title: string, bodies: Array<string | ContextRenderBody>): ContextRenderUnit[] {
  const entries: ContextRenderBody[] = bodies.length
    ? bodies.map((body) => typeof body === "string" ? { text: body } : body)
    : [{ text: "  (none)" }];
  return entries.map((body, i) => ({
    text: `${i === 0 ? `\n${title}\n` : ""}${body.text}\n`, excerptBytes: body.excerptBytes ?? 0,
  }));
}

function boundedUnits(
  result: ContextResult,
  preWithheld: Map<WithholdingReason, ContextWithholding>,
): ContextRenderUnit[] {
  const units: ContextRenderUnit[] = [];
  const selection = result.selection.surfaces.map((surface) => surface.source === "repository"
    ? `  ${surface.path} — repository surface · graph ownership unavailable`
    : `  ${surface.path} — graph file · owner ${surface.graphOwner ?? "unavailable"}`);
  for (const symbol of result.selection.requestedSymbols)
    selection.push(`  symbol ${symbol.name} — ${symbol.path}${symbol.line ? `:${symbol.line}` : ""}`);
  for (const path of result.selection.unresolvedFiles) selection.push(`  unresolved file — ${path}`);
  for (const symbol of result.selection.unresolvedSymbols) selection.push(`  unresolved symbol — ${symbol}`);
  units.push(...groupedUnits("Selection / repository surfaces", selection));

  units.push(...groupedUnits("Owner / intent", result.components.map((component) =>
    `  ${component.name} [${component.dir}] — ${component.intent ?? "intent undeclared"}`)));

  const obligations = result.obligations.map((entry) => {
    const detail = [
      entry.chokepoints.length ? `chokepoint ${entry.chokepoints.join(" + ")}` : "",
      entry.oracles.length ? `oracle ${entry.oracles.join(" + ")}` : "",
    ].filter(Boolean).join(" · ");
    return `  [${entry.component} · ${entry.kind}] ${entry.claim}${detail ? ` — ${detail}` : ""}`;
  });
  units.push(...groupedUnits("Governing obligations", obligations.slice(0, BOUNDED_OBLIGATIONS)));

  const newest = (entries: ContextJournalEntry[]) => [...entries].reverse();
  const decisionEntries = newest(result.journal.decisions);
  const blockedEntries = newest(result.journal.blocked);
  const conjectureEntries = newest(result.journal.openConjectures);
  units.push(...groupedUnits("Standing decisions", decisionEntries.slice(0, BOUNDED_JOURNAL_LANE)
    .map((entry) => excerptBody(`  ${entry.id} · ${entry.agent} — `, entry.chose))));
  units.push(...groupedUnits("Blocked", blockedEntries.slice(0, BOUNDED_JOURNAL_LANE)
    .map((entry) => excerptBody(`  ${entry.id} · ${entry.agent} — `, entry.chose))));
  units.push(...groupedUnits("Open conjectures", conjectureEntries.slice(0, BOUNDED_JOURNAL_LANE)
    .map((entry) => excerptBody(`  ${entry.id} · ${entry.agent} — `, entry.chose))));

  units.push(...groupedUnits("Direct dependencies", result.imports.map((entry) =>
    `  ${entry.from} → ${entry.to}${entry.external ? " (external)" : ""}`)));
  units.push(...groupedUnits("Direct importers", result.importers.map((entry) =>
    `  ${entry.from} → ${entry.to}`)));

  const testPriority: Record<ContextTest["reason"], number> = {
    selected: 0, "direct importer": 1, "direct import": 2, "same owning component": 3,
  };
  const orderedTests = [...result.tests].sort((a, b) =>
    testPriority[a.reason] - testPriority[b.reason] || cmp(a.path, b.path));
  let sameOwnerTests = 0;
  const visibleTests: ContextTest[] = [];
  for (const entry of orderedTests) {
    if (entry.reason !== "same owning component" || sameOwnerTests++ < BOUNDED_SAME_COMPONENT_TESTS) {
      visibleTests.push(entry);
      continue;
    }
    addWithholding(preWithheld, "same-component test cap", 1,
      byteLength(`  ${entry.path} — ${entry.reason}\n`));
  }
  units.push(...groupedUnits("Relevant tests", visibleTests.map((entry) =>
    `  ${entry.path} — ${entry.reason}`)));

  const deferred: Array<string | ContextRenderBody> = [];
  for (const body of obligations.slice(BOUNDED_OBLIGATIONS)) deferred.push(`  obligation — ${body.trimStart()}`);
  for (const entry of decisionEntries.slice(BOUNDED_JOURNAL_LANE))
    deferred.push(excerptBody(`  decision ${entry.id} — `, entry.chose));
  for (const entry of blockedEntries.slice(BOUNDED_JOURNAL_LANE))
    deferred.push(excerptBody(`  blocked ${entry.id} — `, entry.chose));
  for (const entry of conjectureEntries.slice(BOUNDED_JOURNAL_LANE))
    deferred.push(excerptBody(`  conjecture ${entry.id} — `, entry.chose));
  units.push(...groupedUnits("Additional obligations / journal history", deferred));

  const rationale: ContextRenderBody[] = [];
  for (const component of result.components) if (component.why)
    rationale.push(excerptBody(`  ${component.name} why — `, component.why));
  for (const [label, entries] of [
    ["decision", decisionEntries], ["blocked", blockedEntries], ["conjecture", conjectureEntries],
  ] as const) for (const entry of entries)
    rationale.push(excerptBody(`  ${label} ${entry.id} because — `, entry.because));
  units.push(...groupedUnits("Rationale / history", rationale));
  return units;
}

const WITHHOLDING_ORDER: WithholdingReason[] = [
  "byte budget", "same-component test cap", "bounded entry excerpt",
];

function orderedWithholding(source: Map<WithholdingReason, ContextWithholding>): ContextWithholding[] {
  return WITHHOLDING_ORDER.map((reason) => source.get(reason)).filter((x): x is ContextWithholding => !!x);
}

function boundedSuffix(
  result: ContextResult,
  maxBytes: number,
  units: ContextRenderUnit[],
  included: number,
  preWithheld: Map<WithholdingReason, ContextWithholding>,
): { text: string; withholding: ContextWithholding[] } {
  const withheld = new Map(preWithheld);
  for (const unit of units.slice(0, included)) if (unit.excerptBytes)
    addWithholding(withheld, "bounded entry excerpt", 1, unit.excerptBytes);
  const omitted = units.slice(included);
  addWithholding(withheld, "byte budget", omitted.length,
    omitted.reduce((sum, unit) => sum + byteLength(unit.text) + unit.excerptBytes
      - (unit.excerptBytes ? byteLength("…") : 0), 0));
  const withholding = orderedWithholding(withheld);
  const items = withholding.reduce((sum, entry) => sum + entry.items, 0);
  const bytes = withholding.reduce((sum, entry) => sum + entry.bytes, 0);
  const L = ["", "Limitations", ...result.limitations.map((limitation) => `  - ${limitation}`), "", "Budget",
    `  Limit: ${maxBytes} UTF-8 bytes.`,
    `  Withheld: ${items} item(s), ${bytes} byte(s).`,
  ];
  for (const entry of withholding)
    L.push(`  - ${entry.reason}: ${entry.items} item(s), ${entry.bytes} byte(s)`);
  if (items) L.push("  Expand by rendering without a byte limit (or with expand=true).");
  return { text: L.join("\n") + "\n", withholding };
}

function minimumBoundedBytes(
  result: ContextResult,
  units: ContextRenderUnit[],
  preWithheld: Map<WithholdingReason, ContextWithholding>,
): number {
  // The footer prints the limit, so decimal-width growth can change the required size.
  // Iterating from one byte reaches the least self-consistent value in a few steps.
  let candidate = 1;
  for (;;) {
    const required = byteLength(BOUNDED_TITLE + boundedSuffix(result, candidate, units, 0, preWithheld).text);
    if (required <= candidate) return candidate;
    candidate = required;
  }
}

/** Produce the structured accounting behind both render modes. In bounded mode entries are
 * atomic and priority ordered; if even the title, named limitations, and omission report do
 * not fit, the function refuses rather than returning an apparently complete fragment. */
export function renderContextProjection(
  result: ContextResult,
  options: ContextRenderOptions = {},
): ContextRenderProjection {
  if (options.maxBytes === undefined || options.expand) {
    const text = renderContextUnbounded(result);
    return {
      text, mode: "unbounded", maxBytes: null, renderedBytes: byteLength(text),
      withheldItems: 0, withheldBytes: 0, withholding: [],
    };
  }
  const maxBytes = options.maxBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new RangeError("context maxBytes must be a positive safe integer");
  const preWithheld = new Map<WithholdingReason, ContextWithholding>();
  const units = boundedUnits(result, preWithheld);
  let winner: { text: string; withholding: ContextWithholding[] } | null = null;
  for (let included = 0; included <= units.length; included++) {
    const suffix = boundedSuffix(result, maxBytes, units, included, preWithheld);
    const text = BOUNDED_TITLE + units.slice(0, included).map((unit) => unit.text).join("") + suffix.text;
    if (byteLength(text) <= maxBytes) winner = { text, withholding: suffix.withholding };
  }
  if (!winner) {
    const minimum = minimumBoundedBytes(result, units, preWithheld);
    throw new RangeError(`context maxBytes ${maxBytes} cannot hold mandatory framing; minimum is ${minimum}`);
  }
  const withheldItems = winner.withholding.reduce((sum, entry) => sum + entry.items, 0);
  const withheldBytes = winner.withholding.reduce((sum, entry) => sum + entry.bytes, 0);
  return {
    text: winner.text, mode: "bounded", maxBytes, renderedBytes: byteLength(winner.text),
    withheldItems, withheldBytes, withholding: winner.withholding,
  };
}

/** Stable human rendering. No options preserves the historical unbounded API; a byte limit
 * selects the route-first projection and `expand` explicitly returns to the full view. */
export function renderContext(result: ContextResult, options: ContextRenderOptions = {}): string {
  return renderContextProjection(result, options).text;
}
