# coherence-harness

A standalone coherence harness for agent-developed projects. It derives a
multi-resolution graph from a `*.spec.md` tree plus the code, renders a navigable
outline and an agent map, and verifies that the docs/claims haven't rotted.

The **core is platform- and language-agnostic.** Project-specific knowledge lives
behind two adapters:
- **language adapter** (`src/adapters/typescript.ts`) — symbols, imports, docblocks.
- **platform adapter** (`src/adapters/cloudflare.ts`) — infra bindings (wrangler.jsonc + .toml). Optional.

## The mental model: the enforcement ladder

Every rule a codebase depends on sits at one of three tiers. The harness exists to
move rules **up** the ladder and to make the current tier of every rule *visible*:

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

## Install as a Claude Code plugin (MCP + skills) — the primary way in

Coherence is meant to be experienced through MCP. The repo is itself a Claude
Code plugin: installing it registers a `coherence` MCP server (the commands
below as tools, run against your project's cwd) plus two skills — `coherence`
(the day-to-day spec/claim/verify workflow) and `coherence-adopt` (bootstrapping
the harness into a project).

```
/plugin marketplace add daniloc/coherence
/plugin install coherence@coherence
```

On the MCP server's first launch the plugin bootstraps itself (`npm install`,
which builds `dist/`) — that one-time step needs network access and Node ≥ 22;
after that it starts instantly. The MCP tools: `verify`, `docs`, `claude_md`,
`phrasebook`, `scaffold`, `onboard`, `log`, `atlas`, `contracts`, `conventions`,
`lint_sinks`, `why_lint` — each mirrors the CLI command of the same name.

Any other MCP client can run the same server directly: `coherence mcp` (stdio).

## Install from GitHub (no npm registry)

Add it as a git dependency. npm clones the repo and runs `prepare` (which builds
`dist/`), then links the `coherence` bin.

```jsonc
// package.json
"devDependencies": {
  "coherence-harness": "github:daniloc/coherence"   // or "github:daniloc/coherence#v0.1.0"
}
```

```sh
npm install
```

Then add scripts that call the bin:

```jsonc
"scripts": {
  "coherence:graph":  "coherence graph",
  "coherence:docs":   "coherence docs",
  "coherence:verify": "coherence verify"
}
```

Requires **Node ≥22** in the consuming project (the build targets ES2022; the
harness uses only Node built-ins, no runtime deps).

## Configure the target project

Add `coherence.config.json` to the project root. Minimal:

```json
{
  "typecheck": ["npm", "run", "typecheck"],
  "test": ["npx", "vitest", "run", "-t"],
  "testMatch": "[1-9][0-9]* passed"
}
```

Full (every field the `Config` interface in `src/types.ts` accepts; defaults from
`src/config.ts`):

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
  "oracleDomain": true,
  "language": "typescript",
  "platform": "cloudflare",
  "claudeMdPath": "../CLAUDE.md",
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
| `ignore` | `["node_modules",".git","dist",".turbo",".wrangler"]` | Dir names the spec/code walk never enters. NOTE: the meta-oracle does **not** reuse this list when hunting for oracle test files (see below). |
| `codeExt` | `["ts"]` | File extensions treated as code for the tree. |
| `typecheck` | `["npm","run","typecheck"]` | Command the `typechecks` claim shells. |
| `test` | `[]` | Base command for `passes test "<name>"` / boundary-oracle claims; `<name>` is appended as the final arg. Empty = those claims skip. |
| `testMatch` | unset | Optional regex the test output MUST contain to count as a pass. **Set it** for runners like `vitest -t` that exit 0 when the name matched nothing — without it a deleted/renamed test silently stays green. |
| `oracleDomain` | `true` (anything but `false`) | The META-ORACLE gate: assert a `via test` oracle iterates a LIVE domain. Set `false` to disable the gate. |
| `language` | `"typescript"` | Language adapter key. |
| `platform` | `null` | Platform adapter key, or null. |
| `components` | unset | Sub-component overrides for `decompose`/`drift` co-change analysis ONLY (globs relative to root; first match wins). The spec graph, verify, and coverage are untouched. |
| `claudeMdPath` | `"CLAUDE.md"` | Path to the CLAUDE.md whose fenced block `coherence claude` owns. May be `../`-relative to escape the coherence root (repo-root CLAUDE.md above a sub-package). |
| `dictionary` | `"dictionary"` | Dir (relative to the coherence root) holding the pattern dictionary — one `<Word>.md` per word. A `conforms to <Word>` claim expands the word's commitments against the declaring component. A project with no such dir simply has no words (see "The dictionary" below). |
| `sources` | `[entryDir]` | Dirs the `lint-sinks`/`conventions` scans are scoped to — keep generated/vendored trees out. |
| `testDir` | `"__tests__"` | Path substring identifying test files for the ratchet scans. |
| `conventions` | unset | `guardVerb` (regex for guard-function NAMES), `seed` (extra guard names), `dismissed` (guard → why it's covered elsewhere). |
| `sinks` | unset | `safeSql`/`safeHtml` — regexes for interpolation expressions that are SAFE by construction. |
| `atlas` | unset | Trust-manifold data: `charts` (trust domain → description), `transitions` (chokepoint symbol → crossing; each may set `enshrined: true` — see below), `nonTransition` (within-chart boundaries), `knownPending` (mapped symbols tolerated as not-yet-in-source). A transition's `enshrined: true` is an **explicit** attestation that the illegal value at that crossing is unrepresentable (a runtime-branded capability), promoting it to tier-1 — it is NOT inferred from a claim's verb, and it MUST be backed by a `via guard` boundary claim (an `enshrined` marker with no backing guard fails `atlas --check`). |
| `novelty` | unset | Thresholds for `log`'s novelty-vs-anchor advisory: `minSurface` (8), `minLoc` (400), `ratio` (12). |
| `artifacts` | unset | Deploy units for `contracts`: unit name → path globs. A file may belong to several (shared vocabulary typically does). |
| `contracts` | unset | Declared cross-unit data contracts: name → `{ producer, consumer, type, description? }` (all symbols). `contracts --check` fails a contract that dangles or that no boundary/parity claim anchors. |

Then author `*.spec.md` files (a folder containing one is a *node*). A spec is
`# Name`, a one-line intent, an optional `## works when` claim list, an optional
`## invariants` list, and an optional `## why` (protected rationale). Claims are a
grammar, not prose — the parser (`src/walk.ts`) strips markdown-formatter escapes
(`\_` → `_`) so a prettified spec still parses.

## The claim phrasebook (the `## works when` grammar)

The claim grammar is a declarative registry — `CLAIM_FORMS` in `src/phrasebook.ts`,
an ordered list of forms where **first match wins** (the order IS the precedence).
`evalClaim` (`src/verify.ts`) is a thin loop over it. **A line matching none of these
is SKIPPED** (`no verifier (dialect gap)`) — it never goes red. A typo'd verb is
therefore a silent no-op; check verify's `skipped` count after authoring claims.

**`coherence phrasebook` is the generated authority** — it prints the table straight
from the `CLAIM_FORMS` registry, so it never lies about the current grammar. The table
below is a hand-maintained convenience copy: nothing compares it against the registry,
so it *can* drift. When the two disagree, the verb (and the registry behind it) wins —
run `coherence phrasebook` to see the source of truth.

| Claim | Grammar | Tier | Example |
| --- | --- | --- | --- |
| typechecks | `typechecks` | deterministic (runs under `--fast`) | `typechecks` |
| exists | `<file> exists at (root\|this node\|every node)` | deterministic | `wrangler.jsonc exists at root` |
| imports | `<file> imports <specifier>` | deterministic | `main.ts imports ./registry` |
| responds | `<url> responds <status> [with "<text>"]` | **live** (skipped under `--fast`; unreachable URL = skip, not fail) | `http://localhost:8787/health responds 200 with "ok"` |
| passes test | `passes test "<name>"` | executable (skipped under `--fast`) | `passes test "write policy totality"` |
| boundary | `boundary "<invariant>" at <chokepoint> [via (test\|guard) "<oracle>"]` | hybrid — anchoring + chokepoint-symbol check + meta-oracle run even under `--fast`; the oracle test run is skipped under `--fast` | `boundary "fail-closed writes" at applyWritePolicy via test "write policy totality"` |
| parity | `parity "<invariant>" over <domain> between <fnA> and <fnB> via test "<oracle>"` | hybrid — anchoring + domain/projection symbols must exist + the parity meta-oracle runs even under `--fast`; the oracle test run is skipped under `--fast` | `parity "disclosure faithfulness" over TOOL_NAMES between toolActivity and messageProvenance via test "live equals settled"` |
| conforms to | `conforms to <Word>` | hybrid — expands a dictionary word's commitments against the declaring component (see "The dictionary" below) | `conforms to OwnedScope` |

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
  pointing at a renamed or deleted test goes **red** — that's the rot detection.
- **boundary** asserts a self-enforcing boundary's anatomy *as a unit*: the named
  invariant, the chokepoint SYMBOL exists in the code graph, and (if given) the
  oracle passes — `via test` additionally passes the meta-oracle (next section);
  `via guard` is exempt from it (see the escape-hatch section). It **anchors** the
  named invariant for the coverage gate.
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

Some real oracles are **source-property** checks, not domain loops: "no trusted
factory exists anywhere", "no call site constructs this type directly". These cannot
be expressed as iteration over a live domain, so `via guard "<oracle>"` exists: the
oracle test must still run and pass, but the meta-oracle's live-domain analysis is
**skipped** (`src/verify.ts`, the boundary arm — the `verb === "test"` condition
gates the `analyzeOracle` call).

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

## Commands

- `coherence phrasebook` — print the claim-form table (name, grammar, tier, example)
  straight from the `CLAIM_FORMS` registry (`src/phrasebook.ts`). The generated authority
  behind the phrasebook table above.
- `coherence graph` — emit `graph.json` + `_graph.html` (the outline) to `outputDir`.
- `coherence overview` — emit `_overview.html` + `AGENTS.md`.
- `coherence docs` — both. `--check` fails if any artifact is stale (for CI/pre-commit).
- `coherence claude` — regenerate the owned fenced block inside CLAUDE.md
  (see "Generated artifacts" below). `--check` fails if the block is stale or the
  markers are missing.
- `coherence verify` — run claims, the narrative evidence chain, and coverage.
  Emits inference jobs (`.coherence/verify-jobs.json`) for a subagent on change;
  `--apply <verdicts>` records the subagent's verdicts; `--fast` skips the
  live/executable tiers (see "The verify loop" below).
  `--staged` (working changes vs HEAD + untracked) or `--since <ref>` **scopes** the
  run to the components whose dirs changed — fast edit-loop reconciliation of just what
  you touched (claims + boundary anchoring + coverage), instead of the whole tree.
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
- `coherence onboard` — bootstrap a repo with no specs: derive structure, suggest a
  decomposition, and emit why-from-history jobs. Output is proposals to review.
- `coherence lint-sinks [--check | --update-baseline]` — interpolation-surface
  ratchet (raw SQL-identifier / HTML sinks). Mechanism in the harness; SAFE patterns
  + scoped `sources` in config; baseline in `<outputDir>/sinks-baseline.json`.
- `coherence conventions [--check | --update-baseline]` — guard-vs-contract detector
  + growth ratchet: a load-bearing guard at N sites with no boundary contract is a
  convention crossing; the baseline makes the set append-only-with-review.
- `coherence atlas [--check]` — trust-graded manifold render + drift/dangling/over-claim
  gate; charts/crossings from `config.atlas`. Tier-1 (**enshrined**) is a crossing
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

`coherence verify` runs in two tiers:

- **`--fast` (the deterministic tier)** — structural claims (`exists`, `imports`),
  `typechecks`, boundary **anchoring** + chokepoint-symbol resolution + the
  **meta-oracle** (static AST analysis — it runs even under `--fast`), the coverage
  gates, and the narrative evidence hashing. No test runner, no network. This is the
  pre-commit tier.
- **the full run (the live tier)** — everything above **plus** `responds` probes
  (needs the server up; unreachable = skip), `passes test` runs, and boundary-oracle
  test runs. This is the outer-loop / CI tier.

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
| `CLAUDE.md` | **two-zone** — one owned fenced block; everything outside stays authored | `coherence claude` | `claude --check` |

**Never hand-edit the owned regions** — the next regeneration clobbers them, and
`--check` fails CI on the drift in the meantime. The `--check` comparison normalizes
volatile fields (timestamps, the absolute checkout path, symbol line numbers) so it
fails only on real structural drift, not clock/machine/line churn.

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

## Known limits (read this section; it is the point)

- **The meta-oracle is necessary, not sufficient.** It proves the oracle's iteration
  root is live-derived — NOT that the effective domain is complete
  (`app.routes.filter(r => PUBLIC.has(r) || r === "…")` passes while covering a
  hand-list), NOT that the domain is non-empty (the floor annotation is advisory),
  and NOT that the assertion exercises the real mechanism rather than a correlate.
  Perturbation (break it, watch it go red, restore) is the only ground truth.
- **`via guard` skips domain analysis entirely.** A genuine escape hatch for source-
  property oracles — and therefore a laundering channel for hand-lists dressed as
  guards. Review every `via guard` by hand; write guards as AST walks, never source
  regexes.
- **Coherence checks DECLARED invariants.** Nothing enforces `exists ⇒ declared`: an
  invariant your code depends on but no spec names is invisible to every gate here.
  Declaring the right invariants is your discipline; `conventions` and `onboard`
  help surface candidates, but the declaration is on you.
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
  authored and protected (verify won't auto-generate it; it can be bootstrapped from
  git history via `onboard`, then human-attested).

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
un-opted-in file), and the **structural ledger** (`structural.ts` — a dropped
boundary/invariant is a loss `--strict` gates on).
