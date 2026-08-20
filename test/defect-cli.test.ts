// defect-cli.test.ts — the process boundary preserves direct agent defect evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { defectSessionPath, defectsDir } from "../src/defects.ts";
import { cfg, cleanup, tmpProject } from "./_helpers.ts";

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

const recordArgs = (session = "defect-owner") => [
  "defect", "the parser accepts a detached row",
  "--evidence", "moving the row to another session file still exits zero",
  "--file", "src/parser.ts",
  "--file", "test/parser.test.ts",
  "--session", session,
  "--agent", "cli-agent",
  "--job", "defect-contract",
];

test("defect CLI — write, exact retry, and strict JSON/text reads round-trip", async () => {
  const root = await tmpProject({ "src/parser.ts": "export const parser = true;\n" });
  try {
    const created = await run(root, recordArgs());
    assert.equal(created.code, 0, created.stderr);
    assert.match(created.stdout, /^def-[a-f0-9]{12}\s+agent-assessed defect recorded by defect-owner/m);

    const path = defectSessionPath(cfg(root), "defect-owner");
    assert.equal(existsSync(path), true);
    const firstBytes = await readFile(path, "utf8");
    assert.equal(firstBytes.trim().split("\n").length, 1);

    const retry = await run(root, recordArgs());
    assert.equal(retry.code, 0, retry.stderr);
    assert.equal(retry.stdout, created.stdout, "an exact process retry returns the standing record");
    assert.equal(await readFile(path, "utf8"), firstBytes, "a retry must not append duplicate evidence");

    const json = await run(root, ["defects", "--json"]);
    assert.equal(json.code, 0, json.stderr);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.defects.length, 1);
    assert.equal(parsed.defects[0].basis, "agent-assessed");
    assert.equal(parsed.defects[0].session, "defect-owner");
    assert.equal(parsed.defects[0].summary, "the parser accepts a detached row");
    assert.equal(parsed.defects[0].evidence, "moving the row to another session file still exits zero");
    assert.deepEqual(parsed.defects[0].files, ["src/parser.ts", "test/parser.test.ts"]);

    const text = await run(root, ["defects"]);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /DEFECT RECORD — agent-assessed contradictions/);
    assert.match(text.stdout, /summary: the parser accepts a detached row/);
    assert.match(text.stdout, /evidence: moving the row to another session file still exits zero/);
    assert.match(text.stdout, /basis: agent-assessed — .*does not claim machine proof/);
  } finally { await cleanup(root); }
});

test("defects CLI — ambient writer attribution never narrows the fleet-wide read", async () => {
  const root = await tmpProject();
  try {
    await run(root, recordArgs("session-one"));
    await run(root, [
      "defect", "the second failure", "--evidence", "a second reproducer",
      "--session", "session-two", "--agent", "cli-agent", "--job", "defect-contract",
    ]);
    const ambient = { ...cleanEnv(), CODEX_THREAD_ID: "ambient-codex-thread" };

    const fleet = await run(root, ["defects", "--json"], ambient);
    assert.equal(fleet.code, 0, fleet.stderr);
    assert.deepEqual(JSON.parse(fleet.stdout).defects.map(
      (defect: { session: string }) => defect.session,
    ).sort(), ["session-one", "session-two"],
    "ambient session identity attributes writes but must not hide other sessions' evidence");

    const narrowed = await run(root, ["defects", "--session", "session-one", "--json"], ambient);
    assert.equal(narrowed.code, 0, narrowed.stderr);
    assert.deepEqual(JSON.parse(narrowed.stdout).defects.map(
      (defect: { session: string }) => defect.session,
    ), ["session-one"], "only an explicit --session narrows the merged defect view");
  } finally { await cleanup(root); }
});

test("defect CLI — writer attribution resolves explicit, coherence, then Codex session precedence", async () => {
  const root = await tmpProject();
  const withoutSession = recordArgs().filter((arg, index, all) =>
    arg !== "--session" && all[index - 1] !== "--session");
  try {
    const both = { ...cleanEnv(), COHERENCE_SESSION: "coherence-env", CODEX_THREAD_ID: "codex-env" };
    const coherence = await run(root, withoutSession, both);
    assert.equal(coherence.code, 0);
    assert.match(coherence.stdout, /recorded by coherence-env$/m);

    const codexOnly = { ...cleanEnv(), CODEX_THREAD_ID: "codex-env" };
    const codex = await run(root, withoutSession, codexOnly);
    assert.equal(codex.code, 0);
    assert.match(codex.stdout, /recorded by codex-env$/m);

    const explicit = await run(root, recordArgs("explicit-session"), both);
    assert.equal(explicit.code, 0);
    assert.match(explicit.stdout, /recorded by explicit-session$/m);
    const fleet = JSON.parse((await run(root, ["defects", "--json"])).stdout);
    assert.deepEqual(fleet.defects.map((defect: { session: string }) => defect.session).sort(),
      ["codex-env", "coherence-env", "explicit-session"],
      "--session wins over COHERENCE_SESSION, which wins over CODEX_THREAD_ID");
  } finally { await cleanup(root); }
});

test("defect CLI — attribution resolves explicit, environment, then host and repository defaults", async () => {
  const root = await tmpProject({ "tracked.txt": "settled\n" });
  const withoutAttribution = recordArgs().filter((arg, index, all) =>
    arg !== "--agent" && all[index - 1] !== "--agent"
    && arg !== "--job" && all[index - 1] !== "--job");
  const withSession = (args: string[], session: string) => args.map((arg, index, all) =>
    all[index - 1] === "--session" ? session : arg);
  try {
    await exec("git", ["init", "-b", "main"], { cwd: root });
    await exec("git", ["config", "user.email", "coherence-test@example.invalid"], { cwd: root });
    await exec("git", ["config", "user.name", "Coherence Test"], { cwd: root });
    await exec("git", ["add", "tracked.txt"], { cwd: root });
    await exec("git", ["commit", "-m", "fixture"], { cwd: root });
    const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();

    const ambient = {
      ...cleanEnv(), CODEX_THREAD_ID: "codex-thread", COHERENCE_AGENT: "environment-agent",
      COHERENCE_JOB: "environment-job",
    };
    const fromEnvironment = await run(root, withSession(withoutAttribution, "environment-owner"), ambient);
    assert.equal(fromEnvironment.code, 0, fromEnvironment.stderr);
    const explicit = await run(root, withSession(recordArgs(), "explicit-owner"), ambient);
    assert.equal(explicit.code, 0, explicit.stderr);
    const fromDefaults = await run(root, withSession(withoutAttribution, "default-owner"), {
      ...cleanEnv(), CODEX_THREAD_ID: "codex-thread",
    });
    assert.equal(fromDefaults.code, 0, fromDefaults.stderr);

    const rows = JSON.parse((await run(root, ["defects", "--json"])).stdout).defects as Array<{
      session: string; agent: string; job: string;
      repo: { branch: string | null; commit: string | null; dirty: boolean | null };
    }>;
    const bySession = new Map(rows.map((row) => [row.session, row]));
    assert.deepEqual(
      { agent: bySession.get("environment-owner")?.agent, job: bySession.get("environment-owner")?.job },
      { agent: "environment-agent", job: "environment-job" },
      "COHERENCE_AGENT and COHERENCE_JOB outrank Codex and repository-derived defaults",
    );
    assert.deepEqual(
      { agent: bySession.get("explicit-owner")?.agent, job: bySession.get("explicit-owner")?.job },
      { agent: "cli-agent", job: "defect-contract" },
      "explicit --agent and --job outrank their environment values",
    );
    assert.deepEqual(
      { agent: bySession.get("default-owner")?.agent, job: bySession.get("default-owner")?.job },
      { agent: "codex", job: "main" },
      "Codex identity and the current branch are the final CLI attribution defaults",
    );
    assert.deepEqual(bySession.get("environment-owner")?.repo,
      { branch: "main", commit: head, dirty: false },
      "the first write captures a real clean git snapshot at the process boundary");
    assert.deepEqual(bySession.get("default-owner")?.repo,
      { branch: "main", commit: head, dirty: true },
      "later untracked ledger bytes are honestly reflected in the next git snapshot");
  } finally { await cleanup(root); }
});

test("defect CLI — filesystem-equivalent distinct sessions append safely in parallel", async () => {
  const root = await tmpProject();
  const sessions = ["Agent-\u00c5", "agent-A\u030a"];
  const args = (session: string, ordinal: number) => [
    "defect", `parallel failure ${ordinal}`,
    "--evidence", `parallel reproducer ${ordinal}`,
    "--session", session,
    "--agent", "parallel-agent",
    "--job", "parallel-contract",
  ];
  try {
    const results = await Promise.all(sessions.map((session, index) => run(root, args(session, index))));
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    const rows = JSON.parse((await run(root, ["defects", "--json"])).stdout).defects as Array<{ session: string }>;
    assert.deepEqual(rows.map((row) => row.session).sort(), [...sessions].sort(),
      "neither concurrent writer loses or absorbs the other session's row");

    const files = (await readdir(defectsDir(cfg(root)))).filter((name) => name.endsWith(".jsonl"));
    assert.equal(files.length, 2);
    assert.equal(new Set(files.map((name) => name.normalize("NFD").toLowerCase())).size, 2,
      "the two append targets remain distinct under portable filesystem equivalence");
    assert.deepEqual(files.sort(), sessions.map((session) => basename(defectSessionPath(cfg(root), session))).sort());
  } finally { await cleanup(root); }
});

test("defect CLI — invalid arguments refuse before creating ledger residue", async () => {
  const root = await tmpProject();
  try {
    const invalid = [
      ["defect", "--evidence", "proof", "--session", "owner"],
      ["defect", "failure", "--session", "owner"],
      ["defect", "failure", "--evidence", "proof"],
      ["defect", "failure", "--evidence", "proof", "--session", " owner "],
      ["defect", "failure", "--evidence", "", "--session", "owner"],
      ["defect", "failure", "--evidence", "--session", "owner"],
      ["defect", "failure", "--evidence", "proof", "--session"],
      ["defect", "failure", "--evidence", "proof", "--session", "one", "--session", "two"],
      ["defect", "failure", "--evidence", "one", "--evidence", "two", "--session", "owner"],
      ["defect", "failure", "--evidence", "proof", "--session", "owner", "--unknown"],
      ["defect", "failure", "--evidence", "proof", "--session", "owner", "--file", "../outside.ts"],
    ];
    for (const args of invalid) {
      const result = await run(root, args);
      assert.equal(result.code, 2, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    }
    assert.equal(existsSync(join(root, ".coherence", "defects")), false,
      "argument and path refusals must happen before the append directory exists");

    for (const args of [
      ["defects", "--session"],
      ["defects", "--session", "   "],
      ["defects", "--session", " owner "],
      ["defects", "--session", "one", "--session", "two"],
      ["defects", "--unknown"],
      ["defects", "unexpected"],
    ]) {
      const result = await run(root, args);
      assert.equal(result.code, 2, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    }
    assert.equal(existsSync(join(root, ".coherence", "defects")), false);
  } finally { await cleanup(root); }
});

test("defects CLI — malformed and internally inconsistent history refuse in text and JSON", async () => {
  const root = await tmpProject();
  try {
    const created = await run(root, recordArgs());
    assert.equal(created.code, 0, created.stderr);
    const path = defectSessionPath(cfg(root), "defect-owner");
    const valid = await readFile(path, "utf8");

    await writeFile(path, valid + '{"version":1\n');
    const malformed = await run(root, ["defects"]);
    assert.equal(malformed.code, 2);
    assert.match(malformed.stderr, /malformed JSON/);
    assert.doesNotMatch(malformed.stdout, /no recorded defects/,
      "damaged evidence must never collapse into an empty successful report");

    const row = JSON.parse(valid.trim());
    row.summary = "edited after the fact";
    await writeFile(path, JSON.stringify(row) + "\n");
    const tampered = await run(root, ["defects", "--json"]);
    assert.equal(tampered.code, 2);
    const refusal = JSON.parse(tampered.stdout);
    assert.match(refusal.error, /id does not match defect content/);
    assert.match(refusal.usage, /coherence defects/);
  } finally { await cleanup(root); }
});
