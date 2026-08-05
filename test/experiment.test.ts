// experiment.test.ts — contracts for the first-class plan/outcome ledger.
//
// The expensive mistakes here are false attribution and false closure: charging another
// session's trace to the owner, accepting half a result set, or reading corrupt history as
// an empty ledger. These tests keep those failures louder than the plan they would distort.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

const stableFixture = (value: any): string => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stableFixture).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableFixture(value[key])}`).join(",")}}`;

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
    session_id: "parent",
    agent_id: session,
    tool_name: tool,
    tool_input: { file_path: path },
  }, at);
}

function parentTrace(config: ReturnType<typeof cfg>, session: string, tool: string, path: string, at: string) {
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

function parentActivity(
  config: ReturnType<typeof cfg>,
  session: string,
  command: "npx coherence verify" | "npx coherence regulate",
  exitCode: number | undefined,
  at: string,
  toolUseId: string,
) {
  return recordActivity(config, "PostToolUse", {
    session_id: session,
    tool_name: "Bash",
    tool_use_id: toolUseId,
    tool_input: { command },
    tool_response: exitCode === undefined ? {} : { exit_code: exitCode },
  }, { host: "codex", transport: "launcher", bundleHash: "bundle-1", experimentId: null }, at);
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

test("Codex parent-only tool events close the loop as an aggregate, never exact owner evidence", async () => {
  const { root, config } = await project();
  try {
    const opened = createExperiment(config, plan("codex-thread"));
    parentTrace(config, "codex-thread", "Read", "src/a.ts", T(2));
    parentActivity(config, "codex-thread", "npx coherence verify", 0, T(3), "parent-verify");

    const closed = closeExperiment(config, closing(opened.id));
    assert.equal(closed.outcome, "success", "manual total criteria, not telemetry scope, derive the outcome");
    assert.equal(closed.trace.attribution, "parent-session-aggregate");
    assert.equal(closed.trace.events[0].observation?.attribution, "parent-fallback");
    assert.equal(closed.activity.attribution, "parent-session-aggregate");
    assert.equal(closed.activity.rows[0].attribution, "parent-fallback");
    assert.match(renderExperiments(config, { id: opened.id }).text, /may include descendant work/);

    const child = createExperiment(config, plan("codex-child", { now: T(6) }));
    parentTrace(config, "codex-thread", "Read", "src/b.ts", T(7));
    parentActivity(config, "codex-thread", "npx coherence regulate", 0, T(7), "parent-regulate");
    const childClose = closeExperiment(config, closing(child.id, { now: T(8) }));
    assert.equal(childClose.trace.attribution, "none");
    assert.equal(childClose.activity.attribution, "none");
    assert.deepEqual(childClose.trace.events, [],
      "Codex parent-only PostToolUse cannot be invented as exact evidence for a child id");
    assert.deepEqual(childClose.activity.rows, []);
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

test("trace integrity — a torn post-open row is counted and refuses closure", async () => {
  const { root, config } = await project();
  try {
    const opened = createExperiment(config, plan());
    const tracePath = join(root, ".coherence", "read-traces", "owner-1.jsonl");
    await mkdir(dirname(tracePath), { recursive: true });
    appendFileSync(tracePath, "{ half a trace row\n");
    assert.throws(() => closeExperiment(config, closing(opened.id)), /trace has 1 unreadable row.*scoped evidence is unavailable/);
    assert.equal(readExperiments(config).open.length, 1);
  } finally { await cleanup(root); }
});

test("activity integrity — unreadable or rewritten owner activity refuses scoped closure", async () => {
  const damaged = await project();
  try {
    const opened = createExperiment(damaged.config, plan());
    const damagedPath = activityPath(damaged.config, "owner-1");
    await mkdir(dirname(damagedPath), { recursive: true });
    appendFileSync(damagedPath, "{ half a row\n");
    assert.throws(() => closeExperiment(damaged.config, closing(opened.id)), /1 unreadable row.*scoped attribution is unavailable/);
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

  const nested = await project();
  try {
    const opened = createExperiment(nested.config, plan());
    closeExperiment(nested.config, closing(opened.id));
    const path = experimentSessionPath(nested.config, "assessor-1");
    const raw = JSON.parse((await readFile(path, "utf8")).trim()) as Record<string, any>;
    raw.trace.events = [null];
    raw.trace.end = raw.trace.start + 1;
    raw.activity.rows = [null];
    raw.activity.end = raw.activity.start + 1;
    await writeFile(path, JSON.stringify(raw) + "\n");
    assert.throws(() => readExperiments(nested.config), (error: unknown) => {
      assert.ok(error instanceof ExperimentLedgerError, "nested damage must use the ledger refusal surface");
      assert.match(error.message, /trace\.events\[0\] must be an object/);
      assert.match(error.message, /activity\.rows\[0\] must be an object/);
      return true;
    });
  } finally { await cleanup(nested.root); }
});

test("strict read — frozen telemetry cannot launder unknown trace scope or inconsistent activity", async () => {
  const { root, config } = await project();
  try {
    const opened = createExperiment(config, plan());
    trace(config, "owner-1", "Read", "src/a.ts", T(2));
    activity(config, "owner-1", "npx coherence verify", 0, T(3), "integrity", opened.id);
    closeExperiment(config, closing(opened.id));
    const path = experimentSessionPath(config, "assessor-1");
    const raw = JSON.parse((await readFile(path, "utf8")).trim()) as Record<string, any>;
    raw.trace.events[0].observation.attribution = "unknown";
    raw.trace.attribution = "owner-session";
    raw.activity.rows[0].command.kind = "intervention";
    await writeFile(path, JSON.stringify(raw) + "\n");
    assert.throws(() => readExperiments(config), (error: unknown) => {
      assert.ok(error instanceof ExperimentLedgerError);
      assert.match(error.message, /observation has unknown scope/);
      assert.match(error.message, /not an internally consistent activity row/);
      return true;
    });
  } finally { await cleanup(root); }
});

test("wire compatibility — valid V1 ledgers remain readable and normalize empty attribution", async () => {
  const { root, config } = await project();
  try {
    const opened = {"version":1,"event":"opened","ordinal":1,"session":"owner","agent":"main","job":"-","repo":{"branch":null,"commit":null,"dirty":null},"hypothesis":"old ledger remains readable","predictedContext":["src/a.ts"],"actions":[{"id":"a1","text":"inspect"}],"criteria":[{"id":"s1","text":"reader accepts it"}],"traceCursor":0,"tracePrefix":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","activityCursor":1,"activityPrefix":"d331084238ec0004017665d730dac20603440acf388818c95f9e36dc333aa09c","activityKnownEvents":["e-f434ab0d1e1825b2"],"id":"e-ddb8f3fc9dff","at":"2026-08-04T12:00:01.000Z"};
    const closed = {"version":1,"event":"closed","experiment":"e-ddb8f3fc9dff","ownerSession":"owner","assessor":{"session":"assessor","agent":"main","job":"-"},"repo":{"branch":null,"commit":null,"dirty":null},"actionResults":[{"id":"a1","status":"followed","evidence":"inspected"}],"criterionResults":[{"id":"s1","status":"met","evidence":"accepted"}],"outcome":"success","trace":{"attribution":"owner-session","session":"owner","start":0,"end":0,"events":[]},"activity":{"attribution":"owner-session","session":"owner","start":1,"end":1,"rows":[]},"id":"x-c0b96cbb1f23","at":"2026-08-04T12:00:02.000Z"};
    const openPath = experimentSessionPath(config, "owner");
    const closePath = experimentSessionPath(config, "assessor");
    await mkdir(dirname(openPath), { recursive: true });
    await writeFile(openPath, JSON.stringify(opened) + "\n");
    await writeFile(closePath, JSON.stringify(closed) + "\n");

    const ledger = readExperiments(config);
    assert.equal(ledger.closed.length, 1);
    assert.equal(ledger.closed[0].opened.version, 1);
    assert.equal(ledger.closed[0].closed?.version, 1);
    assert.equal(ledger.closed[0].closed?.trace.attribution, "none");
    assert.equal(ledger.closed[0].closed?.activity.attribution, "none");
    assert.match(renderExperiments(config).text, /none trace 0\.\.0/);

    const fresh = createExperiment(config, plan("fresh-owner", { now: T(6) }));
    assert.equal(fresh.version, 2, "new writes advance the wire instead of changing V1 in place");
    const freshClose = closeExperiment(config, closing(fresh.id, {
      session: "fresh-assessor", now: T(7),
    }));
    assert.equal(freshClose.trace.attribution, "none");
    const freshClosePath = experimentSessionPath(config, "fresh-assessor");
    const damaged = JSON.parse((await readFile(freshClosePath, "utf8")).trim()) as Record<string, any>;
    damaged.trace.attribution = "owner-session";
    damaged.activity.attribution = "owner-session";
    await writeFile(freshClosePath, JSON.stringify(damaged) + "\n");
    assert.throws(() => readExperiments(config), /attribution must describe its weakest row scope \(none\)/,
      "V2 may not reuse the legacy owner-session spelling for an empty window");
  } finally { await cleanup(root); }
});

test("wire compatibility — V1 trace without observation stays visibly legacy-unscoped", async () => {
  const { root, config } = await project();
  try {
    const opened = {"version":1,"event":"opened","ordinal":1,"session":"owner-trace","agent":"main","job":"-","repo":{"branch":null,"commit":null,"dirty":null},"hypothesis":"legacy trace remains readable","predictedContext":["src/a.ts"],"actions":[{"id":"a1","text":"read"}],"criteria":[{"id":"s1","text":"visible"}],"traceCursor":0,"tracePrefix":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","activityCursor":0,"activityPrefix":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","activityKnownEvents":[],"id":"e-b99df711d198","at":"2026-08-04T13:00:00.000Z"};
    const closed = {"version":1,"event":"closed","experiment":"e-b99df711d198","ownerSession":"owner-trace","assessor":{"session":"assessor-trace","agent":"main","job":"-"},"repo":{"branch":null,"commit":null,"dirty":null},"actionResults":[{"id":"a1","status":"followed","evidence":"read"}],"criterionResults":[{"id":"s1","status":"met","evidence":"visible"}],"outcome":"success","trace":{"attribution":"owner-session","session":"owner-trace","start":0,"end":1,"events":[{"at":"2026-08-04T13:00:01.000Z","session":"owner-trace","tool":"Read","mode":"read","path":"src/a.ts"}]},"activity":{"attribution":"owner-session","session":"owner-trace","start":0,"end":1,"rows":[{"version":1,"at":"2026-08-04T13:00:01.500Z","host":"codex","transport":"launcher","bundleHash":"bundle-v1","session":"owner-trace","parentSession":null,"agentId":null,"attribution":"session","event":"SessionStart","turn":"turn-2","tool":null,"toolUseId":null,"eventId":"e-36d16e99ff337e0b","experimentId":null}]},"id":"x-67949d09e6ef","at":"2026-08-04T13:00:02.000Z"};
    const openPath = experimentSessionPath(config, "owner-trace");
    const closePath = experimentSessionPath(config, "assessor-trace");
    await mkdir(dirname(openPath), { recursive: true });
    await writeFile(openPath, JSON.stringify(opened) + "\n");
    await writeFile(closePath, JSON.stringify(closed) + "\n");

    const resolved = readExperiments(config).closed[0].closed!;
    assert.equal(resolved.trace.attribution, "legacy-unscoped");
    assert.equal(resolved.activity.attribution, "owner-session");
    assert.match(renderExperiments(config).text, /legacy-unscoped trace 0\.\.1/);
  } finally { await cleanup(root); }
});

test("wire compatibility — V1 keeps the opaque timestamps its released writer froze", async () => {
  const { root, config } = await project();
  try {
    const opened = {"version":1,"event":"opened","ordinal":1,"session":"owner","agent":"main","job":"-","repo":{"branch":null,"commit":null,"dirty":null},"hypothesis":"timestamp","predictedContext":["src/a.ts"],"actions":[{"id":"a1","text":"inspect"}],"criteria":[{"id":"s1","text":"readable"}],"traceCursor":0,"tracePrefix":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","activityCursor":1,"activityPrefix":"7e6e5cb0649d67a5cb86009a579da58447d82dfcba05c3f581fc6a631d40b9e6","activityKnownEvents":["e-7772df1bfb873d30"],"id":"e-3fac2a6b33ff","at":"2026-08-04T12:00:01.000Z"};
    const closed = {"version":1,"event":"closed","experiment":"e-3fac2a6b33ff","ownerSession":"owner","assessor":{"session":"assessor","agent":"main","job":"-"},"repo":{"branch":null,"commit":null,"dirty":null},"actionResults":[{"id":"a1","status":"followed","evidence":"yes"}],"criterionResults":[{"id":"s1","status":"met","evidence":"yes"}],"outcome":"success","trace":{"attribution":"owner-session","session":"owner","start":0,"end":0,"events":[]},"activity":{"attribution":"owner-session","session":"owner","start":1,"end":2,"rows":[{"version":1,"at":"not-time","host":"codex","transport":"launcher","bundleHash":"v1","session":"owner","parentSession":null,"agentId":null,"attribution":"session","event":"SessionStart","turn":"t2","tool":null,"toolUseId":null,"eventId":"e-4ec41bf0b8e18aa4","experimentId":"e-3fac2a6b33ff"}]},"id":"x-16d9cac4c267","at":"2026-08-04T12:00:03.000Z"};
    const openPath = experimentSessionPath(config, "owner");
    const closePath = experimentSessionPath(config, "assessor");
    await mkdir(dirname(openPath), { recursive: true });
    await writeFile(openPath, JSON.stringify(opened) + "\n");
    await writeFile(closePath, JSON.stringify(closed) + "\n");

    const ledger = readExperiments(config);
    assert.equal(ledger.closed.length, 1);
    assert.equal(ledger.closed[0].closed?.activity.rows[0].at, "not-time");
    assert.deepEqual(
      [experimentStats(ledger).activityRows, experimentStats(ledger).activityEvents],
      [1, 1],
      "compatibility validates in memory without rewriting frozen V1 bytes",
    );
  } finally { await cleanup(root); }
});

test("wire compatibility — close versions advance monotonically and never downgrade a V2 open", async () => {
  const { root, config } = await project();
  try {
    const opened = createExperiment(config, plan("owner-wire-order"));
    closeExperiment(config, closing(opened.id, { session: "assessor-wire-order" }));
    const closePath = experimentSessionPath(config, "assessor-wire-order");
    const close = JSON.parse((await readFile(closePath, "utf8")).trim()) as Record<string, any>;
    close.version = 1;
    const { id: _id, at: _at, ...identity } = close;
    close.id = `x-${createHash("sha256").update(stableFixture(identity)).digest("hex").slice(0, 12)}`;
    await writeFile(closePath, JSON.stringify(close) + "\n");

    assert.throws(
      () => readExperiments(config),
      /wire version 1 predates its version 2 open/,
    );
  } finally { await cleanup(root); }
});

test("wire compatibility — V1 event ids still suppress a replay that crossed plan open", async () => {
  const { root, config } = await project();
  try {
    const opened = {"version":1,"event":"opened","ordinal":1,"session":"owner-replay","agent":"main","job":"-","repo":{"branch":null,"commit":null,"dirty":null},"hypothesis":"pre-open replay is not new work","predictedContext":["src/a.ts"],"actions":[{"id":"a1","text":"observe"}],"criteria":[{"id":"s1","text":"suppressed"}],"traceCursor":0,"tracePrefix":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","activityCursor":1,"activityPrefix":"df6c05c6af4dff0a6f1f8d9718da8f7bb053ef5c7d6bb0476c7f6fc9b7ee1d9b","activityKnownEvents":["e-5a422e00db90122f"],"id":"e-83486fe6bf46","at":"2026-08-04T14:00:01.000Z"};
    const closed = {"version":1,"event":"closed","experiment":"e-83486fe6bf46","ownerSession":"owner-replay","assessor":{"session":"assessor-replay","agent":"main","job":"-"},"repo":{"branch":null,"commit":null,"dirty":null},"actionResults":[{"id":"a1","status":"followed","evidence":"observed"}],"criterionResults":[{"id":"s1","status":"met","evidence":"suppressed"}],"outcome":"success","trace":{"attribution":"owner-session","session":"owner-replay","start":0,"end":0,"events":[]},"activity":{"attribution":"owner-session","session":"owner-replay","start":1,"end":2,"rows":[{"version":1,"at":"2026-08-04T14:00:02.000Z","host":"codex","transport":"launcher","bundleHash":"bundle-v1","session":"owner-replay","parentSession":null,"agentId":null,"attribution":"session","event":"SessionStart","turn":"turn-r","tool":null,"toolUseId":null,"eventId":"e-5a422e00db90122f","experimentId":null}]},"id":"x-c77567e7ad7f","at":"2026-08-04T14:00:03.000Z"};
    const openPath = experimentSessionPath(config, "owner-replay");
    const closePath = experimentSessionPath(config, "assessor-replay");
    await mkdir(dirname(openPath), { recursive: true });
    await writeFile(openPath, JSON.stringify(opened) + "\n");
    await writeFile(closePath, JSON.stringify(closed) + "\n");

    const stats = experimentStats(readExperiments(config));
    assert.deepEqual([stats.activityRows, stats.activityEvents, stats.activityDuplicates], [1, 0, 1]);
    assert.match(renderExperiments(config).text, /1 raw row\(s\), 0 new event\(s\)/);
  } finally { await cleanup(root); }
});

test("wire compatibility — V1 still collapses the same host event across observation domains", async () => {
  const { root, config } = await project();
  try {
    const opened = createExperiment(config, plan("owner-v1-domains"));
    activity(config, "owner-v1-domains", "npx coherence verify", 0, T(2), "same-event", opened.id);
    activity(config, "owner-v1-domains", "npx coherence verify", 0, T(3), "same-event", opened.id, "direct");
    closeExperiment(config, closing(opened.id, { session: "owner-v1-domains", now: T(4) }));
    const current = readExperiments(config);
    assert.deepEqual(
      [experimentStats(current).activityRows, experimentStats(current).activityEvents],
      [2, 2],
      "V2 keeps separate launcher and direct observation domains",
    );

    const legacy = structuredClone(current);
    legacy.closed[0].opened.version = 1;
    legacy.closed[0].closed!.version = 1;
    assert.deepEqual(
      [experimentStats(legacy).activityRows, experimentStats(legacy).activityEvents,
        experimentStats(legacy).activityDuplicates],
      [2, 1, 1],
      "released V1 resolved rows solely by eventId",
    );
  } finally { await cleanup(root); }
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
