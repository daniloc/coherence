// hooks-cli.test.ts — the host selector is a public control boundary, not an internal API.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tmpProject } from "./_helpers.ts";

const exec = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");
const SOURCE_ROOT = join(dirname(CLI));

function hostEnv(codexThread?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.COHERENCE_SESSION;
  delete env.COHERENCE_AGENT;
  delete env.COHERENCE_JOB;
  delete env.CODEX_THREAD_ID;
  if (codexThread) env.CODEX_THREAD_ID = codexThread;
  return env;
}

async function run(root: string, args: string[], env = hostEnv()): Promise<{
  code: number; stdout: string; stderr: string;
}> {
  return exec(process.execPath, [CLI, ...args], { cwd: root, env })
    .then((result) => ({ code: 0, stdout: result.stdout, stderr: result.stderr }))
    .catch((error: { code: number; stdout: string; stderr: string }) => ({
      code: error.code, stdout: error.stdout, stderr: error.stderr,
    }));
}

async function installTarget(root: string): Promise<void> {
  const path = join(root, "node_modules", ".bin", "coherence-hook");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "#!/bin/sh\nexit 0\n");
  await chmod(path, 0o755);
}

test("hooks CLI — explicit Codex dispatch is isolated and the bare command stays Claude", async () => {
  const root = await tmpProject();
  try {
    await installTarget(root);

    const bare = await run(root, ["hooks", "install"], hostEnv("ambient-codex-thread"));
    assert.equal(bare.code, 0, bare.stderr);
    assert.equal(existsSync(join(root, ".claude", "settings.json")), true);
    assert.equal(existsSync(join(root, ".codex", "hooks.json")), false,
      "CODEX_THREAD_ID must not silently retarget the legacy control command");
    const claudeBytes = await readFile(join(root, ".claude", "settings.json"), "utf8");

    const defaultStatus = await run(root, ["hooks", "status", "--json"], hostEnv("ambient-codex-thread"));
    assert.equal(defaultStatus.code, 0, defaultStatus.stderr);
    const defaultJson = JSON.parse(defaultStatus.stdout);
    assert.equal(defaultJson.host, "claude");
    assert.equal(defaultJson.observation.current, null,
      "a Codex environment variable does not supply a session to the default Claude host");

    const installed = await run(root, ["hooks", "install", "--host", "codex", "--json"]);
    assert.equal(installed.code, 0, installed.stderr);
    const installedJson = JSON.parse(installed.stdout);
    assert.equal(installedJson.host, "codex");
    assert.equal(installedJson.control.present, true);
    assert.equal(await readFile(join(root, ".claude", "settings.json"), "utf8"), claudeBytes,
      "installing Codex does not rewrite Claude's independent control");

    const scoped = await run(root, [
      "hooks", "status", "--host", "codex", "--session", "chosen-session", "--json",
    ]);
    assert.equal(scoped.code, 0, scoped.stderr);
    const scopedJson = JSON.parse(scoped.stdout);
    assert.equal(scopedJson.host, "codex");
    assert.equal(scopedJson.observation.current.session, "chosen-session");

    const checked = await run(root, ["hooks", "--check", "--host", "codex", "--json"]);
    assert.equal(checked.code, 0, checked.stderr);
    assert.equal(JSON.parse(checked.stdout).control.present, true);

    const printed = await run(root, ["hooks", "print", "--host", "codex"]);
    assert.equal(printed.code, 0, printed.stderr);
    assert.match(printed.stdout, /Canonical codex control/);
    assert.match(printed.stdout, /Bash\|apply_patch\|update_plan\|mcp__/);

    const removed = await run(root, ["hooks", "uninstall", "--host", "codex", "--json"]);
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(JSON.parse(removed.stdout).control.present, false);
    const claudeCheck = await run(root, ["hooks", "--check", "--json"], hostEnv("ambient-codex-thread"));
    assert.equal(claudeCheck.code, 0, claudeCheck.stderr);
    assert.equal(JSON.parse(claudeCheck.stdout).host, "claude");
  } finally {
    await cleanup(root);
  }
});

test("hooks CLI — malformed host and session selectors refuse before mutation", async () => {
  const root = await tmpProject();
  try {
    await installTarget(root);
    const cases: Array<{ args: string[]; error: RegExp }> = [
      { args: ["hooks", "status", "--host", "other", "--json"], error: /invalid hook host/ },
      { args: ["hooks", "status", "--host", "--json"], error: /missing value.*--host/ },
      { args: ["hooks", "status", "--host", "codex", "--host", "claude", "--json"], error: /repeated hooks selector.*--host/ },
      { args: ["hooks", "status", "--session", "--json"], error: /missing value.*--session/ },
      { args: ["hooks", "status", "--session", "unknown", "--json"], error: /non-empty, non-unknown/ },
      { args: ["hooks", "status", "--session", "one", "--session", "two", "--json"], error: /repeated hooks selector.*--session/ },
      { args: ["hooks", "print", "--session", "one", "--json"], error: /unsupported flag/ },
    ];
    for (const fixture of cases) {
      const result = await run(root, fixture.args);
      assert.equal(result.code, 2, `${fixture.args.join(" ")}\n${result.stderr}`);
      assert.match(JSON.parse(result.stdout).error, fixture.error);
    }
    assert.equal(existsSync(join(root, ".claude")), false);
    assert.equal(existsSync(join(root, ".codex")), false);
  } finally {
    await cleanup(root);
  }
});

test("PostToolUse starts from the source bundle with no dependency installation", async () => {
  const root = await tmpProject({ "coherence.config.json": "{}\n" });
  try {
    // Copy the complete source tree into an isolated project but deliberately omit
    // node_modules. This is a runtime import-closure canary: a static allow-list could
    // miss a new eager edge, while the exact failure this guards happens before the hook
    // can read its event. High-frequency lifecycle events must remain on built-ins plus
    // local source; parser packages belong behind the main CLI composition root.
    const isolated = join(root, "isolated");
    await cp(SOURCE_ROOT, join(isolated, "src"), { recursive: true });
    const observed = join(root, "observed.txt");
    await writeFile(observed, "read me\n");
    await mkdir(join(root, ".coherence"), { recursive: true });
    const hostileTrace = join(root, ".coherence", "read-traces");
    await writeFile(hostileTrace, "this regular file prevents trace directory creation\n");
    const result = spawnSync(process.execPath, [join(isolated, "src", "hook-cli.ts"), "PostToolUse"], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({
        session_id: "canary-session", tool_name: "Read", tool_input: { file_path: observed },
      }) + "\n",
      env: {
        ...hostEnv(),
        COHERENCE_PROJECT_ROOT: root,
        COHERENCE_HOOK_HOST: "codex",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "", "lost telemetry keeps PostToolUse byte-silent");
    assert.equal(result.stderr, "");
    assert.match(await readFile(hostileTrace, "utf8"), /regular file prevents/);
  } finally {
    await cleanup(root);
  }
});
