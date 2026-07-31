# Coherence

The repository-level reading surface: configuration, package contract, generated maps,
and the authored explanation of why the harness exists.

Implementation belongs to the nested source and test components. This root component
keeps only the files that establish how those components are built, read, and released.

## works when

- coherence.config.json exists at root
- .claude/settings.json exists at root
- package.json exists at root
- README.md exists at root
- src/cli.ts exists at root

## why

An agent should encounter the project's purpose and its ownership seams before source
detail. The project hook wiring also records which repository reads informed a change and
which decisions survived it. Keeping coordination separate from implementation makes that
first read small while still checking that every deeper entry point is reachable.
