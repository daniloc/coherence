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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { buildGraph } from "./derive.ts";
import { ownerOf } from "./walk.ts";
import type { Config, Graph, GraphNode } from "./types.ts";

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

/** Map changed files to the component dirs that own them (the deepest spec'd
 *  ancestor — same ownership rule the graph uses). */
export function affectedComponents(graph: Graph, files: Set<string>): Set<string> {
  const dirs = graph.nodes.filter((n) => n.kind === "component").map((n) => n.id.slice(2));
  const hit = new Set<string>();
  for (const f of files) hit.add(ownerOf(f, dirs));
  return hit;
}

const git = (args: string[], cwd: string) =>
  spawnSync("git", args, { cwd, encoding: "utf8" });

const BOUNDARY_RE = /^boundary\s+"([^"]+)"\s+at\s+(\S+)(?:\s+via (test|guard)\s+"([^"]+)")?$/;

export interface Boundary { inv: string; chokepoint: string; verb: string; oracle: string; }
interface Ledger {
  label: string;
  invariants: Set<string>;
  boundaries: Map<string, Boundary>; // keyed by invariant name
  claims: Set<string>;               // non-boundary claims (exists/imports/…)
}

function ledgerOf(node: GraphNode): Ledger {
  const boundaries = new Map<string, Boundary>();
  const claims = new Set<string>();
  for (const c of node.claims ?? []) {
    const m = BOUNDARY_RE.exec(c);
    if (m) boundaries.set(m[1], { inv: m[1], chokepoint: m[2], verb: m[3] ?? "", oracle: m[4] ?? "" });
    else claims.add(c);
  }
  return {
    label: node.label,
    invariants: new Set(node.invariants ?? []),
    boundaries,
    claims,
  };
}

function ledgersOf(graph: Graph): Map<string, Ledger> {
  const out = new Map<string, Ledger>();
  for (const n of graph.nodes) if (n.kind === "component") out.set(n.label, ledgerOf(n));
  return out;
}

/** Build the graph as it exists at a git ref (null = the live working tree). */
export async function graphAtRef(cfg: Config, ref: string | null): Promise<Graph> {
  if (!ref) return buildGraph(cfg);
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
    return await buildGraph(await loadConfig(join(tmp, relProject)));
  } finally {
    git(["worktree", "remove", "--force", tmp], cfg.root);
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export interface StructuralDiff {
  componentsAdded: string[];
  componentsRemoved: string[];
  invAdded: Array<{ comp: string; inv: string }>;
  invRemoved: Array<{ comp: string; inv: string }>;
  boundaryAdded: Array<{ comp: string; b: Boundary }>;
  boundaryRemoved: Array<{ comp: string; b: Boundary }>;
  boundaryRewired: Array<{ comp: string; inv: string; before: Boundary; after: Boundary }>;
  claimDelta: Array<{ comp: string; added: number; removed: number }>;
}

export function diffGraphs(before: Graph, after: Graph): StructuralDiff {
  const A = ledgersOf(before), B = ledgersOf(after);
  const d: StructuralDiff = {
    componentsAdded: [], componentsRemoved: [], invAdded: [], invRemoved: [],
    boundaryAdded: [], boundaryRemoved: [], boundaryRewired: [], claimDelta: [],
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
      else if (prev.chokepoint !== bnd.chokepoint || prev.oracle !== bnd.oracle || prev.verb !== bnd.verb)
        d.boundaryRewired.push({ comp: label, inv, before: prev, after: bnd });
    }
    for (const [inv, bnd] of a.boundaries) if (!b.boundaries.has(inv)) d.boundaryRemoved.push({ comp: label, b: bnd });
    let added = 0, removed = 0;
    for (const c of b.claims) if (!a.claims.has(c)) added++;
    for (const c of a.claims) if (!b.claims.has(c)) removed++;
    if (added || removed) d.claimDelta.push({ comp: label, added, removed });
  }
  return d;
}

const fmtB = (b: Boundary) => `"${b.inv}" at ${b.chokepoint}${b.oracle ? ` via ${b.verb} "${b.oracle}"` : ""}`;

/** Render the diff; return the count of LOSSES (removed invariants/boundaries/components). */
export function renderDiff(d: StructuralDiff, fromLabel: string, toLabel: string): number {
  console.log(`\n  STRUCTURAL LEDGER — ${fromLabel} → ${toLabel}\n`);
  const losses = d.componentsRemoved.length + d.invRemoved.length + d.boundaryRemoved.length;
  const line = (mark: string, s: string) => console.log(`  ${mark} ${s}`);

  if (d.componentsAdded.length) for (const c of d.componentsAdded) line("+", `component ${c}`);
  if (d.componentsRemoved.length) for (const c of d.componentsRemoved) line("–", `component ${c}  (REMOVED)`);

  for (const x of d.invAdded) line("+", `invariant "${x.inv}" (${x.comp})`);
  for (const x of d.invRemoved) line("–", `invariant "${x.inv}" (${x.comp})  (REMOVED — was the spec enforcing something it no longer claims?)`);

  for (const x of d.boundaryAdded) line("+", `boundary ${fmtB(x.b)} (${x.comp})`);
  for (const x of d.boundaryRemoved) line("–", `boundary ${fmtB(x.b)} (${x.comp})  (ANCHOR REMOVED)`);
  for (const x of d.boundaryRewired) {
    line("~", `boundary "${x.inv}" (${x.comp}) rewired:`);
    const cp = x.before.chokepoint !== x.after.chokepoint ? `chokepoint ${x.before.chokepoint} → ${x.after.chokepoint}` : "";
    const or = x.before.oracle !== x.after.oracle || x.before.verb !== x.after.verb
      ? `oracle ${x.before.verb} "${x.before.oracle}" → ${x.after.verb} "${x.after.oracle}"` : "";
    for (const s of [cp, or].filter(Boolean)) console.log(`      ${s}`);
  }

  if (d.claimDelta.length) {
    const tot = d.claimDelta.reduce((n, c) => n + c.added + c.removed, 0);
    console.log(`\n  (${tot} non-boundary claim change(s) across ${d.claimDelta.length} component(s): ${d.claimDelta.map((c) => `${c.comp} +${c.added}/-${c.removed}`).join(", ")})`);
  }

  const changed = losses + d.componentsAdded.length + d.invAdded.length + d.boundaryAdded.length + d.boundaryRewired.length;
  if (!changed && !d.claimDelta.length) console.log("  no structural change.");
  console.log(`\n  ${changed} structural change(s) · ${losses} loss(es) (removed invariant/boundary/component)`);
  return losses;
}

export async function structuralLog(cfg: Config, refA: string, refB: string | null, strict: boolean): Promise<number> {
  const before = await graphAtRef(cfg, refA);
  const after = await graphAtRef(cfg, refB);
  const d = diffGraphs(before, after);
  const losses = renderDiff(d, refA, refB ?? "working tree");
  if (strict && losses) {
    console.log(`\n  ✗ --strict: ${losses} structural loss(es) — a dropped invariant/boundary must be intentional.`);
    return 1;
  }
  return 0;
}
