// language-registry.ts — the one seam every instrument consults for languages beyond the
// built-ins: a registered pack's rows reach the graph, surface, sites, sinks, and oracle
// arms exactly where the built-in rows do.
//
// A LEAF ON PURPOSE. language-packs.ts imports every arm to aggregate the built-ins; the
// arms import THIS module to read registered rows. Only `import type` crosses the other
// way (erased at runtime), so the registry can never close an import cycle, and an arm
// reading rows during its own module evaluation (redundancy's top-level grammar load)
// sees a finished registry.
//
// A REGISTERED PACK IS HELD TO THE BUILT-INS' RULE. Data only — query text, patterns,
// names of mechanism-owned strategies — and the purity sweep runs at registration, so a
// function-valued field refuses by path before any instrument trusts the row. A built-in
// name refuses too: shadowing `typescript` would silently re-grade a different tree. The
// FIRST registration of a name wins and later ones are ignored: `signal` and `log` import
// a historic copy of the project module from a detached worktree, and pinning the current
// tree's rows keeps the instrument constant across the diff it measures.
//
// FIRST-PARTY PACKS SEED FROM A STATIC LIST, NEVER BY SIDE-EFFECT IMPORT. Rust ships in
// the package as a pack, not as rows in each arm's table, so `"language": "rust"` takes
// the same path a project pack takes. The pack modules are this file's only runtime
// imports and import nothing back but types, so seeding finishes before any arm module
// evaluates — redundancy's top-level grammar load included — whatever imported first.
import { rustPack } from "./languages/rust.ts";
import type { TreeSitterLanguageSpec } from "./adapters/tree-sitter.ts";
import type { SurfaceLanguage } from "./novelty.ts";
import type { SiteLanguage } from "./redundancy.ts";
import type { SinkLanguage } from "./lint-sinks.ts";
import type { OracleLanguageSpec } from "./oracle-domain.ts";

/** The names the harness ships grammars for. tree-sitter.ts ties its grammar and adapter
 *  tables to this list with `satisfies`, so tsc is the oracle that the spellings agree. */
export const BUILTIN_LANGUAGE_NAMES = ["typescript", "python", "ruby"] as const;
/** One shipped language's name — the key type the built-in tables are checked against. */
export type BuiltinLanguageName = (typeof BUILTIN_LANGUAGE_NAMES)[number];

/** The packs that ship in the package and register before anything else can. Their
 *  names are as reserved as the built-ins': a project pack named `rust` refuses. */
const FIRST_PARTY_PACKS: readonly LanguagePack[] = [rustPack];

/** One language, every instrument it covers: DATA ONLY (pack purity). An absent arm is a
 *  declared gap — that instrument contributes nothing for the language, never a fallback. */
export interface LanguagePack {
  /** The name the pack registers under; a built-in name refuses. */
  name: string;
  /** Filesystem path of the grammar .wasm; arms reach it by naming `name` as their grammar. */
  grammar: string;
  graph?: TreeSitterLanguageSpec;
  surface?: SurfaceLanguage;
  sites?: SiteLanguage;
  sinks?: SinkLanguage;
  oracle?: OracleLanguageSpec;
}

/** Depth-first sweep for function-valued fields; returns the path of each offender.
 *  RegExp is data (a pattern); a function is code and never belongs in a pack. */
export function functionFields(value: unknown, path = "pack"): string[] {
  if (typeof value === "function") return [path];
  if (value instanceof RegExp || value === null || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) out.push(...functionFields(v, `${path}.${k}`));
  return out;
}

/** Why a would-be pack cannot register, by field — empty when it can. The routing fields
 *  are checked because an instrument dereferences them for every file it walks; a missing
 *  one would surface as a crash deep inside a scan instead of a named refusal here. */
export function languagePackProblems(pack: unknown): string[] {
  if (!pack || typeof pack !== "object") return ["a language pack must be an object"];
  const p = pack as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof p.name !== "string" || !p.name) problems.push("`name` must be a non-empty string");
  else if ((BUILTIN_LANGUAGE_NAMES as readonly string[]).includes(p.name)
    || FIRST_PARTY_PACKS.some((f) => f.name === p.name && f !== pack)) {
    problems.push(`\`name\` ${JSON.stringify(p.name)} is a built-in language and cannot be re-registered`);
  }
  if (typeof p.grammar !== "string" || !p.grammar) problems.push("`grammar` must be the path of a grammar .wasm");
  const field = (arm: string, key: string, ok: (v: unknown) => boolean, want: string) => {
    const row = p[arm] as Record<string, unknown> | undefined;
    if (row !== undefined && !ok(row?.[key])) problems.push(`\`${arm}.${key}\` must be ${want}`);
  };
  const isRe = (v: unknown) => v instanceof RegExp;
  const isStr = (v: unknown) => typeof v === "string" && v.length > 0;
  field("surface", "ext", isRe, "a RegExp");
  field("sites", "ext", isRe, "a RegExp");
  field("sinks", "ext", isStr, "an extension string");
  field("oracle", "testFilePattern", isRe, "a RegExp");
  for (const offender of functionFields(pack)) problems.push(`${offender} is a function — a pack carries data, never code`);
  return problems;
}

const registry = new Map<string, LanguagePack>();

/** Register a pack, or throw naming every problem. Returns false when an earlier pack of
 *  the same name already holds the slot (first registration wins). */
export function registerLanguagePack(pack: LanguagePack): boolean {
  const problems = languagePackProblems(pack);
  if (problems.length) throw new Error(`language pack refused:\n  ${problems.join("\n  ")}`);
  if (registry.has(pack.name)) return false;
  registry.set(pack.name, pack);
  return true;
}

// Seeded through the same refusal path a project pack takes, so a first-party pack that
// grew a function field fails at import, by path, before any instrument reads it.
for (const pack of FIRST_PARTY_PACKS) registerLanguagePack(pack);

/** The registered pack of one name, if any. */
export const registeredPack = (name: string): LanguagePack | undefined => registry.get(name);

/** Every registered pack's name, first-party ones first — what a refusal lists. */
export const registeredNames = (): string[] => [...registry.keys()];

/** Every registered row for one instrument arm, in registration order. */
export function registeredRows<K extends "surface" | "sites" | "sinks" | "oracle">(arm: K): NonNullable<LanguagePack[K]>[] {
  return [...registry.values()].flatMap((p) => (p[arm] ? [p[arm]!] : []));
}
