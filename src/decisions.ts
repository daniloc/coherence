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
// ...AND WHY THAT NEARLY DROWNED A PULL REQUEST. One consuming project accumulated ~20
// new `.jsonl` files in a single day, and twenty new files is not a diff anybody reads —
// which converts the record into noise at exactly the moment it is supposed to be read.
// The cause was ONE LINE: the fallback when no `--session` and no hook supplied an id was
// `newSessionId()`, a RANDOM id, so every hookless `coherence decide` minted a fresh file.
// Randomness is right for a HOOK-minted session — those genuinely are concurrent — and
// wrong as a fallback, where the caller is a human or a lone agent typing the command.
// So the fallback is DERIVED (`derivedSessionId`): same branch, same agent, same UTC day
// appends to one file. The BRANCH STAYS IN THE FILENAME, because reason 1 above is the
// whole reason this layout exists and a tidier PR is not worth trading a merge conflict
// for. What is left after that is `compactJournal` — folding files that git already holds,
// which is tidying the working tree rather than editing the record.
//
// IT GATES NOTHING, DELIBERATELY. The moment this can fail a build it acquires an
// incentive to be complete, and a complete journal is a transcript again.
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, readFileSync, readdirSync,
  mkdirSync, openSync, statSync, unlinkSync, writeFileSync, writeSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { basename, join } from "node:path";
import type { Config } from "./types.ts";

export type DecisionKind = "session" | "decision" | "blocked" | "retraction" | "conjecture" | "resolution" | "dismissal";

/** Machine-addressable scope for a decision. These are SETS, not a second prose field:
 * writers sort and deduplicate them before they enter the wire record and its identity. */
export interface DecisionScope {
  components?: string[];
  files?: string[];
  symbols?: string[];
  environment?: string[];
}

/** Whose authority the row claims. Identity is intentionally a small closed vocabulary;
 * an actor/session belongs in `agent`, while this field answers whether that actor was
 * proposing, ratifying for the swarm, or carrying an explicit user direction. */
export type DecisionAuthority = "local-proposal" | "orchestrator-accepted" | "user-directed";

export interface StructuredDecisionFields {
  work?: string;
  subject?: string;
  scope?: DecisionScope;
  authority?: DecisionAuthority;
}

export interface DecisionRecord extends StructuredDecisionFields {
  /** Absent is the released legacy wire format. V2 is emitted only when one of the
   * structured fields above is present, so an ordinary historical row stays byte- and
   * id-compatible. */
  version?: 2;
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
export const INSTRUMENT_MARKER = "[instrument]";

// The lexical reader exists for OLD records and rendering only. It must never discharge
// the write-time guarantee: mentioning another apparatus is not the same as doubting the
// one that produced the surprising reading. d-77dc0ad1 demonstrated the false-positive
// shape exactly — "the advisory is fine ... the probe should have been writing" used the
// word `probe`, so the canonical candidate silently disappeared. New authored wording is
// explicit via `[instrument]`; otherwise the exact canonical candidate is added.
const INSTRUMENT_WORDS = [
  "instrument", "measurement", "measured wrong", "harness", "decoder", "parser",
  "off-by-one", "off by one", "the tool", "the script", "the query", "the regex",
  "the counter", "the probe", "the metric", "miscount", "the test itself",
];
const INSTRUMENT_AFFIRMATION =
  /\b(?:advisory|instrument|measurement|harness|decoder|parser|tool|script|query|regex|counter|probe|metric|test)\s+(?:is|was|are|were)\s+(?:fine|correct|right|sound|working)\b/;

function isExplicitInstrumentCandidate(candidate: string): boolean {
  const t = candidate.trim();
  return t === INSTRUMENT_CANDIDATE || t.startsWith(`${INSTRUMENT_MARKER} `);
}

/** Does this candidate already doubt the apparatus rather than the world? */
export function readsAsInstrumentDoubt(candidate: string): boolean {
  if (isExplicitInstrumentCandidate(candidate)) return true;
  const t = candidate.toLowerCase();
  if (INSTRUMENT_AFFIRMATION.test(t)) return false;
  return INSTRUMENT_WORDS.some((w) => t.includes(w));
}

/** THE GUARANTEE: every conjecture leaves here with instrument-doubt among its
 *  candidates. Six for six of the findings that motivated this record were instrument
 *  failures, so the prior is not merely high — and a candidate list that omits it has
 *  already made the mistake, at WRITE time, before any reader can catch it.
 *
 *  Nothing is reordered when the author explicitly marks their own wording: their
 *  specific candidate (`[instrument] the decoder had an off-by-one`) beats the generic
 *  canonical line. Lexical inference is deliberately insufficient here: redundancy is
 *  recoverable, while a false positive silently removes the candidate. */
export function withInstrumentCandidate(couldBe: string[]): string[] {
  return couldBe.some(isExplicitInstrumentCandidate) ? couldBe : [INSTRUMENT_CANDIDATE, ...couldBe];
}

export function decisionsDir(cfg: Config): string {
  return join(cfg.root, ".coherence", "decisions");
}

/** ONE FILENAME COMPONENT, filesystem-safe, AND STILL INJECTIVE — that last part is the
 *  requirement that rules out a plain `replace`. A branch may contain `/`, and if
 *  `feat/x` and `feat-x` both flatten to `feat-x` they share a journal file, which is
 *  exactly the two-branches-conflict failure the split layout exists to prevent. So
 *  whenever sanitising CHANGED anything — a substitution, a trim, the length cap — a
 *  digest of the RAW string is appended, and two distinct inputs can no longer land on
 *  one name. A string that was already safe is passed through untouched, so every session
 *  id ever written (`s-` + 12 hex) still maps to the file it has always mapped to.
 *
 *  It is applied at `sessionPath`, which also closes a hole that predates it: `--session`
 *  is caller-supplied and went straight into a path, so `--session ../../etc/x` wrote
 *  outside the journal. */
export function slug(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").replace(/[-.]+$/, "").replace(/-{2,}/g, "-");
  const safe = (clean || "x").slice(0, 48);
  return safe === raw ? safe : `${safe}-${createHash("sha256").update(raw).digest("hex").slice(0, 6)}`;
}

function hashedDecisionSessionFilename(session: string): string {
  const key = createHash("sha256")
    .update("coherence:decision-session\0")
    .update(session, "utf8")
    .digest("hex");
  return `s-${key}.jsonl`;
}

export function sessionPath(cfg: Config, session: string): string {
  const dir = decisionsDir(cfg);
  const legacyName = `${slug(session)}.jsonl`;
  const legacy = join(dir, legacyName);
  const hashed = join(dir, hashedDecisionSessionFilename(session));
  // Reuse a historical direct-session file only when its surviving rows prove exact
  // ownership. On a case-folding filesystem Owner.jsonl may also answer a lookup for
  // owner.jsonl; existence alone would append the second session into the first.
  try {
    const standing = lstatSync(legacy);
    if (standing.isFile() && !standing.isSymbolicLink()) {
      const rows = readFileSync(legacy, "utf8").split("\n").filter((line) => line.trim());
      if (rows.length && rows.every((line) => {
        try {
          const raw = JSON.parse(line) as { session?: unknown };
          return raw.session === session;
        } catch { return false; }
      })) return legacy;
    }
  } catch { /* an absent or damaged readable address is resolved against portable aliases below */ }
  // Once a collision has selected the hashed grade, every later append for that session
  // returns to it. Hash ownership is checked by the strict reader; this resolver only
  // chooses the stable address before the append boundary verifies file identity.
  try {
    const standing = lstatSync(hashed);
    if (standing.isFile() && !standing.isSymbolicLink()) return hashed;
  } catch { /* first append at the hashed grade */ }
  // Preserve the released readable filenames for the overwhelmingly common case. Only
  // a portable case/normalization alias selects the hash, so Owner and owner cannot
  // share bytes on APFS while existing `session.jsonl` addresses do not churn.
  try {
    const portable = legacyName.normalize("NFD").toLowerCase();
    if (readdirSync(dir).some((name) => name.normalize("NFD").toLowerCase() === portable)) return hashed;
  } catch { /* an absent directory means this is the first direct file */ }
  return legacy;
}

function ensureDecisionDirectory(cfg: Config): void {
  for (const [path, label] of [
    [join(cfg.root, ".coherence"), ".coherence"],
    [decisionsDir(cfg), ".coherence/decisions"],
  ] as const) {
    if (!existsSync(path)) mkdirSync(path);
    const standing = lstatSync(path);
    if (standing.isSymbolicLink() || !standing.isDirectory()) {
      throw new Error(`${label} must be a real repository directory, never a symlink`);
    }
  }
}

function appendDecisionRow(cfg: Config, session: string, record: DecisionRecord): void {
  ensureDecisionDirectory(cfg);
  const path = sessionPath(cfg, session);
  const target = basename(path);
  if (existsSync(path)) {
    const standing = lstatSync(path);
    if (standing.isSymbolicLink() || !standing.isFile()) {
      throw new Error(`${target} is not a contained regular decision append target`);
    }
  }
  const flags = constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
  let fd: number;
  try { fd = openSync(path, flags, 0o666); }
  catch (error) {
    throw new Error(`${target} cannot be opened as a contained decision append target${(error as NodeJS.ErrnoException).code ? ` (${(error as NodeJS.ErrnoException).code})` : ""}`);
  }
  try {
    const opened = fstatSync(fd);
    const standing = lstatSync(path);
    if (!opened.isFile() || !standing.isFile() || standing.isSymbolicLink()
      || opened.dev !== standing.dev || opened.ino !== standing.ino) {
      throw new Error(`${target} changed identity while opening; refusing the decision append`);
    }
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
    for (let offset = 0; offset < bytes.length;) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error(`${target} decision append made no progress`);
      offset += written;
    }
  } finally { closeSync(fd); }
}

/** A fresh fallback session id. Random rather than derived: two agents started in the same
 *  second on the same branch with the same name must not collide, and they can.
 *
 *  A host-supplied unique id is preferred by the hook. Randomness is its fallback, never
 *  the fallback for a hookless `coherence decide` — see `derivedSessionId`. */
export function newSessionId(): string {
  return "s-" + randomBytes(6).toString("hex");
}

/** THE HOOKLESS FALLBACK: `<branch>-<agent>-<YYYY-MM-DD>`, derived rather than random, so
 *  a human typing `decide` five times gets ONE file instead of five.
 *
 *  THE BRANCH IS IN THE NAME AND MUST STAY THERE. Distinct filenames are the entire reason
 *  two parallel branches never conflict on the journal; an id that dropped the branch would
 *  buy a tidier PR by reintroducing the conflict this layout was built to avoid.
 *
 *  THE DATE COMES FROM THE RECORD'S OWN `at`, so the filename and the timestamps inside it
 *  are on ONE clock (UTC). The cost is that an evening's work can straddle UTC midnight
 *  into two files; month-grouped compaction absorbs that completely, and a local-clock
 *  filename would put two timezones in one layout for the same money.
 *
 *  THE RESIDUAL COLLISION IS TWO AGENTS THAT BOTH DEFAULTED TO agent "main" ON ONE BRANCH,
 *  and it is safe on four independent grounds:
 *    1. Same branch means same checkout. Git refuses to check one branch out in two
 *       worktrees, so genuinely concurrent agents have DIFFERENT branches by construction —
 *       and therefore different files.
 *    2. Even interleaved, the write survives: `appendFileSync` is measured here at 8
 *       concurrent writers x 300 lines, 2400/2400 intact, 0 torn, 0 missing (and the same
 *       probe loses 1242 of 2400 with a seek-then-write writer, so it can see loss).
 *    3. What is actually lost is attribution BETWEEN two agents that already declined to
 *       pass `--agent` — they were indistinguishable before the filename was.
 *    4. The supported concurrency path is the hook, and the hook still mints random ids. */
export function derivedSessionId(branch: string | null, agent: string, at: string): string {
  return `${slug(branch ?? "nobranch")}-${slug(agent)}-${at.slice(0, 10)}`;
}

function git(root: string, args: string[]): string | null {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/** Like `git` but it DISTINGUISHES "said nothing" from "failed" — `null` is a failure,
 *  `[]` is a clean answer. `git` above collapses the two, which is harmless for reading a
 *  branch name and fatal for `git diff --name-only`, where empty output is the whole
 *  point: treating a failed diff as "clean" would fold a file nothing had verified. */
function gitLines(root: string, args: string[]): string[] | null {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return null;
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
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
 *  `supersedes` joins the digest only when present. It is CONTENT for every terminal row:
 *  two identical answers to two different questions are two different resolutions. The
 *  first implementation omitted it, so four writes with shared prose minted one id and
 *  `resolve` collapsed three. Conditional append preserves every historical non-terminal
 *  id while making new terminal identities target-specific.
 *
 *  `finding` IS IN THE DIGEST, and it is the other exception — for the opposite reason. It
 *  is NOT a projection of the text: an advisory's key is derived to hold STILL while the
 *  wording moves (a redundancy pair's `chose` carries line numbers and a score; its key
 *  carries neither), so two genuinely different findings could in principle render the
 *  same sentence. Hashing the key makes that collision impossible by construction rather
 *  than by inspection. It appends LAST and only when set, so a record without one — which
 *  is every record ever written to disk before this field existed — hashes byte-for-byte
 *  what it always did. A content hash may only widen for content that did not exist. */
function decisionId(
  kind: DecisionKind, agent: string, chose: string, over: string[], because: string,
  couldBe: string[] = [], discriminatedBy = "", supersedes = "", finding = "",
  structured?: StructuredDecisionFields,
): string {
  const parts = [kind, agent, chose, over.join(" "), because];
  if (couldBe.length || discriminatedBy) parts.push(couldBe.join(" "), discriminatedBy);
  if (supersedes) parts.push(supersedes);
  if (finding) parts.push(finding);
  if (structured && hasStructuredDecisionFields(structured)) {
    // A version marker plus one fixed-order tuple makes the widening reviewable and
    // unambiguous. It is conditional: the empty structured shape appends NO separators,
    // preserving every V1 pointer already stored in a supersedes field.
    parts.push("v2", JSON.stringify([
      structured.work ?? null,
      structured.subject ?? null,
      structured.scope
        ? [
          structured.scope.components ?? [], structured.scope.files ?? [],
          structured.scope.symbols ?? [], structured.scope.environment ?? [],
        ]
        : null,
      structured.authority ?? null,
      // Two retired relationship slots stay in the V2 identity tuple as empty arrays.
      // No released row used them, but every structured row's existing content address
      // included the placeholders. Consequence records are now the single link home.
      [],
      [],
    ]));
  }
  return "d-" + createHash("sha256").update(parts.join(ID_SEP)).digest("hex").slice(0, 8);
}

const hasStructuredDecisionFields = (s: StructuredDecisionFields): boolean =>
  s.work !== undefined || s.subject !== undefined || s.scope !== undefined
  || s.authority !== undefined;

const canonicalSet = (xs: string[] | undefined): string[] | undefined =>
  xs === undefined ? undefined : [...new Set(xs)].sort((a, b) => a.localeCompare(b));

function canonicalStructuredDecisionFields(s: StructuredDecisionFields): StructuredDecisionFields {
  const scope = s.scope
    ? {
      ...(s.scope.components !== undefined ? { components: canonicalSet(s.scope.components) } : {}),
      ...(s.scope.files !== undefined ? { files: canonicalSet(s.scope.files) } : {}),
      ...(s.scope.symbols !== undefined ? { symbols: canonicalSet(s.scope.symbols) } : {}),
      ...(s.scope.environment !== undefined ? { environment: canonicalSet(s.scope.environment) } : {}),
    }
    : undefined;
  return {
    ...(s.work !== undefined ? { work: s.work } : {}),
    ...(s.subject !== undefined ? { subject: s.subject } : {}),
    ...(scope !== undefined ? { scope } : {}),
    ...(s.authority !== undefined ? { authority: s.authority } : {}),
  };
}

/** Recompute the released content address. Callers should normally use
 * `readTrustedJournal`; this export exists for ledger migrations and focused audits. */
export function recomputeDecisionId(record: DecisionRecord): string {
  return decisionId(
    record.kind, record.agent, record.chose, record.over, record.because,
    record.couldBe ?? [], record.discriminatedBy ?? "", record.supersedes ?? "",
    record.finding ?? "", record,
  );
}

/** Before 7d501e8, terminal identity omitted its target. Those rows remain valid wire
 * history, even though the grade was later retired after four same-prose resolutions
 * collapsed to one id. The trusted reader recognizes that frozen grade but its duplicate
 * conflict check still refuses the exact many-target collision that retired it. */
function recomputeTargetOmittingDecisionId(record: DecisionRecord): string {
  return decisionId(
    record.kind, record.agent, record.chose, record.over, record.because,
    record.couldBe ?? [], record.discriminatedBy ?? "", "", record.finding ?? "",
  );
}

export interface DecideInput extends StructuredDecisionFields {
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

/** Open a session and write its header record. A lifecycle host may supply its stable,
 *  unique agent/session id so later tool hooks, calibration labels and journal writes all
 *  address the same file. Hookless callers still mint a collision-safe random id. */
export function openSession(
  cfg: Config,
  o: { agent?: string; job?: string; session?: string; now?: string } = {},
): DecisionRecord {
  const session = o.session || newSessionId();
  return write(cfg, session, {
    kind: "session", chose: "(session opened)", because: "agent session start",
    agent: o.agent, job: o.job, now: o.now,
  });
}

/** Append one record to a session's file, creating the session on first write so an
 *  agent that never saw the hook still produces an attributable file.
 *
 *  WITH NO ID FROM ANYWHERE THE ID IS DERIVED, NOT RANDOMISED — the one-line cause of
 *  twenty unreviewable files in a day. `null` is passed down rather than resolved here
 *  because the derivation needs the branch and the agent, and `write` is where those are
 *  worked out; computing them twice is how the two spellings drift. */
export function appendDecision(cfg: Config, input: DecideInput): DecisionRecord {
  return write(cfg, input.session || process.env.COHERENCE_SESSION || null, input);
}

function write(cfg: Config, given: string | null, input: DecideInput): DecisionRecord {
  const agent = input.agent || process.env.COHERENCE_AGENT || "main";
  const ctx = context(cfg.root);
  const at = input.now ?? new Date().toISOString();
  const session = given ?? derivedSessionId(ctx.branch, agent, at);
  const job = input.job || process.env.COHERENCE_JOB || ctx.branch || "-";
  const over = input.over ?? [];
  // THE GUARANTEE IS APPLIED AT THE WRITE, not at the CLI and not at the render. Every
  // path into the journal — cli.ts, a hook, a test, some future tool — gets it, and the
  // instrument candidate is inside the content hash, so the same conjecture logged twice
  // still dedupes to one id.
  const conjecture = input.kind === "conjecture";
  const couldBe = conjecture ? withInstrumentCandidate(input.couldBe ?? []) : (input.couldBe ?? []);
  const discriminatedBy = input.discriminatedBy ?? "";
  const structured = canonicalStructuredDecisionFields(input);
  const structuredV2 = hasStructuredDecisionFields(structured);
  const rec: DecisionRecord = {
    ...(structuredV2 ? { version: 2 as const, ...structured } : {}),
    id: decisionId(
      input.kind, agent, input.chose, over, input.because, couldBe, discriminatedBy,
      input.supersedes, input.finding, structured,
    ),
    session,
    at,
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
  appendDecisionRow(cfg, session, rec);
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

/** THE TOTAL TIMELINE ORDER, exported because two readers depend on it agreeing with
 *  itself: `readJournal`'s merged render and the live stream (`journal.ts`), which
 *  receives records incrementally and must interleave them exactly where a cold read
 *  would have. Two hand-written copies of a three-key comparator is how "compaction
 *  changes nothing" stops being checkable. See `readJournal` for why the third key
 *  exists at all. */
export const timelineOrder = (a: DecisionRecord, b: DecisionRecord): number =>
  a.at.localeCompare(b.at) || a.id.localeCompare(b.id)
  || (a.session ?? "").localeCompare(b.session ?? "");

/** A SESSION IS NAMED BY ITS WORK, NOT BY ITS HEADER. The header is written by the
 *  hook at agent start, BEFORE the agent knows what it is called — so it defaults to
 *  "main" and the branch. Taking identity from the first record therefore filed every
 *  agent's session under "main", which is exactly the attribution the split-file
 *  layout exists to guarantee. A real record's own claim always wins over the header's
 *  placeholder.
 *
 *  Sorted INTERNALLY rather than trusting the caller's order, so the answer is a
 *  function of the record SET — the same property `readJournal`'s sort buys — and a
 *  caller holding an incrementally-grown array (the stream) gets the same sessions a
 *  cold read would. */
export function deriveSessions(records: DecisionRecord[]): Session[] {
  const byS = new Map<string, Session>();
  for (const r of [...records].sort(timelineOrder)) {
    let s = byS.get(r.session);
    if (!s) { s = { id: r.session, agent: r.agent, job: r.job, branch: r.branch, started: r.at, count: 0 }; byS.set(r.session, s); }
    if (r.kind !== "session") {
      s.count++;
      s.agent = r.agent; s.job = r.job; s.branch = r.branch;
    }
    if (r.at < s.started) s.started = r.at;
  }
  return [...byS.values()].sort((a, b) => a.started.localeCompare(b.started));
}

/** ONE SPELLING OF "IN SCOPE". `decisions` filters its render by job/agent/session/branch
 *  and the stream filters the same four ways; a second hand-written predicate is exactly
 *  the two-spellings drift `redundancy` exists to report, one file over from the module
 *  that hunts it. */
export interface JournalScope { job?: string | null; agent?: string | null; session?: string | null; branch?: string | null }
export const inScope = (r: DecisionRecord, s: JournalScope): boolean =>
  (!s.job || r.job === s.job) && (!s.agent || r.agent === s.agent)
  && (!s.session || r.session === s.session) && (!s.branch || r.branch === s.branch);

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
  // THE SORT IS TOTAL, AND THE THIRD KEY IS WHAT MAKES COMPACTION A NO-OP. Two keys left
  // ties to be settled by the order the records happened to be READ in — directory listing,
  // then line number — so the render was a function of the FILE LAYOUT, not of the content.
  // Which is fine until `compactJournal` changes the layout: an (at, id) tie split across
  // two files could then flip, and `resolve`'s last-write-wins dedupe would render the
  // other copy's agent/branch/commit. `session` closes it: (at, id, session) can only tie
  // for records that are byte-identical duplicates, which dedupe to one entry anyway. The
  // render is now a function of the SET of records — which is what "compaction changes
  // nothing" has to mean to be checkable. (Measured before adding it: 0 (at, id) ties and
  // 0 duplicate ids across this repo's own 72 records, so it moved nothing on disk today.)
  records.sort(timelineOrder);
  return { records, sessions: deriveSessions(records), unreadable };
}

// ── TRUSTED PROJECTION — strict evidence admission, separate from forensic availability ─

export type TrustedJournalDamageCode =
  | "parse"
  | "shape"
  | "timestamp"
  | "identity"
  | "duplicate-conflict"
  | "reference"
  | "session-file"
  | "storage";

export interface TrustedJournalDamage {
  code: TrustedJournalDamageCode;
  file: string;
  line?: number;
  id?: string;
  detail: string;
}

/** A damaged strict read contains no admissible records. Keeping `records` empty in the
 * refusal arm makes it difficult for a verdict caller to accidentally trust the valid
 * subset while merely printing a warning about the rest. `readJournal` remains the
 * tolerant recovery/rendering surface. */
export type TrustedJournalRead =
  | { ok: true; records: DecisionRecord[]; sessions: Session[]; damage: [] }
  | { ok: false; records: []; sessions: []; damage: TrustedJournalDamage[] };

interface LocatedDecision { record: DecisionRecord; file: string; line: number }

/** Git is the deletion witness the append-only files cannot provide for themselves.
 * This asks only about paths present at the current HEAD and deleted from the combined
 * index/worktree view. `null` means Git cannot establish a comparison (non-repository,
 * unborn branch, or command failure); it is not promoted into evidence of prior rows.
 *
 * The witness is consulted only when the live projection derives ZERO records. That
 * keeps compaction legal: replacing tracked session files with a populated fold changes
 * addresses but does not erase the population. It also leaves a genuinely never-created
 * ledger at adoption-from-zero, because HEAD then owns no deleted decision paths. */
function trackedDecisionDeletions(root: string): string[] | null {
  const deleted = gitLines(root, [
    "diff", "--no-renames", "--name-only", "--diff-filter=D", "HEAD", "--",
    ".coherence/decisions",
  ]);
  return deleted?.filter((path) => path.endsWith(".jsonl")) ?? null;
}

function trustedEmptyOrCommittedLoss(cfg: Config): TrustedJournalRead {
  const deleted = trackedDecisionDeletions(cfg.root);
  if (deleted?.length) {
    return {
      ok: false, records: [], sessions: [],
      damage: [{
        code: "storage", file: ".coherence/decisions",
        detail: `trusted projection derived zero rows, but HEAD owns ${deleted.length} deleted decision file(s): ${deleted.join(", ")}`,
      }],
    };
  }
  return { ok: true, records: [], sessions: [], damage: [] };
}

const DECISION_KINDS = new Set<DecisionKind>([
  "session", "decision", "blocked", "retraction", "conjecture", "resolution", "dismissal",
]);
const TERMINAL_KINDS = new Set<DecisionKind>(["retraction", "resolution", "dismissal"]);
const DECISION_KEYS = new Set([
  "version", "id", "session", "at", "kind", "agent", "job", "branch", "commit", "dirty",
  "chose", "over", "because", "supersedes", "files", "couldBe", "discriminatedBy",
  "metric", "value", "baseline", "threshold", "unit", "finding",
  "work", "subject", "scope", "authority",
]);
const SCOPE_KEYS = new Set(["components", "files", "symbols", "environment"]);
const AUTHORITIES = new Set<DecisionAuthority>([
  "local-proposal", "orchestrator-accepted", "user-directed",
]);

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Canonical means the writer's exact UTC millisecond spelling, not merely a date that
 * JavaScript happens to parse. Alternate offsets and omitted milliseconds otherwise give
 * one instant several timeline identities. */
const canonicalTimestamp = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return false;
  try { return new Date(v).toISOString() === v; } catch { return false; }
};

const normalizedString = (v: unknown, allowEmpty = false): v is string =>
  typeof v === "string" && (allowEmpty || v.length > 0) && v.trim() === v && !v.includes(ID_SEP);

function canonicalStringSet(v: unknown): v is string[] {
  if (!Array.isArray(v) || !v.length || !v.every((x) => normalizedString(x))) return false;
  return v.every((x, i) => i === 0 || v[i - 1].localeCompare(x) < 0);
}

const stringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => normalizedString(x));

function identitySignature(r: DecisionRecord): string {
  return JSON.stringify([
    r.kind, r.agent, r.chose, r.over, r.because, r.couldBe ?? null,
    r.discriminatedBy ?? null, r.supersedes ?? null, r.finding ?? null,
    r.version ?? 1,
    r.work ?? null, r.subject ?? null,
    r.scope
      ? [r.scope.components ?? [], r.scope.files ?? [], r.scope.symbols ?? [], r.scope.environment ?? []]
      : null,
    r.authority ?? null, [], [],
  ]);
}

function validateTrustedRecord(
  raw: unknown, file: string, line: number,
): { record?: DecisionRecord; damage: TrustedJournalDamage[] } {
  const damage: TrustedJournalDamage[] = [];
  const add = (code: TrustedJournalDamageCode, detail: string, id?: string) =>
    damage.push({ code, file, line, ...(id ? { id } : {}), detail });
  if (!object(raw)) {
    add("shape", "row is not a JSON object");
    return { damage };
  }
  const id = typeof raw.id === "string" ? raw.id : undefined;
  const unknown = Object.keys(raw).filter((k) => !DECISION_KEYS.has(k));
  if (unknown.length) add("shape", `unknown field(s): ${unknown.sort().join(", ")}`, id);
  if (raw.version !== undefined && raw.version !== 2) {
    add("shape", `unsupported decision wire version ${String(raw.version)}`, id);
  }
  if (typeof raw.id !== "string" || !/^d-[0-9a-f]{8}$/.test(raw.id)) add("shape", "id is not d- plus eight lowercase hex digits", id);
  for (const field of ["session", "agent", "job"] as const) {
    if (!normalizedString(raw[field])) add("shape", `${field} must be a nonempty normalized string`, id);
  }
  if (!canonicalTimestamp(raw.at)) add("timestamp", "at must be canonical UTC with millisecond precision", id);
  if (typeof raw.kind !== "string" || !DECISION_KINDS.has(raw.kind as DecisionKind)) add("shape", "kind is not a supported decision kind", id);
  if (raw.branch !== null && !normalizedString(raw.branch)) add("shape", "branch must be null or a normalized string", id);
  if (raw.commit !== null && !normalizedString(raw.commit)) add("shape", "commit must be null or a normalized string", id);
  if (typeof raw.dirty !== "boolean") add("shape", "dirty must be boolean", id);
  if (!normalizedString(raw.chose)) add("shape", "chose must be a nonempty normalized string", id);
  if (!stringList(raw.over)) add("shape", "over must be an array of nonempty normalized strings", id);

  const kind = typeof raw.kind === "string" && DECISION_KINDS.has(raw.kind as DecisionKind)
    ? raw.kind as DecisionKind
    : undefined;
  const becauseMayBeEmpty = kind === "conjecture";
  if (!normalizedString(raw.because, becauseMayBeEmpty)) {
    add("shape", `because must be a ${becauseMayBeEmpty ? "normalized" : "nonempty normalized"} string`, id);
  }
  if (raw.files !== undefined && (!Array.isArray(raw.files) || !raw.files.length || !raw.files.every((x) => normalizedString(x)))) {
    add("shape", "files must be a nonempty array of normalized repository addresses", id);
  }

  if (kind && TERMINAL_KINDS.has(kind)) {
    if (!normalizedString(raw.supersedes) || !/^d-[0-9a-f]{8}$/.test(raw.supersedes)) {
      add("shape", `${kind} requires a content-address supersedes target`, id);
    }
  } else if (raw.supersedes !== undefined) {
    add("shape", "supersedes is only valid on a terminal row", id);
  }

  if (kind === "conjecture") {
    if (!stringList(raw.couldBe) || !raw.couldBe.length) add("shape", "conjecture requires at least one candidate", id);
    if (!normalizedString(raw.discriminatedBy)) add("shape", "conjecture requires a discriminating test", id);
  } else if (raw.couldBe !== undefined || raw.discriminatedBy !== undefined) {
    add("shape", "couldBe and discriminatedBy are conjecture-only fields", id);
  }

  const metricFields = ["metric", "value", "baseline", "threshold", "unit"] as const;
  if (metricFields.some((k) => raw[k] !== undefined)) {
    if (kind !== "conjecture") add("shape", "metric evidence is only valid on a conjecture", id);
    if (!normalizedString(raw.metric)) add("shape", "metric must be a normalized string", id);
    for (const field of ["value", "baseline", "threshold"] as const) {
      if (typeof raw[field] !== "number" || !Number.isFinite(raw[field])) add("shape", `${field} must be a finite number`, id);
    }
    if (raw.unit !== undefined && !normalizedString(raw.unit)) add("shape", "unit must be a normalized string", id);
  }
  if (raw.finding !== undefined) {
    if ((kind !== "decision" && kind !== "conjecture") || !normalizedString(raw.finding)) {
      add("shape", "finding must be a normalized decision/conjecture key", id);
    }
  }

  const hasStructured = ["work", "subject", "scope", "authority"]
    .some((k) => raw[k] !== undefined);
  if (hasStructured !== (raw.version === 2)) {
    add("shape", hasStructured
      ? "structured decision fields require wire version 2"
      : "wire version 2 requires at least one structured decision field", id);
  }
  for (const field of ["work", "subject"] as const) {
    if (raw[field] !== undefined && !normalizedString(raw[field])) add("shape", `${field} must be a normalized string`, id);
  }
  if (raw.authority !== undefined && (typeof raw.authority !== "string" || !AUTHORITIES.has(raw.authority as DecisionAuthority))) {
    add("shape", "authority is not a supported authority grade", id);
  }
  if (raw.scope !== undefined) {
    if (!object(raw.scope)) add("shape", "scope must be an object", id);
    else {
      const scope = raw.scope;
      const scopeUnknown = Object.keys(scope).filter((k) => !SCOPE_KEYS.has(k));
      if (scopeUnknown.length) add("shape", `unknown scope field(s): ${scopeUnknown.sort().join(", ")}`, id);
      const present = [...SCOPE_KEYS].filter((k) => scope[k] !== undefined);
      if (!present.length) add("shape", "scope must name at least one address set", id);
      for (const field of present) {
        if (!canonicalStringSet(scope[field])) add("shape", `scope.${field} must be a nonempty sorted set of normalized addresses`, id);
      }
    }
  }

  if (damage.length) return { damage };
  const record = raw as unknown as DecisionRecord;
  const expected = recomputeDecisionId(record);
  const legacyTerminal = record.version === undefined && !!record.supersedes
    ? recomputeTargetOmittingDecisionId(record)
    : null;
  if (record.id !== expected && record.id !== legacyTerminal) {
    add("identity", `stored id ${record.id} does not match recomputed ${expected}${legacyTerminal ? ` or legacy ${legacyTerminal}` : ""}`, record.id);
    return { damage };
  }
  return { record, damage };
}

/** Strict, version-aware evidence projection. Unlike `readJournal`, one damaged row,
 * broken pointer, conflicting content address, or provable session/file displacement
 * refuses the entire projection. This is the reader verdict-bearing consumers use. */
export function readTrustedJournal(cfg: Config): TrustedJournalRead {
  const dir = decisionsDir(cfg);
  const damage: TrustedJournalDamage[] = [];
  for (const [path, label] of [
    [join(cfg.root, ".coherence"), ".coherence"],
    [dir, ".coherence/decisions"],
  ] as const) {
    let standing;
    try { standing = lstatSync(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return trustedEmptyOrCommittedLoss(cfg);
      }
      return {
        ok: false, records: [], sessions: [],
        damage: [{
          code: "storage", file: label,
          detail: "cannot inspect ledger directory: " + (error instanceof Error ? error.message : String(error)),
        }],
      };
    }
    if (standing.isSymbolicLink() || !standing.isDirectory()) {
      return {
        ok: false, records: [], sessions: [],
        damage: [{ code: "storage", file: label, detail: "must be a real repository directory, never a symlink" }],
      };
    }
  }
  const located: LocatedDecision[] = [];
  const byFile = new Map<string, LocatedDecision[]>();
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    return {
      ok: false, records: [], sessions: [],
      damage: [{
        code: "storage", file: ".coherence/decisions",
        detail: "cannot enumerate ledger: " + (error instanceof Error ? error.message : String(error)),
      }],
    };
  }
  const portableNames = new Map<string, string>();
  for (const entry of entries) {
    const file = entry.name;
    if (entry.isSymbolicLink()) {
      damage.push({ code: "storage", file, detail: "journal evidence must be a contained regular file, never a symlink" });
      continue;
    }
    if (file === ".DS_Store") continue;
    if (!file.endsWith(".jsonl")) {
      damage.push({ code: "storage", file, detail: "unexpected journal entry; only decision .jsonl files belong here" });
      continue;
    }
    if (!entry.isFile()) {
      damage.push({ code: "storage", file, detail: "journal entry is not a regular file" });
      continue;
    }
    const portable = file.normalize("NFD").toLowerCase();
    const priorName = portableNames.get(portable);
    if (priorName && priorName !== file) {
      damage.push({ code: "storage", file, detail: priorName + " and " + file + " alias on a portable filesystem" });
    } else portableNames.set(portable, file);
    let source: string;
    try { source = readFileSync(join(dir, file), "utf8"); }
    catch (e) {
      damage.push({ code: "parse", file, detail: `cannot read file: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    const rows: LocatedDecision[] = [];
    if (!source.trim()) {
      damage.push({ code: "storage", file, detail: "journal file contains no records" });
      byFile.set(file, rows);
      continue;
    }
    const lines = source.split("\n");
    if (lines.pop() !== "") {
      damage.push({ code: "storage", file, detail: "journal file has no canonical final newline; its last append may be torn" });
      byFile.set(file, rows);
      continue;
    }
    for (const [index, text] of lines.entries()) {
      const line = index + 1;
      if (!text.trim()) {
        damage.push({ code: "storage", file, line, detail: "blank journal row is not canonical append framing" });
        continue;
      }
      let raw: unknown;
      try { raw = JSON.parse(text); }
      catch {
        damage.push({ code: "parse", file, line, detail: "line is not valid JSON" });
        continue;
      }
      const checked = validateTrustedRecord(raw, file, line);
      damage.push(...checked.damage);
      if (checked.record) {
        const row = { record: checked.record, file, line };
        rows.push(row); located.push(row);
      }
    }
    byFile.set(file, rows);
  }

  // A direct file is named by its session. A compacted file is named by branch/month.
  // One released legacy file followed a session across a branch switch; if at least one
  // row anchors that session to the filename, later rows from THE SAME session remain
  // attributable. An unrelated, unanchored session in that file still refuses.
  for (const [file, rows] of byFile) {
    if (!rows.length) continue;
    const stem = file.slice(0, -".jsonl".length);
    const matches = (r: DecisionRecord) =>
      file === hashedDecisionSessionFilename(r.session)
      || stem === slug(r.session)
      || stem === `${slug(r.branch ?? "nobranch")}-${r.at.slice(0, 7)}`;
    const anchoredSessions = new Set(rows.filter((x) => matches(x.record)).map((x) => x.record.session));
    if (!anchoredSessions.size) {
      damage.push({ code: "session-file", file, detail: "filename is anchored by neither a contained session nor a contained branch/month" });
      continue;
    }
    for (const row of rows) {
      if (!matches(row.record) && !anchoredSessions.has(row.record.session)) {
        damage.push({
          code: "session-file", file, line: row.line, id: row.record.id,
          detail: `session ${row.record.session} is not attributable to this journal file`,
        });
      }
    }
  }

  const byId = new Map<string, { signature: string; first: LocatedDecision; records: LocatedDecision[] }>();
  for (const row of located) {
    const signature = identitySignature(row.record);
    const prior = byId.get(row.record.id);
    if (!prior) byId.set(row.record.id, { signature, first: row, records: [row] });
    else {
      prior.records.push(row);
      if (prior.signature !== signature) {
        damage.push({
          code: "duplicate-conflict", file: row.file, line: row.line, id: row.record.id,
          detail: `content address conflicts with ${prior.first.file}:${prior.first.line}`,
        });
      }
    }
  }

  for (const row of located) {
    const targetId = row.record.supersedes;
    if (!targetId) continue;
    const target = byId.get(targetId)?.first.record;
    if (!target) {
      damage.push({
        code: "reference", file: row.file, line: row.line, id: row.record.id,
        detail: `supersedes target ${targetId} does not exist`,
      });
      continue;
    }
    if (target.kind === "session") {
      damage.push({ code: "reference", file: row.file, line: row.line, id: row.record.id, detail: "a session header cannot be superseded" });
    }
    if ((row.record.kind === "resolution" || row.record.kind === "dismissal") && target.kind !== "conjecture") {
      damage.push({
        code: "reference", file: row.file, line: row.line, id: row.record.id,
        detail: `${row.record.kind} target ${targetId} is ${target.kind}, not conjecture`,
      });
    }
  }

  // Generic cycle check even though finding one through a content hash normally requires
  // a collision: the projection must not inherit that cryptographic assumption as control
  // flow, especially with the deliberately short historical eight-hex addresses.
  for (const row of located) {
    const seen = new Set<string>();
    let cursor: DecisionRecord | undefined = row.record;
    while (cursor?.supersedes) {
      if (seen.has(cursor.id)) {
        damage.push({ code: "reference", file: row.file, line: row.line, id: row.record.id, detail: "supersedes relation contains a cycle" });
        break;
      }
      seen.add(cursor.id);
      cursor = byId.get(cursor.supersedes)?.first.record;
    }
  }

  if (!located.length && !damage.length) {
    const empty = trustedEmptyOrCommittedLoss(cfg);
    if (!empty.ok) damage.push(...empty.damage);
  }

  if (damage.length) {
    damage.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.code.localeCompare(b.code));
    return { ok: false, records: [], sessions: [], damage };
  }
  const records = located.map((x) => x.record).sort(timelineOrder);
  return { ok: true, records, sessions: deriveSessions(records), damage: [] };
}

// ── COMPACTION — tidying the working tree, never editing the record ──────────────────
//
// THE PAIN IS A PULL REQUEST. One consuming project produced ~20 journal files in a day;
// twenty new files is not a diff anybody reads, and one or two is. `derivedSessionId` stops
// the multiplication going forward, and this folds what already multiplied.
//
// HOW IT COEXISTS WITH APPEND-ONLY, which is the only interesting question here: it only
// folds files whose blobs are ALREADY IN GIT HISTORY. The originals therefore live in the
// history forever and `git log -- <path>` plus `git show <commit>:<path>` recovers any individual
// session, so nothing is
// erased — the working tree is tidied, and the record is exactly as complete afterwards as
// it was before. A file git has never seen is skipped, always, because for that file this
// operation WOULD be a deletion.
//
// THE ACCEPTANCE TEST IS THAT IT CHANGES NOTHING. `coherence decisions` before and after
// must be character-for-character identical; if the render moves, the compaction is wrong.
// That is testable rather than aspirational because of two properties: every LINE is copied
// BYTE-FOR-BYTE (never re-serialised through JSON.parse/stringify, which would reorder keys
// and re-escape unicode), and `readJournal`'s sort is TOTAL, so the render is a function of
// the set of records rather than of which file each one sits in.
//
// GROUPING IS (BRANCH, MONTH), and both halves are load-bearing:
//   · branch alone would fold all of main's history into one ever-growing file, and would
//     put two branches in one file — reintroducing the merge conflict the split exists for.
//   · month alone would mix branches, same problem.
//   A PR branch lives days to weeks, so it lands as one or two files. That is the point.
//
// THE GROUP KEY COMES FROM THE RECORDS, NEVER FROM THE FILENAME. Filenames are not parsed
// anywhere in this module — a name is only ever compared against one computed from content —
// so a hand-named file, a hook-minted random id and a previously-compacted file all sort
// themselves out by what they contain. (This is the same correction `readJournal`'s
// session-naming already had to make: the file is not the authority on what is inside it.)

/** THE QUIET WINDOW: a file written more recently than this is never folded.
 *
 *  TWO HOURS, and both bounds are argued rather than picked. It has to be LONGER than the
 *  gap between one agent's successive appends, or compaction lands mid-session — measured
 *  on this repo's own journal, the largest gap between consecutive entries in a single
 *  session is 14.1 min and the longest session spans 22.5 min, so two hours is ~8x the
 *  observed worst case. And it has to be SHORTER than a day, because the motivating case is
 *  twenty files accumulated in ONE day and compacted before the PR goes up; a 24-hour
 *  window would refuse exactly the work it was asked to tidy.
 *
 *  It is a heuristic, so it is not the only guard: every source is re-stat'ed immediately
 *  before its group is written and the group is abandoned if anything moved, and a fold
 *  that raced an append anyway would duplicate lines rather than lose them — which
 *  `resolve`'s content-hash dedupe renders identically. */
export const COMPACT_QUIET_MS = 2 * 60 * 60 * 1000;

interface Foldable { file: string; target: string; lines: string[]; recs: DecisionRecord[]; size: number; mtimeMs: number }

export interface CompactPlan {
  /** target filename -> the files folded into it (may include the target itself). */
  groups: { target: string; sources: Foldable[] }[];
  /** left alone, with the reason — a skip is normal operation, not a failure. */
  skipped: { file: string; why: string }[];
  /** non-empty means DO NOTHING AT ALL. Not "skip these files" — abort. */
  refusals: string[];
  before: number;
}

/** What compaction WOULD do. Separated from doing it so the refusals can be tested without
 *  a filesystem mutation, and so the executor has no policy left in it. */
export function planCompaction(cfg: Config, nowMs: number = Date.now()): CompactPlan {
  const dir = decisionsDir(cfg);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort() : [];
  const plan: CompactPlan = { groups: [], skipped: [], refusals: [], before: files.length };
  if (!files.length) return plan;

  // `ls-tree HEAD` is the question that actually matters — IS THIS BLOB IN THE HISTORY —
  // and it is not the same question as `git status`, which says nothing about ignored
  // files. A project that gitignored `.coherence/decisions/` would look perfectly clean
  // while holding no committed copy of anything, and this is the check that catches it.
  // A RELATIVE pathspec, resolved against `cwd: cfg.root`. An absolute one breaks on macOS,
  // where a temp root is `/var/folders/…` and git resolves the worktree to
  // `/private/var/folders/…` and then calls the pathspec outside its own repository.
  const spec = join(".coherence", "decisions");
  const inHead = gitLines(cfg.root, ["ls-tree", "-r", "--name-only", "HEAD", "--", spec]);
  const changed = gitLines(cfg.root, ["diff", "HEAD", "--name-only", "--", spec]);
  if (inHead === null || changed === null) {
    plan.refusals.push("no git HEAD to fall back on — compaction is only non-destructive because"
      + " git history holds the originals, so outside a repo with at least one commit it is just deletion.");
    return plan;
  }
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const committed = new Set(inHead.map(base));
  const dirty = new Set(changed.map(base));

  const foldable: Foldable[] = [];
  for (const f of files) {
    const st = statSync(join(dir, f));
    // THE REFUSAL, and it is deliberately the only one about file state. A TRACKED journal
    // file whose content differs from HEAD means the record was edited in place — the one
    // thing this journal forbids — and compaction must not paper over it by folding the
    // difference into a bigger file where nobody will find it.
    if (dirty.has(f)) { plan.refusals.push(`${f} differs from HEAD — uncommitted journal content`); continue; }
    // UNCOMMITTED IS A SKIP, NOT A REFUSAL, and that asymmetry is the live-session case: an
    // untracked `.jsonl` is a session opened minutes ago. Refusing there would make the
    // command unusable in any repo where an agent is running, which is every repo needing it.
    if (!committed.has(f)) { plan.skipped.push({ file: f, why: "never committed — git history has no copy to recover it from" }); continue; }
    const age = nowMs - st.mtimeMs;
    if (age < COMPACT_QUIET_MS) {
      plan.skipped.push({ file: f, why: `written ${Math.round(age / 60000)} min ago — inside the ${COMPACT_QUIET_MS / 3600000}h quiet window` });
      continue;
    }
    const lines = readFileSync(join(dir, f), "utf8").split("\n").filter((l) => l.trim());
    const recs: DecisionRecord[] = [];
    for (const line of lines) {
      try {
        const o = JSON.parse(line) as DecisionRecord;
        if (typeof o.id === "string" && typeof o.chose === "string" && typeof o.at === "string") recs.push(o);
      } catch { /* counted by the length compare below */ }
    }
    // A FILE WITH AN UNREADABLE LINE IS LEFT ALONE. A line the reader cannot parse has no
    // timestamp, so there is no honest place for it in a timestamp-ordered concatenation —
    // and dropping it would lower the render's `N unreadable line(s)` warning from N to
    // N-1, which is the silent repair this journal exists to refuse.
    if (recs.length !== lines.length) {
      plan.skipped.push({ file: f, why: `${lines.length - recs.length} unreadable line(s) — a line with no timestamp cannot be ordered, and dropping it would quietly lower the damage count` });
      continue;
    }
    if (!recs.length) { plan.skipped.push({ file: f, why: "empty" }); continue; }
    const branch = recs.find((r) => r.branch)?.branch ?? null;
    const month = recs.reduce((m, r) => (r.at < m ? r.at : m), recs[0].at).slice(0, 7);
    foldable.push({ file: f, target: `${slug(branch ?? "nobranch")}-${month}.jsonl`, lines, recs, size: st.size, mtimeMs: st.mtimeMs });
  }
  // A refusal aborts EVERYTHING. Compaction rewrites a directory; a directory in a state
  // nobody has explained is not one to rewrite, and half a compaction is worse than none.
  if (plan.refusals.length) return { ...plan, groups: [], skipped: [] };

  const byTarget = new Map<string, Foldable[]>();
  for (const c of foldable) byTarget.set(c.target, [...(byTarget.get(c.target) ?? []), c]);
  for (const [target, sources] of [...byTarget].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Already exactly where it belongs, under the name it belongs under: nothing to do.
    // Without this, a second `--compact` rewrites every file it wrote the first time.
    if (sources.length === 1 && sources[0].file === target) continue;
    plan.groups.push({ target, sources });
  }
  return plan;
}

/** Execute the plan. Report lines out, exit code out; the CLI only prints. */
export function compactJournal(cfg: Config, o: { nowMs?: number } = {}): { code: number; lines: string[] } {
  const dir = decisionsDir(cfg);
  const plan = planCompaction(cfg, o.nowMs);
  const L: string[] = [];
  if (plan.refusals.length) {
    L.push(`REFUSED — nothing was compacted. ${plan.refusals.length} problem(s):`);
    for (const r of plan.refusals) L.push(`  · ${r}`);
    L.push("", "Compaction only folds files git ALREADY HOLDS, so the originals stay recoverable with");
    L.push("`git log`. Commit the journal first, then compact.");
    return { code: 1, lines: L };
  }

  let folded = 0, written = 0;
  for (const { target, sources } of plan.groups) {
    // RE-STAT IMMEDIATELY BEFORE WRITING. The mtime window is a heuristic about agents;
    // this is the actual guard against racing one. If anything moved between the plan and
    // now, the group is abandoned whole — a partially folded group is the one outcome with
    // no clean recovery story.
    const moved = sources.filter((s) => {
      const st = statSync(join(dir, s.file));
      return st.size !== s.size || st.mtimeMs !== s.mtimeMs;
    });
    if (moved.length) {
      for (const m of moved) plan.skipped.push({ file: m.file, why: "changed while compacting — left alone" });
      continue;
    }
    // Sorted on the READER's key, so the reader's own stable sort has nothing left to do
    // inside a compacted file. The line text is the ORIGINAL bytes — re-serialising the
    // parsed record would reorder keys and re-escape unicode, and "content byte-identical"
    // is the property the whole operation is judged on.
    const rows = sources.flatMap((s) => s.lines.map((line, i) => ({ line, r: s.recs[i] })));
    rows.sort((a, b) => timelineOrder(a.r, b.r));
    writeFileSync(join(dir, target), rows.map((x) => x.line).join("\n") + "\n");
    written++;
    // AFTER the target exists, never before: a crash here leaves duplicate lines, which
    // `resolve`'s content-hash dedupe renders identically. A crash the other way round
    // loses the lines outright.
    for (const s of sources) if (s.file !== target) { unlinkSync(join(dir, s.file)); folded++; }
    L.push(`${target}  ← ${sources.length} file(s), ${rows.length} entr${rows.length === 1 ? "y" : "ies"}`);
  }

  // COUNTED FROM THE DIRECTORY, NOT DERIVED FROM THE TALLIES. The first version computed
  // `before - folded`, and the dogfood run on this repo's own journal reported "15 file(s)
  // → 1" when the answer was 5: it subtracted the 14 files unlinked and forgot the 4
  // written. Doubt the instrument before the subject — and where the subject is a
  // directory, ask the directory.
  const after = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).length;
  if (!plan.groups.length) L.push("nothing to compact — every foldable file is already grouped by (branch, month).");
  L.push("");
  L.push(`${plan.before} file(s) → ${after}${written ? `  (${written} written, ${folded} folded away)` : ""}`);
  for (const s of plan.skipped) L.push(`  skipped ${s.file}: ${s.why}`);
  if (folded) {
    L.push("", "The originals are in git history: `git log --oneline -- .coherence/decisions/<file>` names the");
    L.push("commits that held it and `git show <commit>:<path>` prints it back, byte for byte. `coherence decisions`");
    L.push("renders exactly what it rendered before; stage the result with `git add -A .coherence/decisions/`.");
  }
  return { code: 0, lines: L };
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
  // Retractions are collected FIRST because they may withdraw a terminal row too. A
  // resolution is still a claim, and an append-only record needs a real way to correct
  // an overbroad answer without relying on an implicit last-write-wins accident. The old
  // one-pass build skipped terminal rows before consulting `withdrawn`, so retracting a
  // resolution exited 0 and changed nothing.
  for (const r of all) {
    if (r.kind === "retraction" && r.supersedes) withdrawn.set(r.supersedes, r);
  }
  for (const r of all) {
    if (withdrawn.has(r.id)) continue;
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
    const by = withdrawn.get(r.id);
    if (by) { retracted.push({ rec: r, by }); continue; }
    if (r.kind === "retraction" || r.kind === "resolution" || r.kind === "dismissal") continue;
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
  const state = resolve(records);
  if (!state.open.some((r) => r.id === id)) {
    const answered = state.resolved.find((x) => x.rec.id === id)?.by;
    const dismissed = state.dismissed.find((x) => x.rec.id === id)?.by;
    const withdrawn = state.retracted.find((x) => x.rec.id === id)?.by;
    const terminal = answered ?? dismissed ?? withdrawn;
    const stateName = answered ? "resolved" : dismissed ? "dismissed" : "retracted";
    return { error: [
      `${id} is already ${stateName}${terminal ? ` by ${terminal.id}` : ""}.`,
      answered
        ? `Retract the prior answer first: coherence retract ${answered.id} --because "..."`
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
  const scoped = records.filter((r) => inScope(r, opts));
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
      .map((c) => (readsAsInstrumentDoubt(c) && !c.trim().startsWith(`${INSTRUMENT_MARKER} `)
        ? `${INSTRUMENT_MARKER} ${c}` : c)).join(" · ")}`);
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
