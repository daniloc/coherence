// scaffold.ts — the gradient-flip generator.
//
// Portability of the doctrine = making the convergent (O(1)) shape CHEAPER to produce
// than the divergent (O(N)) one. Each kind emits the WHOLE anti-entropic anatomy in one
// shot so the complete shape is the cheapest thing to ship:
//   boundary  — a NEW component spec pre-wired with `## invariants` + a `boundary` claim
//               + the chokepoint/fail-closed/oracle TODOs. You cannot scaffold a
//               half-boundary: the unanchored-invariant gate refuses the spec until the
//               chokepoint symbol and the oracle both exist.
//   component — a NEW plain component spec (intent + works-when skeleton + a why stub).
//   invariant — the PASTE-IN fragments (invariants entry + boundary claim + why
//               paragraph) for an EXISTING component spec; printed to stdout, no file.
//
// The spec/claim shape is language-agnostic and lives here; concrete code templates are
// the (optional) job of a language adapter, so the core stays the physics.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./types.ts";

function boundaryFragments(name: string): { inv: string; claim: string; why: string } {
  const inv = `${name} property`;
  return {
    inv,
    claim: `boundary "${inv}" at ChokepointSymbol via test "${name} totality"`,
    why: `The invariant "${inv}" is enforced at ONE chokepoint — \`ChokepointSymbol\` — that a new
code path physically cannot avoid, with a FAIL-CLOSED default (absence of a declaration →
the safe/denied state, never the open one), asserted by a totality oracle ("${name}
totality") that fails loud if the chokepoint stops covering the whole domain. Do NOT
re-implement the guard at call sites; route through the chokepoint. Adding a new case is a
row in the declaration the chokepoint reads, not a new guard somewhere.`,
  };
}

const CODE_TODO = (name: string) => `<!-- TODO(code), in this order — the boundary claim stays RED until all three exist:
  1. ChokepointSymbol — the ONE place the rule lives (a required flag, a registry, a
     factory). Everything that touches the invariant routes through it.
  2. a FAIL-CLOSED default — an unclassified/unrouted case resolves to the safe state.
  3. a test "${name} totality" — asserts the chokepoint covers the enumerable domain
     (e.g. every member of KERNEL_TABLES is classified; every served sink is enumerated). -->`;

function boundarySpec(cap: string, name: string): string {
  const { inv, claim, why } = boundaryFragments(name);
  return `# ${cap}

One-line intent: what this component IS (a noun, the thing it owns).

## invariants
- ${inv}

## works when
- chokepoint.ts exists at this node
- ${claim}

## why

${why}

${CODE_TODO(name)}
`;
}

function componentSpec(cap: string): string {
  return `# ${cap}

One-line intent: what this component IS — a noun, the single concern it owns.

## works when
- main.ts exists at this node
- main.ts imports ./dependency

## why

Why this is its OWN component: the non-derivable decision it embodies (the boundary it
draws, the concern it keeps from leaking into its neighbours). The WHAT is derivable from
code and regenerated; this WHY is not — author it, don't fabricate it.
`;
}

function usage(): number {
  console.error("usage: coherence scaffold <boundary|component|invariant> <name>   (name: a short identifier)");
  return 2;
}

export async function scaffold(cfg: Config, kind: string, name: string): Promise<number> {
  if (!name || !/^[a-z][a-z0-9-]*$/i.test(name)) return usage();
  const cap = name[0].toUpperCase() + name.slice(1);

  if (kind === "boundary") {
    const path = join(cfg.root, `${name}.spec.md.draft`);
    await writeFile(path, boundarySpec(cap, name));
    console.log(`scaffolded boundary "${name}" → ${name}.spec.md.draft`);
    console.log(`Place it as <component-dir>/${name}.spec.md, then fill the three TODO(code)`);
    console.log(`items the spec names. \`coherence verify\` will refuse the spec until the`);
    console.log(`chokepoint symbol and the "${name} totality" oracle both exist — that refusal`);
    console.log(`is the ratchet: it makes the complete boundary the only thing you can ship.`);
    return 0;
  }

  if (kind === "component") {
    const path = join(cfg.root, `${name}.spec.md.draft`);
    await writeFile(path, componentSpec(cap));
    console.log(`scaffolded component "${name}" → ${name}.spec.md.draft`);
    console.log(`Place it as <component-dir>/${name}.spec.md and replace the placeholder`);
    console.log(`works-when claims with real ones (exists / imports). \`coherence verify\``);
    console.log(`then gates that the component carries claims AND a why.`);
    return 0;
  }

  if (kind === "invariant") {
    // The "add to an EXISTING spec" path — no new file, just the three fragments that
    // must land in lockstep so the new invariant ships anchored, not as orphaned prose.
    const { inv, claim, why } = boundaryFragments(name);
    console.log(`# add invariant "${inv}" to an existing component spec — paste each fragment\n`);
    console.log(`## invariants  (append)`);
    console.log(`- ${inv}\n`);
    console.log(`## works when  (append — anchors the invariant; stays RED until the chokepoint + oracle exist)`);
    console.log(`- ${claim}\n`);
    console.log(`## why  (append a paragraph)`);
    console.log(why + "\n");
    console.log(CODE_TODO(name));
    return 0;
  }

  return usage();
}
