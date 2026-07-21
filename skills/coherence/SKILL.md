---
name: coherence
description: Working in a project that uses the coherence harness — it has coherence.config.json and/or *.spec.md files. Use when editing code or specs in such a project, when the user mentions coherence, specs, claims, invariants, boundaries, or parity, or when a coherence verify/docs CI gate goes red. Covers the coherence MCP tools (verify, docs, phrasebook, scaffold, …), the claim grammar, and the reconciliation loop.
---

# Working with the coherence harness

Coherence derives a multi-resolution graph from a `*.spec.md` tree plus the code,
renders docs from it, and **verifies that the specs' claims still hold**. Interact
with it through the `coherence` MCP server's tools; every tool runs against the
current project (or pass `project_root` explicitly).

## The mental model (30 seconds)

Every rule sits on a three-tier enforcement ladder:

1. **Enshrined** — the wrong state is unrepresentable (type system's job).
2. **Totality-checked** — one declarative home + an oracle that fails loud (the
   tier coherence's `boundary`/`parity` claims target).
3. **Convention** — N sites held together by memory. A latent tear.

The harness exists to move rules **up** the ladder and make each rule's tier
visible. Conventions are failures lurking in the code; promote them to contracts.

## The core loop

1. **Edit code or specs.**
2. **Reconcile:** call `verify` — with `staged: true` to scope to what you touched
   (or `since: "<ref>"`), `fast: true` to skip test runs while iterating.
3. **A red claim means the spec and code disagree.** Fix the code, or — only when
   the *claim* is what's wrong — change the claim and say so out loud. Never
   weaken a claim just to go green; that deletes the rot detector.
4. **Watch the skipped count.** A claim line matching no grammar form is silently
   SKIPPED, never red — a typo'd verb is a no-op. If verify reports more skips
   than you expect, diff your claim lines against the `phrasebook` tool's output.
5. **Keep derived docs fresh:** `docs` with `check: true` tells you if
   graph/overview/AGENTS.md are stale; call `docs` (and `claude_md`) to
   regenerate before committing.

## Authoring claims

**Always call the `phrasebook` tool before writing or editing `## works when`
lines** — it prints the live grammar straight from the registry, so it never
lies. Highlights:

- `typechecks` · `<file> exists at root` · `<file> imports <specifier>` — deterministic.
- `passes test "<name>"` — the single front door: an invariant enforced by a test
  is named in the spec, so verify transitively runs it, and a renamed/deleted
  test goes red.
- `boundary "<invariant>" at <chokepoint> via test "<oracle>"` — asserts a
  self-enforcing boundary's anatomy; the meta-oracle requires the oracle to
  iterate a LIVE domain, not a hand-copied sample.
- `parity "<invariant>" over <domain> between <fnA> and <fnB> via test "<oracle>"`
  — two projections of one enumerated domain must agree.

Use the `scaffold` tool (`kind`: boundary | component | invariant | parity) to get
paste-in spec fragments and an oracle skeleton instead of writing them from
memory.

## A spec file, minimally

A folder containing a `*.spec.md` is a node:

```markdown
# Name
One-line intent (≤140 chars).

## works when
- typechecks
- boundary "fail-closed writes" at applyWritePolicy via test "write policy totality"

## invariants
- writes outside policy are rejected

## why
Protected rationale — decisions, not mechanism (the why-lint tool flags prose
that restates what a boundary claim already anchors).
```

## The other tools

| Tool | Use it to |
| --- | --- |
| `log` | Structural diff of the invariant/boundary set between refs — what a change added/removed/weakened. |
| `atlas` / `contracts` | Render (or `check`-gate) the trust manifold and cross-artifact contracts. |
| `conventions` | Find guard functions still at convention tier — candidates to promote to boundary claims. |
| `lint_sinks` | The SQL/HTML interpolation-surface ratchet. |
| `why_lint` | Flag `## why` prose restating mechanism. |
| `onboard` | Bootstrap proposals for a repo with no specs (see the coherence-adopt skill). |

Ratchet baselines (`conventions`, `lint_sinks`) only move via
`mode: "update-baseline"` — do that only after telling the user what changed.

If the MCP server is unavailable, the same commands exist as a CLI:
`npx coherence verify|docs|phrasebook|…` from the project root.

## What green does and does not mean

Coherence verifies a boundary's **anatomy** — invariant named, chokepoint symbol
exists, oracle runs over a live domain. It does not prove the wrong call is
impossible (tier-1, the type system's job) and does not judge whether a claim is
the *right* claim (the human's job). Treat every green run accordingly.
