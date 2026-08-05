// regulate-cli.test.ts — the explicit rollout surface is read-only and representation-stable.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpProject, cleanup } from "./_helpers.ts";
import { loadConfig } from "../src/config.ts";
import { setLifecycleHook } from "../src/control.ts";
import { ANTI_ENTROPY_DOCTRINE } from "../src/doctrine.ts";

const run = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");

function git(root: string, ...args: string[]) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

async function fixture(): Promise<string> {
  const root = await tmpProject({
    "coherence.config.json": JSON.stringify({
      entryDir: "app", codeExt: ["ts"], language: "typescript", platform: null,
    }),
    "package.json": JSON.stringify({ name: "coherence-harness" }),
    "src/hook-cli.ts": "export const hookTarget = true;\n",
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

test("regulate CLI — report and check expose the same read-only decision", async () => {
  const root = await fixture();
  try {
    const before = git(root, "status", "--porcelain").stdout;
    const report = await run(process.execPath, [CLI, "regulate", "--host", "claude", "--json"], { cwd: root });
    const first = JSON.parse(report.stdout);
    assert.equal(first.action, "redirect");
    assert.equal(first.host, "claude");
    assert.deepEqual(first.selected.command, { name: "hooks", args: ["install", "--host", "claude"] });
    assert.equal(git(root, "status", "--porcelain").stdout, before, "report mode must not repair what it observes");

    const checked = await run(process.execPath, [CLI, "regulate", "--check", "--host", "claude", "--json"], { cwd: root })
      .then((value) => ({ code: 0, stdout: value.stdout }), (error: { code: number; stdout: string }) => error);
    assert.equal(checked.code, 1);
    assert.deepEqual(JSON.parse(checked.stdout), first, "--check changes only the exit status");
    assert.equal(git(root, "status", "--porcelain").stdout, before);

    const installed = await setLifecycleHook(await loadConfig(root), true);
    assert.deepEqual(installed.errors, []);
    const installedState = git(root, "status", "--porcelain").stdout;
    const released = await run(process.execPath, [CLI, "regulate", "--check", "--host", "claude", "--json"], { cwd: root });
    assert.equal(JSON.parse(released.stdout).action, "release");
    assert.equal(git(root, "status", "--porcelain").stdout, installedState,
      "release must not stamp status or create journal residue");

    const codex = await run(process.execPath, [CLI, "regulate", "--host", "codex", "--json"], { cwd: root });
    const codexDecision = JSON.parse(codex.stdout);
    assert.equal(codexDecision.action, "redirect", "Claude control cannot redeem selected Codex regulation");
    assert.deepEqual(codexDecision.selected.command, {
      name: "hooks", args: ["install", "--host", "codex"],
    });
  } finally {
    await cleanup(root);
  }
});

test("regulate CLI — an unreadable required control observation refuses", async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(join(root, ".claude", "settings.json"), "{not json\n");
    const result = await run(process.execPath, [CLI, "regulate", "--host", "claude", "--json"], { cwd: root })
      .then((value) => ({ code: 0, stdout: value.stdout }), (error: { code: number; stdout: string }) => error);
    assert.equal(result.code, 2);
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.action, "refuse");
    assert.match(decision.selected.evidence, /settings\.json/);
    assert.equal(decision.selected.command, undefined);
  } finally {
    await cleanup(root);
  }
});

test("regulate CLI — malformed --since arguments refuse at the command boundary", async () => {
  const root = await fixture();
  try {
    for (const args of [
      ["regulate", "--since", "--json"],
      ["regulate", "--since", "HEAD", "--since", "HEAD~1", "--json"],
      ["regulate", "--host", "other", "--json"],
      ["regulate", "--host", "codex", "--host", "claude", "--json"],
    ]) {
      const result = await run(process.execPath, [CLI, ...args], { cwd: root })
        .then((value) => ({ code: 0, stdout: value.stdout }), (error: { code: number; stdout: string }) => error);
      assert.equal(result.code, 2);
      assert.match(JSON.parse(result.stdout).usage, /regulate \[--check\]/);
    }
  } finally {
    await cleanup(root);
  }
});

test("regulate CLI — an absent runnable hook target refuses instead of prescribing a doomed install", async () => {
  const root = await fixture();
  try {
    await rm(join(root, "src/hook-cli.ts"));
    const result = await run(process.execPath, [CLI, "regulate", "--host", "claude", "--json"], { cwd: root })
      .then((value) => ({ code: 0, stdout: value.stdout }), (error: { code: number; stdout: string }) => error);
    assert.equal(result.code, 2);
    const decision = JSON.parse(result.stdout);
    assert.equal(decision.action, "refuse");
    assert.equal(decision.selected.rule, "canonical-lifecycle-control");
    assert.match(decision.selected.evidence, /target is missing/);
    assert.equal(decision.selected.command, undefined);
  } finally {
    await cleanup(root);
  }
});

test("doctrine CLI — the printable document is the selector's live registry", async () => {
  const root = await tmpProject();
  try {
    const result = await run(process.execPath, [CLI, "doctrine", "--json"], { cwd: root });
    const document = JSON.parse(result.stdout);
    assert.equal(document.id, ANTI_ENTROPY_DOCTRINE.id);
    assert.deepEqual(document.potential, [...ANTI_ENTROPY_DOCTRINE.potential]);
    assert.deepEqual(document.rules.map((rule: { id: string }) => rule.id),
      ANTI_ENTROPY_DOCTRINE.rules.map((rule) => rule.id));
  } finally {
    await cleanup(root);
  }
});
