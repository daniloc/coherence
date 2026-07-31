// scene.test.ts — the DERIVATION half of `coherence scene`. The load-bearing, rot-prone
// logic: the APPEND-ONLY geography (a placed lot never moves; a demolished lot's cell is
// never reused), the claimed WIREFRAME (which files/symbols a claim actually names), the
// per-file triangular PIECES (one tile per file, claimed mirroring the wireframe so tiles
// sum to claimed.files/mass.files), the gate MATERIAL ladder (steel/scaffold/breached from
// verdicts alone), LIGHT levels
// (lit/dim/dark from verification recency), and cross-component adjacency. The IO shell
// (layout persistence) is exercised through buildSceneModel on a temp project; the pure
// derivations are unit-tested directly with an injected HEAD so staleness is controllable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSceneModel, deriveGates, deriveLight, readLayout, mergeSceneDiff, diffTally, deriveBaseModel, symbolSetsByFile, graphPaths } from "../src/scene.ts";
import type { DiffEnd } from "../src/scene.ts";
import { outsideTally, deriveOutside, fileStats, type FileStat } from "../src/tree.ts";
import { buildGraph } from "../src/derive.ts";
import type { ClaimRecord, StatusRecord } from "../src/status.ts";
import type { SceneModel, SceneComponent, ScenePiece } from "../src/scene-model.ts";
import { comp, sym, fileNode, imp, graph, cfg, tmpProject, cleanup } from "./_helpers.ts";

const EMPTY: StatusRecord = { version: 1 };

// ── hand-built model factories for the PURE diff merge (no git, no graph) ────────────
// A tower's HEIGHT is `lines`; default it to the symbol count so terse fixtures still carry
// a plausible height, override via `over` when a test asserts prevLines.
const piece = (label: string, symbols: number, over: Partial<ScenePiece> = {}): ScenePiece =>
  ({ label, path: `d/${label}`, lines: symbols, symbols, claimed: false, ...over });
const scomp = (dir: string, pieces: ScenePiece[], over: Partial<SceneComponent> = {}): SceneComponent => ({
  label: dir, dir, intent: "", why: "", lot: { x: 0, y: 0 },
  mass: { files: pieces.length, symbols: pieces.reduce((n, p) => n + p.symbols, 0) },
  claimed: { files: 0, symbols: 0 }, pieces, unclaimedSample: [], gates: [], unanchored: [],
  light: { level: "dark", fails: 0, stale: 0 }, heat: 0, links: [], ...over,
});
const smodel = (components: SceneComponent[]): SceneModel => ({
  root: "test", intent: "", generatedAt: "", head: "head", dirty: false,
  grid: { cols: 1, rows: 1 }, components, verify: null, diff: null,
});
// Symbol-LABEL sets keyed by piece.path — the diff's structure signal.
const symSets = (m: Record<string, string[]>): Map<string, Set<string>> =>
  new Map(Object.entries(m).map(([k, v]) => [k, new Set(v)]));
// Content stats keyed by piece.path — the merge reads only the HASH here (the body-edit
// signal); prevLines comes from the pieces' own `lines`, so stats' lines are left 0.
const st = (m: Record<string, string>): Map<string, FileStat> =>
  new Map(Object.entries(m).map(([k, hash]) => [k, { lines: 0, hash }]));
const end = (syms: Record<string, string[]>, hashes: Record<string, string>): DiffEnd =>
  ({ syms: symSets(syms), stats: st(hashes) });
const rec = (node: string, claim: string, kind: ClaimRecord["kind"], o: Partial<ClaimRecord> = {}): ClaimRecord =>
  ({ node, claim, kind, at: "2026-07-10T11:58:00.000Z", commit: "aaaa111", tier: "fast", ...o });
const lotOf = (m: { components: { dir: string; lot: { x: number; y: number } }[] }, dir: string) =>
  m.components.find((x) => x.dir === dir)!.lot;

test("layout — geography is stable and append-only: a placed lot never moves; the newcomer takes a vacant lot", async () => {
  const root = await tmpProject({});
  try {
    const c = cfg(root);
    const g1 = graph([comp("."), comp("a"), comp("b")]);
    const m1 = await buildSceneModel(c, g1, EMPTY);
    const m2 = await buildSceneModel(c, g1, EMPTY);
    // Rebuild is byte-identical geography — the whole familiarity mechanism.
    for (const d of [".", "a", "b"]) assert.deepEqual(lotOf(m2, d), lotOf(m1, d), `${d} moved on rebuild`);
    assert.deepEqual(lotOf(m1, "."), { x: 0, y: 0 }, "entry '.' is the plaza at the origin");

    // Add a new component: the established lots stay verbatim, the newcomer gets a
    // distinct vacant cell.
    const g2 = graph([comp("."), comp("a"), comp("b"), comp("c")]);
    const m3 = await buildSceneModel(c, g2, EMPTY);
    assert.deepEqual(lotOf(m3, "a"), lotOf(m1, "a"), "a held its lot");
    assert.deepEqual(lotOf(m3, "b"), lotOf(m1, "b"), "b held its lot");
    const taken = [lotOf(m1, "."), lotOf(m1, "a"), lotOf(m1, "b")];
    const nl = lotOf(m3, "c");
    assert.ok(!taken.some((t) => t.x === nl.x && t.y === nl.y), "newcomer took a vacant lot");
  } finally { await cleanup(root); }
});

test("layout — a removed component's lot stays RESERVED and is never reused by a later addition", async () => {
  const root = await tmpProject({});
  try {
    const c = cfg(root);
    const m1 = await buildSceneModel(c, graph([comp("."), comp("a"), comp("b")]), EMPTY);
    const bLot = lotOf(m1, "b");
    // b is demolished, d is built. d must NOT land on b's cell.
    const m2 = await buildSceneModel(c, graph([comp("."), comp("a"), comp("d")]), EMPTY);
    const dLot = lotOf(m2, "d");
    assert.ok(!(dLot.x === bLot.x && dLot.y === bLot.y), "d reused the demolished lot");
    const layout = await readLayout(c);
    assert.ok(layout.lots.b, "b's lot survives in the layout file (reserved forever)");
    assert.deepEqual(layout.lots.b, bLot);
  } finally { await cleanup(root); }
});

test("claimed — a file named by `exists at` and a chokepoint symbol count as claimed; the rest are the wireframe's gaps", async () => {
  const root = await tmpProject({});
  try {
    const c = cfg(root);
    const g = graph([
      comp("core", { label: "Core", claims: ["x.ts exists at this node", 'boundary "inv" at S via test "o"'] }),
      fileNode("core/x.ts", "core"), fileNode("core/y.ts", "core"),
      sym("S", "core/x.ts"), sym("T", "core/x.ts"),
    ]);
    const core = (await buildSceneModel(c, g, EMPTY)).components.find((x) => x.dir === "core")!;
    assert.deepEqual(core.mass, { files: 2, symbols: 2 }, "honest mass = everything that exists");
    assert.deepEqual(core.claimed, { files: 1, symbols: 1 }, "x.ts + S are named; y.ts + T are not");
    assert.deepEqual(core.unclaimedSample, ["y.ts", "T"], "uncovered names, files first then symbols");
  } finally { await cleanup(root); }
});

test("pieces — one tile per file, sorted by label, carrying path + THAT FILE's own symbol count; claimed flags mirror the claims and sum to claimed.files/mass.files", async () => {
  const root = await tmpProject({});
  try {
    const c = cfg(root);
    // Files deliberately out of label order in the graph; a boundary claim names a SYMBOL
    // (never a file), so it must not mark any tile claimed. Symbols spread unevenly across
    // files so per-FILE counts (not the component total) are what a tile must carry.
    const g = graph([
      comp("core", { label: "Core", claims: ["z.ts exists at this node", "a.ts imports b", 'boundary "inv" at S via test "o"'] }),
      fileNode("core/z.ts", "core"), fileNode("core/a.ts", "core"), fileNode("core/m.ts", "core"),
      sym("S", "core/z.ts"), sym("T", "core/z.ts"), sym("A", "core/a.ts"),  // z.ts:2  a.ts:1  m.ts:0
    ]);
    const core = (await buildSceneModel(c, g, EMPTY)).components.find((x) => x.dir === "core")!;
    assert.deepEqual(core.pieces.map((p) => p.label), ["a.ts", "m.ts", "z.ts"], "one tile per file, sorted by label");
    assert.deepEqual(core.pieces.map((p) => p.path), ["core/a.ts", "core/m.ts", "core/z.ts"], "each tile carries its repo-relative path");
    assert.deepEqual(core.pieces.map((p) => p.symbols), [1, 0, 2], "each tile's height is THAT FILE's own symbol count, not the component total");
    assert.deepEqual(
      core.pieces.map((p) => [p.label, p.claimed]),
      [["a.ts", true], ["m.ts", false], ["z.ts", true]],
      "a.ts (imports) + z.ts (exists at) are named; m.ts is not; the symbol claim marks no file",
    );
    // The tile-level view sums EXACTLY to the aggregate wireframe counts.
    assert.equal(core.pieces.length, core.mass.files, "every file is one tile");
    assert.equal(core.pieces.filter((p) => p.claimed).length, core.claimed.files, "claimed tiles sum to claimed.files");
    assert.equal(core.pieces.reduce((n, p) => n + p.symbols, 0), core.mass.symbols, "per-file symbol counts sum to mass.symbols");
    assert.equal((await buildSceneModel(c, g, EMPTY)).diff, null, "a plain scene carries diff:null — no review flags");
  } finally { await cleanup(root); }
});

test("gate — material follows the verdict: pass+oracle→steel, stale→scaffold, fail→breached, unknown→scaffold(+human eye)", () => {
  const claims = [
    'boundary "p" at cp via test "op"',
    'boundary "s" at cs via test "os"',
    'boundary "f" at cf via test "of"',
    'boundary "u" at cu via guard "ou"',
  ];
  const recBy = new Map<string, ClaimRecord>([
    [`N ${claims[0]}`, rec("N", claims[0], "pass", { commit: "aaaa111" })],   // at HEAD
    [`N ${claims[1]}`, rec("N", claims[1], "pass", { commit: "bbbb222" })],   // aging green
    [`N ${claims[2]}`, rec("N", claims[2], "fail")],
    // claims[3] has no record at all
  ]);
  const gates = deriveGates(claims, "N", recBy, "aaaa111");
  assert.deepEqual([gates[0].verdict, gates[0].material], ["pass", "steel"]);
  assert.deepEqual([gates[1].verdict, gates[1].material], ["stale", "scaffold"], "an aging green is temporary construction");
  assert.deepEqual([gates[2].verdict, gates[2].material], ["fail", "breached"]);
  assert.deepEqual([gates[3].verdict, gates[3].material], ["unknown", "scaffold"]);
  assert.equal(gates[3].humanEye, true, "a via-guard gate is flagged for a human eye");
  assert.equal(gates[0].humanEye, false);
});

test("light — lit at HEAD, dim when passes are only at older commits, dark when nothing ever passed", () => {
  assert.equal(deriveLight([rec("N", "c", "pass", { commit: "aaaa111" })], "aaaa111").level, "lit");
  const dim = deriveLight([rec("N", "c", "pass", { commit: "bbbb222" })], "aaaa111");
  assert.equal(dim.level, "dim");
  assert.equal(dim.stale, 1);
  assert.equal(deriveLight([rec("N", "c", "fail")], "aaaa111").level, "dark", "a fail alone leaves the district dark");
  const l = deriveLight([
    rec("N", "a", "pass", { commit: "aaaa111", at: "2026-01-01T00:00:00.000Z" }),
    rec("N", "b", "pass", { commit: "aaaa111", at: "2026-02-01T00:00:00.000Z" }),
    rec("N", "c", "fail"),
  ], "aaaa111");
  assert.equal(l.level, "lit");
  assert.equal(l.fails, 1);
  assert.equal(l.freshest, "2026-02-01T00:00:00.000Z", "freshest = the newest pass stamp");
});

test("links — a cross-component import edge becomes directed adjacency on the importer only", async () => {
  const root = await tmpProject({});
  try {
    const c = cfg(root);
    const g = graph(
      [comp("."), comp("a"), comp("b"), fileNode("a/x.ts", "a"), fileNode("b/y.ts", "b")],
      [imp("a/x.ts", "b/y.ts")],
    );
    const m = await buildSceneModel(c, g, EMPTY);
    assert.deepEqual(m.components.find((x) => x.dir === "a")!.links, ["b"], "a imports into b");
    assert.deepEqual(m.components.find((x) => x.dir === "b")!.links, [], "adjacency is directed — b does not link back");
  } finally { await cleanup(root); }
});

test("diff merge — a file's change is keyed by structure OR body: added, removed→ghost, changed when its SYMBOL SET moved OR its CONTENT moved; prevSymbols/prevLines carry base when the count/height moved", () => {
  // Head district `d`: keep.ts (untouched), touched.ts (BODY edit — same symbol set, new
  //   content), renamed.ts (same COUNT, different labels), grown.ts (a symbol added, taller),
  //   new.ts (added). Base district `d` additionally had gone.ts (removed).
  const head = smodel([scomp("d", [
    piece("keep.ts", 2), piece("touched.ts", 1), piece("renamed.ts", 2), piece("grown.ts", 3, { lines: 30 }), piece("new.ts", 1),
  ])]);
  const base = smodel([scomp("d", [
    piece("keep.ts", 2), piece("touched.ts", 1), piece("renamed.ts", 2), piece("grown.ts", 2, { lines: 20 }), piece("gone.ts", 4),
  ])]);
  // keep.ts: identical hash → unchanged. Everything else: a different head hash → its body moved.
  const headEnd = end(
    { "d/keep.ts": ["K1", "K2"], "d/touched.ts": ["T1"], "d/renamed.ts": ["R1", "R2b"], "d/grown.ts": ["G1", "G2", "G3"], "d/new.ts": ["N1"] },
    { "d/keep.ts": "hk", "d/touched.ts": "ht2", "d/renamed.ts": "hr2", "d/grown.ts": "hg2", "d/new.ts": "hn" },
  );
  const baseEnd = end(
    { "d/keep.ts": ["K1", "K2"], "d/touched.ts": ["T1"], "d/renamed.ts": ["R1", "R2a"], "d/grown.ts": ["G1", "G2"], "d/gone.ts": ["X1", "X2", "X3", "X4"] },
    { "d/keep.ts": "hk", "d/touched.ts": "ht1", "d/renamed.ts": "hr1", "d/grown.ts": "hg1", "d/gone.ts": "hx" },
  );
  const merged = mergeSceneDiff(head, base, headEnd, baseEnd, "abc123");
  assert.deepEqual(merged.diff, { base: "abc123", outside: { added: 0, removed: 0, changed: 0 } }, "a merged model records the base ref + an (here empty) outside tally");
  const d = merged.components.find((c) => c.dir === "d")!;
  // Ghost is injected and the whole set is re-sorted by label — stable within-district geography.
  assert.deepEqual(d.pieces.map((p) => p.label), ["gone.ts", "grown.ts", "keep.ts", "new.ts", "renamed.ts", "touched.ts"]);
  const by = (l: string) => d.pieces.find((p) => p.label === l)!;
  assert.equal(by("keep.ts").change, undefined, "identical symbol set AND identical content → no annotation");
  assert.equal(by("touched.ts").change, "changed", "a body-only edit (same symbols, new content) NOW registers — a reviewer can't be blind to prose");
  assert.equal(by("touched.ts").prevSymbols, undefined, "symbol count unchanged → no prevSymbols");
  assert.equal(by("touched.ts").prevLines, undefined, "line count unchanged → no prevLines");
  assert.equal(by("renamed.ts").change, "changed", "same count but a different label set IS a structural change");
  assert.equal(by("renamed.ts").prevSymbols, undefined, "count didn't move → no prevSymbols");
  assert.equal(by("renamed.ts").prevLines, undefined, "height didn't move → no prevLines");
  assert.equal(by("grown.ts").change, "changed");
  assert.equal(by("grown.ts").prevSymbols, 2, "a symbol was added → prevSymbols carries the former count");
  assert.equal(by("grown.ts").prevLines, 20, "the tower grew → prevLines carries the former height");
  assert.equal(by("new.ts").change, "added", "head-only file");
  assert.equal(by("gone.ts").change, "removed", "base-only file becomes a ghost tile");
  assert.equal(by("gone.ts").symbols, 4, "the ghost carries its BASE symbol count (honest former shape)");
  assert.deepEqual(diffTally(merged), { added: 1, removed: 1, changed: 3 });
});

test("diff merge — whole-district add/remove: a head-only district is `added`, a base-only district is injected as a `removed` ghost on its reserved lot with its base pieces/mass", () => {
  const head = smodel([
    scomp("core", [piece("x.ts", 1)]),
    scomp("fresh", [piece("y.ts", 2), piece("z.ts", 1)]),  // did not exist at base
  ]);
  const base = smodel([
    scomp("core", [piece("x.ts", 1)]),
    scomp("legacy", [piece("old.ts", 5)], { lot: { x: 3, y: 2 }, mass: { files: 1, symbols: 5 } }),  // gone at head
  ]);
  const e = end(
    { "d/x.ts": ["S"], "d/y.ts": ["A", "B"], "d/z.ts": ["C"], "d/old.ts": ["O"] },
    { "d/x.ts": "hx", "d/y.ts": "hy", "d/z.ts": "hz", "d/old.ts": "ho" },
  );
  const merged = mergeSceneDiff(head, base, e, e, "def456");
  const fresh = merged.components.find((c) => c.dir === "fresh")!;
  assert.equal(fresh.change, "added", "a district absent from base is wholly new");
  const legacy = merged.components.find((c) => c.dir === "legacy")!;
  assert.equal(legacy.change, "removed", "a district absent from head is injected as a ghost");
  assert.deepEqual(legacy.lot, { x: 3, y: 2 }, "the ghost sits on its reserved (base) lot — geography is append-only");
  assert.deepEqual(legacy.pieces.map((p) => p.label), ["old.ts"], "the ghost carries its BASE pieces for honest shape");
  assert.deepEqual(legacy.mass, { files: 1, symbols: 5 }, "and its base mass");
  assert.equal(merged.components.find((c) => c.dir === "core")!.change, undefined, "an unchanged district recedes — no flag");
  assert.deepEqual(diffTally(merged), { added: 2, removed: 1, changed: 0 }, "an added/removed district counts all its files");
});

test("diff (IO) — deriveBaseModel materializes a base ref in a throwaway worktree; the merge diffs head against it (lines + symbols); out-of-graph changes land in diff.outside; the current tree is untouched + the worktree torn down", async () => {
  const root = await tmpProject({
    "coherence.config.json": JSON.stringify({ outputDir: "public", codeExt: ["ts"] }),
    ".gitignore": "public/\n",
    // Root component ".", plus source a.ts with ONE symbol / ONE line at base, and a README
    // the graph does NOT model (not a .ts) — the honest "outside the map" surface.
    "root.spec.md": "# Root\n\n## works when\n\na.ts exists at this node\n",
    "a.ts": "export function one() {}\n",
    "README.md": "# base\n",
  });
  try {
    const c = cfg(root);
    const git = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "pipe" });
    git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
    git("add", "-A"); git("commit", "-qm", "base");

    // Head = a SECOND commit: a.ts gains a symbol AND a line, a brand-new component `b`
    // arrives, and the un-modeled README is edited (an out-of-graph change).
    await writeFile(join(root, "a.ts"), "export function one() {}\nexport function two() {}\n");
    await mkdir(join(root, "b"), { recursive: true });
    await writeFile(join(root, "b", "b.spec.md"), "# B\n\n## works when\n\nb.ts exists at this node\n");
    await writeFile(join(root, "b", "b.ts"), "export function bee() {}\n");
    await writeFile(join(root, "README.md"), "# head, edited\n");
    git("add", "-A"); git("commit", "-qm", "head");

    const graphNow = await buildGraph(c);
    const headStats = await fileStats(c, graphNow.nodes.filter((n) => n.kind === "file"));
    const headModel = await buildSceneModel(c, graphNow, EMPTY, headStats);
    const before = await readLayout(c);

    const base = await deriveBaseModel(c, "HEAD~1");   // HEAD~1 = the base commit
    assert.ok(base.ref && base.ref.length >= 4, "base ref resolved to a short sha");
    const outside = deriveOutside(c, base.ref, graphPaths(headModel, base.model));
    const headEnd = { syms: symbolSetsByFile(graphNow), stats: headStats };
    const merged = mergeSceneDiff(headModel, base.model, headEnd, base.end, base.ref, outside);

    // The base derivation's writes went to the tmp worktree — the current layout is byte-identical.
    assert.deepEqual(await readLayout(c), before, "base derivation never wrote into the current tree");

    // `b` is a wholly new district; a.ts gained a symbol AND a line → a `changed` tile carrying both former measures.
    const b = merged.components.find((x) => x.dir === "b")!;
    assert.equal(b.change, "added", "the new component is an added district");
    const aTile = merged.components.find((x) => x.dir === ".")!.pieces.find((p) => p.label === "a.ts")!;
    assert.equal(aTile.change, "changed", "a.ts gained a symbol → structural change");
    assert.equal(aTile.prevSymbols, 1, "and carries its base symbol count");
    assert.equal(aTile.lines, 2, "the head tower is 2 lines tall (read from disk)");
    assert.equal(aTile.prevLines, 1, "and carries its base height (1 line)");
    assert.ok(diffTally(merged).added >= 1, "at least b.ts is added");

    // The map never silently truncates: README.md is out of the graph → counted in diff.outside;
    // a.ts + b.ts (real towers) are graph-owned and are NOT double-counted here. b.spec.md is a
    // component's spec meta (not a modeled tower), so it too reads as outside — honest, not hidden.
    assert.deepEqual(merged.diff!.outside, outside);
    assert.equal(outside.changed, 1, "the README edit is one change outside the map");
    assert.equal(outside.added, 1, "b.spec.md (spec meta, not a tower) is an out-of-graph addition");
    assert.equal(outside.removed, 0);

    // No leftover worktree registered (torn down in the finally block).
    const wt = execFileSync("git", ["worktree", "list"], { cwd: root, encoding: "utf8" });
    assert.equal(wt.trim().split("\n").length, 1, "the throwaway worktree was torn down");
  } finally { await cleanup(root); }
});

test("outside (pure) — git --name-status is tallied minus the graph's own paths: A→added, D→removed, M/R→changed", () => {
  const owned = new Set(["src/a.ts", "src/b.ts"]);
  // src/a.ts (graph tower — dropped), README.md (M), scripts/ci.sh (A), old/gone.txt (D),
  // and a rename of a doc (R → changed, keyed off either path).
  const nameStatus = [
    "M\tsrc/a.ts",
    "M\tREADME.md",
    "A\tscripts/ci.sh",
    "D\told/gone.txt",
    "R096\tdocs/old.md\tdocs/new.md",
    "A\tsrc/b.ts",              // another graph tower — dropped
  ].join("\n");
  assert.deepEqual(outsideTally(nameStatus, owned), { added: 1, removed: 1, changed: 2 },
    "README (M) + docs rename (R) = 2 changed; ci.sh = 1 added; gone.txt = 1 removed; the two graph towers are dropped");
  assert.deepEqual(outsideTally("", owned), { added: 0, removed: 0, changed: 0 }, "empty diff → an all-zero tally");
  // A rename whose destination is graph-owned is the graph's, dropped on the owned path.
  assert.deepEqual(outsideTally("R100\told/x.ts\tsrc/a.ts", owned), { added: 0, removed: 0, changed: 0 }, "a rename INTO a graph path is owned");
});

test("lines — a tower's height is its file's on-disk line count (newlines); symbols stay a separate datum; unreadable → 0", async () => {
  const root = await tmpProject({
    "core/tall.ts": "a\nb\nc\nd\ne\n",                       // 5 newlines, ZERO symbols — a real structure
    "core/small.ts": "export const x = 1;\n",                // 1 line, 1 symbol
  });
  try {
    const c = cfg(root);
    const g = graph([
      comp("core", { label: "Core" }),
      fileNode("core/tall.ts", "core"), fileNode("core/small.ts", "core"), fileNode("core/ghost.ts", "core"),
      sym("X", "core/small.ts"),
    ]);
    const core = (await buildSceneModel(c, g, EMPTY)).components.find((x) => x.dir === "core")!;
    const by = (l: string) => core.pieces.find((p) => p.label === l)!;
    assert.equal(by("tall.ts").lines, 5, "height = the newline count read from disk");
    assert.equal(by("tall.ts").symbols, 0, "a symbol-less file is still a tall tower, not a stub");
    assert.equal(by("small.ts").lines, 1);
    assert.equal(by("small.ts").symbols, 1, "symbols remain a per-file datum, independent of height");
    assert.equal(by("ghost.ts").lines, 0, "a file that isn't on disk → 0 lines (unreadable), not a crash");
  } finally { await cleanup(root); }
});

test("claimed by PATH — a unique basename claim blesses its file, an AMBIGUOUS basename blesses NONE, and a path-suffix claim blesses exactly the one it names", async () => {
  const root = await tmpProject({});
  try {
    const c = cfg(root);
    // A district with FOUR `hooks.ts` (different sub-paths) + a unique `index.ts`. Claims:
    //   · `index.ts exists at this node`         → unique basename, blesses index.ts
    //   · `hooks.ts exists at this node`         → AMBIGUOUS basename (4 candidates), blesses NONE
    //   · `a/hooks.ts imports ./x`               → path suffix, blesses ONLY a/hooks.ts
    //   · `b/hooks.ts exists at this node`       → path suffix, blesses ONLY b/hooks.ts
    const g = graph([
      comp("feat", { label: "Feat", claims: [
        "index.ts exists at this node",
        "hooks.ts exists at this node",
        "a/hooks.ts imports ./x",
        "b/hooks.ts exists at this node",
      ] }),
      fileNode("feat/index.ts", "feat"),
      fileNode("feat/a/hooks.ts", "feat"), fileNode("feat/b/hooks.ts", "feat"),
      fileNode("feat/c/hooks.ts", "feat"), fileNode("feat/d/hooks.ts", "feat"),
    ]);
    const feat = (await buildSceneModel(c, g, EMPTY)).components.find((x) => x.dir === "feat")!;
    const byPath = (path: string) => feat.pieces.find((p) => p.path === `feat/${path}`)!;
    assert.equal(byPath("index.ts").claimed, true, "a unique basename is blessed");
    assert.equal(byPath("a/hooks.ts").claimed, true, "a path-suffix claim blesses exactly its file");
    assert.equal(byPath("b/hooks.ts").claimed, true, "…and only its file");
    assert.equal(byPath("c/hooks.ts").claimed, false, "the ambiguous `hooks.ts` basename blesses NONE — no over-report");
    assert.equal(byPath("d/hooks.ts").claimed, false, "so the un-named same-name siblings stay dark");
    // Counts agree tile-for-tile with the wireframe — 3 blessed of 5 files.
    assert.equal(feat.claimed.files, 3, "index.ts + a/hooks.ts + b/hooks.ts");
    assert.equal(feat.pieces.filter((p) => p.claimed).length, feat.claimed.files, "per-tile flags sum EXACTLY to claimed.files");
    assert.equal(feat.mass.files, 5);
  } finally { await cleanup(root); }
});
