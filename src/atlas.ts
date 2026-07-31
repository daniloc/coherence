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
import { recordAtlas } from "./status.ts";
import { readCommitLog, fileChurn, gitPrefix, rebaseCommits, CHURN_WINDOW, type Commit } from "./evolution.ts";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const pad = (s: unknown, n: number) => String(s).padEnd(n);

// ── HEAT: where the map is being worked ───────────────────────────────────────────────
//
// A tier grade says how well a crossing is DEFENDED; it says nothing about whether anyone
// has been near it lately. Heat is the other axis: the share of recent concern-carrying
// commits that touched the file defining this chokepoint. A tier-3 convention crossing in
// code nobody has opened in a year and a tier-3 crossing in the file half the repo's
// commits touch are the same grade and completely different risks.
//
// HEAT IS A TEMPERATURE, NOT A CORRECTNESS FACT, and it therefore grades NOTHING: it is
// absent from `--check` entirely (drift/dangling/over-claim are the only verdicts), it is
// absent from the scene's visuals, and a crossing whose heat cannot be measured renders
// `—`. See the `--check` block at the bottom of this file.

const BARS = "▁▂▃▄▅▆▇█";

/**
 * Per-chokepoint HEAT — for each symbol, the MAX over its defining files of that file's
 * churn share (touches / commits considered), using the shared EVOLUTION store's
 * `fileChurn` (same 2…BULK concern filter every other derivation applies).
 *
 * MAX, NOT SUM OR MEAN. A symbol can resolve to more than one file (an overload, a re-export,
 * the same name defined in two places). Summing would let a cold twin inflate a hot one past
 * 100% of a share it never had; averaging would let a cold twin HIDE a genuinely hot
 * definition, which is the failure that matters — the question heat answers is "is anyone
 * working near this chokepoint", and one hot definition is a yes whatever the others say.
 *
 * ABSENCE IS NOT ZERO. A symbol with no node in the graph, and an empty history (nothing
 * survived the concern filter), yield NO ENTRY — the caller renders `—`. A symbol that IS in
 * the graph over a real history and was simply never touched yields 0, which is a measurement.
 */
export function crossingHeat(graph: Graph, syms: string[], commits: Commit[]): Map<string, number> {
  const out = new Map<string, number>();
  const { byFile, considered } = fileChurn(commits);
  if (!considered) return out;
  const paths = new Map<string, string[]>();
  for (const n of graph.nodes)
    if (n.kind === "symbol" && n.path) paths.set(n.label, [...(paths.get(n.label) ?? []), n.path]);
  for (const sym of syms) {
    const ps = paths.get(sym);
    if (!ps || !ps.length) continue;
    out.set(sym, Math.max(...ps.map((p) => (byFile.get(p) ?? 0) / considered)));
  }
  return out;
}

/** One crossing's heat as a bar + the raw share, normalized against the HOTTEST crossing in
 *  this render so the bar reads as a comparison between crossings rather than against an
 *  arbitrary absolute. `—` when the crossing has no reading at all. */
export function heatCell(heat: number | undefined, max: number): string {
  if (heat === undefined) return "—";
  const i = max > 0 ? Math.round((heat / max) * (BARS.length - 1)) : 0;
  return `${BARS[i]} ${Math.round(heat * 100)}%`;
}

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

  // Heat, computed ONCE for every symbol the atlas could ask about — the crossing itself and
  // the `anchoredBy` symbol a crossing cites when the crossing's own name has no graph node
  // (the same fallback `tierOf` already uses for the boundary claim). One git read, one pass.
  const heatSyms = [...Object.keys(transitions), ...Object.values(transitions).map((d) => d.anchoredBy).filter(Boolean) as string[]];
  // git speaks repo-root-relative paths; the graph speaks cfg.root-relative ones. Rebase
  // BEFORE measuring, or a subdirectory-rooted project reads a measured 0% on every
  // crossing — a wrong number, where the design wants either a true share or absence.
  const heatOf = crossingHeat(graph, heatSyms, rebaseCommits(readCommitLog(cfg, CHURN_WINDOW), gitPrefix(cfg)));

  const edges = Object.entries(transitions).map(([sym, def]) => ({
    sym, ...def, ...tierOf(sym, def), present: symbolExists(sym), pending: knownPending.has(sym),
    // undefined (never 0) when neither the crossing nor its anchor resolves to a graph symbol,
    // or when history carries nothing to measure against.
    heat: heatOf.get(sym) ?? (def.anchoredBy ? heatOf.get(def.anchoredBy) : undefined),
  }));
  // The normalizer for the bar glyphs: the hottest crossing on this map.
  const maxHeat = edges.reduce((m, e) => (e.heat !== undefined && e.heat > m ? e.heat : m), 0);
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
      out.push(`    ${pad(`${e.from} → ${e.to}`, 38)} [tier-${e.tier}] ${pad(e.sym, 24)} ${pad(`heat ${heatCell(e.heat, maxHeat)}`, 12)}${flags}`);
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
    "`heat` is the share of recent commits that touched the file defining the chokepoint — where",
    "the map is being worked. It is a temperature, not a grade: it never affects `atlas --check`,",
    "and `—` means unmeasurable (no such symbol in the graph, or no history), never cold.", "",
    "| tier | from → to | chokepoint | oracle | re-establishes | heat |", "| --- | --- | --- | --- | --- | --- |");
  for (const tier of [1, 2, 3])
    for (const e of edges.filter((x) => x.tier === tier).sort((x, y) => x.sym.localeCompare(y.sym))) {
      const mark = e.present ? "" : (e.pending ? " _(pending)_" : " _(DANGLING)_");
      L.push(`| tier-${e.tier} | \`${e.from}\` → \`${e.to}\` | \`${e.sym}\`${mark} | ${e.note} | ${e.translates} | ${heatCell(e.heat, maxHeat)} |`);
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

  // File the tier grades into the status record (best-effort — never fails the run).
  try {
    await recordAtlas(cfg, {
      tiers: { enshrined: counts[0], checked: counts[1], convention: counts[2] },
      // `heat` is the RAW share (0..1), never the rendered bar: the record stores the
      // measurement and leaves normalization to whoever draws it (the panel normalizes over
      // its own top-N, this render over the whole map).
      crossings: edges.map((e) => ({ sym: e.sym, from: e.from, to: e.to, tier: e.tier, security: !!e.security, note: e.note, translates: e.translates, present: e.present, pending: e.pending, heat: e.heat })),
      drift,
      dangling: dangling.map((e) => e.sym),
      overclaimed: overclaimed.map((e) => e.sym),
      tier3Security: tier3sec.map((e) => e.sym),
    });
  } catch { /* record is best-effort */ }

  if (mode === "check") {
    // HEAT IS ABSENT FROM THIS VERDICT, ON PURPOSE. `--check` fails on drift, dangling edges
    // and over-claim — three statements about whether the map matches the territory. Heat is
    // a temperature: a hot crossing is not wrong, a cold one is not right, and an unmeasurable
    // one is not a defect. Grading on it would make a run's verdict depend on how recently
    // somebody committed, which is the definition of a check nobody can act on.
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
