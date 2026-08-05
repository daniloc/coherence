// activity.test.ts — hook telemetry stays attributable, narrow, and non-authoritative.
import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  activityAttribution, activityPath, activityRow, classifyActivityCommand,
  currentSessionSummary, readActivity, recordActivity, type ActivityContext,
} from "../src/activity.ts";
import { recordHookReads } from "../src/read-trace.ts";
import { hookStatus } from "../src/hooks.ts";
import { CODEX_LIFECYCLE_HOOK_BUNDLE_FINGERPRINT } from "../src/control.ts";
import { cfg, cleanup, tmpProject } from "./_helpers.ts";

const launcher: ActivityContext = {
  host: "codex", transport: "launcher", bundleHash: "sha256:canonical", experimentId: "plan/v1",
};

test("activity — host metadata and exact agent attribution survive one row", () => {
  const row = activityRow("PostToolUse", {
    session_id: "parent-thread", agent_id: "agent-7", turn_id: "turn-2",
    tool_use_id: "call-9", tool_name: "update_plan", tool_input: { plan: [] },
  }, launcher, "2026-08-04T12:00:00.000Z");
  assert.deepEqual({
    host: row.host, transport: row.transport, bundleHash: row.bundleHash,
    session: row.session, parentSession: row.parentSession, agentId: row.agentId,
    attribution: row.attribution, event: row.event, turn: row.turn, tool: row.tool,
    toolUseId: row.toolUseId, experimentId: row.experimentId,
  }, {
    host: "codex", transport: "launcher", bundleHash: "sha256:canonical",
    session: "agent-7", parentSession: "parent-thread", agentId: "agent-7",
    attribution: "agent", event: "PostToolUse", turn: "turn-2", tool: "update_plan",
    toolUseId: "call-9", experimentId: "plan/v1",
  });
  assert.match(row.eventId ?? "", /^e-[0-9a-f]{16}$/);
});

test("activity — child-capable events without agent_id name their parent fallback", () => {
  assert.deepEqual(activityAttribution("PostToolUse", { session_id: "parent-thread" }), {
    session: "parent-thread", parentSession: "parent-thread", agentId: null,
    attribution: "parent-fallback",
  });
  assert.deepEqual(activityAttribution("Stop", { session_id: "main-thread" }), {
    session: "main-thread", parentSession: null, agentId: null, attribution: "session",
  });
  assert.deepEqual(activityAttribution("SubagentStop", { session_id: "parent-thread" }), {
    session: "parent-thread", parentSession: "parent-thread", agentId: null,
    attribution: "parent-fallback",
  }, "an omitted child id cannot turn the parent's id into exact child evidence");
  assert.deepEqual(activityAttribution("PostToolUse", {}), {
    session: "unknown", parentSession: null, agentId: null, attribution: "unknown",
  });
});

test("activity — verification and intervention recognize only bare exact Bash shapes", () => {
  const verification = classifyActivityCommand({
    tool_name: "Bash", tool_input: { command: "npx coherence verify --fast" },
    tool_response: { exit_code: 0 },
  });
  assert.deepEqual(verification, {
    kind: "verification", name: "verify", command: "npx coherence verify --fast",
    result: "success", exitCode: 0,
  });
  assert.deepEqual(classifyActivityCommand({
    tool_name: "Bash", tool_input: { command: "node ./src/cli.ts regulate --check" },
    tool_response: { exitCode: 1 },
  }), {
    kind: "intervention", name: "regulate", command: "node ./src/cli.ts regulate --check",
    result: "failure", exitCode: 1,
  });
  assert.equal(classifyActivityCommand({
    tool_name: "Bash", tool_input: { command: "coherence verify" }, tool_response: "completed",
  })?.result, "unknown", "model-facing prose is not an exit status");

  for (const command of [
    "printf 'npx coherence verify'", "npx coherence verify && echo done",
    "npx coherence verify | tee report", "npx coherence regulate; npx coherence verify",
    "echo npx coherence regulate", " npx coherence verify", "npx coherence verify\n",
  ]) {
    assert.equal(classifyActivityCommand({
      tool_name: "Bash", tool_input: { command }, tool_response: { exit_code: 0 },
    }), undefined, `must not treat shell text as execution: ${JSON.stringify(command)}`);
  }
  assert.equal(classifyActivityCommand({
    tool_name: "apply_patch", tool_input: { command: "npx coherence verify" },
    tool_response: { exit_code: 0 },
  }), undefined, "the exact command grammar is still confined to Bash");
});

test("activity — per-session reads isolate agents, count damage, and keep direct probes non-authoritative", async () => {
  const root = await tmpProject();
  try {
    const c = cfg(root);
    const payload = {
      session_id: "parent", agent_id: "agent-a", turn_id: "turn-a", tool_use_id: "verify-1",
      tool_name: "Bash", tool_input: { command: "coherence verify" }, tool_response: { exit_code: 0 },
    };
    recordActivity(c, "PostToolUse", payload, launcher, "2026-08-04T12:00:00.000Z");
    // Exact replay: raw evidence remains append-only, summary counts it once.
    recordActivity(c, "PostToolUse", payload, launcher, "2026-08-04T12:00:01.000Z");
    recordActivity(c, "PostToolUse", {
      ...payload, turn_id: "turn-b", tool_use_id: "regulate-1",
      tool_input: { command: "coherence regulate" }, tool_response: { exit_code: 2 },
    }, { ...launcher, transport: "direct" }, "2026-08-04T12:00:02.000Z");
    recordActivity(c, "SessionStart", { session_id: "someone-else" }, launcher,
      "2026-08-04T12:00:03.000Z");
    appendFileSync(activityPath(c, "agent-a"), "{ half a row\n");

    const read = readActivity(c, "agent-a");
    assert.equal(read.rows.length, 3);
    assert.equal(read.unreadable, 1);
    assert.equal(readActivity(c, "someone-else").rows.length, 1);

    const summary = currentSessionSummary(c, "agent-a");
    assert.equal(summary.all.rawRows, 3);
    assert.equal(summary.all.rows, 2);
    assert.equal(summary.all.duplicates, 1);
    assert.deepEqual(summary.all.verification, { total: 1, success: 1, failure: 0, unknown: 0 });
    assert.deepEqual(summary.all.intervention, { total: 1, success: 0, failure: 1, unknown: 0 });
    assert.equal(summary.launcher.rawRows, 2);
    assert.equal(summary.launcher.rows, 1, "replayed launcher evidence counts once");
    assert.deepEqual(summary.launcher.intervention, { total: 0, success: 0, failure: 0, unknown: 0 },
      "a direct/manual invocation cannot become installed-hook execution evidence");
    assert.equal(summary.latest?.transport, "direct");
    assert.equal(summary.latestLauncher?.transport, "launcher");
    assert.equal(summary.unreadable, 1);
  } finally { await cleanup(root); }
});

test("activity — unknown sessions are a named empty read, never a latest-session guess", async () => {
  const root = await tmpProject();
  try {
    const c = cfg(root);
    recordActivity(c, "SessionStart", { session_id: "real" }, launcher);
    recordActivity(c, "SessionStart", {}, {
      ...launcher, bundleHash: CODEX_LIFECYCLE_HOOK_BUNDLE_FINGERPRINT,
    });
    assert.deepEqual(currentSessionSummary(c, "missing"), {
      session: "missing", unreadable: 0,
      all: {
        rows: 0, rawRows: 0, duplicates: 0, events: {}, tools: {},
        verification: { total: 0, success: 0, failure: 0, unknown: 0 },
        intervention: { total: 0, success: 0, failure: 0, unknown: 0 },
      },
      launcher: {
        rows: 0, rawRows: 0, duplicates: 0, events: {}, tools: {},
        verification: { total: 0, success: 0, failure: 0, unknown: 0 },
        intervention: { total: 0, success: 0, failure: 0, unknown: 0 },
      },
      latest: null, latestLauncher: null,
    });
    const unknown = hookStatus(c, "codex", "unknown").observation.current!;
    assert.equal(unknown.state, "unobserved");
    assert.equal(unknown.exactLauncherEvents, 0,
      "the fallback sentinel can never satisfy exact-session activation");
  } finally { await cleanup(root); }
});

test("activity — internally inconsistent scope, time, and command rows are damage, not evidence", async () => {
  const root = await tmpProject();
  try {
    const c = cfg(root);
    const valid = recordActivity(c, "PostToolUse", {
      session_id: "parent", agent_id: "agent-a", tool_use_id: "verify-integrity",
      tool_name: "Bash", tool_input: { command: "coherence verify" },
      tool_response: { exit_code: 0 },
    }, launcher, "2026-08-04T12:00:00.000Z");
    const broken = [
      { ...valid, agentId: "someone-else" },
      { ...valid, at: "not-a-time" },
      { ...valid, command: { ...valid.command!, kind: "intervention" } },
      { ...valid, command: { ...valid.command!, result: "failure" } },
    ];
    appendFileSync(activityPath(c, "agent-a"), broken.map((row) => JSON.stringify(row)).join("\n") + "\n");
    const read = readActivity(c, "agent-a");
    assert.deepEqual(read.rows, [valid]);
    assert.equal(read.unreadable, 4);
  } finally { await cleanup(root); }
});

test("hook status — exact current bundle activates; stale, direct, replayed, and damaged evidence does not", async () => {
  const root = await tmpProject();
  try {
    const c = cfg(root);
    const payload = {
      session_id: "parent", agent_id: "agent-a", tool_use_id: "verify-replay",
      tool_name: "Bash", tool_input: { command: "coherence verify" },
    };
    const context: ActivityContext = {
      host: "codex", transport: "launcher",
      bundleHash: CODEX_LIFECYCLE_HOOK_BUNDLE_FINGERPRINT,
      experimentId: null,
    };
    recordActivity(c, "PostToolUse", { ...payload, tool_response: {} }, context, "2026-08-04T12:00:00.000Z");
    recordActivity(c, "PostToolUse", { ...payload, tool_response: { exit_code: 0 } }, context, "2026-08-04T12:00:01.000Z");
    recordActivity(c, "PostToolUse", { ...payload, tool_response: { exit_code: 0 } },
      { ...context, bundleHash: "an-older-bundle" }, "2026-08-04T12:00:01.100Z");
    recordActivity(c, "PostToolUse", { ...payload, tool_response: { exit_code: 0 } },
      { ...context, transport: "direct" }, "2026-08-04T12:00:01.200Z");
    recordActivity(c, "SessionStart", { session_id: "stale-only" },
      { ...context, bundleHash: "an-older-bundle" }, "2026-08-04T12:00:02.000Z");
    recordActivity(c, "SessionStart", { session_id: "direct-only" },
      { ...context, transport: "direct" }, "2026-08-04T12:00:03.000Z");
    appendFileSync(activityPath(c, "agent-a"), "{ half a row\n");

    const current = hookStatus(c, "codex", "agent-a").observation.current!;
    assert.equal(current.state, "observed");
    assert.deepEqual([current.exactLauncherEvents, current.staleLauncherEvents, current.directEvents], [1, 1, 1],
      "same-domain replay collapses, but stale/direct delivery of the same host event stays visible");
    assert.deepEqual(current.verification, { total: 1, success: 1, failure: 0, unknown: 0 },
      "the structured result on a replay replaces the earlier unknown result");
    assert.equal(current.unreadableActivity, 1,
      "status must not promote a damaged activity file into exact-looking evidence");
    const stale = hookStatus(c, "codex", "stale-only").observation.current!;
    assert.equal(stale.state, "stale");
    assert.deepEqual([stale.exactLauncherEvents, stale.staleLauncherEvents, stale.directEvents], [0, 1, 0]);
    const direct = hookStatus(c, "codex", "direct-only").observation.current!;
    assert.equal(direct.state, "unobserved");
    assert.deepEqual([direct.exactLauncherEvents, direct.staleLauncherEvents, direct.directEvents], [0, 0, 1]);
  } finally { await cleanup(root); }
});

test("hook status — trace scope, bundle provenance, legacy rows, and damage stay distinct", async () => {
  const root = await tmpProject({
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 2;\n",
    "src/c.ts": "export const c = 3;\n",
  });
  const prior = {
    host: process.env.COHERENCE_HOOK_HOST,
    transport: process.env.COHERENCE_HOOK_TRANSPORT,
    bundle: process.env.COHERENCE_HOOK_BUNDLE_FINGERPRINT,
  };
  try {
    const c = cfg(root);
    process.env.COHERENCE_HOOK_HOST = "codex";
    process.env.COHERENCE_HOOK_TRANSPORT = "launcher";
    process.env.COHERENCE_HOOK_BUNDLE_FINGERPRINT = CODEX_LIFECYCLE_HOOK_BUNDLE_FINGERPRINT;
    recordHookReads(c, {
      session_id: "thread-trace", tool_name: "Read", tool_use_id: "exact",
      tool_input: { file_path: "src/a.ts" },
    });
    process.env.COHERENCE_HOOK_BUNDLE_FINGERPRINT = "older-bundle";
    recordHookReads(c, {
      session_id: "thread-trace", tool_name: "Read", tool_use_id: "stale",
      tool_input: { file_path: "src/b.ts" },
    });
    delete process.env.COHERENCE_HOOK_HOST;
    delete process.env.COHERENCE_HOOK_TRANSPORT;
    delete process.env.COHERENCE_HOOK_BUNDLE_FINGERPRINT;
    recordHookReads(c, {
      session_id: "parent", agent_id: "thread-trace", tool_name: "Read", tool_use_id: "direct",
      tool_input: { file_path: "src/c.ts" },
    });
    const tracePath = join(root, ".coherence", "read-traces", "thread-trace.jsonl");
    appendFileSync(tracePath, `${JSON.stringify({
      at: "2026-08-04T12:00:04.000Z", session: "thread-trace", tool: "Read",
      mode: "read", path: "src/a.ts",
    })}\n{ half a row\n`);

    const trace = hookStatus(c, "codex", "thread-trace").observation.current!.trace;
    assert.deepEqual(trace.scope, { ownerSession: 1, parentSessionAggregate: 2, unscoped: 1 });
    assert.equal(trace.attribution, "unscoped", "weakest row scope owns the aggregate label");
    assert.deepEqual(trace.bundle, { exactLauncher: 1, staleLauncher: 1, direct: 1, legacy: 1 });
    assert.equal(trace.unreadable, 1);
  } finally {
    const restore = (key: "COHERENCE_HOOK_HOST" | "COHERENCE_HOOK_TRANSPORT" | "COHERENCE_HOOK_BUNDLE_FINGERPRINT", value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("COHERENCE_HOOK_HOST", prior.host);
    restore("COHERENCE_HOOK_TRANSPORT", prior.transport);
    restore("COHERENCE_HOOK_BUNDLE_FINGERPRINT", prior.bundle);
    await cleanup(root);
  }
});
