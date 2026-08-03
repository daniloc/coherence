// due.ts — WHICH INSTRUMENTS THE TREE HAS OUTRUN, counted in commits.
//
// ── THE FINDING ───────────────────────────────────────────────────────────────────────
//
// `.coherence/status.json` stamps every section with the commit that produced it, and
// nothing ever reads those stamps back to ask whether they are still current. Measured
// across two projects the day this was written:
//
//     coherence   verify 1 · atlas 2 · mass 2 · economy 45 · drift 45
//     hoist       verify 1 · atlas 1 · mass 11 · economy 28   (full tier: 9)
//
// Five sections on two repos, four of them tens of commits behind a tree that moved every
// day. Nobody was ignoring the tool; nobody was being told.
//
// ── COMMITS, NOT CLOCK, AND THAT IS THE WHOLE MEASUREMENT ────────────────────────────
//
// A repo nobody touched is neglecting nothing. `economy` last run three weeks ago is
// perfect health on a frozen tree and an emergency on this one, and wall-clock cannot
// tell those apart — it reports the same "3 weeks" for both. NEGLECT IS THE TREE MOVING
// WHILE THE INSTRUMENT DID NOT, so the unit is commits landed since the recorded run, and
// a quiet week is silent by construction rather than by a special case.
//
// ── WHY THIS PRINTS AN IMPERATIVE INSTEAD OF AN ADVISORY ─────────────────────────────
//
// Transcript archaeology over 234MB found NO recorded instance of a printed advisory
// causing action: `--raise` was invoked four times ever, and 89 of 89 never-red findings
// were never asked about. What demonstrably moves an agent is the SessionStart
// instruction block — its journal imperative produced hundreds of entries in days, and
// its `DOUBT THE INSTRUMENT` paragraph propagated to a consuming project verbatim. So the
// reading ships in the channel with the only demonstrated hit rate, as a section of an
// existing block rather than as a new command: three commands were evicted this week for
// having no invocations, and a fourth nobody runs would be the same mistake with a longer
// help string.
//
// That channel is also the widest blast radius in this repo — the block reaches every
// adopting project on repin, and it already carries three imperatives. A fourth that
// fired on every session would dilute all four. SILENCE WHEN NOTHING IS DUE IS THEREFORE
// NOT A POLISH ITEM; it is the condition on which this is allowed to exist at all, and it
// is why the thresholds below err toward saying nothing.
//
// ── IT NEVER WRITES AND IT NEVER GATES ───────────────────────────────────────────────
//
// Every function here reads: the run record, and `git rev-list --count`. Nothing is
// recorded about having reported, no "last nagged at" stamp, no journal entry. `d-738d7116`
// already settled that a surprising write is how a mechanism gets switched off wholesale
// rather than tuned, and a SessionStart hook that mutated the repo as a side effect of
// starting a session is the purest available form of that mistake. A build that fails
// because you have not run something often enough gets deleted, so this returns text and
// no exit code — `runHook` returns 0 whatever this says.
//
// ── DECLINING IS JOURNALED, AND THAT IS THE LOAD-BEARING HALF ────────────────────────
//
// The emitted text names `coherence blocked` because without it a DEFERRED item and a
// NEGLECTED one are identical forever: both read as "45 commits" next session and the one
// after. `blocked` is what lets the next reader tell "nobody looked" from "we looked and
// decided not to" — the same absent-vs-unreadable distinction that runs through this whole
// codebase (floor.ts's refusal, status.ts's skip-never-clobbers, `dismiss` vs `resolved`).
// The reading itself is deliberately NOT suppressed by a `blocked` entry: suppression
// would need a stored key, the key would need to survive rewording, and a stale
// suppression is a silence nobody can see. The journal entry is for the human reading the
// timeline, not for this printer.
import { spawnSync } from "node:child_process";
import { readStatus } from "./status.ts";
import { COMMANDS } from "./commands.ts";
import type { Config } from "./types.ts";

/**
 * HOW MANY COMMITS BEFORE A RECORDED RUN STOPS BEING CURRENT.
 *
 * There is no measurement that fixes this number, so it is chosen against the failure
 * mode rather than against the data. Both dogfood repos commit 8–39 times on an active
 * day, so ten is roughly half a working day of motion — long enough that the tree has
 * genuinely changed underneath the verdict, short enough to still be this session's
 * problem. The observed split sat at 1·1·2·2 (current) against 9·11·28·45·45 (stale),
 * so ten lands inside the gap rather than through a cluster.
 *
 * Erring HIGH is the safe direction: a threshold too low prints on every session, and a
 * section of this block that always prints costs the other three their attention.
 */
export const DUE_AFTER = 10;

/** THE CAP, and the reason is raise.ts's verbatim: a floor is a precision knob and a repo
 *  can sit above it any number of times, so the bound that does not depend on tuning is a
 *  hard count. Three, because the block this joins already carries three imperatives and a
 *  fourth section longer than them would invert the priority of the whole block. What is
 *  over the cap is NEVER silent — `formatDue` names the count and the sections, because a
 *  truncated list that looks complete is the defect this harness exists to hunt. */
export const DUE_CAP = 3;

/** One instrument the tree has outrun. `commits` is what ordered it; `why` is the clause
 *  that makes it actionable, and it differs per reading (a section that has not run at all
 *  says something different from one that runs constantly in a tier that skips the
 *  oracles). */
export interface DueItem {
  section: string;
  commits: number;
  why: string;
}

/** ONE READING OF THE RUN RECORD against the tree that has moved since — everything
 *  `formatDue` needs, including the two things it must not have to assume: what was
 *  withheld by the cap, and how much of the tool this reading cannot see at all. */
export interface DueReading {
  /** Over threshold, most-neglected first, capped at `DUE_CAP`. */
  due: DueItem[];
  /** Over threshold and over the cap. Reported as a count, never dropped. */
  withheld: DueItem[];
  /** Sections that record but whose stamped commit is not in this history — a rebase, a
   *  shallow clone, a record copied between checkouts. NOT reported as stale: an
   *  uncountable distance and a zero distance must not look alike, which is the same rule
   *  atlas.ts applies to an unmeasurable `heat`. */
  uncountable: string[];
  /** How many commands file a report at all, and how many exist. The blind spot, carried
   *  as data so the formatter states it rather than asserting completeness it lacks. */
  recording: number;
  commands: number;
  /** The cap this reading was taken under — carried so the withheld line quotes the bound
   *  itself rather than `due.length`, which equals it only by coincidence. */
  cap: number;
}

/**
 * Commits landed since `commit`, or null when the distance cannot be established.
 *
 * NULL IS A REAL ANSWER HERE. `git rev-list A..HEAD` exits non-zero when A is not an
 * object in this repository — after a rebase, in a shallow clone, or when a status record
 * travelled between checkouts — and coercing that to 0 would report the most neglected
 * possible section as perfectly current. Absent must not read as green; that is the defect
 * this file's own hook block spends a paragraph on.
 */
export function commitsSince(root: string, commit: string): number | null {
  const r = spawnSync("git", ["rev-list", "--count", `${commit}..HEAD`], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return null;
  const n = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Commits landed since an instant. Used ONLY for the tier reading, because `lastFullAt`
 * and `lastFastAt` are timestamps — the record stamps one commit per section, not one per
 * tier, so there is no hash to diff from.
 *
 * This is an APPROXIMATION and is named as one wherever it is reported: `--since` filters
 * on COMMITTER date, which a rebase rewrites, so a rebased branch can under-count. It is
 * still the honest unit — commits, not elapsed days — and the alternative (widening the
 * record to stamp a commit per tier) is a schema change on every adopting project to
 * sharpen a number that is already directionally right.
 */
export function commitsSinceTime(root: string, iso: string): number | null {
  const r = spawnSync("git", ["rev-list", "--count", `--since=${iso}`, "HEAD"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return null;
  const n = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/** A recorded section: any key of the run record carrying its own `at` + `commit` stamp.
 *  DERIVED, never a hand-kept list — a section added to status.ts tomorrow is read here
 *  without editing this file, which is the correspondence commands.ts exists to kill. */
function stampedSections(rec: unknown): Array<{ name: string; commit: string | null }> {
  if (!rec || typeof rec !== "object") return [];
  const out: Array<{ name: string; commit: string | null }> = [];
  for (const [name, v] of Object.entries(rec as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const s = v as Record<string, unknown>;
    if (typeof s.at !== "string") continue;
    out.push({ name, commit: typeof s.commit === "string" ? s.commit : null });
  }
  return out;
}

/**
 * READ THE RECORD AND ASK WHAT THE TREE HAS OUTRUN. Pure of writes; safe to call from a
 * hook, which is the only caller that matters.
 *
 * A SECTION THAT HAS NEVER RUN IS SILENT. An absent section is ambiguous three ways —
 * never ran, does not record, or is not applicable to this project — and reporting the
 * first would fire forever on every consuming project with no reason to run `drift`. The
 * definition being implemented presupposes an instrument that moved once: neglect is the
 * tree moving while the instrument did not. Never-having-run is UNADOPTION, a different
 * finding, and one this reading has no evidence about.
 */
export async function readDue(cfg: Config, after = DUE_AFTER, cap = DUE_CAP): Promise<DueReading> {
  const commands = COMMANDS.length;
  // Sections whose name is not a live command are skipped rather than reported: the whole
  // value of an item is the exact line the reader can run, and an item that cannot name
  // one is a complaint.
  const runnable = new Set(COMMANDS.map((c) => c.name));
  const blank: DueReading = { due: [], withheld: [], uncountable: [], recording: 0, commands, cap };

  // An unreadable record is `verify`'s refusal to make, not a session hook's. This block
  // reaches every adopting project on repin; throwing here would break every session in
  // one, which is a far worse failure than one missed reading.
  let rec: Awaited<ReturnType<typeof readStatus>>;
  try { rec = await readStatus(cfg); } catch { return blank; }

  const sections = stampedSections(rec);
  const recording = sections.filter((s) => runnable.has(s.name)).length;
  const items: DueItem[] = [];
  const uncountable: string[] = [];

  for (const { name, commit } of sections) {
    if (!runnable.has(name)) continue;
    if (!commit) { uncountable.push(name); continue; }
    const n = commitsSince(cfg.root, commit);
    if (n === null) { uncountable.push(name); continue; }
    if (n >= after) {
      items.push({ section: name, commits: n, why: `has not run in ${n} commits` });
      continue;
    }
    // ── THE TIER READING, and it only applies to a section the first reading cleared.
    // `verify --fast` skips every boundary oracle, so a `verify` section stamped an hour
    // ago can be simultaneously the freshest thing in the record and evidence that no
    // oracle has executed in a fortnight. Reporting the section as current on the strength
    // of a run that graded almost nothing is green-by-absence in the newest instrument.
    //
    // AT MOST ONE ITEM PER SECTION, by construction: this branch is unreachable when the
    // plain reading fired, and the plain reading subsumes it — a `verify` that has not run
    // at all has not run a full tier either, and two lines pointing at one command would
    // spend the cap on a repetition.
    if (name !== "verify") continue;
    const full = rec.verify?.lastFullAt ?? null;
    const fast = rec.verify?.lastFastAt ?? null;
    // Both stamps required: a project that has only ever run one tier is not skipping the
    // other, it has one habit, and there is no evidence of a tier being avoided.
    if (!full || !fast || fast <= full) continue;
    const since = commitsSinceTime(cfg.root, full);
    if (since === null || since < after) continue;
    items.push({
      section: name,
      commits: since,
      why: `last ran its FULL tier ${since} commits ago (approx — committer dates); every run\n    since was --fast, which skips every boundary oracle`,
    });
  }

  items.sort((a, b) => b.commits - a.commits || a.section.localeCompare(b.section));
  return { due: items.slice(0, cap), withheld: items.slice(cap), uncountable, recording, commands, cap };
}

/**
 * THE EMITTED SECTION, or nothing at all.
 *
 * Returns `[]` when nothing is due — the caller appends nothing, and the block it joins is
 * byte-identical to what it was before this shipped. That is the contract the whole
 * feature rests on.
 */
export function formatDue(r: DueReading, cli: string, scope: string): string[] {
  if (!r.due.length) return [];
  const out = [
    "",
    "COHERENCE WORK IS DUE — fold these into this session's tasks.",
    "",
  ];
  for (const d of r.due) out.push(`  · ${d.section} ${d.why}`, `      ${cli} ${d.section}`);
  if (r.withheld.length) {
    out.push("", `    WITHHELD ${r.withheld.length} more — the cap is ${r.cap} per session `
      + `(${r.withheld.map((w) => `${w.section} ${w.commits}`).join(" · ")}).`);
  }
  out.push(
    "",
    "Not blocking, and nothing here was written to disk. IF YOU DECLINE ONE, SAY WHY —",
    "that is what lets the next session tell \"nobody looked\" from \"we decided not to\".",
    "Without it a deferred item and a neglected one read identically forever:",
    "",
    `  ${cli} blocked "<what you did not do>" --because "<why>" ${scope}`,
    "",
    // THE BLIND SPOT, stated rather than implied. Only the run record can be read, and only
    // a handful of commands write to it; claiming this list is "what is due" would be
    // green-by-absence in the newest instrument in the repo — the exact defect a day was
    // spent removing. So it says what it can see and what it cannot.
    `Counted from .coherence/status.json, which only ${r.recording} of ${r.commands} commands write. For the`,
    `other ${r.commands - r.recording}, "has not run" and "does not record" are indistinguishable, so they are`,
    "not reported here — this is not a complete account of what is due.",
  );
  if (r.uncountable.length) {
    out.push(
      `Distance unknown for: ${r.uncountable.join(", ")} — the stamped commit is not in this`,
      "history (rebase, shallow clone), so the count is absent rather than zero.",
    );
  }
  return out;
}
