// observed.ts — THE TRIGGER. What happens when a tracked number moves further than the
// project said was notable, and nobody has said why.
//
// THE SEAM, AND WHICH HALF LIVES WHERE. The band already exists, and it exists in the
// PROJECT, not here: planetizer's `tools/headless.ts` carries a table of tracked metrics
// — `{ label, now, before, prev, threshold, unit, why }` — and prints, every run, the
// rows whose move exceeds their own threshold, each with the reason it moved. That table
// is deliberately a REPORT THAT DEMANDS AN EXPLANATION, not a gate that demands
// IDENTITY, and it is not rebuilt here and not turned into a gate. It cannot be: the
// threshold on a gas row is a tenth of that channel's declared `notableDelta`, which is
// physics, and physics is knowledge this harness does not have and must not guess at.
//
// WHAT WAS MISSING WAS THE TRIGGER. A crossed threshold printed to a terminal and was
// gone. The `why` column is filled in AFTER a human has worked the move out; there was
// no state at all for the interval that matters — MOVED, UNEXPLAINED, NOT YET CHASED —
// and that interval is where the finding lives. `coherence observed` is one call from
// the harness that noticed, and it turns that interval into an open conjecture that
// survives the session.
//
//   the project owns  →  WHAT COUNTS AS NOTABLE (the label, the number, the threshold,
//                        and the explanation when it has one)
//   coherence owns    →  WHAT HAPPENS WHEN SOMETHING NOTABLE GOES UNEXPLAINED
//
// DEDUPE IS THE WHOLE DIFFICULTY, and the existing machinery cannot do it. A journal id
// hashes the record's CONTENT, and the content of an observation includes the number —
// so a metric that sits outside its band for ten runs mints ten ids and files ten open
// questions about one question. The identity of a question is not the identity of a
// measurement. The label is what stays still while the number moves, so the label is the
// key: AT MOST ONE OPEN CONJECTURE PER METRIC, ever, across sessions and agents.
//
// AND A RESOLVED ONE STAYS QUIET UNTIL THE VALUE MOVES AGAIN. A resolution answers the
// excursion it was written against, so a later reading that has travelled a further
// threshold-width past the value that was resolved is a DIFFERENT excursion and gets a
// new question. That is why `value` is stored on the record: after the answer, it is the
// only thing that can tell "still the thing we explained" from "it moved again".
//
// RETURNING TO THE BAND DOES NOT RESOLVE ANYTHING. See `returned-to-band` below; the
// reasoning is that a resolution's `because` is what the discriminating test SHOWED, and
// a number wandering back shows nothing about the cause.
//
// IT GATES NOTHING, like everything else in the journal. Every observation exits 0.
import { appendDecision, resolve, readJournal, type DecisionRecord } from "./decisions.ts";
import type { Config } from "./types.ts";

export interface Observation {
  /** The metric's label. THE DEDUPE KEY — the caller must spell it the same way twice. */
  metric: string;
  value: number;
  baseline: number;
  /** At or above this absolute move, the metric counts as MOVED. `>=`, matching the
   *  consuming table's own comparison — a threshold spelled one way in the project and
   *  another way here would make the two halves disagree at the edge, silently. */
  threshold: number;
  unit?: string;
  /** The project's explanation, when it has one. Its presence is the whole difference
   *  between "record the answer" and "open the question". */
  why?: string;
}

export type ObservedAction =
  /** Nothing comparable — a row with no baseline yet. Never an excursion. */
  | "no-baseline"
  /** Inside the band. Nothing is written, and nothing was open. */
  | "within-band"
  /** Inside the band, with a question still open about this metric. REPORTED, NOT CLOSED. */
  | "returned-to-band"
  /** Outside the band, unexplained, and nobody had asked yet. A conjecture is opened. */
  | "opened"
  /** Outside the band, and the same question is already open. This is the dedupe. */
  | "already-open"
  /** Explained on arrival: a conjecture and its resolution, written together. */
  | "explained"
  /** A `--why` arrived for a metric whose question was already open. The loop closes. */
  | "resolved"
  /** Outside the band, but a resolution already accounts for this excursion. */
  | "answered";

export interface ObservedVerdict {
  action: ObservedAction;
  obs: Observation;
  /** value − baseline. NaN when either end is not a number. */
  delta: number;
  /** The conjecture this observation opened, deduped against, or was answered by. */
  conjecture?: DecisionRecord;
  /** The resolution, when one was written or already existed. */
  resolution?: DecisionRecord;
}

/** Was this move big enough for the project to call it notable? `>=`, and a
 *  non-comparable end can never be an excursion — a metric with no baseline cannot
 *  have drifted from one. */
export function isOutsideBand(o: Observation): boolean {
  const d = o.value - o.baseline;
  return Number.isFinite(d) && Math.abs(d) >= o.threshold;
}

export function comparable(o: Observation): boolean {
  return Number.isFinite(o.value) && Number.isFinite(o.baseline) && Number.isFinite(o.threshold);
}

/** Six significant figures, trailing zeros dropped: enough to tell two runs of a
 *  deterministic harness apart, short enough to read inside a sentence. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(Number(n.toPrecision(6)));
}
const signed = (n: number): string => (Number.isFinite(n) && n >= 0 ? "+" : "") + fmt(n);

/** How far past the band, in band-widths — the number that says whether this is a
 *  knife-edge crossing or a rout. A zero band means every move is notable, which is a
 *  legal thing for a project to declare and not a division to perform. */
function bandWidths(delta: number, threshold: number): string {
  if (!(threshold > 0)) return "its band is 0, so any move at all is notable";
  return `${(Math.abs(delta) / threshold).toFixed(1)} band-widths`;
}

/** THE OBSERVATION, WORDED. This is the record's `chose`, so it must be TIMELESS: it
 *  states what was measured and nothing about whether anyone has explained it yet,
 *  because the same sentence has to still be true after somebody does. */
export function observationText(o: Observation): string {
  const u = o.unit ?? "";
  const d = o.value - o.baseline;
  return `${o.metric} moved ${signed(d)}${u} past its ${fmt(o.threshold)}${u} band`
    + ` — ${fmt(o.baseline)} → ${fmt(o.value)} (${bandWidths(d, o.threshold)})`;
}

/** Why this is worth a reader's attention, in the record's own voice. It quotes the
 *  project's threshold back at it on purpose: the bar was not invented here. */
function surpriseText(o: Observation): string {
  const u = o.unit ?? "";
  return `the project declares ${fmt(o.threshold)}${u} the smallest move in '${o.metric}'`
    + ` worth saying out loud; this is ${bandWidths(o.value - o.baseline, o.threshold)}.`
    + " The harness reported it with no explanation attached, which is the state this"
    + " entry exists to hold: moved, unexplained, not yet chased.";
}

/** Candidate explanations. Note what is NOT here: "the instrument is wrong". It is
 *  omitted deliberately — `withInstrumentCandidate` prepends the canonical wording at
 *  the write, so it arrives tagged `[instrument]` and FIRST, and a hand-written copy
 *  here would only be a second, worse spelling of the same idea. */
function candidates(o: Observation): string[] {
  return [
    `the model really moved — a change nobody wrote down, and this row is its shadow`,
    `the baseline is stale — ${fmt(o.baseline)} describes a tree this no longer is,`
      + ` and the move landed commits ago`,
  ];
}

/** The discriminating test. It has to be a thing a reader can actually go and do, or
 *  the entry is a complaint. This one separates all three candidates in one run. */
function discriminator(o: Observation): string {
  return `re-run the harness at the commit the baseline ${fmt(o.baseline)} was taken from.`
    + ` If it reproduces ${fmt(o.baseline)}, the model moved and the commits between there`
    + ` and here hold the cause — bisect on '${o.metric}'. If it reproduces ${fmt(o.value)}`
    + ` instead, nothing moved: the baseline was never this tree's, and what to fix is the`
    + ` record or the thing that produced it.`;
}

export interface Prior {
  /** The open question about this metric, if one is already standing. */
  open?: DecisionRecord;
  /** The most recent ANSWERED question about this metric. */
  resolved?: DecisionRecord;
}

/** What the journal already holds about one metric, keyed on the LABEL.
 *
 *  A RETRACTED conjecture counts as neither, and that is a decision rather than an
 *  oversight: a retraction claims the observation was never real. If the instrument
 *  keeps producing it, that claim is the thing that should be re-examined, so the
 *  question is allowed to be asked again. */
export function priorFor(records: DecisionRecord[], metric: string): Prior {
  const { open, resolved } = resolve(records);
  const mine = (r: DecisionRecord) => r.metric === metric;
  const latest = (rs: DecisionRecord[]) =>
    rs.filter(mine).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  return { open: latest(open), resolved: latest(resolved.map((r) => r.rec)) };
}

/** Does a reading that is outside its band represent a NEW excursion, given that one was
 *  already answered? Yes when it has travelled a further threshold-width past the value
 *  the answer was written against — the answer covered that number, not this one. */
function isFurtherThan(answered: DecisionRecord, o: Observation): boolean {
  // Unreachable in practice (a record carrying `metric` always carries `value`), and
  // it resolves toward SILENCE on purpose: without a number to compare, claiming this
  // is a new excursion would be exactly the spam this key exists to prevent.
  if (!Number.isFinite(answered.value)) return false;
  return Math.abs(o.value - (answered.value as number)) >= o.threshold;
}

export interface ObservedOpts { agent?: string; job?: string; session?: string; files?: string[]; now?: string }

/** THE ONE ENTRY POINT. Reads the journal, decides which of the seven things this
 *  observation is, and writes at most one conjecture and at most one resolution. */
export function recordObservation(cfg: Config, o: Observation, opts: ObservedOpts = {}): ObservedVerdict {
  const delta = o.value - o.baseline;
  const base = { obs: o, delta };
  if (!comparable(o)) return { action: "no-baseline", ...base };

  const prior = priorFor(readJournal(cfg).records, o.metric);
  const outside = isOutsideBand(o);
  const common = {
    agent: opts.agent, job: opts.job, session: opts.session, files: opts.files, now: opts.now,
  };

  // AN OPEN QUESTION IS ANSWERED BY AN EXPLANATION, NEVER BY A NUMBER. `--why` closes it
  // whichever side of the band the metric now sits on, because the explanation is the
  // evidence; and the absence of `--why` leaves it open for the same reason, even when
  // the metric has wandered back inside.
  if (prior.open) {
    if (o.why) {
      const by = appendDecision(cfg, {
        kind: "resolution", chose: `(resolved: ${prior.open.id})`, because: o.why,
        supersedes: prior.open.id, ...common,
      });
      return { action: "resolved", ...base, conjecture: prior.open, resolution: by };
    }
    return { action: outside ? "already-open" : "returned-to-band", ...base, conjecture: prior.open };
  }

  if (!outside) return { action: "within-band", ...base };
  if (prior.resolved && !isFurtherThan(prior.resolved, o)) {
    return { action: "answered", ...base, conjecture: prior.resolved };
  }

  const rec = appendDecision(cfg, {
    kind: "conjecture",
    chose: observationText(o),
    because: surpriseText(o),
    couldBe: candidates(o),
    discriminatedBy: discriminator(o),
    metric: o.metric, value: o.value, baseline: o.baseline, threshold: o.threshold, unit: o.unit,
    ...common,
  });
  if (!o.why) return { action: "opened", ...base, conjecture: rec };
  // BORN ANSWERED. The move is explained, so the journal should hold the explanation
  // rather than a question — but it is written as a conjecture plus its resolution, the
  // shape the journal already has for "a notable move, and what accounted for it". An
  // explained-on-arrival move and an explained-three-weeks-later one then render
  // identically, which is right: the reader cares what the answer is, not how long it took.
  const by = appendDecision(cfg, {
    kind: "resolution", chose: `(resolved: ${rec.id})`, because: o.why, supersedes: rec.id, ...common,
  });
  return { action: "explained", ...base, conjecture: rec, resolution: by };
}

/** What the caller sees. One or two lines — this runs once per tracked metric per run,
 *  so a paragraph per row would bury the report the project already prints. */
export function formatObserved(v: ObservedVerdict): string[] {
  const { obs: o, delta } = v;
  const u = o.unit ?? "";
  const moved = `${o.metric}  ${fmt(o.baseline)} → ${fmt(o.value)}  (${signed(delta)}${u}, band ${fmt(o.threshold)}${u})`;
  const settle = (id: string) =>
    `  settle it with:  coherence resolved ${id} --because "<what the test showed>" --as "<which candidate won>"`;
  switch (v.action) {
    case "no-baseline":
      return [`no baseline: ${o.metric} — nothing to compare, nothing recorded`];
    case "within-band":
      return [`within band: ${moved} — nothing recorded`];
    case "returned-to-band":
      // Reported, never resolved. This line IS evidence a human may resolve WITH; it is
      // not the resolution, and `observed` will not write one from a number alone.
      return [
        `within band: ${moved}`,
        `  STILL OPEN: ${v.conjecture!.id} asked why this metric moved, and nothing has answered it.`,
        "  Coming back inside the band is not an answer — it is one more thing to explain.",
        settle(v.conjecture!.id),
      ];
    case "already-open":
      return [
        `outside band: ${moved}`,
        `  already asked: ${v.conjecture!.id} (${v.conjecture!.at.slice(0, 10)}) — open, unanswered. Nothing recorded.`,
      ];
    case "answered":
      return [
        `outside band: ${moved}`,
        `  accounted for: ${v.conjecture!.id} was resolved at ${fmt(v.conjecture!.value as number)}${u}. Nothing recorded.`,
      ];
    case "opened":
      return [
        `outside band: ${moved} — UNEXPLAINED`,
        `${v.conjecture!.id}  conjecture opened`,
        ...(v.conjecture!.couldBe ?? []).map((c) => `  could be: ${c}`),
        settle(v.conjecture!.id),
      ];
    case "explained":
      return [
        `outside band: ${moved} — explained`,
        `${v.conjecture!.id}  recorded, answered by ${v.resolution!.id}: ${o.why}`,
      ];
    case "resolved":
      return [
        `${isOutsideBand(o) ? "outside" : "within"} band: ${moved}`,
        `${v.resolution!.id}  resolves ${v.conjecture!.id}: ${o.why}`,
      ];
  }
}
