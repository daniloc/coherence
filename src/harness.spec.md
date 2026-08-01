# Harness core

Builds the source/spec graph, evaluates declared claims, renders reading surfaces, and
records the decisions and observations that must survive an agent's context window.

The CLI is deliberately a thin composition root. Parsing, derivation, verification,
rendering, and journaling remain independently addressable modules beneath this boundary.

## invariants

- agent lifecycle preserves decisions and exposes the current change signal
- significant behavioral growth acquires an anchor or patch-specific decision
- task context is bounded and names its approximations
- cached decisions expose structurally expired premises
- predicted context closure is calibrated against observed reads and outcomes
- reviewed risk sites survive relocation but never duplication
- pinned mass follows a value-conserving rename but never absorbs growth
- a claim goes green only on positive evidence its oracle ran
- a vanished oracle reds its claim, never green-by-absence
- a declared invariant unanchored by any boundary fails coverage
- a via-test oracle that iterates no live domain fails its claim
- a skipped run never clobbers an oracle's recorded verdict
- a named oracle that no test runs cannot pass
- an empty derivation against a remembered surface refuses, never passes

## refutations

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
- an empty derivation against a remembered surface refuses, never passes: mutated BOTH ends (2026-07-31). (a) gutted `buildGraph` to return an empty graph — the original defect, which before the floor printed `claims: 0 · 0 green · 0 red · 0 skipped` and `✓ coherent`, exit 0: now full verify refuses before grading (`✗ [floor] the derived graph is EMPTY of claims — 0 component(s), 0 claims — but the record remembers 27 claim(s)`), exit 1, on the scoped path too, and the record is left un-clobbered so the refusal repeats. (b) made `vacuityRefusal` return null unconditionally — the floor itself deleted: full verify red BY NAME, `claims: 28 · 27 green · 1 red`, this claim failing through its guard. Restored, 28/28. (b) is the direction that matters: a floor that cannot fail is the vacuity it exists to catch.

## works when

- cli.ts imports ./config.ts
- cli.ts imports ./derive.ts
- cli.ts imports ./verify.ts
- hooks.ts imports ./decisions.ts
- derive.ts imports ./walk.ts
- boundary "agent lifecycle preserves decisions and exposes the current change signal" at runHook via guard "hooks — generated wiring uses the low-cost entrypoint and observes writes"
- boundary "significant behavioral growth acquires an anchor or patch-specific decision" at signal via guard "only a zero-anchor alarm without attestation needs a decision"
- boundary "task context is bounded and names its approximations" at contextFor via guard "renderContext — byte-stable for the same inputs and names every approximation"
- boundary "cached decisions expose structurally expired premises" at auditPremiseLeases via guard "audit — retracted decisions disappear and only broken strong leases fail a check"
- boundary "predicted context closure is calibrated against observed reads and outcomes" at calibrate via guard "calibration reports coverage, outside reads, and defect rates by prediction misses"
- boundary "reviewed risk sites survive relocation but never duplication" at reconcile via guard "sinks — a moved file keeps its baselined identity and a genuinely new site still fails"
- boundary "pinned mass follows a value-conserving rename but never absorbs growth" at reconcileMass via guard "mass — a renamed component keeps its pin; growth and novelty are never absorbed"
- boundary "a claim goes green only on positive evidence its oracle ran" at execNamedTest via guard "testMatch — a runner exiting 0 with no matching output FAILS (the renamed-test trap)"
- boundary "a vanished oracle reds its claim, never green-by-absence" at resolveFromBatch via guard "match — ZERO matching tests is its OWN state: the vanished oracle, named as such"
- boundary "a declared invariant unanchored by any boundary fails coverage" at runVerify via guard "RATCHET — a declared invariant with no anchoring boundary fails coverage"
- boundary "a via-test oracle that iterates no live domain fails its claim" at analyzeOracle via guard "META-ORACLE — a `via test` boundary whose oracle loops a LITERAL fails"
- boundary "a skipped run never clobbers an oracle's recorded verdict" at recordVerify via guard "merge — a skip never clobbers a real verdict; the old verdict rides through with its own stamp"
- boundary "a named oracle that no test runs cannot pass" at runNamedTest via guard "runner contract — a name that exists nowhere exits nonzero (the vanished oracle cannot pass)"
- boundary "an empty derivation against a remembered surface refuses, never passes" at vacuityRefusal via guard "FLOOR — an empty derivation against a remembered surface REFUSES, never reports coherent"

## why

**agent lifecycle preserves decisions and exposes the current change signal.** Decisions
and risk are cheapest to surface while the agent still holds the context that produced
them; waiting for a later reviewer externalizes both reconstruction costs.

**significant behavioral growth acquires an anchor or patch-specific decision.** The cost
of adding an invariant is immediate while the cost of omitting it appears later, so the
current patch must carry either enforcement or an addressable reason that it needs none.

**task context is bounded and names its approximations.** A focused context packet is
useful only when its one-hop and heuristic limits stay visible; otherwise convenience is
misread as completeness and recreates the omission gradient this project exists to oppose.

**cached decisions expose structurally expired premises.** A decision saves inference only
while the repository addresses supporting it remain live. Broken explicit referents must
be louder than readable but stale rationale.

**predicted context closure is calibrated against observed reads and outcomes.** Economy's
one-hop closure is a hypothesis about necessary reading, not cognition. Observed reads and
later defect labels give that model a path to correction instead of turning it into dogma.

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

(The import claims above separately prove that the composition root still reaches the
configuration loader, graph derivation, verifier, spec walker, and journal.)
