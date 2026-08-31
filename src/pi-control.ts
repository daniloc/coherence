import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { mkdir, rm, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOOK_BODY_BUILD_ID } from "./control.ts";
import type { Config } from "./types.ts";

export const PI_EXTENSION_ID = "@danilocampos/coherence";
export const PI_HOOK_PROTOCOL_VERSION = 1 as const;
const PI_BUNDLE_SHAPE = {
  version: PI_HOOK_PROTOCOL_VERSION,
  hookBodyBuild: HOOK_BODY_BUILD_ID,
  package: PI_EXTENSION_ID,
  settings: { packages: ["local-package-root"], mapping: ".pi/coherence-root" },
  lifecycle: ["session_start", "before_agent_start", "tool_result", "agent_settled:main", "agent_settled:child-once"],
};
export const PI_HOOK_BUNDLE_FINGERPRINT = `sha256:${createHash("sha256").update(JSON.stringify(PI_BUNDLE_SHAPE)).digest("hex")}`;

type JsonObject = Record<string, unknown>;
interface SettingsRead {
  path: string; exists: boolean; valid: boolean; value: JsonObject;
  indent: number; newline: boolean; mode?: number; error?: string;
}

function object(value: unknown): value is JsonObject { return !!value && typeof value === "object" && !Array.isArray(value); }
function packageManifest(root: string): JsonObject | null {
  try { const value = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); return object(value) ? value : null; } catch { return null; }
}
function packageRoot(cfg: Config): string {
  const declared = packageManifest(resolve(cfg.root));
  if (declared?.name === PI_EXTENSION_ID) return resolve(cfg.root);
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (packageManifest(dir)?.name === PI_EXTENSION_ID) return dir;
    const parent = dirname(dir); if (parent === dir) break; dir = parent;
  }
  return resolve(cfg.root);
}
function manifestExtension(root: string): string | null {
  const manifest = packageManifest(root);
  const extensions = object(manifest?.pi) && Array.isArray(manifest.pi.extensions) ? manifest.pi.extensions : [];
  const extension = extensions.length === 1 && typeof extensions[0] === "string" ? extensions[0] : null;
  return extension ? resolve(root, extension) : null;
}
function projectRoot(cfg: Config): string { return resolve(cfg.root, cfg.piProjectRoot ?? "."); }
function settingsPath(cfg: Config): string { return join(projectRoot(cfg), ".pi", "settings.json"); }
function mappingPath(cfg: Config): string { return join(projectRoot(cfg), ".pi", "coherence-root"); }
function canonicalEntry(cfg: Config): string { return relative(join(projectRoot(cfg), ".pi"), packageRoot(cfg)).replaceAll("\\", "/") || "."; }
function expectedMapping(cfg: Config): string { return `${relative(projectRoot(cfg), resolve(cfg.root)).replaceAll("\\", "/") || "."}\n`; }

function readSettingsPath(path: string): SettingsRead {
  if (!existsSync(path)) return { path, exists: false, valid: true, value: {}, indent: 2, newline: true };
  try {
    const raw = readFileSync(path, "utf8");
    const value = JSON.parse(raw);
    if (!object(value)) throw new Error("settings must be a JSON object");
    const match = raw.match(/\n([ \t]+)"/);
    return { path, exists: true, valid: true, value, indent: match ? match[1]!.length : raw.includes("\n") ? 2 : 0, newline: raw.endsWith("\n"), mode: statSync(path).mode & 0o777 };
  } catch (error) { return { path, exists: true, valid: false, value: {}, indent: 2, newline: true, error: error instanceof Error ? error.message : String(error) }; }
}
function readSettings(cfg: Config): SettingsRead { return readSettingsPath(settingsPath(cfg)); }
function packageSource(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  return object(entry) && typeof entry.source === "string" ? entry.source : null;
}
function namesCoherencePackage(source: string): boolean {
  const name = source.startsWith("npm:") ? source.slice(4) : source;
  return name === PI_EXTENSION_ID || name.startsWith(`${PI_EXTENSION_ID}@`);
}
function coherenceExtension(path: string): boolean {
  let dir = dirname(path);
  while (true) {
    if (packageManifest(dir)?.name === PI_EXTENSION_ID && manifestExtension(dir) === path) return true;
    const parent = dirname(dir); if (parent === dir) return false; dir = parent;
  }
}
function recognizedPackage(entry: unknown, base: string): boolean {
  const source = packageSource(entry);
  if (!source) return false;
  if (namesCoherencePackage(source)) return true;
  if (source.startsWith("npm:") || source.startsWith("git:") || /^https?:|^ssh:/.test(source)) return false;
  const resolved = resolve(base, source);
  return packageManifest(resolved)?.name === PI_EXTENSION_ID || coherenceExtension(resolved);
}
function recognizedExtension(entry: unknown, base: string): boolean {
  return typeof entry === "string" && coherenceExtension(resolve(base, entry));
}
function entries(read: SettingsRead, base: string): { packages: unknown[]; extensions: unknown[]; recognized: number } {
  const packages = Array.isArray(read.value.packages) ? read.value.packages : [];
  const extensions = Array.isArray(read.value.extensions) ? read.value.extensions : [];
  return {
    packages, extensions,
    recognized: packages.filter((entry) => recognizedPackage(entry, base)).length
      + extensions.filter((entry) => recognizedExtension(entry, base)).length,
  };
}
function format(value: JsonObject, read: SettingsRead): string {
  return JSON.stringify(value, null, read.indent || undefined) + (read.newline ? "\n" : "");
}
async function atomic(path: string, content: string, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.coherence-${process.pid}-${Date.now()}`;
  await writeFile(temp, content, mode === undefined ? undefined : { mode });
  await rename(temp, path);
}

export function resolvePiProjectRoot(cfg: Config): string { return projectRoot(cfg); }

export interface PiLifecycleInspection {
  host: "pi"; present: boolean; configured: boolean; valid: boolean;
  settings: { path: string; exists: boolean; valid: boolean; canonicalEntries: number; managedEntries: number; error?: string };
  mapping: { path: string; present: boolean; expected: string; actual?: string };
  target: { packageRoot: string; extensionPath: string; present: boolean };
  bundleFingerprint: string; warnings: string[];
}
export interface PiLifecycleMutation { inspection: PiLifecycleInspection; changed: string[]; errors: string[]; }

export function inspectPiLifecycleHook(cfg: Config): PiLifecycleInspection {
  const read = readSettings(cfg), root = packageRoot(cfg), extension = manifestExtension(root), entry = canonicalEntry(cfg);
  const valid = read.valid && (read.value.packages === undefined || Array.isArray(read.value.packages))
    && (read.value.extensions === undefined || Array.isArray(read.value.extensions));
  const found = valid ? entries(read, join(projectRoot(cfg), ".pi")) : { packages: [], extensions: [], recognized: 0 };
  const canonicalEntries = found.packages.filter((value) => value === entry).length;
  const mapPath = mappingPath(cfg), actual = existsSync(mapPath) ? readFileSync(mapPath, "utf8") : undefined;
  const targetPresent = !!extension && statSafeFile(extension);
  const present = valid && canonicalEntries === 1 && found.recognized === 1 && actual === expectedMapping(cfg) && targetPresent;
  return { host: "pi", present, configured: valid && canonicalEntries === 1 && actual === expectedMapping(cfg), valid,
    settings: { path: read.path, exists: read.exists, valid, canonicalEntries, managedEntries: found.recognized, ...(read.error ? { error: read.error } : {}) },
    mapping: { path: mapPath, present: actual !== undefined, expected: expectedMapping(cfg), ...(actual === undefined ? {} : { actual }) },
    target: { packageRoot: root, extensionPath: extension ?? "", present: targetPresent }, bundleFingerprint: PI_HOOK_BUNDLE_FINGERPRINT, warnings: [] };
}
function statSafeFile(path: string): boolean { try { return lstatSync(path).isFile(); } catch { return false; } }

export async function setPiLifecycleHook(cfg: Config, present: boolean): Promise<PiLifecycleMutation> {
  const before = inspectPiLifecycleHook(cfg), changed: string[] = [], errors: string[] = [], read = readSettings(cfg);
  if (!read.valid) return { inspection: before, changed, errors: [`${read.path}: ${read.error}`] };
  const root = packageRoot(cfg), extension = manifestExtension(root);
  if (present && !extension) return { inspection: before, changed, errors: ["Pi extension target is missing from the package manifest"] };
  if (present && !statSafeFile(extension!)) return { inspection: before, changed, errors: ["Pi extension target is missing"] };
  if (read.value.packages !== undefined && !Array.isArray(read.value.packages)) return { inspection: before, changed, errors: [`${read.path}: packages must be an array`] };
  if (read.value.extensions !== undefined && !Array.isArray(read.value.extensions)) return { inspection: before, changed, errors: [`${read.path}: extensions must be an array`] };
  const base = join(projectRoot(cfg), ".pi"), found = entries(read, base);
  if (present && found.recognized > 1) return { inspection: before, changed, errors: ["Pi settings contain multiple ambiguous coherence entries"] };
  const entry = canonicalEntry(cfg), next = structuredClone(read.value);
  const packages = found.packages.filter((value) => !recognizedPackage(value, base));
  const extensions = found.extensions.filter((value) => !recognizedExtension(value, base));
  if (present) packages.push(entry);
  if (read.value.packages !== undefined || present || packages.length) next.packages = packages;
  if (read.value.extensions !== undefined) next.extensions = extensions;
  if (JSON.stringify(next) !== JSON.stringify(read.value)) { await atomic(read.path, format(next, read), read.mode); changed.push(read.path); }
  if (present) {
    const expected = expectedMapping(cfg), current = existsSync(mappingPath(cfg)) ? readFileSync(mappingPath(cfg), "utf8") : undefined;
    if (current !== expected) { await atomic(mappingPath(cfg), expected); changed.push(mappingPath(cfg)); }
  } else {
    const current = existsSync(mappingPath(cfg)) ? readFileSync(mappingPath(cfg), "utf8") : undefined;
    if (current === expectedMapping(cfg)) { await rm(mappingPath(cfg)); changed.push(mappingPath(cfg)); }
  }
  return { inspection: inspectPiLifecycleHook(cfg), changed: [...new Set(changed)], errors };
}

function contains(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function resolvePiRuntimeRoot(cwd: string, extensionPath: string): { active: true; root: string } | { active: false; reason: string } {
  const declared: string[] = [];
  let dir = resolve(cwd);
  while (true) {
    const map = join(dir, ".pi", "coherence-root");
    if (existsSync(map)) {
      const rel = readFileSync(map, "utf8");
      if (!rel.endsWith("\n") || rel.slice(0, -1).includes("\n")) return { active: false, reason: "invalid Pi coherence mapping" };
      const root = resolve(dir, rel.trim());
      if (!existsSync(join(root, "coherence.config.json"))) return { active: false, reason: "mapped coherence root is undeclared" };
      const settings = readSettingsPath(join(dir, ".pi", "settings.json"));
      if (!settings.valid || !Array.isArray(settings.value.packages)) return { active: false, reason: "mapped Pi settings are invalid" };
      const selected = settings.value.packages.filter((entry) => recognizedPackage(entry, join(dir, ".pi")))
        .map((entry) => packageSource(entry)).filter((source): source is string => !!source && !namesCoherencePackage(source))
        .map((source) => manifestExtension(resolve(join(dir, ".pi"), source))).filter((path): path is string => !!path);
      if (selected.length === 1 && resolve(extensionPath) === selected[0]) return { active: true, root };
      return { active: false, reason: "extension is not the mapped coherence package" };
    }
    if (existsSync(join(dir, "coherence.config.json"))) declared.push(dir);
    const parent = dirname(dir); if (parent === dir) break; dir = parent;
  }
  if (declared.length !== 1) return { active: false, reason: declared.length ? "multiple declared coherence roots are ambiguous" : "Pi project control is absent" };
  const root = declared[0]!;
  return contains(root, resolve(extensionPath))
    ? { active: false, reason: "an in-project competing extension is inert without project control" }
    : { active: true, root };
}
