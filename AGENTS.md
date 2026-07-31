# wt — map for agents

> Generated from the spec tree by the coherence harness. Do not edit by hand.

The repository-level reading surface: configuration, package contract, generated maps, and the authored explanation of why the harness exists.

## Components

### Coherence  `.`
The repository-level reading surface: configuration, package contract, generated maps, and the authored explanation of why the harness exists.

_why:_ An agent should encounter the project's purpose and its ownership seams before source detail. The project hook wiring also records which repository reads informed a change and which decisions survived it. Keeping coordination separate from implementation makes that first read small while still checking that every deeper entry point is reachable. This spec once claimed five files existed at root; three were pruned rather than dressed up, because a root claim earns its line only when the failure it detects would otherwise be SILENT. `package.json`, `README.md`, and `src/cli.ts` fail loudly on their own — npm, the reader, and the CLI itself all scream within seconds of their absence — so claiming them was green weight that could never turn red for an interesting reason (the Known-limits section calls that spec "coherent and worthless"). The two claims kept are the ones whose absence the system absorbs without a sound: `loadConfig` falls back to defaults when `coherence.config.json` is missing (verify would silently run with no test runner, no serial pin, and the wrong testMatch), and a missing `.claude/settings.json` kills the journal hooks with no error at all — the exact silent-death mode `coherence hooks --check` exists to detect. Fewer claims, honestly scoped, is the trade this harness teaches; making its own root spec take it is the least it owes.

_works when:_
- coherence.config.json exists at root
- .claude/settings.json exists at root

### Harness core  `src`
Builds the source/spec graph, evaluates declared claims, renders reading surfaces, and records the decisions and observations that must survive an agent's context window.

_why:_ **agent lifecycle preserves decisions and exposes the current change signal.** Decisions and risk are cheapest to surface while the agent still holds the context that produced them; waiting for a later reviewer externalizes both reconstruction costs. **significant behavioral growth acquires an anchor or patch-specific decision.** The cost of adding an invariant is immediate while the cost of omitting it appears later, so the current patch must carry either enforcement or an addressable reason that it needs none. **task context is bounded and names its approximations.** A focused context packet is useful only when its one-hop and heuristic limits stay visible; otherwise convenience is misread as completeness and recreates the omission gradient this project exists to oppose. **cached decisions expose structurally expired premises.** A decision saves inference only while the repository addresses supporting it remain live. Broken explicit referents must be louder than readable but stale rationale. **predicted context closure is calibrated against observed reads and outcomes.** Economy's one-hop closure is a hypothesis about necessary reading, not cognition. Observed reads and later defect labels give that model a path to correction instead of turning it into dogma. **reviewed risk sites survive relocation but never duplication.** A ratchet baseline is a cached review, and a cached fact that expires on a rename rots the same way a decision's premises do — a refactor then spends a reviewer's attention on sites nobody touched, and attention spent on false alarms is how a real one gets waved through. Relocation changes where a reviewed site lives; duplication changes how much unreviewed surface exists, and only the second is news. (The import claims above separately prove that the composition root still reaches the configuration loader, graph derivation, verifier, spec walker, and journal.)

_works when:_
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

_files:_ `atlas.ts`, `boundary.ts`, `calibration.ts`, `cli.ts`, `commands.ts`, `config.ts`, `context.ts`, `contracts.ts`, `conventions.ts`, `decisions.ts`, `decompose.ts`, `derive.ts`, `drift.ts`, `economy.ts`, `evolution.ts`, `hook-cli.ts`, `hooks.ts`, `lint-sinks.ts`, `mass.ts`, `novelty.ts`, `observed.ts`, `onboard.ts`, `oracle-domain.ts`, `panel.ts`, `parity.ts`, `phrasebook.ts`, `premise.ts`, `promise-model.ts`, `promise.ts`, `prose.ts`, `raise.ts`, `read-trace.ts`, `redundancy.ts`, `render-claude.ts`, `render-contract.ts`, `render-outline.ts`, `render-overview.ts`, `render-scene.ts`, `scaffold.ts`, `scene-model.ts`, `scene.ts`, `sidecar.ts`, `signal.ts`, `status.ts`, `structural.ts`, `test-batch.ts`, `types.ts`, `verify.ts`, `walk.ts`, `why-lint.ts`

### Source adapters  `src/adapters`
Translate language syntax and platform configuration into the common graph vocabulary consumed by the harness core.

_why:_ Language and platform knowledge changes on a different cadence from graph semantics. Keeping it at this seam prevents a new parser or deployment target from multiplying conditionals through every renderer and verifier.

_works when:_
- typescript.ts exists at this node
- python.ts exists at this node
- cloudflare.ts exists at this node

_files:_ `cloudflare.ts`, `python.ts`, `typescript.ts`

### Executable contracts  `test`
Exercises the harness through focused unit contracts and end-to-end fixtures built from the same public data shapes that consuming repositories use.

_why:_ The shared fixture builders, verifier tests, journal tests, and command-registry tests are the suite's load-bearing entry points. Naming them makes the evidence surface visible without turning hundreds of individual test cases into an agent's component map.

_works when:_
- _helpers.ts exists at this node
- verify.test.ts exists at this node
- decisions.test.ts exists at this node
- commands.test.ts exists at this node

_files:_ `_helpers.ts`, `atlas.test.ts`, `calibration.test.ts`, `claude.test.ts`, `commands.test.ts`, `conjecture.test.ts`, `context.test.ts`, `contracts.test.ts`, `decisions.test.ts`, `decompose.test.ts`, `dictionary.test.ts`, `economy.test.ts`, `evolution.test.ts`, `kinds.test.ts`, `mass.test.ts`, `novelty.test.ts`, `observed.test.ts`, `oracle.test.ts`, `panel.test.ts`, `parity.test.ts`, `parse.test.ts`, `phrasebook.test.ts`, `premise.test.ts`, `promise.test.ts`, `prose.test.ts`, `python-oracle.test.ts`, `raise.test.ts`, `redundancy.test.ts`, `render-contract.test.ts`, `render-scene.test.ts`, `scene.test.ts`, `signal.test.ts`, `sinks.test.ts`, `status.test.ts`, `structural.test.ts`, `test-batch.test.ts`, `verify.test.ts`, `why-lint.test.ts`

## Structure

```
wt/
├─ src/  ●
│  ├─ adapters/  ●
│  │  ├─ cloudflare.ts
│  │  ├─ python.ts
│  │  └─ typescript.ts
│  ├─ atlas.ts
│  ├─ boundary.ts
│  ├─ calibration.ts
│  ├─ cli.ts
│  ├─ commands.ts
│  ├─ config.ts
│  ├─ context.ts
│  ├─ contracts.ts
│  ├─ conventions.ts
│  ├─ decisions.ts
│  ├─ decompose.ts
│  ├─ derive.ts
│  ├─ drift.ts
│  ├─ economy.ts
│  ├─ evolution.ts
│  ├─ hook-cli.ts
│  ├─ hooks.ts
│  ├─ lint-sinks.ts
│  ├─ mass.ts
│  ├─ novelty.ts
│  ├─ observed.ts
│  ├─ onboard.ts
│  ├─ oracle-domain.ts
│  ├─ panel.ts
│  ├─ parity.ts
│  ├─ phrasebook.ts
│  ├─ premise.ts
│  ├─ promise-model.ts
│  ├─ promise.ts
│  ├─ prose.ts
│  ├─ raise.ts
│  ├─ read-trace.ts
│  ├─ redundancy.ts
│  ├─ render-claude.ts
│  ├─ render-contract.ts
│  ├─ render-outline.ts
│  ├─ render-overview.ts
│  ├─ render-scene.ts
│  ├─ scaffold.ts
│  ├─ scene-model.ts
│  ├─ scene.ts
│  ├─ sidecar.ts
│  ├─ signal.ts
│  ├─ status.ts
│  ├─ structural.ts
│  ├─ test-batch.ts
│  ├─ types.ts
│  ├─ verify.ts
│  ├─ walk.ts
│  └─ why-lint.ts
└─ test/  ●
   ├─ _helpers.ts
   ├─ atlas.test.ts
   ├─ calibration.test.ts
   ├─ claude.test.ts
   ├─ commands.test.ts
   ├─ conjecture.test.ts
   ├─ context.test.ts
   ├─ contracts.test.ts
   ├─ decisions.test.ts
   ├─ decompose.test.ts
   ├─ dictionary.test.ts
   ├─ economy.test.ts
   ├─ evolution.test.ts
   ├─ kinds.test.ts
   ├─ mass.test.ts
   ├─ novelty.test.ts
   ├─ observed.test.ts
   ├─ oracle.test.ts
   ├─ panel.test.ts
   ├─ parity.test.ts
   ├─ parse.test.ts
   ├─ phrasebook.test.ts
   ├─ premise.test.ts
   ├─ promise.test.ts
   ├─ prose.test.ts
   ├─ python-oracle.test.ts
   ├─ raise.test.ts
   ├─ redundancy.test.ts
   ├─ render-contract.test.ts
   ├─ render-scene.test.ts
   ├─ scene.test.ts
   ├─ signal.test.ts
   ├─ sinks.test.ts
   ├─ status.test.ts
   ├─ structural.test.ts
   ├─ test-batch.test.ts
   ├─ verify.test.ts
   └─ why-lint.test.ts
```

