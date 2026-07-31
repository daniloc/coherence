// evolution.test.ts — the shared EVOLUTION store (src/evolution.ts): the ONE home for the
// git derivation decompose, drift, scene and mass all read. Two layers, the same split
// decompose.test.ts's header sets out and for the same reason:
//   1. the pure derivations — fileChurn / componentChurn / locDeltaSeries driven through
//      HAND-BUILT commit arrays: exhaustive, deterministic, no git.
//   2. the git plumbing the injection bypasses — readCommitLog's %x00/%x1f parser,
//      commitDeltas' --shortstat parse, and THE MEMO — driven through real throwaway
//      repos, because a memo is precisely the thing an injected array cannot exercise.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  gitPrefix, rebaseCommits,
  BULK, CHURN_WINDOW, bucketize, commitDeltas, componentChurn, fileChurn,
  locDeltaSeries, readCommitLog, _resetEvolutionMemo, type Commit, type Delta,
} from "../src/evolution.ts";
import { cfg, cleanup } from "./_helpers.ts";

const commit = (files: string[], hash = "h", subject = "s"): Commit => ({ hash, subject, files });
const NOGIT = "/coherence-test-no-such-dir";

// ── Layer 1: the pure derivations ────────────────────────────────────────────────────────

test("fileChurn — counts touches per git path over the 2…BULK band", () => {
  const { byFile, considered } = fileChurn([
    commit(["a.ts", "b.ts"], "1"),
    commit(["a.ts", "c.ts"], "2"),
    commit(["a.ts", "b.ts", "c.ts"], "3"),
  ]);
  assert.equal(considered, 3);
  assert.equal(byFile.get("a.ts"), 3);
  assert.equal(byFile.get("b.ts"), 2);
  assert.equal(byFile.get("c.ts"), 2);
});

test("fileChurn — the BULK band boundary: 1 file is out, exactly BULK is in, BULK+1 is out", () => {
  const one = commit(["solo.ts"], "1");
  const atBulk = commit(Array.from({ length: BULK }, (_, i) => `k${i}.ts`), "at");
  const overBulk = commit(Array.from({ length: BULK + 1 }, (_, i) => `y${i}.ts`), "over");
  const { byFile, considered } = fileChurn([one, atBulk, overBulk]);
  assert.equal(considered, 1);                    // only the exactly-BULK commit survived
  assert.equal(byFile.get("solo.ts"), undefined);
  assert.equal(byFile.get("k0.ts"), 1);
  assert.equal(byFile.get("y0.ts"), undefined);
  assert.equal(byFile.size, BULK);
});

test("fileChurn — empty history is zeros, never NaN or undefined", () => {
  const { byFile, considered } = fileChurn([]);
  assert.equal(considered, 0);
  assert.equal(byFile.size, 0);
});

test("componentChurn — a commit counts ONCE per component however many of its files landed there", () => {
  const compOf = (p: string): string | null => (p.startsWith("A/") ? "A" : p.startsWith("B/") ? "B" : null);
  const churn = componentChurn(compOf, [
    commit(["A/a1.ts", "A/a2.ts", "A/a3.ts"], "1"),   // A once, not three times
    commit(["A/a1.ts", "B/b.ts"], "2"),
    commit(["ghost/z.ts"], "3"),                      // owned by nobody → contributes nothing
  ]);
  assert.equal(churn.get("A"), 2);
  assert.equal(churn.get("B"), 1);
  assert.equal(churn.size, 2);
});

test("componentChurn — a >BULK commit is excluded, but a 1-file commit is NOT (heat, not coupling)", () => {
  // The distinction is deliberate and is the scene's semantics, preserved verbatim: a
  // single-file commit has no PAIR to contribute to coupling but is absolutely a district
  // being worked in. fileChurn (coupling-shaped) drops it; componentChurn (heat) keeps it.
  const compOf = (p: string): string | null => (p.startsWith("A/") ? "A" : null);
  const churn = componentChurn(compOf, [
    commit(["A/solo.ts"], "1"),
    commit(Array.from({ length: BULK + 1 }, (_, i) => `A/m${i}.ts`), "mechanical"),
  ]);
  assert.equal(churn.get("A"), 1);
});

test("componentChurn — an undefined-returning compOf (componentMap's shape) is accepted", () => {
  const compOf = (p: string): string | undefined => (p === "A/a.ts" ? "A" : undefined);
  const churn = componentChurn(compOf, [commit(["A/a.ts", "z.ts"], "1")]);
  assert.deepEqual([...churn], [["A", 1]]);
});

test("locDeltaSeries — NET delta per bucket, OLDEST → NEWEST (git hands us newest-first)", () => {
  const deltas = new Map<string, Delta>([
    ["new", { added: 100, deleted: 0 }],
    ["mid", { added: 10, deleted: 4 }],
    ["old", { added: 1, deleted: 0 }],
  ]);
  const commits = [commit([], "new"), commit([], "mid"), commit([], "old")]; // newest first
  assert.deepEqual(locDeltaSeries(deltas, commits, 3), [1, 6, 100]);
});

test("locDeltaSeries — a net-removal window is NEGATIVE, and that is the point", () => {
  const deltas = new Map<string, Delta>([["a", { added: 3, deleted: 90 }], ["b", { added: 5, deleted: 1 }]]);
  assert.deepEqual(locDeltaSeries(deltas, [commit([], "a"), commit([], "b")], 2), [4, -87]);
});

test("locDeltaSeries — a commit with no delta entry contributes 0 rather than dropping its bucket", () => {
  const deltas = new Map<string, Delta>([["a", { added: 7, deleted: 2 }]]);
  assert.deepEqual(locDeltaSeries(deltas, [commit([], "a"), commit([], "empty")], 2), [0, 5]);
});

test("locDeltaSeries — bucket edges: 8 commits → 8 buckets; 9 → 5 (ceil, never a padded window)", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => commit([], `c${i}`));
  const deltas = new Map<string, Delta>(mk(9).map((c) => [c.hash, { added: 1, deleted: 0 }] as const));
  assert.equal(locDeltaSeries(deltas, mk(8)).length, 8);
  const nine = locDeltaSeries(deltas, mk(9));
  assert.equal(nine.length, 5);            // k = ceil(9/8) = 2 → 5 buckets, the last a singleton
  assert.deepEqual(nine, [2, 2, 2, 2, 1]);
});

test("locDeltaSeries — empty history is an empty series, not a row of fake zeros", () => {
  assert.deepEqual(locDeltaSeries(new Map(), []), []);
});

test("bucketize — order preserved, contiguous, never empty buckets", () => {
  assert.deepEqual(bucketize([1, 2, 3, 4, 5], 2), [[1, 2, 3], [4, 5]]);
  assert.deepEqual(bucketize([], 8), []);
  assert.deepEqual(bucketize([1], 8), [[1]]);
});

test("CHURN_WINDOW is a named constant (the bare 200 that hid the third spelling)", () => {
  assert.equal(CHURN_WINDOW, 200);
  assert.equal(BULK, 40);
});

// ── Layer 2: the git plumbing + THE MEMO ─────────────────────────────────────────────────

const git = (args: string[], cwd: string) => spawnSync("git", args, { cwd, encoding: "utf8" });
async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "coh-evo-"));
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

test("readCommitLog — PARITY with the reader decompose used to own: subjects + file lists, newest-first", async (t) => {
  const root = await initRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  await gitCommit(root, "first", { "a.ts": "1" });
  await gitCommit(root, "second multi", { "b.ts": "2", "c.ts": "3" });

  const log = readCommitLog(cfg(root), 2000);
  assert.equal(log.length, 2);
  assert.equal(log[0].subject, "second multi");
  assert.deepEqual([...log[0].files].sort(), ["b.ts", "c.ts"]);
  assert.equal(log[1].subject, "first");
  assert.deepEqual(log[1].files, ["a.ts"]);
});

test("readCommitLog — a root that is not a repo yields [], and caches THAT (no per-call git spawn)", () => {
  _resetEvolutionMemo();
  assert.deepEqual(readCommitLog(cfg(NOGIT), 10), []);
  assert.deepEqual(readCommitLog(cfg(NOGIT), 10), []);
});

test("commitDeltas — --shortstat parsed into per-hash added/deleted", async (t) => {
  const root = await initRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  await gitCommit(root, "add", { "a.ts": "1\n2\n3\n" });
  await gitCommit(root, "shrink", { "a.ts": "1\n" });

  const log = readCommitLog(cfg(root), 100);
  const deltas = commitDeltas(cfg(root), 100);
  const shrink = deltas.get(log[0].hash)!;
  assert.ok(shrink.deleted > shrink.added, "the second commit removed more than it added");
  const add = deltas.get(log[1].hash)!;
  assert.equal(add.added, 3);
  assert.equal(add.deleted, 0);
});

test("THE MEMO — a second read inside one process returns the FIRST answer; the reset drops it", async (t) => {
  // The memo's licence is "the CLI is one command per process, so HEAD cannot move
  // underneath it". This pins both halves of that: within a run the answer is stable
  // (the sharing is real, not a coincidence of git being fast), and _resetEvolutionMemo
  // makes a test process — the one place the licence does not hold — see the world again.
  const root = await initRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  await gitCommit(root, "one", { "a.ts": "1" });

  const first = readCommitLog(cfg(root), 100);
  assert.equal(first.length, 1);
  assert.equal(readCommitLog(cfg(root), 100), first, "the same array instance — this is a memo, not a re-read");

  await gitCommit(root, "two", { "b.ts": "2" });
  assert.equal(readCommitLog(cfg(root), 100).length, 1, "HEAD moved but the memo held — the documented licence");

  _resetEvolutionMemo();
  const after = readCommitLog(cfg(root), 100);
  assert.equal(after.length, 2);
  assert.equal(after[0].subject, "two");
});

test("THE MEMO — the key carries the LIMIT, so a different window is a different read", async (t) => {
  const root = await initRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  await gitCommit(root, "one", { "a.ts": "1" });
  await gitCommit(root, "two", { "b.ts": "2" });

  assert.equal(readCommitLog(cfg(root), 1).length, 1);
  assert.equal(readCommitLog(cfg(root), 100).length, 2);
  assert.notEqual(commitDeltas(cfg(root), 1).size, commitDeltas(cfg(root), 100).size);
});

test("glue — componentChurn over a REAL log is the same heat the scene used to compute inline", async (t) => {
  const root = await initRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  await gitCommit(root, "a work", { "A/a1.ts": "1", "A/a2.ts": "2" });
  await gitCommit(root, "cross", { "A/a1.ts": "1b", "B/b.ts": "3" });

  const compOf = (p: string): string | null => (p.startsWith("A/") ? "A" : p.startsWith("B/") ? "B" : null);
  const churn = componentChurn(compOf, readCommitLog(cfg(root), CHURN_WINDOW));
  assert.equal(churn.get("A"), 2);
  assert.equal(churn.get("B"), 1);
});

test("rebaseCommits — pure: strips the prefix, drops files outside the root, keeps '' as-is", () => {
  const cs = [commit(["app/a.ts", "app/sub/b.ts", "README.md"]), commit(["README.md"])];
  const rebased = rebaseCommits(cs, "app/");
  assert.deepEqual(rebased[0].files, ["a.ts", "sub/b.ts"]);
  assert.deepEqual(rebased[1].files, []);           // nothing inside the root — an empty commit, not a dropped one
  assert.equal(rebaseCommits(cs, ""), cs);          // root project: the same array, untouched
});

test("gitPrefix + rebaseCommits — glue: a cfg.root that is a SUBDIRECTORY reads its own history", async (t) => {
  // The regression that motivated the helper: a consumer rooted at <repo>/app measured
  // heat 0% on every crossing because git speaks repo-root paths and the graph does not.
  const root = await initRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  await gitCommit(root, "one", { "app/x.ts": "1", "app/y.ts": "1", "docs/readme.md": "outside" });
  await gitCommit(root, "two", { "app/x.ts": "2", "app/z.ts": "1" });
  const sub = join(root, "app");
  assert.equal(gitPrefix(cfg(sub)), "app/");
  const rebased = rebaseCommits(readCommitLog(cfg(sub), CHURN_WINDOW), gitPrefix(cfg(sub)));
  const { byFile, considered } = fileChurn(rebased);
  assert.equal(considered, 2);
  assert.equal(byFile.get("x.ts"), 2);              // addressed the way the graph addresses it
  assert.equal(byFile.get("app/x.ts"), undefined);  // the un-rebased spelling is gone
  assert.equal(byFile.get("readme.md"), undefined); // outside the root: dropped, not misfiled
});
