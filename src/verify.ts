// verify.ts — the coherence engine: deterministic claim verifiers + the narrative
// evidence chain (emits inference jobs for a subagent) + coverage meta-claims
// (what auto-generates, why is human-authored). Config-driven; consumes the Graph.
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Config, Graph } from "./types.ts";
import { analyzeOracle } from "./oracle-domain.ts";
import { ownerOf } from "./walk.ts";

const hashOf = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const exists = async (p: string) => { try { await stat(p); return true; } catch { return false; } };
const jobsPath = (cfg: Config) => join(cfg.root, ".coherence", "verify-jobs.json");
const narrPath = (cfg: Config) => join(cfg.root, "narrative.json");

async function evidence(root: string, addrs: string[]) {
  const parts: string[] = [], missing: string[] = [];
  for (const a of addrs) if (a.startsWith("file:")) { const p = a.slice(5); try { parts.push(`--- ${p} ---\n${(await readFile(join(root, p), "utf8")).slice(0, 6000)}`); } catch { missing.push(a); } }
  return { text: parts.join("\n\n"), missing };
}

/** record subagent verdicts (the mechanical notary; judge ≠ notary, axiom #5). */
export async function applyVerdicts(cfg: Config, verdictsPath: string): Promise<number> {
  const verdicts = JSON.parse(await readFile(verdictsPath, "utf8")) as Array<{ id: string; supported: boolean; reason: string; corrected?: string | null }>;
  const jobs = JSON.parse(await readFile(jobsPath(cfg), "utf8")) as Array<{ id: string; currentHash: string }>;
  const narr = JSON.parse(await readFile(narrPath(cfg), "utf8")) as { statements: any[] };
  let ok = 0, drift = 0;
  for (const v of verdicts) {
    const st = narr.statements.find((s) => s.id === v.id); const job = jobs.find((j) => j.id === v.id);
    if (!st || !job) continue;
    if (v.supported) { st.verifiedHash = job.currentHash; st.status = "ok"; delete st.drift; delete st.suggested; ok++; }
    else { st.status = "drifted"; st.drift = v.reason; if (v.corrected) st.suggested = v.corrected; drift++; }
  }
  await writeFile(narrPath(cfg), JSON.stringify(narr, null, 2) + "\n");
  console.log(`applied ${verdicts.length} verdict(s): ${ok} confirmed · ${drift} drifted`);
  for (const s of narr.statements) if (s.status === "drifted") console.log(`  ✗ [${s.id}] DRIFT — ${s.drift}`);
  return drift === 0 ? 0 : 1;
}

export async function runVerify(cfg: Config, graph: Graph, opts: { fast?: boolean; only?: Set<string> }): Promise<number> {
  const root = cfg.root;
  // Invariants ANCHORED by a `boundary "<name>" ...` claim, per component label. The
  // coverage gate fails any `## invariants` entry that nothing anchors (the ratchet).
  const anchored = new Map<string, Set<string>>();
  let tc: { pass: boolean; detail: string } | null = null;
  const typecheck = () => {
    if (tc) return tc;
    const r = spawnSync(cfg.typecheck[0], cfg.typecheck.slice(1), { cwd: root, encoding: "utf8", timeout: 120000 });
    const tail = ((r.stderr || "") + (r.stdout || "")).split("\n").filter(Boolean).slice(-3).join(" | ");
    tc = r.status === 0 ? { pass: true, detail: "" } : { pass: false, detail: tail.slice(0, 200) };
    return tc;
  };
  type Sig = { kind: "pass" | "fail" | "skip"; claim: string; node: string; detail?: string };
  const evalClaim = async (claim: string, nodeDir: string, node: string): Promise<Sig> => {
    const mk = (kind: Sig["kind"], detail?: string): Sig => ({ kind, claim, node, detail });
    let m: RegExpExecArray | null;
    if (/^typechecks$/.test(claim)) { const t = typecheck(); return mk(t.pass ? "pass" : "fail", t.detail); }
    if ((m = /^(\S+)\s+exists at\s+(root|this node|every node)$/.exec(claim))) { const base = m[2] === "root" ? root : nodeDir; return mk((await exists(join(base, m[1]))) ? "pass" : "fail", `${m[1]} @ ${m[2]}`); }
    if ((m = /^(\S+)\s+imports\s+(\S+)$/.exec(claim))) { try { const src = await readFile(join(nodeDir, m[1]), "utf8"); const re = new RegExp(`from\\s+["']${m[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`); return mk(re.test(src) ? "pass" : "fail", re.test(src) ? "" : `no import of ${m[2]}`); } catch { return mk("fail", `cannot read ${m[1]}`); } }
    if ((m = /^(\S+)\s+responds\s+(\d+)(?:\s+with\s+"(.*)")?$/.exec(claim))) { if (opts.fast) return mk("skip", "live tier (--fast)"); try { const res = await fetch(m[1]); if (res.status !== Number(m[2])) return mk("fail", `got ${res.status}`); if (m[3]) { const bdy = await res.text(); if (!bdy.includes(m[3])) return mk("fail", `body missing "${m[3]}"`); } return mk("pass"); } catch { return mk("skip", "unreachable"); } }
    // executable tier: delegate an invariant to an existing test. The spec's `works
    // when` becomes the single front door — coherence runs the test the claim names.
    // Slow (shells the runner), so it joins the live tier skipped under --fast.
    if ((m = /^passes test\s+"(.+)"$/.exec(claim))) {
      if (opts.fast) return mk("skip", "executable tier (--fast)");
      if (!cfg.test || !cfg.test.length) return mk("skip", "no test runner configured (config.test)");
      const r = spawnSync(cfg.test[0], [...cfg.test.slice(1), m[1]], { cwd: root, encoding: "utf8", timeout: 120000 });
      const out = (r.stderr || "") + (r.stdout || "");
      const tail = out.split("\n").filter(Boolean).slice(-3).join(" | ");
      // exit 0 alone is not trusted: a runner that matched zero tests (renamed/deleted)
      // can still exit 0. testMatch requires positive evidence the named test actually ran.
      if (r.status !== 0) return mk("fail", tail.slice(0, 200));
      if (cfg.testMatch && !new RegExp(cfg.testMatch).test(out)) return mk("fail", `test "${m[1]}" matched no run (testMatch)`);
      return mk("pass");
    }
    // BOUNDARY tier — the anti-entropy ratchet. `boundary "<invariant>" at <chokepoint>
    // [via (test|guard) "<oracle>"]` asserts the four-part anatomy of a self-enforcing
    // boundary: the invariant is named, the chokepoint SYMBOL exists, and (if given) the
    // oracle passes. It ANCHORS the named invariant so the coverage gate can fail any
    // `## invariants` entry with no boundary claim. This is what makes "one chokepoint +
    // totality oracle" a checkable PROPERTY, not a prose checklist.
    //   via test  — a DOMAIN-totality oracle: it must iterate a LIVE domain (the META-ORACLE
    //               in oracle-domain.ts checks this — a literal/source-grep oracle FAILS).
    //   via guard — a SOURCE-PROPERTY oracle (e.g. "no trusted factory exists anywhere"),
    //               which can't be a domain loop; exempt from the live-domain requirement.
    if ((m = /^boundary\s+"([^"]+)"\s+at\s+(\S+)(?:\s+via (test|guard)\s+"([^"]+)")?$/.exec(claim))) {
      const inv = m[1], sym = m[2], verb = m[3], test = m[4];
      let set = anchored.get(node); if (!set) { set = new Set(); anchored.set(node, set); } set.add(inv);
      if (!graph.nodes.some((n) => n.kind === "symbol" && n.label === sym)) return mk("fail", `chokepoint symbol "${sym}" not found in the code graph`);
      if (!test) return mk("pass", `${inv} @ ${sym} (no oracle)`);
      // META-ORACLE — the third assertion. A `via test` oracle MUST iterate a LIVE domain
      // (an imported registry/SSOT, a call/query result, the anchor itself) — not an array/
      // regex literal, a same-file const array (a sampling oracle wearing the totality
      // label), nor "no domain iteration at all" (a pure source-grep / hand-enumerated
      // cases). Cheap AST analysis (no runner) so it runs even under --fast. The `via guard`
      // verb is the deliberate escape hatch for a legitimate source-PROPERTY oracle ("no
      // trusted factory exists anywhere"), which cannot be expressed as domain iteration —
      // `via guard` skips the live-domain requirement (the runner still has to pass).
      if (verb === "test" && cfg.oracleDomain !== false) {
        const a = await analyzeOracle(cfg, test);
        if (a.verdict === "literal")
          return mk("fail", `[oracle] "${test}" iterates a LITERAL domain (${a.detail}) — a sampling oracle, not totality. Derive its domain from the live SSOT behind \`${sym}\` (or, if it is a source-property guard, declare it \`via guard\` not \`via test\`).`);
        if (a.verdict === "no-iteration")
          return mk("fail", `[oracle] "${test}" performs NO domain iteration (${a.detail}) — a source-grep / hand-enumerated cases, not totality. Loop the live domain behind \`${sym}\`, or — if it is a genuine source-property guard — declare it \`via guard "${test}"\` instead of \`via test\`.`);
        // NOT-FOUND must fail, not fall through: the test RUNNER matches names as a
        // substring/regex, so a claim anchored to an it() title (or a typo'd describe)
        // still passes the runner while silently opting out of domain analysis — the
        // exact muting that lets a hand-list regression ship green. `via test` means
        // "analyzable totality"; if the describe can't be located, the claim is
        // unverifiable as declared.
        if (a.verdict === "not-found")
          return mk("fail", `[oracle] "${test}" — no describe() with this EXACT title found, so the meta-oracle cannot analyze its domain (the runner alone would still pass on an it()-name match, silently skipping analysis). Anchor the claim to the oracle's exact describe title, or declare it \`passes test\`/\`via guard\` if it is not a domain totality.`);
      }
      if (opts.fast) return mk("skip", "boundary oracle (--fast)");
      if (!cfg.test || !cfg.test.length) return mk("skip", "no test runner configured (config.test)");
      const r = spawnSync(cfg.test[0], [...cfg.test.slice(1), test], { cwd: root, encoding: "utf8", timeout: 120000 });
      const out = (r.stderr || "") + (r.stdout || "");
      if (r.status !== 0) return mk("fail", out.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 200));
      if (cfg.testMatch && !new RegExp(cfg.testMatch).test(out)) return mk("fail", `oracle "${test}" matched no run (testMatch)`);
      return mk("pass", `${inv} @ ${sym}${verb === "guard" ? " (source-property guard)" : ""}`);
    }
    return mk("skip", "no verifier (dialect gap)");
  };

  // `only` (verify --staged/--since) scopes the run to the components whose dirs
  // changed — the edit-loop affordance. The boundary-anchoring + coverage gates below
  // then cover exactly the touched components, so a fast scoped check still fails on a
  // touched-but-broken invariant. Symbol resolution for boundary claims stays GLOBAL
  // (a touched chokepoint's oracle may name a symbol defined elsewhere).
  const comps = graph.nodes.filter((n) => n.kind === "component" && (!opts.only || opts.only.has(n.id.slice(2))));
  const compDirs = graph.nodes.filter((n) => n.kind === "component").map((n) => n.id.slice(2));
  // Scope the (advisory) symbol-doc coverage to the touched components too, so a
  // staged run doesn't dump every undocumented symbol in the repo as a job.
  const symbols = graph.nodes.filter((n) => n.kind === "symbol" && (!opts.only || (n.path != null && opts.only.has(ownerOf(n.path, compDirs)))));
  const sigs: Sig[] = [];
  for (const c of comps) { const dir = c.id.slice(2); const diskDir = dir === "." ? root : join(root, dir); for (const cl of c.claims || []) sigs.push(await evalClaim(cl, diskDir, c.label)); }
  const red = sigs.filter((s) => s.kind === "fail").length;
  console.log(`claims: ${sigs.length} · ${sigs.filter((s) => s.kind === "pass").length} green · ${red} red · ${sigs.filter((s) => s.kind === "skip").length} skipped`);
  for (const s of sigs) if (s.kind !== "pass") console.log(`  ${s.kind === "fail" ? "✗" : "·"} [${s.node}] ${s.claim}${s.detail ? ` — ${s.detail}` : ""}`);

  const jobs: Array<Record<string, any>> = [];
  let narr: { statements: any[] } | null = null;
  try { narr = JSON.parse(await readFile(narrPath(cfg), "utf8")); } catch { /* none */ }
  let broken = 0;
  if (narr?.statements) {
    let unchanged = 0, pending = 0;
    for (const st of narr.statements) {
      const { text, missing } = await evidence(root, st.evidence);
      if (missing.length) { broken++; st.status = "broken"; console.log(`  ✗ [narrative ${st.id}] broken evidence: ${missing.join(", ")}`); continue; }
      const h = hashOf(text);
      if (h === st.verifiedHash) { unchanged++; st.status = "ok"; continue; }
      st.status = "pending"; pending++;
      jobs.push({ kind: "verify-statement", id: st.id, statement: st.statement, evidenceFiles: st.evidence.filter((e: string) => e.startsWith("file:")).map((e: string) => e.slice(5)), currentHash: h });
    }
    await writeFile(narrPath(cfg), JSON.stringify(narr, null, 2) + "\n");
    console.log(`narrative: ${narr.statements.length} statements · ${unchanged} unchanged · ${pending} need verification · ${broken} broken`);
  }

  // Coverage gates NODE-CONTRACT completeness (does each node carry claims + a why),
  // NOT symbol-doc exhaustiveness. Per-symbol prose is advisory: forcing a docblock on
  // every export produces stale busywork and a perpetually-red baseline that trains
  // contributors to ignore the gate. Undocumented symbols still surface as jobs.
  const compGaps = comps.filter((c) => !(c.claims && c.claims.length));
  const docGaps = symbols.filter((s) => !s.prose || !String(s.prose).trim());
  const whyGaps = comps.filter((c) => !c.why || !String(c.why).trim());
  console.log(`coverage: components ${comps.length - compGaps.length}/${comps.length} claimed, ${comps.length - whyGaps.length}/${comps.length} with why · symbols ${symbols.length - docGaps.length}/${symbols.length} documented (advisory)`);
  for (const c of compGaps) { console.log(`  ✗ [coverage] component "${c.label}" has no claims`); jobs.push({ kind: "generate-claims", id: c.id, name: c.label }); }
  for (const c of whyGaps) { console.log(`  ✗ [coverage] component "${c.label}" states no rationale (why)`); jobs.push({ kind: "author-why", id: c.id, name: c.label }); }
  // advisory only — emitted as jobs, never gated
  for (const s of docGaps) jobs.push({ kind: "generate-doc", id: s.id, file: s.path, line: s.line, name: s.label });
  if (docGaps.length) console.log(`  · [advisory] ${docGaps.length} symbol(s) undocumented (not gated)`);
  // RATCHET coverage: a named invariant with no `boundary` claim is a property the spec
  // asserts but nothing enforces/anchors — fail it, the way a boundary shipped without
  // its totality oracle should fail loud rather than rot silently.
  const invGaps: { comp: string; inv: string }[] = [];
  for (const c of comps) for (const inv of c.invariants ?? []) if (!anchored.get(c.label)?.has(inv)) invGaps.push({ comp: c.label, inv });
  for (const g of invGaps) { console.log(`  ✗ [coverage] invariant "${g.inv}" (${g.comp}) is not anchored by a boundary claim`); jobs.push({ kind: "anchor-invariant", comp: g.comp, inv: g.inv }); }
  const totalInv = comps.reduce((n, c) => n + (c.invariants?.length ?? 0), 0);
  if (totalInv) console.log(`invariants: ${totalInv - invGaps.length}/${totalInv} anchored by a boundary claim`);
  const covGaps = compGaps.length + whyGaps.length + invGaps.length;

  const verifyJobs = jobs.filter((j) => j.kind === "verify-statement");
  const genJobs = jobs.filter((j) => j.kind === "generate-doc" || j.kind === "generate-claims");
  const authorJobs = jobs.filter((j) => j.kind === "author-why");
  if (jobs.length) {
    await mkdir(join(root, ".coherence"), { recursive: true });
    await writeFile(jobsPath(cfg), JSON.stringify(jobs, null, 2) + "\n");
    console.log(`\n=== JOBS — ${jobs.length} (dispatch a subagent) · .coherence/verify-jobs.json ===`);
    if (verifyJobs.length) { console.log(`\n VERIFY (evidence changed — judge if the statement still holds):`); console.log(`   → write .coherence/verify-verdicts.json, then re-run with --apply .coherence/verify-verdicts.json`); for (const j of verifyJobs) console.log(`   [${j.id}] "${j.statement}"`); }
    if (genJobs.length) { console.log(`\n GENERATE — the WHAT (derivable; write into source, re-run):`); for (const j of genJobs) console.log(j.kind === "generate-doc" ? `   [doc] ${j.name} at ${j.file}:${j.line}` : `   [claims] component "${j.name}" — add a ## works when block`); }
    if (authorJobs.length) { console.log(`\n AUTHOR — the WHY (NOT derivable — do not fabricate; needs a human/attested author):`); for (const j of authorJobs) console.log(`   [why] component "${j.name}" — states no rationale`); }
  }

  const failures = red + broken + covGaps;
  console.log(failures === 0 ? (verifyJobs.length ? `\n• ${verifyJobs.length} verification job(s) pending` : "\n✓ coherent") : `\n✗ ${failures} coherence failure(s) — ${red} claim · ${broken} broken · ${covGaps} coverage`);
  return failures === 0 ? 0 : 1;
}
