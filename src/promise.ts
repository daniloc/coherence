// promise.ts — the DERIVATION half of the PROMISE GRAPH (`coherence contract` / `review`):
// spec grammar + graph + status + git → PromiseModel (src/promise-model.ts is THE contract;
// src/render-contract.ts is the other half). Where the scene renders the project's BODY
// (what code exists, where), the contract renders its OBLIGATIONS — the guarantees each
// component makes at its perimeter (gates) and the guarantees it consumes (reliances) —
// graded, placed on declared trust walls, and diffed as a ledger of typed events.
//
// It mirrors scene.ts's architecture EXACTLY: exported pure cores (deriveGates, the reliance
// double-entry inside assemblePromiseModel, promiseDiff, formatLedger) so the whole thing is
// testable without a repo, wrapped by a thin IO shell (buildPromiseModel: read zones off the
// entry spec, stat files for mass, stamp git) and the base-worktree acquisition it SHARES
// with the scene (withBaseWorktree). Three doctrines carry the design:
//
//   TOPOLOGY IS DECLARED. Zones come from the ENTRY spec's `## zones` (declared order = trust
//   order); a gate's `crossing <from> -> <to>` says which wall it sits on; a component's
//   `lives in <zone>` says where it lives. Nothing spatial is invented — an element with no
//   declared place is UNPLACED / UNDECLARED RESIDENCE (visible pressure, never a guess).
//
//   ONE ENFORCED GRADE. Every gate carries a single ordinal (A best … U floor), a TOTAL
//   function of the ONE recorded signal for its claim (see gradeOf). Freshness is judged
//   against the tree's own HEAD — so a base model built for a review grades each record
//   relative to the BASE commit, which is what makes "the green went stale between base and
//   head" surface as a real demotion instead of noise.
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
  PromiseModel, PromiseComponent, PromiseGate, Reliance, Zone, Grade, PromiseEvent,
} from "./promise-model.ts";
import { parseBoundary, claimKey } from "./boundary.ts";
import { parseZones, findSpec } from "./walk.ts";
import { gitStamp, type StatusRecord, type ClaimRecord } from "./status.ts";
import { fileStats, claimedFilePaths, withBaseWorktree, type FileStat } from "./scene.ts";

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
  claims: string[], label: string, recBy: Map<string, ClaimRecord>, head: string | null,
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
 *  dir sort); mass/accounted reuse the scene's file-stat + claimed-path machinery (a single
 *  source, no duplication); reliances + reliants are the DOUBLE-ENTRY posting. review is null
 *  (a plain contract is diffed against nothing; buildReview populates it). */
export function assemblePromiseModel(
  graph: Graph, status: StatusRecord, stats: Map<string, FileStat>, zones: Zone[],
  head: { commit: string | null; dirty: boolean },
): PromiseModel {
  const comps = graph.nodes.filter((n) => n.kind === "component");
  const ordered = [...comps].sort((a, b) => {
    const da = a.id.slice(2), db = b.id.slice(2);
    return da === "." ? -1 : db === "." ? 1 : da < db ? -1 : da > db ? 1 : 0;
  });

  // Ownership: a file node's dir is its parent component (like scene). Group files per dir.
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

  const recBy = new Map<string, ClaimRecord>();
  for (const r of status.verify?.claims ?? []) recBy.set(claimKey(r.node, r.claim), r);
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

// ── the review ledger — a diff of typed events over the closed vocabulary ─────────────

const GRADE_RANK: Record<Grade, number> = { A: 4, B: 3, C: 2, D: 1, U: 0 };
/** NAKED: a cross-ZONE reliance with no covering gate. (same-zone from===to ⇒ never naked;
 *  crossing null ⇒ undeclared residence, a different exposure, not naked.) */
const isNaked = (r: Reliance): boolean => r.via === null && r.crossing !== null && r.crossing.from !== r.crossing.to;
const crossFT = (c: { from: string; to: string } | null) => (c ? { from: c.from, to: c.to } : {});
const wall = (c: { from: string; to: string } | null) => (c ? ` on the ${c.from}→${c.to} wall` : "");

function demoteReason(bg: PromiseGate, hg: PromiseGate): string {
  if (hg.verdict === "fail") return "its oracle now fails";
  if (hg.grade === "U") return "the record shows only a skip (a dialect gap)";
  if (bg.grade === "A" && hg.grade === "B") return "its green went stale";
  return `grade fell ${bg.grade}→${hg.grade}`;
}
function promoteReason(bg: PromiseGate, hg: PromiseGate): string {
  if (bg.verdict === "fail" && hg.verdict === "pass") return "its oracle now passes";
  if (bg.grade === "B" && hg.grade === "A") return "its stale green refreshed at HEAD";
  // U→D is the honest floor-exit: the skip resolved into a declared-but-unverified gate —
  // legible again, but still carrying no evidence. Higher exits mean a real pass landed.
  if (bg.grade === "U") return hg.grade === "D"
    ? "the claim parses again — no verdict yet"
    : "the harness can read it again and a pass is on record";
  return `grade rose ${bg.grade}→${hg.grade}`;
}

// Event constructors. BLAST doctrine: a gate event carries the AFFECTED GATE's reliants (at
// HEAD for gates that still exist, at BASE for a withdrawn gate — the gate is gone at head, so
// the ledger reads who USED to lean on it). Reliance + component events carry no blast: the
// event's own `comp` already names the party. from/to carry the wall's zones for topology
// events and the grade transition for grade events, so formatLedger prints one uniform "→".
const coveredEvent = (comp: string, g: PromiseGate): PromiseEvent => ({
  kind: "covered", comp, inv: g.inv, ...crossFT(g.crossing),
  detail: `A new gate "${g.inv}" now guards ${g.chokepoint}${wall(g.crossing)}.`,
  blast: [...g.reliants],
});
const withdrawnEvent = (comp: string, g: PromiseGate): PromiseEvent => ({
  kind: "withdrawn", comp, inv: g.inv, ...crossFT(g.crossing),
  detail: `The gate "${g.inv}" at ${g.chokepoint} is gone — its promise is withdrawn.`,
  blast: [...g.reliants],
});
const promotedEvent = (comp: string, bg: PromiseGate, hg: PromiseGate): PromiseEvent => ({
  kind: "promoted", comp, inv: hg.inv, from: bg.grade, to: hg.grade,
  detail: `"${hg.inv}" strengthened from ${bg.grade} to ${hg.grade} — ${promoteReason(bg, hg)}.`,
  blast: [...hg.reliants],
});
const demotedEvent = (comp: string, bg: PromiseGate, hg: PromiseGate): PromiseEvent => ({
  kind: "demoted", comp, inv: hg.inv, from: bg.grade, to: hg.grade,
  detail: `"${hg.inv}" weakened from ${bg.grade} to ${hg.grade} — ${demoteReason(bg, hg)}.`,
  blast: [...hg.reliants],
});
const placedEvent = (comp: string, g: PromiseGate): PromiseEvent => ({
  kind: "placed", comp, inv: g.inv, ...crossFT(g.crossing),
  detail: `"${g.inv}" now declares its wall — it guards the ${g.crossing!.from}→${g.crossing!.to} crossing.`,
  // The gate covered NOTHING while unplaced (crossing null matches no wall), so its head
  // reliants are exactly the reliances this placement newly covers.
  blast: [...g.reliants],
});
const nakedEvent = (comp: string, r: Reliance): PromiseEvent => ({
  kind: "naked", comp, ...crossFT(r.crossing),
  detail: `${comp}'s reliance on ${r.to} crosses ${r.crossing!.from}→${r.crossing!.to} with no gate on that wall.`,
  blast: [],
});
// `prior` names what the reliance was BEFORE coverage: naked (a known wall, no gate) or
// unassessable (undeclared residence — the wall itself was unknown). Coverage gains must
// always leave a ledger trace, whichever uncovered state they climbed out of.
const sealedEvent = (comp: string, r: Reliance, prior: "naked" | "unassessable"): PromiseEvent => ({
  kind: "sealed", comp, ...crossFT(r.crossing),
  detail: `${comp}'s reliance on ${r.to} across ${r.crossing!.from}→${r.crossing!.to} — previously ${
    prior === "naked" ? "naked" : "unassessable (undeclared residence)"} — is now covered by "${r.via}".`,
  blast: [],
});

// Most-severe-first: the alarm cases (a promise weakened/uncovered/withdrawn/razed) lead, the
// reassurances trail (placed/sealed sit with the good-news family — topology/coverage gains).
// Ties break deterministically by comp, then inv, then the wall's target.
const KIND_ORDER: PromiseEvent["kind"][] =
  ["demoted", "naked", "withdrawn", "razed", "promoted", "placed", "sealed", "covered", "arrived", "rezoned"];
function sortEvents(events: PromiseEvent[]): PromiseEvent[] {
  return events.sort((a, b) => {
    const d = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (d) return d;
    if (a.comp !== b.comp) return a.comp < b.comp ? -1 : 1;
    const ai = a.inv ?? "", bi = b.inv ?? "";
    if (ai !== bi) return ai < bi ? -1 : 1;
    return (a.to ?? "") < (b.to ?? "") ? -1 : (a.to ?? "") > (b.to ?? "") ? 1 : 0;
  });
}

/** PURE: the diff of two PromiseModels as typed events from the CLOSED vocabulary. Gates and
 *  reliances are compared only for components present at BOTH ends; a wholly new component is
 *  one `arrived` (its gates/reliances arrive folded in), a vanished one is one `razed` PLUS a
 *  `withdrawn` per gate (its promises are individually gone). Grade rank A>B>C>D>U decides
 *  promote vs demote; naked/sealed track a reliance crossing the naked↔covered boundary. */
export function promiseDiff(head: PromiseModel, base: PromiseModel): PromiseEvent[] {
  const events: PromiseEvent[] = [];
  const baseByDir = new Map(base.components.map((c) => [c.dir, c]));
  const headDirs = new Set(head.components.map((c) => c.dir));

  for (const hc of head.components) {
    const bc = baseByDir.get(hc.dir);
    if (!bc) { events.push({ kind: "arrived", comp: hc.dir, detail: `Component ${hc.dir} appeared.`, blast: [] }); continue; }

    if ((hc.zone ?? null) !== (bc.zone ?? null))
      events.push({
        kind: "rezoned", comp: hc.dir, from: bc.zone ?? "—", to: hc.zone ?? "—",
        detail: `${hc.dir} moved from zone ${bc.zone ?? "(undeclared)"} to ${hc.zone ?? "(undeclared)"}.`, blast: [],
      });

    const baseGates = new Map(bc.gates.map((g) => [g.inv, g]));
    const headGateInvs = new Set(hc.gates.map((g) => g.inv));
    for (const hg of hc.gates) {
      const bg = baseGates.get(hg.inv);
      if (!bg) { events.push(coveredEvent(hc.dir, hg)); continue; }
      // PLACED: the gate existed at both ends and its crossing went null → declared — the
      // promise finally states what it separates. Independent of any grade movement (a gate
      // can be placed AND promoted in one diff — two facts, two events).
      if (!bg.crossing && hg.crossing) events.push(placedEvent(hc.dir, hg));
      const d = GRADE_RANK[hg.grade] - GRADE_RANK[bg.grade];
      if (d > 0) events.push(promotedEvent(hc.dir, bg, hg));
      else if (d < 0) events.push(demotedEvent(hc.dir, bg, hg));
    }
    for (const bg of bc.gates) if (!headGateInvs.has(bg.inv)) events.push(withdrawnEvent(hc.dir, bg));

    const baseRel = new Map(bc.relies.map((r) => [r.to, r]));
    for (const hr of hc.relies) {
      const br = baseRel.get(hr.to);
      const hn = isNaked(hr), bn = br ? isNaked(br) : false;
      // SEALED fires on ANY uncovered→covered move: from naked (a known wall, no gate) OR
      // from unassessable (crossing null — undeclared residence). Coverage gains must always
      // leave a ledger trace; a topology-establishing diff may otherwise read as silent on
      // exactly its gains. A reliance that ARRIVES covered stays quiet (nothing improved).
      const wasUncovered = br ? (bn || br.crossing === null) : false;
      if (hn && !(br && bn)) events.push(nakedEvent(hc.dir, hr));            // newly uncovered
      else if (hr.via !== null && wasUncovered)
        events.push(sealedEvent(hc.dir, hr, bn ? "naked" : "unassessable")); // now covered
    }
  }

  for (const bc of base.components) if (!headDirs.has(bc.dir)) {
    events.push({ kind: "razed", comp: bc.dir, detail: `Component ${bc.dir} vanished.`, blast: [] });
    for (const bg of bc.gates) events.push(withdrawnEvent(bc.dir, bg));
  }

  return sortEvents(events);
}

/** PURE: assemble a REVIEW model — head annotated with `change` (added/removed districts) and
 *  a populated `review`. Mirrors mergeSceneDiff: arrived components flag `added`, razed ones
 *  are injected as `removed`, and the event ledger + outside tally ride in `review`. */
export function buildReview(
  head: PromiseModel, base: PromiseModel, baseRef: string,
  outside: { added: number; removed: number; changed: number },
): PromiseModel {
  const events = promiseDiff(head, base);
  const headDirs = new Set(head.components.map((c) => c.dir));
  const baseDirs = new Set(base.components.map((c) => c.dir));
  const components: PromiseComponent[] = head.components.map((c) =>
    baseDirs.has(c.dir) ? c : { ...c, change: "added" as const });
  for (const bc of base.components) if (!headDirs.has(bc.dir)) components.push({ ...bc, change: "removed" as const });
  return { ...head, components, review: { base: baseRef, events, outside } };
}

/** The repo-relative paths the graph OWNS (every file node's path) — the outside tally
 *  subtracts these so it counts only the change the contract doesn't model. */
export const graphFilePaths = (graph: Graph): Set<string> =>
  new Set(graph.nodes.filter((n) => n.kind === "file").map((f) => f.path ?? f.label));

/** IO shell over withBaseWorktree: materialize `ref` in a throwaway worktree and assemble ITS
 *  PromiseModel. The LIVE status rides through unchanged so each record's freshness is graded
 *  against the BASE commit (gitStamp of the base worktree) — a pass taken at base is fresh
 *  there and stale at head, which is exactly what surfaces "went stale" as a real demotion.
 *  Returns the base model, its owned paths (for the outside tally), and the short base ref. */
export async function derivePromiseBase(
  cfg: Config, ref: string, status: StatusRecord,
): Promise<{ model: PromiseModel; ownedPaths: Set<string>; ref: string }> {
  return withBaseWorktree(cfg, ref, async (baseCfg, baseGraph, short) => {
    const fileNodes = baseGraph.nodes.filter((n) => n.kind === "file");
    const stats = await fileStats(baseCfg, fileNodes);
    const zones = await readZones(baseCfg);
    const model = assemblePromiseModel(baseGraph, status, stats, zones, gitStamp(baseCfg.root));
    return { model, ownedPaths: graphFilePaths(baseGraph), ref: short };
  });
}

/** Deterministic, pipe-safe text of the ledger (`coherence review` prints this). A masthead
 *  line, then one block per event: KIND (padded) · comp: inv · from→to · the detail sentence ·
 *  and the blast line when reliants hold a degraded asset. A steady state prints almost nothing. */
export function formatLedger(model: PromiseModel): string {
  const lines: string[] = [];
  const head = model.head ?? "(no git)";
  const r = model.review;
  if (!r) {
    lines.push(`contract ${model.root} — head ${head} · ${model.components.length} component(s) · ${model.zones.length} zone(s) · no review`);
    return lines.join("\n");
  }
  const o = r.outside;
  const oTail = o.added || o.removed || o.changed ? ` · outside +${o.added} −${o.removed} ~${o.changed}` : "";
  lines.push(`contract ${model.root} — head ${head} vs base ${r.base} · ${r.events.length} event${r.events.length === 1 ? "" : "s"}${oTail}`);
  if (!r.events.length) { lines.push("  (steady state — no contract-relevant change)"); return lines.join("\n"); }
  for (const e of r.events) {
    const heading = e.inv ? `${e.comp}: ${e.inv}` : e.comp;
    const ft = e.from !== undefined && e.to !== undefined ? `  ${e.from}→${e.to}` : "";
    lines.push(`${e.kind.toUpperCase().padEnd(9)} ${heading}${ft}`);
    lines.push(`  ${e.detail}`);
    // The blast line's register follows the event's: an alarm degrades the reliants' asset;
    // a good-news event (promoted/placed/sealed/covered) strengthens or newly covers it.
    const word = e.kind === "demoted" || e.kind === "withdrawn" || e.kind === "naked" || e.kind === "razed"
      ? "a degraded asset" : "a strengthened asset";
    if (e.blast.length) lines.push(`  → ${e.blast.length} reliant${e.blast.length === 1 ? "" : "s"} hold${e.blast.length === 1 ? "s" : ""} ${word}: ${e.blast.join(", ")}`);
  }
  return lines.join("\n");
}
