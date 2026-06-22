// conventions.ts — the convention-vs-contract detector + growth ratchet (was mnemion's
// conventions.mjs). A CONVENTION is a load-bearing GUARD reached at N>1 call sites with
// no enforcing contract — a block-list that fails open the moment one site forgets. A
// CONTRACT enforces it structurally: an anchored boundary (chokepoint + oracle) or a
// totality-named test. This surfaces guards (a verb lexicon + a project seed), counts
// fan-out, classifies against the contracts the harness ALREADY parsed (boundary claims
// from the graph; totality tests in the test dir), and ratchets the unguarded set.
import type { Config, Graph } from "./types.ts";
import { scanSources, readBaseline, writeBaseline } from "./sidecar.ts";
import { allBoundaries } from "./structural.ts";

const DEFAULT_GUARD_VERB =
  "^(is|has|can|should|assert|verify|check|validate|ensure|require|deny|refuse|reject|gate|seal|sanitiz|escape|guard|enforce|redact|mint|scope)";
const DECL =
  /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_]\w*)\s*\(|(?:export\s+)?const\s+([a-zA-Z_]\w*)\s*=\s*(?:async\s*)?\(/g;
const BASELINE = "conventions-baseline.json";

export async function conventions(cfg: Config, graph: Graph, mode: "report" | "check" | "update"): Promise<number> {
  const guardVerb = new RegExp(cfg.conventions?.guardVerb ?? DEFAULT_GUARD_VERB);
  const seed = new Set(cfg.conventions?.seed ?? []);
  const dismissed = cfg.conventions?.dismissed ?? {};
  const { src, test } = await scanSources(cfg);

  // 1. Candidate guards from source declarations (verb lexicon ∪ project seed).
  const guards = new Map<string, string>(); // name -> defFile
  for (const { rel, text } of src)
    for (const m of text.matchAll(DECL)) {
      const name = m[1] || m[2];
      if (name && (guardVerb.test(name) || seed.has(name)) && !guards.has(name)) guards.set(name, rel);
    }

  // 2. Call-site fan-out (across source, excluding each guard's own declaration).
  const callSites = (name: string): number => {
    const call = new RegExp(`\\b${name}\\s*\\(`, "g");
    const decl = new RegExp(`function\\s+${name}\\s*\\(`, "g");
    let n = 0;
    for (const { text } of src) n += (text.match(call)?.length ?? 0) - (text.match(decl)?.length ?? 0);
    return n;
  };

  // 3. Contracts the harness already holds: boundary-claim chokepoint symbols (parsed
  //    from the graph, NOT re-grepped from the spec tree) + totality-named tests.
  const anchored = new Set([...allBoundaries(graph).keys()]);
  const totalityTests = test.filter(({ text }) => /(?:describe|it)\s*\(\s*["'`][^"'`]*totality/i.test(text));
  const hasOracle = (name: string) => { const re = new RegExp(`\\b${name}\\b`); return totalityTests.some(({ text }) => re.test(text)); };

  // 4. Classify.
  interface Row { name: string; sites: number; status: string; reason: string; def: string }
  const rows: Row[] = [];
  for (const [name, def] of guards) {
    const sites = callSites(name);
    if (sites < 1) continue;
    let status: string, reason = "";
    if (dismissed[name]) { status = "dismissed"; reason = dismissed[name]; }
    else if (anchored.has(name)) status = "ANCHORED";
    else if (hasOracle(name)) status = "ORACLE";
    else if (sites <= 1) status = "single";
    else status = "CONVENTION";
    rows.push({ name, sites, status, reason, def });
  }
  rows.sort((a, b) => b.sites - a.sites);
  const flagged = rows.filter((r) => r.status === "CONVENTION");

  if (mode === "update") {
    const base = flagged.map((c) => ({ name: c.name, sites: c.sites })).sort((a, b) => a.name.localeCompare(b.name));
    const p = await writeBaseline(cfg, BASELINE, base);
    console.log(`Pinned ${base.length} known convention(s) to ${p}`);
    return 0;
  }

  const pad = (s: unknown, n: number) => String(s).padEnd(n);
  console.log("\n  CONVENTION DETECTOR — load-bearing guards vs the contracts that enforce them\n");
  console.log(`  ${pad("guard", 26)} ${pad("call-sites", 11)} status`);
  console.log(`  ${"-".repeat(26)} ${"-".repeat(11)} ${"-".repeat(12)}`);
  for (const r of rows) {
    const flag = r.status === "CONVENTION" ? "  ◀ CONVENTION (no contract)"
      : r.status === "ANCHORED" ? "  ✓ boundary"
      : r.status === "ORACLE" ? "  ✓ totality test"
      : r.status === "dismissed" ? `  — dismissed: ${r.reason}` : "";
    console.log(`  ${pad(r.name, 26)} ${pad(r.sites, 11)} ${pad(r.status, 12)}${flag}`);
  }
  console.log(`\n  ${flagged.length} candidate convention(s) — guards with fan-out and no contract.  (anchored boundaries: ${anchored.size})`);

  if (mode !== "check") return 0;
  const base = await readBaseline<{ name: string; sites: number }[]>(cfg, BASELINE);
  if (!base) { console.error("\n  --check: no baseline. Run with --update-baseline first."); return 2; }
  const baseMap = new Map(base.map((b) => [b.name, b.sites]));
  const regressions: string[] = [];
  for (const c of flagged) {
    if (!baseMap.has(c.name)) regressions.push(`NEW convention: ${c.name} (${c.sites} sites)`);
    else if (c.sites > baseMap.get(c.name)!) regressions.push(`${c.name} fan-out grew ${baseMap.get(c.name)}→${c.sites} without a contract`);
  }
  if (regressions.length) {
    console.error(`\n  ✗ convention ratchet FAILED — the surface grew:\n${regressions.map((r) => "    - " + r).join("\n")}`);
    console.error("  Convert it to a contract, or (if intentional) re-pin with --update-baseline.\n");
    return 1;
  }
  console.log("\n  ✓ convention ratchet held — no new conventions.");
  if (base.length) {
    console.log(`\n  Baselined debt: ${base.length} convention(s) tolerated (toward zero):`);
    for (const b of [...base].sort((a, z) => z.sites - a.sites)) {
      const live = flagged.find((c) => c.name === b.name);
      console.log(`    - ${b.name} (${b.sites} sites)${live ? "" : "  — gone from code; drop from baseline"}`);
    }
  }
  console.log("");
  return 0;
}
