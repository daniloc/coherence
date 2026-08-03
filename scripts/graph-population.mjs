#!/usr/bin/env node
// THE POPULATION PROBE floor.ts prescribes and this repo did not have.
//
// floor.ts names a hole it deliberately does NOT close: a gradual N→1 collapse of the
// derived graph, where the walk drops one whole component per step. Each step is
// observationally identical to deleting a component's spec, deletion must stay free, and
// so the non-vacuity floor cannot gate it. Its named mitigation is a PIN — "a `measures`
// dimension in `config.mass` whose command counts the population (component nodes or
// claim lines in the derived graph)" — which turns the shrink into a ratchet finding a
// human re-pins with a diff, rather than a gate that punishes removal.
//
// This is that command. It DERIVES the graph rather than reading `public/graph.json`,
// which matters: a walk that drops a component still leaves the last-committed artifact
// intact, and a probe that reads the artifact would report the pre-collapse population
// and pin the collapse as "no change" — the exact laundering mass.ts's header warns a
// broken probe performs.
//
// A THIN ENTRY, like scripts/run-named-test.mjs: the logic it needs is already inside the
// evidence perimeter (`sources: ["src"]`), so nothing but composition lives out here.
// Prints the count as the only token on stdout; `mass` reads the last numeric token, and
// a nonzero exit is UNMEASURABLE (never 0), which is what makes a broken derivation fail
// the ratchet closed instead of reading as a heroic shrink.
import { loadConfig } from "../src/config.ts";
import { buildGraph } from "../src/derive.ts";

const what = process.argv[2];
if (what !== "components" && what !== "claims") {
  console.error("usage: graph-population.mjs <components|claims>");
  process.exit(2);
}

const graph = await buildGraph(await loadConfig(process.cwd()));
const components = graph.nodes.filter((n) => n.kind === "component");
console.log(
  what === "components"
    ? components.length
    : components.reduce((n, c) => n + (c.claims?.length ?? 0), 0),
);
