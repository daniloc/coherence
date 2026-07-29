// decisions.ts — the decision journal: what an agent CHOSE, what it chose that OVER,
// and why. One file per agent session; one merged timeline across all of them.
//
// THE PROBLEM IT EXISTS FOR. Five subagents at 400k tokens each produce more context
// than anything can read, and the report each one hands back is written by the agent
// that did the work — so it records what was concluded, never what was considered and
// dropped. The transcript has that information and is unreadable; the report is
// readable and has lost it. This is the third option: each agent emits a line per
// decision AS IT MAKES IT, and the orchestrator reads the merged journal.
//
// THE UNIT IS A DECISION, NOT AN OBSERVATION — a point where the work could have gone
// more than one way and someone chose. An earlier design had seven event types
// (OBSERVED / INFERRED / ASSUMED / ...); that was the wrong granularity, because most
// of them are noise at the scale that survives context loss.
//
// ...WITH ONE EXCEPTION, AND IT EARNED ITS PLACE: THE CONJECTURE. `decide` records a
// choice, `blocked` records an impasse, and NOTHING recorded what was WONDERED. That
// gap cost real money. Six findings from a single session, every one of them reached by
// the same move — a number was surprising, so the INSTRUMENT was doubted before the
// SUBJECT — and not one of them was representable here:
//   · 139,460 habitat violations → the decoder had an off-by-one (`floor(v/16)` vs
//     `floor((v-1)/16)`). The true count was 158.
//   · 4,237 removed lines charged to an 1,139-line file → impossible on its face;
//     deleted files emit `+++ /dev/null` and their removals landed on the file before.
//   · "arm A wrote 3x the code" → it measured patch-file lines, not added lines. The
//     arms were within 1.6%.
//   · a mutation harness scored every fault as caught → the repo ships a declared
//     expected-failure ledger and is already red at rest.
//   · a negative control "passed" → its regex never matched, so it tested nothing.
// Six for six, the instrument. So a conjecture carries CANDIDATE explanations rather
// than a conclusion, and `withInstrumentCandidate` guarantees that "the instrument is
// wrong" is always one of them, whether or not the author thought of it.
//
// AND THE UNRESOLVED STATE IS THE VALUABLE ONE. A question somebody stopped asking and
// a question somebody answered are not the same object, and only the journal can tell
// them apart — so open conjectures render FIRST, above the settled decisions, and the
// summary line shouts their count. The standing list of things this project noticed and
// did not chase is worth more than any single entry on it.
//
// ...WHICH IS EXACTLY WHY A THIRD STATE EXISTS: DISMISSED. Once an ADVISORY can raise a
// question (see `raise.ts`), questions arrive faster than anyone answers them, and the
// only defence against a noisy one is a way to make it go away permanently. A dismissal
// is that way, and it is deliberately NOT a resolution: "we answered this" and "we
// decided not to ask" are different facts, and a render that files them together tells a
// reader an unanswered question has an answer. It is the same distinction `resolve()`
// already refuses to blur between a conjecture and a decision, one level further out.
// It is an APPEND like everything else — a dismissal that deleted the line would be
// indistinguishable from a question nobody ever raised, and the whole value of `--open`
// is that it counts what this project chose not to chase.
//
// TWO FIELDS DO THE WORK, and both are what a gate-shaped design drops:
//   `over`   — what was REJECTED. This is what stops re-litigation. In the session
//              that motivated this file, roughly half the cost was reconsidering
//              settled questions; the grid was reopened three separate times.
//   status   — standing, or retracted with a pointer at what replaced it. A verdict
//              stood for two passes because nothing recorded it as INFERRED rather
//              than established.
//
// WHY ONE FILE PER SESSION rather than one shared journal:
//   1. TWO BRANCHES MERGE CLEANLY. Distinct filenames never conflict; a single shared
//      JSONL conflicts on every parallel branch, which is precisely the situation
//      five concurrent agents create.
//   2. ATTRIBUTION IS STRUCTURAL. The file IS the session, so a record cannot lose
//      track of who wrote it even if an agent forgets its own `--agent`.
//   3. CONCURRENT APPEND STOPS BEING A QUESTION. Separate files cannot interleave.
//      (Measured anyway, because an agent can still fire two writes at once from one
//      session: `appendFileSync` at 8 concurrent writers x 300 lines, 200 B .. 64 KB,
//      is 2400/2400 intact with 0 torn and 0 missing. The same probe with a
//      read-then-write-at-offset writer loses 1242 of 2400, so it can see loss when
//      loss exists. No lock — and a lock is a thing five agents can deadlock on.)
//
// IT GATES NOTHING, DELIBERATELY. The moment this can fail a build it acquires an
// incentive to be complete, and a complete journal is a transcript again.
import { appendFileSync, existsSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Config } from "./types.ts";

export type DecisionKind = "session" | "decision" | "blocked" | "retraction" | "conjecture" | "resolution" | "dismissal";

export interface DecisionRecord {
  id: string;              // "d-" + 8 hex of the CONTENT hash — a re-log dedupes
  session: string;         // "s-" + 12 hex — the agent session that wrote it
  at: string;              // ISO
  kind: DecisionKind;
  agent: string;           // WHO — the whole point when five run at once
  job: string;             // WHICH fan-out / task this belongs to
  branch: string | null;   // WHICH branch, so the merged timeline can say where
  commit: string | null;   // context is the clock
  dirty: boolean;          // ...and whether that context was even committed
  chose: string;           // decision: what was chosen · blocked: what could not be
                           // conjecture: THE SURPRISING OBSERVATION · resolution: which candidate won
  over: string[];          // alternatives REJECTED
  because: string;         // criterion + evidence · resolution: what the discriminating test SHOWED
                           // dismissal: why this is not worth chasing
  supersedes?: string;     // retraction -> the id it withdraws · resolution -> the conjecture it
                           // answers · dismissal -> the conjecture it retires unanswered
  files?: string[];
  // ── conjecture only ────────────────────────────────────────────────────────────
  // `couldBe` is deliberately NOT `over`. `over` means REJECTED, and a candidate
  // explanation is precisely what has not been rejected yet — filing candidates under
  // `over` would report every open question as settled in the "alternatives rejected"
  // tally, which inverts the one distinction this record exists to make.
  couldBe?: string[];      // candidate explanations; one of them always doubts the instrument
  discriminatedBy?: string; // the test that would separate the candidates — the actionable field
  // ── `observed` only: the tracked metric that raised this ───────────────────────
  // `metric` IS THE DEDUPE KEY, and it is the reason these fields exist as fields
  // rather than as prose inside `chose`. The id is a hash of the content and the
  // content includes the NUMBER, so a metric that sits outside its band for ten runs
  // mints ten different ids — ten open questions for one question. The label is what
  // stays still while the measurement moves, so the label is what identity must be
  // taken from. `value` is stored for the same reason: after a resolution it is the
  // only thing that can say whether a later reading is the SAME excursion (quiet) or
  // a further one (a new question). See `observed.ts`.
  metric?: string;
  value?: number;
  baseline?: number;
  threshold?: number;      // the caller's word — planetizer's `Claim.threshold`, kept
  unit?: string;
  // ── `raise` only: the ADVISORY-DERIVED dedupe key ──────────────────────────────
  // The same job `metric` does for `observed`, for a caller that has no label to give.
  // `observed` gets its key from the project, which spells the metric's name the same way
  // twice; an advisory has nobody to ask, so it must derive identity FROM THE FINDING —
  // and the derivation is the entire difficulty (see raise.ts). Stored as readable text
  // (`<advisory>:<subject>`) rather than a digest so a person debugging a duplicate can
  // grep the journal and SEE which half of the key moved.
  finding?: string;
}

// LABELS ARE CAPPED; EVIDENCE IS NOT. Measured on this repo's own journal at 53
// entries: `chose` p50 149 / p90 241, `over` p50 94 / p90 175 — both already read as
// labels, and the few that run long are the ones where an agent put its rationale in
// the title. But `because` p50 609, and ALL 53 exceed 250: capping it there would have
// stripped 16 of 23 file:line citations and 22 of 33 measured numbers, because the
// evidence lives at the END of a rationale, after the claim. That converts a checkable
// entry into an assertable one, which is the failure this journal exists to prevent.
// So the cap is a WARNING on the label fields only, and readability is solved where it
// belongs — at the render, with `--brief`.
export const LABEL_SOFT_MAX = 200;

// ── the candidate nobody writes down ────────────────────────────────────────────────
//
// It names the MOVE, not the mood. "the instrument is wrong" alone is unactionable; the
// clause after the dash is what turns it into a next step, because the mistake is always
// the same one — reading a number as a fact about the subject when it is a fact about
// the thing that produced it.
export const INSTRUMENT_CANDIDATE =
  "the instrument is wrong — the thing that PRODUCED this number, not the thing it describes";

// DELIBERATELY NARROW. Its only job is to answer "did the author already doubt their
// instrument?", and its failure mode is asymmetric ON PURPOSE: a false negative adds a
// redundant canonical candidate (noise, recoverable), while a false positive would let a
// conjecture ship WITHOUT the instrument on the list (silent, and the exact failure this
// record exists to prevent). So it only fires on words that name a measuring apparatus,
// and it does not try to be clever about phrasing.
const INSTRUMENT_WORDS = [
  "instrument", "measurement", "measured wrong", "harness", "decoder", "parser",
  "off-by-one", "off by one", "the tool", "the script", "the query", "the regex",
  "the counter", "the probe", "the metric", "miscount", "the test itself",
];

/** Does this candidate already doubt the apparatus rather than the world? */
export function readsAsInstrumentDoubt(candidate: string): boolean {
  const t = candidate.toLowerCase();
  return INSTRUMENT_WORDS.some((w) => t.includes(w));
}

/** THE GUARANTEE: every conjecture leaves here with instrument-doubt among its
 *  candidates. Six for six of the findings that motivated this record were instrument
 *  failures, so the prior is not merely high — and a candidate list that omits it has
 *  already made the mistake, at WRITE time, before any reader can catch it.
 *
 *  Nothing is reordered when the author supplied their own: their wording is more
 *  specific than the canonical line ("the decoder had an off-by-one" beats "the
 *  instrument is wrong"), and specificity is the whole value. */
export function withInstrumentCandidate(couldBe: string[]): string[] {
  return couldBe.some(readsAsInstrumentDoubt) ? couldBe : [INSTRUMENT_CANDIDATE, ...couldBe];
}

export function decisionsDir(cfg: Config): string {
  return join(cfg.root, ".coherence", "decisions");
}
export function sessionPath(cfg: Config, session: string): string {
  return join(decisionsDir(cfg), `${session}.jsonl`);
}

/** A fresh session id. Random rather than derived: two agents started in the same
 *  second on the same branch with the same name must not collide, and they can. */
export function newSessionId(): string {
  return "s-" + randomBytes(6).toString("hex");
}

function git(root: string, args: string[]): string | null {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

function context(root: string): { branch: string | null; commit: string | null; dirty: boolean } {
  return {
    branch: git(root, ["branch", "--show-current"]),
    commit: git(root, ["rev-parse", "--short", "HEAD"]),
    dirty: (git(root, ["status", "--porcelain"]) ?? "").length > 0,
  };
}

/** THE FIELD SEPARATOR IS A NUL, AND IT MUST STAY ONE. It arrived as a literal 0x00
 *  byte in the source — invisible in every editor and every diff — and it is written
 *  here as an explicit escape so the next reader can SEE it instead of "tidying" it
 *  into a space. Measured before touching it: all 20 entries in this repo's own journal
 *  reproduce their stored id under NUL, and 0 of 20 under a space. Swapping it would
 *  re-mint every id ever written and orphan every `supersedes` pointer on disk.
 *  (NUL is also right on its merits — it is the one byte that cannot occur in a field,
 *  so no `chose` can forge a collision by impersonating the boundary.) */
const ID_SEP = "\u0000";

/** The id hashes the CONTENT, not the time — so the same decision logged twice (a
 *  retried agent, a resumed workflow) collapses instead of inflating the count.
 *  Identity is WHAT was decided, not when it was written down.
 *
 *  THE CONJECTURE FIELDS ARE APPENDED ONLY WHEN PRESENT, and that conditional is
 *  load-bearing rather than tidy. Ids are POINTERS: every `supersedes` in every journal
 *  already on disk names one. Feeding two more (empty) fields into the digest for a
 *  plain decision would append two separators and move every id ever minted, silently
 *  orphaning every retraction in every committed `.coherence/decisions/`. A content
 *  hash may only widen for content that did not exist before.
 *
 *  THE `observed` METRIC FIELDS ARE NOT IN THE DIGEST AT ALL, and that is deliberate
 *  rather than an omission. They are a PROJECTION of the observation text: `observed.ts`
 *  renders label, value, baseline, threshold and unit into `chose` at the same moment it
 *  files them, so every one of them is already inside the hash by way of the sentence
 *  that quotes it. Widening the digest for a second copy would buy nothing and would put
 *  one more thing between the frozen id format and the next person who edits this file.
 *
 *  `finding` IS IN THE DIGEST, and it is the one exception — for the opposite reason. It
 *  is NOT a projection of the text: an advisory's key is derived to hold STILL while the
 *  wording moves (a redundancy pair's `chose` carries line numbers and a score; its key
 *  carries neither), so two genuinely different findings could in principle render the
 *  same sentence. Hashing the key makes that collision impossible by construction rather
 *  than by inspection. It appends LAST and only when set, so a record without one — which
 *  is every record ever written to disk before this field existed — hashes byte-for-byte
 *  what it always did. A content hash may only widen for content that did not exist. */
function decisionId(
  kind: DecisionKind, agent: string, chose: string, over: string[], because: string,
  couldBe: string[] = [], discriminatedBy = "", finding = "",
): string {
  const parts = [kind, agent, chose, over.join(" "), because];
  if (couldBe.length || discriminatedBy) parts.push(couldBe.join(" "), discriminatedBy);
  if (finding) parts.push(finding);
  return "d-" + createHash("sha256").update(parts.join(ID_SEP)).digest("hex").slice(0, 8);
}

export interface DecideInput {
  kind: DecisionKind;
  chose: string;
  because: string;
  over?: string[];
  agent?: string;
  job?: string;
  session?: string;
  files?: string[];
  supersedes?: string;
  couldBe?: string[];        // conjecture only — instrument-doubt is added if absent
  discriminatedBy?: string;  // conjecture only
  metric?: string;           // `observed` only — the dedupe key
  value?: number;
  baseline?: number;
  threshold?: number;
  unit?: string;
  finding?: string;          // `raise` only — the advisory-DERIVED dedupe key
  now?: string; // injectable for tests
}

/** Open a session: mint an id and write its header record. The header makes each file
 *  self-describing, so the merger never has to parse a filename to know who wrote it. */
export function openSession(cfg: Config, o: { agent?: string; job?: string; now?: string } = {}): DecisionRecord {
  const session = newSessionId();
  return write(cfg, session, {
    kind: "session", chose: "(session opened)", because: "agent session start",
    agent: o.agent, job: o.job, now: o.now,
  });
}

/** Append one record to a session's file, creating the session on first write so an
 *  agent that never saw the hook still produces an attributable file. */
export function appendDecision(cfg: Config, input: DecideInput): DecisionRecord {
  const session = input.session || process.env.COHERENCE_SESSION || newSessionId();
  return write(cfg, session, input);
}

function write(cfg: Config, session: string, input: DecideInput): DecisionRecord {
  const agent = input.agent || process.env.COHERENCE_AGENT || "main";
  const ctx = context(cfg.root);
  const job = input.job || process.env.COHERENCE_JOB || ctx.branch || "-";
  const over = input.over ?? [];
  // THE GUARANTEE IS APPLIED AT THE WRITE, not at the CLI and not at the render. Every
  // path into the journal — cli.ts, a hook, a test, some future tool — gets it, and the
  // instrument candidate is inside the content hash, so the same conjecture logged twice
  // still dedupes to one id.
  const conjecture = input.kind === "conjecture";
  const couldBe = conjecture ? withInstrumentCandidate(input.couldBe ?? []) : (input.couldBe ?? []);
  const discriminatedBy = input.discriminatedBy ?? "";
  const rec: DecisionRecord = {
    id: decisionId(input.kind, agent, input.chose, over, input.because, couldBe, discriminatedBy, input.finding),
    session,
    at: input.now ?? new Date().toISOString(),
    kind: input.kind,
    agent, job, branch: ctx.branch, commit: ctx.commit, dirty: ctx.dirty,
    chose: input.chose, over, because: input.because,
    ...(input.supersedes ? { supersedes: input.supersedes } : {}),
    ...(input.files && input.files.length ? { files: input.files } : {}),
    ...(couldBe.length ? { couldBe } : {}),
    ...(discriminatedBy ? { discriminatedBy } : {}),
    // Written only when a metric raised this record, so a hand-typed conjecture is
    // byte-identical to what it has always been on disk.
    ...(input.metric
      ? {
        metric: input.metric, value: input.value, baseline: input.baseline,
        threshold: input.threshold, ...(input.unit ? { unit: input.unit } : {}),
      }
      : {}),
    ...(input.finding ? { finding: input.finding } : {}),
  };
  mkdirSync(decisionsDir(cfg), { recursive: true });
  appendFileSync(sessionPath(cfg, session), JSON.stringify(rec) + "\n");
  // Warn, never reject. A journal that can refuse a write is one an agent stops using
  // mid-job, and the entry it drops is the one it was too busy to reword.
  // `could-be` is a LABEL like `over` and warns with them; `discriminated-by` is prose
  // like `because` and never does.
  for (const [field, text] of [["chose", rec.chose] as const, ...rec.over.map((o) => ["over", o] as const),
    ...(rec.couldBe ?? []).map((c) => ["could-be", c] as const)]) {
    if (text.length > LABEL_SOFT_MAX) {
      console.error(`note: \`${field}\` is ${text.length} chars. That reads as rationale, not a label —`
        + " the evidence belongs in `--because`, which is uncapped. Written as given.");
    }
  }
  return rec;
}

export interface Session { id: string; agent: string; job: string; branch: string | null; started: string; count: number }

/** THE COHERING READ. Every session file in the folder, merged into ONE timeline
 *  ordered by time — across agents, across jobs, across branches. This is the
 *  abstraction the whole split-file layout exists to make possible: writers are
 *  isolated so they never collide, and the reader sees a single history anyway.
 *
 *  A malformed line is SKIPPED and COUNTED, never thrown on: a journal that refuses
 *  to render because one agent wrote garbage has failed at the one job it has. */
export function readJournal(cfg: Config): { records: DecisionRecord[]; sessions: Session[]; unreadable: number } {
  const dir = decisionsDir(cfg);
  if (!existsSync(dir)) return { records: [], sessions: [], unreadable: 0 };
  const records: DecisionRecord[] = [];
  let unreadable = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as DecisionRecord;
        if (typeof o.id === "string" && typeof o.chose === "string" && typeof o.at === "string") records.push(o);
        else unreadable++;
      } catch { unreadable++; }
    }
  }
  records.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

  // A SESSION IS NAMED BY ITS WORK, NOT BY ITS HEADER. The header is written by the
  // hook at agent start, BEFORE the agent knows what it is called — so it defaults to
  // "main" and the branch. Taking identity from the first record therefore filed every
  // agent's session under "main", which is exactly the attribution the split-file
  // layout exists to guarantee. A real record's own claim always wins over the header's
  // placeholder.
  const byS = new Map<string, Session>();
  for (const r of records) {
    let s = byS.get(r.session);
    if (!s) { s = { id: r.session, agent: r.agent, job: r.job, branch: r.branch, started: r.at, count: 0 }; byS.set(r.session, s); }
    if (r.kind !== "session") {
      s.count++;
      s.agent = r.agent; s.job = r.job; s.branch = r.branch;
    }
    if (r.at < s.started) s.started = r.at;
  }
  return { records, sessions: [...byS.values()].sort((a, b) => a.started.localeCompare(b.started)), unreadable };
}

/** Retractions resolve ACROSS session files — one agent may withdraw another's
 *  decision, which in a fan-out is the single most valuable thing that can happen.
 *  Resolutions cross files the same way, and for the same reason: the agent that
 *  notices the surprising number is very often not the one with the instrument to
 *  settle it. Dismissals too — and a dismissal by a SECOND agent is the ordinary case,
 *  because the advisory that raised the question is not a person at all.
 *
 *  OPEN AND RESOLVED ARE SEPARATE BUCKETS, not a flag on one list, because the render
 *  has to be able to lead with the open ones. A conjecture never lands in `standing`:
 *  it is not a choice, and counting it as one would report an unanswered question as a
 *  settled position — the precise confusion this record exists to end.
 *
 *  THE PRECEDENCE IS retraction > resolution > dismissal, and each step is a claim about
 *  how much a reader learns:
 *    · a RETRACTION says the observation was never real — there is nothing to answer, so
 *      it outranks an answer.
 *    · a RESOLUTION beats a DISMISSAL because an answer is strictly more informative than
 *      a decision not to ask. Filing an answered question under "we chose not to chase
 *      this" would HIDE the answer, which is the more expensive of the two mistakes. */
export function resolve(records: DecisionRecord[]): {
  standing: DecisionRecord[];
  retracted: { rec: DecisionRecord; by: DecisionRecord }[];
  blocked: DecisionRecord[];
  open: DecisionRecord[];
  resolved: { rec: DecisionRecord; by: DecisionRecord }[];
  dismissed: { rec: DecisionRecord; by: DecisionRecord }[];
} {
  const byId = new Map<string, DecisionRecord>();
  for (const r of records) if (r.kind !== "session") byId.set(r.id, r); // dedupe: identity is content
  const all = [...byId.values()];
  const withdrawn = new Map<string, DecisionRecord>();
  const answered = new Map<string, DecisionRecord>();
  const retired = new Map<string, DecisionRecord>();
  for (const r of all) {
    if (r.kind === "retraction" && r.supersedes) withdrawn.set(r.supersedes, r);
    if (r.kind === "resolution" && r.supersedes) answered.set(r.supersedes, r);
    if (r.kind === "dismissal" && r.supersedes) retired.set(r.supersedes, r);
  }

  const standing: DecisionRecord[] = [];
  const retracted: { rec: DecisionRecord; by: DecisionRecord }[] = [];
  const blocked: DecisionRecord[] = [];
  const open: DecisionRecord[] = [];
  const resolved: { rec: DecisionRecord; by: DecisionRecord }[] = [];
  const dismissed: { rec: DecisionRecord; by: DecisionRecord }[] = [];
  for (const r of all) {
    if (r.kind === "retraction" || r.kind === "resolution" || r.kind === "dismissal") continue;
    const by = withdrawn.get(r.id);
    if (by) { retracted.push({ rec: r, by }); continue; }
    if (r.kind === "conjecture") {
      const ans = answered.get(r.id);
      if (ans) { resolved.push({ rec: r, by: ans }); continue; }
      const no = retired.get(r.id);
      if (no) dismissed.push({ rec: r, by: no }); else open.push(r);
      continue;
    }
    if (r.kind === "blocked") blocked.push(r);
    else standing.push(r);
  }
  const t = (a: DecisionRecord, b: DecisionRecord) => a.at.localeCompare(b.at);
  standing.sort(t); blocked.sort(t); open.sort(t);
  retracted.sort((a, b) => t(a.rec, b.rec)); resolved.sort((a, b) => t(a.rec, b.rec));
  dismissed.sort((a, b) => t(a.rec, b.rec));
  return { standing, retracted, blocked, open, resolved, dismissed };
}

/** WHAT MAY BE RESOLVED OR DISMISSED, and the exact refusal when it may not.
 *
 *  Two DIFFERENT failures live here and they need different messages: an id nobody ever
 *  wrote, versus an id that names the wrong KIND of thing. Accepting the second would
 *  append a resolution pointing at a decision, which no render ever reads — a command
 *  that exits 0 and does nothing, which is the defect this harness exists to hunt.
 *
 *  It sits in the journal rather than in the CLI so the rule is testable without
 *  spawning a process, and so a second caller cannot reimplement it differently.
 *
 *  DISMISSAL SHARES THE RULE RATHER THAN COPYING IT, and that is the point of the `verb`
 *  parameter. `dismiss` has to be as cheap to reach for as `resolved` — if it is even
 *  slightly harder, a noisy question stays open and the whole `--open` list gets skipped
 *  — and "as cheap" includes failing the same way, with the same words, on the same
 *  mistakes. Two hand-written copies of this rule would have drifted by the second edit. */
export function resolvableConjecture(
  records: DecisionRecord[], id: string, verb: "resolve" | "dismiss" = "resolve",
): { rec: DecisionRecord } | { error: string[] } {
  const rec = records.find((r) => r.id === id);
  if (!rec) {
    return { error: [`no entry ${id} in the journal — run \`coherence decisions --open\` to see the open conjectures`] };
  }
  if (rec.kind !== "conjecture") {
    return { error: [
      `${id} is a ${rec.kind}, not a conjecture — only a conjecture ${verb === "dismiss" ? "is dismissed" : "resolves"}.`,
      rec.kind === "decision"
        ? `To withdraw a decision, append a retraction: coherence retract ${id} --because "..."`
        : "Run `coherence decisions --open` to see what is actually open.",
    ] };
  }
  return { rec };
}

export interface RenderOpts {
  job?: string | null; agent?: string | null; session?: string | null; branch?: string | null;
  markdown?: boolean; sessions?: boolean; brief?: boolean; open?: boolean;
}

/** `--brief`'s budget for `because`. Truncation is ALWAYS announced with the withheld
 *  count — a shortened rationale that looks complete is worse than no rationale. */
export const BRIEF_BECAUSE = 180;

/** The render IS the artifact, and its value is a COMPRESSION RATIO: a reader given
 *  this should be better equipped than one given the transcripts. So it leads with
 *  what is standing, states what was rejected inline, and gives retractions their own
 *  section — a retraction rendered as an absence is invisible, and it is the most
 *  valuable entry in the journal.
 *
 *  OPEN CONJECTURES GO ABOVE EVERYTHING, INCLUDING `Standing`. That ordering is the
 *  feature, not decoration. A standing decision is settled and will still be there
 *  tomorrow; an open conjecture is a thing this project NOTICED AND DID NOT CHASE, and
 *  it decays — the agent that saw the surprising number is gone, and nobody else knows
 *  to look. Filed underneath the settled work it reads as an appendix, which is
 *  indistinguishable from never having recorded it. */
export function renderJournal(cfg: Config, opts: RenderOpts = {}): { text: string; count: number } {
  const { records, sessions, unreadable } = readJournal(cfg);
  const scoped = records.filter((r) =>
    (!opts.job || r.job === opts.job) &&
    (!opts.agent || r.agent === opts.agent) &&
    (!opts.session || r.session === opts.session) &&
    (!opts.branch || r.branch === opts.branch));
  const { standing, retracted, blocked, open, resolved, dismissed } = resolve(scoped);
  const md = !!opts.markdown;
  const L: string[] = [];
  const bullet = md ? "- " : "  · ";

  const scope = [opts.job && `job ${opts.job}`, opts.agent && `agent ${opts.agent}`,
    opts.session && `session ${opts.session}`, opts.branch && `branch ${opts.branch}`]
    .filter(Boolean).join(" · ") || "every session";
  L.push(`${md ? "# " : ""}Decisions — ${scope}`, "");

  const seen = new Set(scoped.map((r) => r.session));
  const rejected = standing.reduce((n, r) => n + r.over.length, 0);
  // Shouted only when nonzero. A permanent all-caps field is furniture, and furniture is
  // what the eye learns to skip — which would cost exactly the entries that matter.
  const openCount = open.length ? `${open.length} OPEN CONJECTURE(S)` : "0 open conjectures";
  // Dismissals appear in the summary ONLY when there are some. Unlike `resolved` and
  // `retracted` — which every project accumulates — a permanent `0 dismissed` on a repo
  // that has never dismissed anything is a field advertising a verb the reader does not
  // need yet, and one more column for the eye to learn to skip.
  const dismissedCount = dismissed.length ? ` · ${dismissed.length} dismissed` : "";
  L.push(`${standing.length} standing · ${openCount} · ${resolved.length} resolved${dismissedCount}`
    + ` · ${retracted.length} retracted · ${blocked.length} blocked`
    + ` · ${rejected} alternative(s) rejected · ${seen.size} session(s)`
    + ` · ${new Set(scoped.map((r) => r.branch).filter(Boolean)).size} branch(es)`);
  if (unreadable) L.push(`WARNING: ${unreadable} unreadable line(s) — skipped, not repaired.`);
  L.push("");

  if (opts.sessions) {
    L.push(`${md ? "## " : ""}Sessions`, "");
    for (const s of sessions.filter((s) => seen.has(s.id))) {
      L.push(`${bullet}${s.id}  ${s.agent}  job ${s.job}  ${s.branch ?? "-"}  ${s.started.slice(0, 16).replace("T", " ")}  ${s.count} entr${s.count === 1 ? "y" : "ies"}`);
    }
    L.push("");
  }
  if (open.length || opts.open) {
    L.push(`${md ? "## " : ""}Open questions — NOTICED, NOT YET CHASED`, "");
    for (const r of open) L.push(...entry(r, bullet, md, opts.brief));
    // `--open` with nothing open must SAY so. Silence there is ambiguous between "all
    // chased" and "the filter is broken", and this repo has shipped that ambiguity before.
    if (!open.length) L.push("(none open — every conjecture in scope is resolved, or none was raised)", "");
  }
  // `--open` is a lens, not a report: it answers one question and shows nothing else.
  if (!opts.open) {
    if (standing.length) { L.push(`${md ? "## " : ""}Standing`, ""); for (const r of standing) L.push(...entry(r, bullet, md, opts.brief)); }
    if (resolved.length) {
      L.push(`${md ? "## " : ""}Resolved`, "");
      for (const { rec, by } of resolved) {
        L.push(...entry(rec, bullet, md, opts.brief));
        const sub = md ? "  - " : `${bullet}  `;
        L.push(`${sub}RESOLVED by ${by.agent} (${by.session}): ${opts.brief ? clip(by.because, BRIEF_BECAUSE) : by.because}`);
        // The placeholder `chose` exists only so the record has a title; echoing it as a
        // winning candidate would invent a finding nobody claimed.
        if (!by.chose.startsWith("(resolved:")) L.push(`${sub}won: ${by.chose}`);
        L.push("");
      }
    }
    // NOT ANSWERED — RETIRED. The heading has to carry that on its own, because a reader
    // scanning section titles never reaches the body, and "Dismissed" sitting under
    // "Resolved" reads as a second flavour of settled. It is the opposite: every entry
    // here is a question whose answer nobody knows and nobody intends to find out.
    if (dismissed.length) {
      L.push(`${md ? "## " : ""}Dismissed — NOT WORTH CHASING (no answer was found; none was sought)`, "");
      for (const { rec, by } of dismissed) {
        L.push(...entry(rec, bullet, md, opts.brief));
        L.push(`${md ? "  - " : `${bullet}  `}DISMISSED by ${by.agent} (${by.session}): ${opts.brief ? clip(by.because, BRIEF_BECAUSE) : by.because}`, "");
      }
    }
    if (retracted.length) {
      L.push(`${md ? "## " : ""}Retracted`, "");
      for (const { rec, by } of retracted) {
        L.push(...entry(rec, bullet, md, opts.brief));
        L.push(`${md ? "  - " : `${bullet}  `}RETRACTED by ${by.agent} (${by.session}): ${by.because}`, "");
      }
    }
    if (blocked.length) { L.push(`${md ? "## " : ""}Could not`, ""); for (const r of blocked) L.push(...entry(r, bullet, md, opts.brief)); }
  }
  if (!scoped.length) L.push("(nothing logged)");
  return {
    text: L.join("\n"),
    count: standing.length + retracted.length + blocked.length + open.length + resolved.length + dismissed.length,
  };
}

/** Truncate on a WORD boundary and say how much was withheld. Never silently. */
function clip(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.slice(0, budget);
  const at = cut.lastIndexOf(" ");
  const head = (at > budget * 0.6 ? cut.slice(0, at) : cut).trimEnd();
  return `${head}… (+${text.length - head.length} chars — drop --brief for the evidence)`;
}

function entry(r: DecisionRecord, bullet: string, md: boolean, brief?: boolean): string[] {
  const b = md ? "**" : "";
  const where = `${r.agent} · ${r.branch ?? "-"} · ${r.commit ?? "no-commit"}${r.dirty ? "+dirty" : ""}`;
  const out = [`${bullet}${b}${r.chose}${b}   [${r.id} · ${where}]`];
  // In markdown the detail lines must NEST under the decision, not sit beside it as
  // siblings — an `over:` rendered at the same level as the thing it qualifies reads
  // as a separate decision, which is the one misreading this format cannot afford.
  const sub = md ? "  - " : `${bullet}  `;
  if (r.kind === "conjecture") {
    // THE INSTRUMENT CANDIDATE IS TAGGED, not merely present. An unmarked line in a list
    // is a line the eye averages over, and the whole reason this candidate is guaranteed
    // is that it is the one people skip. The tag is what makes the guarantee legible.
    out.push(`${sub}could be: ${(r.couldBe ?? [])
      .map((c) => (readsAsInstrumentDoubt(c) ? `[instrument] ${c}` : c)).join(" · ")}`);
    // Prose clips under --brief, labels never do — the same rule `because`/`over` follow.
    // This one is the ACTIONABLE field, so when it is clipped the withheld count matters
    // more than anywhere else, and `clip` always announces it.
    out.push(`${sub}discriminated by: ${brief ? clip(r.discriminatedBy ?? "", BRIEF_BECAUSE) : r.discriminatedBy ?? ""}`);
    // A conjecture's `because` is optional — the observation usually IS the surprise —
    // so it prints only when the author had something more to say. No `over:` line at
    // all: a conjecture has rejected nothing yet, and that is its defining property.
    if (r.because) out.push(`${sub}because: ${brief ? clip(r.because, BRIEF_BECAUSE) : r.because}`);
  } else {
    // `over` prints even when empty, and SAYS it is empty. A decision with no
    // alternative was either forced or unexamined; those are different, and the reader
    // should see which one the author is claiming.
    out.push(r.over.length
      ? `${sub}over: ${r.over.join(" · ")}`
      : `${sub}over: (nothing — forced, or no alternative considered)`);
    out.push(`${sub}because: ${brief ? clip(r.because, BRIEF_BECAUSE) : r.because}`);
  }
  if (r.files?.length) out.push(`${sub}files: ${r.files.join(", ")}`);
  out.push("");
  return out;
}
