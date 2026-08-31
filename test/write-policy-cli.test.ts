import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

async function git(cwd: string, ...args: string[]) {
  await exec("git", args, { cwd });
}
async function run(cwd: string, args: string[]) {
  try {
    const result = await exec(process.execPath, [CLI, ...args], { cwd });
    return { code: 0, ...result };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: Number(e.code), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "coh-policy-"));
  await mkdir(join(root, "app"), { recursive: true });
  await writeFile(join(root, "app", "app.ts"), "export const app = true;\n");
  await writeFile(join(root, "coherence.config.json"), '{"protectPrimaryCheckout":true}\n');
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "user.email", "test@example.invalid");
  await git(root, "config", "user.name", "test");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "fixture");
  const linked = join(root, "linked");
  await git(root, "worktree", "add", "-q", "-b", "linked", linked);
  return { root, linked };
}

test("protected primary refuses explicit writes before dispatch but permits reads and linked writes", async () => {
  const { root, linked } = await fixture();
  try {
    const rejected = await run(root, ["decide", "choice", "--because", "evidence", "--session", "s"]);
    assert.equal(rejected.code, 2);
    assert.match(rejected.stderr, /protected primary checkout/);
    assert.equal(existsSync(join(root, ".coherence", "decisions")), false);

    const read = await run(root, ["decisions"]);
    assert.equal(read.code, 0, read.stderr);

    const install = await run(root, ["hooks", "install"]);
    assert.equal(install.code, 2);
    assert.equal(existsSync(join(root, ".claude")), false);

    const graph = await run(root, ["graph"]);
    assert.equal(graph.code, 2);
    assert.equal(existsSync(join(root, "public")), false);
    const graphCheck = await run(root, ["graph", "--check"]);
    assert.notEqual(graphCheck.code, 2, graphCheck.stderr);

    const accepted = await run(linked, ["decide", "choice", "--because", "evidence", "--session", "s"]);
    assert.equal(accepted.code, 0, accepted.stderr);
    assert.equal(existsSync(join(linked, ".coherence", "decisions", "s.jsonl")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
