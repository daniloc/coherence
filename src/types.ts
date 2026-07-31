// types.ts — the coherence framework's data model and adapter contracts.
// The core is platform- and language-agnostic; everything project-specific lives
// behind LanguageAdapter (how to read code) and PlatformAdapter (how to read infra).

export interface GraphNode {
  id: string; parent?: string; label: string; kind: string;
  sub?: string; path?: string; line?: number; claimed?: boolean; claims?: string[];
  invariants?: string[]; // named properties the component upholds (## invariants); each anchored by a `boundary` claim
  refutations?: string[]; // observed negative controls (## refutations): `<invariant>: <what was broken> -> <what was seen>`
  claimKinds?: Record<string, string>; // bare claim text -> the kind it declared via a trailing `[bracket]`
  prose?: string; // the WHAT — derivable from code, regenerable
  why?: string;   // the WHY — rationale/intent, authored + protected
}
export interface GraphEdge { id: string; source: string; target: string; kind: string; }

export interface Bindings {
  /** runtime entities that map to a code component (e.g. a Durable Object class). */
  entities: Array<{ name: string; className: string }>;
  /** infrastructure stores (db, kv, …) shown as their own nodes. */
  stores: Array<{ binding: string; label: string; sub: string }>;
  vars: Record<string, string>;
  meta: Record<string, string>;
}
export interface Graph {
  generatedAt: string; root: string; absRoot: string;
  nodes: GraphNode[]; edges: GraphEdge[]; bindings: Bindings | null;
}

/** A raw spec parsed from a *.spec.md file. */
export interface ParsedSpec { name: string; intent: string; claims: string[]; claimKinds: Record<string, string>; prose: string; why: string; invariants: string[]; refutations: string[]; }

/** How to read a language's code — symbols, imports, and where docblocks live. */
export interface LanguageAdapter {
  exts: string[]; // file extensions whose symbols/imports/docblocks we parse
  symbols(src: string): Array<{ name: string; kind: string; line: number }>;
  imports(src: string): string[];
  docAbove(lines: string[], line: number): string;
  fileDoc(lines: string[]): string;
}

/** How to read a platform's infra config (optional — null platform = none). */
export interface PlatformAdapter {
  bindings(root: string): Promise<Bindings | null>;
}

export interface Config {
  root: string;
  outputDir: string;        // where generated html/json artifacts go (e.g. "public")
  entryDir: string;         // the entrypoint component's dir, "." = root
  tooling: string[];        // path prefixes demoted to a "tooling" group
  ignore: string[];         // dir names never walked
  codeExt: string[];        // file extensions treated as code (for the tree)
  typecheck: string[];      // command for the `typechecks` claim
  test: string[];           // base command for `passes test "<name>"` claims (name appended as final arg). Empty = claim skips.
  testMatch?: string;       // optional regex the test output MUST contain to count as a pass. Guards runners (e.g. vitest -t) that exit 0 when the named test matched nothing — without it, a deleted/renamed test silently stays green.
  // BATCHED ORACLE EXECUTION. `test` boots the runner once PER CLAIM, which is correct and
  // — on a project whose test pool is expensive to start — almost all of the wall clock.
  // Set `testBatch` to a command that runs the WHOLE suite and emits a machine-readable
  // report, and the executable tier (`passes test`, `boundary … via test`, `parity … via
  // test`) resolves every claim from that ONE run. Unset = the per-claim path, unchanged.
  // The per-claim path also remains the FALLBACK: if the batch crashes or its report will
  // not parse, verify says so loudly and reverts to it rather than degrading in silence.
  testBatch?: string[];     // e.g. ["npx","vitest","run","--reporter=json","--outputFile=.coherence/test-report.json"]
  testBatchFormat?: string; // report format; "vitest-json" is the only one v1 knows (and the default). An unknown value is a hard error, NOT a silent fallback.
  // Batch is the DEFAULT full-tier path: unset `testBatch` is DERIVED from `test` when the
  // runner is recognizable (vitest today). Set this to "serial" to demand the old per-claim
  // profile — one full test-pool boot PER CLAIM. It is supported and it is never implicit,
  // because a default nobody chose should not cost 20-35 minutes. Equivalent to the
  // `--serial-oracles` flag; the flag wins when both are present.
  oracleExecution?: "serial";
  // CLAIM KINDS — what a claim is ALLOWED to assert, declared BY THE PROJECT.
  // Coherence prevents behavioural drift, which is right for most projects and
  // dangerous for some: in a simulation a claim that pins a MEASURED VALUE does not
  // prevent regression, it LOCKS IN today's behaviour, and nothing detects that until
  // a later system is built on top of it. But a golden-output pin is exactly correct
  // in a compiler. So coherence holds NO OPINION — the project names its kinds and
  // their policy, and the harness enforces what was named.
  //   pin  — a claim of this kind is normal (default for anything declared)
  //   warn — allowed, but every use is reported (the "are you sure?" tier)
  // Unset (the default) disables the whole mechanism: kinds are neither required nor
  // checked, and existing specs are unaffected.
  claimKinds?: Record<string, { policy: "pin" | "warn"; why?: string }>;
  oracleDomain?: boolean;   // META-ORACLE: also assert a boundary's oracle test iterates a LIVE domain (not a literal/source-grep). Default true; set false to disable the gate (still classifies for the report).
  language: string;         // language adapter key
  platform: string | null;  // platform adapter key, or null
  components?: { name: string; files: string[] }[]; // optional sub-component overrides for the decompose/drift co-change analysis ONLY (the spec graph, verify, and coverage are untouched). `files` are globs relative to cfg.root (`*` = within a path segment, `**` = any). A file matching one is regrouped under `name`, so a large spec-component (a domain core) can be measured as the distinct concerns it actually contains instead of one opaque hub. First matching definition wins; unmatched files keep their spec-component.
  claudeMdPath?: string;    // path to the CLAUDE.md whose fenced block `coherence claude` owns (default: "CLAUDE.md" at cfg.root). Use a `../`-relative path when the authored CLAUDE.md lives outside the coherence root (e.g. a repo root above a sub-package); coherence still operates on cfg.root, only the splice target moves.
  dictionary?: string;      // dir (relative to cfg.root) holding the pattern dictionary — one `<Word>.md` per word, each a `# <Word>` heading + intent + `## commitments` claim list. A `conforms to <Word>` claim expands the word's commitments against the declaring component. Default "dictionary"; a project with no such dir simply has no words (the claim form still resolves — a missing word file goes RED, not skip).

  novelty?: {
    // Thresholds for the novelty-vs-anchor advisory `log` renders after the ledger diff.
    // Surface = net-new exported symbols + net-new union/enum variants + net-new keyed-
    // table keys across the ref range (test files excluded).
    minSurface?: number; // advisory floor for the surface count (default 8)
    minLoc?: number;     // LOC-added floor that can raise the zero-anchor alarm alone (default 400)
    ratio?: number;      // anchors added are "keeping pace" while surface <= anchors * ratio (default 12)
  };

  redundancy?: {
    // Thresholds for the `redundancy` advisory — UNDECLARED duplicated enumerated domains
    // (the complement of a parity claim: nobody wrote anything down, and two spellings of
    // one domain are free to drift). The detector is only as good as its floor, so every
    // knob here trades recall away for precision: a wall of candidates is worse than
    // silence. See src/redundancy.ts.
    minShared?: number;   // tokens two sites must share to be a candidate at all (default 3)
    containment?: number; // fraction of the SMALLER token set the overlap must cover (default 0.7)
    minScore?: number;    // ranking floor for the default report (default 3.5; `--all` drops it)
    maxDf?: number;       // a token at more than this many sites is project idiom, not a domain (default 6)
    top?: number;         // how many ranked pairs the default report prints (default 10)
  };

  prose?: {
    // Thresholds for the `prose` advisory — duplicated prose across reading surfaces
    // (README / RELEASE-NOTES / *.spec.md / module header essays) and whether the copies
    // still agree. Precision-first for the same reason as `redundancy`: a summary that
    // legitimately restates a fuller argument must never read as a defect. See src/prose.ts.
    minWords?: number; // sentences shorter than this cannot pair — idiom, not an argument (default 12)
    floor?: number;    // Jaccard floor over 6-word shingles (default 0.5; below it, rewrite and paraphrase are indistinguishable)
    maxDf?: number;    // a shingle in more than this many sentences is idiom, not a copy signature (default 6)
    top?: number;      // how many ranked pairs the default report prints (default 12; `--all` uncaps)
  };

  // --- producer/consumer contracts across deploy artifacts (mechanisms 2a + 3) ---
  // An invariant that SPANS deploy artifacts (e.g. a browser bundle and a Worker) is
  // exactly what no single compiler run can see — only the whole-source graph can. The
  // project declares its deploy units and its typed cross-unit message contracts here;
  // `coherence contracts` owns the resolution, the anchoring gate, and the uncovered-
  // surface detector.
  artifacts?: Record<string, string[]>; // deploy unit name → path globs (a file may belong to several, e.g. shared/)
  contracts?: Record<string, {
    producer: string;     // chokepoint symbol that EMITS the typed message
    consumer: string;     // chokepoint symbol that CONSUMES it
    type: string;         // the shared vocabulary symbol (the contract's type/registry)
    description?: string;
  }>;

  // --- ratchet / atlas subcommands (lint-sinks · conventions · atlas) — all optional ---
  // The harness owns the MECHANISM (scan, classify, baseline, render, --check); the
  // project owns the DATA here. Absent → sensible defaults (the lints scan the whole
  // tree minus `ignore`; the atlas is empty).
  sources?: string[];          // dirs the lint-sinks/conventions scans are scoped to (default: [entryDir]) — keep generated/vendored trees out
  testDir?: string;            // path substring identifying test files (default "__tests__")
  conventions?: {
    guardVerb?: string;        // regex (as a string) matching guard-function NAMES (names that signal a correctness/security decision)
    seed?: string[];           // extra guard names whose form doesn't match guardVerb
    dismissed?: Record<string, string>; // guard name → why it is NOT an unguarded convention (covered by another contract)
  };
  sinks?: { safeSql?: string; safeHtml?: string }; // regex (string) for interpolation exprs that are SAFE by construction
  // The MASS ratchet (`coherence mass`). The harness owns the mechanism (measure, pin,
  // --check, --raise); the project owns what else counts as mass. `measures` are probes
  // the harness cannot guess — each runs `cmd` from cfg.root and the LAST numeric token of
  // its stdout is the value (a nonzero exit or unparseable output is UNMEASURABLE and
  // fails --check; it is never read as 0). `deps: false` drops the package.json /
  // package-lock.json dimensions. `tolerance` is per baseline key — how much growth is
  // allowed before the ratchet says so (default 0: any growth is reported).
  mass?: { measures?: { key: string; cmd: string[]; unit?: string }[]; deps?: boolean; tolerance?: Record<string, number> };
  atlas?: {
    charts: Record<string, string>;  // trust domain → description
    transitions: Record<string, { from: string; to: string; security?: boolean; anchoredBy?: string; translates: string; enshrined?: true }>; // chokepoint symbol → the crossing it manages. `enshrined: true` is an EXPLICIT project attestation that the illegal value at this crossing is unrepresentable (a runtime-branded capability), not just source-checked — it promotes a crossing to tier-1. It is NOT verb-inferred: a `via guard` claim alone is only source-totality evidence (tier-2). An `enshrined` marker MUST be backed by a `via guard` boundary claim (the source-totality guard the enshrinement rides on); an enshrinement with no backing guard fails `atlas --check` (fail-closed — an empty over-claim).
    nonTransition?: Record<string, string>; // boundary chokepoints that hold WITHIN a chart (not crossings) → reason (so they aren't flagged as drift)
    knownPending?: string[];          // mapped symbols tolerated as not-yet-in-source (don't fail --check)
  };
}
