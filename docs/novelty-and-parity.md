# Novelty, parity, and cross-artifact contracts — design

Motivated by a real failure in a consuming repo: a ~3,500-line feature rev (a per-turn
tool-disclosure surface spanning the Worker and the browser bundle) landed with ZERO new
invariants/boundaries/components. `coherence log` correctly reported "no structural
change" — and a subsequent review found 14 confirmed bugs on exactly that surface, while
`verify` stayed green the whole time. Root cause, in this harness's own terms: coherence
verifies DECLARED claims, but nothing applies pressure to DECLARE when new load-bearing
surface appears; and the bug class itself — two projections of one enumerated domain
disagreeing across deploy artifacts (a Worker function and a browser table, which no
single TypeScript compilation can reconcile) — had no claim form that could express it.

Three mechanisms, one per gap:

## 1. Novelty-vs-anchor advisory (in `log`)

`coherence log <refA> [<refB>]` already computes the structural ledger diff. It gains a
second section: BEHAVIORAL SURFACE vs CLAIMS, contrasting proxies for net-new surface
across the range against the anchors added in the same range.

Surface proxies (tractable, explainable):
- **net-new exported symbols** — diffed from the two graphs' symbol nodes (keyed
  `path#name`; the graph already enumerates exports + class methods per ref).
- **net-new union variants / enum members / keyed-table keys** — a TS-AST scan
  (compiler API, already a runtime dep via the meta-oracle) of only the files git
  reports changed in the range, at each ref: exported string-literal unions, enums, and
  exported consts typed/`satisfies` `Record<K, V>` (their property-name keysets). New
  members of existing domains and members of brand-new domains both count — a new
  keyed-lookup table IS new behavioral surface.
- **LOC added/deleted** — `git diff --numstat`, filtered to `codeExt` minus `ignore`.

Anchors added: from the same StructuralDiff — invariants added + boundary claims added
(+ parity claims added, mechanism 2). New components are reported but a component
without invariants is not an anchor.

Verdict (advisory — never changes the exit code):
- `anchors == 0` and (`surface >= minSurface` (default 8) or `locAdded >= minLoc`
  (default 400)) → **"significant new surface, no new anchors."**
- `anchors > 0` but `surface > anchors * ratio` (default 12) → softer "surface is
  outpacing anchors."
- **Churn proviso** (the refactor self-qualification): a refactor is high line-churn but
  low net-new surface; a feature is net-new exports/variants. When the alarm fired on
  LOC alone (`surface < minSurface`) or deletions track additions
  (`locDeleted >= locAdded/2`), the advisory appends
  *"(disregard if recent work was mostly refactor — churn dominates net-new surface)"*.

Thresholds live in `cfg.novelty` (`minSurface`, `minLoc`, `ratio`), all optional.

## 2. Parity claims + producer/consumer contracts

### 2b. The parity claim form (the primitive)

The bug class: `f` and `g` are two projections of ONE enumerated domain (live
`action`-frame detail vs settled provenance detail, keyed by an implicit ToolName
domain) and silently disagree. The existing `boundary … via test` + meta-oracle asserts
COVERAGE of a domain; parity generalizes the same anatomy to AGREEMENT over a domain.

New claim form (src/parity.ts owns the grammar, mirroring boundary.ts):

```
parity "<invariant>" over <domain> between <fnA> and <fnB> via test "<oracle>"
```

e.g.

```
parity "disclosure faithfulness" over TOOL_NAMES between toolActivity and
messageProvenance via test "disclosure faithfulness (live action == settled provenance)"
```

Verification (a hybrid form, like boundary):
1. anchors `<invariant>` for the coverage gate (a parity claim is a first-class anchor);
2. `<domain>`, `<fnA>`, `<fnB>` must all resolve to symbols in the code graph;
3. **parity meta-oracle** (runs even under `--fast`, like the boundary meta-oracle):
   the named describe block must (a) ENUMERATE the declared domain — some iteration
   construct whose unwrapped root IS `<domain>` (helper unwrap: Object.keys/values/
   entries, Array.from, chained .map/.filter, it/test/describe.each) — and (b) reference
   BOTH `<fnA>` and `<fnB>`. Verdicts: `not-found`, `no-enumeration` (loops exist but
   none range over the declared domain — a hand-copied sample list), `one-sided` (the
   oracle never exercises one projection — exactly the pre-registry test, which compared
   two runs of the SAME projector), else ok;
4. the oracle test runs via the configured runner (skipped under `--fast`).

The oracle body — what "agree" means — stays project-authored (an equivalence between
two projections is domain knowledge: hoist's record-edits route into a different
provenance bucket than actions). What the harness auto-checks is the SHAPE that makes
the oracle a real parity totality: domain-enumerating, two-sided, passing.
`coherence scaffold parity <name>` emits the whole anatomy (spec fragment + a
domain-loop test skeleton asserting f≡g per member), so the complete shape is the
cheapest thing to ship — same gradient-flip as `scaffold boundary`.

Ledger: parity claims are parsed into the structural ledger beside boundaries —
added/removed/rewired, and a removed parity anchor is a LOSS under `--strict`.

### 2a. Producer/consumer contracts (declared, like the atlas)

Config gains two blocks (project data; harness owns mechanism — same split as atlas):

```jsonc
"artifacts": {                    // deploy units, by path glob
  "worker":  ["worker.ts", "entities/**", "shared/**"],
  "browser": ["web/**", "shared/**"]
},
"contracts": {                    // typed message: emitted at one chokepoint, consumed at another
  "sse-frames": {
    "producer": "send()",         // chokepoint symbol that emits
    "consumer": "readSse",        // chokepoint symbol that consumes
    "type": "SseFrames",          // the shared vocabulary symbol
    "description": "Worker emits the typed SSE frame family; the SPA renders it."
  }
}
```

`coherence contracts [--check]`:
- resolves producer/consumer/type symbols against the graph (DANGLING if missing);
- computes each contract's artifact crossing from the producer/consumer files' artifact
  sets (disjoint sets = a real cross-artifact contract — the case TS cannot see);
- grades each contract ANCHORED iff some boundary or parity claim names its producer,
  consumer, or type symbol as chokepoint/projection — an UNANCHORED declared contract
  fails `--check` (the must-declare pressure).

## 3. Cross-artifact totality (the detector)

The principle: an invariant that spans deploy artifacts is mandatory-to-anchor, because
no compiler sees both sides — only coherence's whole-source graph does. Enforcement
(folded into `contracts`): from the graph's import edges, any file whose importers span
DISJOINT artifact sets is shared vocabulary between deploy units. Each such file must be
covered by a declared contract (its type/producer/consumer lives there) or by a
boundary/parity claim anchored on one of its symbols; uncovered files are flagged in the
report as **cross-artifact surface with no declared contract** (advisory in v1 — the
declared-contract checks are the hard `--check` gate; the detector is the loud gap
list that #1's advisory pressure drives you to declare).

## Surfaces touched

- `src/novelty.ts` (new) — surface scan (pure, AST), signals diff, verdict, render.
- `src/structural.ts` — `withTreeAt` ref-checkout helper (graphAtRef refactors onto it);
  ledger learns parity claims; `structuralLog` runs the novelty advisory.
- `src/parity.ts` (new) — PARITY_RE + parseParity (single home of the grammar).
- `src/oracle-domain.ts` — `analyzeParityOracle` (reuses describe-finder + loop/root
  machinery).
- `src/phrasebook.ts` — the `parity` claim form (registry entry; anchors like boundary).
- `src/contracts.ts` (new) — the contracts subcommand + cross-artifact detector.
- `src/types.ts` — `cfg.novelty`, `cfg.artifacts`, `cfg.contracts`.
- `src/cli.ts` — wire `contracts`; usage text.
- `src/scaffold.ts` — `scaffold parity <name>`.
- tests: `test/novelty.test.ts`, `test/parity.test.ts`, `test/contracts.test.ts`.

## Validation (against the consuming repo)

- `log 7854c7e HEAD` on the consumer must light the advisory (ground truth: ~3.5k lines,
  +14-bug surface, zero anchors) — and with feature-shaped signals (net-new exports and
  variants high, deletions low), so NO churn proviso.
- The parity claim above, evaluated against the consumer's live tree (which now has
  `shared/tools/registry.ts` + the two-sided enumerating oracle), must go GREEN; the
  SAME claim evaluated against the pre-registry tree must go RED at the meta-oracle
  (`one-sided` / `no-enumeration`) — i.e. it would have caught the divergence class.
- `verify --fast` on the consumer must stay green under the modified harness.
