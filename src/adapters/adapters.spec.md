# Source adapters

Translate language syntax and platform configuration into the common graph vocabulary
consumed by the harness core.

Adapters may know a language or platform. The derivation and verification layers should
not acquire those details directly.

## works when

- tree-sitter.ts exists at this node
- cloudflare.ts exists at this node

## why

Language and platform knowledge changes on a different cadence from graph semantics.
Keeping it at this seam prevents a new parser or deployment target from multiplying
conditionals through every renderer and verifier.

One parsing foundation lives here now. The regex adapters that preceded it were
corpus-diffed to parity and deleted — two implementations of one outcome are two
spellings of a domain, and the languages themselves became data: a grammar binary
plus a spec of capture queries per language, with the prose-extraction logic the
regex era proved carried over verbatim.
