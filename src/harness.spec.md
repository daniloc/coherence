# Harness core

Builds the source/spec graph, evaluates declared claims, renders reading surfaces, and
records the decisions and observations that must survive an agent's context window.

The CLI is deliberately a thin composition root. Parsing, derivation, verification,
rendering, and journaling remain independently addressable modules beneath this boundary.

## invariants

- agent lifecycle preserves decisions and exposes the current change signal
- significant behavioral growth acquires an anchor or patch-specific decision
- a weaker regulation obligation never masks a stronger one
- regulation evaluates and repairs the selected agent host
- task context is bounded and names its approximations
- cached decisions expose structurally expired premises
- predicted context closure is calibrated against observed reads and outcomes
- calibration preserves the weakest host attribution of its trace
- reviewed risk sites survive relocation but never duplication
- pinned mass follows a value-conserving rename but never absorbs growth
- a claim goes green only on positive evidence its oracle ran
- a vanished oracle reds its claim, never green-by-absence
- a declared invariant unanchored by any boundary fails coverage
- a via-test oracle that iterates no live domain fails its claim
- a skipped run never clobbers an oracle's recorded verdict
- a named oracle that no test runs cannot pass
- an empty derivation against a remembered surface refuses, never passes
- lifecycle hook presence is one canonical runnable bit
- supported lifecycle hosts share one control contract without sharing host syntax
- current-session activation requires exact installed-bundle evidence
- customized hook text composes declared overrides and appends, degrading to canon on damage
- python sources feed the same instruments as typescript at their declared regex grade
- experiment outcomes require criterion-total evidence
- experiment telemetry preserves its weakest provable attribution
- activity evidence is accepted only when identity, scope, time, and command agree
- a streamed journal entry renders exactly once across appends and compaction

## refutations

- a weaker regulation obligation never masks a stronger one: swapped `candidateCompare` from potential-first to doctrine-rule-first (2026-08-04), so the earlier lifecycle-control redirect masked the stronger current-patch decision when both were owed — full verify red by name, alongside the independent Stop mutation, at `claims: 32 · 30 green · 2 red`; the guard observed `redirect` where `require-decision` was required. Restored. This is the dangerous direction: a stable ordering that is stable on the wrong axis still makes the controller converge on lower-value work.
- agent lifecycle preserves decisions and exposes the current change signal: inserted an `emit` immediately after main Stop's calibration snapshot (2026-08-04), recreating the conclusion-echo failure and the deeper attribution error — shared-worktree state bought whichever main agent happened to stop another model turn. Full verify red this claim by name at `claims: 32 · 31 green · 1 red`; the runtime guard observed nonempty stdout even for the quiet main Stop. Restored. SubagentStop still restates because its parent may see only the final reply; main Stop now snapshots calibration with byte-empty stdout.
- lifecycle hook presence is one canonical runnable bit: loosened `inspectLifecycleHook` so `present` ignored `wiringPresent` and trusted only valid JSON plus the launcher (2026-08-03) — full verify named this claim as the sole red, `claims: 30 · 29 green · 1 red`; the guard's duplicate-canonical-group fixture observed the laundered `true`. Restored. This is the dangerous direction: a checker that accepts two firing paths is not a binary control, only a substring detector with a nicer report.
- pinned mass follows a value-conserving rename but never absorbs growth: mutated `reconcileMass` in BOTH directions (2026-07-31) and full verify reds the claim by name each time. (a) `const hit = undefined` — the pre-fix behaviour where a rename never absorbs: `claims: 27 · 26 green · 1 red`, the H1-rename phase failing on strictEqual (a one-line spec rename read as growth again). (b) dropped the VALUE from the move-invariant address so any same-family vanished pin absorbs any new name — the laundering direction: same `27 · 26 green · 1 red`, the renamed-AND-grown phase failing on match (the growth rode in under the rename and the guard caught the missing NEW-dimension report). Restored, back to 27/27. As with the sinks reconciler, (b) is the direction that matters: a rename-forgiver that cannot fail is a growth ratchet that deleted itself.
- reviewed risk sites survive relocation but never duplication: mutated `reconcile` in BOTH directions and the guard reds each time. (a) `const from = undefined` — the pre-fix behaviour where the path is part of a site's identity: `claims: 23 · 22 green · 1 red`, the moved file reported as new risk. (b) absorb from every baselined address instead of only vanished ones, without consuming the pool — plain content-addressing: same `1 red`, the copied sink waved through. Restored, back to 23/23. The loosening direction is the one that matters: a fix for a false alarm that cannot fail (b) is a fix that deleted the ratchet.
- cached decisions expose structurally expired premises: gutted `auditPremiseLeases` to return `{entries: [], expired: [], checked: 0}` unconditionally — the SAME mutation that left the tree "✓ coherent" while the claim carried no oracle. With the guard wired it reds by name: `claims: 22 · 21 green · 1 red`, `✗ 1 coherence failure(s)`. Restored, back to 22/22. The other four claims now execute (137ms, 135ms and siblings in the holding-cost block) but have not yet been individually mutated — that is the next increment, not a claim made here.
- predicted context closure is calibrated against observed reads and outcomes: hardcoded `calibrationStats`' defect count to `defects: 0` (audit M1, re-run 2026-07-31) -> full verify RED by name, `claims: 23 · 22 green · 1 red`, the calibration guard failing on strictEqual. Restored, back to green.
- significant behavioral growth acquires an anchor or patch-specific decision: made `signalState` return `"attested"` for an unattested zero-anchor alarm (audit M2, re-run 2026-07-31) -> full verify RED by name, `claims: 23 · 22 green · 1 red`, the zero-anchor guard failing. Restored, back to green. The SAME mutation left `verify --fast` "✓ coherent" and `npm test` 589-pass when the guard's test was merely RETITLED (audit M4) — which is why CI now runs the full tier.
- a claim goes green only on positive evidence its oracle ran: deleted the testMatch evidence rule from the serial arm — the audit-M3 mutation that previously left the tree 23/23 "✓ coherent" with the anti-vacuity mechanism gone -> now `claims: 26 · 25 green · 1 red`, this claim red by name. Restored, 26/26.
- a vanished oracle reds its claim, never green-by-absence: made zero batch matches return `ok: true` -> `claims: 26 · 25 green · 1 red`, this claim red by name. Restored, 26/26.
- a declared invariant unanchored by any boundary fails coverage: wrapped the gap-collection loop in `if (false)` -> `claims: 26 · 25 green · 1 red`, this claim red by name. Restored, 26/26.
- a via-test oracle that iterates no live domain fails its claim: flipped the self-literal domain branch to report `live` -> `claims: 26 · 25 green · 1 red`, this claim red by name. Restored, 26/26.
- a skipped run never clobbers an oracle's recorded verdict: made the merge take the fresh skip unconditionally -> `claims: 26 · 25 green · 1 red`, this claim red by name. Restored, 26/26.
- a named oracle that no test runs cannot pass: made the no-owning-file branch exit 0 -> `claims: 26 · 25 green · 1 red`, this claim red by name (the guard test, run by the mutated runner itself, observed the quiet pass). Restored, 26/26.
- a streamed journal entry renders exactly once across appends and compaction: deleted the `seen` dedupe from `tailJournal`'s parse loop — every parsed line pushed unconditionally, so a compaction fold replays its whole record set (2026-08-04) — full verify red BY NAME, `claims: 31 · 30 green · 1 red`, this claim failing through its guard (the fold fixture observed the replay). Restored, back to 31/31. This is the loosening direction and the quiet one: a feed that duplicates does not crash, it just teaches the orchestrator that a question was decided twice — the exact lie the content address exists to prevent.
- an empty derivation against a remembered surface refuses, never passes: mutated BOTH ends (2026-07-31). (a) gutted `buildGraph` to return an empty graph — the original defect, which before the floor printed `claims: 0 · 0 green · 0 red · 0 skipped` and `✓ coherent`, exit 0: now full verify refuses before grading (`✗ [floor] the derived graph is EMPTY of claims — 0 component(s), 0 claims — but the record remembers 27 claim(s)`), exit 1, on the scoped path too, and the record is left un-clobbered so the refusal repeats. (b) made `vacuityRefusal` return null unconditionally — the floor itself deleted: full verify red BY NAME, `claims: 28 · 27 green · 1 red`, this claim failing through its guard. Restored, 28/28. (b) is the direction that matters: a floor that cannot fail is the vacuity it exists to catch.

## works when

- typechecks
- cli.ts imports ./config.ts
- cli.ts imports ./derive.ts
- cli.ts imports ./verify.ts
- hooks.ts imports ./decisions.ts
- derive.ts imports ./walk.ts
- boundary "agent lifecycle preserves decisions and exposes the current change signal" at runHook via guard "hooks — main Stop snapshots without feedback while SubagentStop alone restates"
- boundary "significant behavioral growth acquires an anchor or patch-specific decision" at signal via guard "only a zero-anchor alarm without attestation needs a decision"
- boundary "a weaker regulation obligation never masks a stronger one" at selectRegulation via guard "regulate — ordered potential is permutation-invariant and monotone"
- boundary "regulation evaluates and repairs the selected agent host" at observeRegulation via guard "regulate — selected Codex host cannot be redeemed by Claude control"
- boundary "task context is bounded and names its approximations" at contextFor via guard "renderContext — byte-stable for the same inputs and names every approximation"
- boundary "cached decisions expose structurally expired premises" at auditPremiseLeases via guard "audit — retracted decisions disappear and only broken strong leases fail a check"
- boundary "predicted context closure is calibrated against observed reads and outcomes" at calibrate via guard "calibration reports coverage, outside reads, and defect rates by prediction misses"
- boundary "calibration preserves the weakest host attribution of its trace" at calibrationPaths via guard "calibration keeps Codex parent-only writes aggregate and legacy rows unscoped"
- boundary "reviewed risk sites survive relocation but never duplication" at reconcile via guard "sinks — a moved file keeps its baselined identity and a genuinely new site still fails"
- boundary "pinned mass follows a value-conserving rename but never absorbs growth" at reconcileMass via guard "mass — a renamed component keeps its pin; growth and novelty are never absorbed"
- boundary "a claim goes green only on positive evidence its oracle ran" at execNamedTest via guard "testMatch — a runner exiting 0 with no matching output FAILS (the renamed-test trap)"
- boundary "a vanished oracle reds its claim, never green-by-absence" at resolveFromBatch via guard "match — ZERO matching tests is its OWN state: the vanished oracle, named as such"
- boundary "a declared invariant unanchored by any boundary fails coverage" at runVerify via guard "RATCHET — a declared invariant with no anchoring boundary fails coverage"
- boundary "a via-test oracle that iterates no live domain fails its claim" at analyzeOracle via guard "META-ORACLE — a `via test` boundary whose oracle loops a LITERAL fails"
- boundary "a skipped run never clobbers an oracle's recorded verdict" at recordVerify via guard "merge — a skip never clobbers a real verdict; the old verdict rides through with its own stamp"
- boundary "a named oracle that no test runs cannot pass" at runNamedTest via guard "runner contract — a name that exists nowhere exits nonzero (the vanished oracle cannot pass)"
- boundary "an empty derivation against a remembered surface refuses, never passes" at vacuityRefusal via guard "FLOOR — an empty derivation against a remembered surface REFUSES, never reports coherent"
- boundary "lifecycle hook presence is one canonical runnable bit" at inspectLifecycleHook via guard "control — presence is the complete canonical bundle, never a partial or lookalike"
- boundary "supported lifecycle hosts share one control contract without sharing host syntax" at setLifecycleHookForHost via guard "Codex control — install is exact, idempotent, preserving, and runnable across nested paths"
- boundary "current-session activation requires exact installed-bundle evidence" at currentObservation via guard "hook status — exact current bundle activates; stale, direct, replayed, and damaged evidence does not"
- boundary "customized hook text composes declared overrides and appends, degrading to canon on damage" at composeHookText via guard "hook text — override replaces, append follows, and damage degrades to the canonical emission"
- boundary "python sources feed the same instruments as typescript at their declared regex grade" at surfaceOfSource via guard "python surface — module defs, enum variants, and dict keys count; underscore and nested names do not"
- boundary "python sources feed the same instruments as typescript at their declared regex grade" at analyzeParityOracle via guard "python parity — a .py oracle that iterates the live domain passes; a literal list fails; a vanished oracle cannot pass"
- boundary "python sources feed the same instruments as typescript at their declared regex grade" at sitesOfPython via guard "python redundancy — two spellings of one domain in .py rank as a candidate; declared parity and idiom do not"
- boundary "python sources feed the same instruments as typescript at their declared regex grade" at resolveFromBatch via guard "pytest batch — nodeid names resolve per claim, zero matches is the vanished oracle, and a torn report falls back loudly"
- boundary "python sources feed the same instruments as typescript at their declared regex grade" at lintSinks via guard "python sinks — an f-string into a SQL context is a site, a safe-pattern expression is not, and the ratchet reds the new site"
- boundary "experiment outcomes require criterion-total evidence" at closeExperiment via guard "close — total nonempty evidence is mandatory and outcome is derived, never supplied"
- boundary "experiment telemetry preserves its weakest provable attribution" at closeExperiment via guard "Codex parent-only tool events close the loop as an aggregate, never exact owner evidence"
- boundary "activity evidence is accepted only when identity, scope, time, and command agree" at isActivityRow via guard "activity — internally inconsistent scope, time, and command rows are damage, not evidence"
- boundary "a streamed journal entry renders exactly once across appends and compaction" at tailJournal via guard "tail — an appended record arrives exactly once, a compaction fold re-emits nothing and drops nothing, and a half-written line waits for its bytes"

## why

**agent lifecycle preserves decisions and exposes the current change signal.** Decisions
and risk are cheapest to surface while the agent still holds the context that produced
them; waiting for a later reviewer externalizes both reconstruction costs. The two stop
surfaces are not interchangeable: a subagent restates its report because its caller may
see nothing else, while the main agent has already shown its report to the user and is
never interrupted by shared-worktree state that may belong to another agent. Main Stop
keeps the calibration observation and emits no bytes; only SubagentStop carries the
journal and patch signal forward.

**significant behavioral growth acquires an anchor or patch-specific decision.** The cost
of adding an invariant is immediate while the cost of omitting it appears later, so the
current patch must carry either enforcement or an addressable reason that it needs none.

**a weaker regulation obligation never masks a stronger one.** Regulation compares live
obligations by a lexicographic potential, with missing observations failing closed instead
of becoming zero, and returns the single strongest action owed. V1 evaluates only rules
declared in the live doctrine registry; even a no-action result makes no claim of overall
safety.

**regulation evaluates and repairs the selected agent host.** A canonical Claude control
cannot create a field around a Codex session, even though both hosts implement the same
lifecycle domain. The sensor therefore names the explicit or current host in its reading,
the decision identity retains it, and a lifecycle redirect installs that same host. A
foreign host value refuses before it can release or author a shell command.

**task context is bounded and names its approximations.** A focused context packet is
useful only when its one-hop and heuristic limits stay visible; otherwise convenience is
misread as completeness and recreates the omission gradient this project exists to oppose.

**cached decisions expose structurally expired premises.** A decision saves inference only
while the repository addresses supporting it remain live. Broken explicit referents must
be louder than readable but stale rationale.

**predicted context closure is calibrated against observed reads and outcomes.** Economy's
one-hop closure is a hypothesis about necessary reading, not cognition. Observed reads and
later defect labels give that model a path to correction instead of turning it into dogma.

**calibration preserves the weakest host attribution of its trace.** A Codex parent
session file can contain parent and descendant tool use because PostToolUse supplies no
child id. Calibration may still compare that aggregate against a patch, but it must name
the aggregate rather than relabeling those writes as one agent's work. Legacy rows remain
unscoped, shared-worktree fallback remains separate, and any unreadable row prevents a
new sample instead of disappearing from its denominator.

**reviewed risk sites survive relocation but never duplication.** A ratchet baseline is a
cached review, and a cached fact that expires on a rename rots the same way a decision's
premises do — a refactor then spends a reviewer's attention on sites nobody touched, and
attention spent on false alarms is how a real one gets waved through. Relocation changes
where a reviewed site lives; duplication changes how much unreviewed surface exists, and
only the second is news.

**pinned mass follows a value-conserving rename but never absorbs growth.** A mass
dimension's key embeds a name someone chose — a spec H1, a measure's config key — so a
rename re-addresses the pin, and a ratchet that reads its own re-addressing as "gained
parts nobody named" prints a lie beside the unchanged total that refutes it (measured:
one H1 edit, 35 lines relabeled, zero gained, gate red). The repair must stay
count-conserving: only a vanished pin with the same family, unit and exact value can
absorb a new name, or growth and novelty would ride in under renames.

**a claim goes green only on positive evidence its oracle ran.** The verifier's whole
authority rests on this one property, and until now no claim cited it: an audit deleted
the rule and the tree stayed "✓ coherent" while the unit test failed unseen. An exit
code is the runner's statement about itself, not about the named test — a filter that
matched nothing exits clean on every runner class this repo has measured — so green
must require output that names the run, the one reading absence cannot produce.

**a vanished oracle reds its claim, never green-by-absence.** A renamed or deleted test
leaves a claim citing a name nothing owns, and that claim then guards nothing while
wearing green. Absence has to be its own observable verdict, distinct from ran-and-failed,
because the two demand different repairs: a red test needs the code fixed, a vanished
oracle needs the contract re-tied to something that exists.

**a declared invariant unanchored by any boundary fails coverage.** A spec may not
assert a property that nothing enforces: that is the ratchet the whole harness turns on,
and if it silently loosened, specs would drift back into aspiration prose. The gap has to
cost a red at the run that opened it, while the person who opened it still holds the
context to close it.

**a via-test oracle that iterates no live domain fails its claim.** A totality label on a
sampling test is worse than no label: it retires the reader's suspicion without retiring
the risk. Deriving the checked set from the live registry the chokepoint actually serves
is what makes "covers every case" a fact about the system rather than about the fixture
list the author remembered.

**a skipped run never clobbers an oracle's recorded verdict.** The record is the last
known truth, honestly dated. A fast tier that skips the executable claims every commit
would otherwise erase last week's real pass — or, worse, a real fail — with "did not
look", and history that can be overwritten by not looking is not history.

**a named oracle that no test runs cannot pass.** The serial runner is the component the
executable tier leans its trust on, and it was outside the evidence perimeter — unclaimed,
untested, and (measured) willing to exit clean when the cited title survived only as a
string in a file. The runner itself must refuse a name it cannot show ran, because every
green above it inherits that refusal.

**an empty derivation against a remembered surface refuses, never passes.** Every verdict
in this file rests on the graph deriving non-empty, and nothing checked that premise:
gutting `buildGraph` left the gate printing "claims: 0" and "✓ coherent", exit 0 —
deeper than a vanished oracle, because it empties every check at once while announcing
they all passed. The record remembers how many claims the last run graded, so a run that
suddenly sees zero must refuse rather than report success over nothing; the only
legitimate zero (a project adopting from nothing) is exactly the one with no memory, and
it gets the adoption ladder instead. The floor deliberately stops at zero: a partial
collapse where every component keeps a claim is observationally identical to deliberate
pruning, and deletion has to stay free or people stop deleting. What the complement
underneath it actually reaches is narrower than it first appears — a component stripped of
its claims is still a node someone can red, while a component the walk never discovered
leaves nothing behind to notice, so an N→1 slide reads as N ordinary prunings. Pinning the
population as a mass dimension is the honest answer there, because the question it settles
is not whether anything survived but whether as much survived as last time.

**lifecycle hook presence is one canonical runnable bit.** The control surface cannot
create a field if every repository is free to carry a merely similar—or silently dead—
hook. Printing, installation, and inspection therefore share one five-event value and
one stable launcher per host. Presence means exactly one shared project copy, no competing
local, inline, or legacy path, an aligned host/launcher root, a correct declared root
mapping, an enabled project-hook layer, and a runnable target. Unrelated hooks may coexist.
Historical journal activity is reported beside this bit but can neither redeem current
absence nor erase current presence.

**supported lifecycle hosts share one control contract without sharing host syntax.**
Claude and Codex expose the same five lifecycle meanings through different settings files,
matchers, launch commands, and response envelopes. Host parity therefore means deriving
each complete bundle from one host-selected domain while retaining a distinct fingerprint;
copying Claude bytes into Codex would be resemblance, not parity.

**current-session activation requires exact installed-bundle evidence.** Structural
presence proves that the project control is runnable, not that this session loaded it. A
session becomes observed only when its activity names the selected host, launcher
transport, and current bundle fingerprint. Direct probes, stale bundles, other sessions,
and a guessed newest session cannot establish activation; parent-session fallback stays a
named attribution ceiling rather than being promoted to child evidence.

**customized hook text composes declared overrides and appends, degrading to canon on
damage.** The canonical hook text is the harness's voice — identical across adopting
projects, and byte-testable because of it — but a project knows things the harness cannot:
its own commands, its conventions, the one warning its history taught it. So a project
gets a declared voice per event rather than a fork of the hook body, under one composition
rule with no conflict state: the override answers what the base is, the append answers
what follows it, and both may coexist; an empty override is a deliberate, visible silence,
not an error. Damage must degrade to the canonical emission at hook time, because the hook
body runs inside every agent session of every adopting project — a torn customization
file that broke sessions would make the journal's carrier the thing that kills the work it
records — so a tear costs exactly the customization, never the session, and the loud
surface for it is `hooks review`, where a reader is actually looking. Events with no
canonical emission — main Stop, PostToolUse — speak only with a declared project voice;
main Stop's canonical byte-silence and the attribution reasoning behind it stand unchanged
as the default.

**python sources feed the same instruments as typescript at their declared regex grade.**
The adapter seam always promised language-agnosticism, but three analyzers and two
scanners parsed TypeScript directly, so a python project's surface grew invisibly — the
zero-anchor alarm never fired, parity claims skipped `.py` oracles, duplicated domains
went unranked, batch oracles knew one report format, and f-string interpolations were not
sites. Each instrument now reads python at the same grade the adapters set deliberately:
regex and indentation, in-harness, no subprocess and no new parser dependency, following
the precedent `analyzePythonOracle` established. The grade is declared, not hidden —
precision is preferred over recall everywhere, because an advisory that cries wolf
retires the reader's attention without retiring risk, and with no compiler behind `.py`
a false positive can never be rescued downstream. What the regex grade deliberately does
not count is journaled beside each instrument, so the next reader inherits the boundary
of the instrument instead of rediscovering it.

**experiment outcomes require criterion-total evidence.** A
plan is frozen before work with its predicted context, actions, criteria, and evidence
cursors. Closure answers every action and criterion exactly once, preserves the assessor,
and derives success, failure, or inconclusive from criterion statuses rather than accepting
an outcome label. Otherwise the ledger would turn an incomplete story into a measured loop.

**experiment telemetry preserves its weakest provable attribution.** Trace and activity
windows may be empty, prove an exact owner session, or only prove a parent-session aggregate
that can include descendants; older trace may carry no observation metadata at all. Those
four scopes remain distinct in the immutable close record. Damaged prefixes, unreadable
rows, and unknown or inconsistent scope refuse. That keeps compatible history without
turning absence or uncertainty into false precision.

**activity evidence is accepted only when identity, scope, time, and command agree.** A
row is useful precisely because later status and experiment readers stop re-deriving the
host event. That cached inference is safe only while its relational fields still agree:
agent attribution names the row session, parent fallback names its parent domain, event
identity recomputes, time is canonical, and command kind/result agrees with name and exit
code. One strict reader grades that whole relation; malformed rows become counted damage,
never partially trusted evidence.

**a streamed journal entry renders exactly once across appends and compaction.** The live
stream exists for the one reader the settled render cannot serve — an orchestrator watching
five subagents mid-flight — and that reader has no way to audit the feed against the files.
A dropped entry is a decision the orchestrator never saw, indistinguishable from one never
made; a duplicate teaches the opposite lie, that a question was decided twice. Both are
cheap to produce, because the journal's files do not strictly grow: compaction moves lines
between files and unlinks the originals, which a position-addressed reader replays in full.
So a record's identity in the stream comes from its content — the same triple the merged
timeline sorts by — and a moved line is one the feed already carried.

(The import claims above separately prove that the composition root still reaches the
configuration loader, graph derivation, verifier, spec walker, and journal.)
