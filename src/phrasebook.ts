// phrasebook.ts — the claim grammar as DATA. Every claim form `evalClaim` (verify.ts)
// understands lives here as an ordered `ClaimForm` registry: first match wins, and the
// order below IS the precedence (identical to the historical if-chain in evalClaim).
//
// Two payoffs of moving the grammar out of the engine and into a registry:
//   1. `coherence phrasebook` renders the form table straight from this array, so the
//      README's hand-kept table gains a generated authority (it can't silently drift).
//   2. The dictionary (`conforms to <Word>`) is just one more form — a macro that
//      expands a word file's commitment list back through this same registry.
//
// The boundary form imports BOUNDARY_RE from boundary.ts (its single home); it is NOT
// duplicated here.
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Config, Graph } from "./types.ts";
import { BOUNDARY_RE } from "./boundary.ts";
import { PARITY_RE } from "./parity.ts";
import { analyzeOracle, analyzeParityOracle } from "./oracle-domain.ts";
import { unescapeMd } from "./walk.ts";
import { resolveFromBatch, type OracleAccess } from "./test-batch.ts";

const fileExists = async (p: string) => { try { await stat(p); return true; } catch { return false; } };

/** The verdict a claim form returns — adapted into verify's `Sig` (which adds claim + node). */
export interface ClaimResult { kind: "pass" | "fail" | "skip"; detail?: string }

/**
 * Everything a claim form needs to evaluate, threaded from runVerify. `nodeDir`/`node`
 * are the DECLARING component's disk dir + label; `anchor` records a boundary-anchored
 * invariant for that component (so the coverage gate sees it — even when the boundary is
 * reached through a `conforms to` word). `typecheck` is memoized upstream (one run/verify).
 * `wordStack` is the `conforms to` expansion stack for cycle/depth safety.
 *
 * `oracles` is the EXECUTABLE-TIER seam, memoized upstream exactly like `typecheck`: at
 * most one whole-suite resolution per verify, LAZILY — a `--fast` run or a project with no
 * executable claims never calls it. It answers with a batch report when one is available,
 * and otherwise says whether the SERIAL per-claim path is permitted at all. A null report
 * with `serialAllowed: false` is a refusal (no batch, no report, nobody asked for serial),
 * and the claim skips rather than quietly costing a full pool boot.
 */
export interface ClaimCtx {
  cfg: Config;
  graph: Graph;
  root: string;
  nodeDir: string;
  node: string;
  fast: boolean;
  typecheck: () => { pass: boolean; detail: string };
  anchor: (inv: string) => void;
  wordStack: string[];
  oracles?: () => OracleAccess;
}

export interface ClaimForm {
  name: string;
  /** human-readable grammar, for the phrasebook table / README authority. */
  grammar: string;
  example: string;
  tier: "deterministic" | "live" | "executable" | "hybrid";
  match(line: string): RegExpMatchArray | null;
  evaluate(ctx: ClaimCtx, m: RegExpMatchArray): ClaimResult | Promise<ClaimResult>;
}

// ── the dictionary word file ──────────────────────────────────────────────────────────
// `<coherence root>/<dictionary>/<Word>.md`: a `# <Word>` heading, first non-blank line =
// intent, a `## commitments` bullet list where each bullet is a claim line in THIS grammar
// (including `boundary …` and nested `conforms to <OtherWord>`). Parsed with walk.ts's
// regex-heading style + markdown-unescape so a prettified word file still parses.
export interface Word { name: string; intent: string; commitments: string[] }

/** Parse a dictionary word file, or null if it is not a well-formed word (a broken
 *  reference must go RED, not skip — a word is a contract). */
export function parseWord(text: string): Word | null {
  const lines = text.split("\n");
  let name = "", i = 0;
  for (; i < lines.length; i++) { const m = /^#\s+(.+?)\s*$/.exec(lines[i]); if (m) { name = m[1]; i++; break; } }
  if (!name) return null;
  let intent = "";
  for (; i < lines.length; i++) { const l = lines[i].trim(); if (!l) continue; if (l.startsWith("#")) break; intent = l; break; }
  const cs = lines.findIndex((l) => /^##\s+commitments\s*$/i.test(l));
  if (cs < 0) return null; // a word with no commitments section is not a contract
  const commitments: string[] = [];
  for (let j = cs + 1; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j])) break;
    const c = /^-\s+(.+?)\s*$/.exec(lines[j]);
    if (c) commitments.push(unescapeMd(c[1]));
  }
  return { name, intent, commitments };
}

/** Where a word file resolves, relative to the coherence root. */
export const dictionaryDir = (cfg: Config) => cfg.dictionary ?? "dictionary";
const wordPath = (cfg: Config, word: string) => join(dictionaryDir(cfg), `${word}.md`);

// Defensive cap on `conforms to` nesting (cycle detection already handles loops; this
// bounds a pathological deep-but-acyclic chain).
const MAX_CONFORMS_DEPTH = 16;

/** A dictionary word plus the components that `conforms to` it — for the overview render. */
export interface DictEntry { word: string; intent: string; conformers: string[] }

/** The `conforms to <Word>` grammar — SINGLE HOME. Consumed by the claim form's `match`,
 *  the dictionary cross-reference in `loadDictionary`, and the `--staged`/`--since` word-edit
 *  propagation scope in structural.ts. Capture group 1 is the word token. */
export const CONFORMS_RE = /^conforms to\s+([A-Za-z][A-Za-z0-9_-]*)$/;

/** Regex-escape a string so it matches literally when interpolated into a RegExp or passed
 *  to a test runner whose `-t <name>` treats the arg as a regex (vitest, jest). */
export const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Resolve ONE named test — the shared executable arm of `passes test`,
 * `boundary … via test`, and `parity … via test`. THE SINGLE FRONT DOOR: every runner
 * invocation coherence makes on a project's behalf goes through here, which is why
 * batching is a change to this one function rather than to three claim forms.
 *
 * Two arms, one contract:
 *   BATCH — a whole-suite report is available, so the answer is a lookup (`resolveFromBatch`).
 *   PER-CLAIM — shell `config.test` with the name appended, regex-escaped for the runner's
 *     `-t`; exit 0 alone is not trusted (`testMatch` requires positive evidence the named
 *     test actually ran — an exit-0 runner that matched zero tests would otherwise pass a
 *     renamed/deleted oracle).
 *
 * Both arms require positive evidence and both go red on zero matches, so which one
 * answered is an operational detail, never a difference in what green means.
 */
function execNamedTest(ctx: ClaimCtx, name: string): { ok: boolean; detail: string } {
  const o = ctx.oracles?.();
  if (o?.report) return resolveFromBatch(o.report, name);
  const cfg = ctx.cfg;
  const r = spawnSync(cfg.test[0], [...cfg.test.slice(1), reEscape(name)], { cwd: ctx.root, encoding: "utf8", timeout: 120000 });
  const out = (r.stderr || "") + (r.stdout || "");
  if (r.status !== 0) return { ok: false, detail: out.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 200) };
  if (cfg.testMatch && !new RegExp(cfg.testMatch).test(out)) return { ok: false, detail: `test "${name}" matched no run (testMatch)` };
  return { ok: true, detail: "" };
}

/** Whether SOME runner is allowed to answer an executable claim: a batch report, or — only
 *  when the run permits it — a configured per-claim command. A REFUSAL (`serialAllowed:
 *  false` with no report) reports false, so the claim skips instead of silently buying one
 *  full test-pool boot; verify fails the run separately, with instructions. */
function hasRunner(ctx: ClaimCtx): boolean {
  const o = ctx.oracles?.();
  if (o?.report) return true;
  if (o && !o.serialAllowed) return false;
  return !!(ctx.cfg.test && ctx.cfg.test.length);
}

/** Scan the dictionary dir + cross-reference the graph's `conforms to` claims. Empty when
 *  the project has no dictionary dir (so the overview's Dictionary section is omitted). */
export async function loadDictionary(cfg: Config, graph: Graph): Promise<DictEntry[]> {
  const dir = join(cfg.root, dictionaryDir(cfg));
  let files: string[];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".md")); } catch { return []; }
  // Key conformers by the WORD TOKEN in the claim (= the file basename `conforms to` resolves
  // against), not the file's `# ` heading — those can differ; the token is what references it.
  const conformers = new Map<string, string[]>();
  for (const c of graph.nodes.filter((n) => n.kind === "component"))
    for (const cl of c.claims ?? []) { const m = CONFORMS_RE.exec(cl); if (m) { const a = conformers.get(m[1]) ?? []; a.push(c.label); conformers.set(m[1], a); } }
  const entries: DictEntry[] = [];
  for (const f of files.sort()) {
    const base = f.replace(/\.md$/, "");
    const w = parseWord(await readFile(join(dir, f), "utf8").catch(() => ""));
    entries.push({ word: base, intent: w?.intent ?? "", conformers: conformers.get(base) ?? [] });
  }
  return entries;
}

export const CLAIM_FORMS: ClaimForm[] = [
  {
    name: "typechecks",
    grammar: "typechecks",
    example: "typechecks",
    tier: "deterministic",
    match: (l) => l.match(/^typechecks$/),
    evaluate: (ctx) => { const t = ctx.typecheck(); return { kind: t.pass ? "pass" : "fail", detail: t.detail }; },
  },
  {
    name: "exists",
    grammar: "<file> exists at (root | this node | every node)",
    example: "wrangler.jsonc exists at root",
    tier: "deterministic",
    match: (l) => l.match(/^(\S+)\s+exists at\s+(root|this node|every node)$/),
    evaluate: async (ctx, m) => {
      const base = m[2] === "root" ? ctx.root : ctx.nodeDir;
      return { kind: (await fileExists(join(base, m[1]))) ? "pass" : "fail", detail: `${m[1]} @ ${m[2]}` };
    },
  },
  {
    name: "imports",
    grammar: "<file> imports <specifier>",
    example: "main.ts imports ./registry",
    tier: "deterministic",
    match: (l) => l.match(/^(\S+)\s+imports\s+(\S+)$/),
    evaluate: async (ctx, m) => {
      try {
        const src = await readFile(join(ctx.nodeDir, m[1]), "utf8");
        const re = new RegExp(`from\\s+["']${m[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
        return re.test(src) ? { kind: "pass", detail: "" } : { kind: "fail", detail: `no import of ${m[2]}` };
      } catch { return { kind: "fail", detail: `cannot read ${m[1]}` }; }
    },
  },
  {
    name: "responds",
    grammar: '<url> responds <status> [with "<text>"]',
    example: 'http://localhost:8787/health responds 200 with "ok"',
    tier: "live",
    match: (l) => l.match(/^(\S+)\s+responds\s+(\d+)(?:\s+with\s+"(.*)")?$/),
    evaluate: async (ctx, m) => {
      if (ctx.fast) return { kind: "skip", detail: "live tier (--fast)" };
      try {
        const res = await fetch(m[1]);
        if (res.status !== Number(m[2])) return { kind: "fail", detail: `got ${res.status}` };
        if (m[3]) { const bdy = await res.text(); if (!bdy.includes(m[3])) return { kind: "fail", detail: `body missing "${m[3]}"` }; }
        return { kind: "pass" };
      } catch { return { kind: "skip", detail: "unreachable" }; }
    },
  },
  {
    name: "passes test",
    grammar: 'passes test "<name>"',
    example: 'passes test "write policy totality"',
    tier: "executable",
    match: (l) => l.match(/^passes test\s+"(.+)"$/),
    evaluate: (ctx, m) => {
      if (ctx.fast) return { kind: "skip", detail: "executable tier (--fast)" };
      if (!hasRunner(ctx)) return { kind: "skip", detail: "no test runner configured (config.test)" };
      const r = execNamedTest(ctx, m[1]);
      return r.ok ? { kind: "pass" } : { kind: "fail", detail: r.detail };
    },
  },
  {
    name: "boundary",
    grammar: 'boundary "<invariant>" at <chokepoint> [crossing <zone> -> <zone>] [via (test|guard) "<oracle>"]',
    example: 'boundary "fail-closed writes" at applyWritePolicy crossing agent-mcp -> storage via test "write policy totality"',
    tier: "hybrid",
    match: (l) => l.match(BOUNDARY_RE),
    // The anti-entropy ratchet. Asserts the four-part anatomy of a self-enforcing boundary:
    // the invariant is named (and ANCHORED for the coverage gate), the chokepoint SYMBOL
    // exists, and (if given) the oracle passes. `via test` additionally runs the META-ORACLE
    // (live-domain analysis, even under --fast); `via guard` is exempt (source-property oracle).
    // The optional `crossing` clause (groups 3/4) is PROMISE-GRAPH topology, not a runtime
    // check — verify never evaluates it, so verb/oracle now read from groups 5/6.
    evaluate: async (ctx, m) => {
      const inv = m[1], sym = m[2], verb = m[5], test = m[6];
      ctx.anchor(inv);
      if (!ctx.graph.nodes.some((n) => n.kind === "symbol" && n.label === sym)) return { kind: "fail", detail: `chokepoint symbol "${sym}" not found in the code graph` };
      if (!test) return { kind: "pass", detail: `${inv} @ ${sym} (no oracle)` };
      if (verb === "test" && ctx.cfg.oracleDomain !== false) {
        const a = await analyzeOracle(ctx.cfg, test);
        if (a.verdict === "literal")
          return { kind: "fail", detail: `[oracle] "${test}" iterates a LITERAL domain (${a.detail}) — a sampling oracle, not totality. Derive its domain from the live SSOT behind \`${sym}\` (or, if it is a source-property guard, declare it \`via guard\` not \`via test\`).` };
        if (a.verdict === "no-iteration")
          return { kind: "fail", detail: `[oracle] "${test}" performs NO domain iteration (${a.detail}) — a source-grep / hand-enumerated cases, not totality. Loop the live domain behind \`${sym}\`, or — if it is a genuine source-property guard — declare it \`via guard "${test}"\` instead of \`via test\`.` };
        if (a.verdict === "not-found")
          return { kind: "fail", detail: `[oracle] "${test}" — no describe() with this EXACT title found, so the meta-oracle cannot analyze its domain (the runner alone would still pass on an it()-name match, silently skipping analysis). Anchor the claim to the oracle's exact describe title, or declare it \`passes test\`/\`via guard\` if it is not a domain totality.` };
      }
      if (ctx.fast) return { kind: "skip", detail: "boundary oracle (--fast)" };
      if (!hasRunner(ctx)) return { kind: "skip", detail: "no test runner configured (config.test)" };
      const r = execNamedTest(ctx, test);
      if (!r.ok) return { kind: "fail", detail: r.detail };
      return { kind: "pass", detail: `${inv} @ ${sym}${verb === "guard" ? " (source-property guard)" : ""}` };
    },
  },
  {
    name: "lives in",
    grammar: "lives in <zone>",
    example: "lives in owner-trusted",
    tier: "deterministic",
    // RESIDENCE — the PROMISE GRAPH's topology axiom 2: a component declares which trust
    // zone it lives in, so a cross-component import can be graded (same-zone / covered /
    // naked). Like a crossing, residence is a DECLARATION, not a runtime property, so verify
    // asserts only that it is well-formed (a non-empty zone token) and passes. Its SEMANTIC
    // validation (is the named zone declared? does the wall it opens have a gate?) lives in
    // the promise layer (`coherence contract`), which owns zones — NOT here. Registering it
    // is what keeps `lives in` from grading as U: an unregistered verb is a dialect-gap skip,
    // which would wrongly report the topology as an unread claim.
    match: (l) => l.match(/^lives in\s+(\S+)$/),
    evaluate: (_ctx, m) => ({ kind: "pass", detail: `resides in ${m[1]}` }),
  },
  {
    name: "parity",
    grammar: 'parity "<invariant>" over <domain> between <fnA> and <fnB> via test "<oracle>"',
    example: 'parity "disclosure faithfulness" over TOOL_NAMES between toolActivity and messageProvenance via test "live equals settled"',
    tier: "hybrid",
    // The AGREEMENT ratchet — the boundary totality pattern generalized from coverage to
    // parity. Two functions are declared PROJECTIONS OF ONE ENUMERATED DOMAIN and must
    // agree over it: the invariant is named (and anchored, so a parity claim satisfies
    // the invariant-coverage gate exactly like a boundary), the domain and BOTH
    // projection symbols must exist in the code graph, and the oracle passes. The parity
    // META-ORACLE runs even under --fast (source analysis, like the boundary's): the
    // named describe must ENUMERATE the declared domain and DRIVE both projections —
    // a one-sided or sample-list oracle fails the claim rather than wearing the label.
    match: (l) => l.match(PARITY_RE),
    evaluate: async (ctx, m) => {
      const inv = m[1], domain = m[2], f = m[3], g = m[4], oracle = m[5];
      ctx.anchor(inv);
      for (const s of [domain, f, g])
        if (!ctx.graph.nodes.some((n) => n.kind === "symbol" && n.label === s))
          return { kind: "fail", detail: `symbol "${s}" not found in the code graph` };
      if (ctx.cfg.oracleDomain !== false) {
        const a = await analyzeParityOracle(ctx.cfg, oracle, domain, f, g);
        if (a.verdict === "not-found")
          return { kind: "fail", detail: `[parity] "${oracle}" — no describe() with this EXACT title found, so the parity meta-oracle cannot analyze it. Anchor the claim to the oracle's exact describe title.` };
        if (a.verdict !== "ok")
          return { kind: "fail", detail: `[parity] "${oracle}" ${a.detail} (${a.file}). Loop the declared domain and assert \`${f}\` ≡ \`${g}\` per member.` };
      }
      if (ctx.fast) return { kind: "skip", detail: "parity oracle (--fast)" };
      if (!hasRunner(ctx)) return { kind: "skip", detail: "no test runner configured (config.test)" };
      const r = execNamedTest(ctx, oracle);
      if (!r.ok) return { kind: "fail", detail: r.detail };
      return { kind: "pass", detail: `${inv}: ${f} ≡ ${g} over ${domain}` };
    },
  },
  {
    name: "conforms to",
    grammar: "conforms to <Word>",
    example: "conforms to OwnedScope",
    tier: "hybrid",
    // The dictionary macro. A `<Word>.md` in the dictionary is a pattern — an intent plus a
    // commitment list — grown from the project's own code. `conforms to <Word>` expands those
    // commitments against the DECLARING component's context (same node dir, same anchoring:
    // a `boundary` commitment anchors its invariant on THIS component, exactly as if inline)
    // and aggregates. A word is a CONTRACT, so — unlike a free-form spec claim — a commitment
    // that matches no claim form goes RED rather than skipping, and a missing/unparseable word
    // file goes RED (the verb was recognized; a broken reference is not a dialect gap).
    match: (l) => l.match(CONFORMS_RE),
    evaluate: async (ctx, m) => {
      const word = m[1];
      if (ctx.wordStack.includes(word))
        return { kind: "fail", detail: `conforms-to cycle: ${[...ctx.wordStack, word].join(" → ")}` };
      if (ctx.wordStack.length >= MAX_CONFORMS_DEPTH)
        return { kind: "fail", detail: `conforms-to nesting exceeds depth ${MAX_CONFORMS_DEPTH}: ${[...ctx.wordStack, word].join(" → ")}` };
      const rel = wordPath(ctx.cfg, word);
      let text: string;
      try { text = await readFile(join(ctx.root, rel), "utf8"); }
      catch { return { kind: "fail", detail: `word "${word}" not found at ${rel}` }; }
      const w = parseWord(text);
      if (!w) return { kind: "fail", detail: `word "${word}" at ${rel} is unparseable (needs a "# ${word}" heading and a "## commitments" list)` };
      // The file basename is what `conforms to` resolves against; its `# heading` must agree,
      // or the contract references a word that isn't the one on disk (a silent aliasing bug).
      if (w.name !== word) return { kind: "fail", detail: `word "${word}" at ${rel} is headed "# ${w.name}" — the heading must match the file basename "${word}"` };
      const child: ClaimCtx = { ...ctx, wordStack: [...ctx.wordStack, word] };
      let green = 0, skipped = 0;
      for (const commitment of w.commitments) {
        let form: ClaimForm | null = null, cm: RegExpMatchArray | null = null;
        for (const f of CLAIM_FORMS) { const mx = f.match(commitment); if (mx) { form = f; cm = mx; break; } }
        if (!form || !cm)
          return { kind: "fail", detail: `word "${word}": commitment "${commitment}" matches no claim form (a word is a contract — no silent skips)` };
        const r = await form.evaluate(child, cm);
        if (r.kind === "fail") return { kind: "fail", detail: `word "${word}": commitment "${commitment}" failed${r.detail ? ` — ${r.detail}` : ""}` };
        if (r.kind === "skip") skipped++; else green++;
      }
      // A word verifies NOTHING it skipped: if any commitment was skipped (unrunnable in this
      // tier — `--fast`, or no test runner) the claim is a SKIP, not a green pass. It lands in
      // verify's skipped tally and skip list exactly like an inline skipped claim, so a word
      // can't launder to coherent having run none of its commitments. A FAIL still wins above.
      if (skipped) return { kind: "skip", detail: `${word}: ${green} green · ${skipped} skipped (not runnable in this tier)` };
      return { kind: "pass", detail: `${word}: ${green} commitment${green === 1 ? "" : "s"} green` };
    },
  },
];
