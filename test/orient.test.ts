import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { closeWork, createWork, transitionWork } from "../src/work.ts";
import { appendDecision } from "../src/decisions.ts";
import { observeOrientation, renderOrientation } from "../src/orient.ts";
import { cfg, cleanup, tmpProject } from "./_helpers.ts";

const authority = { kind: "user-directed" as const, grantedBy: "user", boundary: "build the requested gyroscope" };
const exec = promisify(execFile);

test("orientation dispatches dependency-clear work and states every source", async () => {
  const root = await tmpProject();
  const config = cfg(root);
  try {
    createWork(config, {
      session: "orchestrator", objective: "implement parser", criteria: ["tests pass"],
      authority, risk: "medium", writeScopes: ["src/parser.ts"], now: "2026-01-01T00:00:00.000Z",
    });
    const reading = await observeOrientation(config);
    assert.equal(reading.action, "dispatch");
    assert.equal(reading.sources.length, 6);
    assert.ok(reading.sources.every((item) => item.ok));
    assert.match(renderOrientation(reading), /ORIENTATION DISPATCH/);
  } finally { await cleanup(root); }
});

test("orientation gives active write collisions precedence over ready work", async () => {
  const root = await tmpProject();
  const config = cfg(root);
  try {
    const left = createWork(config, {
      session: "one", owner: { session: "one", agent: "a" }, objective: "left", criteria: ["done"],
      authority, risk: "high", writeScopes: ["src/**"], now: "2026-01-01T00:00:00.000Z",
    });
    const right = createWork(config, {
      session: "two", owner: { session: "two", agent: "b" }, objective: "right", criteria: ["done"],
      authority, risk: "high", writeScopes: ["src/file.ts"], now: "2026-01-01T00:00:01.000Z",
    });
    transitionWork(config, { work: left.work, session: "one", to: "active", reason: "started", now: "2026-01-01T00:00:02.000Z" });
    transitionWork(config, { work: right.work, session: "two", to: "active", reason: "started", now: "2026-01-01T00:00:03.000Z" });
    const reading = await observeOrientation(config);
    assert.equal(reading.action, "resolve-conflict");
    assert.equal(reading.work?.conflicts.length, 1);
  } finally { await cleanup(root); }
});

test("orientation dispatches a ready sibling before asking for parent synthesis", async () => {
  const root = await tmpProject();
  const config = cfg(root);
  try {
    createWork(config, {
      work: "wrk-parent", session: "orchestrator", objective: "join child results", criteria: ["all children complete"],
      authority, risk: "high", now: "2026-01-01T00:00:00.000Z",
    });
    transitionWork(config, {
      work: "wrk-parent", session: "orchestrator", to: "active", reason: "children dispatched",
      now: "2026-01-01T00:00:01.000Z",
    });
    createWork(config, {
      work: "wrk-a", parent: "wrk-parent", session: "agent-a", objective: "produce A", criteria: ["A complete"],
      authority, risk: "medium", now: "2026-01-01T00:00:02.000Z",
    });
    createWork(config, {
      work: "wrk-b", parent: "wrk-parent", session: "agent-b", objective: "consume A", criteria: ["B complete"],
      authority, risk: "medium", dependsOn: ["wrk-a"], now: "2026-01-01T00:00:03.000Z",
    });
    transitionWork(config, {
      work: "wrk-a", session: "agent-a", to: "active", reason: "started A", now: "2026-01-01T00:00:04.000Z",
    });
    closeWork(config, {
      work: "wrk-a", session: "agent-a", to: "completed", reason: "finished A", resultEvidence: ["A passed"],
      now: "2026-01-01T00:00:05.000Z",
    });

    const ready = await observeOrientation(config);
    assert.equal(ready.action, "dispatch");
    assert.deepEqual(ready.work?.ready, ["wrk-b"]);
    assert.deepEqual(ready.work?.unsynthesized, [{ parent: "wrk-parent", child: "wrk-a" }]);

    transitionWork(config, {
      work: "wrk-b", session: "agent-b", to: "active", reason: "A is available", now: "2026-01-01T00:00:06.000Z",
    });
    const active = await observeOrientation(config);
    assert.equal(active.action, "continue");

    closeWork(config, {
      work: "wrk-b", session: "agent-b", to: "completed", reason: "finished B", resultEvidence: ["B passed"],
      now: "2026-01-01T00:00:07.000Z",
    });
    const joined = await observeOrientation(config);
    assert.equal(joined.action, "synthesize");
    assert.deepEqual(joined.work?.unsynthesized, [
      { parent: "wrk-parent", child: "wrk-a" },
      { parent: "wrk-parent", child: "wrk-b" },
    ]);
  } finally { await cleanup(root); }
});

test("orientation refuses a damaged trusted source instead of reading it as empty", async () => {
  const root = await tmpProject();
  try {
    await mkdir(join(root, ".coherence", "decisions"), { recursive: true });
    await writeFile(join(root, ".coherence", "decisions", "broken.jsonl"), "{torn\n");
    const reading = await observeOrientation(cfg(root));
    assert.equal(reading.action, "refuse");
    assert.equal(reading.sources.find((item) => item.name === "decisions")?.ok, false);
  } finally { await cleanup(root); }
});

test("orientation is total over an invalid decision-ledger filesystem shape", async () => {
  const root = await tmpProject();
  try {
    await mkdir(join(root, ".coherence"), { recursive: true });
    await writeFile(join(root, ".coherence", "decisions"), "not a directory\n");
    const reading = await observeOrientation(cfg(root));
    assert.equal(reading.action, "refuse");
    assert.equal(reading.sources.find((item) => item.name === "decisions")?.ok, false);
  } finally { await cleanup(root); }
});

test("orientation refuses parseable malformed verification and never promotes missing provenance", async () => {
  const malformedRoot = await tmpProject();
  try {
    await mkdir(join(malformedRoot, ".coherence"), { recursive: true });
    await writeFile(join(malformedRoot, ".coherence", "status.json"), JSON.stringify({
      version: 1,
      verify: { at: "not-a-time", commit: null, dirty: false, tier: "full", failures: "not-a-number" },
    }) + "\n");
    const malformed = await observeOrientation(cfg(malformedRoot));
    assert.equal(malformed.action, "refuse");
    assert.equal(malformed.sources.find((item) => item.name === "verification")?.ok, false);
  } finally { await cleanup(malformedRoot); }

  const unanchoredRoot = await tmpProject();
  try {
    await mkdir(join(unanchoredRoot, ".coherence"), { recursive: true });
    await writeFile(join(unanchoredRoot, ".coherence", "status.json"), JSON.stringify({
      version: 1,
      verify: {
        at: "2026-01-01T00:00:00.000Z", commit: null, dirty: false,
        tier: "full", failures: 0,
      },
    }) + "\n");
    const unanchored = await observeOrientation(cfg(unanchoredRoot));
    assert.equal(unanchored.verification?.state, "stale");
    assert.equal(unanchored.action, "verify");
  } finally { await cleanup(unanchoredRoot); }
});

test("verification currency ignores its own receipt but rejects tracked source and index changes", async () => {
  const root = await tmpProject({
    "coherence.config.json": "{}\n",
    "src/app.ts": "export const answer = 42;\n",
  });
  try {
    await exec("git", ["init", "-q"], { cwd: root });
    await exec("git", ["config", "user.email", "orientation@example.test"], { cwd: root });
    await exec("git", ["config", "user.name", "Orientation Test"], { cwd: root });
    await exec("git", ["add", "coherence.config.json", "src/app.ts"], { cwd: root });
    await exec("git", ["commit", "-qm", "fixture"], { cwd: root });
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
    const commit = stdout.trim();
    await mkdir(join(root, ".coherence"), { recursive: true });
    await writeFile(join(root, ".coherence", "status.json"), JSON.stringify({
      version: 1,
      verify: {
        at: "2026-01-01T00:00:00.000Z", commit, dirty: false,
        tier: "full", failures: 0,
      },
    }) + "\n");

    const receiptOnly = await observeOrientation(cfg(root));
    assert.equal(receiptOnly.verification?.state, "current");
    assert.equal(receiptOnly.action, "steady");

    await writeFile(join(root, "src", "app.ts"), "export const answer = 43;\n");
    const sourceDirty = await observeOrientation(cfg(root));
    assert.equal(sourceDirty.verification?.state, "stale");
    assert.equal(sourceDirty.action, "verify");

    await exec("git", ["add", "src/app.ts"], { cwd: root });
    const indexDirty = await observeOrientation(cfg(root));
    assert.equal(indexDirty.verification?.state, "stale");
    assert.equal(indexDirty.action, "verify");
  } finally { await cleanup(root); }
});

test("orientation treats journal blockage as history, not a live work state", async () => {
  const root = await tmpProject();
  const config = cfg(root);
  try {
    appendDecision(config, {
      kind: "blocked", chose: "an old attempt could not reach the service",
      because: "the credential was unavailable then", session: "historical", agent: "agent",
      now: "2026-01-01T00:00:00.000Z",
    });
    const reading = await observeOrientation(config);
    assert.equal(reading.action, "steady");
    assert.equal(reading.decisions?.historicalBlockedReports, 1);
    assert.match(renderOrientation(reading), /1 historical blocked report/);
  } finally { await cleanup(root); }
});
