// decompose.test.ts — the LOCALITY math (the "anti-entropy thermostat"). It is advisory
// (never gates CI), but it is the metric you reason about when judging whether a codebase
// is decohering, so its CORRECTNESS is worth pinning. Two layers, by design:
//   1. the pure math — driven through analyze(cfg, graph, INJECTED commits): exhaustive,
//      deterministic, no git. (the one-line commit-injection seam in decompose.ts.)
//   2. the git/glue the injection bypasses — readCommitLog's parser and componentMap's
//      git-prefix stripping — driven through REAL throwaway git repos, because that plumbing
//      is exactly where injection is blind and where real path-mapping bugs hide.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { analyze, readCommitLog, componentMap } from "../src/decompose.ts";
import { decompose } from "../src/decompose.ts";
import type { Commit } from "../src/decompose.ts";
import { cfg, comp, graph, fileNode, imp, runCaptured, cleanup } from "./_helpers.ts";

// A nonexistent root: componentMap's `git rev-parse --show-prefix` fails → prefix "" → the
// injected-commit path maps file paths straight through fileComp, never touching git.
const NOGIT = "/coherence-test-no-such-dir";
const commit = (files: string[], hash = "h", subject = "s"): Commit => ({ hash, subject, files });

// ── Layer 1: the pure math (injected commits, hand-built graph) ──────────────────────────

test("LOCALITY — within=1, cross=2 over one A,A,B commit → 1/3", () => {
  const g = graph([comp("A"), comp("B"), fileNode("A/a1.ts", "A"), fileNode("A/a2.ts", "A"), fileNode("B/b1.ts", "B")]);
  const a = analyze(cfg(NOGIT), g, [commit(["A/a1.ts", "A/a2.ts", "B/b1.ts"])]);
  assert.equal(a.within, 1);
  assert.equal(a.cross, 2);
  assert.equal(a.locality, 1 / 3);
  assert.deepEqual(a.pairs[0], ["A  ⇄  B", 2]); // both cross pairs key to the same sorted edge
});

test("LOCALITY — all co-change inside one component → 1.0, no smells", () => {
  const g = graph([comp("A"), fileNode("A/a1.ts", "A"), fileNode("A/a2.ts", "A"), fileNode("A/a3.ts", "A")]);
  const a = analyze(cfg(NOGIT), g, [commit(["A/a1.ts", "A/a2.ts", "A/a3.ts"])]);
  assert.equal(a.within, 3);
  assert.equal(a.cross, 0);
  assert.equal(a.locality, 1);
  assert.equal(a.pairs.length, 0);
});

test("LOCALITY — empty history defaults to 1.0, never NaN", () => {
  const a = analyze(cfg(NOGIT), graph([comp("A")]), []);
  assert.equal(a.locality, 1);
  assert.ok(!Number.isNaN(a.locality));
  assert.equal(a.commits, 0);
});

test("a file unknown to the graph is dropped, not counted as a pair", () => {
  const g = graph([comp("A"), fileNode("A/a1.ts", "A")]);
  const a = analyze(cfg(NOGIT), g, [commit(["A/a1.ts", "ghost/z.ts"])]);
  assert.equal(a.within + a.cross, 0); // only one file resolved → no pair
  assert.equal(a.locality, 1);
});

test("BULK band — a 1-file commit and a 41-file commit are excluded; exactly-40 is kept", () => {
  const g = graph([comp("A"), comp("B"), fileNode("A/a.ts", "A"), fileNode("B/b.ts", "B")]);
  const forty = ["A/a.ts", "B/b.ts", ...Array.from({ length: 38 }, (_, i) => `x/x${i}.ts`)]; // 40 files, 2 resolve to a cross pair
  const fortyOne = Array.from({ length: 41 }, (_, i) => `y/y${i}.ts`);
  const a = analyze(cfg(NOGIT), g, [commit(["A/a.ts"], "1"), commit(forty, "40"), commit(fortyOne, "41")]);
  assert.equal(a.commits, 1);          // only the 40-file commit survived the band
  assert.equal(a.cross, 1);            // its one resolvable cross pair
  assert.equal(a.within, 0);
});

test("godFiles — a file co-changing with ≥3 other components is a missing-abstraction smell (2 is not)", () => {
  const g = graph([
    comp("A"), comp("B"), comp("C"), comp("D"),
    fileNode("A/hub.ts", "A"), fileNode("A/two.ts", "A"),
    fileNode("B/b.ts", "B"), fileNode("C/c.ts", "C"), fileNode("D/d.ts", "D"),
  ]);
  const a = analyze(cfg(NOGIT), g, [
    commit(["A/hub.ts", "B/b.ts"], "1"),
    commit(["A/hub.ts", "C/c.ts"], "2"),
    commit(["A/hub.ts", "D/d.ts"], "3"), // hub now spans {B,C,D} = 3 → flagged
    commit(["A/two.ts", "B/b.ts"], "4"),
    commit(["A/two.ts", "C/c.ts"], "5"), // two spans {B,C} = 2 → NOT flagged
  ]);
  const gods = a.godFiles.map(([f]) => f);
  assert.ok(gods.includes("A/hub.ts"));
  assert.ok(!gods.includes("A/two.ts"));
  assert.deepEqual(a.godFiles.find(([f]) => f === "A/hub.ts"), ["A/hub.ts", 3]);
});

test("hubs — import fan-in ≥4 is flagged (3 is not); intra-component imports don't inflate", () => {
  const nodes = [
    comp("CORE"), comp("W"), comp("X"), comp("Y"), comp("Z"), comp("LEAF"), comp("P"), comp("Q"), comp("R"),
    fileNode("CORE/core.ts", "CORE"), fileNode("CORE/core2.ts", "CORE"),
    fileNode("W/w.ts", "W"), fileNode("X/x.ts", "X"), fileNode("Y/y.ts", "Y"), fileNode("Z/z.ts", "Z"),
    fileNode("LEAF/leaf.ts", "LEAF"), fileNode("P/p.ts", "P"), fileNode("Q/q.ts", "Q"), fileNode("R/r.ts", "R"),
  ];
  const edges = [
    imp("W/w.ts", "CORE/core.ts"), imp("X/x.ts", "CORE/core.ts"), imp("Y/y.ts", "CORE/core.ts"), imp("Z/z.ts", "CORE/core.ts"),
    imp("CORE/core2.ts", "CORE/core.ts"),                       // intra-component: must NOT count toward fan-in
    imp("P/p.ts", "LEAF/leaf.ts"), imp("Q/q.ts", "LEAF/leaf.ts"), imp("R/r.ts", "LEAF/leaf.ts"), // LEAF fan-in = 3
  ];
  const a = analyze(cfg(NOGIT), graph(nodes, edges), []);
  const hubs = Object.fromEntries(a.hubs);
  assert.equal(hubs["CORE"], 4);          // W,X,Y,Z — the intra-component edge did not inflate it
  assert.equal(hubs["LEAF"], undefined);  // 3 importers is below the ≥4 threshold
});

test("pairs — cross-boundary co-change is ranked by count, key is order-independent", () => {
  const g = graph([comp("A"), comp("B"), comp("C"), fileNode("A/a.ts", "A"), fileNode("B/b.ts", "B"), fileNode("C/c.ts", "C")]);
  const a = analyze(cfg(NOGIT), g, [
    commit(["A/a.ts", "B/b.ts"], "1"),
    commit(["A/a.ts", "B/b.ts"], "2"),
    commit(["C/c.ts", "A/a.ts"], "3"), // reversed file order, still keys "A  ⇄  C"
  ]);
  assert.deepEqual(a.pairs, [["A  ⇄  B", 2], ["A  ⇄  C", 1]]);
});

// ── Layer 2: the real git plumbing the injection bypasses ─────────────────────────────────

const git = (args: string[], cwd: string) => spawnSync("git", args, { cwd, encoding: "utf8" });
async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "coh-git-"));
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

test("readCommitLog — parses subjects + file lists, newest-first (the %x00/%x1f framing)", async (t) => {
  const root = await initRepo();
  t.after(() => cleanup(root));
  await gitCommit(root, "first", { "a.ts": "1" });
  await gitCommit(root, "second multi", { "b.ts": "2", "c.ts": "3" });

  const log = readCommitLog(cfg(root), 2000);
  assert.equal(log.length, 2);
  assert.equal(log[0].subject, "second multi"); // newest first
  assert.deepEqual([...log[0].files].sort(), ["b.ts", "c.ts"]);
  assert.equal(log[1].subject, "first");
  assert.deepEqual(log[1].files, ["a.ts"]);
});

test("componentMap — strips the git --show-prefix so a subdir repo's paths map to components", async (t) => {
  const root = await initRepo();
  t.after(() => cleanup(root));
  await gitCommit(root, "init", { "proj/Hive/hive.ts": "x" }); // project lives in a subdir
  const projCfg = cfg(join(root, "proj"));                     // cfg.root is the subdir → non-empty prefix
  const g = graph([comp("Hive"), fileNode("Hive/hive.ts", "Hive")]);

  const { compOf, fileComp } = componentMap(projCfg, g);
  assert.equal(fileComp.get("Hive/hive.ts"), "Hive");            // graph map keyed cfg-root-relative
  assert.equal(compOf("proj/Hive/hive.ts"), "Hive");            // git path → prefix stripped → component
  assert.equal(compOf("other/x.ts"), undefined);               // outside the prefix → unmapped
});

test("decompose — end-to-end against a real repo prints the expected LOCALITY (wiring + formatter)", async (t) => {
  const root = await initRepo();
  t.after(() => cleanup(root));
  await gitCommit(root, "mixed", { "A/a1.ts": "1", "A/a2.ts": "2", "B/b1.ts": "3" }); // within=1, cross=2
  const g = graph([comp("A"), comp("B"), fileNode("A/a1.ts", "A"), fileNode("A/a2.ts", "A"), fileNode("B/b1.ts", "B")]);

  const { code, out } = await runCaptured(() => decompose(cfg(root), g));
  assert.equal(code, 0);
  assert.match(out, /LOCALITY 33%/);
});
