# coherence

A standalone coherence harness for agent-developed projects. It derives a
multi-resolution graph from a `*.spec.md` tree plus the code, renders a navigable
outline and an agent map, and verifies that the docs/claims haven't rotted.

```sh
npm install --save-dev @danilocampos/coherence
printf '{}\n' > coherence.config.json       # declare the root — an empty config is complete, defaults do the rest
npx coherence hooks install --host claude   # the lifecycle field: journal + instructions in every agent session
npx coherence verify                        # derive the graph and grade the claims
```

Requires **Node ≥22**. The [full installation section](#install) covers configuration,
the Codex host, and activating the lifecycle control properly.

That is the mechanism. The **purpose** is narrower and worth stating before any of it:
the expensive resource in a codebase is not bytes and not lines — it is **inference**,
and this is a machine for spending less of it. Read [the economy of inference](#the-economy-of-inference-what-a-codebase-actually-costs)
for that model; every command below is an instrument in that economy.

The **core is platform- and language-agnostic.** Project-specific knowledge lives
behind two adapters:
- **language adapter** (`src/adapters/tree-sitter.ts`) — symbols, imports, docblocks; grammar-backed built-ins for TypeScript, Python, and Ruby, project-extensible.
- **platform adapter** (`src/adapters/cloudflare.ts`) — infra bindings from wrangler config plus direct typed `Env` capabilities. Optional.

With `"platform": "cloudflare"`, direct module-level `Env` / `Cloudflare.Env`
properties using the existing D1, KV, Vectorize, R2, and Workers AI types form the
committed capability floor; `wrangler.jsonc` / `wrangler.toml`
augment and confirm it. This keeps an optional binding's graph node stable when a local
deployment toggle is enabled or commented out. Agreement deduplicates; a source/config
type conflict refuses rather than picking whichever spelling was read last. Source
inference consumes the same filtered code-file population as the graph, so put generated
machine-local declarations such as `worker-configuration.d.ts` in `ignore`. Wrangler
runtime-variable names remain visible as declarations, but their deployment values are
discarded at the adapter boundary and never enter `graph.json` or an overview.

## Agent and swarm quick path

Start with a heading, then buy only the context the task needs:

```sh
npx coherence orient
npx coherence context src/payments/settle.ts       # bounded to 12,000 bytes by default
npx coherence context --changed --max-bytes 20000
npx coherence context src/payments/settle.ts --all # explicit unbounded expansion
```

`orient` reads the strict decision projection, work graph, consequence links,
experiments, defects, and last verification. It emits **one** deterministic action:
`REFUSE`, `RESOLVE-CONFLICT`, `REPAIR-NAVIGATION`, `UNBLOCK`, `SYNTHESIZE`,
`DISPATCH`, `CONTINUE`, `VERIFY`, or `STEADY`. It never runs the action. If a
required ledger is damaged, the heading is `REFUSE`; damaged or unreadable surviving
evidence is not converted into an empty, healthy-looking swarm.

The examples use `$COHERENCE_SESSION`, `$CHILD_SESSION`, and `$NEXT_SESSION` for
exact host-provided session identities. Set them from your host or orchestrator before
writing; for a Codex parent, `COHERENCE_SESSION="$CODEX_THREAD_ID"` is the usual mapping.
Do not substitute a branch name, date, `unknown`, or a guessed newest session.

For coordinated work, make authority, ownership, success, dependencies, and write scope
addressable before agents start:

```sh
WORK_ID="$(
  npx coherence work create "harden settlement retries" \
  --success "the retry oracle passes" --risk high \
  --authority orchestrator-delegated --granted-by orchestrator \
  --boundary "src/payments/** and its focused tests only" \
  --owner-session "$CHILD_SESSION" --owner-agent retry-agent \
  --read-scope src/payments --write-scope src/payments \
  --session "$COHERENCE_SESSION" | awk '/^OPEN / {print $2}'
)"

npx coherence work inspect
npx coherence work transition "$WORK_ID" active --because "owner accepted the order" \
  --session "$CHILD_SESSION"
npx coherence work handoff "$WORK_ID" --owner-session "$NEXT_SESSION" --owner-agent reviewer \
  --because "implementation complete; verification remains" --session "$CHILD_SESSION"
npx coherence work close "$WORK_ID" completed --because "success criterion met" \
  --evidence "focused oracle passed" --session "$NEXT_SESSION"
```

The work ledger is append-only and inert: it coordinates but does not spawn agents or
execute commands. Every mutation names an exact writer session; ownership changes only by
handoff; state transitions carry their predecessor; dependencies determine readiness;
simultaneously runnable work with overlapping write scopes is reported as a collision.
An order cannot activate or complete until every dependency completed. A parent cannot
become terminal while a child remains live, and closure names every completed direct
child whose result it synthesized.

A completed child can remain visibly unsynthesized while one of its direct siblings is
still ready, active, or blocked. Synthesis is represented only by closing the parent, so
`orient` selects the live sibling's executable obligation first and emits `SYNTHESIZE`
only after that parent's direct children are terminal.

Work authority answers who may act and within what boundary. Decision authority is a
separate question: whose choice may ratify policy for the swarm. Record a choice at the
moment it is made, and add `--subject` whenever it should enter conflict analysis.
`--authority` is optional, but an ungraded choice cannot ratify or outrank another:

```sh
DECISION_ID="$(
  npx coherence decide "use compare-and-append state transitions" \
  --over "last timestamp wins" \
  --because "concurrent histories must refuse instead of hiding one writer" \
  --work "$WORK_ID" --subject work-state/concurrency \
  --authority local-proposal --scope-file src/work.ts \
  --session "$CHILD_SESSION" --agent retry-agent | awk '{print $1}'
)"
```

Two local proposals with the same explicit subject and different choices need
ratification. An `orchestrator-accepted` or `user-directed` record can select one
choice; incompatible records at the highest authority remain contested. Prose similarity,
timestamp order, and “last writer wins” never decide policy. Historical journal rows
remain readable. Rows without a subject stay outside position analysis; rows with a
subject but no authority may align or conflict, but never ratify or outrank.

Finally, state relationships rather than asking later readers to infer them from time,
paths, or Git proximity:

```text
decision ──authorizes──▶ work ──produces──▶ commit
                              ▲
verification ───verifies─────┘
work or commit ──repairs─────▶ defect
```

```sh
npx coherence consequence add "decision:$DECISION_ID" authorizes "work:$WORK_ID" \
  --evidence "the accepted decision grants this work order" --session "$COHERENCE_SESSION"
npx coherence consequence add "verification:full@$(git rev-parse HEAD)" verifies "work:$WORK_ID" \
  --evidence "full coherence verification passed at this commit" --session "$COHERENCE_SESSION"
npx coherence consequence inspect "work:$WORK_ID"
```

The consequence ledger preserves the authored direction and renders both directions for
navigation. Its typed relation table rejects nonsense, but an edge remains an attributable
assessment—not proof of causality. A completed work order stays visibly unverified until a
`verification --verifies--> work` edge names it. Today that verification reference is an
assessor-authored address, not an existence-checked append-only receipt; record it only
after the named check actually ran. The output and Known limits section keep that ceiling
explicit.

Commit `.coherence/work/` and `.coherence/consequences/`. They are repository evidence,
not machine-local queues; configure blanket `.coherence/*` ignore rules to re-include both.
This repository pins that requirement with a public-CLI write → Git commit → clone → strict
replay test. First-use repositories need no tracked empty directories, but once records
exist, a clone that drops them has lost the swarm's ownership and navigation state.

That is the shortest operating loop:

1. `orient` for the fleet heading.
2. `context` for a bounded, omission-accounted reading packet.
3. `work` for authority, ownership, dependencies, scopes, handoff, and synthesis.
4. `decide` for alternatives and ratifiable policy.
5. `consequence` for explicit provenance between durable records.
6. `verify`, link the evidence, then run `orient` again.

### Validate a swarm in the field

A green harness proves mechanisms, not that a swarm delivered the right result. Keep two
claims separate:

- a **live canary** proves that attribution, conflict sensing, handoff, synthesis,
  navigation, and fail-closed recovery work in the selected host;
- a **matched efficacy trial** asks whether those mechanisms reduce inference, conflict,
  rework, or defects without degrading the domain outcome.

Predeclare the canary before dispatch. Use `experiment create` to freeze its representative
task, actions, and observable criteria; choose the time/read budgets and sample counts now,
not after seeing the result. At minimum name the native domain outcome, assignment delivery,
actual-versus-declared write scope, one seeded collision and one dependency-serialized
overlap, decision ratification, handoff and child synthesis, hook reliability, transcript-free
navigation, damage recovery, and the final orientation:

```sh
npx coherence experiment create "the live swarm completes its domain task and leaves a recoverable field" \
  --context src/changed-domain.ts \
  --action "run the canary below with exact parent and child sessions" \
  --success "the project-native acceptance criterion passes" \
  --success "coordination, navigation, and recovery criteria all carry evidence" \
  --session "$COHERENCE_SESSION"
```

Run the canary on a disposable branch with one parent, two real child sessions, a dependency,
a shared integration seam, and a reviewer handoff:

1. Capture the clean baseline: project-native acceptance, `coherence verify`, commit, elapsed
   time, and the expected changed paths. Prove the selected lifecycle bundle and current
   parent activation; have each child restate the exact work order its `SessionStart` emitted.
   An unobserved bundle or empty event window is missing hook evidence, never a measured zero
   failure rate.
2. Make one pair of runnable orders claim an overlapping write scope. Before either writes,
   `orient` must say `RESOLVE-CONFLICT`. Block or serialize one. A second overlapping order
   waiting on a declared dependency must remain potential overlap, never a live collision.
   Compare the actual diff and explicit-path trace with every declared write scope; the work
   ledger records authority but cannot prevent an out-of-scope write.
3. Have two children record incompatible `local-proposal` choices on one explicit subject.
   Require `RESOLVE-CONFLICT`, then record the accepted authority and confirm timestamps did
   not choose it. Exercise early dependency refusal, handoff to the exact reviewer, and the
   parent's refusal to close until every live child is terminal and every completed child is
   named as synthesized.
4. Run the project-native acceptance and full verification. Preserve the command, output,
   and commit, then record the decision-to-work, work-to-commit, and verification-to-work
   links. The verification address is still assessor-authored, so the retained evidence is
   part of this criterion.
5. Give a fresh agent **no transcript**. Its only starting surfaces are `orient`, bounded
   `context`, `work inspect`, and `consequence inspect`. Within the predeclared time and read
   budget it must recover the objective, authority, owners, dependencies, ratified choice,
   evidence, and next action, invent no causal edge, and make no out-of-scope follow-up edit.
6. In a disposable copy, damage one surviving ledger row and stale the verification. The
   headings must move to `REFUSE`, then `VERIFY`, never `STEADY`. Restore the row, close every
   experiment criterion with evidence, and require native acceptance, current verification,
   `regulate --check` release, and `orient` steady.

The canary passes only with all assigned sessions accounted for, zero out-of-scope writes,
the seeded collision detected before the first conflicting write, no false collision for the
serialized pair, no old-owner write after handoff, complete child synthesis, zero hook failures
across a nonzero predeclared event count, correct fresh-reader answers with zero invented
links, and successful refusal and recovery. An empty trace cannot satisfy the hook criterion.
A single canary establishes operability, not efficacy.

For efficacy, pre-register a matched task set or historical comparator and one primary metric.
Report sample size and attribution grade beside median time to the correct heading, context
bytes and outside reads, duplicate/conflicting edits, reviewer reconstruction time, rework,
and escaped defects. Pass only if domain correctness does not regress and the predeclared
primary metric clears its chosen improvement band; the other measures remain evidence, not a
post-hoc score. A few matched tasks are a pilot, not a population claim.

Keep attribution at its weakest provable grade. Exact work owners and journal writers do not
make Codex descendant `PostToolUse` rows exact: those remain a `parent-session-aggregate`.
Explicit-path traces are a lower bound, shell/editor/remembered reads are absent, and current
verification references are not receipt-checked. Score per-child behavior only from exact
records, label aggregate measures as aggregate, and retain manual scope and verification
evidence rather than upgrading either ceiling by inference.

#### What this repository's V2 canary established

The run behind commit `5ff3e7d` delegated three bounded implementation slices and then gave
a separate reader no transcript. That reader recovered the root objective, exact owners, a
host-session handoff, the accepted policy, explicit evidence links, trust ceilings, and the
executable next action from `orient`, `context`, `work inspect`, and `consequence inspect`
alone. The resulting tree passed 921 project tests and 80/80 coherence claims with all 60
declared invariants anchored.

The run also falsified four quiet paths before release: synthesis could outrank a live sibling
even though parent closure was impossible; same-`HEAD` source changes could leave verification
current; deleting the whole committed decision population could look like first adoption; and
the new work/consequence ledgers worked locally while Git ignored them. Each now has a named
negative control, and the last has an actual commit/clone/replay oracle rather than an ignore-
pattern proxy.

It did **not** establish hook reliability or swarm efficacy. Structural Codex control was
present, but this API-hosted parent session was unobserved and the experiment captured zero
trace and activity events, recorded honestly as `none`. No matched task population was run.
Treat this as strong mechanism and navigation evidence with an unproven host-telemetry arm,
not as evidence that swarms improve outcomes.

The rest of this README explains the trust model, adoption, claim language, instruments,
and known ceilings behind that loop.

## The economy of inference: what a codebase actually costs

A reader arrives at code with a question. *Can I change this safely. What breaks if I
do. Why is it this way.* The reader is a human at 2am or an agent with a 400k window;
the question is the same and so is the invoice. There are exactly three prices it can
be answered at:

1. **Inferred** — reconstructed by reading the code and simulating it in the reader's
   head. The most expensive operation in the system, and the only one that is paid
   **again by every reader, forever**: nobody's inference makes the next reader's
   cheaper. It is also the only price that is silent. Nothing in the repo records that
   it was charged.
2. **Read** — looked up, because somebody cached the fact. A claim, an atlas entry, a
   journal line. The expensive reconstruction is paid **once**, at write time, by the
   party who already had the answer in hand and was therefore the cheapest possible
   payer. It is **not free after that**: every reader still pays retrieval, integration,
   and enough verification to trust the cache. The cache wins by making those payments
   smaller and bounded, not by making reading disappear.
3. **Unaskable** — the question cannot arise, because the fact is structural. A
   capability that carries its own scope does not make a cross-tenant read *checked*;
   it leaves "could this read another tenant's rows?" with no site to be asked at. A
   sealed schema does not warn about an open object — an open object is a compile
   error. **Zero read-time cost for that question**; the design and migration that made
   it unaskable still had a construction cost, and future structural changes can incur
   another.

Coherence is a machine for moving facts **down** that ladder.

- A **claim** is a cached inference. "Does X hold across all of its sites?" — a
  question that otherwise costs a read of every site plus a mental proof — collapses to
  one anchored line with an oracle behind it. The build re-derives it so no reader has
  to.
- The atlas's **`nonTransition` registry** is cached *negative* inference, which is the
  half nobody writes down. It pre-answers *"do I have to worry about this symbol?"*
  with a reasoned **no**. Without the entry, every future reader re-derives that no
  from scratch — and derives it slower, and less confidently, as the surrounding code
  grows.
- The journal's **`--over`** caches the most expensive inference there is: the search
  that does not have to be run again. A settled question with its rejected alternatives
  attached is a question the next agent does not re-litigate, and re-litigation is
  full-price inference for an answer that already existed in the repo's history and was
  merely unaddressable.
- **The tier system is this ladder, priced.** Tier-3 *convention* means the fact still
  lives at the inference rung — prose, sampled tests, memory. Tier-2 *totality-checked*
  means it has moved to **read**: one declarative home, plus an oracle that holds the
  cache warm and fails loud the moment the cache and the domain disagree. Tier-1
  *enshrined* means **unaskable**: the type system or the addressing scheme carries it
  and no oracle is needed to keep it true. The enforcement ladder below and this one
  are the same ladder, read from opposite ends — enforcement is what it costs to keep a
  fact true, price is what it costs to find out.
- **Ratchets** exist because facts climb back **up**. A domain re-spelled by hand, a
  guard added at an N+1th site, an interpolation sink reopened: each is a fact demoted
  from read back to inferred, and each demotion is individually defensible. The
  baseline is what makes the aggregate visible.

The reducer function, in one line: **dissolve > declare > infer.** Make a fact
unaskable if it can be made unaskable; write it down if it cannot; and treat every fact
still living at the inference rung — on hot paths especially — as **the tangle
inventory**. That inventory is the work list, and it is the thing `atlas`, `conventions`,
`redundancy`, and `contracts` each report a slice of.

The symbol **Σ** makes the asymmetry explicit. It means “sum this cost over every
instance,” here every future reader or change:

```text
repository reading cost = Σᵣ (retrievalᵣ + integrationᵣ + verificationᵣ)
```

For an implicit fact, retrieval includes discovery and verification includes rebuilding
the proof from code; for a declared fact, those terms are smaller but still present. The
problem agents sharpen is that reader `r` pays the whole term now while the damage from a
miss is propagated into later terms. Under a short-horizon prompt, reading broadly is a
visible cost and preserving context is mostly somebody else's benefit. The local gradient
therefore points toward the smallest patch that satisfies the prompt, including patches
that preserve or amplify a bad structure.

Coherence cannot repeal that gradient; it can move part of the future Σ onto the current
change. `context` makes a bounded, task-shaped first read cheaper without calling it
complete. `signal --check` makes significant new surface carry an anchor or a
patch-fingerprinted decision now. `premise` makes expired decision addresses visible.
The read/write hook trace and `calibrate` test economy's predicted context against what
agents actually loaded and whether labeled outcomes were clean. These are pressure and
instrumentation, not a proof that the right context was read.

Two secondary economies fall out of the same frame. **Economy of writes is locality**:
one intent should produce one write site, and co-change across a boundary is write
amplification — `decompose` and `drift` measure exactly that. **Economy of reads is
context closure**: how much has to be loaded before one thing can be changed safely.
Neither is byte count. **Byte mass is orthogonal to all of it** — 500KB of font files
carries zero inference surface, while a clever ten-line implicit coupling can be the
single most expensive object in the repo.

Two cautions keep the doctrine honest, and the harness is shaped by both. **A cached
fact is itself mass, and it can go stale.** Declared-but-wrong is strictly worse than
undeclared: the reader stops inferring, which was the entire point, and now stops at the
wrong answer. The whole "what happens when the claim being enforced is wrong?" discipline
— refutations, claim kinds, the never-red advisory, the meta-oracle's stated ceiling —
exists for this one hazard. And **the bottom rung is the only free one.** Every rung
above `unaskable` costs something to keep, which is why "declare everything" is not the
strategy and never was.

### The maintenance-cost ledger: making the price perceptible

Trust accounting says *where the untrusted becomes verified*. Work accounting says *what
that costs to keep, continuously* — and the instruments in v0.18–0.19 exist because the
dissipation is otherwise imperceptible. A mechanical watch loses amplitude with every
complication added and the watchmaker feels it; software's invoice arrives as velocity
quietly decaying, months later, attributable to nothing.

- **`mass`** pins how much machine there is. Byte mass is not inference mass — but
  unpinned growth is where undeclared facts accumulate, and its failure message asks for
  the one thing the ratchet cannot know: *name what the new mass buys* (`coherence
  decide`), then re-pin.
- **holding cost** (`verify`) prices each promise: what this project pays, per run,
  to keep one cached fact warm. A claim eating a quarter of the run is not wrong — it is
  expensive, and expensive-to-keep-true is a real position to hold knowingly.
- **heat** (`atlas`) puts a temperature on every crossing: the share of recent commits
  touching a file that defines the chokepoint. A hot tier-1 crossing is not a finding; it
  is load-bearing and busy.

The compound reading is the useful one: **heat × tier**. High change traffic at an
undeclared junction is a place where every edit is paying full inference price, over and
over, in the busiest part of the map. That is where a fact should be moved down the
ladder next.

### The same ladder, read as trust

Everything above is the **builder's** view: what does it cost to work here. Turn the
same ladder around and it is the **relier's** view: what may be safely assumed without
checking. These are not two properties. **Trust is the license to skip inference** —
and the ladder measures exactly that license, rung by rung. Going down it, cost falls;
going up it, the license to rely weakens until it is nothing but hope.

The image is an electrical panel. A tidy panel — every breaker labeled, the work to
code, the cover sealed, the permit history in the door pocket — is more trustworthy than
a tangled unlabeled one, and the reason is not aesthetic. It is that a trustworthy panel
can be **acted on from its representations**, while an untrustworthy one has to be
re-derived by tracing wires. Tracing wires is inference. Every part of that panel that
earns trust is a part that spared someone the trace:

- **Labels are claims** — and what makes a label trustworthy is not that it was written,
  it is that it was **checked**. A mislabeled breaker is worse than an unlabeled one: the
  unlabeled breaker gets traced, the mislabeled one gets believed. That is
  declared-but-wrong-is-worse-than-undeclared in one image, and it is why a claim without
  a live oracle behind it is a liability rather than an asset.
- **Code compliance is dictionary conformance.** The vetted pattern carries the safety
  argument, so the inspector does not re-derive it per installation — which is precisely
  what `conforms to <Word>` buys, and precisely why a word's commitments have to be real
  (a green `conforms to` that ran none of its commitments would be a code stamp sold, not
  earned).
- **The sealed cover is tier-1.** The mistake is not forbidden, it is made
  unrepresentable. Nothing to remember, nothing to check, nothing to re-derive.
- **Trust is risk-weighted, and so is the compliance bar.** "No security boundary without
  a totality oracle" is the same rule as stricter code on the 240V circuits — over-
  enshrining a lighting circuit is waste, under-enshrining a service entrance is how
  people get hurt. Match rigor to consequence.
- **The permit and inspection history are the journal and the track record.** Provenance
  is a trust instrument: who decided this, over what, and why (`decide --over`), and which
  checkers have ever actually been seen to fail (the never-red advisory's `everFailed`).
- **The atlas and `contract` are inspection artifacts** — the panel schedule taped inside
  the door. They are written for the **relying party**, not for the author, which is what
  makes them different in kind from the code they describe.
- **Refutations are proving the breaker trips.** A checker never observed to fail has not
  been shown to be a checker. A negative control is how a label stops being a claim about
  the label and becomes a claim about the circuit.

Which closes the loop: **dissolve > declare > infer is also the trust gradient.** A fact
dissolved into structure needs no trust at all; a fact declared and checked can be relied
on to the exact strength of its oracle; a fact left at the inference rung can only be
relied on by re-deriving it, which is to say it is not being relied on, it is being
rebuilt. Economy and trust are one quantity seen from two chairs — the builder asking
what this costs, the relier asking what may be assumed.

### The assembly these parts build: an envelope, in constant motion

Scale the panel up and the whole discipline comes into view: coherence is an **envelope
construction kit** for software. A building envelope is the boundary assembly that makes
the interior governable, and its physics are the atlas's physics. Failures happen at
**penetrations**, so that is where the effort concentrates: every deliberate crossing is
flashed and sealed (a chokepoint with an oracle behind it), every non-penetration is
documented as one (`nonTransition` is the note that says *this is wall, not window*), and
the unsealed joints are on the drawing (`knownPending`) rather than discovered by the
weather. The envelope's cardinal property is **continuity** — a 99% continuous vapor
barrier is not 99% effective; one gap defeats it — which is the deep reason totality
oracles exist and their exact building-science name: **a totality oracle is a blower-door
test.** It does not check the seals you remember making. It pressurizes the assembly and
asks whether any gap exists at all. (A refutation is the smoke pencil: proof the test can
detect a leak.) And the payoff of the envelope is the **interior**: inside a sound one,
local reasoning is valid and context closure stays small. Interior code gets to be simple
because the boundary is doing the work — the economy frame and the envelope frame arriving
at the same place.

One thing separates this envelope from a building's: **the primary weather is the
construction crew.** A building is sealed once and then maintained against an exterior; a
codebase's chief threat and only maintainer are the same party, in constant motion, and
so maintenance signal cannot come from periodic inspection — it has to be produced as
**exhaust of the work itself**, at the moment of the work, by the worker, who is the only
party holding the answer at zero inference cost. That is what the journal is: **signal
residue.** Residue is what distinguishes a designed penetration from damage — a hole with
a `decide` behind it is a feature; a hole without one is a leak, and in a system in
motion that distinction cannot be recovered later, because it exists only at the moment
of the cut. And residue is what keeps the atlas an **as-built drawing** instead of a
blueprint: a static drawing of a moving building quietly stops resembling it, while a
drawing fed by the decision stream, the drift series, and the heat readings moves with
the walls.

## The mental model: the enforcement ladder

Every rule a codebase depends on sits at one of three tiers. The harness exists to
move rules **up** the ladder — which is the same motion as moving the fact **down** the
price ladder above — and to make the current tier of every rule *visible*:

1. **Enshrined (structural)** — the wrong state is *unrepresentable*. A capability
   type with no trust parameter to dial at a call site; a constructor that only
   produces the safe shape. The best tier: correct by construction, no oracle needed
   to *stay* correct. This tier belongs to the **type system**, not to coherence.
2. **Totality-checked** — the rule has N sites, but ONE declarative home plus an
   oracle that enumerates the live domain and **fails loud** when the declaration and
   the domain disagree. Correct because *checked* every build. This is the tier the
   `boundary` claim machinery targets.
3. **Convention** — N sites held together by memory. A latent tear: it holds only
   because everyone remembers, so it will eventually not hold.

The thesis in one line: **conventions are failures lurking in the code; promote them
to contracts** — a type, a chokepoint, an oracle, a ratchet. Match rigor to
consequence: not every rule needs tier-1 (over-enshrining is its own pathology), but
a *security* rule at tier-3 is a bug waiting for a forgetful edit.

**The honest ceiling, stated plainly:** coherence verifies a boundary's **anatomy**
— the invariant is named, the chokepoint symbol exists, the oracle runs and iterates
a live domain. It does **not** verify that the wrong call is *impossible* (that's
the type system's job, tier-1), and it does **not** verify that a claim is the
**right** claim (that's the human's judgment — axiom #5, judge ≠ notary). It is a
coherence layer, not a proof system. Treat every green run accordingly.

## Install

Published on npm as [`@danilocampos/coherence`](https://www.npmjs.com/package/@danilocampos/coherence)
(the unscoped name was taken). Install it as a dev dependency; the `coherence` and
`coherence-hook` bins link into the consuming project:

```sh
npm install --save-dev @danilocampos/coherence
```

Releases are tag-driven with npm provenance. A repository ruleset makes existing `v*`
tags immutable; publication then requires that the exact tagged SHA passed `main` CI,
that the tag agrees with `package.json`, and that any existing npm version names that
same SHA. Use `>=0.32.0` — the 0.31.0 artifact is deprecated (broken dependency
declaration).

To qualify unreleased work, a git dependency still works — npm clones the repo and
runs `prepare` (which builds `dist/`):

```jsonc
// package.json
"devDependencies": {
  "@danilocampos/coherence": "github:daniloc/coherence#main"   // or pin a tag/commit
}
```

Then add scripts that call the bin:

```jsonc
"scripts": {
  "coherence:graph":  "coherence graph",
  "coherence:docs":   "coherence docs",
  "coherence:verify": "coherence verify",
  "coherence:claude-hooks-check": "coherence hooks --check --host claude",
  "coherence:codex-hooks-check": "coherence hooks --check --host codex"
}
```

Requires **Node ≥22** in the consuming project (the build targets ES2022). One
runtime dependency: `web-tree-sitter`, the wasm parser runtime behind every language
instrument (the grammar binaries ship with the package under `grammars/`, provenance
alongside).

## Configure the target project

Add `coherence.config.json` to the project root. Its **presence is the declaration**
that this directory is a coherence root: walking commands (`verify`, `graph`, the
ratchets) refuse without one — a configless run started in the wrong directory would
walk and grade everything under it — while journal, hook, and reference commands work
anywhere. `{}` is a complete config (the defaults do the rest). A useful minimal one:

```json
{
  "typecheck": ["npm", "run", "typecheck"],
  "test": ["npx", "vitest", "run", "-t"],
  "testMatch": "[1-9][0-9]* passed"
}
```

**Languages.** Three are built in — `"language": "typescript"`, `"python"`, or `"ruby"`
resolves against grammar binaries that ship with the package (`grammars/`, provenance
alongside), and every instrument reads them through those grammars. What each language
gets today, with the per-instrument query tables as the source of truth:

| Instrument | typescript | python | ruby | your adapter |
|---|---|---|---|---|
| Graph, claims, prose (`tree-sitter.ts`) | ✓ | ✓ | ✓ | ✓ |
| Serial test oracles (`test` argv + `testMatch`) | ✓ | ✓ | ✓ | ✓ |
| Everything language-blind (hooks, journal, mass, drift, atlas) | ✓ | ✓ | ✓ | ✓ |
| Surface → zero-anchor alarm (`SURFACE_LANGUAGES`, novelty.ts) | ✓ | ✓ | — | — |
| `via test` oracle + parity analysis (oracle-domain.ts) | ✓ | ✓ | — | — |
| Duplicate-domain ranking (`SITE_LANGUAGES`, redundancy.ts) | ✓ | ✓ | — | — |
| Injection sinks (`SINK_LANGUAGES`, lint-sinks.ts) | ✓ | ✓ | ✓ | — |
| Batched oracles (`testBatchFormat`) | vitest-json | pytest-json | serial | serial |

A `—` costs you the instrument, never a false verdict: an uncovered language simply
contributes nothing there. One consequence worth knowing: `via test` claims in an
uncovered language fail oracle analysis rather than pass vacuously — set
`"oracleDomain": false` until the language has an oracle arm.

Serial oracles are runner-agnostic — the claim's oracle name is appended to `test` and
`testMatch` guards the output — so rspec is `"test": ["bundle", "exec", "rspec", "-e"]`,
go is `["go", "test", "-run"]`, and so on. Only batch formats are enumerated.

**A python configuration**, end to end (`pytest-json-report` provides the batch report):

```json
{
  "language": "python",
  "codeExt": ["py"],
  "testDir": "tests/",
  "test": [".venv/bin/python", "-m", "pytest", "-k"],
  "testMatch": "[1-9]\\d* passed",
  "testBatch": [".venv/bin/python", "-m", "pytest", "--json-report", "--json-report-file=.coherence/test-report.json"],
  "testBatchFormat": "pytest-json",
  "ignore": ["node_modules", ".git", ".venv", "__pycache__", ".pytest_cache"]
}
```

A `passes test` claim cites the pytest function name (`test_…`); in batch mode it
matches every parametrized case of that function and all must pass.

**Adding a language is a ladder** — each rung is useful on its own:

**Rung 1 — a built-in name.** `typescript`, `python`, `ruby`: config only, nothing to
write. An unknown bare name refuses with the live built-in list rather than falling
back (a wrong grammar would grade a different tree than you configured).

**Rung 2 — a project adapter: the graph tier for any language.** `language` accepts a
`./`-relative module path, and for most languages you never write parsing: modern
tree-sitter grammar packages ship a prebuilt wasm (no native toolchain —
`web-tree-sitter` runs it sandboxed), and the shipped factory turns a grammar plus
~30 lines of capture queries into an adapter. Go, for example:

```json
{ "language": "./.coherence/adapters/go.mjs", "codeExt": ["go"] }
```

```js
// .coherence/adapters/go.mjs — npm i -D tree-sitter-go for the grammar wasm
import { makeTreeSitterAdapter } from "@danilocampos/coherence/dist/adapters/tree-sitter.js";
export default await makeTreeSitterAdapter({
  exts: ["go"],
  symbolQuery: `
    (function_declaration name: (identifier) @function)
    (method_declaration name: (field_identifier) @method)
    (type_declaration (type_spec name: (type_identifier) @type))
  `,
  importQuery: `(import_spec path: (interpreted_string_literal) @spec)`,
  lineComment: "//",
}, new URL("../../node_modules/tree-sitter-go/tree-sitter-go.wasm", import.meta.url).pathname);
```

Capture names become symbol kinds; the shipped specs in `src/adapters/tree-sitter.ts`
are the reference. Prose extraction is a named `docStyle` strategy (`"line"`,
`"jsdoc"`, `"docstring"`); a project module may instead supply its own `docs`
functions or hand-implement the five `LanguageAdapter` members directly — rung 2 is
code territory by definition, and both shapes serve the same seam. A wrong-shaped
module refuses naming the broken field. Importing the module executes project code —
the same declared trust as the config's `test`/`typecheck` argv.

**Rung 3 — the full field: instrument rows.** The instrument arms read languages as
pure data, so giving a language an instrument is a table row of capture queries, not
an analyzer: a `SURFACE_LANGUAGES` row (novelty.ts) feeds the zero-anchor alarm, a
`SITE_LANGUAGES` row (redundancy.ts) feeds duplicate-domain ranking, a
`SINK_LANGUAGES` row (lint-sinks.ts) feeds the injection ratchet, and an
`ORACLE_LANGUAGES` row (oracle-domain.ts) carries the `via test` analysis. The rule
every row lives under is enforced, not aspirational: a built-in pack carries queries,
patterns, and named strategies — **never functions** — and a guard sweeps every table
for violations (`language-packs.ts`). Rows live in the harness today, so rung 3 is a
contribution — small ones, as the ruby sinks row (three lines) shows — and the house
rule for every row is the one this repo's own migration was held to: build the new
reader beside an existing witness and gate them against a real corpus before trusting
it. A batch report format (`testBatchFormat`) is likewise a registered parser in
test-batch.ts; serial oracles need nothing.

### Adopt the lifecycle control

Do this after `npm install` and after `coherence.config.json` is in its final
directory. Run the commands from that directory—the **coherence root**, where the
consuming `package.json` installed `@danilocampos/coherence`. `npx` below resolves that
project-local dependency; no global installation is assumed.

1. **Name each host's project root when it differs.** The host project root is the
   directory the agent host opens and where that host keeps project hooks. Claude owns
   `.claude/settings.json`; Codex owns `.codex/hooks.json`. For an ordinary single-root
   layout, omit both fields. If coherence is installed in `app/` while both hosts open the
   repository root, put this in `app/coherence.config.json` *before* installing either
   control:

   ```json
   {
     "claudeProjectRoot": "..",
     "codexProjectRoot": ".."
   }
   ```

   `codexProjectRoot` defaults to `claudeProjectRoot`, then `"."`, but the explicit field
   is preferable when the layouts differ. In a Git checkout it must resolve to the same
   directory as `git rev-parse --show-toplevel`: Codex's canonical command deliberately
   finds `.codex/coherence-hook` from that root. It is not an arbitrary directory in which
   to park hook files. Outside Git, Codex treats the session working directory as its
   project root; install and launch the session from this configured root. Current-session
   activation remains the runtime proof that the structural path actually fired.

2. **Converge one host's control ON.** Do not author a repository-specific command or
   paste a near-equivalent hook block:

   ```sh
   npx coherence hooks install --host claude
   npx coherence hooks install --host codex --session "$CODEX_THREAD_ID"
   ```

   `--host` is deliberately explicit: a bare command remains Claude for compatibility,
   even when `CODEX_THREAD_ID` is present. `--session` is optional for installation and
   does not activate a running session—it asks the report printed after installation to
   inspect that exact session.

   Installation preserves unrelated settings and hooks and publishes exactly one shared
   five-event bundle for the selected host. The lifecycle domain is the same, but the
   host syntax is not. Claude receives:

   ```sh
   "$CLAUDE_PROJECT_DIR/.claude/coherence-hook" EVENT
   ```

   Codex receives its own matchers and launcher identity:

   ```sh
   codex_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd -P); "$codex_root/.codex/coherence-hook" EVENT
   ```

   In particular, Codex `SessionStart` matches `startup|resume|clear|compact`, while
   `PostToolUse` matches `Bash|apply_patch|update_plan|mcp__.*`. Layout is carried
   separately by the selected host's `coherence-root` file. If installation reports a
   missing lifecycle target, stop: install dependencies in the coherence root before
   editing host settings.

3. **Commit the complete selected control.** Track the selected host's three artifacts:

   - `.claude/settings.json`
   - `.claude/coherence-hook`
   - `.claude/coherence-root`

   or:

   - `.codex/hooks.json`
   - `.codex/coherence-hook`
   - `.codex/coherence-root`

   Also commit `coherence.config.json`. In a nested layout these files deliberately live
   at different levels: the config/package in the coherence root, the three control
   files in the host project root. `.claude/settings.local.json` is not part of Claude's
   shared control; the installer only removes recognized competing coherence actions
   from it. Codex's `.codex/config.toml` is inspected but not owned: an inline hook table
   prevents a singular project path and makes installation refuse, while
   `features.hooks = false` or `allow_managed_hooks_only = true` leaves the files
   configured but the project control absent. User, managed, and plugin Codex layers
   remain outside a repository check's authority.

4. **Accept the structural bit.** With no session in scope, this is the adoption gate and
   is suitable for CI:

   ```sh
   npx coherence hooks --check --host claude
   npx coherence hooks --check --host codex
   # or use the corresponding host-specific package script above
   ```

   Exit `0` means the singular canonical bundle, launcher, root mapping, and runnable
   target are all present. Exit `1` means absent/noncanonical; exit `2` means the checker
   could not answer safely (for example, invalid settings). A partial block, duplicate,
   legacy spelling, competing action, drifted launcher, misaligned Codex/Git root,
   excluded or disabled Codex project hooks, or missing target is OFF.

5. **Activate and prove the current Codex session separately.** Installation cannot make
   a hook fire retroactively. Review the exact project hook in Codex `/hooks`, then start
   or resume the session so `SessionStart` crosses the installed launcher. Inspect the
   same session by id:

   ```sh
   npx coherence hooks status --host codex --session "$CODEX_THREAD_ID"
   npx coherence hooks --check --host codex --session "$CODEX_THREAD_ID"
   ```

   With `--session`, `--check` requires both the structural bit and an event delivered by
   the exact selected host, launcher transport, and installed bundle fingerprint. That
   fingerprint includes the hook-body protocol as well as settings and launcher bytes,
   so an event from an older wire contract cannot prove the new body ran. A manual
   `coherence hook` probe is reported as direct evidence, not activation; an older bundle
   is reported as stale. There is deliberately no “newest session” fallback—concurrency
   makes newest an attribution bug. When neither `--session`, `COHERENCE_SESSION`, nor
   `CODEX_THREAD_ID` supplies an identity, `status` says the current session is unknown.
   Historical hook-opened sessions remain telemetry: yesterday's firing cannot redeem
   wiring removed today, and a newly installed runnable control can be present while this
   session's activation remains unconfirmed.

6. **Read the attribution ceiling.** Codex `PostToolUse` carries `session_id` but no
   `agent_id`, and subagent hooks share the parent's session id. The parent session file
   may therefore aggregate parent and descendant tool activity. Coherence records those
   rows as `parent-fallback`, reports their count in session status, and never promotes
   them to exact child evidence. A matching host/launcher/bundle row may still prove that
   the installed control reached the named parent session; activation does not strengthen
   its attribution. This is an honest aggregate, not a best guess. A
   first-class experiment keeps valid fallback rows but labels the resulting telemetry
   `parent-session-aggregate`: it may include descendant work and is never presented as
   exact owner or child evidence. Exact agent/session rows are `owner-session`, an empty
   post-open window is `none`, and trace rows written before observation metadata existed
   remain visible as `legacy-unscoped`. Unreadable or internally unscoped/unknown rows
   refuse closure. `none` is an attribution result, not proof of a zero failure rate:
   without current-bundle activation and a nonzero predeclared event denominator, hook
   reliability remains unmeasured. Likewise, a
   `SubagentStop` without an exact child id reports the child journal count as unavailable
   and takes no child calibration snapshot; the repository-wide open-conjecture reminder
   remains explicitly repository-wide.

7. **Watch the record as it is written.** With the control on, every agent session
   journals as it works. From the coherence root, in a second terminal:

   ```sh
   npx coherence journal
   ```

   This is the payoff surface of the whole record: every stream interleaved, newest
   first, live. `⏎` drills into an entry, `c` lists the open conjectures, `f` follows
   the tip as agents write. Leave it open while a fleet runs and you are reading your
   agents' reasoning at the moment it happens instead of reconstructing it afterward.

`npx coherence hooks print --host codex` (or `--host claude`) renders that host's canonical
settings, launcher, and mapping for inspection. It is not the preferred installer. The
launcher and mapping paths are coherence-owned: `install` repairs drift at those names,
while `uninstall --host …` removes them only if their bytes still prove coherence ownership.

### The project's voice in the emissions

The canonical hook text is the harness's: identical in every adopting project, which is
what keeps it byte-testable. What your project knows and the harness cannot — its own
commands, its conventions, the one warning its history taught it — goes in per-event
files under `.coherence/hooks/`:

- `<Event>.override.md` **replaces** that event's canonical emission
- `<Event>.append.md` **follows** whatever the base said

for any of the five lifecycle events. One composition rule, no conflict state: the
override (if any) is the base, otherwise the canonical text is; the append follows it.
An **empty** override deliberately silences the event. Events that canonically emit
nothing (main `Stop`, `PostToolUse`) speak only when a project declares a voice there —
and the stop-loop guard still outranks it. Tokens `{{session}}`, `{{agent}}`, `{{cli}}`
and `{{scope}}` substitute at emission (`{{agent}}` is only guaranteed at the start
events); a token the harness cannot supply stays honestly literal.

A customization file that cannot be read costs exactly the customization: the event falls
back to its canonical emission rather than breaking the agent's session. The loud surface
for both damage and review is:

```sh
npx coherence hooks review
```

which prints every event's **effective** emission with provenance — canonical, override,
append, silenced — and a `warning:` line per unreadable file. Commit `.coherence/hooks/`
alongside the decisions folder: the voice is part of the field, and it should travel with
the repository.

### Regulate the field: one next action

An instrument answers one question. A regulator decides which answer should change what
you do **next**. `coherence regulate` is the first deliberately narrow control loop over
the existing instruments: observe, select one intervention, act, then run it again. It is
not another dashboard or an umbrella verifier.

```sh
npx coherence doctrine                         # inspect the law being applied
npx coherence regulate                         # current host (Codex when CODEX_THREAD_ID is set)
npx coherence regulate --host claude
npx coherence regulate --host codex --since origin/main
npx coherence regulate --check --host codex
npx coherence regulate --host codex --json
```

The doctrine is versioned and built in, not a configurable score. Its potential is
lexicographic: **refuse an unavailable required reading**, then **require a decision**,
then **redirect an absent lifecycle control to its one repair command**, otherwise
**release**. The first nonempty class wins. One run emits at most one executable command;
lower-priority obligations are counted as withheld, and a rerun after the selected action
reveals the next one. Insertion order, duplicate readings, and locally convenient weights
cannot change that order.

V2 evaluates exactly four rules: the selected host's canonical lifecycle control is
present; swarm decisions and work are attributable, structurally readable, and
collision-visible; completed work carries an explicit verification-to-work consequence
link; and significant behavioral growth carries an invariant/boundary/parity anchor or a
standing patch-bound decision. That is the whole domain. `release` therefore means “no
intervention under those four live rules,” never “this repository is coherent” or “this
change is correct.” `coherence doctrine [--json]` prints the rules and their stated
limits from the same registry the selector executes.

`--host` selects the control being regulated; when omitted, a Codex process selects Codex
and other environments select Claude. The host is part of the reading and decision id,
and an absent control redirects to `hooks install --host <that-host>`—a present Claude
control cannot redeem Codex. The command is explicit and read-only. It installs no hook,
adds no anchor, writes no
attestation, and does not update the journal or status record. Without `--check`, a
redirect or decision requirement is advisory and exits `0`; with `--check`, either exits
`1`. Release exits `0`, and refusal—where the regulator could not obtain a required
reading—exits `2` in both modes. `--json` changes only the representation.

The full regulator selector is intentionally **not in any hook yet**. `SubagentStop`
independently reports the pre-existing change signal, but main-agent `Stop` emits no
feedback at all: it fires once per turn, and any output would make the host continue.
Putting an uncalibrated selector there would turn an explicit report into repeated ambient
control. The first release earns automation by direct use. A later rollout needs genuine
per-agent attribution before it can canary the same decision without charging one agent
for another agent's shared-worktree change.

Representative configuration (the `Config` interface in `src/types.ts` is authoritative;
defaults come from `src/config.ts`):

```json
{
  "outputDir": "docs/coherence",
  "entryDir": ".",
  "tooling": ["scripts"],
  "ignore": ["node_modules", ".git", "dist", ".wrangler", "__tests__"],
  "codeExt": ["ts", "sql"],
  "typecheck": ["npm", "run", "typecheck"],
  "test": ["npx", "vitest", "run", "-t"],
  "testMatch": "[1-9][0-9]* passed",
  "testBatch": ["npx", "vitest", "run", "--reporter=json", "--outputFile=.coherence/test-report.json"],
  "testBatchFormat": "vitest-json",
  "oracleDomain": true,
  "staticOracleExistence": true,
  "language": "typescript",
  "platform": "cloudflare",
  "claudeMdPath": "../CLAUDE.md",
  "claudeProjectRoot": "..",
  "codexProjectRoot": "..",
  "dictionary": "dictionary",
  "sources": ["src"],
  "testDir": "__tests__",
  "components": [{ "name": "billing", "files": ["src/billing/**"] }],
  "conventions": { "guardVerb": "^(assert|require|check)", "seed": [], "dismissed": {} },
  "sinks": { "safeSql": "quoteIdent\\(", "safeHtml": "escapeHtml\\(" },
  "atlas": { "charts": {}, "transitions": {} },
  "novelty": { "minSurface": 8, "minLoc": 400, "ratio": 12 },
  "artifacts": { "worker": ["worker.ts", "entities/**", "shared/**"], "browser": ["web/**", "shared/**"] },
  "contracts": { "sse-frames": { "producer": "Patient", "consumer": "readSse", "type": "SseFrames" } }
}
```

### Config reference

| Field | Default | Purpose |
| --- | --- | --- |
| `outputDir` | `"public"` | Where generated artifacts go (`graph.json`, `_graph.html`, `_overview.html`, ratchet baselines). |
| `entryDir` | `"."` | The entrypoint component's dir (`.` = root). |
| `tooling` | `[]` | Path prefixes demoted to a "tooling" group in the graph. |
| `ignore` | `["node_modules",".git","dist",".turbo",".wrangler"]` | File or directory names the spec/code walk never enters. Put machine-generated environment declarations here when platform capability inference should use authored types only. NOTE: neither the meta-oracle nor the fast Vitest name floor reuses this graph list when hunting for oracle test files (see below). |
| `codeExt` | `["ts"]` | File extensions treated as code for the tree. |
| `typecheck` | `["npm","run","typecheck"]` | Command the `typechecks` claim shells. |
| `test` | `[]` | Base command for `passes test "<name>"` / boundary-oracle claims; `<name>` is appended as the final arg. Empty = those claims skip. |
| `testMatch` | unset | Optional regex the test output MUST contain to count as a pass. Guards the **serial** arm against runners like `vitest -t` that exit 0 when the name matched nothing. **Not needed for batched claims** — a batch report observes a missing test directly (see "Batched oracle execution"). It does **not** protect a `node --test` project at all (measured: a pattern matching nothing still reports the file as one passing test). |
| `testBatch` | **derived** from `test` | Command that runs the **whole suite** once and emits a machine-readable report. Left unset, coherence **derives** it when the runner is recognizable (vitest today), so batching needs no configuration. Set it explicitly for any other runner: `["npx","vitest","run","--reporter=json","--outputFile=.coherence/test-report.json"]`. |
| `testBatchFormat` | `"vitest-json"` | The report format: `vitest-json` or `pytest-json`. An **unknown** value fails the run immediately — it is never a silent fallback to the slow path. |
| `oracleExecution` | unset (= batched) | Set to `"serial"` to demand the pre-0.17 profile: one **full test-pool boot per claim**. Supported, never implicit — see "Batched oracle execution". Same as the `--serial-oracles` flag, which wins if both are present. |
| `oracleDomain` | `true` (anything but `false`) | The META-ORACLE gate: assert a `via test` oracle iterates a LIVE domain. Set `false` to disable the gate. |
| `staticOracleExistence` | `true` when Vitest is identifiable | The runner-free `verify --fast` name-existence floor for conventional Vitest source. Set `false` when a project's test registry is assembled outside the scanner's direct-declaration grade; named executable claims then remain UNKNOWN/skipped and no source index is built. |
| `language` | `"typescript"` | Language adapter key. |
| `platform` | `null` | Platform adapter key, or null. |
| `components` | unset | Sub-component overrides for `decompose`/`drift` co-change analysis ONLY (globs relative to root; first match wins). The spec graph, verify, and coverage are untouched. |
| `claudeMdPath` | `"CLAUDE.md"` | Path to the CLAUDE.md whose fenced block `coherence claude` owns. May be `../`-relative to escape the coherence root (repo-root CLAUDE.md above a sub-package). |
| `claudeProjectRoot` | `"."` | Path from the coherence root to the Claude project root whose `.claude/settings.json` owns lifecycle hooks. Set `".."` when coherence/package.json lives in a sub-project but Claude opens at the repository root. The installed launcher remains identical; `.claude/coherence-root` carries the relative address back. |
| `codexProjectRoot` | `claudeProjectRoot`, then `"."` | Path from the coherence root to the Codex project root whose `.codex/hooks.json` owns lifecycle hooks. In a Git checkout this must resolve to `git rev-parse --show-toplevel`, because the canonical launcher is found from that root. The Codex and Claude controls remain independent even when their roots coincide. |
| `dictionary` | `"dictionary"` | Dir (relative to the coherence root) holding the pattern dictionary — one `<Word>.md` per word. A `conforms to <Word>` claim expands the word's commitments against the declaring component. A project with no such dir simply has no words (see "The dictionary" below). |
| `sources` | `[entryDir]` | Dirs the `lint-sinks`/`conventions` scans are scoped to — keep generated/vendored trees out. |
| `testDir` | `"__tests__"` | Path substring identifying test files for the ratchet scans. |
| `conventions` | unset | `guardVerb` (regex for guard-function NAMES), `seed` (extra guard names), `dismissed` (guard → why it's covered elsewhere). |
| `sinks` | unset | `safeSql`/`safeHtml` — regexes for interpolation expressions that are SAFE by construction. |
| `mass` | unset | The mass ratchet's project-owned half: `measures` (`[{ key, cmd, unit? }]` — each `cmd` runs from the project root and the **last numeric token** of stdout is the value; a nonzero exit or unparseable output is UNMEASURABLE and fails `--check`, never `0`), `deps` (set `false` to drop the package.json / package-lock.json dimensions), `tolerance` (per baseline key — how much growth is allowed before the ratchet says so; default `0`). |
| `atlas` | unset | Trust-manifold data: `charts` (trust domain → description), `transitions` (chokepoint symbol → crossing; each may set `enshrined: true` — see below), `nonTransition` (within-chart boundaries), `knownPending` (mapped symbols tolerated as not-yet-in-source). A transition's `enshrined: true` is an **explicit** attestation that the illegal value at that crossing is unrepresentable (a runtime-branded capability), promoting it to tier-1 — it is NOT inferred from a claim's verb, and it MUST be backed by a `via guard` boundary claim (an `enshrined` marker with no backing guard fails `atlas --check`). |
| `novelty` | unset | Thresholds for `log`'s novelty-vs-anchor advisory: `minSurface` (8), `minLoc` (400), `ratio` (12). |
| `redundancy` | unset | Thresholds for the `redundancy` advisory (undeclared duplicated domains): `minShared` (3), `containment` (0.7), `minScore` (3.5), `maxDf` (6), `top` (10). Every knob trades recall for precision — a wall of candidates is worse than silence. |
| `artifacts` | unset | Deploy units for `contracts`: unit name → path globs. A file may belong to several (shared vocabulary typically does). |
| `claimKinds` | unset | The kinds a claim may declare via a trailing `[kind]`, and each kind's policy: `{ "measured": { "policy": "warn", "why": "…" } }`. `pin` gates normally; `warn` gates but reports every run. An **undeclared** kind fails the run. Unset = feature off, no output, no behaviour change. See "Claim kinds" below. |
| `contracts` | unset | Declared cross-unit data contracts: name → `{ producer, consumer, type, description? }` (all symbols). `contracts --check` fails a contract that dangles or that no boundary/parity claim anchors. |

Then author `*.spec.md` files (a folder containing one is a *node*). A spec is
`# Name`, a one-line intent, an optional `## works when` claim list, an optional
`## invariants` list, an optional `## refutations` list, and an optional `## why`
(protected rationale). Claims are a
grammar, not prose — the parser (`src/walk.ts`) strips markdown-formatter escapes
(`\_` → `_`) so a prettified spec still parses.

## The claim phrasebook (the `## works when` grammar)

The claim grammar is a declarative registry — `CLAIM_FORMS` in `src/phrasebook.ts`,
an ordered list of forms where **first match wins** (the order IS the precedence).
`evalClaim` (`src/verify.ts`) is a thin loop over it. **A line matching none of these
is SKIPPED** (`no verifier (dialect gap)`) — it never goes red. A typo'd verb is
therefore a silent no-op; check verify's `skipped` count after authoring claims.

The index below is **derived from that registry** by `coherence docs` — the same
marker-pair machinery as the command index, checked the same way (`docs --check` and
`test/commands.test.ts` byte-compare it against the registry). It replaced a
hand-maintained copy that had drifted exactly as its own caveat predicted: 8 forms
listed while the registry carried 9 (`lives in` was missing), and a boundary grammar
that had lost the `crossing` clause. `coherence phrasebook` prints the same registry
at the terminal.

<!-- coherence:phrasebook:begin -->
<!-- GENERATED by `coherence docs` from the CLAIM_FORMS registry (src/phrasebook.ts). Do not
     edit by hand — change the registry and re-run. Everything OUTSIDE these markers is
     authored prose. -->

_9 claim forms, in registry order — **first match wins**, so this order IS the
precedence. Derived from the same registry `evalClaim` executes (`coherence phrasebook`
prints it at the terminal), so it cannot drift from the grammar. The per-form notes below
the block are authored._

- **typechecks** [deterministic] — `typechecks`
  e.g. `typechecks`
- **exists** [deterministic] — `<file> exists at (root | this node | every node)`
  e.g. `wrangler.jsonc exists at root`
- **imports** [deterministic] — `<file> imports <specifier>`
  e.g. `main.ts imports ./registry`
- **responds** [live] — `<url> responds <status> [with "<text>"]`
  e.g. `http://localhost:8787/health responds 200 with "ok"`
- **passes test** [executable] — `passes test "<name>"`
  e.g. `passes test "write policy totality"`
- **boundary** [hybrid] — `boundary "<invariant>" at <chokepoint> [crossing <zone> -> <zone>] [via (test|guard) "<oracle>"]`
  e.g. `boundary "fail-closed writes" at applyWritePolicy crossing agent-mcp -> storage via test "write policy totality"`
- **lives in** [deterministic] — `lives in <zone>`
  e.g. `lives in owner-trusted`
- **parity** [hybrid] — `parity "<invariant>" over <domain> between <fnA> and <fnB> via test "<oracle>"`
  e.g. `parity "disclosure faithfulness" over TOOL_NAMES between toolActivity and messageProvenance via test "live equals settled"`
- **conforms to** [hybrid] — `conforms to <Word>`
  e.g. `conforms to OwnedScope`

<!-- coherence:phrasebook:end -->

Notes, from the implementing code:

- **exists** resolves `root` to the project root and `this node` to the component's
  dir. `every node` is accepted by the grammar but is currently evaluated against
  the declaring component's dir only (same as `this node`) — claims are per-spec, so
  there is no cross-node fan-out today.
- **imports** reads `<file>` relative to the node dir and requires a
  `from "<specifier>"` match.
- **responds** treats a connection failure as a *skip* ("unreachable"), not a fail —
  so a full `verify` run without the server up quietly skips the live tier rather
  than going red. Only a reachable-but-wrong status/body fails.
- **passes test** shells `config.test` with `<name>` appended and applies
  `config.testMatch` as positive evidence the named test actually ran (exit 0 alone
  is not trusted). This is the **single front door**: an invariant enforced by a
  test is named in the spec, so `coherence verify` transitively runs it, and a claim
  pointing at a renamed or deleted test goes **red** — that's the rot detection. With
  `config.testBatch` set, the same claim resolves from one whole-suite report instead of
  its own runner boot, and the rot detection stops depending on `testMatch` at all — see
  "Batched oracle execution".
- **boundary** asserts a self-enforcing boundary's anatomy *as a unit*: the named
  invariant, the chokepoint SYMBOL exists in the code graph, and (if given) the
  oracle passes — `via test` additionally passes the meta-oracle (next section);
  `via guard` is exempt from it (see the escape-hatch section). It **anchors** the
  named invariant for the coverage gate.
- **lives in** declares the component's trust-zone RESIDENCE for the promise graph
  (so a cross-component import can be graded same-zone / covered / naked). Like a
  `crossing`, it is a *declaration*, not a runtime property: verify asserts only that
  it is well-formed and passes. Its semantic validation (is the zone declared? does
  the wall it opens have a gate?) lives in the promise layer — `coherence contract`.
  It is registered as a form precisely so it does not grade as a dialect-gap skip.
- **parity** generalizes the boundary totality pattern from COVERAGE to AGREEMENT:
  `<fnA>` and `<fnB>` are declared two projections of ONE enumerated domain and must
  agree over it (the drift class where a live view and a settled view — or a server
  table and a client table in *different deploy artifacts* — silently diverge). It
  anchors the invariant like a boundary; `<domain>`, `<fnA>`, `<fnB>` must all exist
  in the code graph; and the **parity meta-oracle** (run even under `--fast`) requires
  the named describe to ENUMERATE the declared domain and DRIVE both projections — a
  one-sided oracle (e.g. one comparing two runs of the *same* projector) or a
  hand-copied sample list goes red. `via test` is mandatory: what "agree" means is
  project knowledge, so the oracle body stays yours. `coherence scaffold parity <name>`
  prints the paste-in spec fragments plus a domain-loop oracle skeleton.
- **conforms to** expands a dictionary word's commitments against the declaring
  component (see the next section). Unlike every other form, a *broken* `conforms to`
  goes **red**, not skip.

## The dictionary (`conforms to <Word>`)

A pattern recurs across a codebase — "owner-scoped reads", "fail-closed writes",
"idempotent handler". Rather than re-authoring the same claim list at every node that
upholds it, name it once as a **word** and have each node `conforms to` it. A word is
a *pattern with commitments, grown from the project's own code*: a dictionary edit
propagates to every conforming node on the next verify.

Words live in `<coherence root>/<dictionary>/<Word>.md` (dir configurable via
`dictionary`, default `"dictionary"`). A word file is:

```md
# OwnedScope
Reads and writes stay inside the caller's owner scope.

## commitments
- boundary "owner-scoped reads" at scopedQuery via guard "no cross-owner read"
- typechecks
- conforms to Idempotent
```

`# <Word>` heading, first non-blank line = the intent, then a `## commitments` bullet
list where **each bullet is a claim line in the phrasebook grammar above** — including
`boundary …` and a nested `conforms to <OtherWord>`. (Word files are parsed with the
same markdown-unescape as specs, so a prettified file still resolves.)

A node opts in with a single `## works when` claim:

```md
- conforms to OwnedScope
```

On verify, `conforms to OwnedScope` loads the word file and evaluates **every
commitment against the declaring component's own context** — same node dir, same
anchoring. All commitments green → the claim passes (`OwnedScope: N commitments
green`); any commitment fails → the claim fails, naming the word and the first failing
commitment.

Three properties make a word a **contract**, not a convenience:

- **Boundary commitments anchor on the declaring component.** A `boundary "<inv>" …`
  commitment anchors `<inv>` for the conforming node's coverage gate *exactly as if it
  were written inline* — so a node can declare `## invariants` and satisfy the
  unanchored-invariant ratchet entirely through the word.
- **Red, not skip, inside a word.** In a free-form spec a line matching no claim form
  is a silent dialect-gap skip. Inside a word's commitments that is a **failure** — a
  typo'd verb in a contract must go red, not vanish. Likewise a **missing or
  unparseable word file is red** (the verb was recognized; a broken reference is not a
  dialect gap), and `conforms to` **cycles** (`A → B → A`) fail with a clear detail.
- **Propagation.** The word file is re-read every verify, so editing a commitment
  flips every conforming node on the next run — one edit, one home, N enforced nodes.

The dictionary is rendered into the generated overview / `AGENTS.md` as a small
**Dictionary** section (each word, its intent, and which components conform) — but
only when a dictionary dir exists; projects without one see zero output change.

**Coverage gates node-contract completeness, not symbol-doc exhaustiveness.** A node
must carry claims and a `## why`; per-symbol prose is *advisory* (surfaced as jobs,
never red). Forcing a docblock on every export produces stale busywork and a
perpetually-red baseline that trains contributors to ignore the gate.

### `## invariants` — the no-unanchored-invariant gate

A spec may declare a `## invariants` section (a bullet list of named properties the
component upholds). **Every listed invariant must be anchored by a `boundary "<name>" …`
claim, or coverage FAILS.** This is the ratchet: it makes "every invariant is enforced at
a chokepoint with a totality oracle" a *checkable property* — a boundary shipped without
its oracle fails loud instead of rotting silently. The intent is to encode the doctrine
*convert block-lists into chokepoints; fail closed; one home; a totality oracle* as
machinery rather than prose, so a codebase inherits it by construction.

### `## refutations` — the observed negative control

A spec may declare a `## refutations` section: one line per invariant, recording the
experiment that made it go **red**.

```markdown
## invariants
- one write site per shared scalar

## refutations
- one write site per shared scalar: deleted sumChannel's total check -> RED, "1 failed | 3 passed"
```

Verify reports the gap (`refutations: 1/2 invariants carry an observed negative
control`) and names the uncovered ones. It never fails on it — **a refutation is a
thing you did, and coherence cannot know whether you did it.** The section exists
because a green claim and an unfalsifiable claim are indistinguishable from the
outside, and only one of them is evidence. Free-form after the `invariant: ` prefix;
record what you broke and what the run said.

The gap list appears only once a project has declared its **first** refutation — a line
per invariant on a project that has never used the feature is a nag. `verify --raise`
honours the same floor exactly, so a project with no refutations raises no questions here.

### Claim kinds — what a claim is ALLOWED to assert

Coherence exists to prevent behavioural drift. On a **simulation** — or anything whose
current behaviour is a guess — that same act pins bad behaviour in place, and the
damage is invisible until a later subsystem contradicts it. A claim asserting
`landFraction ≈ 0.37` goes red when the model gets *better*.

The fix is not for coherence to have an opinion. **The project declares its own kinds
and their policy**; coherence enforces what was declared and nothing else:

```json
"claimKinds": {
  "structural": { "policy": "pin" },
  "mathematical": { "policy": "pin" },
  "measured": { "policy": "warn", "why": "chaotic system — a measured value pins today's bug" }
}
```

A claim carries its kind as a trailing `[bracket]`:

```markdown
## works when
- boundary "one write site" at applyFlux via test "flux totality" [structural]
- passes test "sea level p50 within 2 m" [measured]
```

The suffix is stripped by the **parser** (`src/walk.ts`), at the single site where a
spec becomes claims — so `claims` holds the bare text and the kind rides alongside in
`claimKinds`. Every consumer downstream (`parseBoundary`, the coverage ratchet, the
panel, the promise graph, and the status record's identity) sees the string
it saw in 0.10.0. **Annotating an existing claim with a kind does not orphan its
history**, exactly as the `crossing` clause does not.

The generated CLAUDE.md invariant table grows a **Kind** and a **Refuted?** column
when the project uses those features, and only then. That is where the two facts have
to survive a context boundary: a fresh agent reading it learns "this one is `measured`,
so it could convict us for improving" and "nobody has ever watched this one fail.

| policy | effect |
| --- | --- |
| `pin` | normal — the claim gates as usual |
| `warn` | the claim still gates, but every run reports it and prints the project's own `why` |
| *(undeclared kind)* | **RED** — a typo'd kind must not silently grade as unkinded |

The whole feature is **off unless `claimKinds` is configured**: no config, no output,
no behaviour change.

### The never-red advisory

Verify flags claims that are green on every run, have never once been red, and carry
no recorded refutation. That combination is not proof of correctness — it is equally
the signature of a claim nothing can break. Requires 3+ recorded runs (a `skip` is
not a run), so it stays quiet on a young project.

Backed by sticky history in the status record: `everFailed` is set on the first red
and is **never** cleared, along with `lastFailAt` / `lastFailCommit`. A claim that has
ever been red has been shown to be capable of going red — that fact is worth more than
its current colour.

`verify --raise` turns each of these into an open conjecture in the decision journal
instead of a line on a terminal — `[instrument]` ("the oracle is vacuous") is exactly the
right first hypothesis, and the discriminating test is the refutation you owe anyway. See
"`--raise`".

## The meta-oracle: what it proves — and what it does NOT

A `boundary … via test "<oracle>"` claim already checks the chokepoint symbol exists
and the named test passes. Those two say NOTHING about whether the oracle is a real
totality check: a test that loops a hand-written array passes, looks total, and
proves nothing about completeness. The meta-oracle (`src/oracle-domain.ts`,
`analyzeOracle`) is the third assertion. It locates the oracle by its **exact
`describe("<title>")`** in the project's test files (for Python, an exact
`def <name>(`/`class <Name>`), reads the oracle's own source, and classifies how it
iterates its domain:

- **LIVE** — some assertion loop ranges over a live-derived collection: an imported
  binding (a registry/SSOT), a call/query result, member access on an import, or the
  anchor symbol itself. The analyzer peels `Object.keys/values/entries`,
  `Array.from`, and chained `.map`/`.filter`/etc. down to the source collection, and
  recognizes `for…of`/`for…in`, `.forEach`-family calls, `it.each`/`test.each`/
  `describe.each`, and spreads as iteration. LIVE **passes**.
- **LITERAL** — every loop iterates an array/regex literal, a same-file `const`
  array, or `new Set([...literal])`. A sampling oracle wearing the totality label:
  the hand-list drifts from the domain silently. **Fails** the claim.
- **NO-ITERATION** — no domain iteration at all (a pure source-grep, or hand-
  enumerated `it()` blocks). Asserts a source property, not coverage. **Fails.**
- **NOT-FOUND** — no `describe` with that exact title exists. **Fails** — it does
  *not* fall through to the runner. (The runner matches names as a substring/regex,
  so a claim anchored to an `it()` title or a typo'd describe would still pass the
  runner while silently opting out of domain analysis — the exact muting that lets a
  hand-list regression ship green. `via test` means "analyzable totality"; if the
  describe can't be located, the claim is unverifiable as declared. Name the
  `describe` after the invariant, or use `passes test`/`via guard`.)

The analysis is cheap AST work (the `typescript` compiler API; no runner), so it
runs even under `--fast`. It deliberately does **not** reuse `config.ignore` when
hunting for test files — projects commonly exclude their test dir from the spec
graph, and that's exactly where the oracles live; only true build/VCS noise dirs are
skipped. Unknown identifiers (params, closure vars) classify as LIVE — the analyzer
is conservative and never false-fails.

### The #1 footgun: live-rooted ≠ the right, complete domain

**The meta-oracle checks the iteration ROOT is live-derived — it does NOT check the
domain is COMPLETE.** The canonical failure:

```ts
// PASSES the meta-oracle: the root `app.routes` is live (imported binding).
// But the EFFECTIVE domain is a hand-list hidden in the filter predicate —
// every route outside PUBLIC and "…" is silently uncovered.
for (const r of app.routes.filter(r => PUBLIC.has(r) || r === "…")) {
  // assert …
}
```

This oracle is live-rooted (the analyzer peels `.filter` down to `app.routes`), so
`via test` goes green — while the predicate quietly narrows the domain to a
hand-list. A whole class of elements is uncovered and nothing is red. This is a real
failure mode, not a theoretical one: **do not mistake a passing `via test` for a
proof of totality.** The pattern that actually prevents it is in the next section.

Two related honest limits, also from the code:

- **Vacuous-if-empty.** A LIVE domain that silently shrinks to zero (a schema
  projection whose shape changed, a registry that collapsed) makes the loop range
  over nothing and pass vacuously. The analyzer detects a **floor** assertion
  (`expect(domain.length).toBeGreaterThanOrEqual(n)`, or a bare `.length >= n`) and
  *annotates* a live oracle without one ("no domain floor (vacuous if the domain
  empties)") — but the annotation is advisory; it does not fail the claim. Write the
  floor.
- **Anatomy, not semantics.** The meta-oracle proves the oracle *iterates a live
  domain*. It **cannot** prove the oracle exercises the real enforcement rather than
  a *correlate* of it. An oracle can loop a live domain, pass every static check,
  and still assert a proxy — e.g. a unit test with a fake DB that asserts the owner
  argument was *passed*, while the SQL predicate that actually filters the rows has
  been deleted. `oracle → meta-oracle` are both static; a proxy fools both. The
  answer is perturbation (see the checklist below).

## Uniform vs non-uniform domains — the pattern that prevents the footgun

Before writing an oracle, ask: **is every element of the live domain in scope for
this invariant, or only some?**

**UNIFORM** — every element is in scope ("every route must 401 without a token",
"every kernel table is classified"). A single loop over the whole live set is
genuinely total:

```ts
describe("auth totality", () => {
  for (const r of app.routes) {
    it(`${r.path} rejects an unauthenticated request`, async () => { /* … */ });
  }
});
```

No filter, no carve-outs. If an element genuinely can't be asserted uniformly, that
is the signal your domain is not uniform — do not reach for `.filter`.

**NON-UNIFORM** — only SOME elements are in scope ("these routes are metered, those
aren't"; "these tables sync, those are local"). A single loop **cannot self-certify
completeness** — any filter/carve-out re-introduces the hand-list. You need
**double-entry**: declare the classification as *data* (one home), then check it
against the live domain in **both directions** — every live element is classified,
and every classification is live:

```ts
import { METERED, UNMETERED } from "../src/billing/classification"; // data, one home
import { app } from "../src/app";

describe("metering classification totality", () => {
  const live = new Set(app.routes.map((r) => r.path));
  it("every live route is classified", () => {
    for (const r of live) assert.ok(METERED.has(r) || UNMETERED.has(r), r);
  });
  it("every classification is live", () => {
    for (const r of [...METERED, ...UNMETERED]) assert.ok(live.has(r), r);
  });
  it("the domain has a floor", () => {
    assert.ok(live.size >= 10); // collapse-to-empty fails loud, not vacuously
  });
});
```

The chokepoint then *derives* its behavior from the same classification data — one
home, both the code and the oracle reading it.

Honest note: even double-entry only reduces the residual question to **"is the live
source you named genuinely the complete domain?"** If `app.routes` is not actually
where every route registers, no oracle over it can save you. That last step stays
human judgment — name your SSOT deliberately.

## Authoring a boundary — the checklist

To add `boundary "<inv>" at <chokepoint> via test|guard "<oracle>"`:

1. **Name the invariant** in the spec's `## invariants` list. The coverage gate now
   refuses the spec until a `boundary` claim anchors it — that refusal is the
   ratchet.
2. **Put the chokepoint where the invariant is *about*** — the one symbol all paths
   to the protected thing cross (a required flag, a registry read, a factory), not
   the convenient layer. The claim fails until the symbol exists in the code graph.
3. **Give it a fail-closed default** — the unclassified/unrouted case resolves to
   the safe state, so forgetting to update the declaration is *safe*.
4. **Write the oracle over the LIVE domain** — uniform → a single loop over the
   whole live set; non-uniform → double-entry (previous section). Name the
   `describe` exactly what the claim says (the meta-oracle matches it as an *exact*
   string, so that title must be literal), and add a domain floor. The harness now
   **regex-escapes** the claim/oracle name before passing it to the runner's `-t`, so
   a title with `+` or parentheses matches literally instead of silently matching
   nothing — the only remaining constraint is whatever regex your own `config.testMatch`
   imposes on the runner's *output*.
5. **MANDATORY — validate by perturbation.** Break the chokepoint (revert the fix,
   or inject the exact violation the invariant forbids), confirm the oracle goes
   **RED**, then restore. **A green oracle can be green for the wrong reason; only a
   confirmed red proves it enforces.** If it stays green under the violation, the
   oracle tests a correlate — rewrite it against the real mechanism (real DB, real
   dispatch). For an impact read rather than a spot check, inject a *fair* set —
   in-domain violations, out-of-domain logic bugs (blind spots), benign edits (false
   alarms) — and score which go red. Static layers stack; the injection is ground
   truth.

`coherence scaffold boundary <name>` emits the complete shape in one shot — a draft
spec pre-wired with `## invariants`, the `boundary` claim, and the
chokepoint/fail-closed/oracle TODOs — so the full anatomy is the cheapest thing to
ship. `coherence scaffold invariant <name>` prints the paste-in fragments for an
*existing* spec.

**`decompose` / `drift` are degenerate with a single node** — LOCALITY reads a
trivial 100% and SPREAD flat until the spec tree actually carves the code into
multiple components.

## `via guard` — the escape hatch, with warnings

Not every real oracle is a domain loop. Two other kinds exist, and `via guard
"<oracle>"` is the verb for both: the oracle test must still run and pass, but the
meta-oracle's live-domain analysis is **skipped** (`src/verify.ts`, the boundary arm —
the `verb === "test"` condition gates the `analyzeOracle` call).

- **Source-property checks**: "no trusted factory exists anywhere", "no call site
  constructs this type directly". A property of the *code as text/AST*, with no live
  domain to iterate.
- **Non-domain behavioral invariants**: a `test()` block that exercises a behavior
  with no enumerable domain at all — "a moved file keeps its baselined identity",
  "retracted decisions disappear from the audit". This repo's own six `Harness core`
  boundaries are all of this kind: they are behavioral oracles, not totalities and
  not AST walks, and `via guard` is the honest verb for them precisely because
  claiming `via test` would assert a domain-totality analysis they cannot pass.
  The cost of the honest verb is real: a guard proves *the scenario in the test
  body*, not coverage of a domain — which is why the refutations ledger (mutate the
  chokepoint, watch the guard red) matters most for this kind.

Two warnings:

- **It can launder a hand-list.** Because `via guard` skips domain analysis, a
  sampling oracle re-declared as a guard sails past the meta-oracle. Use it ONLY for
  genuine source properties — if your oracle *could* be a loop over a live domain,
  it must be `via test`. Treat every `via guard` in review as a claim that needs a
  human eye.
- **Write source guards as AST walks, never regexes.** A guard that greps source
  text for a forbidden token misses aliases (`const f = trustedFactory`), computed
  access (`obj["trusted" + "Factory"]`), re-exports, and string-embedded code — it
  is theater. Walk the actual TypeScript program (the compilation surface) the way
  `oracle-domain.ts` itself does, and assert over symbols, not strings.

## The decision journal — what an agent CHOSE, and what it chose that OVER

Five subagents at 400k tokens each produce more context than anything can read, and
the report each one hands back is written by the agent that did the work — so it
records what was *concluded*, never what was *considered and dropped*. The transcript
has that information and is unreadable; the report is readable and has lost it.

The journal is the third option: each agent emits a line per decision **as it makes
it**, and you read the merged result.

```sh
coherence hooks install --host codex --session "$CODEX_THREAD_ID"
coherence hooks status --host codex --session "$CODEX_THREAD_ID"
coherence hooks --check --host codex --session "$CODEX_THREAD_ID"
coherence hooks uninstall --host codex # leaves unrelated settings and hooks intact
```

The hook is a **control value**, not a family of similar snippets. Printing, installing,
and checking all derive from one host-selected five-event value and byte-exact launcher.
Host parity means one contract with host-native syntax, not pretending Claude and Codex
consume the same JSON or output shape. `--check` without a session answers the structural
question: is the selected host's complete shared control present and runnable? With an
exact `--session`, it additionally requires an event from this host's installed bundle.
A partial block, older spelling, duplicate, wrong matcher, direct diagnostic invocation,
or stale bundle cannot earn that reading; unrelated hooks may coexist. `install` converges
recognized older spellings and is byte-idempotent.

Each host's `coherence-hook` and `coherence-root` are coherence-owned control files.
`install` atomically repairs drift or collisions at those exact names; `uninstall` removes
either file only while its bytes still prove coherence ownership. Layout is data: declare
the host root with `claudeProjectRoot` or `codexProjectRoot`, and the mapping addresses the
coherence root without minting a repository-specific launcher.

**Configuration, current-session activation, and historical observation are different
facts.** `status` prints all three. Old activity cannot redeem a hook removed today; an
installed control does not prove the current Codex session loaded it; and invoking the
body by hand proves only that the body runs. For Codex, review the project hook in `/hooks`,
start or resume the named session, then require `activation: OBSERVED` for that session.
**The journal itself needs no hook** — `coherence decide` is a plain command; without a
running hook you put the instruction in each agent's brief instead.

The block `coherence hooks` prints carries **five** event names. `SubagentStart` and
`SessionStart` do the same job at two scales: each OPENS a session — the only place that
can guarantee one id per *agent* rather than one per shell command — and injects the
instruction. `SubagentStart` fires for every agent a run spawns; `SessionStart` fires for
the session itself, so work that never spawns an agent still journals under an id of its
own instead of falling back to a derived one. `PostToolUse` records only explicit
read/write path fields in a transient per-session trace and narrow lifecycle/command
activity carrying host, launcher, bundle, and the strongest available attribution; it does
no graph or git analysis on that high-frequency path. The path trace is an explicit-path
lower bound whose current rows carry that observation identity; status partitions exact,
stale, direct, parent-aggregate, and legacy rows and counts malformed lines. Older rows
without observation metadata remain explicitly `legacy-unscoped`. `SubagentStop`
snapshots calibration and reports the
exact child's journal count plus the patch's repository-wide change signal only when the
host supplied an `agent_id`; otherwise it names the ceiling and does not charge the parent
session to an unknown child. Its final-report restatement is subagent-only: the parent may
see no other account of the work. Main-agent `Stop` snapshots calibration with byte-empty
stdout. It cannot safely turn the shared worktree's change signal or open-conjecture count
into this agent's unfinished task, so no main conclusion receives a second model turn.
Subagent feedback gets one turn; a `stop_hook_active` follow-up is silent so it cannot loop
or become a gate. Trace-persistence failure is contained and keeps PostToolUse byte-silent;
a damaged decision-journal path keeps SessionStart alive with the exact session instructions
and a named `JOURNAL CONTROL unavailable` line rather than a stack trace.
`signal --check` is the CI gate. The generated block invokes the dedicated
`coherence-hook` binary so loading the full command registry is not part of every read.
An event the harness does not recognize is deliberately *not* an error — hook sets grow,
and a harness that crashes on a new name breaks every session that added one.

### Two journal reads, two trust contracts

The settled timeline and the control plane do not ask the same question. `decisions` and
`journal` use the tolerant historical read: they preserve whatever valid rows can still
be rendered and expose damage to a human. `signal`, `orient`, and `regulate` use the
trusted projection: one malformed row, noncanonical timestamp, forged content id,
conflicting duplicate, broken supersedes pointer, cycle, or provable session/file
displacement makes the whole verdict-bearing decision source unavailable. It also validates
real repository containment, every surviving directory entry, and canonical final-newline
framing. A damaged row cannot shrink the standing set and thereby waive an obligation.

Whole-population loss needs an external witness because no surviving row can report its own
deletion. When the trusted projection derives zero rows, current Git `HEAD` is consulted: if
it owns decision JSONL files that are now deleted, the source is unavailable rather than a
valid adoption from zero. The witness is deliberately narrow. It does not prove completeness
in a non-Git or unborn repository, detect deletion already committed into a newer history,
survive a malicious history rewrite, or detect partial loss while any valid row remains.

Legacy rows retain their original bytes and ids. A new row moves to decision wire v2 only
when it carries at least one structured field:

- `--work` associates the choice with one work identity.
- `--subject` names the exact question on which choices may conflict.
- `--authority` is `local-proposal`, `orchestrator-accepted`, or `user-directed`.
- `--scope-component`, `--scope-file`, `--scope-symbol`, and `--environment` add
  sorted, machine-addressable scope.

These fields do not infer each other. In particular, similar prose does not create a
shared subject, `--work` does not manufacture authorization, and a scope does not grant
permission. Cross-record realization, verification, repair, and provenance belong only
to the explicit `consequence` ledger.

The authority order is deliberately small:
`local-proposal < orchestrator-accepted < user-directed`. Differing local choices on one
subject produce `needs-ratification`; one stronger choice ratifies the position; differing
choices at the highest surviving authority remain `contested`. Retraction is the only
way to withdraw a standing choice. Recency is never authority.

The ordinary journal verbs remain cheap:

```sh
coherence decide "species gas physics as its own commit" \
  --over "bundle it with the habitat work" --over "keep the single lifeFraction path" \
  --because "it MOVES THE ATMOSPHERE; trajectory-moving changes land alone" --session s-abc

coherence blocked "measure the converged CO2" --because "sub-cycling is unbuilt" --session s-abc
coherence retract d-dfa936a6 --because "the sweep RAN: 5/8 on a re-roll" --session s-abc

coherence conjecture "139,460 habitat violations across 84 cells" \
  --could-be "the sim really is that broken" \
  --discriminated-by "decode one known cell by hand and compare against the reported column" --session s-abc
coherence resolved d-9b81f24c --because "hand-decode says 158 — floor(v/16) where the encoding is 1-based" \
  --as "the decoder had an off-by-one" --session s-abc
coherence dismiss d-4e19c2d7 --because "three keys and a doc table; a parity claim costs more than the drift"

# ...and the same question, raised by an ADVISORY rather than by a person. Opt-in, capped
# per run, deduped on a key derived from the finding's SUBJECT rather than its score.
coherence redundancy --raise
coherence verify --raise [--raise-cap N]

# ...and the same question, raised by the harness that measured it rather than by an agent.
# Outside its band with no --why opens ONE conjecture per label, however many runs report it.
coherence observed "CO2 range, low" --value 0.180 --baseline 0.140 --threshold 0.010 --unit "%"

coherence decisions [--job X] [--agent Y] [--session S] [--branch B] [--sessions] [--md] [--brief] [--open]

# ...and the one write that lives under the read command, because its whole contract is that
# it changes nothing the read prints: fold COMMITTED session files into one per (branch, month).
coherence decisions --compact
```

For a swarm-addressable choice, add the structured fields at write time:

```sh
coherence decide "serialize migrations through one owner" \
  --over "let both agents write the migration directory" \
  --because "the scopes collide and migration order is semantic" \
  --work wrk-migrations --subject migrations/ownership \
  --authority orchestrator-accepted --scope-file migrations \
  --session "$CODEX_THREAD_ID" --agent orchestrator
```

### `coherence work` — an append-only swarm work graph

Work records live one JSONL file per writer session under `.coherence/work/`. Opening a
work order freezes its objective, observable success criteria, constraints, non-goals,
risk, authority boundary, owner, parent, dependencies, and read/write scopes. Later events
may transition state, hand ownership to an exact session/agent pair, or close the work;
they cannot rewrite the opening contract.

Each event points to the previous event. `work inspect --json` exposes the current
`last.id` token for a coordinating caller to pass as `--expected-previous`: two
writers advancing the same predecessor create competing history
and the strict merged reader refuses instead of picking whichever timestamp sorts last.
Exact semantic retries deduplicate. Missing parents or dependencies, parent/dependency
cycles, activation or completion ahead of a dependency, live children below terminal
parents, incomplete or invalid child synthesis, damaged rows, and displaced session files
are likewise refusals. Objectives, criteria, authority text, and other authored work
strings reject instruction-control bytes before they can cross into SessionStart.

Scopes are repository addresses, not semantic ownership inference. An exact path overlaps
the same exact path; a scope ending in `/**` owns that subtree; `**` overlaps everything.
Two dependency-clear or active orders with overlapping write scopes are a live conflict.
An overlap serialized behind a dependency stays visible as potential overlap, not a
collision. Declare only the scope actually granted—the ledger reports the declaration; it
cannot discover an undeclared coupling.

`SessionStart` may render up to three current work orders, but only when the work owner
session exactly matches the starting session. Parent-session guesses and “newest session”
fallbacks do not transfer authority. A resumed or follow-up child may receive a new
host-provided session id; ownership remains with the recorded session until an explicit
`work handoff` transfers it.

### `coherence consequence` — explicit record-to-record navigation

Consequence records live under `.coherence/consequences/`, one append-only file per
assessor session, addressed by a domain-separated hash so case-distinct sessions cannot
alias on a portable filesystem. References have the form `kind:id`; kinds are `decision`, `work`,
`commit`, `experiment`, `verification`, and `defect`. Specialized relations have
typed endpoints—for example, `decision --authorizes--> work`,
`verification --verifies--> work|commit`, and `work|commit --repairs--> defect` are
admissible. General
`supports`, `contradicts`, `supersedes`, and `depends-on` edges remain available
where the assessor needs a weaker statement.

The record requires evidence for why the edge is warranted and captures repository and
writer attribution. Its reader recomputes content ids and refuses malformed, forged,
conflicting, or displaced rows. `inspect <kind:id>` traverses incident edges in both
directions while retaining the direction actually authored. It deliberately does not mine
timestamps, common paths, or Git co-presence for causality.

Both `.coherence/work/` and `.coherence/consequences/` must cross the repository boundary.
If either is ignored, local inspection can look correct while a fresh clone loses the work
graph or its navigation. This repository's acceptance guard writes both through the public
CLI, commits them, clones the fixture, strictly replays them, and requires zero dangling
consequence references.

### `coherence orient` — one heading, not another dashboard

`orient` composes the strict ledgers without collapsing their epistemic boundaries. Its
priority is fixed: damaged evidence or an invalid work graph refuses first; decision or
write-scope conflict follows; then dangling navigation and live work blockers. An
unsynthesized child result comes next only when every direct child of that parent is terminal,
making parent closure executable. Otherwise ready, active, or blocked sibling work keeps its
own heading while the pending result remains visible. Ready work, active work, missing
verification, stale/failing verification, and finally steady state complete the ordering.
`--json` exposes the complete projection for an orchestrator.

The heading does not authorize work and does not prove correctness. It is a gyroscope:
one stable direction from the evidence agents deliberately left behind, with the
instrument's limits printed beside it.

### `coherence experiment` — freeze a planned inference loop, then close it with evidence

A checklist records intended motion and a checked box records self-report. An experiment
records the prediction **before** the work and requires evidence for every declared action
and success criterion afterward. It is a separate append-only ledger because a failed
experiment can still be a well-closed loop, while a successful experiment is not proof
that the patch is clean or that the plan caused the outcome.

Create the experiment before taking its first action:

```sh
coherence experiment create "one boundary removes the repeated branch" \
  --context src/a.ts --context src/a.spec.md \
  --action "replace both branches at the shared chokepoint" \
  --success "the focused contract passes" \
  --session "$CODEX_THREAD_ID"
```

The owner session is exact—there is no branch/date, `unknown`, or newest-session fallback.
At least one predicted context path, inert action label, and observable success criterion
is required. The command executes none of them. It freezes the repository snapshot and
the owner session's read/activity cursors, assigns stable ids (`a1`, `s1`, …), and prints
the close template. A session may have one open experiment; an exact create retry dedupes,
while changing the plan requires closing the standing one first.

Inspect one loop or the open work list at any time:

```sh
coherence experiment inspect <experiment-id>
coherence experiment inspect --open --session "$CODEX_THREAD_ID"
# `coherence plan …` is an alias; `--json` is available on create/inspect/close.
```

With no selector, inspect is the merged fleet view. Ambient `CODEX_THREAD_ID` or
`COHERENCE_SESSION` identifies create/close writers but never silently narrows a read;
only an explicit `--session` applies that filter.

Close it by answering every generated id exactly once with nonempty evidence:

```sh
coherence experiment close <experiment-id> \
  --action-result 'a1=revised::the diff showed a third caller at src/c.ts' \
  --result 's1=unmet::the focused contract still reports one failing case' \
  --session "$CODEX_THREAD_ID"
```

Action statuses are `followed|revised|skipped|unknown`; criterion statuses are
`met|unmet|unknown`. The caller cannot supply an outcome. Any unmet criterion derives
`failure`; all met derives `success`; otherwise the result is `inconclusive`. Closure
freezes the post-open trace and activity windows in the owner's session files while
preserving the assessor's separate identity. Each window names its weakest provable
scope: `none` for an empty post-open window, `owner-session` for exact agent/session rows,
`parent-session-aggregate` when a valid Codex fallback may include descendant work, and
`legacy-unscoped` for older trace rows that predate observation metadata. Activity
evidence uses the first three scopes; legacy trace remains visible instead of being
silently upgraded. These telemetry labels do not derive the outcome—the assessor's total
criterion evidence does. Missing or extra ids, unreadable rows, shrunk or rewritten
prefixes, and unknown or inconsistent scope all refuse rather than manufacturing a
complete story. An exact close retry returns the immutable record; changed evidence
cannot rewrite it. Commit `.coherence/experiments/` alongside the decision and calibration
records.

New writes use experiment wire v2, whose replay identity includes the observation domain
and whose empty windows say `none`. The strict reader still accepts valid v1 rows, checks
their original content-addressed ids before adapting anything, and normalizes the old
`owner-session` spelling in memory to `none` or `legacy-unscoped` where the frozen rows
prove only that weaker scope. It never rewrites the append-only bytes.

### `coherence defect` — record observed damage before the repair erases it

A conjecture preserves a question. A defect record preserves the stronger conclusion an
agent reached when behavior violated an expectation, together with the evidence that made
the agent call it a defect:

```sh
coherence defect "verify aborts while walking a large repository" \
  --evidence "v0.34.0 aborted in Parser.parse at parse 638 of an 80KB source" \
  --file src/adapters/tree-sitter.ts \
  --session "$CODEX_THREAD_ID"

coherence defects
coherence defects --session "$CODEX_THREAD_ID"
coherence defects --json
```

The distinction is semantic, not cosmetic: use `conjecture` while whether something is a
defect remains unsettled; use `defect` only when the agent is asserting that it is one.
`--evidence` and an exact non-placeholder writer-session label are required; the canonical
hook supplies its host session and any available agent label. Direct callers may set `COHERENCE_SESSION`,
`COHERENCE_AGENT`, and `COHERENCE_JOB`; Codex also recognizes `CODEX_THREAD_ID` and uses
`codex` as the final agent fallback. Explicit flags win over those environment values.
`--file` is repeatable. The record captures caller-supplied attribution plus the available
repository branch, commit, and dirty-state snapshot. Direct flags and environment values
are labels, not authenticated identities; callers must give concurrent writers distinct
sessions. Every row says `agent-assessed`: it stores accountable testimony, not a
machine-demonstrated oracle breach.
Because this directory is committed, redact credentials, tokens, personal data, and
customer data from summaries and evidence before recording them.

New records append under `.coherence/defects/` to one lowercase SHA-256-named target per
exact session label. Hashing the append target keeps distinct writers separate even when a filesystem
folds case or normalizes Unicode; the exact session remains visible inside every row.
Legacy pre-release slug files remain readable, so a migrated session may span its legacy
file and the canonical target used by new writes.
Record ids are independently content-addressed, so an exact retry dedupes instead of
inflating the record. The merged reader validates every surviving row, recomputes its id,
and checks that the containing filename agrees with the writer session; malformed,
internally inconsistent, or displaced surviving evidence refuses the read instead of
being skipped. The recorder API only appends, but its in-row unkeyed hash is not a
cryptographic promise that repository bytes were never rewritten.
Pre-existing ledger-directory and row symlinks refuse, and the writer opens the session
target without following its final link. This protects stable local filesystem state; it
does not claim to defeat a privileged process racing parent-directory renames during the
append. Captured commit names must have lowercase SHA-1/SHA-256 shape; every human field
is terminal-safe on render.
A self-contained ledger cannot prove a valid row was rewritten with a recomputed id, or
that a whole row, tail, or file was cleanly deleted: commit `.coherence/defects/` so Git
history is the external rewrite/deletion witness. A separately anchored ledger head is
intentionally future work, not a property this first cut claims.

This first cut deliberately has no automatic collector, causal attribution, resolution
lifecycle, calibration projection, or regulator rule. Those can grow around this
attributable assessment without changing what this command claimed. A failed command or experiment is not
silently promoted into this ledger, and recording a defect gates nothing.

### The conjecture — abduction as a first-class entry

`decide` records a choice and `blocked` records an impasse. Neither records what was
**wondered**, and that was the gap: every expensive finding in one recent session came
from the same move — *a number was surprising, so the instrument was doubted before the
subject* — and none of it was representable.

| what was surprising | what it actually was |
| --- | --- |
| 139,460 habitat violations | a decoder off-by-one (`floor(v/16)` vs `floor((v-1)/16)`). True answer: **158** |
| 4,237 removed lines charged to an 1,139-line file | deleted files emit `+++ /dev/null`; their removals landed on the previous file |
| "arm A wrote 3x the code" | it measured *patch-file* lines, not *added* lines. The arms were within **1.6%** |
| a mutation harness caught every fault | the repo ships a declared expected-failure ledger and is already red at rest |
| a negative control passed | its regex never matched, so it tested nothing |

Six for six, the instrument. So **"the instrument is wrong" is always a candidate** —
if you do not supply it, it is added, and the render tags it `[instrument]`:

```
  · 139,460 habitat violations across 84 cells   [d-9b81f24c · finder-1 · main · 20cc889]
  ·   could be: [instrument] the instrument is wrong — the thing that PRODUCED this
      number, not the thing it describes · the sim really is that broken
  ·   discriminated by: decode one known cell by hand and compare against the reported column
```

The detector that decides whether you already doubted your apparatus is deliberately
narrow, and its failure mode is asymmetric on purpose: a miss adds one redundant
canonical candidate — recoverable noise — while a false positive would ship a conjecture
with no instrument doubt at all, silently, which is the whole failure being prevented.

**`--could-be` is optional; `--discriminated-by` is not.** That looks backwards and is
not. Candidates are optional because the one that matters most is supplied for you. The
discriminating test is required because without it the entry is a complaint: a surprising
number with no way to settle it sits in the journal forever being re-noticed. `"unknown —
no test comes to mind"` is a legal and honest value; omitting the flag is not.

**An UNRESOLVED conjecture is the valuable state, so it is loud.** Open questions render
**above** `Standing`, not below it — a settled decision will still be there tomorrow, but
an open conjecture decays, because the agent that saw the surprising number is gone and
nobody else knows to look. Filed under the settled work it reads as an appendix, which is
indistinguishable from never having recorded it. The count is shouted in the summary line
when it is nonzero (and stated plainly when it is zero — permanent all-caps is furniture,
and furniture is what the eye learns to skip):

```
3 standing · 2 OPEN CONJECTURE(S) · 1 resolved · 0 retracted · 1 blocked · …
```

`coherence decisions --open` is the lens: the standing list of what this project noticed
and did not chase, and nothing else. With nothing open it *says so* — silence there is
ambiguous between "all chased" and "the filter is broken". `SubagentStop` names the count
too, because that is the moment an open question is cheapest to answer and one turn from
becoming most expensive.

**A resolution is an append that points at the conjecture**, exactly as a retraction
points at a decision — so the agent that settles a question need not be the one that
raised it. `--as` names which candidate won; `--because` carries what the discriminating
test showed. Resolving an id that is not a conjecture is **refused**, with a different
message from an id that does not exist: accepting it would append a record no render ever
reads, which is a command that exits 0 and does nothing.

**It does not point at a `decide` entry, deliberately.** The arc *noticed → tested →
chose* is already content in `--as` and `--because`; a pointer would add referential
integrity to keep in sync and a choreography cost (log the decision, copy its id, then
resolve) to a journal whose design constraint is that the write must be the cheapest thing
in the CLI. It would also create an expectation that the arc *should* be recorded — the
incentive-to-be-complete this journal exists to refuse.

A conjecture is never a `standing` decision. It has rejected nothing, so it renders no
`over:` line, and counting it as a settled position is the exact confusion the record
exists to end.

### `coherence observed` — the division of labour

A conjecture written by hand is written by an agent that *noticed*. Most surprising
numbers are noticed by a harness, in a table, at 3am, and then forgotten by morning.

```sh
coherence observed "<label>" --value <n> --baseline <n> --threshold <n> \
  [--unit "<s>"] [--why "<explanation>"] [--agent A] [--job J] [--session S]
```

**The band belongs to the project, and coherence must not have an opinion about it.**
The consuming project already carries a tracked-metric table — planetizer's
`tools/headless.ts` holds `{ label, now, before, prev, threshold, unit, why }` and
prints, every run, the rows whose move exceeds their own threshold, each with the
reason it moved. Those thresholds are *physics*: a gas row's bar is a tenth of that
channel's declared `notableDelta`, which is in turn a tenth of the manual's own
band. Nothing in a spec harness knows that, and a harness that guessed at it would be
inventing a bar and then holding the project to it.

That table is also, deliberately, **a report that demands an EXPLANATION rather than a
gate that demands IDENTITY**. It prints and it does not fail. `coherence observed` does
not change that and does not rebuild it.

|  | owns |
| --- | --- |
| **the project** | what counts as notable — the label, the number, the bar, and the explanation once it has one |
| **coherence** | what happens when something notable goes **unexplained** |

What was missing was never the band. It was the **trigger**: a crossed threshold printed
to a terminal and was gone. The `why` column gets filled in *after* a human has worked
the move out, so there was no state at all for the interval where the finding actually
lives — *moved, unexplained, not yet chased*. One call per row per run turns that
interval into an open conjecture that outlives the session that measured it:

```
outside band: CO2 range, low  0.14 → 0.18  (+0.04%, band 0.01%) — UNEXPLAINED
d-fe07c630  conjecture opened
  could be: the instrument is wrong — the thing that PRODUCED this number, not the thing it describes
  could be: the model really moved — a change nobody wrote down, and this row is its shadow
  could be: the baseline is stale — 0.14 describes a tree this no longer is, and the move landed commits ago
  settle it with:  coherence resolved d-fe07c630 --because "<what the test showed>" --as "<which candidate won>"
```

Inside the band, **nothing is written at all**. Thirty rows run every pass and most of
them are still; a record each would turn the journal into a metrics store, and a metrics
store is a transcript again. `--why` is what closes a question — and when a question was
already open for that label, the `--why` **resolves it**, which is the loop completing
itself: coherence asked, the project filled in the column its own table already has, and
the next harness run carried the answer back without anybody copying an id.

#### Dedupe is on the LABEL, and it has to be

The existing content-hash id cannot do this job. An id hashes the record's content and
the content of an observation *contains the number*, so a metric that sits outside its
band for ten runs mints ten ids and files ten open questions about one question. **The
identity of a question is not the identity of a measurement.** The label is the thing
that stays still while the number moves, so the label is the key: at most **one open
conjecture per metric**, across every session, agent and branch.

After an answer, the label stays quiet **until the value moves again** — specifically,
until it has travelled a further threshold-width past the reading the answer was written
against. A resolution answers the excursion it was written for; a bigger one later is a
different question and gets asked. (This is why `value` is stored on the record: it is
the only thing that can tell *still the thing we explained* from *it moved again*.)

A **retracted** conjecture is allowed to be asked again. A retraction claims the
observation was never real — if the instrument keeps producing it, that claim is what
deserves re-examination.

#### Coming back inside the band resolves nothing

It is reported, loudly, and it is never closed:

```
within band: CO2 range, low  0.14 → 0.142  (+0.002%, band 0.01%)
  STILL OPEN: d-fe07c630 asked why this metric moved, and nothing has answered it.
  Coming back inside the band is not an answer — it is one more thing to explain.
```

Three reasons, in order. A resolution's `because` is **what the discriminating test
showed**; a number wandering back shows nothing about the cause, so auto-resolving would
have to write a false claim into the one field that carries evidence. The failure would
be silent and asymmetric — it deletes an entry from `decisions --open`, the single list
this feature exists to populate, and deletes it precisely in the case where nobody
looked. And it would close the *most interesting* questions preferentially: a metric that
left its band and came back has usually done something stranger than one that stayed out.
The resolution comes from the explanation, never from the number — which is also why
`--why` closes a question whichever side of the band the metric is now on.

**It gates nothing.** Every observation exits 0 — outside the band, inside it, opened,
deduped, all of it. A *malformed invocation* exits 2 with the other usage errors, because
`--value banana` is not a metric within its band, and reporting it as one would be a
command that exits 0 and does nothing.

One last thing that is a fact rather than a bug: the comparison is `Math.abs(now −
before) >= threshold`, byte-for-byte the consuming table's own. `0.15 - 0.14` is
`0.00999999999999998`, so a decimal move that *looks* like exactly one band is under a
`0.010` bar and both halves call it quiet. Being wrong the same way is worth more than
being right alone — a disagreement at the boundary is the one place a disagreement is
invisible.

### `--raise` — an advisory OPENS a question instead of printing one

Suspicions were **stored** in the journal but **generated** by the advisory layer, and
only one generator was ever wired. `coherence observed` wrote to the journal; `verify`,
`redundancy`, `novelty`, `drift`, `why-lint`, `conventions`, `atlas` and `contracts`
wrote zero — while every one of them already *forms* a suspicion and then throws it away
by printing it. Verbatim, from the code that shipped:

| advisory | what it already says | what that is |
| --- | --- | --- |
| `redundancy` | "the two spellings ALREADY disagree — either the difference is intended (say so), or one side drifted" | a conjecture with two candidates |
| `verify` never-red | "green every run, never once red, no recorded refutation" | a finding whose first hypothesis is `[instrument]` |
| `verify` refutations | "never observed failing" | an invariant nobody has tried to break |
| `verify` kinds | "this claim could convict us for improving" | the project's own standing suspicion |

```sh
coherence redundancy --raise          # the ranked pairs above the DEFAULT floor
coherence verify --raise              # never-red · warned kinds · unrefuted invariants
coherence verify --raise --raise-cap 8
```

**Identity is DERIVED, and that is the whole feature.** `observed` dedupes on a label the
caller supplies — the project spells "CO2 range, low" the same way twice. An advisory has
nobody to ask, so it must take identity from the finding itself, and there are two ways to
get that wrong, both fatal and in opposite directions:

- **too volatile** → every run opens a new question and `--open` is noise within a week;
- **too coarse** → two different findings collapse and the second is *silently swallowed*,
  which is worse, because nothing anywhere says so.

The rule that resolves it: **the key is the finding's SUBJECT — the addressable thing a
reader would go and look at — and nothing else.** For a redundancy pair that is the pair
of sites (`src/oracle-domain.ts#list:NOISE_DIRS|src/sidecar.ts#list:ALWAYS_IGNORE`); for a
never-red claim it is the node and the claim text. What is *excluded* is the point:

- **the score.** Redundancy's `df` is computed over the whole tree, so adding one
  unrelated file re-ranks every pair in the repo. A key holding the score opens a fresh
  question on an edit that touched neither site.
- **the run count.** "green for 14 runs" changes every run by construction — and it is the
  most tempting field to include, because it is what makes the finding feel urgent. It goes
  in the *sentence*, where volatility is free.
- **the line number.** A navigation aid, never structure. (The same call `coherence graph
  --check` already makes when it strips `data-line` before comparing `graph.json`.)

One trap, which the first draft walked into: an alternation site is named
`alternation@<line>`, so the line is *inside* the name. Stripping the suffix fuses every
alternation in a file into one key — the coarse failure — so a positional name is re-keyed
on a digest of its own tokens instead.

**Volume is the most likely way this dies**, so there are three layers and each catches a
case the others do not:

1. **Opt-in.** Raising *writes*. An advisory that mutates the journal as a side effect of a
   read-only report is a surprise, and a surprising write is how a mechanism gets switched
   off wholesale instead of tuned. It also keeps a pre-commit `verify` from raising.
2. **The advisory's own floor.** Only findings it already *shows* may raise. This does the
   most work: `redundancy --all` drops the score floor to zero to expose the tail, and
   raising ignores that and uses the default floor — 42 pairs shown, 7 eligible on this
   repo. The refutation advisory prints its per-invariant list only once a project has
   declared its first refutation, so on a project with none it raises nothing at all.
3. **A per-run cap (default 3) that says what it withheld.** The floor is a precision knob
   and a repo can sit above it three hundred times; the cap is the bound that does not
   depend on tuning. The remainder is never silent — a truncated list that looks complete
   is the defect this harness exists to hunt.

The cap is spent **round-robin across advisories**, which dogfooding forced. Strict
priority was the obvious design and it was wrong: on a real repo `verify` offered 14
never-red findings and 3 warned-kind ones, and every warned-kind question queued behind
twelve others — on the one project whose config explicitly declares that kind the suspect
one. A detector that never speaks is a detector nobody wired.

```
  RAISE — 3 question(s) opened in the decision journal (17 finding(s) considered)
    d-53f3f490  never-red:game::typechecks
    d-a31cde59  warned-kind:sim::boundary "removing a source moves the channel back…"
    d-43cba53d  never-red:sim::typechecks
    WITHHELD 14 more — the cap is 3 per run (warned-kind 2 · never-red 12).
    They are not lost and they are not recorded: settle the ones above and re-run.
```

**A finding that disappears does not close its question.** Derive one spelling from the
other and the redundancy pair stops being reported — its question stays open until somebody
says what happened. Same rule `observed` follows when a metric wanders back inside its
band, same reason: the absence of a symptom is not an explanation, and auto-closing would
delete the entry from `--open` in precisely the case where nobody was looking.

### `coherence dismiss` — we decided not to ask

```sh
coherence dismiss <id> --because "<why this is not worth chasing>"
```

Once an advisory can raise, questions arrive faster than anyone answers them, and the only
defence against a noisy one is a one-line way to make it go away **permanently**. If that
line is even slightly harder to reach for than the one that answers a question, the noise
stays and the whole `--open` list gets skipped instead — so `dismiss` shares `resolved`'s
refusal rules verbatim (an unknown id and a wrong-kind id get different messages), and every
raised question prints both commands underneath it.

**A dismissal is NOT a resolution.** "We answered this" and "we decided not to ask" are
different facts, and a render that files them together tells a reader an unanswered question
has an answer — the one lie this journal cannot afford. So it is its own record kind, its
own bucket, and its own section, whose heading carries the distinction on its own because a
reader scanning section titles never reaches the body:

This is this repo's own journal — `redundancy --raise` asked whether two hand-kept
method lists in `oracle-domain.ts` needed a parity claim, and the answer was that
their difference is deliberate:

```
121 standing · 10 OPEN CONJECTURE(S) · 12 resolved · 1 dismissed · 1 retracted · …

Dismissed — NOT WORTH CHASING (no answer was found; none was sought)
  · src/oracle-domain.ts `CHAIN_METHODS` and src/oracle-domain.ts `ITER_METHODS`
    spell one 8-token domain, tied together by nothing — and it has ALREADY
    drifted   [d-83c8020f · main · main · f78eb54]
  ·   DISMISSED (s-d27892ea6afd): CHAIN_METHODS and ITER_METHODS are deliberately
      different sets that overlap on the array methods; the difference is the point
```

Like everything else it is an **append**, never an edit — a dismissal that deleted the line
would be indistinguishable from a question nobody ever raised, and the value of `--open` is
that it counts what a project chose not to chase. It is counted in the summary only when
nonzero: one more permanent column is one more thing for the eye to learn to skip.

Precedence, when more than one thing points at a conjecture, is **retraction > resolution >
dismissal**. A retraction says the observation was never real, so there is nothing to
answer. A resolution beats a dismissal because an answer is strictly more informative than a
decision not to ask, and filing an answered question under "not worth chasing" would hide
the answer.

`retract` and `dismiss` make opposite claims and behave accordingly: a **retracted**
question may be raised again (if the detector keeps producing it, the retraction is what
deserves re-examination), a **dismissed** one never is.

### Length: cap the labels, never the evidence

`chose` and `over` are labels. Over 200 chars, `decide` prints a note on **stderr** —
that length means the rationale went in the title — and **writes the entry anyway**. A
journal that can refuse a write is one an agent stops using mid-job, and the entry it
drops is the one it was too busy to reword.

**`because` is never capped**, and that is measured rather than assumed. On a real
53-entry journal: `chose` p50 149 / p90 241 and `over` p50 94 / p90 175 — both already
read as labels. But `because` p50 **609**, and every entry exceeded 250. Capping it
there would have stripped **16 of 23 file:line citations and 22 of 33 measured
numbers**, because the evidence sits at the END of a rationale, after the claim.
That converts a checkable entry into an assertable one — the exact failure the journal
exists to prevent.

Readability is a RENDER problem, so it is solved at the render: `coherence decisions
--brief` clips each rationale for scanning and **announces what it withheld**
(`… (+412 chars — drop --brief for the evidence)`). Nothing on disk is ever shortened.

One rule, applied everywhere: **under `--brief`, prose clips and labels never do.** So
`because` and `discriminated by` clip; `over` and `could be` do not. Clipping a candidate
would hide which explanations were even considered, which is the one thing a conjecture
is for.

**`--over` is the field that matters.** What was REJECTED is what stops the next agent
re-litigating a settled question. It is also the field every gate-shaped design drops.
An empty `over` renders as *"(nothing — forced, or no alternative considered)"* — a
forced choice and an unexamined one must not look alike.

**Retraction is an APPEND, never an edit**, and it crosses session files: agent B
withdrawing agent A's verdict is the single most valuable thing that can happen in a
fan-out. Retractions get their own render section, because a retraction shown as an
absence is invisible.

### Storage: one append-only file per agent session

`.coherence/decisions/<session>.jsonl` in the ordinary case. If two session labels alias
under portable case/Unicode normalization, the later address uses a domain-separated
session hash instead of sharing bytes; released readable filenames remain unchanged.
**Commit the folder** — it is the record, not a cache. Three reasons for the split:

1. **Two branches merge cleanly.** Distinct filenames never conflict; one shared JSONL
   conflicts on every parallel branch — exactly what five concurrent agents create.
2. **Attribution is structural.** The file *is* the session.
3. **Concurrent append stops being a question.** Separate files cannot interleave.
   (Measured anyway: `appendFileSync` at 8 concurrent writers x 300 lines, 200 B–64 KB,
   is 2400/2400 intact, 0 torn, 0 missing. The same probe with a
   read-then-write-at-offset writer loses 1242 of 2400, so it can see loss when loss
   exists. No lock — and a lock is a thing five agents can deadlock on.)

**Ids are pointers, so the id format is frozen.** `d-` + 8 hex of a SHA-256 over the
record's fields joined on a **NUL** — the one byte a field cannot contain, so no `chose`
can forge a field boundary. Every `supersedes` in every committed journal names one of
these, which is why the conjecture fields were added to the digest *only when present*:
feeding two empty fields into a plain decision's hash would have re-minted every id ever
written and silently orphaned every retraction on disk. Measured before touching it — all
20 entries in this repo's own journal reproduce under NUL, 0 of 20 under a space — and
pinned by a test against a literal id minted before conjectures existed.

`coherence decisions` is the cohering read: every session file merged into ONE timeline
ordered by time, across agents, jobs and branches.

### Reading it live — `coherence journal`

`coherence decisions` is the settled read; **`coherence journal`** is the live one. Run
it in a terminal while agents work and it opens an interactive surf over the same
record: every stream interleaved, **newest first**, one cell per entry — glyph, local
time, agent, then up to two lines of the entry text.

- **↑/↓** move a visible selection, and the viewport slides only at the edges. **⏎**
  opens the full entry — every field, labeled, colons aligned, nothing clipped — and
  **esc** returns to whichever list you came from. Inside an entry that carries a
  `supersedes` pointer, **⏎** follows it (the footer names the target); a chain of
  retractions reads like a paper trail, and **esc** walks back out one hop at a time.
- **s** is the streams picker: every session ordered by most recent activity, with the
  merged timeline pinned at the top.
- **c** opens the **open conjectures** view — the list behind the masthead's "N OPEN
  conjecture(s)" count, each cell leading with its discriminator, because the test that
  would close the question is the actionable part.
- **f** (or **G**) follows the tip: new entries land at the top, under the cursor, as
  agents write them. Surfing into history pauses the follow; walking back to the top
  resumes it.

A pipe or `--once` prints a chronological snapshot instead, and `--follow` is the
line-mode tail for a second terminal. The same four scoping filters as `decisions`
(`--job`, `--agent`, `--session`, `--branch`) work in every mode. The tail is
content-addressed — deduped on the record's identity, not file offsets — so a live
append arrives exactly once and a `--compact` fold mid-watch neither replays nor drops
an entry.

### The session id: random for a hook, DERIVED for anything else

One file per session is right when the sessions are real. It was expensive when they were
not: a consuming project accumulated **~20 new `.jsonl` files in a single day**, and twenty
new files is not a diff anybody reads — which turns the record into noise at exactly the
moment it is supposed to be read.

The cause was one line. With no `--session` and no `COHERENCE_SESSION`, `appendDecision`
fell back to a *random* id, so every hookless `coherence decide` minted a fresh file. So:

- **`SubagentStart` mints a random `s-<12 hex>`.** Those sessions genuinely are concurrent
  and randomness is the only thing that separates them. Unchanged.
- **Everything else derives `<branch>-<agent>-<YYYY-MM-DD>`.** Same branch, same agent,
  same UTC day appends to *one* file. A human typing `decide` five times gets one file.

**The branch stays in the filename** — reason 1 above is the entire reason this layout
exists, and a tidier PR is not worth trading a merge conflict for. The date comes from the
record's own `at`, so the filename and the timestamps inside it are on one clock; an
evening's work can straddle UTC midnight into two files, which month-grouped compaction
absorbs completely. Sanitising is **injective**: a branch may contain `/`, and if `feat/x`
and `feat-x` both flattened to `feat-x` they would share a file, so whenever sanitising
changes anything a digest of the raw string is appended. A name that was already safe passes
through untouched, which is why every id ever written still maps to the file it always did
— and why `--session ../../etc/x` no longer escapes the journal directory.

Case is also identity. Before an append chooses a readable filename it checks for a
portable case/normalization alias; a collision such as `Owner` and `owner` moves the second
session to its hash address. Readers verify the filename against the row and refuse linked,
unexpected, blank, or torn surviving storage. Writers refuse symlinked directory or final
append targets without making recoverable historical row damage a gate on recording a new
observation.

The residual collision is two agents that both defaulted to agent `main` on one branch, and
it is safe on four independent grounds: same branch means same checkout, and git refuses to
check one branch out in two worktrees, so genuinely concurrent agents have different
branches *by construction*; even interleaved, the measured append does not tear; what is
lost is attribution between two agents that already declined to pass `--agent`; and the
supported concurrency path is the hook, which still randomises.

### `coherence decisions --compact` — fewer files, byte-identical record

What the derived id prevents going forward, this folds after the fact: one file per
**(branch, month)** — `main-2026-07.jsonl`, `feature-x-2026-07.jsonl`.

```sh
coherence decisions --compact
```

**It tidies the working tree; it does not edit the record**, and three constraints are what
make that true rather than aspirational:

1. **Only files whose blobs are COMMITTED are folded.** The originals then live in git
   history forever: `git log --oneline -- .coherence/decisions/<file>` names the commits that
   held it and `git show <commit>:<path>` prints it back, byte for byte. A file git has never seen is skipped, always — for that file this
   would be a deletion. The check is `git ls-tree HEAD`, not `git status`, because status
   says nothing about *ignored* files: a project that gitignored the journal would look
   perfectly clean while holding no committed copy of anything.
2. **A tracked journal file that differs from HEAD is a REFUSAL**, and nothing at all is
   folded. That means the record was edited in place, which is the one thing this journal
   forbids, and compaction must not bury the difference in a bigger file. A file written in
   the last **two hours** is skipped instead — the window has to exceed the gap between one
   agent's successive appends (measured on this repo: worst intra-session gap 14.1 min,
   longest session 22.5 min) and stay well under a day, or it would refuse the very case it
   exists for: twenty files accumulated today, compacted before the PR goes up. Every source
   is also re-`stat`ed immediately before its group is written, and a fold that raced an
   append anyway duplicates lines rather than losing them — which the content-hash dedupe
   renders identically.
3. **Grouping is (branch, month), and both halves are load-bearing.** Branch alone folds all
   of main's history into one ever-growing file *and* puts two branches in one file,
   reintroducing the conflict the split exists for; month alone mixes branches, same problem.
   A PR branch lives days to weeks, so it lands as one or two files. The key is read from the
   RECORDS, never from the filename — nothing in the journal parses a filename.

**The acceptance test is that it changes nothing.** `coherence decisions` before and after
must be *character-for-character* identical; if the render moves, the compaction is wrong.
Two properties make that checkable rather than hopeful: every line is copied **byte for
byte** (never re-serialised through `JSON.parse`/`stringify`, which reorders keys and
re-escapes unicode), and `readJournal`'s sort is **total** over `(at, id, session)`, so the
render is a function of the *set* of records rather than of which file each one sits in. A
file containing an unreadable line is left alone: that line has no timestamp to order it by,
and dropping it would quietly lower the render's `N unreadable line(s)` warning — the silent
repair this journal refuses.

Run on this repo's own journal: **15 files → 5**, all nine render shapes byte-identical, 78
records and 15 sessions preserved. And watched to fail — disabling the unreadable-line guard
turns the identity test red on exactly the missing `WARNING:` line.

### It gates nothing, deliberately

The moment this can fail a build it acquires an incentive to be complete, and **a
complete journal is a transcript again** — which is the thing it exists to compress.
`SubagentStop` reports what was logged and never blocks.

### Why a CLI and not an MCP server

An MCP tool's schema is loaded into the context of every agent that might call it —
five agents, five copies, paid every turn whether or not a decision gets made. A shell
line costs nothing until it runs, has no server lifecycle to fail, and works from any
agent that can run Bash. A mechanism that spends context to save context is
self-defeating.

## Commands

**The index below is generated** — from the command registry in `src/commands.ts`, the one
declarative home for what verbs exist. `coherence docs` rewrites it, `coherence docs
--check` fails if it is stale, and `test/commands.test.ts` reads the live `cmd === …`
dispatch chain out of the CLI's own AST and asserts the registry matches it exactly. The
index is therefore *complete by construction*, and so is the usage banner, which is the
same registry `.map`ped and joined.

It was not, before. The list was spelled three times — banner, dispatch, this section — and
enforced nowhere, and in two days it drifted three times: a merge conflict on the banner's
`<a|b|c>` literal, banner 29 vs dispatch 30, and this reference **twelve commands behind**
the CLI, with `dismiss` documented while its six sibling journal verbs were not (so a reader
found a verb for retiring conjectures and nothing explaining what a conjecture is).
`coherence redundancy` had been reporting the pair on every single run — *identical today,
tied together by nothing* — and was right every time. This is the harness taking its own
advice: derive one spelling from the other.

**In detail**, below the block, is authored, and it is deliberately *not* a second list: it
is the reasoning for the commands that have any, and it does not cover all of them.
Completeness is what a derivation owes; depth is what prose owes. A section trying to be
both is exactly what drifted.

<!-- coherence:commands:begin -->
<!-- GENERATED by `coherence docs` from the COMMAND registry (src/commands.ts). Do not
     edit by hand — add the command to the registry and re-run. Everything OUTSIDE these
     markers is authored prose. -->

_45 commands. This index is derived from the registry the dispatch is checked
against (`test/commands.test.ts` enumerates the live `cmd === …` chain and asserts the two
sets are equal), so it cannot fall behind the CLI. The reasoning for the commands that have
any is in **In detail** below — that half is authored, and does not cover all of them._

**Derive the artifacts**

- `coherence graph [--check]` — emit `graph.json` + `_graph.html` (the outline) to `outputDir`
- `coherence overview [--check]` — emit `_overview.html` + `AGENTS.md`
- `coherence docs [--check]` — graph + overview + this command index; `--check` fails on any stale artifact
- `coherence claude [--check]` — regenerate the owned fenced block inside `CLAUDE.md`

**Verify, and diff what is enforced**

- `coherence verify [--fast] [--staged | --since <ref>] [--raise [--raise-cap N]] [--apply <verdicts>] [--from-report <file>] [--serial-oracles]` — run the claims, the evidence chain and coverage — the gate
- `coherence log [<refA> [<refB>]] [--strict]` — structural diff of the invariant/boundary set between two refs, then the novelty advisory
- `coherence signal [--check] [--since <ref>] [--attest-no-invariant --because <why>]` — require significant behavioral growth to gain an anchor or a patch-bound decision
- `coherence regulate [--check] [--since <ref>] [--host <claude|codex>] [--json]` — apply the anti-entropy doctrine to live readings and emit exactly one next action

**Durable agent record — appends only, gates nothing**

- `coherence decide "<chose>" [--over "<alt>" ...] --because "<why>" [--work W] [--subject S] [--authority A] [--scope-component C] [--scope-file p] [--scope-symbol S] [--environment E] [--session S]` — log one choice, any rejected alternatives, and optional swarm-addressable authority
- `coherence blocked "<what>" --because "<why>"` — log what you could NOT do — first-class, not a footnote
- `coherence defect "<what failed>" --evidence "<what proves it>" [--file p] [--session S] [--agent A] [--job J]` — record an agent-assessed defect with the evidence that made it a defect
- `coherence defects [--session S] [--json]` — read the merged append-only defect record across agent sessions
- `coherence conjecture "<observation>" [--could-be "<explanation>"] --discriminated-by "<the test>"` — log what surprised you; `the instrument is wrong` is added if you omit it
- `coherence observed "<label>" --value <n> --baseline <n> --threshold <n> [--unit U] [--why "<explanation>"]` — a tracked metric from the harness that measured it — outside its band and unexplained, one conjecture per label
- `coherence resolved <id> --because "<what the test showed>" [--as "<which candidate won>"]` (alias: `resolve`) — close a conjecture with what the discriminating test showed
- `coherence dismiss <id> --because "<why this is not worth chasing>"` — retire a conjecture UNANSWERED — not a resolution, and never raised again
- `coherence retract <id> --because "<what refuted it>" [--for "<replacement>"]` — withdraw a decision by appending, never by editing
- `coherence decisions [--job|--agent|--session|--branch|--sessions|--md|--brief|--open|--compact]` — the MERGED timeline across every session file; `--open` is what was noticed and not yet chased, `--compact` folds committed session files into one per (branch, month) without changing what this prints
- `coherence journal [--follow | --once] [--job X] [--agent Y] [--session S] [--branch B]` — the LIVE read — stream entries as agents write them, and surf the history in aggregate or one session's stream
- `coherence experiment <create|inspect|close> ... [--session S] [--json]` (alias: `plan`) — open a plan hypothesis, freeze its predicted context/actions/criteria, then close it with criterion-total evidence
- `coherence work <create|transition|handoff|close|inspect> ... [--json]` — append-only swarm work graph; writes require an exact session, reads stay fleet-wide
- `coherence consequence <add|inspect> ... [--json]` — explicit assessed links across durable records; add requires an exact session

**Perceive the project**

- `coherence index [--since <ref>]` — the returning human's page — MAP · JOURNAL · TRAJECTORY, framed against what you last saw (`_index.html` + `index.json`)
- `coherence panel [--no-watch | --once]` — live TUI over the graph + the status record
- `coherence orient [--json]` — one deterministic swarm heading over strict decisions, work, links, experiments, defects, and verification
- `coherence contract` — the promise graph — graded gates + the reliance ledger (`_contract.html`)
- `coherence context [<file>...] [--symbol <name>] [--changed|--staged] [--max-bytes N|--all]` — emit a bounded graph/repository context packet with exact omission accounting; --all expands

**Ratchets and gates**

- `coherence lint-sinks [--check | --update-baseline]` — interpolation-surface ratchet — raw SQL-identifier and HTML sinks
- `coherence conventions [--check | --update-baseline]` — guard-vs-contract detector + growth ratchet
- `coherence mass [--check|--update-baseline] [--raise]` — how much machine there is — lines, files, symbols, deps and project measures, pinned
- `coherence atlas [--check] [--raise]` — trust-graded manifold render + the drift / dangling / over-claim gate
- `coherence contracts [--check]` — producer/consumer contracts across deploy artifacts + the uncovered-surface detector

**Advisories — they surface, you judge**

- `coherence redundancy [--all] [--raise]` — one enumerated domain spelled twice with nothing tying the spellings together
- `coherence prose [--all] [--raise]` — duplicated prose across reading surfaces — and whether the copies have already diverged
- `coherence why-lint [--check]` — `## why` prose restating a mechanism a boundary claim already anchors
- `coherence decompose` — the wise-decomposition report — a LOCALITY score plus the smells that lower it
- `coherence drift` — decompose's derivative — converging on one home, or decohering across boundaries
- `coherence economy [--raise]` — the context closure of a change — what a reader must load to modify one thing safely
- `coherence premise [--check]` — audit whether standing decisions' named structural addresses still resolve
- `coherence calibrate [--outcome <clean|defect>] [--session <id>]` — compare economy's predicted context with observed agent reads and labeled outcomes

**Bootstrap and scaffold**

- `coherence scaffold <kind> <name>` — the gradient-flip generator — make the complete shape the cheapest thing to ship

**Reference and plumbing**

- `coherence doctrine [--json]` — print the versioned law the regulator is allowed to apply
- `coherence phrasebook` — print the claim-form table straight from the `CLAIM_FORMS` registry
- `coherence hooks [status|install|uninstall|print|review] [--check] [--json] [--host <claude|codex>] [--session <id>]` — the lifecycle control — converge on one canonical, runnable shared hook bundle
- `coherence hook <event>` — the hook BODY, invoked by the harness rather than by you

<!-- coherence:commands:end -->

### In detail

- `coherence verify` — run claims, the narrative evidence chain, and coverage. Every
  claim it runs is a **cached inference** and every tier verdict is a rung on the price
  ladder: this is the command that keeps the caches warm and reports which facts are
  still being paid for at full price.
  Emits inference jobs (`.coherence/verify-jobs.json`) for a subagent on change;
  `--apply <verdicts>` records the subagent's verdicts; `--fast` skips the
  live/executable tiers (see "The verify loop" below).
  `--staged` (working changes vs HEAD + untracked) or `--since <ref>` **scopes** the
  run to the components whose dirs changed — fast edit-loop reconciliation of just what
  you touched (claims + boundary anchoring + coverage), instead of the whole tree.
  `--raise [--raise-cap N]` turns its three advisories — never-red, warned claim kinds,
  unrefuted invariants — into open conjectures in the decision journal instead of lines
  on a terminal (see "`--raise`" above). Opt-in, capped per run, deduped on the claim.
  It also reports the **holding cost** — not whether the claims are true, but what it costs
  to keep them true, every run, forever. Each executable claim carries a duration *and the
  clock that produced it*: `report` is the runner's own per-test number, `wall` is verify's
  clock around the claim, and the two are never blended. The printed total is a **sum of
  per-claim costs, not the suite's wall time** — a pooled runner overlaps them, and a 4-file
  suite sleeping 800ms per file measures wall 1.0s against a sum of 3.2s, so calling that
  "took 3.2s" would be the instrument lying about what it measured. There is a **floor**:
  nothing prints unless the tier costs a second in aggregate or some single claim costs
  250ms, because an advisory that fires on every project on every run is one people learn to
  scroll past. A claim that is *both* over a second and over a quarter of the bill is raised
  as a question under `--raise` — both, because a 1.1s claim in a 40s tier is not the story
  and a 25% share of a 0.2s tier is not a cost. The vector lands in `.coherence/status.json`
  as `verify.cost` (the total, plus the five most expensive claims with their clock),
  **run-level and rewritten whole** rather than per claim: a verdict is a verdict, a timing
  is provenance about the instrument, like `commit` and `dirty`.
- `coherence index [--since <ref>]` — the **returning human's page** (`<outputDir>/_index.html`,
  plus `index.json`, the model it is a pure function of). Every other browser artifact here is
  a complete dump of one moment — `_graph.html` runs to 364KB on this repo — and a complete
  picture has no attention budget in it and no delta, which is why they go unread. The premise
  of this one is that **code-level diffs are not useful in LLM development**: thousands of
  lines move in an afternoon and reading them is not how anyone learns what happened. What you
  want is the diff of a higher abstraction. So: **three views, no more.**
  **MAP** — components, zones, gates (invariant → chokepoint → grade), crossings, and a TRUST
  reading. **JOURNAL** — `blocked` entries first, because an agent recording that it could not
  do something is the highest-value line a human can read and no gate will ever report it;
  then open conjectures, then decisions; settled work collapses to counts.
  **TRAJECTORY** — what this frame did to the **invariant/boundary set** (`coherence log`'s
  ledger), the frame's LOC delta as context, and the recorded mass and drift trends behind it.
  The trust reading names **four darknesses and never merges them**, because one "dark region"
  number averages four problems with four different repairs: *unwitnessed* (invariants with no
  `## refutations` entry — the one that separates a green claim from an unfalsifiable one, so
  it leads), *unclaimed* (files no claim names), *undocumented* (symbols with no docblock), and
  *unvisited* (paths recent work keeps touching that the graph does not own, so no reading
  closure can be computed for them and every cost figure silently excludes them).
  **Novelty gates every list and severity only orders what survives**: an anomaly is NEWS, not
  merely a bad thing, and a three-day-old impasse you have seen on every visit is not news. The
  frame defaults to the **cursor** — the HEAD the last index run recorded, read back out of
  `index.json` — falling back to the last tag only when it is not HEAD itself, and otherwise
  saying FIRST LOOK rather than dumping history as if it were new. (The last tag was the
  obvious default and it degenerates in practice: measured across two projects, one had its
  last tag *at* HEAD and the other had no tags at all.) It **derives nothing**: every figure is
  a reading the graph, the promise model, `.coherence/status.json` or the journals already
  took, each source named at the top of the page with whether it was read, STALE, or UNREAD —
  a blank section must never read as health. Lists are capped and **the withheld tail is
  always stated**. It grades nothing and gates nothing; there is no ✓ anywhere in it.
- `coherence panel [--no-watch | --once]` — the **operator's instrument panel**: a
  zero-dependency TUI over the graph + the status record (see "The status record and
  the panel" below). Masthead (identity, enforcement-ladder tier bar, claim lights,
  freshness, drift arrows), a component list (worst-light-wins), and a drill-in per
  component (the invariant → chokepoint → oracle table with per-row verdicts, `w` for
  the `## why` pager). Watch mode (default on a TTY) re-runs the scoped fast tier on
  file change and streams what flipped. `--once` prints a static snapshot (also what a
  non-TTY stdout gets).
- `coherence log [<refA> [<refB>]]` — the **temporal ledger**: the structural diff of
  the invariant/boundary set between two refs (default `HEAD` → working tree). The graph
  is a snapshot; this is the transaction view — which `## invariants` and `boundary`
  claims were **added**, **removed**, or **rewired** (chokepoint or oracle changed),
  per component, by building the graph at each ref in a throwaway git worktree. Answers
  "did my change alter what's enforced?" without re-reading the world. `--strict` exits
  nonzero on a **loss** (a removed invariant/boundary/parity/component) so a PR can't
  silently drop a guard the way a prose review misses it.
  After the ledger it prints the **NOVELTY vs ANCHORS advisory** — the pressure the
  ledger alone lacks: a large feature can land with ZERO ledger change and read
  "no structural change" while shipping a pile of unanchored surface. The advisory
  contrasts BEHAVIORAL SURFACE ADDED across the range (net-new exported symbols,
  net-new union/enum variants and `Record<…>`-keyed table keys — an AST scan of the
  changed files at each ref, `.tsx` included, non-exported tables counted, test files
  excluded — plus code-LOC numstat) against ANCHORS ADDED (invariants + boundary/parity
  claims). Significant surface with zero anchors raises the alarm; anchors outpaced
  `ratio`× raise the softer advisory; and when the signal is churn-shaped (LOC-only, or
  deletions tracking additions) it self-qualifies: *"disregard if recent work was mostly
  refactor"*. Thresholds in `config.novelty` (`minSurface` 8 · `minLoc` 400 · `ratio`
  12). Advisory only — never the exit code.
- `coherence signal [--check] [--since <ref>]` — the per-change pressure layer over
  `log`'s novelty instrument. Significant behavioral surface with zero new invariant,
  boundary or parity anchors fails under `--check`; smaller changes and anchored changes
  pass. The deliberate escape hatch is not a permanent config switch:
  `--attest-no-invariant --because "…"` appends a decision whose finding key contains a
  fingerprint of the base commit, assessable changed paths and their current bytes. Any
  patch change outside the harness's own `.coherence/` records invalidates that
  attestation. Presence of an anchor is not proof that it is the right
  one; this gate makes the omission visible and addressable, then leaves semantics to
  review and verification.
- `coherence context [<file>...] [--symbol <name>] [--changed|--staged] [--max-bytes N|--all]`
  — a route-first reading packet for a task, bounded to 12,000 bytes by default. It returns
  selected graph ownership, intent and why, invariants and claims, chokepoints/oracles,
  one-hop imports/importers, structurally relevant tests, repository-level surfaces,
  standing decisions, open conjectures, unresolved inputs, and named limitations. Tracked,
  untracked, and explicitly requested ignored/generated files remain addressable even when
  they have `graphOwner: null`. File, symbol and Git-change selectors compose. The
  bounded render is deterministic and reports every withheld item and byte by reason; an
  impossible budget refuses with the exact minimum. `--all` opts into the unbounded
  expansion. This lowers retrieval cost without claiming semantic completeness.
- `coherence decompose` — the **wise-decomposition** report. Coherence holds the Intent
  graph (spec tree) and the Structure graph (imports); this adds the Evolution graph (git
  change-coupling) and measures their *agreement*. Prints a **LOCALITY** score (the
  fraction of co-change that stays inside one component — higher = wiser) plus smells:
  cross-boundary co-change (false-boundary / smeared-concern), files pulled into many
  concerns (missing abstraction), and structure hubs. Advisory — it surfaces, you judge.
- `coherence drift` — the **direction** view: decompose's derivative. Where decompose
  grades the decomposition *now*, drift reads recent history and shows whether the agent
  is **converging** (one concern → one home — the anti-entropic response to perturbation)
  or **decohering** (concerns smearing across boundaries — a block-list forming). It
  projects today's component map back over the last ~400 commits and prints two
  trajectories — **LOCALITY** (co-change staying in one component; rising = wiser) and
  **SPREAD** (distinct components per commit; falling = localizing) — the **hot seam**
  (the boundary being churned across right now), and the recent stream of **gestures**
  (each commit tagged ● converge / ○ couple / ✕ smear by component span). For an operator
  watching an agent drive, this is the "where is this going" instrument: a clean snapshot
  with a decohering slope is the early warning a static grade can't give. Advisory, and
  honest about its limit — it sees gesture *shape*, not intent (a chokepoint-building edit
  and a guard-scattering one can look alike); read the diff at the seam, and use
  `coherence verify` for whether each invariant is actually anchored.
- `coherence economy [--raise]` — the **context closure** of a change: what a reader must
  load to modify one thing safely. `decompose`, `drift` and `mass` all measure the *write*
  side — whether co-change stays inside one component, which way that is moving, how much
  machine there is. This is the read side, and it moves independently: a repo can hold
  perfect locality and still demand nine files be held in the head for any edit, because
  the component's files all reach through one hub. Per commit, the closure is the touched
  files **the graph knows**, plus their direct import neighbours **in both directions**,
  plus the spec files of the components those files belong to. Both directions is the
  load-bearing half — a safe modifier needs what the touched file depends on (or the edit
  is written against imagined behaviour) *and* who depends on it (or the edit is a silent
  breaking change); a one-way closure would report a hub as cheap. The report is the median
  and p90 closure in files and lines over the last 400 commits (the 2–40-file concern band
  every other derivation applies), an 8-window trend of the median, the **worst closures**
  (which changes demanded the most context), the **files in most closures** (read-side hubs
  — everything needs these), and the mean closure per component. Two approximations, both
  named on the report itself rather than in a footnote: **lines are measured against the
  current tree**, which is an approximation for historical commits (per-commit `git show`
  buys precision the ranking does not turn on), and **the universe is the graph** — a commit
  that touched only docs, config or a lockfile contributes *no* closure rather than a zero,
  because a zero would claim a change was free to read that this instrument never saw.
  `--raise` opens a conjecture for each file appearing in **half or more** of the recent
  closures, keyed on the bare path, with the two candidates that actually explain one: a
  declared hub (the cost is the honest price of one home — record it and dismiss) or a
  missing abstraction (`decompose`'s smell, with a read-side price tag). It exits 0 always:
  a closure is a cost, not a defect, and a project whose specs are worth reading has a
  larger closure than one with no specs at all. The run is recorded in
  `.coherence/status.json` (`economy`), sample size included — a median over three commits
  and one over three hundred must never look alike.
- `coherence premise [--check]` — audit whether the structural addresses cached in
  standing journal decisions still resolve. Explicit `files` leases are check-grade:
  a missing file fails `--check`; uniquely moved candidates and missing/ambiguous symbols
  are reported with stable finding keys. Code-shaped paths inferred from prose remain
  advisory because prose is not authority, and decisions with no extractable lease are
  counted rather than invented. This detects broken referents, not a rationale whose
  words still point at live code while its meaning has gone stale.
- `coherence calibrate [--outcome clean|defect] [--session <id>]` — compare economy's
  predicted one-hop read set with observed explicit file reads, then label the patch
  outcome. Compact append-only samples live per session in `.coherence/calibration/`;
  raw hook traces remain transient. Exact write-bearing rows scope changed files to the
  editing session; Codex parent-only rows stay `parent-session-aggregate`, legacy rows
  stay unscoped, and hosts without write events fall back to the shared worktree union.
  Trace damage produces no sample instead of shrinking the observation silently. Coverage
  and defect-rate differences are calibration evidence, not
  causal proof, and shell/editor/remembered reads are intentionally not guessed.
- `coherence scaffold <boundary|component|invariant|parity> <name>` — the gradient-flip
  generator: make the complete shape the cheapest thing to ship.
  - `boundary` — a NEW component spec pre-wired with `## invariants` + a `boundary` claim
    + the chokepoint/fail-closed/oracle TODOs. You can't scaffold a half-boundary: the
    unanchored-invariant gate refuses it until the chokepoint symbol and oracle exist.
  - `component` — a NEW plain component spec (intent + works-when skeleton + why stub).
  - `invariant` — the PASTE-IN fragments (invariants entry + boundary claim + why
    paragraph) to add an invariant to an **existing** spec; printed to stdout, no file,
    so the three pieces land in lockstep instead of as orphaned prose.
  - `parity` — the same paste-in kit for a **parity** invariant, plus a domain-loop
    oracle skeleton (enumerate the SSOT, assert `projectionA ≡ projectionB` per member)
    that the parity meta-oracle will accept once the placeholders are real symbols.
- Adoption (there is no `onboard` command — evicted 2026-07-31): `coherence verify` on a
  repo with no record and no claims does not say "✓ coherent"; it names the adoption
  state and prints THE ONE NEXT ACTION, re-runnable, one rung per run — write a config;
  name ONE boundary (measured by `decompose`/`economy`/`redundancy`, which work on a repo
  with zero claims); leave `## works when` empty until the first incident supplies the
  first claim; give one invariant an oracle; prove one breaker trips (`## refutations`).
  `onboard` was removed because it was undefended (zero tests; gutting its significance
  filter changed nothing observable), its component candidates were a platform heuristic
  rather than a boundary analysis, it emitted job piles that measured zero uptake, and
  its draft spec shipped the exact green trivialities (`typechecks`, `<entry> exists at
  root`) this repo prunes from its own spec.
- `coherence lint-sinks [--check | --update-baseline]` — interpolation-surface
  ratchet (raw SQL-identifier / HTML sinks). Mechanism in the harness; SAFE patterns
  + scoped `sources` in config; baseline in `<outputDir>/sinks-baseline.json`. The
  baseline is **move-aware**: a site keyed `context|file|expr` whose file was relocated
  is reconciled as a **MOVE** (reported `old → new`, does not fail) rather than as new
  risk, because keying a reviewed site by its path made every refactor manufacture false
  security alarms in proportion to how much code it moved — and a ratchet whose alarms
  are routinely wrong is one reviewers learn to wave through. Absorption is
  **count-conserving**: only a baselined site that *vanished* can absorb a relocated one,
  one for one, so a site that was **copied** (the original still live) is still NOVEL and
  still fails. Content-addressing alone would have let an already-reviewed expression
  reappear in any number of new and more dangerous files for free.
- `coherence conventions [--check | --update-baseline]` — guard-vs-contract detector
  + growth ratchet: a load-bearing guard at N sites with no boundary contract is a
  convention crossing; the baseline makes the set append-only-with-review.
- `coherence mass [--check|--update-baseline] [--raise]` — the **mass ratchet**: how much
  machine there is, pinned. Every other ratchet counts a *kind of debt*; this one counts
  the thing a reader of an agent-built repo asks first — how much is there now, and did it
  grow? Byte mass is **orthogonal** to inference mass — a font file costs a reader nothing,
  while a ten-line implicit coupling can cost more than the rest of the repo — so this
  ratchet measures the other axis on purpose, and it measures the axis along which
  undeclared facts quietly accumulate. A codebase does not decohere only by smearing
  concerns across boundaries; it also decoheres by accumulating, one defensible edit at
  a time, which is exactly why the
  aggregate needs a pin rather than a review. Dimensions, each an addressable baseline key:
  `lines|total` and `lines|<component>` (from the shared on-disk read in `src/tree.ts`
  every measurer uses), `files|total`, `symbols|total`, `deps|direct` / `deps|dev` (package.json) and
  `deps|transitive` (the npm lockfile's `packages` map minus its root entry), plus
  `measure|<key>` for each probe declared in `config.mass.measures` — the harness runs the
  command from the project root and reads the **last numeric token** of its stdout, so a
  bundle-size or table-count probe needs no plugin. Report mode also prints an 8-bucket
  **net-LOC spark** over the last 400 commits: the pin says whether today is bigger than
  the last pin, and the spark says what the road here looked like (a negative window is a
  real, and welcome, shape). Ratchet mechanics are `conventions`': `--update-baseline`
  writes `<outputDir>/mass-baseline.json`, `--check` fails on **new keys** and on growth
  past `config.mass.tolerance[key]` (default 0), shrinkage never fails, and a baselined key
  that has vanished prints as droppable. Two rules the dimensions obey, and both are
  load-bearing: **absence is not emptiness** — no package.json or no lockfile OMITS those
  dimensions instead of reporting `0`, because "the lockfile disappeared" must not read as
  "nice, zero transitive deps"; and **an unmeasurable measure fails closed** — a probe that
  exits nonzero or prints no number is reported loudly and fails `--check`, because a
  broken bundle probe read as `0` is the most dangerous sentence a growth ratchet can
  utter. The failure message does not print a diff you already had: it says *the movement
  gained parts nobody named* and instructs `coherence decide "<what the new mass buys>"
  --because "…"`, then a re-pin. `--raise` turns each excursion into an open conjecture
  keyed on the **dimension** (never on its value), so a second run after more growth adds
  no second question. The run is recorded in `.coherence/status.json` (`mass`).
- `coherence atlas [--check]` — trust-graded manifold render + drift/dangling/over-claim
  gate; charts/crossings from `config.atlas`. Its `nonTransition` half is the registry of
  **cached negative inference** — symbols a reader would otherwise have to re-derive a
  *no* about, answered once. Tier-1 (**enshrined**) is a crossing
  explicitly marked `enshrined: true` in config AND backed by a `via guard` boundary claim
  (the guard is the source-totality evidence the enshrinement rides on); a bare `via guard`
  or `via test` claim is tier-2 (**totality-checked**); no governing claim is tier-3
  (**convention**). The renderer does NOT infer unrepresentability from a claim's verb. An
  `enshrined` marker with no backing `via guard` is an over-claim and **fails `--check`**.
  What `--check` verifies is only that an `enshrined` crossing HAS a backing `via guard`
  claim — it does **not** verify the crossing is genuinely a runtime-branded capability
  whose illegal value cannot be constructed (that is not statically decidable from the
  claim). So a consuming project should **reconcile** its atlas `enshrined` set against its
  own tier authority — e.g. a tier-gate that grades tier-1 structurally from a capability
  list — with a double-entry check: the atlas `enshrined` set must **equal** the gate's
  tier-1 set, and drift in either direction (an enshrined crossing the gate does not grade,
  or a gate tier-1 the atlas does not enshrine) is a red.
  Every crossing also carries a **heat** reading — the share of the recent concern-carrying
  commits (the last 200, 2–40 files each) that touched the file defining the chokepoint,
  rendered as a bar normalized against the hottest crossing on this map plus the raw
  percentage. It answers the axis a tier cannot: a tier-3 crossing nobody has opened in a
  year and a tier-3 in the file half the repo's commits touch are the same grade and
  completely different risks. **Heat never affects `--check`** — a hot crossing is not
  wrong, a cold one is not right — and `—` means *unmeasurable* (no such symbol in the
  graph, or no history), never cold. The **inference hazard** line is the join of the two:
  a tier-3 crossing (an undeclared junction — every reader who arrives re-derives what may
  legally cross) whose heat is **≥ 10%** (somebody keeps needing to know). It renders in the
  console and gets its own `### Inference hazards` section in `atlas.md`, and `--raise`
  opens one conjecture per hazard keyed on the crossing **symbol** — never on its heat,
  which moves weekly and would mint a fresh question every warm run. Like the heat it is
  built on, a hazard grades nothing: `--check` still fails only on drift, dangling edges
  and over-claim.
- `coherence contracts [--check]` — **producer/consumer contracts across deploy
  artifacts** (the atlas's split, applied to data contracts: project data, harness
  mechanism). `config.artifacts` names the deploy units as path globs (a file may sit
  in several — `shared/**` typically in all); `config.contracts` declares each typed
  cross-unit message: a `producer` chokepoint symbol, a `consumer` chokepoint symbol,
  and the shared vocabulary `type` symbol. The WHY: a message produced in one
  compile/deploy unit and consumed in another (a Worker's SSE frames rendered by the
  browser bundle) is invisible to either unit's compiler — the two sides typecheck
  separately and drift silently; only the whole-source graph sees both. Each declared
  contract is resolved against the graph (**DANGLING** if a symbol is gone), located in
  its artifacts (disjoint producer/consumer sets = **CROSS-ARTIFACT**), and graded
  **anchored** iff a boundary or parity claim names its producer, consumer, or type.
  `--check` fails dangling or unanchored contracts. The **detector** then flags, as an
  advisory, every file whose importers span disjoint artifact sets but which no
  contract or anchored claim covers — shared vocabulary two deploy units must agree on
  that nothing yet declares. (Import edges come from the graph, so today they cover the
  language adapter's extensions — `.ts`; a `.tsx`-only importer is not seen.)
- `coherence redundancy [--all] [--raise]` — the **undeclared half of parity**. A `parity` claim is
  *declared*: somebody already suspected two projections should agree and wrote it down.
  The defect class that actually costs time is the complement — nobody declared anything,
  and two things that should have agreed quietly didn't (two decoders of one byte encoding
  reading 56,317 and 158 violations of the same property; the *disagreement* was the whole
  signal, and it took a human noticing a number looked absurd). Redundancy is the only
  detector that reaches unknown-unknowns, because a divergence between two independent
  computations is informative **without any prior claim about the value**.

  So this scans for **one enumerated domain spelled more than once**: a string-literal
  union, an enum, an interface's members, an object/`Record` literal's keys, a `switch`'s
  case labels, an `x === "lit"` chain, an array of string literals, the **first column of a
  markdown table**, and a bracketed `a|b|c` alternation inside a string or regex. Markdown
  counts on purpose — a hand-kept doc table transcribing a code table is the one
  duplication no compiler will ever see.

  Three things keep it from becoming a wall. **Compiler-enforced pairs are collapsed, not
  reported**: `const G: Record<Verdict, string>` cannot drift from `Verdict`, so tsc is
  already the oracle and coherence has nothing to add (that pair is tier-1 on the ladder
  above). **Test files are excluded**: a hand-copied domain inside an oracle is the boundary
  meta-oracle's finding, not a second detector's. **Pairs a `parity` claim already names are
  dropped** — the point is what nobody declared. What survives is ranked by shared-token
  count, how much of that vocabulary appears at no third site, code↔prose vs code↔code, and
  whether the two spellings **already disagree** (a transcription that has drifted is a
  finding on its own evidence, with no oracle behind it).

  Output is **advisory, ranked, and capped** — it always exits 0, and it would rather stay
  silent than ship candidates. `--all` drops the floor so the tail can be judged rather than
  trusted; thresholds live in `config.redundancy`. Findings are candidates, not defects:
  the fix is to derive one spelling from the other (best), or to declare the `parity` claim
  that was missing. `--raise` opens the pairs above the **default** floor as conjectures —
  never the tail `--all` exposes, which is there to be judged, not recorded.
- **The decision journal**, all eight verbs — the section "The decision journal" above has
  the reasoning behind each. Every one of these appends to
  `.coherence/decisions/<session>.jsonl`, and **none of them gates anything**:
  - `coherence decide "<chose>" --over "<rejected>" --because "<why>"` — a choice made.
    `--over` is repeatable and is the field that matters: what was REJECTED is what
    stops the next agent re-opening a settled question. It is the cache entry for the
    most expensive inference in the repo — the search that no longer has to be run.
  - `coherence blocked "<what>" --because "<why>"` — what could NOT be determined.
    First-class, not a footnote; it is the section that gets dropped under length pressure.
  - `coherence conjecture "<observation>" --could-be "<explanation>" --discriminated-by "<test>"`
    — a suspicion. `[instrument] the instrument is wrong` is injected as a candidate
    whether or not you supply it.
  - `coherence resolved <id> --because "<what the test showed>" [--as "<which won>"]` —
    close a conjecture. `resolve` is accepted as an alias.
  - `coherence dismiss <id> --because "<why this is not worth chasing>"` — retire an open
    conjecture **unanswered**. Not a resolution: it renders in its own section saying so,
    and a dismissed finding is never raised again.
  - `coherence retract <id> --because "<what refuted it>" [--for "<replacement>"]` —
    withdraw a decision. An append, never an edit: a journal that quietly changed its
    mind is indistinguishable from one that was always right.
  - `coherence observed "<label>" --value <n> --baseline <n> --threshold <n> [--why "…"]`
    — a project's own harness reporting a measurement. Inside the band, silence; outside
    it and unexplained, one conjecture per label.
  - `coherence decisions [--job|--agent|--session|--branch|--open|--sessions|--md|--brief]`
    — the MERGED timeline across every session file, ordered by time. `--compact` is the
    one exception to "appends only": it folds **committed** session files into one per
    (branch, month) and is judged by leaving this render character-for-character identical.
- `coherence experiment <create|inspect|close> …` (alias `plan`) — the first-class plan
  ledger. `create` freezes a hypothesis, predicted context, inert actions, criteria, and
  owner session-file evidence cursors before work. `close` requires total nonempty evidence,
  labels telemetry at its weakest provable scope, and derives
  `success|failure|inconclusive` from the criteria; it accepts no caller-authored outcome
  and makes no clean/defect or causal claim. Records append under
  `.coherence/experiments/<writing-session>.jsonl`.
- `coherence contract` — the **promise graph**: derive declared zones, graded gates and the
  reliance double-entry into a self-contained `_contract.html`, plus `promise.json` for
  agents and tools. It is the **reliance ledger** — an inspection artifact written for the
  relying party rather than the author, answering *what may be assumed here, and on whose
  evidence*, which is the trust-side reading of the ladder above. It embeds live grades, so it is always regenerated — there is no
  `--check` for it.
- `coherence hooks [status|install|uninstall|print] [--check] [--host claude|codex] [--session S] [--json]`
  — the lifecycle control. `--host` selects every action; `--session` scopes `status`,
  `--check`, and the report after `install`/`uninstall`, while `print` accepts only the
  host. One host-selected canonical five-event bundle and stable launcher are shared by
  the printer, installer, and checker. A
  sessionless `--check` grades the complete runnable control; with `--session`, it also
  requires activation evidence from that host's exact installed bundle. `status` keeps
  structural state, current-session activation, and historical firing separate, and names
  Codex's `parent-fallback` attribution ceiling. The block traces explicit read/write paths
  at `PostToolUse`; `SubagentStop` emits the journal + patch report, while main-agent `Stop`
  records calibration with byte-empty stdout. `coherence-hook <event>` is the
  dependency-light lifecycle body; `coherence hook <event>` remains the general-CLI spelling.
- `coherence why-lint` — the **`## why` discipline**, two advisory checks against the
  graph the harness already holds:
  1. **mechanism-restatement** — a sentence that names an anchored chokepoint/oracle
     SYMBOL alongside an oracle-VERB ("iterates", "totality", "fails the build") is
     prose re-deriving the WHAT — the boundary claim already carries it.
  2. **paragraph ↔ invariant anchoring** — in specs that declare `## invariants`,
     every `## why` paragraph should anchor to a named invariant (mention it by name,
     case- and punctuation-insensitive), and every invariant should be anchored by
     some paragraph. Unanchored paragraphs are narrative drift; unanchored invariants
     are rationale debt. Parenthetical paragraphs (`(...)`) are exempt as meta-framing.
     Components without `## invariants` are exempt entirely (free-form why is fine).

  This applies pressure on the right axis (CONTENT, keyed to the invariant set) rather
  than the wrong one (character count, which would flatten the load signal — a spec
  carrying thirteen boundaries earns more bytes than one carrying one). `--check` exits
  nonzero on a finding; otherwise advisory.

## The verify loop + verdict flow

**The non-vacuity floor runs before anything is graded.** Every verdict below rests on the
graph deriving non-empty, and that premise is checked first (the instrument-check-first
idiom): a run that derives ZERO claims while `.coherence/status.json` remembers a graded
surface **refuses** — exit 1, a legible `✗ [floor]` message, and no record filed (a refusal
that overwrote the memory it refused against would refuse exactly once). Scoped runs cannot
trip it: the floor reads the always-full-tree graph, above the `--staged`/`--since` seam. It
deliberately stops at zero — a partial collapse where every component keeps a claim is
observationally identical to deliberate pruning, and deletion has to stay free.

**The complement is narrower than it looks, and this is the hole to know about.** Coverage
reds a component that *survives derivation* carrying zero claims — a broken spec parse. It
iterates the DERIVED graph, so a component the **walk dropped entirely** (a bad `ignore`
entry, a glob bug, a moved or renamed `*.spec.md`) is invisible to it: there is no node
left to red. Measured: with one component removed from what the walk discovers, a record
remembering 2 claims produced `claims: 1 · 1 green`, `components 1/1 claimed`, `✓ coherent`
exit 0 — and the record was rewritten to 1 claim in the same run, so a gradual N→1 collapse
never accumulates toward the floor. That is not gated on purpose: a vanished node is
exactly what deleting a spec produces, and a gate that punishes removal teaches people to
stop removing. **The mitigation is a pin, not a gate** — a `measures` dimension in
`config.mass` whose command counts the population (component nodes or claim lines in the
derived graph) turns the shrink into a *ratchet* finding: reviewable, and re-pinnable only
with a diff. It answers the question the floor cannot — not "is anything left?" but "is
there as much as there was?".

The only legitimate zero is a project with no memory, and that
gets the **adoption ladder** (see `onboard`'s eviction note in the command detail) instead
of a green: the same empty observation, told apart by the record.

`coherence verify` runs in two tiers:

- **`--fast` (the deterministic tier)** — structural claims (`exists`, `imports`),
  `typechecks`, boundary **anchoring** + chokepoint-symbol resolution, the
  source-derived Vitest oracle-name floor, the **meta-oracle** (static AST analysis —
  it runs even under `--fast`), the coverage gates, and the narrative evidence hashing.
  No test runner, no network. This is the pre-commit tier.
- **the full run (the live tier)** — everything above **plus** `responds` probes
  (needs the server up; unreachable = skip), `passes test` runs, and boundary-oracle
  test runs. This is the outer-loop / CI tier. Since v0.17.0 the executable tier runs
  the suite **once** and resolves every claim from that one report — see below.

### Batched oracle execution — the default since v0.17.0

**The deployment tiers, honestly.** `--fast` is the inner loop — seconds, no runner, run it
on every save. A **scoped** full run (`--staged` / `--since`) is what you run when a feature
is finished. A **whole-tree** full run **plus `npm test`** is the pre-deploy gate — the pair,
never `verify` alone: verify cannot catch its own evisceration (measured 2026-07-31 —
corrupting `evalClaim`'s verdict adaptation, `fail` → `pass`, left 20 guard oracles failing
in the suite while verify still printed "✓ coherent, 27 green"; only the suite reds there).
That last tier used to be unaffordable, and the reason was arithmetic, not test count.

Before v0.17.0 the executable tier shelled `config.test` **once per claim**
(`vitest run -t "<name>"`), booting the project's entire test pool to execute milliseconds
of assertions. Measured in two consuming repos:

- a workerd/vitest pool at 15–30s per boot × ~70 executable claims = **20–35 minutes**, for
  a suite that runs end-to-end in under two;
- a second repo: one targeted oracle run took **4.51s** and reported `7 passed | 291
  skipped` — it paid the import and transform cost of 298 tests to run 7. × 17 claims ≈ 77s,
  ~60s of it fixed overhead, **on top of** an outer `check.mjs` that had already run the
  whole suite. Their full tier: 8 minutes.

That is not a conservative default; it is a bad one nobody chose. So **batching is now the
default**, and the per-claim profile is opt-in.

#### The four modes, in precedence order

| Mode | How you get it | What happens |
| --- | --- | --- |
| **`--from-report <file>`** | the flag | Resolves from a report you already have. Runs **no tests at all**. |
| **serial** | `--serial-oracles`, or `"oracleExecution": "serial"` | One full pool boot **per claim**. Prints its cost every run. |
| **batch (configured)** | `config.testBatch` | Runs your command once, resolves every claim from the report. |
| **batch (derived)** | *nothing — this is the default* | `config.test` names vitest → coherence synthesizes the JSON-reporter command itself. |

If none of those apply — an unrecognized runner, no `testBatch`, no report, no explicit
serial — the full tier **fails loud** with all three ways out. It will not quietly buy you
N pool boots:

```
✗ [oracles] cannot run the executable tier, and will not silently run it the slow way.
  config.test (pnpm jest -t) is not a runner coherence knows how to batch.
  The executable tier needs ONE of these — pick deliberately:
    · config.testBatch: ["npx","vitest","run","--reporter=json","--outputFile=.coherence/test-report.json"]
    · coherence verify --from-report <file>
    · coherence verify --serial-oracles   (or config.oracleExecution: "serial")
```

A consumer has to **type the name of the expensive profile** to get it. When serial does run
— explicitly, or as the batch-crash fallback — it states the cost every time and names the
config that retires it.

`--outputFile` is preferred over bare `--reporter=json`, and the derived command uses it: a
test that writes straight to `process.stdout` puts its bytes in the same stream as the
report, ahead of it. Coherence scans for the report object rather than trusting the whole
stream, so the bare form works too — but a file cannot be interleaved with at all.

**`coherence verify --from-report <file>`** is the cheapest tier of all. If an outer gate (a
CI step, a `check.mjs`) has just run the suite, hand coherence its report and the full
executable tier costs a file read. The flag is its own opt-in; passing a path asserts the
file is current, which is a claim only the caller can make.

For Vitest, make the report the suite's ordinary CI output rather than paying for a second
run. Keeping the human reporter beside JSON preserves the useful failure log; `always()`
lets Coherence attribute failing and vanished oracles even when the test step is red:

```yaml
- name: Test and write oracle evidence
  run: >-
    npx vitest run --reporter=default --reporter=json
    --outputFile.json=.coherence/vitest-report.json
- name: Resolve Coherence claims from that same run
  if: always()
  run: npx coherence verify --from-report .coherence/vitest-report.json
```

#### Source-derived oracle existence in `--fast`

A vanished oracle is a name-resolution failure before it is a test outcome. The fast tier
therefore derives an ephemeral Vitest-title index directly from the current test source and
uses the same literal-substring matcher as the JSON-report path. It reconstructs each
literal `fullName` through its enclosing `describe`/`suite` titles, so a claim may still
name a whole suite or a substring spanning the suite/test boundary.

This floor never upgrades a skipped executable claim to green. A source match proves only
that the named oracle exists, so the claim remains skipped until a real run supplies its
outcome. Zero matches after a complete scan is red — `VANISHED ORACLE (static)`. There is
also an edit-time proof that does not require global completeness: when a concrete test
name in Git `HEAD` owned the live claim and disappears from a former owner path that is
deleted or still statically complete, the lost owner reds before unrelated dynamic sites
are considered. If that former owner file itself becomes dynamic, damaged, or unreadable,
the claim remains **unknown**. Outside a Git checkout that signal is simply unavailable.
The red-capable population is conventional
`*.test/spec` TypeScript/JavaScript source.
Dynamic titles, parameterized declarations, local or imported test DSLs, runtime
registration helpers, unreadable or damaged source, unsupported Vitest wrappers, zero
conventional candidates, and visible custom `include`/`includeSource` configuration make
absolute current-tree absence explicitly **unknown**, never absent. A lost concrete HEAD
owner remains independently observable. This is a direct-declaration grade:
arbitrary side-effect imports, evaluation, or dynamically assembled configuration cannot
be proven complete without executing the project. Set `staticOracleExistence: false` for
such a registry; fast claims then remain UNKNOWN/skipped. The scanner executes no test
configuration, imports no test module, touches no remote binding, and writes no index
artifact; the node is derived again from the working tree on every fast verification.

#### Three states, and the third one is the actual point

Speed is the visible win. The one that matters is that a report distinguishes what an exit
code cannot:

| | fast source floor | serial (per claim) | batch report |
| --- | --- | --- | --- |
| named test ran and **passed** | skip — existence only | green | green |
| named test ran and **failed** | skip — no outcome | red | red, naming the failing test |
| named test **does not exist** | **red when statically provable** | *green* unless you set `testMatch` | **red — `VANISHED ORACLE`** |
| source title cannot be resolved | explicit unknown/skip | runner answers | report answers |

`vitest -t` exits **0** when its filter matched nothing, so a renamed or deleted oracle reads
as a pass — the hole `config.testMatch` exists to plug, by having the project hand-configure
a regex over the runner's *output*. Under batch mode absence is directly observable: zero
matching tests is its own distinct verdict saying the claim names an oracle that does not
exist, so nothing is enforcing it. **`testMatch` has nothing left to do for a batched
claim.** Same move as an unknown claim kind or a typo'd verb — eliminate the failure mode
structurally instead of papering over it with a knob a reader has to know to set.

This matters most where it is least visible. On `node --test`, `testMatch` does **not** work
at all: a `--test-name-pattern` matching nothing still reports the *file* as one passing test
and exits 0, satisfying any "N passed" regex. (Worse, node stops parsing its own options at
the first positional, so a `config.test` of `["node","--test","<glob>","--test-name-pattern"]`
passes the filter to the *script*, where it is silently ignored and the whole suite runs and
passes.) Both were measured on Node 25.2.1.

#### What it guarantees

- **Matching mirrors the runner's `-t`.** Verified against vitest 4.1.10: `-t` is an
  *unanchored regex* over the report's `fullName` (`ancestorTitles.join(" ")` + the title),
  and the serial path always regex-**escapes** the claim name first — so an escaped pattern
  matched unanchored is exactly a **literal substring** test. `-t "totality covers"` really
  does run `write policy totality covers every op`, and a claim anchored to a `describe`
  title matches every test beneath it. Green requires ≥1 matching test that **passed** and
  **none** that failed; skipped tests are neither evidence nor failure, which is what the
  runner itself concludes.
- **Attribution stays per claim.** The batch is shared *evidence*, never a shared verdict.
  Each claim fails alone, naming its own oracle and the specific test that failed. "The suite
  is red" is not a verdict coherence will ever print.
- **A crash falls back, loudly.** If the batch command cannot run, or its report will not
  parse, verify says so, prints the serial cost, and reverts to the per-claim path. A nonzero
  **exit code is not a crash**: a suite with a failing test exits nonzero, and that is
  precisely the run whose report is most worth reading.
- **A stale report is refused.** The report file must postdate the run that was supposed to
  write it. A runner that exits without writing, over a leftover report, would otherwise
  resolve every claim from evidence about code that no longer exists — and would look
  healthy.
- **A typo'd `testBatchFormat` fails the run** rather than falling back. A silent revert
  would produce a correct-looking green that took thirty minutes.
- **`--fast` stays runner-free** — executable outcomes still skip, but Vitest-backed claims
  pay the small source-derived existence floor above. A project with no test-backed claims
  never builds the index.
- **Scoped runs still batch the whole suite once** and resolve only the in-scope claims from
  it. One boot is already cheaper than even three scoped per-claim boots.
- The `responds` probes and the **meta-oracle** are untouched — neither is runner-based.

#### What it does NOT do

Batching stops you **repaying import overhead**. It does not make a genuinely long-running
oracle cheaper: an ensemble that does ~140s of real convergence work costs ~140s whether it
is reached through one boot or seventeen. If your full tier is slow because the *tests* are
slow, this feature will not help and the honest fix is elsewhere.

**`node --test` cannot be batched yet.** It ships no JSON reporter (only `default`, `dot`,
`junit`, `lcov`, `spec`, `tap`) and its `--test-name-pattern` does not match the concatenated
suite path the way vitest's `-t` does, so a batch would need a second, unverified matching
rule. node:test projects are recognized and told so, rather than guessed at; use
`--from-report` with a report you produce, or `--serial-oracles`.

### The narrative evidence chain

`narrative.json` (at the project root) holds prose statements pinned to evidence
files (`"evidence": ["file:src/x.ts", …]`). On every run, verify hashes each
statement's evidence; when the hash differs from the statement's `verifiedHash`, the
statement flips to `pending` and a `verify-statement` job is emitted — a code change
automatically flags every narrative statement whose evidence it touched. Missing
evidence files flip the statement to `broken`, which is a hard failure.

Jobs land in **`.coherence/verify-jobs.json`** in three groups: VERIFY (judge if the
statement still holds against the changed evidence), GENERATE (derivable — missing
claims/docblocks; write into source and re-run), AUTHOR (a missing `## why` — NOT
derivable; do not fabricate; needs a human/attested author).

A subagent (or you) resolves the VERIFY jobs by writing
**`.coherence/verify-verdicts.json`** — the exact shape `applyVerdicts`
(`src/verify.ts`) reads:

```json
[
  { "id": "n1", "supported": true, "reason": "still holds" },
  { "id": "n2", "supported": false, "reason": "the retry limit moved to config",
    "corrected": "Retries are bounded by config.maxRetries (default 3)." }
]
```

Then apply:

```sh
coherence verify --apply .coherence/verify-verdicts.json
```

`supported: true` re-pins the statement to the current evidence hash (`status: ok`).
`supported: false` marks it `drifted` with `reason` as the drift note and the
optional `corrected` text as the suggested replacement — and exits nonzero until the
narrative is fixed. The judge (whoever wrote the verdicts) and the notary (the
harness recording them) are deliberately separate — axiom #5.

### The status record and the panel

Historically the richest signal the harness computes — per-claim verdicts, coverage,
tier grades, the drift trajectory — was printed to stdout and evaporated at process
exit, so nothing human-facing could ever show *health*. Now every instrument **files a
report**: `verify` (both tiers), `atlas`, and `drift` write their findings into
**`.coherence/status.json`**, each section stamped with its own ISO time + short
commit + dirty flag. The record is the last known truth, honestly dated — never a
claim about the present. Machine-readable by design (`jq`-able; the panel is just one
consumer).

For `orient`, a successful verification is `current` only when its failure count is zero,
its recorded commit matches live `HEAD`, its recorded dirty bit is false, and the live index,
tracked files, and untracked files contain no material change. Exactly
`.coherence/status.json` is excluded from that live dirty reading because filing the receipt
after sampling Git would otherwise invalidate every run immediately. A source or staged
change at the same `HEAD` is therefore stale; committing after a pre-commit verification also
moves `HEAD` and makes that receipt stale until verification runs again.

**Commit `.coherence/status.json`.** The sticky red history (`everFailed`,
`lastFailAt`, `lastFailCommit`, `runs`) is the only part of the record that is
CUMULATIVE, and it is what makes the never-red advisory mean anything — a fresh
clone starts with no history, so nothing has "never been red" and the advisory
stays silent forever. The cost is honest churn: the timestamp and dirty flag move
on every run, so the file conflicts on concurrent branches. Resolve by keeping the
side with the higher `runs` and `everFailed: true` if either has it — those two
fields only ever ratchet.

Three merge rules keep the record honest (`src/status.ts`):

- **A skip never clobbers a real verdict.** A `--fast` run skips the executable tier;
  overwriting last week's oracle PASS with "skipped (--fast)" would erase the last
  known truth. The old verdict survives with its own stamp — its age is visible, not
  laundered.
- **Scoped runs (`--staged`/`--since`) replace only what they touched**; out-of-scope
  records ride through and keep aging.
- **Full-tree runs drop ghost rows** — a claim deleted from a spec leaves the record.

`coherence panel` renders the record live. The lights encode the honesty rules: a
pass recorded at another commit degrades to **stale** (`◐`, shown with age — never
re-badged green); a fail stays a fail however old (the worst known truth); tier-skips
render as "not run", never as health; **dialect-gap skips get their own mark** (`?`)
so a typo'd verb is a visible light instead of a silent no-op; and every `via guard`
row carries a **⚑ human eye** flag, because the meta-oracle never analyzed it. The
fast and full tiers age independently in the masthead (`fast 40s · full 2d`) — an
unrefreshed green is itself a health fact. The tier bar renders the atlas's
enshrined/totality-checked/convention distribution: the enforcement ladder made
visible, deliberately *not* collapsed into a fake single score.

The panel re-runs nothing in-process: `r`/`R`/`a`/`d` (and watch mode's file-change
trigger, which runs `verify --fast --staged` — exactly the pre-commit tier, scoped to
what changed) spawn the CLI as a child, let it file its report, and re-read the
record — judge and notary stay separate, and the panel works identically on a record
some other process (CI, an agent's run) filed.

### The two enforcement points

Wire the fast tier as a pre-commit governor and mirror the full tier in CI. The
harness ships no hook files — the consuming project owns this wiring, e.g.:

```sh
# .hooks/pre-commit  (then: git config core.hooksPath .hooks)
coherence verify --fast --staged && coherence docs --check && coherence claude --check
```

CI runs the full thing: `coherence verify` (live tier, server up if you use
`responds`), `coherence docs --check`, `coherence claude --check`, plus whichever
ratchets the project has adopted (`conventions --check`, `lint-sinks --check`,
`atlas --check`, `log --strict`). Both points need **Node ≥22**.

## Generated artifacts: what coherence owns vs what stays authored

| Artifact | Ownership | Regenerated by | Freshness gate |
| --- | --- | --- | --- |
| `<outputDir>/graph.json`, `_graph.html` | fully owned | `coherence graph` (or `docs`) | `graph --check` / `docs --check` |
| `<outputDir>/_overview.html`, `AGENTS.md` | fully owned | `coherence overview` (or `docs`) | `overview --check` / `docs --check` |
| `<outputDir>/_index.html`, `index.json` | fully owned | `coherence index` | none — it embeds a live frame and a cursor |
| `CLAUDE.md` | **two-zone** — one owned fenced block; everything outside stays authored | `coherence claude` | `claude --check` |
| `README.md` | **two-zone** — one owned fenced block holding the derived command index (opt-in) | `coherence docs` | `docs --check` |

**Never hand-edit the owned regions** — the next regeneration clobbers them, and
`--check` fails CI on the drift in the meantime. The `--check` comparison normalizes
volatile fields (timestamps, the absolute checkout path, symbol line numbers) so it
fails only on real structural drift, not clock/machine/line churn. The command index is
the exception, and deliberately: it is a pure function of the registry — no clock, no
paths — so its gate is a byte-for-byte compare with **nothing** normalized away. Every
normalization a freshness gate needs is a hole in that gate.

The two fenced blocks answer a **missing marker pair differently**, which is not an
inconsistency. `claude --check` reds on it: you asked for that block by running that
command, so a CLAUDE.md without markers is a file that failed to get wired up. `docs
--check` treats it as *not owned* and stays green: `docs` runs in every consuming project,
and a gate that fails on a file the project never opted into is a gate that gets switched
off wholesale. `coherence docs` still says which case it took — an un-fenced README prints
the marker pair to add, rather than passing in silence.

The CLAUDE.md contract (`src/render-claude.ts`): the owned block sits between the
exact markers

```
<!-- coherence:begin -->
…generated component map + invariants→chokepoint→oracle table…
<!-- coherence:end -->
```

`coherence claude` splices a fresh block between them and preserves everything
outside (your why-essays, conventions, doctrine — the WHY, which the graph cannot
derive). If the markers are absent it **refuses to touch the file** and prints the
marker pair to add — opting in is explicit. `config.claudeMdPath` moves the splice
target (e.g. a repo-root CLAUDE.md above a sub-package). The generated invariants
table is rendered from every `boundary … via (test|guard)` claim, parsed by the
single `BOUNDARY_RE` in `src/boundary.ts` (shared by `verify`, `structural`, and
`render-claude` — one home for the grammar).

The README.md contract (`src/commands.ts`): the same splicer, a **distinct** marker pair —
HTML comments reading `coherence:commands:begin` and `coherence:commands:end`. Distinct
because a project may carry both files, the two blocks hold different things, and a shared
marker would let one command clobber the other's zone. `spliceBlock`/`extractBlock` take the
fence as an argument for exactly this; there is one splice implementation, not two. Run
`coherence docs` in a repo whose README lacks the pair and it prints the exact lines to
paste — named here rather than quoted verbatim on purpose, because a second literal copy of
a fence inside an owned file is a second fence, and `indexOf` cannot tell which one you
meant.

## Known limits (read this section; it is the point)

- **The task context is a bounded hypothesis, not completeness.** It uses graph ownership,
  one-hop imports/importers, repository surfaces, structural test links and journal
  addresses. The CLI defaults to 12,000 bytes and accounts exactly for withheld items and
  bytes; `--all` is an explicit expansion. Dynamic loading, semantic coupling and external
  state can live beyond that packet; its limitations are printed in every result.
- **The work graph records declared coordination, not effective capability.** Authority,
  owner, dependency, and path scope are attributable facts, but the ledger neither spawns
  an agent nor prevents an out-of-scope write. Path overlap does not discover semantic
  coupling, external systems, or an omitted scope.
- **Decision disappearance detection has a Git-HEAD, zero-population grade.** It catches a
  current checkout whose tracked decision files were all deleted. It does not prove an empty
  non-Git/unborn repository complete, detect deletion already committed into history, resist
  history rewrite, or detect partial loss while any valid row survives.
- **Consequence edges are assessed provenance, not causal proof.** They are never inferred
  from co-presence. Commit identities can be checked against Git and durable record ids
  against their strict ledgers; verification is still a rolling status record rather than
  an append-only receipt registry, so verification references remain explicitly
  existence-unchecked.
- **Orientation is one bounded heading, not an overall correctness verdict.** It refuses
  unavailable required evidence and orders known coordination obligations. Unrecorded
  work, wrong-but-well-formed decisions, and facts outside its listed sources remain
  outside the reading.
- **Premise leases detect dead addresses, not dead meanings.** Missing explicit files are
  strong failures; inferred prose paths are advisory. A live file or symbol can still
  support a rationale that is semantically obsolete.
- **Read calibration is an explicit-path lower bound.** Shell commands, editor buffers and
  remembered context are not inferred. Per-agent patch attribution requires write-bearing
  tool events; without them a sample uses the shared worktree's changed-file union. An
  unobserved lifecycle bundle or empty event window is absence of hook evidence, not a
  measured zero failure rate.
- **The change signal measures surface and anchor presence, not semantic adequacy.** A
  trivial anchor can satisfy its structural condition, and a patch-specific journal
  decision can attest that no anchor is needed. Review and claim verification still judge
  whether either choice is true.
- **The meta-oracle is necessary, not sufficient.** It proves the oracle's iteration
  root is live-derived — NOT that the effective domain is complete
  (`app.routes.filter(r => PUBLIC.has(r) || r === "…")` passes while covering a
  hand-list), NOT that the domain is non-empty (the floor annotation is advisory),
  and NOT that the assertion exercises the real mechanism rather than a correlate.
  Perturbation (break it, watch it go red, restore) is the only ground truth.
- **`via guard` skips domain analysis entirely.** A genuine escape hatch for source-
  property oracles and for non-domain behavioral invariants (see the escape-hatch
  section) — and therefore a laundering channel for hand-lists dressed as guards.
  Review every `via guard` by hand; write source guards as AST walks, never source
  regexes; and demand refutations for behavioral guards, which prove only the
  scenario their test body exercises.
- **Coherence checks DECLARED invariants.** Nothing enforces `exists ⇒ declared`: an
  invariant your code depends on but no spec names is invisible to every gate here.
  Declaring the right invariants is your discipline; `conventions`, `decompose` and
  `redundancy` help surface candidates, but the declaration is on you.
- **It verifies claims PASS, not that they're the RIGHT claims.** A spec full of
  green trivialities is coherent and worthless. Human attestation of the claim set —
  judge ≠ notary — is axiom #5, and it is not automatable.
- **An unrecognized claim line skips, it doesn't fail.** The dialect gap keeps the
  harness language-agnostic, but it means a typo'd verb is a silent no-op — watch
  the `skipped` count.
- **The wrong call is still expressible.** Coherence can require the chokepoint
  exists and its oracle holds; only the type system can make routing *around* the
  chokepoint unrepresentable. Tier-2 machinery is not tier-1.
- **Dictionary words are parameterless (v1), so most commitments are GLOBAL, not
  node-relative.** A word's `typechecks` / `passes test` commitments assert the same
  global fact no matter which node conforms — so the conformer list is *documentation,
  not discrimination*: a node can `conforms to` a word whose pattern it doesn't actually
  use and still verify green (the commitments pass for reasons unrelated to that node).
  Only node-relative forms (`exists at this node`, `imports`) genuinely vary per
  conformer. Read a green `conforms to` as "these commitments hold," not "this node
  embodies the pattern."
- **`conforms to`'s red-not-skip guarantee begins only AFTER the verb matches exactly.**
  The contract semantics (a broken reference or a typo'd commitment goes red, not skip)
  apply to a `conforms to <Word>` line the harness *recognized*. A malformed line —
  trailing punctuation, wrong casing, a stray word — matches no claim form at all, so it
  is a silent dialect-gap skip like any other unrecognized free-form claim. Watch the
  `skipped` count after authoring a `conforms to`; a typo in the verb itself vanishes.
- **A word with unrunnable commitments reports SKIPPED, not green.** Under `--fast` (or
  with no test runner configured), a word whose commitments include `passes test` makes
  the whole `conforms to` claim a **skip** — it lands in verify's skipped tally, not the
  green count, so a word can't launder to "coherent" having run none of its commitments.
  Run the full tier to certify a word.

## The two documentation fields

- **what** (docblock body / `## ` prose) — derivable from code, regenerated freely.
- **why** (`@why` in a docblock, `## why` in a spec) — rationale/intent, NOT derivable;
  authored and protected (verify won't auto-generate it — ground it in the git history
  of the decisions it explains, then human-attest it).

## Develop the harness itself

```sh
npm install        # installs typescript + @types/node, builds dist via prepare
npm run build      # tsc → dist
node src/cli.ts graph   # run from source (Node ≥22 strips types; no build needed)
npm test           # node:test suite (Node ≥22; type-stripped, zero test deps)
```

Add a `LanguageAdapter`/`PlatformAdapter` (see `src/types.ts`), register it in
`src/derive.ts`'s `LANGUAGES`/`PLATFORMS` map, and select it via config.

### Tests

`test/*.test.ts` run on the built-in `node:test` runner (no Vitest/Jest — the
harness keeps its zero-dependency stance, and Node ≥22 strips the TypeScript at
load). Coverage targets the load-bearing, regression-prone logic rather than
chasing a line-count: the **meta-oracle** classifier (`oracle-domain.ts` — every
live/literal/no-iteration path), the **spec parser** (`walk.ts`), the **claim +
boundary + coverage engine** end-to-end (`verify.ts`, including the `testMatch`
rule that stops a renamed test from silently staying green and the
unanchored-invariant ratchet), the **CLAUDE.md fence splicer** (never clobbers an
un-opted-in file, and now takes the fence as an argument so README.md's command block
reuses it), the **command registry's totality oracle** (`commands.test.ts` — it parses
`cli.ts` and asserts the registry equals the live `cmd === …` dispatch, so a new branch
with no registry entry, or the reverse, fails the suite; it checks its own scanner *first*,
because an AST scan that silently returned nothing would compare two empty sets and pass),
the **structural ledger** (`structural.ts` — a dropped
boundary/invariant is a loss `--strict` gates on), the **status record's merge rules**
(`status.ts` — a skip must never clobber a real verdict; scoped runs replace only what
they touched), and the **panel's pure core** (`panel.ts` — light derivation incl.
staleness degradation, model assembly, and the frame renderer with colors off).
