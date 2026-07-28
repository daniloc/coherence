// structural.ts — the temporal affordance. A coherence graph is a *snapshot*
// ledger; this adds the transaction view: what one ref → another did to the
// STRUCTURE an agent cares about — components, the invariants they uphold, and
// the boundary claims (chokepoint + oracle) that anchor those invariants.
//
// The point is the question "did my change alter the invariant set?" — answerable
// without re-reading the world, and a review gate: a dropped boundary or a
// silently-rewired chokepoint is the diff a prose review misses. `--strict` turns
// a LOSS (an invariant or boundary anchor removed) into a nonzero exit.
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  boundaryInvariantName,
  formatBoundary,
  formatBoundaryInvariant,
  formatBoundaryVia,
  parseBoundary,
  type Boundary,
} from "./boundary.ts";
import { parseParity, type Parity } from "./parity.ts";
import { loadConfig } from "./config.ts";
import { buildGraph } from "./derive.ts";
import { ownerOf } from "./walk.ts";
import { CONFORMS_RE, dictionaryDir, parseWord } from "./phrasebook.ts";
import { noveltyVerdict, renderNovelty, scanSurface, surfaceSignals } from "./novelty.ts";
import type { Config, DbtParity, Graph, GraphEdge, GraphNode } from "./types.ts";

/** Files changed vs `since` (a ref), or — when null — the working tree vs HEAD
 *  PLUS untracked files. Paths are relative to cfg.root (`--relative`). This is the
 *  domain `verify --staged` / `--since` scopes to. */
export function changedFiles(cfg: Config, since: string | null): Set<string> {
  const lines = (args: string[]) =>
    (git(args, cfg.root).stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (since) return new Set(lines(["diff", "--name-only", "--relative", since]));
  return new Set([
    ...lines(["diff", "--name-only", "--relative", "HEAD"]),
    ...lines(["ls-files", "--others", "--exclude-standard"]),
  ]);
}

/** The word a changed path names, if it is a `<dictionary>/<Word>.md` file (else null).
 *  Word files are flat basenames directly under the dictionary dir. */
function wordOfPath(f: string, dictDir: string): string | null {
  const norm = f.replace(/\\/g, "/");
  const prefix = dictDir.replace(/\/+$/, "") + "/";
  if (!norm.startsWith(prefix)) return null;
  const m = /^([A-Za-z][A-Za-z0-9_-]*)\.md$/.exec(norm.slice(prefix.length));
  return m ? m[1] : null;
}

/** Given a set of directly-changed words, the transitive closure of words affected by the
 *  edit: a word whose commitments `conforms to` an affected word is itself affected (a nested
 *  reference means an edit to the inner word propagates through the outer word to its
 *  conformers). Reads the CURRENT dictionary — the same tree the graph and verify see. */
async function affectedWords(cfg: Config, changed: Set<string>): Promise<Set<string>> {
  const dir = join(cfg.root, dictionaryDir(cfg));
  let files: string[] = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".md")); } catch { /* no dictionary */ }
  const refs = new Map<string, Set<string>>(); // word → words it conforms-to (its commitments)
  for (const f of files) {
    const base = f.replace(/\.md$/, "");
    const w = parseWord(await readFile(join(dir, f), "utf8").catch(() => ""));
    const set = new Set<string>();
    for (const c of w?.commitments ?? []) { const m = CONFORMS_RE.exec(c); if (m) set.add(m[1]); }
    refs.set(base, set);
  }
  const out = new Set(changed);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [word, set] of refs) {
      if (out.has(word)) continue;
      for (const r of set) if (out.has(r)) { out.add(word); grew = true; break; }
    }
  }
  return out;
}

/** Map changed files to the component dirs that own them (the deepest spec'd
 *  ancestor — same ownership rule the graph uses). A changed dictionary word file does NOT
 *  map to its owning dir (the root, spuriously) — it maps to every component that `conforms
 *  to` that word (transitively through nested word references), so a word edit re-verifies
 *  the CONFORMERS it actually propagates to, not the dictionary's accidental container. */
export async function affectedComponents(cfg: Config, graph: Graph, files: Set<string>): Promise<Set<string>> {
  const dirs = graph.nodes.filter((n) => n.kind === "component").map((n) => n.id.slice(2));
  const dictDir = dictionaryDir(cfg);
  const hit = new Set<string>();
  const changedWords = new Set<string>();
  for (const f of files) {
    const w = wordOfPath(f, dictDir);
    if (w) changedWords.add(w);
    else hit.add(ownerOf(f, dirs));
  }
  if (changedWords.size) {
    const words = await affectedWords(cfg, changedWords);
    for (const n of graph.nodes)
      if (n.kind === "component")
        for (const cl of n.claims ?? []) {
          const m = CONFORMS_RE.exec(cl);
          if (m && words.has(m[1])) { hit.add(n.id.slice(2)); break; }
        }
  }
  return hit;
}

// Git env vars a caller (lint-staged, a rebase, another hook) may have set that
// would hijack our subcommands — most damagingly `git worktree add`, which
// resolves a relative GIT_INDEX_FILE inside the new detached worktree and dies
// with ".git/index: Not a directory". Scrub them so worktree/log ops always
// target the real repo regardless of the invoking context.
const GIT_ENV_SCRUB = [
  "GIT_INDEX_FILE",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
] as const;

const scrubbedGitEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const k of GIT_ENV_SCRUB) delete env[k];
  return env;
};

const git = (args: string[], cwd: string) =>
  spawnSync("git", args, { cwd, encoding: "utf8", env: scrubbedGitEnv() });

export type { Boundary } from "./boundary.ts";
interface Ledger {
  label: string;
  invariants: Set<string>;
  boundaries: Map<string, Boundary>; // keyed by invariant name
  parities: Map<string, Parity>;     // parity claims, keyed by invariant name (first-class anchors)
  claims: Set<string>;               // other claims (exists/imports/…)
}

function ledgerOf(node: GraphNode): Ledger {
  const boundaries = new Map<string, Boundary>();
  const parities = new Map<string, Parity>();
  const claims = new Set<string>();
  for (const c of node.claims ?? []) {
    const b = parseBoundary(c);
    const p = b ? null : parseParity(c);
    if (b) boundaries.set(boundaryInvariantName(b), b);
    else if (p) parities.set(p.inv, p);
    else claims.add(c);
  }
  return {
    label: node.label,
    invariants: new Set(node.invariants ?? []),
    boundaries,
    parities,
    claims,
  };
}

function ledgersOf(graph: Graph): Map<string, Ledger> {
  const out = new Map<string, Ledger>();
  for (const n of graph.nodes) if (n.kind === "component") out.set(n.label, ledgerOf(n));
  return out;
}

/** Every boundary claim in the graph, keyed by its CHOKEPOINT symbol — the shared
 *  input the atlas (tier derivation) and conventions (anchored set) subcommands both
 *  consume, parsed ONCE from the graph the harness already built (no spec re-walk). */
export function allBoundaries(graph: Graph): Map<string, Boundary & { component: string }> {
  const out = new Map<string, Boundary & { component: string }>();
  for (const n of graph.nodes)
    if (n.kind === "component")
      for (const b of ledgerOf(n).boundaries.values())
        if (!out.has(b.chokepoint)) out.set(b.chokepoint, { ...b, component: n.label });
  return out;
}

/** EVERY boundary claim whose chokepoint is `sym` — not the single kept claim `allBoundaries`
 *  keeps per symbol. A chokepoint can carry several claims (e.g. one `via test` and one
 *  `via guard`); `allBoundaries` collapses them order-dependently, so any caller that must ask
 *  an ∃/∀ question across a symbol's claims (the atlas: "is ANY claim here `via guard`?" when
 *  grading enshrinement) has to consult the full list, not whichever claim the map happened
 *  to keep. Returns [] when no claim anchors that symbol. */
export function boundariesAt(graph: Graph, sym: string): Array<Boundary & { component: string }> {
  const out: Array<Boundary & { component: string }> = [];
  for (const n of graph.nodes)
    if (n.kind === "component")
      for (const b of ledgerOf(n).boundaries.values())
        if (b.chokepoint === sym) out.push({ ...b, component: n.label });
  return out;
}

/** Run `fn` against the project root AS IT EXISTS at a git ref (null = the live
 *  working tree — no checkout). The temp worktree lives only for the callback, so a
 *  caller can derive anything it needs from that tree (the graph, a surface scan) in
 *  ONE checkout instead of one per artifact. */
export async function withTreeAt<T>(cfg: Config, ref: string | null, fn: (projRoot: string) => Promise<T>): Promise<T> {
  if (!ref) return fn(cfg.root);
  const top = git(["rev-parse", "--show-toplevel"], cfg.root);
  if (top.status !== 0) throw new Error(`not a git repo at ${cfg.root}: ${(top.stderr || "").trim()}`);
  const repoRoot = top.stdout.trim();
  const relProject = relative(repoRoot, resolve(cfg.root));
  const tmp = await mkdtemp(join(tmpdir(), "coherence-wt-"));
  // A detached worktree at <ref> gives us that ref's COMMITTED files (untracked /
  // gitignored paths like node_modules are absent — buildGraph only needs source +
  // specs + config, so no install is required).
  const add = git(["worktree", "add", "--detach", tmp, ref], cfg.root);
  if (add.status !== 0) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw new Error(`cannot check out "${ref}": ${(add.stderr || "").trim()}`);
  }
  try {
    return await fn(join(tmp, relProject));
  } finally {
    git(["worktree", "remove", "--force", tmp], cfg.root);
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Build the graph as it exists at a git ref (null = the live working tree). */
export async function graphAtRef(cfg: Config, ref: string | null): Promise<Graph> {
  return withTreeAt(cfg, ref, async (root) => buildGraph(await loadConfig(root)));
}

export interface StructuralDiff {
  componentsAdded: string[];
  componentsRemoved: string[];
  invAdded: Array<{ comp: string; inv: string }>;
  invRemoved: Array<{ comp: string; inv: string }>;
  boundaryAdded: Array<{ comp: string; b: Boundary }>;
  boundaryRemoved: Array<{ comp: string; b: Boundary }>;
  boundaryRewired: Array<{ comp: string; inv: string; before: Boundary; after: Boundary }>;
  parityAdded: Array<{ comp: string; p: Parity }>;
  parityRemoved: Array<{ comp: string; p: Parity }>;
  parityRewired: Array<{ comp: string; inv: string; before: Parity; after: Parity }>;
  claimDelta: Array<{ comp: string; added: number; removed: number }>;
  dbtResourcesAdded: Array<{ uniqueId: string; name: string; resourceType: string }>;
  dbtResourcesRemoved: Array<{ uniqueId: string; name: string; resourceType: string }>;
  dbtChanged: Array<{
    uniqueId: string;
    name: string;
    dependenciesAdded: string[];
    dependenciesRemoved: string[];
    columnsAdded: string[];
    columnsRemoved: string[];
    constraintsAdded: string[];
    constraintsRemoved: string[];
    rolesAdded: string[];
    rolesRemoved: string[];
    observerBefore: boolean;
    observerAfter: boolean;
    grainBefore?: string[];
    grainAfter?: string[];
    materializedBefore?: string;
    materializedAfter?: string;
  }>;
  dbtRelationshipsAdded: Array<{ source: string; target: string; contract: NonNullable<GraphEdge["dbt"]> }>;
  dbtRelationshipsRemoved: Array<{ source: string; target: string; contract: NonNullable<GraphEdge["dbt"]> }>;
  dbtRelationshipsRewired: Array<{
    source: string;
    target: string;
    before: NonNullable<GraphEdge["dbt"]>;
    after: NonNullable<GraphEdge["dbt"]>;
  }>;
  dbtParitiesAdded: DbtParity[];
  dbtParitiesRemoved: DbtParity[];
  dbtParitiesRewired: Array<{ name: string; before: DbtParity; after: DbtParity }>;
}

const dbtNodes = (graph: Graph) =>
  new Map(graph.nodes.filter((n) => n.dbt).map((n) => [n.dbt!.uniqueId, n]));

const dbtRelationships = (graph: Graph) => {
  const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  return new Map(graph.edges.filter((edge) => edge.dbt).map((edge) => [
    `${edge.source}->${edge.target}`,
    {
      edge,
      source: labels.get(edge.source) ?? edge.source,
      target: labels.get(edge.target) ?? edge.target,
    },
  ]));
};

const dbtParities = (graph: Graph) => {
  const labels = new Map(
    graph.nodes.filter((node) => node.dbt).map((node) => [node.dbt!.uniqueId, node.label]),
  );
  return new Map(graph.nodes.flatMap((node) => node.dbt?.parities ?? []).map((parity) => [
    parity.name,
    {
      ...parity,
      left: labels.get(parity.left) ?? parity.left,
      right: labels.get(parity.right) ?? parity.right,
    },
  ]));
};

const stringSetDelta = (before: Iterable<string>, after: Iterable<string>) => {
  const a = new Set(before), b = new Set(after);
  return {
    added: [...b].filter((x) => !a.has(x)).sort(),
    removed: [...a].filter((x) => !b.has(x)).sort(),
  };
};

const columnsOf = (n: GraphNode) => (n.dbt?.columns ?? []).map((c) => `${c.name}:${c.dataType ?? "?"}`);
const constraintsOf = (n: GraphNode) =>
  (n.dbt?.constraints ?? []).map((constraint) =>
    `${constraint.type}(${constraint.columns.join(", ")})`
  );

export function diffGraphs(before: Graph, after: Graph): StructuralDiff {
  const A = ledgersOf(before), B = ledgersOf(after);
  const d: StructuralDiff = {
    componentsAdded: [], componentsRemoved: [], invAdded: [], invRemoved: [],
    boundaryAdded: [], boundaryRemoved: [], boundaryRewired: [],
    parityAdded: [], parityRemoved: [], parityRewired: [], claimDelta: [],
    dbtResourcesAdded: [], dbtResourcesRemoved: [], dbtChanged: [],
    dbtRelationshipsAdded: [], dbtRelationshipsRemoved: [], dbtRelationshipsRewired: [],
    dbtParitiesAdded: [], dbtParitiesRemoved: [], dbtParitiesRewired: [],
  };
  for (const label of B.keys()) if (!A.has(label)) d.componentsAdded.push(label);
  for (const label of A.keys()) if (!B.has(label)) d.componentsRemoved.push(label);

  for (const [label, b] of B) {
    const a = A.get(label);
    if (!a) continue; // brand-new component — its whole ledger is "added", covered by componentsAdded
    for (const inv of b.invariants) if (!a.invariants.has(inv)) d.invAdded.push({ comp: label, inv });
    for (const inv of a.invariants) if (!b.invariants.has(inv)) d.invRemoved.push({ comp: label, inv });
    for (const [inv, bnd] of b.boundaries) {
      const prev = a.boundaries.get(inv);
      if (!prev) d.boundaryAdded.push({ comp: label, b: bnd });
      else if (
        prev.chokepoint !== bnd.chokepoint ||
        formatBoundaryVia(prev) !== formatBoundaryVia(bnd)
      )
        d.boundaryRewired.push({ comp: label, inv, before: prev, after: bnd });
    }
    for (const [inv, bnd] of a.boundaries) if (!b.boundaries.has(inv)) d.boundaryRemoved.push({ comp: label, b: bnd });
    // parity claims — anchors like boundaries: added/removed/rewired, a removal is a LOSS
    for (const [inv, par] of b.parities) {
      const prev = a.parities.get(inv);
      if (!prev) d.parityAdded.push({ comp: label, p: par });
      else if (prev.domain !== par.domain || prev.f !== par.f || prev.g !== par.g || prev.oracle !== par.oracle)
        d.parityRewired.push({ comp: label, inv, before: prev, after: par });
    }
    for (const [inv, par] of a.parities) if (!b.parities.has(inv)) d.parityRemoved.push({ comp: label, p: par });
    let added = 0, removed = 0;
    for (const c of b.claims) if (!a.claims.has(c)) added++;
    for (const c of a.claims) if (!b.claims.has(c)) removed++;
    if (added || removed) d.claimDelta.push({ comp: label, added, removed });
  }

  const dbtA = dbtNodes(before), dbtB = dbtNodes(after);
  for (const [uniqueId, n] of dbtB) if (!dbtA.has(uniqueId))
    d.dbtResourcesAdded.push({ uniqueId, name: n.label, resourceType: n.dbt!.resourceType });
  for (const [uniqueId, n] of dbtA) if (!dbtB.has(uniqueId))
    d.dbtResourcesRemoved.push({ uniqueId, name: n.label, resourceType: n.dbt!.resourceType });
  for (const [uniqueId, b] of dbtB) {
    const a = dbtA.get(uniqueId);
    if (!a) continue;
    const dependencies = stringSetDelta(a.dbt!.dependsOn, b.dbt!.dependsOn);
    const columns = stringSetDelta(columnsOf(a), columnsOf(b));
    const constraints = stringSetDelta(constraintsOf(a), constraintsOf(b));
    const roles = stringSetDelta(a.dbt!.roles, b.dbt!.roles);
    const observerBefore = !!a.dbt!.observer;
    const observerAfter = !!b.dbt!.observer;
    const grainBefore = a.dbt!.grain;
    const grainAfter = b.dbt!.grain;
    const grainChanged = JSON.stringify(grainBefore ?? []) !== JSON.stringify(grainAfter ?? []);
    const materializedChanged = a.dbt!.materialized !== b.dbt!.materialized;
    if (
      dependencies.added.length || dependencies.removed.length ||
      columns.added.length || columns.removed.length ||
      constraints.added.length || constraints.removed.length ||
      roles.added.length || roles.removed.length ||
      observerBefore !== observerAfter ||
      grainChanged || materializedChanged
    ) {
      d.dbtChanged.push({
        uniqueId,
        name: b.label,
        dependenciesAdded: dependencies.added,
        dependenciesRemoved: dependencies.removed,
        columnsAdded: columns.added,
        columnsRemoved: columns.removed,
        constraintsAdded: constraints.added,
        constraintsRemoved: constraints.removed,
        rolesAdded: roles.added,
        rolesRemoved: roles.removed,
        observerBefore,
        observerAfter,
        grainBefore,
        grainAfter,
        materializedBefore: a.dbt!.materialized,
        materializedAfter: b.dbt!.materialized,
      });
    }
  }
  const relA = dbtRelationships(before), relB = dbtRelationships(after);
  for (const [key, relationship] of relB) {
    const previous = relA.get(key);
    if (!previous) d.dbtRelationshipsAdded.push({
      source: relationship.source,
      target: relationship.target,
      contract: relationship.edge.dbt!,
    });
    else if (JSON.stringify(previous.edge.dbt) !== JSON.stringify(relationship.edge.dbt))
      d.dbtRelationshipsRewired.push({
        source: relationship.source,
        target: relationship.target,
        before: previous.edge.dbt!,
        after: relationship.edge.dbt!,
      });
  }
  for (const [key, relationship] of relA) if (!relB.has(key))
    d.dbtRelationshipsRemoved.push({
      source: relationship.source,
      target: relationship.target,
      contract: relationship.edge.dbt!,
    });
  const dbtParityA = dbtParities(before), dbtParityB = dbtParities(after);
  for (const [name, parity] of dbtParityB) {
    const previous = dbtParityA.get(name);
    if (!previous) d.dbtParitiesAdded.push(parity);
    else if (
      previous.left !== parity.left ||
      previous.right !== parity.right ||
      previous.oracle !== parity.oracle
    ) d.dbtParitiesRewired.push({ name, before: previous, after: parity });
  }
  for (const [name, parity] of dbtParityA)
    if (!dbtParityB.has(name)) d.dbtParitiesRemoved.push(parity);
  return d;
}

const fmtB = (b: Boundary) => formatBoundary(b).slice("boundary ".length);
const fmtP = (p: Parity) => `"${p.inv}" over ${p.domain} between ${p.f} and ${p.g} via test "${p.oracle}"`;

/** Render the diff; return the count of LOSSES (removed invariants/boundaries/parities/components). */
export function renderDiff(d: StructuralDiff, fromLabel: string, toLabel: string): number {
  console.log(`\n  STRUCTURAL LEDGER — ${fromLabel} → ${toLabel}\n`);
  const dbtShapeLosses = d.dbtChanged.reduce((n, x) =>
    n + x.columnsRemoved.length + x.constraintsRemoved.length + x.rolesRemoved.length +
    (x.observerBefore && !x.observerAfter ? 1 : 0) +
    (x.grainBefore?.length && !x.grainAfter?.length ? 1 : 0), 0);
  const losses = d.componentsRemoved.length + d.invRemoved.length + d.boundaryRemoved.length + d.parityRemoved.length
    + d.dbtResourcesRemoved.length + d.dbtRelationshipsRemoved.length + d.dbtParitiesRemoved.length + dbtShapeLosses;
  const line = (mark: string, s: string) => console.log(`  ${mark} ${s}`);

  if (d.componentsAdded.length) for (const c of d.componentsAdded) line("+", `component ${c}`);
  if (d.componentsRemoved.length) for (const c of d.componentsRemoved) line("–", `component ${c}  (REMOVED)`);

  for (const x of d.invAdded) line("+", `invariant "${x.inv}" (${x.comp})`);
  for (const x of d.invRemoved) line("–", `invariant "${x.inv}" (${x.comp})  (REMOVED — was the spec enforcing something it no longer claims?)`);

  for (const x of d.boundaryAdded) line("+", `boundary ${fmtB(x.b)} (${x.comp})`);
  for (const x of d.boundaryRemoved) line("–", `boundary ${fmtB(x.b)} (${x.comp})  (ANCHOR REMOVED)`);
  for (const x of d.boundaryRewired) {
    line("~", `boundary ${formatBoundaryInvariant(x.before)} (${x.comp}) rewired:`);
    const cp = x.before.chokepoint !== x.after.chokepoint ? `chokepoint ${x.before.chokepoint} → ${x.after.chokepoint}` : "";
    const or = formatBoundaryVia(x.before) !== formatBoundaryVia(x.after)
      ? `oracle${formatBoundaryVia(x.before)} →${formatBoundaryVia(x.after)}` : "";
    for (const s of [cp, or].filter(Boolean)) console.log(`      ${s}`);
  }

  for (const x of d.parityAdded) line("+", `parity ${fmtP(x.p)} (${x.comp})`);
  for (const x of d.parityRemoved) line("–", `parity ${fmtP(x.p)} (${x.comp})  (AGREEMENT ANCHOR REMOVED)`);
  for (const x of d.parityRewired) {
    line("~", `parity "${x.inv}" (${x.comp}) rewired:`);
    const dm = x.before.domain !== x.after.domain ? `domain ${x.before.domain} → ${x.after.domain}` : "";
    const fg = x.before.f !== x.after.f || x.before.g !== x.after.g
      ? `projections ${x.before.f}/${x.before.g} → ${x.after.f}/${x.after.g}` : "";
    const or = x.before.oracle !== x.after.oracle ? `oracle "${x.before.oracle}" → "${x.after.oracle}"` : "";
    for (const s of [dm, fg, or].filter(Boolean)) console.log(`      ${s}`);
  }

  if (d.claimDelta.length) {
    const tot = d.claimDelta.reduce((n, c) => n + c.added + c.removed, 0);
    console.log(`\n  (${tot} non-boundary claim change(s) across ${d.claimDelta.length} component(s): ${d.claimDelta.map((c) => `${c.comp} +${c.added}/-${c.removed}`).join(", ")})`);
  }

  for (const x of d.dbtResourcesAdded) line("+", `dbt ${x.resourceType} ${x.name}`);
  for (const x of d.dbtResourcesRemoved) line("–", `dbt ${x.resourceType} ${x.name}  (REMOVED)`);
  for (const x of d.dbtChanged) {
    line("~", `dbt ${x.name}`);
    if (x.dependenciesAdded.length) console.log(`      dependencies +${x.dependenciesAdded.join(", +")}`);
    if (x.dependenciesRemoved.length) console.log(`      dependencies -${x.dependenciesRemoved.join(", -")}`);
    if (x.columnsAdded.length) console.log(`      columns +${x.columnsAdded.join(", +")}`);
    if (x.columnsRemoved.length) console.log(`      columns -${x.columnsRemoved.join(", -")}  (SHAPE REMOVED)`);
    if (x.constraintsAdded.length) console.log(`      constraints +${x.constraintsAdded.join(", +")}`);
    if (x.constraintsRemoved.length) console.log(`      constraints -${x.constraintsRemoved.join(", -")}  (PROPERTY REMOVED)`);
    if (x.rolesAdded.length) console.log(`      roles +${x.rolesAdded.join(", +")}`);
    if (x.rolesRemoved.length) console.log(`      roles -${x.rolesRemoved.join(", -")}  (CLASSIFICATION REMOVED)`);
    if (x.observerBefore !== x.observerAfter)
      console.log(`      observer ${x.observerBefore} → ${x.observerAfter}${x.observerBefore ? "  (CLASSIFICATION REMOVED)" : ""}`);
    if (JSON.stringify(x.grainBefore ?? []) !== JSON.stringify(x.grainAfter ?? []))
      console.log(`      grain [${x.grainBefore?.join(", ") ?? "undeclared"}] → [${x.grainAfter?.join(", ") ?? "undeclared"}]`);
    if (x.materializedBefore !== x.materializedAfter)
      console.log(`      materialization ${x.materializedBefore ?? "unset"} → ${x.materializedAfter ?? "unset"}`);
  }
  for (const x of d.dbtRelationshipsAdded)
    line("+", `dbt relationship ${x.target} → ${x.source} (${x.contract.multiplicity}, ${x.contract.filtering})`);
  for (const x of d.dbtRelationshipsRemoved)
    line("–", `dbt relationship ${x.target} → ${x.source} (${x.contract.multiplicity}, ${x.contract.filtering})  (CONTRACT REMOVED)`);
  for (const x of d.dbtRelationshipsRewired) {
    line("~", `dbt relationship ${x.target} → ${x.source}`);
    console.log(`      multiplicity ${x.before.multiplicity} → ${x.after.multiplicity}`);
    console.log(`      filtering ${x.before.filtering} → ${x.after.filtering}`);
  }
  const fmtDbtParity = (parity: DbtParity) =>
    `"${parity.name}" between ${parity.left} and ${parity.right} via test "${parity.oracle}"`;
  for (const parity of d.dbtParitiesAdded)
    line("+", `dbt parity ${fmtDbtParity(parity)}`);
  for (const parity of d.dbtParitiesRemoved)
    line("–", `dbt parity ${fmtDbtParity(parity)}  (AGREEMENT ANCHOR REMOVED)`);
  for (const parity of d.dbtParitiesRewired) {
    line("~", `dbt parity "${parity.name}" rewired:`);
    if (parity.before.left !== parity.after.left || parity.before.right !== parity.after.right)
      console.log(`      models ${parity.before.left}/${parity.before.right} → ${parity.after.left}/${parity.after.right}`);
    if (parity.before.oracle !== parity.after.oracle)
      console.log(`      oracle "${parity.before.oracle}" → "${parity.after.oracle}"`);
  }

  const changed = losses + d.componentsAdded.length + d.invAdded.length + d.boundaryAdded.length + d.boundaryRewired.length
    + d.parityAdded.length + d.parityRewired.length + d.dbtResourcesAdded.length + d.dbtChanged.length
    + d.dbtRelationshipsAdded.length + d.dbtRelationshipsRewired.length
    + d.dbtParitiesAdded.length + d.dbtParitiesRewired.length;
  if (!changed && !d.claimDelta.length) console.log("  no structural change.");
  console.log(`\n  ${changed} structural change(s) · ${losses} loss(es) (removed invariant/boundary/parity/component)`);
  return losses;
}

/** Files changed refA → refB (refB null = the working tree, plus untracked). Paths
 *  relative to cfg.root. The domain the novelty surface scan is scoped to. */
export function changedBetween(cfg: Config, refA: string, refB: string | null): Set<string> {
  const lines = (args: string[]) =>
    (git(args, cfg.root).stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (refB) return new Set(lines(["diff", "--name-only", "--relative", refA, refB]));
  return new Set([
    ...lines(["diff", "--name-only", "--relative", refA]),
    ...lines(["ls-files", "--others", "--exclude-standard"]),
  ]);
}

/** LOC added/deleted refA → refB across CODE files (cfg.codeExt), with cfg.ignore dirs
 *  and binary rows excluded. Untracked files (refB = null) are not counted — the
 *  headline use is a committed ref range. */
export function locDelta(cfg: Config, refA: string, refB: string | null): { added: number; deleted: number } {
  const r = git(["diff", "--numstat", "--relative", refA, ...(refB ? [refB] : [])], cfg.root);
  const extRe = new RegExp(`\\.(${cfg.codeExt.join("|")})$`);
  const ignore = new Set(cfg.ignore);
  let added = 0, deleted = 0;
  for (const line of (r.stdout || "").split("\n")) {
    const m = /^(\d+)\t(\d+)\t(.+)$/.exec(line.trim());
    if (!m) continue; // binary rows are "-\t-\tpath"
    const path = m[3];
    if (!extRe.test(path)) continue;
    if (path.split("/").some((seg) => ignore.has(seg))) continue;
    added += Number(m[1]); deleted += Number(m[2]);
  }
  return { added, deleted };
}

export async function structuralLog(cfg: Config, refA: string, refB: string | null, strict: boolean): Promise<number> {
  // One checkout per ref: derive the graph AND the changed-file domain scan from the
  // same tree (the novelty surface proxies need the file contents at each ref).
  const changed = changedBetween(cfg, refA, refB);
  const at = (ref: string | null) => withTreeAt(cfg, ref, async (root) => ({
    graph: await buildGraph(await loadConfig(root)),
    surface: await scanSurface(root, changed),
  }));
  const before = await at(refA);
  const after = await at(refB);
  const d = diffGraphs(before.graph, after.graph);
  const losses = renderDiff(d, refA, refB ?? "working tree");

  // The novelty-vs-anchor advisory: behavioral surface added vs anchors added. Advisory
  // only — it renders after the ledger and never touches the exit code.
  const sig = surfaceSignals(
    before.surface, after.surface,
    locDelta(cfg, refA, refB),
    { anchorsAdded: d.invAdded.length + d.boundaryAdded.length + d.parityAdded.length + d.dbtParitiesAdded.length, componentsAdded: d.componentsAdded.length },
  );
  renderNovelty(sig, noveltyVerdict(sig, cfg.novelty));

  if (strict && losses) {
    console.log(`\n  ✗ --strict: ${losses} structural loss(es) — a dropped invariant/boundary must be intentional.`);
    return 1;
  }
  return 0;
}
