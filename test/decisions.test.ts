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
//   5. THE HOOKLESS FALLBACK APPENDS RATHER THAN MULTIPLYING — and two branches still
//      land on two filenames, which is the property the whole split-file layout buys.
//   6. COMPACTION IS A NO-OP ON THE RENDER. `coherence decisions` before and after must
//      be character-for-character identical, or the compaction is wrong and does not ship.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openSession, appendDecision, readJournal, resolve, renderJournal, decisionsDir, newSessionId,
  derivedSessionId, slug, compactJournal, planCompaction, COMPACT_QUIET_MS,
  LABEL_SOFT_MAX,
} from "../src/decisions.ts";
import { checkHooks, printHooks, stopFeedbackActive } from "../src/hooks.ts";
import { runCaptured, cleanup } from "./_helpers.ts";
import type { Config } from "../src/types.ts";

async function root(): Promise<Config> {
  const dir = await mkdtemp(join(tmpdir(), "coh-dec-"));
  return { root: dir } as Config;
}
const T = (n: number) => `2026-07-28T10:${String(n).padStart(2, "0")}:00.000Z`;

// ── a REAL git repo, because the fallback reads a branch and compaction reads history ──
const g = (root: string, ...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });

async function gitRoot(): Promise<Config> {
  const dir = await mkdtemp(join(tmpdir(), "coh-git-"));
  g(dir, "init", "-q", "-b", "main");
  g(dir, "config", "user.email", "t@example.com");
  g(dir, "config", "user.name", "T");
  g(dir, "commit", "-q", "--allow-empty", "-m", "root");
  return { root: dir } as Config;
}
const commitAll = (cfg: Config) => { g(cfg.root, "add", "-A", "."); g(cfg.root, "commit", "-q", "-m", "journal"); };

/** Backdate every journal file out of the quiet window. The window is a guard against
 *  compacting under a live agent, so a test about grouping has to get out of its way. */
function ageOut(cfg: Config, files?: string[]) {
  const then = (Date.now() - COMPACT_QUIET_MS - 60_000) / 1000;
  for (const f of files ?? readdirSync(decisionsDir(cfg))) utimesSync(join(decisionsDir(cfg), f), then, then);
}

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

// ── is the hook actually firing? ─────────────────────────────────────────────────

test("hooks --check — CONFIGURED BUT NEVER FIRED is its own verdict, not silence", async () => {
  // The failure this exists for: the settings block present, `coherence hook` emitting
  // correct JSON by hand, and the subagent receiving NOTHING. No error anywhere. A
  // mechanism that looks installed and does nothing is the defect this repo hunts.
  const cfg = await root();
  await mkdir(join(cfg.root, ".claude"), { recursive: true });
  await writeFile(join(cfg.root, ".claude", "settings.json"), JSON.stringify({
    hooks: { SubagentStart: [{ hooks: [{ type: "command", command: "npx coherence hook SubagentStart" }] }] },
  }));
  // Entries exist, but every one was logged by hand — no session header from a hook.
  appendDecision(cfg, { kind: "decision", chose: "X", because: "-", session: newSessionId(), now: T(1) });

  const { code, out } = await runCaptured(() => Promise.resolve(checkHooks(cfg)));
  assert.equal(code, 1, "configured-but-dead must be nonzero — it is a broken install");
  assert.match(out, /sessions OPENED BY A HOOK: 0/);
  assert.match(out, /CONFIGURED BUT NEVER FIRED/);
  assert.match(out, /PostToolUse hook that touches a file/, "must say how to prove it, not just that it failed");
  await rm(cfg.root, { recursive: true, force: true });
});

test("hooks --check — a hook-opened session is the tell that it IS firing", async () => {
  const cfg = await root();
  await mkdir(join(cfg.root, ".claude"), { recursive: true });
  await writeFile(join(cfg.root, ".claude", "settings.json"), JSON.stringify({
    hooks: { SubagentStart: [{ hooks: [{ type: "command", command: "node ./src/hook-cli.ts SubagentStart" }] }] },
  }));
  const opened = openSession(cfg, { session: "agent-abc", now: T(0) });
  assert.equal(opened.session, "agent-abc", "the host id must address journal and tool trace alike");
  const { code, out } = await runCaptured(() => Promise.resolve(checkHooks(cfg)));
  assert.equal(code, 0);
  assert.match(out, /FIRING\. 1 session\(s\)/);
  await rm(cfg.root, { recursive: true, force: true });
});

test("hooks — generated wiring uses the low-cost entrypoint and observes writes", async () => {
  const cfg = await root();
  const { out } = await runCaptured(async () => { printHooks(cfg); return 0; });
  assert.match(out, /node_modules\/\.bin\/coherence-hook/);
  assert.match(out, /SubagentStart/);
  assert.match(out, /Read\|Grep\|Glob\|Write\|Edit\|MultiEdit\|NotebookEdit/);
  assert.doesNotMatch(out, /npx coherence hook PostToolUse/);
  assert.equal(stopFeedbackActive({ stop_hook_active: true }), true);
  assert.equal(stopFeedbackActive({ stop_hook_active: false }), false);
  await cleanup(cfg.root);
});

test("hooks --check — no configuration at all is a different verdict from a dead one", async () => {
  const cfg = await root();
  const { code, out } = await runCaptured(() => Promise.resolve(checkHooks(cfg)));
  assert.equal(code, 1);
  assert.match(out, /hooks configured: NONE/);
  assert.ok(!/NEVER FIRED/.test(out), "not-installed and installed-but-dead need different fixes");
  await rm(cfg.root, { recursive: true, force: true });
});

test("render — markdown NESTS the detail lines instead of making them sibling bullets", async () => {
  // A `- over: ...` at the same level as the decision it qualifies reads as a separate
  // decision. That is the one misreading this format cannot afford.
  const cfg = await root();
  const s = newSessionId();
  appendDecision(cfg, { kind: "decision", chose: "X", over: ["Y"], because: "measured", session: s, now: T(1) });
  const { text } = renderJournal(cfg, { markdown: true });
  assert.match(text, /^- \*\*X\*\*/m);
  assert.match(text, /^ {2}- over: Y$/m);
  assert.match(text, /^ {2}- because: measured$/m);
  await rm(cfg.root, { recursive: true, force: true });
});

// ── length: cap the LABELS, never the evidence ───────────────────────────────────

test("length — an over-long `chose` warns and is written ANYWAY", async () => {
  // A journal that can refuse a write is one an agent stops using mid-job, and the
  // entry it drops is the one it was too busy to reword.
  const cfg = await root();
  const long = "x".repeat(LABEL_SOFT_MAX + 50);
  const { err } = await runCaptured(async () => {
    appendDecision(cfg, { kind: "decision", chose: long, because: "-", session: newSessionId(), now: T(1) });
    return 0;
  });
  assert.match(err, /`chose` is 250 chars.*reads as rationale, not a label/s);
  assert.equal(readJournal(cfg).records[0].chose, long, "written as given — the warning is advice, not a gate");
  await cleanup(cfg.root);
});

test("length — `because` is NEVER capped on write, because the evidence lives at its end", async () => {
  // Measured on the journal that motivated this: 16 of 23 file:line citations and 22 of
  // 33 measured numbers sit past character 250. Capping there turns a checkable entry
  // into an assertable one.
  const cfg = await root();
  const evidence = "the claim comes first, and the citation that makes it checkable comes last. "
    .repeat(8) + "flux.ts:519 measured 0.38%";
  const { err } = await runCaptured(async () => {
    appendDecision(cfg, { kind: "decision", chose: "X", because: evidence, session: newSessionId(), now: T(1) });
    return 0;
  });
  assert.equal(err.trim(), "", "no warning: a long rationale is the journal working");
  assert.equal(readJournal(cfg).records[0].because, evidence);
  assert.match(renderJournal(cfg).text, /flux\.ts:519 measured 0\.38%/, "the default render withholds nothing");
  await cleanup(cfg.root);
});

test("--brief — clips the rationale for scanning and ANNOUNCES what it withheld", async () => {
  const cfg = await root();
  const long = "a".repeat(400) + " flux.ts:519";
  appendDecision(cfg, { kind: "decision", chose: "X", over: ["Y"], because: long, session: newSessionId(), now: T(1) });

  const brief = renderJournal(cfg, { brief: true }).text;
  assert.ok(!brief.includes("flux.ts:519"), "the tail is clipped");
  assert.match(brief, /\(\+\d+ chars — drop --brief for the evidence\)/, "and the reader is TOLD, with a count");
  assert.match(brief, /over: Y/, "labels are never clipped — they are already short");

  assert.match(renderJournal(cfg).text, /flux\.ts:519/, "without --brief nothing is withheld");
  await cleanup(cfg.root);
});

// ── the hookless fallback: derive the id, do not randomise it ────────────────────
//
// The failure this exists for: ~20 new `.jsonl` files in ONE DAY on a consuming project,
// because `appendDecision` fell back to a RANDOM id whenever no `--session` and no hook
// supplied one. Twenty new files is not a diff anybody reads, which converts the record
// into noise at exactly the moment it is supposed to be read.

test("fallback — no session and no hook APPENDS to one file instead of minting a new one each time", async () => {
  const cfg = await gitRoot();
  for (let i = 1; i <= 5; i++) {
    appendDecision(cfg, { kind: "decision", chose: `choice ${i}`, because: "-", now: T(i) });
  }
  const files = readdirSync(decisionsDir(cfg));
  assert.deepEqual(files, ["main-main-2026-07-28.jsonl"],
    "five hookless writes, same branch, same agent, same day — ONE file");
  assert.equal(readJournal(cfg).records.length, 5, "and every entry is still there");
  await cleanup(cfg.root);
});

test("fallback — two branches can never share a file, because the branch is IN the filename", async () => {
  // This is the property the split-file layout was bought for: distinct filenames never
  // conflict on a merge. A derived id that dropped the branch would buy a tidier PR by
  // reintroducing the conflict five concurrent agents create.
  const cfg = await gitRoot();
  appendDecision(cfg, { kind: "decision", chose: "on main", because: "-", now: T(1) });
  g(cfg.root, "checkout", "-q", "-b", "feature/compact");
  appendDecision(cfg, { kind: "decision", chose: "on the branch", because: "-", now: T(2) });

  const files = readdirSync(decisionsDir(cfg)).sort();
  assert.equal(files.length, 2, "two branches, two files — no shared file to conflict on");
  assert.ok(files.includes("main-main-2026-07-28.jsonl"));
  const other = files.find((f) => f !== "main-main-2026-07-28.jsonl")!;
  assert.match(other, /^feature-compact-[0-9a-f]{6}-main-2026-07-28\.jsonl$/,
    "`/` is sanitised, and the digest of the RAW branch keeps the flattening injective");
  await cleanup(cfg.root);
});

test("fallback — the same agent on two DAYS gets two files; two agents on one day get two files", async () => {
  const cfg = await gitRoot();
  appendDecision(cfg, { kind: "decision", chose: "day one", because: "-", now: "2026-07-28T23:59:00.000Z" });
  appendDecision(cfg, { kind: "decision", chose: "day two", because: "-", now: "2026-07-29T00:01:00.000Z" });
  appendDecision(cfg, { kind: "decision", chose: "other agent", because: "-", agent: "finder-1", now: T(3) });
  assert.deepEqual(readdirSync(decisionsDir(cfg)).sort(), [
    "main-finder-1-2026-07-28.jsonl", "main-main-2026-07-28.jsonl", "main-main-2026-07-29.jsonl",
  ]);
  await cleanup(cfg.root);
});

test("fallback — a hook-minted session keeps its RANDOM id, where the concurrency is real", async () => {
  const cfg = await gitRoot();
  const a = openSession(cfg, { agent: "finder-1" });
  const b = openSession(cfg, { agent: "finder-2" });
  assert.match(a.session, /^s-[0-9a-f]{12}$/);
  assert.notEqual(a.session, b.session, "two agents starting in the same second must not collide");
  await cleanup(cfg.root);
});

test("slug — sanitising a branch name stays INJECTIVE, so two branches cannot merge into one file", async () => {
  assert.equal(slug("main"), "main", "already safe: passed through, so every id ever written maps where it did");
  assert.equal(slug("s-1132d33c9566"), "s-1132d33c9566");
  assert.notEqual(slug("feat/x"), slug("feat-x"), "the flattening must not collapse two real branches");
  assert.ok(!slug("../../etc/passwd").includes("/"), "no separator survives — `--session` goes straight into a path");
  assert.ok(!slug("../../etc/passwd").includes(".."));
  assert.equal(derivedSessionId(null, "main", "2026-07-28T10:00:00.000Z"), "nobranch-main-2026-07-28",
    "detached HEAD still gets a stable name");
});

// ── compaction ───────────────────────────────────────────────────────────────────
//
// THE ACCEPTANCE TEST IS THAT IT CHANGES NOTHING VISIBLE. Everything else about
// compaction is a means to that end.

/** A journal of many files across two branches and two months, plus the three cases that
 *  must be LEFT ALONE: a file with an unreadable line, a file inside the quiet window, and
 *  a file git has never seen. */
async function manyFiles(): Promise<Config> {
  const cfg = await gitRoot();
  for (let i = 1; i <= 4; i++) {
    appendDecision(cfg, {
      kind: "decision", chose: `main choice ${i}`, over: [`alternative ${i}`],
      because: `evidence ${i} — file.ts:${100 + i}`, session: newSessionId(), agent: `agent-${i}`,
      now: `2026-07-2${i}T10:0${i}:00.000Z`,
    });
  }
  const d = appendDecision(cfg, {
    kind: "conjecture", chose: "139,460 habitat violations", because: "",
    couldBe: ["the sim really is that broken"], discriminatedBy: "decode one cell by hand",
    session: newSessionId(), agent: "finder", now: "2026-06-15T09:00:00.000Z",
  });
  appendDecision(cfg, {
    kind: "resolution", chose: "the decoder had an off-by-one", because: "hand-decode says 158",
    supersedes: d.id, session: newSessionId(), agent: "integrator", now: "2026-06-16T09:00:00.000Z",
  });
  g(cfg.root, "checkout", "-q", "-b", "other");
  for (let i = 1; i <= 3; i++) {
    appendDecision(cfg, {
      kind: "decision", chose: `branch choice ${i}`, because: "-",
      session: newSessionId(), agent: "brancher", now: `2026-07-1${i}T11:00:00.000Z`,
    });
  }
  await writeFile(join(decisionsDir(cfg), "s-broken.jsonl"),
    JSON.stringify({ id: "d-ok", session: "s-broken", at: T(7), kind: "decision", agent: "x", job: "-", branch: "main", commit: null, dirty: false, chose: "readable", over: [], because: "-" }) + "\nnot json at all\n");
  commitAll(cfg);
  ageOut(cfg);
  // ...and now two files that must survive untouched for reasons other than their content.
  appendDecision(cfg, { kind: "decision", chose: "live session", because: "-", session: "s-uncommitted", now: T(8) });
  appendDecision(cfg, { kind: "decision", chose: "just written", because: "-", session: "s-recent", now: T(9) });
  commitAll(cfg);                                         // s-recent is committed but FRESH
  utimesSync(join(decisionsDir(cfg), "s-uncommitted.jsonl"), Date.now() / 1000, Date.now() / 1000);
  g(cfg.root, "rm", "-q", "--cached", ".coherence/decisions/s-uncommitted.jsonl");
  g(cfg.root, "commit", "-q", "-m", "untrack the live one");
  return cfg;
}

test("compact — THE RENDER IS CHARACTER-FOR-CHARACTER IDENTICAL, which is the whole contract", async () => {
  const cfg = await manyFiles();
  const before = readdirSync(decisionsDir(cfg)).sort();
  // Every render shape, because a compaction that only preserved the default one would
  // still be wrong: the summary counts, the per-session table and the markdown all read
  // the same records through different code.
  const shapes = [{}, { sessions: true }, { md: true, brief: true }, { open: true }, { branch: "main" }];
  const rendered = shapes.map((o) => renderJournal(cfg, o).text);
  const records = readJournal(cfg);

  const { code, lines } = compactJournal(cfg);
  assert.equal(code, 0, lines.join("\n"));

  // THE CONTRACT FIRST, and deliberately before the file-layout evidence below. When this
  // test was written the order was the other way round, and a negative control that broke
  // compaction failed on an `assert.ok(after.includes(...))` — a true failure, but not the
  // one being demonstrated. An acceptance test that can be pre-empted by its own supporting
  // assertions cannot show you what it is for.
  for (const [i, o] of shapes.entries()) {
    assert.equal(renderJournal(cfg, o).text, rendered[i],
      `the render moved under ${JSON.stringify(o)} — compaction is WRONG and must not ship`);
  }
  const now = readJournal(cfg);
  assert.equal(now.records.length, records.records.length, "no line gained or lost");
  assert.equal(now.unreadable, records.unreadable, "and the damage count is preserved, not repaired");
  assert.deepEqual(now.records, records.records, "record for record, field for field");

  // ...and the evidence that it did the job it was asked to do, rather than nothing at all.
  const after = readdirSync(decisionsDir(cfg)).sort();
  assert.ok(after.length < before.length, `${before.length} → ${after.length}: it must actually fold something`);
  assert.ok(after.includes("main-2026-07.jsonl") && after.includes("main-2026-06.jsonl")
    && after.includes("other-2026-07.jsonl"),
    `(branch, month) grouping — got ${after.join(" ")}`);
  assert.ok(after.includes("s-broken.jsonl"), "an unreadable line has no timestamp: leave the file alone");
  assert.ok(after.includes("s-uncommitted.jsonl"), "git has no copy — folding it would be a deletion");
  assert.ok(after.includes("s-recent.jsonl"), "inside the quiet window — a live agent may still hold it");
  // THE REPORTED COUNT IS THE ONE A HUMAN JUDGES THE RUN BY, so it is asserted against the
  // directory. It was wrong once — derived as `before - folded`, which subtracted the files
  // unlinked and forgot the ones written, and reported this repo's own 15 → 5 fold as "15
  // file(s) → 1".
  assert.match(lines.join("\n"), new RegExp(`${before.length} file\\(s\\) → ${after.length}\\b`),
    `the report must match the directory: ${lines.join(" / ")}`);
  await cleanup(cfg.root);
});

test("compact — the concatenation is in timestamp order, and every line is byte-identical", async () => {
  // Ordering has its own assertion because the READER's sort is total, so a scrambled
  // concatenation would still render correctly — and a property nothing checks is a
  // property that rots. Byte-identity is checked here too: re-serialising through
  // JSON.stringify would reorder keys and re-escape unicode.
  const cfg = await manyFiles();
  const original = new Map<string, string>();
  for (const f of readdirSync(decisionsDir(cfg))) {
    for (const line of readFileSync(join(decisionsDir(cfg), f), "utf8").split("\n").filter((l) => l.trim())) {
      original.set(line, f);
    }
  }
  compactJournal(cfg);
  for (const f of readdirSync(decisionsDir(cfg))) {
    const lines = readFileSync(join(decisionsDir(cfg), f), "utf8").split("\n").filter((l) => l.trim());
    for (const line of lines) assert.ok(original.has(line), `line was rewritten, not copied, in ${f}: ${line.slice(0, 60)}`);
    // The deliberately-unreadable fixture file has a line with no timestamp — which is
    // precisely why compaction leaves that file alone rather than trying to order it.
    const ats = lines.map((l) => { try { return JSON.parse(l).at as string; } catch { return null; } }).filter((a): a is string => !!a);
    assert.deepEqual(ats, [...ats].sort(), `${f} is not in timestamp order`);
  }
  await cleanup(cfg.root);
});

test("compact — REFUSES on a dirty journal, and folds nothing at all", async () => {
  // The dangerous case, and the only file-state refusal: a TRACKED journal file whose
  // content differs from HEAD means the record was edited in place. Folding that
  // difference into a bigger file would hide an edit the journal forbids outright.
  const cfg = await manyFiles();
  // A file the plan would otherwise fold, so the refusal is what stops it and not the
  // quiet window or the never-committed skip.
  const victim = planCompaction(cfg).groups[0].sources[0].file;
  const before = readdirSync(decisionsDir(cfg)).sort();
  const p = join(decisionsDir(cfg), victim);
  writeFileSync(p, readFileSync(p, "utf8").replace(/"because":"[^"]*"/, '"because":"EDITED IN PLACE"'));
  ageOut(cfg, [victim]);

  const { code, lines } = compactJournal(cfg);
  assert.equal(code, 1, "a dirty journal is a refusal, not a warning");
  assert.match(lines.join("\n"), /REFUSED — nothing was compacted/);
  assert.match(lines.join("\n"), new RegExp(`${victim} differs from HEAD`));
  assert.match(lines.join("\n"), /git log/, "it must say WHY the commit is the precondition");
  assert.deepEqual(readdirSync(decisionsDir(cfg)).sort(), before, "and not one file moved");
  await cleanup(cfg.root);
});

test("compact — refuses to fold a file git has never seen, even when the tree looks clean", async () => {
  // `git status` says nothing about IGNORED files, so a project that gitignored
  // `.coherence/decisions/` would look perfectly clean while holding no committed copy of
  // anything. `ls-tree HEAD` is the question that actually matters.
  const cfg = await gitRoot();
  await writeFile(join(cfg.root, ".gitignore"), ".coherence/\n");
  for (let i = 1; i <= 3; i++) {
    appendDecision(cfg, { kind: "decision", chose: `c${i}`, because: "-", session: newSessionId(), now: T(i) });
  }
  commitAll(cfg);                          // commits .gitignore; the journal stays ignored
  ageOut(cfg);
  assert.equal(g(cfg.root, "status", "--porcelain").stdout.trim(), "", "the tree LOOKS clean");

  const plan = planCompaction(cfg);
  assert.equal(plan.groups.length, 0, "nothing may be folded");
  assert.equal(plan.skipped.length, 3);
  for (const s of plan.skipped) assert.match(s.why, /never committed/);
  const { code, lines } = compactJournal(cfg);
  assert.equal(code, 0, "not a failure — there is simply nothing safe to do");
  assert.equal(readdirSync(decisionsDir(cfg)).length, 3);
  assert.match(lines.join("\n"), /3 file\(s\) → 3/);
  await cleanup(cfg.root);
});

test("compact — outside a repo with a commit it refuses, because there is nothing to fall back on", async () => {
  const cfg = await root();                                        // no git at all
  appendDecision(cfg, { kind: "decision", chose: "x", because: "-", session: newSessionId(), now: T(1) });
  ageOut(cfg);
  const { code, lines } = compactJournal(cfg);
  assert.equal(code, 1);
  assert.match(lines.join("\n"), /no git HEAD to fall back on/);
  assert.equal(readdirSync(decisionsDir(cfg)).length, 1);
  await cleanup(cfg.root);
});

test("compact — running it twice is a no-op the second time", async () => {
  const cfg = await manyFiles();
  // Two passes to reach the fixed point: the first fold leaves the live and the fresh file
  // alone by design, and committing + ageing them makes them foldable, so the SECOND pass
  // absorbs them. The third is the one that must find nothing left to do.
  for (let i = 0; i < 2; i++) { compactJournal(cfg); commitAll(cfg); ageOut(cfg); }
  const after2 = readdirSync(decisionsDir(cfg)).sort();
  const render2 = renderJournal(cfg).text;
  const { code, lines } = compactJournal(cfg);
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /nothing to compact/);
  assert.deepEqual(readdirSync(decisionsDir(cfg)).sort(), after2, "a pass must not rewrite its own output");
  assert.equal(renderJournal(cfg).text, render2);
  await cleanup(cfg.root);
});

test("compact — a fresh decision after compaction lands in the derived file, not back in the pile", async () => {
  const cfg = await manyFiles();
  compactJournal(cfg);
  commitAll(cfg);
  const before = renderJournal(cfg).text;
  appendDecision(cfg, { kind: "decision", chose: "after the fold", because: "-", now: "2026-07-30T08:00:00.000Z" });
  appendDecision(cfg, { kind: "decision", chose: "and another", because: "-", now: "2026-07-30T09:00:00.000Z" });
  const files = readdirSync(decisionsDir(cfg));
  assert.ok(files.includes("other-main-2026-07-30.jsonl"), `derived id expected, got ${files.join(" ")}`);
  assert.notEqual(renderJournal(cfg).text, before, "the new entries render — compaction did not shut the journal");
  await cleanup(cfg.root);
});
