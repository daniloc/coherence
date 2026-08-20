// codex-control.test.ts — Codex gets its own exact project control, never a Claude alias.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  canonicalLifecycleHookSettings,
  CODEX_LIFECYCLE_HOOK_BUNDLE_FINGERPRINT,
  CODEX_LIFECYCLE_HOOK_SCRIPT,
  CODEX_POST_TOOL_USE_MATCHER,
  inspectCodexProjectConfig,
  inspectLifecycleHook,
  LIFECYCLE_HOOK_BUNDLE_FINGERPRINT,
  LIFECYCLE_HOOK_EVENTS,
  LIFECYCLE_HOOK_SCRIPT,
  lifecycleHookBundleFingerprint,
  lifecycleHookCommand,
  managedLifecycleEvent,
  resolveCodexProjectRoot,
  setLifecycleHook,
  setLifecycleHookForHost,
} from "../src/control.ts";
import { cfg, cleanup, tmpProject } from "./_helpers.ts";

type Json = Record<string, any>;
const run = promisify(execFile);

async function installTarget(root: string, body = "#!/bin/sh\nexit 0\n"): Promise<string> {
  const path = join(root, "node_modules", ".bin", "coherence-hook");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  await chmod(path, 0o755);
  return path;
}

async function writeCodex(root: string, name: "hooks.json" | "config.toml", contents: string): Promise<void> {
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(join(root, ".codex", name), contents);
}

async function readHooks(root: string): Promise<Json> {
  return JSON.parse(await readFile(join(root, ".codex", "hooks.json"), "utf8")) as Json;
}

test("Codex control — canonical bundle uses the host's exact matchers, commands, and identity", () => {
  const settings = canonicalLifecycleHookSettings("codex") as Json;
  assert.deepEqual(Object.keys(settings.hooks), [...LIFECYCLE_HOOK_EVENTS]);
  assert.equal(settings.hooks.SessionStart[0].matcher, "startup|resume|clear|compact");
  assert.equal(settings.hooks.PostToolUse[0].matcher, CODEX_POST_TOOL_USE_MATCHER);
  assert.equal(CODEX_POST_TOOL_USE_MATCHER, "Bash|apply_patch|update_plan|mcp__.*");
  assert.equal(settings.hooks.Stop[0].matcher, undefined, "Stop ignores matchers in Codex");
  for (const event of LIFECYCLE_HOOK_EVENTS) {
    assert.equal(settings.hooks[event][0].hooks[0].command, lifecycleHookCommand(event, "codex"));
    assert.equal(managedLifecycleEvent(lifecycleHookCommand(event, "codex"), "codex"), event);
  }
  assert.equal(managedLifecycleEvent("npx coherence hook Stop", "codex"), "Stop");
  assert.equal(managedLifecycleEvent("node ./src/hook-cli.ts SubagentStart", "codex"), "SubagentStart");
  assert.equal(managedLifecycleEvent("echo npx coherence hook Stop", "codex"), null);
  assert.equal(managedLifecycleEvent(`${lifecycleHookCommand("Stop", "codex")} && echo extra`, "codex"), null);
  assert.notEqual(CODEX_LIFECYCLE_HOOK_BUNDLE_FINGERPRINT, LIFECYCLE_HOOK_BUNDLE_FINGERPRINT);
  assert.equal(CODEX_LIFECYCLE_HOOK_BUNDLE_FINGERPRINT, lifecycleHookBundleFingerprint("codex"));
  assert.match(CODEX_LIFECYCLE_HOOK_SCRIPT, /COHERENCE_HOOK_HOST="codex"/);
  assert.match(CODEX_LIFECYCLE_HOOK_SCRIPT, /COHERENCE_HOOK_TRANSPORT="launcher"/);
  assert.match(CODEX_LIFECYCLE_HOOK_SCRIPT, new RegExp(CODEX_LIFECYCLE_HOOK_BUNDLE_FINGERPRINT));
  assert.match(LIFECYCLE_HOOK_SCRIPT, /COHERENCE_HOOK_HOST="claude"/);
  assert.match(LIFECYCLE_HOOK_SCRIPT, /COHERENCE_HOOK_TRANSPORT="launcher"/);
  assert.match(LIFECYCLE_HOOK_SCRIPT, new RegExp(LIFECYCLE_HOOK_BUNDLE_FINGERPRINT));
});

test("Codex control — install is exact, idempotent, preserving, and runnable across nested paths", async () => {
  const host = await tmpProject();
  const root = join(host, "packages", "app with spaces");
  try {
    await mkdir(root, { recursive: true });
    await run("git", ["init"], { cwd: host });
    const resultPath = join(host, "codex-hook-result");
    await installTarget(root, `#!/bin/sh
printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$PWD" "$COHERENCE_PROJECT_ROOT" "$COHERENCE_HOOK_HOST" "$COHERENCE_HOOK_TRANSPORT" "$COHERENCE_HOOK_BUNDLE_FINGERPRINT" "$1" > "$CODEX_RESULT"
`);
    await writeCodex(host, "hooks.json", JSON.stringify({
      description: "operator-owned description",
      metadata: { retained: true },
      hooks: {
        SessionStart: [{ hooks: [
          { type: "command", command: "npx coherence hook SessionStart" },
          { type: "command", command: "printf unrelated-start" },
        ] }],
        Notification: [{ hooks: [{ type: "command", command: "printf notify" }] }],
      },
    }, null, 4) + "\n");
    await chmod(join(host, ".codex", "hooks.json"), 0o600);
    const nested = cfg(root, { codexProjectRoot: "../.." });

    const first = await setLifecycleHookForHost(nested, "codex", true);
    assert.deepEqual(first.errors, []);
    assert.equal(first.inspection.host, "codex");
    assert.equal(first.inspection.configured, true);
    assert.equal(first.inspection.present, true);
    assert.deepEqual(first.inspection.scopes, ["project"]);
    assert.equal(first.inspection.files.length, 1);
    assert.equal(first.inspection.files[0]?.path, join(host, ".codex", "hooks.json"));
    assert.equal(first.inspection.files[0]?.managedActions, 5,
      "the audited direct spelling is migrated instead of left to double-fire");
    assert.equal(first.inspection.bundleFingerprint, CODEX_LIFECYCLE_HOOK_BUNDLE_FINGERPRINT);
    assert.equal(first.inspection.launcher.rootAligned, true);
    assert.equal(first.inspection.launcher.commandRoot, await realpath(host));

    const installed = await readHooks(host);
    const canonical = canonicalLifecycleHookSettings("codex") as Json;
    assert.equal(installed.description, "operator-owned description");
    assert.deepEqual(installed.metadata, { retained: true });
    assert.equal(installed.hooks.SessionStart[0].hooks[0].command, "printf unrelated-start");
    assert.equal(installed.hooks.Notification[0].hooks[0].command, "printf notify");
    for (const event of LIFECYCLE_HOOK_EVENTS) {
      assert.deepEqual(installed.hooks[event].at(-1), canonical.hooks[event][0]);
    }
    assert.equal((await stat(join(host, ".codex", "hooks.json"))).mode & 0o777, 0o600);
    assert.equal(await readFile(join(host, ".codex", "coherence-root"), "utf8"), "packages/app with spaces\n");
    assert.equal(await readFile(join(host, ".codex", "coherence-hook"), "utf8"), CODEX_LIFECYCLE_HOOK_SCRIPT);

    const nestedCwd = join(root, "deeper");
    await mkdir(nestedCwd);
    await run("/bin/sh", ["-c", lifecycleHookCommand("SessionStart", "codex")], {
      cwd: nestedCwd,
      env: { ...process.env, CODEX_RESULT: resultPath },
    });
    const physicalRoot = await realpath(root);
    assert.equal(
      await readFile(resultPath, "utf8"),
      `${physicalRoot}\n${physicalRoot}\ncodex\nlauncher\n${CODEX_LIFECYCLE_HOOK_BUNDLE_FINGERPRINT}\nSessionStart\n`,
    );

    const hookBytes = await readFile(join(host, ".codex", "hooks.json"), "utf8");
    const second = await setLifecycleHook(nested, true, "codex");
    assert.deepEqual(second.errors, []);
    assert.deepEqual(second.changed, []);
    assert.equal(await readFile(join(host, ".codex", "hooks.json"), "utf8"), hookBytes);

    const off = await setLifecycleHook(nested, false, "codex");
    assert.deepEqual(off.errors, []);
    assert.equal(off.inspection.present, false);
    const after = await readHooks(host);
    assert.equal(after.description, "operator-owned description");
    assert.deepEqual(after.metadata, { retained: true });
    assert.equal(after.hooks.SessionStart[0].hooks[0].command, "printf unrelated-start");
    assert.equal(after.hooks.Notification[0].hooks[0].command, "printf notify");
    await assert.rejects(readFile(join(host, ".codex", "coherence-hook")), { code: "ENOENT" });
    await assert.rejects(readFile(join(host, ".codex", "coherence-root")), { code: "ENOENT" });
  } finally {
    await cleanup(host);
  }
});

test("Codex control — a configured root the stable launcher cannot address refuses before writing", async () => {
  const host = await tmpProject();
  const root = join(host, "app");
  try {
    await mkdir(root, { recursive: true });
    await run("git", ["init"], { cwd: host });
    await installTarget(root);

    const nested = cfg(root);
    const before = inspectLifecycleHook(nested, "codex");
    assert.equal(before.launcher.rootAligned, false);
    assert.equal(before.launcher.configuredRoot, root);
    assert.equal(before.launcher.commandRoot, await realpath(host));
    assert.match(before.warnings.join("\n"), /launcher resolves .* not configured project root/);

    const refused = await setLifecycleHook(nested, true, "codex");
    assert.ok(refused.errors.some((error) => /project root does not match launcher root/.test(error)));
    assert.deepEqual(refused.changed, []);
    await assert.rejects(readFile(join(root, ".codex", "hooks.json")), { code: "ENOENT" });
    await assert.rejects(readFile(join(root, ".codex", "coherence-hook")), { code: "ENOENT" });

    const aligned = cfg(root, { codexProjectRoot: ".." });
    const installed = await setLifecycleHook(aligned, true, "codex");
    assert.deepEqual(installed.errors, []);
    assert.equal(installed.inspection.present, true);
    assert.equal(installed.inspection.launcher.rootAligned, true);
    assert.equal(await readFile(join(host, ".codex", "coherence-root"), "utf8"), "app\n");
  } finally {
    await cleanup(host);
  }
});

test("Codex control — project-root default follows the existing Claude root without coupling files", async () => {
  const host = await tmpProject();
  const root = join(host, "app");
  try {
    await mkdir(root, { recursive: true });
    await installTarget(root);
    await mkdir(join(host, ".claude"), { recursive: true });
    await writeFile(join(host, ".claude", "settings.json"), "{\n  \"operator\": true\n}\n");
    const claudeBytes = await readFile(join(host, ".claude", "settings.json"), "utf8");
    const nested = cfg(root, { claudeProjectRoot: ".." });
    assert.equal(resolveCodexProjectRoot(nested), host);
    assert.equal((await setLifecycleHook(nested, true, "codex")).inspection.present, true);
    assert.equal(await readFile(join(host, ".claude", "settings.json"), "utf8"), claudeBytes);
    assert.equal(inspectLifecycleHook(nested).present, false, "the default inspection remains Claude-only");
    assert.equal(inspectLifecycleHook(nested, "codex").present, true);
  } finally {
    await cleanup(host);
  }
});

test("Codex control — invalid JSON and inline TOML refuse before any partial install", async () => {
  const invalid = await tmpProject();
  try {
    await installTarget(invalid);
    await writeCodex(invalid, "hooks.json", "{ not-json\n");
    const before = await readFile(join(invalid, ".codex", "hooks.json"), "utf8");
    const result = await setLifecycleHook(cfg(invalid), true, "codex");
    assert.equal(result.inspection.valid, false);
    assert.ok(result.errors.length > 0);
    assert.deepEqual(result.changed, []);
    assert.equal(await readFile(join(invalid, ".codex", "hooks.json"), "utf8"), before);
    await assert.rejects(readFile(join(invalid, ".codex", "coherence-hook")), { code: "ENOENT" });
    await assert.rejects(readFile(join(invalid, ".codex", "coherence-root")), { code: "ENOENT" });
  } finally {
    await cleanup(invalid);
  }

  const inline = await tmpProject();
  try {
    await installTarget(inline);
    await writeCodex(inline, "config.toml", `# [[hooks.CommentOnly]]
note = "[[hooks.InAString]] # still a value"

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "printf unrelated"
`);
    const inspected = inspectLifecycleHook(cfg(inline), "codex");
    assert.equal(inspected.valid, true);
    assert.equal(inspected.codexConfig?.inlineHooks, true);
    assert.equal(inspected.configured, false);
    assert.match(inspected.warnings.join("\n"), /inline hooks/);
    const refused = await setLifecycleHook(cfg(inline), true, "codex");
    assert.ok(refused.errors.some((error) => /inline Codex hooks/.test(error)));
    assert.deepEqual(refused.changed, []);
    await assert.rejects(readFile(join(inline, ".codex", "hooks.json")), { code: "ENOENT" });
  } finally {
    await cleanup(inline);
  }
});

test("Codex control — disabled project hooks stay configured without claiming presence", async () => {
  const root = await tmpProject();
  try {
    await installTarget(root);
    assert.equal((await setLifecycleHook(cfg(root), true, "codex")).inspection.present, true);
    await writeCodex(root, "config.toml", `[features]
hooks = false
`);
    const inspection = inspectLifecycleHook(cfg(root), "codex");
    assert.equal(inspection.valid, true);
    assert.equal(inspection.configured, true, "the exact project bundle remains installed");
    assert.equal(inspection.present, false, "a disabled bundle is not a present control");
    assert.equal(inspection.codexConfig?.hooksDisabled, true);
    assert.match(inspection.warnings.join("\n"), /disables hooks/);
    const repeat = await setLifecycleHook(cfg(root), true, "codex");
    assert.deepEqual(repeat.errors, []);
    assert.deepEqual(repeat.changed, []);
  } finally {
    await cleanup(root);
  }
});

test("Codex control — managed-only mode excludes an otherwise configured project bundle", async () => {
  const root = await tmpProject();
  try {
    await installTarget(root);
    assert.equal((await setLifecycleHook(cfg(root), true, "codex")).inspection.present, true);
    await writeCodex(root, "config.toml", `allow_managed_hooks_only = true

[features]
hooks = true
`);
    const inspection = inspectLifecycleHook(cfg(root), "codex");
    assert.equal(inspection.valid, true);
    assert.equal(inspection.configured, true, "the exact project artifacts remain installed");
    assert.equal(inspection.present, false, "Codex will skip project hooks in managed-only mode");
    assert.equal(inspection.codexConfig?.managedHooksOnly, true);
    assert.match(inspection.warnings.join("\n"), /allow_managed_hooks_only = true/);

    const repeat = await setLifecycleHook(cfg(root), true, "codex");
    assert.deepEqual(repeat.errors, []);
    assert.deepEqual(repeat.changed, [], "install does not rewrite the operator's disabling config");
    assert.equal(repeat.inspection.present, false);
  } finally {
    await cleanup(root);
  }
});

test("Codex control — relevant TOML detection is comment-aware and fails closed on malformed tables", async () => {
  const root = await tmpProject();
  try {
    await writeCodex(root, "config.toml", `# [hooks]
note = "features.hooks = false # inert"
managed_note = "allow_managed_hooks_only = true"
[features]
hooks = true # explicitly enabled
`);
    const clean = inspectCodexProjectConfig(cfg(root));
    assert.equal(clean.valid, true);
    assert.equal(clean.inlineHooks, false);
    assert.equal(clean.hooksDisabled, false);
    assert.equal(clean.managedHooksOnly, false, "a mention inside a string is not configuration");

    await writeCodex(root, "config.toml", '[["hooks".Stop]]\n');
    const quoted = inspectCodexProjectConfig(cfg(root));
    assert.equal(quoted.valid, true);
    assert.equal(quoted.inlineHooks, true, "quoted TOML keys cannot hide an inline hook surface");

    await writeCodex(root, "config.toml", "[hooks\n");
    const malformed = inspectCodexProjectConfig(cfg(root));
    assert.equal(malformed.valid, false);
    assert.match(malformed.error ?? "", /could not classify/);
  } finally {
    await cleanup(root);
  }
});

test("Codex control — uninstall removes only canonical bytes and spares launcher drift", async () => {
  const root = await tmpProject();
  try {
    await installTarget(root);
    await writeCodex(root, "hooks.json", JSON.stringify({
      keep: true,
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo coherence-hook Stop" }] }],
      },
    }, null, 2) + "\n");
    assert.equal((await setLifecycleHook(cfg(root), true, "codex")).inspection.present, true);
    await writeFile(join(root, ".codex", "coherence-hook"), "operator edit after install\n");

    const off = await setLifecycleHook(cfg(root), false, "codex");
    assert.deepEqual(off.errors, []);
    assert.equal(await readFile(join(root, ".codex", "coherence-hook"), "utf8"), "operator edit after install\n");
    await assert.rejects(readFile(join(root, ".codex", "coherence-root")), { code: "ENOENT" });
    const hooks = await readHooks(root);
    assert.equal(hooks.keep, true);
    assert.equal(hooks.hooks.Stop[0].hooks[0].command, "echo coherence-hook Stop");
  } finally {
    await cleanup(root);
  }
});
