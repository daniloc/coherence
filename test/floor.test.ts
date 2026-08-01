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
import { readSurface, vacuityRefusal, ratchetVacuityRefusal, adoptionLadder, readJsonOrRefuse, Unrunnable } from "../src/floor.ts";
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

test("FLOOR — the SCOPED path refuses an empty derivation too, instead of grading it `nothing to check`", async () => {
  // THE POSITIVE DIRECTION OF THE TEST ABOVE, and it did not exist. `verify --staged`
  // takes an early exit when no changed file maps to a component, and a gutted deriver
  // reaches that exit for exactly the wrong reason: with no components in the graph,
  // NOTHING maps, so the evisceration would be graded "nothing to check", exit 0. cli.ts
  // guards it — but deleting those two lines left the whole suite green, which makes the
  // guard a claim nothing defends. Only the negative direction ("a scoped run over a
  // healthy graph never trips the floor") was pinned, and a gate tested in one direction
  // is half a gate.
  //
  // Driven through the CLI on purpose: the branch lives in the dispatch, above runVerify,
  // and a unit test of the engine cannot reach it.
  const dir = await tmpProject({
    "coherence.config.json": JSON.stringify({ outputDir: "public", entryDir: ".", typecheck: ["true"] }),
    "a/a.spec.md": "# A\n\nThe A component.\n\n## works when\n\n- x.ts exists at this node\n\n## why\n\nThe fixture needs a rationale like any other component.\n",
    "a/x.ts": "/** what. why: r */\nexport const x = 1;\n",
    "b/b.spec.md": "# B\n\nThe B component.\n\n## works when\n\n- y.ts exists at this node\n\n## why\n\nThe fixture needs a rationale like any other component.\n",
    "b/y.ts": "/** what. why: r */\nexport const y = 1;\n",
  });
  try {
    for (const args of [["init", "-q"], ["add", "-A"], ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"]]) {
      await run("git", args, { cwd: dir });
    }
    // 1. A full run files the memory (both components), and a healthy SCOPED run over a
    //    real change grades normally against it.
    const seed = await cli(["verify"], dir);
    assert.equal(seed.code, 0, seed.out);
    await writeFile(join(dir, "a", "x.ts"), "/** what. why: r */\nexport const x = 2;\n");
    const healthyRun = await cli(["verify", "--staged"], dir);
    assert.equal(healthyRun.code, 0, healthyRun.out);
    assert.match(healthyRun.out, /^verify \(scoped to 1 changed component\(s\)\): a$/m, "the fixture must really scope, or this proves nothing");
    assert.ok(JSON.parse(await readFile(join(dir, ".coherence", "status.json"), "utf8")).verify.claims.length >= 2);

    // 2. Derivation breaks — the spec files the graph is derived FROM go away, which is
    //    what a gutted `buildGraph` looks like from here: zero components, zero claims.
    //    With no components, NO changed file can map to one, so the scoped early exit is
    //    reached for precisely the wrong reason.
    await rm(join(dir, "a", "a.spec.md"));
    await rm(join(dir, "b", "b.spec.md"));

    const r = await cli(["verify", "--staged"], dir);
    assert.equal(r.code, 1, "an eviscerated graph must refuse on the scoped path, not exit 0");
    assert.match(r.out, /\[floor\]/);
    assert.match(r.out, /0 component\(s\), 0 claims/);
    assert.doesNotMatch(r.out, /nothing to check/, "`nothing to check` over a remembered surface is the failure, not the report of it");
    assert.doesNotMatch(r.out, /✓ coherent/);
    // The refusal files no record — otherwise it refuses once and waves every run after
    // it through, which is the same permanence defect as an unreadable record.
    assert.ok(JSON.parse(await readFile(join(dir, ".coherence", "status.json"), "utf8")).verify.claims.length >= 2,
      "the scoped refusal must leave the remembered surface intact");
  } finally { await cleanup(dir); }
});

test("VACUITY — a scoped run that evaluates ZERO claims says `nothing to check`, never `✓ coherent`", async () => {
  // A verdict has two halves: the POPULATION examined and what was found there. Drop the
  // population and `0 of 0` renders exactly like `0 of 500` — "I looked and found nothing
  // wrong" becomes indistinguishable from "I did not look". Reproduced live 2026-07-31,
  // needing no mutation: a healthy two-component tree, one unowned root-level file
  // changed, and `verify --staged` printed `scoped to 1 changed component(s): .` over a
  // component that does not exist, then `claims: 0 · 0 green`, then `✓ coherent`, exit 0.
  //
  // `ownerOf` returning null is what stops that scope set being minted at all; this is the
  // second door on the same failure, at the seam that owns the WORD "coherent". Exit 0,
  // because an empty scope is ordinary — it is a green claim over nothing that is not.
  await withProject({ ".coherence/status.json": remembered(4), "a/x.txt": "" }, async (root) => {
    const g = graph([comp("a", { label: "A", claims: ["x.txt exists at this node"], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { only: new Set(["nosuchdir"]) }));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /✓ coherent/, "health was pronounced over nothing");
    assert.doesNotMatch(r.out, /claims: 0/, "a `0 of 0` tally with no population is the defect, not the report of it");
    assert.match(r.out, /nothing to check/);
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

// ── the RATCHET floor: the same reading, one file over ─────────────────────────────────
//
// `verify` holds its memory in .coherence/status.json; a baselined ratchet holds its own,
// in the file it pins. The defect is identical and was measured on `mass` (2026-07-31): a
// gutted `buildGraph` made `--check` print "✓ mass ratchet held" and then prescribe
// "4 dimension(s) SHRANK — re-pin to bank it", and the pin that followed zeroed four
// dimensions and dropped a fifth. It did not wash out when derivation was restored — it
// INVERTED, and the project's own untouched mass then failed the ratchet as GROWTH.
//
// The end-to-end enforcement is in commands.test.ts, which demands the refusal from every
// command declaring `writesBaseline`. What is pinned HERE is the rule's own boundary: it
// must fire on total collapse and it must never fire on ordinary deletion.

const reading = (live: number, pinned: number) => ({
  ratchet: "mass", baseline: "public/mass-baseline.json",
  live, unit: "graph file(s) + symbol(s)",
  pinned, pinnedUnit: "file(s) + symbol(s)",
});

test("ratchet floor — a TOTAL collapse over a live baseline refuses at BOTH seams, in the seam's own words", () => {
  const check = ratchetVacuityRefusal(reading(0, 12), "check");
  const update = ratchetVacuityRefusal(reading(0, 12), "update");
  assert.ok(check && update);
  for (const r of [check!, update!]) {
    assert.match(r[0], /\[floor\] mass examined NOTHING this run — 0 graph file\(s\) \+ symbol\(s\)/);
    assert.match(r.join("\n"), /public\/mass-baseline\.json/, "the refusal names the file a reader has to open");
  }
  // The two seams fail for DIFFERENT reasons and say so: grading nothing reports success
  // over nothing; pinning nothing writes the break into the floor every later run is
  // graded against. A shared sentence would lose the half that tells you what you nearly did.
  assert.match(check!.join("\n"), /Refusing to grade this run/);
  assert.match(update!.join("\n"), /Refusing to pin this run/);
  assert.match(update!.join("\n"), /reads the project's own mass as GROWTH/);
});

test("ratchet floor — deletion stays FREE: partial shrinkage never refuses, and neither does a first pin", () => {
  // The discriminator is TOTAL COLLAPSE, exactly as for the graph floor above. A ratchet
  // that punished removal would teach people to stop removing, so a project that deleted
  // 99% of itself still passes this rule and faces only the ordinary ratchet.
  assert.equal(ratchetVacuityRefusal(reading(1, 5000), "check"), null, "one surviving file is a denominator");
  assert.equal(ratchetVacuityRefusal(reading(4999, 5000), "check"), null);
  // Nothing pinned, nothing to betray: an empty reading on a project that never had a
  // non-empty one is the on-ramp, not a refusal — the same call the graph floor makes for
  // a record that remembers zero.
  assert.equal(ratchetVacuityRefusal(reading(0, 0), "check"), null);
  assert.equal(ratchetVacuityRefusal(reading(0, 0), "update"), null);
});

test("an instrument that cannot run REPORTS — `log` outside a git repo names the requirement, exit 2", async () => {
  // The opposite face of green-by-absence: this used to reach the operator as a raw throw
  // out of withTreeAt, complete with a stack and a `Node.js vX` banner. A crash is a report
  // that failed to say what was and was not measured. The state is ordinary, not exotic —
  // a shallow CI clone, a source export, a worktree that lost its .git.
  const dir = await tmpProject({
    "coherence.config.json": JSON.stringify({ outputDir: "public", entryDir: "app" }),
    "app/app.spec.md": "# app\n\nThe component.\n\n## works when\n\n- app.ts exists at this node\n",
  });
  try {
    const r = await run(process.execPath, [CLI_PATH, "log"], { cwd: dir })
      .then(() => ({ code: 0, stdout: "", stderr: "" }), (e: { code: number; stdout: string; stderr: string }) => e);
    assert.equal(r.code, 2, "2 is this CLI's `could not run`, as distinct from 1, `ran and failed`");
    const out = `${r.stdout}${r.stderr}`;
    assert.match(out, /reads git HISTORY, and .* is not inside a git repository/);
    assert.match(out, /Nothing was measured/, "the report has to say the population was empty, not merely that it failed");
    assert.doesNotMatch(out, /^\s+at .*\(?file:\/\//m, "a stack trace is not a report");
    assert.doesNotMatch(out, /\bNode\.js v\d/);
  } finally { await cleanup(dir); }
});

// ── the MEMORY every floor above reads ────────────────────────────────────────────────
//
// Every gate on this page compares a live reading against a REMEMBERED one, and each
// remembered one lives in a JSON file that was loaded by `catch → return default`. That
// catch cannot tell "the file is not there" from "the file is there and I could not read
// it" — so one unparseable byte in any of the three turned the floor above it off. The
// status.json case was the worst of them because the run then FILED A FRESH RECORD over
// the corpse: the disarm was permanent, and where `.coherence/` is untracked there was
// not even a diff. Absent must keep meaning exactly what it meant; unreadable must refuse.

/** A small healthy project: two components, real claims, a real config. */
const healthy = (): Record<string, string> => ({
  "coherence.config.json": JSON.stringify({ outputDir: "public", entryDir: ".", typecheck: ["true"] }),
  "a/a.spec.md": "# A\n\nThe A component.\n\n## works when\n\n- x.ts exists at this node\n",
  "a/x.ts": "/** what. why: r */\nexport const x = 1;\n",
  "b/b.spec.md": "# B\n\nThe B component.\n\n## works when\n\n- y.ts exists at this node\n",
  "b/y.ts": "/** what. why: r */\nexport const y = 1;\n",
});

const cli = (args: string[], cwd: string) =>
  run(process.execPath, [CLI_PATH, ...args], { cwd })
    .then((ok) => ({ code: 0, out: `${ok.stdout}${ok.stderr}` }))
    .catch((e: { code?: number; stdout?: string; stderr?: string }) => ({ code: e.code ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }));

test("MEMORY — an unreadable .coherence/status.json REFUSES, and does not overwrite itself with a fresh one", async () => {
  // THE MEASURED DEFECT (2026-07-31, an adversarial review): truncate status.json — a
  // crashed write is enough — with derivation ALSO broken, and `verify` went from
  // `✗ [floor]` exit 1 to the adoption ladder, exit 0. The run then filed an empty record,
  // so every later run, verify and all six guarded generators, passed forever. The last
  // assertion is the one that matters: the corrupt file survives the refusal untouched.
  const dir = await tmpProject(healthy());
  try {
    await cli(["verify"], dir);                                   // file a real record
    const before = await readFile(join(dir, ".coherence", "status.json"), "utf8");
    assert.ok(JSON.parse(before).verify.claims.length >= 2, "the fixture must remember a surface, or this proves nothing");

    const truncated = before.slice(0, 40);                        // exactly what a crashed write leaves
    await writeFile(join(dir, ".coherence", "status.json"), truncated);

    for (const pass of ["first", "second"]) {
      const r = await cli(["verify"], dir);
      assert.equal(r.code, 2, `the ${pass} run must refuse (2 = could not run), not grade`);
      assert.match(r.out, /\[floor\] \.coherence\/status\.json EXISTS and DOES NOT PARSE/);
      assert.doesNotMatch(r.out, /✓ coherent/);
      assert.doesNotMatch(r.out, /○ adoption/, "an unreadable record must never read as a project that never adopted");
      assert.doesNotMatch(r.out, /^\s+at .*file:\/\//m, "a stack trace is not a report");
      // THE PERMANENCE IS THE DEFECT. A refusal that rewrote the file it refused against
      // would refuse exactly once and wave every run after it through — which is why the
      // SECOND pass is asserted at all.
      assert.equal(await readFile(join(dir, ".coherence", "status.json"), "utf8"), truncated,
        `the ${pass} refusal must leave the unreadable record byte-for-byte as it was`);
    }
  } finally { await cleanup(dir); }
});

test("MEMORY — the generators refuse an unreadable record too, and leave the good artifacts alone", async () => {
  // The floor guards the generators because they are a second door onto the same failure
  // (`FLOOR — a generator REFUSES to overwrite a good map with a blank one`, above). That
  // guard reads the record, so an unreadable record walked straight past it: `docs` wrote
  // `graph.json` with `"nodes": []`, blanking a good artifact.
  const dir = await tmpProject(healthy());
  try {
    await cli(["verify"], dir);
    await cli(["docs"], dir);
    const good = await readFile(join(dir, "public", "graph.json"), "utf8");
    assert.ok(good.includes("x.ts"), "the fixture must produce a non-empty map, or this proves nothing");
    await writeFile(join(dir, ".coherence", "status.json"), "{\"version\":1,\"veri");

    for (const args of [["docs"], ["graph"], ["contract"], ["docs", "--check"]]) {
      const r = await cli(args, dir);
      assert.equal(r.code, 2, `\`coherence ${args.join(" ")}\` must refuse an unreadable record`);
      assert.match(r.out, /\[floor\] \.coherence\/status\.json/, `\`coherence ${args.join(" ")}\` must say WHY`);
    }
    assert.equal(await readFile(join(dir, "public", "graph.json"), "utf8"), good, "the refusal must leave the good map intact");
  } finally { await cleanup(dir); }
});

test("MEMORY — an unreadable ratchet baseline REFUSES the PIN, rather than pinning zeroes over it", async () => {
  // The inversion incident mass.ts's own header documents, reachable through one byte:
  // truncate mass-baseline.json over a real population and `--update-baseline` printed
  // "Pinned 4 mass dimension(s)", exit 0, with every dimension at zero — because a null
  // baseline reads as "never pinned", and `update` skips the ratchet floor when nothing
  // is pinned. The check seam is asserted alongside it: a `held` over a baseline nobody
  // could read is the same green-by-absence one command over.
  const dir = await tmpProject(healthy());
  try {
    const pin = await cli(["mass", "--update-baseline"], dir);
    assert.equal(pin.code, 0, pin.out);
    const before = await readFile(join(dir, "public", "mass-baseline.json"), "utf8");
    assert.ok(JSON.parse(before).length > 0, "the fixture must pin a live population, or this proves nothing");

    const truncated = before.slice(0, 30);
    await writeFile(join(dir, "public", "mass-baseline.json"), truncated);
    for (const args of [["mass", "--update-baseline"], ["mass", "--check"]]) {
      const r = await cli(args, dir);
      assert.equal(r.code, 2, `\`coherence ${args.join(" ")}\` must refuse an unreadable baseline`);
      assert.match(r.out, /\[floor\] public\/mass-baseline\.json EXISTS and DOES NOT PARSE/);
      assert.doesNotMatch(r.out, /Pinned \d+ mass dimension/, "a refusal that still pinned would bank the break as the new floor");
      assert.doesNotMatch(r.out, /ratchet held/);
    }
    assert.equal(await readFile(join(dir, "public", "mass-baseline.json"), "utf8"), truncated, "the refusal must not rewrite the pin");
  } finally { await cleanup(dir); }
});

test("MEMORY — an unreadable coherence.config.json REFUSES, instead of degrading to the defaults", async () => {
  // Silently defaulting is not a milder version of the same thing: it is the harness
  // reading a DIFFERENT TREE than the one it was configured to read, and reporting on it
  // with full confidence. `ignore`, `codeExt` and `sources` all revert (the walk changes
  // shape), and `name` reverts to absent — which resurrects the cross-checkout
  // `docs --check` false positive b32965d shipped to kill.
  const dir = await tmpProject(healthy());
  try {
    await writeFile(join(dir, "coherence.config.json"), '{ "outputDir": "public",\n');
    const r = await cli(["verify"], dir);
    assert.equal(r.code, 2);
    assert.match(r.out, /\[floor\] coherence\.config\.json EXISTS and DOES NOT PARSE/);
    assert.match(r.out, /walking a DIFFERENT TREE than you configured/);
    assert.doesNotMatch(r.out, /✓ coherent/);
    assert.doesNotMatch(r.out, /^\s+at .*file:\/\//m, "a stack trace is not a report");
  } finally { await cleanup(dir); }
});

test("MEMORY — ABSENT keeps meaning exactly what it always meant: adoption, defaults, a first pin", async () => {
  // THE HALF THAT MUST NOT MOVE. The three readers exist to serve legitimately-empty
  // states — a first run, a project mid-adoption, an unpinned ratchet — and a fix that
  // refused those would be a worse instrument than the one it replaced. Asserted through
  // the CLI, on a project carrying NONE of the three files.
  const dir = await tmpProject({
    "a/a.spec.md": "# A\n\nThe A component.\n\n## why\n\nBecause the fixture needs one.\n",
    "a/x.ts": "/** what. why: r */\nexport const x = 1;\n",
  });
  try {
    const v = await cli(["verify"], dir);          // no config, no record
    assert.equal(v.code, 0, v.out);
    assert.doesNotMatch(v.out, /\[floor\]/, "an absent config and an absent record are the on-ramp, never a refusal");
    assert.match(v.out, /○ adoption — step 1/, "no coherence.config.json is rung 1, exactly as before");

    const m = await cli(["mass", "--update-baseline"], dir);   // no baseline
    assert.equal(m.code, 0, m.out);
    assert.match(m.out, /Pinned \d+ mass dimension/, "a first pin over an absent baseline stays free");
  } finally { await cleanup(dir); }
});

test("MEMORY — the seam itself: absent is null, unreadable throws Unrunnable naming the file", async () => {
  // The rule is ONE seam (`readJsonOrRefuse`) and not three catch blocks, because three
  // hand-rolled copies of it is how all three readers came to have the same defect. Pinned
  // directly so the next persistent reader inherits a rule with a witness, and so a
  // regression names the seam rather than one of its callers.
  const dir = await tmpProject({ "there.json": "{ oh no", "afile": "not a directory" });
  const memory = { label: "there.json", what: "a memory", absentMeans: "nothing was recorded", consequence: ["a floor goes quiet."] };
  try {
    assert.equal(await readJsonOrRefuse(join(dir, "not-there.json"), memory), null,
      "ABSENT is legitimate — the state adoption, a first run and an unpinned ratchet all share");
    assert.equal(await readJsonOrRefuse(join(dir, "afile", "under.json"), { ...memory, label: "afile/under.json" }), null,
      "ENOTDIR — absence one directory up — is still absence, not a corrupt file");
    await assert.rejects(
      () => readJsonOrRefuse(join(dir, "there.json"), memory),
      (e: unknown) => {
        assert.ok(e instanceof Unrunnable, "the refusal must be the type the CLI renderer is total over, not a raw SyntaxError");
        const out = e.report.join("\n");
        assert.match(out, /there\.json EXISTS and DOES NOT PARSE AS JSON/);
        assert.match(out, /NOTHING has been written/, "the report must say what it did NOT do — the permanence is the defect");
        assert.match(out, /nothing was recorded/, "the report must say what an absent one would have meant");
        return true;
      },
    );
  } finally { await cleanup(dir); }
});
