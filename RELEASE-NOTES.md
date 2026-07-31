# Release notes

Newest first. v0.10.1 through v0.12.0 shipped on 2026-07-28 in one burst, on top of
v0.9.0 (2026-07-11); v0.13.0 through v0.16.0 followed on 2026-07-29, and v0.17.0 on
2026-07-30.

The whole run has a single theme. Coherence gates a build on claims a project
writes about itself, and every release here is a consequence of one uncomfortable
question: **what happens when the claim being enforced is wrong?** A harness that
prevents drift and a harness that cements a bug are the same machine viewed from
two sides. 0.10.x gives a project the vocabulary to say which one it is looking
at; 0.11.x builds the record of what agents decided and why; 0.12.0 protects the
evidence inside that record.

---

## v0.22.0 — a rename is not growth

The `mass` ratchet said **"the movement gained parts nobody named"** about a
component rename. Nothing was gained: renaming a component (its label comes from
the spec's H1) moved 35 lines from one key to another while `lines|total` stayed
identical — printed in the same report, two lines above the accusation. And in
the FAILED path the vanished key printed nowhere at all, so half the exonerating
evidence was off the page.

`reconcileMass` now mirrors `lint-sinks.reconcile` (v0.20.1): a NEW dimension
inherits a vanished pin only when one of the same **family, unit and exact
value** disappeared, each absorbing exactly one. A rename reports as
`~ lines|ids → lines|identifiers (35 lines conserved)`, in the ratchet's own
words, and never as growth.

### The design that lost

This shipped against my own prior design, which is the point of building it. I
had argued for a type-level obligation forcing every baseline to DECLARE a
rename policy — `forgives-moves | immune-by-key | rename-is-signal` — on the
theory that the families want different semantics: sink sites are DISCOVERED so
a move should be forgiven, components are DECLARED so a rename should be signal.

Measured, that asymmetry does not survive contact **at the gate**. Renaming a
`measure|` key with its probe still printing the same number produced the
identical lie. When the value is conserved nothing was gained in either family;
when it is not, both must fail. `deps|*`, `files|total`, `symbols|total` and
`undocumented|symbols` are closed key sets where a rename is inexpressible, so a
policy declaration buys nothing but surface there. The asymmetry survives only
in vocabulary — mass says RENAMED where sinks say MOVED.

One reconciler, no policy enum. The obligation design was over-engineered and is
recorded as rejected on evidence (d-6032bb85).

### Value equality IS the conservation property

The move-invariant address is family + unit + **exact value**, and the
alternatives were rejected for what they give up. Value-blind or tolerance
matching would let a genuinely new component pass whenever any same-family pin
of matching size vanished — growth laundered through a rename, conservation
inverted. Exact matching instead fails closed when a rename lands in the same
commit as an edit, and the report names the candidate rather than hiding it:
`lines|ids (3) vanished this run … its mass ALSO changed 3 → 5`. The documented
loosening is the same one sinks accepts: a deleted 35-line component plus a
coincidentally-35-line new one reads as a rename, printed by name so a reader
can catch it.

Proven by mutation in both directions — never-absorb, and value-dropped-from-the
-address (the laundering direction) — each redding the claim by name.

627 tests (was 620). 27 claims, 27 green, refutations 11/13.

---

## v0.21.0 — the harness stops exempting itself

Three audits pointed the doctrine at the tool. Each found the same sentence
failing in a different place — *declared-but-wrong is strictly worse than
undeclared* — and this release is the repair.

### The instrument could lie, and now it cannot

Deleting `verify`'s own `testMatch` evidence rule — the anti-vacuity mechanism,
the single most important property the tool has — left the tree **23/23 green,
"✓ coherent."** The verifier carried no claims about itself. It now carries six,
and **every one was watched failing before it was allowed to exist**: positive
evidence at `execNamedTest`, the vanished oracle at `resolveFromBatch`, the
unanchored-invariant ratchet, the literal-domain meta-oracle, skip-never-clobbers
at `recordVerify`, and no-test-runs at `runNamedTest`. Refutation coverage is
10/12.

Two structural repairs behind them. **Claim-record identity** was spelled three
ways — `claimKey` promised to be "the ONE key (store AND read)" while the merge
keyed on a raw NUL-separated string — so annotating a boundary with a purely
declarative `crossing` clause silently reset `everFailed: true, runs: 50` to
`false, 1`, and the never-red advisory then flagged the checker with the richest
failure history as a suspect. `claimKey` now returns a branded `ClaimKey` that
cannot be minted elsewhere, and `indexClaimRecords()` is the one map-mint every
reader uses. And **CI never ran full verify**, so renaming a guard's test title
orphaned its oracle with every automated gate still green. It runs now.

### A checker that cannot fail is not a checker — including the runner

`execNamedTest` trusted `config.test` on the serial path, on a runner class this
repo had itself documented as un-guardable by `testMatch`. `proveSerialRunnerCanFail`
now runs a nonce that exists nowhere through the exact claim path, once per serial
verify: if it PASSES, the runner cannot filter, and the run refuses loudly instead
of grading claims against a runner that says yes to everything. Ten existing tests
used always-exit-0 fakes; the canary correctly refuses that shape, so they were
rewritten name-sensitive. The per-claim shim also moved from `scripts/` into `src/`
— inside the evidence perimeter, where it is claimed and tested rather than trusted.

### It stopped exporting the anti-pattern it hunts

`scaffold`'s `## why` template generated mechanism-restatement — *"enforced at ONE
chokepoint … asserted by a totality oracle … that fails loud"* — the exact prose
`why-lint` exists to kill, proven by pasting scaffold output into a fixture and
watching the linter flag it verbatim. Since scaffold output is what adopters paste
unmodified, the generator was propagating the smell into every consuming repo. It
is now a rationale prompt; the mechanics moved to the `TODO(code)` comment.

The claim-form table had drifted exactly as the README predicted it could — 8
listed against 9 real forms, missing `lives in` and the boundary `crossing`
clause. It is now **derived** from `CLAIM_FORMS` and byte-checked, the way the
command index already was. Two README examples that showed real journal ids
"dismissed" and "resolved" with fabricated rationales were corrected — a doc
depicting a lie the journal says it cannot recover from. And the root spec's
five `exists at root` trivialities were pruned to the two whose absence is
*silent*: fewer honest claims, not invented ones.

### `coherence prose` — duplicated prose that has already diverged

The new advisory. Not "you repeated yourself" — a module header exists so a reader
of the module need not find the README, and that duplication is correct. The signal
is **the copies no longer agree**, which no reader can detect without diffing both.
On this repo: 35 linked pairs, **24 diverged**. It prints its floor's cost and says
plainly that it compares text, not meaning — it cannot tell a deliberate summary
from a rotted copy.

620 tests (was 589). 26 claims, 26 green.

---

## v0.20.1 — a reviewed risk site keeps its identity when the file moves

Found by a consuming project, not by this repo. Eight subsystems were extracted out
of one Durable Object into `shared/<name>/` modules; `lint-sinks --check` then failed
CI with **"7 new raw interpolation sites."** Four of the seven were not new at all —
`u.characteristic`, `pert.label`, `pert.characteristic`, `frame.reference.label` had
been reviewed and baselined months earlier, under the path they lived at *before* the
refactor moved them.

The cause is one line. The baseline addressed a site as `` `${context}|${file}|${expr}` ``,
so **the file path was part of the site's identity** and relocating a file re-addressed
every sink inside it. A refactor manufactured false security alarms in proportion to how
much code it moved.

That is not a cosmetic annoyance, and it is the same failure class the rest of this
release train is about. A ratchet baseline is a **cached review** — a fact paid for once
by the party who had the answer in hand, so no later reader has to re-derive it. A cached
fact that expires on a rename is premise rot one layer down. Worse, the expiry is
*silent about being an expiry*: it presents as new risk. A reviewer who trusts the
ratchet re-reviews sinks nobody touched, and a reviewer who has done that twice starts
waving the whole report through — which is exactly the mislabeled-breaker failure this
harness exists to prevent.

### What changed

`reconcile` (new, exported from `src/lint-sinks.ts`) splits the live sites against the
baseline into **moves** and genuinely **novel** sites. A move is a **matched
disappearance**: an unmatched site inherits a baselined review only if some baselined
site with the same `context|expr` has *vanished* from the live set, and each vanished
entry absorbs exactly **one** unmatched site. Moves are printed as their own block
(`old → new`) and do not fail `--check`.

The conservation rule is the whole design. The obvious fix — drop the path from the key
and address a site by its content — makes the reported symptom disappear and quietly
guts the ratchet: an already-reviewed `${row.name}` could then be copy-pasted into fifty
new and more dangerous files for free, because `--check` would no longer be asking about
*sites*. Counting per `context|expr` keeps the distinction that matters: **relocation
changes where a reviewed site lives; duplication changes how much unreviewed surface
exists, and only the second is news.** A copy — original still live, nothing vanished to
absorb it — is still NOVEL and still fails.

Also rejected: git-rename-aware reconciliation (`--find-renames`), which is more precise
but makes a tree-reading ratchet depend on VCS history — shallow CI clones, non-git
consumers, and uncommitted working-tree moves are exactly the conditions `--check` runs
under (d-4544efd8).

### What it gives up, said out loud

A sink that moved into a genuinely *more exposed* file no longer fails `--check`. The
sink **context** is still part of the address, so a move that changes the *kind* of sink
(`sql-ident` ↔ `html-value`) is still novel and still fails; what is given up is
path-level exposure judgment, which this lint never actually had — it only ever knew
that a path string had changed. The fact does not vanish, it changes rung: every move is
named in the report with its old and new path, so the reader can judge what the tool
cannot (d-33abbd36).

One honest limit: when several byte-identical sites share a `context|expr`, *which* new
path inherits *which* vanished review is arbitrary — paths pair in sorted order for
determinism, not for meaning. The guarantee is the count, and the tests assert the count
(d-70ed7465).

### The claim, and proof it can fail

`src/harness.spec.md` gains a sixth invariant — *reviewed risk sites survive relocation
but never duplication* — anchored at `reconcile` via guard `"sinks — a moved file keeps
its baselined identity and a genuinely new site still fails"`, whose one oracle exercises
all three directions end to end. Per the discipline v0.20.0 set for itself, it was
mutated in both directions before being believed: reverting to path-as-identity reds it
(the moved file reports as new risk), and switching to plain content-addressing without
conservation reds it too (the copy is waved through). `claims: 23 · 22 green · 1 red`
each time; restored, 23/23. The loosening direction is the one that mattered to test — a
fix for a false alarm that cannot itself fail is a fix that deleted the ratchet.

`conventions` was checked for the same exposure and **does not have it**: its baseline is
`{name, sites}`, and `callSites()` counts across the whole source set regardless of file,
so relocation is invisible to it by construction. Measured, not assumed — a guard's
declaration *and* a call site were moved into a new directory and the ratchet stayed
green. It was left unchanged; symmetry is not a reason to add machinery to a component
that does not have the defect (d-044803b8).

---

## v0.20.0 — the read side of the work ledger

The README's newly-landed doctrine section says a codebase's real price is the
**economy of inference**: what a reader must derive before they may safely act.
Everything the harness measured until now priced the *write* side. `decompose`
grades whether what changes together lives together; `drift` shows which way that
is moving; `mass` pins how much machine there is. All three answer "what did
changing this cost to build". None answered the question a maintainer pays every
day: **to change one thing safely, how much do I have to load first?**

The economy of writes is locality. The economy of reads is **context closure**,
and this release builds its instruments.

### `coherence economy` — the context closure of a change

For every commit in the recent concern band, the closure is the touched files
the graph knows, **plus their direct import neighbours in both directions**,
plus the spec files of the components those files belong to. Both directions is
the load-bearing half: a safe modifier needs what the touched file depends on
(or the edit is written against imagined behaviour) *and* who depends on it (or
the edit is a silent breaking change), and a one-way closure reports a hub as
cheap (d-ab4ffddc). The report prints the median and p90 closure in files and
lines, an 8-window trend, the worst closures, the **read-side hubs** (files
appearing in most closures), and the mean closure per component. `--raise` opens
one conjecture per file in half or more of the closures, keyed on the bare path,
with the two candidates that actually explain one — a declared hub whose cost is
bought, or a missing abstraction with a read-side price tag.

The window is 400 commits, shared with `drift` and `mass` through the evolution
memo's `<root>|400` key, because closure is a trajectory instrument and not
all-time archaeology (d-6ff3b30a). Two approximations ride along, and both are
named **on the report itself** rather than in a footnote (mass.ts's precedent: a
number whose universe is not the reader's must say so on the line):

- **Lines are measured against the current tree.** A per-commit `git show` would
  be exact and would buy precision the ranking does not turn on (d-9dfa5f1e).
- **The universe is the graph.** A commit that touched only docs, config or a
  lockfile contributes *no* closure rather than a zero — a zero would claim a
  change was free to read that the instrument never saw.

It exits 0 always: a closure is a cost, not a defect. A project whose specs are
worth reading has a larger closure than one with no specs at all, and the second
is not healthier. The run is filed to `.coherence/status.json` with its **sample
size**, because a median over three commits and one over three hundred must
never look alike (d-970c1488). *A panel energy strip for closure is a named
follow-up, not in this release.*

Dogfooded on this repo, the first run reported a median closure of 39 files
against a 77-file graph — surprising enough to doubt the instrument before the
subject (d-2396264c). The discriminating test recomputed the median over a
narrow 2–3-file band: it fell to 15, with a floor of 6, so the concern band
inflates the *level* on a repo this small but does not manufacture the finding.
The hub structure is real — one flat component over a shared `types.ts` and a
`cli.ts` that imports nearly everything (d-37a7963c).

### `atlas` — the inference hazard

A tier grade says how well a crossing is defended; heat says whether anyone has
been near it. The **join** is the new line: a tier-3 crossing (an undeclared
junction, where every reader who arrives re-derives what may legally cross) with
heat **≥ 10%** (somebody keeps needing to know). It renders in the console and in
`atlas.md`, lands in the recorded atlas section as an optional `hazards` field —
pre-0.20 status files still parse — and under `--raise` opens one conjecture keyed
on the crossing **symbol**, never on its heat, which moves weekly. An unmeasurable
heat is never a hazard: absence is not cold. Like the heat it is built on, it
grades nothing — `atlas --check` still fails only on drift, dangling edges and
over-claim (d-cfe4a359).

### `mass` gains `undocumented|symbols`

`symbols|total` counts how much surface there is. The new dimension counts how
much of it a reader must derive by reading the body — the inference mass that byte
mass cannot see. The predicate gets **one home**: `isDocumented`, exported from
`src/derive.ts` (the module that sets `prose`) and read by `mass`, by `verify`'s
coverage line and by its `[doc]` jobs, so a symbol the advisory calls undocumented
is exactly one the ratchet counts. It was spelled twice inside `verify.ts` alone
before this (d-eded250c).

**CONSUMING REPOS: your next `coherence mass --check` will red** with
`NEW dimension: undocumented|symbols = N`. That failure is correct and
self-explaining — it is the designed adoption path, and the message already says
what to do: `coherence decide "<what the new surface buys>"`, then
`coherence mass --update-baseline`. Growth thereafter fails like any other
dimension, which is the point: undeclared surface that keeps growing deserves a
decide. All four features ship in one release precisely so this costs one
re-pin cycle rather than two (d-c1316af0).

### `verify` ranks `[doc]` jobs by churn

The undocumented-symbol list is the longest thing verify prints, and it came out
in walk order — alphabetical by path, which correlates with nothing. It is now
ranked by the churn share of the **defining file**, hottest first, annotated
`(hot: N% of recent commits)` above a 5% floor. Zero-churn gaps keep their source
order (`Array.prototype.sort` is stable), so a project with no history gets
exactly the list it always got (d-5e1c36bd). Same `fileChurn` reading atlas heat
uses, through the same memo — one git read, two consumers.

### Reference

The README's `### In detail` entries gained what v0.19 shipped but never
documented outside its doctrine section: `atlas` now covers heat and the hazard,
`verify` covers the holding cost (report-vs-wall clocks, the floor, the run-level
record), and `economy` has an entry of its own.

551 tests (was 520).

---

## v0.19.1 — heat tells the truth in a subdirectory

The first consumer to adopt v0.19.0 roots coherence at `<repo>/app`, and every
crossing read `heat ▁ 0%` — the hottest chokepoints in the project reading
coldest, which is worse than no reading. The adopting agent doubted the number
before the code and was right: git reports commit paths from the repository
root, the graph addresses files from `cfg.root`, and `crossingHeat` compared
the two address spaces raw. The translation existed — spelled privately inside
`componentMap` since decompose shipped — so the fix is the same one-spelling
move the evolution store itself was: `gitPrefix()` / `rebaseCommits()` now live
in the store, and both consumers use them. Heat on that project now reads
Patient ≈ 31% where the hand computation said it should (d-ee05c4a2; the
consumer's journal holds the discovery as d-99949758 → d-d0bbb52c).

---

## v0.19.0 — the work ledger reaches the claims and the map

v0.18.0 pinned how much machine there is. This release asks the two follow-on
questions: what does each **claim** cost to keep true, and where is the map
**hot**?

### Holding cost — `verify` now prices its own promises

Every claim's verification time is measured and recorded: the runner's own
per-assertion `duration` when the batch report carries one, verify's wall clock
otherwise, and the answering clock is named per row (`report` / `wall` —
d-3fe015df). The vector is **run-level** on `VerifySection`, rewritten whole
every run, deliberately not a field on `ClaimRecord`: the skip-carry argument
that already settled `batched` applies verbatim, and a carried ms would price a
verdict from a previous run (d-86a6c498). The advisory block stays quiet below
a floor and shows the top five above it; under `--raise`, a claim eating ≥25%
of the total becomes a journal question — ranked **last**, because
expensive-to-keep-true never outranks a correctness finding (d-3aa93a9b).

One number in this feature was interrogated before it shipped. The plan filed a
standing conjecture: does a pooled runner's per-assertion duration mean
wall-clock share? The discriminating test ran — four 800ms test files under the
concurrent pool summed to 3,207ms of assertion time against 1.04s of wall, a
3.1× overshoot with all four start times identical to the millisecond. The
durations are truthful in-worker readings that count the same wall seconds once
per worker; the instrument was right and the first report wording was not, so
the line now says what the number is: "summed per-claim cost … (a pooled runner
overlaps some of it)" (d-fe9ebf1e → d-0f3c7154 → d-d126843f).

### Atlas heat — a temperature on every crossing

Each mapped transition now carries **heat**: the share of the last 200 commits
(the shared `CHURN_WINDOW`) touching a file that defines the chokepoint symbol
— max over defining files, **absent** (never zero) when nothing resolves or
history is empty (d-90a2f7a7). It renders as a bar normalized across the map
plus the raw percent, in the console and a new `atlas.md` column, and lands raw
in the recorded crossings (d-be02ab02). Heat never affects `--check`: it is a
temperature, not a correctness fact — a hot tier-1 crossing is not wrong, it is
*load-bearing and busy*, which is exactly what a reader deciding where to be
careful wants to know. The scene remains glow-free; the recorded audit decision
and its test stand.

### The panel's energy strip

The masthead gains one line, present only when the data is: total holding cost
with the most expensive claim, and a heat spark over the hottest crossings.
Everything comes from `status.json` — the panel still re-runs nothing.

518 tests (was 493).

---

## v0.18.0 — the harness begins to account for work, not just trust

Coherence has always been flux accounting for **trust**: where the untrusted
becomes verified, and through which anchored chokepoint. This release starts the
other ledger — **work**: what a project costs to keep, continuously. The framing
is a mechanical watch. Every complication in a movement is paid for in torque,
and the watchmaker feels the amplitude drop; software has the same physics and
none of the perception, because the invoice arrives as velocity quietly decaying
instead of a watch that stops. The instruments in this release exist to make the
dissipation perceptible.

### `src/evolution.ts` — the EVOLUTION graph, spelled once

The same git-history derivation was spelled three times: `decompose`'s commit
log, `drift`'s per-commit deltas, `scene`'s inline churn loop with its own bare
`200`. That is verbatim the finding the `redundancy` advisory reports about
other people's code, fixed the way the advisory prescribes: one home, one
spelling of `BULK` and the churn window, all consumers derived. Deliberately a
**memo, not a cache** — the duplication was a redundancy problem, not a latency
one, and a persisted churn artifact keyed by HEAD is perpetual diff noise in
exchange for a git call that costs milliseconds (d-9d5776a5). The new pure
derivations (`fileChurn`, `componentChurn`, `locDeltaSeries`) take a commit
array, so the math tests without git and the git plumbing tests against a real
throwaway repo.

### `coherence mass` — how much machine there is, pinned

The fourth ratchet, and the first one that counts the thing a reader of an
agent-built repo asks first: how much is there NOW, and did it grow? Dimensions:
`lines|total` and `lines|<component>`, `files|total`, `symbols|total`,
`deps|direct` / `deps|dev` / `deps|transitive`, and `measure|<key>` for whatever
the project can measure about itself (bundle bytes, table counts) via
config-declared probe commands. Baseline in `<outputDir>/mass-baseline.json`,
per-key `tolerance`, the conventions mechanics exactly: 0 held · 1 grew · 2 no
baseline.

Three rules carry the design:

- **Absence is not emptiness.** No manifest means the dimension is *omitted*,
  never zero — "the lockfile disappeared" must not read as "zero transitive
  deps".
- **An unmeasurable measure fails closed.** A probe that exits nonzero or prints
  no number fails `--check` loudly; treating it as 0 would make a broken bundle
  probe read as a heroic size reduction.
- **The growth failure prescribes `coherence decide`.** The ratchet cannot know
  whether 460 new lines bought a feature or an accident; the only party who can
  say is the one who wrote them, this run. The gate's message is not "justify
  this to me" — it is "name what the new mass buys, then re-pin". No part enters
  the movement without naming its complication (d-97f6f9ef).

Excursions become journal questions only under `--raise`, through the standard
finding machinery — mass has a pin, not a band, and an implicit write on a
report run is the surprising-write failure `raise.ts` exists to prevent
(d-9492b164). The report ends with an 8-bucket net-LOC spark whose caption names
its universe — ALL tracked files, not just the graph's — because the first
dogfood run of `mass` on this very repo surprised us by ~4k lines and the
discriminating test showed the two instruments count different file sets
(d-84e3e34f, opened and resolved in one session; the journal has the evidence).

493 tests (was 454). decompose/drift/scene render output byte-identical across
the refactor. Next: per-claim holding cost in `verify` and per-crossing heat on
the atlas — the same ledger, pointed at the claims themselves.

---

## v0.17.0 — the twenty-minute full tier is retired, not made optional

This release **removes a default**. Until now `verify`'s executable tier shelled
`config.test` once per claim — `vitest run -t "<name>"` — and every one of those invocations
booted the consuming project's entire test pool to execute milliseconds of assertions. Two
repos, measured:

- a workerd/vitest pool at 15–30s per boot × ~70 executable claims = **20–35 minutes**, for a
  suite that runs end-to-end in **under two**;
- a second project: one targeted oracle run took **4.51s** and reported
  `7 passed | 291 skipped` — it paid the import and transform cost of **298 tests in order to
  run 7**. × 17 claims ≈ 77s, ~60s of it fixed overhead, **on top of** an outer `check.mjs`
  that had already run the whole suite for its own reasons. Their full tier: **8 minutes**.

Nothing in those numbers is about test count. The full tier paid one suite's import cost
**eighteen times**, and that project paid it a nineteenth time before coherence even started.

The first cut of this shipped as an opt-in `testBatch` key, faithful to the harness's own
"no behaviour change unless configured" discipline. That was wrong, and the second
measurement is why: **the projects that most need the fast path are the least likely to have
found the knob.** That repo was re-deriving evidence it already had, eighteen times, and
nobody noticed because the slow profile never announces itself. An additive fix is right for
a feature and wrong for a defect.

So batching is now **the default**, and it needs no configuration at all: if `config.test`
names vitest, coherence **derives** the whole-suite command itself.

### The four modes, and a refusal

| Mode | How you get it | What happens |
| --- | --- | --- |
| `--from-report <file>` | the flag | resolves from a report you already have — runs **no tests** |
| serial | `--serial-oracles` / `"oracleExecution": "serial"` | one full pool boot **per claim** |
| batch (configured) | `config.testBatch` | your command, once |
| batch (derived) | **nothing — the default** | synthesized from `config.test` |

Unrecognized runner, no `testBatch`, no report, no explicit serial → the full tier **fails
loud**, listing all three ways out. It will not quietly buy you N pool boots. A consumer has
to **type the name of the expensive profile** to get it, and when serial does run — by request
or as the batch-crash fallback — it states its cost every single time and names the config
that retires it.

### The third state is the other half of the point

Speed is what you notice. What matters as much is that a report distinguishes something an
exit code cannot. `vitest -t` exits **0** when its filter matched nothing — so under the old
path a renamed or deleted oracle read as a **pass**, and the only thing between that and a
laundered green was `config.testMatch`, a regex the project had to know to hand-configure over
the runner's *output*.

| | serial | batch |
| --- | --- | --- |
| test ran, passed | green | green |
| test ran, failed | red | red, naming the failing test |
| **test does not exist** | *green* unless `testMatch` is set | **red — `VANISHED ORACLE`** |

Under batch mode absence is directly observable, and zero matching tests is its own verdict
that says so in those words. **`testMatch` has nothing left to do for a batched claim** — the
same move as an unknown claim kind or a typo'd verb, where the failure mode is *eliminated*
rather than covered by a knob whose absence is silent.

Chasing that turned up something worse, on Node 25.2.1: for `node --test`, `testMatch` does
not work **at all**. A `--test-name-pattern` matching nothing still reports the *file* as one
passing test and exits 0, satisfying any "N passed" regex — and because node stops parsing its
own options at the first positional, a `config.test` of
`["node","--test","<glob>","--test-name-pattern"]` hands the filter to the *script*, where it
is silently ignored and the whole suite runs and passes. Every claim in such a project has
been green for free. That is now written down in the README, and it is the strongest argument
for the batch path there is.

### Mirroring `-t`, verified rather than assumed

Batching is only allowed to exist because it reproduces the per-claim verdicts exactly, so the
semantics were checked against the real binary before any of it was written. `-t` is an
**unanchored regex** over the report's `fullName` — the reporter's own
`ancestorTitles.join(" ")` plus the title — and the serial path always regex-**escapes** the
name first. An escaped pattern matched unanchored *is* a literal substring test, so that is
what batch matching is. `-t "totality covers"` really does run
`write policy totality covers every op`, and a claim anchored to a `describe` title matches
every test beneath it; equality would have red-lined that entire common case. The same run
confirmed why escaping is load-bearing: unescaped, `-t "rejects unknown (a+b)"` matched
**zero** tests and still exited 0.

Green requires ≥1 matching test that **passed** and none that **failed**. Skipped tests are
neither evidence nor failure — deliberately, because that is what the runner concludes too,
and a batch stricter than the path it replaces would invent reds in repos that were honestly
green.

### Four things it refuses to do quietly

- **Attribution stays per claim.** The batch is shared *evidence*, never a shared verdict.
  Each claim fails alone, naming its own oracle and the test that failed. "The suite is red"
  would have been simpler and would have been a regression.
- **A crash falls back, out loud** — with the serial cost framing, because that is the one
  remaining route into the expensive profile that nobody typed. A **nonzero exit is not a
  crash**: a suite with a red test exits nonzero, and that is exactly the run whose report is
  worth reading. (Relatedly, `spawnSync`'s default 1 MiB `maxBuffer` is now 64 MiB — a vitest
  report embeds a stack trace per failure, so the *failing* run was the one whose report would
  have arrived truncated.)
- **A stale report is refused.** The report file must postdate the run that was meant to write
  it. Found while chasing a suspiciously fast smoke run: a runner that exits without writing,
  over a leftover report, resolves every claim from evidence about code that no longer exists
  — and looks perfectly healthy. Strictly worse than a crash, which at least falls back.
- **A typo'd `testBatchFormat` fails the run.** Falling back would produce a correct-looking
  green that took thirty minutes.

`--fast` never boots any of it: resolution is a lazy memoized thunk, like `typecheck`, so the
executable tier skips before asking and a `--fast` run cannot be refused either. Scoped runs
(`--staged`/`--since`) *do* batch the whole suite once and resolve only in-scope claims from it
— one boot is already cheaper than three scoped per-claim boots.

### What it does not fix

Batching stops you **repaying import overhead**. It does nothing for an oracle that is
genuinely slow: a convergence ensemble doing ~140s of real work costs ~140s whether it is
reached through one boot or seventeen. If the full tier is slow because the *tests* are slow,
this is not the lever.

**`node --test` cannot be batched yet** — it ships no JSON reporter (only `default`, `dot`,
`junit`, `lcov`, `spec`, `tap`), and its `--test-name-pattern` matches each individual test
name rather than a concatenated one, so a batch would need a second, unverified matching rule.
node:test projects are recognized and told so rather than guessed at.

### Upgrading

**A vitest project needs to do nothing** and gets batching automatically — but do one thing
deliberately the first time: run a full `verify` **before and after** upgrading. Identical
verdicts are the acceptance test. If the batch surfaces new reds, read them: a
`VANISHED ORACLE` is a claim that was green because nothing was checking it.

Keep `config.test` configured — it is what a failed batch falls back to. `testMatch` can stay
(it still guards the serial arm) but no longer carries the renamed-oracle guarantee on its own.

**Two cases must act:**

- **Any runner that is not vitest** (jest, node:test, a custom script) now **fails the full
  tier** until you choose a mode: set `config.testBatch`, pass `--from-report <file>`, or
  accept the old profile with `--serial-oracles` / `"oracleExecution": "serial"`. This is
  deliberate — it is the one change here that can break a green build, and it breaks it with
  instructions rather than with a twenty-minute wait.
- **CI that wants the old behaviour** should add `"oracleExecution": "serial"` explicitly.
  Nothing infers it any more.

---

## v0.16.0 — the journal stops drowning its own pull request

One file per session is right when the sessions are real. A consuming project produced
**~20 new `.jsonl` files in one day**, and twenty new files is not a diff anybody reads —
so the record became noise at exactly the moment it was supposed to be read.

The cause was **one line**: with no `--session` and no `COHERENCE_SESSION`,
`appendDecision` fell back to `newSessionId()`, a *random* id, so every hookless
`coherence decide` minted a fresh file. Randomness is correct for a hook-minted session,
where five agents genuinely are concurrent. It was never correct as a fallback, where the
caller is a person or a lone agent typing a shell line.

### A derived fallback: `<branch>-<agent>-<YYYY-MM-DD>`

Same branch, same agent, same UTC day now **appends to one file**. Hook-minted sessions
keep their random `s-<12 hex>`.

**The branch stays in the filename.** Distinct filenames are the whole reason two parallel
branches never conflict on the journal, and a tidier PR is not worth trading a merge
conflict for. Sanitising is injective — a digest of the raw name is appended whenever
flattening changes anything, so `feat/x` and `feat-x` cannot land on one file — and a name
that was already safe passes through untouched, so every id ever written still maps where
it did. It also closes a hole that predated it: `--session` went straight into a path.

The residual collision — two agents both defaulting to agent `main` on one branch — is safe
four ways over, the strongest being structural: same branch means same checkout, and git
refuses to check one branch out in two worktrees, so genuinely concurrent agents have
different branches *by construction*.

### `coherence decisions --compact` — and the test that it changes nothing

What the derived id prevents going forward, this folds after the fact: one file per
**(branch, month)**. It coexists with append-only because **it only folds files whose blobs
are already committed** — the originals stay in git history, where `git log -- <path>` and
`git show <commit>:<path>` recover any individual session, so the working tree is tidied and
the record is untouched.

- A tracked journal file that differs from HEAD is a **refusal**; nothing is folded.
- A file git has never seen is **skipped** — that would be a deletion. Checked with
  `git ls-tree HEAD` rather than `git status`, which says nothing about *ignored* files.
- A file written in the last **two hours** is skipped: the window must exceed one agent's
  worst intra-session append gap (14.1 min measured here) and stay well under a day, or it
  would refuse the very case it exists for.

**The acceptance test is that the render does not move** — `coherence decisions` before and
after, character for character. Two properties make that checkable: lines are copied byte
for byte, never re-serialised; and `readJournal`'s sort became **total** over
`(at, id, session)`, so the render is a function of the *set* of records rather than of the
file layout. A file with an unreadable line is left alone, because dropping that line would
quietly lower the render's `N unreadable line(s)` warning.

Dogfooded on this repo's own journal: **15 files → 5**, nine render shapes byte-identical,
78 records and 15 sessions preserved. Watched to fail, too: disabling the unreadable-line
guard turns the identity test red on exactly the missing `WARNING:` line — and the first
negative control (reversing the concatenation order) leaves it *green*, which is correct and
is why the ordering property carries its own assertion against file content.

---

## v0.15.0 — the harness takes its own advice

`coherence redundancy` had been printing the same finding on every run since it
shipped: `src/cli.ts` spelled the command list twice — once as the pipe-separated
alternation literal in the usage banner, once as the `cmd === "…"` dispatch chain —
with *nothing keeping the spellings equal*. 31 shared tokens, score 31.30, and the
verdict "the two spellings ALREADY disagree", because the dispatch accepted
`resolve` and the banner had never heard of it.

It was right, and the cost was measurable. The banner produced v0.14.0's **only
merge conflict** — two branches hand-editing the same line. Banner vs dispatch
measured 29 vs 30. And README's `## Commands` reference, a *third* spelling nobody
had counted, measured **20 vs 32**: twelve commands undocumented, including
`dismiss` listed while its six sibling journal verbs were not, so a reader found a
verb for retiring conjectures with nothing on the page explaining what a conjecture
is. A convention-tier rule the tool itself kept flagging.

### One declarative home, two derived spellings

`src/commands.ts` holds `COMMANDS` — an ordered `{ name, summary, usage?, group,
aliases? }` registry in the shape `CLAIM_FORMS` already established for the claim
grammar. From it:

- **the usage banner** is `.map`ped and joined. No command-name string literal
  survives in `cli.ts`'s help text, so there is no line left for two branches to
  conflict on, and the banner is now *complete* — it used to omit the details of
  eight commands it listed.
- **a third owned block in README.md**, fenced like CLAUDE.md's and spliced by the
  same `spliceBlock` (which now takes the fence as an argument — one splice
  implementation, two marker pairs, not two copies). `coherence docs` writes it;
  `coherence docs --check` fails on it when stale.

The registry lives in its own file rather than beside the dispatch for a blunt
reason: `cli.ts` **executes at import**, so a test cannot read it. A source of
truth its own oracle cannot import is not one.

### The totality oracle is the point

`test/commands.test.ts` parses `src/cli.ts` and pulls every `cmd === "<literal>"`
out of the **TypeScript AST**, then asserts set equality with the registry —
aliases counted on the dispatch side, so `resolve` is dispatched without being
advertised as a command of its own. A hand-written expected list was rejected: it
would be a fourth spelling of the same domain, drifting like the other three.

The AST rather than a regex, because a regex also matches `cmd === "x"` inside a
comment, and an oracle a code comment can fool is not one. And the scanner is
**checked before it is trusted** — the first test asserts it found a dispatch of
plausible size, because a scan that silently returned `[]` would compare two empty
sets, pass, and report perfect agreement with nothing. That is this harness's
signature defect and it does not get a free pass for living inside the harness.

### Index vs detail: completeness and depth are different debts

The generated block is an **index** — name, argument shape, one line, all 31 of
them. The reasoning stays authored below it under **In detail**, and is *not*
expected to cover every command. Completeness is what a derivation owes; depth is
what prose owes; the section that drifted three times was trying to be both.

Two smaller consequences of taking the advice seriously:

- the block is a **bullet list, not a table** — `redundancy` reads a markdown
  table's first column as an enumerated domain, so a generated table would have
  handed it a fresh README↔dispatch pair. A generated block the project's own
  detector still flags has fixed nothing.
- the block carries **no timestamp**, so its freshness gate is a byte-for-byte
  compare with *nothing* normalized away. Every normalization a gate needs is a
  hole in it.

**Measured, after:** `coherence redundancy` goes from 42 candidate pairs to 37 —
five removed, **zero added**. The banner/dispatch pair is gone from the pair set
entirely, not demoted below the reporting floor.

`docs --check` treats an absent README fence pair as *not owned*, not as stale:
`docs` runs in every consuming project, and a gate that fails on a file the project
never opted into is a gate that gets switched off wholesale. It is not silent about
it — `coherence docs` prints the marker pair to paste.

---

## v0.14.0 — the advisories get to ask

0.13.0 gave the journal a record for a suspicion. It then wired exactly one
generator. `coherence observed` wrote conjectures; `verify`, `redundancy`,
`novelty`, `drift`, `why-lint`, `conventions`, `atlas` and `contracts` wrote
zero — while every one of them already *forms* a suspicion and throws it away by
printing it. Redundancy's own words: *"the two spellings ALREADY disagree —
either the difference is intended (say so), or one side drifted."* That is a
conjecture with two candidates, scrolled past once per run forever.

### `--raise` — an advisory opens a question instead of printing one

    coherence redundancy --raise
    coherence verify --raise [--raise-cap N]

**The identity problem is the whole feature.** `observed` dedupes on a label the
caller supplies; an advisory has nobody to ask and must derive identity *from the
finding*. Too volatile and every run mints a new question; too coarse and two real
findings collapse, the second one silently. The rule: **the key is the finding's
SUBJECT** — for a redundancy pair, the pair of sites; for a never-red claim, the
node and the claim text. Excluded, deliberately: the score (redundancy's `df` is
global, so an unrelated file re-ranks every pair in the repo), the run count
(changes every run by construction, and it is the field that makes a finding feel
urgent), and the line number (navigation, never structure).

**Three volume layers, because a first run that opens two hundred questions kills
the mechanism on contact.** Opt-in — raising *writes*, and a surprising write gets
a feature switched off rather than tuned. The advisory's own reporting floor —
`redundancy --all` drops the score floor to expose the tail, and raising ignores
that (42 pairs shown on this repo, 7 eligible). And a per-run cap of 3 that names
what it withheld, per advisory.

Dogfooding refuted the first cap design immediately: strict priority order left
every warned-kind question queued behind twelve never-red ones, on the one project
whose config declares that kind the suspect one. The cap is now spent round-robin.

### `dismiss` — we decided not to ask

    coherence dismiss <id> --because "<why this is not worth chasing>"

The escape valve, and it has to be as cheap as `resolved` or the noisy question
stays and the whole `--open` list gets skipped. It is **not** a resolution: "we
answered this" and "we decided not to ask" are different facts, so a dismissal is
its own record kind, its own bucket, and its own section — *"Dismissed — NOT WORTH
CHASING (no answer was found; none was sought)"*. An append like everything else.
A dismissed finding is never raised again; a **retracted** one may be, because a
retraction claims the observation was never real and a detector that keeps
producing it is evidence against the retraction.

Precedence: retraction > resolution > dismissal.

---

## v0.13.0 — the abductive turn

Everything before this release answers a question somebody already asked. This one
is the first attempt at the other half: noticing that a question is owed.

### `conjecture` / `resolved` — what an agent WONDERED

The journal recorded `decide` (a choice made), `blocked` (could not determine) and
`retract`. Nothing recorded a suspicion.

    coherence conjecture "<the surprising observation>" \
      --could-be "<explanation>" --discriminated-by "<the test that separates them>"
    coherence resolved <id> --because "<what the test showed>" --as "<which won>"

Three properties do the work. **`[instrument] the instrument is wrong` is injected
as a candidate whether or not the author supplies it** — it is the highest-prior
explanation for a surprising measurement and the one people skip. **An unresolved
conjecture is loud**: its own section, its own count, capitalised, because a
question someone stopped asking must not look like one they answered. And
resolution is an append that crosses session files, so the agent who settles a
question need not be the one who raised it.

### `redundancy` — the parity claims nobody wrote

`parity … over <domain> between <fnA> and <fnB>` already existed, but it is
DECLARED: somebody had to already suspect two things should agree. This finds the
complement — one enumerated domain spelled in more than one place, with nothing
tying the spellings together — and ranks what it finds.

Against this repo: 147 domain sites, 41 overlapping pairs, 5 above the reporting
floor, 14 suppressed as compiler-enforced. It flagged the CLI usage banner and the
command dispatch chain as "identical today, tied together by nothing." An hour
later two feature branches both hand-edited that banner and produced the only merge
conflict of the release. The detector was right, on this repo, about this repo,
before it happened.

### `observed` — a moved metric that nobody explained becomes a question

    coherence observed "<label>" --value <n> --baseline <n> --threshold <n> [--why "…"]

Inside the band, silence. Outside with a `--why`, the explanation lands in the
journal instead of only in a source file. **Outside with no explanation, it opens a
conjecture** — so a harness that noticed something hands coherence a question rather
than printing to a terminal that scrolls away.

Deduped on LABEL, not on content: a metric that sits outside its band for ten runs
produces one open question, not ten. A metric drifting back inside its band does NOT
auto-resolve, because a number wandering back is not an explanation.

**The division of labour this settles:** the project owns what counts as notable —
that is domain knowledge, a physics `notableDelta` — and coherence owns what happens
when something notable goes unexplained.

### `.coherence/` is no longer gitignored

Found by dogfooding: this repo was ignoring the exact folder its own README tells
consumers to commit, so the decision journal it had just written about itself was one
clean checkout from gone. Now split — `verify-jobs.json` stays ignored because it is
genuinely a cache; `decisions/` and `status.json` are the record and are tracked.

356 tests.


## A note on v0.10.0

**There is no v0.10.0, and there is no tag for it.** The version in
`package.json` went from `0.9.0` straight to `0.10.1` in a single commit
(`0002271`). No commit reachable from any ref has ever carried version `0.10.0`.

If you are looking for "the 0.10.0 features", they are in **v0.10.1** below — it
is the first release of the 0.10 line, not a patch on one. The 0.10.1 commit
message refers in passing to how things behaved "in 0.10.0"; treat that as a
reference to 0.9.0 behaviour.

---

## v0.12.0 — cap the labels, never the evidence

**Tag:** `v0.12.0` · **Commit:** `0e87378`

### What changed

**A soft length cap on decision titles, and nothing else.** Journal entries have
three text fields: `chose` (what you picked), `over` (what you rejected), and
`because` (why). A 250-character cap across all three was proposed. Rather than
guess, it was measured against a real 53-entry journal, and the answer turned out
to differ per field:

- `chose` and `over` are already short — median 149 and 94 characters, with only
  5 of 107 values over 250. The handful that run long are entries where an agent
  crammed its reasoning into the title, so a nudge genuinely helps.
- `because` is long by design — median 609 characters, and **all 53 entries**
  exceeded 250. Capping it would have deleted 16 of 23 `file:line` citations and
  22 of 33 measured numbers, because **the evidence in a rationale sits at the
  end, after the claim**. A uniform cap would have cut the journal roughly in
  half (46,397 → 26,784 characters) by removing the half that makes it worth
  keeping — turning entries you can check into entries you can only take on
  faith.

The result: a soft cap of 200 characters on `chose` and `over` only. It prints a
warning to stderr and **writes the entry anyway**. Nothing is ever truncated on
write. The reasoning is that a journal which can reject a write is a journal an
agent abandons mid-job, and the entry it gives up on is the one it was too busy
to reword — exactly the one worth having.

**`coherence decisions --brief`.** Readability is a display problem, so it is
solved at display time. `--brief` clips each rationale on a word boundary and
**announces how much it withheld**, because a shortened rationale that looks
complete is worse than no rationale at all.

**Internal:** the test helper `runCaptured` now captures stderr separately, so a
notice that belongs on stderr can be asserted without polluting piped report
output.

### Upgrading

Nothing to do. No configuration, no format change. Long titles now produce a
stderr warning that does not affect the exit code.

---

## v0.11.2 — the markdown digest nests its detail lines

**Tag:** `v0.11.2` · **Commit:** `3af2625`

A display fix. In the markdown digest, the `- over: ...` line was rendered at the
same indentation as the decision it belongs to, so it read as a *separate
decision*. On a 230-line digest that is the one misreading this format cannot
afford, since the entire point of `over` is that it qualifies something else.
Detail lines are now nested under their parent.

---

## v0.11.1 — `hooks --check`, because a dead hook is silent

**Tag:** `v0.11.1` · **Commit:** `357e306`

### The problem

The first real-world test of the hook path in v0.11.0 failed with no signal
whatsoever. The settings block was present and well-formed. Running
`coherence hook SubagentStart` by hand emitted correct JSON. And the subagent
received nothing at all. Some harnesses simply do not execute project hooks, and
a hook that is never invoked cannot report that fact about itself.

A mechanism that looks installed and quietly does nothing is precisely the class
of defect this tool exists to catch, so it needed catching here.

### What changed

`coherence hooks --check` distinguishes three states, because each needs a
different fix:

1. **Not configured** — no hook block in settings.
2. **Configured but never fired** — the dangerous one, previously invisible.
3. **Firing** — working normally.

The detection is structural rather than heuristic: only the hook itself calls
`openSession()`, so a journal that has entries but **zero hook-opened sessions**
proves every entry was logged by an agent that was told to by hand.

For the dead case, the output prints a throwaway `PostToolUse` experiment that
settles the question either way, and states plainly that the journal still works
without the hook — `decide` is an ordinary command you can always call directly.

---

## v0.11.0 — the decision journal

**Tag:** `v0.11.0` · **Commit:** `c6d4de3`

### The problem

Five subagents at 400k tokens each generate more context than anything can read.
The report each one hands back is written by the agent that did the work, so it
records what was **concluded** and never what was **considered and discarded**.
The raw transcript contains that information and is unreadable; the report is
readable and has thrown it away.

This release is the third option: each agent writes one line per decision *as it
makes it*, and whoever is coordinating reads the merged journal.

### What changed

Four new commands:

| Command | Purpose |
| --- | --- |
| `coherence decide` | Record a choice: what you chose, what you rejected, why |
| `coherence blocked` | Record what you could **not** do — first-class, not a footnote |
| `coherence retract` | Withdraw an earlier decision by appending, never by editing |
| `coherence decisions` | Read the merged timeline across agents, jobs and branches |

The unit of record is a **decision** — a point where the work could have gone
more than one way and someone picked. An earlier draft had seven event types
(`OBSERVED`, `INFERRED`, `ASSUMED`, and so on); that was the wrong granularity,
because most of those are noise at the scale where context is actually lost.

**Two fields carry the value.** `over` — what was rejected — is what stops the
next agent re-litigating a settled question. And **status**: a retraction is an
*append* that points at what replaced it, and it can cross session files, because
one agent withdrawing another agent's verdict is the single most valuable event
in a parallel fan-out. An empty `over` renders explicitly as "(nothing — forced,
or no alternative considered)", so that a forced choice and an unexamined one do
not look alike.

### How it is stored

**One append-only file per agent session**, with the session id minted by the
hook. Two branches merge cleanly because distinct filenames never collide — a
single shared JSONL file conflicts on every parallel branch, which is exactly the
situation several concurrent agents create. Attribution is structural: the file
*is* the session. `coherence decisions` merges every file into one timeline.

Concurrency was measured before any of it was built: `appendFileSync` with 8
concurrent writers × 300 lines, at sizes from 200 B to 64 KB, gave 2400/2400
lines intact, 0 torn, 0 missing. The same probe run against a
read-then-write-at-offset writer lost 1242 of 2400 — so the probe can detect loss
when loss exists, and the clean result is not a blind control. There is no lock,
deliberately: a lock is something several agents can deadlock on.

### Two design commitments worth knowing

**It is a CLI, not an MCP server.** An MCP tool's schema is loaded into the
context of every agent that might call it — paid on every turn, whether a
decision gets logged or not. A mechanism that spends context in order to save
context defeats itself.

**It gates nothing.** The stop hook reports and never blocks. The moment this can
fail a build, it acquires an incentive to be *complete* — and a complete journal
is just a transcript again.

### Upgrading

Purely additive. Run `coherence hooks` to print the settings block that mints
session ids automatically, then `coherence hooks --check` (v0.11.1+) to confirm
it actually fires.

---

## v0.10.2 — spec intent is the first paragraph, not the first line

**Tag:** `v0.10.2` · **Commit:** `2d2254d`

### What changed

Specs are hard-wrapped at 80 columns, and `parseSpec` read exactly one line — so
every component intent longer than one line was silently chopped mid-clause. That
fragment is what the generated CLAUDE.md component map, the outline, the panel
and the scene all display. Since CLAUDE.md is loaded into the system prompt of
every run, the truncation was permanently resident noise in every agent's
context.

Observed on a consumer project: an intent rendering as *"The player's half of the
program: the four priced verbs (`tools.ts`), the one"* — ending on "the one".

Intent is now read as the first **paragraph**. `intentLine` marks the last line
consumed, so the prose scan still begins after the intent rather than re-reading
its tail.

### Also in this range: the kinded-claim parse bug (`09b7c40`)

This is the most consequential fix of the 0.10 line, and it is easy to miss
because it shipped **under the 0.10.1 version number, after the v0.10.1 tag**.
If you are bisecting, it lives in `v0.10.1..v0.10.2`.

The first implementation of claim kinds stripped the trailing `[kind]` suffix
inside `evalClaim`. Verification graded correctly, so it looked right. But
`BOUNDARY_RE` is anchored with `$`, and **every other consumer reads the raw
claim string**. The consequence: `parseBoundary` returned `null` for every kinded
claim, silently emptying the generated CLAUDE.md invariant table, the promise
graph, the panel and the scene.

Concretely: `parseBoundary(claim)` parsed, while
`parseBoundary(claim + " [structural]")` returned null. On one consumer project,
`coherence graph` went from 5 stale boundary rows to 17 once fixed. Verification
stayed green the entire time — which is exactly why nobody noticed, since the one
gate that stripped the suffix was the one gate watching.

The strip now happens in `parseSpec`: `claims` holds the bare text and the kind
travels alongside in `claimKinds`. Every downstream consumer therefore sees the
same string it saw before kinds existed, **including the status record's
identity** — so annotating an existing claim with a kind does not orphan its
history.

That commit also added `Kind` and `Refuted?` columns to the generated CLAUDE.md
invariant table, appearing only when a project actually uses those features. And
`coherence scaffold` emits an empty `## refutations` section with the format in a
comment — a pre-filled TODO would score as covered, which is the exact deception
the section exists to remove.

---

## v0.10.1 — claim kinds, refutations, and sticky red history

**Tag:** `v0.10.1` · **Commit:** `0002271`
*(First release of the 0.10 line. See the note above: v0.10.0 never shipped.)*

### Why

A consumer project — a chaotic simulation — hit the seam in this tool's premise.
Coherence exists to prevent behavioural **drift**; but on a system whose current
behaviour is itself a guess, preventing drift and locking in a bug are the same
act seen from two sides. That project's own evidence: seven seeds pinned at
2.99–3.00% land with every gate green, and a test that convicted the code for
getting *better*.

Three additions answer that, **all off by default**. A project that configures
none of them parses and grades exactly as it did in 0.9.0.

### Claim kinds

A claim may carry a trailing `[kind]`, for example:

```
the tick length is exact and bounded at every rung [mathematical]
```

The project declares which kinds exist and what each one's policy is, in
`claimKinds`. Coherence holds no opinion about which kinds *should* exist.

- `pin` — gates as usual.
- `warn` — still gates, but is reported on every run together with the project's
  own stated reason, so a category the project distrusts cannot be used quietly.
- An **undeclared kind fails the run**, so that a typo cannot silently grade as
  an unkinded claim.

The suffix is stripped in exactly one place before form matching, so no claim
form's grammar changes.

### Refutations

A `## refutations` section records, per invariant, the experiment that actually
made it go red — you break the chokepoint, run the oracle, and write down what it
said.

Verification **reports the gap but cannot fail on it**. A refutation is something
you *did*, and the harness has no way to know whether you did it. The section
exists because a green claim and an unfalsifiable claim are indistinguishable
from the outside, and only one of them is evidence.

### Sticky red history

`everFailed` is set the first time a claim goes red and is **never cleared**,
alongside `lastFailAt`, `lastFailCommit`, and a `runs` counter that a skipped run
does not advance.

From this comes the **never-red advisory**: green on every run, never once red,
and no recorded refutation. That combination is equally the signature of a claim
that nothing can break.

Advisory lists are capped at 8 entries with the overflow **announced**. The first
cut printed 17 advisory lines per run against a real project, which is how an
advisory becomes wallpaper.

### Upgrading

Nothing is required. To adopt:

1. Declare your kinds and their policies in `claimKinds` in your config.
2. Add `[kind]` suffixes to claims as you touch them.
3. Add a `## refutations` section to a spec (`coherence scaffold` emits an empty
   one).
4. Commit `.coherence/status.json` — added in `b012a54`. Without it in the repo a
   fresh clone starts with no history, nothing has ever been red, and the
   never-red advisory stays silent forever. On a merge conflict, keep the higher
   `runs` and `everFailed: true` if either side has it; both fields only ratchet.

**Do not upgrade to `v0.10.1` exactly if you use kinded claims** — see the parse
bug under v0.10.2 above. Use `v0.10.2` or later.
