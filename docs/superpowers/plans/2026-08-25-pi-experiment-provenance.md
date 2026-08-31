# Pi Experiment Provenance Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the strict experiment reader accept valid persisted Pi-native telemetry without weakening fail-closed provenance validation.

**Architecture:** Export one host/transport relation predicate from `activity.ts`, where the lifecycle provenance types already live. Reuse it in activity rows, read-trace observations, and frozen experiment trace validation; remove the experiment activity projection's redundant stale enum checks because `isActivityRow` already validates the complete row.

**Tech Stack:** TypeScript, Node.js `node:test`, append-only JSONL ledgers.

**Spec:** `docs/superpowers/specs/2026-08-25-pi-experiment-provenance-design.md`

## Global Constraints

- Change no persisted schema, version, or bytes.
- Accept `pi/native`, `claude|codex/launcher`, and recognized-host/direct relations only.
- Continue refusing invalid host/transport pairings and all existing attribution, identity, timestamp, framing, and content-address damage.
- Add no dependency and perform no unrelated refactor.

---

### Task 1: Share provenance relation validation

**Files:**
- Modify: `src/activity.ts:95-110,261-267`
- Modify: `src/read-trace.ts:10-15,181-203`
- Modify: `src/experiment.ts:15-20,486-500,574-586`
- Test: `test/experiment.test.ts`

**Interfaces:**
- Produces: `isActivityHostTransport(host: unknown, transport: unknown): boolean` from `src/activity.ts`.
- Consumes: existing `ActivityHost`, `ActivityTransport`, `isActivityRow`, `recordActivity`, `recordHookReads`, `closeExperiment`, and `readExperiments` contracts.

- [ ] **Step 1: Write the failing persisted-ledger regression test**

Add a test beside the existing strict-read experiment contracts. Create an experiment owned by `owner-1`, record one trace and one activity event with this context:

```ts
const piContext = {
  host: "pi",
  transport: "native",
  bundleHash: "pi-bundle",
  experimentId: opened.id,
} as const;
```

Record the trace with:

```ts
recordHookReads(config, {
  session_id: "parent",
  agent_id: "owner-1",
  tool_name: "Read",
  tool_input: { file_path: "src/a.ts" },
}, T(2), piContext);
```

Record activity and close the experiment:

```ts
recordActivity(config, "PostToolUse", {
  session_id: "parent",
  agent_id: "owner-1",
  tool_name: "Bash",
  tool_use_id: "pi-verify",
  tool_input: { command: "npx coherence verify" },
  tool_response: { exit_code: 0 },
}, piContext, T(3));
closeExperiment(config, closing(opened.id));

const resolved = readExperiments(config).closed[0].closed!;
assert.equal(resolved.trace.events[0].observation?.host, "pi");
assert.equal(resolved.trace.events[0].observation?.transport, "native");
assert.equal(resolved.activity.rows[0].host, "pi");
assert.equal(resolved.activity.rows[0].transport, "native");
```

Then rewrite only the frozen trace observation to the invalid pair `pi/launcher`, recompute the close record's existing content address, and prove strict refusal:

```ts
const closePath = experimentSessionPath(config, "assessor-1");
const raw = JSON.parse((await readFile(closePath, "utf8")).trim()) as Record<string, any>;
raw.trace.events[0].observation.transport = "launcher";
const { id: _id, at: _at, ...identity } = raw;
raw.id = `x-${createHash("sha256").update(stableFixture(identity)).digest("hex").slice(0, 12)}`;
await writeFile(closePath, JSON.stringify(raw) + "\n");
assert.throws(() => readExperiments(config), /host\/transport relation is invalid/);
```

This proves the change admits the intended relation rather than disabling strict validation.

- [ ] **Step 2: Run the regression test to verify RED**

Run:

```bash
node --test --test-name-pattern="Pi native telemetry" test/experiment.test.ts
```

Expected: FAIL because the current experiment projection reports the Pi observation host as unrecognized and `native` transport as invalid.

- [ ] **Step 3: Implement the shared relation predicate**

In `src/activity.ts`, export:

```ts
export function isActivityHostTransport(host: unknown, transport: unknown): boolean {
  return (host === "pi" && transport === "native")
    || ((host === "claude" || host === "codex") && transport === "launcher")
    || (HOSTS.has(String(host)) && transport === "direct");
}
```

Replace `isActivityRow`'s separate host, transport, native, and launcher conditions with `!isActivityHostTransport(row.host, row.transport)`.

Import and use the predicate in `src/read-trace.ts`'s `validObservation`, replacing its duplicated host/transport checks while retaining all attribution and nullable-field validation.

Import and use it in `src/experiment.ts`'s trace observation validation. Emit one path-specific problem when the relation is invalid. Remove the experiment activity projection's separate stale host/transport checks because its preceding `isActivityRow(validationRow, session)` call already validates the complete relation.

- [ ] **Step 4: Run focused GREEN verification**

Run:

```bash
node --test test/experiment.test.ts test/activity.test.ts
npm run typecheck
```

Expected: both test files pass with zero failures and TypeScript reports no errors.

- [ ] **Step 5: Build and reproduce the installed status path**

Run:

```bash
npm run build
coherence hooks status --host pi
```

Expected: the existing persisted Pi-native experiment ledger no longer reports `experiment: UNAVAILABLE`; structural Pi control remains PRESENT.

- [ ] **Step 6: Run the full regression suite**

Run:

```bash
npm test
```

Expected: all tests pass with zero failures.

- [ ] **Step 7: Commit and update the PR branch**

Run:

```bash
git add src/activity.ts src/read-trace.ts src/experiment.ts test/experiment.test.ts
git commit -m "fix: accept Pi native experiment evidence"
git push
```

Confirm `git status --short --branch` is clean and PR #1 contains the new commit.
