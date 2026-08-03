// control.test.ts — the lifecycle hook is the first binary control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalLifecycleHookSettings,
  inspectLifecycleHook,
  LIFECYCLE_HOOK_SCRIPT,
  lifecycleHookCommand,
  managedLifecycleEvent,
  setLifecycleHook,
} from "../src/control.ts";
import { checkHooks } from "../src/hooks.ts";
import { loadConfig } from "../src/config.ts";
import { openSession } from "../src/decisions.ts";
import { cfg, cleanup, runCaptured, tmpProject } from "./_helpers.ts";

type Json = Record<string, any>;
const run = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function writeSettings(
  root: string,
  name: "settings.json" | "settings.local.json",
  value: unknown,
): Promise<void> {
  await mkdir(join(root, ".claude"), { recursive: true });
  await writeFile(join(root, ".claude", name), JSON.stringify(value, null, 2) + "\n");
}

async function readSettings(root: string, name: "settings.json" | "settings.local.json"): Promise<Json> {
  return JSON.parse(await readFile(join(root, ".claude", name), "utf8")) as Json;
}

async function installTarget(root: string, body = "#!/bin/sh\nexit 0\n"): Promise<string> {
  const path = join(root, "node_modules", ".bin", "coherence-hook");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  await chmod(path, 0o755);
  return path;
}

test("control — lifecycle installation is exact, idempotent, and preserves unrelated hooks", async () => {
  const root = await tmpProject();
  try {
    await installTarget(root);
    await writeSettings(root, "settings.json", {
      permissions: { allow: ["Read"] },
      hooks: {
        SessionStart: [{ hooks: [
          { type: "command", command: "npx coherence hook SessionStart" },
          { type: "command", command: "printf unrelated-start" },
        ] }],
        Notification: [{ matcher: "idle", hooks: [{ type: "command", command: "printf notify" }] }],
      },
    });
    await writeSettings(root, "settings.local.json", {
      theme: "dark",
      hooks: { Stop: [{ hooks: [{ type: "command", command: "node ./src/hook-cli.ts Stop" }] }] },
    });
    await chmod(join(root, ".claude", "settings.json"), 0o600);
    await chmod(join(root, ".claude", "settings.local.json"), 0o600);

    const first = await setLifecycleHook(cfg(root), true);
    assert.deepEqual(first.errors, []);
    assert.equal(first.inspection.present, true);
    assert.equal(first.inspection.wiringPresent, true);
    assert.deepEqual(first.inspection.scopes, ["project"]);
    assert.equal(first.inspection.files.find((file) => file.scope === "project")?.canonicalGroups, 5);
    assert.equal(first.inspection.files.find((file) => file.scope === "local")?.managedActions, 0,
      "migration must not leave a second lifecycle path firing from local settings");

    const project = await readSettings(root, "settings.json");
    const local = await readSettings(root, "settings.local.json");
    assert.deepEqual(project.permissions, { allow: ["Read"] });
    assert.equal(project.hooks.SessionStart[0].hooks[0].command, "printf unrelated-start");
    assert.equal(project.hooks.Notification[0].hooks[0].command, "printf notify");
    assert.equal(local.theme, "dark");
    assert.equal(local.hooks, undefined, "only the managed action is removed from local settings");
    assert.equal((await stat(join(root, ".claude", "settings.json"))).mode & 0o777, 0o600,
      "atomic replacement preserves the settings file's private mode");
    assert.equal((await stat(join(root, ".claude", "settings.local.json"))).mode & 0o777, 0o600);
    assert.equal(await readFile(join(root, ".claude", "coherence-hook"), "utf8"), LIFECYCLE_HOOK_SCRIPT);
    assert.equal(await readFile(join(root, ".claude", "coherence-root"), "utf8"), ".\n");

    const projectBytes = await readFile(join(root, ".claude", "settings.json"), "utf8");
    const localBytes = await readFile(join(root, ".claude", "settings.local.json"), "utf8");
    const second = await setLifecycleHook(cfg(root), true);
    assert.deepEqual(second.errors, []);
    assert.deepEqual(second.changed, [], "installing an installed control is a byte-stable no-op");
    assert.equal(await readFile(join(root, ".claude", "settings.json"), "utf8"), projectBytes);
    assert.equal(await readFile(join(root, ".claude", "settings.local.json"), "utf8"), localBytes);

    const off = await setLifecycleHook(cfg(root), false);
    assert.deepEqual(off.errors, []);
    assert.equal(off.inspection.present, false);
    const after = await readSettings(root, "settings.json");
    assert.deepEqual(after.permissions, { allow: ["Read"] });
    assert.equal(after.hooks.SessionStart[0].hooks[0].command, "printf unrelated-start");
    assert.equal(after.hooks.Notification[0].hooks[0].command, "printf notify");
    await assert.rejects(readFile(join(root, ".claude", "coherence-hook")), { code: "ENOENT" });
    await assert.rejects(readFile(join(root, ".claude", "coherence-root")), { code: "ENOENT" });
  } finally {
    await cleanup(root);
  }
});

test("control — presence is the complete canonical bundle, never a partial or lookalike", async () => {
  const cases: Array<{ name: string; mutate: (settings: Json) => void; present: boolean }> = [
    {
      name: "unrelated settings and separate hook groups coexist",
      mutate: (settings) => {
        settings.permissions = { allow: ["Read"] };
        settings.hooks.SubagentStart.push({ hooks: [{ type: "command", command: "printf unrelated" }] });
        settings.hooks.Notification = [{ hooks: [{ type: "command", command: "printf notify" }] }];
      },
      present: true,
    },
    {
      name: "duplicate canonical groups are a competing path",
      mutate: (settings) => settings.hooks.Stop.push(structuredClone(settings.hooks.Stop[0])),
      present: false,
    },
    {
      name: "four events are incomplete",
      mutate: (settings) => { delete settings.hooks.Stop; },
      present: false,
    },
    {
      name: "the event argument is part of identity",
      mutate: (settings) => { settings.hooks.Stop[0].hooks[0].command = lifecycleHookCommand("SubagentStop"); },
      present: false,
    },
    {
      name: "the PostToolUse matcher is exact",
      mutate: (settings) => { settings.hooks.PostToolUse[0].matcher = "Read|Write"; },
      present: false,
    },
    {
      name: "PostToolUse without a matcher is not canonical",
      mutate: (settings) => { delete settings.hooks.PostToolUse[0].matcher; },
      present: false,
    },
    {
      name: "matcher and command cannot be synthesized across groups",
      mutate: (settings) => {
        settings.hooks.PostToolUse = [
          { matcher: "Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: "printf nope" }] },
          { hooks: [{ type: "command", command: lifecycleHookCommand("PostToolUse") }] },
        ];
      },
      present: false,
    },
    {
      name: "a lifecycle matcher changes the canonical group",
      mutate: (settings) => { settings.hooks.Stop[0].matcher = "anything"; },
      present: false,
    },
    {
      name: "an extra action in the canonical group changes the canonical group",
      mutate: (settings) => settings.hooks.Stop[0].hooks.push({ type: "command", command: "printf unrelated" }),
      present: false,
    },
    {
      name: "extra action metadata changes the canonical action",
      mutate: (settings) => { settings.hooks.Stop[0].hooks[0].timeout = 30; },
      present: false,
    },
    {
      name: "a prompt action is not a command action",
      mutate: (settings) => { settings.hooks.Stop[0].hooks[0].type = "prompt"; },
      present: false,
    },
  ];

  for (const fixture of cases) {
    const root = await tmpProject();
    try {
      await installTarget(root);
      assert.equal((await setLifecycleHook(cfg(root), true)).inspection.present, true,
        "the fixture needs a live canonical baseline before mutating it");
      const settings = canonicalLifecycleHookSettings() as Json;
      fixture.mutate(settings);
      await writeSettings(root, "settings.json", settings);
      assert.equal(inspectLifecycleHook(cfg(root)).present, fixture.present, fixture.name);
    } finally {
      await cleanup(root);
    }
  }

  const missingLauncher = await tmpProject();
  try {
    await installTarget(missingLauncher);
    await writeSettings(missingLauncher, "settings.json", canonicalLifecycleHookSettings());
    assert.equal(inspectLifecycleHook(cfg(missingLauncher)).present, false,
      "canonical JSON without the stable launcher is not a runnable control");
  } finally {
    await cleanup(missingLauncher);
  }

  const competingLocal = await tmpProject();
  try {
    await installTarget(competingLocal);
    await setLifecycleHook(cfg(competingLocal), true);
    await writeSettings(competingLocal, "settings.local.json", {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "npx coherence hook Stop" }] }] },
    });
    assert.equal(inspectLifecycleHook(cfg(competingLocal)).present, false,
      "a second local lifecycle path prevents the shared control from being singular");
  } finally {
    await cleanup(competingLocal);
  }
});

test("control — structural presence and observed firing are orthogonal", async () => {
  const root = await tmpProject();
  try {
    await installTarget(root);
    assert.equal((await setLifecycleHook(cfg(root), true)).inspection.present, true);
    const installed = await runCaptured(() => Promise.resolve(checkHooks(cfg(root))));
    assert.equal(installed.code, 0, "unobserved runtime activity cannot erase a present hook");
    assert.match(installed.out, /lifecycle hook: PRESENT/);
    assert.match(installed.out, /runtime observation: UNOBSERVED/);
    assert.match(installed.out, /launcher: READY/);

    const partial = canonicalLifecycleHookSettings() as Json;
    delete partial.hooks.Stop;
    await writeSettings(root, "settings.json", partial);
    openSession(cfg(root), { session: "historical-hook-session" });
    const observed = await runCaptured(() => Promise.resolve(checkHooks(cfg(root))));
    assert.equal(observed.code, 1, "historical activity cannot redeem current structural absence");
    assert.match(observed.out, /lifecycle hook: ABSENT/);
    assert.match(observed.out, /runtime observation: OBSERVED/);
  } finally {
    await cleanup(root);
  }
});

test("control — local-only, duplicated, and invalid settings never satisfy the shared bit", async () => {
  const root = await tmpProject();
  try {
    await installTarget(root);
    await writeSettings(root, "settings.local.json", canonicalLifecycleHookSettings());
    const local = inspectLifecycleHook(cfg(root));
    assert.equal(local.wiringPresent, false);
    assert.equal(local.present, false);
    assert.deepEqual(local.scopes, ["local"]);
    assert.match(local.warnings.join("\n"), /local-only/);

    await writeSettings(root, "settings.json", canonicalLifecycleHookSettings());
    const duplicate = inspectLifecycleHook(cfg(root));
    assert.equal(duplicate.wiringPresent, false, "two settings scopes would fire twice");
    assert.match(duplicate.warnings.join("\n"), /competing/);

    await writeFile(join(root, ".claude", "settings.json"), "{ definitely-not-json");
    const beforeLocal = await readFile(join(root, ".claude", "settings.local.json"), "utf8");
    const invalid = await setLifecycleHook(cfg(root), true);
    assert.equal(invalid.inspection.valid, false);
    assert.equal(invalid.inspection.present, false);
    assert.ok(invalid.errors.length > 0);
    assert.deepEqual(invalid.changed, [], "an invalid scope refuses before writing either scope");
    assert.equal(await readFile(join(root, ".claude", "settings.local.json"), "utf8"), beforeLocal);
    const checked = await runCaptured(() => Promise.resolve(checkHooks(cfg(root))));
    assert.equal(checked.code, 2);
    assert.match(checked.out, /lifecycle hook: UNKNOWN/);
  } finally {
    await cleanup(root);
  }
});

test("control — the stable launcher maps a Claude root to a nested coherence root", async () => {
  const host = await tmpProject();
  const root = join(host, "app");
  try {
    await mkdir(root, { recursive: true });
    await installTarget(root, `#!/bin/sh
printf '%s\n%s\n%s\n' "$PWD" "$COHERENCE_PROJECT_ROOT" "$1" > "$CLAUDE_PROJECT_DIR/hook-result"
`);
    await writeSettings(host, "settings.json", {
      permissions: { allow: ["Read"] },
      hooks: {
        SessionStart: [{ hooks: [
          { type: "command", command: 'cd "$CLAUDE_PROJECT_DIR/app" 2>/dev/null || cd "$CLAUDE_PROJECT_DIR"; npx coherence hook SessionStart' },
          { type: "command", command: 'cd "$CLAUDE_PROJECT_DIR/app" 2>/dev/null || cd "$CLAUDE_PROJECT_DIR"; npx coherence decisions --open --brief' },
        ] }],
      },
    });
    const nestedCfg = cfg(root, { claudeProjectRoot: ".." });
    const installed = await setLifecycleHook(nestedCfg, true);
    assert.deepEqual(installed.errors, []);
    assert.equal(installed.inspection.present, true);
    assert.equal(installed.inspection.files[0]?.path, join(host, ".claude", "settings.json"));
    assert.equal(await readFile(join(host, ".claude", "coherence-root"), "utf8"), "app\n");
    const settings = await readSettings(host, "settings.json");
    assert.equal(settings.permissions.allow[0], "Read");
    assert.equal(settings.hooks.SessionStart[0].hooks[0].command,
      'cd "$CLAUDE_PROJECT_DIR/app" 2>/dev/null || cd "$CLAUDE_PROJECT_DIR"; npx coherence decisions --open --brief');
    assert.equal(installed.inspection.files[0]?.managedActions, 5,
      "the audited Hoist wrapper is migrated instead of left to double-fire");

    await run(join(host, ".claude", "coherence-hook"), ["SessionStart"], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: host },
    });
    const physicalRoot = await realpath(root);
    assert.equal(await readFile(join(host, "hook-result"), "utf8"), `${physicalRoot}\n${physicalRoot}\nSessionStart\n`,
      "cwd and the explicit env both address the nested coherence root (old and new hook CLIs)");
  } finally {
    await cleanup(host);
  }
});

test("control — the source fallback is a readable regular file and runs from the coherence root", async () => {
  const root = await tmpProject();
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "coherence-harness" }));
    const source = join(root, "src", "hook-cli.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(source, `import { writeFileSync } from "node:fs";
writeFileSync(process.env.CLAUDE_PROJECT_DIR + "/source-result", process.cwd() + "\\n" + process.env.COHERENCE_PROJECT_ROOT + "\\n" + process.argv[2] + "\\n");
`);

    const installed = await setLifecycleHook(cfg(root), true);
    assert.deepEqual(installed.errors, []);
    assert.equal(installed.inspection.present, true);
    assert.equal(installed.inspection.launcher.targetKind, "source");
    await run(join(root, ".claude", "coherence-hook"), ["SessionStart"], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    const physicalRoot = await realpath(root);
    assert.equal(await readFile(join(root, "source-result"), "utf8"), `${physicalRoot}\n${physicalRoot}\nSessionStart\n`);

    await rm(source);
    await mkdir(source);
    const directory = inspectLifecycleHook(cfg(root));
    assert.equal(directory.present, false);
    assert.equal(directory.launcher.targetPresent, false,
      "inspection must reject the same non-file target the launcher rejects");
  } finally {
    await cleanup(root);
  }
});

test("control — install repairs coherence-owned launcher files and uninstall spares drift", async () => {
  const root = await tmpProject();
  try {
    await installTarget(root);
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "coherence-hook"), "operator collision\n");
    await writeFile(join(root, ".claude", "coherence-root"), "wrong-root\n");

    const installed = await setLifecycleHook(cfg(root), true);
    assert.deepEqual(installed.errors, []);
    assert.equal(installed.inspection.present, true);
    assert.equal(await readFile(join(root, ".claude", "coherence-hook"), "utf8"), LIFECYCLE_HOOK_SCRIPT);
    assert.equal(await readFile(join(root, ".claude", "coherence-root"), "utf8"), ".\n");

    await writeFile(join(root, ".claude", "coherence-hook"), "operator edit after install\n");
    const uninstalled = await setLifecycleHook(cfg(root), false);
    assert.deepEqual(uninstalled.errors, []);
    assert.equal(await readFile(join(root, ".claude", "coherence-hook"), "utf8"), "operator edit after install\n",
      "OFF never deletes a managed-path file whose bytes no longer prove coherence ownership");
    await assert.rejects(readFile(join(root, ".claude", "coherence-root")), { code: "ENOENT" });
  } finally {
    await cleanup(root);
  }
});

test("control — install refuses a missing target and leaves settings untouched", async () => {
  const root = await tmpProject();
  try {
    await writeSettings(root, "settings.json", { permissions: { allow: ["Read"] } });
    const before = await readFile(join(root, ".claude", "settings.json"), "utf8");
    const result = await setLifecycleHook(cfg(root), true);
    assert.ok(result.errors.some((error) => /target is missing/.test(error)));
    assert.deepEqual(result.changed, []);
    assert.equal(await readFile(join(root, ".claude", "settings.json"), "utf8"), before);
    await assert.rejects(readFile(join(root, ".claude", "coherence-hook")), { code: "ENOENT" });
  } finally {
    await cleanup(root);
  }
});

test("control — migration recognizes only emitted terminal invocations", () => {
  assert.equal(managedLifecycleEvent("npx coherence hook Stop"), "Stop");
  assert.equal(managedLifecycleEvent("node ./src/hook-cli.ts SubagentStart"), "SubagentStart");
  assert.equal(managedLifecycleEvent('cd "$CLAUDE_PROJECT_DIR" && node ./src/hook-cli.ts PostToolUse'), "PostToolUse");
  assert.equal(managedLifecycleEvent(lifecycleHookCommand("SessionStart")), "SessionStart");
  assert.equal(managedLifecycleEvent(
    'cd "$CLAUDE_PROJECT_DIR/app" 2>/dev/null || cd "$CLAUDE_PROJECT_DIR"; npx coherence hook SessionStart',
  ), "SessionStart");
  assert.equal(managedLifecycleEvent("echo coherence-hook Stop"), null);
  assert.equal(managedLifecycleEvent("npx coherence hook Stop && printf extra"), null);
  assert.equal(managedLifecycleEvent("npx coherence hook SubagentStop"), "SubagentStop");
});

test("control CLI — actions and exit codes expose one unambiguous switch", async () => {
  const root = await tmpProject();
  try {
    await installTarget(root);
    const installed = await run(process.execPath, [CLI, "hooks", "install"], { cwd: root });
    assert.match(installed.stdout, /lifecycle hook: PRESENT/);
    await run(process.execPath, [CLI, "hooks", "--check"], { cwd: root });

    const status = await run(process.execPath, [CLI, "hooks", "status", "--json"], { cwd: root });
    const parsed = JSON.parse(status.stdout) as { control: { present: boolean } };
    assert.equal(parsed.control.present, true);

    const conflict = await run(process.execPath, [CLI, "hooks", "install", "--check"], { cwd: root })
      .then(() => ({ code: 0, stdout: "" }), (error: { code: number; stdout: string }) => error);
    assert.equal(conflict.code, 2);

    const undocumentedAlias = await run(process.execPath, [CLI, "hooks", "check"], { cwd: root })
      .then(() => ({ code: 0 }), (error: { code: number }) => error);
    assert.equal(undocumentedAlias.code, 2, "the binary spelling is exactly `hooks --check`");

    await run(process.execPath, [CLI, "hooks", "uninstall"], { cwd: root });
    const absent = await run(process.execPath, [CLI, "hooks", "--check"], { cwd: root })
      .then(() => ({ code: 0 }), (error: { code: number }) => error);
    assert.equal(absent.code, 1);

    const jsonError = await run(process.execPath, [CLI, "hooks", "print", "--json"], { cwd: root })
      .then(() => ({ code: 0, stdout: "" }), (error: { code: number; stdout: string }) => error);
    assert.equal(jsonError.code, 2);
    assert.match(JSON.parse(jsonError.stdout).error, /unsupported flag/);
  } finally {
    await cleanup(root);
  }
});

test("control — this repository's own lifecycle control is PRESENT", async () => {
  const inspection = inspectLifecycleHook(await loadConfig(REPO_ROOT));
  assert.equal(inspection.present, true, JSON.stringify(inspection, null, 2));
  assert.deepEqual(inspection.warnings, []);
});
