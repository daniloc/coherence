// scaffold.ts — the gradient-flip generator.
//
// Portability of the doctrine = making the convergent (O(1)) shape CHEAPER to produce
// than the divergent (O(N)) one. This emits the WHOLE anti-entropic anatomy for a new
// boundary in one shot — a spec pre-wired with `## invariants` + a `boundary` claim +
// the `## why`, plus the code-side TODOs for the chokepoint, the fail-closed default, and
// the totality oracle. You cannot scaffold a half-boundary: the unanchored-invariant gate
// (`coherence verify`) refuses the spec until the chokepoint symbol and the oracle exist.
//
// The spec/claim shape is language-agnostic and lives here; concrete code templates are
// the (optional) job of a language adapter, so the core stays the physics.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./types.ts";

function boundarySpec(cap: string, name: string): string {
  const inv = `${name} property`;
  return `# ${cap}

One-line intent: what this component IS (a noun, the thing it owns).

## invariants
- ${inv}

## works when
- chokepoint.ts exists at this node
- boundary "${inv}" at ChokepointSymbol via test "${name} totality"

## why

The invariant "${inv}" is enforced at ONE chokepoint — \`ChokepointSymbol\` — that a new
code path physically cannot avoid, with a FAIL-CLOSED default (absence of a declaration →
the safe/denied state, never the open one), asserted by a totality oracle ("${name}
totality") that fails loud if the chokepoint stops covering the whole domain. Do NOT
re-implement the guard at call sites; route through the chokepoint. Adding a new case is a
row in the declaration the chokepoint reads, not a new guard somewhere.

<!-- TODO(code), in this order — the boundary claim above stays RED until all three exist:
  1. ChokepointSymbol — the ONE place the rule lives (a required flag, a registry, a
     factory). Everything that touches the invariant routes through it.
  2. a FAIL-CLOSED default — an unclassified/unrouted case resolves to the safe state.
  3. a test "${name} totality" — asserts the chokepoint covers the enumerable domain
     (e.g. every member of KERNEL_TABLES is classified; every served sink is enumerated).
     This is the "you can stop" signal: it turns "did I find every gap?" into a check. -->
`;
}

export async function scaffold(cfg: Config, kind: string, name: string): Promise<number> {
  if (kind !== "boundary" || !name || !/^[a-z][a-z0-9-]*$/i.test(name)) {
    console.error('usage: coherence scaffold boundary <name>   (name: a short identifier)');
    return 2;
  }
  const cap = name[0].toUpperCase() + name.slice(1);
  const path = join(cfg.root, `${name}.spec.md.draft`);
  await writeFile(path, boundarySpec(cap, name));
  console.log(`scaffolded boundary "${name}" → ${name}.spec.md.draft`);
  console.log(`Place it as <component-dir>/${name}.spec.md, then fill the three TODO(code)`);
  console.log(`items the spec names. \`coherence verify\` will refuse the spec until the`);
  console.log(`chokepoint symbol and the "${name} totality" oracle both exist — that refusal`);
  console.log(`is the ratchet: it makes the complete boundary the only thing you can ship.`);
  return 0;
}
