import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tmpProject } from "./_helpers.ts";

const exec = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");

async function run(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return exec(process.execPath, [CLI, ...args], { cwd: root, env: { ...process.env, COHERENCE_SESSION: "" } })
    .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch((error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
}

test("work CLI carries authority through lifecycle and orientation demands explicit verification", async () => {
  const root = await tmpProject({ "coherence.config.json": "{}\n" });
  try {
    const opened = await run(root, [
      "work", "create", "build the control", "--id", "wrk-root", "--success", "focused suite passes",
      "--risk", "high", "--authority", "user-directed", "--granted-by", "user",
      "--boundary", "the requested project", "--session", "worker", "--write-scope", "src/**", "--json",
    ]);
    assert.equal(opened.code, 0, opened.stderr);
    assert.equal(JSON.parse(opened.stdout).work, "wrk-root");

    const active = await run(root, ["work", "transition", "wrk-root", "active", "--because", "started", "--session", "worker", "--json"]);
    assert.equal(active.code, 0, active.stderr);
    assert.equal(JSON.parse(active.stdout).to, "active");

    const evidenceFree = await run(root, ["work", "close", "wrk-root", "completed", "--because", "done", "--session", "worker", "--json"]);
    assert.equal(evidenceFree.code, 2);
    assert.match(JSON.parse(evidenceFree.stdout).error, /requires at least one resultEvidence item/);

    const closed = await run(root, [
      "work", "close", "wrk-root", "completed", "--because", "done", "--evidence", "focused suite passed",
      "--session", "worker", "--json",
    ]);
    assert.equal(closed.code, 0, closed.stderr);

    const unverified = await run(root, ["orient", "--json"]);
    assert.equal(unverified.code, 0, unverified.stderr);
    assert.equal(JSON.parse(unverified.stdout).action, "verify");

    const linked = await run(root, [
      "consequence", "add", "verification:verify-focused", "verifies", "work:wrk-root",
      "--evidence", "the focused suite passed after the change", "--session", "reviewer", "--json",
    ]);
    assert.equal(linked.code, 0, linked.stderr);
    assert.equal(JSON.parse(linked.stdout).relation, "verifies");
    const settled = JSON.parse((await run(root, ["orient", "--json"])).stdout);
    assert.equal(settled.action, "steady");
    assert.deepEqual(settled.consequences.unverifiedCompletedWork, []);
  } finally { await cleanup(root); }
});

test("structured decision CLI exposes proposal conflict and explicit ratification", async () => {
  const root = await tmpProject({ "coherence.config.json": "{}\n" });
  try {
    for (const [choice, session] of [["sqlite", "a"], ["postgres", "b"]]) {
      const result = await run(root, [
        "decide", choice, "--over", choice === "sqlite" ? "postgres" : "sqlite", "--because", "measured tradeoff",
        "--subject", "storage", "--authority", "local-proposal", "--work", "wrk-root", "--session", session,
      ]);
      assert.equal(result.code, 0, result.stderr);
    }
    const conflicted = JSON.parse((await run(root, ["orient", "--json"])).stdout);
    assert.equal(conflicted.action, "resolve-conflict");
    assert.deepEqual(conflicted.decisions.needsRatification, ["storage"]);

    const accepted = await run(root, [
      "decide", "postgres", "--over", "sqlite", "--because", "the orchestrator accepted the measured fit",
      "--subject", "storage", "--authority", "orchestrator-accepted", "--work", "wrk-root", "--session", "main",
      "--scope-component", "Harness core",
    ]);
    assert.equal(accepted.code, 0, accepted.stderr);
    const oriented = JSON.parse((await run(root, ["orient", "--json"])).stdout);
    assert.equal(oriented.decisions.positions[0].state, "ratified");
    assert.equal(oriented.decisions.positions[0].selected.authority, "orchestrator-accepted");
  } finally { await cleanup(root); }
});

test("swarm CLI refusals are structured and leave no silent no-op", async () => {
  const root = await tmpProject({ "coherence.config.json": "{}\n" });
  try {
    const badAuthority = await run(root, [
      "work", "create", "x", "--success", "y", "--risk", "low", "--authority", "guess",
      "--granted-by", "nobody", "--boundary", "none", "--session", "s", "--json",
    ]);
    assert.equal(badAuthority.code, 2);
    assert.match(JSON.parse(badAuthority.stdout).error, /--authority/);
    const badRelation = await run(root, [
      "consequence", "add", "defect:def-123456789abc", "authorizes", "commit:abc",
      "--evidence", "none", "--session", "s", "--json",
    ]);
    assert.equal(badRelation.code, 2);
    assert.match(JSON.parse(badRelation.stdout).error, /does not admit/);
  } finally { await cleanup(root); }
});

test("swarm writes reject repeated singleton identity and authority flags before append", async () => {
  const root = await tmpProject({ "coherence.config.json": "{}\n" });
  try {
    const repeatedWork = await run(root, [
      "work", "create", "ambiguous owner", "--success", "never appended", "--risk", "low",
      "--authority", "agent-local", "--granted-by", "one", "--granted-by", "two",
      "--boundary", "local", "--session", "one", "--session", "two", "--json",
    ]);
    assert.equal(repeatedWork.code, 2);
    assert.match(JSON.parse(repeatedWork.stdout).error, /repeated singleton flag.*--granted-by.*--session/);

    const repeatedConsequence = await run(root, [
      "consequence", "add", "work:wrk-a", "produces", "commit:abcdef1",
      "--evidence", "one", "--session", "one", "--session", "two", "--json",
    ]);
    assert.equal(repeatedConsequence.code, 2);
    assert.match(JSON.parse(repeatedConsequence.stdout).error, /repeated singleton flag.*--session/);

    const repeatedDecision = await run(root, [
      "decide", "one", "--because", "ambiguous authority must not append",
      "--subject", "storage", "--authority", "local-proposal", "--authority", "user-directed",
      "--session", "one",
    ]);
    assert.equal(repeatedDecision.code, 2);
    assert.match(repeatedDecision.stderr, /repeated singleton flag.*--authority/);

    const work = await run(root, ["work", "inspect", "--json"]);
    assert.equal(work.code, 0, work.stderr);
    assert.equal(JSON.parse(work.stdout).stats.total, 0);
    const oriented = await run(root, ["orient", "--json"]);
    assert.equal(JSON.parse(oriented.stdout).decisions.standing, 0);
    assert.equal(JSON.parse(oriented.stdout).consequences.links, 0);
  } finally { await cleanup(root); }
});
