// decisions.test.ts — the decision journal.
//
// What these pin, in order of how badly it hurts when it breaks:
//   1. TWO SESSIONS NEVER COLLIDE. The premise is five agents writing at once.
//   2. THE MERGE COHERES. Separate files, one timeline, ordered by time, across
//      agents / jobs / branches.
//   3. RETRACTION CROSSES FILES. Agent B withdrawing agent A's decision is the most
//      valuable thing that can happen in a fan-out, and it spans two files.
//   4. A BAD LINE DOES NOT KILL THE RENDER. One agent writing garbage must not take
//      the journal down; the damage is counted, never silent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openSession, appendDecision, readJournal, resolve, renderJournal, decisionsDir, newSessionId,
} from "../src/decisions.ts";
import type { Config } from "../src/types.ts";

async function root(): Promise<Config> {
  const dir = await mkdtemp(join(tmpdir(), "coh-dec-"));
  return { root: dir } as Config;
}
const T = (n: number) => `2026-07-28T10:${String(n).padStart(2, "0")}:00.000Z`;

test("sessions — each agent gets its own file, and two sessions never collide", async () => {
  const cfg = await root();
  const a = openSession(cfg, { agent: "finder-1", job: "evolution", now: T(0) });
  const b = openSession(cfg, { agent: "finder-2", job: "evolution", now: T(0) });
  assert.notEqual(a.session, b.session, "same agent-start second, same job — ids must still differ");

  appendDecision(cfg, { kind: "decision", chose: "A", because: "x", session: a.session, agent: "finder-1", now: T(1) });
  appendDecision(cfg, { kind: "decision", chose: "B", because: "y", session: b.session, agent: "finder-2", now: T(2) });

  const files = readdirSync(decisionsDir(cfg)).sort();
  assert.equal(files.length, 2, "one file per session — this is what makes two branches merge cleanly");
  assert.ok(files.includes(`${a.session}.jsonl`) && files.includes(`${b.session}.jsonl`));
  await rm(cfg.root, { recursive: true, force: true });
});

test("merge — separate files cohere into ONE timeline ordered by time, not by file", async () => {
  const cfg = await root();
  const a = newSessionId(), b = newSessionId();
  // Interleaved in time, but written to different files in the "wrong" order.
  appendDecision(cfg, { kind: "decision", chose: "third", because: "-", session: b, agent: "B", now: T(3) });
  appendDecision(cfg, { kind: "decision", chose: "first", because: "-", session: a, agent: "A", now: T(1) });
  appendDecision(cfg, { kind: "decision", chose: "second", because: "-", session: b, agent: "B", now: T(2) });

  const { records, sessions } = readJournal(cfg);
  assert.deepEqual(records.map((r) => r.chose), ["first", "second", "third"]);
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((s) => s.count), [1, 2], "per-session counts survive the merge");
  await rm(cfg.root, { recursive: true, force: true });
});

test("retraction — agent B withdraws agent A's decision, ACROSS session files", async () => {
  const cfg = await root();
  const a = newSessionId(), b = newSessionId();
  const d = appendDecision(cfg, {
    kind: "decision", chose: "do not build evolution", over: ["build it"],
    because: "one blocker, high confidence", session: a, agent: "verifier", now: T(1),
  });
  appendDecision(cfg, {
    kind: "retraction", chose: "build it", supersedes: d.id,
    because: "the harness skipped generateTerrain — measured on a planet with no continents",
    session: b, agent: "integrator", now: T(5),
  });

  const { standing, retracted } = resolve(readJournal(cfg).records);
  assert.equal(standing.length, 0, "a retracted decision must not still read as standing");
  assert.equal(retracted.length, 1);
  assert.equal(retracted[0].rec.id, d.id);
  assert.match(retracted[0].by.because, /generateTerrain/);

  const { text } = renderJournal(cfg);
  assert.match(text, /## ?Retracted|Retracted/);
  assert.match(text, /RETRACTED by integrator/);
  await rm(cfg.root, { recursive: true, force: true });
});

test("identity — the same decision logged twice collapses; identity is CONTENT, not time", async () => {
  const cfg = await root();
  const s = newSessionId();
  const one = appendDecision(cfg, { kind: "decision", chose: "gamma", over: ["linear"], because: "preserves the max", session: s, now: T(1) });
  const two = appendDecision(cfg, { kind: "decision", chose: "gamma", over: ["linear"], because: "preserves the max", session: s, now: T(9) });
  assert.equal(one.id, two.id, "a retried agent must not inflate the count");
  assert.equal(readJournal(cfg).records.length, 2, "both lines are on disk — append-only means append-only");
  assert.equal(resolve(readJournal(cfg).records).standing.length, 1, "but the resolved view shows one");
  await rm(cfg.root, { recursive: true, force: true });
});

test("robustness — one agent writing garbage does not take the journal down", async () => {
  const cfg = await root();
  const s = newSessionId();
  appendDecision(cfg, { kind: "decision", chose: "good", because: "-", session: s, now: T(1) });
  await mkdir(decisionsDir(cfg), { recursive: true });
  await writeFile(join(decisionsDir(cfg), "s-broken.jsonl"), '{"not":"a record"}\nnot json at all\n');

  const { records, unreadable } = readJournal(cfg);
  assert.equal(records.length, 1, "the good record still reads");
  assert.equal(unreadable, 2, "and the damage is COUNTED, never silent");
  assert.match(renderJournal(cfg).text, /WARNING: 2 unreadable line\(s\)/);
  await rm(cfg.root, { recursive: true, force: true });
});

test("render — an empty `over` says so, because forced and unexamined are different", async () => {
  const cfg = await root();
  const s = newSessionId();
  appendDecision(cfg, { kind: "decision", chose: "X", because: "no alternative existed", session: s, now: T(1) });
  appendDecision(cfg, { kind: "decision", chose: "Y", over: ["Z", "W"], because: "measured", session: s, now: T(2) });
  const { text } = renderJournal(cfg);
  assert.match(text, /over: \(nothing — forced, or no alternative considered\)/);
  assert.match(text, /over: Z · W/);
  assert.match(text, /2 alternative\(s\) rejected/);
  await rm(cfg.root, { recursive: true, force: true });
});

test("scope — the merged view filters by job, agent, session and branch", async () => {
  const cfg = await root();
  const a = newSessionId(), b = newSessionId();
  appendDecision(cfg, { kind: "decision", chose: "evo", because: "-", session: a, agent: "A", job: "evolution", now: T(1) });
  appendDecision(cfg, { kind: "decision", chose: "cli", because: "-", session: b, agent: "B", job: "tooling", now: T(2) });
  assert.match(renderJournal(cfg, { job: "evolution" }).text, /evo/);
  assert.ok(!renderJournal(cfg, { job: "evolution" }).text.includes("cli"));
  assert.match(renderJournal(cfg, { agent: "B" }).text, /cli/);
  assert.match(renderJournal(cfg, { session: a }).text, /1 standing/);
  await rm(cfg.root, { recursive: true, force: true });
});

test("sessions — a session is named by its WORK, not by the header the hook wrote", async () => {
  // The hook opens the session before the agent knows its own name, so the header says
  // agent "main". Taking identity from the first record filed every agent under "main",
  // which defeats the whole point of one file per session.
  const cfg = await root();
  const h = openSession(cfg, { now: T(0) });                       // no agent: the hook's default
  appendDecision(cfg, { kind: "decision", chose: "X", because: "-", session: h.session, agent: "finder-1", job: "evolution", now: T(1) });

  const s = readJournal(cfg).sessions.find((s) => s.id === h.session)!;
  assert.equal(s.agent, "finder-1", "the agent's own claim must beat the header placeholder");
  assert.equal(s.job, "evolution");
  assert.equal(s.count, 1, "and the header itself is not counted as a decision");
  assert.equal(s.started, T(0), "while the START time still comes from the header");
  await rm(cfg.root, { recursive: true, force: true });
});
