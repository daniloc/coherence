// test-batch.test.ts — BATCHED ORACLE EXECUTION. Two halves: the pure report layer
// (parse + match) driven directly, and the whole feature driven end-to-end through
// runVerify against a fake batch runner.
//
// THE FIXTURE IS REAL. `VITEST_REPORT` below was captured from an actual
// `npx vitest run --reporter=json --outputFile=…` on vitest 4.1.10 (stack traces pared
// down, timings dropped; every field name, nesting level, and `fullName` value is
// verbatim). The schema was not guessed — the whole feature rests on `fullName` being
// the runner's own suite-path concatenation and on `-t` matching it unanchored, and both
// were verified by running the real thing before any of this was written.
//
// Note the fixture contains "write policy totality covers every op" AND
// "write policy totality covers every op extended" — the prefix edge, where a claim name
// that is a strict prefix of a longer test's name must match BOTH, because that is what
// the runner's `-t` does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile, utimes, writeFile } from "node:fs/promises";
import { runVerify } from "../src/verify.ts";
import {
  parseVitestJson, resolveFromBatch, resolveBatchFormat, extractJsonObjects,
  outputFileOf, runTestBatch, TEST_BATCH_FORMATS, selectOracleMode, deriveBatchCommand,
  detectRunner, DERIVED_REPORT_PATH, type BatchReport,
} from "../src/test-batch.ts";
import { tmpProject, cleanup, runCaptured, cfg, comp, sym, graph } from "./_helpers.ts";

const withProject = async (files: Record<string, string>, fn: (root: string) => Promise<void>) => {
  const root = await tmpProject(files);
  try { await fn(root); } finally { await cleanup(root); }
};

const VITEST_REPORT = JSON.stringify({
  numTotalTestSuites: 8, numPassedTestSuites: 6, numFailedTestSuites: 2,
  numTotalTests: 8, numPassedTests: 6, numFailedTests: 1, numPendingTests: 1, numTodoTests: 0,
  success: false,
  testResults: [
    {
      name: "/proj/a.test.ts", status: "passed", message: "",
      assertionResults: [
        { ancestorTitles: ["write policy totality"], fullName: "write policy totality covers every op", title: "covers every op", status: "passed", failureMessages: [], meta: {}, tags: [] },
        { ancestorTitles: ["write policy totality"], fullName: "write policy totality rejects unknown (a+b)", title: "rejects unknown (a+b)", status: "passed", failureMessages: [], meta: {}, tags: [] },
        { ancestorTitles: ["outer", "inner nest"], fullName: "outer inner nest deep", title: "deep", status: "passed", failureMessages: [], meta: {}, tags: [] },
        { ancestorTitles: [], fullName: "bare top level test", title: "bare top level test", status: "passed", failureMessages: [], meta: {}, tags: [] },
      ],
    },
    {
      name: "/proj/b.test.ts", status: "failed", message: "",
      assertionResults: [
        { ancestorTitles: ["failing group"], fullName: "failing group this one fails", title: "this one fails", status: "failed", failureMessages: ["AssertionError: expected 1 to be 2 // Object.is equality\n    at /proj/b.test.ts:3:42"], meta: {}, tags: [] },
        { ancestorTitles: ["failing group"], fullName: "failing group this one passes", title: "this one passes", status: "passed", failureMessages: [], meta: {}, tags: [] },
        { ancestorTitles: [], fullName: "skipped test", title: "skipped test", status: "skipped", failureMessages: [], meta: {}, tags: [] },
      ],
    },
    {
      name: "/proj/d.test.ts", status: "passed", message: "",
      assertionResults: [
        { ancestorTitles: ["write policy totality"], fullName: "write policy totality covers every op extended", title: "covers every op extended", status: "passed", failureMessages: [], meta: {}, tags: [] },
      ],
    },
  ],
});

const REPORT: BatchReport = parseVitestJson(VITEST_REPORT);

/** A fake batch runner: prints `body` to stdout (or to the --outputFile the command
 *  carries), appends a byte to `runs.log` so we can count boots, and exits `code`. */
const batchRunner = (body: string, code = 1) => `
const fs = require("node:fs");
fs.appendFileSync(process.env.RUNS_LOG, "x");
const body = ${JSON.stringify(body)};
const of = process.argv.find((a) => a.startsWith("--outputFile="));
if (of) {
  const p = of.slice("--outputFile=".length);
  // real vitest creates the report's parent dirs (verified), so the fake must too
  fs.mkdirSync(require("node:path").dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
else process.stdout.write(body);
process.exit(${code});
`;

// ── the report layer ─────────────────────────────────────────────────────────────────

test("parse — the real vitest report yields every test with its runner-supplied fullName", () => {
  assert.equal(REPORT.format, "vitest-json");
  assert.equal(REPORT.tests.length, 8);
  const byName = new Map(REPORT.tests.map((t) => [t.fullName, t]));
  // fullName IS ancestorTitles.join(" ") + " " + title — the string `-t` filters against.
  assert.equal(byName.get("outer inner nest deep")?.status, "passed");
  assert.equal(byName.get("failing group this one fails")?.status, "failed");
  assert.equal(byName.get("skipped test")?.status, "skipped");
  // the per-file `name` rides along for detail lines
  assert.equal(byName.get("write policy totality covers every op")?.file, "/proj/a.test.ts");
});

test("parse — a report missing `fullName` is reconstructed with the runner's own join", () => {
  const r = parseVitestJson(JSON.stringify({
    testResults: [{ name: "x.test.ts", assertionResults: [{ ancestorTitles: ["outer", "inner"], title: "leaf", status: "passed" }] }],
  }));
  assert.deepEqual(r.tests.map((t) => t.fullName), ["outer inner leaf"]);
});

test("parse — an unparsable report THROWS rather than returning an empty one", () => {
  // An empty report and an unreadable one must not look alike: one of them would resolve
  // every claim RED against a perfectly healthy suite.
  assert.throws(() => parseVitestJson("total gibberish, no json here"), /no vitest JSON report found/);
  assert.throws(() => parseVitestJson(""), /no vitest JSON report found/);
  assert.throws(() => parseVitestJson('{"numTotalTests":3}'), /no vitest JSON report found/);
});

test("parse — a test that wrote to stdout ahead of the report does not break parsing", () => {
  // MEASURED against the real runner: `process.stdout.write("RAW WRITE\n")` inside a test
  // lands in the same stream, before the reporter's object, and a whole-string JSON.parse
  // throws on the 'R'. The brace scan recovers the report.
  const polluted = `RAW WRITE\nsome other noise {not json}\n${VITEST_REPORT}\n`;
  assert.throws(() => JSON.parse(polluted));           // the naive approach fails …
  assert.equal(parseVitestJson(polluted).tests.length, 8); // … the scan does not
});

test("parse — brace scanning is string-literal aware, so braces inside test names are safe", () => {
  const objs = extractJsonObjects('noise {"a":"}{ not a brace "} tail {"b":1}');
  assert.deepEqual(objs, ['{"a":"}{ not a brace "}', '{"b":1}']);
  // a test titled with a brace survives the round trip
  const r = parseVitestJson(JSON.stringify({
    testResults: [{ name: "x", assertionResults: [{ fullName: 'renders {"a":1} literally', title: "t", status: "passed" }] }],
  }));
  assert.deepEqual(r.tests.map((t) => t.fullName), ['renders {"a":1} literally']);
});

test("format — unknown values are refused; omitted defaults to the only format there is", () => {
  assert.deepEqual(resolveBatchFormat(cfg("/x")), { format: "vitest-json" });
  assert.deepEqual(resolveBatchFormat(cfg("/x", { testBatchFormat: "vitest-json" })), { format: "vitest-json" });
  const bad = resolveBatchFormat(cfg("/x", { testBatchFormat: "vitest_json" }));
  assert.ok("error" in bad && /not a format coherence knows/.test(bad.error), JSON.stringify(bad));
  assert.deepEqual([...TEST_BATCH_FORMATS], ["vitest-json", "pytest-json"]);
});

test("outputFile — all three spellings the runner accepts are recognized", () => {
  assert.equal(outputFileOf(["npx", "vitest", "run", "--reporter=json"]), null);
  assert.equal(outputFileOf(["npx", "vitest", "run", "--outputFile=out/r.json"]), "out/r.json");
  assert.equal(outputFileOf(["npx", "vitest", "run", "--outputFile.json=out/r.json"]), "out/r.json");
  assert.equal(outputFileOf(["npx", "vitest", "run", "--outputFile", "out/r.json"]), "out/r.json");
});

// ── matching: the mirror of `-t` ──────────────────────────────────────────────────────

test("match — a substring spanning the describe/test boundary matches, as `-t` does", () => {
  // VERIFIED against vitest 4.1.10: `-t "totality covers"` runs
  // "write policy totality covers every op". Anchored equality would have matched nothing.
  assert.ok(resolveFromBatch(REPORT, "totality covers").ok);
  assert.ok(resolveFromBatch(REPORT, "write policy totality covers every op").ok);
  assert.ok(resolveFromBatch(REPORT, "inner nest deep").ok);
  assert.ok(resolveFromBatch(REPORT, "bare top level test").ok);
});

test("match — a claim name that is a strict PREFIX of another test's name matches both", () => {
  // "…covers every op" is a prefix of "…covers every op extended". Both are green here, so
  // the claim is green — and it would go red if EITHER failed, which is exactly what the
  // runner would report for that `-t`.
  const both = REPORT.tests.filter((t) => t.fullName.includes("write policy totality covers every op"));
  assert.equal(both.length, 2, "the prefix edge must actually be present in the fixture");
  assert.ok(resolveFromBatch(REPORT, "write policy totality covers every op").ok);
});

test("match — names with regex metacharacters match LITERALLY, never as a pattern", () => {
  // The hole escaping closed, restated on this path: measured, `-t "rejects unknown (a+b)"`
  // UNESCAPED matched zero tests and still exited 0. A literal substring test cannot
  // reproduce that, and a live `new RegExp(name)` would.
  assert.ok(resolveFromBatch(REPORT, "rejects unknown (a+b)").ok);
  // proof it is not being treated as a pattern: this regex WOULD match "…(a+b)" if compiled
  const asPattern = resolveFromBatch(REPORT, "rejects unknown (a+*b)");
  assert.equal(asPattern.ok, false);
  assert.match(asPattern.detail, /VANISHED ORACLE/);
});

test("match — ZERO matching tests is its OWN state: the vanished oracle, named as such", () => {
  // THE THIRD STATE. `vitest -t` exits 0 on a filter that matched nothing, so the per-claim
  // path collapses "does not exist" into "passed" unless the project happened to configure
  // `testMatch`. Here absence is directly observable and gets its own verdict — the hole is
  // closed structurally rather than by a config knob a reader has to know to set.
  const r = resolveFromBatch(REPORT, "a test nobody ever wrote");
  assert.equal(r.ok, false);
  assert.match(r.detail, /VANISHED ORACLE/);
  assert.match(r.detail, /no test in the batch report matches this name/);
  assert.match(r.detail, /renamed, deleted, or never collected/);
  // and it is DISTINGUISHABLE from a test that ran and failed — three states, not two
  assert.doesNotMatch(r.detail, /FAILED/);
  assert.match(resolveFromBatch(REPORT, "failing group this one fails").detail, /FAILED/);
});

test("match — a batched claim needs no testMatch: the guarantee is structural, not configured", () => {
  // Same report, no `testMatch` anywhere in the config, and the vanished oracle is still red.
  const noTestMatch = cfg("/x", { testBatch: ["x"] });
  assert.equal(noTestMatch.testMatch, undefined);
  assert.equal(resolveFromBatch(REPORT, "gone").ok, false);
});

test("match — one matching test failed is RED, and the detail names the failing test", () => {
  const r = resolveFromBatch(REPORT, "failing group this one fails");
  assert.equal(r.ok, false);
  assert.match(r.detail, /FAILED in the batch report/);
  assert.match(r.detail, /failing group this one fails/);
});

test("match — MIXED matches (one passed, one failed) are RED, and the count is reported", () => {
  // `-t "failing group"` runs both; the runner would exit nonzero, so this must be red.
  const r = resolveFromBatch(REPORT, "failing group");
  assert.equal(r.ok, false);
  assert.match(r.detail, /FAILED/);
  const two = REPORT.tests.filter((t) => t.fullName.includes("failing group"));
  assert.equal(two.length, 2);
});

test("match — multiple failing matches announce the extra failures rather than hiding them", () => {
  const r = resolveFromBatch(
    { format: "vitest-json", tests: [
      { fullName: "group one", status: "failed" }, { fullName: "group two", status: "failed" },
    ] }, "group");
  assert.equal(r.ok, false);
  assert.match(r.detail, /\+1 more matching failure/);
});

test("match — a match that only SKIPPED is red: no positive evidence, as testMatch requires", () => {
  const r = resolveFromBatch(REPORT, "skipped test");
  assert.equal(r.ok, false);
  assert.match(r.detail, /none of which ran/);
  assert.match(r.detail, /skipped/);
});

test("match — a passed test alongside a skipped one is GREEN, mirroring the runner exactly", () => {
  // The per-claim path over this `-t` gets "1 passed | 1 skipped", exit 0, and testMatch's
  // "N passed" matches — so it says green. Batch must not be stricter than the path it
  // replaces, or flipping the config invents reds in repos that were honestly green.
  const r = resolveFromBatch({ format: "vitest-json", tests: [
    { fullName: "mixed group runs", status: "passed" },
    { fullName: "mixed group is skipped", status: "skipped" },
  ] }, "mixed group");
  assert.equal(r.ok, true, r.detail);
});

// ── end to end, through runVerify ─────────────────────────────────────────────────────

test("verify — `passes test` claims resolve from ONE batch run, and the suite boots once", async () => {
  await withProject({ "runner.js": batchRunner(VITEST_REPORT) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", {
      claims: [
        'passes test "write policy totality covers every op"',
        'passes test "outer inner nest deep"',
        'passes test "bare top level test"',
        'passes test "rejects unknown (a+b)"',
      ],
      why: "r",
    })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { testBatch: ["node", join(root, "runner.js"), "--reporter=json"] }), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /4 green/);
    assert.match(r.out, /oracles: batched — running the whole suite ONCE/);
    assert.match(r.out, /report parsed \(vitest-json\), 8 test\(s\)/);
    // FOUR claims, ONE boot — the whole point of the feature.
    assert.equal((await readFile(join(root, "runs.log"), "utf8")).length, 1);
  });
});

test("verify — a nonzero runner exit is NOT a crash: a red suite's report is still read", async () => {
  // The fixture's suite HAS a failing test, so the runner exits 1. That run's report is the
  // most valuable one there is; treating the exit code as a crash would fall back to the
  // slow path on exactly the runs where you are iterating on a failure.
  await withProject({ "runner.js": batchRunner(VITEST_REPORT, 1) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", { claims: ['passes test "failing group this one fails"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { testBatch: ["node", join(root, "runner.js")] }), g, {}));
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.out, /FALLING BACK/);
    assert.match(r.out, /FAILED in the batch report/);
  });
});

test("verify — a claim whose test was renamed away goes RED, not green-by-absence", async () => {
  await withProject({ "runner.js": batchRunner(VITEST_REPORT) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", { claims: ['passes test "the old name nobody kept"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { testBatch: ["node", join(root, "runner.js")] }), g, {}));
    assert.equal(r.code, 1);
    assert.match(r.out, /VANISHED ORACLE/);
    // no testMatch was configured, and it was not needed
    assert.doesNotMatch(r.out, /testMatch/);
  });
});

test("verify — ATTRIBUTION IS PER CLAIM: three claims, three distinct verdicts and details", async () => {
  // A batch that reported "the suite is red" would be a regression on the per-claim path.
  // The batch is shared EVIDENCE, never a shared verdict: each claim names its own oracle,
  // and each failure says which of the three states it is in.
  await withProject({ "runner.js": batchRunner(VITEST_REPORT) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", {
      claims: [
        'passes test "outer inner nest deep"',            // (a) ran + passed
        'passes test "failing group this one fails"',     // (b) ran + failed
        'passes test "an oracle that was deleted"',       // (c) does not exist
      ],
      why: "r",
    })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { testBatch: ["node", join(root, "runner.js")] }), g, {}));
    assert.equal(r.code, 1);
    assert.match(r.out, /claims: 3 · 1 green · 2 red/);
    // A cost advisory may name this green claim; pin only that no RED verdict does.
    assert.doesNotMatch(r.out, /^\s*✗ .*outer inner nest deep/m);
    // each red line carries its OWN oracle name and its OWN state
    const failLine = r.out.split("\n").find((l) => l.includes('"failing group this one fails"'))!;
    assert.match(failLine, /matching test FAILED in the batch report: "failing group this one fails"/);
    const goneLine = r.out.split("\n").find((l) => l.includes('"an oracle that was deleted"'))!;
    assert.match(goneLine, /VANISHED ORACLE/);
    assert.notEqual(failLine, goneLine);
    assert.equal((await readFile(join(root, "runs.log"), "utf8")).length, 1);
  });
});

test("verify — --from-report consumes an outer gate's report and runs NO suite at all", async () => {
  // The cheapest tier: a project's own check script ran the suite once; coherence reads what
  // that run already knew instead of paying the whole import cost again.
  await withProject({ "outer-report.json": VITEST_REPORT }, async (root) => {
    const g = graph([comp(".", {
      claims: ['passes test "outer inner nest deep"', 'passes test "bare top level test"'],
      why: "r",
    })]);
    const r = await runCaptured(() => runVerify(
      // deliberately NO testBatch and NO test: the flag is the whole opt-in
      cfg(root), g, { fromReport: "outer-report.json" }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 green/);
    assert.match(r.out, /reading an existing report — outer-report\.json \(running no tests\)/);
    assert.doesNotMatch(r.out, /running the whole suite/);
  });
});

test("verify — --from-report wins over a configured testBatch, and still fails vanished oracles", async () => {
  await withProject({ "outer-report.json": VITEST_REPORT, "runner.js": batchRunner(VITEST_REPORT) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", { claims: ['passes test "long gone"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { testBatch: ["node", join(root, "runner.js")] }), g, { fromReport: "outer-report.json" }));
    assert.equal(r.code, 1);
    assert.match(r.out, /VANISHED ORACLE/);
    // the configured batch command was never spawned
    await assert.rejects(() => readFile(join(root, "runs.log"), "utf8"));
  });
});

test("verify — a missing --from-report file falls back loudly, naming the file", async () => {
  // The fake runner is NAME-SENSITIVE (fails anything it does not know): the serial
  // canary refuses a runner that cannot fail, so `process.exit(0)` is no longer a
  // legal fake — that shape is now itself a defect verify catches.
  await withProject({ "ok.js": "process.exit(['whatever'].includes(process.argv[2]) ? 0 : 1)" }, async (root) => {
    const g = graph([comp(".", { claims: ['passes test "whatever"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { test: ["node", join(root, "ok.js")] }), g, { fromReport: "nope.json" }));
    assert.match(r.out, /--from-report nope\.json could not be read/);
    assert.match(r.out, /FALLING BACK/);
    assert.equal(r.code, 0, r.out);
  });
});

test("verify — the report may arrive via --outputFile instead of stdout", async () => {
  await withProject({ "runner.js": batchRunner(VITEST_REPORT) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", { claims: ['passes test "outer inner nest deep"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root, {
      testBatch: ["node", join(root, "runner.js"), "--outputFile=report.json"],
    }), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /report parsed/);
    // proof it came from the file, not stdout
    assert.match(await readFile(join(root, "report.json"), "utf8"), /testResults/);
  });
});

test("verify — a boundary `via test` oracle resolves from the batch too (the expensive ones)", async () => {
  await withProject({ "runner.js": batchRunner(VITEST_REPORT) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([
      comp(".", {
        claims: ['boundary "fail-closed writes" at applyWritePolicy via test "write policy totality"'],
        invariants: ["fail-closed writes"], why: "r",
      }),
      sym("applyWritePolicy"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root, {
      testBatch: ["node", join(root, "runner.js")], oracleDomain: false,
    }), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 green/);
    assert.equal((await readFile(join(root, "runs.log"), "utf8")).length, 1);
  });
});

test("verify — a batch crash falls back to the per-claim path, LOUDLY, and still gets a verdict", async () => {
  // The per-claim runner passes what it knows (the canary refuses one that passes
  // anything), so a silent degrade would look like success. What must be observable is
  // that the fallback ANNOUNCED itself and said why.
  await withProject({ "ok.js": "process.exit(['whatever'].includes(process.argv[2]) ? 0 : 1)" }, async (root) => {
    const g = graph([comp(".", { claims: ['passes test "whatever"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root, {
      test: ["node", join(root, "ok.js")],
      testBatch: ["node", join(root, "there-is-no-such-file.js")],
    }), g, {}));
    assert.match(r.out, /oracles: the batch run FAILED/);
    assert.match(r.out, /FALLING BACK to the serial per-claim runner/);
    assert.equal(r.code, 0, r.out);   // the per-claim path answered
    assert.match(r.out, /1 green/);
  });
});

test("verify — an unparsable report is a fallback with the reason, not a wave of false reds", async () => {
  await withProject({
    "runner.js": batchRunner("this is not json at all"),
    "ok.js": "process.exit(['whatever'].includes(process.argv[2]) ? 0 : 1)",
  }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", { claims: ['passes test "whatever"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root, {
      test: ["node", join(root, "ok.js")], testBatch: ["node", join(root, "runner.js")],
    }), g, {}));
    assert.match(r.out, /could not be parsed/);
    assert.match(r.out, /FALLING BACK/);
    assert.equal(r.code, 0, r.out);
  });
});

test("verify — a batch that fell back with NO per-claim runner skips, it does not go red", async () => {
  await withProject({ "runner.js": batchRunner("nope") }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", { claims: ['passes test "whatever"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root, {
      test: [], testBatch: ["node", join(root, "runner.js")],
    }), g, {}));
    assert.match(r.out, /FALLING BACK/);
    assert.match(r.out, /no test runner configured/);
    assert.equal(r.code, 0, r.out);
  });
});

test("verify — an unknown testBatchFormat FAILS the run; it never silently falls back", async () => {
  await withProject({ "ok.js": "process.exit(0)" }, async (root) => {
    const g = graph([comp(".", { claims: ['passes test "whatever"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root, {
      test: ["node", join(root, "ok.js")],
      testBatch: ["node", join(root, "ok.js")], testBatchFormat: "vitest_json",
    }), g, {}));
    assert.equal(r.code, 1);
    assert.match(r.out, /not a format coherence knows/);
    // and it stopped BEFORE doing any work — a typo costs one line, not a whole verify
    assert.doesNotMatch(r.out, /claims:/);
  });
});

test("verify — --fast never boots the batch: the executable tier skips before asking", async () => {
  await withProject({ "runner.js": batchRunner(VITEST_REPORT) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", { claims: ['passes test "outer inner nest deep"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { testBatch: ["node", join(root, "runner.js")] }), g, { fast: true }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 skipped/);
    assert.doesNotMatch(r.out, /test batch/);
    // the thunk is LAZY — nothing ran, so the log was never created
    await assert.rejects(() => readFile(join(root, "runs.log"), "utf8"));
  });
});

test("verify — a project with no executable claims never boots the batch either", async () => {
  await withProject({ "runner.js": batchRunner(VITEST_REPORT), "present.txt": "" }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", { claims: ["present.txt exists at root"], why: "r" })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { testBatch: ["node", join(root, "runner.js")] }), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /test batch/);
    await assert.rejects(() => readFile(join(root, "runs.log"), "utf8"));
  });
});

test("verify — a SCOPED run batches the whole suite once and resolves only in-scope claims", async () => {
  await withProject({ "runner.js": batchRunner(VITEST_REPORT) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([
      comp("a", { claims: ['passes test "outer inner nest deep"'], why: "r" }),
      comp("b", { claims: ['passes test "failing group this one fails"'], why: "r" }),
    ]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { testBatch: ["node", join(root, "runner.js")] }), g, { only: new Set(["a"]) }));
    // component b's claim would be RED, but it is out of scope and never evaluated
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /claims: 1 · 1 green/);
    assert.equal((await readFile(join(root, "runs.log"), "utf8")).length, 1);
  });
});

test("verify — the status record marks the run as batched (run-level provenance)", async () => {
  await withProject({ "runner.js": batchRunner(VITEST_REPORT) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", { claims: ['passes test "outer inner nest deep"'], why: "r" })]);
    await runCaptured(() => runVerify(
      cfg(root, { testBatch: ["node", join(root, "runner.js")] }), g, {}));
    const rec = JSON.parse(await readFile(join(root, ".coherence", "status.json"), "utf8"));
    assert.equal(rec.verify.batched, true);
    // the verdicts themselves are shaped exactly as the per-claim path writes them
    assert.equal(rec.verify.claims.length, 1);
    assert.equal(rec.verify.claims[0].kind, "pass");
    assert.equal(rec.verify.claims[0].tier, "full");
  });
});

test("verify — an unbatched run leaves the marker absent, so old records stay readable", async () => {
  await withProject({ "present.txt": "" }, async (root) => {
    const g = graph([comp(".", { claims: ["present.txt exists at root"], why: "r" })]);
    await runCaptured(() => runVerify(cfg(root), g, {}));
    const rec = JSON.parse(await readFile(join(root, ".coherence", "status.json"), "utf8"));
    assert.equal(rec.verify.batched, undefined);
  });
});

test("runTestBatch — an empty report is a fallback, never a green-everything or red-everything", async () => {
  await withProject({ "runner.js": batchRunner(JSON.stringify({ testResults: [] })) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const out = runTestBatch(["node", join(root, "runner.js")], root, "vitest-json");
    assert.equal(out.report, null);
    assert.match(out.note, /no tests/);
  });
});

// ── THE MODE-SELECTION MATRIX ─────────────────────────────────────────────────────────
//
// Batch is the default full-tier path as of v0.17.0, and the serial per-claim profile — one
// FULL test-pool boot per claim — is reachable only by naming it. These cover every row.

test("mode — runner detection: vitest, node:test, and neither", () => {
  assert.equal(detectRunner(["npx", "vitest", "run", "-t"]), "vitest");
  assert.equal(detectRunner(["./node_modules/.bin/vitest", "run", "-t"]), "vitest");
  assert.equal(detectRunner(["node", "--test", "--test-name-pattern"]), "node-test");
  assert.equal(detectRunner(["pnpm", "jest", "-t"]), "unknown");
  assert.equal(detectRunner([]), "unknown");
});

test("mode — a vitest `config.test` DERIVES a whole-suite batch command", () => {
  // Zero-config batching: the project said `vitest -t`, so coherence knows how to say
  // "vitest, everything, as JSON" without being told.
  const d = deriveBatchCommand(cfg("/x", { test: ["npx", "vitest", "run", "-t"] }));
  assert.ok("cmd" in d, JSON.stringify(d));
  assert.deepEqual(d.cmd, ["npx", "vitest", "run", "--reporter=json", `--outputFile=${DERIVED_REPORT_PATH}`]);
  // the name filter is STRIPPED (a batch runs everything) …
  assert.ok(!d.cmd.includes("-t"));
  // … and `--outputFile` is chosen over bare stdout, because a derived command is one the
  // user never sees and so should be the robust form, not the tempting one.
  assert.ok(d.cmd.some((a) => a.startsWith("--outputFile=")));
});

test("mode — derivation preserves other args, drops `--testNamePattern=`, and forces a one-shot run", () => {
  const d = deriveBatchCommand(cfg("/x", { test: ["npx", "vitest", "--config", "vitest.ci.ts", "--testNamePattern"] }));
  assert.ok("cmd" in d);
  assert.ok(d.cmd.includes("--config") && d.cmd.includes("vitest.ci.ts"), d.cmd.join(" "));
  assert.ok(!d.cmd.some((a) => a.includes("testNamePattern")));
  // `run` is inserted: a derived command that started a WATCHER would hang the gate forever
  assert.ok(d.cmd.includes("run"), d.cmd.join(" "));
  assert.equal(d.cmd.indexOf("run"), d.cmd.indexOf("vitest") + 1);
});

test("mode — node:test is REFUSED with the measured reason, not guessed at", () => {
  const d = deriveBatchCommand(cfg("/x", { test: ["node", "--test", "--test-name-pattern"] }));
  assert.ok("why" in d, JSON.stringify(d));
  const why = d.why.join(" ");
  assert.match(why, /ships no/);
  assert.match(why, /--test-name-pattern/);
  // and it warns that testMatch does not save a node:test project either (measured)
  assert.match(why, /testMatch/);
});

test("mode — precedence: --from-report > --serial-oracles > testBatch > derived", () => {
  const c = cfg("/x", { test: ["npx", "vitest", "run", "-t"], testBatch: ["configured"] });
  assert.deepEqual(selectOracleMode(c, { fromReport: "r.json" }), { kind: "from-report", file: "r.json" });
  assert.deepEqual(selectOracleMode(c, { serial: true }), { kind: "serial", why: "--serial-oracles" });
  assert.deepEqual(selectOracleMode(c, {}), { kind: "batch", cmd: ["configured"], derived: false });
  const derived = selectOracleMode(cfg("/x", { test: ["npx", "vitest", "run", "-t"] }), {});
  assert.equal(derived.kind, "batch");
  assert.ok(derived.kind === "batch" && derived.derived);
  // config.oracleExecution is the flag's equivalent …
  assert.deepEqual(
    selectOracleMode(cfg("/x", { test: ["npx", "vitest", "run", "-t"], oracleExecution: "serial" }), {}),
    { kind: "serial", why: "config.oracleExecution" });
  // … and the FLAG wins when both are present
  assert.deepEqual(
    selectOracleMode(cfg("/x", { oracleExecution: "serial" }), { serial: true }),
    { kind: "serial", why: "--serial-oracles" });
});

test("mode — an unknown runner with nothing else configured REFUSES", () => {
  const m = selectOracleMode(cfg("/x", { test: ["pnpm", "jest", "-t"] }), {});
  assert.equal(m.kind, "refuse");
  assert.ok(m.kind === "refuse");
  const text = m.lines.join("\n");
  // the refusal must be ACTIONABLE — all three ways out, named
  assert.match(text, /config\.testBatch/);
  assert.match(text, /--from-report/);
  assert.match(text, /--serial-oracles/);
});

test("verify — ZERO-CONFIG: a vitest project batches with no testBatch configured", async () => {
  // The headline behaviour change. `config.test` alone is enough; the consumer changed nothing.
  await withProject({ "runner.js": batchRunner(VITEST_REPORT) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", {
      claims: ['passes test "outer inner nest deep"', 'passes test "bare top level test"'],
      why: "r",
    })]);
    // a fake "vitest" so detection fires while the command stays hermetic
    const fake = join(root, "vitest");
    await writeFile(fake, "");
    const r = await runCaptured(() => runVerify(
      cfg(root, { test: ["node", join(root, "runner.js"), fake, "-t"] }), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /command derived from config\.test/);
    assert.match(r.out, /2 green/);
    // ONE boot for two claims, without the project asking for batching
    assert.equal((await readFile(join(root, "runs.log"), "utf8")).length, 1);
  });
});

test("verify — an UNKNOWN runner FAILS LOUD instead of silently booting the pool per claim", async () => {
  // The profile this release exists to make unreachable. The per-claim runner here would
  // happily pass every claim, so a silent serial run would have looked like success.
  await withProject({ "ok.js": "process.exit(0)" }, async (root) => {
    const g = graph([comp(".", { claims: ['passes test "whatever"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { test: ["node", join(root, "ok.js")] }), g, {}));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[oracles\] cannot run the executable tier, and will not silently run it the slow way/);
    assert.match(r.out, /executable tier refused/);
    // the claim SKIPPED rather than going red — the claim is not what is broken
    assert.match(r.out, /0 green · 0 red · 1 skipped/);
    // and all three ways out are printed
    assert.match(r.out, /config\.testBatch/);
    assert.match(r.out, /--from-report/);
    assert.match(r.out, /--serial-oracles/);
  });
});

test("verify — --fast never refuses: the executable tier is not being run at all", async () => {
  // A refusal is about HOW the executable tier would run. Under --fast it does not run, so
  // firing there would break every pre-commit hook on every unknown-runner project.
  await withProject({ "ok.js": "process.exit(0)" }, async (root) => {
    const g = graph([comp(".", { claims: ['passes test "whatever"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { test: ["node", join(root, "ok.js")] }), g, { fast: true }));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /\[oracles\]/);
  });
});

test("verify — a project with no executable claims never refuses either", async () => {
  await withProject({ "present.txt": "", "ok.js": "process.exit(0)" }, async (root) => {
    const g = graph([comp(".", { claims: ["present.txt exists at root"], why: "r" })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { test: ["node", join(root, "ok.js")] }), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /\[oracles\]/);
  });
});

test("verify — SERIAL is reachable explicitly, and states its cost every single time", async () => {
  await withProject({ "ok.js": "process.exit(['one','two','three'].includes(process.argv[2]) ? 0 : 1)" }, async (root) => {
    const g = graph([comp(".", {
      claims: ['passes test "one"', 'passes test "two"', 'passes test "three"'],
      why: "r",
    })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { test: ["node", join(root, "ok.js")] }), g, { serial: true }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /3 green/);
    assert.match(r.out, /SERIAL ORACLES \(--serial-oracles\): 3 executable claim\(s\) × one FULL test-pool boot each/);
    // and it names the config that retires the profile
    assert.match(r.out, /config\.testBatch/);
  });
});

test("verify — config.oracleExecution: \"serial\" is the durable form of the same opt-in", async () => {
  await withProject({ "ok.js": "process.exit(['one'].includes(process.argv[2]) ? 0 : 1)" }, async (root) => {
    const g = graph([comp(".", { claims: ['passes test "one"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(
      cfg(root, { test: ["node", join(root, "ok.js")], oracleExecution: "serial" }), g, {}));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /SERIAL ORACLES \(config\.oracleExecution\)/);
  });
});

test("verify — the crash fallback prints the serial cost too, not just the reason", async () => {
  // The one remaining route into serial that nobody typed. It must be as loud as the
  // opt-in, or the expensive profile arrives unannounced after all.
  await withProject({ "ok.js": "process.exit(['one','two'].includes(process.argv[2]) ? 0 : 1)" }, async (root) => {
    const g = graph([comp(".", { claims: ['passes test "one"', 'passes test "two"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root, {
      test: ["node", join(root, "ok.js")], testBatch: ["node", join(root, "nope.js")],
    }), g, {}));
    assert.match(r.out, /SERIAL ORACLES \(batch fallback\): 2 executable claim\(s\)/);
    assert.equal(r.code, 0, r.out);
  });
});

test("runTestBatch — a report file the run did NOT write is refused as stale", async () => {
  // A runner that exits without writing, over a report left by a PREVIOUS run, would
  // otherwise resolve every claim from evidence about code that no longer exists — and it
  // would look perfectly healthy. Worse than a crash, which at least falls back.
  await withProject({
    "stale.json": VITEST_REPORT,
    "runner.js": "process.exit(1)",   // writes nothing
  }, async (root) => {
    // backdate the leftover report an hour, i.e. a previous run's artifact
    const hourAgo = new Date(Date.now() - 3600_000);
    await utimes(join(root, "stale.json"), hourAgo, hourAgo);
    const out = runTestBatch(["node", join(root, "runner.js"), "--outputFile=stale.json"], root, "vitest-json");
    assert.equal(out.report, null);
    assert.match(out.note, /was not written by this run/);
  });
});

// ── HOLDING COST: the runner's own per-assertion durations ───────────────────────────
//
// The report carries a `duration` per assertion, and it is the ONLY honest reading of what a
// batch-resolved claim costs — coherence's own clock around such a claim measures a map
// lookup. The rule these tests pin is the one that is easy to lose: ABSENCE IS NOT ZERO. A
// report without timings must answer "unknown", never "free", because the second one ranks a
// never-measured claim as the cheapest thing in the suite.

/** The same shape the real reporter emits, with `duration` present (ms, per assertion). */
const TIMED_REPORT = JSON.stringify({
  numTotalTests: 4, success: true,
  testResults: [
    {
      name: "/proj/slow.test.ts", status: "passed", message: "",
      assertionResults: [
        { ancestorTitles: ["big domain"], fullName: "big domain covers every member", title: "covers every member", status: "passed", duration: 1500, failureMessages: [] },
        { ancestorTitles: ["big domain"], fullName: "big domain covers every member extended", title: "covers every member extended", status: "passed", duration: 400, failureMessages: [] },
      ],
    },
    {
      name: "/proj/fast.test.ts", status: "passed", message: "",
      assertionResults: [
        { ancestorTitles: [], fullName: "cheap check", title: "cheap check", status: "passed", duration: 3, failureMessages: [] },
        // a real report can carry a null duration for a test that never ran
        { ancestorTitles: [], fullName: "never ran", title: "never ran", status: "skipped", duration: null, failureMessages: [] },
      ],
    },
  ],
});
const TIMED: BatchReport = parseVitestJson(TIMED_REPORT);

test("cost — a report's per-assertion `duration` is carried onto every BatchTest", () => {
  const by = new Map(TIMED.tests.map((t) => [t.fullName, t]));
  assert.equal(by.get("big domain covers every member")?.duration, 1500);
  assert.equal(by.get("cheap check")?.duration, 3);
  // a null duration is NOT 0: it did not parse into a number, so the field stays absent
  assert.equal(by.get("never ran")?.duration, undefined);
});

test("cost — a report WITHOUT durations leaves every duration undefined (absence, never zero)", () => {
  // The original fixture at the top of this file was captured with timings dropped, which
  // makes it exactly the case that must not read as a free suite.
  assert.ok(REPORT.tests.every((t) => t.duration === undefined), "the untimed fixture must carry no durations");
  assert.ok(REPORT.tests.every((t) => t.duration !== 0), "…and specifically not zeroes");
});

test("cost — resolveFromBatch SUMS the duration of every test the claim's name matched", () => {
  // A claim whose name matches two tests is buying both, exactly as `-t` would run both.
  assert.equal(resolveFromBatch(TIMED, "big domain covers every member").ms, 1900);
  assert.equal(resolveFromBatch(TIMED, "cheap check").ms, 3);
});

test("cost — with no timings anywhere, ms is UNDEFINED rather than 0 (absence ≠ zero)", () => {
  const r = resolveFromBatch(REPORT, "write policy totality covers every op");
  assert.equal(r.ok, true);
  assert.equal(r.ms, undefined, "an untimed report must answer `unknown`, not `free`");
  // and the same for a red verdict — the cost question is independent of the verdict
  assert.equal(resolveFromBatch(REPORT, "failing group this one fails").ms, undefined);
});

test("cost — a PARTIALLY timed match sums what was measured instead of dropping the reading", () => {
  const partial: BatchReport = { format: "vitest-json", tests: [
    { fullName: "mixed group timed", status: "passed", duration: 250 },
    { fullName: "mixed group untimed", status: "passed" },
  ] };
  assert.equal(resolveFromBatch(partial, "mixed group").ms, 250);
});

test("cost — a VANISHED oracle has no cost at all: nothing ran, so there is nothing to sum", () => {
  const r = resolveFromBatch(TIMED, "an oracle nobody wrote");
  assert.equal(r.ok, false);
  assert.match(r.detail, /VANISHED ORACLE/);
  assert.equal(r.ms, undefined);
});

test("cost — a FAILING match still reports its cost: a red claim is not a free one", () => {
  const red: BatchReport = { format: "vitest-json", tests: [
    { fullName: "slow and wrong", status: "failed", duration: 900 },
  ] };
  const r = resolveFromBatch(red, "slow and wrong");
  assert.equal(r.ok, false);
  assert.equal(r.ms, 900);
});
