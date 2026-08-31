# Protected Primary Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in policy that refuses every explicit Coherence mutation and suppresses automatic lifecycle persistence in Git's primary checkout while preserving read-only CLI and lifecycle behavior.

**Architecture:** A lightweight `write-policy.ts` classifies the current Git checkout and returns one shared authorization result. The command registry classifies every full CLI invocation as read or write; explicit writes fail at CLI dispatch, while Claude, Codex, and Pi consume the same policy to degrade lifecycle events to read-only behavior with a named startup notice.

**Tech Stack:** TypeScript, Node.js 22 built-ins, Git porcelain commands, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-28-protected-primary-checkout-design.md`

## Global Constraints

- `protectPrimaryCheckout` is opt-in and defaults to `false`.
- Git worktree identity, not branch name, decides whether the checkout is primary or linked.
- With protection enabled, only a registered linked worktree may write; primary and unprovable identities refuse.
- Explicit CLI mutations fail nonzero before mutation; lifecycle persistence becomes a non-fatal no-op with a startup notice.
- Read-only CLI and lifecycle instruction composition remain available.
- Claude, Codex, and Pi use the same policy.
- Do not redirect state, add a force flag, add an environment override, change storage schemas, or infer intent from shell commands.
- Preserve the high-frequency hook's dependency-light import closure: the policy module may import only Node built-ins and project types.
- Tests must assert observable files and process behavior, not source strings or symbol existence.

---

### Task 1: Checkout identity and shared write policy

**Files:**
- Create: `src/write-policy.ts`
- Create: `test/write-policy.test.ts`
- Modify: `src/types.ts:55-125`
- Modify: `src/config.ts:5-17`

**Interfaces:**
- Produces: `CheckoutIdentity = { kind: "primary" | "linked" | "unknown"; topLevel: string | null; reason?: string }`.
- Produces: `ProjectWritePolicy = { state: "disabled" | "linked" | "protected-primary" | "unprovable"; writable: boolean; identity: CheckoutIdentity }`.
- Produces: `classifyGitCheckout(root: string, runGit?: GitRunner): CheckoutIdentity`; the optional runner exists only for deterministic malformed-output tests.
- Produces: `projectWritePolicy(cfg: Pick<Config, "root" | "protectPrimaryCheckout">): ProjectWritePolicy`.
- Produces: `writeRefusal(policy: ProjectWritePolicy, operation: string): string[] | null` and `lifecyclePersistenceNotice(policy: ProjectWritePolicy): string | null`.
- Consumes: `Config.root` and the new optional `Config.protectPrimaryCheckout`.

- [ ] **Step 1: Install dependencies and verify the inherited policy-related tests are green**

Run:

```bash
cd /home/kthorn/coherence/.worktrees/protected-primary-checkout
npm ci
node --test test/control.test.ts test/hook-stop.test.ts test/pi-extension.test.ts
```

Expected: all selected tests pass before the new policy exists.

- [ ] **Step 2: Write failing real-Git checkout-classification tests**

Create `test/write-policy.test.ts`. Build a temporary repository with an initial commit and a real linked worktree; do not mock Git output for the primary/linked cases.

Core cases:

```ts
test("write policy protects Git's primary checkout and permits its linked worktree", async () => {
  const primary = await gitRepository({ protectPrimaryCheckout: true });
  const linked = join(dirname(primary), "linked");
  git(primary, "worktree", "add", "-b", "feature", linked);

  assert.deepEqual(projectWritePolicy(cfg(primary, { protectPrimaryCheckout: true })).state, "protected-primary");
  assert.deepEqual(projectWritePolicy(cfg(linked, { protectPrimaryCheckout: true })).state, "linked");
});

test("write policy keeps existing projects writable by default", async () => {
  const primary = await gitRepository({ protectPrimaryCheckout: false });
  assert.equal(projectWritePolicy(cfg(primary)).state, "disabled");
  assert.equal(projectWritePolicy(cfg(primary)).writable, true);
});

test("write policy refuses when protected checkout identity is unprovable", async () => {
  const root = await tmpProject();
  const policy = projectWritePolicy(cfg(root, { protectPrimaryCheckout: true }));
  assert.equal(policy.state, "unprovable");
  assert.equal(policy.writable, false);
  assert.match(writeRefusal(policy, "decision append")!.join("\n"), /registered linked worktree/);
});
```

Also cover canonical path equivalence, a config root nested beneath the Git top-level, malformed/missing worktree-list identity through a narrow injected Git runner, and a real submodule fixture that classifies as its own primary checkout rather than linked.

- [ ] **Step 3: Run the new tests and verify the missing module/config field fails**

Run:

```bash
node --test test/write-policy.test.ts
```

Expected: FAIL because `src/write-policy.ts` and `Config.protectPrimaryCheckout` do not exist.

- [ ] **Step 4: Add the config field and minimal checkout classifier**

Add to `Config`:

```ts
protectPrimaryCheckout?: boolean; // opt-in: Coherence writes require a registered linked worktree
```

Add `protectPrimaryCheckout: false` to `DEFAULTS` so the loaded configuration has an explicit default.

Implement `src/write-policy.ts` with only `node:child_process`, `node:fs`, `node:path`, and a type-only `Config` import. Use:

```ts
export type CheckoutKind = "primary" | "linked" | "unknown";
export interface CheckoutIdentity {
  kind: CheckoutKind;
  topLevel: string | null;
  reason?: string;
}
export type WritePolicyState = "disabled" | "linked" | "protected-primary" | "unprovable";
export interface ProjectWritePolicy {
  state: WritePolicyState;
  writable: boolean;
  identity: CheckoutIdentity;
}
```

The production runner executes:

```bash
git rev-parse --show-toplevel
git worktree list --porcelain -z
```

Parse every NUL-delimited field beginning with `worktree `. Canonicalize the current top-level and registered worktree paths with `realpathSync`. The first worktree is primary. Return `unknown` when Git fails, the root escapes the reported top-level, no worktrees are listed, or the current top-level is absent from the registry.

Policy mapping must short-circuit when disabled so existing projects pay no Git subprocess cost:

```ts
if (!cfg.protectPrimaryCheckout) {
  return {
    state: "disabled", writable: true,
    identity: { kind: "unknown", topLevel: null, reason: "protection disabled" },
  };
}
const identity = classifyGitCheckout(cfg.root);
if (identity.kind === "linked") return { state: "linked", writable: true, identity };
if (identity.kind === "primary") return { state: "protected-primary", writable: false, identity };
return { state: "unprovable", writable: false, identity };
```

`writeRefusal` returns `null` when writable. Otherwise it returns concise stderr lines naming the operation, state/top-level, and `Run from a registered linked worktree.`

`lifecyclePersistenceNotice` returns `null` when writable. Otherwise return one paragraph beginning `COHERENCE PERSISTENCE unavailable:` and state that read-only guidance remains active and no evidence will be recorded in this checkout.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
node --test test/write-policy.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit the policy foundation**

```bash
git add src/write-policy.ts src/types.ts src/config.ts test/write-policy.test.ts
git commit -m "feat: classify protected primary checkouts"
```

---

### Task 2: Total CLI effect classification and explicit mutation refusal

**Files:**
- Modify: `src/commands.ts:56-310`
- Modify: `src/cli.ts:10-165,300-317`
- Modify: `test/commands.test.ts:1-150`
- Create: `test/write-policy-cli.test.ts`

**Interfaces:**
- Consumes: `projectWritePolicy` and `writeRefusal` from Task 1.
- Produces: `CommandEffect = "read" | "write"`.
- Produces: mandatory `Command.effect: CommandEffect | ((argv: readonly string[]) => CommandEffect)`.
- Produces: `commandEffect(token: string | undefined, argv: readonly string[]): CommandEffect | null`.
- Leaves `coherence hook` authorization to the lifecycle gate in Task 3 so protected startup can still emit read-only instructions.

- [ ] **Step 1: Write failing command-effect totality tests**

Extend `test/commands.test.ts`:

```ts
test("every command and alias has a total invocation effect", () => {
  for (const token of dispatchTokens()) {
    assert.ok(commandEffect(token, []) === "read" || commandEffect(token, []) === "write", token);
  }
  assert.equal(commandEffect("not-a-command", []), null);
});

test("mixed commands classify their mutating modes", () => {
  assert.equal(commandEffect("decisions", []), "read");
  assert.equal(commandEffect("decisions", ["--compact"]), "write");
  assert.equal(commandEffect("work", ["inspect"]), "read");
  assert.equal(commandEffect("work", ["create", "objective"]), "write");
  assert.equal(commandEffect("hooks", ["status"]), "read");
  assert.equal(commandEffect("hooks", ["install"]), "write");
  assert.equal(commandEffect("atlas", ["--check"]), "read");
  assert.equal(commandEffect("atlas", ["--check", "--raise"]), "write");
});
```

- [ ] **Step 2: Write failing process-level protected CLI tests**

Create `test/write-policy-cli.test.ts` with a committed primary fixture containing `"protectPrimaryCheckout": true` and a linked worktree.

Assert:

```ts
const rejected = await run(primary, ["decide", "choice", "--because", "evidence", "--session", "s"]);
assert.equal(rejected.code, 2);
assert.match(rejected.stderr, /protected primary checkout/);
assert.equal(existsSync(join(primary, ".coherence", "decisions")), false);

const read = await run(primary, ["decisions"]);
assert.equal(read.code, 0, read.stderr);

const install = await run(primary, ["hooks", "install"]);
assert.equal(install.code, 2);
assert.equal(existsSync(join(primary, ".claude")), false);

const accepted = await run(linked, ["decide", "choice", "--because", "evidence", "--session", "s"]);
assert.equal(accepted.code, 0, accepted.stderr);
assert.equal(existsSync(join(linked, ".coherence", "decisions", "s.jsonl")), true);
```

Also prove a potentially mutating generator (`graph` without `--check`) refuses before creating `public/`, while `graph --check` reaches its normal read-only result.

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```bash
node --test test/commands.test.ts test/write-policy-cli.test.ts
```

Expected: FAIL because effects and the CLI gate are absent.

- [ ] **Step 4: Add mandatory command effects to the registry**

Add:

```ts
export type CommandEffect = "read" | "write";
type CommandEffectRule = CommandEffect | ((argv: readonly string[]) => CommandEffect);

export interface Command {
  // existing fields
  effect: CommandEffectRule;
}

export function commandEffect(token: string | undefined, argv: readonly string[]): CommandEffect | null {
  const command = commandFor(token);
  if (!command) return null;
  return typeof command.effect === "function" ? command.effect(argv) : command.effect;
}
```

Declare these exact effects:

| Commands | Effect |
|---|---|
| `graph`, `overview`, `docs`, `claude` | write unless `--check` |
| `verify` | write |
| `log`, `regulate` | read |
| `signal` | write only with `--attest-no-invariant` |
| `decide`, `blocked`, `defect`, `conjecture`, `observed`, `resolved`, `dismiss`, `retract` | write |
| `defects`, `journal`, `orient`, `decompose`, `drift`, `context`, `contracts`, `premise`, `why-lint`, `doctrine`, `phrasebook` | read |
| `decisions` | write only with `--compact` |
| `experiment`/`plan` | read only when action is absent/`inspect`; otherwise write |
| `work` | read only when action is absent/`inspect`/`status`; otherwise write |
| `consequence` | write only for `add` |
| `hooks` | write only for `install` or `uninstall`; `--check` is read |
| `hook` | write; Task 3 handles its lifecycle-specific read-only degradation |
| `scaffold`, `index`, `contract` | write |
| `lint-sinks`, `conventions` | write only with `--update-baseline` |
| `mass` | write with `--update-baseline` or `--raise` |
| `atlas` | write without `--check`, or whenever `--raise` is present |
| `panel` | read only with `--once`; interactive mode is potentially write-capable |
| `redundancy`, `prose`, `economy` | write only with `--raise` |
| `calibrate` | write only with `--outcome` |

Functions should inspect only the supplied argument array; do not duplicate CLI value parsing.

- [ ] **Step 5: Gate explicit CLI mutation before artifact floors or dispatch**

Immediately after loading `cfg`, before the `writesArtifacts` floor and command dispatch:

```ts
const effect = commandEffect(cmd, argv);
if (effect === "write" && cmd !== "hook") {
  const refusal = writeRefusal(projectWritePolicy(cfg), `coherence ${cmd}`);
  if (refusal) {
    for (const line of refusal) console.error(line);
    await exit(2);
  }
}
```

Unknown commands retain the existing usage path. `hook` is intentionally delegated to Task 3 because throwing here would prevent protected SessionStart from returning its read-only instructions.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
node --test test/commands.test.ts test/write-policy-cli.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 7: Commit CLI enforcement**

```bash
git add src/commands.ts src/cli.ts test/commands.test.ts test/write-policy-cli.test.ts
git commit -m "feat: refuse CLI writes in protected checkouts"
```

---

### Task 3: Shared Claude and Codex lifecycle degradation

**Files:**
- Modify: `src/hooks.ts:20-330`
- Modify: `test/hook-stop.test.ts:1-140,240-330`
- Modify: `test/hooks-cli.test.ts:130-190`

**Interfaces:**
- Consumes: `ProjectWritePolicy`, `projectWritePolicy`, and `lifecyclePersistenceNotice` from Task 1.
- Changes: `prepareSessionStart(cfg, event, identity, policy)` requires a policy and can render without opening a session.
- Changes: `recordLifecycleToolResult(cfg, payload, context, policy)`, `recordMainSettlement(cfg, session, policy)`, and `prepareChildSettlement(cfg, session, policy)` require the same policy.
- Produces: external `runHook` computes one policy per lifecycle process and passes it through every persistence-capable shared operation.

- [ ] **Step 1: Write failing protected Claude/Codex lifecycle tests**

Add a real committed primary fixture with `protectPrimaryCheckout: true`. For both external hosts (`claude`, `codex`), spawn `src/hook-cli.ts` and assert:

```ts
const started = hook(root, "SessionStart", { session_id: `${host}-session` }, host);
assert.equal(started.status, 0, started.stderr);
assert.match(started.stdout, /COHERENCE PERSISTENCE unavailable/);
assert.match(started.stdout, /registered linked worktree/);
assert.equal(existsSync(join(root, ".coherence")), false);

const tool = hook(root, "PostToolUse", {
  session_id: `${host}-session`, tool_name: "Read", tool_input: { file_path: "package.json" },
}, host);
assert.equal(tool.status, 0, tool.stderr);
assert.equal(tool.stdout, "");
assert.equal(existsSync(join(root, ".coherence")), false);

const settled = hook(root, "Stop", { session_id: `${host}-session` }, host);
assert.equal(settled.status, 0, settled.stderr);
assert.equal(settled.stdout, "");
assert.equal(existsSync(join(root, ".coherence", "calibration")), false);
```

Add a child case proving `SubagentStop` still returns one read-only report but creates no session/calibration record. Keep existing unprotected lifecycle tests unchanged as regression coverage.

- [ ] **Step 2: Run the external lifecycle tests and verify they fail by writing evidence**

Run:

```bash
node --test test/hook-stop.test.ts test/hooks-cli.test.ts
```

Expected: FAIL because startup/activity/calibration files appear.

- [ ] **Step 3: Make startup rendering independent from session creation**

Change `prepareSessionStart` so `rec` begins from exact host identity:

```ts
let rec = { session: identity.session, agent: identity.agent };
if (policy.writable) {
  const trusted = readTrustedJournal(cfg);
  if (!trusted.ok) throw new Error(`${trusted.damage.length} decision journal damage item(s)`);
  rec = trusted.records.find((row) => row.kind === "session" && row.session === identity.session)
    ?? openSession(cfg, { session: identity.session, agent: identity.agent, job: identity.job });
} else {
  const trusted = readTrustedJournal(cfg);
  if (!trusted.ok) journalControl = ["", `JOURNAL CONTROL unavailable: ${trusted.damage.length} decision journal damage item(s)`];
  else rec = trusted.records.find((row) => row.kind === "session" && row.session === identity.session) ?? rec;
}
```

Append `lifecyclePersistenceNotice(policy)` to the canonical instruction only when non-null. Do not create an empty journal directory to render zero records.

- [ ] **Step 4: Gate every shared lifecycle write**

In `runHook`, compute:

```ts
const policy = projectWritePolicy(cfg);
```

Then:

- call `recordActivity` only when `policy.writable`;
- make `recordLifecycleToolResult` return immediately when not writable;
- make `recordMainSettlement` return immediately when not writable;
- make `prepareChildSettlement` skip calibration when not writable but still analyze/read and compose feedback;
- pass `policy` to every shared helper;
- preserve byte-silent `PostToolUse` and main `Stop` outputs.

Do not catch protection as generic damage: protected execution is an intentional policy state represented by the startup notice.

- [ ] **Step 5: Re-run lifecycle tests and the dependency-light canary**

Run:

```bash
node --test test/hook-stop.test.ts test/hooks-cli.test.ts
npm run typecheck
```

Expected: pass, including `PostToolUse starts from the source bundle with no dependency installation`.

- [ ] **Step 6: Commit shared lifecycle enforcement**

```bash
git add src/hooks.ts test/hook-stop.test.ts test/hooks-cli.test.ts
git commit -m "feat: keep protected lifecycle hooks read only"
```

---

### Task 4: Native Pi lifecycle parity

**Files:**
- Modify: `src/pi-extension.ts:1-115`
- Modify: `test/pi-extension.test.ts:1-240`
- Create: `test/protected-checkout-hosts.test.ts`

**Interfaces:**
- Consumes: `ProjectWritePolicy` and `projectWritePolicy` from Task 1.
- Consumes: the policy-requiring shared lifecycle signatures from Task 3.
- Produces: one policy snapshot per Pi `session_start`, reset whenever Pi starts/reloads a session.
- Produces: one behavioral guard exercising protected persistence across the complete runtime host domain `claude`, `codex`, and `pi`.

- [ ] **Step 1: Write failing native Pi protected-primary tests**

Extend the Pi fixture so a test can initialize Git and write `protectPrimaryCheckout: true`. Fire `session_start`, `before_agent_start`, `tool_result`, and `agent_settled`.

Assert:

```ts
const started = await runtime.fire("before_agent_start", {
  type: "before_agent_start", systemPrompt: "base", prompt: "work",
});
assert.ok(started);
assert.match(started.systemPrompt, /COHERENCE PERSISTENCE unavailable/);
assert.equal(existsSync(join(root, ".coherence")), false);
```

Repeat in child mode, fire settlement twice, assert exactly one follow-up message and no lifecycle files.

- [ ] **Step 2: Run the Pi tests and verify direct activity/calibration writes fail them**

Run:

```bash
node --test test/pi-extension.test.ts
```

Expected: FAIL because `session_start`, `tool_result`, and `agent_settled` persist evidence.

- [ ] **Step 3: Cache and apply the policy for one Pi session**

Add runtime state:

```ts
let policy: ProjectWritePolicy | null = null;
```

Reset it at the beginning of `session_start`, then set it immediately after `loadConfig`:

```ts
policy = projectWritePolicy(loaded);
```

Require `config`, `identity`, and `policy` in later handlers. Pass policy to every shared lifecycle helper. Wrap Pi's direct startup/settlement `recordActivity` calls in `if (policy.writable)`. The tool-result handler delegates to the now-policy-aware `recordLifecycleToolResult` and still returns `undefined`.

- [ ] **Step 4: Add one cross-host persistence guard**

Create `test/protected-checkout-hosts.test.ts`. Use one real protected primary fixture. Drive Claude and Codex through `hook-cli.ts`; drive Pi through a minimal public-API fake like `test/pi-extension.test.ts`. Derive the host loop from a runtime constant:

```ts
export const HOOK_HOSTS = ["claude", "codex", "pi"] as const;
export type HookHost = typeof HOOK_HOSTS[number];
```

Place `HOOK_HOSTS` beside `HookHost` in `src/types.ts` and replace only the directly touched repeated host validation where useful; do not broaden this task into a host-registry refactor.

Name the guard exactly:

```ts
test("protected primary checkout stays read-only across CLI, Claude, Codex, and Pi", async () => {
  const observed = new Map<HookHost, string[]>();
  for (const host of HOOK_HOSTS) observed.set(host, await runProtectedLifecycle(host));
  assert.deepEqual([...observed.keys()], [...HOOK_HOSTS]);
  for (const files of observed.values()) assert.deepEqual(files, []);
});
```

`runProtectedLifecycle` must execute startup, one tool event, and settlement for each host and return repository-relative files created after the baseline. This is the authored-spec oracle; it must cross real host adapters rather than call `projectWritePolicy` directly.

- [ ] **Step 5: Run Pi, cross-host, and external lifecycle tests**

Run:

```bash
node --test test/pi-extension.test.ts test/protected-checkout-hosts.test.ts test/hook-stop.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit Pi parity**

```bash
git add src/pi-extension.ts src/types.ts test/pi-extension.test.ts test/protected-checkout-hosts.test.ts
git commit -m "feat: enforce protected checkout policy in Pi"
```

---

### Task 5: Durable contract, operator documentation, and final verification

**Files:**
- Modify: `src/harness.spec.md:10-60,200-230,130-185`
- Modify: `README.md:700-790,990-1020`
- Regenerate: `AGENTS.md`
- Regenerate: `public/graph.json`
- Regenerate: `public/_graph.html`
- Regenerate: `public/_overview.html`
- Regenerate if changed by the normal documentation command: other tracked `public/` derived artifacts

**Interfaces:**
- Consumes: the cross-host guard name from Task 4.
- Produces: boundary invariant `lifecycle persistence respects protected checkout ownership across every supported host` at `projectWritePolicy`.
- Documents: exact config, checkout identity, read-only lifecycle behavior, activation-evidence limitation, and no-override policy.

- [ ] **Step 1: Add the authored harness invariant and boundary**

Add to the Harness core invariants/why prose:

```md
**lifecycle persistence respects protected checkout ownership across every supported host.**
A host event arrives before an agent can obey repository prose, so textual worktree guidance
cannot authorize automatic persistence. When the project opts in, Git's registered primary
worktree remains read-only across explicit CLI operations and Claude, Codex, and Pi lifecycle
events; an unprovable identity refuses writes rather than becoming permission. Linked
worktrees retain the complete evidence path.
```

Anchor it under `## works when`:

```md
- boundary "lifecycle persistence respects protected checkout ownership across every supported host" at projectWritePolicy via guard "protected primary checkout stays read-only across CLI, Claude, Codex, and Pi"
```

Keep the existing native Pi parity invariant; this new invariant governs persistence authorization rather than transport mapping.

- [ ] **Step 2: Document adoption and configuration**

In the lifecycle-control section, add a short `Protected primary checkout` subsection showing:

```json
{
  "protectPrimaryCheckout": true
}
```

State:

- Git's first `worktree list --porcelain` entry is protected;
- registered linked worktrees remain writable regardless of branch;
- primary/unprovable explicit writes exit nonzero;
- startup instructions remain available, while tool telemetry and calibration are suppressed;
- protected execution cannot manufacture current-session activation evidence;
- there is no force flag, environment override, redirection, or automatic cleanup.

Add a Config reference row with default `false` and the same concise semantics.

- [ ] **Step 3: Run focused behavior and type validation once**

Run:

```bash
node --test \
  test/write-policy.test.ts \
  test/write-policy-cli.test.ts \
  test/commands.test.ts \
  test/hook-stop.test.ts \
  test/hooks-cli.test.ts \
  test/pi-extension.test.ts \
  test/protected-checkout-hosts.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 4: Regenerate tracked documentation after the diff is stable**

Run from the feature worktree, where writes are permitted:

```bash
node src/cli.ts docs
```

Inspect every generated diff. Retain only artifacts produced by this command and required by the changed source/spec graph; do not hand-edit generated files.

- [ ] **Step 5: Run build, full tests, and Coherence verification**

Run once after regeneration:

```bash
npm run build
npm test
npx coherence verify
```

Expected: build succeeds, all tests pass, and every Coherence claim is coherent. If `verify` updates tracked derived evidence, inspect it before staging; do not commit machine-local or transient `.coherence` rows.

- [ ] **Step 6: Inspect and commit the complete implementation diff**

```bash
git status --short
git diff --check
git diff --stat
git diff
git add src/write-policy.ts src/types.ts src/config.ts src/commands.ts src/cli.ts src/hooks.ts src/pi-extension.ts \
  test/write-policy.test.ts test/write-policy-cli.test.ts test/commands.test.ts \
  test/hook-stop.test.ts test/hooks-cli.test.ts test/pi-extension.test.ts \
  test/protected-checkout-hosts.test.ts src/harness.spec.md README.md AGENTS.md public/
git diff --cached --check
git commit -m "docs: document protected primary checkout policy"
```

Do not stage `.coherence/calibration/`, `.coherence/activity/`, `.coherence/read-traces/`, or session-local decision files created by validation.

- [ ] **Step 7: Confirm the branch is clean and review the commit range**

```bash
git status --short --branch
git log --oneline c15820d..HEAD
git diff --stat c15820d..HEAD
```

Expected: clean worktree; one design commit, focused implementation commits, and the final documentation/contract commit.
