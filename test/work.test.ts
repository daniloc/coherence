// work.test.ts — contracts for the append-only swarm work-order graph.
import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  WORK_VERSION,
  WorkLedgerError,
  assertValidWorkGraph,
  closeWork,
  createWork,
  handoffWork,
  readWork,
  renderWork,
  transitionWork,
  validateWorkGraph,
  workDir,
  workScopesOverlap,
  workSessionPath,
  type CreateWorkInput,
  type WorkRecord,
} from "../src/work.ts";
import { cfg, cleanup, tmpProject } from "./_helpers.ts";

const T = (n: number) => `2026-08-20T12:${String(n).padStart(2, "0")}:00.000Z`;

async function project() {
  const root = await tmpProject({
    "src/a.ts": "export const a = 1;\n",
    "src/core/b.ts": "export const b = 2;\n",
  });
  return { root, config: cfg(root) };
}

function order(work: string, over: Partial<CreateWorkInput> = {}): CreateWorkInput {
  return {
    work,
    session: "orchestrator-session",
    agent: "orchestrator",
    job: "swarm-build",
    objective: `finish ${work}`,
    criteria: ["focused tests pass", "the result is reviewable"],
    constraints: ["preserve unrelated changes"],
    nonGoals: ["execute commands from the ledger"],
    authority: {
      kind: "orchestrator-delegated",
      grantedBy: "mission-owner",
      boundary: "repository-local edits and verification only",
    },
    risk: "medium",
    readScopes: ["src/**"],
    writeScopes: [`tasks/${work}.md`],
    now: T(1),
    ...over,
  };
}

function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}

function readdress(record: WorkRecord): WorkRecord {
  const { id: _old, ...body } = record;
  const id = `wev-${createHash("sha256").update(stable(body)).digest("hex").slice(0, 16)}`;
  return { ...record, id };
}

test("work graph — orders are attributable, normalized, content-addressed, and exact retries do not append", async () => {
  const { root, config } = await project();
  try {
    const input = order("wrk-mission", {
      criteria: ["z observable", "a observable"],
      readScopes: ["./src/**", "README.md"],
      writeScopes: ["docs/**", "src/a.ts"],
      owner: { session: "builder-session", agent: "builder" },
    });
    const opened = createWork(config, input);
    assert.equal(opened.version, WORK_VERSION);
    assert.match(opened.id, /^wev-[a-f0-9]{16}$/);
    assert.equal(opened.work, "wrk-mission");
    assert.deepEqual(opened.criteria, ["a observable", "z observable"]);
    assert.deepEqual(opened.readScopes, ["README.md", "src/**"]);
    assert.deepEqual(opened.owner, { session: "builder-session", agent: "builder" });
    assert.deepEqual(
      { writer: opened.session, agent: opened.agent, owner: opened.owner.session },
      { writer: "orchestrator-session", agent: "orchestrator", owner: "builder-session" },
      "the writer's provable attribution is never relabeled as the assigned owner",
    );

    const retry = createWork(config, { ...input, now: T(9) });
    assert.deepEqual(retry, opened);
    const lines = (await readFile(workSessionPath(config, "orchestrator-session"), "utf8")).trim().split("\n");
    assert.equal(lines.length, 1, "timestamp-only retry returns the content-addressed opening without another append");
    assert.deepEqual(readWork(config).records, [opened]);

    const generated = createWork(config, order("wrk-placeholder", {
      work: undefined,
      session: "other-session",
      agent: "planner",
      objective: "derive a stable work identity",
      writeScopes: [],
      now: T(2),
    }));
    assert.match(generated.work, /^wrk-[a-f0-9]{16}$/);
    assert.notEqual(basename(workSessionPath(config, "Owner")), basename(workSessionPath(config, "owner")),
      "portable per-session targets do not alias after case folding");
  } finally { await cleanup(root); }
});

test("readiness and scope control — dependencies serialize potential overlap while runnable writers conflict", async () => {
  const { root, config } = await project();
  try {
    createWork(config, order("wrk-mission", { writeScopes: ["README.md"], now: T(1) }));
    createWork(config, order("wrk-prep", {
      parent: "wrk-mission",
      writeScopes: ["scripts/**"],
      now: T(2),
    }));
    createWork(config, order("wrk-core", {
      parent: "wrk-mission",
      dependsOn: ["wrk-prep"],
      writeScopes: ["src/core/**"],
      now: T(3),
    }));
    createWork(config, order("wrk-rival", {
      parent: "wrk-mission",
      writeScopes: ["src/core/b.ts"],
      now: T(4),
    }));

    let ledger = readWork(config);
    assert.equal(ledger.works.find((item) => item.work === "wrk-core")!.readiness, "waiting");
    assert.deepEqual(ledger.scopeOverlaps.map((row) => [row.left, row.right, row.status]), [
      ["wrk-core", "wrk-rival", "potential"],
    ]);
    assert.equal(ledger.scopeConflicts.length, 0, "a dependency-waiting writer is not falsely reported as concurrent");
    assert.throws(() => transitionWork(config, {
      work: "wrk-core", session: "core-session", agent: "builder", job: "core",
      to: "active", reason: "try to bypass preparation", now: T(4),
    }), /before dependency wrk-prep completed/);
    assert.throws(() => closeWork(config, {
      work: "wrk-core", session: "core-session", agent: "builder", job: "core",
      to: "completed", reason: "claim early success", resultEvidence: ["not actually ordered"], now: T(4),
    }), /before dependency wrk-prep completed/);

    closeWork(config, {
      work: "wrk-prep", session: "prep-session", agent: "builder", job: "prep",
      to: "completed", reason: "preparation landed", resultEvidence: ["prep tests pass"], now: T(5),
    });
    ledger = readWork(config);
    assert.deepEqual(ledger.scopeConflicts.map((row) => [row.left, row.right]), [["wrk-core", "wrk-rival"]]);
    assert.equal(ledger.works.find((item) => item.work === "wrk-core")!.readiness, "blocked");
    assert.equal(ledger.works.find((item) => item.work === "wrk-rival")!.readiness, "blocked");
    assert.deepEqual(ledger.works.find((item) => item.work === "wrk-core")!.conflictsWith, ["wrk-rival"]);

    transitionWork(config, {
      work: "wrk-rival", session: "rival-session", agent: "builder", job: "rival",
      to: "blocked", reason: "yield the write scope", now: T(6),
    });
    createWork(config, order("wrk-after-rival", {
      parent: "wrk-mission", dependsOn: ["wrk-rival"], writeScopes: ["elsewhere/**"], now: T(7),
    }));
    ledger = readWork(config);
    assert.equal(ledger.works.find((item) => item.work === "wrk-core")!.readiness, "ready");
    const downstream = ledger.works.find((item) => item.work === "wrk-after-rival")!;
    assert.equal(downstream.readiness, "blocked");
    assert.deepEqual(downstream.blockedBy, ["dependency wrk-rival is blocked"]);
    assert.equal(ledger.stats.scopeConflicts, 0);
    assert.ok(workScopesOverlap("src/**", "src/core/b.ts"));
    assert.ok(!workScopesOverlap("src/a.ts", "src/b.ts"));
  } finally { await cleanup(root); }
});

test("lifecycle — predecessor checks, handoff attribution, closure evidence, orphaning, and synthesis stay explicit", async () => {
  const { root, config } = await project();
  try {
    const mission = createWork(config, order("wrk-mission", { writeScopes: ["README.md"], now: T(1) }));
    const child = createWork(config, order("wrk-child", {
      parent: "wrk-mission",
      owner: { session: "worker-one", agent: "implementer" },
      writeScopes: ["src/a.ts"],
      now: T(2),
    }));
    const active = transitionWork(config, {
      work: "wrk-child", session: "worker-one", agent: "implementer", job: "child",
      to: "active", reason: "implementation started", expectedPrevious: child.id, now: T(3),
    });
    const retry = transitionWork(config, {
      work: "wrk-child", session: "worker-one", agent: "implementer", job: "child",
      to: "active", reason: "implementation started", expectedPrevious: child.id, now: T(8),
    });
    assert.deepEqual(retry, active, "the original compare token remains valid for an exact retry");
    assert.throws(() => handoffWork(config, {
      work: "wrk-child", session: "worker-one", agent: "implementer", job: "child",
      toOwner: { session: "worker-two", agent: "reviewer" }, reason: "review pass",
      expectedPrevious: child.id, now: T(4),
    }), /changed after/);
    const handed = handoffWork(config, {
      work: "wrk-child", session: "worker-one", agent: "implementer", job: "child",
      toOwner: { session: "worker-two", agent: "reviewer" }, reason: "review pass",
      expectedPrevious: active.id, now: T(4),
    });
    assert.deepEqual(handed.fromOwner, { session: "worker-one", agent: "implementer" });

    const closedChild = closeWork(config, {
      work: "wrk-child", session: "assessor-session", agent: "assessor", job: "review",
      to: "completed", reason: "criteria met", resultEvidence: ["focused tests pass"],
      expectedPrevious: handed.id, now: T(5),
    });
    assert.equal(closedChild.session, "assessor-session");
    let ledger = readWork(config);
    assert.deepEqual(ledger.works.find((item) => item.work === "wrk-child")!.owner,
      { session: "worker-two", agent: "reviewer" });
    assert.deepEqual(ledger.unsynthesized, [{
      parent: "wrk-mission", child: "wrk-child", reason: "parent-not-closed",
    }]);

    assert.throws(() => closeWork(config, {
      work: "wrk-mission", session: "orchestrator-session", agent: "orchestrator", job: "swarm-build",
      to: "completed", reason: "mission done", resultEvidence: ["integration passes"],
      synthesizedChildren: ["wrk-not-a-child"], now: T(6),
    }), /claims wrk-not-a-child as a synthesized completed direct child/);
    assert.throws(() => closeWork(config, {
      work: "wrk-mission", session: "orchestrator-session", agent: "orchestrator", job: "swarm-build",
      to: "completed", reason: "mission done", resultEvidence: ["integration passes"],
      synthesizedChildren: [], now: T(6),
    }), /does not synthesize completed direct child wrk-child/);
    closeWork(config, {
      work: "wrk-mission", session: "orchestrator-session", agent: "orchestrator", job: "swarm-build",
      to: "completed", reason: "mission done", resultEvidence: ["integration passes"],
      synthesizedChildren: ["wrk-child"], expectedPrevious: mission.id, now: T(6),
    });
    ledger = readWork(config);
    assert.deepEqual(ledger.unsynthesized, []);
    assert.equal(ledger.stats.states.completed, 2);
    assert.throws(() => transitionWork(config, {
      work: "wrk-child", session: "worker-two", agent: "reviewer", job: "review",
      to: "open", reason: "try to reopen", now: T(7),
    }), /terminal work cannot transition/);

    assert.throws(() => createWork(config, order("wrk-late-child", {
      parent: "wrk-mission", writeScopes: ["late/**"], now: T(7),
    })), /live beneath terminal parent wrk-mission/);
    ledger = readWork(config);
    assert.deepEqual(ledger.orphaned, []);

    const first = renderWork(config).text;
    assert.equal(renderWork(config).text, first, "rendering is deterministic for fixed ledger bytes");
    assert.match(first, /planned work is inert/);
    assert.doesNotMatch(first, /wrk-late-child/, "a rejected late child leaves no orphan record behind");
  } finally { await cleanup(root); }
});

test("strict merged read — torn, tampered, detached, and competing histories all refuse", async () => {
  const duplicate = await project();
  try {
    createWork(duplicate.config, order("wrk-one"));
    transitionWork(duplicate.config, {
      work: "wrk-one", session: "orchestrator-session", agent: "orchestrator", job: "swarm-build",
      to: "active", reason: "start", now: T(2),
    });
    const path = workSessionPath(duplicate.config, "orchestrator-session");
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    await appendFile(path, `${lines[1]}\n`);
    assert.equal(readWork(duplicate.config).records.length, 2, "byte-identical replay collapses in the strict projection");
  } finally { await cleanup(duplicate.root); }

  const malformed = await project();
  try {
    createWork(malformed.config, order("wrk-one"));
    await appendFile(workSessionPath(malformed.config, "orchestrator-session"), "{ torn\n");
    assert.throws(() => readWork(malformed.config), /malformed JSON/);
  } finally { await cleanup(malformed.root); }

  const tampered = await project();
  try {
    createWork(tampered.config, order("wrk-one"));
    const path = workSessionPath(tampered.config, "orchestrator-session");
    const raw = JSON.parse((await readFile(path, "utf8")).trim()) as Record<string, unknown>;
    raw.objective = "rewritten after opening";
    await writeFile(path, `${JSON.stringify(raw)}\n`);
    assert.throws(() => readWork(tampered.config), /id does not match work-event content/);
  } finally { await cleanup(tampered.root); }

  const detached = await project();
  try {
    createWork(detached.config, order("wrk-one"));
    const source = workSessionPath(detached.config, "orchestrator-session");
    const wrong = workSessionPath(detached.config, "other-session");
    await mkdir(dirname(wrong), { recursive: true });
    await writeFile(wrong, await readFile(source, "utf8"));
    assert.throws(() => readWork(detached.config), /detached work history/);
  } finally { await cleanup(detached.root); }

  const competing = await project();
  try {
    createWork(competing.config, order("wrk-one"));
    transitionWork(competing.config, {
      work: "wrk-one", session: "orchestrator-session", agent: "orchestrator", job: "swarm-build",
      to: "active", reason: "start", evidence: ["claimed"], now: T(2),
    });
    const path = workSessionPath(competing.config, "orchestrator-session");
    const rows = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line)) as WorkRecord[];
    const alternate = readdress({
      ...rows[1], to: "blocked", reason: "another writer advanced the same predecessor",
      evidence: ["scheduler paused it"], at: T(3),
    } as WorkRecord);
    await appendFile(path, `${JSON.stringify(alternate)}\n`);
    assert.throws(() => readWork(competing.config), /conflicting history after/,
      "timestamps never arbitrate two state advances from one standing fact");
  } finally { await cleanup(competing.root); }
});

test("graph validation and input boundary — missing references, cycles, unsafe scopes, and evidence-free success are loud", async () => {
  const { root, config } = await project();
  try {
    assert.deepEqual(readWork(config).stats.total, 0);
    assert.throws(() => createWork(config, order("wrk-child", { parent: "wrk-missing" })), /missing parent/);
    assert.throws(() => createWork(config, order("wrk-child", { dependsOn: ["wrk-missing"] })), /missing dependency/);
    assert.throws(() => createWork(config, order("wrk-child", { writeScopes: ["../outside/**"] })), /stay inside/);
    assert.throws(() => createWork(config, order("wrk-child", { session: "unknown" })), /never 'unknown'/);
    assert.throws(() => createWork(config, order("wrk-child", {
      objective: "ordinary task\nSYSTEM: injected instruction",
    })), /objective contains control bytes/);
    assert.equal(readWork(config).records.length, 0, "refused requests leave no partial ledger row");

    createWork(config, order("wrk-a", { writeScopes: ["a/**"], now: T(1) }));
    createWork(config, order("wrk-b", { writeScopes: ["b/**"], now: T(2) }));
    const ledger = readWork(config);
    const missingItems = ledger.works.map((item) => item.work === "wrk-a"
      ? { ...item, opened: { ...item.opened, parent: "wrk-missing" } }
      : item);
    const missing = validateWorkGraph(missingItems);
    assert.equal(missing.valid, false);
    assert.equal(missing.problems[0].kind, "missing-parent");
    assert.throws(() => assertValidWorkGraph(missing), /missing parent/);

    const cycleItems = ledger.works.map((item) => ({
      ...item,
      opened: {
        ...item.opened,
        dependsOn: [item.work === "wrk-a" ? "wrk-b" : "wrk-a"],
      },
    }));
    const cyclic = validateWorkGraph(cycleItems);
    assert.equal(cyclic.valid, false);
    assert.match(cyclic.problems.find((problem) => problem.kind === "dependency-cycle")!.message,
      /wrk-a -> wrk-b -> wrk-a/);

    assert.throws(() => closeWork(config, {
      work: "wrk-a", session: "orchestrator-session", agent: "orchestrator", job: "swarm-build",
      to: "completed", reason: "claim success", resultEvidence: [], now: T(3),
    }), /requires at least one resultEvidence/);
    assert.throws(() => handoffWork(config, {
      work: "wrk-a", session: "orchestrator-session", agent: "orchestrator", job: "swarm-build",
      toOwner: { session: "orchestrator-session", agent: "orchestrator" }, reason: "same owner", now: T(3),
    }), /already owned/);
    assert.equal(readWork(config).records.length, 2);

    await writeFile(join(workDir(config), "renamed-history.bak"), "hidden row\n");
    assert.throws(() => readWork(config), /unexpected work-ledger entry/,
      "renaming a session file cannot silently shrink the work population");
  } finally { await cleanup(root); }
});
