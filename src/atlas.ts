// atlas.ts — the trust-graded manifold, rendered (was mnemion's atlas.mjs). CHARTS are
// trust domains; TRANSITION MAPS are chokepoints that cross between them. Each crossing's
// TIER is derived from the live boundary claims (parsed already) PLUS explicit project
// attestation — a generic renderer CANNOT infer unrepresentability from a claim's verb:
//   - tier-1 (enshrined/structural) ONLY IF the transition is explicitly marked
//     `enshrined` in cfg.atlas AND is backed by a `via guard` boundary claim. Enshrinement
//     is the strictly stronger property — a runtime-branded capability whose illegal value
//     cannot be constructed — and the `via guard` is the source-totality evidence it rides
//     on. A bare `via guard` does NOT make a violation unrepresentable (you can still write
//     the raw call; the guard only rejects it at build), so it is NOT tier-1 on its own.
//   - tier-2 (totality-checked) for a `via guard` OR `via test` claim NOT marked enshrined.
//   - tier-3 (convention) when no governing claim exists — a latent tear if it's a security
//     crossing.
// FAIL-CLOSED: a transition marked `enshrined` with no backing `via guard` claim is an
// over-claim and fails `atlas --check` (it must red, not silently render tier-1). The charts
// + crossings + `enshrined` markers are project data (`cfg.atlas`); the harness owns the tier
// derivation, the drift/dangling/over-claim checks, and the render.
import type { Config, Graph } from "./types.ts";
import { scanSources } from "./sidecar.ts";
import { allBoundaries, boundariesAt } from "./structural.ts";
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

  // Tier is explicit attestation (`enshrined`) crossed with the boundary-claim evidence —
  // NOT verb-inferred. `overclaim` flags an `enshrined` marker with no backing via-guard
  // claim: it fails-closed rather than rendering tier-1 off an absent source-totality guard.
  const tierOf = (sym: string, def: { anchoredBy?: string; enshrined?: true }) => {
    const anchoredBy = def.anchoredBy;
    const enshrined = def.enshrined === true;
    const c = claims.get(sym) || (anchoredBy ? claims.get(anchoredBy) : undefined);
    if (!c)
      return enshrined
        ? { tier: 3, label: "convention", note: "MARKED enshrined but NO boundary claim", overclaim: true }
        : { tier: 3, label: "convention", note: "no boundary claim", overclaim: false };
    const via = anchoredBy && !claims.get(sym) ? ` (via ${anchoredBy})` : "";
    // Enshrinement rides on source-totality evidence: it is guard-backed iff ANY boundary
    // claim at this chokepoint is `via guard` — NOT whichever single claim `allBoundaries`
    // kept (that pick is spec-line-order-dependent, so a benign doc reorder could otherwise
    // flip a legitimate tier-1 into a false over-claim). `c` still supplies the display note.
    const claimSym = claims.get(sym) ? sym : (anchoredBy as string);
    const guardBacked = boundariesAt(graph, claimSym).some((b) => b.verb === "guard");
    if (enshrined && guardBacked) return { tier: 1, label: "enshrined", note: c.oracle + via, overclaim: false };
    if (enshrined)
      // marked enshrined but the backing claim is `via test`, not `via guard` — no source-
      // totality guard to ride on. Render at its real evidence tier (2) and fail-closed.
      return { tier: 2, label: "totality-checked", note: `${c.oracle}${via} — MARKED enshrined but backing claim is \`via ${c.verb}\`, not \`via guard\``, overclaim: true };
    return { tier: 2, label: "totality-checked", note: c.oracle + via, overclaim: false };
  };

  const edges = Object.entries(transitions).map(([sym, def]) => ({
    sym, ...def, ...tierOf(sym, def), present: symbolExists(sym), pending: knownPending.has(sym),
  }));
  // FAIL-CLOSED over-claim: `enshrined` markers with no backing `via guard` boundary claim.
  const overclaimed = edges.filter((e) => e.overclaim);

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
    const n = group.length, s = n === 1 ? "" : "s";
    const label = tier === 1 ? `ENSHRINED (structural — ${n} crossing${s})`
      : tier === 2 ? `TOTALITY-CHECKED (${n} site${s}, oracle proves agreement)`
      : `CONVENTION (${n} unmanaged site${s} — latent tear if security)`;
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
  if (overclaimed.length) {
    out.push(`  ✗ OVER-CLAIM — ${overclaimed.length} transition(s) marked \`enshrined\` with NO backing \`via guard\` claim:`);
    for (const e of overclaimed) out.push(`      ${pad(e.sym, 28)} (enshrinement needs a source-totality guard; ${e.note})`);
  } else out.push("  ✓ no over-claim — every enshrined crossing is backed by a `via guard` boundary claim.");
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
  if (overclaimed.length) {
    L.push("", "### Over-claim — `enshrined` markers with no backing `via guard` (fails `atlas --check`)", "",
      "An enshrinement marker with no source-totality guard is an empty over-claim — it is rendered at its real evidence tier, not tier-1:", "");
    for (const e of overclaimed) L.push(`- \`${e.sym}\` (\`${e.from}\` → \`${e.to}\`) — ${e.note}`);
  }
  L.push("");
  await mkdir(join(cfg.root, cfg.outputDir), { recursive: true });
  await writeFile(join(cfg.root, cfg.outputDir, "atlas.md"), L.join("\n"));

  if (mode === "check") {
    if (drift.length || dangling.length || overclaimed.length) {
      console.error("  ✗ atlas --check FAILED — the atlas is out of sync with the boundary claims.");
      if (drift.length) console.error("    drift: " + drift.join(", "));
      if (dangling.length) console.error("    dangling: " + dangling.map((e) => e.sym).join(", "));
      if (overclaimed.length) console.error("    over-claim (marked `enshrined`, no backing `via guard`): " + overclaimed.map((e) => e.sym).join(", "));
      return 1;
    }
    console.log("  ✓ atlas --check held — every boundary chokepoint is mapped, no dangling edges, no over-claimed enshrinement.\n");
  }
  return 0;
}
