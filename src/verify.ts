// verify.ts — the coherence engine: deterministic claim verifiers + the narrative
// evidence chain (emits inference jobs for a subagent) + coverage meta-claims
// (what auto-generates, why is human-authored). Config-driven; consumes the Graph.
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Config, Graph } from "./types.ts";

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

export async function runVerify(cfg: Config, graph: Graph, opts: { fast?: boolean }): Promise<number> {
  const root = cfg.root;
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
    return mk("skip", "no verifier (dialect gap)");
  };

  const comps = graph.nodes.filter((n) => n.kind === "component");
  const symbols = graph.nodes.filter((n) => n.kind === "symbol");
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

  const compGaps = comps.filter((c) => !(c.claims && c.claims.length));
  const docGaps = symbols.filter((s) => !s.prose || !String(s.prose).trim());
  const whyGaps = comps.filter((c) => !c.why || !String(c.why).trim());
  console.log(`coverage: components ${comps.length - compGaps.length}/${comps.length} claimed, ${comps.length - whyGaps.length}/${comps.length} with why · symbols ${symbols.length - docGaps.length}/${symbols.length} documented`);
  for (const c of compGaps) { console.log(`  ✗ [coverage] component "${c.label}" has no claims`); jobs.push({ kind: "generate-claims", id: c.id, name: c.label }); }
  for (const s of docGaps) { console.log(`  ✗ [coverage] symbol "${s.label}" (${s.path}:${s.line}) has no description (what)`); jobs.push({ kind: "generate-doc", id: s.id, file: s.path, line: s.line, name: s.label }); }
  for (const c of whyGaps) { console.log(`  ✗ [coverage] component "${c.label}" states no rationale (why)`); jobs.push({ kind: "author-why", id: c.id, name: c.label }); }
  const covGaps = compGaps.length + docGaps.length + whyGaps.length;

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
