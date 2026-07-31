// verify.test.ts — the claim engine end-to-end, driven through runVerify against a
// hand-built graph + a throwaway project. Covers the deterministic claim verifiers, the
// boundary ratchet (chokepoint must exist; invariant must be anchored), the meta-oracle
// integration, and the testMatch evidence rule — the regression that "a renamed test
// silently stays green" specifically broke and that this rule exists to catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runVerify } from "../src/verify.ts";
import { tmpProject, cleanup, runCaptured, cfg, comp, sym, graph } from "./_helpers.ts";

const withProject = async (
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
) => {
  const root = await tmpProject(files);
  try { await fn(root); } finally { await cleanup(root); }
};

test("structural — `exists at root` passes when the file is present, fails when absent", async () => {
  await withProject({ "present.txt": "" }, async (root) => {
    const okG = graph([comp(".", { claims: ["present.txt exists at root"], why: "r" })]);
    const ok = await runCaptured(() => runVerify(cfg(root), okG, {}));
    assert.equal(ok.code, 0);
    assert.match(ok.out, /1 green/);

    const badG = graph([comp(".", { claims: ["missing.txt exists at root"], why: "r" })]);
    const bad = await runCaptured(() => runVerify(cfg(root), badG, {}));
    assert.equal(bad.code, 1);
    assert.match(bad.out, /coherence failure/);
  });
});

test("structural — `imports` checks the source actually imports the module", async () => {
  await withProject({ "a.ts": 'import x from "./b";\n', "yes.txt": "" }, async (root) => {
    const okG = graph([comp(".", { claims: ["a.ts imports ./b", "yes.txt exists at root"], why: "r" })]);
    assert.equal((await runCaptured(() => runVerify(cfg(root), okG, {}))).code, 0);
  });
  await withProject({ "a.ts": "const x = 1;\n" }, async (root) => {
    const badG = graph([comp(".", { claims: ["a.ts imports ./b"], why: "r" })]);
    assert.equal((await runCaptured(() => runVerify(cfg(root), badG, {}))).code, 1);
  });
});

test("passes test — a claim name with regex metacharacters (+ and parens) is escaped so it matches literally", async () => {
  // The runner receives the name as its `-t` arg and treats it as a REGEX. Our fake runner
  // builds `new RegExp(argv[2])` and tests it against the LITERAL name: it passes (exit 0)
  // only if the harness escaped the metacharacters — an unescaped `(name)`/`+` would compile
  // to a different pattern that does NOT match the literal string (exit 1, a false failure).
  const HAYSTACK = "the (name) with + here";
  const runner = `const re = new RegExp(process.argv[2]); process.exit(re.test(${JSON.stringify(HAYSTACK)}) ? 0 : 1);`;
  await withProject({ "runner.js": runner }, async (root) => {
    const g = graph([comp(".", { claims: [`passes test "${HAYSTACK}"`], why: "r" })]);
    const r = await runCaptured(() =>
      runVerify(cfg(root, { typecheck: ["true"], test: ["node", join(root, "runner.js")] }), g, { fast: false, serial: true }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 green/);
  });
});

test("boundary — a chokepoint symbol absent from the graph fails the claim", async () => {
  await withProject({}, async (root) => {
    const g = graph([comp(".", { claims: ['boundary "x" at MissingSym via guard "g"'], invariants: ["x"], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /chokepoint symbol "MissingSym" not found/);
  });
});

test("RATCHET — a declared invariant with no anchoring boundary fails coverage", async () => {
  await withProject({}, async (root) => {
    // "guarded" is anchored by the boundary claim; "orphan" is declared but nothing anchors it.
    const g = graph([
      comp(".", { claims: ['boundary "guarded" at Choke via guard "g"'], invariants: ["guarded", "orphan"], why: "r" }),
      sym("Choke"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /invariant "orphan".*not anchored/);
  });
});

test("RATCHET — a fully anchored invariant set is coherent (the green baseline)", async () => {
  await withProject({}, async (root) => {
    const g = graph([
      comp(".", { claims: ['boundary "guarded" at Choke via guard "g"'], invariants: ["guarded"], why: "r" }),
      sym("Choke"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 0);
    assert.match(r.out, /✓ coherent/);
  });
});

test("META-ORACLE — a `via test` boundary whose oracle loops a LITERAL fails", async () => {
  await withProject({ "o.test.ts": 'describe("lit oracle", () => { ["a"].forEach((x) => {}); });\n' }, async (root) => {
    const g = graph([
      comp(".", { claims: ['boundary "y" at ChokeY via test "lit oracle"'], invariants: ["y"], why: "r" }),
      sym("ChokeY"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /iterates a LITERAL domain/);
  });
});

test("META-ORACLE — a `via test` boundary whose oracle loops a LIVE domain passes the meta-check", async () => {
  await withProject(
    { "o.test.ts": 'import { REG } from "./r.ts";\ndescribe("live oracle", () => { for (const x of REG) { expect(x).toBeDefined(); } });\n' },
    async (root) => {
      const g = graph([
        comp(".", { claims: ['boundary "z" at ChokeZ via test "live oracle"'], invariants: ["z"], why: "r" }),
        sym("ChokeZ"),
      ]);
      // --fast skips the actual runner; the meta-oracle (live-domain check) still runs and must pass.
      const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
      assert.equal(r.code, 0);
      assert.doesNotMatch(r.out, /LITERAL|NO domain/);
    },
  );
});

test("testMatch — a runner exiting 0 with no matching output FAILS (the renamed-test trap)", async () => {
  await withProject({}, async (root) => {
    const c = cfg(root, { test: ["node", "-e", "process.exit(0)"], testMatch: "RAN" });
    const g = graph([comp(".", { claims: ['passes test "ghost"'], why: "r" })]);
    // `serial: true` because testMatch is a property of the SERIAL arm — the batch path
    // gets this guarantee structurally instead (see test/test-batch.test.ts).
    const r = await runCaptured(() => runVerify(c, g, { serial: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /matched no run/);
  });
});

test("testMatch — a runner that emits the expected token passes", async () => {
  await withProject({}, async (root) => {
    const c = cfg(root, { test: ["node", "-e", "console.log('RAN ok')"], testMatch: "RAN" });
    const g = graph([comp(".", { claims: ['passes test "real"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(c, g, { serial: true }));
    assert.equal(r.code, 0);
  });
});

test("coverage — a component with no claims, or no why, fails loudly", async () => {
  await withProject({ "present.txt": "" }, async (root) => {
    const noClaims = graph([comp(".", { claims: [], why: "r" })]);
    const a = await runCaptured(() => runVerify(cfg(root), noClaims, {}));
    assert.equal(a.code, 1);
    assert.match(a.out, /has no claims/);

    // claim passes (present.txt exists) so the failure is isolated to the missing why
    const noWhy = graph([comp(".", { claims: ["present.txt exists at root"] })]);
    const b = await runCaptured(() => runVerify(cfg(root), noWhy, {}));
    assert.equal(b.code, 1);
    assert.match(b.out, /states no rationale/);
  });
});

// ── HOLDING COST — what it costs to keep the claims true, per run ─────────────────────
//
// Verification says whether a claim is true. This says what standing bill it leaves behind:
// the oracle runs again on every commit, forever. Three properties are pinned here, and the
// second is the one a future refactor is most likely to break:
//   1. The RUNNER'S OWN duration outranks verify's wall clock, and the record says which
//      clock answered — on a batch-resolved claim the wall clock times a map lookup.
//   2. The vector is RUN-LEVEL and rewritten WHOLE: a claim that disappears from the specs
//      must not leave a ghost row ranking a run that no longer exists.
//   3. The report has a FLOOR. On a fast suite it says nothing at all.
import { readFile as readFileP, writeFile as writeFileP, mkdir as mkdirP } from "node:fs/promises";
import type { StatusRecord } from "../src/status.ts";

/** A vitest-shaped report where each named test carries a known duration. */
const timedReport = (tests: Array<[string, number]>) => JSON.stringify({
  testResults: [{
    name: "/proj/a.test.ts", status: "passed",
    assertionResults: tests.map(([fullName, duration]) => ({
      ancestorTitles: [], fullName, title: fullName, status: "passed", duration, failureMessages: [],
    })),
  }],
});

/** A fake batch runner that writes `body` to the --outputFile it was handed. */
const reportRunner = (body: string) => `
const fs = require("node:fs"), path = require("node:path");
const of = process.argv.find((a) => a.startsWith("--outputFile="));
const p = of.slice("--outputFile=".length);
fs.mkdirSync(path.dirname(p), { recursive: true });
fs.writeFileSync(p, ${JSON.stringify(body)});
process.exit(0);
`;

const readRecord = async (root: string): Promise<StatusRecord> =>
  JSON.parse(await readFileP(join(root, ".coherence", "status.json"), "utf8"));

test("holding cost — the report prefers the RUNNER's duration over wall time, and says so", async () => {
  const report = timedReport([["alpha", 2500], ["beta", 300], ["gamma", 40]]);
  await withProject({ "runner.js": reportRunner(report) }, async (root) => {
    const c = cfg(root, { testBatch: ["node", join(root, "runner.js"), "--outputFile=.coherence/r.json"] });
    const g = graph([comp(".", { label: "Root", why: "r", claims: [
      'passes test "alpha"', 'passes test "beta"', 'passes test "gamma"',
    ] })]);
    const r = await runCaptured(() => runVerify(c, g, {}));
    assert.equal(r.code, 0, r.out);
    // the total is a SUM OF PER-CLAIM COSTS, and the line must not read as suite wall time:
    // measured, a pooled runner overlaps them (see the resolved conjecture in the journal)
    assert.match(r.out, /holding cost: 2\.8s across 3 claim\(s\) — summed per-claim cost/);
    assert.match(r.out, /a pooled runner overlaps some of it/);
    // most expensive first, with the ms AND the clock that produced it
    assert.match(r.out, /\[cost\] \[Root\] passes test "alpha" — 2500ms \(report\)/);
    // the wall clock around a batch-resolved claim times a map lookup — it must NOT be what
    // is reported, and the batch SPAWN (the expensive part) is not charged to claim one
    assert.doesNotMatch(r.out, /passes test "alpha" — \d+ms \(wall\)/);

    const rec = await readRecord(root);
    assert.ok(rec.verify?.cost, "the cost vector is filed in the run record");
    assert.equal(Math.round(rec.verify!.cost!.totalMs), 2840);
    assert.deepEqual(rec.verify!.cost!.claims.map((x) => x.claim), [
      'passes test "alpha"', 'passes test "beta"', 'passes test "gamma"',
    ]);
    assert.equal(rec.verify!.cost!.claims[0].source, "report");
    assert.equal(rec.verify!.cost!.claims[0].node, "Root");
  });
});

test("holding cost — the vector is REWRITTEN WHOLE: a dropped claim leaves no ghost row", async () => {
  // The anti-merge property, asserted directly. `mergeClaimRecords` deliberately carries
  // per-claim history forward across runs; the cost vector must NOT ride that path, or a row
  // from run one would sit in run two's ranking describing a run that no longer happened.
  const report = timedReport([["alpha", 2500], ["beta", 300], ["gamma", 40]]);
  await withProject({ "runner.js": reportRunner(report) }, async (root) => {
    const c = cfg(root, { testBatch: ["node", join(root, "runner.js"), "--outputFile=.coherence/r.json"] });
    const three = graph([comp(".", { label: "Root", why: "r", claims: [
      'passes test "alpha"', 'passes test "beta"', 'passes test "gamma"',
    ] })]);
    await runCaptured(() => runVerify(c, three, {}));
    const first = await readRecord(root);
    assert.equal(first.verify!.cost!.claims.length, 3);

    // run two: the same project, one claim left
    const one = graph([comp(".", { label: "Root", why: "r", claims: ['passes test "gamma"'] })]);
    await runCaptured(() => runVerify(c, one, {}));
    const second = await readRecord(root);
    assert.deepEqual(second.verify!.cost!.claims.map((x) => x.claim), ['passes test "gamma"']);
    assert.ok(!second.verify!.cost!.claims.some((x) => x.claim.includes("alpha")), "no ghost row from run one");
    assert.ok(second.verify!.cost!.totalMs < 100, `run two's total is run two's alone (got ${second.verify!.cost!.totalMs})`);
  });
});

test("holding cost — silent below the floor: a fast suite gets no cost report at all", async () => {
  await withProject({ "present.txt": "" }, async (root) => {
    const g = graph([comp(".", { claims: ["present.txt exists at root"], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /holding cost/, "an advisory that fires on every fast suite is one people scroll past");
    // …but the measurement is still FILED: quiet on the console is not the same as unmeasured
    const rec = await readRecord(root);
    assert.ok(rec.verify?.cost, "the record carries the vector even when the console does not");
  });
});

test("holding cost — a cost finding is raised LAST: it never displaces a correctness question", async () => {
  const report = timedReport([["alpha", 2500]]);
  await withProject({ "runner.js": reportRunner(report) }, async (root) => {
    // Seed the record so `alpha` is SEASONED (3 green runs, never failed) — that makes it a
    // never-red finding as well as the expensive one, so both advisories point at the same
    // claim and the cap has to choose between them.
    await mkdirP(join(root, ".coherence"), { recursive: true });
    await writeFileP(join(root, ".coherence", "status.json"), JSON.stringify({
      version: 1,
      verify: {
        at: "2026-01-01T00:00:00.000Z", commit: null, dirty: false, tier: "full", scope: null,
        claims: [{ node: "Root", claim: 'passes test "alpha"', kind: "pass", at: "2026-01-01T00:00:00.000Z", commit: null, tier: "full", runs: 5, everFailed: false }],
        coverage: { components: 1, claimed: 1, withWhy: 1, symbols: 0, documented: 0 },
        invariants: { total: 0, anchored: 0, gaps: [] },
        narrative: null, jobs: 0, failures: 0,
      },
    }, null, 2));
    const c = cfg(root, { testBatch: ["node", join(root, "runner.js"), "--outputFile=.coherence/r.json"] });
    const g = graph([comp(".", { label: "Root", why: "r", claims: ['passes test "alpha"'] })]);
    const r = await runCaptured(() => runVerify(c, g, { raise: true, raiseCap: 1, session: "s-testtesttest" }));
    assert.equal(r.code, 0, r.out);
    // both advisories fired on the same claim …
    assert.match(r.out, /holding cost:/);
    assert.match(r.out, /never red: 1 claim/);
    // … and the ONE question the cap allowed is the correctness one, not the cost one
    assert.match(r.out, /RAISE — 1 question\(s\) opened/);
    assert.match(r.out, /never-red:Root::passes test "alpha"/);
    assert.doesNotMatch(r.out, /^ *[a-z0-9-]+ +holding-cost:/m);
    assert.match(r.out, /WITHHELD 1 more — the cap is 1 per run \(holding-cost 1\)/);
  });
});

// ── [doc] job ranking by defining-file churn ─────────────────────────────────────────────
//
// The undocumented-symbol list is the longest thing verify prints, and it used to come out
// in walk order — alphabetical by path, which correlates with nothing. Ranking it by the
// churn share of the defining file puts the symbol somebody is about to read at the top.
// Two properties are load-bearing and both are pinned below: hot-first, and ZERO-churn gaps
// keeping their source order (a repo with no history must get the list it always got).
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { rankDocGaps } from "../src/verify.ts";
import { _resetEvolutionMemo } from "../src/evolution.ts";

test("rankDocGaps — hottest defining file first; the share is a fraction of the commits considered", () => {
  const gaps = [{ path: "cold.ts", n: 1 }, { path: "hot.ts", n: 2 }, { path: "warm.ts", n: 3 }];
  const byFile = new Map([["hot.ts", 8], ["warm.ts", 4], ["cold.ts", 0]]);
  const ranked = rankDocGaps(gaps, byFile, 10);
  assert.deepEqual(ranked.map((g) => g.path), ["hot.ts", "warm.ts", "cold.ts"]);
  assert.deepEqual(ranked.map((g) => g.share), [0.8, 0.4, 0]);
});

test("rankDocGaps — zero-churn gaps keep SOURCE order (Array.prototype.sort is stable)", () => {
  const gaps = ["z.ts", "a.ts", "m.ts"].map((path) => ({ path }));
  assert.deepEqual(rankDocGaps(gaps, new Map(), 10).map((g) => g.path), ["z.ts", "a.ts", "m.ts"]);
});

test("rankDocGaps — no history at all (considered 0) is every share 0, never a division by zero", () => {
  const gaps = [{ path: "a.ts" }, { path: undefined }];
  const ranked = rankDocGaps(gaps, new Map([["a.ts", 5]]), 0);
  assert.deepEqual(ranked.map((g) => g.share), [0, 0]);
  assert.deepEqual(ranked.map((g) => g.path), ["a.ts", undefined]);
});

test("[doc] jobs — the hot symbol leads the list and its line says how hot", async (t) => {
  // hot.ts is touched by every commit; cold.ts only by the first of twenty-one, which puts
  // it under the 5% hot floor. Both define one undocumented symbol, and cold.ts sorts FIRST
  // alphabetically — so an unranked list would put it on top, which is what this replaces.
  const root = await mkdtemp(join(tmpdir(), "coh-docrank-"));
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  const git = (args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const write = async (p: string, c: string) => { await mkdir(dirname(join(root, p)), { recursive: true }); await writeFile(join(root, p), c); };
  git(["init", "-q"]); git(["config", "user.email", "t@test"]); git(["config", "user.name", "t"]); git(["config", "commit.gpgsign", "false"]);
  await write("cold.ts", "export const chilly = 0;\n");
  await write("hot.ts", "export const blazing = 0;\n");
  await write("filler.ts", "export const f = 0;\n");
  git(["add", "-A"]); git(["commit", "-q", "-m", "init"]);
  for (let i = 0; i < 20; i++) {
    await write("hot.ts", `export const blazing = ${i + 1};\n`);
    await write("filler.ts", `export const f = ${i + 1};\n`);
    git(["add", "-A"]); git(["commit", "-q", "-m", `edit ${i}`]);
  }
  const g = graph([
    comp(".", { claims: ["hot.ts exists at root"], why: "r" }),
    sym("chilly", "cold.ts"), sym("blazing", "hot.ts"),
  ]);
  const { out } = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
  const docLines = out.split("\n").filter((l) => l.includes("[doc]"));
  assert.equal(docLines.length, 2);
  assert.match(docLines[0], /\[doc\] blazing at hot\.ts:1 \(hot: 100% of recent commits\)/);
  assert.match(docLines[1], /\[doc\] chilly at cold\.ts:1$/, "a cold gap carries no annotation — 0 is not a temperature worth printing");
});
