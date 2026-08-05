// experiment-cli.test.ts — the process boundary preserves the ledger's strict contract.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { cleanup, tmpProject } from "./_helpers.ts";

const exec = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");
const cleanEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.COHERENCE_SESSION;
  delete env.COHERENCE_AGENT;
  delete env.COHERENCE_JOB;
  delete env.CODEX_THREAD_ID;
  return env;
};

async function run(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv = cleanEnv(),
): Promise<{ code: number; stdout: string; stderr: string }> {
  return exec(process.execPath, [CLI, ...args], { cwd: root, env })
    .then((result) => ({ code: 0, stdout: result.stdout, stderr: result.stderr }))
    .catch((error: { code: number; stdout: string; stderr: string }) => ({
      code: error.code, stdout: error.stdout, stderr: error.stderr,
    }));
}

const createArgs = (session = "owner-cli") => [
  "experiment", "create", "one boundary removes the repeated branch",
  "--context", "src/a.ts",
  "--action", "replace both branches",
  "--success", "the focused contract passes",
  "--session", session,
  "--agent", "cli-agent",
  "--job", "cli-contract",
  "--json",
];

test("experiment CLI — create, alias inspect, close, retry, and open lens round-trip", async () => {
  const root = await tmpProject({ "src/a.ts": "export const a = 1;\n" });
  try {
    const createdRun = await run(root, createArgs());
    assert.equal(createdRun.code, 0, createdRun.stderr);
    const opened = JSON.parse(createdRun.stdout);
    assert.match(opened.id, /^e-[a-f0-9]{12}$/);
    assert.equal(opened.session, "owner-cli");
    assert.equal(existsSync(join(root, ".coherence", "experiments", "owner-cli.jsonl")), true);

    const inspected = await run(root, ["plan", "inspect", opened.id, "--json"]);
    assert.equal(inspected.code, 0, inspected.stderr);
    const before = JSON.parse(inspected.stdout);
    assert.equal(before.experiments.length, 1);
    assert.equal(before.experiments[0].opened.id, opened.id);
    assert.equal(before.experiments[0].closed, null);

    const closeArgs = [
      "experiment", "close", opened.id,
      "--action-result", "a1=followed::the diff shows both callers changed",
      "--result", "s1=unmet::the focused contract still reports one failure",
      "--session", "assessor-cli",
      "--agent", "cli-reviewer",
      "--job", "cli-contract",
      "--json",
    ];
    const closedRun = await run(root, closeArgs);
    assert.equal(closedRun.code, 0, closedRun.stderr);
    const closed = JSON.parse(closedRun.stdout);
    assert.equal(closed.outcome, "failure", "the process accepts no outcome flag; criteria derive it");
    assert.equal(closed.ownerSession, "owner-cli");
    assert.equal(closed.assessor.session, "assessor-cli");
    assert.equal(existsSync(join(root, ".coherence", "calibration")), false,
      "closing through the CLI must not translate failure into a defect label");

    const retry = await run(root, closeArgs);
    assert.equal(retry.code, 0, retry.stderr);
    assert.equal(JSON.parse(retry.stdout).id, closed.id, "an exact process retry returns the frozen close");

    const openOnly = await run(root, ["experiment", "inspect", "--open", "--json"]);
    assert.equal(openOnly.code, 0, openOnly.stderr);
    assert.deepEqual(JSON.parse(openOnly.stdout).experiments, []);

    const changed = await run(root, closeArgs.map((arg) => arg.includes("still reports")
      ? "s1=met::the focused contract now passes" : arg));
    assert.equal(changed.code, 2);
    assert.match(JSON.parse(changed.stdout).error, /already closed by immutable record/);
  } finally { await cleanup(root); }
});

test("experiment CLI — ambient Codex identity attributes writers but never narrows inspect", async () => {
  const root = await tmpProject({ "src/a.ts": "export const a = 1;\n" });
  try {
    const first = JSON.parse((await run(root, createArgs("owner-one"))).stdout);
    const second = JSON.parse((await run(root, createArgs("owner-two"))).stdout);
    const ambient = { ...cleanEnv(), CODEX_THREAD_ID: "ambient-codex-thread" };

    const fleet = await run(root, ["experiment", "inspect", "--json"], ambient);
    assert.equal(fleet.code, 0, fleet.stderr);
    assert.deepEqual(JSON.parse(fleet.stdout).experiments.map(
      (experiment: { opened: { id: string } }) => experiment.opened.id,
    ).sort(), [first.id, second.id].sort(), "ambient writer identity must not hide other sessions' loops");

    const narrowed = await run(root, [
      "experiment", "inspect", "--session", "owner-one", "--json",
    ], ambient);
    assert.equal(narrowed.code, 0, narrowed.stderr);
    assert.deepEqual(JSON.parse(narrowed.stdout).experiments.map(
      (experiment: { opened: { id: string } }) => experiment.opened.id,
    ), [first.id], "only an explicit --session narrows the merged experiment view");
  } finally { await cleanup(root); }
});

test("experiment CLI — missing values, repeated identity, and malformed evidence refuse before append", async () => {
  const root = await tmpProject({ "src/a.ts": "export const a = 1;\n" });
  try {
    for (const args of [
      createArgs().filter((arg, index, all) => arg !== "--session" && all[index - 1] !== "--session"),
      [...createArgs().slice(0, -1), "--session", "--json"],
      [...createArgs().slice(0, -1), "--session", "other", "--json"],
    ]) {
      const result = await run(root, args);
      assert.equal(result.code, 2, `${args.join(" ")}\n${result.stderr}`);
      const error = JSON.parse(result.stdout);
      assert.match(error.error, /exact host session|missing value|repeatable identity/);
    }
    assert.equal(existsSync(join(root, ".coherence", "experiments")), false,
      "argument-boundary refusals must not create ledger residue");

    const created = JSON.parse((await run(root, createArgs())).stdout);
    const malformed = await run(root, [
      "experiment", "close", created.id,
      "--action-result", "a1=followed::",
      "--result", "s1=met::evidence",
      "--session", "assessor-cli",
      "--json",
    ]);
    assert.equal(malformed.code, 2);
    assert.match(JSON.parse(malformed.stdout).error, /--action-result must be/);
  } finally { await cleanup(root); }
});
