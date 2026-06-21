// decompose.ts — the wise-decomposition detector (the thermostat).
//
// Coherence already holds two of the three graphs: INTENT (the spec tree) and
// STRUCTURE (the import graph). This adds the third — EVOLUTION (git change-coupling) —
// and measures their AGREEMENT. A wise decomposition is one where the three converge:
// files that change together (Evolution) live together (Structure) under one named
// concern (Intent). Divergence IS sludge, and every classic decomposition smell is a
// specific divergence, surfaced here. Advisory only: it names the candidate; directed
// inference (you) judges the wisdom — a metric can't know your future change.
import { spawnSync } from "node:child_process";
import type { Config, Graph } from "./types.ts";

export const BULK = 40; // a commit touching more than this is mechanical (a rename/migration) — noise, not a concern signal
const HIST = 2000; // commits of history to read

export interface Commit { hash: string; subject: string; files: string[] }

interface Coupling {
  locality: number;            // EVOLUTION∩STRUCTURE: fraction of co-change pairs that stay within one component
  within: number; cross: number;
  pairs: [string, number][];   // top cross-component co-change (false-boundary smell)
  godFiles: [string, number][];// files co-changing across many concerns (missing-abstraction smell)
  hubs: [string, number][];    // STRUCTURE fan-in: components imported by many others (lying-leaf smell)
  commits: number;
}

// EVOLUTION graph, raw: every non-merge commit newest→oldest with its touched files
// and subject. Shared by decompose (all-time coupling) and drift (recent trajectory).
export function readCommitLog(cfg: Config, limit: number): Commit[] {
  const r = spawnSync("git", ["log", `-n${limit}`, "--no-merges", "--name-only", "--pretty=format:%x00%H%x1f%s"], { cwd: cfg.root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) return [];
  const commits: Commit[] = [];
  let cur: Commit | null = null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("\x00")) { if (cur) commits.push(cur); const [hash, subject] = line.slice(1).split("\x1f"); cur = { hash, subject: subject ?? "", files: [] }; }
    else if (line.trim() && cur) cur.files.push(line.trim());
  }
  if (cur) commits.push(cur);
  return commits;
}

// STRUCTURE map: resolve a git-reported path (repo-root-relative) to its component
// label. git reports paths from the REPO root; the graph is relative to cfg.root
// (which may be a subdir), so strip the prefix to line the two address spaces up.
// `fileComp` is the raw graph-path→label map (graph edges are already cfg.root-relative).
export function componentMap(cfg: Config, graph: Graph): { compOf: (gitPath: string) => string | undefined; fileComp: Map<string, string> } {
  const prefix = (spawnSync("git", ["rev-parse", "--show-prefix"], { cwd: cfg.root, encoding: "utf8" }).stdout || "").trim();
  const rel = (p: string): string | null => prefix ? (p.startsWith(prefix) ? p.slice(prefix.length) : null) : p;
  const compLabel = new Map<string, string>();
  for (const n of graph.nodes) if (n.kind === "component") compLabel.set(n.id, n.label);
  const fileComp = new Map<string, string>(); // graph file path → component label
  for (const n of graph.nodes) if (n.kind === "file" && n.path && n.parent) fileComp.set(n.path, compLabel.get(n.parent) ?? n.parent);
  applySubComponents(cfg, fileComp);
  return { compOf: (gitPath) => { const r = rel(gitPath); return r ? fileComp.get(r) : undefined; }, fileComp };
}

// Glob → regex: `**` matches any run (incl. `/`), `*` matches within a path
// segment, everything else is literal.
function globToRe(glob: string): RegExp {
  const esc = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const body = glob.split("**").map((seg) => seg.split("*").map(esc).join("[^/]*")).join(".*");
  return new RegExp("^" + body + "$");
}

// Refine the file→component map with optional config sub-components — decompose/drift
// ONLY. A large spec-component (a deliberate domain core / hub) can declare the
// concerns it actually contains, so co-change WITHIN a concern reads as local instead
// of manufacturing a cross-boundary hub signal. First matching definition wins; files
// matching none keep their spec-component. Does not touch the spec graph or verify.
function applySubComponents(cfg: Config, fileComp: Map<string, string>): void {
  const subs = cfg.components;
  if (!subs?.length) return;
  const compiled = subs.map((s) => ({ name: s.name, res: s.files.map(globToRe) }));
  for (const path of fileComp.keys()) {
    for (const s of compiled) if (s.res.some((re) => re.test(path))) { fileComp.set(path, s.name); break; }
  }
}

function analyze(cfg: Config, graph: Graph): Coupling {
  const { compOf, fileComp } = componentMap(cfg, graph);

  // STRUCTURE: cross-component import fan-in (who imports INTO each component)
  const fanIn = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.kind !== "imports" || !e.source.startsWith("f:") || !e.target.startsWith("f:")) continue;
    const sc = fileComp.get(e.source.slice(2)), tc = fileComp.get(e.target.slice(2));
    if (sc && tc && sc !== tc) { let s = fanIn.get(tc); if (!s) { s = new Set(); fanIn.set(tc, s); } s.add(sc); }
  }

  // EVOLUTION: classify every co-changing file PAIR as within- or cross-component
  const commits = readCommitLog(cfg, HIST).filter((c) => c.files.length >= 2 && c.files.length <= BULK);
  let within = 0, cross = 0;
  const crossPair = new Map<string, number>();
  const fileSpan = new Map<string, Set<string>>();
  for (const c of commits) {
    const fs = c.files.map((f) => ({ f, c: compOf(f) })).filter((x): x is { f: string; c: string } => !!x.c);
    const distinct = [...new Set(fs.map((x) => x.c))];
    for (const { f, c: fc } of fs) { let s = fileSpan.get(f); if (!s) { s = new Set(); fileSpan.set(f, s); } for (const oc of distinct) if (oc !== fc) s.add(oc); }
    for (let a = 0; a < fs.length; a++) for (let b = a + 1; b < fs.length; b++) {
      if (fs[a].c === fs[b].c) within++;
      else { cross++; const key = [fs[a].c, fs[b].c].sort().join("  ⇄  "); crossPair.set(key, (crossPair.get(key) ?? 0) + 1); }
    }
  }

  return {
    locality: within + cross > 0 ? within / (within + cross) : 1,
    within, cross,
    pairs: [...crossPair.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    godFiles: [...fileSpan.entries()].filter(([, s]) => s.size >= 3).map(([f, s]) => [f, s.size] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 8),
    hubs: [...fanIn.entries()].filter(([, s]) => s.size >= 4).map(([c, s]) => [c, s.size] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 8),
    commits: commits.length,
  };
}

export async function decompose(cfg: Config, graph: Graph): Promise<number> {
  // With config sub-components, the effective component count for the analysis is the
  // distinct refined labels (not the spec-node count) — report what the metric sees.
  const comps = cfg.components?.length
    ? new Set(componentMap(cfg, graph).fileComp.values()).size
    : graph.nodes.filter((n) => n.kind === "component").length;
  const a = analyze(cfg, graph);
  console.log(`decomposition — three-graph agreement (Intent · Structure · Evolution)`);
  console.log(`  ${comps} components · ${a.commits} commits analyzed (2–${BULK} files each)`);
  console.log(`  LOCALITY ${(a.locality * 100).toFixed(0)}%  — co-change that stays inside one component (higher = wiser; a decomposition where what changes together lives together)`);
  console.log("");
  if (a.pairs.length) {
    console.log("  cross-boundary co-change  (false-boundary / smeared-concern — do these belong apart?)");
    for (const [pair, n] of a.pairs) console.log(`    ${String(n).padStart(4)}×  ${pair}`);
    console.log("");
  }
  if (a.godFiles.length) {
    console.log("  missing abstraction  (a file pulled into many concerns — extract the join into a declared interface)");
    for (const [f, n] of a.godFiles) console.log(`    ${n} concerns  ${f}`);
    console.log("");
  }
  if (a.hubs.length) {
    console.log("  structure hubs  (imported by many components — confirm the spec frames it as a hub, not a leaf)");
    for (const [c, n] of a.hubs) console.log(`    ${n} importers  ${c}`);
    console.log("");
  }
  if (!a.pairs.length && !a.godFiles.length && !a.hubs.length) console.log("  no decomposition smells surfaced.");
  console.log("  (advisory — these are smells, not verdicts; the metric surfaces, you judge)");
  return 0;
}
