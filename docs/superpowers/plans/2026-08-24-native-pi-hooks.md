# Native Pi Lifecycle Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add installable, observable native Pi lifecycle hooks with optional `pi-subagents` child parity and explicit Pi regulation.

**Architecture:** A dedicated `pi-control.ts` owns Pi settings and root mapping while `pi-extension.ts` adapts public Pi events into shared lifecycle operations extracted from `hooks.ts`. Claude/Codex retain their launcher controls and envelopes; hooks status and regulation dispatch to the selected host-specific inspection without pretending Pi has a launcher.

**Tech Stack:** Node.js 22, TypeScript 5.7, `node:test`, public `@earendil-works/pi-coding-agent` extension types, JSON project settings.

**Spec:** `docs/superpowers/specs/2026-08-24-native-pi-hooks-design.md`

## Global Constraints

- `@earendil-works/pi-coding-agent` is the canonical Pi API; use its public extension contract only.
- `pi-subagents` is neither a dependency nor a peer dependency; child integration uses only documented environment variables and `pi.events` acknowledgement.
- Preserve unrelated `.pi/settings.json`, Claude, and Codex configuration.
- Bare `hooks` and `regulate` host selection remains unchanged; Pi requires explicit `--host pi`.
- Do not shell out per Pi lifecycle event.
- Main settlement is model-silent; a child receives exactly one final-report turn.
- Tool telemetry never alters a successful Pi tool result.
- Use TDD: every production behavior starts with a focused failing test observed for the expected reason.

---

## File Structure

**Create:**

- `src/pi-control.ts` — Pi project settings, package target, root mapping, inspection, mutation, runtime-root ownership, and Pi bundle identity.
- `src/pi-extension.ts` — public Pi event adapter and child completion loop guard.
- `test/pi-control.test.ts` — native control install/check/uninstall contracts.
- `test/pi-extension.test.ts` — in-process Pi lifecycle behavior through a fake public ExtensionAPI surface.

**Modify:**

- `src/types.ts`, `src/config.ts` — `piProjectRoot` configuration.
- `src/control.ts` — distinguish external `claude|codex` hosts from the public `claude|codex|pi` selector.
- `src/hooks.ts` — reusable lifecycle seams plus selected-host status/installation dispatch.
- `src/activity.ts`, `src/read-trace.ts` — strict `pi`/`native` provenance.
- `src/regulate.ts` — inspect and repair the explicit Pi host.
- `src/cli.ts`, `src/commands.ts` — accept and document explicit `--host pi`.
- `package.json`, `package-lock.json` — Pi manifest and optional peer/development type contract.
- `scripts/package-smoke.mjs` — verify the packed native extension and project-local Pi control.
- `test/activity.test.ts`, `test/hook-stop.test.ts`, `test/hooks-cli.test.ts`, `test/regulate.test.ts`, `test/control.test.ts` — focused regression and host-selection coverage.
- `src/harness.spec.md`, `coherence.config.json`, `coherence.spec.md` — native lifecycle invariant, atlas crossings, and repository control claim.
- `README.md`, `AGENTS.md`, `public/graph.json`, `public/_graph.html`, `public/_overview.html` — authored and generated reading surfaces.
- `.pi/settings.json`, `.pi/coherence-root` — this repository's dogfooded native Pi control.

---

### Task 1: Native Pi structural control

**Files:**
- Create: `src/pi-control.ts`
- Create: `test/pi-control.test.ts`
- Modify: `src/types.ts:114-116`
- Modify: `src/control.ts:23-26`

**Interfaces:**
- Consumes: `Config.root`, optional `Config.piProjectRoot`, package name `@danilocampos/coherence`.
- Produces:

```ts
export type HookHost = "claude" | "codex" | "pi";
export type ExternalHookHost = Exclude<HookHost, "pi">;

export const PI_EXTENSION_ID = "@danilocampos/coherence";
export const PI_HOOK_PROTOCOL_VERSION = 1 as const;
export const PI_HOOK_BUNDLE_FINGERPRINT: string;

export interface PiLifecycleInspection {
  host: "pi";
  present: boolean;
  configured: boolean;
  valid: boolean;
  settings: {
    path: string;
    exists: boolean;
    valid: boolean;
    canonicalEntries: number;
    managedEntries: number;
    error?: string;
  };
  mapping: {
    path: string;
    present: boolean;
    expected: string;
    actual?: string;
  };
  target: {
    packageRoot: string;
    extensionPath: string;
    present: boolean;
  };
  bundleFingerprint: string;
  warnings: string[];
}

export interface PiLifecycleMutation {
  inspection: PiLifecycleInspection;
  changed: string[];
  errors: string[];
}

export function resolvePiProjectRoot(cfg: Config): string;
export function inspectPiLifecycleHook(cfg: Config): PiLifecycleInspection;
export function setPiLifecycleHook(cfg: Config, present: boolean): Promise<PiLifecycleMutation>;
export function resolvePiRuntimeRoot(cwd: string, extensionPath: string):
  | { active: true; root: string }
  | { active: false; reason: string };
```

- [ ] **Step 1: Write the failing installation contract**

Create a temp package fixture whose `package.json` declares `pi.extensions: ["./dist/pi-extension.js"]`, materialize that target, preserve an unrelated package and setting, and assert nested-root installation:

```ts
test("Pi control — install is exact, idempotent, preserving, and nested-root aware", async () => {
  const host = await tmpProject({
    ".pi/settings.json": JSON.stringify({ packages: ["npm:other"], theme: "dark" }, null, 2) + "\n",
  });
  const root = join(host, "app");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@danilocampos/coherence",
    pi: { extensions: ["./dist/pi-extension.js"] },
  }));
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist/pi-extension.js"), "export default () => {};\n");
  const config = cfg(root, { piProjectRoot: ".." });

  const first = await setPiLifecycleHook(config, true);
  assert.equal(first.inspection.present, true);
  assert.deepEqual(JSON.parse(await readFile(join(host, ".pi/settings.json"), "utf8")), {
    packages: ["npm:other", "../app"],
    theme: "dark",
  });
  assert.equal(await readFile(join(host, ".pi/coherence-root"), "utf8"), "app\n");
  assert.deepEqual((await setPiLifecycleHook(config, true)).changed, []);
});
```

The production change that makes this test pass is the new canonical settings/mapping mutation; it fails initially because `setPiLifecycleHook` does not exist.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/pi-control.test.ts`

Expected: FAIL with an unresolved `../src/pi-control.ts` import or missing `setPiLifecycleHook`; no production file exists yet.

- [ ] **Step 3: Implement the minimum settings control**

Implement `src/pi-control.ts` with Node built-ins only:

```ts
const canonicalPackageEntry = (cfg: Config): string =>
  relative(join(resolvePiProjectRoot(cfg), ".pi"), packageRoot(cfg)).replaceAll("\\", "/") || ".";

const expectedMapping = (cfg: Config): string =>
  `${relative(resolvePiProjectRoot(cfg), cfg.root).replaceAll("\\", "/") || "."}\n`;

export function resolvePiProjectRoot(cfg: Config): string {
  return resolve(cfg.root, cfg.piProjectRoot ?? ".");
}
```

Read JSON as an object, require `packages` to be absent or an array, recognize managed entries only when a local entry resolves to a package named `@danilocampos/coherence` or directly names its Pi extension, and write atomically while retaining indentation, trailing newline, and file mode. Inspection is present only for one canonical entry, one exact mapping, and the manifest-declared extension file.

Add `piProjectRoot?: string` to `Config`. Change external control functions in `control.ts` to accept `ExternalHookHost`, while re-exporting the public `HookHost` union for current import compatibility.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/pi-control.test.ts`

Expected: PASS for installation/idempotence.

- [ ] **Step 5: Add failing refusal and ownership-safe uninstall tests**

Add separate tests that assert:

```ts
assert.equal(inspectPiLifecycleHook(cfg(root)).valid, false); // malformed settings JSON
assert.equal(inspectPiLifecycleHook(cfg(root)).present, false); // two managed entries
assert.match(result.errors.join("\n"), /extension target is missing/);
assert.equal(await readFile(mappingPath, "utf8"), "operator changed this\n"); // uninstall preserves drift
```

Also exercise `resolvePiRuntimeRoot`: no config means inactive; exact project mapping selects the matching extension package; a second extension path is inactive.

- [ ] **Step 6: Run the focused test, observe the new assertions fail, then implement the guards**

Run before implementation: `node --test test/pi-control.test.ts`

Expected RED: duplicate/malformed/target/drift cases are accepted or unsupported.

Implement fail-closed validation and byte-owned removal, then rerun.

Expected GREEN: all `test/pi-control.test.ts` tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/pi-control.ts src/types.ts src/control.ts test/pi-control.test.ts
git commit -m "feat: add native Pi lifecycle control"
```

---

### Task 2: Shared lifecycle seams and native telemetry

**Files:**
- Modify: `src/activity.ts`
- Modify: `src/read-trace.ts`
- Modify: `src/hooks.ts:250-430`
- Modify: `test/activity.test.ts`
- Modify: `test/hook-stop.test.ts`

**Interfaces:**
- Consumes: Task 1 `HookHost`, existing `ActivityContext`, journal/work/signal/calibration modules.
- Produces:

```ts
export type ActivityHost = "claude" | "codex" | "pi" | "unknown";
export type ActivityTransport = "launcher" | "native" | "direct";

export interface LifecycleIdentity {
  session: string;
  agent: string;
  job: string;
  host: ActivityHost;
  transport: ActivityTransport;
  bundleHash: string | null;
}

export async function prepareSessionStart(
  cfg: Config,
  event: "SessionStart" | "SubagentStart",
  identity: LifecycleIdentity,
): Promise<string>;

export function recordLifecycleToolResult(
  cfg: Config,
  payload: unknown,
  context: ActivityContext,
): void;

export async function recordMainSettlement(cfg: Config, session: string): Promise<void>;
export async function prepareChildSettlement(cfg: Config, session: string): Promise<string>;
```

`recordHookReads` retains its existing parameters and accepts an optional fourth `ActivityContext`; omitted context preserves environment-derived Claude/Codex behavior.

- [ ] **Step 1: Write failing strict native telemetry tests**

Add a real Pi-shaped payload and verify both activity and path trace:

```ts
test("Pi telemetry — native activity and path traces stay exact-session and strict", async () => {
  const root = await tmpProject({ "src/a.ts": "export const a = 1;\n" });
  const c = cfg(root);
  const context = {
    host: "pi", transport: "native", bundleHash: "pi-bundle", experimentId: null,
  } as const;
  const payload = {
    session_id: "pi-session", agent_id: "pi-session", tool_use_id: "call-1",
    tool_name: "Read", tool_input: { path: "src/a.ts" },
  };
  recordActivity(c, "PostToolUse", payload, context, "2026-08-24T00:00:00.000Z");
  recordHookReads(c, payload, "2026-08-24T00:00:00.000Z", context);
  assert.equal(readActivity(c, "pi-session").rows[0]?.transport, "native");
  assert.equal(readTraceDetailed(c, "pi-session").rows[0]?.observation?.host, "pi");
});
```

Add malformed variants proving `native` is accepted only with a valid host/attribution relation and unknown transport remains damage.

- [ ] **Step 2: Run telemetry tests and verify RED**

Run: `node --test test/activity.test.ts`

Expected: FAIL because `pi` and `native` are rejected by strict readers and `recordHookReads` lacks the context parameter.

- [ ] **Step 3: Implement the telemetry vocabulary minimally**

Extend the strict host/transport sets in both modules. Make `recordHookReads` choose the explicit context when supplied and retain its existing environment fallback otherwise. Keep `currentSessionSummary.launcher` launcher-only; native authority is interpreted by Pi status later, not relabeled here.

- [ ] **Step 4: Run telemetry tests and verify GREEN**

Run: `node --test test/activity.test.ts`

Expected: PASS with existing Claude/Codex cases unchanged.

- [ ] **Step 5: Write failing reusable lifecycle tests**

In `test/hook-stop.test.ts`, call the wished-for helpers directly:

```ts
const text = await prepareSessionStart(config, "SessionStart", {
  session: "pi-session", agent: "main", job: "pi-session",
  host: "pi", transport: "native", bundleHash: "pi-bundle",
});
assert.match(text, /YOUR SESSION ID IS pi-session/);
await recordMainSettlement(config, "pi-session");
const child = await prepareChildSettlement(config, "pi-child");
assert.match(child, /YOUR REPLY MUST RESTATE YOUR FINAL REPORT/);
assert.match(child, /CHANGE SIGNAL/);
```

The production mutation that must break this guard is removing main calibration or child report composition; the test reads the resulting journal/calibration files and report, not exported-symbol existence.

- [ ] **Step 6: Run lifecycle tests and verify RED**

Run: `node --test test/hook-stop.test.ts`

Expected: FAIL because the shared helpers do not exist.

- [ ] **Step 7: Extract the minimum helpers and rewire `runHook`**

Move existing branches without changing their host envelopes:

```ts
if (event === "SubagentStart" || event === "SessionStart") {
  const identity = identityFromHookPayload(event, payload);
  const text = await prepareSessionStart(cfg, event, identity);
  if (text) emit(identity.host, event, text);
  return 0;
}
```

`recordLifecycleToolResult` catches activity and trace persistence independently. Remove the old unconditional activity append for `PostToolUse` before calling it so one tool result creates one physical activity row; non-tool `runHook` events retain their existing top-level activity append. `recordMainSettlement` performs only calibration. `prepareChildSettlement` snapshots exact-child calibration and returns `composeHookText(stopReport + change signal, ...)`. Keep `runHook`'s malformed-stdin tolerance, `stop_hook_active` guard, Codex block envelope, and main byte-silence.

- [ ] **Step 8: Run focused regression tests and verify GREEN**

Run:

```bash
node --test test/activity.test.ts test/hook-stop.test.ts test/hooks-cli.test.ts
```

Expected: PASS, including the dependency-light PostToolUse canary.

- [ ] **Step 9: Commit**

```bash
git add src/activity.ts src/read-trace.ts src/hooks.ts test/activity.test.ts test/hook-stop.test.ts
git commit -m "refactor: share lifecycle operations with native hosts"
```

---

### Task 3: Native Pi extension and optional child completion

**Files:**
- Create: `src/pi-extension.ts`
- Create: `test/pi-extension.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Task 1 `resolvePiRuntimeRoot`, `PI_HOOK_BUNDLE_FINGERPRINT`; Task 2 lifecycle helpers; public Pi `ExtensionAPI`, `ToolResultEvent`, and `ExtensionContext` types.
- Produces:

```ts
export const PI_COHERENCE_EXTENSION_ACK = "@danilocampos.coherence";
export default function registerPiHooks(pi: ExtensionAPI): void;
```

The emitted acknowledgement is:

```ts
pi.events.emit("subagent:acknowledge-extension", { id: PI_COHERENCE_EXTENSION_ACK });
```

- [ ] **Step 1: Add Pi as an optional type/build contract**

Run:

```bash
npm install --save-dev @earendil-works/pi-coding-agent@^0.84.3
```

Then edit `package.json` so general coherence consumers do not install Pi transitively:

```json
{
  "keywords": ["agents", "spec", "coherence", "claude-code", "codex", "pi-package", "harness", "verification"],
  "pi": { "extensions": ["./dist/pi-extension.js"] },
  "peerDependencies": { "@earendil-works/pi-coding-agent": "*" },
  "peerDependenciesMeta": {
    "@earendil-works/pi-coding-agent": { "optional": true }
  }
}
```

Keep `@earendil-works/pi-coding-agent` in `devDependencies` for compilation/tests and regenerate `package-lock.json` through npm rather than editing lock bytes manually.

- [ ] **Step 2: Write the failing extension lifecycle test**

Build a fake API that stores registered handlers by event name, exposes a synchronous event bus, records `sendMessage`, and supplies real temp-project contexts. Assert observable behavior:

```ts
test("Pi extension — main settlement stays silent and child settlement triggers exactly one final report without pi-subagents", async () => {
  const runtime = fakePi("pi-child-session", root);
  await withEnv({ PI_SUBAGENT_CHILD: "1", PI_SUBAGENT_CHILD_AGENT: "worker" }, async () => {
    registerPiHooks(runtime.pi);
    await runtime.fire("session_start", { reason: "startup" });
    const started = await runtime.fire("before_agent_start", { systemPrompt: "base", prompt: "work" });
    assert.match(started.systemPrompt, /YOUR SESSION ID IS pi-child-session/);
    await runtime.fire("agent_settled", {});
    await runtime.fire("agent_settled", {});
  });
  assert.equal(runtime.sent.length, 1);
  assert.equal(runtime.sent[0].options.triggerTurn, true);
  assert.equal(runtime.sent[0].options.deliverAs, "followUp");
  assert.match(runtime.sent[0].message.content, /YOUR REPLY MUST RESTATE YOUR FINAL REPORT/);
});
```

A companion main-process case deletes `PI_SUBAGENT_CHILD`, fires `agent_settled`, asserts no sent message, and checks that calibration was recorded. The test environment intentionally has no `pi-subagents` dependency.

- [ ] **Step 3: Run the extension test and verify RED**

Run: `node --test test/pi-extension.test.ts`

Expected: FAIL because `src/pi-extension.ts` does not exist.

- [ ] **Step 4: Implement registration, root resolution, and the loop guard**

Use one in-memory state object per extension runtime:

```ts
let config: Config | null = null;
let identity: LifecycleIdentity | null = null;
let childFeedbackSent = false;

pi.on("session_start", async (_event, ctx) => {
  const selected = resolvePiRuntimeRoot(ctx.cwd, fileURLToPath(import.meta.url));
  if (!selected.active) return;
  config = await loadConfig(selected.root);
  const session = ctx.sessionManager.getSessionId()?.trim() || newSessionId();
  const child = process.env.PI_SUBAGENT_CHILD === "1";
  identity = {
    session,
    agent: process.env.PI_SUBAGENT_CHILD_AGENT?.trim() || (child ? "subagent" : "main"),
    job: process.env.PI_SUBAGENT_RUN_ID?.trim() || session,
    host: "pi",
    transport: "native",
    bundleHash: PI_HOOK_BUNDLE_FINGERPRINT,
  };
  childFeedbackSent = false;
  recordActivity(config, "SessionStart", {
    session_id: session,
    ...(child ? { agent_id: session } : {}),
  }, {
    host: "pi", transport: "native",
    bundleHash: PI_HOOK_BUNDLE_FINGERPRINT, experimentId: null,
  });
});
```

`before_agent_start` appends freshly prepared instructions to `event.systemPrompt`. `tool_result` creates a payload with exact session/agent/tool-call identity, maps built-in tool names to coherence's existing names, and calls `recordLifecycleToolResult`. Pass `details.exitCode` only when it is an explicit integer; Pi 0.84.3's built-in Bash result details do not expose it, so do not infer an exit code from output or `isError`. Record native `Stop`/`SubagentStop` activity at settlement before invoking the corresponding shared helper.

At child `agent_settled`, set `childFeedbackSent = true` before awaiting report composition, then call:

```ts
pi.sendMessage({
  customType: "coherence-subagent-stop",
  content: feedback,
  display: true,
}, { deliverAs: "followUp", triggerTurn: true });
```

At main settlement call only `recordMainSettlement`. Catch lifecycle persistence failures at event boundaries and use `ctx.ui.notify(..., "warning")` only when `ctx.hasUI`; never return a tool-result patch.

- [ ] **Step 5: Run extension tests and verify GREEN**

Run: `node --test test/pi-extension.test.ts`

Expected: PASS with one child message and zero main messages.

- [ ] **Step 6: Add failing tool and acknowledgement cases**

Fire `tool_result` with real `read`, `write`, and `bash` inputs. Assert native activity/path rows, unknown verification result without a numeric exit field, and an acknowledgement payload with the stable ID. Replace `.coherence/read-traces` with a regular file and assert the handler resolves without returning a result patch.

Run before the adapter additions: `node --test test/pi-extension.test.ts`

Expected RED: missing trace/activity/acknowledgement evidence.

Implement only the event-to-payload mapping required by those cases, rerun, and expect GREEN.

- [ ] **Step 7: Typecheck and build the public extension**

Run:

```bash
npm run typecheck
npm run build
test -f dist/pi-extension.js
```

Expected: all commands exit 0 and `dist/pi-extension.js` exists.

- [ ] **Step 8: Commit**

```bash
git add src/pi-extension.ts test/pi-extension.test.ts package.json package-lock.json
git commit -m "feat: run coherence lifecycle natively in Pi"
```

---

### Task 4: Host-selected hooks status, CLI, and regulation

**Files:**
- Modify: `src/hooks.ts:480-847`
- Modify: `src/regulate.ts:1-330`
- Modify: `src/cli.ts:370-400,1020-1075`
- Modify: `src/commands.ts:140-145,270-276`
- Modify: `test/hooks-cli.test.ts`
- Modify: `test/regulate.test.ts`
- Modify: `test/activity.test.ts`
- Modify: `scripts/package-smoke.mjs`

**Interfaces:**
- Consumes: `PiLifecycleInspection`, `inspectPiLifecycleHook`, `setPiLifecycleHook`, native activity rows.
- Produces: explicit `hooks --host pi` and `regulate --host pi`; existing default commands remain Claude.

Add a Pi-specific current observation shape rather than reusing launcher labels:

```ts
export interface CurrentPiHookObservation {
  session: string;
  state: "observed" | "unobserved" | "stale";
  exactNativeEvents: number;
  staleNativeEvents: number;
  directEvents: number;
  lastExactAt: string | null;
  trace: Omit<CurrentHookObservation["trace"], "bundle"> & {
    bundle: { exactNative: number; staleNative: number; direct: number; legacy: number };
  };
  updatePlanEvents: number;
  parentFallbackEvents: number;
  unreadableActivity: number;
  verification: { total: number; success: number; failure: number; unknown: number };
  intervention: { total: number; success: number; failure: number; unknown: number };
  experiment: CurrentHookObservation["experiment"];
}
```

- [ ] **Step 1: Write failing Pi CLI dispatch tests**

Extend `test/hooks-cli.test.ts` with a packed-shape fixture and assert:

```ts
const installed = await run(root, ["hooks", "install", "--host", "pi", "--json"]);
assert.equal(installed.code, 0, installed.stderr);
assert.equal(JSON.parse(installed.stdout).host, "pi");
assert.equal(existsSync(join(root, ".pi/settings.json")), true);

const bare = await run(root, ["hooks", "status", "--json"], {
  ...hostEnv(), PI_SESSION_ID: "ambient-pi",
});
assert.equal(JSON.parse(bare.stdout).host, "claude");
```

Also assert `hooks print --host pi`, `review --host pi`, check exit 0 after install, uninstall, and invalid-host help says `claude, codex, or pi`.

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `node --test test/hooks-cli.test.ts`

Expected: FAIL with `invalid hook host: pi`.

- [ ] **Step 3: Implement selected-host dispatch and native status**

In `hooks.ts`, branch before external inspection/mutation:

```ts
const controlFor = (cfg: Config, host: HookHost) =>
  host === "pi" ? inspectPiLifecycleHook(cfg) : inspectLifecycleHook(cfg, host);

const mutateControl = (cfg: Config, host: HookHost, present: boolean) =>
  host === "pi" ? setPiLifecycleHook(cfg, present) : setLifecycleHook(cfg, present, host);
```

Keep external `HookStatus` JSON/text unchanged. For Pi, count authoritative rows only when `transport === "native"`, `host === "pi"`, and bundle fingerprint matches. `activeHookSession("pi")` reads explicit session, then `COHERENCE_SESSION`, then `PI_SESSION_ID`; it never guesses newest. Print `native package`, `root mapping`, `extension target`, and `exact native/bundle events`, never `launcher`.

Update CLI allowed hosts and command registry usage. Pass the selected host into `reviewHooks` so its heading names Pi while effective emission content remains shared.

- [ ] **Step 4: Run CLI/status tests and verify GREEN**

Run:

```bash
node --test test/hooks-cli.test.ts test/activity.test.ts
```

Expected: PASS; existing Claude/Codex JSON assertions remain unchanged.

- [ ] **Step 5: Write the failing Pi regulation guard**

Add:

```ts
test("regulate — selected Pi host cannot be redeemed by Claude or Codex control", async () => {
  await setLifecycleHook(config, true, "claude");
  const absentPi = selectRegulation(await observeRegulation(config, undefined, { host: "pi" }));
  assert.equal(absentPi.action, "redirect");
  assert.deepEqual(absentPi.selected?.command, {
    name: "hooks", args: ["install", "--host", "pi"],
  });
  await setPiLifecycleHook(config, true);
  const completePi = selectRegulation(await observeRegulation(config, undefined, { host: "pi" }));
  assert.equal(completePi.action, "release");
});
```

Extend malformed reading tests so an unknown fourth host still refuses while `pi` is admitted.

- [ ] **Step 6: Run regulation tests and verify RED**

Run: `node --test test/regulate.test.ts test/regulate-cli.test.ts`

Expected: FAIL because selector and sensor support only Claude/Codex.

- [ ] **Step 7: Implement explicit Pi regulation**

Allow `pi` in `selectRegulation`, append `--host pi` for every host-scoped doctrine command, and map both inspection types to one sensor reading:

```ts
const selectedControl = host === "pi"
  ? piControlReading(inspectPiLifecycleHook(cfg))
  : externalControlReading(inspectLifecycleHook(cfg, host));
```

`piControlReading` reports unavailable for invalid settings/mapping/target, satisfied only when `present`, and violated otherwise. Update regulate CLI parsing and registry usage to `<claude|codex|pi>` without changing its ambient default.

- [ ] **Step 8: Run regulation tests and verify GREEN**

Run:

```bash
node --test test/regulate.test.ts test/regulate-cli.test.ts test/hooks-cli.test.ts
```

Expected: PASS.

- [ ] **Step 9: Extend the packed-consumer smoke test**

Before implementation, add assertions that fail against the old tarball:

```js
assert.equal(existsSync(join(installed, "dist", "pi-extension.js")), true);
const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
assert.deepEqual(manifest.pi.extensions, ["./dist/pi-extension.js"]);
run(coherence, ["hooks", "install", "--host", "pi"], { cwd: consumer });
run(coherence, ["hooks", "--check", "--host", "pi"], { cwd: consumer });
```

Add `.pi/` to the consumer ignore list. Run: `node scripts/package-smoke.mjs`

Expected after implementation: `package smoke: packed artifact passed in an isolated git consumer`.

- [ ] **Step 10: Commit**

```bash
git add src/hooks.ts src/regulate.ts src/cli.ts src/commands.ts test/hooks-cli.test.ts test/regulate.test.ts test/activity.test.ts scripts/package-smoke.mjs
git commit -m "feat: inspect and regulate the Pi lifecycle host"
```

---

### Task 5: Dogfood, anchor, document, and verify the native control

**Files:**
- Modify: `src/harness.spec.md`
- Modify: `coherence.config.json`
- Modify: `coherence.spec.md`
- Modify: `test/control.test.ts`
- Modify: `README.md`
- Create: `.pi/settings.json`
- Create: `.pi/coherence-root`
- Regenerate: `AGENTS.md`, `public/graph.json`, `public/_graph.html`, `public/_overview.html`, README command index
- Update if measured growth requires repinning: `public/mass-baseline.json`

**Interfaces:**
- Consumes: all prior tasks and the exact guard name from Task 3.
- Produces: checked-in native control, an anchored invariant, upstream-facing installation docs, and final evidence.

- [ ] **Step 1: Extend the repository control test and observe RED**

Change the repository control test to inspect all three supported hosts:

```ts
for (const host of ["claude", "codex", "pi"] as const) {
  const inspection = host === "pi"
    ? inspectPiLifecycleHook(config)
    : inspectLifecycleHook(config, host);
  assert.equal(inspection.present, true, `${host}\n${JSON.stringify(inspection, null, 2)}`);
  assert.deepEqual(inspection.warnings, [], host);
}
```

Run: `node --test test/control.test.ts`

Expected: FAIL for Pi because this repository has not installed `.pi` control.

- [ ] **Step 2: Build and install this repository's native control**

Run:

```bash
npm run build
node src/cli.ts hooks install --host pi
node src/cli.ts hooks --check --host pi
```

Expected: `.pi/settings.json` contains one local package entry resolving to the repository root, `.pi/coherence-root` contains `.`, and check exits 0.

Rerun: `node --test test/control.test.ts`

Expected: PASS for Claude, Codex, and Pi.

- [ ] **Step 3: Add the native invariant and atlas crossings**

In `src/harness.spec.md`, add this invariant:

```md
- native Pi lifecycle preserves host meaning without requiring pi-subagents
```

Anchor it with the exact Task 3 oracle:

```md
- boundary "native Pi lifecycle preserves host meaning without requiring pi-subagents" at registerPiHooks via guard "Pi extension — main settlement stays silent and child settlement triggers exactly one final report without pi-subagents"
```

Add `## why` prose stating that Pi's in-process extension maps exact native session/tool/settlement events, remains useful with no child package, and allows one guarded child completion turn when `PI_SUBAGENT_CHILD=1`.

Update existing lifecycle-host and activation prose so Claude/Codex launchers and Pi native transport remain distinct. In `coherence.config.json`, add `registerPiHooks` and `inspectPiLifecycleHook` crossings and update `currentObservation` to say “canonical host transport” rather than launcher-only evidence.

- [ ] **Step 4: Run fast structural checks and fix only named gaps**

Run:

```bash
node src/cli.ts verify --fast
node src/cli.ts atlas --check
node src/cli.ts why-lint --check
```

Expected: fast verification recognizes the new boundary; atlas and why-lint exit 0 after the crossing/rationale updates. Any failure must be repaired at the named spec/config relation, not waived.

- [ ] **Step 5: Update authored README installation guidance**

Add Pi to Quick Start and lifecycle adoption without replacing Claude/Codex examples. Document:

```sh
npx coherence hooks install --host pi
npx coherence hooks --check --host pi
npx coherence hooks status --host pi --session "$PI_SESSION_ID"
```

State the committed files, `piProjectRoot`, dormant behavior outside a declared root, optional `pi-subagents` detection, exact child session attribution, one extra child report turn, and explicit `regulate --host pi`. Do not add tools, slash commands, or a `pi-subagents` installation requirement.

Update `coherence.spec.md`'s root-control wording so the existing repository guard explicitly covers every supported host.

- [ ] **Step 6: Regenerate owned reading surfaces**

Run:

```bash
node src/cli.ts docs
node src/cli.ts docs --check
```

Expected: `AGENTS.md`, graph/overview artifacts, and README's generated command index are current; the check exits 0.

- [ ] **Step 7: Re-pin measured mass with an attributable decision**

Run: `node src/cli.ts mass --check`

Expected: the new native adapter, extension, tests, and invariant report intentional growth. Record why this mass exists and re-pin:

```bash
session="${PI_SESSION_ID:-${COHERENCE_SESSION:?run inside the exact Pi/coherence session}}"
node src/cli.ts decide \
  "accept native Pi lifecycle control and its executable parity guard" \
  --over "leaving Pi as an undocumented external launcher integration" \
  --because "the user-directed upstream feature adds one native host boundary, optional child parity, and behavior tests that fail if either disappears" \
  --session "$session" --agent main
node src/cli.ts mass --update-baseline
node src/cli.ts mass --check
```

Do not substitute `unknown`, a branch name, or a date for the required exact session.

Expected: the final mass check exits 0 and the decision is stored under `.coherence/decisions/`.

- [ ] **Step 8: Run complete verification**

Run in this order:

```bash
npm run typecheck
npm test
npm run build
node scripts/package-smoke.mjs
node src/cli.ts signal --check --since main
node src/cli.ts premise --check
node src/cli.ts docs --check
node src/cli.ts why-lint --check
node src/cli.ts mass --check
node src/cli.ts conventions --check
node src/cli.ts lint-sinks --check
node src/cli.ts atlas --check
node src/cli.ts verify
```

Expected: every command exits 0. Capture the full verification claim count and test count in the completion report. If `signal --check --since main` requires a different upstream base in this fork, use `git merge-base HEAD origin/main` explicitly and report that SHA.

- [ ] **Step 9: Inspect the final diff for packaging and temporary artifacts**

Run:

```bash
git status --short
git diff --check
git diff --stat origin/main...HEAD
find . -path '*/.superpowers/sdd/*' -print
```

Expected: no `.superpowers/sdd/` files, no committed `dist/` or `node_modules/`, no unstaged generated drift, and only the feature/spec/plan/control/evidence files remain.

- [ ] **Step 10: Commit**

```bash
git add .pi .coherence/decisions src/harness.spec.md coherence.config.json coherence.spec.md \
  test/control.test.ts README.md AGENTS.md public/graph.json public/_graph.html \
  public/_overview.html public/mass-baseline.json
git commit -m "docs: adopt native Pi lifecycle control"
```

If a listed generated or evidence file did not change, omit that path rather than creating empty churn.
