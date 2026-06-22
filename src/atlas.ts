// atlas.ts — the trust-graded manifold, rendered (was mnemion's atlas.mjs). CHARTS are
// trust domains; TRANSITION MAPS are chokepoints that cross between them. Each crossing's
// TIER is DERIVED from the live boundary claims (the harness already parsed them): a
// crossing anchored by a `via guard` claim is tier-1 (enshrined/structural), `via test`
// is tier-2 (totality-checked), and no governing claim is tier-3 (convention — a latent
// tear if it's a security crossing). The charts + crossings are project data (`cfg.atlas`);
// the harness owns the tier derivation, the drift/dangling check, and the render.
import type { Config, Graph } from "./types.ts";
import { scanSources } from "./sidecar.ts";
import { allBoundaries } from "./structural.ts";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const pad = (s: unknown, n: number) => String(s).padEnd(n);

export async function atlas(cfg: Config, graph: Graph, mode: "render" | "check"): Promise<number> {
  const a = cfg.atlas;
  if (!a || !a.charts || !a.transitions) {
    console.log("\n  atlas: no `atlas` config (charts + transitions) — nothing to render.\n");
    return 0;
  }
  const charts = a.charts;
  const transitions = a.transitions;
  const nonTransition = a.nonTransition ?? {};
  const knownPending = new Set(a.knownPending ?? []);

  // Tier from the parsed boundary claims, keyed by chokepoint (shared with conventions).
  const claims = allBoundaries(graph);
  const { src } = await scanSources(cfg);
  const srcText = src.map((f) => f.text).join("\n");
  const symbolExists = (s: string) => new RegExp(`\\b${s}\\b`).test(srcText);

  const tierOf = (sym: string, anchoredBy?: string) => {
    const c = claims.get(sym) || (anchoredBy ? claims.get(anchoredBy) : undefined);
    if (!c) return { tier: 3, label: "convention", note: "no boundary claim" };
    const via = anchoredBy && !claims.get(sym) ? ` (via ${anchoredBy})` : "";
    if (c.verb === "guard") return { tier: 1, label: "enshrined", note: c.oracle + via };
    return { tier: 2, label: "totality-checked", note: c.oracle + via };
  };

  const edges = Object.entries(transitions).map(([sym, def]) => ({
    sym, ...def, ...tierOf(sym, def.anchoredBy), present: symbolExists(sym), pending: knownPending.has(sym),
  }));

  // (a) DRIFT: a boundary chokepoint with no transition entry, unless it's a declared
  //     within-chart non-transition or the `anchoredBy` symbol a crossing cites.
  const anchoredBySyms = new Set(Object.values(transitions).map((d) => d.anchoredBy).filter(Boolean) as string[]);
  const drift = [...claims.keys()].filter((sym) => !(sym in transitions) && !(sym in nonTransition) && !anchoredBySyms.has(sym));
  // (b) DANGLING: a mapped symbol no longer in source (pending excused).
  const dangling = edges.filter((e) => !e.present && !e.pending);
  const pendingMissing = edges.filter((e) => !e.present && e.pending);

  // ── console render ──
  const out: string[] = ["\n  SECURITY ATLAS — the trust-graded manifold, made explicit\n", "  CHARTS (trust domains):"];
  for (const [name, desc] of Object.entries(charts)) out.push(`    ${pad(name, 18)} ${desc}`);
  out.push("\n  TRANSITION MAPS (chokepoints crossing charts), by tier:");
  for (const tier of [1, 2, 3]) {
    const group = edges.filter((e) => e.tier === tier).sort((x, y) => x.sym.localeCompare(y.sym));
    if (!group.length) continue;
    const label = tier === 1 ? "ENSHRINED (structural, one crossing)"
      : tier === 2 ? "TOTALITY-CHECKED (N sites, oracle proves agreement)"
      : "CONVENTION (N unmanaged sites — latent tear if security)";
    out.push(`\n  ── tier-${tier} · ${label} ──`);
    for (const e of group) {
      const flags = (e.security ? "" : " [non-security]") + (!e.present ? (e.pending ? " [PENDING]" : " [DANGLING]") : "");
      out.push(`    ${pad(`${e.from} → ${e.to}`, 38)} [tier-${e.tier}] ${pad(e.sym, 24)}${flags}`);
      out.push(`      ${pad("", 38)} translates: ${e.translates}`);
    }
  }
  out.push("\n  ── flags ──");
  if (drift.length) {
    out.push(`  ✗ ATLAS DRIFT — ${drift.length} spec boundary chokepoint(s) with NO transition entry:`);
    for (const sym of drift) out.push(`      ${pad(sym, 28)} (boundary "${claims.get(sym)!.inv}", ${claims.get(sym)!.component})`);
  } else out.push("  ✓ no drift — every spec boundary chokepoint is mapped (or a declared within-chart non-transition).");
  if (dangling.length) { out.push(`  ✗ DANGLING — ${dangling.length} mapped symbol(s) no longer in source:`); for (const e of dangling) out.push(`      ${e.sym}`); }
  else out.push("  ✓ no dangling edges — every mapped symbol exists in source.");
  if (pendingMissing.length) out.push(`  ⋯ pending — ${pendingMissing.map((e) => e.sym).join(", ")} not yet in source (does not fail --check).`);
  const counts = [1, 2, 3].map((t) => edges.filter((e) => e.tier === t).length);
  out.push(`\n  Tiers: ${counts[0]} enshrined · ${counts[1]} totality-checked · ${counts[2]} convention  (${edges.length} crossings total)`);
  const tier3sec = edges.filter((e) => e.tier === 3 && e.security);
  if (tier3sec.length) {
    out.push(`\n  ◀ HEADLINE — ${tier3sec.length} tier-3 SECURITY crossing(s) (unmanaged — a latent tear in the manifold):`);
    for (const e of tier3sec) out.push(`      ${pad(e.sym, 24)} ${e.from} → ${e.to} — ${e.translates}`);
  } else out.push("\n  ✓ no tier-3 security crossings — every security transition is enshrined or totality-checked.");
  console.log(out.join("\n") + "\n");

  // ── doc artifact (atlas.md in the output dir) ──
  const L: string[] = ["# Security Atlas", "",
    "> Generated by `coherence atlas`. Do not edit by hand — the tiers are derived from the",
    "> `## works when` boundary claims in the `*.spec.md` tree; charts + crossings are `coherence.config.json`.", "",
    "The security architecture is a **trust-graded manifold**: components are CHARTS (local",
    "trust domains); chokepoints are TRANSITION MAPS that cross between them, re-establishing",
    "the destination chart's invariant. Trust is directional — only an enshrined chokepoint raises it.", "",
    "## Charts (trust domains)", "", "| chart | description |", "| --- | --- |"];
  for (const [name, desc] of Object.entries(charts)) L.push(`| \`${name}\` | ${desc} |`);
  L.push("", "## Transition maps (chokepoints), by tier", "",
    "| tier | from → to | chokepoint | oracle | re-establishes |", "| --- | --- | --- | --- | --- |");
  for (const tier of [1, 2, 3])
    for (const e of edges.filter((x) => x.tier === tier).sort((x, y) => x.sym.localeCompare(y.sym))) {
      const mark = e.present ? "" : (e.pending ? " _(pending)_" : " _(DANGLING)_");
      L.push(`| tier-${e.tier} | \`${e.from}\` → \`${e.to}\` | \`${e.sym}\`${mark} | ${e.note} | ${e.translates} |`);
    }
  L.push("", `**Tiers:** ${counts[0]} enshrined · ${counts[1]} totality-checked · ${counts[2]} convention (${edges.length} crossings).`, "");
  if (tier3sec.length) {
    L.push("### Headline — tier-3 security crossings (unmanaged)", "", "Security boundaries enforced by convention, not a chokepoint + totality oracle:", "");
    for (const e of tier3sec) L.push(`- \`${e.sym}\` (\`${e.from}\` → \`${e.to}\`) — ${e.translates}`);
  } else L.push("### Headline", "", "No tier-3 security crossings — every security transition is enshrined or totality-checked.");
  L.push("");
  await mkdir(join(cfg.root, cfg.outputDir), { recursive: true });
  await writeFile(join(cfg.root, cfg.outputDir, "atlas.md"), L.join("\n"));

  if (mode === "check") {
    if (drift.length || dangling.length) {
      console.error("  ✗ atlas --check FAILED — the atlas is out of sync with the boundary claims.");
      if (drift.length) console.error("    drift: " + drift.join(", "));
      if (dangling.length) console.error("    dangling: " + dangling.map((e) => e.sym).join(", "));
      return 1;
    }
    console.log("  ✓ atlas --check held — every boundary chokepoint is mapped, no dangling edges.\n");
  }
  return 0;
}
