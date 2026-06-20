# coherence-harness

A standalone coherence harness for agent-developed projects. It derives a
multi-resolution graph from a `*.spec.md` tree plus the code, renders a navigable
outline and an agent map, and verifies that the docs/claims haven't rotted.

The **core is platform- and language-agnostic.** Project-specific knowledge lives
behind two adapters:
- **language adapter** (`src/adapters/typescript.ts`) — symbols, imports, docblocks.
- **platform adapter** (`src/adapters/cloudflare.ts`) — infra bindings (wrangler.jsonc + .toml). Optional.

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

Add `coherence.config.json` to the project root:

```json
{
  "outputDir": "docs/coherence",
  "entryDir": ".",
  "tooling": [],
  "ignore": ["node_modules", ".git", "dist", ".wrangler", "__tests__"],
  "codeExt": ["ts", "sql"],
  "typecheck": ["npm", "run", "typecheck"],
  "test": ["npx", "vitest", "run", "-t"],
  "testMatch": "[1-9][0-9]* passed",
  "language": "typescript",
  "platform": "cloudflare"
}
```

Then author `*.spec.md` files (a folder containing one is a *node*). See the spec
grammar: a spec is `# Name`, a one-line intent, an optional `## works when` claim
list, and an optional `## why` (protected rationale).

### Claim grammar (the `## works when` list)

Each claim is verified at one of three tiers:

- **structural** (instant, deterministic) — `X exists at this node` · `X imports Y` · `typechecks`.
- **executable** (slow, deterministic) — `passes test "<name>"` shells `config.test`
  with `<name>` appended and reports pass/fail. This is the **single front door**: an
  invariant enforced by a test (a totality check, a security boundary) is named in the
  spec, so `coherence verify` transitively runs it. A claim pointing at a renamed or
  deleted test goes **red** — that's the rot detection. Skipped under `--fast`.
- **live** (slow) — `URL responds 200 with "..."`. Skipped under `--fast`.
- **boundary** (the anti-entropy ratchet) — `boundary "<invariant>" at <chokepoint> [via test "<oracle>"]`
  asserts a self-enforcing boundary's anatomy *as a unit*: the named invariant, the
  chokepoint SYMBOL exists in the code graph, and (if given) a totality oracle test
  passes. It **anchors** the named invariant for the coverage gate below.

`config.test` is the base test command; `<name>` is appended as the final arg.
`config.testMatch` is an optional regex the output must contain to count as a pass —
**set it** for runners like `vitest -t` that exit 0 even when the name matched nothing
(without it, a deleted test silently stays green). The example above requires vitest's
`N passed` summary.

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

## Commands

- `coherence graph` — emit `graph.json` + `_graph.html` (the outline) to `outputDir`.
- `coherence overview` — emit `_overview.html` + `AGENTS.md`.
- `coherence docs` — both. `--check` fails if any artifact is stale (for CI/pre-commit).
- `coherence verify` — run claims, the narrative evidence chain, and coverage.
  Emits inference jobs (`.coherence/verify-jobs.json`) for a subagent on change;
  `--apply <verdicts>` records the subagent's verdicts; `--fast` skips live claims.
- `coherence decompose` — the **wise-decomposition** report. Coherence holds the Intent
  graph (spec tree) and the Structure graph (imports); this adds the Evolution graph (git
  change-coupling) and measures their *agreement*. Prints a **LOCALITY** score (the
  fraction of co-change that stays inside one component — higher = wiser) plus smells:
  cross-boundary co-change (false-boundary / smeared-concern), files pulled into many
  concerns (missing abstraction), and structure hubs. Advisory — it surfaces, you judge.
- `coherence scaffold boundary <name>` — emit a spec pre-wired with `## invariants` + a
  `boundary` claim + the chokepoint/fail-closed/oracle TODOs, so the cheapest "add a
  boundary" already produces the complete shape. You can't scaffold a half-boundary: the
  unanchored-invariant gate refuses it until the chokepoint symbol and oracle exist.
- `coherence onboard` — bootstrap a repo with no specs: derive structure, suggest a
  decomposition, and emit why-from-history jobs. Output is proposals to review.

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
```

Add a `LanguageAdapter`/`PlatformAdapter` (see `src/types.ts`), register it in
`src/derive.ts`'s `LANGUAGES`/`PLATFORMS` map, and select it via config.
