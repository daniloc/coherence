// raise.test.ts — AN ADVISORY OPENS A QUESTION INSTEAD OF PRINTING ONE.
//
// What these pin, in order of how badly it hurts when it breaks:
//   1. IDENTITY IS DERIVED, AND IT HOLDS STILL. `observed` deduped on a label the caller
//      supplied; an advisory has nobody to ask. If the derived key picks up anything that
//      moves — a score, a run count, a line number — every run opens a new question and
//      `--open` is unreadable inside a week. This is the whole feature and it is the first
//      four tests.
//   2. ...AND IT IS NOT TOO COARSE. The opposite failure is silent and therefore worse:
//      two genuinely different findings collapsing means the second one is never asked,
//      and nothing anywhere says so.
//   3. VOLUME. A large repo's first run must not open two hundred questions. Three layers
//      — opt-in, the advisory's own floor, a per-run cap — and the cap must SAY what it
//      withheld, because a truncated list that looks complete is the defect this harness
//      exists to hunt.
//   4. DISMISSAL IS PERMANENT AND IS NOT AN ANSWER. If a dismissed finding can be
//      re-raised, the only defence against a noisy question does not work and the feature
//      gets switched off. If a dismissal RENDERS as a resolution, the journal tells a
//      reader an unanswered question has been answered — which is the one lie it cannot
//      afford.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendDecision, readJournal, resolve, renderJournal, newSessionId, resolvableConjecture,
  readsAsInstrumentDoubt,
} from "../src/decisions.ts";
import {
  raiseFindings, formatRaise, findingKey, priorsByFinding, interleaveByAdvisory,
  RAISE_CAP, type Finding,
} from "../src/raise.ts";
import {
  pairFindings, pairSubject, siteSubject, stableSiteName, shownPairs, pairSites,
  sitesOfSource, redundancy, REDUNDANCY_DEFAULTS, type DomainSite, type RedundancyPair,
} from "../src/redundancy.ts";
import { neverRedFinding, refutationFinding, warnedKindFinding, runVerify } from "../src/verify.ts";
import { cleanup, tmpProject, runCaptured, cfg, comp, graph } from "./_helpers.ts";
import type { Config } from "../src/types.ts";

async function root(): Promise<Config> {
  const dir = await mkdtemp(join(tmpdir(), "coh-raise-"));
  return { root: dir } as Config;
}
const T = (n: number) => `2026-07-29T1${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}:00.000Z`;

const site = (o: Partial<DomainSite> = {}): DomainSite => ({
  name: "NOISE_DIRS", kind: "list", file: "src/oracle-domain.ts", line: 61,
  keys: [".git", "dist", "node_modules"], typeLink: null, ...o,
});

/** A pair built by hand so the volatile fields can be moved one at a time. */
const pair = (a: DomainSite, b: DomainSite, o: Partial<RedundancyPair> = {}): RedundancyPair => ({
  a, b, shared: [".git", "dist", "node_modules"], onlyA: [], onlyB: [], exclusive: 3, score: 9.8, ...o,
});

const raise = (cfg: Config, fs: Finding[], o: Record<string, unknown> = {}) =>
  raiseFindings(cfg, readJournal(cfg).records, fs, { enabled: true, session: "s-adv", agent: "advisory", ...o });

// ── 1. THE KEY HOLDS STILL WHILE THE REPORT MOVES ────────────────────────────────

test("identity — a pair keeps ONE question after its score, rank and line all move", async () => {
  // The negative control this exists for: `df` is computed over the WHOLE TREE, so adding
  // one unrelated file re-ranks every pair in the repo. A key holding the score would open
  // a fresh question on an edit that touched neither site. Reproduced here by moving every
  // volatile field at once and leaving both sites where they are.
  const cfg = await root();
  const before = pair(site(), site({ name: "ALWAYS_IGNORE", file: "src/sidecar.ts", line: 17 }));
  const first = raise(cfg, pairFindings([before]), { now: T(1) });
  assert.equal(first.opened.length, 1);

  const after = pair(
    site({ line: 61 }),
    site({ name: "ALWAYS_IGNORE", file: "src/sidecar.ts", line: 22 }), // five lines inserted above it
    { score: 5.25, exclusive: 2 },                                     // and the score fell by 46%
  );
  const second = raise(cfg, pairFindings([after]), { now: T(2) });
  assert.equal(second.opened.length, 0, "nothing new was written");
  assert.equal(second.alreadyOpen.length, 1, "it is the SAME question");
  assert.equal(second.alreadyOpen[0].rec.id, first.opened[0].rec.id);
  assert.equal(resolve(readJournal(cfg).records).open.length, 1, "ONE open question, not two");
  await cleanup(cfg.root);
});

test("identity — the key contains no score, no line, and no token count", async () => {
  // Asserted on the STRING rather than on behaviour: a key that happens to dedupe today
  // because two runs produced the same score is not the same thing as a key that cannot
  // contain one. This is the property, stated directly.
  const k = pairSubject(pair(site(), site({ name: "ALWAYS_IGNORE", file: "src/sidecar.ts", line: 17 })));
  assert.equal(k, "src/oracle-domain.ts#list:NOISE_DIRS|src/sidecar.ts#list:ALWAYS_IGNORE");
  for (const volatile of ["9.8", "61", "17", "@", "3"]) {
    assert.ok(!k.includes(volatile), `'${volatile}' must not be in a finding key`);
  }
  // ...and it is order-free: the same two sites are one question whichever way round the
  // detector happened to emit them.
  const flipped = pairSubject(pair(site({ name: "ALWAYS_IGNORE", file: "src/sidecar.ts" }), site()));
  assert.equal(flipped, k, "A|B and B|A are the same pair");
});

test("identity — a POSITIONAL site name is re-keyed on its tokens, not stripped", async () => {
  // The trap the first draft walked into: an alternation site is named `alternation@<line>`,
  // so the line is INSIDE the name and dropping the `@line` suffix from the id is not
  // enough. Stripping the suffix outright is the coarse failure — every alternation in a
  // file fuses into one key and the second finding is swallowed.
  const one = site({ name: "alternation@506", kind: "alternation", file: "src/cli.ts", keys: ["a", "b", "c"] });
  const moved = { ...one, name: "alternation@530", line: 530 };
  const other = site({ name: "alternation@88", kind: "alternation", file: "src/cli.ts", keys: ["x", "y", "z"] });

  assert.equal(siteSubject(one), siteSubject(moved), "moving it does not re-key it");
  assert.notEqual(siteSubject(one), siteSubject(other), "and two alternations in ONE file stay distinct");
  assert.ok(!/@\d/.test(stableSiteName(one)), "no line survives in the name");
  // A changed token set IS a different enumeration, so re-keying on it is honest.
  assert.notEqual(siteSubject(one), siteSubject({ ...one, keys: ["a", "b", "d"] }));
});

test("identity — a claim's run count is in the SENTENCE and never in the key", async () => {
  // The most tempting field to include, because it is what makes the finding feel urgent.
  const a = neverRedFinding("sim", 'boundary "one write site per shared scalar"', 3);
  const b = neverRedFinding("sim", 'boundary "one write site per shared scalar"', 41);
  assert.equal(a.subject, b.subject, "38 more green runs is not a new question");
  assert.match(a.observation, /green on all 3 run\(s\)/);
  assert.match(b.observation, /green on all 41 run\(s\)/, "...but the count is still SAID");

  const cfg = await root();
  raise(cfg, [a], { now: T(1) });
  assert.equal(raise(cfg, [b], { now: T(2) }).opened.length, 0);
  assert.equal(resolve(readJournal(cfg).records).open.length, 1);
  await cleanup(cfg.root);
});

// ── 2. ...AND IT IS NOT TOO COARSE ───────────────────────────────────────────────

test("identity — two different findings are two questions, and neither is swallowed", async () => {
  const cfg = await root();
  const findings = [
    ...pairFindings([pair(site(), site({ name: "ALWAYS_IGNORE", file: "src/sidecar.ts" }))]),
    neverRedFinding("sim", 'boundary "one write site per shared scalar"', 12),
    neverRedFinding("sim", 'boundary "systems cannot write shared globals"', 12),
    warnedKindFinding("sim", 'boundary "one write site per shared scalar"', "measured", "doctrine 2a"),
    refutationFinding("game", "every player action opens a counterfactual"),
  ];
  const r = raise(cfg, findings, { cap: 99, now: T(1) });
  assert.equal(r.opened.length, 5, "five distinct subjects, five questions");
  assert.equal(new Set(r.opened.map((o) => findingKey(o.finding))).size, 5, "and five distinct keys");

  // The two that share a NODE differ only by claim text; the two that share CLAIM TEXT
  // differ only by advisory. Both collapses are the silent failure, so both are named.
  assert.notEqual(findings[1].subject, findings[2].subject, "same node, different claim");
  assert.notEqual(findingKey(findings[1]), findingKey(findings[3]),
    "same node AND same claim, different advisory — the namespace is what separates them");
  await cleanup(cfg.root);
});

test("identity — the key is inside the content hash, so two findings cannot share an id", async () => {
  // The keys are derived to hold still while the wording moves, so two different findings
  // could in principle render the same sentence. Hashing the key makes that impossible by
  // construction rather than by inspection.
  const cfg = await root();
  const same = (subject: string): Finding => ({
    advisory: "x", subject, observation: "identical text", discriminatedBy: "t",
  });
  const r = raise(cfg, [same("one"), same("two")], { cap: 99, now: T(1) });
  assert.equal(r.opened.length, 2);
  assert.notEqual(r.opened[0].rec.id, r.opened[1].rec.id, "same sentence, different subject, different id");
  await cleanup(cfg.root);
});

// ── 3. VOLUME — the single most likely way this dies ─────────────────────────────

test("volume — raising is OPT-IN: without it nothing is written, and it says what it would do", async () => {
  const cfg = await root();
  const findings = Array.from({ length: 40 }, (_, i) => neverRedFinding("sim", `claim ${i}`, 9));
  const r = raiseFindings(cfg, readJournal(cfg).records, findings, { session: "s-adv", now: T(1) });
  assert.equal(r.enabled, false);
  assert.equal(r.opened.length, 0);
  assert.equal(readJournal(cfg).records.length, 0, "an advisory must not mutate the journal as a side effect of reporting");
  assert.equal(r.fresh.length, 40, "...but it knows exactly what it is holding back");

  const said = formatRaise(r).join("\n");
  assert.match(said, /40 of these 40 finding\(s\) have never been asked about/);
  assert.match(said, /`--raise` opens up to 3/, "and names the flag AND the cap — a verb nobody is told about is a verb nobody uses");
  await cleanup(cfg.root);
});

test("volume — the cap bounds a first run, and the remainder is ANNOUNCED, never dropped", async () => {
  const cfg = await root();
  const findings = Array.from({ length: 200 }, (_, i) => neverRedFinding("sim", `claim ${i}`, 9));
  const r = raise(cfg, findings, { now: T(1) });
  assert.equal(r.opened.length, RAISE_CAP, "two hundred findings, three questions");
  assert.equal(r.withheld.length, 197);
  assert.equal(readJournal(cfg).records.length, RAISE_CAP, "and only three lines on disk");

  const said = formatRaise(r).join("\n");
  assert.match(said, /WITHHELD 197 more — the cap is 3 per run \(never-red 197\)/);
  assert.match(said, /not lost and they are not recorded/, "the reader is told which of the two it is");
  await cleanup(cfg.root);
});

test("volume — the cap is spent ROUND-ROBIN, so no advisory is starved by a louder one", async () => {
  // Dogfooding refuted the strict-priority design on the first run: planetizer offered 14
  // never-red findings and 3 warned-kind, and every warned-kind question queued behind
  // twelve others — on the one repo whose config declares that kind the suspect one.
  const cfg = await root();
  const findings = [
    ...Array.from({ length: 14 }, (_, i) => neverRedFinding("sim", `claim ${i}`, 9)),
    ...Array.from({ length: 3 }, (_, i) => warnedKindFinding("sim", `measured ${i}`, "measured")),
  ];
  const r = raise(cfg, findings, { now: T(1) });
  const advisories = r.opened.map((o) => o.finding.advisory);
  assert.ok(advisories.includes("warned-kind"), "the quieter detector speaks on the FIRST run, not the fifth");
  assert.ok(advisories.includes("never-red"));

  // ...and within a lane the caller's own ranking is preserved.
  const lanes = interleaveByAdvisory(findings);
  assert.deepEqual(
    lanes.filter((f) => f.advisory === "never-red").slice(0, 3).map((f) => f.subject),
    findings.filter((f) => f.advisory === "never-red").slice(0, 3).map((f) => f.subject),
  );
  assert.equal(lanes.length, findings.length, "interleaving loses nothing");
  await cleanup(cfg.root);
});

test("volume — only what the advisory SHOWS may raise: `--all`'s tail must not become questions", async () => {
  // `--all` drops redundancy's score floor to zero so the precision of the tail can be
  // judged rather than trusted. A flag whose job is to show more must not also mean write
  // more, or the one command a curious person runs first is the one that fills the journal.
  const strong = pair(site(), site({ name: "ALWAYS_IGNORE", file: "src/sidecar.ts" }), { score: 9.8 });
  const weak = pair(
    site({ name: "A", file: "a.ts" }), site({ name: "B", file: "b.ts" }), { score: 0.4 },
  );
  const floored = shownPairs([strong, weak], REDUNDANCY_DEFAULTS);
  assert.deepEqual(floored.map((p) => p.score), [9.8], "the weak pair is below the default floor");
  assert.equal(shownPairs([strong, weak], { minScore: 0 }).length, 2, "...and `--all` shows it anyway");
});

test("volume — an explicit --raise that raised nothing SAYS so", async () => {
  // Silence there is ambiguous between "nothing was above the floor" and "the flag did not
  // take", which is exactly the ambiguity `decisions --open` refuses.
  const cfg = await root();
  const said = formatRaise(raise(cfg, [], { now: T(1) })).join("\n");
  assert.match(said, /nothing to raise/);
  // ...but with raising OFF and nothing to say, it says nothing: a permanent line is
  // furniture, and furniture is what the eye learns to skip.
  assert.deepEqual(formatRaise(raiseFindings(cfg, [], [], {})), []);
  await cleanup(cfg.root);
});

// ── 4. DISMISSAL ─────────────────────────────────────────────────────────────────

test("dismissal — a dismissed finding is NEVER raised again", async () => {
  const cfg = await root();
  const f = pairFindings([pair(site(), site({ name: "ALWAYS_IGNORE", file: "src/sidecar.ts" }))]);
  const opened = raise(cfg, f, { now: T(1) }).opened[0].rec;

  appendDecision(cfg, {
    kind: "dismissal", chose: `(dismissed: ${opened.id})`, supersedes: opened.id,
    because: "three keys and a doc table; a parity claim would cost more than the drift",
    session: "s-human", now: T(2),
  });

  // Ten more runs, each with a different score — the case that made dedupe necessary at all.
  for (let i = 3; i < 13; i++) {
    const r = raise(cfg, pairFindings([pair(site(), site({ name: "ALWAYS_IGNORE", file: "src/sidecar.ts" }), { score: i })]), { now: T(i) });
    assert.equal(r.opened.length, 0);
    assert.equal(r.settled[0]?.how, "dismissed", "and the report says WHY it is quiet");
  }
  assert.equal(readJournal(cfg).records.length, 2, "the conjecture and its dismissal — nothing else");
  assert.equal(resolve(readJournal(cfg).records).open.length, 0);
  await cleanup(cfg.root);
});

test("dismissal — it is a SEPARATE bucket from resolved, at the model level", async () => {
  const cfg = await root();
  const mk = (subject: string, now: string) =>
    raise(cfg, [{ advisory: "x", subject, observation: `o ${subject}`, discriminatedBy: "t" }], { now }).opened[0].rec;
  const answered = mk("one", T(1));
  const retired = mk("two", T(2));
  appendDecision(cfg, { kind: "resolution", chose: "the oracle was vacuous", supersedes: answered.id, because: "broke it; still green", session: "s", now: T(3) });
  appendDecision(cfg, { kind: "dismissal", chose: "(dismissed)", supersedes: retired.id, because: "not worth the pass", session: "s", now: T(4) });

  const { open, resolved, dismissed } = resolve(readJournal(cfg).records);
  assert.deepEqual([open.length, resolved.length, dismissed.length], [0, 1, 1]);
  assert.equal(resolved[0].rec.id, answered.id);
  assert.equal(dismissed[0].rec.id, retired.id);

  // Both are quiet to a re-raise, and the report can still tell them apart.
  const again = raise(cfg, [
    { advisory: "x", subject: "one", observation: "o one", discriminatedBy: "t" },
    { advisory: "x", subject: "two", observation: "o two", discriminatedBy: "t" },
  ], { now: T(5) });
  assert.equal(again.opened.length, 0);
  assert.deepEqual(again.settled.map((s) => s.how).sort(), ["dismissed", "resolved"]);
  await cleanup(cfg.root);
});

test("dismissal — the RENDER must never read as an answer", async () => {
  // The one lie the journal cannot afford. A reader scanning section titles never reaches
  // the body, so the heading has to carry it on its own.
  const cfg = await root();
  const rec = raise(cfg, [{ advisory: "x", subject: "s", observation: "the two spellings disagree", discriminatedBy: "t" }], { now: T(1) }).opened[0].rec;
  appendDecision(cfg, {
    kind: "dismissal", chose: `(dismissed: ${rec.id})`, supersedes: rec.id,
    because: "the difference is intended and not worth a parity claim",
    agent: "danilo", session: "s-human", now: T(2),
  });

  const text = renderJournal(cfg).text;
  assert.match(text, /Dismissed — NOT WORTH CHASING \(no answer was found; none was sought\)/);
  assert.match(text, /DISMISSED by danilo/);
  assert.ok(!/RESOLVED by/.test(text), "it must not appear as a resolution");
  assert.ok(!/^Resolved$/m.test(text), "and it must not create a Resolved section");
  assert.match(text, /0 open conjectures · 0 resolved · 1 dismissed/, "counted separately in the summary");
  assert.ok(text.indexOf("Resolved") < 0 || text.indexOf("Dismissed") > 0);

  // ...and it is OUT of the open lens, which is the point of dismissing it.
  assert.match(renderJournal(cfg, { open: true }).text, /\(none open —/);
  await cleanup(cfg.root);
});

test("dismissal — `0 dismissed` is not printed on a repo that has never dismissed anything", async () => {
  // One more permanent column is one more thing for the eye to learn to skip.
  const cfg = await root();
  appendDecision(cfg, { kind: "decision", chose: "X", because: "-", session: newSessionId(), now: T(1) });
  assert.ok(!/dismissed/.test(renderJournal(cfg).text));
  await cleanup(cfg.root);
});

test("dismissal — refused on a decision, with a different message from an unknown id", async () => {
  // Accepting either would append a record no render ever reads: a command that exits 0
  // and does nothing. The rule is SHARED with `resolved` rather than copied, so the two
  // verbs cannot drift into disagreeing about what may be retired.
  const cfg = await root();
  const d = appendDecision(cfg, { kind: "decision", chose: "X", because: "-", session: newSessionId(), now: T(1) });
  const wrongKind = resolvableConjecture(readJournal(cfg).records, d.id, "dismiss") as { error: string[] };
  assert.match(wrongKind.error.join("\n"), /is a decision, not a conjecture — only a conjecture is dismissed/);
  assert.match(wrongKind.error.join("\n"), /coherence retract/);

  const unknown = resolvableConjecture(readJournal(cfg).records, "d-deadbeef", "dismiss") as { error: string[] };
  assert.match(unknown.error[0], /no entry d-deadbeef in the journal/);
  await cleanup(cfg.root);
});

test("dismissal — a RETRACTED question may be asked again; a dismissed one may not", async () => {
  // The two verbs make opposite claims. A retraction says the observation was never real,
  // so if the detector keeps producing it, that claim is what deserves re-examination.
  const cfg = await root();
  const f: Finding[] = [{ advisory: "x", subject: "s", observation: "o", discriminatedBy: "t" }];
  const first = raise(cfg, f, { now: T(1) }).opened[0].rec;
  appendDecision(cfg, {
    kind: "retraction", chose: "(withdrawn)", supersedes: first.id,
    because: "that pairing was an artefact of a bug in the detector", session: "s", now: T(2),
  });
  assert.equal(raise(cfg, f, { now: T(3) }).opened.length, 1, "retracted — asked again");
  await cleanup(cfg.root);
});

// ── 5. what a raised question actually says ──────────────────────────────────────

test("the entry carries a candidate list and a test somebody can go and run", async () => {
  const cfg = await root();
  const p = pair(
    site(), site({ name: "ALWAYS_IGNORE", file: "src/sidecar.ts", line: 17 }),
    { onlyA: [".next", "coverage"], onlyB: [] },
  );
  const rec = raise(cfg, pairFindings([p]), { now: T(1) }).opened[0].rec;
  assert.match(rec.chose, /already drifted/i, "the divergence is the finding, so it is in the title");
  assert.match(rec.because ?? "", /Only in A: "\.next", "coverage"/, "and the evidence is below, uncapped");
  assert.ok((rec.couldBe ?? []).some((c) => /one side drifted/.test(c)));
  assert.ok((rec.couldBe ?? []).some((c) => /difference is intended/.test(c)));
  assert.ok((rec.couldBe ?? []).some(readsAsInstrumentDoubt),
    "and the detector itself is on the list — a heuristic pairing is the highest-prior explanation");
  assert.match(rec.discriminatedBy ?? "", /parity "<what must agree>"/, "the fix is spelled out, not alluded to");
  assert.equal(rec.finding, `redundancy:${pairSubject(p)}`,
    "stored readable and namespaced, so a duplicate can be grepped and the moving half SEEN");
  await cleanup(cfg.root);
});

test("never-red marks the apparatus explicitly, so the canonical line is not bolted on", async () => {
  // `[instrument]` is exactly the right first hypothesis for a claim that has never gone
  // red, and a specific wording beats the canonical one — that is `withInstrumentCandidate`'s
  // own rule, applied from the advisory side.
  const cfg = await root();
  const rec = raise(cfg, [neverRedFinding("sim", 'boundary "X" at f via test "t"', 14)], { now: T(1) }).opened[0].rec;
  const could = rec.couldBe ?? [];
  assert.equal(could.length, 2, "no redundant canonical candidate was prepended");
  assert.ok(could.some((c) => /oracle is vacuous/.test(c) && readsAsInstrumentDoubt(c)));
  assert.match(rec.discriminatedBy ?? "", /break the chokepoint/);
  assert.match(rec.discriminatedBy ?? "", /`## refutations`/, "and it names where the answer gets written");
  await cleanup(cfg.root);
});

test("the labels stay labels — a raised `chose` does not run to a paragraph", async () => {
  // The first raise on this repo tripped the LABEL_SOFT_MAX warning three times: the
  // observation was carrying kinds, lines and the token diff. Those are evidence and they
  // belong in `because`, which is uncapped.
  const src = `type Verdict = "a" | "b" | "c" | "d";\nconst TABLE = { a: 1, b: 2, c: 3, d: 4 };\n`;
  const { pairs } = pairSites(sitesOfSource(src, "x.ts"), new Set(), { containment: 0.5 });
  for (const f of [
    ...pairFindings(pairs),
    neverRedFinding("sim", 'boundary "every flux source\'s time-scale behaviour is measured and declared" at contribute via test "time scale invariance over flux sources"', 19),
    warnedKindFinding("sim", 'boundary "a per-tick channel bound\'s grip on a source is measured" at integrate via test "per-tick channel bounds"', "measured",
      "doctrine 2a: an observation of CURRENT behaviour. Would it go red if the simulation got BETTER? Then it is making today's bug tomorrow's standard."),
    refutationFinding("sim", "no non-finite contribution reaches a channel"),
  ]) {
    assert.ok(f.observation.length <= 200, `\`${f.advisory}\` observation is ${f.observation.length} chars — that reads as rationale`);
  }
});

// ── 6. it gates nothing, and a failed write is never silent ──────────────────────

test("gates nothing — a journal that cannot be written reports the loss and returns", async () => {
  // Advisory or not, a lost entry is reported. The alternative is an advisory that looks
  // like it raised a question and did not, which is the defect this harness hunts.
  // A regular file at the journal directory's parent makes mkdir fail deterministically.
  // The old fixture used a nonexistent path under /proc. On Linux, this file's worker
  // was the only worker that never exited in every CI run since v0.14.0; replacing its
  // sole platform-specific setup makes the failure portable and the diagnosis testable.
  const cfg = await root();
  try {
    await writeFile(join(cfg.root, ".coherence"), "not a directory\n");
    const r = raiseFindings(cfg, [], [neverRedFinding("sim", "c", 4)], { enabled: true });
    assert.equal(r.opened.length, 0);
    assert.equal(r.failed, 1);
    assert.match(formatRaise(r).join("\n"), /1 write\(s\) FAILED/);
  } finally { await cleanup(cfg.root); }
});

// ── 7. through the actual commands ───────────────────────────────────────────────

const PLANTED = {
  // One pair well above the floor (a private four-token vocabulary, spelled twice, tied by
  // nothing) and one far below it (three tokens that are also project idiom elsewhere).
  "src/kinds.ts": `export type Verdict = "live" | "literal" | "no-iteration" | "not-found";\n`
    + `export type Tier = "one" | "two" | "three";\n`,
  "src/report.ts": `const ALL = ["live", "literal", "no-iteration", "not-found"];\n`
    + `const RANK = ["one", "two", "three"];\n`,
};

test("redundancy — the command writes NOTHING unless --raise was asked for", async () => {
  const root = await tmpProject(PLANTED);
  try {
    const c = cfg(root);
    const { code, out } = await runCaptured(() => redundancy(c, graph([]), {}));
    assert.equal(code, 0, "advisory: it gates nothing, raising or not");
    assert.equal(readJournal(c).records.length, 0);
    assert.match(out, /`--raise` opens up to/, "but it names the verb, or nobody learns it exists");
  } finally { await cleanup(root); }
});

test("redundancy — `--all` shows the tail and must NOT raise it", async () => {
  // The policy that keeps the one command a curious person runs first from filling their
  // journal. Asserted as an equality rather than a count, so it holds however the fixture's
  // scores land.
  const withAll = await tmpProject(PLANTED);
  const without = await tmpProject(PLANTED);
  try {
    const a = cfg(withAll), b = cfg(without);
    const shown = await runCaptured(() => redundancy(a, graph([]), { all: true, raise: true, session: "s-a" }));
    const floored = await runCaptured(() => redundancy(b, graph([]), { raise: true, session: "s-b" }));
    const opened = (cf: Config) => resolve(readJournal(cf).records).open.length;
    assert.ok(/score ≥ 0/.test(shown.out), "`--all` really did drop the floor for the REPORT");
    assert.equal(opened(a), opened(b), "…and raised exactly what the default floor allows, no more");
  } finally { await cleanup(withAll); await cleanup(without); }
});

test("verify — the three advisories raise through the real command, and never by default", async () => {
  const root = await tmpProject({
    "src/a.ts": "export const f = 1;\n",
    ".coherence/status.json": JSON.stringify({
      verify: { claims: [{ node: "sim", claim: "typechecks", runs: 9, everFailed: false }] },
    }),
  });
  try {
    const c = cfg(root, {
      claimKinds: { measured: { policy: "warn", why: "it could convict us for improving" } },
    });
    const g = graph([comp("src", {
      label: "sim", claims: ["typechecks"], claimKinds: { typechecks: "measured" },
      invariants: ["a thing that holds"], refutations: ["something else: broke X -> saw Y"], why: "-",
    })]);
    // Anchoring an invariant needs a boundary claim; this fixture has none, so verify is
    // red on coverage. That is fine — raising is advisory and must happen anyway.
    const quiet = await runCaptured(() => runVerify(c, g, { fast: true }));
    assert.match(quiet.out, /never red: 1 claim/, "the advisory found it");
    assert.equal(readJournal(c).records.length, 0, "and wrote nothing");

    const loud = await runCaptured(() => runVerify(c, g, { fast: true, raise: true, session: "s-v" }));
    const open = resolve(readJournal(c).records).open;
    assert.match(loud.out, /RAISE — \d+ question\(s\) opened/);
    // never-red, warned-kind and refutation all fire on this fixture; the refutation one
    // is suppressed because never-red already named that claim's boundary… except this
    // claim is not a boundary, so the invariant's gap stands on its own.
    const kinds = new Set(open.map((r) => (r.finding ?? "").split(":")[0]));
    assert.ok(kinds.has("never-red"));
    assert.ok(kinds.has("warned-kind"));
    assert.ok(kinds.has("refutation"), "the refutation advisory reaches invariants no claim covers");

    // Run it again: the dedupe holds through the command, not only through the helper.
    const before = readJournal(c).records.length;
    await runCaptured(() => runVerify(c, g, { fast: true, raise: true, session: "s-v" }));
    assert.equal(readJournal(c).records.length, before, "a second run asks nothing new");
  } finally { await cleanup(root); }
});

test("verify — the refutation advisory raises NOTHING until a project declares its first", async () => {
  // Its per-invariant list is gated on `refs.length` because a line per invariant on a
  // project that has never used the feature is a nag. Raising there would be the same nag
  // with an id, and on a spec-heavy repo it is the single biggest source of first-run volume.
  const root = await tmpProject({ "src/a.ts": "export const f = 1;\n" });
  try {
    const c = cfg(root);
    const g = graph([comp("src", { label: "sim", claims: ["typechecks"], invariants: ["p", "q", "r"], why: "-" })]);
    await runCaptured(() => runVerify(c, g, { fast: true, raise: true, session: "s-v" }));
    assert.equal(resolve(readJournal(c).records).open.length, 0, "three unrefuted invariants, zero questions");
  } finally { await cleanup(root); }
});

test("priorsByFinding — a record with no `finding` is invisible to the advisory dedupe", async () => {
  // A hand-written conjecture about the same subject is a different record with different
  // evidence, exactly as `observed.priorFor` treats one. The advisory still asks its own.
  const cfg = await root();
  appendDecision(cfg, {
    kind: "conjecture", chose: "NOISE_DIRS and ALWAYS_IGNORE look duplicated to me",
    because: "", discriminatedBy: "-", session: "s-human", now: T(1),
  });
  assert.equal(priorsByFinding(readJournal(cfg).records).size, 0);
  assert.equal(raise(cfg, pairFindings([pair(site(), site({ name: "ALWAYS_IGNORE", file: "src/sidecar.ts" }))]), { now: T(2) }).opened.length, 1);
  await cleanup(cfg.root);
});
