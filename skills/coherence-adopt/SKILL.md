---
name: coherence-adopt
description: Install and adopt the coherence harness into a project that doesn't use it yet — add the git dependency, write coherence.config.json, run onboarding to bootstrap specs from the existing code and git history, and wire the verify/docs gates into CI and CLAUDE.md. Use when the user wants to add coherence (coherence-harness) to a repo, set up specs for an existing codebase, or asks how to get started with coherence.
---

# Adopting coherence in a project

Goal state: the project has a `*.spec.md` tree whose claims verify green, derived
docs that a CI gate keeps fresh, and a CLAUDE.md block the harness owns. Get
there in this order.

## 1. Install the harness

The npm package installs from GitHub (no registry); `prepare` builds it:

```jsonc
// package.json — requires Node >= 22 in the consuming project
"devDependencies": { "coherence-harness": "github:daniloc/coherence" },
"scripts": {
  "coherence:docs":   "coherence docs",
  "coherence:verify": "coherence verify"
}
```

Then `npm install`. (The MCP server itself ships with the Claude Code plugin —
the project-local install is what pins a version for CI and teammates.)

## 2. Write `coherence.config.json` at the project root

Minimal, and the fields that matter most:

```json
{
  "typecheck": ["npm", "run", "typecheck"],
  "test": ["npx", "vitest", "run", "-t"],
  "testMatch": "[1-9][0-9]* passed"
}
```

- `test` is the base command for `passes test "<name>"` claims; the name is
  appended as the final arg. Left empty, those claims skip.
- **Set `testMatch`** for runners like `vitest -t` that exit 0 when the name
  matched nothing — without it a deleted/renamed test silently stays green,
  which defeats the whole point.
- Other fields (`outputDir`, `sources`, `language`, `platform`, `atlas`,
  `contracts`, …) are in the README's config reference; add them as needed, not
  up front.

## 3. Bootstrap specs with the `onboard` tool

Call the `onboard` MCP tool (or `npx coherence onboard`). It derives the graph
and writes **proposals** (never source mutations):

- `.coherence-out/onboarding.md` — suggested component decomposition. The human
  decides the boundaries; the harness can't invent them.
- `.coherence-out/<project>.spec.md.draft` — a draft root spec. Refine the
  intent line, then promote it to a real `<Project>.spec.md`.
- `.coherence/onboard-jobs.json` — why-from-history jobs. Dispatch a subagent:
  for each job, read the file and its `git log`, propose a 1–2 sentence `@why`
  grounded in actual commits (cite them; never fabricate). Write proposals to
  `.coherence-out/why-proposals.md` for the human to attest.

## 4. Author the first claims

Start small: a root spec with `typechecks` plus one or two `exists`/`imports`
claims, then promote the project's most consequential invariant to a
`boundary … via test` claim (use the `scaffold` tool for the fragments and
oracle skeleton, and the `phrasebook` tool for the grammar — unknown claim
lines are silently skipped, not red). Run the `verify` tool until green.

## 5. Wire CLAUDE.md

Add a fenced block where the generated component map + invariant table should
live:

```markdown
<!-- coherence:begin -->
<!-- coherence:end -->
```

Everything between the markers is owned by the harness;
authored prose stays outside. Set `claudeMdPath` in config if CLAUDE.md lives
above the coherence root. Then call `claude_md` to splice the block.

## 6. Gate it in CI

Two checks keep the system honest:

```sh
npx coherence verify          # claims still hold (red = spec/code disagree)
npx coherence docs --check    # committed graph/overview/AGENTS.md are fresh
```

Optionally add `atlas --check`, `contracts --check`, and the ratchets
(`conventions --check`, `lint-sinks --check`) as the project grows into them.

From here, day-to-day work follows the `coherence` skill: edit → `verify`
(scoped with `staged: true`) → keep docs fresh → promote conventions upward.
