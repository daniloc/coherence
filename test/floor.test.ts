// floor.test.ts — the NON-VACUITY FLOOR and the adoption on-ramp (src/floor.ts).
//
// The defect the floor closes, reproduced by hand twice before it existed (2026-07-31):
// gut `buildGraph` to return an empty graph and verify printed `claims: 0 · 0 green ·
// 0 red · 0 skipped` and `✓ coherent`, exit 0 — the entire verification surface vanished
// from derivation and the gate reported success. Every claim-defended verdict rests on
// the graph deriving non-empty, so that premise is now checked FIRST (the same
// instrument-check-first idiom commands.test.ts applies to its AST scanner).
//
// The same observation — zero components, zero claims — is also what a repo that never
// adopted the harness looks like. What separates them is the record's memory, so the
// second half of this file pins the other answer: the adoption ladder, one rung per run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runVerify } from "../src/verify.ts";
import { readSurface, vacuityRefusal, adoptionLadder } from "../src/floor.ts";
import type { StatusRecord } from "../src/status.ts";
import { tmpProject, cleanup, runCaptured, cfg, comp, sym, graph } from "./_helpers.ts";

const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = promisify(execFile);

const withProject = async (
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
) => {
  const root = await tmpProject(files);
  try { await fn(root); } finally { await cleanup(root); }
};

/** Seed a status record remembering `n` claim rows — the memory the floor reads. */
const remembered = (n: number): string => JSON.stringify({
  version: 1,
  verify: {
    at: "2026-07-30T00:00:00.000Z", commit: "abc1234", dirty: false, tier: "full", scope: null,
    claims: Array.from({ length: n }, (_, i) => ({
      node: "Root", claim: `passes test "t${i}"`, kind: "pass",
      at: "2026-07-30T00:00:00.000Z", commit: "abc1234", tier: "full",
    })),
    coverage: { components: 1, claimed: 1, withWhy: 1, symbols: 0, documented: 0 },
    invariants: { total: 0, anchored: 0, gaps: [] },
    narrative: null, jobs: 0, failures: 0,
  },
} satisfies StatusRecord, null, 2);

// ── the floor ─────────────────────────────────────────────────────────────────────────

test("FLOOR — an empty derivation against a remembered surface REFUSES, never reports coherent", async () => {
  await withProject({ ".coherence/status.json": remembered(3) }, async (root) => {
    const r = await runCaptured(() => runVerify(cfg(root), graph([]), {}));
    assert.equal(r.code, 1, "zero claims over a remembered surface must not exit 0");
    assert.match(r.out, /\[floor\]/);
    assert.match(r.out, /remembers 3 claim/);
    assert.doesNotMatch(r.out, /✓ coherent/);
    assert.doesNotMatch(r.out, /claims: 0/, "the refusal fires BEFORE grading — nothing is graded");
    // THE REFUSAL FILES NO RECORD: overwriting the memory it refused against would make
    // the floor refuse exactly once, then wave the same evisceration through.
    const after = JSON.parse(await readFile(join(root, ".coherence", "status.json"), "utf8")) as StatusRecord;
    assert.equal(after.verify?.claims.length, 3, "the record still remembers the surface");
  });
});

test("floor — components stripped of every claim refuse too (a broken spec parse, not just a gutted walk)", async () => {
  await withProject({ ".coherence/status.json": remembered(5) }, async (root) => {
    const r = await runCaptured(() => runVerify(cfg(root), graph([comp(".", { claims: [], why: "r" })]), {}));
    assert.equal(r.code, 1);
    assert.match(r.out, /1 component\(s\), 0 claims/);
  });
});

test("floor — scope-blind by construction: a scoped run over a healthy graph never trips it", async () => {
  // The graph is always derived full-tree; --staged/--since narrow what is EVALUATED.
  // A reading taken above the scoping seam needs no scope exemption — pinned here so a
  // future refactor that moves the floor below the seam fails loudly.
  await withProject({ ".coherence/status.json": remembered(4), "a/x.txt": "", "b/y.txt": "" }, async (root) => {
    const g = graph([
      comp("a", { label: "A", claims: ["x.txt exists at this node"], why: "r" }),
      comp("b", { label: "B", claims: ["y.txt exists at this node"], why: "r" }),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { only: new Set(["a"]) }));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /\[floor\]/);
    assert.match(r.out, /claims: 1/);
  });
});

test("floor — a PARTIAL collapse is deliberately NOT refused: pruning and breakage are indistinguishable there", async () => {
  // 4 remembered → 1 derived, every surviving component still carrying a claim. That is
  // the exact shape of deliberate spec pruning (this repo pruned its own trivialities the
  // day the floor landed), and coverage already reds any component whose claims ALL
  // vanished — so the floor stops at zero, where no legitimate reading exists.
  await withProject({ ".coherence/status.json": remembered(4), "x.txt": "" }, async (root) => {
    const r = await runCaptured(() => runVerify(cfg(root), graph([comp(".", { claims: ["x.txt exists at root"], why: "r" })]), {}));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /\[floor\]/);
  });
});

test("floor — a record that remembers ZERO claims is the on-ramp, never a refusal", () => {
  const s = readSurface(graph([]), { version: 1 });
  assert.equal(s.remembered, null);
  assert.equal(vacuityRefusal(s), null);
  const zero = readSurface(graph([]), {
    version: 1,
    verify: { at: "t", commit: null, dirty: false, tier: "full", scope: null, claims: [], coverage: { components: 0, claimed: 0, withWhy: 0, symbols: 0, documented: 0 }, invariants: { total: 0, anchored: 0, gaps: [] }, narrative: null, jobs: 0, failures: 0 },
  });
  assert.equal(zero.remembered, 0);
  assert.equal(vacuityRefusal(zero), null, "an adoption run that filed claims: [] must not lock the project out");
});

// ── the on-ramp ───────────────────────────────────────────────────────────────────────

test("on-ramp — no record, no claims, no config: rung 1 names the config, exits 0, and never says coherent", async () => {
  await withProject({}, async (root) => {
    const r = await runCaptured(() => runVerify(cfg(root), graph([]), {}));
    assert.equal(r.code, 0, "the on-ramp is not an error");
    assert.match(r.out, /adoption — step 1/);
    assert.match(r.out, /coherence\.config\.json/);
    assert.doesNotMatch(r.out, /✓ coherent/, "zero claims verified is not coherence");
  });
});

test("on-ramp — config but no specs: rung 2 points at the instruments, not at a guess", async () => {
  await withProject({ "coherence.config.json": "{}" }, async (root) => {
    const r = await runCaptured(() => runVerify(cfg(root), graph([]), {}));
    assert.equal(r.code, 0);
    assert.match(r.out, /adoption — step 2/);
    for (const tool of ["decompose", "economy", "redundancy"]) assert.match(r.out, new RegExp(tool));
    assert.doesNotMatch(r.out, /✓ coherent/);
  });
});

test("on-ramp — specs but no claims: rung 3 exits 0 DESPITE the coverage gap, and prescribes the incident", async () => {
  await withProject({ "coherence.config.json": "{}" }, async (root) => {
    const r = await runCaptured(() => runVerify(cfg(root), graph([comp(".", { label: "Gadget", claims: [], why: "r" })]), {}));
    assert.equal(r.code, 0, "a spec with an empty ## works when is an on-ramp state, not a defect");
    assert.match(r.out, /adoption — step 3/);
    assert.match(r.out, /born\s+from an incident/);
    assert.match(r.out, /\[coverage\] component "Gadget" has no claims/, "the gap is still named — only the verdict changes");
    assert.doesNotMatch(r.out, /✓ coherent/);
  });
});

test("on-ramp — rung 4 rides AFTER a normal verdict: claims graded, then the oracle-less ones named", async () => {
  await withProject({ "coherence.config.json": "{}", "x.txt": "" }, async (root) => {
    const r = await runCaptured(() => runVerify(cfg(root), graph([comp(".", { label: "Root", claims: ["x.txt exists at root"], why: "r" })]), {}));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /✓ coherent/, "rung 4 is a next action, never a verdict override");
    assert.match(r.out, /adoption — step 4/);
    assert.match(r.out, /\[Root\] x\.txt exists at root/);
  });
});

test("on-ramp — rung 5 wants one observed failure; the first refutation graduates the ladder", async () => {
  const c = { root: "/nowhere" } as any;
  const oracled = (refutations: string[]) => graph([
    comp(".", { claims: ['boundary "b" at Choke via guard "g"'], invariants: ["b"], refutations, why: "r" }),
    sym("Choke"),
  ]);
  const rung5 = await adoptionLadder(c, oracled([]));
  assert.equal(rung5?.rung, 5);
  assert.equal(rung5?.onramp, false);
  assert.match(rung5!.lines.join("\n"), /refutations/);
  assert.equal(await adoptionLadder(c, oracled(["b: broke it -> red"])), null, "a refuted project has graduated");
});

test("on-ramp — `conforms to` counts as oracle-backed: a word is a contract, not a nag target", async () => {
  const state = await adoptionLadder({ root: "/nowhere" } as any, graph([comp(".", { claims: ["conforms to SealedSchema"], why: "r" })]));
  assert.notEqual(state?.rung, 4);
});

// ── the floor guards the GENERATORS, not just the grader ──────────────────────────────

test("FLOOR — a generator REFUSES to overwrite a good map with a blank one", async () => {
  // THE INCIDENT THIS PINS (2026-07-31). A mutation test gutted `buildGraph`; `contract`
  // then ran against the claimless graph and rewrote promise.json with 13 gates degraded
  // from grade C to "unknown". The mutation was reverted — but reverting SOURCE does not
  // re-run a generator, so the poisoned artifacts outlived it and read to the next reviewer
  // as claim history silently vanishing, which is the exact signature of a claim-key
  // erasure bug. It cost a full investigation to prove it was not one.
  //
  // `verify` refusing to GRADE an empty derivation never protected this: the generators are
  // a second door onto the same failure, and writing a blank map through it launders a
  // broken deriver into a committed diff. The assertion that matters is the last one — the
  // artifacts are BYTE-UNCHANGED, not merely that the command exited nonzero.
  const dir = await tmpProject({
    "coherence.config.json": JSON.stringify({ outputDir: "public", entryDir: "app" }),
    "app/app.spec.md": "# app\n\nThe fixture component.\n\n## works when\n\n- app.ts exists at this node\n",
    "app/app.ts": "export const x = 1;\n",
  });
  try {
    // 1. A healthy tree generates a real map.
    await run(process.execPath, [CLI_PATH, "docs"], { cwd: dir });
    await run(process.execPath, [CLI_PATH, "contract"], { cwd: dir });
    const good = await readFile(join(dir, "public", "graph.json"), "utf8");
    const goodContract = await readFile(join(dir, "public", "promise.json"), "utf8");
    assert.ok(good.includes("app.ts"), "the fixture must produce a non-empty map, or this test proves nothing");

    // 2. Derivation breaks — modelled by removing the spec the graph is derived FROM,
    //    which is what a gutted `buildGraph` looks like from the artifacts' point of view:
    //    zero components, zero claims. The record still remembers the surface.
    await rm(join(dir, "app", "app.spec.md"));
    await mkdir(join(dir, ".coherence"), { recursive: true });
    await writeFile(join(dir, ".coherence", "status.json"), remembered(3));

    // 3. Every generator refuses — writing AND checking, because a staleness report is a
    //    diagnosis and "4 artifacts stale" sends a reader to regenerate when the truth is
    //    that derivation is broken.
    for (const args of [["docs"], ["graph"], ["contract"], ["atlas"], ["docs", "--check"]]) {
      const r = await run(process.execPath, [CLI_PATH, ...args], { cwd: dir })
        .then((ok) => ({ code: 0, stdout: ok.stdout }))
        .catch((e: { code?: number; stdout?: string }) => ({ code: e.code ?? -1, stdout: e.stdout ?? "" }));
      assert.equal(r.code, 1, `\`coherence ${args.join(" ")}\` must refuse an empty derivation, not proceed`);
      assert.match(r.stdout, /\[floor\]/, `\`coherence ${args.join(" ")}\` must say WHY it refused`);
    }

    // 4. And nothing was overwritten. This is the whole point.
    assert.equal(await readFile(join(dir, "public", "graph.json"), "utf8"), good, "the refusal must leave the good map intact");
    assert.equal(await readFile(join(dir, "public", "promise.json"), "utf8"), goodContract, "the refusal must leave the good contract intact");
  } finally { await cleanup(dir); }
});
