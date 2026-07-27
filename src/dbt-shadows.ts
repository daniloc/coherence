import type { Graph } from "./types.ts";

export interface DbtShadowViolation {
  chokepoint: string;
  consumer: string;
  privateModel: string;
}

export interface DbtShadowReport {
  chokepoints: number;
  privateModels: number;
  violations: DbtShadowViolation[];
}

/**
 * Check the visibility boundary encoded by dbt chokepoint shadows.
 *
 * dbt dependency edges point from consumer to dependency. A dependency hidden
 * behind C may therefore be read only by C itself or by another model in C's
 * shadow. Tests are deliberately outside this rule: testing an internal model
 * does not make it part of the project's public data interface.
 */
export function dbtShadowReport(graph: Graph): DbtShadowReport {
  const dbtNodes = graph.nodes.filter((node) => node.dbt);
  const byId = new Map(dbtNodes.map((node) => [node.id, node]));
  const byUniqueId = new Map(dbtNodes.map((node) => [node.dbt!.uniqueId, node]));
  const violations: DbtShadowViolation[] = [];

  for (const edge of graph.edges) {
    if (edge.kind !== "dbt-depends-on") continue;
    const consumer = byId.get(edge.source);
    const dependency = byId.get(edge.target);
    if (
      consumer?.dbt?.resourceType !== "model" ||
      dependency?.dbt?.resourceType !== "model"
    ) continue;

    for (const chokepointId of dependency.dbt.shadowedBy ?? []) {
      const consumerInside =
        consumer.dbt.uniqueId === chokepointId ||
        consumer.dbt.shadowedBy?.includes(chokepointId);
      if (consumerInside) continue;
      violations.push({
        chokepoint: byUniqueId.get(chokepointId)?.label ?? chokepointId,
        consumer: consumer.label,
        privateModel: dependency.label,
      });
    }
  }

  violations.sort((a, b) =>
    a.chokepoint.localeCompare(b.chokepoint) ||
    a.consumer.localeCompare(b.consumer) ||
    a.privateModel.localeCompare(b.privateModel)
  );
  return {
    chokepoints: dbtNodes.filter((node) => node.dbt?.chokepoint).length,
    privateModels: dbtNodes.filter((node) => node.dbt?.shadowedBy?.length).length,
    violations,
  };
}
