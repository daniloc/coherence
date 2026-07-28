import type { Graph } from "./types.ts";

export interface DbtShadowViolation {
  chokepoint: string;
  consumer: string;
  privateModel: string;
}

export interface DbtObserverViolation {
  observer: string;
  consumer: string;
}

export interface DbtShadowReport {
  chokepoints: number;
  privateModels: number;
  observers: number;
  violations: DbtShadowViolation[];
  observerViolations: DbtObserverViolation[];
}

/**
 * Check the visibility boundary encoded by dbt chokepoint shadows.
 *
 * dbt dependency edges point from consumer to dependency. A dependency hidden
 * behind C may therefore be reused by upstream peer branches, but a model
 * downstream of C must not bypass C and read that dependency directly. Tests
 * are deliberately outside this rule: testing an internal model does not make
 * it part of the project's public data interface.
 */
export function dbtShadowReport(graph: Graph): DbtShadowReport {
  const dbtNodes = graph.nodes.filter((node) => node.dbt);
  const byId = new Map(dbtNodes.map((node) => [node.id, node]));
  const byUniqueId = new Map(dbtNodes.map((node) => [node.dbt!.uniqueId, node]));
  const consumersByDependency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== "dbt-depends-on") continue;
    const consumers = consumersByDependency.get(edge.target) ?? [];
    consumers.push(edge.source);
    consumersByDependency.set(edge.target, consumers);
  }
  const downstreamByChokepoint = new Map<string, Set<string>>();
  for (const chokepoint of dbtNodes.filter((node) => node.dbt?.chokepoint)) {
    const downstream = new Set<string>();
    const pending = [...(consumersByDependency.get(chokepoint.id) ?? [])];
    while (pending.length) {
      const consumerId = pending.pop()!;
      const consumer = byId.get(consumerId);
      if (consumer?.dbt?.resourceType !== "model" || downstream.has(consumerId)) continue;
      downstream.add(consumerId);
      pending.push(...(consumersByDependency.get(consumerId) ?? []));
    }
    downstreamByChokepoint.set(chokepoint.dbt!.uniqueId, downstream);
  }
  const violations: DbtShadowViolation[] = [];
  const observerViolations: DbtObserverViolation[] = [];

  for (const edge of graph.edges) {
    if (edge.kind !== "dbt-depends-on") continue;
    const consumer = byId.get(edge.source);
    const dependency = byId.get(edge.target);
    if (
      consumer?.dbt?.resourceType !== "model" ||
      dependency?.dbt?.resourceType !== "model"
    ) continue;

    if (dependency.dbt.observer) {
      observerViolations.push({
        observer: dependency.label,
        consumer: consumer.label,
      });
    }
    if (consumer.dbt.observer) continue;

    for (const chokepointId of dependency.dbt.shadowedBy ?? []) {
      const consumerDownstream = downstreamByChokepoint.get(chokepointId)?.has(consumer.id);
      if (!consumerDownstream) continue;
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
  observerViolations.sort((a, b) =>
    a.observer.localeCompare(b.observer) ||
    a.consumer.localeCompare(b.consumer)
  );
  return {
    chokepoints: dbtNodes.filter((node) => node.dbt?.chokepoint).length,
    privateModels: dbtNodes.filter((node) => node.dbt?.shadowedBy?.length).length,
    observers: dbtNodes.filter((node) => node.dbt?.observer).length,
    violations,
    observerViolations,
  };
}
