// read-trace.ts — the dependency-light PostToolUse hook path.
//
// This file MUST stay cheap to import: it runs after every explicit read/write-bearing
// tool. Graph derivation, TypeScript, git history and calibration math belong at Stop or
// in the `calibrate` command, never on this tick.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  activityRow,
  type ActivityAttribution,
  type ActivityHost,
  type ActivityTransport,
} from "./activity.ts";
import type { Config } from "./types.ts";

export type TraceMode = "read" | "write";
export type PatchOperation = "add" | "update" | "delete" | "move";
export interface ReadEventProvenance {
  source: "apply_patch";
  operation: PatchOperation;
}
export interface ReadEventObservation {
  version: 1;
  host: ActivityHost;
  transport: ActivityTransport;
  bundleHash: string | null;
  parentSession: string | null;
  agentId: string | null;
  attribution: ActivityAttribution;
  /** Stable only when the host supplied a turn or tool-call id. */
  eventId: string | null;
}
export interface ReadEvent {
  at: string;
  session: string;
  tool: string;
  mode: TraceMode;
  path: string;
  /** Absent on every pre-Codex and explicit-path row: old trace wire stays unchanged. */
  provenance?: ReadEventProvenance;
  /** Absent on legacy rows. Absence remains visible as legacy-unscoped evidence. */
  observation?: ReadEventObservation;
}

export interface TraceRead {
  rows: ReadEvent[];
  /** Torn, foreign, or structurally invalid rows never become evidence by omission. */
  unreadable: number;
}

interface PathCandidate { path: string; provenance?: ReadEventProvenance }

const traceDir = (cfg: Config) => join(cfg.root, ".coherence", "read-traces");
const legacySlug = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "unknown";
/** Sanitisation and truncation must not merge two concurrent host sessions. */
const slug = (raw: string): string => {
  const clean = raw.replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "").replace(/[-.]+$/, "").replace(/-{2,}/g, "-");
  const safe = (clean || "x").slice(0, 80);
  return safe === raw ? safe : `${safe}-${createHash("sha256").update(raw).digest("hex").slice(0, 8)}`;
};

/**
 * Parse only the formal file headers accepted by the apply_patch tool. This is not shell
 * command inference: it runs solely for canonical `tool_name: "apply_patch"`, requires the
 * complete Begin/End envelope, and ignores arbitrary command text from Bash.
 */
export function applyPatchCandidates(command: unknown): PathCandidate[] {
  if (typeof command !== "string") return [];
  const lines = command.replaceAll("\r\n", "\n").split("\n");
  while (lines.at(-1) === "") lines.pop();
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") return [];
  if (lines.slice(1, -1).some((line) => line === "*** Begin Patch" || line === "*** End Patch")) return [];

  const out: PathCandidate[] = [];
  let current: PatchOperation | null = null;
  for (const line of lines.slice(1, -1)) {
    const file = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (file) {
      const operation = file[1].toLowerCase() as "add" | "update" | "delete";
      const path = file[2].trim();
      current = operation;
      if (path && !path.includes("\0")) out.push({ path, provenance: { source: "apply_patch", operation } });
      continue;
    }
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (move && current === "update") {
      const path = move[1].trim();
      if (path && !path.includes("\0")) out.push({ path, provenance: { source: "apply_patch", operation: "move" } });
    }
  }
  return out;
}

/** Generic enough for Claude hook payloads without coupling the core to one version of
 * their schema. Explicit fields count everywhere; formal patch headers count only for
 * Codex's structured apply_patch tool. Bash command text is never parsed. */
function hookPathCandidates(payload: unknown): {
  session: string; tool: string; mode: TraceMode; candidates: PathCandidate[];
} {
  const p = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const input = p.tool_input && typeof p.tool_input === "object" ? p.tool_input as Record<string, unknown> : {};
  // Claude-compatible hosts put the unique agent id on every tool event inside a
  // subagent; the parent session id alone would merge concurrent agents' traces.
  const session = String(p.agent_id ?? p.agentId ?? p.session_id ?? p.sessionId ?? process.env.COHERENCE_SESSION ?? "unknown");
  const tool = String(p.tool_name ?? p.toolName ?? "unknown");
  const mode: TraceMode = /^(Write|Edit|MultiEdit|NotebookEdit|apply_patch)$/i.test(tool) ? "write" : "read";
  const raw: unknown[] = [input.file_path, input.filePath, input.path, input.notebook_path];
  if (Array.isArray(input.paths)) raw.push(...input.paths);
  const byPath = new Map<string, PathCandidate>();
  for (const path of raw.filter((x): x is string => typeof x === "string" && !!x.trim())) {
    byPath.set(path, { path });
  }
  // Structured provenance wins if a host redundantly supplies the same explicit path.
  if (tool === "apply_patch") {
    for (const candidate of applyPatchCandidates(input.command)) byPath.set(candidate.path, candidate);
  }
  return { session, tool, mode, candidates: [...byPath.values()] };
}

/** The historical public payload API: exact keys and path-array shape are preserved. */
export function hookReadCandidates(payload: unknown): { session: string; tool: string; mode: TraceMode; paths: string[] } {
  const { session, tool, mode, candidates } = hookPathCandidates(payload);
  return { session, tool, mode, paths: candidates.map((candidate) => candidate.path) };
}

function repoPath(cfg: Config, p: string, mustExist: boolean): string | null {
  try {
    const abs = resolve(cfg.root, p);
    const rel = relative(cfg.root, abs).replace(/\\/g, "/");
    if (!rel || rel === "." || rel.startsWith("../") || isAbsolute(rel)) return null;
    if (mustExist && !statSync(abs).isFile()) return null;
    return rel;
  } catch { return null; }
}

/** PostToolUse write: tiny, append-only, and intentionally outside the committed record. */
export function recordHookReads(cfg: Config, payload: unknown, now = new Date().toISOString()): ReadEvent[] {
  const { session, tool, mode, candidates } = hookPathCandidates(payload);
  const at = Number.isFinite(Date.parse(now)) ? new Date(now).toISOString() : now;
  const host = process.env.COHERENCE_HOOK_HOST;
  const observed = activityRow("PostToolUse", payload, {
    host: host === "claude" || host === "codex" ? host : "unknown",
    transport: process.env.COHERENCE_HOOK_TRANSPORT === "launcher" ? "launcher" : "direct",
    bundleHash: process.env.COHERENCE_HOOK_BUNDLE_FINGERPRINT ?? null,
    experimentId: null,
  }, at);
  const observation: ReadEventObservation = {
    version: 1,
    host: observed.host,
    transport: observed.transport,
    bundleHash: observed.bundleHash,
    parentSession: observed.parentSession,
    agentId: observed.agentId,
    attribution: observed.attribution,
    eventId: observed.eventId,
  };
  const events: ReadEvent[] = [];
  for (const candidate of candidates) {
    // Delete and move-source paths legitimately do not exist after PostToolUse. Formal
    // apply_patch provenance is the positive evidence that lets those writes survive;
    // explicit paths retain the historical real-file requirement.
    const path = repoPath(cfg, candidate.path, candidate.provenance === undefined);
    if (path) events.push({
      at, session, tool, mode, path,
      ...(candidate.provenance ? { provenance: candidate.provenance } : {}),
      observation,
    });
  }
  if (!events.length) return events;
  mkdirSync(traceDir(cfg), { recursive: true });
  appendFileSync(join(traceDir(cfg), `${slug(session)}.jsonl`), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return events;
}

const HOSTS = new Set<string>(["claude", "codex", "unknown"]);
const ATTRIBUTIONS = new Set<string>(["agent", "session", "parent-fallback", "unknown"]);

function nullableText(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.length > 0);
}

function validObservation(value: unknown, session: string): value is ReadEventObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const shape = row.version === 1
    && HOSTS.has(String(row.host))
    && (row.transport === "launcher" || row.transport === "direct")
    && ATTRIBUTIONS.has(String(row.attribution))
    && nullableText(row.bundleHash)
    && nullableText(row.parentSession)
    && nullableText(row.agentId)
    && nullableText(row.eventId)
    && (row.eventId === null || /^e-[a-f0-9]{16}$/.test(String(row.eventId)));
  if (!shape) return false;
  if (row.attribution === "agent") return row.agentId === session;
  if (row.attribution === "session") return row.agentId === null && row.parentSession === null;
  if (row.attribution === "parent-fallback") return row.agentId === null && row.parentSession === session;
  return row.agentId === null && row.parentSession === null;
}

function validProvenance(value: unknown): value is ReadEventProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.source === "apply_patch"
    && ["add", "update", "delete", "move"].includes(String(row.operation));
}

/** Strict reader used by experiments and status surfaces that must report lost evidence. */
export function readTraceDetailed(cfg: Config, session: string): TraceRead {
  const current = join(traceDir(cfg), `${slug(session)}.jsonl`);
  const legacy = join(traceDir(cfg), `${legacySlug(session)}.jsonl`);
  const sources = [
    ...(legacy !== current && existsSync(legacy) ? [{ path: legacy, legacy: true }] : []),
    ...(existsSync(current) ? [{ path: current, legacy: false }] : []),
  ];
  if (!sources.length) return { rows: [], unreadable: 0 };
  const rows: ReadEvent[] = [];
  let unreadable = 0;
  for (const source of sources) {
    for (const line of readFileSync(source.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { unreadable++; continue; }
        const e = parsed as Record<string, unknown>;
        // Old sanitised filenames could be shared by two distinct session ids. A complete
        // foreign row belongs to the other session; it is not damage in this one's trace.
        if (source.legacy && typeof e.session === "string" && e.session !== session) continue;
        const mode = e.mode ?? "read";
        if (e.session !== session || typeof e.at !== "string" || !e.at
          || !Number.isFinite(Date.parse(e.at)) || new Date(e.at).toISOString() !== e.at
          || typeof e.tool !== "string" || !e.tool || typeof e.path !== "string" || !e.path
          || (mode !== "read" && mode !== "write")
          || (e.provenance !== undefined && !validProvenance(e.provenance))
          || (e.observation !== undefined && !validObservation(e.observation, session))) {
          unreadable++;
          continue;
        }
        rows.push({
          at: e.at,
          session,
          tool: e.tool,
          mode,
          path: e.path,
          ...(e.provenance ? { provenance: e.provenance as ReadEventProvenance } : {}),
          ...(e.observation ? { observation: e.observation as ReadEventObservation } : {}),
        });
      } catch { unreadable++; }
    }
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  return { rows, unreadable };
}

/** Historical convenience reader: callers needing loss accounting use readTraceDetailed. */
export function readTrace(cfg: Config, session: string): ReadEvent[] {
  return readTraceDetailed(cfg, session).rows;
}
