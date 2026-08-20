import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createWork, transitionWork } from "../src/work.ts";
import { appendDecision } from "../src/decisions.ts";
import { observeOrientation, renderOrientation } from "../src/orient.ts";
import { cfg, cleanup, tmpProject } from "./_helpers.ts";

const authority = { kind: "user-directed" as const, grantedBy: "user", boundary: "build the requested gyroscope" };

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
