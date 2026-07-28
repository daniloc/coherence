// contracts.ts — producer/consumer contracts across deploy artifacts.
//
// The principle (cross-artifact totality): an invariant that SPANS deploy artifacts — a
// typed message emitted in one compile/deploy unit and consumed in another (a Worker's
// SSE frames rendered by a browser bundle) — is exactly what NO single compiler run can
// check. The two sides typecheck separately and drift silently; only the whole-source
// graph sees both. So a cross-artifact data contract is the canonical MUST-DECLARE case,
// and this subcommand supplies both halves of the pressure:
//
//   DECLARED contracts (cfg.contracts) — a typed message with a producer chokepoint, a
//   consumer chokepoint, and a shared vocabulary symbol. Analogous to the atlas's
//   transitions: project data, harness mechanism. Each is resolved against the graph
//   (DANGLING if a symbol is gone), located in the declared artifacts (cfg.artifacts,
//   path globs per deploy unit), and graded ANCHORED iff some boundary or parity claim
//   names its producer, consumer, or type symbol. An UNANCHORED declared contract fails
//   `--check` — declaring the seam without anchoring what must hold across it is the
//   half-shape the ratchet refuses.
//
//   The DETECTOR — from the graph's import edges: any file whose importers span
//   DISJOINT artifact sets is shared vocabulary between deploy units. Each such file
//   should be covered by a declared contract or an anchored claim on one of its
//   symbols; uncovered files are flagged (advisory — the loud gap list #1's novelty
//   advisory drives you to declare, not yet a hard gate).
import type { Config, Graph } from "./types.ts";
import { formatBoundaryInvariant } from "./boundary.ts";
import { globToRe } from "./decompose.ts";
import { allBoundaries } from "./structural.ts";
import { parseParity } from "./parity.ts";

const pad = (s: unknown, n: number) => String(s).padEnd(n);

interface ContractRow {
  name: string;
  producer: string; consumer: string; type: string;
  description?: string;
  missing: string[];                    // declared symbols absent from the graph (dangling)
  producerArts: string[]; consumerArts: string[];
  cross: boolean | null;                // null = artifacts not configured / not resolvable
  anchoredBy: string[];                 // claims naming producer/consumer/type
}

export async function contracts(cfg: Config, graph: Graph, mode: "render" | "check"): Promise<number> {
  const decl = cfg.contracts ?? {};
  const artDefs = Object.entries(cfg.artifacts ?? {}).map(([name, globs]) => ({ name, res: globs.map(globToRe) }));
  if (!Object.keys(decl).length && !artDefs.length) {
    console.log("\n  contracts: no `contracts` / `artifacts` config — nothing to check.\n");
    return 0;
  }

  // symbol label → the files defining it (a label can repeat across files, e.g. methods)
  const symFiles = new Map<string, string[]>();
  for (const n of graph.nodes)
    if (n.kind === "symbol" && n.path) { const a = symFiles.get(n.label) ?? []; a.push(n.path); symFiles.set(n.label, a); }

  const artifactsOf = (path: string): string[] => artDefs.filter((a) => a.res.some((re) => re.test(path))).map((a) => a.name);
  const artsOfSymbol = (label: string): string[] =>
    [...new Set((symFiles.get(label) ?? []).flatMap(artifactsOf))];

  // ── anchoring evidence: every boundary chokepoint + every parity claim's symbols ──
  const boundaryAt = allBoundaries(graph); // chokepoint → claim
  const parityClaims: Array<{ comp: string; domain: string; f: string; g: string; inv: string }> = [];
  for (const n of graph.nodes)
    if (n.kind === "component")
      for (const c of n.claims ?? []) { const p = parseParity(c); if (p) parityClaims.push({ comp: n.label, ...p }); }
  const anchorsOf = (labels: string[]): string[] => {
    const out: string[] = [];
    for (const l of labels) {
      const b = boundaryAt.get(l);
      if (b) out.push(`boundary ${formatBoundaryInvariant(b)} at ${l} (${b.component})`);
      for (const p of parityClaims)
        if (p.f === l || p.g === l || p.domain === l) out.push(`parity "${p.inv}" over ${p.domain} (${p.comp})`);
    }
    return [...new Set(out)];
  };

  const rows: ContractRow[] = Object.entries(decl).map(([name, d]) => {
    const missing = [d.producer, d.consumer, d.type].filter((s) => !symFiles.has(s));
    const producerArts = artsOfSymbol(d.producer);
    const consumerArts = artsOfSymbol(d.consumer);
    const cross = !artDefs.length || !producerArts.length || !consumerArts.length
      ? null
      : producerArts.every((a) => !consumerArts.includes(a));
    return { name, ...d, missing, producerArts, consumerArts, cross, anchoredBy: anchorsOf([d.producer, d.consumer, d.type]) };
  });

  // ── the detector: files whose importers span disjoint artifact sets ──
  const fileArts = new Map<string, string[]>(); // file path → artifacts
  for (const n of graph.nodes) if (n.kind === "file" && n.path) fileArts.set(n.path, artifactsOf(n.path));
  const importersOf = new Map<string, Set<string>>(); // target file → importer files
  for (const e of graph.edges) {
    if (e.kind !== "imports" || !e.source.startsWith("f:") || !e.target.startsWith("f:")) continue;
    const t = e.target.slice(2), s = e.source.slice(2);
    (importersOf.get(t) ?? importersOf.set(t, new Set()).get(t)!).add(s);
  }
  // symbols per file (a shared file with no symbols is not vocabulary — skip it)
  const fileHasSymbols = new Set<string>();
  for (const n of graph.nodes) if (n.kind === "symbol" && n.path) fileHasSymbols.add(n.path);
  // files already covered: a declared contract symbol lives there, or an anchored claim's
  // symbol (boundary chokepoint / parity domain/f/g) does.
  const coveredFiles = new Set<string>();
  const coverSymbol = (label: string) => { for (const f of symFiles.get(label) ?? []) coveredFiles.add(f); };
  for (const r of rows) for (const s of [r.producer, r.consumer, r.type]) coverSymbol(s);
  for (const sym of boundaryAt.keys()) coverSymbol(sym);
  for (const p of parityClaims) for (const s of [p.domain, p.f, p.g]) coverSymbol(s);

  const shared: Array<{ file: string; spans: string[] }> = [];
  if (artDefs.length) {
    for (const [file, importers] of importersOf) {
      if (!fileHasSymbols.has(file)) continue;
      const artSets = [...importers].map((f) => fileArts.get(f) ?? []).filter((a) => a.length);
      // two importers whose artifact sets are DISJOINT → the file is cross-unit vocabulary
      let cross = false;
      const spans = new Set<string>();
      for (let i = 0; i < artSets.length && !cross; i++)
        for (let j = i + 1; j < artSets.length; j++)
          if (artSets[i].every((a) => !artSets[j].includes(a))) {
            cross = true;
            for (const a of [...artSets[i], ...artSets[j]]) spans.add(a);
            break;
          }
      if (cross && !coveredFiles.has(file)) shared.push({ file, spans: [...spans].sort() });
    }
    shared.sort((a, b) => a.file.localeCompare(b.file));
  }

  // ── render ──
  const out: string[] = ["\n  CONTRACTS — typed messages crossing deploy artifacts\n"];
  if (artDefs.length) {
    out.push("  ARTIFACTS (deploy units):");
    for (const [name, globs] of Object.entries(cfg.artifacts ?? {})) out.push(`    ${pad(name, 14)} ${globs.join(", ")}`);
    out.push("");
  }
  const dangling = rows.filter((r) => r.missing.length);
  const unanchored = rows.filter((r) => !r.missing.length && !r.anchoredBy.length);
  if (rows.length) {
    out.push("  DECLARED contracts:");
    for (const r of rows) {
      const crossNote = r.cross === null ? "" : r.cross ? "  [CROSS-ARTIFACT]" : "  [same artifact]";
      out.push(`    ${pad(r.name, 18)} ${r.producer} → ${r.consumer}  (type ${r.type})${crossNote}`);
      if (r.description) out.push(`      ${pad("", 18)} ${r.description}`);
      if (r.producerArts.length || r.consumerArts.length)
        out.push(`      ${pad("", 18)} producer in [${r.producerArts.join(", ") || "?"}] · consumer in [${r.consumerArts.join(", ") || "?"}]`);
      if (r.missing.length) out.push(`      ${pad("", 18)} ✗ DANGLING — not in the code graph: ${r.missing.join(", ")}`);
      else if (r.anchoredBy.length) for (const a of r.anchoredBy) out.push(`      ${pad("", 18)} ✓ anchored by ${a}`);
      else out.push(`      ${pad("", 18)} ✗ UNANCHORED — no boundary/parity claim names ${r.producer}, ${r.consumer}, or ${r.type}`);
    }
    out.push("");
  }
  out.push("  ── flags ──");
  if (dangling.length) out.push(`  ✗ DANGLING — ${dangling.length} contract(s) name symbols missing from the graph.`);
  else if (rows.length) out.push("  ✓ every declared contract's symbols resolve in the code graph.");
  if (unanchored.length) {
    out.push(`  ✗ UNANCHORED — ${unanchored.length} declared contract(s) with no boundary/parity claim on producer, consumer, or type:`);
    for (const r of unanchored) out.push(`      ${r.name} (anchor a parity claim over its vocabulary, or a boundary at a chokepoint)`);
  } else if (rows.length) out.push("  ✓ every declared contract is anchored by a boundary or parity claim.");
  if (artDefs.length) {
    if (shared.length) {
      out.push(`  ◀ ADVISORY — ${shared.length} cross-artifact shared file(s) with NO declared contract or anchored claim:`);
      for (const s of shared) out.push(`      ${pad(s.file, 36)} imported from disjoint units [${s.spans.join(" | ")}] — vocabulary two deploy units must agree on; declare a contract or anchor a claim on one of its symbols`);
    } else out.push("  ✓ every cross-artifact shared file is covered by a declared contract or an anchored claim.");
  }
  console.log(out.join("\n") + "\n");

  if (mode === "check" && (dangling.length || unanchored.length)) {
    console.error("  ✗ contracts --check FAILED — " +
      [dangling.length && `${dangling.length} dangling`, unanchored.length && `${unanchored.length} unanchored`].filter(Boolean).join(" · "));
    return 1;
  }
  if (mode === "check") console.log("  ✓ contracts --check held — declared contracts resolve and are anchored.\n");
  return 0;
}
