// language-packs.ts — the one place every built-in language pack is visible at once.
//
// A pack is DATA: query text, regex/string fields, and names of mechanism-owned
// strategies — never functions. That rule is what keeps "add a language" a table-row
// act instead of a code contribution, and it is enforceable precisely because the
// packs are inspectable values: the purity guard walks this aggregate and refuses any
// function-valued field. Structural soundness alone did not earn that trust — every
// table below was gated against its predecessor at zero behavioral deltas before the
// predecessor was deleted (the sinks, surface, sites, and oracle gates; see the
// experiment ledger) — but the type-level rule is what makes the NEXT hand-rolled
// scanner unrepresentable at this seam rather than merely discouraged.
//
// Future home of pack conformance (`languages --check`) and project-local pack
// merging; today it aggregates for inspection and the purity oracle, nothing more.
import { typescript, python, ruby } from "./adapters/tree-sitter.ts";
import { SURFACE_LANGUAGES } from "./novelty.ts";
import { SITE_LANGUAGES } from "./redundancy.ts";
import { SINK_LANGUAGES } from "./lint-sinks.ts";
import { ORACLE_LANGUAGES } from "./oracle-domain.ts";

/** Every built-in pack table, keyed by the instrument that consumes it. */
export function builtinLanguagePacks(): Record<string, unknown> {
  return {
    graph: { typescript, python, ruby },
    surface: SURFACE_LANGUAGES,
    sites: SITE_LANGUAGES,
    sinks: SINK_LANGUAGES,
    oracle: ORACLE_LANGUAGES,
  };
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
