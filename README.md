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
  "language": "typescript",
  "platform": "cloudflare"
}
```

Then author `*.spec.md` files (a folder containing one is a *node*). See the spec
grammar: a spec is `# Name`, a one-line intent, an optional `## works when` claim
list, and an optional `## why` (protected rationale).

## Commands

- `coherence graph` — emit `graph.json` + `_graph.html` (the outline) to `outputDir`.
- `coherence overview` — emit `_overview.html` + `AGENTS.md`.
- `coherence docs` — both. `--check` fails if any artifact is stale (for CI/pre-commit).
- `coherence verify` — run claims, the narrative evidence chain, and coverage.
  Emits inference jobs (`.coherence/verify-jobs.json`) for a subagent on change;
  `--apply <verdicts>` records the subagent's verdicts; `--fast` skips live claims.
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
