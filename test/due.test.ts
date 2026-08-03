// due.test.ts — the work-order reading: which instruments the tree has outrun.
//
// The tests that matter here are the NEGATIVE ones. This section joins the block that
// reaches every adopting project on repin, so the property worth defending is that it says
// NOTHING almost all of the time — a section that fires on every session costs the three
// imperatives beside it their attention, and none of the positive cases are worth that.
// Hence: silence on a current repo, silence on a section that never ran, silence on a
// distance that cannot be counted, and silence on a quiet tree no matter how old the run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readDue, formatDue, commitsSince, DUE_AFTER, DUE_CAP } from "../src/due.ts";
import { COMMANDS } from "../src/commands.ts";
import { agentInstructions } from "../src/hooks.ts";
import { tmpProject, cleanup, cfg } from "./_helpers.ts";

const git = (root: string, ...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });

/** A throwaway repo with `n` commits, returning the short hash of each in order. */
async function repo(n: number): Promise<{ root: string; commits: string[] }> {
  const root = await tmpProject({ "seed.txt": "0" });
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t.t");
  git(root, "config", "user.name", "t");
  const commits: string[] = [];
  for (let i = 0; i < n; i++) {
    await writeFile(join(root, "seed.txt"), String(i));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", `c${i}`);
    commits.push(git(root, "rev-parse", "--short", "HEAD").stdout.trim());
  }
  return { root, commits };
}

async function status(root: string, rec: Record<string, unknown>): Promise<void> {
  await mkdir(join(root, ".coherence"), { recursive: true });
  await writeFile(join(root, ".coherence", "status.json"), JSON.stringify({ version: 1, ...rec }, null, 2));
}

const at = "2026-01-01T00:00:00.000Z";

test("due — SILENT when every instrument is current, and the emitted section is then empty", async () => {
  // THE CONTRACT THE WHOLE FEATURE RESTS ON. If this ever fails, the block gains a fourth
  // permanent imperative and the other three lose their standing.
  const { root, commits } = await repo(3);
  await status(root, { economy: { at, commit: commits.at(-1) }, mass: { at, commit: commits.at(-2) } });
  const r = await readDue(cfg(root));
  assert.deepEqual(r.due, []);
  assert.deepEqual(formatDue(r, "npx coherence", "--session \"s\""), [],
    "nothing due must append nothing at all — not a header, not a blank line");
  await cleanup(root);
});

test("due — a section the tree has outrun is reported in COMMITS, with the exact command to run", async () => {
  const { root, commits } = await repo(DUE_AFTER + 2);
  await status(root, { economy: { at, commit: commits[0] } });
  const r = await readDue(cfg(root));
  assert.equal(r.due.length, 1);
  assert.equal(r.due[0].section, "economy");
  assert.equal(r.due[0].commits, DUE_AFTER + 1, "distance is commits landed since the stamped commit");
  const text = formatDue(r, "npx coherence", '--session "s"').join("\n");
  assert.match(text, /COHERENCE WORK IS DUE/);
  assert.match(text, /economy has not run in 11 commits/);
  assert.match(text, /npx coherence economy/, "an item that cannot name a runnable command is a complaint");
  await cleanup(root);
});

test("due — a QUIET tree is silent however old the run: the unit is commits, never the clock", async () => {
  // A repo nobody touched is neglecting nothing. The stamp below is from January; the
  // tree has not moved since, so there is nothing to fold into anything.
  const { root, commits } = await repo(2);
  await status(root, { economy: { at: "2020-01-01T00:00:00.000Z", commit: commits.at(-1) } });
  const r = await readDue(cfg(root));
  assert.deepEqual(r.due, [], "six years stale and zero commits stale — the second is the measurement");
  await cleanup(root);
});

test("due — a section that has NEVER run is silent; never-ran is unadoption, not neglect", async () => {
  // The reading deliberately declined. An absent section is ambiguous three ways (never
  // ran / does not record / not applicable here), so reporting it would fire forever on
  // every consuming project with no reason to run `drift`.
  const { root, commits } = await repo(DUE_AFTER + 5);
  await status(root, { verify: { at, commit: commits.at(-1) } });
  const r = await readDue(cfg(root));
  assert.deepEqual(r.due.map((d) => d.section), [], "no drift/economy/mass/atlas section exists — say nothing about them");
  assert.equal(r.recording, 1);
  await cleanup(root);
});

test("due — ordered by staleness, capped, and the withheld remainder is NAMED rather than dropped", async () => {
  const { root, commits } = await repo(41);
  await status(root, {
    economy: { at, commit: commits[0] },   // 40 behind
    drift: { at, commit: commits[10] },    // 30
    mass: { at, commit: commits[20] },     // 20
    atlas: { at, commit: commits[30] },    // 10
  });
  const r = await readDue(cfg(root));
  assert.deepEqual(r.due.map((d) => d.section), ["economy", "drift", "mass"], "most-neglected first");
  assert.equal(r.due.length, DUE_CAP);
  assert.deepEqual(r.withheld.map((d) => d.section), ["atlas"]);
  const text = formatDue(r, "npx coherence", '--session "s"').join("\n");
  assert.match(text, /WITHHELD 1 more — the cap is 3 per session \(atlas 10\)/,
    "a truncated list that looks complete is the defect this harness hunts");
  await cleanup(root);
});

test("due — a fresh verify whose FULL tier is far behind is reported; a --fast run grades almost nothing", async () => {
  // Green-by-absence in the newest instrument: the section stamp says "an hour ago" while
  // every boundary oracle has been skipped for a fortnight.
  const { root, commits } = await repo(DUE_AFTER + 3);
  const old = spawnSync("git", ["log", "-1", "--format=%cI", commits[1]], { cwd: root, encoding: "utf8" }).stdout.trim();
  await status(root, {
    verify: { at, commit: commits.at(-1), lastFullAt: old, lastFastAt: "2030-01-01T00:00:00.000Z" },
  });
  const r = await readDue(cfg(root));
  assert.equal(r.due.length, 1);
  assert.equal(r.due[0].section, "verify");
  assert.match(r.due[0].why, /FULL tier/);
  assert.match(r.due[0].why, /--fast, which skips every boundary oracle/);
  await cleanup(root);
});

test("due — verify never yields two items: the plain reading subsumes the tier reading", async () => {
  // Both conditions hold at once here. Two lines pointing at one command would spend a
  // third of the cap on a repetition.
  const { root, commits } = await repo(DUE_AFTER + 3);
  const old = spawnSync("git", ["log", "-1", "--format=%cI", commits[0]], { cwd: root, encoding: "utf8" }).stdout.trim();
  await status(root, {
    verify: { at, commit: commits[0], lastFullAt: old, lastFastAt: "2030-01-01T00:00:00.000Z" },
  });
  const r = await readDue(cfg(root));
  assert.equal(r.due.length, 1);
  assert.match(r.due[0].why, /has not run in/, "the stronger, unapproximated reading wins");
  await cleanup(root);
});

test("due — a tier with only ONE habit is not a tier being skipped", async () => {
  // A project that has never run --fast is not avoiding the full tier. No evidence, no item.
  const { root, commits } = await repo(DUE_AFTER + 3);
  const old = spawnSync("git", ["log", "-1", "--format=%cI", commits[1]], { cwd: root, encoding: "utf8" }).stdout.trim();
  await status(root, { verify: { at, commit: commits.at(-1), lastFullAt: old } });
  assert.deepEqual((await readDue(cfg(root))).due, []);
  await cleanup(root);
});

test("due — an UNCOUNTABLE distance is never reported as zero, and says so in its own words", async () => {
  // A rebase, a shallow clone, a record copied between checkouts. `git rev-list` exits
  // non-zero and coercing that to 0 would report the most neglected section as current.
  const { root, commits } = await repo(DUE_AFTER + 2);
  assert.equal(commitsSince(root, "deadbee"), null, "an unknown object is null, not 0");
  await status(root, { economy: { at, commit: "deadbee" }, mass: { at, commit: commits[0] } });
  const r = await readDue(cfg(root));
  assert.deepEqual(r.due.map((d) => d.section), ["mass"]);
  assert.deepEqual(r.uncountable, ["economy"]);
  assert.match(formatDue(r, "npx coherence", '--session "s"').join("\n"),
    /Distance unknown for: economy/, "absent must not read as green, and must not read as red either");
  await cleanup(root);
});

test("due — the emitted text STATES ITS OWN BLIND SPOT and teaches the verb that records a decline", async () => {
  const { root, commits } = await repo(DUE_AFTER + 2);
  await status(root, { economy: { at, commit: commits[0] } });
  const text = formatDue(await readDue(cfg(root)), "npx coherence", '--session "s"').join("\n");
  assert.match(text, new RegExp(`only 1 of ${COMMANDS.length} commands write`),
    "claiming this list is what is due would be green-by-absence in the newest instrument");
  assert.match(text, /"has not run" and "does not record" are indistinguishable/);
  assert.match(text, /not a complete account of what is due/);
  // The load-bearing half: without a journaled decline, a DEFERRED item and a NEGLECTED
  // one read identically forever.
  assert.match(text, /npx coherence blocked "<what you did not do>" --because "<why>" --session "s"/);
  assert.match(text, /"nobody looked" from "we decided not to"/);
  assert.match(text, /Not blocking/);
  await cleanup(root);
});

test("due — reading it WRITES NOTHING; a surprising write is how a mechanism gets switched off", async () => {
  const { root, commits } = await repo(DUE_AFTER + 2);
  await status(root, { economy: { at, commit: commits[0] } });
  const p = join(root, ".coherence", "status.json");
  const before = readFileSync(p, "utf8");
  const listBefore = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout;
  await readDue(cfg(root));
  assert.equal(readFileSync(p, "utf8"), before, "the run record is read-only to this reading");
  assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout, listBefore,
    "no stamp, no marker, no journal entry — nothing about having reported is persisted");
  await cleanup(root);
});

test("due — an absent or unreadable run record fails to SILENCE, never to a thrown hook", async () => {
  // This runs inside SessionStart on every adopting project. A throw here breaks every
  // session in that project, which is far worse than one missed reading — `verify` owns
  // the refusal on an unreadable record.
  const { root } = await repo(2);
  assert.deepEqual((await readDue(cfg(root))).due, [], "no record at all");
  await mkdir(join(root, ".coherence"), { recursive: true });
  await writeFile(join(root, ".coherence", "status.json"), "{ truncated");
  assert.deepEqual((await readDue(cfg(root))).due, [], "a corrupt record");
  await cleanup(root);
});

test("due — the instruction block itself stays a PURE function: the reading is composed at the emit site", () => {
  // `agentInstructions` is printed verbatim by `coherence hooks` and compared byte-for-byte
  // by its own tests. If the work order ever migrates inside it, a documentation command's
  // output starts varying by repo state and by day — commands.ts's "no clock, nothing
  // machine-specific" rule, broken in the widest-reach file in the repo.
  const t = agentInstructions("s-abc", "npx coherence");
  assert.doesNotMatch(t, /WORK IS DUE/);
  assert.equal(t, agentInstructions("s-abc", "npx coherence"), "same inputs, same bytes — no clock, no git");
});

test("due — a section whose name is not a live command is skipped, not guessed at", async () => {
  // The item's whole value is the line the reader can run. A future record key with no
  // command behind it must not produce `npx coherence <not-a-command>`.
  const { root, commits } = await repo(DUE_AFTER + 2);
  await status(root, { telemetry: { at, commit: commits[0] } });
  const r = await readDue(cfg(root));
  assert.deepEqual(r.due, []);
  assert.equal(r.recording, 0);
  await cleanup(root);
});
