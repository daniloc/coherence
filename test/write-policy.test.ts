import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { classifyGitCheckout, lifecyclePersistenceNotice, projectWritePolicy, writeRefusal, type GitRunner } from "../src/write-policy.ts";
import type { Config } from "../src/types.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
const cfg = (root: string, protectPrimaryCheckout = false): Pick<Config, "root" | "protectPrimaryCheckout"> => ({ root, protectPrimaryCheckout });

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "coh-policy-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "test\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  return root;
}

test("write policy protects Git's primary checkout and permits its linked worktree", async () => {
  const primary = await repository();
  const linked = join(dirname(primary), "linked");
  const unusual = join(dirname(primary), "linked with embedded\nnewline and trailing space ");
  try {
    git(primary, "worktree", "add", "-q", "-b", "feature", linked);
    git(primary, "worktree", "add", "-q", "-b", "unusual", unusual);
    const protectedPolicy = projectWritePolicy(cfg(primary, true));
    assert.equal(protectedPolicy.state, "protected-primary");
    assert.match(lifecyclePersistenceNotice(protectedPolicy)!, /protectPrimaryCheckout.*Git's primary checkout/);
    assert.equal(projectWritePolicy(cfg(linked, true)).state, "linked");
    assert.equal(projectWritePolicy(cfg(unusual, true)).state, "linked");
  } finally {
    await rm(primary, { recursive: true, force: true });
    await rm(linked, { recursive: true, force: true });
    await rm(unusual, { recursive: true, force: true });
  }
});

test("write policy keeps existing projects writable by default", async () => {
  const root = await repository();
  try {
    const policy = projectWritePolicy(cfg(root));
    assert.equal(policy.state, "disabled");
    assert.equal(policy.writable, true);
    assert.equal(policy.identity.reason, "protection disabled");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("write policy refuses when protected checkout identity is unprovable", async () => {
  const root = await mkdtemp(join(tmpdir(), "coh-policy-"));
  try {
    const policy = projectWritePolicy(cfg(root, true));
    assert.equal(policy.state, "unprovable");
    assert.equal(policy.writable, false);
    assert.match(writeRefusal(policy, "decision append")!.join("\n"), /safe Git checkout identity could not be established/);
    assert.match(writeRefusal(policy, "decision append")!.join("\n"), /registered linked worktree/);
    assert.match(lifecyclePersistenceNotice(policy)!, /^COHERENCE PERSISTENCE unavailable:/);
    assert.match(lifecyclePersistenceNotice(policy)!, /safe checkout identity could not be established/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator output quotes paths and neutralizes every terminal-control range", () => {
  const policy = {
    state: "protected-primary" as const, writable: false,
    identity: { kind: "primary" as const, topLevel: "/tmp/control\u001b[31m\u007f\u009b" },
  };
  const lines = [...writeRefusal(policy, "coherence decide")!, lifecyclePersistenceNotice(policy)!];
  const output = lines.join("\n");
  assert.match(output, /protected primary checkout/);
  assert.match(output, /"\/tmp\/control\\u001b\[31m\\u007f\\u009b"/);
  for (const line of lines) assert.doesNotMatch(line, /[\x00-\x1f\x7f-\x9f]/);
});

test("unprovable operator output names an available terminal-safe Git top-level", () => {
  const policy = {
    state: "unprovable" as const, writable: false,
    identity: { kind: "unknown" as const, topLevel: "/tmp/resolved\u009b", reason: "registration mismatch" },
  };
  const lines = [...writeRefusal(policy, "coherence decide")!, lifecyclePersistenceNotice(policy)!];
  const output = lines.join("\n");
  assert.match(output, /safe (?:Git )?checkout identity could not be established/);
  assert.match(output, /at "\/tmp\/resolved\\u009b"/);
  for (const line of lines) assert.doesNotMatch(line, /[\x00-\x1f\x7f-\x9f]/);
});

test("classifier accepts nested and canonical-equivalent roots", async () => {
  const root = await repository();
  try {
    await mkdir(join(root, "nested"));
    assert.equal(classifyGitCheckout(join(root, "." )).kind, "primary");
    assert.equal(classifyGitCheckout(join(root, "nested"), ((args, cwd) => {
      if (args[0] === "rev-parse") return root + "\n";
      return `worktree ${root}\0HEAD abc\0\0`;
    }) as GitRunner).kind, "primary");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a real submodule is classified as its own primary checkout", async () => {
  const parent = await repository();
  const child = await repository();
  try {
    git(parent, "-c", "protocol.file.allow=always", "submodule", "add", "-q", child, "sub");
    git(parent, "commit", "-qm", "add submodule");
    assert.deepEqual(classifyGitCheckout(join(parent, "sub")), { kind: "primary", topLevel: join(parent, "sub") });
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(child, { recursive: true, force: true });
  }
});

test("classifier preserves NUL-delimited worktree path bytes", async () => {
  const root = await repository();
  const unusual = join(dirname(root), "linked with embedded\nnewline and trailing space ");
  try {
    await mkdir(unusual);
    const nulRunner: GitRunner = (args) => args[0] === "rev-parse"
      ? `${unusual}\n`
      : `worktree ${root}\0HEAD primary\0\0worktree ${unusual}\0HEAD linked\0\0`;
    const lineRunner: GitRunner = (args) => {
      if (args[0] === "rev-parse") return `${unusual}\n`;
      if (args.includes("-z")) throw new Error("older Git");
      return `worktree ${root}\nHEAD primary\n\nworktree ${JSON.stringify(unusual)}\nHEAD linked\n\n`;
    };
    assert.deepEqual(classifyGitCheckout(unusual, nulRunner), { kind: "linked", topLevel: unusual });
    assert.deepEqual(classifyGitCheckout(unusual, lineRunner), { kind: "linked", topLevel: unusual });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(unusual, { recursive: true, force: true });
  }
});

test("classifier refuses malformed or missing worktree identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "coh-policy-"));
  try {
    const cases = ["", `worktree ${root}\0branch refs/heads/main\0`, `worktree ${join(root, "other")}\0HEAD x\0`];
    for (const listing of cases) {
      const runner: GitRunner = (args) => args[0] === "rev-parse" ? root + "\n" : listing;
      assert.equal(classifyGitCheckout(root, runner).kind, "unknown");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
