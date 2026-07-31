// scene.ts — the DERIVATION half of `coherence scene`: graph + status record + git →
// SceneModel (src/scene-model.ts is THE contract; src/render-scene.ts is the other
// half). The scene gives the project a persistent spatial BODY so a human PERCEIVES
// it rather than reads it, and the whole illusion rides on one rule:
//
//   STABLE GEOGRAPHY. Lot positions live in an APPEND-ONLY layout file
//   (`<outputDir>/scene-layout.json`). A component, once placed, NEVER moves; a new
//   component takes the next VACANT lot on a fixed outward spiral from (0,0); a
//   removed component's lot stays RESERVED forever (a demolished lot, never reused).
//   Familiarity is the mechanism — change is perceived only against a place that
//   otherwise holds still — so the spiral order and the persisted lots are load-
//   bearing and must be deterministic. The renderer now reads each (x,y) as AXIAL HEX
//   (q=x, r=y) — a component is a hexagonal DISTRICT, each of its files one TRIANGULAR
//   piece — but that is pure reinterpretation: the spiral sequence and the persisted
//   coordinates here are UNCHANGED, so geography stays append-only and stable.
//
//   HONEST MASS. A tower's HEIGHT is its file's LINE count (read from disk), not its
//   symbol count — so 40+ near-symbol-less test files read as the real structures they
//   are instead of identical stubs; symbols stay a card datum. And a claim blesses at
//   MOST ONE file, matched by PATH (a bare basename that names several same-named files
//   in a district blesses NONE) — a district with four `hooks.ts` no longer reads 4/4
//   claimed off one same-named claim. deriveClaimed and derivePieces share that one
//   path-matching rule, so counts and per-tile flags stay exactly consistent.
//
//   THE DIFF IS SPATIAL. A code review renders as change against the SAME stable
//   geography, never as text: `coherence scene --diff <ref>` materializes the base tree
//   in a throwaway git worktree, derives ITS SceneModel (structure only — verification
//   state is meaningful live, so the base is built against an empty status), and merges
//   the two so head grows `change`/`prev*`/`diff`. New structures rise (added), base-only
//   structures stand as ghosts on their still-reserved lots (removed — the layout is
//   append-only, so the lot is present in the current tree too), and a file reads as
//   `changed` when its SYMBOL SET moved OR its CONTENT moved (BODY EDITS REGISTER — a
//   reviewer cannot accept blindness to a prose/logic-only change), with prevSymbols/
//   prevLines carrying the base measurement when the count/height moved. The map NEVER
//   SILENTLY TRUNCATES: changed files OUTSIDE the graph (scripts/CI/docs) are counted in
//   diff.outside. The merge is a PURE function over two models plus each end's per-file
//   symbol-label sets + content stats (lines+hash), so it is testable without git; only
//   base acquisition (deriveBaseModel) and the outside tally (deriveOutside) are IO. A
//   plain scene carries diff:null and no flags.
//
// The pure core (assignLots, deriveClaimed/Gates/Light, mergeSceneDiff, outsideTally) is
// exported so the derivation is testable without a repo; buildSceneModel, deriveBaseModel,
// fileStats, and deriveOutside are the thin IO shells (layout read/write, git stamp, git
// churn, base worktree, disk reads) around it.
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, basename, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Config, Graph, GraphNode } from "./types.ts";
import type { SceneModel, SceneComponent, SceneDiff, SceneGate, SceneLight, ScenePiece } from "./scene-model.ts";
import { parseBoundary, claimKey } from "./boundary.ts";
import { ownerOf } from "./walk.ts";
import { gitStamp, type StatusRecord, type ClaimRecord } from "./status.ts";
import { componentMap } from "./decompose.ts";
import { readCommitLog, componentChurn, CHURN_WINDOW } from "./evolution.ts";
import { loadConfig } from "./config.ts";
import { buildGraph } from "./derive.ts";

// ── the append-only geography ───────────────────────────────────────────────────────

export interface Lot { x: number; y: number }
export interface Layout { lots: Record<string, Lot> }

export const layoutPath = (cfg: Config) => join(cfg.root, cfg.outputDir, "scene-layout.json");

export async function readLayout(cfg: Config): Promise<Layout> {
  try { const l = JSON.parse(await readFile(layoutPath(cfg), "utf8")) as Layout; return l?.lots ? { lots: l.lots } : { lots: {} }; }
  catch { return { lots: {} }; }
}

// Ulam-style outward spiral from (0,0): (0,0),(1,0),(1,1),(0,1),(-1,1),(-1,0),… The
// ENTIRE stability guarantee rides on this order never changing, so it is a fixed
// infinite sequence, NEVER reseeded from current occupancy — occupancy only decides
// which yielded cells are skipped.
export function* spiral(): Generator<Lot> {
  let x = 0, y = 0, d = 1, m = 1;
  yield { x, y };
  for (;;) {
    while (2 * x * d < m) { x += d; yield { x, y }; }
    while (2 * y * d < m) { y += d; yield { x, y }; }
    d = -d; m++;
  }
}

// PURE core. Copy existing placements VERBATIM (append-only), never prune removed dirs
// (a reserved lot keeps its cell occupied so it is never reused), and hand each unplaced
// dir the next spiral cell not already taken. Entry "." is placed FIRST so it claims the
// plaza (0,0) on a fresh geography; the rest go in lexicographic order — a fixed order so
// a given set of newcomers always lands on the same cells regardless of graph iteration.
export function assignLots(existing: Record<string, Lot>, dirs: string[]): { lots: Record<string, Lot>; added: boolean } {
  const lots: Record<string, Lot> = { ...existing };
  const occupied = new Set(Object.values(lots).map((p) => `${p.x},${p.y}`));
  const need = dirs.filter((d) => !(d in lots)).sort((a, b) => (a === "." ? -1 : b === "." ? 1 : a < b ? -1 : a > b ? 1 : 0));
  if (!need.length) return { lots, added: false };
  const gen = spiral();
  for (const dir of need) {
    let cell = gen.next().value as Lot;
    while (occupied.has(`${cell.x},${cell.y}`)) cell = gen.next().value as Lot;
    lots[dir] = cell;
    occupied.add(`${cell.x},${cell.y}`);
  }
  return { lots, added: true };
}

// Grid extents = the bounding box of ALL assigned lots (reserved ones included — a
// demolished lot still shapes the site's footprint).
function extents(lots: Record<string, Lot>): { cols: number; rows: number } {
  const ps = Object.values(lots);
  if (!ps.length) return { cols: 0, rows: 0 };
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  return { cols: Math.max(...xs) - Math.min(...xs) + 1, rows: Math.max(...ys) - Math.min(...ys) + 1 };
}

// ── per-component derivations (pure, head-injectable for tests) ──────────────────────

const isStalePass = (r: ClaimRecord, head: string | null) => r.kind === "pass" && head !== null && r.commit !== null && r.commit !== head;

/** A path-qualified claim token matches when its `/`-segments equal the file path's
 *  TRAILING segments: `documents/hooks.ts` matches `…/features/documents/hooks.ts` but
 *  NOT `…/pages/hooks.ts`. So a claim that names a specific sub-path blesses exactly the
 *  file it means, never every same-named sibling. */
const suffixMatch = (path: string, token: string): boolean => {
  const ps = path.split("/"), ts = token.split("/");
  if (ps.length < ts.length) return false;
  return ps.slice(ps.length - ts.length).every((s, i) => s === ts[i]);
};

/** The ONE definition of which of a component's FILES a claim blesses — matched by PATH,
 *  blessing at MOST ONE file per claim token, NEVER over-reporting coverage. A file is
 *  named via `<file> exists at …` or `<file> imports …`; a boundary claim names a
 *  chokepoint SYMBOL (skipped here), and typechecks/passes test/responds/conforms name
 *  neither. The file token is resolved against the component's REAL paths:
 *    · a token WITH a `/` → PATH-SUFFIX match (segments == the path's trailing segments);
 *    · a BARE basename    → matches only if EXACTLY ONE file carries that basename.
 *  Either way, if a token has several candidates it blesses NONE — a district with four
 *  `hooks.ts` no longer reads 4/4 claimed off a single `manifest.ts` claim. deriveClaimed
 *  and derivePieces both read this ONE set, so a tile is claimed iff the file counts as
 *  claimed — pieces sum exactly to claimed.files. */
export function claimedFilePaths(claims: string[], files: GraphNode[]): Set<string> {
  const paths = files.map((f) => f.path ?? f.label);
  const blessed = new Set<string>();
  for (const claim of claims) {
    if (parseBoundary(claim)) continue;
    const m = /^(\S+)\s+(?:exists at|imports)\b/.exec(claim);
    if (!m) continue;
    const token = m[1];
    const cands = token.includes("/")
      ? paths.filter((p) => suffixMatch(p, token))
      : paths.filter((p) => basename(p) === token);
    if (cands.length === 1) blessed.add(cands[0]);   // ambiguous (0 or >1) → bless nothing
  }
  return blessed;
}

/** The claimed WIREFRAME: which of a component's files/symbols any claim actually names.
 *  Files come from claimedFilePaths (the shared path rule); a boundary claim names its
 *  chokepoint SYMBOL. Surface claims name neither — so mass they don't cover renders
 *  outside the amber. claimed.files = the blessed set's size (files.length minus the
 *  uncovered), so it agrees tile-for-tile with derivePieces. */
export function deriveClaimed(claims: string[], files: GraphNode[], syms: GraphNode[]): Pick<SceneComponent, "mass" | "claimed" | "unclaimedSample"> {
  const blessed = claimedFilePaths(claims, files);
  const claimedSyms = new Set<string>();
  for (const claim of claims) { const b = parseBoundary(claim); if (b) claimedSyms.add(b.chokepoint); }
  const uncoveredFiles = files.filter((f) => !blessed.has(f.path ?? f.label)).map((f) => f.label);
  const uncoveredSyms = syms.filter((s) => !claimedSyms.has(s.label)).map((s) => s.label);
  return {
    mass: { files: files.length, symbols: syms.length },
    claimed: { files: files.length - uncoveredFiles.length, symbols: syms.length - uncoveredSyms.length },
    unclaimedSample: [...uncoveredFiles, ...uncoveredSyms].slice(0, 12),
  };
}

/** The district's triangular towers: ONE per file, sorted by label so within-district
 *  geography is stable. `claimed` reads claimedFilePaths — the SAME rule deriveClaimed
 *  counts by — so the towers sum exactly to claimed.files / mass.files. `path` is the
 *  file's repo-relative path (the diff key + full name); `lines` (from `stats`) is the
 *  file's own line count — the tower's HEIGHT (honest mass), so a 200-line test with no
 *  exports is a real structure, not a stub; `symbols` is THAT FILE's own declaration
 *  count (a card datum), counted per-file, NOT the component's total. */
export function derivePieces(claims: string[], files: GraphNode[], syms: GraphNode[], stats: Map<string, FileStat>): ScenePiece[] {
  const blessed = claimedFilePaths(claims, files);
  const perFile = new Map<string, number>();
  for (const s of syms) { const k = s.path ?? s.label; perFile.set(k, (perFile.get(k) ?? 0) + 1); }
  return files
    .map((f) => {
      const path = f.path ?? f.label;
      return { label: f.label, path, lines: stats.get(path)?.lines ?? 0, symbols: perFile.get(path) ?? 0, claimed: blessed.has(path) };
    })
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** Per-file content STATS keyed by repo-relative path: the LINE count (tower height) and a
 *  content HASH (the body-edit signal for the diff). The tower-height driver and the review's
 *  "body edits register" rule both read from disk here — the only IO in the mass/diff path.
 *  Unreadable or binary (a NUL byte) → 0 lines; the hash is still taken from the raw bytes so
 *  a body edit to a binary would register. `lines` counts NEWLINES (join(cfg.root, path)). */
export interface FileStat { lines: number; hash: string }
export async function fileStats(cfg: Config, files: GraphNode[]): Promise<Map<string, FileStat>> {
  const out = new Map<string, FileStat>();
  await Promise.all(files.map(async (f) => {
    const path = f.path ?? f.label;
    try {
      const buf = await readFile(join(cfg.root, path));
      const hash = createHash("sha1").update(buf).digest("hex");
      const binary = buf.includes(0);
      let lines = 0;
      if (!binary) for (const b of buf) if (b === 0x0a) lines++;   // count '\n'
      out.set(path, { lines, hash });
    } catch { out.set(path, { lines: 0, hash: "" }); }
  }));
  return out;
}

/** Per-file symbol-LABEL sets, keyed by the file's path (a symbol's `path` IS its file's
 *  path). The diff merge compares these SETS end-to-end: a file registers as `changed`
 *  only when its symbol set moved, so a body-only edit that renames/adds/removes no symbol
 *  does not — models carry only symbol COUNTS, so the sets are derived from the graph here. */
export function symbolSetsByFile(graph: Graph): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const n of graph.nodes) {
    if (n.kind !== "symbol") continue;
    const k = n.path ?? n.label;
    (m.get(k) ?? m.set(k, new Set<string>()).get(k)!).add(n.label);
  }
  return m;
}

/** One gate per boundary claim. verdict comes from the status record (node label +
 *  verbatim claim); MATERIAL encodes the enforcement ladder from claims + verdicts ALONE
 *  (no atlas): breached = the gate isn't holding (fail); steel = an oracle whose last
 *  verdict passed at HEAD; scaffold = everything else (no oracle, never verified, or an
 *  aging green at another commit — visibly temporary construction). */
export function deriveGates(claims: string[], label: string, recBy: Map<string, ClaimRecord>, head: string | null): SceneGate[] {
  const gates: SceneGate[] = [];
  for (const claim of claims) {
    const b = parseBoundary(claim);
    if (!b) continue;
    // claimKey normalizes the crossing clause away on BOTH sides (store + read), so
    // annotating a boundary with a crossing never orphans its recorded verdict.
    const rec = recBy.get(claimKey(label, claim));
    const verdict: SceneGate["verdict"] =
      !rec || rec.kind === "skip" ? "unknown"
      : rec.kind === "fail" ? "fail"
      : isStalePass(rec, head) ? "stale"
      : "pass";
    const material: SceneGate["material"] =
      verdict === "fail" ? "breached"
      : verdict === "pass" && b.verb !== "" ? "steel"
      : "scaffold";
    gates.push({ inv: b.inv, chokepoint: b.chokepoint, verb: b.verb as SceneGate["verb"], oracle: b.oracle, material, verdict, humanEye: b.verb === "guard" });
  }
  return gates;
}

/** Illumination = verification recency. lit = a pass at the current HEAD; dim = passes
 *  exist but all at older commits; dark = nothing ever verified. fails/stale flare
 *  independently, and freshest is the newest pass's stamp. */
export function deriveLight(records: ClaimRecord[], head: string | null): SceneLight {
  const passes = records.filter((r) => r.kind === "pass");
  const stale = passes.filter((r) => isStalePass(r, head)).length;
  const level: SceneLight["level"] = passes.some((r) => !isStalePass(r, head)) ? "lit" : passes.length ? "dim" : "dark";
  const freshest = passes.reduce<string | undefined>((best, r) => (!best || r.at > best ? r.at : best), undefined);
  return { level, fails: records.filter((r) => r.kind === "fail").length, stale, freshest };
}

// ── the IO shell: assemble the model ─────────────────────────────────────────────────

export async function buildSceneModel(cfg: Config, graph: Graph, status: StatusRecord, stats?: Map<string, FileStat>): Promise<SceneModel> {
  const comps = graph.nodes.filter((n) => n.kind === "component");
  const compDirs = comps.map((c) => c.id.slice(2));

  // Geography: read → append-only assign → write back ONLY if a new lot was taken.
  const layout = await readLayout(cfg);
  const { lots, added } = assignLots(layout.lots, compDirs);
  if (added) {
    await mkdir(join(cfg.root, cfg.outputDir), { recursive: true });
    await writeFile(layoutPath(cfg), JSON.stringify({ lots }, null, 2) + "\n");
  }

  const head = gitStamp(cfg.root);

  // Ownership: files parent → component dir (reliable in both real graph and fixtures);
  // symbols resolve through their parent file, or via ownerOf(path) when unparented.
  const fileNodes = graph.nodes.filter((n) => n.kind === "file");
  const symNodes = graph.nodes.filter((n) => n.kind === "symbol");
  // Tower heights: caller may hand in the content stats (single disk read, reused by the
  // diff path); otherwise read them here. Keyed by path, so one map serves every district.
  const fileStatsMap = stats ?? await fileStats(cfg, fileNodes);
  const dirOfFileId = new Map<string, string>();
  for (const f of fileNodes) dirOfFileId.set(f.id, (f.parent ?? "c:.").slice(2));
  const filesByDir = new Map<string, GraphNode[]>(), symsByDir = new Map<string, GraphNode[]>();
  const push = (m: Map<string, GraphNode[]>, k: string, v: GraphNode) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  for (const f of fileNodes) push(filesByDir, dirOfFileId.get(f.id)!, f);
  for (const s of symNodes) push(symsByDir, dirOfFileId.get(s.parent ?? "") ?? ownerOf(s.path ?? "", compDirs), s);

  // Adjacency: cross-component imports (file → file across a boundary).
  const linksByDir = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.kind !== "imports" || !e.source.startsWith("f:") || !e.target.startsWith("f:")) continue;
    const sd = dirOfFileId.get(e.source), td = dirOfFileId.get(e.target);
    if (sd && td && sd !== td) { const s = linksByDir.get(sd) ?? new Set(); s.add(td); linksByDir.set(sd, s); }
  }

  // HEAT: share of recent commits (≤BULK files, like drift) touching each component,
  // normalized against the busiest. No history (or not a repo) → all cold. The loop that
  // was inline here is `componentChurn` in src/evolution.ts, and the window that was a
  // bare `200` is `CHURN_WINDOW` — same numbers, one home (see that file's header).
  const { compOf } = componentMap(cfg, graph);
  const churn = componentChurn(compOf, readCommitLog(cfg, CHURN_WINDOW));
  const maxChurn = Math.max(0, ...churn.values());

  const recBy = new Map<string, ClaimRecord>();
  for (const r of status.verify?.claims ?? []) recBy.set(claimKey(r.node, r.claim), r);
  const records = status.verify?.claims ?? [];
  // Unanchored invariants: the record's gap list is authoritative once a verify has run
  // (it sees anchoring through `conforms to` words); a static parse is the cold-start
  // fallback so a never-verified tree still shows its ratchet reds — same as panel.ts.
  const gapsByComp = new Map<string, string[]>();
  if (status.verify) for (const g of status.verify.invariants.gaps) gapsByComp.set(g.comp, [...(gapsByComp.get(g.comp) ?? []), g.inv]);

  const components: SceneComponent[] = comps.map((c) => {
    const dir = c.id.slice(2), claims = c.claims ?? [];
    const files = filesByDir.get(dir) ?? [], syms = symsByDir.get(dir) ?? [];
    const anchored = new Set(claims.map(parseBoundary).filter((b): b is NonNullable<typeof b> => !!b).map((b) => b.inv));
    const staticGaps = (c.invariants ?? []).filter((i) => !anchored.has(i));
    return {
      label: c.label, dir, intent: c.sub ?? "", why: c.why ?? "",
      lot: lots[dir],
      ...deriveClaimed(claims, files, syms),
      pieces: derivePieces(claims, files, syms, fileStatsMap),
      gates: deriveGates(claims, c.label, recBy, head.commit),
      unanchored: status.verify ? (gapsByComp.get(c.label) ?? []) : staticGaps,
      light: deriveLight(records.filter((r) => r.node === c.label), head.commit),
      heat: maxChurn ? Math.min(1, (churn.get(c.label) ?? 0) / maxChurn) : 0,
      links: [...(linksByDir.get(dir) ?? [])].sort(),
    };
  });

  const entry = comps.find((c) => c.id === "c:.") ?? comps[0];
  const v = status.verify;
  return {
    root: graph.root,
    intent: entry?.sub ?? "",
    generatedAt: new Date().toISOString(),
    head: head.commit, dirty: head.dirty,
    grid: extents(lots),
    components,
    verify: v ? { lastFastAt: v.lastFastAt, lastFullAt: v.lastFullAt, failures: v.failures } : null,
    diff: null,   // a plain scene is diffed against nothing; --diff replaces this via mergeSceneDiff
  };
}

// ── the spatial diff: base acquisition (IO) + the pure merge ─────────────────────────

/** Materialize the base tree in a THROWAWAY git worktree and derive its SceneModel, so a
 *  review renders against the same geography. Structure is what matters here, so the base
 *  is built against an EMPTY status ({version:1}) — verification light/heat is only
 *  meaningful for the LIVE tree. Layout note: scene-layout.json is committed + append-only,
 *  so the base tree's lots agree with the current tree's for shared dirs — no reconciliation.
 *  The base derivation's ONLY writes (a new lot in scene-layout.json) land in the discarded
 *  tmpdir (baseCfg.root = tmp), never the current tree. ALWAYS tears the worktree down. */
export async function deriveBaseModel(
  cfg: Config,
  ref: string,
): Promise<{ model: SceneModel; end: DiffEnd; ref: string }> {
  return withBaseWorktree(cfg, ref, async (baseCfg, baseGraph, short) => {
    // Base line/content stats come from the base WORKTREE on disk — read ONCE and threaded
    // into both the base model (tower heights) and the merge (prevLines + body-edit signal).
    const stats = await fileStats(baseCfg, baseGraph.nodes.filter((n) => n.kind === "file"));
    const model = await buildSceneModel(baseCfg, baseGraph, { version: 1 }, stats);
    return { model, end: { syms: symbolSetsByFile(baseGraph), stats }, ref: short };
  });
}

/** The SHARED base-tree acquisition both the scene and the promise graph ride on: resolve
 *  `ref`, materialize it in a THROWAWAY detached git worktree, load ITS config + build ITS
 *  graph, hand them to `fn`, and ALWAYS tear the worktree down. The ref is resolved FIRST —
 *  the clean gate for "not a repo / unknown ref" before any worktree machinery — and its
 *  short sha is passed to `fn` (the base ref a review records). Every write `fn` triggers
 *  (e.g. a new lot in scene-layout.json) lands in the discarded tmpdir, never the live tree.
 *  Extracting this keeps the two layers from re-deriving (and drifting on) worktree teardown. */
export async function withBaseWorktree<T>(
  cfg: Config,
  ref: string,
  fn: (baseCfg: Config, baseGraph: Graph, shortRef: string) => Promise<T>,
): Promise<T> {
  const rp = spawnSync("git", ["rev-parse", "--short", ref], { cwd: cfg.root, encoding: "utf8" });
  if (rp.status !== 0) throw new Error(`cannot resolve '${ref}' (not a git repo, or unknown ref)`);
  const short = rp.stdout.trim();

  const tmp = await mkdtemp(join(tmpdir(), "coh-base-"));
  try {
    const add = spawnSync("git", ["worktree", "add", "--detach", tmp, ref], { cwd: cfg.root, encoding: "utf8" });
    if (add.status !== 0) throw new Error(`git worktree add failed: ${(add.stderr || "").trim()}`);
    // The coherence root may be a SUBDIRECTORY of the git repo (a sub-package with its own
    // coherence.config.json). The worktree materializes the WHOLE repo, so the base config
    // must be loaded from the SAME subdirectory inside it — loading from the worktree top
    // would fall back to defaults rooted at the repo top-level, prefix every base component
    // dir with the subdir, and make every diff a total razed/arrived storm. realpath both
    // ends because `git rev-parse --show-toplevel` returns the canonical path (e.g. macOS
    // /tmp → /private/tmp) while cfg.root may be the symlinked spelling.
    const tl = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: cfg.root, encoding: "utf8" });
    const rel = tl.status === 0 ? relative(realpathSync(tl.stdout.trim()), realpathSync(resolve(cfg.root))) : "";
    const baseCfg = await loadConfig(rel && !rel.startsWith("..") ? join(tmp, rel) : tmp);
    const baseGraph = await buildGraph(baseCfg);
    return await fn(baseCfg, baseGraph, short);
  } finally {
    // Tear down unconditionally: --force removes even a dirty worktree; prune cleans the
    // administrative ref if remove ever half-fails; rm sweeps the dir itself.
    spawnSync("git", ["worktree", "remove", "--force", tmp], { cwd: cfg.root, encoding: "utf8" });
    spawnSync("git", ["worktree", "prune"], { cwd: cfg.root, encoding: "utf8" });
    await rm(tmp, { recursive: true, force: true });
  }
}

const setsEqual = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
};
const EMPTY_SET: Set<string> = new Set();
const byLabel = (a: { label: string }, b: { label: string }) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);

/** One END of a diff: the per-file symbol-LABEL sets (structure signal) and content STATS
 *  (lines + hash — the height and the body-edit signal), both keyed by repo-relative path.
 *  Bundled so the pure merge takes one object per side instead of four loose maps. */
export interface DiffEnd { syms: Map<string, Set<string>>; stats: Map<string, FileStat> }

/** Merge the base pieces of ONE matched component into the head component: a head-only
 *  file is `added`; a base-only file is injected as a `removed` ghost carrying its BASE
 *  measurements; a file present at both is `changed` when its SYMBOL SET moved OR its
 *  CONTENT moved (BODY EDITS REGISTER — a content-only edit with an unchanged symbol set
 *  is still a change; a reviewer cannot be blind to prose). prevSymbols carries the base
 *  count when the height-by-symbols moved; prevLines the base line count when the
 *  tower height moved. A rename inside the symbol set (equal counts, same line count)
 *  reads as changed with NO prev*. Label sort is preserved so ghost tiles sit in stable
 *  within-district geography. */
function diffPieces(hc: SceneComponent, bc: SceneComponent, head: DiffEnd, base: DiffEnd): ScenePiece[] {
  const baseByPath = new Map(bc.pieces.map((p) => [p.path, p]));
  const headPaths = new Set(hc.pieces.map((p) => p.path));
  const out: ScenePiece[] = hc.pieces.map((hp) => {
    const bp = baseByPath.get(hp.path);
    if (!bp) return { ...hp, change: "added" as const };
    const symbolsMoved = !setsEqual(head.syms.get(hp.path) ?? EMPTY_SET, base.syms.get(hp.path) ?? EMPTY_SET);
    const contentMoved = (head.stats.get(hp.path)?.hash ?? "") !== (base.stats.get(hp.path)?.hash ?? "");
    if (!symbolsMoved && !contentMoved) return hp; // unchanged in BOTH structure and body
    const piece: ScenePiece = { ...hp, change: "changed" };
    if (hp.symbols !== bp.symbols) piece.prevSymbols = bp.symbols;
    if (hp.lines !== bp.lines) piece.prevLines = bp.lines;
    return piece;
  });
  for (const bp of bc.pieces) if (!headPaths.has(bp.path)) out.push({ ...bp, change: "removed" });
  return out.sort(byLabel);
}

/** The PURE spatial diff: annotate the CURRENT model with change against the base, keyed
 *  by `dir` (components) and `path` (pieces). Head-only district → `added`; base-only
 *  district → the whole base component injected as a `removed` ghost on its still-reserved
 *  lot (append-only geography → the lot exists in the current layout too), carrying its
 *  BASE pieces/mass so the ghost has honest shape; a matched district gets its pieces
 *  diffed. `outside` (the out-of-graph change tally, from deriveOutside) is threaded into
 *  model.diff so the map never silently truncates. model.diff records the short base ref —
 *  the flag that makes this a REVIEW scene. */
export function mergeSceneDiff(
  head: SceneModel,
  base: SceneModel,
  headEnd: DiffEnd,
  baseEnd: DiffEnd,
  baseRef: string,
  outside: SceneDiff["outside"] = { added: 0, removed: 0, changed: 0 },
): SceneModel {
  const baseByDir = new Map(base.components.map((c) => [c.dir, c]));
  const headDirs = new Set(head.components.map((c) => c.dir));
  const components: SceneComponent[] = head.components.map((hc) => {
    const bc = baseByDir.get(hc.dir);
    return bc ? { ...hc, pieces: diffPieces(hc, bc, headEnd, baseEnd) } : { ...hc, change: "added" as const };
  });
  for (const bc of base.components) if (!headDirs.has(bc.dir)) components.push({ ...bc, change: "removed" as const });
  return { ...head, components, diff: { base: baseRef, outside } };
}

/** The set of repo-relative paths the GRAPH owns — every piece path at EITHER end. The
 *  outside tally subtracts these so it counts ONLY the files the scene doesn't model. */
export function graphPaths(head: SceneModel, base: SceneModel): Set<string> {
  const s = new Set<string>();
  for (const m of [head, base]) for (const c of m.components) for (const p of c.pieces) s.add(p.path);
  return s;
}

/** PURE: tally the changed files OUTSIDE the graph from `git diff --name-status` output.
 *  A → added, D → removed, everything else (M, and R/C renames/copies) → changed. An entry
 *  whose path (either the old or the new for a rename) is graph-owned is DROPPED — those
 *  are the scene's own towers, already drawn. What's left is scripts/CI/docs the graph
 *  never modeled — counted so the renderer can badge "N changes outside the map". */
export function outsideTally(nameStatus: string, owned: Set<string>): SceneDiff["outside"] {
  let added = 0, removed = 0, changed = 0;
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    if (paths.some((p) => owned.has(p))) continue;   // the graph draws this one already
    const code = status[0];
    if (code === "A") added++;
    else if (code === "D") removed++;
    else changed++;                                   // M, R…, C…, T → a change
  }
  return { added, removed, changed };
}

/** IO shell over outsideTally: run `git diff --name-status <base> HEAD` and tally what the
 *  graph does NOT own. A non-repo / failed diff yields an all-zero tally (nothing to badge). */
export function deriveOutside(cfg: Config, baseRef: string, owned: Set<string>): SceneDiff["outside"] {
  const r = spawnSync("git", ["diff", "--name-status", baseRef, "HEAD"], { cwd: cfg.root, encoding: "utf8" });
  if (r.status !== 0) return { added: 0, removed: 0, changed: 0 };
  return outsideTally(r.stdout, owned);
}

/** Roll up a diffed model's per-file change tallies for the CLI one-liner: added,
 *  removed, changed FILES. A wholly added/removed district contributes all its tiles. */
export function diffTally(model: SceneModel): { added: number; removed: number; changed: number } {
  let added = 0, removed = 0, changed = 0;
  for (const c of model.components) {
    if (c.change === "added") { added += c.pieces.length; continue; }
    if (c.change === "removed") { removed += c.pieces.length; continue; }
    for (const p of c.pieces) {
      if (p.change === "added") added++;
      else if (p.change === "removed") removed++;
      else if (p.change === "changed") changed++;
    }
  }
  return { added, removed, changed };
}
