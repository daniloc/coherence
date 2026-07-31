// promise.ts — the DERIVATION half of the PROMISE GRAPH (`coherence contract`):
// spec grammar + graph + status + git → PromiseModel (src/promise-model.ts is THE contract;
// src/render-contract.ts is the other half). The contract renders a project's OBLIGATIONS —
// the guarantees each component makes at its perimeter (gates) and the guarantees it
// consumes (reliances) — graded and placed on declared trust walls.
//
// Exported pure cores (deriveGates, the reliance double-entry inside assemblePromiseModel)
// so the whole thing is testable without a repo, wrapped by a thin IO shell
// (buildPromiseModel: read zones off the entry spec, stat files for mass, stamp git).
// Three doctrines carry the design:
//
//   TOPOLOGY IS DECLARED. Zones come from the ENTRY spec's `## zones` (declared order = trust
//   order); a gate's `crossing <from> -> <to>` says which wall it sits on; a component's
//   `lives in <zone>` says where it lives. Nothing spatial is invented — an element with no
//   declared place is UNPLACED / UNDECLARED RESIDENCE (visible pressure, never a guess).
//
//   ONE ENFORCED GRADE. Every gate carries a single ordinal (A best … U floor), a TOTAL
//   function of the ONE recorded signal for its claim (see gradeOf). Freshness is judged
//   against the tree's own HEAD.
//
//   DOUBLE-ENTRY RELIANCE. Every cross-component import is one Reliance; a cross-ZONE reliance
//   is COVERED by a gate on that wall or NAKED; and the covering gate lists the reliant back
//   (one fact, two postings). The wall-level COVERING RULE (v1): a reliance crossing {za→zb},
//   za≠zb, is covered iff ANY gate in the model declares crossing {za→zb} exactly — its via is
//   that gate's inv (first by stable order); same-zone reliances need no gate (not naked);
//   undeclared residence at either end ⇒ no crossing ⇒ neither covered nor naked.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config, Graph, GraphNode } from "./types.ts";
import type {
  PromiseModel, PromiseComponent, PromiseGate, Reliance, Zone, Grade,
} from "./promise-model.ts";
import { parseBoundary, claimKey, type ClaimKey } from "./boundary.ts";
import { parseZones, findSpec } from "./walk.ts";
import { gitStamp, indexClaimRecords, type StatusRecord, type ClaimRecord } from "./status.ts";
import { fileStats, claimedFilePaths, type FileStat } from "./tree.ts";

// ── grammar readers (residence + zones) ──────────────────────────────────────────────

/** Residence: a component's `lives in <zone>` claim → its declared zone (null when absent →
 *  UNDECLARED RESIDENCE). First one wins (a component lives in one place). Verify registers
 *  the same form so it grades as a pass, not a dialect-gap skip. */
const RESIDENCE_RE = /^lives in\s+(\S+)$/;
export function residenceOf(claims: string[]): string | null {
  for (const c of claims) { const m = RESIDENCE_RE.exec(c); if (m) return m[1]; }
  return null;
}

/** Read the ENTRY component's `## zones` — the SINGLE HOME of the trust-order declaration
 *  (declared order IS trust order). A `## zones` in any NON-entry spec is never read here, so
 *  it is silently ignored (not an error) — the doctrine kept deliberately simple by only ever
 *  consulting the entry spec. Empty when the entry spec has no zones section. */
export async function readZones(cfg: Config): Promise<Zone[]> {
  const specPath = await findSpec(join(cfg.root, cfg.entryDir === "." ? "" : cfg.entryDir));
  if (!specPath) return [];
  return parseZones(await readFile(specPath, "utf8").catch(() => ""))
    .map((z) => ({ name: z.name, intent: z.intent, inside: z.inside }));
}

// ── the grade doctrine (a TOTAL function of one recorded signal) ──────────────────────

const isStalePass = (r: ClaimRecord, head: string | null) =>
  r.kind === "pass" && head !== null && r.commit !== null && r.commit !== head;

/** GRADE — the enforced ordinal, a total function of the gate's ONE claim record + its verb.
 *  Ordinal A>B>C>D with U as the unassessed FLOOR (below D):
 *    A — `via test`, a machine oracle PASSING at HEAD (fresh, analyzed strength)
 *    B — `via test`, a machine oracle passing but STALE (an aging green, at an older commit)
 *    C — `via guard` with ANY recorded pass (human-judged / source-property; staleness moot)
 *    D — no effective pass: no record, unknown, a FAIL (rides in verdict), or a no-oracle
 *        boundary (a declared perimeter with no evidence)
 *    U — the record shows a SKIP (a dialect gap): the claim exists but the harness could not
 *        even read it. The unassessed floor — rendered ink, never a blank. */
function gradeOf(verb: string, rec: ClaimRecord | undefined, head: string | null): Grade {
  if (rec?.kind === "skip") return "U";                       // a skip is the unassessed floor
  const passed = rec?.kind === "pass";
  if (verb === "test") return passed ? (isStalePass(rec!, head) ? "B" : "A") : "D";
  if (verb === "guard") return passed ? "C" : "D";            // any recorded guard pass → C
  return "D";                                                 // no oracle verb → no evidence
}

/** One gate per boundary claim. verdict is the RAW record (pass/fail/stale/unknown); grade is
 *  the DOCTRINE over it; crossing is the declared wall (null = UNPLACED); freshest is the
 *  newest pass stamp if any; reliants start empty and are POSTED by the reliance pass. */
export function deriveGates(
  claims: string[], label: string, recBy: Map<ClaimKey, ClaimRecord>, head: string | null,
): PromiseGate[] {
  const gates: PromiseGate[] = [];
  for (const claim of claims) {
    const b = parseBoundary(claim);
    if (!b) continue;
    // claimKey strips the crossing clause on BOTH sides of the lookup (the store side does
    // the same): the clause is pure topology, so annotating an existing boundary with a
    // crossing must never orphan its recorded verdict (grade dropping on pure annotation).
    const rec = recBy.get(claimKey(label, claim));
    const verdict: PromiseGate["verdict"] =
      !rec || rec.kind === "skip" ? "unknown"
      : rec.kind === "fail" ? "fail"
      : isStalePass(rec, head) ? "stale"
      : "pass";
    const gate: PromiseGate = {
      inv: b.inv, chokepoint: b.chokepoint, verb: b.verb as PromiseGate["verb"], oracle: b.oracle,
      crossing: b.crossing, grade: gradeOf(b.verb, rec, head), verdict, reliants: [],
    };
    if (rec?.kind === "pass") gate.freshest = rec.at;          // a stale pass still has a stamp
    gates.push(gate);
  }
  return gates;
}

// ── the assembled model (pure over graph + status + stats + zones + head) ─────────────

const crossKey = (from: string, to: string) => `${from}->${to}`;

/** The pure core: fold the graph + status record + per-file stats + declared zones + the HEAD
 *  stamp into a PromiseModel. Components are emitted in spec-tree order (entry "." first, then
 *  dir sort); mass/accounted reuse tree.ts's file-stat + claimed-path machinery (a single
 *  source, no duplication); reliances + reliants are the DOUBLE-ENTRY posting. `review` is
 *  null — the field survives in the model contract for any future against-a-ref surface. */
export function assemblePromiseModel(
  graph: Graph, status: StatusRecord, stats: Map<string, FileStat>, zones: Zone[],
  head: { commit: string | null; dirty: boolean },
): PromiseModel {
  const comps = graph.nodes.filter((n) => n.kind === "component");
  const ordered = [...comps].sort((a, b) => {
    const da = a.id.slice(2), db = b.id.slice(2);
    return da === "." ? -1 : db === "." ? 1 : da < db ? -1 : da > db ? 1 : 0;
  });

  // Ownership: a file node's dir is its parent component. Group files per dir.
  const fileNodes = graph.nodes.filter((n) => n.kind === "file");
  const dirOfFileId = new Map<string, string>();
  for (const f of fileNodes) dirOfFileId.set(f.id, (f.parent ?? "c:.").slice(2));
  const filesByDir = new Map<string, GraphNode[]>();
  for (const f of fileNodes) {
    const k = dirOfFileId.get(f.id)!;
    (filesByDir.get(k) ?? filesByDir.set(k, []).get(k)!).push(f);
  }

  // Cross-component import edges → the reliance adjacency (importer dir → imported dirs).
  // DOCTRINE: type-only imports COUNT as reliance. Under axiom 0 (conceptual coupling) a type
  // dependency is a real reliance — a component shaping its data to another's declared types
  // consumes that component's promise exactly as a value import does; erasure at compile time
  // changes what ships, not what is LEANED ON. So the graph's `imports` edges (which include
  // `import type`) are taken as-is, deliberately.
  const importsByDir = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.kind !== "imports" || !e.source.startsWith("f:") || !e.target.startsWith("f:")) continue;
    const sd = dirOfFileId.get(e.source), td = dirOfFileId.get(e.target);
    if (sd && td && sd !== td) (importsByDir.get(sd) ?? importsByDir.set(sd, new Set()).get(sd)!).add(td);
  }

  const recBy = indexClaimRecords(status.verify?.claims ?? []);
  const linesOf = (p: string) => stats.get(p)?.lines ?? 0;

  // First pass: gates, residence, mass/accounted (relies filled in the second pass).
  const built: PromiseComponent[] = ordered.map((c) => {
    const dir = c.id.slice(2), claims = c.claims ?? [];
    const files = filesByDir.get(dir) ?? [];
    const blessed = claimedFilePaths(claims, files);   // the SAME path rule the scene counts by
    const path = (f: GraphNode) => f.path ?? f.label;
    return {
      label: c.label, dir, intent: c.sub ?? "",
      zone: residenceOf(claims),
      gates: deriveGates(claims, c.label, recBy, head.commit),
      relies: [] as Reliance[],
      mass: { files: files.length, lines: files.reduce((n, f) => n + linesOf(path(f)), 0) },
      accounted: {
        files: blessed.size,
        lines: files.filter((f) => blessed.has(path(f))).reduce((n, f) => n + linesOf(path(f)), 0),
      },
    };
  });

  // The wall-level COVERING RULE: index the FIRST gate (in stable model order) that declares
  // each cross-zone wall {from→to}. "Any gate in the model" — a wall is covered from wherever
  // its gate is declared, not only by the components on either side.
  const zoneByDir = new Map(built.map((c) => [c.dir, c.zone]));
  const coverBy = new Map<string, PromiseGate>();
  for (const c of built) for (const g of c.gates) {
    if (g.crossing && g.crossing.from !== g.crossing.to) {
      const k = crossKey(g.crossing.from, g.crossing.to);
      if (!coverBy.has(k)) coverBy.set(k, g);
    }
  }

  // Second pass: reliances + the double-entry reliants posting.
  const reliantsByGate = new Map<PromiseGate, Set<string>>();
  for (const c of built) {
    const za = zoneByDir.get(c.dir) ?? null;
    c.relies = [...(importsByDir.get(c.dir) ?? [])].sort().map<Reliance>((to) => {
      const zb = zoneByDir.get(to) ?? null;
      if (za === null || zb === null) return { to, crossing: null, via: null }; // undeclared: neither
      if (za === zb) return { to, crossing: { from: za, to: zb }, via: null };  // same-zone: not naked
      const gate = coverBy.get(crossKey(za, zb));
      if (!gate) return { to, crossing: { from: za, to: zb }, via: null };      // cross-zone, NAKED
      (reliantsByGate.get(gate) ?? reliantsByGate.set(gate, new Set()).get(gate)!).add(c.dir);
      return { to, crossing: { from: za, to: zb }, via: gate.inv };             // COVERED
    });
  }
  for (const [gate, set] of reliantsByGate) gate.reliants = [...set].sort();

  const entry = ordered.find((c) => c.id === "c:.") ?? ordered[0];
  return {
    root: graph.root,
    intent: entry?.sub ?? "",
    generatedAt: new Date().toISOString(),
    head: head.commit, dirty: head.dirty,
    zones,
    components: built,
    review: null,
  };
}

/** IO shell: read the entry zones, stat the files (unless handed in), stamp git, assemble. */
export async function buildPromiseModel(
  cfg: Config, graph: Graph, status: StatusRecord, stats?: Map<string, FileStat>,
): Promise<PromiseModel> {
  const s = stats ?? await fileStats(cfg, graph.nodes.filter((n) => n.kind === "file"));
  const zones = await readZones(cfg);
  return assemblePromiseModel(graph, status, s, zones, gitStamp(cfg.root));
}
