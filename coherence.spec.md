# Coherence

The repository-level reading surface: configuration, package contract, generated maps,
and the authored explanation of why the harness exists.

Implementation belongs to the nested source and test components. This root component
keeps only the files that establish how those components are built, read, and released.

## works when

- coherence.config.json exists at root
- passes test "control — this repository's own lifecycle control is PRESENT"

## why

An agent should encounter the project's purpose and its ownership seams before source
detail. The project hook wiring also records which repository reads informed a change and
which decisions survived it. Keeping coordination separate from implementation makes that
first read small while still checking that every deeper entry point is reachable.

This spec once claimed five obvious files existed at root; three were pruned rather than
dressed up, because a root claim earns its line only when the failure it detects would
otherwise be SILENT. `package.json`, `README.md`, and `src/cli.ts` fail loudly on their
own — npm, the reader, and the CLI itself all scream within seconds of their absence —
so claiming them was green weight that could never turn red for an interesting reason
(the Known-limits section calls that spec "coherent and worthless"). The two claims
kept from that pruning are the ones whose absence the system absorbs without a sound:
`loadConfig`
falls back to defaults when `coherence.config.json` is missing (verify would silently
run with no test runner, no serial pin, and the wrong testMatch), and a missing lifecycle
control kills the journal hooks with no host error at all. The latter used to be the weak
structural claim `.claude/settings.json exists at root`; now the root claims the binary
control reading itself. Its oracle checks the three tracked parts—settings, stable
launcher, and root mapping—their exact composition, the absence of a competing local
path, and the runnable target. One meaningful claim is lighter and stronger than three
green file-existence claims. Fewer claims, honestly scoped, is still the trade this
harness teaches; making its own root spec take it is the least it owes.
