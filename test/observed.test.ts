// observed.test.ts — THE TRIGGER: a tracked metric leaves its band, and the question
// that nobody has answered survives the session that noticed it.
//
// What these pin, in order of how badly it hurts when it breaks:
//   1. DEDUPE ON THE LABEL. This is the whole difference between a useful signal and a
//      spam generator. The value changes every run and the content-hash id changes with
//      it, so identity has to come from the label instead. If this is the thing that
//      quietly stops holding, the first agent to read `decisions --open` finds forty
//      copies of one question and learns to skip the section.
//   2. SILENCE INSIDE THE BAND. Thirty rows per run, most of them still. If a metric
//      that did not move writes anything at all, the journal becomes a metrics store,
//      and a journal that is a metrics store is a transcript again.
//   3. RETURNING TO THE BAND RESOLVES NOTHING. A number wandering back is not an
//      explanation. Auto-resolving would delete an entry from `--open` — the one list
//      this feature exists to populate — and delete it precisely when nobody looked.
//   4. `--why` IS WHAT CLOSES A QUESTION, whichever side of the band the metric is on,
//      because the explanation is the evidence and the number never was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJournal, resolve, renderJournal, newSessionId, appendDecision, readsAsInstrumentDoubt } from "../src/decisions.ts";
import {
  recordObservation, formatObserved, priorFor, isOutsideBand, observationText,
  type Observation,
} from "../src/observed.ts";
import { cleanup } from "./_helpers.ts";
import type { Config } from "../src/types.ts";

async function root(): Promise<Config> {
  const dir = await mkdtemp(join(tmpdir(), "coh-obs-"));
  return { root: dir } as Config;
}
const T = (n: number) => `2026-07-29T1${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}:00.000Z`;

/** A real row from planetizer's tracked table: CO2's low end, whose 0.010% threshold is
 *  a tenth of the co2 channel's declared `notableDelta`. The project owns that number. */
const CO2 = (over: Partial<Observation> = {}): Observation => ({
  metric: "CO2 range, low", value: 0.14, baseline: 0.14, threshold: 0.01, unit: "%", ...over,
});

const say = (cfg: Config, o: Observation, now?: string) =>
  recordObservation(cfg, o, { agent: "headless", session: "s-harness", now });

// ── 1. inside the band: nothing happens, and nothing is written ──────────────────

test("within band — a metric that did not move writes NOTHING", async () => {
  const cfg = await root();
  // 0.145 vs a 0.140 baseline is half a band. Thirty of these run every pass; if each
  // left a record the journal would be a metrics store inside a week.
  const v = say(cfg, CO2({ value: 0.145 }), T(1));
  assert.equal(v.action, "within-band");
  assert.equal(readJournal(cfg).records.length, 0, "not one line on disk");
  assert.match(formatObserved(v).join("\n"), /within band/);
  assert.equal(formatObserved(v).length, 1, "one line to the caller — the report is the project's, not ours");
  await cleanup(cfg.root);
});

test("within band — the edge belongs to MOVED, matching the table's own `>=`", async () => {
  // planetizer's row prints MOVED at `Math.abs(now - before) >= threshold`. A harness
  // that called a reading notable and a coherence that called it quiet would disagree
  // exactly at the edge, which is the one place a disagreement is invisible.
  const int = (value: number) => isOutsideBand({ metric: "deep sea cells", value, baseline: 3143, threshold: 10 });
  assert.equal(int(3153), true, "a move of exactly the threshold IS notable — `>=`, not `>`");
  assert.equal(int(3152), false);
  assert.equal(int(3133), true, "and it is symmetric: down counts too");

  // AND THE EDGE IS FLOAT-DEPENDENT, which is a fact rather than a bug. `0.15 - 0.14` is
  // 0.00999999999999998, so a decimal move that looks like exactly one band is under it.
  // This is asserted rather than avoided because the two halves must be wrong the SAME
  // way: the comparison here is byte-for-byte the one the project's table prints MOVED
  // from, so whatever a float does at the boundary, both halves do it together.
  assert.equal(isOutsideBand(CO2({ value: 0.15 })), false, "0.15 − 0.14 is 0.00999999999999998");
  assert.equal(0.15 - 0.14 >= 0.01, false, "...and the project's own row agrees, for the same reason");
});

test("no baseline — a row with no history cannot have drifted from one", async () => {
  const cfg = await root();
  // planetizer prints `n/a` for these (`before: NaN`) and can never mark them MOVED.
  const v = say(cfg, CO2({ value: 12.3, baseline: NaN }), T(1));
  assert.equal(v.action, "no-baseline");
  assert.equal(readJournal(cfg).records.length, 0);
  assert.match(formatObserved(v)[0], /no baseline/, "and it SAYS so — a silent skip is indistinguishable from a bug");
  await cleanup(cfg.root);
});

// ── 2. outside the band, unexplained: the harness hands coherence a question ─────

test("opened — an unexplained excursion opens exactly ONE conjecture, worded from the row", async () => {
  const cfg = await root();
  const v = say(cfg, CO2({ value: 0.18 }), T(1));
  assert.equal(v.action, "opened");

  const { open, standing, resolved } = resolve(readJournal(cfg).records);
  assert.equal(open.length, 1, "one open question");
  assert.deepEqual([standing.length, resolved.length], [0, 0],
    "and it is a QUESTION — an unexplained move is not a settled position");

  const q = open[0];
  assert.equal(q.metric, "CO2 range, low", "the label is stored, because the label is the dedupe key");
  assert.equal(q.value, 0.18, "and the value, because after an answer it is the only thing that can say 'it moved again'");
  assert.match(q.chose, /CO2 range, low moved \+0\.04% past its 0\.01% band/);
  assert.match(q.chose, /0\.14 → 0\.18 \(4\.0 band-widths\)/, "how far past the bar, in the project's own units");
  assert.ok(!/unexplained|nobody/i.test(q.chose),
    "the OBSERVATION is timeless — it must still read true after somebody explains it");
  assert.match(q.because ?? "", /moved, unexplained, not yet chased/);
  assert.match(q.discriminatedBy ?? "", /re-run the harness at the commit the baseline 0\.14 was taken from/);
  await cleanup(cfg.root);
});

test("opened — `[instrument]` is the FIRST candidate, and nothing here hand-rolls it", async () => {
  // Six for six of the findings that motivated the conjecture record were instrument
  // failures. `observed` gets the guarantee from the write path rather than restating it,
  // so a candidate list from the harness cannot be the one that ships without it.
  const cfg = await root();
  const v = say(cfg, CO2({ value: 0.18 }), T(1));
  const could = v.conjecture!.couldBe!;
  assert.ok(readsAsInstrumentDoubt(could[0]), "first, because the eye averages over the middle of a list");
  assert.equal(could.length, 3, "plus the two this observation can actually name");
  assert.ok(could.some((c) => /the model really moved/.test(c)));
  assert.ok(could.some((c) => /the baseline is stale/.test(c)));
  assert.match(renderJournal(cfg, { open: true }).text, /could be: \[instrument\]/);
  await cleanup(cfg.root);
});

test("opened — a zero band is a legal declaration, not a division by zero", async () => {
  const cfg = await root();
  // planetizer has rows like `sliders diverged` where the bar is 'any change at all'.
  const v = say(cfg, { metric: "sliders diverged", value: 1, baseline: 0, threshold: 0, unit: "" }, T(1));
  assert.equal(v.action, "opened");
  assert.match(v.conjecture!.chose, /its band is 0, so any move at all is notable/);
  assert.ok(!/Infinity|NaN/.test(v.conjecture!.chose));
  await cleanup(cfg.root);
});

// ── 3. THE DEDUPE. Ten runs, ten different numbers, ONE question ─────────────────

test("dedupe — ten runs of a metric that stays out of its band produce ONE open conjecture", async () => {
  const cfg = await root();
  // Every run reports a different number, which is the case the existing content-hash id
  // cannot handle: the value is inside the observation text, so ten values are ten ids.
  const values = [0.18, 0.181, 0.19, 0.2, 0.175, 0.183, 0.21, 0.178, 0.195, 0.188];
  const seen = values.map((value, i) => say(cfg, CO2({ value }), T(i + 1)));

  assert.equal(seen[0].action, "opened");
  assert.ok(seen.slice(1).every((v) => v.action === "already-open"), "runs 2..10 ask nothing new");
  const { open } = resolve(readJournal(cfg).records);
  assert.equal(open.length, 1, "ONE question, not ten — this is the difference between a signal and a spam generator");
  assert.equal(readJournal(cfg).records.length, 1, "and nine of the ten runs wrote nothing at all");
  assert.equal(open[0].value, 0.18, "the question is pinned to the reading that RAISED it");

  const said = formatObserved(seen[3]).join("\n");
  assert.match(said, /already asked: d-[0-9a-f]{8}/, "a deduped run still points the caller at the open id");
  await cleanup(cfg.root);
});

test("dedupe — the key is the LABEL, so a second metric is a second question", async () => {
  const cfg = await root();
  say(cfg, CO2({ value: 0.18 }), T(1));
  say(cfg, { metric: "methane, final", value: 228.4, baseline: 137.5, threshold: 4, unit: " ppm" }, T(2));
  const { open } = resolve(readJournal(cfg).records);
  assert.equal(open.length, 2);
  assert.deepEqual(open.map((r) => r.metric), ["CO2 range, low", "methane, final"]);
  await cleanup(cfg.root);
});

test("dedupe — it holds ACROSS sessions and agents, because the journal is one timeline", async () => {
  // Two harness runs from different agents are the ordinary case, not the exotic one.
  const cfg = await root();
  recordObservation(cfg, CO2({ value: 0.18 }), { agent: "headless", session: newSessionId(), now: T(1) });
  const second = recordObservation(cfg, CO2({ value: 0.22 }), { agent: "ci", session: newSessionId(), now: T(2) });
  assert.equal(second.action, "already-open");
  assert.equal(resolve(readJournal(cfg).records).open.length, 1);
  await cleanup(cfg.root);
});

test("dedupe — a RETRACTED question is allowed to be asked again", async () => {
  // A retraction claims the observation was never real. If the instrument keeps producing
  // it, that claim is what deserves re-examination — so this is a decision, not a leak.
  const cfg = await root();
  const first = say(cfg, CO2({ value: 0.18 }), T(1));
  appendDecision(cfg, {
    kind: "retraction", chose: "(withdrawn)", supersedes: first.conjecture!.id,
    because: "that run was against a planet with no continents — there was no observation",
    session: "s-harness", now: T(2),
  });
  const again = say(cfg, CO2({ value: 0.18 }), T(3));
  assert.equal(again.action, "opened");
  await cleanup(cfg.root);
});

// ── 4. --why: the explanation is what closes a question ──────────────────────────

test("--why — an explained move records the explanation and opens NO question", async () => {
  const cfg = await root();
  const v = say(cfg, CO2({ value: 0.18, why: "the greenhouse term now reads ch4 at 0.30 weight" }), T(1));
  assert.equal(v.action, "explained");

  const { open, resolved } = resolve(readJournal(cfg).records);
  assert.equal(open.length, 0, "nothing is open — the move came with its reason");
  assert.equal(resolved.length, 1, "and the reason is IN THE JOURNAL, not only in a source file");
  assert.match(resolved[0].by.because, /greenhouse term now reads ch4/);

  const text = renderJournal(cfg).text;
  assert.match(text, /0 open conjectures/);
  assert.match(text, /RESOLVED by headless/);
  assert.ok(!/won: /.test(text), "no candidate 'won' — nobody ran a test, they wrote down what they knew");
  await cleanup(cfg.root);
});

test("--why — repeating an explained excursion writes nothing more", async () => {
  const cfg = await root();
  const why = "the greenhouse term now reads ch4";
  say(cfg, CO2({ value: 0.18, why }), T(1));
  const before = readJournal(cfg).records.length;
  for (let i = 2; i < 8; i++) say(cfg, CO2({ value: 0.18 + i / 10000, why }), T(i));
  assert.equal(readJournal(cfg).records.length, before, "an answered label is quiet, however many runs re-report it");
  assert.equal(resolve(readJournal(cfg).records).resolved.length, 1);
  await cleanup(cfg.root);
});

test("--why — arriving for a question already open CLOSES it: the loop completes", async () => {
  // This is the intended arc. Coherence asks; the project works it out and fills in the
  // `why` its own table already has a column for; the next harness run carries the answer
  // back. Nobody has to copy an id.
  const cfg = await root();
  const opened = say(cfg, CO2({ value: 0.18 }), T(1));
  assert.equal(opened.action, "opened");

  const closed = say(cfg, CO2({ value: 0.182, why: "flux ledger reordered co2 before dust" }), T(2));
  assert.equal(closed.action, "resolved");
  assert.equal(closed.resolution!.supersedes, opened.conjecture!.id, "it points at the question that was open");

  const { open, resolved } = resolve(readJournal(cfg).records);
  assert.deepEqual([open.length, resolved.length], [0, 1]);
  assert.match(resolved[0].by.because, /flux ledger reordered/);
  assert.equal(readJournal(cfg).records.length, 2, "a conjecture and its resolution — no third record");
  await cleanup(cfg.root);
});

test("--why — it closes an open question even when the metric came back INSIDE the band", async () => {
  // The resolution comes from the EXPLANATION, never from the number. That is the same
  // rule that makes a bare return-to-band resolve nothing, read from the other side.
  const cfg = await root();
  say(cfg, CO2({ value: 0.18 }), T(1));
  const v = say(cfg, CO2({ value: 0.141, why: "the sweep that moved it was reverted in 4f2a1c9" }), T(2));
  assert.equal(v.action, "resolved");
  assert.equal(resolve(readJournal(cfg).records).open.length, 0);
  assert.match(formatObserved(v)[0], /within band/, "and the caller is told which side of the band it settled on");
  await cleanup(cfg.root);
});

// ── 5. return to band: reported, NEVER resolved ──────────────────────────────────

test("returned to band — an open question is NOT auto-resolved by the number coming back", async () => {
  // A resolution's `because` is what the discriminating test SHOWED. A number wandering
  // back shows nothing about the cause, so auto-resolving would write a false claim into
  // the one field that carries evidence — and would delete the entry from `--open`
  // precisely in the case where nobody looked at it.
  const cfg = await root();
  const opened = say(cfg, CO2({ value: 0.18 }), T(1));
  const back = say(cfg, CO2({ value: 0.142 }), T(2));

  assert.equal(back.action, "returned-to-band");
  assert.equal(readJournal(cfg).records.length, 1, "nothing was written — a return is not evidence");
  const { open, resolved } = resolve(readJournal(cfg).records);
  assert.equal(open.length, 1, "THE QUESTION IS STILL OPEN");
  assert.equal(resolved.length, 0);
  assert.equal(open[0].id, opened.conjecture!.id);

  // Silence would be the other failure, so the return is SAID — as evidence a human may
  // resolve with, and with the line that would do it.
  const said = formatObserved(back).join("\n");
  assert.match(said, /STILL OPEN: d-[0-9a-f]{8}/);
  assert.match(said, /Coming back inside the band is not an answer/);
  assert.match(said, new RegExp(`coherence resolved ${opened.conjecture!.id} --because`));
  await cleanup(cfg.root);
});

test("returned to band — and it stays open across every later run, in or out of band", async () => {
  const cfg = await root();
  say(cfg, CO2({ value: 0.18 }), T(1));
  for (const [i, value] of [0.142, 0.19, 0.14, 0.2, 0.145].entries()) say(cfg, CO2({ value }), T(i + 2));
  assert.equal(resolve(readJournal(cfg).records).open.length, 1, "one question, still unanswered");
  assert.equal(readJournal(cfg).records.length, 1);
  await cleanup(cfg.root);
});

// ── 6. after an answer: quiet until it moves AGAIN ───────────────────────────────

test("answered — a resolved label stays quiet while the metric sits where the answer left it", async () => {
  const cfg = await root();
  say(cfg, CO2({ value: 0.18, why: "ch4 weight" }), T(1));
  const same = say(cfg, CO2({ value: 0.185 }), T(2));
  assert.equal(same.action, "answered", "0.005 from the answered reading is inside one band — same excursion");
  assert.equal(readJournal(cfg).records.length, 2);
  assert.match(formatObserved(same).join("\n"), /accounted for: d-[0-9a-f]{8} was resolved at 0\.18%/);
  await cleanup(cfg.root);
});

test("answered — but a FURTHER excursion is a different question, and gets asked", async () => {
  // The answer covered the move to 0.18. A reading a further band-width past that is not
  // the thing anybody explained, and the alternative — quiet forever once a label has been
  // answered once — trades the spam generator for a silence generator.
  const cfg = await root();
  say(cfg, CO2({ value: 0.18, why: "ch4 weight" }), T(1));
  const further = say(cfg, CO2({ value: 0.195 }), T(2));
  assert.equal(further.action, "opened");
  const { open, resolved } = resolve(readJournal(cfg).records);
  assert.deepEqual([open.length, resolved.length], [1, 1], "the old answer stands; the new question is separate");
  assert.equal(open[0].value, 0.195);
  await cleanup(cfg.root);
});

// ── 7. the read side, and the seam ───────────────────────────────────────────────

test("priorFor — the label is what is looked up, and a hand-written conjecture is not it", async () => {
  const cfg = await root();
  appendDecision(cfg, {
    kind: "conjecture", chose: "CO2 range, low looks wrong to me", because: "",
    discriminatedBy: "-", session: "s-human", now: T(1),
  });
  const p = priorFor(readJournal(cfg).records, "CO2 range, low");
  assert.equal(p.open, undefined, "no `metric` field, so it is not a tracked-metric question");
  // ...and the harness therefore still asks its own, which is right: a human musing and a
  // threshold crossing are different records with different evidence.
  assert.equal(say(cfg, CO2({ value: 0.18 }), T(2)).action, "opened");
  await cleanup(cfg.root);
});

test("open questions from the harness render in the same lens as everyone else's", async () => {
  const cfg = await root();
  say(cfg, CO2({ value: 0.18 }), T(1));
  const lens = renderJournal(cfg, { open: true }).text;
  assert.match(lens, /1 OPEN CONJECTURE\(S\)/, "shouted in the summary, like any other open question");
  assert.match(lens, /Open questions — NOTICED, NOT YET CHASED/);
  assert.match(lens, /CO2 range, low moved \+0\.04%/);
  assert.match(lens, /discriminated by: re-run the harness/);
  await cleanup(cfg.root);
});

test("observationText — every field the caller passed is in the sentence that is hashed", async () => {
  // The metric fields are deliberately NOT fed into the id digest: they are a projection
  // of this sentence, so they are already inside the hash by way of it. If a field ever
  // stops appearing here, that reasoning silently stops being true.
  const t = observationText(CO2({ value: 0.18 }));
  for (const piece of ["CO2 range, low", "0.14", "0.18", "0.01", "%"]) {
    assert.ok(t.includes(piece), `'${piece}' must be in the observation text`);
  }
});

// ── 8. it gates nothing ──────────────────────────────────────────────────────────

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
function cli(cwd: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [CLI, "observed", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

test("gates nothing — every observation exits 0, whichever side of the band it is on", async () => {
  const cfg = await root();
  const flags = (v: number) => ["CO2 range, low", "--value", String(v), "--baseline", "0.140", "--threshold", "0.010", "--unit", "%"];
  const outside = cli(cfg.root, flags(0.18));
  assert.equal(outside.code, 0, "a metric outside its band must never fail a build");
  assert.match(outside.out, /UNEXPLAINED/);
  assert.equal(cli(cfg.root, flags(0.181)).code, 0, "nor the ninth run of the same excursion");
  assert.equal(cli(cfg.root, flags(0.141)).code, 0);
  assert.equal(resolve(readJournal(cfg).records).open.length, 1, "and the three runs left ONE question");
  await cleanup(cfg.root);
});

test("gates nothing — but a MALFORMED invocation is not an observation, and says so", async () => {
  // Exiting 0 here would be a command that runs and does nothing, which is the defect
  // this harness exists to hunt: a typo'd flag would silently stop asking questions.
  const cfg = await root();
  const bad = cli(cfg.root, ["CO2 range, low", "--value", "banana", "--baseline", "0.140", "--threshold", "0.010"]);
  assert.equal(bad.code, 2);
  assert.match(bad.out, /usage: coherence observed/);
  const missing = cli(cfg.root, ["CO2 range, low", "--value", "0.18"]);
  assert.equal(missing.code, 2, "a missing threshold is a missing BAR — there is no default for domain knowledge");
  assert.equal(readJournal(cfg).records.length, 0, "and neither wrote anything");
  await cleanup(cfg.root);
});
