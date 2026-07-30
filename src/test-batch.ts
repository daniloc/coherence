// test-batch.ts — BATCHED ORACLE EXECUTION. Run the consuming project's test runner
// ONCE, with a machine-readable reporter, and resolve every executable claim from that
// single report instead of booting the runner per claim.
//
// WHY THIS EXISTS. The per-claim arm (`execNamedTest` in phrasebook.ts) shells
// `config.test` + the claim name once per executable claim. That is the right default:
// it needs no reporter, no schema, and no trust in a report file. But the cost is a
// whole runner boot per claim, and on a project whose pool is expensive to start (a
// workerd/vitest pool: 15-30s) it is pure redundancy — measured at 20-35 minutes for
// ~70 executable claims in a suite that runs end-to-end in under two. One boot, then
// N lookups, is the same evidence for one two-hundredth of the wall clock.
//
// THE GUARANTEE IS THE POINT, NOT THE SPEED. This module is only allowed to exist
// because it can reproduce the per-claim path's verdicts exactly, including the one
// that took a regression to learn (`config.testMatch`): a claim whose test was renamed
// or deleted must go RED, never green-by-absence. Here that protection is structural
// rather than configured — zero matching tests in the report is a red with a reason,
// and there is no exit code to misread.
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Config } from "./types.ts";

/** The report formats v1 understands. An unknown `config.testBatchFormat` is a hard
 *  error, never a fallback: a typo'd format that silently reverted to the per-claim
 *  path would look exactly like a working batch that happened to be slow. */
export const TEST_BATCH_FORMATS = ["vitest-json"] as const;
export type TestBatchFormat = (typeof TEST_BATCH_FORMATS)[number];

/** One test as the report described it. `fullName` is the runner's OWN concatenation of
 *  the suite path and the test title — the exact string its `-t` filter matches against,
 *  which is what makes batch matching a mirror rather than a re-implementation. */
export interface BatchTest { fullName: string; status: string; file?: string }
export interface BatchReport { format: TestBatchFormat; tests: BatchTest[] }

/** A batch attempt: the report, or null with the reason the run must fall back. */
export interface BatchOutcome { report: BatchReport | null; note: string }

/** What the executable tier is allowed to do this run. `serialAllowed: false` with a null
 *  report is a REFUSAL — the claim skips rather than quietly taking the slow path. */
export interface OracleAccess { report: BatchReport | null; serialAllowed: boolean }

/**
 * HOW THE EXECUTABLE TIER WILL RUN — decided once, from config + flags, before any claim.
 *
 * The serial per-claim path is not reachable by accident any more. It boots the project's
 * whole test pool once per claim, and on a real repo that is 20-35 minutes for evidence one
 * boot already contains; a default nobody chose should not have that shape. So the mode is
 * explicit: batch when we can (configured or DERIVED), read a report when handed one, and
 * otherwise REFUSE — a consumer has to type the name of the slow profile to get it.
 */
export type OracleMode =
  | { kind: "from-report"; file: string }
  | { kind: "batch"; cmd: string[]; derived: boolean }
  | { kind: "serial"; why: "config.oracleExecution" | "--serial-oracles" }
  | { kind: "refuse"; lines: string[] };

/** Which runner `config.test` is driving, as far as we can tell from the command itself. */
export type RunnerKind = "vitest" | "node-test" | "unknown";

export function detectRunner(test: string[] | undefined): RunnerKind {
  const joined = (test ?? []).join(" ");
  if (/(^|[\s/])vitest\b/.test(joined)) return "vitest";
  // `node --test` (or a --test-name-pattern anywhere) is node's own runner.
  if (/(^|\s)--test(\s|$|=)/.test(joined) || /--test-name-pattern/.test(joined)) return "node-test";
  return "unknown";
}

/** Where a derived batch command writes its report. Inside `.coherence/` because that dir
 *  already exists, is already the harness's, and is already committed-or-ignored per project. */
export const DERIVED_REPORT_PATH = ".coherence/test-report.json";

// The name-filter flags a per-claim command carries. A batch command must NOT carry them —
// it runs the WHOLE suite — so derivation strips them.
const NAME_FILTER_FLAGS = ["-t", "--testNamePattern", "--test-name-pattern"];

/**
 * Derive a whole-suite batch command from `config.test`, so a project that never heard of
 * `testBatch` still gets batching. Vitest only in v1, and deliberately so: the safety
 * argument for batching is that matching MIRRORS the runner's own name filter, and that was
 * verified for vitest against the real binary. It does NOT hold for `node --test`, whose
 * `--test-name-pattern` matches each individual test name rather than a concatenated one
 * (measured), and which ships no JSON reporter at all — so node:test is recognized and
 * refused with instructions instead of guessed at.
 */
export function deriveBatchCommand(cfg: Config): { cmd: string[] } | { why: string[] } {
  const test = cfg.test ?? [];
  const runner = detectRunner(test);
  if (runner === "vitest") {
    // Drop the name filter (this command runs everything) …
    const cmd = test.filter((a) => !NAME_FILTER_FLAGS.includes(a) && !NAME_FILTER_FLAGS.some((f) => a.startsWith(`${f}=`)));
    // … make sure it is a one-shot run and not a watcher, which would never exit …
    if (!cmd.includes("run") && !cmd.includes("--run")) {
      const i = cmd.findIndex((a) => /(^|[\s/])vitest\b/.test(a));
      cmd.splice(i + 1, 0, "run");
    }
    // … and add the reporter. --outputFile rather than bare stdout: a test writing straight
    // to process.stdout interleaves with a stdout report (measured), and a derived command
    // is one the user never sees, so it should be the robust form, not the tempting one.
    cmd.push("--reporter=json", `--outputFile=${DERIVED_REPORT_PATH}`);
    return { cmd };
  }
  if (runner === "node-test") return { why: [
    "config.test drives `node --test`, and coherence cannot batch it yet: node:test ships no",
    "JSON reporter (only default, dot, junit, lcov, spec, tap), and its --test-name-pattern",
    "does not match the concatenated suite path the way vitest's -t does — so a batch would",
    "need a second, unverified matching rule. Refusing rather than guessing.",
    "NOTE: `config.testMatch` does NOT protect a node:test project from a renamed oracle —",
    "a pattern matching nothing still reports the FILE as one passing test and exits 0.",
  ] };
  return { why: [
    test.length
      ? `config.test (${test.join(" ")}) is not a runner coherence knows how to batch.`
      : "config.test is not set, so there is no runner to batch or to run per claim.",
  ] };
}

/** Decide the mode. Order is precedence: an explicit flag always beats a derivation. */
export function selectOracleMode(
  cfg: Config,
  opts: { fromReport?: string; serial?: boolean },
): OracleMode {
  if (opts.fromReport) return { kind: "from-report", file: opts.fromReport };
  if (opts.serial) return { kind: "serial", why: "--serial-oracles" };
  if (cfg.oracleExecution === "serial") return { kind: "serial", why: "config.oracleExecution" };
  if (cfg.testBatch?.length) return { kind: "batch", cmd: cfg.testBatch, derived: false };
  const d = deriveBatchCommand(cfg);
  if ("cmd" in d) return { kind: "batch", cmd: d.cmd, derived: true };
  return {
    kind: "refuse",
    lines: [
      ...d.why,
      "",
      "The executable tier needs ONE of these — pick deliberately:",
      `  · config.testBatch: ["npx","vitest","run","--reporter=json","--outputFile=${DERIVED_REPORT_PATH}"]`,
      "      run the whole suite once and resolve every claim from that report (the fast path).",
      "  · coherence verify --from-report <file>",
      "      you already ran the suite; hand coherence its report and it runs nothing.",
      "  · coherence verify --serial-oracles   (or config.oracleExecution: \"serial\")",
      "      accept one FULL test-pool boot PER CLAIM. On a real project this is 20-35 minutes",
      "      for evidence a single boot already contains. It is supported, not recommended,",
      "      and it is opt-in precisely so nobody gets this profile without choosing it.",
    ],
  };
}

/** The cost framing the serial path prints EVERY time it runs — explicit opt-in or crash
 *  fallback alike. A profile this expensive should never be quiet about what it is doing. */
export function serialCostLines(claims: number, why: string): string[] {
  return [
    `  ! SERIAL ORACLES (${why}): ${claims} executable claim(s) × one FULL test-pool boot each.`,
    `  ! Each boot loads the whole suite to run one test's assertions; the evidence for all`,
    `  ! ${claims} is contained in a single run. Retire this with config.testBatch (or hand a`,
    `  ! report to \`verify --from-report <file>\`) — see README "Batched oracle execution".`,
  ];
}

// A whole suite, not one test — the per-claim arm's 2-minute ceiling would fail the very
// suites this exists for. Generous on purpose: a timeout here falls back to the per-claim
// path, which is slower still, so a too-tight bound is the worst of both.
const BATCH_TIMEOUT_MS = 900_000;
// spawnSync's DEFAULT maxBuffer is 1 MiB, and a vitest JSON report carries a full stack
// trace per failure — the exact run where the report matters most is the one most likely
// to blow a 1 MiB cap and arrive TRUNCATED (unparsable, i.e. a silent fallback on every
// red run). 64 MiB is far past any real report and costs nothing when unused.
const BATCH_MAX_BUFFER = 64 * 1024 * 1024;

/** Resolve the configured format, or say why it cannot be. An omitted format defaults to
 *  the only one there is; an unknown one is an error the run must surface. */
export function resolveBatchFormat(cfg: Config): { format: TestBatchFormat } | { error: string } {
  const raw = cfg.testBatchFormat;
  if (raw == null) return { format: "vitest-json" };
  if ((TEST_BATCH_FORMATS as readonly string[]).includes(raw)) return { format: raw as TestBatchFormat };
  return { error: `config.testBatchFormat "${raw}" is not a format coherence knows — supported: ${TEST_BATCH_FORMATS.join(", ")}` };
}

/**
 * Every top-level `{…}` region in a string, brace-balanced and string-literal aware.
 *
 * Needed because a reporter that writes to stdout does not own stdout: a test calling
 * `process.stdout.write` puts its bytes in the same stream, and a whole-string
 * `JSON.parse` then throws on the first stray character (measured — see the release
 * notes). Scanning for the object is what makes the obvious `--reporter=json` command
 * work anyway; `--outputFile` avoids the question entirely and is what the docs advise.
 */
export function extractJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; continue; }
    if (ch === "}" && depth > 0) { depth--; if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; } }
  }
  return out;
}

function collectVitest(j: any): BatchTest[] {
  const tests: BatchTest[] = [];
  for (const f of j.testResults) {
    const file = typeof f?.name === "string" ? f.name : undefined;
    const asserts = Array.isArray(f?.assertionResults) ? f.assertionResults : [];
    for (const a of asserts) {
      // Prefer the reporter's own `fullName`: it is the string the runner's `-t` filters
      // against, so taking it verbatim keeps the mirror exact. The reconstruction is a
      // fallback for a report that omitted it, and uses the same join the runner does.
      const fullName = typeof a?.fullName === "string" && a.fullName.trim()
        ? a.fullName
        : [...(Array.isArray(a?.ancestorTitles) ? a.ancestorTitles : []), a?.title ?? ""]
            .filter((s) => typeof s === "string" && s.length).join(" ");
      if (!fullName) continue;
      tests.push({ fullName, status: String(a?.status ?? "unknown"), file });
    }
  }
  return tests;
}

/**
 * Parse a `vitest run --reporter=json` report. Throws (never returns an empty report)
 * when no report can be found — an empty report and an unreadable one must not look
 * alike, because one of them would resolve every claim RED on a healthy suite.
 *
 * SCHEMA, verified against vitest 4.1.10 rather than assumed:
 *   { testResults: [ { name: <abs file>, status, assertionResults: [
 *       { ancestorTitles: string[], fullName: string, title: string,
 *         status: "passed" | "failed" | "skipped" | …, failureMessages: string[] } ] } ] }
 * and `fullName === [...ancestorTitles, title].join(" ")`.
 */
export function parseVitestJson(text: string): BatchReport {
  const candidates = extractJsonObjects(text);
  // LAST WINS. The reporter emits its object after the suite finishes, so anything a
  // test wrote to stdout mid-run precedes it and cannot outrank it.
  for (let i = candidates.length - 1; i >= 0; i--) {
    let j: any;
    try { j = JSON.parse(candidates[i]); } catch { continue; }
    if (!j || typeof j !== "object" || !Array.isArray(j.testResults)) continue;
    return { format: "vitest-json", tests: collectVitest(j) };
  }
  throw new Error("no vitest JSON report found in the output (expected an object with a `testResults` array)");
}

/** Where the command tells the runner to write its report, if it does. Covers
 *  `--outputFile=p`, `--outputFile.json=p` (vitest's per-reporter form) and
 *  `--outputFile p`. */
export function outputFileOf(cmd: string[]): string | null {
  for (let i = 0; i < cmd.length; i++) {
    const m = /^--outputFile(?:\.[A-Za-z0-9_-]+)?=(.+)$/.exec(cmd[i]);
    if (m) return m[1];
    if (/^--outputFile(?:\.[A-Za-z0-9_-]+)?$/.test(cmd[i]) && i + 1 < cmd.length) return cmd[i + 1];
  }
  return null;
}

/**
 * Read a report the project ALREADY produced (`verify --from-report <file>`) instead of
 * running the suite ourselves.
 *
 * WHY THIS IS THE CHEAPEST TIER. A project with an outer gate — a `check.mjs`, a CI step —
 * has usually just run the whole suite for its own reasons. Without this flag coherence
 * runs it a SECOND time to learn what that run already knew. Measured in a consuming repo:
 * their outer gate ran 298 tests, then the full tier paid the same suite's import cost 18
 * more times. With `--from-report` the full tier is one suite run plus a file read.
 */
export function readReportFile(root: string, file: string, format: TestBatchFormat): BatchOutcome {
  const p = isAbsolute(file) ? file : join(root, file);
  let text: string;
  try { text = readFileSync(p, "utf8"); }
  catch (e) { return { report: null, note: `--from-report ${file} could not be read: ${(e as Error).message}` }; }
  try {
    const report = format === "vitest-json" ? parseVitestJson(text) : parseVitestJson(text);
    if (!report.tests.length) return { report: null, note: `--from-report ${file} parsed but contained no tests` };
    return { report, note: `${report.tests.length} test(s)` };
  } catch (e) {
    return { report: null, note: `--from-report ${file} could not be parsed: ${(e as Error).message}` };
  }
}

/**
 * Run the whole suite once and return the report, or null plus the reason a fallback is
 * owed. Never throws — a batch that cannot be trusted degrades to the per-claim path,
 * loudly, and the caller prints the note.
 *
 * THE EXIT CODE IS DELIBERATELY IGNORED. A suite with a failing test exits nonzero, and
 * that is precisely the run whose report is most worth reading. A crash is the runner not
 * running (spawn error, timeout, signal) or a report that will not parse — never "some
 * test was red".
 */
export function runTestBatch(cmd: string[], root: string, format: TestBatchFormat): BatchOutcome {
  if (!cmd.length) return { report: null, note: "the batch command is empty" };
  // Taken BEFORE the spawn so the report file can be proved to postdate this run.
  const startedAt = Date.now();
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: root, encoding: "utf8", timeout: BATCH_TIMEOUT_MS, maxBuffer: BATCH_MAX_BUFFER,
  });
  if (r.error) return { report: null, note: `the runner did not complete: ${(r.error as Error).message}` };
  if (r.status === null) return { report: null, note: `the runner was killed by signal ${r.signal ?? "unknown"}` };

  const outFile = outputFileOf(cmd);
  let text: string;
  if (outFile) {
    const p = isAbsolute(outFile) ? outFile : join(root, outFile);
    // A STALE REPORT IS THE WORST OUTCOME AVAILABLE — worse than a crash, which at least
    // falls back. If the runner exits without writing (a config error, a collection failure)
    // and a report from a PREVIOUS run is still sitting on disk, reading it resolves every
    // claim from evidence about code that no longer exists — and it looks completely healthy.
    // So the file must be proved to postdate the run we just did. The 2s slack absorbs
    // coarse filesystem mtime granularity; it cannot admit a report from a previous run.
    try {
      const mtime = statSync(p).mtimeMs;
      if (mtime < startedAt - 2000)
        return { report: null, note: `report file ${outFile} was not written by this run (its mtime predates it) — the runner exited without producing a report` };
    } catch (e) {
      return { report: null, note: `report file ${outFile} could not be read: ${(e as Error).message}` };
    }
    try { text = readFileSync(p, "utf8"); }
    catch (e) { return { report: null, note: `report file ${outFile} could not be read: ${(e as Error).message}` }; }
  } else {
    text = r.stdout || "";
  }

  try {
    // One format today; the switch is where a second one lands, and the unknown case is
    // already refused before we ever get here (resolveBatchFormat).
    const report = format === "vitest-json" ? parseVitestJson(text) : parseVitestJson(text);
    if (!report.tests.length) return { report: null, note: "the report parsed but contained no tests" };
    return { report, note: `${report.tests.length} test(s)` };
  } catch (e) {
    return { report: null, note: `the report could not be parsed: ${(e as Error).message}` };
  }
}

/**
 * Resolve ONE claim's named test against the batch report — the mirror of what
 * `execNamedTest` learns from a scoped runner invocation.
 *
 * MATCHING MIRRORS `-t`. Verified against vitest 4.1.10: `-t` is an UNANCHORED REGEX
 * tested against `fullName`, so `-t "totality covers"` matches
 * "write policy totality covers every op" — a substring that spans the describe/test
 * boundary. The per-claim path always `reEscape`s the name first, and an escaped pattern
 * matched unanchored is exactly a literal substring test. Hence `fullName.includes(name)`
 * — not equality (which would red every claim anchored to a describe title, the common
 * case) and not a live regex (which would re-open the `(a+b)` hole that escaping closed:
 * measured, the unescaped form matched ZERO tests and exited 0).
 *
 * THREE STATES, AND THE THIRD IS THE POINT. A report distinguishes what an exit code
 * cannot:
 *   (a) the named test RAN and PASSED   → green
 *   (b) the named test RAN and FAILED   → red, naming the failing test
 *   (c) the named test DOES NOT EXIST   → red, and said so as its own distinct verdict
 * State (c) is the defect the per-claim path collapses into (a): `vitest -t` exits 0 when
 * the filter matched nothing, so a renamed or deleted oracle reads as a pass unless the
 * project hand-configured `config.testMatch` to demand "N passed" in the output. That is a
 * hole plugged by a config knob the project has to know to set. Here it is closed
 * STRUCTURALLY — there is no exit code to misread, absence is directly observable, and
 * `testMatch` has nothing left to do for a batched claim. Same move as a typo'd claim verb
 * or an unknown claim kind: eliminate the failure mode rather than paper over it.
 *
 * GREEN REQUIRES POSITIVE EVIDENCE: at least one matching test that actually PASSED, and
 * none that failed.
 *
 * ATTRIBUTION IS PER CLAIM. This resolves ONE claim's oracle and returns ONE claim's
 * detail, naming that oracle and the specific test that failed. A batch verdict of "the
 * suite is red" would be a regression on the per-claim path, so no caller aggregates:
 * the batch is shared EVIDENCE, never a shared verdict.
 */
export function resolveFromBatch(report: BatchReport, name: string): { ok: boolean; detail: string } {
  const matches = report.tests.filter((t) => t.fullName.includes(name));
  if (!matches.length)
    return {
      ok: false,
      detail: `test "${name}" — VANISHED ORACLE: no test in the batch report matches this name`
        + ` (renamed, deleted, or never collected). The claim names an oracle that does not exist,`
        + ` so nothing is enforcing it.`,
    };
  const failed = matches.filter((t) => t.status === "failed");
  if (failed.length)
    return {
      ok: false,
      detail: `test "${name}" — matching test FAILED in the batch report: "${failed[0].fullName}"`
        + (failed.length > 1 ? ` (+${failed.length - 1} more matching failure(s))` : ""),
    };
  // Skipped/todo tests are neither evidence nor failure — the same thing the per-claim
  // path concludes, since `vitest -t` exits 0 over a skipped match and `testMatch`'s
  // "N passed" then finds nothing to count.
  if (!matches.some((t) => t.status === "passed"))
    return {
      ok: false,
      detail: `test "${name}" — ${matches.length} matching test(s), none of which ran`
        + ` (${[...new Set(matches.map((m) => m.status))].sort().join(", ")}) — no positive evidence`,
    };
  return { ok: true, detail: "" };
}
