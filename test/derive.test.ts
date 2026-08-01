// derive.test.ts — A GENERATED ARTIFACT IS A FUNCTION OF THE TRACKED TREE, AND OF
// NOTHING ELSE.
//
// The defect these pin, measured 2026-07-31: verifying a commit inside a git worktree
// whose DIRECTORY was named differently from the main checkout made `docs --check` report
// four artifacts stale — AGENTS.md, graph.json, _graph.html, _overview.html — that were
// byte-correct for that commit. `buildGraph` set the project's rendered name to
// `basename(resolve(root))`, so the checkout's PATH leaked into every artifact. The name
// is not tracked, so the gate whose entire job is detecting real drift was reporting drift
// that did not exist, and it fails outright in any CI that clones to a non-default
// directory name.
//
// This is the harness's own doctrine turned on itself — `dissolve > declare > infer`. The
// name was INFERRED from the filesystem; it is now DECLARED in coherence.config.json, and
// the basename survives only as the fallback for a project that has not adopted the field.
//
// Two directions are needed and the negative control is the load-bearing one: asserting
// that a DECLARED name is stable proves nothing on its own, because a test that never
// varies the path would pass just as happily against the old hard-coded basename. So the
// first test varies the path with NO name declared and asserts the artifacts DO diverge —
// pinning the fallback as the known non-hermetic path — and the second varies the same
// path with a name declared and asserts byte-equality.
import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../src/derive.ts";
import { tmpProject, cleanup, cfg } from "./_helpers.ts";

/** A tree with enough shape to produce components, files and an import edge — so the
 *  comparison below is over a real artifact, not an empty one that would match trivially. */
const FILES = {
  "coherence.config.json": JSON.stringify({ outputDir: "public", entryDir: "." }),
  "app.spec.md": "# app\n\n## works when\n\n- main.ts exists at root\n",
  "main.ts": "import { helper } from './lib.ts';\nexport const run = () => helper();\n",
  "lib.ts": "export const helper = () => 1;\n",
};

/** The artifact as `coherence graph` would write it, minus the two fields the staleness
 *  gate already normalizes away: the clock and the absolute checkout path. What remains is
 *  what `docs --check` actually compares — so if THIS differs across two paths, the gate
 *  reports stale. */
const artifact = (g: Awaited<ReturnType<typeof buildGraph>>): string =>
  JSON.stringify({ ...g, generatedAt: "", absRoot: "" }, null, 2);

/** Build the same tree at two independently-named temp dirs. mkdtemp guarantees the
 *  basenames differ, which is exactly the condition a second worktree or a CI clone
 *  creates. */
const atTwoPaths = async (over: Parameters<typeof cfg>[1], fn: (a: string, b: string) => void) => {
  const rootA = await tmpProject(FILES);
  const rootB = await tmpProject(FILES);
  try {
    fn(artifact(await buildGraph(cfg(rootA, over))), artifact(await buildGraph(cfg(rootB, over))));
  } finally {
    await cleanup(rootA); await cleanup(rootB);
  }
};

test("NEGATIVE CONTROL: with no declared name the basename leaks into the artifact", async () => {
  await atTwoPaths({}, (a, b) => {
    assert.notEqual(a, b, "expected the undeclared-name fallback to be path-dependent — if this passes, the fallback no longer reads the basename and the test below has stopped proving anything");
    // And name the leak precisely, so a future change that makes them differ for some
    // OTHER reason cannot masquerade as this one still holding.
    assert.notEqual(JSON.parse(a).root, JSON.parse(b).root, "the divergence must be the `root` name specifically");
  });
});

test("a declared name makes the artifact identical across two differently-named checkouts", async () => {
  await atTwoPaths({ name: "fixed-name" }, (a, b) => {
    assert.equal(JSON.parse(a).root, "fixed-name");
    assert.equal(a, b, "the same commit at two paths must produce a byte-identical artifact — this is what makes `docs --check` hermetic");
  });
});

test("a blank or whitespace-only declared name falls back rather than rendering empty", async () => {
  // An empty string is falsy and a whitespace string is not, so the fallback has to trim.
  // Without this, a project that writes `"name": " "` gets artifacts titled with a space —
  // a silently corrupt render rather than a loud refusal or an honest default.
  const root = await tmpProject(FILES);
  try {
    for (const blank of ["", "   "]) {
      const g = await buildGraph(cfg(root, { name: blank }));
      assert.equal(g.root, (root.split("/").pop() ?? ""), `a ${JSON.stringify(blank)} name must fall back to the basename`);
    }
  } finally { await cleanup(root); }
});
