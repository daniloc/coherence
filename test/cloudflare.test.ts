// cloudflare.test.ts — the platform graph describes the capability surface the code
// is built to use, not whichever optional bindings happen to be enabled in one
// developer's working wrangler file.
//
// The measured failure came from Mnemion's optional DOCUMENTS bucket. Its committed
// Env declaration names `DOCUMENTS?: R2Bucket`, while the shipped wrangler.toml keeps
// the R2 block commented until an operator provisions the bucket. Docs generated in an
// enabled checkout therefore carried i:DOCUMENTS and its binds edges; the same commit in
// a clean clone silently lost them and failed the freshness gate. The generated
// worker-configuration.d.ts reflects that same local toggle, so it must stay outside the
// declared source population rather than becoming a second machine-local authority.
// The 0.36.3 follow-up found one remaining value channel: bindings.vars copied
// WORKER_HOST from the working Wrangler file into every generated artifact. Variable
// names are architecture; per-machine deployment values are not.
import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "../src/derive.ts";
import { renderOverview } from "../src/render-overview.ts";
import type { Graph } from "../src/types.ts";
import { cfg, cleanup, tmpProject } from "./_helpers.ts";

const SPEC = "# App\n\nA Cloudflare worker.\n";
const ENV_SOURCE = `
export interface Env {
  DOCUMENTS?: R2Bucket;
}

export function fetchDocument(env: Env) {
  return env.DOCUMENTS?.get("one");
}
`;

const WRANGLER_BASE = `
main = "src/worker.ts"
compatibility_date = "2026-08-20"

[vars]
WORKER_HOST = "your-worker.workers.dev"

[[kv_namespaces]]
binding = "OAUTH_KV"

[[vectorize]]
binding = "VECTORIZE"
index_name = "vectors"

[ai]
binding = "AI"
`;

const R2_BLOCK = `

[[r2_buckets]]
binding = "DOCUMENTS"
bucket_name = "documents"
`;

const D1_BLOCK = `

[[d1_databases]]
binding = "APP_DB"
database_name = "local-app-db"
database_id = "local-only-id"
`;

function platformProjection(graph: Graph) {
  return {
    bindings: graph.bindings,
    nodes: graph.nodes.filter((node) => node.kind === "infra"),
    edges: graph.edges.filter((edge) => edge.kind === "binds"),
  };
}

async function cloudflareGraph(wrangler: string, extra: Record<string, string> = {}) {
  const root = await tmpProject({
    "App.spec.md": SPEC,
    "src/worker.ts": ENV_SOURCE,
    "wrangler.toml": wrangler,
    ...extra,
  });
  try {
    return await buildGraph(cfg(root, {
      platform: "cloudflare",
      ignore: ["node_modules", ".git", "dist", "worker-configuration.d.ts"],
    }));
  } finally {
    await cleanup(root);
  }
}

test("Cloudflare bindings — committed Env capability is stable across optional wrangler toggles", async () => {
  const generatedLocalState = {
    // This is exactly the surface `wrangler types` varies with local deployment
    // configuration. If the platform adapter walks independently of derive.ts, this
    // ignored declaration leaks into the graph and the negative control catches it.
    "worker-configuration.d.ts": "interface Env { LOCAL_ONLY: D1Database }\n",
  };
  const disabled = await cloudflareGraph(WRANGLER_BASE, generatedLocalState);
  const enabled = await cloudflareGraph(
    (WRANGLER_BASE + R2_BLOCK).replace("your-worker.workers.dev", "mnemion.workers.dev"),
    generatedLocalState,
  );

  assert.deepEqual(platformProjection(disabled), platformProjection(enabled),
    "deployment values and optional R2 state cannot perturb the committed platform projection");
  assert.deepEqual(disabled.bindings?.vars, { WORKER_HOST: "declared" },
    "the variable name remains architectural while its deployment value is discarded");
  const surfaces = renderOverview(enabled, "test");
  for (const bytes of [JSON.stringify(enabled), surfaces.md, surfaces.html]) {
    assert.match(bytes, /WORKER_HOST/, "the declared variable name disappeared with its value");
    assert.doesNotMatch(bytes, /your-worker\.workers\.dev|mnemion\.workers\.dev/,
      "a working-tree deployment value escaped into a committed reading surface");
  }
  assert.deepEqual(disabled.bindings?.stores.map(({ binding, sub }) => [binding, sub]), [
    ["AI", "Workers AI"],
    ["DOCUMENTS", "R2"],
    ["OAUTH_KV", "KV"],
    ["VECTORIZE", "Vectorize"],
  ], "the union has one canonical order rather than inheriting wrangler/source insertion order");
  assert.ok(disabled.nodes.some((node) => node.id === "i:DOCUMENTS"),
    "the committed direct Env declaration owns the optional infra node in a clean clone");
  assert.ok(disabled.edges.some((edge) => edge.id === "f:src/worker.ts->i:DOCUMENTS:binds"),
    "ordinary env use ties the source file to the source-derived infra node");
  assert.ok(!disabled.nodes.some((node) => node.id === "i:LOCAL_ONLY"),
    "a generated file excluded by the declared walk cannot become platform authority");
});

test("Cloudflare bindings — source and wrangler refuse the same binding with different kinds", async () => {
  const conflict = `
main = "src/worker.ts"

[[kv_namespaces]]
binding = "DOCUMENTS"
`;
  await assert.rejects(() => cloudflareGraph(conflict),
    /DOCUMENTS.*KV.*R2|DOCUMENTS.*R2.*KV/,
    "silently choosing either declaration would turn a contradiction into a plausible graph");
});

test("Cloudflare bindings — comments, strings, and non-Env interfaces do not invent stores", async () => {
  const graph = await cloudflareGraph(WRANGLER_BASE, {
    "src/decoys.ts": `
// interface Env { COMMENT_ONLY: R2Bucket }
export const text = "interface Env { STRING_ONLY: R2Bucket }";
interface NotEnv { WRONG_SCOPE: R2Bucket }
`,
  });
  for (const binding of ["COMMENT_ONLY", "STRING_ONLY", "WRONG_SCOPE"]) {
    assert.ok(!graph.nodes.some((node) => node.id === `i:${binding}`),
      `${binding} is text or the wrong declaration scope, not a Cloudflare Env capability`);
  }
});

test("Cloudflare bindings — direct Env properties recognize the adapter's five store kinds", async () => {
  const graph = await cloudflareGraph(WRANGLER_BASE, {
    "src/store-kinds.ts": `
interface Env {
  APP_DB: D1Database;
  CACHE: KVNamespace;
  SEARCH: VectorizeIndex;
  BLOBS: R2Bucket | undefined;
  EMBEDDINGS: Ai;
  ASSETS: Fetcher;
}
`,
  });
  const stores = new Map(graph.bindings?.stores.map((store) => [store.binding, store.sub]));
  assert.deepEqual(Object.fromEntries(
    ["APP_DB", "CACHE", "SEARCH", "BLOBS", "EMBEDDINGS"].map((binding) => [binding, stores.get(binding)]),
  ), {
    APP_DB: "D1",
    CACHE: "KV",
    SEARCH: "Vectorize",
    BLOBS: "R2",
    EMBEDDINGS: "Workers AI",
  });
  assert.equal(stores.has("ASSETS"), false,
    "the source grade adds only resource families the existing adapter represents");
});

test("Cloudflare bindings — D1 metadata cannot perturb the canonical store kind", async () => {
  const source = {
    "src/database.ts": "interface Env { APP_DB: D1Database }\n",
  };
  const disabled = await cloudflareGraph(WRANGLER_BASE, source);
  const enabled = await cloudflareGraph(WRANGLER_BASE + D1_BLOCK, source);
  assert.deepEqual(platformProjection(disabled), platformProjection(enabled),
    "a provisioned database name/id is deployment metadata, not graph identity or display shape");
  assert.equal(disabled.bindings?.stores.find((store) => store.binding === "APP_DB")?.sub, "D1");
  assert.equal(enabled.bindings?.stores.find((store) => store.binding === "APP_DB")?.sub, "D1");
});

test("Cloudflare bindings — declare global Cloudflare.Env is a direct capability declaration", async () => {
  const graph = await cloudflareGraph(WRANGLER_BASE, {
    "src/cloudflare-env.d.ts": `
export {};
declare global {
  namespace Cloudflare {
    interface Env {
      GLOBAL_DOCUMENTS?: R2Bucket;
    }
  }
}
`,
  });
  assert.equal(graph.bindings?.stores.filter((store) => store.binding === "GLOBAL_DOCUMENTS").length, 1);
  assert.ok(graph.nodes.some((node) => node.id === "i:GLOBAL_DOCUMENTS"),
    "Mnemion's committed global augmentation is inside the accepted Cloudflare.Env scope");
});

test("Cloudflare bindings — local and foreign Env interfaces cannot mint infrastructure", async () => {
  const graph = await cloudflareGraph(WRANGLER_BASE, {
    "src/false-authority.ts": `
namespace ForeignPlatform {
  interface Env { FOREIGN_BUCKET: R2Bucket }
}

export function localDeclarations() {
  interface Env { FUNCTION_BUCKET: R2Bucket }
  if (true) {
    interface Env { BLOCK_BUCKET: R2Bucket }
  }
}
`,
  });
  for (const binding of ["FOREIGN_BUCKET", "FUNCTION_BUCKET", "BLOCK_BUCKET"]) {
    assert.ok(!graph.nodes.some((node) => node.id === `i:${binding}`),
      `${binding} is not a module Env or Cloudflare.Env declaration`);
  }
});

test("Cloudflare bindings — the same direct kind across three files collapses exactly once", async () => {
  const graph = await cloudflareGraph(WRANGLER_BASE, {
    "src/env-a.ts": "interface Env { SHARED_BUCKET: R2Bucket }\n",
    "src/env-b.ts": "export interface Env { SHARED_BUCKET?: R2Bucket }\n",
    "src/env-c.d.ts": "declare interface Env { SHARED_BUCKET: R2Bucket | undefined }\n",
  });
  assert.equal(graph.bindings?.stores.filter((store) => store.binding === "SHARED_BUCKET").length, 1,
    "interface merging across files is one capability, not three insertion-order artifacts");
  assert.equal(graph.nodes.filter((node) => node.id === "i:SHARED_BUCKET").length, 1);
});
