// calibration.test.ts — empirical calibration remains narrow, deterministic, and honest.
import test from "node:test";
import assert from "node:assert/strict";
import {
  hookReadCandidates, recordHookReads, readTrace, readTraceDetailed, predictedReadSet,
  calibrationPaths, calibrationStats, formatCalibration, readCalibrationSamples, recordCalibrationSample,
  type CalibrationSample,
} from "../src/calibration.ts";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cfg, graph, fileNode, imp, tmpProject, cleanup } from "./_helpers.ts";

const exactObservation = {
  version: 1 as const,
  host: "claude" as const,
  transport: "launcher" as const,
  bundleHash: "bundle-1",
  parentSession: "parent",
  agentId: "agent-abc",
  attribution: "agent" as const,
  eventId: null,
};

test("hook payload extraction reads path fields but never guesses from command text", () => {
  const got = hookReadCandidates({
    session_id: "s-abc", tool_name: "Read",
    tool_input: { file_path: "src/a.ts", command: "cat secrets.txt", paths: ["src/b.ts"] },
  });
  assert.deepEqual(got, { session: "s-abc", tool: "Read", mode: "read", paths: ["src/a.ts", "src/b.ts"] });
});

test("write-bearing hooks provide per-session patch attribution", () => {
  const got = hookReadCandidates({
    session_id: "parent", agent_id: "agent-abc", tool_name: "Edit", tool_input: { file_path: "src/a.ts" },
  });
  assert.deepEqual(got, { session: "agent-abc", tool: "Edit", mode: "write", paths: ["src/a.ts"] });
});

test("calibration uses session writes instead of a concurrent shared-worktree union", () => {
  const traced = calibrationPaths([
    { at: "t", session: "agent-abc", tool: "Read", mode: "read", path: "src/context.ts", observation: exactObservation },
    { at: "t", session: "agent-abc", tool: "Edit", mode: "write", path: "src/signal.ts", observation: exactObservation },
  ], ["src/signal.ts", "src/someone-elses-change.ts"]);
  assert.deepEqual(traced, {
    changed: ["src/signal.ts"], observed: ["src/context.ts"], attribution: "session-writes",
  });
  assert.equal(calibrationPaths(traced.observed.map((path) => ({
    at: "t", session: "agent-abc", tool: "Read", mode: "read" as const, path,
  })), ["src/shared.ts"]).attribution, "worktree-union");

  assert.deepEqual(calibrationPaths([
    { at: "t", session: "agent-abc", tool: "apply_patch", mode: "write", path: "src/failed.ts", observation: exactObservation },
  ], ["src/someone-elses-change.ts"]), {
    changed: [], observed: [], attribution: "session-writes",
  }, "a failed/no-op attributed write must not fall back to another agent's worktree union");
});

test("calibration keeps Codex parent-only writes aggregate and legacy rows unscoped", () => {
  const parent = {
    ...exactObservation,
    host: "codex" as const,
    parentSession: "codex-thread",
    agentId: null,
    attribution: "parent-fallback" as const,
  };
  assert.deepEqual(calibrationPaths([
    { at: "t", session: "codex-thread", tool: "Read", mode: "read", path: "src/context.ts", observation: parent },
    { at: "t", session: "codex-thread", tool: "apply_patch", mode: "write", path: "src/signal.ts", observation: parent },
  ], ["src/signal.ts", "src/someone-elses-change.ts"]), {
    changed: ["src/signal.ts"], observed: ["src/context.ts"], attribution: "parent-session-aggregate",
  });
  assert.equal(calibrationPaths([
    { at: "t", session: "legacy", tool: "Edit", mode: "write", path: "src/signal.ts" },
    { at: "t", session: "legacy", tool: "Read", mode: "read", path: "src/context.ts" },
  ], ["src/signal.ts"]).attribution, "legacy-unscoped");
});

test("hook recording keeps only real files inside the repo", async () => {
  const root = await tmpProject({ "src/a.ts": "export const a = 1;\n" });
  try {
    const c = cfg(root);
    const events = recordHookReads(c, {
      session_id: "s-abc", tool_name: "Read",
      tool_input: { file_path: `${root}/src/a.ts`, paths: ["missing.ts", "/etc/passwd"] },
    }, "2026-01-01T00:00:00Z");
    assert.deepEqual(events.map((e) => e.path), ["src/a.ts"]);
    assert.deepEqual(readTrace(c, "s-abc").map((e) => e.path), ["src/a.ts"]);
  } finally { await cleanup(root); }
});

test("trace files keep sanitization-colliding session ids isolated", async () => {
  const root = await tmpProject({ "src/a.ts": "a\n", "src/b.ts": "b\n" });
  try {
    const c = cfg(root);
    recordHookReads(c, {
      session_id: "parent", agent_id: "a/b", tool_name: "Read", tool_input: { file_path: "src/a.ts" },
    });
    recordHookReads(c, {
      session_id: "parent", agent_id: "a?b", tool_name: "Read", tool_input: { file_path: "src/b.ts" },
    });
    assert.equal(readTraceDetailed(c, "a/b").unreadable, 0);
    assert.deepEqual(readTrace(c, "a/b").map((row) => row.path), ["src/a.ts"]);
    assert.deepEqual(readTrace(c, "a?b").map((row) => row.path), ["src/b.ts"]);
  } finally { await cleanup(root); }
});

test("calibration refuses a damaged trace instead of minting a smaller sample", async () => {
  const root = await tmpProject({ "src/a.ts": "export const a = 1;\n" });
  try {
    const c = cfg(root);
    recordHookReads(c, {
      session_id: "parent", agent_id: "agent-damage", tool_name: "Read",
      tool_input: { file_path: "src/a.ts" },
    });
    appendFileSync(join(root, ".coherence", "read-traces", "agent-damage.jsonl"), "{ torn\n");
    const sample = await recordCalibrationSample(c, "agent-damage", "unknown", graph([fileNode("src/a.ts", ".")]));
    assert.equal(sample, null);
    assert.equal(existsSync(join(root, ".coherence", "calibration")), false);
  } finally { await cleanup(root); }
});

test("predicted set is touched files plus import neighbours in both directions", () => {
  const g = graph([fileNode("a.ts", "."), fileNode("b.ts", "."), fileNode("c.ts", ".")], [
    imp("a.ts", "b.ts"), imp("c.ts", "a.ts"),
  ]);
  assert.deepEqual([...predictedReadSet(g, ["a.ts"])].sort(), ["a.ts", "b.ts", "c.ts"]);
});

const sample = (id: string, outcome: CalibrationSample["outcome"], observed: string[]): CalibrationSample => ({
  id, at: id, session: "s", patch: id, changed: ["a.ts"],
  predicted: ["a.ts", "b.ts"], observed, outcome, attribution: "session-writes",
});

test("calibration reports coverage, outside reads, and defect rates by prediction misses", () => {
  const stats = calibrationStats([
    sample("1", "defect", ["a.ts", "outside.ts"]),
    sample("2", "clean", ["a.ts", "b.ts"]),
    sample("3", "unknown", ["a.ts"]),
  ]);
  assert.equal(stats.samples, 3);
  assert.equal(stats.labeled, 2);
  assert.equal(stats.defects, 1);
  assert.equal(stats.defectRateWithMisses, 1);
  assert.equal(stats.defectRateWithoutMisses, 0);
  assert.deepEqual([stats.sharedWorktreeSamples, stats.parentAggregateSamples, stats.legacyUnscopedSamples], [0, 0, 0]);
  assert.match(formatCalibration([]).join("\n"), /no samples yet/);
  assert.match(formatCalibration([sample("1", "defect", ["a.ts"])]).join("\n"), /lower bound/);
});

test("calibration — a recurring unknown snapshot never erases an explicit outcome", async () => {
  const root = await tmpProject();
  try {
    const c = cfg(root);
    const dir = join(root, ".coherence", "calibration");
    mkdirSync(dir, { recursive: true });
    const labeled = sample("same-patch", "defect", ["a.ts"]);
    const tick = { ...labeled, at: "later", outcome: "unknown" as const };
    appendFileSync(join(dir, "s.jsonl"), `${JSON.stringify(labeled)}\n${JSON.stringify(tick)}\n`);
    assert.equal(readCalibrationSamples(c)[0]?.outcome, "defect");

    const relabeled = { ...labeled, at: "latest", outcome: "clean" as const };
    appendFileSync(join(dir, "s.jsonl"), `${JSON.stringify(relabeled)}\n`);
    assert.equal(readCalibrationSamples(c)[0]?.outcome, "clean",
      "a later explicit assessment still supersedes the prior one");
  } finally { await cleanup(root); }
});

test("hook payload extraction accepts only formal Codex apply_patch headers as writes", async () => {
  const root = await tmpProject({
    "src/added.ts": "added\n",
    "src/updated.ts": "updated\n",
    "src/moved.ts": "moved\n",
  });
  try {
    const c = cfg(root);
    const command = [
      "*** Begin Patch",
      "*** Add File: src/added.ts",
      "+added",
      "*** Update File: src/updated.ts",
      "@@",
      "-before",
      "+after",
      "*** Update File: src/old-name.ts",
      "*** Move to: src/moved.ts",
      "@@",
      "-old",
      "+moved",
      "*** Delete File: src/deleted.ts",
      "*** End Patch",
    ].join("\n");
    assert.deepEqual(hookReadCandidates({
      session_id: "parent", agent_id: "agent-patch", tool_name: "apply_patch",
      tool_input: { command },
    }), {
      session: "agent-patch", tool: "apply_patch", mode: "write",
      paths: ["src/added.ts", "src/updated.ts", "src/old-name.ts", "src/moved.ts", "src/deleted.ts"],
    });

    const events = recordHookReads(c, {
      session_id: "parent", agent_id: "agent-patch", tool_name: "apply_patch",
      tool_input: { command },
    }, "2026-08-04T00:00:00Z");
    assert.deepEqual(events.map((event) => [event.path, event.provenance?.operation]), [
      ["src/added.ts", "add"],
      ["src/updated.ts", "update"],
      ["src/old-name.ts", "update"],
      ["src/moved.ts", "move"],
      ["src/deleted.ts", "delete"],
    ], "formal write headers preserve paths even when a delete or move-source no longer exists");
    assert.deepEqual(readTrace(c, "agent-patch").map((event) => event.provenance?.source),
      ["apply_patch", "apply_patch", "apply_patch", "apply_patch", "apply_patch"]);
  } finally { await cleanup(root); }
});

test("hook payload extraction never promotes Bash patch-shaped mentions into file reads or writes", async () => {
  const root = await tmpProject({ "src/real.ts": "real\n" });
  try {
    const c = cfg(root);
    const patchMention = "*** Begin Patch\n*** Update File: src/real.ts\n*** End Patch";
    assert.deepEqual(hookReadCandidates({
      session_id: "s-bash", tool_name: "Bash", tool_input: { command: patchMention },
    }), { session: "s-bash", tool: "Bash", mode: "read", paths: [] });
    assert.deepEqual(recordHookReads(c, {
      session_id: "s-bash", tool_name: "Bash", tool_input: { command: patchMention },
    }), []);

    assert.deepEqual(hookReadCandidates({
      session_id: "s-patch", tool_name: "apply_patch",
      tool_input: { command: "echo '*** Update File: src/real.ts'" },
    }), { session: "s-patch", tool: "apply_patch", mode: "write", paths: [] },
    "apply_patch text without the formal envelope is not evidence either");
  } finally { await cleanup(root); }
});
