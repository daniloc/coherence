// economy.test.ts — THE CONTEXT CLOSURE (src/economy.ts): what a reader must load to
// change one thing safely. Two layers, the split decompose.ts's header sets out and
// evolution.ts's repeats, because injection is blind exactly where the git plumbing is:
//   1. the closure math — adjacency, closure, median/p90, the trend orientation, the hub
//      findings — driven through HAND-BUILT commit arrays and graphs. No git, exhaustive.
//   2. the glue the injection bypasses — the real log read, the SUBDIRECTORY rebase (the
//      v0.19.1 regression class), the status record and the raise dedupe — driven through
//      real throwaway repos.
//
// What is genuinely at risk here is not the arithmetic but three ways the advisory could
// LIE: a commit outside the graph read as a ZERO closure (it must be ABSENT), a one-way
// import closure that reports a hub as cheap (the edges are UNDIRECTED), and a hub finding
// whose journal key carries its count (which would mint a new question every run).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  economy, importAdjacency, closureOf, economyStats, closureSeries, fileAttribution,
  economyFindings, type Closure,
} from "../src/economy.ts";
import { _resetEvolutionMemo, type Commit } from "../src/evolution.ts";
import type { StatusRecord } from "../src/status.ts";
import { cfg, cleanup, comp, fileNode, graph, imp, runCaptured, tmpProject } from "./_helpers.ts";

const commit = (hash: string, files: string[], subject = hash): Commit => ({ hash, subject, files });
/** A root no git command can succeed in — the pure layer must never reach the disk. */
const NOGIT = "/coherence-test-no-such-dir";

const lines = (n: number) => (_p: string) => n;
const noSpecs = () => undefined;

// ── Layer 1: the closure math ────────────────────────────────────────────────────────────

test("importAdjacency — an import edge is UNDIRECTED: both endpoints see each other", () => {
  const g = graph([fileNode("a.ts", "."), fileNode("b.ts", ".")], [imp("a.ts", "b.ts")]);
  const adj = importAdjacency(g);
  assert.deepEqual([...adj.get("a.ts")!], ["b.ts"], "the importer must see what it depends on");
  assert.deepEqual([...adj.get("b.ts")!], ["a.ts"], "and the importee must see who depends on IT — half a closure is half a reading");
});

test("importAdjacency — only file↔file `imports` edges count: externals and other kinds are out", () => {
  const g = graph([fileNode("a.ts", ".")], [
    imp("a.ts", "b.ts"),
    { id: "f:a.ts->x:node:fs:imports", source: "f:a.ts", target: "x:node:fs", kind: "imports" },
    { id: "f:a.ts->i:DB:binds", source: "f:a.ts", target: "i:DB", kind: "binds" },
  ]);
  const adj = importAdjacency(g);
  assert.deepEqual([...adj.get("a.ts")!], ["b.ts"], "`node:fs` is not something a reader loads to make a change safely");
  assert.ok(!adj.has("x:node:fs"));
});

test("closureOf — the touched file, what it imports AND what imports it, each counted once", () => {
  // dep.ts ← a.ts → …and user.ts → a.ts. Touching a.ts must pull BOTH neighbours.
  const g = graph(
    [fileNode("a.ts", "."), fileNode("dep.ts", "."), fileNode("user.ts", ".")],
    [imp("a.ts", "dep.ts"), imp("user.ts", "a.ts")],
  );
  const fileSet = new Set(["a.ts", "dep.ts", "user.ts"]);
  const cl = closureOf(commit("c1", ["a.ts", "dep.ts"]), importAdjacency(g), fileSet, new Map(), lines(10), noSpecs)!;
  assert.deepEqual([...cl.members].sort(), ["a.ts", "dep.ts", "user.ts"]);
  assert.equal(cl.files, 3, "dep.ts was BOTH touched and a neighbour — a closure is a set, so it counts once");
  assert.equal(cl.lines, 30);
});

test("closureOf — a commit entirely outside the graph yields NULL, never an empty closure", () => {
  const fileSet = new Set(["a.ts"]);
  const cl = closureOf(commit("docs", ["README.md", "package-lock.json"]), new Map(), fileSet, new Map(), lines(10), noSpecs);
  assert.equal(cl, null, "a zero would claim the change was free to read — a claim about a change this instrument never saw");
});

test("closureOf — spec context is added ONCE per component, however many of its files are in the closure", () => {
  const fileSet = new Set(["A/a.ts", "A/b.ts"]);
  const fileComp = new Map([["A/a.ts", "Alpha"], ["A/b.ts", "Alpha"]]);
  const cl = closureOf(commit("c1", ["A/a.ts", "A/b.ts"]), new Map(), fileSet, fileComp, lines(10), (l) => (l === "Alpha" ? 100 : undefined))!;
  assert.deepEqual(cl.comps, ["Alpha"]);
  assert.equal(cl.files, 3, "two code files + ONE spec");
  assert.equal(cl.lines, 120, "20 code lines + the spec's real 100");
});

test("closureOf — a component with no spec contributes no spec context (absent, not an empty file)", () => {
  const cl = closureOf(commit("c1", ["a.ts", "b.ts"]), new Map(), new Set(["a.ts", "b.ts"]), new Map([["a.ts", "Nameless"]]), lines(5), noSpecs)!;
  assert.equal(cl.files, 2);
  assert.equal(cl.lines, 10);
});

const closure = (files: number, lines = files * 10, hash = "h"): Closure =>
  ({ hash, subject: hash, files, lines, members: new Set(), comps: [] });

test("economyStats — median is the middle for odd n and the MEAN of the two middles for even n", () => {
  assert.deepEqual(economyStats([closure(7)]), { medianFiles: 7, medianLines: 70, p90Files: 7, p90Lines: 70 });
  const even = economyStats([closure(2), closure(4), closure(6), closure(8)]);
  assert.equal(even.medianFiles, 5);
  assert.equal(even.medianLines, 50);
});

test("economyStats — p90 is a REAL observation: the ceil(0.9n)-1th value of the ascending sort", () => {
  // n = 10 → index ceil(9) - 1 = 8 → the 9th smallest. Input deliberately unsorted.
  const cs = [9, 3, 10, 1, 7, 5, 2, 8, 4, 6].map((n) => closure(n));
  const s = economyStats(cs);
  assert.equal(s.medianFiles, 5.5);
  assert.equal(s.p90Files, 9, "the 9th of 10, not an interpolation between 9 and 10");
  assert.equal(s.p90Lines, 90);
  assert.equal(economyStats([]).p90Files, 0, "an empty set is 0s, never NaN");
});

test("closureSeries — closures arrive NEWEST-first and the trend renders OLDEST → NEWEST", () => {
  // newest-first 8,7,6,5,4,3,2,1 over 4 buckets of 2 → oldest-first pairs (1,2)(3,4)(5,6)(7,8)
  const cs = [8, 7, 6, 5, 4, 3, 2, 1].map((n) => closure(n));
  assert.deepEqual(closureSeries(cs, 4), [1.5, 3.5, 5.5, 7.5]);
  assert.deepEqual(closureSeries([], 4), []);
});

test("fileAttribution — counts the closures a path appears in, not the times it was touched", () => {
  const mk = (paths: string[]): Closure => ({ hash: "h", subject: "s", files: paths.length, lines: 0, members: new Set(paths), comps: [] });
  const attr = fileAttribution([mk(["a.ts", "b.ts"]), mk(["a.ts"]), mk(["b.ts", "c.ts"])]);
  assert.equal(attr.get("a.ts"), 2);
  assert.equal(attr.get("b.ts"), 2);
  assert.equal(attr.get("c.ts"), 1);
});

test("economyFindings — below MIN_CONSIDERED nothing is raised, however lopsided the share", () => {
  const attr = new Map([["hub.ts", 3]]);
  assert.deepEqual(economyFindings(attr, 3), [], "3 of 3 is 100% of nothing — a share needs a sample behind it");
  assert.deepEqual(economyFindings(attr, 11), []);
});

test("economyFindings — the subject is the BARE PATH: no count, no share, no rank", () => {
  const attr = new Map([["hub.ts", 10], ["warm.ts", 6], ["cold.ts", 2]]);
  const fs = economyFindings(attr, 12);
  assert.deepEqual(fs.map((f) => f.subject), ["hub.ts", "warm.ts"], "cold.ts is 17% — under the hub floor");
  for (const f of fs) {
    assert.equal(f.advisory, "economy");
    assert.doesNotMatch(f.subject, /\d/, "a key carrying a magnitude mints a new question every run");
    assert.ok(f.discriminatedBy.length > 0, "a finding with no discriminating test is a nag with a UUID");
  }
  assert.match(fs[0].observation, /10 of 12/, "the volatile detail belongs in the observation, where identity does not live");
});

test("economy — with no graph files at all, it says so and still exits 0", async () => {
  const res = await runCaptured(() => economy(cfg(NOGIT), graph([]), {}, [commit("c1", ["a.ts", "b.ts"])]));
  assert.equal(res.code, 0);
  assert.match(res.out, /no closures to measure/);
});

test("economy — the 2…BULK concern band applies POST-rebase, like every other derivation", async () => {
  const g = graph([fileNode("a.ts", "."), fileNode("b.ts", ".")], [imp("a.ts", "b.ts")]);
  const bulk = Array.from({ length: 60 }, (_, i) => `f${i}.ts`);
  const res = await runCaptured(() => economy(cfg(NOGIT), g, {}, [
    commit("solo", ["a.ts"]),                    // 1 file — no concern signal
    commit("sweep", ["a.ts", ...bulk]),          // > BULK — a mechanical migration
    commit("real", ["a.ts", "b.ts"]),
  ]));
  assert.equal(res.code, 0);
  assert.match(res.out, /^\s+1 concern commits analyzed \(2–40 files each, last 400\)/m);
});

// ── Layer 2: the glue, over real repos ───────────────────────────────────────────────────

const git = (args: string[], cwd: string) => spawnSync("git", args, { cwd, encoding: "utf8" });
async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "coh-econ-"));
  git(["init", "-q"], root);
  git(["config", "user.email", "t@test"], root);
  git(["config", "user.name", "t"], root);
  git(["config", "commit.gpgsign", "false"], root);
  return root;
}
async function gitCommit(root: string, subject: string, files: Record<string, string>) {
  for (const [p, c] of Object.entries(files)) {
    const fp = join(root, p);
    await mkdir(dirname(fp), { recursive: true });
    await writeFile(fp, c);
  }
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", subject], root);
}

/** a.ts imports b.ts; every commit touches a.ts + c.ts, so b.ts enters each closure as a
 *  NEIGHBOUR and nothing else does. `n` commits, all inside the concern band. */
async function hubRepo(n: number, prefix = ""): Promise<string> {
  const root = await initRepo();
  const p = (f: string) => `${prefix}${f}`;
  await gitCommit(root, "init", { [p("a.ts")]: 'import "./b.ts";\n', [p("b.ts")]: "export const b = 0;\n", [p("c.ts")]: "export const c = 0;\n" });
  for (let i = 0; i < n; i++) {
    // Both files must actually CHANGE, or git records a one-file commit and the concern
    // band drops it — which is correct behaviour and a trap for the fixture.
    await gitCommit(root, `edit ${i}`, { [p("a.ts")]: `import "./b.ts";\n// ${i}\n`, [p("c.ts")]: `export const c = ${i + 1};\n` });
  }
  return root;
}

const HUB_GRAPH = graph(
  [comp("."), fileNode("a.ts", "."), fileNode("b.ts", "."), fileNode("c.ts", ".")],
  [imp("a.ts", "b.ts")],
);

test("economy — over a real repo: the report carries the medians, the trend and the hub table", async (t) => {
  const root = await hubRepo(4);
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  const { code, out } = await runCaptured(() => economy(cfg(root), HUB_GRAPH));
  assert.equal(code, 0, out);
  // 4 two-file commits (the 3-file init is in the band too) — each closure is {a,b,c}.
  assert.match(out, /concern commits analyzed \(2–40 files each, last 400\)/);
  assert.match(out, /closure per commit\s+median 3 files/);
  assert.match(out, /trend \(median files\)/);
  assert.match(out, /files in most closures/);
  assert.match(out, /b\.ts/, "b.ts is never touched — it is in every closure as a NEIGHBOUR, which is the point");
  assert.match(out, /lines measured against the CURRENT tree/, "both approximations are named on the report itself");
});

test("economy — a SUBDIRECTORY-rooted project measures its own history, not a wrong zero", async (t) => {
  // The v0.19.1 regression class: git speaks repo-root paths, the graph speaks cfg.root ones.
  const root = await hubRepo(4, "app/");
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  await gitCommit(root, "outside", { "docs/x.md": "a", "docs/y.md": "b" });
  const { code, out } = await runCaptured(() => economy(cfg(join(root, "app")), HUB_GRAPH));
  assert.equal(code, 0, out);
  assert.match(out, /5 concern commits analyzed/, "the subtree's own view: 5 in-band commits touched it");
  assert.doesNotMatch(out, /no closures to measure/);
  assert.match(out, /closure per commit\s+median 3 files/);
});

test("economy — spec context is counted at the spec's REAL line count", async (t) => {
  const root = await hubRepo(4);
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  await writeFile(join(root, "root.spec.md"), "# Root\n\nline\nline\n");   // 4 newlines
  const g = graph(
    [comp(".", { label: "Root" }), fileNode("a.ts", "."), fileNode("b.ts", "."), fileNode("c.ts", ".")],
    [imp("a.ts", "b.ts")],
  );
  const { out } = await runCaptured(() => economy(cfg(root), g));
  assert.match(out, /closure per commit\s+median 4 files/, "3 code files + the one spec that governs them");
  assert.match(out, /mean closure by component/);
  assert.match(out, /Root/);
});

test("economy — the run is FILED: status.json gains an economy section carrying its sample size", async (t) => {
  const root = await hubRepo(4);
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  await runCaptured(() => economy(cfg(root), HUB_GRAPH));
  const rec: StatusRecord = JSON.parse(await readFile(join(root, ".coherence", "status.json"), "utf8"));
  assert.equal(rec.economy!.considered, 5);
  assert.equal(rec.economy!.medianFiles, 3);
  assert.ok(rec.economy!.medianLines > 0);
  assert.ok(Array.isArray(rec.economy!.series) && rec.economy!.series.length > 0);
});

test("economy --raise — one question per hub PATH, and a second run opens none", async (t) => {
  const root = await hubRepo(13);
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  const c = cfg(root);
  const first = await runCaptured(() => economy(c, HUB_GRAPH, { raise: true, session: "s-abcabcabcabc" }));
  assert.match(first.out, /RAISE — \d+ question\(s\) opened/);
  assert.match(first.out, /economy:b\.ts/, "the un-touched neighbour is a read-side hub and is raised as one");

  const again = await runCaptured(() => economy(c, HUB_GRAPH, { raise: true, session: "s-abcabcabcabc" }));
  assert.match(again.out, /already open/);
  assert.doesNotMatch(again.out, /RAISE — [1-9]\d* question\(s\) opened/);
});

test("economy — without --raise nothing is written: the journal dir stays absent", async (t) => {
  const root = await hubRepo(13);
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  const { out } = await runCaptured(() => economy(cfg(root), HUB_GRAPH));
  assert.match(out, /RAISE — .* never been asked about/);
  await assert.rejects(() => readFile(join(root, ".coherence", "decisions", "s-abcabcabcabc.jsonl"), "utf8"));
});

test("economy — a project with no git history at all is silent, not zero", async (t) => {
  const root = await tmpProject({ "a.ts": "x\n" });
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  const { code, out } = await runCaptured(() => economy(cfg(root), HUB_GRAPH));
  assert.equal(code, 0);
  assert.match(out, /no closures to measure/);
});
