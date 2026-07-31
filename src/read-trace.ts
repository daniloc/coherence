// read-trace.ts — the dependency-light PostToolUse hook path.
//
// This file MUST stay cheap to import: it runs after every explicit read/write-bearing
// tool. Graph derivation, TypeScript, git history and calibration math belong at Stop or
// in the `calibrate` command, never on this tick.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Config } from "./types.ts";

export type TraceMode = "read" | "write";
export interface ReadEvent {
  at: string;
  session: string;
  tool: string;
  mode: TraceMode;
  path: string;
}

const traceDir = (cfg: Config) => join(cfg.root, ".coherence", "read-traces");
const slug = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "unknown";

/** Generic enough for Claude hook payloads without coupling the core to one version of
 * their schema. Only explicit path-bearing fields count; command text is never parsed. */
export function hookReadCandidates(payload: unknown): { session: string; tool: string; mode: TraceMode; paths: string[] } {
  const p = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const input = p.tool_input && typeof p.tool_input === "object" ? p.tool_input as Record<string, unknown> : {};
  // Claude-compatible hosts put the unique agent id on every tool event inside a
  // subagent; the parent session id alone would merge concurrent agents' traces.
  const session = String(p.agent_id ?? p.agentId ?? p.session_id ?? p.sessionId ?? process.env.COHERENCE_SESSION ?? "unknown");
  const tool = String(p.tool_name ?? p.toolName ?? "unknown");
  const mode: TraceMode = /^(Write|Edit|MultiEdit|NotebookEdit)$/i.test(tool) ? "write" : "read";
  const raw: unknown[] = [input.file_path, input.filePath, input.path, input.notebook_path];
  if (Array.isArray(input.paths)) raw.push(...input.paths);
  return { session, tool, mode, paths: [...new Set(raw.filter((x): x is string => typeof x === "string" && !!x.trim()))] };
}

function repoPath(cfg: Config, p: string): string | null {
  const abs = resolve(cfg.root, p);
  const rel = relative(cfg.root, abs).replace(/\\/g, "/");
  if (!rel || rel === "." || rel.startsWith("../") || isAbsolute(rel)) return null;
  try { if (!statSync(abs).isFile()) return null; } catch { return null; }
  return rel;
}

/** PostToolUse write: tiny, append-only, and intentionally outside the committed record. */
export function recordHookReads(cfg: Config, payload: unknown, now = new Date().toISOString()): ReadEvent[] {
  const { session, tool, mode, paths } = hookReadCandidates(payload);
  const events: ReadEvent[] = [];
  for (const raw of paths) {
    const path = repoPath(cfg, raw);
    if (path) events.push({ at: now, session, tool, mode, path });
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
