// defects.ts — append-only, agent-assessed defect evidence.
//
// A defect row is deliberately smaller than an experiment or a decision. It says that
// one caller-attributed agent assessed one observed contradiction as a defect, preserves the
// evidence behind that assessment, and stops there. There is no status or closure event:
// repair lifecycle belongs to a later controller contract, not to the fact that the
// defect was observed.
//
// ONE FILE PER WRITING SESSION keeps concurrent agents from sharing an append target.
// The merged reader is strict because this record is intended to become calibration and
// control evidence: a surviving malformed, internally inconsistent, or detached row must
// make the corpus unavailable, never quietly make the measured defect population smaller.
// A self-contained hash is not an adversarial rewrite witness; committed Git history is
// the external witness for clean rewrites or deletion.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, writeSync,
} from "node:fs";
import { basename, join, posix } from "node:path";
import { slug } from "./decisions.ts";
import type { Config } from "./types.ts";

export const DEFECT_VERSION = 1 as const;
export const DEFECT_BASIS = "agent-assessed" as const;

export interface DefectRepoSnapshot {
  branch: string | null;
  commit: string | null;
  /** null means git could not answer; it is never silently reported as a clean tree. */
  dirty: boolean | null;
}

export interface DefectRecord {
  version: typeof DEFECT_VERSION;
  event: "recorded";
  id: string;
  at: string;
  /** This is an agent's assessed conclusion, not a claim of machine proof. */
  basis: typeof DEFECT_BASIS;
  session: string;
  agent: string;
  job: string;
  repo: DefectRepoSnapshot;
  summary: string;
  evidence: string;
  /** Canonical, unique, sorted repository-relative paths; absence is represented by []. */
  files: string[];
}

export interface RecordDefectInput {
  /** Required exact, non-placeholder writer-session label. Host hooks supply their id. */
  session: string;
  summary: string;
  evidence: string;
  files?: string[];
  agent?: string;
  job?: string;
  now?: string;
}

export interface DefectLedger {
  /** Exact duplicate rows collapse in this view; the append-only bytes are untouched. */
  records: DefectRecord[];
}

export interface RenderDefectOpts {
  session?: string | null;
}

/** A refusal surface for callers that must not confuse damaged evidence with no evidence. */
export class DefectLedgerError extends Error {
  readonly problems: string[];

  constructor(problems: string | string[]) {
    const all = Array.isArray(problems) ? problems : [problems];
    super(`defect ledger refused: ${all.join("; ")}`);
    this.name = "DefectLedgerError";
    this.problems = all;
  }
}

export function defectsDir(cfg: Config): string {
  return join(cfg.root, ".coherence", "defects");
}

/**
 * Defect writers need a stronger filename property than the general journal slug:
 * distinct exact sessions must not alias merely because the target filesystem folds
 * case or normalizes Unicode. A full SHA-256 of the raw UTF-8 session, rendered as
 * lowercase ASCII, is stable under both transformations and keeps the path bounded.
 *
 * The session itself remains in every content-addressed row; this is only its append target.
 */
function defectSessionFilename(session: string): string {
  const key = createHash("sha256")
    .update("coherence:defect-session\0")
    .update(session, "utf8")
    .digest("hex");
  return `s-${key}.jsonl`;
}

export function defectSessionPath(cfg: Config, session: string): string {
  return join(defectsDir(cfg), defectSessionFilename(session));
}

/** Pre-release defect rows used the shared journal slug. Keep those bytes readable. */
function legacyDefectSessionFilename(session: string): string {
  return `${slug(session)}.jsonl`;
}

function acceptedSessionFilenames(session: string): string[] {
  return [...new Set([defectSessionFilename(session), legacyDefectSessionFilename(session)])];
}

/** The equivalence imposed by the least discriminating supported filesystem. */
function portableFilenameKey(filename: string): string {
  return filename.normalize("NFD").toLowerCase();
}

function nonempty(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new DefectLedgerError(`${field} must be non-empty`);
  return text;
}

function exactSession(value: unknown): string {
  const session = nonempty(value, "session");
  if (value !== session) {
    throw new DefectLedgerError("session must be an exact trimmed writer-session label");
  }
  if (session === "unknown") {
    throw new DefectLedgerError("session must be an exact non-empty writer-session label, never 'unknown'");
  }
  return session;
}

function iso(value: string | undefined): string {
  const at = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) {
    throw new DefectLedgerError("time must be a canonical ISO timestamp");
  }
  return at;
}

function repoPath(value: unknown, field = "file path"): string {
  const raw = nonempty(value, field).replace(/\\/g, "/");
  const path = posix.normalize(raw.replace(/^\.\//, ""));
  if (path === "." || path.startsWith("/") || /^[A-Za-z]:\//.test(path)
    || path === ".." || path.startsWith("../") || path.includes("\0")) {
    throw new DefectLedgerError(`${field} must stay inside the repository: ${String(value)}`);
  }
  return path;
}

function normalizedFiles(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new DefectLedgerError("files must be an array");
  return [...new Set(value.map((file, index) => repoPath(file, `files[${index}]`)))].sort();
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}

const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const recordId = (value: unknown) => `def-${digest(value).slice(0, 12)}`;

function repoSnapshot(root: string): DefectRepoSnapshot {
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

type DefectIdentity = Omit<DefectRecord, "id">;

function identity(record: DefectRecord): DefectIdentity {
  const { id: _id, ...body } = record;
  return body;
}

function requestedIdentity(record: Pick<DefectRecord,
  "basis" | "session" | "agent" | "job" | "summary" | "evidence" | "files">): unknown {
  return {
    basis: record.basis,
    session: record.session,
    agent: record.agent,
    job: record.job,
    summary: record.summary,
    evidence: record.evidence,
    files: record.files,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  problems: string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (stable(actual) !== stable(wanted)) {
    const missing = wanted.filter((key) => !actual.includes(key));
    const extra = actual.filter((key) => !wanted.includes(key));
    problems.push(`${label} has a non-canonical shape`
      + `${missing.length ? `; missing ${missing.join(", ")}` : ""}`
      + `${extra.length ? `; unknown ${extra.join(", ")}` : ""}`);
  }
}

function stringField(
  value: Record<string, unknown>,
  key: string,
  problems: string[],
  label: string,
): string {
  if (typeof value[key] !== "string" || !(value[key] as string).trim()) {
    problems.push(`${label}.${key} must be a non-empty string`);
    return "";
  }
  if (value[key] !== (value[key] as string).trim()) {
    problems.push(`${label}.${key} must not have surrounding whitespace`);
  }
  return value[key] as string;
}

function validateRepo(value: unknown, problems: string[], label: string): value is DefectRepoSnapshot {
  if (!isObject(value)) {
    problems.push(`${label}.repo must be an object`);
    return false;
  }
  exactKeys(value, ["branch", "commit", "dirty"], problems, `${label}.repo`);
  if (!(value.branch === null || (typeof value.branch === "string" && value.branch.trim() === value.branch && !!value.branch))) {
    problems.push(`${label}.repo.branch must be a non-empty trimmed string|null`);
  }
  if (!(value.commit === null || (typeof value.commit === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit)))) {
    problems.push(`${label}.repo.commit must be a lowercase 40- or 64-hex Git object name|null`);
  }
  if (!(value.dirty === null || typeof value.dirty === "boolean")) {
    problems.push(`${label}.repo.dirty must be boolean|null`);
  }
  return true;
}

/** The ledger is a committed repository path, never an indirection to another tree. */
function ledgerDirectoryPresent(cfg: Config): boolean {
  const coherence = join(cfg.root, ".coherence");
  const dir = defectsDir(cfg);
  for (const [path, label] of [[coherence, ".coherence"], [dir, ".coherence/defects"]] as const) {
    let stat;
    try { stat = lstatSync(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      const code = (error as NodeJS.ErrnoException).code;
      throw new DefectLedgerError(`${label} cannot be inspected${code ? ` (${code})` : ""}`);
    }
    if (stat.isSymbolicLink()) throw new DefectLedgerError(`${label} must be a real repository directory, never a symlink`);
    if (!stat.isDirectory()) throw new DefectLedgerError(`${label} must be a directory`);
  }
  return true;
}

function parseRecord(raw: unknown, label: string, problems: string[]): DefectRecord | null {
  const before = problems.length;
  if (!isObject(raw)) {
    problems.push(`${label} must be a JSON object`);
    return null;
  }
  exactKeys(raw, [
    "version", "event", "id", "at", "basis", "session", "agent", "job", "repo", "summary", "evidence", "files",
  ], problems, label);
  if (raw.version !== DEFECT_VERSION) problems.push(`${label}.version must be ${DEFECT_VERSION}`);
  if (raw.event !== "recorded") problems.push(`${label}.event must be recorded`);
  if (raw.basis !== DEFECT_BASIS) problems.push(`${label}.basis must be ${DEFECT_BASIS}`);
  const id = stringField(raw, "id", problems, label);
  const at = stringField(raw, "at", problems, label);
  const session = stringField(raw, "session", problems, label);
  stringField(raw, "agent", problems, label);
  stringField(raw, "job", problems, label);
  stringField(raw, "summary", problems, label);
  stringField(raw, "evidence", problems, label);
  if (id && !/^def-[a-f0-9]{12}$/.test(id)) problems.push(`${label}.id is not a defect id`);
  if (at && (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at)) {
    problems.push(`${label}.at must be a canonical ISO timestamp`);
  }
  if (session === "unknown") problems.push(`${label}.session may not be unknown`);
  validateRepo(raw.repo, problems, label);
  if (!Array.isArray(raw.files)) {
    problems.push(`${label}.files must be an array`);
  } else {
    let canonical: string[] | null = null;
    try { canonical = normalizedFiles(raw.files); }
    catch (error) {
      const messages = error instanceof DefectLedgerError ? error.problems : [(error as Error).message];
      problems.push(...messages.map((message) => `${label}.${message}`));
    }
    if (canonical && stable(canonical) !== stable(raw.files)) {
      problems.push(`${label}.files must be normalized, unique, and sorted`);
    }
  }
  if (problems.length !== before) return null;
  const record = raw as unknown as DefectRecord;
  if (recordId(identity(record)) !== record.id) {
    problems.push(`${label}.id does not match defect content`);
    return null;
  }
  return record;
}

/** Strict merged read. Exact duplicate rows collapse; every other ambiguity refuses. */
export function readDefects(cfg: Config): DefectLedger {
  const dir = defectsDir(cfg);
  const problems: string[] = [];
  const parsed: { record: DefectRecord; file: string; line: number }[] = [];
  let files: string[];
  if (!ledgerDirectoryPresent(cfg)) return { records: [] };
  try {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => entry.name);
    const portableNames = new Map<string, string>();
    for (const entry of entries) {
      const name = entry.name;
      // Finder metadata is explicitly ignored by the repository. Everything else in this
      // dedicated directory must be legible as ledger data; a renamed row file may not
      // make evidence disappear merely by losing its extension.
      if (entry.isSymbolicLink()) {
        problems.push(`${name} is a symlink; defect evidence and append targets must stay inside the repository`);
        continue;
      }
      if (name !== ".DS_Store" && !name.endsWith(".jsonl")) {
        problems.push(`${name} is an unexpected defect-ledger entry; only session .jsonl files belong here`);
      }
      if (name.endsWith(".jsonl") && !entry.isFile()) {
        problems.push(`${name} is not a regular defect-ledger file`);
      }
      if (name.endsWith(".jsonl")) {
        const key = portableFilenameKey(name);
        const prior = portableNames.get(key);
        if (prior && prior !== name) {
          problems.push(`${prior} and ${name} alias on a case-insensitive or Unicode-normalizing filesystem`);
        } else portableNames.set(key, name);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [] };
    const code = (error as NodeJS.ErrnoException).code;
    throw new DefectLedgerError(`defect directory is unreadable${code ? ` (${code})` : ""}`);
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
      problems.push(`${file} contains no defect rows`);
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
        problems.push(`${label} is a blank defect row`);
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
  if (problems.length) throw new DefectLedgerError(problems);

  const byId = new Map<string, { record: DefectRecord; file: string; line: number }>();
  const sessionsByFile = new Map<string, Set<string>>();
  for (const row of parsed) {
    const expectedFiles = acceptedSessionFilenames(row.record.session);
    if (!expectedFiles.includes(row.file)) {
      problems.push(`${row.file}:${row.line} is detached evidence; it belongs in ${expectedFiles[0]}, the writing session's file`);
    }
    const sessions = sessionsByFile.get(row.file) ?? new Set<string>();
    sessions.add(row.record.session);
    sessionsByFile.set(row.file, sessions);
    const prior = byId.get(row.record.id);
    if (!prior) byId.set(row.record.id, row);
    else if (stable(prior.record) !== stable(row.record)) {
      problems.push(`${row.record.id} has conflicting rows at ${prior.file}:${prior.line} and ${row.file}:${row.line}`);
    }
  }
  for (const [file, sessions] of sessionsByFile) {
    if (sessions.size > 1) {
      problems.push(`${file} combines multiple exact writing sessions: ${[...sessions].sort().join(", ")}`);
    }
  }
  if (problems.length) throw new DefectLedgerError(problems);

  return {
    records: [...byId.values()].map((row) => row.record)
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id) || a.session.localeCompare(b.session)),
  };
}

/** Append one content-addressed assessed fact. An exact semantic retry returns the prior row. */
export function recordDefect(cfg: Config, input: RecordDefectInput): DefectRecord {
  const session = exactSession(input.session);
  const summary = nonempty(input.summary, "summary");
  const evidence = nonempty(input.evidence, "evidence");
  const files = normalizedFiles(input.files);
  const agent = nonempty(input.agent ?? process.env.COHERENCE_AGENT ?? "main", "agent");
  const snapshot = repoSnapshot(cfg.root);
  const job = nonempty(input.job ?? process.env.COHERENCE_JOB ?? snapshot.branch ?? "-", "job");
  const request = { basis: DEFECT_BASIS, session, agent, job, summary, evidence, files };
  const ledger = readDefects(cfg);
  const retry = ledger.records.find((record) => stable(requestedIdentity(record)) === stable(request));
  if (retry) return retry;

  const target = basename(defectSessionPath(cfg, session));
  const targetKey = portableFilenameKey(target);
  const collision = ledger.records.find((record) => record.session !== session
    && portableFilenameKey(basename(defectSessionPath(cfg, record.session))) === targetKey);
  if (collision) {
    throw new DefectLedgerError(`session ${session} collides with ${collision.session} at ${target}; refusing a shared append target`);
  }

  const body: DefectIdentity = {
    version: DEFECT_VERSION,
    event: "recorded",
    at: iso(input.now),
    basis: DEFECT_BASIS,
    session,
    agent,
    job,
    repo: snapshot,
    summary,
    evidence,
    files,
  };
  const record: DefectRecord = { ...body, id: recordId(body) };
  mkdirSync(defectsDir(cfg), { recursive: true });
  if (!ledgerDirectoryPresent(cfg)) throw new DefectLedgerError("defect directory could not be created");
  const targetPath = defectSessionPath(cfg, session);
  try {
    const existing = lstatSync(targetPath);
    if (existing.isSymbolicLink()) throw new DefectLedgerError(`${target} is a symlink; refusing an external append target`);
    if (!existing.isFile()) throw new DefectLedgerError(`${target} is not a regular defect-ledger file`);
  } catch (error) {
    if (!(error instanceof DefectLedgerError) && (error as NodeJS.ErrnoException).code !== "ENOENT") {
      const code = (error as NodeJS.ErrnoException).code;
      throw new DefectLedgerError(`${target} cannot be inspected${code ? ` (${code})` : ""}`);
    }
    if (error instanceof DefectLedgerError) throw error;
  }
  // O_NOFOLLOW closes the final-component check/use race on Unix. The lstat/fstat
  // identity check retains the same refusal on platforms where that flag is unavailable.
  const flags = constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
  let fd: number;
  try { fd = openSync(targetPath, flags, 0o666); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new DefectLedgerError(`${target} cannot be opened as a contained append target${code ? ` (${code})` : ""}`);
  }
  try {
    const opened = fstatSync(fd);
    const standing = lstatSync(targetPath);
    if (!opened.isFile() || !standing.isFile() || standing.isSymbolicLink()
      || opened.dev !== standing.dev || opened.ino !== standing.ino) {
      throw new DefectLedgerError(`${target} changed identity while opening; refusing the append`);
    }
    const bytes = Buffer.from(JSON.stringify(record) + "\n");
    for (let offset = 0; offset < bytes.length;) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new DefectLedgerError(`${target} append made no progress`);
      offset += written;
    }
  } finally { closeSync(fd); }
  return record;
}

function visibleText(value: string): string {
  // Keep real line breaks for field reports, but neutralize bytes that can move a cursor,
  // clear a terminal, or smuggle an ANSI/OSC instruction into this reading surface.
  return value.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, (char) =>
    `\\u${char.codePointAt(0)!.toString(16).padStart(4, "0")}`);
}

function renderedField(label: string, value: string): string[] {
  const [first = "", ...continuation] = visibleText(value).split("\n");
  return [`  ${label}: ${first}`, ...continuation.map((line) => `    | ${line}`)];
}

function visibleLine(value: string): string {
  return visibleText(value).replace(/\n/g, "\\n");
}

/** Human reading surface. The returned records are the same strict rows used for --json. */
export function renderDefects(
  cfg: Config,
  opts: RenderDefectOpts = {},
): { text: string; records: DefectRecord[] } {
  const ledger = readDefects(cfg);
  const records = ledger.records.filter((record) => !opts.session || record.session === opts.session);
  const lines = ["DEFECT RECORD — agent-assessed contradictions and the evidence behind them"];
  if (!records.length) return { text: `${lines[0]}\n  no recorded defects`, records };
  lines.push(`  ${records.length} content-addressed defect(s)`);
  for (const record of records) {
    const cleanliness = record.repo.dirty === true ? " dirty"
      : record.repo.dirty === false ? " clean"
        : " cleanliness unknown";
    const repo = record.repo.commit
      ? `${visibleLine(record.repo.branch ?? "detached")}@${visibleLine(record.repo.commit.slice(0, 12))}${cleanliness}`
      : "repository state unavailable";
    lines.push(
      "",
      `DEFECT ${record.id}  ${record.at}`,
      ...renderedField("summary", record.summary),
      ...renderedField("evidence", record.evidence),
      `  assessed by: ${visibleLine(record.session)} (${visibleLine(record.agent)}, ${visibleLine(record.job)})`,
      `  repository: ${repo}`,
      `  files: ${record.files.length ? record.files.map(visibleLine).join(" · ") : "none attached"}`,
    );
  }
  lines.push("", "  basis: agent-assessed — this record preserves a conclusion and its evidence; it does not claim machine proof.");
  return { text: lines.join("\n"), records };
}
