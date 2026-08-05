// activity.test.ts — hook telemetry stays attributable, narrow, and non-authoritative.
import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import {
  activityAttribution, activityPath, activityRow, classifyActivityCommand,
  currentSessionSummary, readActivity, recordActivity, type ActivityContext,
} from "../src/activity.ts";
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

test("activity — PostToolUse without agent_id names its parent fallback", () => {
  assert.deepEqual(activityAttribution("PostToolUse", { session_id: "parent-thread" }), {
    session: "parent-thread", parentSession: "parent-thread", agentId: null,
    attribution: "parent-fallback",
  });
  assert.deepEqual(activityAttribution("Stop", { session_id: "main-thread" }), {
    session: "main-thread", parentSession: null, agentId: null, attribution: "session",
  });
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
  } finally { await cleanup(root); }
});

test("hook status — the last replay result wins and unreadable activity stays loud", async () => {
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
    appendFileSync(activityPath(c, "agent-a"), "{ half a row\n");

    const current = hookStatus(c, "codex", "agent-a").observation.current!;
    assert.deepEqual(current.verification, { total: 1, success: 1, failure: 0, unknown: 0 },
      "the structured result on a replay replaces the earlier unknown result");
    assert.equal(current.unreadableActivity, 1,
      "status must not promote a damaged activity file into exact-looking evidence");
  } finally { await cleanup(root); }
});
