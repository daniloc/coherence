// hook-stop.test.ts — main and subagent conclusions are different delivery surfaces.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpProject, cleanup } from "./_helpers.ts";
import { loadConfig } from "../src/config.ts";
import { recordHookReads } from "../src/read-trace.ts";
import { readCalibrationSamples } from "../src/calibration.ts";
import { appendDecision, readJournal } from "../src/decisions.ts";
import { hookStatus, reportHooks } from "../src/hooks.ts";
import { createWork } from "../src/work.ts";

const HOOK_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hook-cli.ts");

function git(root: string, ...args: string[]) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

function hook(root: string, event: "SessionStart" | "Stop" | "SubagentStop", payload: object, host?: "codex") {
  return spawnSync(process.execPath, [HOOK_CLI, event], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...(host ? { COHERENCE_HOOK_HOST: host } : {}) },
  });
}

async function repo(novelty?: { minSurface: number; minLoc: number; ratio: number }): Promise<string> {
  const root = await tmpProject({
    "coherence.config.json": JSON.stringify({
      entryDir: "app", codeExt: ["ts"], language: "typescript", platform: null,
      ...(novelty ? { novelty } : {}),
    }),
    "app/app.spec.md": "# app\n\nFixture.\n\n## works when\n\n- app.ts exists at this node\n",
    "app/app.ts": "export const value = 1;\n",
  });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "add", ".");
  assert.equal(git(root, "commit", "-q", "-m", "base").status, 0);
  return root;
}

test("hooks — main Stop snapshots without feedback while SubagentStop alone restates", async () => {
  const quietRoot = await repo();
  try {
    await writeFile(join(quietRoot, "app/app.ts"), "export const value = 2;\n");
    const cfg = await loadConfig(quietRoot);
    recordHookReads(cfg, {
      session_id: "main-session", tool_name: "Write",
      tool_input: { file_path: join(quietRoot, "app/app.ts") },
    });
    recordHookReads(cfg, {
      session_id: "main-session", tool_name: "Read",
      tool_input: { file_path: join(quietRoot, "app/app.spec.md") },
    });

    const main = hook(quietRoot, "Stop", { session_id: "main-session" });
    assert.equal(main.status, 0, main.stderr);
    assert.equal(main.stdout, "", "a quiet main conclusion must not receive a second model turn");
    assert.equal(main.stderr, "");
    assert.equal(readCalibrationSamples(cfg).length, 1,
      "main Stop remains a measurement tick even when it emits no feedback");

    const samplePath = join(quietRoot, ".coherence/calibration/main-session.jsonl");
    const beforeActive = await readFile(samplePath, "utf8");
    const active = hook(quietRoot, "Stop", { session_id: "main-session", stop_hook_active: true });
    assert.equal(active.status, 0);
    assert.equal(active.stdout, "");
    assert.equal(await readFile(samplePath, "utf8"), beforeActive,
      "the feedback-loop guard runs before a duplicate calibration snapshot");

    const subagent = hook(quietRoot, "SubagentStop", { session_id: "parent", agent_id: "subagent-1" });
    assert.equal(subagent.status, 0, subagent.stderr);
    const output = JSON.parse(subagent.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, "SubagentStop");
    assert.match(output.hookSpecificOutput.additionalContext, /YOUR REPLY MUST RESTATE YOUR FINAL REPORT/);
    assert.match(output.hookSpecificOutput.additionalContext, /CHANGE SIGNAL/);
  } finally {
    await cleanup(quietRoot);
  }

  const owedRoot = await repo({ minSurface: 1, minLoc: 1, ratio: 12 });
  try {
    await writeFile(join(owedRoot, "feature.ts"), "export const feature = 1;\n");
    const owed = hook(owedRoot, "Stop", { session_id: "main-owed" });
    assert.equal(owed.status, 0, owed.stderr);
    assert.equal(owed.stdout, "",
      "another agent's shared-worktree debt cannot buy this main agent another turn");

    const active = hook(owedRoot, "Stop", { session_id: "main-owed", stopHookActive: true });
    assert.equal(active.status, 0);
    assert.equal(active.stdout, "", "the one actionable continuation cannot loop");
  } finally {
    await cleanup(owedRoot);
  }
});

test("hooks — SubagentStop counts only the exact child while open conjectures stay repo-wide", async () => {
  const root = await repo();
  try {
    const cfg = await loadConfig(root);
    appendDecision(cfg, {
      kind: "decision", chose: "child choice", because: "child evidence", session: "child-a",
    });
    appendDecision(cfg, {
      kind: "decision", chose: "parent choice", because: "parent evidence", session: "parent",
    });
    appendDecision(cfg, {
      kind: "conjecture", chose: "other session question", because: "not chased yet",
      couldBe: ["the subject changed"], discriminatedBy: "run the discriminator", session: "child-b",
    });

    const stopped = hook(root, "SubagentStop", { session_id: "parent", agent_id: "child-a" });
    assert.equal(stopped.status, 0, stopped.stderr);
    const report = JSON.parse(stopped.stdout).hookSpecificOutput.additionalContext as string;
    assert.match(report, /DECISION JOURNAL: 1 entry recorded by this child session\./);
    assert.doesNotMatch(report, /DECISION JOURNAL: 3 entries/,
      "the repository total must not masquerade as this child's journal count");
    assert.match(report, /1 OPEN CONJECTURE\(S\) in this repo/,
      "the advisory tail deliberately remains repository-wide");
  } finally { await cleanup(root); }
});

test("hooks — Codex SubagentStop without agent_id refuses parent-as-child attribution", async () => {
  const root = await repo();
  try {
    const cfg = await loadConfig(root);
    await writeFile(join(root, "app/app.ts"), "export const value = 2;\n");
    appendDecision(cfg, {
      kind: "decision", chose: "parent-owned choice", because: "parent evidence", session: "codex-parent",
    });
    // If the parent id were incorrectly treated as the child id, these two rows would
    // be enough to mint a calibration sample for the child's stop.
    recordHookReads(cfg, {
      session_id: "codex-parent", tool_name: "Write",
      tool_input: { file_path: join(root, "app/app.ts") },
    });
    recordHookReads(cfg, {
      session_id: "codex-parent", tool_name: "Read",
      tool_input: { file_path: join(root, "app/app.spec.md") },
    });

    const stopped = hook(root, "SubagentStop", { session_id: "codex-parent" }, "codex");
    assert.equal(stopped.status, 0, stopped.stderr);
    const output = JSON.parse(stopped.stdout);
    assert.equal(output.decision, "block");
    assert.match(output.reason, /child-session count unavailable/);
    assert.match(output.reason, /no exact agent_id/);
    assert.match(output.reason, /parent session id cannot identify which child/);
    assert.doesNotMatch(output.reason, /DECISION JOURNAL: 1 entry recorded/,
      "the parent's real entry must not be charged to an unidentified child");
    assert.deepEqual(readCalibrationSamples(cfg), [],
      "an unidentified child's stop cannot snapshot the parent's mixed trace");

    await writeFile(join(root, ".coherence/read-traces/codex-parent.jsonl"), "{ torn trace\n", { flag: "a" });
    const current = hookStatus(cfg, "codex", "codex-parent").observation.current!;
    assert.deepEqual(current.trace, {
      reads: 1,
      writes: 1,
      attribution: "parent-session-aggregate",
      scope: { ownerSession: 0, parentSessionAggregate: 2, unscoped: 0 },
      bundle: { exactLauncher: 0, staleLauncher: 0, direct: 2, legacy: 0 },
      unreadable: 1,
    }, "path rows retain their parent-domain ceiling, transport, and actual read damage");

    const lines: string[] = [];
    const log = console.log;
    console.log = (...values: unknown[]) => { lines.push(values.map(String).join(" ")); };
    try { reportHooks(cfg, false, "codex", "codex-parent"); }
    finally { console.log = log; }
    const status = lines.join("\n");
    assert.match(status, /repository journal history: .*durable history, not proof this host or bundle ran/);
    assert.match(status, /path trace \(session file\): 1 read · 1 write — parent-session-aggregate/);
    assert.match(status, /scope: 0 owner-session · 2 parent-session aggregate · 0 unscoped/);
    assert.match(status, /bundle: 0 exact launcher\/bundle · 0 stale\/other launcher · 2 direct · 0 legacy/);
    assert.match(status, /trace damage: 1 unreadable row\(s\) skipped/);
    assert.doesNotMatch(status, /runtime observation: OBSERVED/,
      "durable journal headers must not be promoted into current-host execution evidence");
  } finally { await cleanup(root); }
});

test("hooks — Codex gets its own subagent continuation shape and session refresh is idempotent", async () => {
  const root = await repo();
  try {
    const cfg = await loadConfig(root);
    const first = hook(root, "SessionStart", { session_id: "codex-thread", source: "startup" }, "codex");
    const compact = hook(root, "SessionStart", { session_id: "codex-thread", source: "compact" }, "codex");
    assert.equal(first.status, 0, first.stderr);
    assert.equal(compact.status, 0, compact.stderr);
    assert.equal(readJournal(cfg).records.filter((row) => row.kind === "session" && row.session === "codex-thread").length, 1,
      "resume/compact re-inject context without minting another logical session");

    const subagent = hook(root, "SubagentStop", {
      session_id: "codex-thread", agent_id: "codex-child", stop_hook_active: false,
    }, "codex");
    assert.equal(subagent.status, 0, subagent.stderr);
    const output = JSON.parse(subagent.stdout);
    assert.equal(output.decision, "block");
    assert.match(output.reason, /YOUR REPLY MUST RESTATE YOUR FINAL REPORT/);
    assert.equal(output.hookSpecificOutput, undefined,
      "Codex does not consume Claude's SubagentStop additionalContext shape");

    const repeated = hook(root, "SubagentStop", {
      session_id: "codex-thread", agent_id: "codex-child", stop_hook_active: true,
    }, "codex");
    assert.equal(repeated.status, 0);
    assert.equal(repeated.stdout, "", "the continued child gets only one final turn");
  } finally { await cleanup(root); }
});

test("SessionStart injects only the exact session's current work order", async () => {
  const root = await repo();
  try {
    const config = await loadConfig(root);
    const assigned = createWork(config, {
      session: "orchestrator",
      owner: { session: "codex-thread", agent: "worker" },
      objective: "repair the lifecycle import closure",
      criteria: ["PostToolUse runs without parser packages"],
      authority: { kind: "user-directed", grantedBy: "user", boundary: "build the complete gyroscope" },
      risk: "high",
      writeScopes: ["src/hooks.ts"],
      now: "2026-01-01T00:00:00.000Z",
    });
    createWork(config, {
      session: "orchestrator",
      owner: { session: "other-thread", agent: "worker" },
      objective: "unrelated assignment",
      criteria: ["done"],
      authority: { kind: "orchestrator-delegated", grantedBy: "main", boundary: "other task" },
      risk: "low",
      writeScopes: ["elsewhere.ts"],
      now: "2026-01-01T00:00:01.000Z",
    });

    const started = hook(root, "SessionStart", { session_id: "codex-thread", source: "startup" }, "codex");
    assert.equal(started.status, 0, started.stderr);
    const text = JSON.parse(started.stdout).hookSpecificOutput.additionalContext as string;
    assert.match(text, /CURRENT WORK — exact assignments for this session/);
    assert.match(text, /repair the lifecycle import closure/);
    assert.match(text, /PostToolUse runs without parser packages/);
    assert.doesNotMatch(text, /unrelated assignment/);
    assert.match(text, new RegExp(`work inspect "${assigned.work}"`));
    assert.doesNotMatch(text, /work inspect --session/,
      "the injected re-read command must be accepted by the fleet-wide inspect CLI");
  } finally { await cleanup(root); }
});

test("SessionStart degrades around a damaged journal path without killing the session", async () => {
  const root = await repo();
  try {
    await mkdir(join(root, ".coherence"), { recursive: true });
    const hostileJournal = join(root, ".coherence", "decisions");
    await writeFile(hostileJournal, "this regular file blocks the journal directory\n");
    const started = hook(root, "SessionStart", { session_id: "codex-damaged", source: "startup" }, "codex");
    assert.equal(started.status, 0, started.stderr);
    assert.equal(started.stderr, "");
    const text = JSON.parse(started.stdout).hookSpecificOutput.additionalContext as string;
    assert.match(text, /YOUR SESSION ID IS codex-damaged/);
    assert.match(text, /JOURNAL CONTROL unavailable:/);
    assert.match(await readFile(hostileJournal, "utf8"), /regular file blocks/);
  } finally { await cleanup(root); }
});
