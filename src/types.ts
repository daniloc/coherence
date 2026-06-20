// types.ts — the coherence framework's data model and adapter contracts.
// The core is platform- and language-agnostic; everything project-specific lives
// behind LanguageAdapter (how to read code) and PlatformAdapter (how to read infra).

export interface GraphNode {
  id: string; parent?: string; label: string; kind: string;
  sub?: string; path?: string; line?: number; claimed?: boolean; claims?: string[];
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
export interface ParsedSpec { name: string; intent: string; claims: string[]; prose: string; why: string; }

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
  language: string;         // language adapter key
  platform: string | null;  // platform adapter key, or null
}
