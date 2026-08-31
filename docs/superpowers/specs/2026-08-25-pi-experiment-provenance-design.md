# Pi experiment provenance compatibility

## Problem

Native Pi lifecycle events persist `host: "pi"` with `transport: "native"` in activity and read-trace evidence. The shared activity reader accepts that relation, but the strict experiment projection repeats the older Claude/Codex-only enums. A closed experiment containing valid Pi evidence therefore makes `coherence hooks status --host pi` report the experiment ledger as unavailable.

## Decision

Define one shared predicate for valid lifecycle host/transport relations and use it wherever activity-shaped provenance is validated.

The accepted relations are:

- `pi` with `native`;
- `claude` or `codex` with `launcher`;
- any recognized host with `direct`.

`unknown` remains recognized only where the existing activity contract permits it. Native transport with a non-Pi host and launcher transport with Pi or unknown continue to fail closed.

`isActivityRow` will use the shared predicate. The experiment activity projection will rely on `isActivityRow` rather than reapplying narrower host and transport checks. The experiment trace projection will apply the same shared predicate to its observation because read-trace evidence uses the same host and transport types.

## Compatibility and failure behavior

This changes no persisted schema, version, or bytes. It admits evidence already valid under the current activity/read-trace contract. Malformed records, unknown enum values, invalid host/transport pairings, attribution inconsistencies, and damaged framing remain unavailable rather than being skipped.

Existing Claude, Codex, direct, and legacy experiment evidence retains its current interpretation.

## Verification

A focused regression test will construct persisted experiment evidence containing `pi/native` activity and trace rows and prove the strict reader accepts it. The same test surface will prove invalid pairings still refuse. Focused experiment tests, typecheck, and the full test suite will run before the branch is updated.

## Non-goals

- No migration or rewriting of experiment ledgers.
- No relaxation of attribution, identity, timestamp, framing, or content-address checks.
- No broader experiment refactor.
