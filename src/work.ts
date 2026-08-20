// work.ts — an append-only work-order graph for coordinated agent work.
//
// A work order records intent and authority, not executable instructions. Planned
// actions are deliberately absent: this module can persist and render work, but it
// never shells out or dispatches an agent. One content-addressed event is appended to
// the exact writer session's file. State is a strict predecessor chain, so concurrent
// transitions cannot be hidden by timestamp ordering.
import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, writeSync,
} from "node:fs";
import { basename, join, posix } from "node:path";
import type { Config } from "./types.ts";

export const WORK_VERSION = 1 as const;

export type WorkRisk = "low" | "medium" | "high" | "critical";
export type WorkState = "open" | "active" | "blocked" | "completed" | "cancelled";
export type WorkOpenState = Exclude<WorkState, "completed" | "cancelled">;
export type WorkTerminalState = Extract<WorkState, "completed" | "cancelled">;
export type WorkReadiness = "ready" | "waiting" | "active" | "blocked" | "done";
export type WorkAuthorityKind = "user-directed" | "orchestrator-delegated" | "agent-local" | "external-approved";

export interface WorkActor {
  session: string;
  agent: string;
}

export interface WorkAuthority {
  kind: WorkAuthorityKind;
  /** The person, session, or control surface that granted the authority. */
  grantedBy: string;
  /** A plain-language limit on what this work order may change or approve. */
  boundary: string;
}

interface WorkRecordBase {
  version: typeof WORK_VERSION;
  id: string;
  at: string;
  /** Exact writer identity; ownership is separate and changes only through handoff. */
  session: string;
  agent: string;
  job: string;
  work: string;
}

export interface WorkOpened extends WorkRecordBase {
  event: "opened";
  parent: string | null;
  objective: string;
  criteria: string[];
  constraints: string[];
  nonGoals: string[];
  authority: WorkAuthority;
  owner: WorkActor;
  dependsOn: string[];
  readScopes: string[];
  writeScopes: string[];
  risk: WorkRisk;
  state: "open";
}

export interface WorkTransitioned extends WorkRecordBase {
  event: "transitioned";
  previous: string;
  from: WorkOpenState;
  to: WorkOpenState;
  reason: string;
  evidence: string[];
}

export interface WorkHandedOff extends WorkRecordBase {
  event: "handed-off";
  previous: string;
  fromOwner: WorkActor;
  toOwner: WorkActor;
  reason: string;
}

export interface WorkClosed extends WorkRecordBase {
  event: "closed";
  previous: string;
  from: WorkOpenState;
  to: WorkTerminalState;
  reason: string;
  resultEvidence: string[];
  /** Direct completed children whose results this closure explicitly incorporated. */
  synthesizedChildren: string[];
}

export type WorkRecord = WorkOpened | WorkTransitioned | WorkHandedOff | WorkClosed;

export interface CreateWorkInput {
  session: string;
  /** Optional caller-stable id. Omit to derive a content-stable wrk-* identity. */
  work?: string;
  parent?: string | null;
  objective: string;
  criteria: string[];
  constraints?: string[];
  nonGoals?: string[];
  authority: WorkAuthority;
  /** Defaults to the exact writer. An orchestrator may assign a different exact owner. */
  owner?: WorkActor;
  dependsOn?: string[];
  readScopes?: string[];
  writeScopes?: string[];
  risk: WorkRisk;
  agent?: string;
  job?: string;
  now?: string;
}

interface WorkChangeInput {
  work: string;
  session: string;
  reason: string;
  /** Optional compare-and-append token for callers coordinating concurrent writers. */
  expectedPrevious?: string;
  agent?: string;
  job?: string;
  now?: string;
}

export interface TransitionWorkInput extends WorkChangeInput {
  to: WorkOpenState;
  evidence?: string[];
}

export interface HandoffWorkInput extends WorkChangeInput {
  toOwner: WorkActor;
}

export interface CloseWorkInput extends WorkChangeInput {
  to: WorkTerminalState;
  resultEvidence?: string[];
  synthesizedChildren?: string[];
}

export type WorkGraphProblemKind =
  | "missing-parent"
  | "missing-dependency"
  | "parent-cycle"
  | "dependency-cycle"
  | "invalid-synthesis"
  | "missing-synthesis"
  | "terminal-parent"
  | "dependency-order";

export interface WorkGraphProblem {
  kind: WorkGraphProblemKind;
  work: string;
  related: string[];
  message: string;
}

export interface WorkGraphValidation {
  valid: boolean;
  problems: WorkGraphProblem[];
}

export interface WorkScopeOverlap {
  left: string;
  right: string;
  leftScope: string;
  rightScope: string;
  /** A conflict is runnable now; potential overlaps are serialized or explicitly blocked. */
  status: "conflict" | "potential";
}

export interface UnsynthesizedWorkChild {
  parent: string;
  child: string;
  reason: "parent-not-closed" | "not-listed-by-parent-closure";
}

export interface WorkItem {
  work: string;
  opened: WorkOpened;
  records: WorkRecord[];
  last: WorkRecord;
  state: WorkState;
  owner: WorkActor;
  closed: WorkClosed | null;
  readiness: WorkReadiness;
  blockedBy: string[];
  conflictsWith: string[];
}

export interface WorkStats {
  total: number;
  roots: number;
  dependencies: number;
  states: Record<WorkState, number>;
  readiness: Record<WorkReadiness, number>;
  risks: Record<WorkRisk, number>;
  graphProblems: number;
  scopeOverlaps: number;
  scopeConflicts: number;
  orphans: number;
  unsynthesizedChildren: number;
}

export interface WorkLedger {
  /** Exact duplicate rows collapse here; the append-only bytes remain untouched. */
  records: WorkRecord[];
  works: WorkItem[];
  validation: WorkGraphValidation;
  ready: WorkItem[];
  blocked: WorkItem[];
  scopeOverlaps: WorkScopeOverlap[];
  scopeConflicts: WorkScopeOverlap[];
  orphaned: WorkItem[];
  unsynthesized: UnsynthesizedWorkChild[];
  stats: WorkStats;
}

export interface RenderWorkOpts {
  work?: string | null;
  state?: WorkState | null;
}

export class WorkLedgerError extends Error {
  readonly problems: string[];

  constructor(problems: string | string[]) {
    const all = Array.isArray(problems) ? problems : [problems];
    super(`work ledger refused: ${all.join("; ")}`);
    this.name = "WorkLedgerError";
    this.problems = all;
  }
}

export function workDir(cfg: Config): string {
  return join(cfg.root, ".coherence", "work");
}

function sessionFilename(session: string): string {
  const key = createHash("sha256")
    .update("coherence:work-session\0")
    .update(session, "utf8")
    .digest("hex");
  return `s-${key}.jsonl`;
}

export function workSessionPath(cfg: Config, session: string): string {
  return join(workDir(cfg), sessionFilename(session));
}

function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}

const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const recordId = (value: unknown) => `wev-${digest(value).slice(0, 16)}`;

function nonempty(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new WorkLedgerError(`${field} must be non-empty`);
  if (value !== text) throw new WorkLedgerError(`${field} must not have surrounding whitespace`);
  if (/[\x00-\x1f\x7f-\x9f]/.test(text)) throw new WorkLedgerError(`${field} contains control bytes`);
  return text;
}

function exactSession(value: unknown, field = "session"): string {
  const session = nonempty(value, field);
  if (value !== session) throw new WorkLedgerError(`${field} must be an exact trimmed session label`);
  if (session === "unknown") throw new WorkLedgerError(`${field} must be exact, never 'unknown'`);
  return session;
}

function iso(value: string | undefined): string {
  const at = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) {
    throw new WorkLedgerError("time must be a canonical ISO timestamp");
  }
  return at;
}

function normalizeWorkId(value: unknown, field = "work"): string {
  const id = nonempty(value, field);
  if (!/^wrk-[a-z0-9][a-z0-9._-]{0,95}$/.test(id)) {
    throw new WorkLedgerError(`${field} must match wrk-[a-z0-9][a-z0-9._-]{0,95}`);
  }
  return id;
}

function textList(value: unknown, field: string, required = false): string[] {
  if (!Array.isArray(value)) throw new WorkLedgerError(`${field} must be an array`);
  const list = value.map((entry, index) => nonempty(entry, `${field}[${index}]`));
  if (required && !list.length) throw new WorkLedgerError(`${field} must contain at least one item`);
  if (new Set(list).size !== list.length) throw new WorkLedgerError(`${field} must contain distinct items`);
  return [...list].sort((a, b) => a.localeCompare(b));
}

function workList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new WorkLedgerError(`${field} must be an array`);
  const list = value.map((entry, index) => normalizeWorkId(entry, `${field}[${index}]`));
  if (new Set(list).size !== list.length) throw new WorkLedgerError(`${field} must contain distinct work ids`);
  return [...list].sort();
}

function scope(value: unknown, field: string): string {
  const raw = nonempty(value, field).replace(/\\/g, "/").replace(/^\.\//, "");
  if (raw === "." || raw === "**") return "**";
  if (/[*?\[\]]/.test(raw.replace(/\/\*\*$/, "")) || (raw.includes("*") && !raw.endsWith("/**"))) {
    throw new WorkLedgerError(`${field} supports only an exact repository path, **, or a trailing /**`);
  }
  const directory = raw.endsWith("/**");
  const base = posix.normalize(directory ? raw.slice(0, -3) : raw).replace(/\/$/, "");
  if (!base || base === "." || base.startsWith("/") || /^[A-Za-z]:\//.test(base)
    || base === ".." || base.startsWith("../") || base.includes("\0")) {
    throw new WorkLedgerError(`${field} must stay inside the repository: ${String(value)}`);
  }
  return directory ? `${base}/**` : base;
}

function scopeList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new WorkLedgerError(`${field} must be an array`);
  const list = value.map((entry, index) => scope(entry, `${field}[${index}]`));
  if (new Set(list).size !== list.length) throw new WorkLedgerError(`${field} must contain distinct scopes`);
  return [...list].sort();
}

function actor(value: unknown, field: string): WorkActor {
  if (!isObject(value)) throw new WorkLedgerError(`${field} must be an object`);
  const keys = Object.keys(value).sort();
  if (stable(keys) !== stable(["agent", "session"])) throw new WorkLedgerError(`${field} must contain exactly agent and session`);
  return {
    session: exactSession(value.session, `${field}.session`),
    agent: nonempty(value.agent, `${field}.agent`),
  };
}

function authority(value: unknown): WorkAuthority {
  if (!isObject(value)) throw new WorkLedgerError("authority must be an object");
  const keys = Object.keys(value).sort();
  if (stable(keys) !== stable(["boundary", "grantedBy", "kind"])) {
    throw new WorkLedgerError("authority must contain exactly kind, grantedBy, and boundary");
  }
  const kinds: WorkAuthorityKind[] = ["user-directed", "orchestrator-delegated", "agent-local", "external-approved"];
  if (!kinds.includes(value.kind as WorkAuthorityKind)) {
    throw new WorkLedgerError(`authority.kind must be one of ${kinds.join(", ")}`);
  }
  return {
    kind: value.kind as WorkAuthorityKind,
    grantedBy: nonempty(value.grantedBy, "authority.grantedBy"),
    boundary: nonempty(value.boundary, "authority.boundary"),
  };
}

function writer(input: { session: string; agent?: string; job?: string }): { session: string; agent: string; job: string } {
  const session = exactSession(input.session);
  const agent = nonempty(input.agent ?? process.env.COHERENCE_AGENT ?? "main", "agent");
  const job = nonempty(input.job ?? process.env.COHERENCE_JOB ?? "main", "job");
  return { session, agent, job };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], problems: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (stable(actual) === stable(wanted)) return;
  const missing = wanted.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !wanted.includes(key));
  problems.push(`${label} has a non-canonical shape`
    + `${missing.length ? `; missing ${missing.join(", ")}` : ""}`
    + `${extra.length ? `; unknown ${extra.join(", ")}` : ""}`);
}

function stringField(value: Record<string, unknown>, key: string, problems: string[], label: string): string {
  if (typeof value[key] !== "string" || !(value[key] as string).trim()) {
    problems.push(`${label}.${key} must be a non-empty string`);
    return "";
  }
  if (value[key] !== (value[key] as string).trim()) problems.push(`${label}.${key} must not have surrounding whitespace`);
  return value[key] as string;
}

function canonicalThrough<T>(
  raw: unknown,
  label: string,
  problems: string[],
  normalize: () => T,
): T | null {
  try {
    const canonical = normalize();
    if (stable(canonical) !== stable(raw)) problems.push(`${label} is not canonical`);
    return canonical;
  } catch (error) {
    const messages = error instanceof WorkLedgerError ? error.problems : [(error as Error).message];
    problems.push(...messages.map((message) => `${label}: ${message}`));
    return null;
  }
}

function baseKeys(extra: string[]): string[] {
  return ["version", "event", "id", "at", "session", "agent", "job", "work", ...extra];
}

function parseRecord(raw: unknown, label: string, problems: string[]): WorkRecord | null {
  const before = problems.length;
  if (!isObject(raw)) {
    problems.push(`${label} must be a JSON object`);
    return null;
  }
  const event = raw.event;
  const extras = event === "opened"
    ? ["parent", "objective", "criteria", "constraints", "nonGoals", "authority", "owner", "dependsOn", "readScopes", "writeScopes", "risk", "state"]
    : event === "transitioned"
      ? ["previous", "from", "to", "reason", "evidence"]
      : event === "handed-off"
        ? ["previous", "fromOwner", "toOwner", "reason"]
        : event === "closed"
          ? ["previous", "from", "to", "reason", "resultEvidence", "synthesizedChildren"]
          : [];
  exactKeys(raw, baseKeys(extras), problems, label);
  if (raw.version !== WORK_VERSION) problems.push(`${label}.version must be ${WORK_VERSION}`);
  if (!["opened", "transitioned", "handed-off", "closed"].includes(String(event))) {
    problems.push(`${label}.event is not a work event`);
  }
  const id = stringField(raw, "id", problems, label);
  const at = stringField(raw, "at", problems, label);
  const session = stringField(raw, "session", problems, label);
  stringField(raw, "agent", problems, label);
  stringField(raw, "job", problems, label);
  const work = stringField(raw, "work", problems, label);
  if (id && !/^wev-[a-f0-9]{16}$/.test(id)) problems.push(`${label}.id is not a work-event id`);
  if (at && (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at)) {
    problems.push(`${label}.at must be a canonical ISO timestamp`);
  }
  if (session === "unknown") problems.push(`${label}.session may not be unknown`);
  if (work) canonicalThrough(work, `${label}.work`, problems, () => normalizeWorkId(work));

  if (event === "opened") {
    if (!(raw.parent === null || typeof raw.parent === "string")) problems.push(`${label}.parent must be work id|null`);
    else if (raw.parent !== null) canonicalThrough(raw.parent, `${label}.parent`, problems, () => normalizeWorkId(raw.parent));
    stringField(raw, "objective", problems, label);
    canonicalThrough(raw.criteria, `${label}.criteria`, problems, () => textList(raw.criteria, "criteria", true));
    canonicalThrough(raw.constraints, `${label}.constraints`, problems, () => textList(raw.constraints, "constraints"));
    canonicalThrough(raw.nonGoals, `${label}.nonGoals`, problems, () => textList(raw.nonGoals, "nonGoals"));
    canonicalThrough(raw.authority, `${label}.authority`, problems, () => authority(raw.authority));
    canonicalThrough(raw.owner, `${label}.owner`, problems, () => actor(raw.owner, "owner"));
    canonicalThrough(raw.dependsOn, `${label}.dependsOn`, problems, () => workList(raw.dependsOn, "dependsOn"));
    canonicalThrough(raw.readScopes, `${label}.readScopes`, problems, () => scopeList(raw.readScopes, "readScopes"));
    canonicalThrough(raw.writeScopes, `${label}.writeScopes`, problems, () => scopeList(raw.writeScopes, "writeScopes"));
    if (!["low", "medium", "high", "critical"].includes(String(raw.risk))) problems.push(`${label}.risk is invalid`);
    if (raw.state !== "open") problems.push(`${label}.state must be open`);
  } else if (event === "transitioned") {
    stringField(raw, "previous", problems, label);
    if (!["open", "active", "blocked"].includes(String(raw.from))) problems.push(`${label}.from is not an open state`);
    if (!["open", "active", "blocked"].includes(String(raw.to))) problems.push(`${label}.to is not an open state`);
    stringField(raw, "reason", problems, label);
    canonicalThrough(raw.evidence, `${label}.evidence`, problems, () => textList(raw.evidence, "evidence"));
  } else if (event === "handed-off") {
    stringField(raw, "previous", problems, label);
    canonicalThrough(raw.fromOwner, `${label}.fromOwner`, problems, () => actor(raw.fromOwner, "fromOwner"));
    canonicalThrough(raw.toOwner, `${label}.toOwner`, problems, () => actor(raw.toOwner, "toOwner"));
    stringField(raw, "reason", problems, label);
  } else if (event === "closed") {
    stringField(raw, "previous", problems, label);
    if (!["open", "active", "blocked"].includes(String(raw.from))) problems.push(`${label}.from is not an open state`);
    if (!["completed", "cancelled"].includes(String(raw.to))) problems.push(`${label}.to is not terminal`);
    stringField(raw, "reason", problems, label);
    const result = canonicalThrough(raw.resultEvidence, `${label}.resultEvidence`, problems,
      () => textList(raw.resultEvidence, "resultEvidence"));
    if (raw.to === "completed" && result && !result.length) problems.push(`${label}.resultEvidence is required for completed work`);
    canonicalThrough(raw.synthesizedChildren, `${label}.synthesizedChildren`, problems,
      () => workList(raw.synthesizedChildren, "synthesizedChildren"));
  }

  if (problems.length !== before) return null;
  const record = raw as unknown as WorkRecord;
  const { id: _id, ...body } = record;
  if (recordId(body) !== record.id) {
    problems.push(`${label}.id does not match work-event content`);
    return null;
  }
  return record;
}

function ledgerDirectoryPresent(cfg: Config): boolean {
  const coherence = join(cfg.root, ".coherence");
  const dir = workDir(cfg);
  for (const [path, label] of [[coherence, ".coherence"], [dir, ".coherence/work"]] as const) {
    let stat;
    try { stat = lstatSync(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      const code = (error as NodeJS.ErrnoException).code;
      throw new WorkLedgerError(`${label} cannot be inspected${code ? ` (${code})` : ""}`);
    }
    if (stat.isSymbolicLink()) throw new WorkLedgerError(`${label} must be a real repository directory, never a symlink`);
    if (!stat.isDirectory()) throw new WorkLedgerError(`${label} must be a directory`);
  }
  return true;
}

function portableFilenameKey(filename: string): string {
  return filename.normalize("NFD").toLowerCase();
}

function readRecords(cfg: Config): WorkRecord[] {
  const dir = workDir(cfg);
  const problems: string[] = [];
  const parsed: { record: WorkRecord; file: string; line: number }[] = [];
  if (!ledgerDirectoryPresent(cfg)) return [];
  let files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const portableNames = new Map<string, string>();
    for (const entry of entries) {
      const name = entry.name;
      if (entry.isSymbolicLink()) {
        problems.push(`${name} is a symlink; work evidence must stay inside the repository`);
        continue;
      }
      if (name !== ".DS_Store" && !name.endsWith(".jsonl")) {
        problems.push(`${name} is an unexpected work-ledger entry; only session .jsonl files belong here`);
      }
      if (name.endsWith(".jsonl") && !entry.isFile()) problems.push(`${name} is not a regular work-ledger file`);
      if (name.endsWith(".jsonl")) {
        const key = portableFilenameKey(name);
        const prior = portableNames.get(key);
        if (prior && prior !== name) problems.push(`${prior} and ${name} alias on a portable filesystem`);
        else portableNames.set(key, name);
      }
    }
    files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => entry.name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new WorkLedgerError(`work directory is unreadable${code ? ` (${code})` : ""}`);
  }

  for (const file of files) {
    let contents: string;
    try { contents = readFileSync(join(dir, file), "utf8"); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      problems.push(`${file} is unreadable${code ? ` (${code})` : ""}`);
      continue;
    }
    if (!contents.trim()) {
      problems.push(`${file} contains no work rows`);
      continue;
    }
    const lines = contents.split("\n");
    if (lines.pop() !== "") {
      problems.push(`${file} has no canonical final newline; its last append may be torn`);
      continue;
    }
    lines.forEach((line, index) => {
      const label = `${file}:${index + 1}`;
      if (!line.trim()) {
        problems.push(`${label} is a blank work row`);
        return;
      }
      let raw: unknown;
      try { raw = JSON.parse(line); }
      catch {
        problems.push(`${label} is malformed JSON`);
        return;
      }
      const record = parseRecord(raw, label, problems);
      if (record) parsed.push({ record, file, line: index + 1 });
    });
  }
  if (problems.length) throw new WorkLedgerError(problems);

  const byId = new Map<string, { record: WorkRecord; file: string; line: number }>();
  for (const row of parsed) {
    const expected = sessionFilename(row.record.session);
    if (row.file !== expected) {
      problems.push(`${row.file}:${row.line} is detached work history; writer ${row.record.session} belongs in ${expected}`);
    }
    const prior = byId.get(row.record.id);
    if (!prior) byId.set(row.record.id, row);
    else if (stable(prior.record) !== stable(row.record)) {
      problems.push(`${row.record.id} has conflicting rows at ${prior.file}:${prior.line} and ${row.file}:${row.line}`);
    }
  }
  if (problems.length) throw new WorkLedgerError(problems);
  return [...byId.values()].map((row) => row.record)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id) || a.session.localeCompare(b.session));
}

function appendRecord(cfg: Config, record: WorkRecord): void {
  mkdirSync(workDir(cfg), { recursive: true });
  if (!ledgerDirectoryPresent(cfg)) throw new WorkLedgerError("work directory could not be created");
  const targetPath = workSessionPath(cfg, record.session);
  const target = basename(targetPath);
  try {
    const existing = lstatSync(targetPath);
    if (existing.isSymbolicLink()) throw new WorkLedgerError(`${target} is a symlink; refusing an external append target`);
    if (!existing.isFile()) throw new WorkLedgerError(`${target} is not a regular work-ledger file`);
  } catch (error) {
    if (error instanceof WorkLedgerError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      const code = (error as NodeJS.ErrnoException).code;
      throw new WorkLedgerError(`${target} cannot be inspected${code ? ` (${code})` : ""}`);
    }
  }
  const flags = constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
  let fd: number;
  try { fd = openSync(targetPath, flags, 0o666); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new WorkLedgerError(`${target} cannot be opened as a contained append target${code ? ` (${code})` : ""}`);
  }
  try {
    const opened = fstatSync(fd);
    const standing = lstatSync(targetPath);
    if (!opened.isFile() || !standing.isFile() || standing.isSymbolicLink()
      || opened.dev !== standing.dev || opened.ino !== standing.ino) {
      throw new WorkLedgerError(`${target} changed identity while opening; refusing the append`);
    }
    const bytes = Buffer.from(JSON.stringify(record) + "\n");
    for (let offset = 0; offset < bytes.length;) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new WorkLedgerError(`${target} append made no progress`);
      offset += written;
    }
  } finally { closeSync(fd); }
}

function assertTransition(from: WorkOpenState, to: WorkOpenState): void {
  if (from === to) throw new WorkLedgerError(`work is already ${to}; refusing a no-op transition`);
  const allowed: Record<WorkOpenState, WorkOpenState[]> = {
    open: ["active", "blocked"],
    active: ["open", "blocked"],
    blocked: ["open", "active"],
  };
  if (!allowed[from].includes(to)) throw new WorkLedgerError(`transition ${from} -> ${to} is not allowed`);
}

function history(records: WorkRecord[]): WorkItem[] {
  const problems: string[] = [];
  const groups = new Map<string, WorkRecord[]>();
  const globally = new Map(records.map((record) => [record.id, record]));
  for (const record of records) {
    const group = groups.get(record.work) ?? [];
    group.push(record);
    groups.set(record.work, group);
  }
  const works: WorkItem[] = [];
  for (const [work, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const openedRows = group.filter((record): record is WorkOpened => record.event === "opened");
    if (openedRows.length !== 1) {
      problems.push(`${work} has ${openedRows.length} opening records; exactly one is required`);
      continue;
    }
    const opened = openedRows[0];
    const successors = new Map<string, WorkRecord[]>();
    for (const record of group) {
      if (record.event === "opened") continue;
      const predecessor = globally.get(record.previous);
      if (!predecessor) problems.push(`${work} event ${record.id} names missing predecessor ${record.previous}`);
      else if (predecessor.work !== work) problems.push(`${work} event ${record.id} points into ${predecessor.work}`);
      const rows = successors.get(record.previous) ?? [];
      rows.push(record);
      successors.set(record.previous, rows);
    }
    let state: WorkState = "open";
    let owner = opened.owner;
    let current: WorkRecord = opened;
    let closed: WorkClosed | null = null;
    const chain: WorkRecord[] = [opened];
    const seen = new Set([opened.id]);
    while (true) {
      const nextRows: WorkRecord[] = successors.get(current.id) ?? [];
      if (!nextRows.length) break;
      if (nextRows.length > 1) {
        problems.push(`${work} has conflicting history after ${current.id}: ${nextRows.map((row) => row.id).sort().join(", ")}`);
        break;
      }
      const next: WorkRecord = nextRows[0];
      if (seen.has(next.id)) {
        problems.push(`${work} history cycles at ${next.id}`);
        break;
      }
      seen.add(next.id);
      chain.push(next);
      if (closed) {
        problems.push(`${work} has event ${next.id} after terminal closure ${closed.id}`);
        current = next;
        continue;
      }
      if (next.event === "transitioned") {
        if (next.from !== state) problems.push(`${work} event ${next.id} says from ${next.from}, standing state is ${state}`);
        try { assertTransition(next.from, next.to); }
        catch (error) { problems.push(...(error as WorkLedgerError).problems.map((problem) => `${work} event ${next.id}: ${problem}`)); }
        state = next.to;
      } else if (next.event === "handed-off") {
        if (stable(next.fromOwner) !== stable(owner)) {
          problems.push(`${work} event ${next.id} hands off from ${next.fromOwner.session}/${next.fromOwner.agent}, standing owner is ${owner.session}/${owner.agent}`);
        }
        if (stable(next.fromOwner) === stable(next.toOwner)) problems.push(`${work} event ${next.id} is a no-op handoff`);
        owner = next.toOwner;
      } else if (next.event === "closed") {
        if (next.from !== state) problems.push(`${work} closure ${next.id} says from ${next.from}, standing state is ${state}`);
        state = next.to;
        closed = next;
      }
      current = next;
    }
    if (seen.size !== group.length) {
      const unreachable = group.filter((record) => !seen.has(record.id)).map((record) => record.id).sort();
      problems.push(`${work} has unreachable history: ${unreachable.join(", ")}`);
    }
    works.push({
      work, opened, records: chain, last: current, state, owner, closed,
      readiness: "waiting", blockedBy: [], conflictsWith: [],
    });
  }
  if (problems.length) throw new WorkLedgerError(problems);
  return works;
}

function canonicalCycle(cycle: string[]): string[] {
  const body = cycle.slice(0, -1);
  if (!body.length) return cycle;
  const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)]);
  rotations.sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
  return [...rotations[0], rotations[0][0]];
}

function graphCycles(
  works: WorkItem[],
  edges: (item: WorkItem) => string[],
): string[][] {
  const index = new Map(works.map((item) => [item.work, item]));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const found = new Map<string, string[]>();
  const visit = (id: string): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const start = stack.indexOf(id);
      const cycle = canonicalCycle([...stack.slice(start), id]);
      found.set(cycle.join(" -> "), cycle);
      return;
    }
    state.set(id, 1);
    stack.push(id);
    const item = index.get(id);
    if (item) for (const target of edges(item).filter((candidate) => index.has(candidate)).sort()) visit(target);
    stack.pop();
    state.set(id, 2);
  };
  for (const id of [...index.keys()].sort()) visit(id);
  return [...found.values()].sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
}

export function validateWorkGraph(input: WorkLedger | WorkItem[]): WorkGraphValidation {
  const works = Array.isArray(input) ? input : input.works;
  const index = new Map(works.map((item) => [item.work, item]));
  const problems: WorkGraphProblem[] = [];
  for (const item of works) {
    const parent = item.opened.parent;
    if (parent && !index.has(parent)) {
      problems.push({ kind: "missing-parent", work: item.work, related: [parent], message: `${item.work} names missing parent ${parent}` });
    } else if (parent) {
      const parentItem = index.get(parent)!;
      if ((parentItem.state === "completed" || parentItem.state === "cancelled")
        && item.state !== "completed" && item.state !== "cancelled") {
        problems.push({
          kind: "terminal-parent", work: item.work, related: [parent],
          message: `${item.work} is live beneath terminal parent ${parent}; settle children before closing their join target`,
        });
      }
    }
    for (const dependency of item.opened.dependsOn) {
      if (!index.has(dependency)) {
        problems.push({ kind: "missing-dependency", work: item.work, related: [dependency], message: `${item.work} names missing dependency ${dependency}` });
      } else if ((item.state === "active" || item.state === "completed")
        && index.get(dependency)!.state !== "completed") {
        problems.push({
          kind: "dependency-order", work: item.work, related: [dependency],
          message: `${item.work} is ${item.state} before dependency ${dependency} completed`,
        });
      }
    }
    if (item.closed) {
      for (const child of item.closed.synthesizedChildren) {
        const candidate = index.get(child);
        if (!candidate || candidate.opened.parent !== item.work || candidate.state !== "completed") {
          problems.push({
            kind: "invalid-synthesis", work: item.work, related: [child],
            message: `${item.work} claims ${child} as a synthesized completed direct child, but the graph does not support that relation`,
          });
        }
      }
      for (const child of works.filter((candidate) =>
        candidate.opened.parent === item.work && candidate.state === "completed")) {
        if (!item.closed.synthesizedChildren.includes(child.work)) {
          problems.push({
            kind: "missing-synthesis", work: item.work, related: [child.work],
            message: `${item.work} does not synthesize completed direct child ${child.work}`,
          });
        }
      }
    }
  }
  for (const cycle of graphCycles(works, (item) => item.opened.parent ? [item.opened.parent] : [])) {
    problems.push({ kind: "parent-cycle", work: cycle[0], related: cycle.slice(1), message: `parent cycle: ${cycle.join(" -> ")}` });
  }
  for (const cycle of graphCycles(works, (item) => item.opened.dependsOn)) {
    problems.push({ kind: "dependency-cycle", work: cycle[0], related: cycle.slice(1), message: `dependency cycle: ${cycle.join(" -> ")}` });
  }
  problems.sort((a, b) => a.kind.localeCompare(b.kind) || a.work.localeCompare(b.work) || a.message.localeCompare(b.message));
  return { valid: !problems.length, problems };
}

export function assertValidWorkGraph(input: WorkLedger | WorkGraphValidation | WorkItem[]): void {
  const validation = Array.isArray(input)
    ? validateWorkGraph(input)
    : "valid" in input && "problems" in input ? input : input.validation;
  if (!validation.valid) throw new WorkLedgerError(validation.problems.map((problem) => problem.message));
}

function scopeParts(value: string): { base: string; tree: boolean } {
  if (value === "**") return { base: "", tree: true };
  return value.endsWith("/**") ? { base: value.slice(0, -3), tree: true } : { base: value, tree: false };
}

export function workScopesOverlap(left: string, right: string): boolean {
  const a = scopeParts(scope(left, "left scope"));
  const b = scopeParts(scope(right, "right scope"));
  if (!a.base || !b.base) return true;
  if (!a.tree && !b.tree) return a.base === b.base;
  if (a.tree && !b.tree) return b.base === a.base || b.base.startsWith(`${a.base}/`);
  if (!a.tree && b.tree) return a.base === b.base || a.base.startsWith(`${b.base}/`);
  return a.base === b.base || a.base.startsWith(`${b.base}/`) || b.base.startsWith(`${a.base}/`);
}

function preliminaryReadiness(works: WorkItem[], validation: WorkGraphValidation): void {
  const index = new Map(works.map((item) => [item.work, item]));
  const invalidByWork = new Map<string, string[]>();
  for (const problem of validation.problems) {
    const list = invalidByWork.get(problem.work) ?? [];
    list.push(problem.message);
    invalidByWork.set(problem.work, list);
  }
  for (const item of works) {
    item.blockedBy = [...(invalidByWork.get(item.work) ?? [])].sort();
    item.conflictsWith = [];
    if (item.state === "completed" || item.state === "cancelled") {
      item.readiness = "done";
      continue;
    }
    if (item.state === "active") {
      item.readiness = "active";
      continue;
    }
    if (item.state === "blocked") {
      item.readiness = "blocked";
      item.blockedBy.push("explicitly blocked");
      continue;
    }
    const waiting: string[] = [];
    for (const dependencyId of item.opened.dependsOn) {
      const dependency = index.get(dependencyId);
      if (!dependency) continue;
      if (dependency.state === "completed") continue;
      if (dependency.state === "blocked" || dependency.state === "cancelled") {
        item.blockedBy.push(`dependency ${dependencyId} is ${dependency.state}`);
      } else waiting.push(`dependency ${dependencyId} is ${dependency.state}`);
    }
    if (item.blockedBy.length) item.readiness = "blocked";
    else if (waiting.length) {
      item.readiness = "waiting";
      item.blockedBy = waiting.sort();
    } else item.readiness = "ready";
  }
}

export function detectWorkScopeOverlaps(works: WorkItem[]): WorkScopeOverlap[] {
  const live = works.filter((item) => item.state !== "completed" && item.state !== "cancelled")
    .sort((a, b) => a.work.localeCompare(b.work));
  const overlaps: WorkScopeOverlap[] = [];
  for (let leftIndex = 0; leftIndex < live.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < live.length; rightIndex++) {
      const left = live[leftIndex], right = live[rightIndex];
      for (const leftScope of left.opened.writeScopes) {
        for (const rightScope of right.opened.writeScopes) {
          if (!workScopesOverlap(leftScope, rightScope)) continue;
          const executable = (item: WorkItem) => item.readiness === "ready" || item.readiness === "active";
          overlaps.push({
            left: left.work, right: right.work, leftScope, rightScope,
            status: executable(left) && executable(right) ? "conflict" : "potential",
          });
        }
      }
    }
  }
  return overlaps.sort((a, b) => a.left.localeCompare(b.left) || a.right.localeCompare(b.right)
    || a.leftScope.localeCompare(b.leftScope) || a.rightScope.localeCompare(b.rightScope));
}

function derived(records: WorkRecord[]): WorkLedger {
  const works = history(records);
  const validation = validateWorkGraph(works);
  preliminaryReadiness(works, validation);
  const scopeOverlaps = detectWorkScopeOverlaps(works);
  const scopeConflicts = scopeOverlaps.filter((overlap) => overlap.status === "conflict");
  for (const conflict of scopeConflicts) {
    for (const [work, other] of [[conflict.left, conflict.right], [conflict.right, conflict.left]] as const) {
      const item = works.find((candidate) => candidate.work === work)!;
      item.conflictsWith.push(other);
      if (item.readiness === "ready") {
        item.readiness = "blocked";
        item.blockedBy.push(`write-scope conflict with ${other}`);
      }
    }
  }
  for (const item of works) {
    item.blockedBy = [...new Set(item.blockedBy)].sort();
    item.conflictsWith = [...new Set(item.conflictsWith)].sort();
  }
  const index = new Map(works.map((item) => [item.work, item]));
  const orphaned = works.filter((item) => {
    const parentId = item.opened.parent;
    if (!parentId) return false;
    const parent = index.get(parentId);
    return !parent || ((parent.state === "completed" || parent.state === "cancelled")
      && item.state !== "completed" && item.state !== "cancelled");
  });
  const unsynthesized: UnsynthesizedWorkChild[] = [];
  for (const child of works) {
    const parentId = child.opened.parent;
    if (!parentId || child.state !== "completed") continue;
    const parent = index.get(parentId);
    if (!parent) continue;
    if (!parent.closed) unsynthesized.push({ parent: parentId, child: child.work, reason: "parent-not-closed" });
    else if (!parent.closed.synthesizedChildren.includes(child.work)) {
      unsynthesized.push({ parent: parentId, child: child.work, reason: "not-listed-by-parent-closure" });
    }
  }
  unsynthesized.sort((a, b) => a.parent.localeCompare(b.parent) || a.child.localeCompare(b.child));

  const stateKeys: WorkState[] = ["open", "active", "blocked", "completed", "cancelled"];
  const readinessKeys: WorkReadiness[] = ["ready", "waiting", "active", "blocked", "done"];
  const riskKeys: WorkRisk[] = ["low", "medium", "high", "critical"];
  const states = Object.fromEntries(stateKeys.map((key) => [key, works.filter((item) => item.state === key).length])) as Record<WorkState, number>;
  const readiness = Object.fromEntries(readinessKeys.map((key) => [key, works.filter((item) => item.readiness === key).length])) as Record<WorkReadiness, number>;
  const risks = Object.fromEntries(riskKeys.map((key) => [key, works.filter((item) => item.opened.risk === key).length])) as Record<WorkRisk, number>;
  const stats: WorkStats = {
    total: works.length,
    roots: works.filter((item) => item.opened.parent === null).length,
    dependencies: works.reduce((sum, item) => sum + item.opened.dependsOn.length, 0),
    states, readiness, risks,
    graphProblems: validation.problems.length,
    scopeOverlaps: scopeOverlaps.length,
    scopeConflicts: scopeConflicts.length,
    orphans: orphaned.length,
    unsynthesizedChildren: unsynthesized.length,
  };
  return {
    records, works, validation,
    ready: works.filter((item) => item.readiness === "ready"),
    blocked: works.filter((item) => item.readiness === "blocked"),
    scopeOverlaps, scopeConflicts, orphaned, unsynthesized, stats,
  };
}

/** Strict merged read: malformed rows and ambiguous event histories refuse. */
export function readWork(cfg: Config): WorkLedger {
  return derived(readRecords(cfg));
}

/** Alias whose noun makes integration call sites read naturally. */
export const readWorkLedger = readWork;

function openedRequest(record: WorkOpened): unknown {
  return {
    session: record.session, agent: record.agent, job: record.job, work: record.work,
    parent: record.parent, objective: record.objective, criteria: record.criteria,
    constraints: record.constraints, nonGoals: record.nonGoals, authority: record.authority,
    owner: record.owner, dependsOn: record.dependsOn, readScopes: record.readScopes,
    writeScopes: record.writeScopes, risk: record.risk,
  };
}

export function createWork(cfg: Config, input: CreateWorkInput): WorkOpened {
  const write = writer(input);
  const parent = input.parent === undefined || input.parent === null ? null : normalizeWorkId(input.parent, "parent");
  const objective = nonempty(input.objective, "objective");
  const criteria = textList(input.criteria, "criteria", true);
  const constraints = textList(input.constraints ?? [], "constraints");
  const nonGoals = textList(input.nonGoals ?? [], "nonGoals");
  const declaredAuthority = authority(input.authority);
  const owner = input.owner ? actor(input.owner, "owner") : { session: write.session, agent: write.agent };
  const dependsOn = workList(input.dependsOn ?? [], "dependsOn");
  const readScopes = scopeList(input.readScopes ?? [], "readScopes");
  const writeScopes = scopeList(input.writeScopes ?? [], "writeScopes");
  const risks: WorkRisk[] = ["low", "medium", "high", "critical"];
  if (!risks.includes(input.risk)) throw new WorkLedgerError(`risk must be one of ${risks.join(", ")}`);
  const seed = { parent, objective, criteria, constraints, nonGoals, authority: declaredAuthority, owner, dependsOn, readScopes, writeScopes, risk: input.risk };
  const work = input.work ? normalizeWorkId(input.work) : `wrk-${digest(seed).slice(0, 16)}`;
  if (parent === work) throw new WorkLedgerError(`${work} cannot be its own parent`);
  if (dependsOn.includes(work)) throw new WorkLedgerError(`${work} cannot depend on itself`);
  const request = { ...write, work, ...seed };

  const ledger = readWork(cfg);
  assertValidWorkGraph(ledger);
  const standing = ledger.works.find((item) => item.work === work);
  if (standing) {
    if (stable(openedRequest(standing.opened)) === stable(request)) return standing.opened;
    throw new WorkLedgerError(`${work} already has a different opening record`);
  }
  const known = new Set(ledger.works.map((item) => item.work));
  if (parent && !known.has(parent)) throw new WorkLedgerError(`${work} names missing parent ${parent}`);
  for (const dependency of dependsOn) {
    if (!known.has(dependency)) throw new WorkLedgerError(`${work} names missing dependency ${dependency}`);
  }
  const body: Omit<WorkOpened, "id"> = {
    version: WORK_VERSION, event: "opened", at: iso(input.now), ...write, work,
    parent, objective, criteria, constraints, nonGoals, authority: declaredAuthority,
    owner, dependsOn, readScopes, writeScopes, risk: input.risk, state: "open",
  };
  const record: WorkOpened = { ...body, id: recordId(body) };
  const prospective = derived([...ledger.records, record]);
  assertValidWorkGraph(prospective);
  appendRecord(cfg, record);
  return record;
}

export const openWork = createWork;

function standingWork(ledger: WorkLedger, work: string): WorkItem {
  const item = ledger.works.find((candidate) => candidate.work === work);
  if (!item) throw new WorkLedgerError(`unknown work ${work}`);
  return item;
}

function expectedPrevious(item: WorkItem, expected: string | undefined): void {
  if (expected && expected !== item.last.id) {
    throw new WorkLedgerError(`${item.work} changed after ${expected}; standing predecessor is ${item.last.id}`);
  }
}

function changeRequest(input: WorkChangeInput): { work: string; session: string; agent: string; job: string; reason: string } {
  return { work: normalizeWorkId(input.work), ...writer(input), reason: nonempty(input.reason, "reason") };
}

export function transitionWork(cfg: Config, input: TransitionWorkInput): WorkTransitioned {
  const request = changeRequest(input);
  const evidence = textList(input.evidence ?? [], "evidence");
  if (!["open", "active", "blocked"].includes(input.to)) throw new WorkLedgerError("transition target must remain non-terminal");
  const ledger = readWork(cfg);
  assertValidWorkGraph(ledger);
  const item = standingWork(ledger, request.work);
  const latest = item.last;
  if (latest.event === "transitioned" && latest.to === input.to && latest.reason === request.reason
    && stable(latest.evidence) === stable(evidence) && latest.session === request.session
    && latest.agent === request.agent && latest.job === request.job) return latest;
  if (item.closed) throw new WorkLedgerError(`${item.work} is ${item.state}; terminal work cannot transition`);
  expectedPrevious(item, input.expectedPrevious);
  assertTransition(item.state as WorkOpenState, input.to);
  const body: Omit<WorkTransitioned, "id"> = {
    version: WORK_VERSION, event: "transitioned", at: iso(input.now), ...request,
    previous: item.last.id, from: item.state as WorkOpenState, to: input.to, evidence,
  };
  const record: WorkTransitioned = { ...body, id: recordId(body) };
  const prospective = derived([...ledger.records, record]);
  assertValidWorkGraph(prospective);
  appendRecord(cfg, record);
  return record;
}

export function handoffWork(cfg: Config, input: HandoffWorkInput): WorkHandedOff {
  const request = changeRequest(input);
  const toOwner = actor(input.toOwner, "toOwner");
  const ledger = readWork(cfg);
  assertValidWorkGraph(ledger);
  const item = standingWork(ledger, request.work);
  const latest = item.last;
  if (latest.event === "handed-off" && stable(latest.toOwner) === stable(toOwner)
    && latest.reason === request.reason && latest.session === request.session
    && latest.agent === request.agent && latest.job === request.job) return latest;
  if (item.closed) throw new WorkLedgerError(`${item.work} is ${item.state}; terminal work cannot be handed off`);
  if (stable(item.owner) === stable(toOwner)) throw new WorkLedgerError(`${item.work} is already owned by ${toOwner.session}/${toOwner.agent}`);
  expectedPrevious(item, input.expectedPrevious);
  const body: Omit<WorkHandedOff, "id"> = {
    version: WORK_VERSION, event: "handed-off", at: iso(input.now), ...request,
    previous: item.last.id, fromOwner: item.owner, toOwner,
  };
  const record: WorkHandedOff = { ...body, id: recordId(body) };
  derived([...ledger.records, record]);
  appendRecord(cfg, record);
  return record;
}

export function closeWork(cfg: Config, input: CloseWorkInput): WorkClosed {
  const request = changeRequest(input);
  if (!["completed", "cancelled"].includes(input.to)) throw new WorkLedgerError("closure target must be completed or cancelled");
  const resultEvidence = textList(input.resultEvidence ?? [], "resultEvidence");
  if (input.to === "completed" && !resultEvidence.length) {
    throw new WorkLedgerError("completed work requires at least one resultEvidence item");
  }
  const synthesizedChildren = workList(input.synthesizedChildren ?? [], "synthesizedChildren");
  const ledger = readWork(cfg);
  assertValidWorkGraph(ledger);
  const item = standingWork(ledger, request.work);
  const latest = item.last;
  if (latest.event === "closed" && latest.to === input.to && latest.reason === request.reason
    && stable(latest.resultEvidence) === stable(resultEvidence)
    && stable(latest.synthesizedChildren) === stable(synthesizedChildren)
    && latest.session === request.session && latest.agent === request.agent && latest.job === request.job) return latest;
  if (item.closed) throw new WorkLedgerError(`${item.work} is already ${item.state}`);
  expectedPrevious(item, input.expectedPrevious);
  const body: Omit<WorkClosed, "id"> = {
    version: WORK_VERSION, event: "closed", at: iso(input.now), ...request,
    previous: item.last.id, from: item.state as WorkOpenState, to: input.to,
    resultEvidence, synthesizedChildren,
  };
  const record: WorkClosed = { ...body, id: recordId(body) };
  const prospective = derived([...ledger.records, record]);
  assertValidWorkGraph(prospective);
  appendRecord(cfg, record);
  return record;
}

function visible(value: string): string {
  return value.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, (char) =>
    `\\u${char.codePointAt(0)!.toString(16).padStart(4, "0")}`).replace(/\n/g, "\\n");
}

export function workStats(cfg: Config): WorkStats {
  return readWork(cfg).stats;
}

/** Deterministic human projection; JSON callers should consume the returned ledger. */
export function renderWork(cfg: Config, opts: RenderWorkOpts = {}): { text: string; ledger: WorkLedger; works: WorkItem[] } {
  const ledger = readWork(cfg);
  const works = ledger.works.filter((item) => (!opts.work || item.work === opts.work) && (!opts.state || item.state === opts.state));
  const lines = [
    "WORK GRAPH — inert work orders, ownership, dependencies, and result synthesis",
    `  ${ledger.stats.total} work order(s) · ${ledger.stats.readiness.ready} ready · ${ledger.stats.readiness.blocked} blocked · ${ledger.stats.scopeConflicts} write conflict(s)`,
  ];
  if (ledger.validation.problems.length) {
    lines.push("", "GRAPH PROBLEMS", ...ledger.validation.problems.map((problem) => `  ! ${visible(problem.message)}`));
  }
  if (!works.length) lines.push("", "  no matching work orders");
  for (const item of works) {
    const open = item.opened;
    lines.push(
      "",
      `WORK ${visible(item.work)}  ${item.state}/${item.readiness}  risk:${open.risk}`,
      `  objective: ${visible(open.objective)}`,
      `  owner: ${visible(item.owner.session)} (${visible(item.owner.agent)})`,
      `  authority: ${open.authority.kind} by ${visible(open.authority.grantedBy)} — ${visible(open.authority.boundary)}`,
      `  parent: ${open.parent ? visible(open.parent) : "mission root"}`,
      `  depends on: ${open.dependsOn.length ? open.dependsOn.map(visible).join(" · ") : "none"}`,
      `  criteria: ${open.criteria.map(visible).join(" · ")}`,
      `  read scope: ${open.readScopes.length ? open.readScopes.map(visible).join(" · ") : "none declared"}`,
      `  write scope: ${open.writeScopes.length ? open.writeScopes.map(visible).join(" · ") : "none declared"}`,
    );
    if (item.blockedBy.length) lines.push(`  blocked by: ${item.blockedBy.map(visible).join(" · ")}`);
    if (item.conflictsWith.length) lines.push(`  conflicts with: ${item.conflictsWith.map(visible).join(" · ")}`);
    if (item.closed) {
      lines.push(`  result evidence: ${item.closed.resultEvidence.length ? item.closed.resultEvidence.map(visible).join(" · ") : "none (cancelled)"}`);
    }
  }
  if (ledger.orphaned.length) lines.push("", `ORPHANED  ${ledger.orphaned.map((item) => visible(item.work)).join(" · ")}`);
  if (ledger.unsynthesized.length) {
    lines.push("", "UNSYNTHESIZED", ...ledger.unsynthesized.map((row) => `  ${visible(row.parent)} has not synthesized ${visible(row.child)} (${row.reason})`));
  }
  lines.push("", "  planned work is inert: this ledger stores coordination state and never executes it.");
  return { text: lines.join("\n"), ledger, works };
}

export const renderWorkLedger = renderWork;
