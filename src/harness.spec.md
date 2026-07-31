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

## refutations

- reviewed risk sites survive relocation but never duplication: mutated `reconcile` in BOTH directions and the guard reds each time. (a) `const from = undefined` — the pre-fix behaviour where the path is part of a site's identity: `claims: 23 · 22 green · 1 red`, the moved file reported as new risk. (b) absorb from every baselined address instead of only vanished ones, without consuming the pool — plain content-addressing: same `1 red`, the copied sink waved through. Restored, back to 23/23. The loosening direction is the one that matters: a fix for a false alarm that cannot fail (b) is a fix that deleted the ratchet.
- cached decisions expose structurally expired premises: gutted `auditPremiseLeases` to return `{entries: [], expired: [], checked: 0}` unconditionally — the SAME mutation that left the tree "✓ coherent" while the claim carried no oracle. With the guard wired it reds by name: `claims: 22 · 21 green · 1 red`, `✗ 1 coherence failure(s)`. Restored, back to 22/22. The other four claims now execute (137ms, 135ms and siblings in the holding-cost block) but have not yet been individually mutated — that is the next increment, not a claim made here.

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

(The import claims above separately prove that the composition root still reaches the
configuration loader, graph derivation, verifier, spec walker, and journal.)
