// language-packs.test.ts — the pack-purity guard: the declarative baseline cannot
// erode silently, because a function smuggled into any pack table reds this by path.
import test from "node:test";
import assert from "node:assert/strict";
import { builtinLanguagePacks, functionFields } from "../src/language-packs.ts";

test("language packs — every built-in pack is function-free data across all five instrument tables", () => {
  const packs = builtinLanguagePacks();
  // The aggregate covers all five instruments — an instrument that stops exporting its
  // table would silently leave the purity perimeter, so the coverage is asserted too.
  assert.deepEqual(Object.keys(packs).sort(), ["graph", "oracle", "sinks", "sites", "surface"]);

  const offenders = functionFields(packs);
  assert.deepEqual(offenders, [],
    "a pack carries queries, patterns, and named strategies — never code; offenders by path: "
      + offenders.join(", "));

  // The sweep itself must be able to fail: a planted function is found and named.
  const planted = functionFields({ sinks: [{ accept: () => true }] });
  assert.deepEqual(planted, ["pack.sinks.0.accept"], "the purity oracle can red");
});
