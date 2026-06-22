// _helpers.ts — shared test scaffolding (NOT a test file: the `_` prefix keeps the
// node:test runner from picking it up). Temp-project fixtures, console capture, and
// hand-built Graph/Config factories so the engine can be driven without a real repo.
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { Config, Graph, GraphNode, GraphEdge } from "../src/types.ts";

/** Materialize a throwaway project dir from a {relpath: contents} map. Returns its root. */
export async function tmpProject(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "coh-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
  return dir;
}

export const cleanup = (dir: string) => rm(dir, { recursive: true, force: true });

/** Run an async fn with console.log captured; return its result code + the joined output. */
export async function runCaptured(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    const code = await fn();
    return { code, out: lines.join("\n") };
  } finally {
    console.log = orig;
  }
}

/** A minimal valid Config over a temp root, with overrides. */
export function cfg(root: string, over: Partial<Config> = {}): Config {
  return {
    root,
    outputDir: "public",
    entryDir: ".",
    tooling: [],
    ignore: ["node_modules", ".git", "dist"],
    codeExt: ["ts"],
    typecheck: ["true"],
    test: [],
    language: "typescript",
    platform: null,
    ...over,
  };
}

/** A component graph node (`c:<dir>`), shaped like derive.ts produces. */
export function comp(
  dir: string,
  o: { label?: string; intent?: string; claims?: string[]; invariants?: string[]; why?: string } = {},
): GraphNode {
  return {
    id: `c:${dir}`,
    label: o.label ?? dir,
    kind: "component",
    sub: o.intent,
    claimed: !!(o.claims && o.claims.length),
    claims: o.claims ?? [],
    invariants: o.invariants && o.invariants.length ? o.invariants : undefined,
    why: o.why,
  };
}

/** A symbol graph node — what a boundary claim's chokepoint resolves against. */
export function sym(name: string, path = "x.ts"): GraphNode {
  return { id: `s:${path}#${name}`, label: name, kind: "symbol", path, line: 1 };
}

export function graph(nodes: GraphNode[], edges: GraphEdge[] = []): Graph {
  return { generatedAt: "", root: "test", absRoot: "/test", nodes, edges, bindings: null };
}

/** A file graph node owned by component `dir` — what componentMap maps git paths against. */
export function fileNode(path: string, dir: string): GraphNode {
  return { id: `f:${path}`, label: path.split("/").pop() ?? path, kind: "file", path, parent: `c:${dir}` };
}

/** An `imports` edge between two file nodes — what the decompose fan-in (hubs) reads. */
export function imp(fromPath: string, toPath: string): GraphEdge {
  return { id: `f:${fromPath}->f:${toPath}:imports`, source: `f:${fromPath}`, target: `f:${toPath}`, kind: "imports" };
}
