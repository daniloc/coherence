# Source adapters

Translate language syntax and platform configuration into the common graph vocabulary
consumed by the harness core.

Adapters may know a language or platform. The derivation and verification layers should
not acquire those details directly.

## works when

- typescript.ts exists at this node
- python.ts exists at this node
- cloudflare.ts exists at this node

## why

Language and platform knowledge changes on a different cadence from graph semantics.
Keeping it at this seam prevents a new parser or deployment target from multiplying
conditionals through every renderer and verifier.
