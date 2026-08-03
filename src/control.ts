// control.ts — the first control surface: one immutable lifecycle-hook bundle.
//
// Claude's project root, coherence's config root, and the npm package root are not
// necessarily the same directory. The hook and its launcher remain identical anyway:
// one small data file maps the stable Claude-side launcher to coherence's root. The
// control bit is true only when that whole path is singular, canonical, and runnable.
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { dirname, join, relative, resolve } from "node:path";
import type { Config } from "./types.ts";

export const LIFECYCLE_HOOK_EVENTS = [
  "SubagentStart",
  "SessionStart",
  "SubagentStop",
  "Stop",
  "PostToolUse",
] as const;
export type LifecycleHookEvent = typeof LIFECYCLE_HOOK_EVENTS[number];
export type HookScope = "project" | "local";

export const POST_TOOL_USE_MATCHER = "Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit";
export const LIFECYCLE_HOOK_LAUNCHER = '"$CLAUDE_PROJECT_DIR/.claude/coherence-hook"';
export const LIFECYCLE_HOOK_SCRIPT = `#!/bin/sh
set -eu

claude_root=\${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
IFS= read -r coherence_rel < "$claude_root/.claude/coherence-root"
coherence_root=$(CDPATH= cd -- "$claude_root/$coherence_rel" && pwd -P)
cd "$coherence_root"
export COHERENCE_PROJECT_ROOT="$coherence_root"

if [ -x "$coherence_root/node_modules/.bin/coherence-hook" ]; then
  exec "$coherence_root/node_modules/.bin/coherence-hook" "$@"
fi
if [ -f "$coherence_root/src/hook-cli.ts" ]; then
  exec node "$coherence_root/src/hook-cli.ts" "$@"
fi
printf '%s\\n' "coherence hook target missing under $coherence_root" >&2
exit 127
`;

type JsonObject = Record<string, unknown>;

export interface HookFileInspection {
  scope: HookScope;
  path: string;
  exists: boolean;
  valid: boolean;
  /** Exactly one canonical group per event and no other coherence lifecycle action. */
  complete: boolean;
  matchedEvents: LifecycleHookEvent[];
  missingEvents: LifecycleHookEvent[];
  canonicalGroups: number;
  managedActions: number;
  error?: string;
}

export interface HookLauncherInspection {
  path: string;
  /** Script + mapping + executable target are all current. */
  present: boolean;
  exists: boolean;
  canonical: boolean;
  executable: boolean;
  mappingPath: string;
  mappingPresent: boolean;
  mappingExpected: string;
  mappingActual?: string;
  targetPath: string;
  targetPresent: boolean;
  targetKind: "binary" | "source" | "missing";
}

export interface LifecycleHookInspection {
  /** The control bit: canonical shared wiring, no competing local path, runnable launcher. */
  present: boolean;
  /** False means the instrument could not answer because an existing settings file is invalid. */
  valid: boolean;
  wiringPresent: boolean;
  scopes: HookScope[];
  files: HookFileInspection[];
  launcher: HookLauncherInspection;
  warnings: string[];
}

export interface LifecycleHookMutation {
  inspection: LifecycleHookInspection;
  changed: string[];
  errors: string[];
}

interface ReadSettings {
  scope: HookScope;
  path: string;
  exists: boolean;
  valid: boolean;
  value: JsonObject;
  raw: string;
  indent: string | number;
  trailingNewline: boolean;
  mode?: number;
  error?: string;
}

interface HookTarget {
  path: string;
  present: boolean;
  kind: "binary" | "source" | "missing";
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function lifecycleHookCommand(event: LifecycleHookEvent): string {
  return `${LIFECYCLE_HOOK_LAUNCHER} ${event}`;
}

function canonicalAction(event: LifecycleHookEvent): JsonObject {
  return { type: "command", command: lifecycleHookCommand(event) };
}

function canonicalGroup(event: LifecycleHookEvent): JsonObject {
  return event === "PostToolUse"
    ? { matcher: POST_TOOL_USE_MATCHER, hooks: [canonicalAction(event)] }
    : { hooks: [canonicalAction(event)] };
}

/** The sole authored settings value. Printing, inspection, and installation all call this. */
export function canonicalLifecycleHookSettings(): JsonObject {
  const hooks: JsonObject = {};
  for (const event of LIFECYCLE_HOOK_EVENTS) hooks[event] = [canonicalGroup(event)];
  return { hooks };
}

/** The Claude host root is explicit because real consumers keep coherence in a sub-project. */
export function resolveClaudeProjectRoot(cfg: Config): string {
  return resolve(cfg.root, cfg.claudeProjectRoot ?? ".");
}

function settingsPath(cfg: Config, scope: HookScope): string {
  return join(resolveClaudeProjectRoot(cfg), ".claude", scope === "project" ? "settings.json" : "settings.local.json");
}

function launcherPath(cfg: Config): string {
  return join(resolveClaudeProjectRoot(cfg), ".claude", "coherence-hook");
}

function mappingPath(cfg: Config): string {
  return join(resolveClaudeProjectRoot(cfg), ".claude", "coherence-root");
}

export function lifecycleRootMapping(cfg: Config): string {
  return (relative(resolveClaudeProjectRoot(cfg), cfg.root) || ".") + "\n";
}

function indentation(raw: string): string | number {
  const match = raw.match(/^([\t ]+)"/m);
  return match?.[1] ?? 2;
}

function settingsShapeError(value: JsonObject): string | undefined {
  if (value.hooks === undefined) return undefined;
  if (!isObject(value.hooks)) return "`hooks` is not an object";
  for (const [event, groups] of Object.entries(value.hooks)) {
    if (!Array.isArray(groups)) return `hooks.${event} is not an array`;
    for (const [index, group] of groups.entries()) {
      if (!isObject(group)) return `hooks.${event}[${index}] is not an object`;
      if (!Array.isArray(group.hooks)) return `hooks.${event}[${index}].hooks is not an array`;
    }
  }
  return undefined;
}

function readSettings(cfg: Config, scope: HookScope): ReadSettings {
  const path = settingsPath(cfg, scope);
  if (!existsSync(path)) {
    return { scope, path, exists: false, valid: true, value: {}, raw: "", indent: 2, trailingNewline: true };
  }
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
    const mode = statSync(path).mode & 0o777;
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) {
      return {
        scope, path, exists: true, valid: false, value: {}, raw,
        indent: indentation(raw), trailingNewline: raw.endsWith("\n"),
        mode,
        error: "settings root is not an object",
      };
    }
    const shapeError = settingsShapeError(parsed);
    return {
      scope, path, exists: true, valid: shapeError === undefined, value: parsed, raw,
      indent: indentation(raw), trailingNewline: raw.endsWith("\n"), mode, error: shapeError,
    };
  } catch (error) {
    return {
      scope, path, exists: true, valid: false, value: {}, raw,
      indent: indentation(raw), trailingNewline: raw.endsWith("\n"),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function canonicalCount(groups: unknown, event: LifecycleHookEvent): number {
  if (!Array.isArray(groups)) return 0;
  return groups.filter((group) => isDeepStrictEqual(group, canonicalGroup(event))).length;
}

/**
 * Recognize only lifecycle commands coherence has emitted or that are already present in
 * audited consumers. The match is anchored: mentioning `coherence hook` is not enough.
 */
export function managedLifecycleEvent(command: unknown): LifecycleHookEvent | null {
  if (typeof command !== "string") return null;
  const eventPattern = LIFECYCLE_HOOK_EVENTS.join("|");
  const launchers = [
    String.raw`"\$CLAUDE_PROJECT_DIR/\.claude/coherence-hook"`,
    String.raw`"\$\{CLAUDE_PROJECT_DIR\}/node_modules/\.bin/coherence-hook"`,
    String.raw`"\$CLAUDE_PROJECT_DIR/node_modules/\.bin/coherence-hook"`,
    String.raw`npx coherence hook`,
    String.raw`node \./src/hook-cli\.ts`,
    String.raw`node src/hook-cli\.ts`,
    String.raw`node \./src/cli\.ts hook`,
    String.raw`node src/cli\.ts hook`,
  ];
  const direct = new RegExp(`^(?:${launchers.join("|")}) (${eventPattern})$`).exec(command);
  if (direct) return direct[1] as LifecycleHookEvent;

  const sourceWithCwd = new RegExp(
    `^cd "\\$\\{?CLAUDE_PROJECT_DIR\\}?" && (?:node \\./src/hook-cli\\.ts|node src/hook-cli\\.ts) (${eventPattern})$`,
  ).exec(command);
  if (sourceWithCwd) return sourceWithCwd[1] as LifecycleHookEvent;

  // Hoist's measured nested-root spelling. The prefix only chooses cwd; the terminal
  // invocation remains exact and the event token is still a member of the live domain.
  const nestedRoot = new RegExp(
    `^cd "\\$CLAUDE_PROJECT_DIR/[^"]+" 2>/dev/null \\|\\| cd "\\$CLAUDE_PROJECT_DIR"; npx coherence hook (${eventPattern})$`,
  ).exec(command);
  return nestedRoot ? nestedRoot[1] as LifecycleHookEvent : null;
}

function managedAction(value: unknown): boolean {
  return isObject(value) && value.type === "command" && managedLifecycleEvent(value.command) !== null;
}

function managedCount(hooks: unknown): number {
  if (!isObject(hooks)) return 0;
  let count = 0;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) continue;
      count += group.hooks.filter(managedAction).length;
    }
  }
  return count;
}

function inspectFile(read: ReadSettings): HookFileInspection {
  if (!read.valid) {
    return {
      scope: read.scope, path: read.path, exists: read.exists, valid: false, complete: false,
      matchedEvents: [], missingEvents: [...LIFECYCLE_HOOK_EVENTS], canonicalGroups: 0,
      managedActions: 0, error: read.error,
    };
  }
  const hooks = isObject(read.value.hooks) ? read.value.hooks : {};
  const counts = new Map(LIFECYCLE_HOOK_EVENTS.map((event) => [event, canonicalCount(hooks[event], event)]));
  const matchedEvents = LIFECYCLE_HOOK_EVENTS.filter((event) => (counts.get(event) ?? 0) > 0);
  const missingEvents = LIFECYCLE_HOOK_EVENTS.filter((event) => (counts.get(event) ?? 0) === 0);
  const canonicalGroups = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const managedActions = managedCount(hooks);
  return {
    scope: read.scope,
    path: read.path,
    exists: read.exists,
    valid: true,
    complete: LIFECYCLE_HOOK_EVENTS.every((event) => counts.get(event) === 1)
      && canonicalGroups === LIFECYCLE_HOOK_EVENTS.length
      && managedActions === LIFECYCLE_HOOK_EVENTS.length,
    matchedEvents,
    missingEvents,
    canonicalGroups,
    managedActions,
  };
}

function executableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch { return false; }
}

function readableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.R_OK);
    return true;
  } catch { return false; }
}

function packageName(root: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return isObject(parsed) && typeof parsed.name === "string" ? parsed.name : null;
  } catch { return null; }
}

function runnableTarget(cfg: Config): HookTarget {
  const binary = join(cfg.root, "node_modules", ".bin", "coherence-hook");
  if (executableFile(binary)) return { path: binary, present: true, kind: "binary" };
  const source = join(cfg.root, "src", "hook-cli.ts");
  if (packageName(cfg.root) === "coherence-harness" && readableFile(source)) {
    return { path: source, present: true, kind: "source" };
  }
  return { path: binary, present: false, kind: "missing" };
}

function readText(path: string): string | undefined {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

function inspectLauncher(cfg: Config): HookLauncherInspection {
  const path = launcherPath(cfg);
  const actual = readText(path);
  const expectedMapping = lifecycleRootMapping(cfg);
  const actualMapping = readText(mappingPath(cfg));
  const target = runnableTarget(cfg);
  const canonical = actual === LIFECYCLE_HOOK_SCRIPT;
  const executable = canonical && executableFile(path);
  const mappingPresent = actualMapping === expectedMapping;
  return {
    path,
    present: canonical && executable && mappingPresent && target.present,
    exists: actual !== undefined,
    canonical,
    executable,
    mappingPath: mappingPath(cfg),
    mappingPresent,
    mappingExpected: expectedMapping.trimEnd(),
    mappingActual: actualMapping?.trimEnd(),
    targetPath: target.path,
    targetPresent: target.present,
    targetKind: target.kind,
  };
}

/** Inspect without mutating: the lifecycle control's read operation. */
export function inspectLifecycleHook(cfg: Config): LifecycleHookInspection {
  const files = (["project", "local"] as const).map((scope) => inspectFile(readSettings(cfg, scope)));
  const valid = files.every((file) => file.valid);
  const project = files.find((file) => file.scope === "project")!;
  const local = files.find((file) => file.scope === "local")!;
  const wiringPresent = valid && project.complete && local.managedActions === 0;
  const launcher = inspectLauncher(cfg);
  const warnings: string[] = [];
  for (const file of files) {
    if (file.canonicalGroups > LIFECYCLE_HOOK_EVENTS.length) {
      warnings.push(`${file.scope} settings contain duplicate canonical hook groups`);
    }
    if (file.managedActions > file.canonicalGroups) {
      warnings.push(`${file.scope} settings contain non-canonical coherence hook actions`);
    }
  }
  if (local.managedActions > 0) warnings.push("local settings contain a competing coherence lifecycle path");
  if (local.complete && !project.complete) warnings.push("the canonical bundle is local-only and will not travel with the repository");
  if (launcher.exists && !launcher.canonical) warnings.push("the managed lifecycle launcher has drifted");
  if (launcher.mappingActual !== undefined && !launcher.mappingPresent) warnings.push("the lifecycle root mapping does not address this coherence root");
  return {
    present: wiringPresent && launcher.present,
    valid,
    wiringPresent,
    scopes: files.filter((file) => file.complete).map((file) => file.scope),
    files,
    launcher,
    warnings,
  };
}

function stripManagedActions(value: JsonObject): JsonObject {
  const next = structuredClone(value);
  if (!isObject(next.hooks)) return next;
  const hooks = next.hooks;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept: unknown[] = [];
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) { kept.push(group); continue; }
      const actions = group.hooks.filter((action) => !managedAction(action));
      const removed = actions.length !== group.hooks.length;
      if (removed && actions.length === 0) continue;
      kept.push(removed ? { ...group, hooks: actions } : group);
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return next;
}

function addCanonicalBundle(value: JsonObject): JsonObject {
  const next = structuredClone(value);
  const hooks = isObject(next.hooks) ? next.hooks : {};
  for (const event of LIFECYCLE_HOOK_EVENTS) {
    const groups = hooks[event];
    hooks[event] = [...(Array.isArray(groups) ? groups : []), canonicalGroup(event)];
  }
  next.hooks = hooks;
  return next;
}

async function writeTextAtomic(path: string, contents: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.coherence-${process.pid}-${randomUUID()}.tmp`;
  try {
    await writeFile(temp, contents, mode === undefined ? undefined : { mode });
    if (mode !== undefined) await chmod(temp, mode);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeSettings(read: ReadSettings, value: JsonObject): Promise<boolean> {
  if (read.exists && isDeepStrictEqual(read.value, value)) return false;
  const rendered = JSON.stringify(value, null, read.indent) + (read.trailingNewline ? "\n" : "");
  await writeTextAtomic(read.path, rendered, read.mode);
  return true;
}

async function writeManagedText(path: string, contents: string, mode?: number): Promise<boolean> {
  if (readText(path) === contents && (mode === undefined || executableFile(path))) return false;
  await writeTextAtomic(path, contents, mode);
  return true;
}

async function removeManagedText(path: string, expected: string): Promise<boolean> {
  if (readText(path) !== expected) return false;
  await rm(path);
  return true;
}

/**
 * Set the lifecycle bit. ON converges project settings, removes competing local/legacy
 * paths, and repairs the two coherence-owned launcher files. OFF removes every recognized
 * lifecycle action from both settings scopes, then removes only launcher files whose bytes
 * are still canonical. Unrelated settings and hook actions survive both operations.
 */
export async function setLifecycleHook(cfg: Config, present: boolean): Promise<LifecycleHookMutation> {
  const reads = (["project", "local"] as const).map((scope) => readSettings(cfg, scope));
  const errors = reads.filter((read) => !read.valid).map((read) => `${read.path}: ${read.error ?? "invalid settings"}`);
  const target = runnableTarget(cfg);
  if (present && !target.present) {
    errors.push(`${target.path}: lifecycle target is missing; install this coherence version in the project first`);
  }
  if (errors.length) return { inspection: inspectLifecycleHook(cfg), changed: [], errors };

  const projectRead = reads.find((read) => read.scope === "project")!;
  const localRead = reads.find((read) => read.scope === "local")!;
  const project = present ? addCanonicalBundle(stripManagedActions(projectRead.value)) : stripManagedActions(projectRead.value);
  const local = stripManagedActions(localRead.value);
  const changed: string[] = [];
  try {
    if (present) {
      if (await writeManagedText(mappingPath(cfg), lifecycleRootMapping(cfg))) changed.push(mappingPath(cfg));
      if (await writeManagedText(launcherPath(cfg), LIFECYCLE_HOOK_SCRIPT, 0o755)) changed.push(launcherPath(cfg));
    }
    // Remove the competing local path before publishing the one shared project path.
    if (localRead.exists && await writeSettings(localRead, local)) changed.push(localRead.path);
    if (present || projectRead.exists) {
      if (await writeSettings(projectRead, project)) changed.push(projectRead.path);
    }
    if (!present) {
      if (await removeManagedText(launcherPath(cfg), LIFECYCLE_HOOK_SCRIPT)) changed.push(launcherPath(cfg));
      if (await removeManagedText(mappingPath(cfg), lifecycleRootMapping(cfg))) changed.push(mappingPath(cfg));
    }
  } catch (error) {
    return {
      inspection: inspectLifecycleHook(cfg), changed,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  return { inspection: inspectLifecycleHook(cfg), changed, errors: [] };
}
