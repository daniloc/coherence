// consequence.ts — explicit, attributable links across the records an agent leaves behind.
//
// Decisions, work, commits, experiments, verification, and defects already have useful
// identities. What they did not have was causality: a reader could see that two records
// were nearby in time or touched one path, but neither fact says one implemented, tested,
// contradicted, or repaired the other. This ledger records only the relationship an
// assessor actually states. It never mines timestamps or Git diffs to manufacture edges.
//
// One JSONL file per writer session preserves the same concurrency property as the
// decision and experiment ledgers. The merged reader is strict: malformed or conflicting
// surviving evidence makes the projection unavailable rather than shrinking the graph.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, writeSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { Config } from "./types.ts";

export const CONSEQUENCE_VERSION = 1 as const;
export const CONSEQUENCE_KINDS = Object.freeze([
  "decision", "work", "commit", "experiment", "verification", "defect",
] as const);
export type ConsequenceKind = typeof CONSEQUENCE_KINDS[number];

export const CONSEQUENCE_RELATIONS = Object.freeze([
  "authorizes", "implements", "produces", "evaluates", "verifies", "supports",
  "contradicts", "reveals", "repairs", "supersedes", "depends-on",
] as const);
export type ConsequenceRelation = typeof CONSEQUENCE_RELATIONS[number];

export interface ConsequenceRef {
  kind: ConsequenceKind;
  id: string;
}

export interface ConsequenceRepoSnapshot {
  branch: string | null;
  commit: string | null;
  dirty: boolean | null;
}

export interface ConsequenceRecord {
  version: typeof CONSEQUENCE_VERSION;
  event: "linked";
  id: string;
  at: string;
  session: string;
  agent: string;
  job: string;
  basis: "agent-assessed";
  repo: ConsequenceRepoSnapshot;
  from: ConsequenceRef;
  relation: ConsequenceRelation;
  to: ConsequenceRef;
  /** Why this edge is warranted. It is evidence for the relation, not proof of causality. */
  evidence: string;
}

export interface RecordConsequenceInput {
  session: string;
  from: ConsequenceRef;
  relation: ConsequenceRelation;
  to: ConsequenceRef;
  evidence: string;
  agent?: string;
  job?: string;
  now?: string;
}

export interface ConsequenceLedger {
  records: ConsequenceRecord[];
}

export interface ConsequenceTrace {
  focus: ConsequenceRef | null;
  records: ConsequenceRecord[];
  refs: ConsequenceRef[];
}

export class ConsequenceLedgerError extends Error {
  readonly problems: string[];
  constructor(problems: string | string[]) {
    const all = Array.isArray(problems) ? problems : [problems];
    super(`consequence ledger refused: ${all.join("; ")}`);
    this.name = "ConsequenceLedgerError";
    this.problems = all;
  }
}

export const consequencesDir = (cfg: Config): string => join(cfg.root, ".coherence", "consequences");
function consequenceSessionFilename(session: string): string {
  const key = createHash("sha256")
    .update("coherence:consequence-session\0")
    .update(session, "utf8")
    .digest("hex");
  return `s-${key}.jsonl`;
}
export const consequenceSessionPath = (cfg: Config, session: string): string =>
  join(consequencesDir(cfg), consequenceSessionFilename(session));

function ledgerDirectoryPresent(cfg: Config): boolean {
  const coherence = join(cfg.root, ".coherence");
  for (const [path, label] of [[coherence, ".coherence"], [consequencesDir(cfg), ".coherence/consequences"]] as const) {
    let standing;
    try { standing = lstatSync(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new ConsequenceLedgerError(`${label} cannot be inspected`);
    }
    if (standing.isSymbolicLink() || !standing.isDirectory()) {
      throw new ConsequenceLedgerError(`${label} must be a real repository directory, never a symlink`);
    }
  }
  return true;
}

function ensureLedgerDirectory(cfg: Config): void {
  const coherence = join(cfg.root, ".coherence");
  for (const [path, label] of [[coherence, ".coherence"], [consequencesDir(cfg), ".coherence/consequences"]] as const) {
    if (!existsSync(path)) mkdirSync(path);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new ConsequenceLedgerError(`${label} must be a real repository directory, never a symlink`);
    }
  }
}

const kindSet = new Set<string>(CONSEQUENCE_KINDS);
const relationSet = new Set<string>(CONSEQUENCE_RELATIONS);
const byteCompare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}

const digest = (value: unknown): string => createHash("sha256").update(stable(value)).digest("hex");
const recordId = (value: unknown): string => `lnk-${digest(value).slice(0, 12)}`;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ConsequenceLedgerError(`${field} must be non-empty`);
  if (value !== text) throw new ConsequenceLedgerError(`${field} must not have surrounding whitespace`);
  if (/[\x00-\x1f\x7f-\x9f]/.test(text)) throw new ConsequenceLedgerError(`${field} contains control bytes`);
  return text;
}

function exactSession(value: unknown): string {
  const session = nonempty(value, "session");
  if (session === "unknown") throw new ConsequenceLedgerError("session must identify the exact writer, never 'unknown'");
  return session;
}

function canonicalTime(value: unknown): string {
  const at = nonempty(value, "time");
  if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) {
    throw new ConsequenceLedgerError("time must be a canonical ISO timestamp");
  }
  return at;
}

function ref(value: unknown, field: string): ConsequenceRef {
  if (!isObject(value) || Object.keys(value).sort().join(",") !== "id,kind") {
    throw new ConsequenceLedgerError(`${field} must have exactly kind and id`);
  }
  const kind = nonempty(value.kind, `${field}.kind`);
  if (!kindSet.has(kind)) throw new ConsequenceLedgerError(`${field}.kind must be one of ${CONSEQUENCE_KINDS.join(", ")}`);
  const id = nonempty(value.id, `${field}.id`);
  if (id.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(id)) {
    throw new ConsequenceLedgerError(`${field}.id is not a canonical address`);
  }
  return { kind: kind as ConsequenceKind, id };
}

export function parseConsequenceRef(value: string): ConsequenceRef {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new ConsequenceLedgerError(`reference must be a supported kind, colon, and nonempty id: ${value}`);
  }
  return ref({ kind: value.slice(0, separator), id: value.slice(separator + 1) }, "reference");
}

export const formatConsequenceRef = (value: ConsequenceRef): string => `${value.kind}:${value.id}`;

/** Relation endpoint types are law, not documentation. Broad relationships remain
 * available (`supports`, `contradicts`, `depends-on`), while a nonsensical specialized
 * edge such as a defect "authorizes" a commit refuses at write and read time. */
export function relationProblem(
  from: ConsequenceRef,
  relation: ConsequenceRelation,
  to: ConsequenceRef,
): string | null {
  if (formatConsequenceRef(from) === formatConsequenceRef(to)) return "a consequence cannot link a record to itself";
  const pair = `${from.kind}->${to.kind}`;
  if (relation === "authorizes" && from.kind === "decision" && to.kind === "work") return null;
  if (relation === "implements" && ["work", "commit"].includes(from.kind) && to.kind === "decision") return null;
  if (relation === "produces" && from.kind === "work" && to.kind === "commit") return null;
  if (relation === "evaluates" && ["experiment", "verification"].includes(from.kind)
    && ["decision", "work", "commit"].includes(to.kind)) return null;
  if (relation === "verifies" && from.kind === "verification"
    && ["decision", "work", "commit", "experiment"].includes(to.kind)) return null;
  if ((relation === "supports" || relation === "contradicts")
    && ["experiment", "verification", "defect"].includes(from.kind)) return null;
  if (relation === "reveals" && ["experiment", "verification"].includes(from.kind) && to.kind === "defect") return null;
  // A repair is represented by the work or commit that performs it; there is no second,
  // mutable "repair" entity to reconcile with the work graph.
  if (relation === "repairs" && ["work", "commit"].includes(from.kind) && to.kind === "defect") return null;
  if (relation === "supersedes" && from.kind === to.kind) return null;
  if (relation === "depends-on") return null;
  return `${relation} does not admit ${pair}`;
}

function snapshot(root: string): ConsequenceRepoSnapshot {
  const run = (args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const branch = run(["branch", "--show-current"]);
  const commit = run(["rev-parse", "HEAD"]);
  const dirty = run(["status", "--porcelain"]);
  return {
    branch: branch.status === 0 && branch.stdout.trim() ? branch.stdout.trim() : null,
    commit: commit.status === 0 && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.stdout.trim())
      ? commit.stdout.trim() : null,
    dirty: dirty.status === 0 ? !!dirty.stdout.trim() : null,
  };
}

type ConsequenceIdentity = Omit<ConsequenceRecord, "id">;
const identity = (record: ConsequenceRecord): ConsequenceIdentity => {
  const { id: _id, ...body } = record;
  return body;
};

function validateRepo(value: unknown): ConsequenceRepoSnapshot {
  if (!isObject(value) || Object.keys(value).sort().join(",") !== "branch,commit,dirty") {
    throw new ConsequenceLedgerError("repo must have exactly branch, commit, and dirty");
  }
  if (!(value.branch === null || (typeof value.branch === "string" && !!value.branch.trim() && value.branch === value.branch.trim()))) {
    throw new ConsequenceLedgerError("repo.branch must be a trimmed non-empty string|null");
  }
  if (!(value.commit === null || (typeof value.commit === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit)))) {
    throw new ConsequenceLedgerError("repo.commit must be a lowercase SHA-1/SHA-256 object name|null");
  }
  if (!(value.dirty === null || typeof value.dirty === "boolean")) {
    throw new ConsequenceLedgerError("repo.dirty must be boolean|null");
  }
  return value as unknown as ConsequenceRepoSnapshot;
}

function validateRecord(raw: unknown, source: string): ConsequenceRecord {
  if (!isObject(raw)) throw new ConsequenceLedgerError(`${source} must be a JSON object`);
  const expected = [
    "agent", "at", "basis", "event", "evidence", "from", "id", "job", "relation",
    "repo", "session", "to", "version",
  ].sort();
  if (Object.keys(raw).sort().join(",") !== expected.join(",")) {
    throw new ConsequenceLedgerError(`${source} has a non-canonical shape`);
  }
  if (raw.version !== CONSEQUENCE_VERSION || raw.event !== "linked" || raw.basis !== "agent-assessed") {
    throw new ConsequenceLedgerError(`${source} has unsupported version, event, or basis`);
  }
  const from = ref(raw.from, `${source}.from`);
  const to = ref(raw.to, `${source}.to`);
  const relation = nonempty(raw.relation, `${source}.relation`);
  if (!relationSet.has(relation)) throw new ConsequenceLedgerError(`${source}.relation is unsupported`);
  const problem = relationProblem(from, relation as ConsequenceRelation, to);
  if (problem) throw new ConsequenceLedgerError(`${source}: ${problem}`);
  const record: ConsequenceRecord = {
    version: CONSEQUENCE_VERSION,
    event: "linked",
    id: nonempty(raw.id, `${source}.id`),
    at: canonicalTime(raw.at),
    session: exactSession(raw.session),
    agent: nonempty(raw.agent, `${source}.agent`),
    job: nonempty(raw.job, `${source}.job`),
    basis: "agent-assessed",
    repo: validateRepo(raw.repo),
    from,
    relation: relation as ConsequenceRelation,
    to,
    evidence: nonempty(raw.evidence, `${source}.evidence`),
  };
  if (!/^lnk-[a-f0-9]{12}$/.test(record.id) || record.id !== recordId(identity(record))) {
    throw new ConsequenceLedgerError(`${source}.id does not match its content`);
  }
  return record;
}

export function readConsequences(cfg: Config): ConsequenceLedger {
  const dir = consequencesDir(cfg);
  if (!ledgerDirectoryPresent(cfg)) return { records: [] };
  const problems: string[] = [];
  const byId = new Map<string, { record: ConsequenceRecord; bytes: string }>();
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => byteCompare(a.name, b.name));
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isSymbolicLink()) {
      problems.push(`${name} is a symlink; consequence evidence must stay inside the repository`);
      continue;
    }
    if (name !== ".DS_Store" && !name.endsWith(".jsonl")) {
      problems.push(`${name} is an unexpected consequence-ledger entry; only session .jsonl files belong here`);
      continue;
    }
    if (!name.endsWith(".jsonl")) continue;
    if (!entry.isFile()) {
      problems.push(`${name} is not a regular consequence-ledger file`);
      continue;
    }
    const path = join(dir, name);
    let text = "";
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new ConsequenceLedgerError(`${name} is not a contained regular file`);
      text = readFileSync(path, "utf8");
    }
    catch (error) { problems.push(`${name} cannot be read: ${error instanceof Error ? error.message : String(error)}`); continue; }
    if (!text.trim()) {
      problems.push(`${name} contains no consequence rows`);
      continue;
    }
    const lines = text.split("\n");
    if (lines.pop() !== "") {
      problems.push(`${name} has no canonical final newline; its last append may be torn`);
      continue;
    }
    for (let index = 0; index < lines.length; index += 1) {
      const source = `${name}:${index + 1}`;
      if (!lines[index]!.trim()) {
        problems.push(`${source} is a blank consequence row`);
        continue;
      }
      try {
        const parsed = validateRecord(JSON.parse(lines[index]), source);
        if (basename(consequenceSessionPath(cfg, parsed.session)) !== name) {
          throw new ConsequenceLedgerError(`${source} is displaced from writer session ${parsed.session}`);
        }
        const prior = byId.get(parsed.id);
        if (prior && prior.bytes !== stable(parsed)) {
          throw new ConsequenceLedgerError(`${source} conflicts with another row carrying ${parsed.id}`);
        }
        byId.set(parsed.id, { record: parsed, bytes: stable(parsed) });
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  if (problems.length) throw new ConsequenceLedgerError(problems);
  return {
    records: [...byId.values()].map((value) => value.record)
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
  };
}

/** Append an assessed edge. Exact semantic retries return the existing row. */
export function recordConsequence(cfg: Config, input: RecordConsequenceInput): ConsequenceRecord {
  const session = exactSession(input.session);
  const from = ref(input.from, "from");
  const to = ref(input.to, "to");
  if (!relationSet.has(input.relation)) throw new ConsequenceLedgerError(`relation is unsupported: ${String(input.relation)}`);
  const problem = relationProblem(from, input.relation, to);
  if (problem) throw new ConsequenceLedgerError(problem);
  const evidence = nonempty(input.evidence, "evidence");
  const agent = nonempty(input.agent ?? process.env.COHERENCE_AGENT ?? "main", "agent");
  const repo = snapshot(cfg.root);
  const job = nonempty(input.job ?? process.env.COHERENCE_JOB ?? repo.branch ?? "-", "job");
  const existing = readConsequences(cfg);
  const semantic = stable({ session, agent, job, from, relation: input.relation, to, evidence });
  const retry = existing.records.find((record) => stable({
    session: record.session, agent: record.agent, job: record.job, from: record.from,
    relation: record.relation, to: record.to, evidence: record.evidence,
  }) === semantic);
  if (retry) return retry;
  const body: ConsequenceIdentity = {
    version: CONSEQUENCE_VERSION,
    event: "linked",
    at: canonicalTime(input.now ?? new Date().toISOString()),
    session,
    agent,
    job,
    basis: "agent-assessed",
    repo,
    from,
    relation: input.relation,
    to,
    evidence,
  };
  const record: ConsequenceRecord = { ...body, id: recordId(body) };
  ensureLedgerDirectory(cfg);
  const path = consequenceSessionPath(cfg, session);
  const target = basename(path);
  if (existsSync(path)) {
    const standing = lstatSync(path);
    if (standing.isSymbolicLink() || !standing.isFile()) {
      throw new ConsequenceLedgerError(`${target} is not a contained regular append target`);
    }
  }
  const flags = constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
  let fd: number;
  try { fd = openSync(path, flags, 0o666); }
  catch (error) {
    throw new ConsequenceLedgerError(`${target} cannot be opened as a contained append target${(error as NodeJS.ErrnoException).code ? ` (${(error as NodeJS.ErrnoException).code})` : ""}`);
  }
  try {
    const opened = fstatSync(fd);
    const standing = lstatSync(path);
    if (!opened.isFile() || !standing.isFile() || standing.isSymbolicLink()
      || opened.dev !== standing.dev || opened.ino !== standing.ino) {
      throw new ConsequenceLedgerError(`${target} changed identity while opening; refusing the append`);
    }
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
    for (let offset = 0; offset < bytes.length;) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new ConsequenceLedgerError(`${target} append made no progress`);
      offset += written;
    }
  } finally { closeSync(fd); }
  return record;
}

/** Undirected navigation around an explicit focus. Direction and relation remain on
 * every returned edge; traversal in both directions prevents "what repaired this?" and
 * "what did this repair?" from requiring two indexes. */
export function traceConsequences(ledger: ConsequenceLedger, focus: ConsequenceRef | null = null): ConsequenceTrace {
  const key = focus ? formatConsequenceRef(focus) : null;
  const records = key === null ? [...ledger.records] : ledger.records.filter((record) =>
    formatConsequenceRef(record.from) === key || formatConsequenceRef(record.to) === key);
  const refs = new Map<string, ConsequenceRef>();
  if (focus) refs.set(key!, focus);
  for (const record of records) {
    refs.set(formatConsequenceRef(record.from), record.from);
    refs.set(formatConsequenceRef(record.to), record.to);
  }
  return {
    focus,
    records,
    refs: [...refs.values()].sort((a, b) => byteCompare(formatConsequenceRef(a), formatConsequenceRef(b))),
  };
}

function visible(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, (char) =>
    `\\u${char.codePointAt(0)!.toString(16).padStart(4, "0")}`);
}

export function renderConsequences(cfg: Config, focus: ConsequenceRef | null = null): {
  text: string;
  trace: ConsequenceTrace;
} {
  const trace = traceConsequences(readConsequences(cfg), focus);
  const title = focus
    ? `CONSEQUENCES around ${visible(formatConsequenceRef(focus))}`
    : "CONSEQUENCES — explicit assessed links only";
  const lines = [title];
  if (!trace.records.length) return { text: `${title}\n  no recorded links`, trace };
  lines.push(`  ${trace.records.length} link(s) · ${trace.refs.length} referenced record(s)`);
  for (const record of trace.records) {
    lines.push(
      "",
      `  ${visible(formatConsequenceRef(record.from))} --${record.relation}--> ${visible(formatConsequenceRef(record.to))}`,
      `    ${record.id} · ${record.at} · ${visible(record.session)} (${visible(record.agent)})`,
      `    evidence: ${visible(record.evidence)}`,
    );
  }
  lines.push("", "  limitation: proximity, shared paths, and shared commits create no edge; every link above was explicitly assessed.");
  return { text: lines.join("\n"), trace };
}
