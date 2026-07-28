// verify.ts — the coherence engine: deterministic claim verifiers + the narrative
// evidence chain (emits inference jobs for a subagent) + coverage meta-claims
// (what auto-generates, why is human-authored). Config-driven; consumes the Graph.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Config, Graph } from "./types.ts";
import { CLAIM_FORMS, type ClaimCtx } from "./phrasebook.ts";
import { ownerOf } from "./walk.ts";
import { recordVerify, readStatus } from "./status.ts";

const hashOf = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
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

// Advisories exist to be READ. A 17-line dump every run is scrolled past, so the lists
// are capped — but the overflow is always ANNOUNCED, never silently dropped: a truncated
// list that looks complete is worse than no list.
const ADVISORY_LIST_CAP = 8;
function listCapped<T>(items: T[], line: (t: T) => string): void {
  for (const t of items.slice(0, ADVISORY_LIST_CAP)) console.log(line(t));
  const rest = items.length - ADVISORY_LIST_CAP;
  if (rest > 0) console.log(`  · … and ${rest} more (not shown)`);
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
  type Sig = { kind: "pass" | "fail" | "skip"; claim: string; node: string; detail?: string; declaredKind?: string };
  // Undeclared (the default) leaves the whole mechanism off: kinds are neither required
  // nor checked, and every existing spec in the world parses unchanged.
  const kindPolicy = cfg.claimKinds;
  // The claim grammar is a declarative registry (src/phrasebook.ts): an ordered list of
  // ClaimForms, first match wins (the order IS the historical precedence). evalClaim is now
  // a thin loop — build the per-claim context, find the first matching form, adapt its
  // ClaimResult into a Sig. A line matching NO form still skips as a dialect gap. The
  // boundary + `conforms to` forms anchor invariants via ctx.anchor so the coverage gate
  // sees them (including boundaries reached transitively through a dictionary word).
  const evalClaim = async (claim: string, nodeDir: string, node: string, declaredKind?: string): Promise<Sig> => {
    // The kind arrives ALREADY SEPARATED, stripped by parseSpec (src/walk.ts) at the single
    // parse site. It is deliberately NOT re-parsed here: `claim` is the bare text, identical
    // to what 0.10.0 saw, so every form's grammar, the coverage ratchet, and the status
    // record's identity are untouched. What a kind MEANS is the project's business
    // (config.claimKinds); an unknown one is red because a typo must not grade as unkinded.
    if (kindPolicy && declaredKind && !kindPolicy[declaredKind])
      return { kind: "fail", claim, node, declaredKind,
        detail: `unknown claim kind "${declaredKind}" — config.claimKinds declares: ${Object.keys(kindPolicy).join(", ")}` };
    const ctx: ClaimCtx = {
      cfg, graph, root, nodeDir, node, fast: !!opts.fast, typecheck, wordStack: [],
      anchor: (inv) => { let set = anchored.get(node); if (!set) { set = new Set(); anchored.set(node, set); } set.add(inv); },
    };
    for (const form of CLAIM_FORMS) {
      const m = form.match(claim);
      if (m) { const r = await form.evaluate(ctx, m); return { kind: r.kind, claim, node, detail: r.detail, declaredKind }; }
    }
    return { kind: "skip", claim, node, detail: "no verifier (dialect gap)", declaredKind };
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
  for (const c of comps) { const dir = c.id.slice(2); const diskDir = dir === "." ? root : join(root, dir); for (const cl of c.claims || []) sigs.push(await evalClaim(cl, diskDir, c.label, (c as any).claimKinds?.[cl])); }
  const red = sigs.filter((s) => s.kind === "fail").length;
  console.log(`claims: ${sigs.length} · ${sigs.filter((s) => s.kind === "pass").length} green · ${red} red · ${sigs.filter((s) => s.kind === "skip").length} skipped`);
  for (const s of sigs) if (s.kind !== "pass") console.log(`  ${s.kind === "fail" ? "✗" : "·"} [${s.node}] ${s.claim}${s.detail ? ` — ${s.detail}` : ""}`);

  // ── KINDS. Advisory by design: adoption is gradual, so an unkinded claim in a project
  // that HAS declared kinds is reported, never failed. A `warn` kind is listed every time
  // it is used — that tier exists to make a category the project distrusts impossible to
  // use quietly, not impossible to use.
  if (kindPolicy) {
    const warnKinds = new Set(Object.entries(kindPolicy).filter(([, v]) => v.policy === "warn").map(([k]) => k));
    const warned = sigs.filter((s) => s.declaredKind && warnKinds.has(s.declaredKind));
    const unkinded = sigs.filter((s) => !s.declaredKind);
    console.log(`kinds: ${sigs.length - unkinded.length}/${sigs.length} declared` + (warned.length ? ` · ${warned.length} on a warned kind` : ""));
    // Grouped by kind, so the project's `why` is stated ONCE. Repeating a paragraph of
    // rationale per claim is how the rationale stops being read.
    for (const k of warnKinds) {
      const of = warned.filter((s) => s.declaredKind === k);
      if (!of.length) continue;
      const why = kindPolicy[k]?.why;
      console.log(`  ! kind "${k}" — ${of.length} claim(s)${why ? `: ${why}` : ""}`);
      listCapped(of, (s) => `      [${s.node}] ${s.claim}`);
    }
    listCapped(unkinded, (s) => `  · [${s.node}] ${s.claim} — no kind declared (advisory)`);
  }

  // ── REFUTATIONS. A claim nobody has watched fail is not evidence. `## refutations`
  // records the observed negative control per invariant; this reports the gap. Advisory:
  // the harness cannot know whether an unrefuted claim is lazy or merely young.
  //
  // The per-invariant list appears only once the project has declared its FIRST
  // refutation. Before that the count alone is the message: an advisory that prints
  // a line per invariant on a project that has never used the feature is a nag, and a
  // nag that fires every run on every project is one people learn to scroll past.
  {
    const invs: string[] = [], refs: string[] = [];
    for (const c of comps) { for (const i of (c as any).invariants || []) invs.push(i); for (const r of (c as any).refutations || []) refs.push(r); }
    if (invs.length) {
      const refuted = new Set(refs.map((r) => r.split(":")[0].trim()));
      const missing = invs.filter((i) => !refuted.has(i));
      console.log(`refutations: ${invs.length - missing.length}/${invs.length} invariants carry an observed negative control`
        + (refs.length ? "" : " — none declared; see README `## refutations`"));
      if (refs.length) listCapped(missing, (i) => `  · [refutation] "${i}" — never observed failing (advisory)`);
    }
  }

  // ── THE DECORATION FILTER. Neither signal is worth much alone: a claim that has never
  // been red may simply be a good invariant, and a claim with no recorded refutation may
  // simply be young. TOGETHER they are the honest suspect list — nothing has ever made
  // this fail, and nobody has ever tried. Advisory, and deliberately quiet when the
  // record is new (a first run has no history to report).
  {
    const prior = await readStatus(cfg);
    const hist = new Map((prior.verify?.claims || []).map((c) => [`${c.node} ${c.claim}`, c]));
    const seasoned = sigs.filter((sg) => {
      const h = hist.get(`${sg.node} ${sg.claim}`);
      return h && (h.runs ?? 0) >= 3 && !h.everFailed;
    });
    if (seasoned.length) {
      const refs = new Set<string>();
      for (const c of comps) for (const r of (c as any).refutations || []) refs.add(r.split(":")[0].trim());
      const bare = seasoned.filter((sg) => { const m = /^boundary\s+"([^"]+)"/.exec(sg.claim); return !m || !refs.has(m[1]); });
      if (bare.length) {
        console.log(`never red: ${bare.length} claim(s) green every run so far, with no recorded refutation`);
        listCapped(bare, (sg) => {
          const h = hist.get(`${sg.node} ${sg.claim}`)!;
          return `  · [never-red] [${sg.node}] ${sg.claim} — ${h.runs} run(s), never observed failing`;
        });
      }
    }
  }

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

  // File the report (`.coherence/status.json`) — the run record the panel (and any
  // other consumer) reads. Coverage + invariant TOTALS are static full-tree graph
  // facts, so a scoped run still records them honestly; per-claim verdicts and the
  // gap list merge inside recordVerify (scoped runs replace only what they touched).
  // A failed write must never fail the verify itself (read-only checkout, etc.).
  try {
    const allComps = graph.nodes.filter((n) => n.kind === "component");
    const allSymbols = graph.nodes.filter((n) => n.kind === "symbol");
    await recordVerify(cfg, {
      tier: opts.fast ? "fast" : "full",
      scope: opts.only ? comps.map((c) => c.label) : null,
      sigs,
      coverage: {
        components: allComps.length,
        claimed: allComps.filter((c) => c.claims && c.claims.length).length,
        withWhy: allComps.filter((c) => c.why && String(c.why).trim()).length,
        symbols: allSymbols.length,
        documented: allSymbols.filter((s) => s.prose && String(s.prose).trim()).length,
      },
      invTotal: allComps.reduce((n, c) => n + (c.invariants?.length ?? 0), 0),
      invGaps,
      narrative: narr?.statements
        ? { statements: narr.statements.length, unchanged: narr.statements.filter((s: any) => s.status === "ok").length, pending: narr.statements.filter((s: any) => s.status === "pending").length, broken }
        : null,
      jobs: jobs.length,
      failures,
    });
  } catch { /* the record is best-effort; the console report already happened */ }
  return failures === 0 ? 0 : 1;
}
