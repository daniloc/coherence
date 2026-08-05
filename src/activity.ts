// activity.ts — the transient, per-session observation of hook traffic.
//
// The decision journal is durable memory and status.json is a repository-level run
// record. Hook traffic is neither: it is high-frequency, host-local evidence used to
// answer "what is this session doing now?" and whether a canonical launcher has ever
// reached the body. Keeping it in one append-only file per attributed session avoids a
// shared read/modify/write race while the blanket `.coherence/*` ignore keeps telemetry
// out of review diffs.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Config } from "./types.ts";

export type ActivityHost = "claude" | "codex" | "unknown";
export type ActivityTransport = "launcher" | "direct";
export type ActivityAttribution = "agent" | "session" | "parent-fallback" | "unknown";
export type ActivityCommandKind = "verification" | "intervention";
export type ActivityCommandResult = "success" | "failure" | "unknown";

export interface ActivityCommand {
  kind: ActivityCommandKind;
  name: "verify" | "regulate";
  /** Present only for the deliberately small, shell-operator-free command grammar. */
  command: string;
  result: ActivityCommandResult;
  exitCode?: number;
}

export interface ActivityRow {
  version: 1;
  at: string;
  host: ActivityHost;
  transport: ActivityTransport;
  /** Hash of the canonical host bundle the caller says launched this body. */
  bundleHash: string | null;
  /** The file/summary key: agent id when known, otherwise the session id below. */
  session: string;
  /** Codex tool hooks expose only this parent id for subagents; ambiguity stays visible. */
  parentSession: string | null;
  agentId: string | null;
  attribution: ActivityAttribution;
  event: string;
  turn: string | null;
  tool: string | null;
  toolUseId: string | null;
  /** Stable only where the host supplied a turn or tool-call id; null events never dedupe. */
  eventId: string | null;
  experimentId: string | null;
  command?: ActivityCommand;
}

export interface ActivityContext {
  host: ActivityHost;
  transport: ActivityTransport;
  bundleHash: string | null;
  experimentId: string | null;
}

export interface ActivityRead {
  rows: ActivityRow[];
  unreadable: number;
}

export interface ActivityCommandCounts {
  total: number;
  success: number;
  failure: number;
  unknown: number;
}

export interface ActivityCounts {
  /** Unique event count after replay collapse. */
  rows: number;
  /** Physical append count, useful when diagnosing a duplicated hook path. */
  rawRows: number;
  duplicates: number;
  events: Record<string, number>;
  tools: Record<string, number>;
  verification: ActivityCommandCounts;
  intervention: ActivityCommandCounts;
}

export interface CurrentSessionSummary {
  session: string;
  unreadable: number;
  /** All rows remain inspectable, including deliberate/manual probes. */
  all: ActivityCounts;
  /** Only these rows are runtime evidence that canonical installed wiring reached us. */
  launcher: ActivityCounts;
  latest: ActivityRow | null;
  latestLauncher: ActivityRow | null;
}

const activityDir = (cfg: Config) => join(cfg.root, ".coherence", "activity");

/** Filesystem-safe and collision-resistant when sanitising changes the caller's id. */
function slug(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "").replace(/[-.]+$/, "").replace(/-{2,}/g, "-");
  const safe = (clean || "x").slice(0, 80);
  return safe === raw ? safe : `${safe}-${createHash("sha256").update(raw).digest("hex").slice(0, 8)}`;
}

export const activityPath = (cfg: Config, session: string): string =>
  join(activityDir(cfg), `${slug(session)}.jsonl`);

const HOSTS = new Set<string>(["claude", "codex", "unknown"]);
const ATTRIBUTIONS = new Set<string>(["agent", "session", "parent-fallback", "unknown"]);
const RESULTS = new Set<string>(["success", "failure", "unknown"]);

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function eventIdentity(
  session: string,
  event: string,
  turn: string | null,
  toolUseId: string | null,
): string | null {
  const stable = toolUseId ? ["tool", session, event, turn ?? "", toolUseId]
    : turn ? ["turn", session, event, turn]
    : null;
  return stable
    ? "e-" + createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16)
    : null;
}

/**
 * Resolve attribution once for every reader/writer. PostToolUse without an agent id is
 * intentionally called `parent-fallback`: Codex supplies the parent session id there even
 * when the tool ran in a subagent, so calling it exact session attribution would be a lie.
 */
export function activityAttribution(
  event: string,
  payload: unknown,
): Pick<ActivityRow, "session" | "parentSession" | "agentId" | "attribution"> {
  const p = object(payload);
  const parentSession = text(p.session_id ?? p.sessionId);
  const agentId = text(p.agent_id ?? p.agentId);
  if (agentId) {
    return { session: agentId, parentSession, agentId, attribution: "agent" };
  }
  if (parentSession) {
    return event === "PostToolUse"
      ? { session: parentSession, parentSession, agentId: null, attribution: "parent-fallback" }
      : { session: parentSession, parentSession: null, agentId: null, attribution: "session" };
  }
  return { session: "unknown", parentSession: null, agentId: null, attribution: "unknown" };
}

/** The only accepted shell argv vocabulary. Quotes, substitutions and operators are out. */
const SAFE_WORD = /^[A-Za-z0-9_./:@%+=,-]+$/;

function exactCoherenceArgv(command: string): string[] | null {
  if (!command.length || command !== command.trim() || /[\r\n]/.test(command)) return null;
  const argv = command.split(/[ \t]+/);
  if (argv.some((word) => !word || !SAFE_WORD.test(word))) return null;
  if (argv[0] === "coherence") return argv.slice(1);
  if (argv[0] === "npx" && argv[1] === "coherence") return argv.slice(2);
  if (argv[0] === "node" && (argv[1] === "src/cli.ts" || argv[1] === "./src/cli.ts")) return argv.slice(2);
  return null;
}

function explicitExitCode(response: unknown): number | undefined {
  const r = object(response);
  const raw = r.exit_code ?? r.exitCode;
  return typeof raw === "number" && Number.isInteger(raw) ? raw : undefined;
}

/**
 * Recognize only a bare `verify` or `regulate` invocation observed as the Bash tool.
 * A log line, quoted example, pipeline, wrapper, command substitution, or compound shell
 * command is not execution evidence. The result is likewise unknown without an explicit
 * numeric exit-code field in the structured tool response.
 */
export function classifyActivityCommand(payload: unknown): ActivityCommand | undefined {
  const p = object(payload);
  if (text(p.tool_name ?? p.toolName) !== "Bash") return undefined;
  const input = object(p.tool_input ?? p.toolInput);
  const command = text(input.command);
  if (!command) return undefined;
  const argv = exactCoherenceArgv(command);
  const name = argv?.[0];
  if (name !== "verify" && name !== "regulate") return undefined;
  const exitCode = explicitExitCode(p.tool_response ?? p.toolResponse);
  return {
    kind: name === "verify" ? "verification" : "intervention",
    name,
    command,
    result: exitCode === undefined ? "unknown" : exitCode === 0 ? "success" : "failure",
    ...(exitCode === undefined ? {} : { exitCode }),
  };
}

/** Pure payload conversion; exported so hook wiring can be tested without filesystem I/O. */
export function activityRow(
  event: string,
  payload: unknown,
  context: ActivityContext,
  now = new Date().toISOString(),
): ActivityRow {
  const p = object(payload);
  const attribution = activityAttribution(event, payload);
  const command = event === "PostToolUse" ? classifyActivityCommand(payload) : undefined;
  const turn = text(p.turn_id ?? p.turnId);
  const toolUseId = text(p.tool_use_id ?? p.toolUseId);
  const eventId = eventIdentity(attribution.session, event, turn, toolUseId);
  return {
    version: 1,
    at: now,
    host: context.host,
    transport: context.transport,
    bundleHash: text(context.bundleHash),
    ...attribution,
    event,
    turn,
    tool: text(p.tool_name ?? p.toolName),
    toolUseId,
    eventId,
    experimentId: text(context.experimentId),
    ...(command ? { command } : {}),
  };
}

/** One append and no graph/config/git work: safe on the high-frequency hook path. */
export function recordActivity(
  cfg: Config,
  event: string,
  payload: unknown,
  context: ActivityContext,
  now = new Date().toISOString(),
): ActivityRow {
  const row = activityRow(event, payload, context, now);
  mkdirSync(activityDir(cfg), { recursive: true });
  appendFileSync(activityPath(cfg, row.session), JSON.stringify(row) + "\n");
  return row;
}

function isActivityRow(value: unknown, session: string): value is ActivityRow {
  const row = object(value);
  if (row.version !== 1 || row.session !== session || !text(row.at) || !text(row.event)
    || !HOSTS.has(String(row.host)) || (row.transport !== "launcher" && row.transport !== "direct")
    || !ATTRIBUTIONS.has(String(row.attribution))) return false;
  for (const key of ["bundleHash", "parentSession", "agentId", "turn", "tool", "toolUseId", "eventId", "experimentId"] as const) {
    if (row[key] !== null && !text(row[key])) return false;
  }
  const expected = eventIdentity(session, String(row.event), row.turn as string | null, row.toolUseId as string | null);
  if (row.eventId !== expected) return false;
  if (row.command !== undefined) {
    const command = object(row.command);
    if ((command.kind !== "verification" && command.kind !== "intervention")
      || (command.name !== "verify" && command.name !== "regulate")
      || !text(command.command) || !RESULTS.has(String(command.result))
      || (command.exitCode !== undefined && !(typeof command.exitCode === "number" && Number.isInteger(command.exitCode)))) {
      return false;
    }
  }
  return true;
}

/** A torn or foreign row is skipped and counted, never converted into no activity. */
export function readActivity(cfg: Config, session: string): ActivityRead {
  const path = activityPath(cfg, session);
  if (!existsSync(path)) return { rows: [], unreadable: 0 };
  const rows: ActivityRow[] = [];
  let unreadable = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isActivityRow(parsed, session)) rows.push(parsed);
      else unreadable++;
    } catch { unreadable++; }
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  return { rows, unreadable };
}

const zeroCommands = (): ActivityCommandCounts => ({ total: 0, success: 0, failure: 0, unknown: 0 });

function counts(rows: ActivityRow[]): ActivityCounts {
  // Last replay wins: if a first delivery lacked a structured result and a replay carries
  // it, the summary learns the result without counting the command twice. Events without
  // a host identity remain distinct because inventing identity would hide real starts.
  const byIdentity = new Map<string, ActivityRow>();
  const unique: ActivityRow[] = [];
  for (const row of rows) {
    if (!row.eventId) { unique.push(row); continue; }
    byIdentity.set(row.eventId, row);
  }
  unique.push(...byIdentity.values());
  const out: ActivityCounts = {
    rows: unique.length,
    rawRows: rows.length,
    duplicates: rows.length - unique.length,
    events: {}, tools: {}, verification: zeroCommands(), intervention: zeroCommands(),
  };
  for (const row of unique) {
    out.events[row.event] = (out.events[row.event] ?? 0) + 1;
    if (row.tool) out.tools[row.tool] = (out.tools[row.tool] ?? 0) + 1;
    if (row.command) {
      const bucket = row.command.kind === "verification" ? out.verification : out.intervention;
      bucket.total++;
      bucket[row.command.result]++;
    }
  }
  return out;
}

/**
 * The launcher view is separate by construction. A direct/manual body invocation remains
 * useful diagnostic activity but cannot become proof that installed, trusted wiring ran.
 */
export function currentSessionSummary(cfg: Config, session: string): CurrentSessionSummary {
  const { rows, unreadable } = readActivity(cfg, session);
  const launcher = rows.filter((row) => row.transport === "launcher");
  return {
    session,
    unreadable,
    all: counts(rows),
    launcher: counts(launcher),
    latest: rows.at(-1) ?? null,
    latestLauncher: launcher.at(-1) ?? null,
  };
}
