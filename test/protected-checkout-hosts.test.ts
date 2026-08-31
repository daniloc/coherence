import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import registerPiHooks from "../src/pi-extension.ts";
import { HOOK_HOSTS, type HookHost } from "../src/types.ts";

const run = promisify(execFile);
const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(SOURCE_ROOT, "src/cli.ts");
const HOOK_CLI = join(SOURCE_ROOT, "src/hook-cli.ts");
type Snapshot = Map<string, string>;

async function snapshot(root: string): Promise<Snapshot> {
  const result = new Map<string, string>();
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (dir === root && entry.name === ".git") continue;
      const path = join(dir, entry.name), rel = relative(root, path);
      const stat = await lstat(path);
      if (stat.isDirectory()) { result.set(rel, "directory"); await visit(path); }
      else if (stat.isSymbolicLink()) result.set(rel, `symlink:${await readlink(path)}`);
      else if (stat.isFile()) result.set(rel, `file:${(await readFile(path)).toString("base64")}`);
      else result.set(rel, `other:${stat.mode}`);
    }
  }
  await visit(root);
  return result;
}

function snapshotDiff(before: Snapshot, after: Snapshot): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(path => before.get(path) !== after.get(path)).sort();
}

async function fixture(git: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "coherence-protected-hosts-"));
  const seeded = [
    ["activity/existing.jsonl", "existing activity\n"],
    ["read-traces/existing.jsonl", "existing trace\n"],
    ["calibration/existing.jsonl", "existing calibration\n"],
  ] as const;
  for (const [path, bytes] of seeded) {
    await mkdir(dirname(join(root, ".coherence", path)), { recursive: true });
    await writeFile(join(root, ".coherence", path), bytes);
  }
  await writeFile(join(root, "coherence.config.json"), '{"protectPrimaryCheckout":true}\n');
  if (git) {
    await run("git", ["init", "-q"], { cwd: root });
    await run("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
    await run("git", ["config", "user.name", "Test"], { cwd: root });
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-qm", "baseline"], { cwd: root });
  }
  return root;
}

type Handler = (event: any, context: any) => unknown;
async function runProtectedPi(root: string): Promise<string> {
  const handlers = new Map<string, Handler>();
  const runtime = {
    on(name: string, handler: Handler) { handlers.set(name, handler); },
    events: { emit() {} },
    sendMessage() {},
  };
  const context = { cwd: root, hasUI: false, ui: { notify() {} }, sessionManager: { getSessionId: () => "pi-cross-host" } };
  registerPiHooks(runtime as any);
  await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, context);
  const started = await handlers.get("before_agent_start")?.({ type: "before_agent_start", systemPrompt: "base", prompt: "work" }, context) as { systemPrompt: string };
  await handlers.get("tool_result")?.({ type: "tool_result", toolCallId: "cross", toolName: "read", input: { file_path: "coherence.config.json" }, details: undefined, isError: false }, context);
  await handlers.get("agent_settled")?.({ type: "agent_settled" }, context);
  return started.systemPrompt;
}

function runProtectedCli(root: string): string {
  try {
    execFileSync(process.execPath, [CLI, "decide", "choice", "--because", "evidence", "--session", "cross-host"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.fail("protected CLI mutation unexpectedly succeeded");
  } catch (error) {
    const result = error as { status?: number; stderr?: string };
    assert.equal(result.status, 2);
    return result.stderr ?? "";
  }
}

async function runProtectedLifecycle(host: HookHost, git: boolean): Promise<{ notice: string; cli: string; changed: string[] }> {
  const root = await fixture(git);
  try {
    const baseline = await snapshot(root);
    const cli = runProtectedCli(root);
    let notice: string;
    if (host === "pi") notice = await runProtectedPi(root);
    else {
      const env = { ...process.env, COHERENCE_PROJECT_ROOT: root, COHERENCE_HOOK_HOST: host, COHERENCE_SESSION: `${host}-cross-host` };
      notice = execFileSync(process.execPath, [HOOK_CLI, "SessionStart"], {
        cwd: root, env, encoding: "utf8", input: "{}", stdio: ["pipe", "pipe", "pipe"],
      });
      for (const event of ["PostToolUse", "Stop"] as const) {
        execFileSync(process.execPath, [HOOK_CLI, event], {
          cwd: root, env, encoding: "utf8",
          input: event === "PostToolUse" ? JSON.stringify({ tool_name: "Read", tool_input: { file_path: "coherence.config.json" } }) : "{}",
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
    }
    return { notice, cli, changed: snapshotDiff(baseline, await snapshot(root)) };
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("snapshot detects lifecycle additions, modifications, and deletions", async () => {
  const root = await fixture(false);
  try {
    const before = await snapshot(root);
    await writeFile(join(root, ".coherence/activity/existing.jsonl"), "modified\n");
    await rm(join(root, ".coherence/read-traces/existing.jsonl"));
    await writeFile(join(root, ".coherence/calibration/added.jsonl"), "added\n");
    assert.deepEqual(snapshotDiff(before, await snapshot(root)), [
      ".coherence/activity/existing.jsonl",
      ".coherence/calibration/added.jsonl",
      ".coherence/read-traces/existing.jsonl",
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("protected primary checkout stays read-only across CLI, Claude, Codex, and Pi", async () => {
  for (const git of [true, false]) {
    for (const host of HOOK_HOSTS) {
      const observed = await runProtectedLifecycle(host, git);
      assert.deepEqual(observed.changed, [], `${host} changed protected ${git ? "primary" : "unprovable"} evidence`);
      assert.match(observed.notice, /COHERENCE PERSISTENCE unavailable/);
      assert.match(observed.notice, git ? /protectPrimaryCheckout.*Git's primary checkout/ : /safe checkout identity could not be established/);
      assert.match(observed.cli, git ? /protected primary checkout/ : /safe Git checkout identity could not be established/);
    }
  }
});
