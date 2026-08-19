# coherence — map for agents

> Generated from the spec tree by the coherence harness. Do not edit by hand.

The repository-level reading surface: configuration, package contract, generated maps, and the authored explanation of why the harness exists.

## Components

### Coherence  `.`
The repository-level reading surface: configuration, package contract, generated maps, and the authored explanation of why the harness exists.

_why:_ An agent should encounter the project's purpose and its ownership seams before source detail. The project hook wiring also records which repository reads informed a change and which decisions survived it. Keeping coordination separate from implementation makes that first read small while still checking that every deeper entry point is reachable. This spec once claimed five obvious files existed at root; three were pruned rather than dressed up, because a root claim earns its line only when the failure it detects would otherwise be SILENT. `package.json`, `README.md`, and `src/cli.ts` fail loudly on their own — npm, the reader, and the CLI itself all scream within seconds of their absence — so claiming them was green weight that could never turn red for an interesting reason (the Known-limits section calls that spec "coherent and worthless"). The two claims kept from that pruning are the ones whose absence the system absorbs without a sound: `loadConfig` falls back to defaults when `coherence.config.json` is missing (verify would silently run with no test runner, no serial pin, and the wrong testMatch), and a missing lifecycle control kills the journal hooks with no host error at all. The latter used to be the weak structural claim `.claude/settings.json exists at root`; now the root claims the binary control reading itself for every host this repository supports. Its oracle checks each host's three tracked parts—settings, stable launcher, and root mapping—their exact composition, host-specific exclusion controls, the absence of a competing path, and the runnable target. One meaningful claim is lighter and stronger than six green file-existence claims. Fewer claims, honestly scoped, is still the trade this harness teaches; making its own root spec take it is the least it owes.

_works when:_
- coherence.config.json exists at root
- passes test "control — this repository's own lifecycle control is PRESENT"

### Harness core  `src`
Builds the source/spec graph, evaluates declared claims, renders reading surfaces, and records the decisions and observations that must survive an agent's context window.

_why:_ **agent lifecycle preserves decisions and exposes the current change signal.** Decisions and risk are cheapest to surface while the agent still holds the context that produced them; waiting for a later reviewer externalizes both reconstruction costs. The two stop surfaces are not interchangeable: a subagent restates its report because its caller may see nothing else, while the main agent has already shown its report to the user and is never interrupted by shared-worktree state that may belong to another agent. Main Stop keeps the calibration observation and emits no bytes; only SubagentStop carries the journal and patch signal forward. **significant behavioral growth acquires an anchor or patch-specific decision.** The cost of adding an invariant is immediate while the cost of omitting it appears later, so the current patch must carry either enforcement or an addressable reason that it needs none. **a weaker regulation obligation never masks a stronger one.** Regulation compares live obligations by a lexicographic potential, with missing observations failing closed instead of becoming zero, and returns the single strongest action owed. V1 evaluates only rules declared in the live doctrine registry; even a no-action result makes no claim of overall safety. **regulation evaluates and repairs the selected agent host.** A canonical Claude control cannot create a field around a Codex session, even though both hosts implement the same lifecycle domain. The sensor therefore names the explicit or current host in its reading, the decision identity retains it, and a lifecycle redirect installs that same host. A foreign host value refuses before it can release or author a shell command. **task context is bounded and names its approximations.** A focused context packet is useful only when its one-hop and heuristic limits stay visible; otherwise convenience is misread as completeness and recreates the omission gradient this project exists to oppose. **cached decisions expose structurally expired premises.** A decision saves inference only while the repository addresses supporting it remain live. Broken explicit referents must be louder than readable but stale rationale. **predicted context closure is calibrated against observed reads and outcomes.** Economy's one-hop closure is a hypothesis about necessary reading, not cognition. Observed reads and later defect labels give that model a path to correction instead of turning it into dogma. **calibration preserves the weakest host attribution of its trace.** A Codex parent session file can contain parent and descendant tool use because PostToolUse supplies no child id. Calibration may still compare that aggregate against a patch, but it must name the aggregate rather than relabeling those writes as one agent's work. Legacy rows remain unscoped, shared-worktree fallback remains separate, and any unreadable row prevents a new sample instead of disappearing from its denominator. **reviewed risk sites survive relocation but never duplication.** A ratchet baseline is a cached review, and a cached fact that expires on a rename rots the same way a decision's premises do — a refactor then spends a reviewer's attention on sites nobody touched, and attention spent on false alarms is how a real one gets waved through. Relocation changes where a reviewed site lives; duplication changes how much unreviewed surface exists, and only the second is news. **pinned mass follows a value-conserving rename but never absorbs growth.** A mass dimension's key embeds a name someone chose — a spec H1, a measure's config key — so a rename re-addresses the pin, and a ratchet that reads its own re-addressing as "gained parts nobody named" prints a lie beside the unchanged total that refutes it (measured: one H1 edit, 35 lines relabeled, zero gained, gate red). The repair must stay count-conserving: only a vanished pin with the same family, unit and exact value can absorb a new name, or growth and novelty would ride in under renames. **a claim goes green only on positive evidence its oracle ran.** The verifier's whole authority rests on this one property, and until now no claim cited it: an audit deleted the rule and the tree stayed "✓ coherent" while the unit test failed unseen. An exit code is the runner's statement about itself, not about the named test — a filter that matched nothing exits clean on every runner class this repo has measured — so green must require output that names the run, the one reading absence cannot produce. **a vanished oracle reds its claim, never green-by-absence.** A renamed or deleted test leaves a claim citing a name nothing owns, and that claim then guards nothing while wearing green. Absence has to be its own observable verdict, distinct from ran-and-failed, because the two demand different repairs: a red test needs the code fixed, a vanished oracle needs the contract re-tied to something that exists. **a declared invariant unanchored by any boundary fails coverage.** A spec may not assert a property that nothing enforces: that is the ratchet the whole harness turns on, and if it silently loosened, specs would drift back into aspiration prose. The gap has to cost a red at the run that opened it, while the person who opened it still holds the context to close it. **a via-test oracle that iterates no live domain fails its claim.** A totality label on a sampling test is worse than no label: it retires the reader's suspicion without retiring the risk. Deriving the checked set from the live registry the chokepoint actually serves is what makes "covers every case" a fact about the system rather than about the fixture list the author remembered. **a skipped run never clobbers an oracle's recorded verdict.** The record is the last known truth, honestly dated. A fast tier that skips the executable claims every commit would otherwise erase last week's real pass — or, worse, a real fail — with "did not look", and history that can be overwritten by not looking is not history. **a named oracle that no test runs cannot pass.** The serial runner is the component the executable tier leans its trust on, and it was outside the evidence perimeter — unclaimed, untested, and (measured) willing to exit clean when the cited title survived only as a string in a file. The runner itself must refuse a name it cannot show ran, because every green above it inherits that refusal. **an empty derivation against a remembered surface refuses, never passes.** Every verdict in this file rests on the graph deriving non-empty, and nothing checked that premise: gutting `buildGraph` left the gate printing "claims: 0" and "✓ coherent", exit 0 — deeper than a vanished oracle, because it empties every check at once while announcing they all passed. The record remembers how many claims the last run graded, so a run that suddenly sees zero must refuse rather than report success over nothing; the only legitimate zero (a project adopting from nothing) is exactly the one with no memory, and it gets the adoption ladder instead. The floor deliberately stops at zero: a partial collapse where every component keeps a claim is observationally identical to deliberate pruning, and deletion has to stay free or people stop deleting. What the complement underneath it actually reaches is narrower than it first appears — a component stripped of its claims is still a node someone can red, while a component the walk never discovered leaves nothing behind to notice, so an N→1 slide reads as N ordinary prunings. Pinning the population as a mass dimension is the honest answer there, because the question it settles is not whether anything survived but whether as much survived as last time. **lifecycle hook presence is one canonical runnable bit.** The control surface cannot create a field if every repository is free to carry a merely similar—or silently dead— hook. Printing, installation, and inspection therefore share one five-event value and one stable launcher per host. Presence means exactly one shared project copy, no competing local, inline, or legacy path, an aligned host/launcher root, a correct declared root mapping, an enabled project-hook layer, and a runnable target. Unrelated hooks may coexist. Historical journal activity is reported beside this bit but can neither redeem current absence nor erase current presence. **supported lifecycle hosts share one control contract without sharing host syntax.** Claude and Codex expose the same five lifecycle meanings through different settings files, matchers, launch commands, and response envelopes. Host parity therefore means deriving each complete bundle from one host-selected domain while retaining a distinct fingerprint; copying Claude bytes into Codex would be resemblance, not parity. **current-session activation requires exact installed-bundle evidence.** Structural presence proves that the project control is runnable, not that this session loaded it. A session becomes observed only when its activity names the selected host, launcher transport, and current bundle fingerprint. Direct probes, stale bundles, other sessions, and a guessed newest session cannot establish activation; parent-session fallback stays a named attribution ceiling rather than being promoted to child evidence. **customized hook text composes declared overrides and appends, degrading to canon on damage.** The canonical hook text is the harness's voice — identical across adopting projects, and byte-testable because of it — but a project knows things the harness cannot: its own commands, its conventions, the one warning its history taught it. So a project gets a declared voice per event rather than a fork of the hook body, under one composition rule with no conflict state: the override answers what the base is, the append answers what follows it, and both may coexist; an empty override is a deliberate, visible silence, not an error. Damage must degrade to the canonical emission at hook time, because the hook body runs inside every agent session of every adopting project — a torn customization file that broke sessions would make the journal's carrier the thing that kills the work it records — so a tear costs exactly the customization, never the session, and the loud surface for it is `hooks review`, where a reader is actually looking. Events with no canonical emission — main Stop, PostToolUse — speak only with a declared project voice; main Stop's canonical byte-silence and the attribution reasoning behind it stand unchanged as the default. **python sources feed the same instruments as typescript at their declared grade.** The adapter seam always promised language-agnosticism, but three analyzers and two scanners parsed TypeScript directly, so a python project's surface grew invisibly — the zero-anchor alarm never fired, parity claims skipped `.py` oracles, duplicated domains went unranked, batch oracles knew one report format, and f-string interpolations were not sites. Each instrument now reads python at a DECLARED grade: most through the shared grammar queries of phase 2b (surface, sites, sinks), the oracle arms at the pinned indent-block grade their guards froze — in-harness, no subprocess, and since the arms ported, no compiler dependency at all. The grade is declared, not hidden — precision is preferred over recall everywhere, because an advisory that cries wolf retires the reader's attention without retiring risk, and with no compiler behind `.py` a false positive can never be rescued downstream. What the regex grade deliberately does not count is journaled beside each instrument, so the next reader inherits the boundary of the instrument instead of rediscovering it. **a declared language resolves to a real adapter or refuses, never a silent fallback.** The graph is the one derivation everything downstream consumes, and the adapter decides what that derivation can see. The old `?? typescript` fallback meant a typo'd language name walked the wrong grammar and reported on the garbage with full confidence — the same walking-a-different-tree failure the config loader refuses for, one seam later. So an unknown bare name now refuses with the live built-in list, and the same seam is where a project brings its own language: a `./`-relative module exporting the LanguageAdapter shape, validated field-by-field so the refusal names the line that needs fixing. Importing project code is not new trust — the atlas already declares at the loadConfig crossing that running the harness in a tree executes that tree's config. What a custom adapter buys is the graph tier: symbols, import edges, prose, claims over them. The per-language instrument arms (surface counting, oracle analysis, redundancy, sinks, batch formats) remain harness contributions, and the documentation says so, because an adapter author who is not told the boundary believes they have the full field when they have half. **a grammar-backed adapter derives the graph through the same language seam.** The regex adapters scale in expert code — the python push measured ~900 hand-built lines across five instrument arms — while a grammar plus capture queries scales in data: modern tree-sitter grammar packages ship a prebuilt wasm, `web-tree-sitter` runs it without a native toolchain, and the language-specific knowledge shrinks to patterns a contributor can write without touching verdict logic. The factory is async once (wasm load) and the adapter it returns is synchronous, so the seam is unchanged and a project module reaches it with one top-level await. The corpus diff that justified the phase also bounded it: on this repository's own sixty-three TypeScript files the regex grade missed zero symbols a real parse found, so the graph tier was not where parse fidelity was owed. The built-ins then CONVERGED onto the grammar path anyway — not for fidelity but because two implementations of one outcome are two spellings of a domain, the redundancy class this harness ranks in other people's code. The regex adapters were corpus-diffed to parity (every delta an enumerated regex mistake), their prose logic ported verbatim, and then deleted; their grammars ship vendored with provenance. The instrument arms remain hand-built until a later phase ports them to query packs. **instrument arms read languages through shared grammar queries, never a parallel scanner.** Phase 2b's contract, proven first on the injection ratchet: a language contributes captures and signals — which node is an interpolation, how its SQL context announces itself — and the mechanism owns classification, safe-pattern grading, site identity, and the ratchet, once. The regex scanners this replaced matched line TEXT, so they counted `${}` inside plain strings, comments, and test fixtures as sites, bounded visibility at one brace of nesting, and one of them matched its own source. The query scan re-pinned the baseline with every delta enumerated: nineteen real nested-brace sites gained, one self-match artifact gone. A new language now gains the whole instrument from a table row — ruby's took three lines and no scanner — which is the two-tier boundary dissolving arm by arm. **experiment outcomes require criterion-total evidence.** A plan is frozen before work with its predicted context, actions, criteria, and evidence cursors. Closure answers every action and criterion exactly once, preserves the assessor, and derives success, failure, or inconclusive from criterion statuses rather than accepting an outcome label. Otherwise the ledger would turn an incomplete story into a measured loop. **experiment telemetry preserves its weakest provable attribution.** Trace and activity windows may be empty, prove an exact owner session, or only prove a parent-session aggregate that can include descendants; older trace may carry no observation metadata at all. Those four scopes remain distinct in the immutable close record. Damaged prefixes, unreadable rows, and unknown or inconsistent scope refuse. That keeps compatible history without turning absence or uncertainty into false precision. **activity evidence is accepted only when identity, scope, time, and command agree.** A row is useful precisely because later status and experiment readers stop re-deriving the host event. That cached inference is safe only while its relational fields still agree: agent attribution names the row session, parent fallback names its parent domain, event identity recomputes, time is canonical, and command kind/result agrees with name and exit code. One strict reader grades that whole relation; malformed rows become counted damage, never partially trusted evidence. **a streamed journal entry renders exactly once across appends and compaction.** The live stream exists for the one reader the settled render cannot serve — an orchestrator watching five subagents mid-flight — and that reader has no way to audit the feed against the files. A dropped entry is a decision the orchestrator never saw, indistinguishable from one never made; a duplicate teaches the opposite lie, that a question was decided twice. Both are cheap to produce, because the journal's files do not strictly grow: compaction moves lines between files and unlinks the originals, which a position-addressed reader replays in full. So a record's identity in the stream comes from its content — the same triple the merged timeline sorts by — and a moved line is one the feed already carried. (The import claims above separately prove that the composition root still reaches the configuration loader, graph derivation, verifier, spec walker, and journal.)

_works when:_
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
- boundary "python sources feed the same instruments as typescript at their declared grade" at surfaceOfSource via guard "python surface — module defs, enum variants, and dict keys count; underscore and nested names do not"
- boundary "python sources feed the same instruments as typescript at their declared grade" at analyzeParityOracle via guard "python parity — a .py oracle that iterates the live domain passes; a literal list fails; a vanished oracle cannot pass"
- boundary "python sources feed the same instruments as typescript at their declared grade" at sitesOfPython via guard "python redundancy — two spellings of one domain in .py rank as a candidate; declared parity and idiom do not"
- boundary "python sources feed the same instruments as typescript at their declared grade" at resolveFromBatch via guard "pytest batch — nodeid names resolve per claim, zero matches is the vanished oracle, and a torn report falls back loudly"
- boundary "python sources feed the same instruments as typescript at their declared grade" at lintSinks via guard "python sinks — an f-string into a SQL context is a site, a safe-pattern expression is not, and the ratchet reds the new site"
- boundary "a declared language resolves to a real adapter or refuses, never a silent fallback" at resolveLanguageAdapter via guard "language adapter — a project path loads and shapes the graph; unknown names refuse, never fall back"
- boundary "a grammar-backed adapter derives the graph through the same language seam" at makeTreeSitterAdapter via guard "tree-sitter — a grammar-backed adapter derives ruby symbols, imports, and prose through the same seam"
- boundary "instrument arms read languages through shared grammar queries, never a parallel scanner" at lintSinks via guard "ruby sinks — an interpolation into a SQL context is a site and the safe pattern exempts"
- boundary "experiment outcomes require criterion-total evidence" at closeExperiment via guard "close — total nonempty evidence is mandatory and outcome is derived, never supplied"
- boundary "experiment telemetry preserves its weakest provable attribution" at closeExperiment via guard "Codex parent-only tool events close the loop as an aggregate, never exact owner evidence"
- boundary "activity evidence is accepted only when identity, scope, time, and command agree" at isActivityRow via guard "activity — internally inconsistent scope, time, and command rows are damage, not evidence"
- boundary "a streamed journal entry renders exactly once across appends and compaction" at tailJournal via guard "tail — an appended record arrives exactly once, a compaction fold re-emits nothing and drops nothing, and a half-written line waits for its bytes"

_files:_ `activity.ts`, `atlas.ts`, `boundary.ts`, `calibration.ts`, `cli.ts`, `commands.ts`, `config.ts`, `context.ts`, `contracts.ts`, `control.ts`, `conventions.ts`, `decisions.ts`, `decompose.ts`, `derive.ts`, `doctrine.ts`, `drift.ts`, `due.ts`, `economy.ts`, `evolution.ts`, `experiment.ts`, `floor.ts`, `hook-cli.ts`, `hook-text.ts`, `hooks.ts`, `index-model.ts`, `journal.ts`, `lint-sinks.ts`, `mass.ts`, `novelty.ts`, `observed.ts`, `oracle-domain.ts`, `panel.ts`, `parity.ts`, `phrasebook.ts`, `premise.ts`, `promise-model.ts`, `promise.ts`, `prose.ts`, `raise.ts`, `read-trace.ts`, `redundancy.ts`, `regulate.ts`, `render-claude.ts`, `render-contract.ts`, `render-index.ts`, `render-outline.ts`, `render-overview.ts`, `run-named-test.ts`, `scaffold.ts`, `sidecar.ts`, `signal.ts`, `status.ts`, `structural.ts`, `test-batch.ts`, `tree.ts`, `types.ts`, `verify.ts`, `walk.ts`, `why-lint.ts`

### Source adapters  `src/adapters`
Translate language syntax and platform configuration into the common graph vocabulary consumed by the harness core.

_why:_ Language and platform knowledge changes on a different cadence from graph semantics. Keeping it at this seam prevents a new parser or deployment target from multiplying conditionals through every renderer and verifier. One parsing foundation lives here now. The regex adapters that preceded it were corpus-diffed to parity and deleted — two implementations of one outcome are two spellings of a domain, and the languages themselves became data: a grammar binary plus a spec of capture queries per language, with the prose-extraction logic the regex era proved carried over verbatim.

_works when:_
- tree-sitter.ts exists at this node
- cloudflare.ts exists at this node

_files:_ `cloudflare.ts`, `tree-sitter.ts`

### Executable contracts  `test`
Exercises the harness through focused unit contracts and end-to-end fixtures built from the same public data shapes that consuming repositories use.

_why:_ The shared fixture builders, verifier tests, journal tests, and command-registry tests are the suite's load-bearing entry points. Naming them makes the evidence surface visible without turning hundreds of individual test cases into an agent's component map.

_works when:_
- _helpers.ts exists at this node
- verify.test.ts exists at this node
- decisions.test.ts exists at this node
- commands.test.ts exists at this node

_files:_ `_helpers.ts`, `activity.test.ts`, `adapter-loader.test.ts`, `atlas.test.ts`, `calibration.test.ts`, `claude.test.ts`, `codex-control.test.ts`, `commands.test.ts`, `conjecture.test.ts`, `context.test.ts`, `contracts.test.ts`, `control.test.ts`, `decisions.test.ts`, `decompose.test.ts`, `derive.test.ts`, `dictionary.test.ts`, `due.test.ts`, `economy.test.ts`, `evolution.test.ts`, `experiment-cli.test.ts`, `experiment.test.ts`, `floor.test.ts`, `hook-stop.test.ts`, `hook-text.test.ts`, `hooks-cli.test.ts`, `index.test.ts`, `journal.test.ts`, `kinds.test.ts`, `mass.test.ts`, `novelty-python.test.ts`, `novelty.test.ts`, `observed.test.ts`, `oracle.test.ts`, `panel.test.ts`, `parity.test.ts`, `parse.test.ts`, `phrasebook.test.ts`, `premise.test.ts`, `promise.test.ts`, `prose.test.ts`, `pytest-batch.test.ts`, `python-oracle.test.ts`, `python-parity.test.ts`, `raise.test.ts`, `redundancy.test.ts`, `regulate-cli.test.ts`, `regulate.test.ts`, `render-contract.test.ts`, `run-named-test.test.ts`, `signal.test.ts`, `sinks-python.test.ts`, `sinks-ruby.test.ts`, `sinks.test.ts`, `status.test.ts`, `structural.test.ts`, `test-batch.test.ts`, `tree-sitter-adapter.test.ts`, `tree.test.ts`, `vacuity.test.ts`, `verify.test.ts`, `why-lint.test.ts`

## Structure

```
coherence/
├─ src/  ●
│  ├─ adapters/  ●
│  │  ├─ cloudflare.ts
│  │  └─ tree-sitter.ts
│  ├─ activity.ts
│  ├─ atlas.ts
│  ├─ boundary.ts
│  ├─ calibration.ts
│  ├─ cli.ts
│  ├─ commands.ts
│  ├─ config.ts
│  ├─ context.ts
│  ├─ contracts.ts
│  ├─ control.ts
│  ├─ conventions.ts
│  ├─ decisions.ts
│  ├─ decompose.ts
│  ├─ derive.ts
│  ├─ doctrine.ts
│  ├─ drift.ts
│  ├─ due.ts
│  ├─ economy.ts
│  ├─ evolution.ts
│  ├─ experiment.ts
│  ├─ floor.ts
│  ├─ hook-cli.ts
│  ├─ hook-text.ts
│  ├─ hooks.ts
│  ├─ index-model.ts
│  ├─ journal.ts
│  ├─ lint-sinks.ts
│  ├─ mass.ts
│  ├─ novelty.ts
│  ├─ observed.ts
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
│  ├─ regulate.ts
│  ├─ render-claude.ts
│  ├─ render-contract.ts
│  ├─ render-index.ts
│  ├─ render-outline.ts
│  ├─ render-overview.ts
│  ├─ run-named-test.ts
│  ├─ scaffold.ts
│  ├─ sidecar.ts
│  ├─ signal.ts
│  ├─ status.ts
│  ├─ structural.ts
│  ├─ test-batch.ts
│  ├─ tree.ts
│  ├─ types.ts
│  ├─ verify.ts
│  ├─ walk.ts
│  └─ why-lint.ts
└─ test/  ●
   ├─ _helpers.ts
   ├─ activity.test.ts
   ├─ adapter-loader.test.ts
   ├─ atlas.test.ts
   ├─ calibration.test.ts
   ├─ claude.test.ts
   ├─ codex-control.test.ts
   ├─ commands.test.ts
   ├─ conjecture.test.ts
   ├─ context.test.ts
   ├─ contracts.test.ts
   ├─ control.test.ts
   ├─ decisions.test.ts
   ├─ decompose.test.ts
   ├─ derive.test.ts
   ├─ dictionary.test.ts
   ├─ due.test.ts
   ├─ economy.test.ts
   ├─ evolution.test.ts
   ├─ experiment-cli.test.ts
   ├─ experiment.test.ts
   ├─ floor.test.ts
   ├─ hook-stop.test.ts
   ├─ hook-text.test.ts
   ├─ hooks-cli.test.ts
   ├─ index.test.ts
   ├─ journal.test.ts
   ├─ kinds.test.ts
   ├─ mass.test.ts
   ├─ novelty-python.test.ts
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
   ├─ pytest-batch.test.ts
   ├─ python-oracle.test.ts
   ├─ python-parity.test.ts
   ├─ raise.test.ts
   ├─ redundancy.test.ts
   ├─ regulate-cli.test.ts
   ├─ regulate.test.ts
   ├─ render-contract.test.ts
   ├─ run-named-test.test.ts
   ├─ signal.test.ts
   ├─ sinks-python.test.ts
   ├─ sinks-ruby.test.ts
   ├─ sinks.test.ts
   ├─ status.test.ts
   ├─ structural.test.ts
   ├─ test-batch.test.ts
   ├─ tree-sitter-adapter.test.ts
   ├─ tree.test.ts
   ├─ vacuity.test.ts
   ├─ verify.test.ts
   └─ why-lint.test.ts
```

