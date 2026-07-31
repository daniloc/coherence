// calibration.test.ts — empirical calibration remains narrow, deterministic, and honest.
import test from "node:test";
import assert from "node:assert/strict";
import {
  hookReadCandidates, recordHookReads, readTrace, predictedReadSet,
  calibrationPaths, calibrationStats, formatCalibration, type CalibrationSample,
} from "../src/calibration.ts";
import { cfg, graph, fileNode, imp, tmpProject, cleanup } from "./_helpers.ts";

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
    { at: "t", session: "agent-abc", tool: "Read", mode: "read", path: "src/context.ts" },
    { at: "t", session: "agent-abc", tool: "Edit", mode: "write", path: "src/signal.ts" },
  ], ["src/signal.ts", "src/someone-elses-change.ts"]);
  assert.deepEqual(traced, {
    changed: ["src/signal.ts"], observed: ["src/context.ts"], attribution: "session-writes",
  });
  assert.equal(calibrationPaths(traced.observed.map((path) => ({
    at: "t", session: "agent-abc", tool: "Read", mode: "read" as const, path,
  })), ["src/shared.ts"]).attribution, "worktree-union");
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
  assert.match(formatCalibration([]).join("\n"), /no samples yet/);
  assert.match(formatCalibration([sample("1", "defect", ["a.ts"])]).join("\n"), /lower bound/);
});
