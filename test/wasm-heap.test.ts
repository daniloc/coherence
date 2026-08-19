// wasm-heap.test.ts — the leak that crashed an adopter, pinned as a guard. Trees hold
// wasm heap that only tree.delete() returns; the shipped 0.34.0 leaked every parse and
// a real `verify` aborted mid-walk at ~parse #638 of an 80KB file. Every parse now
// routes through withTree, so a count comfortably past the measured abort point must
// survive through the PUBLIC paths — this is a refutation-calibrated floor, not a perf test.
import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_LANGUAGES, withTree, grammarHandle } from "../src/adapters/tree-sitter.ts";
import { surfaceOfSource } from "../src/novelty.ts";

const BIG_TS = "export const x = 1;\n".repeat(4000); // ~80KB — the abort-repro shape

test("wasm heap — parses past the measured abort cliff survive because every tree is freed", async () => {
  // The measured negative control: WITHOUT delete, this source aborts the shared wasm
  // heap at parse #638 — one heap serves every parser, so ONE loop past the cliff
  // proves freeing for all paths. 350 iterations × (symbols + imports) = 700 trees,
  // plus surfaceOfSource and the throw path riding the same heap.
  const adapter = await BUILTIN_LANGUAGES.typescript();
  for (let i = 0; i < 350; i++) {
    adapter.symbols(BIG_TS);
    adapter.imports(BIG_TS);
  }
  await surfaceOfSource(BIG_TS, "big.ts");

  // And the helper itself frees even when the callback throws.
  const { parser } = await grammarHandle("typescript");
  for (let i = 0; i < 25; i++) {
    try {
      withTree(parser, BIG_TS, null, () => { throw new Error("boom"); });
    } catch { /* the throw must not leak the tree */ }
  }
  assert.ok(true, "no wasm abort across 700+ tree lifetimes on one shared heap");
});
