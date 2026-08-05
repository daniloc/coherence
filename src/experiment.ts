// experiment.ts — a first-class, append-only record of an agent's planned inference loop.
//
// A decision records what won. An experiment records the loop that was supposed to
// produce evidence before anybody knew what would win: a hypothesis, predicted reading
// surface, inert planned actions, observable success criteria, and the evidence actually
// gathered. Keeping that record separate from decisions matters. A failed experiment is
// still a successfully closed loop, and neither "success" nor "failure" means a later
// calibration label is "clean" or "defect".
//
// ONE FILE PER WRITING SESSION keeps parallel writers apart. Open rows live in the owner
// session's file; close rows live in the assessor session's file. The merged reader ties
// them by experiment id and preserves both identities. Every public writer first performs
// the strict merged read: malformed history, a dangling close, or competing close records
// refuses the next append instead of laundering an ambiguous ledger into a new fact.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { basename, join, posix } from "node:path";
import { readActivity, type ActivityRow } from "./activity.ts";
import { slug } from "./decisions.ts";
import { readTrace, type ReadEvent } from "./read-trace.ts";
import type { Config } from "./types.ts";

export const EXPERIMENT_VERSION = 1 as const;
export type ExperimentOutcome = "success" | "failure" | "inconclusive";
export type ExperimentActionStatus = "followed" | "revised" | "skipped" | "unknown";
export type ExperimentCriterionStatus = "met" | "unmet" | "unknown";

export interface ExperimentPlanItem {
  id: string;
  text: string;
}

export interface ExperimentRepoSnapshot {
  branch: string | null;
  commit: string | null;
  /** null means git could not answer; it is never silently reported as a clean tree. */
  dirty: boolean | null;
}

export interface ExperimentOpened {
  version: typeof EXPERIMENT_VERSION;
  event: "opened";
  id: string;
  at: string;
  /** Sequence within the owner session. It makes a repeated plan after closure new. */
  ordinal: number;
  session: string;
  agent: string;
  job: string;
  repo: ExperimentRepoSnapshot;
  hypothesis: string;
  predictedContext: string[];
  actions: ExperimentPlanItem[];
  criteria: ExperimentPlanItem[];
  /** Count of valid owner-session trace events that existed when the plan was opened. */
  traceCursor: number;
  /** Digest of the prefix behind the cursor; a reset/rewrite cannot masquerade as append. */
  tracePrefix: string;
  /** Same append-prefix contract for lifecycle/command evidence. */
  activityCursor: number;
  activityPrefix: string;
  /** Host event identities already present; a later replay cannot become post-plan work. */
  activityKnownEvents: string[];
}

export interface ExperimentActionResult {
  id: string;
  status: ExperimentActionStatus;
  evidence: string;
}

export interface ExperimentCriterionResult {
  id: string;
  status: ExperimentCriterionStatus;
  evidence: string;
}

export interface ExperimentTraceEvidence {
  attribution: "owner-session";
  session: string;
  start: number;
  end: number;
  events: ReadEvent[];
}

export interface ExperimentActivityEvidence {
  attribution: "owner-session";
  session: string;
  start: number;
  end: number;
  /** Raw rows are frozen; stats collapse only rows carrying the same host eventId. */
  rows: ActivityRow[];
}

export interface ExperimentAssessor {
  session: string;
  agent: string;
  job: string;
}

export interface ExperimentClosed {
  version: typeof EXPERIMENT_VERSION;
  event: "closed";
  id: string;
  at: string;
  experiment: string;
  ownerSession: string;
  assessor: ExperimentAssessor;
  repo: ExperimentRepoSnapshot;
  actionResults: ExperimentActionResult[];
  criterionResults: ExperimentCriterionResult[];
  /** Derived solely from criterionResults; callers never supply this value. */
  outcome: ExperimentOutcome;
  trace: ExperimentTraceEvidence;
  activity: ExperimentActivityEvidence;
}

export type ExperimentRecord = ExperimentOpened | ExperimentClosed;

export interface Experiment {
  opened: ExperimentOpened;
  closed: ExperimentClosed | null;
}

export interface ExperimentLedger {
  /** Exact duplicate retries collapse in this resolved view; disk history stays append-only. */
  records: ExperimentRecord[];
  experiments: Experiment[];
  open: Experiment[];
  closed: Experiment[];
}

export interface CreateExperimentInput {
  /** Required exact host session. There is deliberately no branch/date or "unknown" fallback. */
  session: string;
  hypothesis: string;
  predictedContext: string[];
  /** Inert labels. This module stores them and never executes them. */
  actions: string[];
  criteria: string[];
  agent?: string;
  job?: string;
  now?: string;
}

export interface CloseExperimentInput {
  experiment: string;
  /** Exact assessor session; the owner remains the session on the open record. */
  session: string;
  actionResults: ExperimentActionResult[];
  criterionResults: ExperimentCriterionResult[];
  agent?: string;
  job?: string;
  now?: string;
}

export interface ExperimentStats {
  experiments: number;
  open: number;
  closed: number;
  outcomes: Record<ExperimentOutcome, number>;
  actionResults: Record<ExperimentActionStatus, number>;
  criterionResults: Record<ExperimentCriterionStatus, number>;
  traceEvents: number;
  activityRows: number;
  activityEvents: number;
  activityDuplicates: number;
  /** Canonical launcher observations; direct/manual probes remain separate below. */
  verification: ExperimentCommandCounts;
  intervention: ExperimentCommandCounts;
  directVerification: ExperimentCommandCounts;
  directIntervention: ExperimentCommandCounts;
  meanPredictedContextObserved: number;
  meanObservedReadsOutsidePlan: number;
}

export interface ExperimentCommandCounts {
  total: number;
  success: number;
  failure: number;
  unknown: number;
}

export interface RenderExperimentOpts {
  id?: string | null;
  session?: string | null;
  openOnly?: boolean;
}

/** A refusal a CLI can print without mistaking damaged evidence for "no experiments". */
export class ExperimentLedgerError extends Error {
  readonly problems: string[];

  constructor(problems: string | string[]) {
    const all = Array.isArray(problems) ? problems : [problems];
    super(`experiment ledger refused: ${all.join("; ")}`);
    this.name = "ExperimentLedgerError";
    this.problems = all;
  }
}

export function experimentsDir(cfg: Config): string {
  return join(cfg.root, ".coherence", "experiments");
}

export function experimentSessionPath(cfg: Config, session: string): string {
  return join(experimentsDir(cfg), `${slug(session)}.jsonl`);
}

function exactSession(value: string, role: "owner" | "assessor"): string {
  const session = typeof value === "string" ? value.trim() : "";
  if (!session || session === "unknown") {
    throw new ExperimentLedgerError(`${role} session must be an exact non-empty host session, never '${session || "empty"}'`);
  }
  return session;
}

function nonempty(value: string, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ExperimentLedgerError(`${field} must be non-empty`);
  return text;
}

function iso(value: string | undefined, field = "time"): string {
  const at = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) {
    throw new ExperimentLedgerError(`${field} must be a canonical ISO timestamp`);
  }
  return at;
}

function repoPath(value: string): string {
  const raw = nonempty(value, "predicted context path").replace(/\\/g, "/");
  const path = posix.normalize(raw.replace(/^\.\//, ""));
  if (path === "." || path.startsWith("/") || path === ".." || path.startsWith("../")) {
    throw new ExperimentLedgerError(`predicted context path must stay inside the repository: ${value}`);
  }
  return path;
}

function unique<T>(values: T[]): boolean {
  return new Set(values).size === values.length;
}

function planItems(kind: "action" | "criterion", values: string[]): ExperimentPlanItem[] {
  if (!Array.isArray(values) || !values.length) throw new ExperimentLedgerError(`at least one ${kind} is required`);
  const texts = values.map((x, i) => nonempty(x, `${kind} ${i + 1}`));
  if (!unique(texts)) throw new ExperimentLedgerError(`${kind}s must be distinct`);
  const prefix = kind === "action" ? "a" : "s";
  return texts.map((text, i) => ({ id: `${prefix}${i + 1}`, text }));
}

function predictedContext(values: string[]): string[] {
  if (!Array.isArray(values) || !values.length) throw new ExperimentLedgerError("at least one predicted context path is required");
  return [...new Set(values.map(repoPath))].sort();
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const traceDigest = (events: ReadEvent[]) => digest(events.map(traceEvent));
const activityDigest = (rows: ActivityRow[]) => digest(rows.map(activityEvent));
const recordId = (prefix: "e" | "x", value: unknown) => `${prefix}-${digest(value).slice(0, 12)}`;

function traceEvent(event: ReadEvent): ReadEvent {
  return {
    at: event.at, session: event.session, tool: event.tool, mode: event.mode, path: event.path,
    ...(event.provenance ? { provenance: { ...event.provenance } } : {}),
  };
}

function exactTrace(cfg: Config, session: string, when: string): ReadEvent[] {
  const rows = readTrace(cfg, session).map(traceEvent);
  for (const [index, row] of rows.entries()) {
    if (row.session !== session || !row.tool?.trim() || !Number.isFinite(Date.parse(row.at))
      || new Date(row.at).toISOString() !== row.at || (row.mode !== "read" && row.mode !== "write")) {
      throw new ExperimentLedgerError(`${session} trace row ${index + 1} is not exact owner-session evidence ${when}`);
    }
    let normalized = "";
    try { normalized = repoPath(row.path); }
    catch { /* named by the shared refusal below */ }
    if (normalized !== row.path) {
      throw new ExperimentLedgerError(`${session} trace row ${index + 1} has a non-canonical repository path ${when}`);
    }
    if (row.provenance && (row.provenance.source !== "apply_patch"
      || !["add", "update", "delete", "move"].includes(row.provenance.operation))) {
      throw new ExperimentLedgerError(`${session} trace row ${index + 1} has unknown provenance ${when}`);
    }
  }
  return rows;
}

function activityEvent(row: ActivityRow): ActivityRow {
  const base: ActivityRow = {
    version: 1,
    at: row.at,
    host: row.host,
    transport: row.transport,
    bundleHash: row.bundleHash,
    session: row.session,
    parentSession: row.parentSession,
    agentId: row.agentId,
    attribution: row.attribution,
    event: row.event,
    turn: row.turn,
    tool: row.tool,
    toolUseId: row.toolUseId,
    eventId: row.eventId,
    experimentId: row.experimentId,
  };
  return row.command
    ? { ...base, command: { ...row.command, ...(row.command.exitCode === undefined ? {} : { exitCode: row.command.exitCode }) } }
    : base;
}

function exactActivity(cfg: Config, session: string, when: string): ActivityRow[] {
  const read = readActivity(cfg, session);
  if (read.unreadable) {
    throw new ExperimentLedgerError(`${session} activity has ${read.unreadable} unreadable row(s) ${when}; exact attribution is unavailable`);
  }
  const ambiguous = read.rows.filter((row) => row.attribution !== "agent" && row.attribution !== "session");
  if (ambiguous.length) {
    throw new ExperimentLedgerError(`${session} activity has ${ambiguous.length} ambiguously attributed row(s) ${when}; exact attribution is unavailable`);
  }
  return read.rows.map(activityEvent);
}

function openIdentity(record: Omit<ExperimentOpened, "id" | "at">): unknown {
  return record;
}

function closeIdentity(record: Omit<ExperimentClosed, "id" | "at">): unknown {
  return record;
}

function repoSnapshot(root: string): ExperimentRepoSnapshot {
  const run = (args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const branchRun = run(["branch", "--show-current"]);
  const commitRun = run(["rev-parse", "HEAD"]);
  const statusRun = run(["status", "--porcelain"]);
  return {
    branch: branchRun.status === 0 && branchRun.stdout.trim() ? branchRun.stdout.trim() : null,
    commit: commitRun.status === 0 && commitRun.stdout.trim() ? commitRun.stdout.trim() : null,
    dirty: statusRun.status === 0 ? !!statusRun.stdout.trim() : null,
  };
}

function writeRecord(cfg: Config, session: string, record: ExperimentRecord): void {
  mkdirSync(experimentsDir(cfg), { recursive: true });
  appendFileSync(experimentSessionPath(cfg, session), JSON.stringify(record) + "\n");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(o: Record<string, unknown>, key: string, problems: string[], label: string): string {
  if (typeof o[key] !== "string" || !(o[key] as string).trim()) {
    problems.push(`${label}.${key} must be a non-empty string`);
    return "";
  }
  if ((o[key] as string) !== (o[key] as string).trim()) problems.push(`${label}.${key} must not have surrounding whitespace`);
  return o[key] as string;
}

function validateRepo(value: unknown, problems: string[], label: string): value is ExperimentRepoSnapshot {
  if (!isObject(value)) { problems.push(`${label}.repo must be an object`); return false; }
  if (!(value.branch === null || typeof value.branch === "string")) problems.push(`${label}.repo.branch must be string|null`);
  if (!(value.commit === null || typeof value.commit === "string")) problems.push(`${label}.repo.commit must be string|null`);
  if (!(value.dirty === null || typeof value.dirty === "boolean")) problems.push(`${label}.repo.dirty must be boolean|null`);
  return true;
}

function validateItems(value: unknown, prefix: "a" | "s", problems: string[], label: string): value is ExperimentPlanItem[] {
  if (!Array.isArray(value) || !value.length) { problems.push(`${label} must be a non-empty array`); return false; }
  const ids: string[] = [], texts: string[] = [];
  value.forEach((item, i) => {
    if (!isObject(item)) { problems.push(`${label}[${i}] must be an object`); return; }
    const id = stringField(item, "id", problems, `${label}[${i}]`);
    const text = stringField(item, "text", problems, `${label}[${i}]`);
    if (id !== `${prefix}${i + 1}`) problems.push(`${label}[${i}].id must be ${prefix}${i + 1}`);
    ids.push(id); texts.push(text);
  });
  if (!unique(ids)) problems.push(`${label} ids must be unique`);
  if (!unique(texts)) problems.push(`${label} text must be unique`);
  return true;
}

function validateResults(
  value: unknown,
  statuses: readonly string[],
  problems: string[],
  label: string,
): value is (ExperimentActionResult | ExperimentCriterionResult)[] {
  if (!Array.isArray(value) || !value.length) { problems.push(`${label} must be a non-empty array`); return false; }
  const ids: string[] = [];
  value.forEach((result, i) => {
    if (!isObject(result)) { problems.push(`${label}[${i}] must be an object`); return; }
    ids.push(stringField(result, "id", problems, `${label}[${i}]`));
    const status = stringField(result, "status", problems, `${label}[${i}]`);
    if (!statuses.includes(status)) problems.push(`${label}[${i}].status is not recognized`);
    stringField(result, "evidence", problems, `${label}[${i}]`);
  });
  if (!unique(ids)) problems.push(`${label} ids must be unique`);
  return true;
}

function validateTrace(value: unknown, problems: string[], label: string): value is ExperimentTraceEvidence {
  if (!isObject(value)) { problems.push(`${label}.trace must be an object`); return false; }
  if (value.attribution !== "owner-session") problems.push(`${label}.trace.attribution must be owner-session`);
  const session = stringField(value, "session", problems, `${label}.trace`);
  const start = value.start, end = value.end;
  if (!Number.isInteger(start) || (start as number) < 0) problems.push(`${label}.trace.start must be a non-negative integer`);
  if (!Number.isInteger(end) || (end as number) < 0) problems.push(`${label}.trace.end must be a non-negative integer`);
  if (Number.isInteger(start) && Number.isInteger(end) && (end as number) < (start as number)) {
    problems.push(`${label}.trace.end must not precede start`);
  }
  if (!Array.isArray(value.events)) { problems.push(`${label}.trace.events must be an array`); return false; }
  value.events.forEach((event, i) => {
    if (!isObject(event)) { problems.push(`${label}.trace.events[${i}] must be an object`); return; }
    const eventSession = stringField(event, "session", problems, `${label}.trace.events[${i}]`);
    stringField(event, "at", problems, `${label}.trace.events[${i}]`);
    stringField(event, "tool", problems, `${label}.trace.events[${i}]`);
    stringField(event, "path", problems, `${label}.trace.events[${i}]`);
    if (event.mode !== "read" && event.mode !== "write") problems.push(`${label}.trace.events[${i}].mode is not read|write`);
    if (eventSession && session && eventSession !== session) problems.push(`${label}.trace.events[${i}] belongs to another session`);
    if (event.provenance !== undefined) {
      if (!isObject(event.provenance) || event.provenance.source !== "apply_patch"
        || !["add", "update", "delete", "move"].includes(String(event.provenance.operation))) {
        problems.push(`${label}.trace.events[${i}].provenance is not recognized apply_patch provenance`);
      }
    }
  });
  if (Number.isInteger(start) && Number.isInteger(end) && value.events.length !== (end as number) - (start as number)) {
    problems.push(`${label}.trace event count does not match its cursor window`);
  }
  return true;
}

function validateActivity(value: unknown, problems: string[], label: string): value is ExperimentActivityEvidence {
  if (!isObject(value)) { problems.push(`${label}.activity must be an object`); return false; }
  if (value.attribution !== "owner-session") problems.push(`${label}.activity.attribution must be owner-session`);
  const session = stringField(value, "session", problems, `${label}.activity`);
  const start = value.start, end = value.end;
  if (!Number.isInteger(start) || (start as number) < 0) problems.push(`${label}.activity.start must be a non-negative integer`);
  if (!Number.isInteger(end) || (end as number) < 0) problems.push(`${label}.activity.end must be a non-negative integer`);
  if (Number.isInteger(start) && Number.isInteger(end) && (end as number) < (start as number)) {
    problems.push(`${label}.activity.end must not precede start`);
  }
  if (!Array.isArray(value.rows)) { problems.push(`${label}.activity.rows must be an array`); return false; }
  value.rows.forEach((row, i) => {
    const rowLabel = `${label}.activity.rows[${i}]`;
    if (!isObject(row)) { problems.push(`${rowLabel} must be an object`); return; }
    if (row.version !== 1) problems.push(`${rowLabel}.version must be 1`);
    const rowSession = stringField(row, "session", problems, rowLabel);
    stringField(row, "at", problems, rowLabel);
    stringField(row, "event", problems, rowLabel);
    if (rowSession && session && rowSession !== session) problems.push(`${rowLabel} belongs to another session`);
    if (row.attribution !== "agent" && row.attribution !== "session") {
      problems.push(`${rowLabel}.attribution is not exact agent|session attribution`);
    }
    if (row.transport !== "launcher" && row.transport !== "direct") problems.push(`${rowLabel}.transport is not launcher|direct`);
    if (row.host !== "claude" && row.host !== "codex" && row.host !== "unknown") problems.push(`${rowLabel}.host is not recognized`);
    for (const key of ["bundleHash", "parentSession", "agentId", "turn", "tool", "toolUseId", "eventId", "experimentId"] as const) {
      if (row[key] !== null && (typeof row[key] !== "string" || !(row[key] as string).length)) {
        problems.push(`${rowLabel}.${key} must be string|null`);
      }
    }
    if (row.command !== undefined) {
      if (!isObject(row.command)) problems.push(`${rowLabel}.command must be an object`);
      else {
        if (row.command.kind !== "verification" && row.command.kind !== "intervention") problems.push(`${rowLabel}.command.kind is not recognized`);
        if (row.command.name !== "verify" && row.command.name !== "regulate") problems.push(`${rowLabel}.command.name is not recognized`);
        stringField(row.command, "command", problems, `${rowLabel}.command`);
        if (row.command.result !== "success" && row.command.result !== "failure" && row.command.result !== "unknown") {
          problems.push(`${rowLabel}.command.result is not recognized`);
        }
        if (row.command.exitCode !== undefined && !Number.isInteger(row.command.exitCode)) problems.push(`${rowLabel}.command.exitCode must be an integer`);
      }
    }
  });
  if (Number.isInteger(start) && Number.isInteger(end) && value.rows.length !== (end as number) - (start as number)) {
    problems.push(`${label}.activity row count does not match its cursor window`);
  }
  return true;
}

function parseRecord(raw: unknown, label: string, problems: string[]): ExperimentRecord | null {
  if (!isObject(raw)) { problems.push(`${label} must be a JSON object`); return null; }
  if (raw.version !== EXPERIMENT_VERSION) problems.push(`${label}.version must be ${EXPERIMENT_VERSION}`);
  if (raw.event !== "opened" && raw.event !== "closed") {
    problems.push(`${label}.event must be opened|closed`);
    return null;
  }
  const id = stringField(raw, "id", problems, label);
  const at = stringField(raw, "at", problems, label);
  if (at && (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at)) problems.push(`${label}.at must be a canonical ISO timestamp`);
  validateRepo(raw.repo, problems, label);

  if (raw.event === "opened") {
    const session = stringField(raw, "session", problems, label);
    if (session === "unknown") problems.push(`${label}.session may not be unknown`);
    stringField(raw, "agent", problems, label);
    stringField(raw, "job", problems, label);
    stringField(raw, "hypothesis", problems, label);
    if (!Number.isInteger(raw.ordinal) || (raw.ordinal as number) < 1) problems.push(`${label}.ordinal must be a positive integer`);
    if (!Array.isArray(raw.predictedContext) || !raw.predictedContext.length
      || raw.predictedContext.some((x) => typeof x !== "string" || !x.trim())) {
      problems.push(`${label}.predictedContext must be a non-empty string array`);
    } else {
      let normalized: string[] = [];
      try { normalized = [...new Set((raw.predictedContext as string[]).map(repoPath))].sort(); }
      catch (error) { problems.push((error as Error).message); }
      if (stable(normalized) !== stable(raw.predictedContext)) problems.push(`${label}.predictedContext must be normalized, unique, and sorted`);
    }
    validateItems(raw.actions, "a", problems, `${label}.actions`);
    validateItems(raw.criteria, "s", problems, `${label}.criteria`);
    if (!Number.isInteger(raw.traceCursor) || (raw.traceCursor as number) < 0) problems.push(`${label}.traceCursor must be a non-negative integer`);
    if (typeof raw.tracePrefix !== "string" || !/^[a-f0-9]{64}$/.test(raw.tracePrefix)) problems.push(`${label}.tracePrefix must be a sha256 digest`);
    if (!Number.isInteger(raw.activityCursor) || (raw.activityCursor as number) < 0) problems.push(`${label}.activityCursor must be a non-negative integer`);
    if (typeof raw.activityPrefix !== "string" || !/^[a-f0-9]{64}$/.test(raw.activityPrefix)) problems.push(`${label}.activityPrefix must be a sha256 digest`);
    if (!Array.isArray(raw.activityKnownEvents)
      || raw.activityKnownEvents.some((x) => typeof x !== "string" || !/^e-[a-f0-9]{16}$/.test(x))
      || !unique(raw.activityKnownEvents as string[])
      || stable([...(raw.activityKnownEvents as string[])].sort()) !== stable(raw.activityKnownEvents)) {
      problems.push(`${label}.activityKnownEvents must be unique event ids in sorted order`);
    }
    const record = raw as unknown as ExperimentOpened;
    if (id) {
      const { id: _id, at: _at, ...identity } = record;
      if (recordId("e", openIdentity(identity)) !== id) problems.push(`${label}.id does not match immutable open content`);
    }
    return record;
  }

  const experiment = stringField(raw, "experiment", problems, label);
  const ownerSession = stringField(raw, "ownerSession", problems, label);
  if (!isObject(raw.assessor)) problems.push(`${label}.assessor must be an object`);
  else {
    const session = stringField(raw.assessor, "session", problems, `${label}.assessor`);
    if (session === "unknown") problems.push(`${label}.assessor.session may not be unknown`);
    stringField(raw.assessor, "agent", problems, `${label}.assessor`);
    stringField(raw.assessor, "job", problems, `${label}.assessor`);
  }
  validateResults(raw.actionResults, ["followed", "revised", "skipped", "unknown"], problems, `${label}.actionResults`);
  validateResults(raw.criterionResults, ["met", "unmet", "unknown"], problems, `${label}.criterionResults`);
  if (raw.outcome !== "success" && raw.outcome !== "failure" && raw.outcome !== "inconclusive") problems.push(`${label}.outcome is not recognized`);
  validateTrace(raw.trace, problems, label);
  validateActivity(raw.activity, problems, label);
  const record = raw as unknown as ExperimentClosed;
  if (isObject(raw.assessor) && raw.assessor.session !== "unknown" && raw.trace && isObject(raw.trace)) {
    if (raw.trace.session !== ownerSession) problems.push(`${label}.trace must belong to owner session ${ownerSession}`);
  }
  if (raw.activity && isObject(raw.activity) && raw.activity.session !== ownerSession) {
    problems.push(`${label}.activity must belong to owner session ${ownerSession}`);
  }
  if (experiment && !/^e-[a-f0-9]{12}$/.test(experiment)) problems.push(`${label}.experiment is not an experiment id`);
  if (id) {
    const { id: _id, at: _at, ...identity } = record;
    if (recordId("x", closeIdentity(identity)) !== id) problems.push(`${label}.id does not match immutable close content`);
  }
  return record;
}

function resultSet<T extends { id: string; status: string; evidence: string }>(
  expected: ExperimentPlanItem[],
  supplied: T[],
  statuses: readonly string[],
  label: string,
): T[] {
  if (!Array.isArray(supplied)) throw new ExperimentLedgerError(`${label} must be an array`);
  const byId = new Map<string, T>();
  for (const result of supplied) {
    if (!result || typeof result !== "object") throw new ExperimentLedgerError(`${label} contains a non-object result`);
    const id = nonempty(result.id, `${label} id`);
    if (byId.has(id)) throw new ExperimentLedgerError(`${label} repeats ${id}`);
    if (!statuses.includes(result.status)) throw new ExperimentLedgerError(`${label} ${id} has unsupported status '${result.status}'`);
    const evidence = nonempty(result.evidence, `${label} ${id} evidence`);
    byId.set(id, { ...result, id, evidence });
  }
  const expectedIds = new Set(expected.map((x) => x.id));
  const missing = expected.filter((x) => !byId.has(x.id)).map((x) => x.id);
  const extra = [...byId.keys()].filter((id) => !expectedIds.has(id));
  if (missing.length || extra.length) {
    throw new ExperimentLedgerError(`${label} must cover every planned id exactly once`
      + `${missing.length ? `; missing ${missing.join(", ")}` : ""}${extra.length ? `; unknown ${extra.join(", ")}` : ""}`);
  }
  return expected.map((x) => byId.get(x.id)!);
}

export function deriveExperimentOutcome(results: ExperimentCriterionResult[]): ExperimentOutcome {
  if (results.some((x) => x.status === "unmet")) return "failure";
  if (results.length > 0 && results.every((x) => x.status === "met")) return "success";
  return "inconclusive";
}

/** Strict merged read. Exact duplicate rows collapse; every other ambiguity refuses. */
export function readExperiments(cfg: Config): ExperimentLedger {
  const dir = experimentsDir(cfg);
  if (!existsSync(dir)) return { records: [], experiments: [], open: [], closed: [] };
  const problems: string[] = [];
  const parsed: { record: ExperimentRecord; file: string; line: number }[] = [];
  for (const file of readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort()) {
    const lines = readFileSync(join(dir, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      const label = `${file}:${index + 1}`;
      let raw: unknown;
      try { raw = JSON.parse(line); }
      catch { problems.push(`${label} is malformed JSON`); return; }
      const record = parseRecord(raw, label, problems);
      if (record) parsed.push({ record, file, line: index + 1 });
    });
  }
  // Do not run relational checks through structurally invalid casts. The structural
  // damage is already a refusal, and reporting it is more useful than a TypeError from a
  // missing nested field.
  if (problems.length) throw new ExperimentLedgerError(problems);

  const byId = new Map<string, { record: ExperimentRecord; file: string; line: number }>();
  for (const row of parsed) {
    const writingSession = row.record.event === "opened" ? row.record.session : row.record.assessor.session;
    const expectedFile = basename(experimentSessionPath(cfg, writingSession));
    if (row.file !== expectedFile) problems.push(`${row.file}:${row.line} belongs in ${expectedFile}, the writing session's file`);
    const prior = byId.get(row.record.id);
    if (!prior) byId.set(row.record.id, row);
    else if (stable(prior.record) !== stable(row.record)) {
      problems.push(`${row.record.id} has conflicting immutable rows at ${prior.file}:${prior.line} and ${row.file}:${row.line}`);
    }
  }
  const records = [...byId.values()].map((x) => x.record)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const opens = records.filter((x): x is ExperimentOpened => x.event === "opened");
  const closes = records.filter((x): x is ExperimentClosed => x.event === "closed");
  const openById = new Map(opens.map((x) => [x.id, x]));
  const closeByTarget = new Map<string, ExperimentClosed>();

  for (const close of closes) {
    const opened = openById.get(close.experiment);
    if (!opened) { problems.push(`${close.id} closes dangling experiment ${close.experiment}`); continue; }
    if (close.ownerSession !== opened.session) problems.push(`${close.id} names owner ${close.ownerSession}, expected ${opened.session}`);
    if (close.at < opened.at) problems.push(`${close.id} closes ${opened.id} before it opened`);
    if (close.trace.session !== opened.session || close.trace.start !== opened.traceCursor) {
      problems.push(`${close.id} trace window is not anchored at ${opened.session}:${opened.traceCursor}`);
    }
    if (close.activity.session !== opened.session || close.activity.start !== opened.activityCursor) {
      problems.push(`${close.id} activity window is not anchored at ${opened.session}:${opened.activityCursor}`);
    }
    try {
      const actions = resultSet(opened.actions, close.actionResults,
        ["followed", "revised", "skipped", "unknown"], `${close.id} actionResults`);
      const criteria = resultSet(opened.criteria, close.criterionResults,
        ["met", "unmet", "unknown"], `${close.id} criterionResults`);
      if (stable(actions) !== stable(close.actionResults)) problems.push(`${close.id} actionResults are not in canonical plan order`);
      if (stable(criteria) !== stable(close.criterionResults)) problems.push(`${close.id} criterionResults are not in canonical plan order`);
      if (deriveExperimentOutcome(criteria) !== close.outcome) problems.push(`${close.id} outcome is not derived from criterion evidence`);
    } catch (error) {
      problems.push(...(error instanceof ExperimentLedgerError ? error.problems : [(error as Error).message]));
    }
    const prior = closeByTarget.get(close.experiment);
    if (prior && prior.id !== close.id) problems.push(`${close.experiment} has competing closes ${prior.id} and ${close.id}`);
    else closeByTarget.set(close.experiment, close);
  }

  const bySession = new Map<string, ExperimentOpened[]>();
  for (const opened of opens) bySession.set(opened.session, [...(bySession.get(opened.session) ?? []), opened]);
  for (const [session, rows] of bySession) {
    rows.sort((a, b) => a.ordinal - b.ordinal || a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    rows.forEach((row, i) => {
      if (row.ordinal !== i + 1) problems.push(`${session} experiment ordinals must be contiguous from 1; found ${row.ordinal} at position ${i + 1}`);
      if (i > 0) {
        const priorClose = closeByTarget.get(rows[i - 1].id);
        if (!priorClose) problems.push(`${session} opened ${row.id} while ${rows[i - 1].id} was still open`);
        else if (priorClose.at > row.at) problems.push(`${session} opened ${row.id} before ${rows[i - 1].id} closed`);
      }
    });
  }

  if (problems.length) throw new ExperimentLedgerError(problems);
  const experiments = opens
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    .map((opened) => ({ opened, closed: closeByTarget.get(opened.id) ?? null }));
  return {
    records,
    experiments,
    open: experiments.filter((x) => !x.closed),
    closed: experiments.filter((x) => !!x.closed),
  };
}

function requestedPlan(opened: ExperimentOpened): unknown {
  return {
    session: opened.session, agent: opened.agent, job: opened.job, hypothesis: opened.hypothesis,
    predictedContext: opened.predictedContext,
    actions: opened.actions.map((x) => x.text), criteria: opened.criteria.map((x) => x.text),
  };
}

/** Open one immutable plan. A byte-equivalent retry returns the standing row without append. */
export function createExperiment(cfg: Config, input: CreateExperimentInput): ExperimentOpened {
  const session = exactSession(input.session, "owner");
  const hypothesis = nonempty(input.hypothesis, "hypothesis");
  const context = predictedContext(input.predictedContext);
  const actions = planItems("action", input.actions);
  const criteria = planItems("criterion", input.criteria);
  const agent = nonempty(input.agent ?? process.env.COHERENCE_AGENT ?? "main", "agent");
  const ledger = readExperiments(cfg);
  const job = nonempty(input.job ?? process.env.COHERENCE_JOB ?? repoSnapshot(cfg.root).branch ?? "-", "job");
  const requested = {
    session, agent, job, hypothesis, predictedContext: context,
    actions: actions.map((x) => x.text), criteria: criteria.map((x) => x.text),
  };
  const standing = ledger.open.find((x) => x.opened.session === session)?.opened;
  if (standing) {
    if (stable(requestedPlan(standing)) === stable(requested)) return standing;
    throw new ExperimentLedgerError(`session ${session} already has open experiment ${standing.id}; close it before changing the plan`);
  }

  const trace = exactTrace(cfg, session, "at experiment open");
  const activity = exactActivity(cfg, session, "at experiment open");
  const at = iso(input.now, "open time");
  const ordinal = ledger.experiments.filter((x) => x.opened.session === session).length + 1;
  const body: Omit<ExperimentOpened, "id" | "at"> = {
    version: EXPERIMENT_VERSION,
    event: "opened",
    ordinal,
    session,
    agent,
    job,
    repo: repoSnapshot(cfg.root),
    hypothesis,
    predictedContext: context,
    actions,
    criteria,
    traceCursor: trace.length,
    tracePrefix: traceDigest(trace),
    activityCursor: activity.length,
    activityPrefix: activityDigest(activity),
    activityKnownEvents: [...new Set(activity.flatMap((row) => row.eventId ? [row.eventId] : []))].sort(),
  };
  const record: ExperimentOpened = { ...body, id: recordId("e", openIdentity(body)), at };
  writeRecord(cfg, session, record);
  return record;
}

function normalizedClose(
  opened: ExperimentOpened,
  input: CloseExperimentInput,
): { assessor: ExperimentAssessor; actionResults: ExperimentActionResult[]; criterionResults: ExperimentCriterionResult[] } {
  const assessor: ExperimentAssessor = {
    session: exactSession(input.session, "assessor"),
    agent: nonempty(input.agent ?? process.env.COHERENCE_AGENT ?? "main", "assessor agent"),
    job: nonempty(input.job ?? process.env.COHERENCE_JOB ?? "-", "assessor job"),
  };
  const actionResults = resultSet(opened.actions, input.actionResults,
    ["followed", "revised", "skipped", "unknown"], "actionResults") as ExperimentActionResult[];
  const criterionResults = resultSet(opened.criteria, input.criterionResults,
    ["met", "unmet", "unknown"], "criterionResults") as ExperimentCriterionResult[];
  return { assessor, actionResults, criterionResults };
}

/** Close a plan with total evidence. Outcome is derived; trace evidence is owner-only. */
export function closeExperiment(cfg: Config, input: CloseExperimentInput): ExperimentClosed {
  const target = nonempty(input.experiment, "experiment id");
  const ledger = readExperiments(cfg);
  const experiment = ledger.experiments.find((x) => x.opened.id === target);
  if (!experiment) throw new ExperimentLedgerError(`cannot close dangling experiment ${target}`);
  const normalized = normalizedClose(experiment.opened, input);
  if (experiment.closed) {
    const prior = experiment.closed;
    const same = stable({ assessor: prior.assessor, actionResults: prior.actionResults, criterionResults: prior.criterionResults })
      === stable(normalized);
    if (same) return prior;
    throw new ExperimentLedgerError(`${target} is already closed by immutable record ${prior.id}`);
  }

  const at = iso(input.now, "close time");
  if (at < experiment.opened.at) throw new ExperimentLedgerError(`close time must not precede ${target}'s open time`);
  const current = exactTrace(cfg, experiment.opened.session, `while closing ${target}`);
  if (current.length < experiment.opened.traceCursor) {
    throw new ExperimentLedgerError(`${target}'s owner trace shrank behind its cursor; no exact post-open window exists`);
  }
  const prefix = current.slice(0, experiment.opened.traceCursor);
  if (traceDigest(prefix) !== experiment.opened.tracePrefix) {
    throw new ExperimentLedgerError(`${target}'s owner trace prefix changed; refusing to invent post-open attribution`);
  }
  const events = current.slice(experiment.opened.traceCursor);
  const trace: ExperimentTraceEvidence = {
    attribution: "owner-session",
    session: experiment.opened.session,
    start: experiment.opened.traceCursor,
    end: current.length,
    events,
  };
  const currentActivity = exactActivity(cfg, experiment.opened.session, `while closing ${target}`);
  if (currentActivity.length < experiment.opened.activityCursor) {
    throw new ExperimentLedgerError(`${target}'s owner activity shrank behind its cursor; no exact post-open window exists`);
  }
  const activityPrefix = currentActivity.slice(0, experiment.opened.activityCursor);
  if (activityDigest(activityPrefix) !== experiment.opened.activityPrefix) {
    throw new ExperimentLedgerError(`${target}'s owner activity prefix changed; refusing to invent post-open attribution`);
  }
  const activity: ExperimentActivityEvidence = {
    attribution: "owner-session",
    session: experiment.opened.session,
    start: experiment.opened.activityCursor,
    end: currentActivity.length,
    rows: currentActivity.slice(experiment.opened.activityCursor),
  };
  const body: Omit<ExperimentClosed, "id" | "at"> = {
    version: EXPERIMENT_VERSION,
    event: "closed",
    experiment: target,
    ownerSession: experiment.opened.session,
    assessor: normalized.assessor,
    repo: repoSnapshot(cfg.root),
    actionResults: normalized.actionResults,
    criterionResults: normalized.criterionResults,
    outcome: deriveExperimentOutcome(normalized.criterionResults),
    trace,
    activity,
  };
  const record: ExperimentClosed = { ...body, id: recordId("x", closeIdentity(body)), at };
  writeRecord(cfg, normalized.assessor.session, record);
  return record;
}

const ratio = (n: number, d: number) => d ? n / d : 0;

const zeroCommandCounts = (): ExperimentCommandCounts => ({ total: 0, success: 0, failure: 0, unknown: 0 });

function resolvedActivity(rows: ActivityRow[]): ActivityRow[] {
  const identified = new Map<string, ActivityRow>();
  const anonymous: ActivityRow[] = [];
  for (const row of rows) {
    if (row.eventId) identified.set(row.eventId, row);
    else anonymous.push(row);
  }
  return [...anonymous, ...identified.values()];
}

/** Descriptive plan/observation association only. It assigns no clean/defect label. */
export function experimentStats(ledger: ExperimentLedger): ExperimentStats {
  const outcomes: Record<ExperimentOutcome, number> = { success: 0, failure: 0, inconclusive: 0 };
  const actionResults: Record<ExperimentActionStatus, number> = { followed: 0, revised: 0, skipped: 0, unknown: 0 };
  const criterionResults: Record<ExperimentCriterionStatus, number> = { met: 0, unmet: 0, unknown: 0 };
  const verification = zeroCommandCounts(), intervention = zeroCommandCounts();
  const directVerification = zeroCommandCounts(), directIntervention = zeroCommandCounts();
  let traceEvents = 0, coverage = 0, outside = 0;
  let activityRows = 0, activityEvents = 0;
  for (const experiment of ledger.closed) {
    const closed = experiment.closed!;
    outcomes[closed.outcome]++;
    for (const result of closed.actionResults) actionResults[result.status]++;
    for (const result of closed.criterionResults) criterionResults[result.status]++;
    traceEvents += closed.trace.events.length;
    activityRows += closed.activity.rows.length;
    const known = new Set(experiment.opened.activityKnownEvents);
    const activity = resolvedActivity(closed.activity.rows).filter((row) => !row.eventId || !known.has(row.eventId));
    activityEvents += activity.length;
    for (const row of activity) {
      if (!row.command) continue;
      const bucket = row.transport === "launcher"
        ? row.command.kind === "verification" ? verification : intervention
        : row.command.kind === "verification" ? directVerification : directIntervention;
      bucket.total++;
      bucket[row.command.result]++;
    }
    const predicted = new Set(experiment.opened.predictedContext);
    const reads = new Set(closed.trace.events.filter((x) => x.mode === "read").map((x) => x.path));
    coverage += ratio([...predicted].filter((x) => reads.has(x)).length, predicted.size);
    outside += ratio([...reads].filter((x) => !predicted.has(x)).length, reads.size);
  }
  return {
    experiments: ledger.experiments.length,
    open: ledger.open.length,
    closed: ledger.closed.length,
    outcomes,
    actionResults,
    criterionResults,
    traceEvents,
    activityRows,
    activityEvents,
    activityDuplicates: activityRows - activityEvents,
    verification,
    intervention,
    directVerification,
    directIntervention,
    meanPredictedContextObserved: ledger.closed.length ? coverage / ledger.closed.length : 0,
    meanObservedReadsOutsidePlan: ledger.closed.length ? outside / ledger.closed.length : 0,
  };
}

/** Human reading surface. Open loops lead; evidence remains attached to its criterion. */
export function renderExperiments(
  cfg: Config,
  opts: RenderExperimentOpts = {},
): { text: string; count: number; stats: ExperimentStats } {
  const ledger = readExperiments(cfg);
  const selected = ledger.experiments.filter((x) =>
    (!opts.id || x.opened.id === opts.id)
    && (!opts.session || x.opened.session === opts.session || x.closed?.assessor.session === opts.session)
    && (!opts.openOnly || !x.closed));
  const scoped: ExperimentLedger = {
    records: selected.flatMap((x) => [x.opened, ...(x.closed ? [x.closed] : [])]),
    experiments: selected,
    open: selected.filter((x) => !x.closed),
    closed: selected.filter((x) => !!x.closed),
  };
  const stats = experimentStats(scoped);
  const lines = ["PLAN EXPERIMENTS — planned inference loops and their evidence"];
  if (!selected.length) return { text: `${lines[0]}\n  no experiments`, count: 0, stats };
  lines.push(`  ${stats.experiments} experiment(s) · ${stats.open} open · ${stats.closed} closed`);

  const renderOne = (experiment: Experiment) => {
    const o = experiment.opened;
    lines.push("", `${experiment.closed ? experiment.closed.outcome.toUpperCase() : "OPEN"} ${o.id}  owner ${o.session}  ${o.at}`);
    lines.push(`  hypothesis: ${o.hypothesis}`);
    lines.push(`  predicted context: ${o.predictedContext.join(" · ")}`);
    for (const action of o.actions) lines.push(`  action ${action.id}: ${action.text}`);
    for (const criterion of o.criteria) lines.push(`  success ${criterion.id}: ${criterion.text}`);
    if (!experiment.closed) {
      lines.push(`  evidence starts at owner trace event ${o.traceCursor} and activity row ${o.activityCursor}; close requires evidence for every action and criterion.`);
      return;
    }
    const c = experiment.closed;
    lines.push(`  assessed by: ${c.assessor.session} (${c.assessor.agent}, ${c.assessor.job})`);
    for (const result of c.actionResults) lines.push(`  action ${result.id} ${result.status}: ${result.evidence}`);
    for (const result of c.criterionResults) lines.push(`  criterion ${result.id} ${result.status}: ${result.evidence}`);
    const reads = [...new Set(c.trace.events.filter((x) => x.mode === "read").map((x) => x.path))];
    const writes = [...new Set(c.trace.events.filter((x) => x.mode === "write").map((x) => x.path))];
    lines.push(`  owner-session trace ${c.trace.start}..${c.trace.end}: ${c.trace.events.length} event(s)`);
    if (reads.length) lines.push(`    reads: ${reads.join(" · ")}`);
    if (writes.length) lines.push(`    writes: ${writes.join(" · ")}`);
    const known = new Set(o.activityKnownEvents);
    const activity = resolvedActivity(c.activity.rows).filter((row) => !row.eventId || !known.has(row.eventId));
    lines.push(`  owner-session activity ${c.activity.start}..${c.activity.end}: ${c.activity.rows.length} raw row(s), ${activity.length} new event(s)`);
    for (const row of activity.filter((candidate) => candidate.command)) {
      const command = row.command!;
      lines.push(`    ${row.transport} ${command.kind} ${command.name}: ${command.result} — ${command.command}`);
    }
  };
  for (const experiment of [...scoped.open, ...scoped.closed]) renderOne(experiment);
  lines.push("", "  lower bound: only explicit path-bearing reads and recognized owner-session activity are observed.");
  lines.push("  experiment outcome is derived from stated criteria; it is not a clean/defect label or a causal claim.");
  return { text: lines.join("\n"), count: selected.length, stats };
}
