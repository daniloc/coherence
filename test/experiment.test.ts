// experiment.test.ts — contracts for the first-class plan/outcome ledger.
//
// The expensive mistakes here are false attribution and false closure: charging another
// session's trace to the owner, accepting half a result set, or reading corrupt history as
// an empty ledger. These tests keep those failures louder than the plan they would distort.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { activityPath, recordActivity } from "../src/activity.ts";
import {
  closeExperiment,
  createExperiment,
  deriveExperimentOutcome,
  experimentSessionPath,
  experimentStats,
  ExperimentLedgerError,
  readExperiments,
  renderExperiments,
  type CloseExperimentInput,
  type ExperimentActionResult,
  type ExperimentCriterionResult,
} from "../src/experiment.ts";
import { recordHookReads } from "../src/read-trace.ts";
import { cfg, cleanup, tmpProject } from "./_helpers.ts";

const T = (n: number) => `2026-08-04T12:${String(n).padStart(2, "0")}:00.000Z`;

const plan = (session = "owner-1", over: Partial<Parameters<typeof createExperiment>[1]> = {}) => ({
  session,
  hypothesis: "the smaller boundary removes the repeated branch",
  predictedContext: ["src/a.ts", "src/b.ts"],
  actions: ["replace the repeated branch with one boundary", "run the focused contract"],
  criteria: ["both callers use the boundary", "the focused contract passes"],
  agent: "builder",
  job: "field",
  now: T(1),
  ...over,
});

const actions = (
  first: ExperimentActionResult["status"] = "followed",
  second: ExperimentActionResult["status"] = "followed",
): ExperimentActionResult[] => [
  { id: "a1", status: first, evidence: "diff shows both branches replaced" },
  { id: "a2", status: second, evidence: "node:test reported the named contract" },
];

const criteria = (
  first: ExperimentCriterionResult["status"] = "met",
  second: ExperimentCriterionResult["status"] = "met",
): ExperimentCriterionResult[] => [
  { id: "s1", status: first, evidence: "rg finds one call path per caller" },
  { id: "s2", status: second, evidence: "2 tests passed and 0 failed" },
];

const closing = (
  experiment: string,
  over: Partial<CloseExperimentInput> = {},
): CloseExperimentInput => ({
  experiment,
  session: "assessor-1",
  agent: "reviewer",
  job: "field-review",
  actionResults: actions(),
  criterionResults: criteria(),
  now: T(5),
  ...over,
});

async function project() {
  const root = await tmpProject({
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 2;\n",
    "src/outside.ts": "export const outside = 3;\n",
  });
  return { root, config: cfg(root) };
}

function trace(config: ReturnType<typeof cfg>, session: string, tool: string, path: string, at: string) {
  return recordHookReads(config, {
    session_id: session,
    tool_name: tool,
    tool_input: { file_path: path },
  }, at);
}

function patchTrace(config: ReturnType<typeof cfg>, session: string, path: string, at: string) {
  return recordHookReads(config, {
    agent_id: session,
    tool_name: "apply_patch",
    tool_input: { command: `*** Begin Patch\n*** Update File: ${path}\n@@\n-old\n+new\n*** End Patch` },
  }, at);
}

function activity(
  config: ReturnType<typeof cfg>,
  session: string,
  command: "npx coherence verify" | "npx coherence regulate",
  exitCode: number | undefined,
  at: string,
  toolUseId: string,
  experimentId: string | null = null,
  transport: "launcher" | "direct" = "launcher",
) {
  return recordActivity(config, "PostToolUse", {
    session_id: "parent",
    agent_id: session,
    tool_name: "Bash",
    tool_use_id: toolUseId,
    tool_input: { command },
    tool_response: exitCode === undefined ? {} : { exit_code: exitCode },
  }, { host: "codex", transport, bundleHash: "bundle-1", experimentId }, at);
}

test("create — exact owner session, immutable identified plan, one open loop, exact retry dedupe", async () => {
  const { root, config } = await project();
  try {
    assert.throws(() => createExperiment(config, plan("unknown")), /exact non-empty host session/);
    assert.throws(() => createExperiment(config, plan("owner-1", { predictedContext: ["../escape.ts"] })), /stay inside/);

    const opened = createExperiment(config, plan());
    assert.match(opened.id, /^e-[a-f0-9]{12}$/);
    assert.equal(opened.ordinal, 1);
    assert.deepEqual(opened.actions.map((x) => x.id), ["a1", "a2"]);
    assert.deepEqual(opened.criteria.map((x) => x.id), ["s1", "s2"]);
    assert.deepEqual(opened.predictedContext, ["src/a.ts", "src/b.ts"]);
    assert.equal(opened.traceCursor, 0);

    const retry = createExperiment(config, plan("owner-1", { now: T(2) }));
    assert.deepEqual(retry, opened, "time changes on an exact retry must not append a second open row");
    assert.equal(readFileSync(experimentSessionPath(config, "owner-1"), "utf8").trim().split("\n").length, 1);

    assert.throws(
      () => createExperiment(config, plan("owner-1", { hypothesis: "a different plan" })),
      /already has open experiment/,
    );
    const ledger = readExperiments(config);
    assert.deepEqual([ledger.experiments.length, ledger.open.length, ledger.closed.length], [1, 1, 0]);
  } finally { await cleanup(root); }
});

test("plan actions are inert text — shell syntax is recorded and never executed", async () => {
  const { root, config } = await project();
  try {
    const sentinel = join(root, "action-ran");
    const opened = createExperiment(config, plan("owner-inert", {
      actions: [`touch ${sentinel}; echo should-not-run`, "inspect the recorded result"],
    }));
    assert.match(opened.actions[0].text, /touch .*; echo/);
    assert.equal(existsSync(sentinel), false);
  } finally { await cleanup(root); }
});

test("close — total nonempty evidence is mandatory and outcome is derived, never supplied", async () => {
  const { root, config } = await project();
  try {
    const opened = createExperiment(config, plan());
    assert.throws(
      () => closeExperiment(config, closing(opened.id, { actionResults: actions().slice(0, 1) })),
      /missing a2/,
    );
    assert.throws(
      () => closeExperiment(config, closing(opened.id, {
        criterionResults: [{ ...criteria()[0], evidence: " " }, criteria()[1]],
      })),
      /evidence must be non-empty/,
    );
    assert.throws(
      () => closeExperiment(config, closing(opened.id, {
        criterionResults: [...criteria(), { id: "s9", status: "met", evidence: "invented" }],
      })),
      /unknown s9/,
    );
    assert.equal(readExperiments(config).open.length, 1, "refused partial closes append nothing");

    const failed = closeExperiment(config, closing(opened.id, { criterionResults: criteria("unmet", "met") }));
    assert.equal(failed.outcome, "failure");
    assert.equal(deriveExperimentOutcome(criteria("met", "met")), "success");
    assert.equal(deriveExperimentOutcome(criteria("met", "unknown")), "inconclusive");
    assert.equal(deriveExperimentOutcome(criteria("unknown", "unmet")), "failure");

    const second = createExperiment(config, plan("owner-1", { now: T(6) }));
    assert.notEqual(second.id, opened.id, "the same plan after closure is a new loop, not a retry of the old one");
    assert.equal(second.ordinal, 2);
    const inconclusive = closeExperiment(config, closing(second.id, {
      session: "owner-1", now: T(7), criterionResults: criteria("met", "unknown"),
    }));
    assert.equal(inconclusive.outcome, "inconclusive");
  } finally { await cleanup(root); }
});

test("trace attribution — closure snapshots only post-open owner-session events and preserves assessor", async () => {
  const { root, config } = await project();
  try {
    trace(config, "owner-1", "Read", "src/b.ts", T(0)); // prior context, behind cursor
    activity(config, "owner-1", "npx coherence verify", 1, T(0), "before");
    const opened = createExperiment(config, plan());
    assert.equal(opened.traceCursor, 1);
    assert.equal(opened.activityCursor, 1);
    trace(config, "other-agent", "Read", "src/outside.ts", T(2));
    trace(config, "owner-1", "Read", "src/a.ts", T(2));
    patchTrace(config, "owner-1", "src/b.ts", T(3));
    trace(config, "assessor-1", "Read", "src/outside.ts", T(4));
    activity(config, "other-agent", "npx coherence verify", 1, T(2), "other", opened.id);
    activity(config, "owner-1", "npx coherence verify", undefined, T(2), "verify", opened.id);
    activity(config, "owner-1", "npx coherence verify", 0, T(3), "verify", opened.id);
    activity(config, "owner-1", "npx coherence regulate", 2, T(4), "regulate", opened.id);
    activity(config, "assessor-1", "npx coherence verify", 0, T(4), "assessor", opened.id);

    const closed = closeExperiment(config, closing(opened.id));
    assert.equal(closed.ownerSession, "owner-1");
    assert.deepEqual(closed.assessor, { session: "assessor-1", agent: "reviewer", job: "field-review" });
    assert.equal(closed.trace.attribution, "owner-session");
    assert.deepEqual(closed.trace.events.map((x) => [x.session, x.mode, x.path]), [
      ["owner-1", "read", "src/a.ts"],
      ["owner-1", "write", "src/b.ts"],
    ]);
    assert.deepEqual(closed.trace.events[1].provenance, { source: "apply_patch", operation: "update" });
    assert.deepEqual([closed.trace.start, closed.trace.end], [1, 3]);
    assert.deepEqual([closed.activity.start, closed.activity.end], [1, 4]);
    assert.equal(closed.activity.attribution, "owner-session");
    assert.deepEqual(closed.activity.rows.map((x) => [x.session, x.command?.name, x.command?.result]), [
      ["owner-1", "verify", "unknown"],
      ["owner-1", "verify", "success"],
      ["owner-1", "regulate", "failure"],
    ]);
    assert.ok(existsSync(experimentSessionPath(config, "assessor-1")), "the close belongs to the assessor writer file");
    assert.equal(readExperiments(config).closed[0].closed?.id, closed.id);
    assert.equal(existsSync(join(root, ".coherence", "calibration")), false,
      "experiment outcome must not create a clean/defect calibration label");
  } finally { await cleanup(root); }
});

test("close retry — an exact retry dedupes; changed evidence cannot rewrite an outcome", async () => {
  const { root, config } = await project();
  try {
    const opened = createExperiment(config, plan());
    const first = closeExperiment(config, closing(opened.id));
    trace(config, "owner-1", "Read", "src/outside.ts", T(6));
    const retry = closeExperiment(config, closing(opened.id, { now: T(8) }));
    assert.deepEqual(retry, first, "later trace and time do not mutate an already-frozen exact close");
    assert.equal(readFileSync(experimentSessionPath(config, "assessor-1"), "utf8").trim().split("\n").length, 1);

    assert.throws(() => closeExperiment(config, closing(opened.id, {
      criterionResults: criteria("unmet", "met"), now: T(9),
    })), /already closed by immutable record/);
  } finally { await cleanup(root); }
});

test("trace integrity — a rewritten prefix refuses closure instead of inventing a post-open window", async () => {
  const { root, config } = await project();
  try {
    trace(config, "owner-1", "Read", "src/a.ts", T(0));
    const opened = createExperiment(config, plan());
    const tracePath = join(root, ".coherence", "read-traces", "owner-1.jsonl");
    const row = JSON.parse((await readFile(tracePath, "utf8")).trim()) as Record<string, unknown>;
    row.path = "src/b.ts";
    await writeFile(tracePath, JSON.stringify(row) + "\n");
    assert.throws(() => closeExperiment(config, closing(opened.id)), /trace prefix changed/);
    assert.equal(readExperiments(config).open.length, 1);
  } finally { await cleanup(root); }
});

test("activity integrity — unreadable or rewritten owner activity refuses exact closure", async () => {
  const damaged = await project();
  try {
    const opened = createExperiment(damaged.config, plan());
    const damagedPath = activityPath(damaged.config, "owner-1");
    await mkdir(dirname(damagedPath), { recursive: true });
    appendFileSync(damagedPath, "{ half a row\n");
    assert.throws(() => closeExperiment(damaged.config, closing(opened.id)), /1 unreadable row.*exact attribution is unavailable/);
    assert.equal(readExperiments(damaged.config).open.length, 1);
  } finally { await cleanup(damaged.root); }

  const rewritten = await project();
  try {
    activity(rewritten.config, "owner-1", "npx coherence verify", 0, T(0), "before");
    const opened = createExperiment(rewritten.config, plan());
    const path = activityPath(rewritten.config, "owner-1");
    const row = JSON.parse((await readFile(path, "utf8")).trim()) as Record<string, unknown>;
    row.bundleHash = "bundle-2";
    await writeFile(path, JSON.stringify(row) + "\n");
    assert.throws(() => closeExperiment(rewritten.config, closing(opened.id)), /activity prefix changed/);
  } finally { await cleanup(rewritten.root); }

  const ambiguous = await project();
  try {
    recordActivity(ambiguous.config, "PostToolUse", {
      session_id: "owner-1", tool_name: "Bash", tool_use_id: "parent-only",
      tool_input: { command: "npx coherence verify" }, tool_response: { exit_code: 0 },
    }, { host: "codex", transport: "launcher", bundleHash: "bundle-1", experimentId: null }, T(0));
    assert.throws(() => createExperiment(ambiguous.config, plan()), /ambiguously attributed row.*exact attribution is unavailable/);
  } finally { await cleanup(ambiguous.root); }
});

test("strict read — malformed, tampered, and dangling rows are refusals, never omissions", async () => {
  const malformed = await project();
  try {
    const path = experimentSessionPath(malformed.config, "owner-1");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "not json\n");
    assert.throws(() => readExperiments(malformed.config), (error: unknown) => {
      assert.ok(error instanceof ExperimentLedgerError);
      assert.match(error.message, /malformed JSON/);
      return true;
    });
  } finally { await cleanup(malformed.root); }

  const source = await project();
  const dangling = await project();
  try {
    const opened = createExperiment(source.config, plan());
    closeExperiment(source.config, closing(opened.id));
    const closeLine = (await readFile(experimentSessionPath(source.config, "assessor-1"), "utf8")).trim();
    const target = experimentSessionPath(dangling.config, "assessor-1");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, closeLine + "\n");
    assert.throws(() => readExperiments(dangling.config), /closes dangling experiment/);

    const openPath = experimentSessionPath(source.config, "owner-1");
    const raw = JSON.parse((await readFile(openPath, "utf8")).trim()) as Record<string, unknown>;
    raw.hypothesis = "edited in place";
    await writeFile(openPath, JSON.stringify(raw) + "\n");
    assert.throws(() => readExperiments(source.config), /id does not match immutable open content/);
  } finally {
    await cleanup(source.root);
    await cleanup(dangling.root);
  }
});

test("stats and render — report plan association and criteria, never causal calibration claims", async () => {
  const { root, config } = await project();
  try {
    activity(config, "owner-1", "npx coherence verify", undefined, T(0), "cross-boundary");
    const opened = createExperiment(config, plan());
    trace(config, "owner-1", "Read", "src/a.ts", T(2));
    trace(config, "owner-1", "Read", "src/outside.ts", T(3));
    activity(config, "owner-1", "npx coherence verify", 0, T(2), "cross-boundary", opened.id);
    activity(config, "owner-1", "npx coherence verify", undefined, T(2), "verify", opened.id);
    activity(config, "owner-1", "npx coherence verify", 0, T(3), "verify", opened.id);
    activity(config, "owner-1", "npx coherence regulate", 2, T(4), "regulate", opened.id);
    activity(config, "owner-1", "npx coherence verify", 0, T(4), "direct-verify", opened.id, "direct");
    closeExperiment(config, closing(opened.id, { criterionResults: criteria("unmet", "met") }));
    createExperiment(config, plan("owner-2", { now: T(6) }));

    const stats = experimentStats(readExperiments(config));
    assert.deepEqual([stats.experiments, stats.open, stats.closed], [2, 1, 1]);
    assert.deepEqual(stats.outcomes, { success: 0, failure: 1, inconclusive: 0 });
    assert.equal(stats.meanPredictedContextObserved, 0.5);
    assert.equal(stats.meanObservedReadsOutsidePlan, 0.5);
    assert.equal(stats.traceEvents, 2);
    assert.deepEqual([stats.activityRows, stats.activityEvents, stats.activityDuplicates], [5, 3, 2]);
    assert.deepEqual(stats.verification, { total: 1, success: 1, failure: 0, unknown: 0 });
    assert.deepEqual(stats.intervention, { total: 1, success: 0, failure: 1, unknown: 0 });
    assert.deepEqual(stats.directVerification, { total: 1, success: 1, failure: 0, unknown: 0 });
    assert.deepEqual(stats.directIntervention, { total: 0, success: 0, failure: 0, unknown: 0 });
    assert.doesNotMatch(JSON.stringify(stats), /clean|defect/);

    const rendered = renderExperiments(config);
    assert.equal(rendered.count, 2);
    assert.match(rendered.text, /OPEN .*owner-2/);
    assert.match(rendered.text, /FAILURE .*owner-1/);
    assert.match(rendered.text, /criterion s1 unmet: rg finds one call path/);
    assert.match(rendered.text, /owner-session activity 1\.\.6: 5 raw row\(s\), 3 new event\(s\)/);
    assert.match(rendered.text, /launcher verification verify: success/);
    assert.match(rendered.text, /launcher intervention regulate: failure/);
    assert.match(rendered.text, /direct verification verify: success/);
    assert.match(rendered.text, /not a clean\/defect label or a causal claim/);
    const openOnly = renderExperiments(config, { openOnly: true });
    assert.equal(openOnly.count, 1);
    assert.doesNotMatch(openOnly.text, /FAILURE/);
  } finally { await cleanup(root); }
});
