# Protected primary checkout write policy design

**Date:** 2026-08-28
**Status:** Approved for implementation planning

## Purpose

A repository may reserve its primary Git checkout as a clean, sync-only copy and require all authored work to happen in linked worktrees. Coherence currently cannot enforce that boundary. Its lifecycle integrations write session, activity, trace, and calibration records as soon as an agent starts or settles, before the agent can follow repository instructions telling it not to write there.

The observed failure occurred with Ariadne opened in its primary checkout. A user-global native Pi extension resolved that declared Coherence root, wrote a `(session opened)` decision on `session_start`, recreated the record on a later `before_agent_start`, and wrote calibration on `agent_settled`. Deleting the accidental files could not keep the checkout clean because the next lifecycle event recreated them. Claude and Codex share the same lifecycle operations and therefore carry the same failure class.

Add an opt-in, host-neutral policy that makes Coherence read-only in Git's primary checkout while retaining lifecycle guidance and read-only inspection. Explicit write attempts must refuse before mutation; automatic lifecycle persistence must become a named, non-fatal no-op.

## Goals

- Let a project declare its primary Git checkout protected from every Coherence write.
- Apply the same policy to CLI, Claude, Codex, and native Pi entrypoints.
- Determine protection from Git worktree identity, never a branch name.
- Keep read-only commands and lifecycle guidance available in a protected checkout.
- Refuse explicit mutation before any partial write.
- Make suppressed lifecycle persistence visible in startup instructions without breaking the host.
- Preserve existing behavior unless the project opts in.
- Make the CLI operation-effect classification total so a new command cannot silently bypass protection.

## Non-goals

- Redirect records to a cache, home directory, primary checkout, or guessed feature worktree.
- Infer an agent's intended worktree from shell command text, changed files, branch names, or another process.
- Move an already-running host session between roots.
- Change Git worktree creation or ownership.
- Protect a repository from non-Coherence tools or direct filesystem writes.
- Change journal, work, experiment, defect, consequence, verification, or calibration formats.
- Add an environment-variable override or product feature flag.

## Configuration

Add one optional project setting:

```json
{
  "protectPrimaryCheckout": true
}
```

`protectPrimaryCheckout` defaults to `false`. An absent or false value preserves current behavior. The setting is repository policy, so environment variables and host-global settings cannot disable it.

Protection is evaluated for the loaded `Config.root`. A nested Coherence root belongs to the Git worktree containing it; `claudeProjectRoot`, `codexProjectRoot`, and `piProjectRoot` do not change that ownership decision.

## Git checkout identity

Introduce one read-only checkout classifier with three outcomes:

- `primary`: the Git top-level containing `Config.root` is Git's primary worktree;
- `linked`: it is another worktree registered for the same repository;
- `unknown`: Git cannot prove either relation.

The classifier asks Git for the current top-level and parses `git worktree list --porcelain`. Git lists the primary worktree first. After canonical path normalization:

- equality with the first `worktree` entry yields `primary`;
- equality with a later registered entry yields `linked`;
- a failed command, malformed output, missing current entry, bare repository, or containment disagreement yields `unknown`.

This uses Git's own worktree registry rather than `.git` file shape. It therefore does not mistake submodules for linked worktrees and does not assume that the protected checkout is on `main`.

When protection is enabled, writes are authorized only for `linked`. Both `primary` and `unknown` refuse. Failing closed on `unknown` prevents an unavailable instrument from becoming permission.

## Shared write policy

Expose one policy result consumed by every supported entrypoint:

```text
protection disabled                  -> writable
protection enabled + linked          -> writable
protection enabled + primary         -> protected-primary
protection enabled + unknown         -> unprovable
```

The policy is computed before a write-capable operation enters any ledger, generator, control installer, telemetry recorder, or status writer. Existing low-level writers remain unchanged; authorization belongs at the supported CLI and lifecycle boundaries rather than being duplicated across every storage module.

This contract covers Coherence's supported mutation surfaces. Direct imports of internal storage functions are not a public bypass contract and do not acquire a second authorization system.

## CLI operation effects

Add a total invocation classifier with two effects:

- `read`: the exact command and options cannot write repository or project-control state;
- `write`: the invocation may write, even if its data-dependent execution would happen to produce no change.

Classification occurs after normal command parsing has identified the invocation but before its implementation runs. Commands with mixed modes classify by their full invocation: for example, journal inspection is read-only while compaction writes; hook status/review/check are read-only while install/uninstall write. Verification, generated documentation, baselines, status receipts, advisory raising, and every ledger mutation are writes.

The live command catalog and effect classifier must agree exhaustively. A recognized command or mode without an effect is an internal refusal, not an implicit read. A test derives the supported invocation domain from the command catalog and proves every member has an effect. Adding a command therefore requires choosing its effect in the same patch.

In a protected or unprovable checkout, a `write` invocation exits nonzero before calling its implementation. The error names:

- the attempted operation;
- whether the checkout is protected-primary or unprovable;
- the resolved Git top-level when available; and
- the remediation: run from a registered linked worktree.

There is no force flag, environment override, fallback location, or branch exception. Read-only invocations continue normally.

## Lifecycle behavior

Claude, Codex, and Pi consult the same write policy before recording lifecycle activity or calling a shared operation that may persist evidence.

### Startup

Startup instruction composition must no longer require a newly written session header. Separate identity-based rendering from optional session persistence:

1. retain the exact host session, agent, job, host, transport, and bundle identity in memory;
2. when writable, preserve current session opening and activation evidence;
3. when protected, skip session and activity writes;
4. render journal, due-work, project-voice, and exact-assignment instructions from the host identity;
5. append a named persistence notice.

The notice states that `protectPrimaryCheckout` is active for Git's primary checkout, no Coherence evidence will be recorded there, read-only lifecycle guidance remains active, and a linked worktree is required for writes. An unprovable checkout receives the same guidance with the inability to establish safe checkout identity named explicitly.

Pi may refresh this transient instruction on each `before_agent_start`; it remains a system-prompt append rather than a durable session message. Claude and Codex retain their existing startup output envelopes.

### Tool results

In protected mode, `PostToolUse` and Pi `tool_result` persistence are silent no-ops:

- no lifecycle activity;
- no read/write traces;
- no verification or regulation result receipt; and
- no modification of the host's tool result.

The startup notice is the user-visible explanation. High-frequency tool hooks do not repeat it.

### Settlement

In protected mode:

- main settlement emits no bytes and writes no calibration or activity;
- child settlement writes no calibration or activity;
- child settlement may still read the exact-session journal and current change signal and deliver its existing one-shot final-report turn;
- the child loop guard remains unchanged.

The child report is read-only and must not manufacture a session merely to report zero records.

### Activation evidence

Structural lifecycle-control status remains readable. Current-session activation still requires durable exact-bundle activity evidence; protected execution does not fabricate that evidence. Status may therefore report structurally present control without observed current-session activation. The startup persistence notice explains why.

## Failure behavior

Explicit CLI mutation fails loudly and nonzero before any mutation. Lifecycle hooks cannot fail an agent turn merely because persistence is protected or checkout identity is unprovable; they continue read-only and inject the startup notice.

Existing degradation rules remain:

- damaged journal/work evidence is named rather than treated as empty;
- telemetry failures never alter a successful tool result;
- child signal failure remains `CHANGE SIGNAL unavailable`;
- malformed host control still fails structural checking;
- an inactive or unowned extension remains dormant.

Protection does not clean, migrate, or delete pre-existing records. Operators decide whether accidental files are durable and move or remove them explicitly.

## Seams

| Boundary | Value or contract | Supplier | Consumer | Integration evidence |
|---|---|---|---|---|
| Project config → write policy | `protectPrimaryCheckout: boolean`, default false | config loader | shared policy | config/default tests |
| Git → checkout classifier | primary, linked, or unknown | `git worktree list --porcelain` plus current top-level | shared policy | real temporary repository/worktree tests |
| CLI invocation → authorization | total `read` or `write` effect | command parser/catalog | CLI dispatch gate | catalog-totality and process-level CLI tests |
| Host adapter → lifecycle authorization | writable, protected-primary, or unprovable | shared policy | Claude/Codex hook body and Pi extension | shared lifecycle plus host-adapter tests |
| Lifecycle identity → startup rendering | exact identity without mandatory session record | host adapter | instruction/work/project-voice composition | startup tests with absent decision directory |
| Protected lifecycle → filesystem | zero persisted lifecycle artifacts | lifecycle gate | decision, activity, trace, calibration, and status stores | before/after filesystem assertions for every host |

No storage schema or serialization seam changes.

## Testing

Implementation follows TDD.

### Checkout policy

Use real temporary Git repositories rather than mocking command strings:

- protection disabled in a primary checkout remains writable;
- protection enabled classifies the first registered worktree as primary;
- a linked worktree is writable regardless of branch name;
- a submodule is not mistaken for a linked worktree;
- non-Git, bare, malformed, missing, and containment-disagreeing readings are unknown and refuse writes;
- path normalization does not let equivalent paths disagree.

### CLI

Process-level tests prove:

- a protected-primary ledger mutation exits nonzero and leaves the complete tree byte-identical;
- a command that would generate output or status also refuses before creating directories;
- representative read-only journal, work, hook-status, and orientation commands still run;
- mixed commands classify their read and write modes correctly;
- the same mutations succeed in a registered linked worktree;
- an unprovable checkout refuses with its distinct explanation;
- every supported command/mode has an explicit effect classification.

The byte-identical assertion includes project-control paths outside `.coherence`, such as configured host roots and generated output directories.

### Lifecycle parity

Exercise the shared lifecycle functions and each host adapter:

- protected startup emits exact-session instructions and the persistence notice without creating a session or activity file;
- protected tool events create no activity, trace, status, or result receipt and do not alter tool output;
- protected main settlement remains byte-silent and creates no calibration;
- protected child settlement remains one-shot and read-only;
- Claude, Codex, and Pi exhibit the same persistence decision through their host-specific envelopes;
- writable primary behavior with protection disabled remains unchanged;
- writable linked-worktree behavior preserves session, activity, trace, and calibration evidence;
- journal damage still degrades by name in protected mode.

### Project contract and validation

Update the authored harness invariant from mere native-host parity to require lifecycle persistence to respect the project's checkout write policy across every supported host. Its oracle must execute real lifecycle entrypoints and inspect resulting files; source-text or symbol-existence assertions are insufficient.

Run focused config, CLI, hook, Pi-extension, and control tests, then:

```sh
npm run typecheck
npm test
npm run build
npx coherence verify
```

## Documentation

Document:

- the opt-in field and default;
- the exact definition of Git's primary checkout;
- that read-only lifecycle guidance remains active;
- that explicit writes require a registered linked worktree;
- that protected execution intentionally cannot produce current-session activation evidence;
- that no environment or force override exists; and
- that existing accidental records are not automatically migrated or deleted.

## Compatibility and rollout

This is additive and opt-in. Existing projects, including projects that intentionally work in their primary checkout, retain current behavior. Claude, Codex, and Pi settings, fingerprints, envelopes, and storage formats remain unchanged.

A project adopts protection by committing `"protectPrimaryCheckout": true` from a linked worktree. Once that commit is present, Coherence mutations invoked in the primary checkout refuse immediately while the same commands continue in registered linked worktrees.

The implementation targets the local fork branch containing native Pi lifecycle support. Upstream publication or compatibility with a release that lacks that support is outside this change.
