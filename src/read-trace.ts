// read-trace.ts — the dependency-light PostToolUse hook path.
//
// This file MUST stay cheap to import: it runs after every explicit read/write-bearing
// tool. Graph derivation, TypeScript, git history and calibration math belong at Stop or
// in the `calibrate` command, never on this tick.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Config } from "./types.ts";

export type TraceMode = "read" | "write";
export type PatchOperation = "add" | "update" | "delete" | "move";
export interface ReadEventProvenance {
  source: "apply_patch";
  operation: PatchOperation;
}
export interface ReadEvent {
  at: string;
  session: string;
  tool: string;
  mode: TraceMode;
  path: string;
  /** Absent on every pre-Codex and explicit-path row: old trace wire stays unchanged. */
  provenance?: ReadEventProvenance;
}

interface PathCandidate { path: string; provenance?: ReadEventProvenance }

const traceDir = (cfg: Config) => join(cfg.root, ".coherence", "read-traces");
const slug = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "unknown";

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
  const events: ReadEvent[] = [];
  for (const candidate of candidates) {
    // Delete and move-source paths legitimately do not exist after PostToolUse. Formal
    // apply_patch provenance is the positive evidence that lets those writes survive;
    // explicit paths retain the historical real-file requirement.
    const path = repoPath(cfg, candidate.path, candidate.provenance === undefined);
    if (path) events.push({
      at: now, session, tool, mode, path,
      ...(candidate.provenance ? { provenance: candidate.provenance } : {}),
    });
  }
  if (!events.length) return events;
  mkdirSync(traceDir(cfg), { recursive: true });
  appendFileSync(join(traceDir(cfg), `${slug(session)}.jsonl`), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return events;
}

export function readTrace(cfg: Config, session: string): ReadEvent[] {
  const p = join(traceDir(cfg), `${slug(session)}.jsonl`);
  if (!existsSync(p)) return [];
  const out: ReadEvent[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as ReadEvent;
      if (e.session === session && typeof e.path === "string") out.push({ ...e, mode: e.mode ?? "read" });
    } catch { /* a torn trace is omitted, never promoted to an observation */ }
  }
  return out;
}
