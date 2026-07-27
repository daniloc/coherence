import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildGraph } from "../src/derive.ts";
import {
  normalizeDbtManifest,
  syncDbtSnapshot,
  type DbtSnapshot,
} from "../src/adapters/dbt.ts";
import { dbtShadowReport } from "../src/dbt-shadows.ts";
import { diffGraphs } from "../src/structural.ts";
import { runVerify } from "../src/verify.ts";
import { cfg, cleanup, graph, runCaptured, tmpProject } from "./_helpers.ts";
import type { GraphEdge, GraphNode } from "../src/types.ts";

const rawManifest = {
  metadata: { project_name: "money", dbt_schema_version: "v12" },
  nodes: {
    "model.money.usage": {
      unique_id: "model.money.usage",
      resource_type: "model",
      name: "usage",
      original_file_path: "models/usage.sql",
      depends_on: { nodes: ["source.money.billing.usage"] },
      columns: {
        usage_id: { name: "usage_id", data_type: "text" },
        amount: { name: "amount", data_type: "numeric" },
      },
      config: {
        materialized: "incremental",
        unique_key: "usage_id",
        incremental_strategy: "delete+insert",
        contract: { enforced: true },
      },
    },
    "model.money.revenue_entries": {
      unique_id: "model.money.revenue_entries",
      resource_type: "model",
      name: "revenue_entries",
      original_file_path: "models/revenue_entries.sql",
      depends_on: { nodes: ["model.money.usage"] },
      columns: {
        entry_id: { name: "entry_id", data_type: "text" },
      },
      config: { materialized: "table", contract: { enforced: false } },
    },
    "test.money.revenue_entries_balance": {
      unique_id: "test.money.revenue_entries_balance",
      resource_type: "test",
      name: "revenue_entries_balance",
      original_file_path: "tests/revenue_entries_balance.sql",
      depends_on: { nodes: ["model.money.revenue_entries", "model.money.usage"] },
      columns: {},
      config: { materialized: "test", severity: "ERROR" },
      test_metadata: null,
    },
  },
  sources: {
    "source.money.billing.usage": {
      unique_id: "source.money.billing.usage",
      resource_type: "source",
      name: "usage",
      source_name: "billing",
      original_file_path: "models/sources.yml",
      columns: {
        usage_id: { name: "usage_id", data_type: "text" },
      },
      config: {},
    },
  },
};

const semantics = {
  version: 1,
  scope: ["models/**"],
  roles: {
    Fact: ["model:usage"],
    LedgerEntryProducer: ["model:revenue_entries"],
    UsageRecognition: ["model:revenue_entries"],
  },
  models: {
    usage: { grain: ["usage_id"] },
    revenue_entries: { grain: ["entry_id"] },
  },
  parities: {
    "usage translation": {
      between: ["usage", "revenue_entries"],
      via: "revenue_entries_balance",
    },
  },
  relationships: [
    {
      from: "usage",
      to: "revenue_entries",
      multiplicity: "one-to-many",
      filtering: "narrows",
      description: "Only non-zero usage becomes ledger legs.",
    },
  ],
};

const snapshotText = () => JSON.stringify(normalizeDbtManifest(rawManifest), null, 2) + "\n";

test("normalizeDbtManifest keeps deterministic structure, not compiled SQL", () => {
  const snapshot = normalizeDbtManifest({
    ...rawManifest,
    nodes: {
      ...rawManifest.nodes,
      "model.money.usage": {
        ...rawManifest.nodes["model.money.usage"],
        raw_code: "select * from source",
        compiled_code: "select * from prod.source",
      },
    },
  });

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.project, "money");
  assert.deepEqual(snapshot.resources.map((r) => r.uniqueId), [
    "model.money.revenue_entries",
    "model.money.usage",
    "source.money.billing.usage",
    "test.money.revenue_entries_balance",
  ]);
  const usage = snapshot.resources.find((r) => r.name === "usage" && r.resourceType === "model")!;
  assert.deepEqual(usage.columns, [
    { name: "amount", dataType: "numeric" },
    { name: "usage_id", dataType: "text" },
  ]);
  assert.equal(usage.materialized, "incremental");
  assert.equal(usage.contractEnforced, true);
  assert.equal("rawCode" in usage, false);
});

test("dbt graph contributes models, dependencies, roles, grain, and relationship meaning", async () => {
  const root = await tmpProject({
    "money.spec.md": "# Money\nRevenue facts.\n\n## works when\n- typechecks\n\n## why\nThe ledger is authoritative.\n",
    "models/usage.sql": "select 1",
    "models/revenue_entries.sql": "select 1",
    "tests/revenue_entries_balance.sql": "select 1 where false",
    ".coherence/dbt-manifest.json": snapshotText(),
    "coherence.dbt.json": JSON.stringify(semantics),
  });
  try {
    const g = await buildGraph(cfg(root, {
      codeExt: ["sql"],
      dbt: {
        manifest: "target/manifest.json",
        snapshot: ".coherence/dbt-manifest.json",
        semantics: "coherence.dbt.json",
      },
    }));
    const entry = g.nodes.find((n) => n.dbt?.uniqueId === "model.money.revenue_entries")!;
    assert.equal(entry.kind, "symbol");
    assert.equal(entry.label, "revenue_entries");
    assert.deepEqual(entry.dbt?.roles, ["LedgerEntryProducer", "UsageRecognition"]);
    assert.deepEqual(entry.dbt?.grain, ["entry_id"]);
    const oracle = g.nodes.find((n) => n.dbt?.uniqueId === "test.money.revenue_entries_balance")!;
    assert.deepEqual(oracle.dbt?.parities, [{
      name: "usage translation",
      left: "model.money.usage",
      right: "model.money.revenue_entries",
      oracle: "revenue_entries_balance",
    }]);

    const edge = g.edges.find((e) =>
      e.source === "d:model.money.revenue_entries" &&
      e.target === "d:model.money.usage"
    )!;
    assert.equal(edge.kind, "dbt-depends-on");
    assert.deepEqual(edge.dbt, {
      multiplicity: "one-to-many",
      filtering: "narrows",
      description: "Only non-zero usage becomes ledger legs.",
    });
  } finally {
    await cleanup(root);
  }
});

test("dbt parity fails closed unless its oracle directly spans both models", async () => {
  const oneSidedManifest = {
    ...rawManifest,
    nodes: {
      ...rawManifest.nodes,
      "test.money.revenue_entries_balance": {
        ...rawManifest.nodes["test.money.revenue_entries_balance"],
        depends_on: { nodes: ["model.money.revenue_entries"] },
      },
    },
  };
  const root = await tmpProject({
    ".coherence/dbt-manifest.json":
      JSON.stringify(normalizeDbtManifest(oneSidedManifest)),
    "coherence.dbt.json": JSON.stringify(semantics),
  });
  try {
    await assert.rejects(
      buildGraph(cfg(root, {
        dbt: {
          manifest: "target/manifest.json",
          snapshot: ".coherence/dbt-manifest.json",
          semantics: "coherence.dbt.json",
        },
      })),
      /dbt parity "usage translation" oracle "revenue_entries_balance" does not depend on both usage and revenue_entries/,
    );
  } finally {
    await cleanup(root);
  }
});

test("dbt parity fails closed when its oracle is absent", async () => {
  const root = await tmpProject({
    ".coherence/dbt-manifest.json": snapshotText(),
    "coherence.dbt.json": JSON.stringify({
      ...semantics,
      parities: {
        "usage translation": {
          between: ["usage", "revenue_entries"],
          via: "missing_test",
        },
      },
    }),
  });
  try {
    await assert.rejects(
      buildGraph(cfg(root, {
        dbt: {
          manifest: "target/manifest.json",
          snapshot: ".coherence/dbt-manifest.json",
          semantics: "coherence.dbt.json",
        },
      })),
      /dbt parity "usage translation" names unknown test "missing_test"/,
    );
  } finally {
    await cleanup(root);
  }
});

test("coherence verify executes declared dbt parity oracles", async () => {
  const root = await tmpProject({
    "money.spec.md": "# Money\nRevenue facts.\n\n## works when\n- typechecks\n\n## why\nReason.\n",
    ".coherence/dbt-manifest.json": snapshotText(),
    "coherence.dbt.json": JSON.stringify(semantics),
    "runner.js": "console.log('COHERENCE_TEST_PASSED', process.argv[2]);\n",
    "failing-runner.js": "process.exit(1);\n",
  });
  try {
    const config = cfg(root, {
      test: ["node", join(root, "runner.js")],
      testMatch: "COHERENCE_TEST_PASSED",
      dbt: {
        manifest: "target/manifest.json",
        snapshot: ".coherence/dbt-manifest.json",
        semantics: "coherence.dbt.json",
      },
    });
    const g = await buildGraph(config);

    const green = await runCaptured(() => runVerify(config, g, { fast: false }));
    assert.equal(green.code, 0);
    assert.match(green.out, /dbt parity: 1 declared · 1 green · 0 red/);
    assert.match(green.out, /✓ \[dbt parity\] usage translation: usage ≡ revenue_entries via revenue_entries_balance/);

    const red = await runCaptured(() =>
      runVerify({
        ...config,
        test: ["node", join(root, "failing-runner.js")],
      }, g, { fast: false })
    );
    assert.equal(red.code, 1);
    assert.match(red.out, /dbt parity: 1 declared · 0 green · 1 red/);

    const noRunner = await runCaptured(() =>
      runVerify({ ...config, test: [] }, g, { fast: false })
    );
    assert.equal(noRunner.code, 1);
    assert.match(noRunner.out, /no test runner configured/);
  } finally {
    await cleanup(root);
  }
});

test("dbt semantics fail closed on unclassified in-scope models", async () => {
  const root = await tmpProject({
    "money.spec.md": "# Money\nRevenue facts.\n\n## works when\n- typechecks\n\n## why\nReason.\n",
    "models/usage.sql": "select 1",
    "models/revenue_entries.sql": "select 1",
    ".coherence/dbt-manifest.json": snapshotText(),
    "coherence.dbt.json": JSON.stringify({
      ...semantics,
      roles: { Fact: ["model:usage"] },
    }),
  });
  try {
    await assert.rejects(
      buildGraph(cfg(root, {
        codeExt: ["sql"],
        dbt: {
          manifest: "target/manifest.json",
          snapshot: ".coherence/dbt-manifest.json",
          semantics: "coherence.dbt.json",
        },
      })),
      /unclassified dbt model.*revenue_entries/,
    );
  } finally {
    await cleanup(root);
  }
});

test("dbt semantics fail closed when a role selector matches nothing", async () => {
  const root = await tmpProject({
    "money.spec.md": "# Money\nRevenue facts.\n\n## works when\n- typechecks\n\n## why\nReason.\n",
    "models/usage.sql": "select 1",
    "models/revenue_entries.sql": "select 1",
    ".coherence/dbt-manifest.json": snapshotText(),
    "coherence.dbt.json": JSON.stringify({
      ...semantics,
      roles: {
        ...semantics.roles,
        Typo: ["model:missing_model"],
      },
    }),
  });
  try {
    await assert.rejects(
      buildGraph(cfg(root, {
        codeExt: ["sql"],
        dbt: {
          manifest: "target/manifest.json",
          snapshot: ".coherence/dbt-manifest.json",
          semantics: "coherence.dbt.json",
        },
      })),
      /dbt role "Typo" selector "model:missing_model" matched no models/,
    );
  } finally {
    await cleanup(root);
  }
});

test("dbt semantics fail closed when a declared relationship is not a real dependency", async () => {
  const root = await tmpProject({
    "money.spec.md": "# Money\nRevenue facts.\n\n## works when\n- typechecks\n\n## why\nReason.\n",
    "models/usage.sql": "select 1",
    "models/revenue_entries.sql": "select 1",
    ".coherence/dbt-manifest.json": snapshotText(),
    "coherence.dbt.json": JSON.stringify({
      ...semantics,
      relationships: [{
        from: "revenue_entries",
        to: "usage",
        multiplicity: "many-to-one",
        filtering: "preserves",
      }],
    }),
  });
  try {
    await assert.rejects(
      buildGraph(cfg(root, {
        codeExt: ["sql"],
        dbt: {
          manifest: "target/manifest.json",
          snapshot: ".coherence/dbt-manifest.json",
          semantics: "coherence.dbt.json",
        },
      })),
      /declared dbt relationship.*is not a direct dependency/,
    );
  } finally {
    await cleanup(root);
  }
});

const shadowManifest = {
  version: 1 as const,
  project: "money",
  resources: [
    {
      uniqueId: "model.money.a",
      resourceType: "model",
      name: "a",
      originalFilePath: "models/a.sql",
      dependsOn: [],
      columns: [],
    },
    {
      uniqueId: "model.money.b",
      resourceType: "model",
      name: "b",
      originalFilePath: "models/b.sql",
      dependsOn: ["model.money.a"],
      columns: [],
    },
    {
      uniqueId: "model.money.c",
      resourceType: "model",
      name: "c",
      originalFilePath: "models/c.sql",
      dependsOn: ["model.money.a", "model.money.b"],
      columns: [],
    },
    {
      uniqueId: "model.money.d",
      resourceType: "model",
      name: "d",
      originalFilePath: "models/d.sql",
      dependsOn: ["model.money.c"],
      columns: [],
    },
    {
      uniqueId: "model.money.e",
      resourceType: "model",
      name: "e",
      originalFilePath: "models/e.sql",
      dependsOn: ["model.money.a", "model.money.c"],
      columns: [],
    },
  ],
};

const shadowSemantics = {
  version: 1,
  scope: ["models/**"],
  roles: { Model: ["models/**"] },
  chokepoints: ["c"],
};

test("a dbt chokepoint hides its upstream shadow from outside consumers", async () => {
  const root = await tmpProject({
    "money.spec.md": "# Money\nRevenue facts.\n\n## works when\n- typechecks\n\n## why\nReason.\n",
    ".coherence/dbt-manifest.json": JSON.stringify(shadowManifest),
    "coherence.dbt.json": JSON.stringify(shadowSemantics),
  });
  try {
    const g = await buildGraph(cfg(root, {
      dbt: {
        manifest: "target/manifest.json",
        snapshot: ".coherence/dbt-manifest.json",
        semantics: "coherence.dbt.json",
      },
    }));
    const byName = new Map(
      g.nodes.filter((n) => n.dbt?.resourceType === "model").map((n) => [n.label, n]),
    );

    assert.equal(byName.get("c")?.dbt?.chokepoint, true);
    assert.deepEqual(byName.get("a")?.dbt?.shadowedBy, ["model.money.c"]);
    assert.deepEqual(byName.get("b")?.dbt?.shadowedBy, ["model.money.c"]);
    assert.equal(byName.get("d")?.dbt?.shadowedBy, undefined);

    const report = dbtShadowReport(g);
    assert.equal(report.chokepoints, 1);
    assert.equal(report.privateModels, 2);
    assert.deepEqual(report.violations, [{
      chokepoint: "c",
      consumer: "e",
      privateModel: "a",
    }]);

    const result = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(result.code, 1);
    assert.match(result.out, /dbt shadows: 1 chokepoint · 2 private models · 1 bypass/);
    assert.match(result.out, /\[dbt shadow\] e depends on a, which is private behind c; depend on c instead/);
  } finally {
    await cleanup(root);
  }
});

test("dbt chokepoints fail closed when they name an unknown model", async () => {
  const root = await tmpProject({
    ".coherence/dbt-manifest.json": JSON.stringify(shadowManifest),
    "coherence.dbt.json": JSON.stringify({
      ...shadowSemantics,
      chokepoints: ["missing"],
    }),
  });
  try {
    await assert.rejects(
      buildGraph(cfg(root, {
        dbt: {
          manifest: "target/manifest.json",
          snapshot: ".coherence/dbt-manifest.json",
          semantics: "coherence.dbt.json",
        },
      })),
      /dbt chokepoint names unknown model "missing"/,
    );
  } finally {
    await cleanup(root);
  }
});

test("syncDbtSnapshot writes and checks the normalized manifest", async () => {
  const root = await tmpProject({
    "target/manifest.json": JSON.stringify(rawManifest),
  });
  const config = cfg(root, {
    dbt: {
      manifest: "target/manifest.json",
      snapshot: ".coherence/dbt-manifest.json",
      semantics: "coherence.dbt.json",
    },
  });
  try {
    assert.equal(await syncDbtSnapshot(config, false), 0);
    const written = JSON.parse(await readFile(join(root, ".coherence/dbt-manifest.json"), "utf8")) as DbtSnapshot;
    assert.equal(written.resources.length, 4);
    assert.equal(await syncDbtSnapshot(config, true), 0);
  } finally {
    await cleanup(root);
  }
});

const dbtNode = (
  uniqueId: string,
  over: Partial<NonNullable<GraphNode["dbt"]>> = {},
): GraphNode => ({
  id: `d:${uniqueId}`,
  kind: uniqueId.startsWith("test.") ? "dbt-test" : "symbol",
  label: uniqueId.split(".").at(-1)!,
  dbt: {
    uniqueId,
    resourceType: uniqueId.split(".")[0],
    dependsOn: [],
    columns: [],
    roles: [],
    ...over,
  },
});

test("structural dbt diff explains dependencies, columns, grain, and relationship rewiring", () => {
  const beforeNode = dbtNode("model.money.entries", {
    dependsOn: ["model.money.usage"],
    columns: [{ name: "entry_id", dataType: "text" }],
    roles: ["LedgerEntryProducer"],
    grain: ["entry_id"],
  });
  const afterNode = dbtNode("model.money.entries", {
    dependsOn: ["model.money.usage", "model.money.discounts"],
    columns: [
      { name: "entry_id", dataType: "text" },
      { name: "discount_id", dataType: "text" },
    ],
    roles: ["LedgerEntryProducer"],
    grain: ["entry_id", "discount_id"],
  });
  const edge = (multiplicity: NonNullable<GraphEdge["dbt"]>["multiplicity"]): GraphEdge => ({
    id: "d:model.money.entries->d:model.money.usage:dbt-depends-on",
    source: "d:model.money.entries",
    target: "d:model.money.usage",
    kind: "dbt-depends-on",
    dbt: { multiplicity, filtering: "narrows" },
  });
  const before = graph([beforeNode, dbtNode("model.money.usage")], [edge("one-to-many")]);
  const after = graph([
    afterNode,
    dbtNode("model.money.usage"),
    dbtNode("model.money.discounts"),
  ], [edge("many-to-many")]);

  const d = diffGraphs(before, after);
  assert.equal(d.dbtChanged.length, 1);
  assert.deepEqual(d.dbtChanged[0].dependenciesAdded, ["model.money.discounts"]);
  assert.deepEqual(d.dbtChanged[0].columnsAdded, ["discount_id:text"]);
  assert.deepEqual(d.dbtChanged[0].grainBefore, ["entry_id"]);
  assert.deepEqual(d.dbtChanged[0].grainAfter, ["entry_id", "discount_id"]);
  assert.equal(d.dbtRelationshipsRewired.length, 1);
  assert.equal(d.dbtRelationshipsRewired[0].source, "entries");
  assert.equal(d.dbtRelationshipsRewired[0].target, "usage");
  assert.equal(d.dbtRelationshipsRewired[0].before.multiplicity, "one-to-many");
  assert.equal(d.dbtRelationshipsRewired[0].after.multiplicity, "many-to-many");
});

test("structural dbt diff treats removed parity as a loss", async () => {
  const oracle = dbtNode("test.money.usage_translation", {
    parities: [{
      name: "usage translation",
      left: "model.money.usage",
      right: "model.money.entries",
      oracle: "usage_translation",
    }],
  });
  const withoutParity = dbtNode("test.money.usage_translation");
  const before = graph([
    dbtNode("model.money.usage"),
    dbtNode("model.money.entries"),
    oracle,
  ]);
  const after = graph([
    dbtNode("model.money.usage"),
    dbtNode("model.money.entries"),
    withoutParity,
  ]);

  const d = diffGraphs(before, after);
  assert.deepEqual(d.dbtParitiesRemoved, [{
    name: "usage translation",
    left: "usage",
    right: "entries",
    oracle: "usage_translation",
  }]);
  const result = await runCaptured(async () => (
    await import("../src/structural.ts")
  ).renderDiff(d, "before", "after"));
  assert.equal(result.code, 1);
  assert.match(result.out, /dbt parity "usage translation".*AGREEMENT ANCHOR REMOVED/);
});
