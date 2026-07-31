// conjecture.test.ts — the CONJECTURE record: abduction as a first-class journal entry.
//
// What these pin, in order of how badly it hurts when it breaks:
//   1. THE INSTRUMENT CANDIDATE IS ALWAYS THERE. Every one of the six findings that
//      motivated this record was an instrument failure, and the candidate list that
//      omits it has already made the mistake — at WRITE time, before a reader can catch
//      it. If this guarantee is the thing that quietly stops holding, the record is
//      decoration.
//   2. OPEN AND RESOLVED LOOK DIFFERENT, AND OPEN COMES FIRST. A question somebody
//      stopped asking and a question somebody answered are not the same object. If the
//      render cannot tell them apart, nothing can.
//   3. A CONJECTURE IS NOT A DECISION. It must never land in `standing` — reporting an
//      unanswered question as a settled position is the exact confusion this exists to end.
//   4. IDS DO NOT MOVE. They are pointers: every `supersedes` on disk names one. Widening
//      the content hash for the new fields must leave every pre-existing id untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendDecision, readJournal, resolve, renderJournal, newSessionId, resolvableConjecture,
  withInstrumentCandidate, readsAsInstrumentDoubt, INSTRUMENT_CANDIDATE, LABEL_SOFT_MAX,
} from "../src/decisions.ts";
import { agentInstructions, stopReport } from "../src/hooks.ts";
import { runCaptured, cleanup } from "./_helpers.ts";
import type { Config } from "../src/types.ts";

async function root(): Promise<Config> {
  const dir = await mkdtemp(join(tmpdir(), "coh-conj-"));
  return { root: dir } as Config;
}
const T = (n: number) => `2026-07-29T10:${String(n).padStart(2, "0")}:00.000Z`;

/** One real instance from the session that motivated this record: 139,460 habitat
 *  violations that turned out to be a decoder off-by-one. True answer: 158. */
function habitat(cfg: Config, o: { couldBe?: string[]; session?: string; now?: string } = {}) {
  return appendDecision(cfg, {
    kind: "conjecture",
    chose: "139,460 habitat violations across 84 cells",
    because: "",
    couldBe: o.couldBe ?? ["the sim really is that broken"],
    discriminatedBy: "decode one known cell by hand and compare against the reported column",
    session: o.session ?? newSessionId(),
    now: o.now ?? T(1),
  });
}

// ── 1. the candidate nobody writes down ──────────────────────────────────────────

test("instrument — a conjecture that never names the instrument gets it anyway", async () => {
  const cfg = await root();
  const rec = habitat(cfg);
  assert.equal(rec.couldBe?.[0], INSTRUMENT_CANDIDATE,
    "the highest-prior explanation must be present without the author supplying it");
  assert.equal(rec.couldBe?.length, 2, "and the author's own candidate survives beside it");
  assert.ok(rec.couldBe!.some(readsAsInstrumentDoubt), "at least one candidate always reads as instrument doubt");
  await cleanup(cfg.root);
});

test("instrument — the author's OWN wording wins; nothing canonical is bolted on", async () => {
  // Specificity is the whole value: "the decoder had an off-by-one" beats the canonical
  // line, so when the author already doubted the apparatus we leave the list alone.
  const cfg = await root();
  const rec = habitat(cfg, { couldBe: ["the decoder is doing floor(v/16) where the encoding is 1-based"] });
  assert.equal(rec.couldBe?.length, 1, "no redundant canonical candidate");
  assert.ok(!rec.couldBe!.includes(INSTRUMENT_CANDIDATE));
  assert.ok(readsAsInstrumentDoubt(rec.couldBe![0]), "and the guarantee still holds via their wording");
  await cleanup(cfg.root);
});

test("instrument — the heuristic's failure mode is REDUNDANCY, never absence", async () => {
  // The detector is deliberately narrow. When it misses a phrasing that a human would
  // call instrument doubt, the cost is one extra candidate — recoverable noise. The
  // opposite error (shipping a conjecture with no instrument candidate at all) would be
  // silent, and is the failure this record exists to prevent. Asserted over the missing
  // case on purpose: this is the branch that must stay safe.
  const missed = "a paste artifact that has been riding along unnoticed";
  assert.equal(readsAsInstrumentDoubt(missed), false, "narrow by design — this phrasing is not detected");
  const out = withInstrumentCandidate([missed]);
  assert.equal(out.length, 2);
  assert.ok(out.some(readsAsInstrumentDoubt), "so the canonical candidate is added and the guarantee survives the miss");

  // ...and with no candidates at all, the list is not empty.
  assert.deepEqual(withInstrumentCandidate([]), [INSTRUMENT_CANDIDATE]);
});

test("instrument — the guarantee is inside the CONTENT HASH, so a re-log still dedupes", async () => {
  // The candidate is added at the write, not at the render, precisely so this holds.
  const cfg = await root();
  const one = habitat(cfg, { now: T(1) });
  const two = habitat(cfg, { now: T(9) });
  assert.equal(one.id, two.id, "a retried agent must not inflate the open-question count");
  assert.equal(resolve(readJournal(cfg).records).open.length, 1);
  await cleanup(cfg.root);
});

test("instrument — the render TAGS it, because an unmarked line is one the eye averages over", async () => {
  const cfg = await root();
  habitat(cfg);
  const { text } = renderJournal(cfg);
  assert.match(text, /could be: \[instrument\] the instrument is wrong/);
  await cleanup(cfg.root);
});

// ── 2. unresolved is the valuable state, and it must be loud ─────────────────────

test("open vs resolved — they render in DIFFERENT sections, and open comes first", async () => {
  const cfg = await root();
  const a = newSessionId(), b = newSessionId();
  const answered = habitat(cfg, { session: a, now: T(1) });
  appendDecision(cfg, {
    kind: "resolution", chose: "the decoder had an off-by-one", supersedes: answered.id,
    because: "decoded cell 4412 by hand: the true violation count is 158, not 139,460",
    session: b, agent: "integrator", now: T(5),
  });
  appendDecision(cfg, {
    kind: "conjecture", chose: "a negative control passed", because: "",
    couldBe: [], discriminatedBy: "make the control's regex match something and watch it fail",
    session: a, now: T(2),
  });

  const { open, resolved, standing } = resolve(readJournal(cfg).records);
  assert.equal(open.length, 1, "the unanswered one is open");
  assert.equal(resolved.length, 1, "the answered one is not");
  assert.equal(standing.length, 0, "and NEITHER is a decision — a conjecture never reads as a settled position");
  assert.match(resolved[0].by.because, /158, not 139,460/, "resolution crosses session files, like retraction");

  const { text } = renderJournal(cfg);
  assert.match(text, /1 OPEN CONJECTURE\(S\)/, "shouted in the summary when nonzero");
  assert.match(text, /Open questions — NOTICED, NOT YET CHASED/);
  assert.match(text, /RESOLVED by integrator/);
  assert.match(text, /won: the decoder had an off-by-one/, "--as names which candidate won");
  assert.ok(text.indexOf("Open questions") < text.indexOf("Resolved"),
    "OPEN MUST COME FIRST — filed under the settled work it reads as an appendix");
  await cleanup(cfg.root);
});

test("open — zero open conjectures is stated plainly, not shouted", async () => {
  const cfg = await root();
  appendDecision(cfg, { kind: "decision", chose: "X", because: "-", session: newSessionId(), now: T(1) });
  const { text } = renderJournal(cfg);
  assert.match(text, /0 open conjectures/);
  assert.ok(!/OPEN CONJECTURE/.test(text), "permanent all-caps furniture is what the eye learns to skip");
  await cleanup(cfg.root);
});

test("open — `--open` is a lens: only the open questions, and it SAYS when there are none", async () => {
  const cfg = await root();
  const s = newSessionId();
  appendDecision(cfg, { kind: "decision", chose: "a settled choice", because: "-", session: s, now: T(1) });
  const empty = renderJournal(cfg, { open: true }).text;
  assert.ok(!empty.includes("a settled choice"), "the lens shows nothing else");
  assert.match(empty, /\(none open —/, "silence would be ambiguous between 'all chased' and 'the filter is broken'");

  habitat(cfg, { session: s, now: T(2) });
  const some = renderJournal(cfg, { open: true }).text;
  assert.match(some, /139,460 habitat violations/);
  assert.ok(!some.includes("a settled choice"));
  await cleanup(cfg.root);
});

test("open — a RETRACTED conjecture is withdrawn, not answered", async () => {
  // The observation itself turned out not to hold. Showing it as resolved would report
  // an answer to a question that was never real.
  const cfg = await root();
  const s = newSessionId();
  const c = habitat(cfg, { session: s, now: T(1) });
  appendDecision(cfg, {
    kind: "resolution", chose: "the decoder", supersedes: c.id, because: "hand-decode says 158",
    session: s, now: T(2),
  });
  appendDecision(cfg, {
    kind: "retraction", chose: "(withdrawn)", supersedes: c.id,
    because: "the run that produced 139,460 was against a planet with no continents — there was no observation",
    session: s, agent: "verifier", now: T(3),
  });
  const { open, resolved, retracted } = resolve(readJournal(cfg).records);
  assert.deepEqual([open.length, resolved.length, retracted.length], [0, 0, 1],
    "retraction outranks resolution");
  await cleanup(cfg.root);
});

test("open — the stop report names the open questions, where they are cheapest to answer", async () => {
  const cfg = await root();
  habitat(cfg);
  const said = stopReport(cfg);
  assert.match(said, /1 OPEN CONJECTURE\(S\) in this repo/);
  assert.match(said, /decisions --open/, "and says how to see them");

  // No open questions, no tail — the nudge must not become furniture.
  const quiet = await root();
  appendDecision(quiet, { kind: "decision", chose: "X", because: "-", session: newSessionId(), now: T(1) });
  assert.ok(!/OPEN CONJECTURE/.test(stopReport(quiet)));
  await cleanup(cfg.root);
  await cleanup(quiet.root);
});

test("open — the instruction every agent is handed teaches the verb", async () => {
  // A verb no agent is told about is a verb nobody uses, and the feature is then
  // indistinguishable from never having shipped.
  const t = agentInstructions("s-abc");
  assert.match(t, /coherence conjecture/);
  assert.match(t, /--discriminated-by/);
  assert.match(t, /DOUBT THE INSTRUMENT BEFORE THE SUBJECT/);
  assert.match(agentInstructions("agent-abc", "node src/cli.ts"), /node src\/cli\.ts decide/,
    "the dogfood hook must inject a command that works before this package is installed");
  const attributed = agentInstructions("agent-abc", "node src/cli.ts", "Explore");
  assert.match(attributed, /--session "agent-abc" --agent "Explore"/);
  assert.match(attributed, /resolved <id>.*--session "agent-abc"/,
    "closing a question must remain in the lifecycle host's attributable session");
});

// ── 3. resolving something that cannot be resolved ───────────────────────────────

test("resolved — an unknown id is refused, and the refusal points at the open list", async () => {
  const cfg = await root();
  habitat(cfg);
  const r = resolvableConjecture(readJournal(cfg).records, "d-deadbeef");
  assert.ok("error" in r, "an id nobody wrote must not silently append a dangling resolution");
  assert.match((r as { error: string[] }).error[0], /no entry d-deadbeef in the journal/);
  assert.match((r as { error: string[] }).error[0], /decisions --open/);
  await cleanup(cfg.root);
});

test("resolved — a DECISION id is a different refusal from an unknown one", async () => {
  // Accepting it would append a resolution no render ever reads: a command that exits 0
  // and does nothing, which is the defect this harness exists to hunt.
  const cfg = await root();
  const d = appendDecision(cfg, { kind: "decision", chose: "X", because: "-", session: newSessionId(), now: T(1) });
  const r = resolvableConjecture(readJournal(cfg).records, d.id);
  assert.ok("error" in r);
  const err = (r as { error: string[] }).error.join("\n");
  assert.match(err, /is a decision, not a conjecture/);
  assert.match(err, /coherence retract/, "unknown and wrong-kind need different fixes, so they get different messages");
  assert.ok(!/no entry/.test(err));
  await cleanup(cfg.root);
});

test("resolved — a real conjecture id is accepted", async () => {
  const cfg = await root();
  const c = habitat(cfg);
  const r = resolvableConjecture(readJournal(cfg).records, c.id);
  assert.ok("rec" in r);
  assert.equal((r as { rec: { id: string } }).rec.id, c.id);
  await cleanup(cfg.root);
});

// ── 4. --brief: prose clips, labels never do ─────────────────────────────────────

test("--brief — `discriminated by` clips and ANNOUNCES the withheld count", async () => {
  const cfg = await root();
  const s = newSessionId();
  const test_ = "z".repeat(400) + " decode cell 4412 by hand";
  appendDecision(cfg, {
    kind: "conjecture", chose: "139,460 habitat violations", because: "",
    couldBe: ["the sim really is that broken"], discriminatedBy: test_, session: s, now: T(1),
  });
  const brief = renderJournal(cfg, { brief: true }).text;
  assert.ok(!brief.includes("decode cell 4412 by hand"), "the tail is clipped");
  assert.match(brief, /\(\+\d+ chars — drop --brief for the evidence\)/, "and the reader is TOLD, with a count");
  assert.match(renderJournal(cfg).text, /decode cell 4412 by hand/, "without --brief nothing is withheld");
  await cleanup(cfg.root);
});

test("--brief — candidates are LABELS and are never clipped, the same rule `over` follows", async () => {
  const cfg = await root();
  const long = "the decoder is off by one, and here is a long tail of qualification: " + "q".repeat(300);
  appendDecision(cfg, {
    kind: "conjecture", chose: "139,460 habitat violations", because: "",
    couldBe: [long], discriminatedBy: "decode by hand", session: newSessionId(), now: T(1),
  });
  const brief = renderJournal(cfg, { brief: true }).text;
  assert.ok(brief.includes(long), "a candidate is a label — clipping it would hide which explanations were even considered");
  await cleanup(cfg.root);
});

test("--brief — the RESOLUTION's rationale clips too; it is evidence, not a label", async () => {
  const cfg = await root();
  const s = newSessionId();
  const c = habitat(cfg, { session: s, now: T(1) });
  appendDecision(cfg, {
    kind: "resolution", chose: "the decoder", supersedes: c.id,
    because: "y".repeat(400) + " true count 158",
    session: s, agent: "integrator", now: T(2),
  });
  const brief = renderJournal(cfg, { brief: true }).text;
  assert.ok(!brief.includes("true count 158"));
  assert.match(brief, /RESOLVED by integrator[\s\S]*drop --brief for the evidence/);
  assert.match(renderJournal(cfg).text, /true count 158/);
  await cleanup(cfg.root);
});

test("--brief — a conjecture with no `because` prints no empty `because:` line", async () => {
  // The observation usually IS the surprise, so the field is optional — and an optional
  // field rendered as an empty label reads like the author had nothing to say rather
  // than nothing to add.
  const cfg = await root();
  habitat(cfg);
  const { text } = renderJournal(cfg);
  assert.ok(!/because: *$/m.test(text));
  assert.ok(!/over: \(nothing/.test(text), "and no `over:` at all — a conjecture has rejected nothing yet");
  await cleanup(cfg.root);
});

test("length — an over-long candidate warns like `over` does, and is written ANYWAY", async () => {
  const cfg = await root();
  const long = "c".repeat(LABEL_SOFT_MAX + 50);
  const { err } = await runCaptured(async () => {
    appendDecision(cfg, {
      kind: "conjecture", chose: "X", because: "", couldBe: [long],
      discriminatedBy: "-", session: newSessionId(), now: T(1),
    });
    return 0;
  });
  assert.match(err, /`could-be` is 250 chars/);
  assert.ok(!/discriminated/.test(err), "`discriminated by` is PROSE and must never warn — the test belongs at length");
  assert.ok(readJournal(cfg).records[0].couldBe!.includes(long), "written as given; the warning is advice, not a gate");
  await cleanup(cfg.root);
});

// ── 5. ids are pointers, and pointers do not move ────────────────────────────────

test("ids — widening the content hash left every pre-existing id EXACTLY where it was", async () => {
  // Not a value-pin on behaviour: this is the on-disk POINTER FORMAT. Every `supersedes`
  // in every committed .coherence/decisions/ names an id minted by the pre-conjecture
  // formula (five fields joined on a NUL). If the two new fields were fed in
  // unconditionally, empty, every id would shift by two separators and every retraction
  // ever written would point at nothing — silently. The literal below was minted before
  // conjectures existed; it is deliberately NOT recomputed from the current formula,
  // because a pin that restates the implementation cannot catch the implementation
  // changing.
  const cfg = await root();
  const d = appendDecision(cfg, {
    kind: "decision", agent: "A", chose: "X", over: ["Y"], because: "z",
    session: newSessionId(), now: T(1),
  });
  assert.equal(d.id, "d-de1bd779", "a plain decision's id must be byte-for-byte what it always was");

  // ...and the conjecture fields DO participate when they exist, so two conjectures that
  // differ only in their candidate list are two different questions.
  const one = appendDecision(cfg, {
    kind: "conjecture", chose: "X", because: "", couldBe: ["the harness lies"],
    discriminatedBy: "t", session: newSessionId(), now: T(2),
  });
  const two = appendDecision(cfg, {
    kind: "conjecture", chose: "X", because: "", couldBe: ["the harness lies", "or the world is odd"],
    discriminatedBy: "t", session: newSessionId(), now: T(3),
  });
  assert.notEqual(one.id, two.id);
  await cleanup(cfg.root);
});

test("ids — the field separator is a NUL and stays one", async () => {
  // It shipped as an invisible 0x00 byte in the source. It is now an explicit escape so
  // it can be seen, and this pin exists so it cannot be "tidied" into a space: doing so
  // re-mints every id in every journal on disk. Same input, both separators, one answer.
  const cfg = await root();
  const d = appendDecision(cfg, {
    kind: "decision", agent: "A", chose: "X", over: ["Y"], because: "z",
    session: newSessionId(), now: T(1),
  });
  const { createHash } = await import("node:crypto");
  const under = (sep: string) =>
    "d-" + createHash("sha256").update(["decision", "A", "X", "Y", "z"].join(sep)).digest("hex").slice(0, 8);
  // Written as fromCharCode rather than a literal 0x00 byte, for the same reason the
  // production constant is an escape: an invisible separator is one nobody can review.
  assert.equal(d.id, under(String.fromCharCode(0)),
    "NUL — the one byte a field cannot contain, so no `chose` can forge the boundary");
  assert.notEqual(d.id, under(" "),
    "and a space is a DIFFERENT id, which is exactly why this separator must not drift");
  await cleanup(cfg.root);
});

// ── 6. it gates nothing, like the rest of the journal ────────────────────────────

test("gates nothing — a conjecture is an append and the render survives a garbage one", async () => {
  const cfg = await root();
  const s = newSessionId();
  habitat(cfg, { session: s });
  const before = readJournal(cfg).records.length;
  // A conjecture with an empty discriminating test and no candidates is still written.
  const bare = appendDecision(cfg, {
    kind: "conjecture", chose: "something is off", because: "", session: s, now: T(4),
  });
  assert.equal(readJournal(cfg).records.length, before + 1, "nothing refuses the write");
  assert.deepEqual(bare.couldBe, [INSTRUMENT_CANDIDATE], "and it still leaves with the instrument on the list");
  assert.equal(renderJournal(cfg, { open: true }).text.includes("something is off"), true);
  await cleanup(cfg.root);
});
