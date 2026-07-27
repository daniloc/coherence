// dbt.ts — dbt contributes a graph; it is not a source-language parser.
//
// dbt owns the exact resource/dependency graph in target/manifest.json. Coherence
// normalizes that generated artifact into a small committed snapshot so `log` can
// reconstruct both sides of a git diff without installing or invoking dbt in its
// temporary worktrees. Project meaning (roles, grain, chokepoints, parity,
// multiplicity, filtering) stays in a separate sidecar and is checked against the graph.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Config, DbtParity, GraphEdge, GraphNode } from "../types.ts";
import { globToRe } from "../decompose.ts";

export interface DbtResource {
  uniqueId: string;
  resourceType: string;
  name: string;
  originalFilePath?: string;
  dependsOn: string[];
  columns: Array<{ name: string; dataType: string | null }>;
  materialized?: string;
  uniqueKey?: string | string[];
  incrementalStrategy?: string;
  contractEnforced?: boolean;
}

export interface DbtSnapshot {
  version: 1;
  project: string;
  resources: DbtResource[];
}

type Multiplicity = NonNullable<GraphEdge["dbt"]>["multiplicity"];
type Filtering = NonNullable<GraphEdge["dbt"]>["filtering"];

interface DbtSemantics {
  version: 1;
  scope?: string[];
  roles?: Record<string, string[]>;
  chokepoints?: string[];
  parities?: Record<string, {
    between: [string, string];
    via: string;
  }>;
  models?: Record<string, { grain?: string[] }>;
  relationships?: Array<{
    from: string;
    to: string;
    multiplicity: Multiplicity;
    filtering: Filtering;
    description?: string;
  }>;
}

interface RawResource {
  unique_id?: unknown;
  resource_type?: unknown;
  name?: unknown;
  original_file_path?: unknown;
  depends_on?: { nodes?: unknown };
  columns?: Record<string, { name?: unknown; data_type?: unknown }>;
  config?: {
    materialized?: unknown;
    unique_key?: unknown;
    incremental_strategy?: unknown;
    contract?: { enforced?: unknown };
  };
}

const RESOURCE_TYPES = new Set(["model", "source", "seed", "snapshot", "test"]);
const MULTIPLICITIES = new Set<Multiplicity>(["one-to-one", "one-to-many", "many-to-one", "many-to-many"]);
const FILTERING = new Set<Filtering>(["preserves", "narrows", "expands", "mixed"]);

const text = (v: unknown): string | undefined => typeof v === "string" ? v : undefined;

const uniqueKey = (v: unknown): string | string[] | undefined => {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return [...v];
  return undefined;
};

/** Pure, deterministic projection of dbt's large manifest onto Coherence structure. */
export function normalizeDbtManifest(raw: unknown): DbtSnapshot {
  if (!raw || typeof raw !== "object") throw new Error("dbt manifest must be an object");
  const manifest = raw as {
    metadata?: { project_name?: unknown };
    nodes?: Record<string, RawResource>;
    sources?: Record<string, RawResource>;
  };
  const resources: DbtResource[] = [];
  for (const candidate of [
    ...Object.values(manifest.nodes ?? {}),
    ...Object.values(manifest.sources ?? {}),
  ]) {
    const uniqueId = text(candidate.unique_id);
    const resourceType = text(candidate.resource_type);
    const name = text(candidate.name);
    if (!uniqueId || !resourceType || !name || !RESOURCE_TYPES.has(resourceType)) continue;
    const dependsOn = Array.isArray(candidate.depends_on?.nodes)
      ? candidate.depends_on!.nodes!.filter((x): x is string => typeof x === "string").sort()
      : [];
    const columns = Object.values(candidate.columns ?? {})
      .map((c) => ({
        name: text(c.name) ?? "",
        dataType: text(c.data_type) ?? null,
      }))
      .filter((c) => c.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    resources.push({
      uniqueId,
      resourceType,
      name,
      originalFilePath: text(candidate.original_file_path),
      dependsOn,
      columns,
      materialized: text(candidate.config?.materialized),
      uniqueKey: uniqueKey(candidate.config?.unique_key),
      incrementalStrategy: text(candidate.config?.incremental_strategy),
      contractEnforced: typeof candidate.config?.contract?.enforced === "boolean"
        ? candidate.config.contract.enforced
        : undefined,
    });
  }
  resources.sort((a, b) => a.uniqueId.localeCompare(b.uniqueId));
  return {
    version: 1,
    project: text(manifest.metadata?.project_name) ?? "",
    resources,
  };
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/** Rebuild-then-swap the committed snapshot; --check only compares. */
export async function syncDbtSnapshot(cfg: Config, check: boolean): Promise<number> {
  if (!cfg.dbt) {
    console.error("dbt: no config.dbt configured");
    return 1;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(cfg.root, cfg.dbt.manifest), "utf8"));
  } catch (error) {
    console.error(`dbt: cannot read ${cfg.dbt.manifest}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const next = json(normalizeDbtManifest(raw));
  const dest = join(cfg.root, cfg.dbt.snapshot);
  if (check) {
    const current = await readFile(dest, "utf8").catch(() => "");
    console.log(current === next ? "dbt snapshot current" : `stale: ${cfg.dbt.snapshot}`);
    return current === next ? 0 : 1;
  }
  await mkdir(dirname(dest), { recursive: true });
  const temporary = `${dest}.tmp-${process.pid}`;
  await writeFile(temporary, next);
  await rename(temporary, dest);
  console.log(`dbt: wrote ${cfg.dbt.snapshot}`);
  return 0;
}

const readJson = async <T>(path: string, label: string): Promise<T> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    throw new Error(`cannot read ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const matches = (resource: DbtResource, selector: string): boolean => {
  if (selector.startsWith("model:")) return resource.resourceType === "model" && resource.name === selector.slice(6);
  if (selector.startsWith("source:")) return resource.resourceType === "source" && resource.name === selector.slice(7);
  return !!resource.originalFilePath && globToRe(selector).test(resource.originalFilePath);
};

const modelByName = (resources: DbtResource[]): Map<string, DbtResource> => {
  const out = new Map<string, DbtResource>();
  const ambiguous = new Set<string>();
  for (const r of resources.filter((x) => x.resourceType === "model")) {
    if (out.has(r.name)) ambiguous.add(r.name);
    out.set(r.name, r);
  }
  if (ambiguous.size) throw new Error(`ambiguous dbt model name(s): ${[...ambiguous].sort().join(", ")}`);
  return out;
};

const testByName = (resources: DbtResource[], name: string): DbtResource | undefined => {
  const matches = resources.filter(
    (resource) => resource.resourceType === "test" && resource.name === name,
  );
  if (matches.length > 1) throw new Error(`ambiguous dbt test name "${name}"`);
  return matches[0];
};

export async function dbtGraphFragment(
  cfg: Config,
  existingNodes: GraphNode[],
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  if (!cfg.dbt) return { nodes: [], edges: [] };
  const snapshot = await readJson<DbtSnapshot>(join(cfg.root, cfg.dbt.snapshot), "dbt snapshot");
  const semantics = await readJson<DbtSemantics>(join(cfg.root, cfg.dbt.semantics), "dbt semantics");
  if (snapshot.version !== 1) throw new Error(`unsupported dbt snapshot version ${String((snapshot as { version?: unknown }).version)}`);
  if (semantics.version !== 1) throw new Error(`unsupported dbt semantics version ${String((semantics as { version?: unknown }).version)}`);

  const resources = snapshot.resources;
  const byId = new Map(resources.map((r) => [r.uniqueId, r]));
  const models = modelByName(resources);
  if (
    semantics.chokepoints !== undefined &&
    (
      !Array.isArray(semantics.chokepoints) ||
      semantics.chokepoints.some((name) => typeof name !== "string" || !name)
    )
  ) throw new Error("dbt chokepoints must contain non-empty model names");
  const chokepoints = new Map<string, DbtResource>();
  for (const name of new Set(semantics.chokepoints ?? [])) {
    const model = models.get(name);
    if (!model) throw new Error(`dbt chokepoint names unknown model "${name}"`);
    chokepoints.set(model.uniqueId, model);
  }

  // A chokepoint owns every upstream model reachable from it, stopping at other
  // chokepoints. Sources and tests stay public: the boundary governs model reuse,
  // not whether an internal model can be tested or where its raw data originated.
  const shadowedBy = new Map<string, Set<string>>();
  for (const chokepoint of chokepoints.values()) {
    const visit = (resource: DbtResource): void => {
      for (const dependencyId of resource.dependsOn) {
        const dependency = byId.get(dependencyId);
        if (!dependency || dependency.resourceType !== "model" || chokepoints.has(dependencyId)) continue;
        const owners = shadowedBy.get(dependencyId) ?? new Set<string>();
        if (owners.has(chokepoint.uniqueId)) continue;
        owners.add(chokepoint.uniqueId);
        shadowedBy.set(dependencyId, owners);
        visit(dependency);
      }
    };
    visit(chokepoint);
  }

  if (
    semantics.parities !== undefined &&
    (
      !semantics.parities ||
      typeof semantics.parities !== "object" ||
      Array.isArray(semantics.parities)
    )
  ) throw new Error("dbt parities must be an object keyed by invariant name");
  const paritiesByOracle = new Map<string, DbtParity[]>();
  for (const [name, declaration] of Object.entries(semantics.parities ?? {})) {
    if (!name.trim()) throw new Error("dbt parity names must be non-empty");
    if (
      !declaration ||
      typeof declaration !== "object" ||
      Array.isArray(declaration) ||
      Object.keys(declaration).some((key) => key !== "between" && key !== "via") ||
      !Array.isArray(declaration.between) ||
      declaration.between.length !== 2 ||
      declaration.between.some((model) => typeof model !== "string" || !model) ||
      declaration.between[0] === declaration.between[1] ||
      typeof declaration.via !== "string" ||
      !declaration.via
    ) throw new Error(`dbt parity "${name}" must declare two distinct models in "between" and one test in "via"`);
    const [leftName, rightName] = declaration.between;
    const left = models.get(leftName);
    const right = models.get(rightName);
    if (!left || !right)
      throw new Error(`dbt parity "${name}" names unknown model: ${leftName} ≡ ${rightName}`);
    const oracle = testByName(resources, declaration.via);
    if (!oracle)
      throw new Error(`dbt parity "${name}" names unknown test "${declaration.via}"`);
    if (!oracle.dependsOn.includes(left.uniqueId) || !oracle.dependsOn.includes(right.uniqueId))
      throw new Error(`dbt parity "${name}" oracle "${oracle.name}" does not depend on both ${left.name} and ${right.name}`);
    const current = paritiesByOracle.get(oracle.uniqueId) ?? [];
    current.push({
      name,
      left: left.uniqueId,
      right: right.uniqueId,
      oracle: oracle.name,
    });
    current.sort((a, b) => a.name.localeCompare(b.name));
    paritiesByOracle.set(oracle.uniqueId, current);
  }

  const roles = new Map<string, string[]>();
  for (const [role, selectors] of Object.entries(semantics.roles ?? {})) {
    if (!Array.isArray(selectors) || selectors.some((s) => typeof s !== "string"))
      throw new Error(`dbt role "${role}" must contain string selectors`);
    for (const selector of selectors) {
      const selected = resources.filter((r) => r.resourceType === "model" && matches(r, selector));
      if (!selected.length) throw new Error(`dbt role "${role}" selector "${selector}" matched no models`);
      for (const resource of selected) {
        const current = roles.get(resource.uniqueId) ?? [];
        if (!current.includes(role)) current.push(role);
        roles.set(resource.uniqueId, current);
      }
    }
  }
  for (const assigned of roles.values()) assigned.sort();

  const scoped = resources.filter((r) =>
    r.resourceType === "model" &&
    (semantics.scope ?? []).some((selector) => matches(r, selector))
  );
  const unclassified = scoped.filter((r) => !(roles.get(r.uniqueId)?.length));
  if (unclassified.length)
    throw new Error(`unclassified dbt model(s) in Coherence scope: ${unclassified.map((r) => r.name).sort().join(", ")}`);

  const grain = new Map<string, string[]>();
  for (const [name, declaration] of Object.entries(semantics.models ?? {})) {
    const model = models.get(name);
    if (!model) throw new Error(`dbt semantics declares unknown model "${name}"`);
    if (declaration.grain) {
      if (!Array.isArray(declaration.grain) || !declaration.grain.length || declaration.grain.some((c) => typeof c !== "string" || !c))
        throw new Error(`dbt model "${name}" has an invalid grain`);
      grain.set(model.uniqueId, [...new Set(declaration.grain)]);
    }
  }

  const fileIds = new Set(existingNodes.filter((n) => n.kind === "file").map((n) => n.id));
  const nodes: GraphNode[] = resources.map((r) => {
    const parent = r.originalFilePath && fileIds.has(`f:${r.originalFilePath}`) ? `f:${r.originalFilePath}` : undefined;
    const assignedRoles = roles.get(r.uniqueId) ?? [];
    const detail = [`dbt ${r.resourceType}`, ...assignedRoles].join(" · ");
    return {
      id: `d:${r.uniqueId}`,
      parent,
      label: r.name,
      kind: r.resourceType === "test" ? "dbt-test" : r.resourceType === "source" ? "external" : "symbol",
      sub: detail,
      path: r.originalFilePath,
      dbt: {
        uniqueId: r.uniqueId,
        resourceType: r.resourceType,
        dependsOn: [...r.dependsOn],
        columns: r.columns.map((c) => ({ ...c })),
        roles: assignedRoles,
        chokepoint: chokepoints.has(r.uniqueId) ? true : undefined,
        shadowedBy: shadowedBy.has(r.uniqueId) ? [...shadowedBy.get(r.uniqueId)!].sort() : undefined,
        parities: paritiesByOracle.get(r.uniqueId),
        grain: grain.get(r.uniqueId),
        materialized: r.materialized,
        uniqueKey: r.uniqueKey,
        incrementalStrategy: r.incrementalStrategy,
        contractEnforced: r.contractEnforced,
      },
    };
  });

  const edges: GraphEdge[] = [];
  for (const resource of resources) {
    for (const dep of resource.dependsOn) {
      if (!byId.has(dep)) continue;
      edges.push({
        id: `d:${resource.uniqueId}->d:${dep}:dbt-depends-on`,
        source: `d:${resource.uniqueId}`,
        target: `d:${dep}`,
        kind: "dbt-depends-on",
      });
    }
  }

  const relationshipKeys = new Set<string>();
  for (const relationship of semantics.relationships ?? []) {
    if (!MULTIPLICITIES.has(relationship.multiplicity))
      throw new Error(`invalid multiplicity "${String(relationship.multiplicity)}" for ${relationship.from} -> ${relationship.to}`);
    if (!FILTERING.has(relationship.filtering))
      throw new Error(`invalid filtering "${String(relationship.filtering)}" for ${relationship.from} -> ${relationship.to}`);
    const from = models.get(relationship.from);
    const to = models.get(relationship.to);
    if (!from || !to) throw new Error(`declared dbt relationship names unknown model: ${relationship.from} -> ${relationship.to}`);
    if (!to.dependsOn.includes(from.uniqueId))
      throw new Error(`declared dbt relationship ${relationship.from} -> ${relationship.to} is not a direct dependency`);
    const key = `${from.uniqueId}->${to.uniqueId}`;
    if (relationshipKeys.has(key)) throw new Error(`duplicate dbt relationship ${relationship.from} -> ${relationship.to}`);
    relationshipKeys.add(key);
    const edge = edges.find((e) =>
      e.source === `d:${to.uniqueId}` && e.target === `d:${from.uniqueId}` && e.kind === "dbt-depends-on"
    )!;
    edge.dbt = {
      multiplicity: relationship.multiplicity,
      filtering: relationship.filtering,
      description: relationship.description,
    };
  }
  return { nodes, edges };
}
