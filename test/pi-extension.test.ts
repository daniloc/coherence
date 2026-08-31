import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { PI_EXTENSION_ID } from "../src/pi-control.ts";
import { loadConfig } from "../src/config.ts";
import { readCalibrationSamples } from "../src/calibration.ts";
import { PI_COHERENCE_EXTENSION_ACK, default as registerPiHooks } from "../src/pi-extension.ts";
import type {
  AgentSettledEvent, BeforeAgentStartEvent, ExtensionAPI, SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

async function fixture(protectPrimaryCheckout = false) {
  const root = await mkdtemp(join(tmpdir(), "coherence-pi-"));
  const extension = join(process.cwd(), "src/pi-extension.ts");
  await mkdir(join(root, ".pi"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: PI_EXTENSION_ID, pi: { extensions: [relative(root, extension)] } }));
  await writeFile(join(root, "coherence.config.json"), JSON.stringify(protectPrimaryCheckout ? { protectPrimaryCheckout: true } : {}) + "\n");
  await writeFile(join(root, ".pi", "settings.json"), JSON.stringify({ packages: [".."] }));
  await writeFile(join(root, ".pi", "coherence-root"), "./\n");
  return root;
}

type FakeToolResult = {
  type: "tool_result"; toolCallId: string; toolName: string; input: Record<string, unknown>;
  content: Array<{ type: "text"; text: string }>; isError: boolean; details: unknown;
};
type FakeEvents = {
  session_start: Pick<SessionStartEvent, "type" | "reason">;
  before_agent_start: Pick<BeforeAgentStartEvent, "type" | "prompt" | "systemPrompt">;
  tool_result: FakeToolResult;
  agent_settled: Pick<AgentSettledEvent, "type">;
};
type FakeEventName = keyof FakeEvents;
type FakeResult = { systemPrompt: string } | undefined;
type FakeContext = {
  cwd: string;
  hasUI: boolean;
  ui: { notify(message: string, level: "warning"): void };
  sessionManager: { getSessionId(): string | undefined };
};
type FakeHandler = (event: FakeEvents[FakeEventName], ctx: FakeContext) => FakeResult | Promise<FakeResult>;

function fakePi(root: string, sessionId?: string) {
  const handlers = new Map<FakeEventName, FakeHandler>();
  const sent: Array<{ message: { customType: string; content: string; display?: boolean }; options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" } }> = [];
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const on = (name: FakeEventName, handler: FakeHandler): void => { handlers.set(name, handler); };
  const events: ExtensionAPI["events"] = {
    emit(name, payload) { emitted.push({ name, payload }); },
    on() { return () => undefined; },
  };
  const sendMessage: ExtensionAPI["sendMessage"] = (message, options) => {
    if (typeof message.content !== "string") throw new Error("fake expects string custom-message content");
    sent.push({ message: { customType: message.customType, content: message.content, display: message.display }, options });
  };
  const pi: Pick<ExtensionAPI, "on" | "events" | "sendMessage"> = {
    on: on as ExtensionAPI["on"], events, sendMessage,
  };
  const ctx: FakeContext = {
    cwd: root, hasUI: false, ui: { notify() {} },
    sessionManager: { getSessionId: () => sessionId },
  };
  return {
    pi, sent, emitted,
    setContext(nextRoot: string, nextSession?: string) { ctx.cwd = nextRoot; ctx.sessionManager.getSessionId = () => nextSession; },
    async fire<K extends FakeEventName>(name: K, event: FakeEvents[K]): Promise<FakeResult> { return handlers.get(name)?.(event, ctx); },
  };
}

test("Pi extension — protected primary stays read-only for startup, tools, and child settlement", { concurrency: false }, async () => {
  const root = await fixture(true);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });
  const runtime = fakePi(root, "pi-protected-child");
  const old = { ...process.env };
  process.env.PI_SUBAGENT_CHILD = "1";
  try {
    registerPiHooks(runtime.pi);
    await runtime.fire("session_start", { type: "session_start", reason: "startup" });
    const started = await runtime.fire("before_agent_start", { type: "before_agent_start", systemPrompt: "base", prompt: "work" });
    assert.ok(started);
    assert.match(started.systemPrompt, /COHERENCE PERSISTENCE unavailable/);
    await runtime.fire("tool_result", { type: "tool_result", toolCallId: "write", toolName: "write", input: { file_path: "x" }, content: [], isError: false, details: undefined });
    await runtime.fire("agent_settled", { type: "agent_settled" });
    await runtime.fire("agent_settled", { type: "agent_settled" });
    assert.equal(runtime.sent.length, 1);
    assert.equal((await import("node:fs")).existsSync(join(root, ".coherence")), false);
  } finally { process.env = old; await rm(root, { recursive: true, force: true }); }
});

test("Pi extension — main settlement stays silent and child settlement triggers exactly one final report without pi-subagents", { concurrency: false }, async () => {
  const root = await fixture();
  const runtime = fakePi(root, "pi-child-session");
  const old = { ...process.env };
  process.env.PI_SUBAGENT_CHILD = "1";
  process.env.PI_SUBAGENT_CHILD_AGENT = "worker";
  try {
    registerPiHooks(runtime.pi);
    assert.deepEqual(runtime.emitted, [{ name: "subagent:acknowledge-extension", payload: { id: PI_COHERENCE_EXTENSION_ACK } }]);
    await runtime.fire("session_start", { type: "session_start", reason: "startup" });
    const started = await runtime.fire("before_agent_start", { type: "before_agent_start", systemPrompt: "base", prompt: "work" });
    assert.ok(started);
    assert.match(started.systemPrompt, /YOUR SESSION ID IS pi-child-session/);
    await runtime.fire("agent_settled", { type: "agent_settled" });
    await runtime.fire("agent_settled", { type: "agent_settled" });
  } finally {
    process.env = old;
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(runtime.sent.length, 1);
  assert.equal(runtime.sent[0]!.options?.triggerTurn, true);
  assert.equal(runtime.sent[0]!.options?.deliverAs, "followUp");
  assert.match(runtime.sent[0]!.message.content, /YOUR REPLY MUST RESTATE YOUR FINAL REPORT/);
});

test("Pi extension — main tool results use exact-session native telemetry without patching", { concurrency: false }, async () => {
  const root = await fixture();
  const runtime = fakePi(root, "pi-main-session");
  const old = { ...process.env };
  delete process.env.PI_SUBAGENT_CHILD;
  try {
    registerPiHooks(runtime.pi);
    await runtime.fire("session_start", { type: "session_start", reason: "startup" });
    const readResult = await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-read", toolName: "read", input: { file_path: "package.json" }, content: [{ type: "text", text: "{}" }], isError: false, details: undefined });
    assert.equal(readResult, undefined);
    const writeResult = await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-write", toolName: "write", input: { file_path: "observed.txt" }, content: [], isError: false, details: undefined });
    assert.equal(writeResult, undefined);
    const success = await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-1", toolName: "bash", input: { command: "coherence verify" }, content: [{ type: "text", text: "ok" }], isError: false, details: { exitCode: 0 } });
    assert.equal(success, undefined);
    const failure = await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-2", toolName: "bash", input: { command: "coherence verify" }, content: [], isError: false, details: { exitCode: 1 } });
    assert.equal(failure, undefined);
    const unknown = await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-3", toolName: "bash", input: { command: "coherence verify" }, content: [{ type: "text", text: "failed" }], isError: true, details: {} });
    assert.equal(unknown, undefined);
    assert.deepEqual(runtime.emitted, [{ name: "subagent:acknowledge-extension", payload: { id: PI_COHERENCE_EXTENSION_ACK } }]);
    const activity = await readFile(join(root, ".coherence/activity/pi-main-session.jsonl"), "utf8");
    assert.match(activity, /"host":"pi"/);
    assert.match(activity, /"transport":"native"/);
    assert.match(activity, /"result":"success"/);
    assert.match(activity, /"result":"failure"/);
    assert.match(activity, /"result":"unknown"/);
    const toolRows = activity.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((row) => row.event === "PostToolUse");
    assert.equal(toolRows.length, 5);
    assert.ok(toolRows.every((row) => row.attribution === "agent"));
    assert.ok(toolRows.every((row) => row.agentId === "pi-main-session"));
    const traces = await readFile(join(root, ".coherence/read-traces/pi-main-session.jsonl"), "utf8");
    assert.match(traces, /"path":"package.json"/);
    const trace = JSON.parse(traces.trim()) as { observation: { attribution: string; agentId: string | null } };
    assert.equal(trace.observation.attribution, "agent");
    assert.equal(trace.observation.agentId, "pi-main-session");
  } finally {
    process.env = old;
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi extension — an inactive later session cannot reuse prior activation state", { concurrency: false }, async () => {
  const activeRoot = await fixture();
  const dormantRoot = await mkdtemp(join(tmpdir(), "coherence-pi-dormant-"));
  const runtime = fakePi(activeRoot, "pi-child-session");
  const old = { ...process.env };
  process.env.PI_SUBAGENT_CHILD = "1";
  try {
    registerPiHooks(runtime.pi);
    await runtime.fire("session_start", { type: "session_start", reason: "startup" });
    runtime.setContext(dormantRoot, "pi-unowned-session");
    delete process.env.PI_SUBAGENT_CHILD;
    await runtime.fire("session_start", { type: "session_start", reason: "reload" });
    const started = await runtime.fire("before_agent_start", { type: "before_agent_start", systemPrompt: "base", prompt: "work" });
    assert.equal(started, undefined);
    await runtime.fire("agent_settled", { type: "agent_settled" });
    assert.equal(runtime.sent.length, 0);
  } finally {
    process.env = old;
    await rm(activeRoot, { recursive: true, force: true });
    await rm(dormantRoot, { recursive: true, force: true });
  }
});

test("Pi extension — child lifecycle uses child project voice at startup and completion", { concurrency: false }, async () => {
  const root = await fixture();
  await mkdir(join(root, ".coherence/hooks"), { recursive: true });
  await writeFile(join(root, ".coherence/hooks/SessionStart.override.md"), "MAIN START {{session}}\n");
  await writeFile(join(root, ".coherence/hooks/SubagentStart.override.md"), "CHILD START {{session}}\n");
  await writeFile(join(root, ".coherence/hooks/SubagentStop.override.md"), "CHILD STOP {{session}}\n");
  await writeFile(join(root, ".coherence/hooks/SubagentStop.append.md"), "CHILD APPEND {{session}}\n");
  const runtime = fakePi(root, "pi-child-voice");
  const old = { ...process.env };
  process.env.PI_SUBAGENT_CHILD = "1";
  try {
    registerPiHooks(runtime.pi);
    await runtime.fire("session_start", { type: "session_start", reason: "startup" });
    const started = await runtime.fire("before_agent_start", { type: "before_agent_start", systemPrompt: "base", prompt: "work" });
    assert.ok(started);
    assert.match(started.systemPrompt, /CHILD START pi-child-voice/);
    assert.doesNotMatch(started.systemPrompt, /MAIN START/);
    await runtime.fire("agent_settled", { type: "agent_settled" });
    assert.equal(runtime.sent.length, 1);
    assert.equal(runtime.sent[0]!.message.content.match(/CHILD STOP pi-child-voice/g)?.length, 1);
    assert.equal(runtime.sent[0]!.message.content.match(/CHILD APPEND pi-child-voice/g)?.length, 1);
    assert.doesNotMatch(runtime.sent[0]!.message.content, /YOUR REPLY MUST RESTATE/);
  } finally { process.env = old; await rm(root, { recursive: true, force: true }); }
});

test("Pi extension — orphan child labels never grant child settlement authority", { concurrency: false }, async () => {
  const root = await fixture();
  const runtime = fakePi(root, "pi-orphan-label");
  const old = { ...process.env };
  delete process.env.PI_SUBAGENT_CHILD;
  process.env.PI_SUBAGENT_CHILD_AGENT = "worker";
  try {
    registerPiHooks(runtime.pi);
    await runtime.fire("session_start", { type: "session_start", reason: "startup" });
    await runtime.fire("agent_settled", { type: "agent_settled" });
    assert.equal(runtime.sent.length, 0);
    const activity = await readFile(join(root, ".coherence/activity/pi-orphan-label.jsonl"), "utf8");
    assert.match(activity, /\"event\":\"Stop\"/);
    assert.doesNotMatch(activity, /SubagentStop/);
  } finally { process.env = old; await rm(root, { recursive: true, force: true }); }
});

test("Pi extension — settlement continues when activity persistence fails", { concurrency: false }, async () => {
  for (const child of [false, true]) {
    const root = await fixture();
    const runtime = fakePi(root, child ? "pi-hostile-child" : "pi-hostile-main");
    const old = { ...process.env };
    if (child) process.env.PI_SUBAGENT_CHILD = "1"; else delete process.env.PI_SUBAGENT_CHILD;
    try {
      registerPiHooks(runtime.pi);
      if (!child) {
        await writeFile(join(root, "observed.txt"), "baseline\n");
        execFileSync("git", ["init", "-q"], { cwd: root });
        execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
        execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
        execFileSync("git", ["add", "."], { cwd: root });
        execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });
        await writeFile(join(root, "observed.txt"), "changed\n");
      }
      await runtime.fire("session_start", { type: "session_start", reason: "startup" });
      if (!child) {
        await runtime.fire("tool_result", { type: "tool_result", toolCallId: "hostile-write", toolName: "write", input: { file_path: "observed.txt" }, content: [], isError: false, details: undefined });
        await runtime.fire("tool_result", { type: "tool_result", toolCallId: "hostile-read", toolName: "read", input: { file_path: "package.json" }, content: [], isError: false, details: undefined });
      }
      await rm(join(root, ".coherence/activity"), { recursive: true, force: true });
      await writeFile(join(root, ".coherence/activity"), "hostile\n");
      await runtime.fire("agent_settled", { type: "agent_settled" });
      if (child) assert.equal(runtime.sent.length, 1);
      else {
        assert.equal(runtime.sent.length, 0);
        assert.equal(readCalibrationSamples(await loadConfig(root)).length, 1);
      }
    } finally { process.env = old; await rm(root, { recursive: true, force: true }); }
  }
});

test("Pi extension — one fallback session identity survives repeated starts", { concurrency: false }, async () => {
  const root = await fixture();
  const runtime = fakePi(root);
  const old = { ...process.env };
  delete process.env.PI_SUBAGENT_CHILD;
  try {
    registerPiHooks(runtime.pi);
    await runtime.fire("session_start", { type: "session_start", reason: "startup" });
    const first = await runtime.fire("before_agent_start", { type: "before_agent_start", systemPrompt: "base", prompt: "one" });
    await runtime.fire("session_start", { type: "session_start", reason: "reload" });
    const second = await runtime.fire("before_agent_start", { type: "before_agent_start", systemPrompt: "base", prompt: "two" });
    assert.ok(first);
    assert.ok(second);
    const id = (first.systemPrompt.match(/YOUR SESSION ID IS ([^.]*)\./) ?? [])[1];
    assert.ok(id);
    assert.match(second.systemPrompt, new RegExp(`YOUR SESSION ID IS ${id}\\.`));
  } finally { process.env = old; await rm(root, { recursive: true, force: true }); }
});

test("Pi extension — main settlement records exact-session evidence without sending a model message", { concurrency: false }, async () => {
  const root = await fixture();
  const runtime = fakePi(root, "pi-main-settlement");
  const old = { ...process.env };
  delete process.env.PI_SUBAGENT_CHILD;
  delete process.env.PI_SUBAGENT_CHILD_AGENT;
  try {
    registerPiHooks(runtime.pi);
    await writeFile(join(root, "observed.txt"), "baseline\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });
    await writeFile(join(root, "observed.txt"), "changed\n");
    await runtime.fire("session_start", { type: "session_start", reason: "startup" });
    await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-write-main", toolName: "write", input: { file_path: "observed.txt" }, content: [], isError: false, details: undefined });
    await runtime.fire("tool_result", { type: "tool_result", toolCallId: "call-read-main", toolName: "read", input: { file_path: "package.json" }, content: [{ type: "text", text: "{}" }], isError: false, details: undefined });
    await runtime.fire("agent_settled", { type: "agent_settled" });
    assert.equal(runtime.sent.length, 0);
    const cfg = await loadConfig(root);
    const samples = readCalibrationSamples(cfg);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].session, "pi-main-settlement");
    assert.deepEqual(samples[0].changed, ["observed.txt"]);
    assert.deepEqual(samples[0].observed, ["package.json"]);
  } finally {
    process.env = old;
    await rm(root, { recursive: true, force: true });
  }
});
