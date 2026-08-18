// pytest-batch.test.ts — the "pytest-json" batch format (pytest-json-report's file,
// `pytest --json-report --json-report-file=<path>`), held to the same invariants the
// vitest-json format pinned in test-batch.test.ts:
//   · a vanished oracle reds its claim, never green-by-absence — zero matching nodeids
//     is its own named state;
//   · a claim goes green only on positive evidence its oracle ran — outcomes come from
//     report entries, never exit codes;
//   · an unknown testBatchFormat is a hard error; a torn report falls back LOUDLY to
//     the serial per-claim path.
//
// THE FIXTURE IS SHAPED LIKE THE REAL THING: a top-level `tests` array whose entries
// carry `nodeid` (path::Class::function, parametrized ids appending "[param]"),
// `outcome` (passed | failed | error | skipped | xfailed | xpassed), and per-phase
// setup/call/teardown timings in SECONDS. No real pytest is booted here.
//
// MATCHING IS EQUALITY WITH THE FUNCTION SEGMENT, not substring: the fixture contains
// "test_rejects_unknown_kind" (all cases green) alongside a FAILING
// "test_rejects_unknown_kind_extended" — under `-k`-style substring matching the claim
// below would inherit that failure, so its green is the proof of the equality rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { runVerify } from "../src/verify.ts";
import {
  parsePytestJson, resolveFromBatch, resolveBatchFormat, outputFileOf, pytestFunctionName,
  TEST_BATCH_FORMATS, detectRunner, deriveBatchCommand, selectOracleMode, DERIVED_REPORT_PATH,
  type BatchReport,
} from "../src/test-batch.ts";
import { tmpProject, cleanup, runCaptured, cfg, comp, graph } from "./_helpers.ts";

const withProject = async (files: Record<string, string>, fn: (root: string) => Promise<void>) => {
  const root = await tmpProject(files);
  try { await fn(root); } finally { await cleanup(root); }
};

/** One report entry as pytest-json-report writes it. `callDur` in SECONDS (the plugin's
 *  unit); omitted = no call phase at all (a test skipped during setup); null = the phase
 *  ran but carried no usable duration. */
const pt = (nodeid: string, outcome: string, callDur?: number | null) => ({
  nodeid, lineno: 7, outcome, keywords: [nodeid.split("::").pop(), ""],
  setup: { duration: 0.0005, outcome: "passed" },
  ...(callDur === undefined ? {} : { call: { duration: callDur, outcome } }),
  teardown: { duration: 0.0002, outcome: "passed" },
});

const PYTEST_REPORT = JSON.stringify({
  created: 1755500000.0, duration: 2.5, exitcode: 1, root: "/proj",
  environment: { Python: "3.12.4", Platform: "Linux" },
  summary: { passed: 7, failed: 2, error: 1, skipped: 2, xfailed: 1, xpassed: 1, total: 13, collected: 13 },
  collectors: [],
  tests: [
    // the passing claim: three parametrized cases of ONE function, all green
    pt("tests/test_boundary.py::test_rejects_unknown_kind[a]", "passed", 0.25),
    pt("tests/test_boundary.py::test_rejects_unknown_kind[b]", "passed", 0.5),
    pt("tests/test_boundary.py::test_rejects_unknown_kind[c]", "passed", 0.125),
    // the equality guard: SHARES THE PREFIX of the claim above and FAILS — substring
    // matching would drag this into that claim; equality keeps them separate
    pt("tests/test_boundary.py::test_rejects_unknown_kind_extended", "failed", 0.5),
    // the failing claim: one parametrized case red, so the whole function is red
    pt("tests/test_totality.py::test_totality[x]", "passed", 0.25),
    pt("tests/test_totality.py::test_totality[y]", "failed", 0.5),
    // a class-scoped nodeid: the function segment is still the final one
    pt("tests/test_cls.py::TestPolicy::test_method", "passed", 0.125),
    // not-positive-evidence outcomes: skipped during setup (NO call phase), and xfailed
    pt("tests/test_skip.py::test_skipped_only", "skipped"),
    pt("tests/test_skip.py::test_xfailed_only", "xfailed", 0.001),
    // suite anomalies that must RED: an xfail that passed, and a raising fixture
    pt("tests/test_skip.py::test_xpassed_one", "xpassed", 0.001),
    pt("tests/test_err.py::test_errored", "error", null),
    // a parametrized mix, one case skipped alongside a passing one
    pt("tests/test_mix.py::test_mixed_cases[run]", "passed", 0.25),
    pt("tests/test_mix.py::test_mixed_cases[skip]", "skipped"),
  ],
});

const REPORT: BatchReport = parsePytestJson(PYTEST_REPORT);

/** A fake pytest batch: writes `body` to the --json-report-file path (the plugin writes
 *  ONLY to a file, never stdout), appends a byte to runs.log so boots can be counted,
 *  and exits `code`. */
const pytestRunner = (body: string, code = 1) => `
const fs = require("node:fs");
fs.appendFileSync(process.env.RUNS_LOG, "x");
const body = ${JSON.stringify(body)};
const of = process.argv.find((a) => a.startsWith("--json-report-file="));
if (of) {
  const p = of.slice("--json-report-file=".length);
  fs.mkdirSync(require("node:path").dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
process.exit(${code});
`;

test("pytest batch — nodeid names resolve per claim, zero matches is the vanished oracle, and a torn report falls back loudly", async () => {
  // ── the report layer ───────────────────────────────────────────────────────────────
  assert.equal(REPORT.format, "pytest-json");
  assert.equal(REPORT.tests.length, 13);
  const by = new Map(REPORT.tests.map((t) => [t.fullName, t]));
  // fullName is the nodeid VERBATIM (the runner's own string, as the vitest path keeps
  // the reporter's fullName), and the file part rides along for detail lines
  assert.equal(by.get("tests/test_totality.py::test_totality[y]")?.status, "failed");
  assert.equal(by.get("tests/test_totality.py::test_totality[y]")?.file, "tests/test_totality.py");
  // call-phase seconds become the milliseconds BatchTest promises …
  assert.equal(by.get("tests/test_boundary.py::test_rejects_unknown_kind[a]")?.duration, 250);
  // … and ABSENCE IS ABSENCE, never zero: no call phase, and a null duration, both stay undefined
  assert.equal(by.get("tests/test_skip.py::test_skipped_only")?.duration, undefined);
  assert.equal(by.get("tests/test_err.py::test_errored")?.duration, undefined);

  // an unparseable report THROWS rather than returning an empty one — an empty report
  // and an unreadable one must not look alike (one would red every claim on a healthy suite)
  assert.throws(() => parsePytestJson("no json here at all"), /no pytest JSON report found/);
  assert.throws(() => parsePytestJson(""), /no pytest JSON report found/);
  assert.throws(() => parsePytestJson('{"summary":{"total":3}}'), /no pytest JSON report found/);

  // registration: "pytest-json" is a known format; unknown spellings stay a hard error
  assert.deepEqual([...TEST_BATCH_FORMATS], ["vitest-json", "pytest-json"]);
  assert.deepEqual(resolveBatchFormat(cfg("/x", { testBatchFormat: "pytest-json" })), { format: "pytest-json" });
  assert.deepEqual(resolveBatchFormat(cfg("/x")), { format: "vitest-json" }); // the default is unchanged
  const bad = resolveBatchFormat(cfg("/x", { testBatchFormat: "pytest_json" }));
  assert.ok("error" in bad && /not a format coherence knows/.test(bad.error), JSON.stringify(bad));
  assert.ok("error" in bad && /pytest-json/.test(bad.error), "the error must name the format that exists");

  // the plugin's report-file flag is recognized in both spellings (it never writes stdout)
  assert.equal(outputFileOf(["pytest", "--json-report", "--json-report-file=.coherence/test-report.json"]), ".coherence/test-report.json");
  assert.equal(outputFileOf(["pytest", "--json-report", "--json-report-file", "r.json"]), "r.json");
  assert.equal(outputFileOf(["pytest", "--json-report"]), null);

  // ── matching: the function segment of the nodeid, [param] stripped, EQUALITY ───────
  assert.equal(pytestFunctionName("tests/test_x.py::test_a[case-1]"), "test_a");
  assert.equal(pytestFunctionName("tests/test_x.py::TestCls::test_b"), "test_b");

  // (a) all parametrized cases of the named function pass → green, and ms sums ALL of them
  const green = resolveFromBatch(REPORT, "test_rejects_unknown_kind");
  assert.equal(green.ok, true, green.detail);
  assert.equal(green.ms, 875); // 250 + 500 + 125 — three cases bought by one claim
  // …and that green is the PROOF of equality matching: the fixture's FAILING
  // "test_rejects_unknown_kind_extended" shares the prefix and was not dragged in
  assert.equal(by.get("tests/test_boundary.py::test_rejects_unknown_kind_extended")?.status, "failed");

  // a class-scoped test resolves by its final segment too
  assert.ok(resolveFromBatch(REPORT, "test_method").ok);

  // (b) ONE failing case reds the whole function — all matched cases must pass
  const red = resolveFromBatch(REPORT, "test_totality");
  assert.equal(red.ok, false);
  assert.match(red.detail, /FAILED in the batch report/);
  assert.ok(red.detail.includes('"tests/test_totality.py::test_totality[y]"'), red.detail);
  assert.equal(red.ms, 750); // a red claim is not a free one

  // (c) ZERO matches is the VANISHED ORACLE — its own named state, never a quiet pass,
  // and distinguishable from a test that ran and failed
  const gone = resolveFromBatch(REPORT, "test_nobody_ever_wrote");
  assert.equal(gone.ok, false);
  assert.match(gone.detail, /VANISHED ORACLE/);
  assert.match(gone.detail, /no test in the batch report matches this name/);
  assert.doesNotMatch(gone.detail, /FAILED/);
  assert.equal(gone.ms, undefined); // nothing ran, so there is nothing to sum
  // substrings and prefixes of a real function name are ALSO vanished — not `-k` semantics
  assert.match(resolveFromBatch(REPORT, "rejects_unknown_kind").detail, /VANISHED ORACLE/);
  assert.match(resolveFromBatch(REPORT, "test_rejects").detail, /VANISHED ORACLE/);
  // a bare nodeid is not the claim's name either — claims name functions, not paths
  assert.match(resolveFromBatch(REPORT, "tests/test_totality.py::test_totality[y]").detail, /VANISHED ORACLE/);

  // skipped-only and xfailed-only matches carry NO positive evidence the oracle ran → red
  const skipped = resolveFromBatch(REPORT, "test_skipped_only");
  assert.equal(skipped.ok, false);
  assert.match(skipped.detail, /none of which ran/);
  assert.match(skipped.detail, /skipped/);
  assert.equal(resolveFromBatch(REPORT, "test_xfailed_only").ok, false);

  // xpassed is a FAILURE, not a pass: the vitest path has no leniency to mirror (only
  // literal "passed" passes there), and an xfail that passes is a stale expectation
  const xp = resolveFromBatch(REPORT, "test_xpassed_one");
  assert.equal(xp.ok, false);
  assert.match(xp.detail, /FAILED/);
  assert.match(xp.detail, /outcome: xpassed/);
  // and "error" (a raising fixture) reds exactly like a failure
  const err = resolveFromBatch(REPORT, "test_errored");
  assert.equal(err.ok, false);
  assert.match(err.detail, /outcome: error/);

  // a passing case alongside a SKIPPED case is green — the same leniency the vitest
  // sibling pins, so flipping a project to pytest-json cannot invent new reds
  const mixed = resolveFromBatch(REPORT, "test_mixed_cases");
  assert.equal(mixed.ok, true, mixed.detail);

  // ── recognition without guessing: pytest is detected, and derivation REFUSES ───────
  assert.equal(detectRunner(["pytest", "-k"]), "pytest");
  assert.equal(detectRunner(["python", "-m", "pytest", "-k"]), "pytest");
  const d = deriveBatchCommand(cfg("/x", { test: ["pytest", "-k"] }));
  assert.ok("why" in d, "a pytest config.test must not silently grow a guessed batch command");
  const why = d.why.join(" ");
  assert.match(why, /pytest-json-report/);        // names the plugin the batch needs
  assert.match(why, /testBatchFormat/);           // and the exact config to set
  assert.ok(why.includes(DERIVED_REPORT_PATH));
  const m = selectOracleMode(cfg("/x", { test: ["pytest", "-k"] }), {});
  assert.equal(m.kind, "refuse");

  // ── end to end, through runVerify ──────────────────────────────────────────────────
  // ONE suite boot resolves all three claim states, each with per-claim attribution.
  // The runner exits 1 (the suite HAS failures) — a nonzero exit is not a crash: the
  // verdict evidence is the report's entries, never the exit code.
  await withProject({ "runner.js": pytestRunner(PYTEST_REPORT, 1) }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", {
      claims: [
        'passes test "test_rejects_unknown_kind"',  // (a) ran + passed (every case)
        'passes test "test_totality"',              // (b) ran + one case failed
        'passes test "test_deleted_oracle"',        // (c) does not exist
      ],
      why: "r",
    })]);
    const r = await runCaptured(() => runVerify(cfg(root, {
      testBatch: ["node", join(root, "runner.js"), "--json-report", "--json-report-file=report.json"],
      testBatchFormat: "pytest-json",
    }), g, {}));
    assert.equal(r.code, 1);
    assert.match(r.out, /oracles: batched — running the whole suite ONCE/);
    assert.match(r.out, /report parsed \(pytest-json\), 13 test\(s\)/);
    assert.match(r.out, /claims: 3 · 1 green · 2 red/);
    const failLine = r.out.split("\n").find((l) => l.includes('"test_totality"'))!;
    assert.match(failLine, /FAILED in the batch report/);
    assert.ok(failLine.includes("tests/test_totality.py::test_totality[y]"), failLine);
    const goneLine = r.out.split("\n").find((l) => l.includes('"test_deleted_oracle"'))!;
    assert.match(goneLine, /VANISHED ORACLE/);
    assert.notEqual(failLine, goneLine);
    // THREE claims, ONE boot — and no silent serial anything
    assert.equal((await readFile(join(root, "runs.log"), "utf8")).length, 1);
    assert.doesNotMatch(r.out, /FALLING BACK/);
  });

  // a TORN report — the batch ran but its output will not parse — falls back to the
  // serial per-claim path LOUDLY, stating the parse failure, and still gets a verdict
  await withProject({
    "runner.js": pytestRunner("== short test summary info == not a report {"),
    "ok.js": "process.exit(['test_whatever'].includes(process.argv[2]) ? 0 : 1)",
  }, async (root) => {
    process.env.RUNS_LOG = join(root, "runs.log");
    const g = graph([comp(".", { claims: ['passes test "test_whatever"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root, {
      test: ["node", join(root, "ok.js")],
      testBatch: ["node", join(root, "runner.js"), "--json-report-file=report.json"],
      testBatchFormat: "pytest-json",
    }), g, {}));
    assert.match(r.out, /could not be parsed/);
    assert.match(r.out, /no pytest JSON report found/);
    assert.match(r.out, /FALLING BACK to the serial per-claim runner/);
    assert.equal(r.code, 0, r.out); // the per-claim path answered
    assert.match(r.out, /1 green/);
  });

  // an unknown testBatchFormat FAILS the run before any work — never a silent fallback
  await withProject({ "ok.js": "process.exit(0)" }, async (root) => {
    const g = graph([comp(".", { claims: ['passes test "test_whatever"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root, {
      test: ["node", join(root, "ok.js")],
      testBatch: ["node", join(root, "ok.js")], testBatchFormat: "pytest_json",
    }), g, {}));
    assert.equal(r.code, 1);
    assert.match(r.out, /not a format coherence knows/);
    assert.doesNotMatch(r.out, /claims:/); // it stopped before evaluating anything
  });
});
