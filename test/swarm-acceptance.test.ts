// swarm-acceptance.test.ts — one black-box field journey, not an orientation policy matrix.
//
// Unit suites prove each ledger and priority rule in isolation. This journey keeps the
// sequence a real orchestrator experiences: public commands create competing obligations,
// an explicit authority settles policy, a dependency and handoff move work, a parent
// synthesizes terminal children, durable surfaces replace the transcript, and damaged
// evidence refuses until the exact bytes are restored.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tmpProject } from "./_helpers.ts";

const exec = promisify(execFile);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "src", "cli.ts");

interface RunResult { code: number; stdout: string; stderr: string }

async function run(root: string, args: string[]): Promise<RunResult> {
  return exec(process.execPath, [CLI, ...args], {
    cwd: root,
    env: { ...process.env, COHERENCE_SESSION: "", CODEX_THREAD_ID: "" },
  }).then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch((error: { code: number; stdout: string; stderr: string }) => ({
      code: error.code, stdout: error.stdout, stderr: error.stderr,
    }));
}

function parsed(result: RunResult): any {
  assert.ok(result.stdout.trim(), `expected JSON stdout; stderr: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const create = (
  id: string,
  objective: string,
  session: string,
  extra: string[] = [],
): string[] => [
  "work", "create", objective, "--id", id, "--success", `${objective} acceptance passes`,
  "--risk", "high", "--authority", "orchestrator-delegated", "--granted-by", "field-parent",
  "--boundary", "the declared canary scope only", "--owner-session", session,
  "--owner-agent", `${session}-agent`, "--session", "field-parent", ...extra, "--json",
];

test("repository control — work and consequence records survive a fresh clone", async () => {
  const container = await tmpProject();
  const source = join(container, "source");
  const clone = join(container, "clone");
  await mkdir(source);

  try {
    await writeFile(join(source, ".gitignore"), await readFile(join(REPO, ".gitignore"), "utf8"));
    await writeFile(join(source, "coherence.config.json"), "{}\n");
    for (const args of [
      ["init", "-q"],
      ["config", "user.email", "swarm-clone@example.invalid"],
      ["config", "user.name", "swarm clone guard"],
      ["config", "commit.gpgsign", "false"],
    ]) await exec("git", args, { cwd: source });
    await exec("git", ["add", ".gitignore", "coherence.config.json"], { cwd: source });
    await exec("git", ["commit", "-qm", "bootstrap repository policy"], { cwd: source });
    const { stdout: bootstrap } = await exec("git", ["rev-parse", "HEAD"], { cwd: source });

    const opened = await run(source, create("wrk-clone-proof", "preserve swarm evidence", "clone-owner"));
    assert.equal(opened.code, 0, opened.stderr);
    const linked = await run(source, [
      "consequence", "add", "work:wrk-clone-proof", "produces", `commit:${String(bootstrap).trim()}`,
      "--evidence", "the disposable commit represents the delivered work", "--session", "field-parent",
      "--json",
    ]);
    assert.equal(linked.code, 0, linked.stderr);

    await exec("git", ["add", "-A"], { cwd: source });
    const { stdout: tracked } = await exec("git", ["ls-files", ".coherence/work", ".coherence/consequences"], {
      cwd: source,
    });
    assert.equal(String(tracked).trim().split("\n").length, 2,
      "both durable ledger files must enter the commit");
    await exec("git", ["commit", "-qm", "seed durable swarm evidence"], { cwd: source });
    await exec("git", ["clone", "-q", source, clone], { cwd: container });

    const clonedWork = parsed(await run(clone, ["work", "inspect", "wrk-clone-proof", "--json"]));
    assert.equal(clonedWork.work[0].opened.objective, "preserve swarm evidence");
    const clonedLinks = parsed(await run(clone, [
      "consequence", "inspect", "work:wrk-clone-proof", "--json",
    ]));
    assert.equal(clonedLinks.records.length, 1);
    assert.equal(clonedLinks.records[0].relation, "produces");
    const clonedOrientation = parsed(await run(clone, ["orient", "--json"]));
    assert.deepEqual(clonedOrientation.consequences.dangling, []);
  } finally {
    await cleanup(container);
  }
});

test("field journey — competing duties settle into reconstructable evidence and damage recovers", async () => {
  const root = await tmpProject({
    "coherence.config.json": JSON.stringify({
      entryDir: "app", codeExt: ["ts"], language: "typescript", platform: null,
    }),
    "app/app.spec.md": [
      "# App", "", "A real source surface for transcript-free context.", "",
      "## works when", "", "- integration.ts exists at this node", "",
      "## why", "", "The field reader must recover the integration choice without a transcript.", "",
    ].join("\n"),
    "app/integration.ts": "export const strategy = 'staged';\n",
  });

  try {
    for (const args of [
      create("wrk-field-root", "deliver the field canary", "field-parent", ["--write-scope", "README.md"]),
      create("wrk-field-alpha", "implement the shared seam", "alpha", [
        "--parent", "wrk-field-root", "--write-scope", "app/**",
      ]),
      create("wrk-field-beta", "integrate the reviewed seam", "beta", [
        "--parent", "wrk-field-root", "--depends-on", "wrk-field-alpha",
        "--write-scope", "app/integration.ts",
      ]),
    ]) {
      const result = await run(root, args);
      assert.equal(result.code, 0, result.stderr);
    }
    assert.equal((await run(root, [
      "work", "transition", "wrk-field-root", "active", "--because", "the parent is coordinating",
      "--session", "field-parent", "--json",
    ])).code, 0);

    const initialWork = parsed(await run(root, ["work", "inspect", "--json"]));
    const betaInitially = initialWork.work.find((item: any) => item.work === "wrk-field-beta");
    assert.equal(betaInitially.readiness, "waiting");
    assert.deepEqual(initialWork.scopeConflicts, [],
      "an overlapping writer behind a dependency is not a live collision");

    const proposalIds: string[] = [];
    for (const [choice, session] of [["stage the seam", "alpha"], ["replace the seam", "beta"]]) {
      const result = await run(root, [
        "decide", choice, "--over", choice === "stage the seam" ? "replace the seam" : "stage the seam",
        "--because", "the child measured its local path", "--subject", "field/integration-strategy",
        "--authority", "local-proposal", "--work", "wrk-field-root",
        "--scope-file", "app/integration.ts", "--file", "app/integration.ts", "--session", session,
      ]);
      assert.equal(result.code, 0, result.stderr);
      proposalIds.push(result.stdout.trim().split(/\s+/)[0]);
    }
    assert.equal(proposalIds.length, 2);

    const conflicted = parsed(await run(root, ["orient", "--json"]));
    assert.equal(conflicted.action, "resolve-conflict",
      "a policy conflict outranks otherwise dispatchable work");
    assert.deepEqual(conflicted.decisions.needsRatification, ["field/integration-strategy"]);

    const accepted = await run(root, [
      "decide", "stage the seam", "--over", "replace the seam",
      "--because", "the orchestrator accepted the reversible integration path",
      "--subject", "field/integration-strategy", "--authority", "orchestrator-accepted",
      "--work", "wrk-field-root", "--scope-file", "app/integration.ts", "--file", "app/integration.ts",
      "--session", "field-parent", "--agent", "orchestrator",
    ]);
    assert.equal(accepted.code, 0, accepted.stderr);
    const acceptedDecision = accepted.stdout.trim().split(/\s+/)[0];
    const ratified = parsed(await run(root, ["orient", "--json"]));
    assert.equal(ratified.decisions.positions[0].state, "ratified");
    assert.equal(ratified.action, "dispatch");

    const prematureDependency = await run(root, [
      "work", "transition", "wrk-field-beta", "active", "--because", "try to start early",
      "--session", "beta", "--json",
    ]);
    assert.equal(prematureDependency.code, 2);
    assert.match(parsed(prematureDependency).error, /before dependency wrk-field-alpha completed/);

    const handed = await run(root, [
      "work", "handoff", "wrk-field-alpha", "--owner-session", "reviewer", "--owner-agent", "reviewer-agent",
      "--because", "implementation is ready for review", "--session", "alpha", "--json",
    ]);
    assert.equal(handed.code, 0, handed.stderr);
    assert.deepEqual(parsed(handed).toOwner, { session: "reviewer", agent: "reviewer-agent" });
    assert.equal((await run(root, [
      "work", "transition", "wrk-field-alpha", "active", "--because", "review started",
      "--session", "reviewer", "--json",
    ])).code, 0);
    assert.equal((await run(root, [
      "work", "close", "wrk-field-alpha", "completed", "--because", "review accepted the seam",
      "--evidence", "focused seam acceptance passed", "--session", "reviewer", "--json",
    ])).code, 0);

    const dispatchSibling = parsed(await run(root, ["orient", "--json"]));
    assert.equal(dispatchSibling.work.unsynthesized.length, 1);
    assert.deepEqual(dispatchSibling.work.ready, ["wrk-field-beta"]);
    assert.equal(dispatchSibling.action, "dispatch",
      "a completed child awaits synthesis, but its live ready sibling must finish first");

    assert.equal((await run(root, [
      "work", "transition", "wrk-field-beta", "active", "--because", "dependency is complete",
      "--session", "beta", "--json",
    ])).code, 0);
    const continueSibling = parsed(await run(root, ["orient", "--json"]));
    assert.equal(continueSibling.action, "continue",
      "an active sibling outranks premature synthesis of an earlier child");

    const prematureParent = await run(root, [
      "work", "close", "wrk-field-root", "completed", "--because", "claim the mission early",
      "--evidence", "not all child work is terminal", "--synthesized", "wrk-field-alpha",
      "--session", "field-parent", "--json",
    ]);
    assert.equal(prematureParent.code, 2);
    assert.match(parsed(prematureParent).error, /live beneath terminal parent|live child/i);

    assert.equal((await run(root, [
      "work", "close", "wrk-field-beta", "completed", "--because", "integration passed",
      "--evidence", "native integration acceptance passed", "--session", "beta", "--json",
    ])).code, 0);
    const synthesisDue = parsed(await run(root, ["orient", "--json"]));
    assert.equal(synthesisDue.action, "synthesize");
    assert.deepEqual(synthesisDue.work.unsynthesized.map((item: any) => item.child).sort(), [
      "wrk-field-alpha", "wrk-field-beta",
    ]);

    assert.equal((await run(root, [
      "work", "close", "wrk-field-root", "completed", "--because", "all field criteria are integrated",
      "--evidence", "native field acceptance passed", "--synthesized", "wrk-field-alpha",
      "--synthesized", "wrk-field-beta", "--session", "field-parent", "--json",
    ])).code, 0);

    const linkedDecision = await run(root, [
      "consequence", "add", `decision:${acceptedDecision}`, "authorizes", "work:wrk-field-root",
      "--evidence", "the ratified choice authorized the field mission", "--session", "field-parent", "--json",
    ]);
    assert.equal(linkedDecision.code, 0, linkedDecision.stderr);
    for (const work of ["wrk-field-alpha", "wrk-field-beta", "wrk-field-root"]) {
      const linked = await run(root, [
        "consequence", "add", "verification:field-native-at-head", "verifies", `work:${work}`,
        "--evidence", "the native field acceptance passed after synthesis", "--session", "reviewer", "--json",
      ]);
      assert.equal(linked.code, 0, linked.stderr);
    }

    const settled = parsed(await run(root, ["orient", "--json"]));
    assert.equal(settled.action, "steady");
    assert.ok(settled.sources.every((source: any) => source.ok));
    assert.equal(settled.decisions.positions[0].selected.id, acceptedDecision);

    // These are the only durable inputs given to a transcript-free replacement reader.
    const workInput = parsed(await run(root, ["work", "inspect", "wrk-field-root", "--json"]));
    const linkInput = parsed(await run(root, ["consequence", "inspect", "work:wrk-field-root", "--json"]));
    const contextInput = await run(root, ["context", "app/integration.ts", "--max-bytes", "12000"]);
    assert.equal(contextInput.code, 0, contextInput.stderr);
    assert.equal(workInput.work[0].opened.objective, "deliver the field canary");
    assert.deepEqual(workInput.work[0].closed.synthesizedChildren, ["wrk-field-alpha", "wrk-field-beta"]);
    assert.equal(linkInput.records.length, 2);
    assert.ok(linkInput.records.some((record: any) => record.from.id === acceptedDecision
      && record.relation === "authorizes"));
    assert.match(contextInput.stdout, /app\/integration\.ts/);
    assert.match(contextInput.stdout, new RegExp(acceptedDecision));
    assert.match(contextInput.stdout, /Limitations/);

    const workDir = join(root, ".coherence", "work");
    const workFile = (await readdir(workDir)).sort()[0];
    const workPath = join(workDir, workFile);
    const pristine = await readFile(workPath, "utf8");
    await appendFile(workPath, "{torn field evidence\n");
    const refusedResult = await run(root, ["orient", "--json"]);
    assert.equal(refusedResult.code, 2);
    const refused = parsed(refusedResult);
    assert.equal(refused.action, "refuse");
    assert.equal(refused.sources.find((source: any) => source.name === "work").ok, false);

    await writeFile(workPath, pristine);
    const recovered = parsed(await run(root, ["orient", "--json"]));
    assert.equal(recovered.action, "steady");
    assert.ok(recovered.sources.every((source: any) => source.ok));
  } finally {
    await cleanup(root);
  }
});
