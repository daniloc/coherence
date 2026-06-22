// types.ts — the coherence framework's data model and adapter contracts.
// The core is platform- and language-agnostic; everything project-specific lives
// behind LanguageAdapter (how to read code) and PlatformAdapter (how to read infra).

export interface GraphNode {
  id: string; parent?: string; label: string; kind: string;
  sub?: string; path?: string; line?: number; claimed?: boolean; claims?: string[];
  invariants?: string[]; // named properties the component upholds (## invariants); each anchored by a `boundary` claim
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
export interface ParsedSpec { name: string; intent: string; claims: string[]; prose: string; why: string; invariants: string[]; }

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
  oracleDomain?: boolean;   // META-ORACLE: also assert a boundary's oracle test iterates a LIVE domain (not a literal/source-grep). Default true; set false to disable the gate (still classifies for the report).
  language: string;         // language adapter key
  platform: string | null;  // platform adapter key, or null
  components?: { name: string; files: string[] }[]; // optional sub-component overrides for the decompose/drift co-change analysis ONLY (the spec graph, verify, and coverage are untouched). `files` are globs relative to cfg.root (`*` = within a path segment, `**` = any). A file matching one is regrouped under `name`, so a large spec-component (a domain core) can be measured as the distinct concerns it actually contains instead of one opaque hub. First matching definition wins; unmatched files keep their spec-component.

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
  atlas?: {
    charts: Record<string, string>;  // trust domain → description
    transitions: Record<string, { from: string; to: string; security?: boolean; anchoredBy?: string; translates: string }>; // chokepoint symbol → the crossing it manages
    nonTransition?: Record<string, string>; // boundary chokepoints that hold WITHIN a chart (not crossings) → reason (so they aren't flagged as drift)
    knownPending?: string[];          // mapped symbols tolerated as not-yet-in-source (don't fail --check)
  };
}
