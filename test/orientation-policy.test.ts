import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { cleanup, tmpProject } from "./_helpers.ts";

const exec = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");

type Heading =
  | "refuse"
  | "resolve-conflict"
  | "repair-navigation"
  | "unblock"
  | "synthesize"
  | "dispatch"
  | "continue"
  | "verify"
  | "steady";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(root: string, args: string[]): Promise<RunResult> {
  return exec(process.execPath, [CLI, ...args], {
    cwd: root,
    env: { ...process.env, COHERENCE_SESSION: "" },
  }).then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch((error: { code: number; stdout: string; stderr: string }) => ({
      code: error.code, stdout: error.stdout, stderr: error.stderr,
    }));
}

async function succeeds(root: string, args: string[]): Promise<void> {
  const result = await run(root, args);
  assert.equal(result.code, 0, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
}

const workBase = (id: string, objective: string): string[] => [
  "work", "create", objective, "--id", id, "--success", `${objective} is done`,
  "--risk", "medium", "--authority", "orchestrator-delegated", "--granted-by", "policy-test",
  "--boundary", "this disposable orientation fixture", "--session", `owner-${id}`, "--json",
];

async function openWork(root: string, id: string, objective: string): Promise<void> {
  await succeeds(root, workBase(id, objective));
}

async function activeWork(root: string, id: string, objective: string): Promise<void> {
  await openWork(root, id, objective);
  await succeeds(root, [
    "work", "transition", id, "active", "--because", "policy fixture started",
    "--session", `owner-${id}`, "--json",
  ]);
}

async function completedWork(root: string, id: string, objective: string): Promise<void> {
  await activeWork(root, id, objective);
  await succeeds(root, [
    "work", "close", id, "completed", "--because", "policy fixture completed",
    "--evidence", "seeded completion evidence", "--session", `owner-${id}`, "--json",
  ]);
}

async function seedSynthesis(root: string): Promise<void> {
  await activeWork(root, "wrk-synth-parent", "join completed child");
  await succeeds(root, [
    ...workBase("wrk-synth-child", "produce child result"),
    "--parent", "wrk-synth-parent",
  ]);
  await succeeds(root, [
    "work", "transition", "wrk-synth-child", "active", "--because", "child started",
    "--session", "owner-wrk-synth-child", "--json",
  ]);
  await succeeds(root, [
    "work", "close", "wrk-synth-child", "completed", "--because", "child completed",
    "--evidence", "child result exists", "--session", "owner-wrk-synth-child", "--json",
  ]);
}

const seeds: Record<Heading, (root: string) => Promise<void>> = {
  steady: async () => {},
  dispatch: async (root) => openWork(root, "wrk-dispatch", "dispatch ready work"),
  continue: async (root) => activeWork(root, "wrk-continue", "continue active work"),
  verify: async (root) => completedWork(root, "wrk-verify", "verify completed work"),
  unblock: async (root) => {
    await openWork(root, "wrk-blocked", "unblock paused work");
    await succeeds(root, [
      "work", "transition", "wrk-blocked", "blocked", "--because", "seeded blocker",
      "--session", "owner-wrk-blocked", "--json",
    ]);
  },
  synthesize: seedSynthesis,
  "repair-navigation": async (root) => {
    await succeeds(root, [
      "consequence", "add", "work:wrk-nav-origin", "depends-on", "work:wrk-nav-missing",
      "--evidence", "seed a dangling address", "--session", "navigator", "--json",
    ]);
  },
  "resolve-conflict": async (root) => {
    for (const [choice, alternative, session] of [
      ["mutex", "compare-and-swap", "proposal-a"],
      ["compare-and-swap", "mutex", "proposal-b"],
    ]) {
      await succeeds(root, [
        "decide", choice, "--over", alternative, "--because", "seeded competing evidence",
        "--subject", "policy/concurrency", "--authority", "local-proposal",
        "--work", "wrk-policy", "--session", session,
      ]);
    }
  },
  refuse: async (root) => {
    await mkdir(join(root, ".coherence", "decisions"), { recursive: true });
    await writeFile(join(root, ".coherence", "decisions", "broken.jsonl"), "{torn\n");
  },
};

async function assertHeading(root: string, expected: Heading, human = false): Promise<void> {
  const expectedCode = expected === "refuse" ? 2 : 0;
  const result = await run(root, ["orient", "--json"]);
  assert.equal(result.code, expectedCode, result.stderr);
  const reading = JSON.parse(result.stdout) as { action: Heading; sources: Array<{ ok: boolean }> };
  assert.equal(reading.action, expected);
  assert.equal(reading.sources.some((source) => !source.ok), expected === "refuse");
  if (human) {
    const rendered = await run(root, ["orient"]);
    assert.equal(rendered.code, expectedCode, rendered.stderr);
    assert.equal(rendered.stdout.split("\n", 1)[0], `ORIENTATION ${expected.toUpperCase()}`);
  }
}

const priority: Heading[] = [
  "refuse", "resolve-conflict", "repair-navigation", "unblock", "synthesize",
  "dispatch", "continue", "verify", "steady",
];

for (const heading of priority) {
  test(`orientation public CLI materializes ${heading}`, async () => {
    const root = await tmpProject({ "coherence.config.json": "{}\n" });
    try {
      await seeds[heading](root);
      await assertHeading(root, heading, true);
    } finally { await cleanup(root); }
  });
}

// Every stronger/weaker pair is independently materialized through public commands.
// That makes the priority claim a live oracle over all 36 combinations, not a restatement
// of the branch order in orient.ts. Synthesis eligibility has its own sibling table below.
for (let stronger = 0; stronger < priority.length - 1; stronger++) {
  for (let weaker = stronger + 1; weaker < priority.length; weaker++) {
    const expected = priority[stronger]!;
    const lower = priority[weaker]!;
    test(`orientation priority: ${expected} dominates ${lower}`, async () => {
      const root = await tmpProject({ "coherence.config.json": "{}\n" });
      try {
        await seeds[expected](root);
        await seeds[lower](root);
        await assertHeading(root, expected);
      } finally { await cleanup(root); }
    });
  }
}

async function seedPendingSynthesisWithSibling(
  root: string,
  siblingState: "open" | "active" | "blocked",
): Promise<void> {
  await activeWork(root, "wrk-join", "join dependent siblings");
  await succeeds(root, [
    ...workBase("wrk-a", "produce prerequisite"), "--parent", "wrk-join",
  ]);
  await succeeds(root, [
    ...workBase("wrk-b", "consume prerequisite"), "--parent", "wrk-join", "--depends-on", "wrk-a",
  ]);
  await succeeds(root, [
    "work", "transition", "wrk-a", "active", "--because", "A started",
    "--session", "owner-wrk-a", "--json",
  ]);
  await succeeds(root, [
    "work", "close", "wrk-a", "completed", "--because", "A completed",
    "--evidence", "A result exists", "--session", "owner-wrk-a", "--json",
  ]);
  if (siblingState !== "open") {
    await succeeds(root, [
      "work", "transition", "wrk-b", siblingState, "--because", `B is ${siblingState}`,
      "--session", "owner-wrk-b", "--json",
    ]);
  }
}

for (const [state, expected] of [
  ["open", "dispatch"],
  ["active", "continue"],
  ["blocked", "unblock"],
] as const) {
  test(`pending synthesis yields to its ${state} sibling via ${expected}`, async () => {
    const root = await tmpProject({ "coherence.config.json": "{}\n" });
    try {
      await seedPendingSynthesisWithSibling(root, state);
      await assertHeading(root, expected, true);
      const inspected = await run(root, ["work", "inspect", "wrk-join", "--json"]);
      assert.equal(inspected.code, 0, inspected.stderr);
      assert.deepEqual(JSON.parse(inspected.stdout).unsynthesized, [
        { parent: "wrk-join", child: "wrk-a", reason: "parent-not-closed" },
      ]);
    } finally { await cleanup(root); }
  });
}
