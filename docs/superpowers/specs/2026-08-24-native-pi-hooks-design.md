# Native Pi lifecycle hooks design

**Date:** 2026-08-24
**Status:** Approved for implementation planning

## Purpose

Coherence currently implements one five-event lifecycle domain through Claude and Codex host controls. Add a native integration for `@earendil-works/pi-coding-agent` so a project can install, inspect, and use that lifecycle through Pi's extension API without shelling out after every event.

The integration must remain useful when `pi-subagents` is absent. When `pi-subagents` is present, each child Pi process gets the same attributable startup and completion behavior as the existing `SubagentStart` and `SubagentStop` surfaces.

## Goals

- Add `pi` as an explicit host accepted by `coherence hooks install|uninstall|print|status|review|--check`.
- Add explicit `coherence regulate --host pi` evaluation and repair while preserving existing default host selection.
- Install the native extension automatically with `coherence hooks install --host pi`.
- Preserve coherence's startup instructions, work assignment injection, activity telemetry, path tracing, calibration, and child completion report.
- Give a Pi child exactly one coherence-triggered final-report turn, never a feedback loop.
- Keep `pi-subagents` optional and avoid importing it.
- Make the package directly discoverable as a Pi package.
- Preserve all unrelated Pi, Claude, and Codex configuration.

## Non-goals

- Register new model-callable tools or slash commands; the existing coherence CLI remains the operating interface.
- Depend on `pi-subagents` or inspect its private run artifacts.
- Make a repository check authoritative over user-global Pi settings.
- Rebuild Claude/Codex controls around a new generalized host framework.
- Run a coherence subprocess for each Pi event.

## Architecture

Use a dedicated Pi adapter rather than forcing Pi into Claude/Codex's launcher-shaped control types.

### Pi extension entrypoint

Add a compiled extension entrypoint, expected at `dist/pi-extension.js`, and declare it in `package.json`:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./dist/pi-extension.js"]
  }
}
```

The extension uses only the public `@earendil-works/pi-coding-agent` extension API. Pi's package is a peer/development contract; `pi-subagents` is neither a dependency nor a peer dependency.

The extension stays dormant when it cannot resolve a declared coherence root containing `coherence.config.json`. This makes a user-global installation harmless in unrelated projects.

### Pi control module

Add a Pi-specific control module for project settings, root mapping, target resolution, installation, inspection, and bundle identity. Existing Claude/Codex control remains in `src/control.ts`; the hooks CLI and regulation sensor dispatch `host === "pi"` to the native control.

This separation is intentional: Pi loads a package extension and has no stable shell launcher or host hook JSON bundle. Its inspection type must describe the native package entry rather than pretending that entry is a launcher.

### Shared lifecycle seams

Extract only the reusable operations currently embedded in `runHook`:

- open or refresh an attributable session and compose startup instructions;
- record activity and explicit read/write paths;
- record main-agent calibration;
- compose child journal/change feedback.

Claude/Codex continue to call these operations through `runHook` and retain their current JSON output envelopes. Pi calls them in-process.

## Installation and structural control

`coherence hooks install --host pi` runs from the coherence root and resolves:

1. the Pi project root: `piProjectRoot` relative to the coherence root, defaulting to `.`;
2. the runnable package root:
   - the repository root while coherence dogfoods its source checkout;
   - `node_modules/@danilocampos/coherence` in a consuming project;
3. the compiled extension target declared by the package manifest.

It then converges two tracked project artifacts:

- `<piProjectRoot>/.pi/settings.json`
- `<piProjectRoot>/.pi/coherence-root`

The settings file receives one relative local-package entry under `packages`. The mapping file contains the relative path from the Pi project root to the coherence root. The installer removes only recognized competing coherence package/extension entries in that project file and preserves every unrelated setting and package.

Structural presence requires:

- valid project `.pi/settings.json`;
- exactly one canonical coherence package entry and no recognized competing project entry;
- an exact root mapping;
- a present compiled extension target;
- agreement between the package manifest and that target.

Malformed settings refuse installation and checking. `uninstall` removes recognized project entries and removes `.pi/coherence-root` only when its bytes still match the expected mapping. Drifted operator-owned bytes survive.

A project check does not claim authority over `~/.pi/agent/settings.json`. At runtime, if both global and project copies load, the copy named by the canonical project entry activates and the other copy remains inert. Without project control, one global copy may activate for a declared single-root coherence project.

## Lifecycle mapping

| Pi extension event | Coherence lifecycle meaning | Behavior |
|---|---|---|
| `session_start` | `SessionStart` or child `SubagentStart` | Resolve root and exact Pi session; open/refresh journal session; record native activation. |
| `before_agent_start` | startup instruction injection | Append the current canonical/project-composed journal and exact-work instructions to the system prompt. |
| `tool_result` | `PostToolUse` | Record native activity, verification/regulation results where structurally available, and explicit file reads/writes. Never modify the tool result. |
| `agent_settled` in a main process | main `Stop` | Record calibration with no model-visible feedback. |
| first `agent_settled` with `PI_SUBAGENT_CHILD=1` | `SubagentStop` | Snapshot child calibration, compose journal/change feedback, and trigger one final model turn. |
| second child `agent_settled` | stop-loop guard | Emit nothing and allow the child process to finish. |

`before_agent_start` uses a transient system-prompt append rather than adding a durable session message. This avoids duplicate startup entries after resume/reload while ensuring current work state is refreshed at each agent run.

The extension obtains the exact session from `ctx.sessionManager.getSessionId()`. A missing ID is replaced by one extension-local minted ID for the lifetime of that runtime. Child agent labels come from `PI_SUBAGENT_CHILD_AGENT` when present; otherwise the label is `main` for a root process and `subagent` for a child. `PI_SUBAGENT_RUN_ID` may be recorded as the child job identity but never replaces the Pi session ID.

## Optional `pi-subagents` behavior

No source file imports `pi-subagents`. Child behavior is activated only by the environment contract supplied to child Pi processes:

- `PI_SUBAGENT_CHILD=1`
- optional `PI_SUBAGENT_CHILD_AGENT`
- optional `PI_SUBAGENT_RUN_ID`

On extension registration, the extension emits `subagent:acknowledge-extension` with a stable valid ID through `pi.events`. With `pi-subagents`, this becomes best-effort runtime observability. Without a listener, the event is inert.

At the first child settlement, the extension sends a model-visible custom message containing the existing child journal count, repository damage warning, final-report restatement, open-conjecture reminder, and change signal. It uses `deliverAs: "followUp"` with `triggerTurn: true`. An in-memory guard is set before sending. The resulting second settlement cannot trigger another message.

## Telemetry and identity

Extend transient telemetry vocabulary with:

- activity host `pi`;
- activity transport `native`.

Do not label native delivery as `launcher`. A Pi bundle fingerprint covers the Pi control protocol, package-entry shape, mapping contract, and extension lifecycle meaning. Session-scoped status accepts only native Pi rows with the current fingerprint as activation evidence. Direct probes, stale fingerprints, and other sessions remain non-authoritative.

The Pi `tool_result` adapter converts public event fields into coherence's existing payload vocabulary. Built-in lower-case Pi tool names map to the path-trace operations coherence already recognizes. Bash exit status is admitted only when Pi's structured result details contain an explicit integer; model-facing text is never parsed as execution evidence.

## Failure behavior

- A missing `coherence.config.json` makes an unowned/global extension instance dormant.
- A declared project mapping that is missing, unreadable, escaping unexpectedly, or points at invalid configuration produces a named unavailable warning and no authoritative activation claim.
- Startup journal/work damage degrades to the same named control messages used by existing hosts and does not kill Pi.
- Activity and path-trace write failures are contained so a successful tool call stays successful.
- Child signal analysis failure produces `CHANGE SIGNAL unavailable: ...`; the child still gets its one final-report turn.
- Extension exceptions never block or alter tool results.
- Installer/checker ambiguity fails explicitly instead of choosing a package entry.

## CLI and documentation

The existing hooks command accepts `--host pi` for `install`, `uninstall`, `print`, `status`, `review`, and `--check`. `regulate --host pi` reads the same structural/native activation control and repairs it with `hooks install --host pi`. Bare `hooks` and the existing regulation default remain Claude-compatible; ambient Pi variables do not silently change the selected host.

README installation examples add:

```sh
npx coherence hooks install --host pi
npx coherence hooks --check --host pi
```

Documentation also covers `piProjectRoot`, the two committed control files, exact-session activation through `PI_SESSION_ID`, dormant global behavior, optional child parity, and the one-extra-turn contract.

## Testing

Implementation follows TDD. Behavioral tests must cover:

### Control

- exact installation, idempotence, and preservation of unrelated Pi settings;
- nested Pi/coherence roots;
- malformed settings, duplicate/competing coherence entries, missing targets, and drift;
- ownership-safe uninstall;
- structural versus exact-session activation;
- project-copy preference when a global copy is also present;
- regulation observes and repairs Pi rather than consulting Claude or Codex control.

### Extension lifecycle

Use an in-process fake of the public Pi extension API to register and invoke handlers:

- startup injects current instructions for the exact session;
- main settlement records calibration and sends no feedback;
- first child settlement sends exactly one final-report message;
- second child settlement sends none;
- the same behavior runs without `pi-subagents` installed;
- tool results produce attributable native activity and explicit path traces;
- an explicit Bash exit code is classified while output prose is not;
- telemetry and signal failures do not alter successful tool results or loop child completion.

### Packaging and regression

Run:

- focused Pi control/extension tests;
- `npm run typecheck`;
- full `npm test`;
- `npm run build`;
- package-content inspection proving the compiled extension and manifest ship together;
- `npx coherence verify`.

The authored package spec gains a boundary invariant asserting that native Pi events preserve the same lifecycle meanings without requiring `pi-subagents`. Its oracle must exercise the live event mapping rather than assert source strings or exported symbols.

## Compatibility

- Existing Claude and Codex settings, fingerprints, output envelopes, and default host selection remain unchanged except for shared helper extraction.
- Pi becomes available only through an explicit `--host pi`; ambient Pi markers do not change existing defaults.
- Existing consumers that never select `--host pi` see no new control files.
- Pi users can install project-local control without a second package copy.
- Direct `pi install` remains possible through the package manifest, but the coherence installer is the canonical path because it also establishes the checked root mapping.
