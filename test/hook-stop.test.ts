// hook-stop.test.ts — main and subagent conclusions are different delivery surfaces.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpProject, cleanup } from "./_helpers.ts";
import { loadConfig } from "../src/config.ts";
import { recordHookReads } from "../src/read-trace.ts";
import { readCalibrationSamples } from "../src/calibration.ts";

const HOOK_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hook-cli.ts");

function git(root: string, ...args: string[]) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

function hook(root: string, event: "Stop" | "SubagentStop", payload: object) {
  return spawnSync(process.execPath, [HOOK_CLI, event], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
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
