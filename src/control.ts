// control.ts — the first control surface: one immutable lifecycle-hook bundle per host.
//
// A host project root, coherence's config root, and the npm package root are not
// necessarily the same directory. The hook and its launcher remain identical anyway:
// one small data file maps the stable host-side launcher to coherence's root. A host's
// control bit is true only when that whole path is singular, canonical, enabled, and
// runnable. It deliberately says nothing about runtime trust or observed execution.
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
export type HookHost = "claude" | "codex";

export const POST_TOOL_USE_MATCHER = "Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit";
export const CODEX_POST_TOOL_USE_MATCHER = "Bash|apply_patch|update_plan|mcp__.*";
export const CODEX_SESSION_START_MATCHER = "startup|resume|clear|compact";
export const LIFECYCLE_HOOK_LAUNCHER = '"$CLAUDE_PROJECT_DIR/.claude/coherence-hook"';
export const CODEX_LIFECYCLE_HOOK_LAUNCHER = 'codex_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd -P); "$codex_root/.codex/coherence-hook"';

const BUNDLE_FINGERPRINT_TOKEN = "__COHERENCE_HOOK_BUNDLE_FINGERPRINT__";
/** Bump when a hook-body wire meaning changes without a package-version change. */
export const HOOK_BODY_PROTOCOL_VERSION = 1 as const;

function packageVersion(): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return isObject(parsed) && typeof parsed.version === "string" ? parsed.version : "unversioned";
  } catch { return "unversioned"; }
}

/** Old activity cannot prove a newly installed body merely because settings stayed still. */
export const HOOK_BODY_BUILD_ID = `${packageVersion()}/protocol-${HOOK_BODY_PROTOCOL_VERSION}`;

const CLAUDE_LIFECYCLE_HOOK_SCRIPT_TEMPLATE = `#!/bin/sh
set -eu

claude_root=\${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
IFS= read -r coherence_rel < "$claude_root/.claude/coherence-root"
coherence_root=$(CDPATH= cd -- "$claude_root/$coherence_rel" && pwd -P)
cd "$coherence_root"
export COHERENCE_PROJECT_ROOT="$coherence_root"
export COHERENCE_HOOK_HOST="claude"
export COHERENCE_HOOK_TRANSPORT="launcher"
export COHERENCE_HOOK_BUNDLE_FINGERPRINT="${BUNDLE_FINGERPRINT_TOKEN}"

if [ -x "$coherence_root/node_modules/.bin/coherence-hook" ]; then
  exec "$coherence_root/node_modules/.bin/coherence-hook" "$@"
fi
if [ -f "$coherence_root/src/hook-cli.ts" ]; then
  exec node "$coherence_root/src/hook-cli.ts" "$@"
fi
printf '%s\\n' "coherence hook target missing under $coherence_root" >&2
exit 127
`;

const CODEX_LIFECYCLE_HOOK_SCRIPT_TEMPLATE = `#!/bin/sh
set -eu

codex_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
IFS= read -r coherence_rel < "$codex_root/.codex/coherence-root"
coherence_root=$(CDPATH= cd -- "$codex_root/$coherence_rel" && pwd -P)
cd "$coherence_root"
export COHERENCE_PROJECT_ROOT="$coherence_root"
export COHERENCE_HOOK_HOST="codex"
export COHERENCE_HOOK_TRANSPORT="launcher"
export COHERENCE_HOOK_BUNDLE_FINGERPRINT="${BUNDLE_FINGERPRINT_TOKEN}"

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
  host: HookHost;
  path: string;
  /** Script + mapping + executable target are all current. */
  present: boolean;
  /** The root carrying this host's checked-in hook control. */
  configuredRoot: string;
  /** The root the stable command will address (`git` top-level, or cwd outside Git). */
  commandRoot: string;
  /** False means the command cannot reach `path`, even if every file at `path` is exact. */
  rootAligned: boolean;
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
  /** Hash of the authored settings + launcher template, exported by the launcher. */
  bundleFingerprint: string;
}

export interface CodexProjectConfigInspection {
  path: string;
  exists: boolean;
  valid: boolean;
  /** Any inline `[hooks]`/`[[hooks.*]]` surface; conservatively treated as competing. */
  inlineHooks: boolean;
  /** Only project-local `[features].hooks = false`; higher layers remain unknowable here. */
  hooksDisabled: boolean;
  /** This setting excludes user, project, session, and plugin hooks at runtime. */
  managedHooksOnly: boolean;
  error?: string;
}

export interface LifecycleHookInspection {
  host: HookHost;
  /** The control bit: canonical shared wiring, no competing local path, runnable launcher. */
  present: boolean;
  /** Exact project artifacts only. This is not runtime trust or execution evidence. */
  configured: boolean;
  /** False means the instrument could not answer because an existing settings file is invalid. */
  valid: boolean;
  wiringPresent: boolean;
  scopes: HookScope[];
  files: HookFileInspection[];
  launcher: HookLauncherInspection;
  bundleFingerprint: string;
  codexConfig?: CodexProjectConfigInspection;
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

function launcherForHost(host: HookHost): string {
  return host === "codex" ? CODEX_LIFECYCLE_HOOK_LAUNCHER : LIFECYCLE_HOOK_LAUNCHER;
}

function launcherTemplateForHost(host: HookHost): string {
  return host === "codex" ? CODEX_LIFECYCLE_HOOK_SCRIPT_TEMPLATE : CLAUDE_LIFECYCLE_HOOK_SCRIPT_TEMPLATE;
}

export function lifecycleHookCommand(event: LifecycleHookEvent, host: HookHost = "claude"): string {
  return `${launcherForHost(host)} ${event}`;
}

function canonicalAction(event: LifecycleHookEvent, host: HookHost): JsonObject {
  return { type: "command", command: lifecycleHookCommand(event, host) };
}

function canonicalGroup(event: LifecycleHookEvent, host: HookHost): JsonObject {
  if (event === "PostToolUse") {
    const matcher = host === "codex" ? CODEX_POST_TOOL_USE_MATCHER : POST_TOOL_USE_MATCHER;
    return { matcher, hooks: [canonicalAction(event, host)] };
  }
  if (host === "codex" && event === "SessionStart") {
    return { matcher: CODEX_SESSION_START_MATCHER, hooks: [canonicalAction(event, host)] };
  }
  return { hooks: [canonicalAction(event, host)] };
}

/** The sole authored settings value. Printing, inspection, and installation all call this. */
export function canonicalLifecycleHookSettings(host: HookHost = "claude"): JsonObject {
  const hooks: JsonObject = {};
  for (const event of LIFECYCLE_HOOK_EVENTS) hooks[event] = [canonicalGroup(event, host)];
  return { hooks };
}

/**
 * Version the authored hook bundle independently from any machine path. The mapping is
 * inspected separately: including it here would make identical host wiring acquire a new
 * runtime identity merely because the consumer keeps coherence in a nested package.
 */
export function lifecycleHookBundleFingerprint(host: HookHost = "claude"): string {
  const authored = JSON.stringify({
    version: 2,
    host,
    hookBodyBuild: HOOK_BODY_BUILD_ID,
    settings: canonicalLifecycleHookSettings(host),
    launcherTemplate: launcherTemplateForHost(host),
  });
  return createHash("sha256").update(authored).digest("hex");
}

export const LIFECYCLE_HOOK_BUNDLE_FINGERPRINT = lifecycleHookBundleFingerprint("claude");
export const CODEX_LIFECYCLE_HOOK_BUNDLE_FINGERPRINT = lifecycleHookBundleFingerprint("codex");
export const LIFECYCLE_HOOK_SCRIPT = CLAUDE_LIFECYCLE_HOOK_SCRIPT_TEMPLATE.replace(
  BUNDLE_FINGERPRINT_TOKEN,
  LIFECYCLE_HOOK_BUNDLE_FINGERPRINT,
);
export const CODEX_LIFECYCLE_HOOK_SCRIPT = CODEX_LIFECYCLE_HOOK_SCRIPT_TEMPLATE.replace(
  BUNDLE_FINGERPRINT_TOKEN,
  CODEX_LIFECYCLE_HOOK_BUNDLE_FINGERPRINT,
);

/** The Claude host root is explicit because real consumers keep coherence in a sub-project. */
export function resolveClaudeProjectRoot(cfg: Config): string {
  return resolve(cfg.root, cfg.claudeProjectRoot ?? ".");
}

/** Codex ordinarily opens the same repo; retain that relationship only as a default. */
export function resolveCodexProjectRoot(cfg: Config): string {
  return resolve(cfg.root, cfg.codexProjectRoot ?? cfg.claudeProjectRoot ?? ".");
}

export function resolveHookProjectRoot(cfg: Config, host: HookHost): string {
  return host === "codex" ? resolveCodexProjectRoot(cfg) : resolveClaudeProjectRoot(cfg);
}

function hostDirectory(host: HookHost): ".claude" | ".codex" {
  return host === "codex" ? ".codex" : ".claude";
}

function hostScopes(host: HookHost): readonly HookScope[] {
  return host === "codex" ? ["project"] : ["project", "local"];
}

function settingsPath(cfg: Config, scope: HookScope, host: HookHost): string {
  const name = host === "codex"
    ? "hooks.json"
    : scope === "project" ? "settings.json" : "settings.local.json";
  return join(resolveHookProjectRoot(cfg, host), hostDirectory(host), name);
}

function launcherPath(cfg: Config, host: HookHost): string {
  return join(resolveHookProjectRoot(cfg, host), hostDirectory(host), "coherence-hook");
}

function mappingPath(cfg: Config, host: HookHost): string {
  return join(resolveHookProjectRoot(cfg, host), hostDirectory(host), "coherence-root");
}

export function lifecycleRootMapping(cfg: Config, host: HookHost = "claude"): string {
  return (relative(resolveHookProjectRoot(cfg, host), cfg.root) || ".") + "\n";
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

function readSettings(cfg: Config, scope: HookScope, host: HookHost): ReadSettings {
  const path = settingsPath(cfg, scope, host);
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

function canonicalCount(groups: unknown, event: LifecycleHookEvent, host: HookHost): number {
  if (!Array.isArray(groups)) return 0;
  return groups.filter((group) => isDeepStrictEqual(group, canonicalGroup(event, host))).length;
}

/**
 * Recognize only lifecycle commands coherence has emitted or that are already present in
 * audited consumers. The match is anchored: mentioning `coherence hook` is not enough.
 */
export function managedLifecycleEvent(command: unknown, host: HookHost = "claude"): LifecycleHookEvent | null {
  if (typeof command !== "string") return null;
  if (host === "codex") {
    const canonical = LIFECYCLE_HOOK_EVENTS.find((event) => command === lifecycleHookCommand(event, host));
    if (canonical) return canonical;
  }
  const eventPattern = LIFECYCLE_HOOK_EVENTS.join("|");
  const directLaunchers = [
    String.raw`npx coherence hook`,
    String.raw`node \./src/hook-cli\.ts`,
    String.raw`node src/hook-cli\.ts`,
    String.raw`node \./src/cli\.ts hook`,
    String.raw`node src/cli\.ts hook`,
  ];
  if (host === "claude") directLaunchers.unshift(
    String.raw`"\$CLAUDE_PROJECT_DIR/\.claude/coherence-hook"`,
    String.raw`"\$\{CLAUDE_PROJECT_DIR\}/node_modules/\.bin/coherence-hook"`,
    String.raw`"\$CLAUDE_PROJECT_DIR/node_modules/\.bin/coherence-hook"`,
  );
  const direct = new RegExp(`^(?:${directLaunchers.join("|")}) (${eventPattern})$`).exec(command);
  if (direct) return direct[1] as LifecycleHookEvent;
  if (host === "codex") return null;

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

function managedAction(value: unknown, host: HookHost): boolean {
  return isObject(value) && value.type === "command" && managedLifecycleEvent(value.command, host) !== null;
}

function managedCount(hooks: unknown, host: HookHost): number {
  if (!isObject(hooks)) return 0;
  let count = 0;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) continue;
      count += group.hooks.filter((action) => managedAction(action, host)).length;
    }
  }
  return count;
}

function inspectFile(read: ReadSettings, host: HookHost): HookFileInspection {
  if (!read.valid) {
    return {
      scope: read.scope, path: read.path, exists: read.exists, valid: false, complete: false,
      matchedEvents: [], missingEvents: [...LIFECYCLE_HOOK_EVENTS], canonicalGroups: 0,
      managedActions: 0, error: read.error,
    };
  }
  const hooks = isObject(read.value.hooks) ? read.value.hooks : {};
  const counts = new Map(LIFECYCLE_HOOK_EVENTS.map((event) => [event, canonicalCount(hooks[event], event, host)]));
  const matchedEvents = LIFECYCLE_HOOK_EVENTS.filter((event) => (counts.get(event) ?? 0) > 0);
  const missingEvents = LIFECYCLE_HOOK_EVENTS.filter((event) => (counts.get(event) ?? 0) === 0);
  const canonicalGroups = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const managedActions = managedCount(hooks, host);
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
  if (packageName(cfg.root) === "@danilocampos/coherence" && readableFile(source)) {
    return { path: source, present: true, kind: "source" };
  }
  return { path: binary, present: false, kind: "missing" };
}

function readText(path: string): string | undefined {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

export function lifecycleHookScript(host: HookHost = "claude"): string {
  return host === "codex" ? CODEX_LIFECYCLE_HOOK_SCRIPT : LIFECYCLE_HOOK_SCRIPT;
}

function physicalRoot(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}

/**
 * Mirror the stable Codex command's root choice before calling the control runnable.
 * The command is intentionally path-free so one trusted definition travels between
 * checkouts; that only works when the `.codex` owner is also Git's top-level. Outside
 * Git the command falls back to its cwd, which Codex sets to the project root.
 */
function launcherCommandRoot(cfg: Config, host: HookHost): string {
  const configuredRoot = resolveHookProjectRoot(cfg, host);
  if (host !== "codex") return configuredRoot;
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: configuredRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim();
    return root ? resolve(root) : configuredRoot;
  } catch {
    return configuredRoot;
  }
}

function inspectLauncher(cfg: Config, host: HookHost): HookLauncherInspection {
  const configuredRoot = resolveHookProjectRoot(cfg, host);
  const commandRoot = launcherCommandRoot(cfg, host);
  const rootAligned = physicalRoot(configuredRoot) === physicalRoot(commandRoot);
  const path = launcherPath(cfg, host);
  const actual = readText(path);
  const expectedMapping = lifecycleRootMapping(cfg, host);
  const actualMapping = readText(mappingPath(cfg, host));
  const target = runnableTarget(cfg);
  const script = lifecycleHookScript(host);
  const canonical = actual === script;
  const executable = canonical && executableFile(path);
  const mappingPresent = actualMapping === expectedMapping;
  return {
    host,
    path,
    present: rootAligned && canonical && executable && mappingPresent && target.present,
    configuredRoot,
    commandRoot,
    rootAligned,
    exists: actual !== undefined,
    canonical,
    executable,
    mappingPath: mappingPath(cfg, host),
    mappingPresent,
    mappingExpected: expectedMapping.trimEnd(),
    mappingActual: actualMapping?.trimEnd(),
    targetPath: target.path,
    targetPresent: target.present,
    targetKind: target.kind,
    bundleFingerprint: lifecycleHookBundleFingerprint(host),
  };
}

/** Remove a TOML comment without mistaking a `#` inside an ordinary quoted value. */
function tomlCode(line: string): string {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quote === '"' && escaped) { escaped = false; continue; }
    if (quote === '"' && ch === "\\") { escaped = true; continue; }
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "#") return line.slice(0, i).trim();
  }
  return line.trim();
}

/**
 * This is deliberately a relevant-syntax scanner, not a pretend TOML parser. It proves
 * only the project-level facts the control needs: whether another inline hook surface
 * exists, and whether this layer explicitly disables project hooks. Higher config/trust layers
 * remain outside a repository inspection's authority.
 */
export function inspectCodexProjectConfig(cfg: Config): CodexProjectConfigInspection {
  const path = join(resolveCodexProjectRoot(cfg), ".codex", "config.toml");
  if (!existsSync(path)) {
    return {
      path, exists: false, valid: true, inlineHooks: false,
      hooksDisabled: false, managedHooksOnly: false,
    };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      path, exists: true, valid: false, inlineHooks: false,
      hooksDisabled: false, managedHooksOnly: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let section = "";
  let inlineHooks = false;
  let hooksDisabled = false;
  let managedHooksOnly = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = tomlCode(rawLine);
    if (!line) continue;
    if (line.startsWith("[")) {
      // Quoted TOML keys are valid; removing their quotes can only broaden detection,
      // which is the safe direction for a scanner deciding whether it can prove singularity.
      const headerCode = line.replace(/["']/g, "");
      const table = /^(?:\[\s*([A-Za-z0-9_.-]+)\s*\]|\[\[\s*([A-Za-z0-9_.-]+)\s*\]\])$/.exec(headerCode);
      if (!table) {
        if (/^\[+\s*(?:hooks|features)(?:[.\]\s]|$)/.test(headerCode)) {
          return {
            path, exists: true, valid: false, inlineHooks, hooksDisabled, managedHooksOnly,
            error: "could not classify relevant Codex TOML table syntax",
          };
        }
        section = "";
        continue;
      }
      section = table[1] ?? table[2]!;
      if (section === "hooks" || section.startsWith("hooks.")) inlineHooks = true;
      continue;
    }

    const keyCode = line.replace(/["']/g, "");
    if (section === "" && /^hooks(?:\.|\s*=)/.test(keyCode)) inlineHooks = true;
    if (section === ""
      && /^(?:allow_managed_hooks_only|"allow_managed_hooks_only"|'allow_managed_hooks_only')\s*=\s*true(?:\s|$)/.test(line)) {
      managedHooksOnly = true;
    }
    if (section === "" && /^features\.(?:hooks|codex_hooks)\s*=\s*false(?:\s|$)/.test(keyCode)) {
      hooksDisabled = true;
    }
    if (section === "features" && /^(?:hooks|codex_hooks)\s*=\s*false(?:\s|$)/.test(keyCode)) {
      hooksDisabled = true;
    }
  }
  return { path, exists: true, valid: true, inlineHooks, hooksDisabled, managedHooksOnly };
}

/** Inspect without mutating: the lifecycle control's read operation. */
export function inspectLifecycleHook(cfg: Config, host: HookHost = "claude"): LifecycleHookInspection {
  const files = hostScopes(host).map((scope) => inspectFile(readSettings(cfg, scope, host), host));
  const codexConfig = host === "codex" ? inspectCodexProjectConfig(cfg) : undefined;
  const valid = files.every((file) => file.valid) && (codexConfig?.valid ?? true);
  const project = files.find((file) => file.scope === "project")!;
  const local = files.find((file) => file.scope === "local");
  const wiringPresent = valid && project.complete
    && (local?.managedActions ?? 0) === 0
    && !(codexConfig?.inlineHooks ?? false);
  const launcher = inspectLauncher(cfg, host);
  const configured = wiringPresent && launcher.present;
  const warnings: string[] = [];
  for (const file of files) {
    if (file.canonicalGroups > LIFECYCLE_HOOK_EVENTS.length) {
      warnings.push(`${file.scope} settings contain duplicate canonical hook groups`);
    }
    if (file.managedActions > file.canonicalGroups) {
      warnings.push(`${file.scope} settings contain non-canonical coherence hook actions`);
    }
  }
  if ((local?.managedActions ?? 0) > 0) warnings.push("local settings contain a competing coherence lifecycle path");
  if (local?.complete && !project.complete) warnings.push("the canonical bundle is local-only and will not travel with the repository");
  if (codexConfig?.inlineHooks) warnings.push("Codex config contains inline hooks; a singular project lifecycle path cannot be established");
  if (codexConfig?.hooksDisabled) warnings.push("Codex project config disables hooks (`features.hooks = false`)");
  if (codexConfig?.managedHooksOnly) warnings.push("Codex project config excludes project hooks (`allow_managed_hooks_only = true`)");
  if (!launcher.rootAligned) warnings.push(`Codex launcher resolves ${launcher.commandRoot}, not configured project root ${launcher.configuredRoot}`);
  if (launcher.exists && !launcher.canonical) warnings.push("the managed lifecycle launcher has drifted");
  if (launcher.mappingActual !== undefined && !launcher.mappingPresent) warnings.push("the lifecycle root mapping does not address this coherence root");
  return {
    host,
    present: configured && !(codexConfig?.hooksDisabled ?? false) && !(codexConfig?.managedHooksOnly ?? false),
    configured,
    valid,
    wiringPresent,
    scopes: files.filter((file) => file.complete).map((file) => file.scope),
    files,
    launcher,
    bundleFingerprint: lifecycleHookBundleFingerprint(host),
    ...(codexConfig === undefined ? {} : { codexConfig }),
    warnings,
  };
}

export function inspectLifecycleHookForHost(cfg: Config, host: HookHost): LifecycleHookInspection {
  return inspectLifecycleHook(cfg, host);
}

function stripManagedActions(value: JsonObject, host: HookHost): JsonObject {
  const next = structuredClone(value);
  if (!isObject(next.hooks)) return next;
  const hooks = next.hooks;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept: unknown[] = [];
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) { kept.push(group); continue; }
      const actions = group.hooks.filter((action) => !managedAction(action, host));
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

function addCanonicalBundle(value: JsonObject, host: HookHost): JsonObject {
  const next = structuredClone(value);
  const hooks = isObject(next.hooks) ? next.hooks : {};
  for (const event of LIFECYCLE_HOOK_EVENTS) {
    const groups = hooks[event];
    hooks[event] = [...(Array.isArray(groups) ? groups : []), canonicalGroup(event, host)];
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
 * Set one host's lifecycle bit. ON converges project settings, removes competing
 * host-local/legacy paths, and repairs the two coherence-owned launcher files. OFF removes
 * every recognized lifecycle action from that host's settings, then removes only launcher
 * files whose bytes are still canonical. Unrelated settings and hook actions survive.
 */
export async function setLifecycleHook(
  cfg: Config,
  present: boolean,
  host: HookHost = "claude",
): Promise<LifecycleHookMutation> {
  const reads = hostScopes(host).map((scope) => readSettings(cfg, scope, host));
  const errors = reads.filter((read) => !read.valid).map((read) => `${read.path}: ${read.error ?? "invalid settings"}`);
  const codexConfig = host === "codex" ? inspectCodexProjectConfig(cfg) : undefined;
  if (codexConfig && !codexConfig.valid) {
    errors.push(`${codexConfig.path}: ${codexConfig.error ?? "could not inspect Codex configuration"}`);
  }
  if (present && codexConfig?.inlineHooks) {
    errors.push(`${codexConfig.path}: inline Codex hooks prevent a singular coherence lifecycle path`);
  }
  const launcher = inspectLauncher(cfg, host);
  if (present && host === "codex" && !launcher.rootAligned) {
    errors.push(`${launcher.configuredRoot}: Codex project root does not match launcher root ${launcher.commandRoot}; `
      + "the stable launcher addresses Git's top-level .codex directory");
  }
  const target = runnableTarget(cfg);
  if (present && !target.present) {
    errors.push(`${target.path}: lifecycle target is missing; install this coherence version in the project first`);
  }
  if (errors.length) return { inspection: inspectLifecycleHook(cfg, host), changed: [], errors };

  const projectRead = reads.find((read) => read.scope === "project")!;
  const localRead = reads.find((read) => read.scope === "local");
  const projectWithoutManaged = stripManagedActions(projectRead.value, host);
  const project = present ? addCanonicalBundle(projectWithoutManaged, host) : projectWithoutManaged;
  const local = localRead ? stripManagedActions(localRead.value, host) : undefined;
  const changed: string[] = [];
  const script = lifecycleHookScript(host);
  const rootMapping = lifecycleRootMapping(cfg, host);
  try {
    if (present) {
      if (await writeManagedText(mappingPath(cfg, host), rootMapping)) changed.push(mappingPath(cfg, host));
      if (await writeManagedText(launcherPath(cfg, host), script, 0o755)) changed.push(launcherPath(cfg, host));
    }
    // Remove the competing local path before publishing the one shared project path.
    if (localRead?.exists && local && await writeSettings(localRead, local)) changed.push(localRead.path);
    if (present || projectRead.exists) {
      if (await writeSettings(projectRead, project)) changed.push(projectRead.path);
    }
    if (!present) {
      if (await removeManagedText(launcherPath(cfg, host), script)) changed.push(launcherPath(cfg, host));
      if (await removeManagedText(mappingPath(cfg, host), rootMapping)) changed.push(mappingPath(cfg, host));
    }
  } catch (error) {
    return {
      inspection: inspectLifecycleHook(cfg, host), changed,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  return { inspection: inspectLifecycleHook(cfg, host), changed, errors: [] };
}

export function setLifecycleHookForHost(
  cfg: Config,
  host: HookHost,
  present: boolean,
): Promise<LifecycleHookMutation> {
  return setLifecycleHook(cfg, present, host);
}
