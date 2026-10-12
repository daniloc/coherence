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
// Future home of pack conformance (`languages --check`); today it aggregates the
// built-ins for inspection and the purity oracle. Project packs merge through
// language-registry.ts, held to the same sweep at registration.
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

// The purity sweep lives in the registry, which runs it on every registered pack before
// any instrument trusts a row; re-exported so the built-in guard reads the same spelling.
export { functionFields } from "./language-registry.ts";
