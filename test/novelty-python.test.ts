// novelty-python.test.ts — Python parity for the novelty-vs-anchor advisory. The gap
// this guards: signal.ts's zero-anchor growth alarm rides on scanSurface/surfaceSignals/
// noveltyVerdict, and until the regex-grade Python scan landed, a Python project grew
// behavioral surface invisibly — no exports, no variants, no alarm. These tests pin what
// COUNTS (module defs/classes/consts, Enum members, dict keys, Literal alternatives),
// what deliberately does NOT (underscore-prefixed names, nested defs, methods, docstring
// example code, test files), and that Python growth registers exactly the way TS growth
// does — through the same public API, no signature changes.
import test from "node:test";
import assert from "node:assert/strict";
import { surfaceOfSource, surfaceSignals, noveltyVerdict, isTestPath, scanSurface } from "../src/novelty.ts";
import { tmpProject, cleanup } from "./_helpers.ts";

const MODULE_PY = `"""Module docstring.

Example that must NOT count as surface:
FAKE = "not surface"
"""
from enum import Enum
from typing import Literal

MODEL = "small"
MAX_RETRIES: int = 3
_PRIVATE = "hidden"

def fetch(url):
    def inner(x):
        return x
    return inner

async def stream(
    url,
    timeout=30,
):
    pass

def _helper():
    pass

class Client:
    def request(self):
        retries = 0
        return retries

class Mode(Enum):
    FAST = "fast"
    SLOW = "slow"
    _ignored = 1

    def label(self):
        text = "x"
        return text

ROUTES = {
    "home": "/",
    "about": "/about",
}

Verb = Literal["get", "post"]
`;

test("python surface — module defs, enum variants, and dict keys count; underscore and nested names do not", async (t) => {
  await t.test("exact surface of one module: 8 exports, 3 domains, 6 members", async () => {
    const s = await surfaceOfSource(MODULE_PY, "module.py");
    // N module-level defs/classes/consts: MODEL, MAX_RETRIES, fetch, stream, Client,
    // Mode, ROUTES, Verb — and nothing else.
    assert.deepEqual(
      [...s.exports].sort(),
      ["Client", "MAX_RETRIES", "MODEL", "Mode", "ROUTES", "Verb", "fetch", "stream"],
    );
    // M enum members + K dict keys + Literal alternatives = 2 + 2 + 2 = 6 total.
    assert.deepEqual([...s.domains.keys()].sort(), ["Mode", "ROUTES", "Verb"]);
    assert.deepEqual([...s.domains.get("Mode")!].sort(), ["FAST", "SLOW"]);
    assert.deepEqual([...s.domains.get("ROUTES")!].sort(), ["about", "home"]);
    assert.deepEqual([...s.domains.get("Verb")!].sort(), ["get", "post"]);
    const totalMembers = [...s.domains.values()].reduce((n, set) => n + set.size, 0);
    assert.equal(s.exports.size + totalMembers, 8 + 6);
  });

  await t.test("underscore-prefixed and nested names are excluded", async () => {
    const s = await surfaceOfSource(MODULE_PY, "module.py");
    assert.ok(!s.exports.has("_PRIVATE"), "_PRIVATE is private by convention");
    assert.ok(!s.exports.has("_helper"), "_helper is private by convention");
    assert.ok(!s.exports.has("inner"), "nested def is not module surface");
    assert.ok(!s.exports.has("request"), "method is not module surface");
    assert.ok(!s.exports.has("retries"), "function-local binding is not module surface");
    assert.ok(!s.exports.has("text"), "method-local binding is not an enum member either");
    assert.ok(!s.domains.get("Mode")!.has("_ignored"), "underscore enum member is not a variant");
    assert.ok(!s.exports.has("FAKE"), "docstring example code is not surface");
  });

  await t.test("test_*.py under the test dir is excluded entirely by scanSurface", async () => {
    const root = await tmpProject({
      "module.py": MODULE_PY,
      "tests/test_module.py": `TEST_TABLE = {\n    "a": 1,\n}\n\ndef test_fetch():\n    pass\n`,
      "pkg/module_test.py": `def test_other():\n    pass\n`,
    });
    try {
      assert.ok(isTestPath("tests/test_module.py"));
      assert.ok(isTestPath("pkg/module_test.py"));
      assert.ok(!isTestPath("module.py"));
      const s = await scanSurface(root, ["module.py", "tests/test_module.py", "pkg/module_test.py"]);
      assert.ok(!s.exports.has("TEST_TABLE"), "tests are evidence, not surface");
      assert.ok(!s.exports.has("test_fetch"));
      assert.ok(!s.exports.has("test_other"));
      assert.ok(s.exports.has("fetch"), "non-test python file still scans");
    } finally { await cleanup(root); }
  });

  await t.test("python growth registers exactly like TS growth: zero-anchor alarm fires", async () => {
    // Same drive as the TS path: scan the changed file at both refs, diff with
    // surfaceSignals, decide with noveltyVerdict — the pipeline signal.ts runs.
    const beforeRoot = await tmpProject({ "module.py": `def fetch(url):\n    pass\n` });
    const afterRoot = await tmpProject({ "module.py": MODULE_PY });
    try {
      const before = await scanSurface(beforeRoot, ["module.py"]);
      const after = await scanSurface(afterRoot, ["module.py"]);
      assert.deepEqual([...before.exports], ["fetch"]);
      const sig = surfaceSignals(before, after, { added: 500, deleted: 10 }, { anchorsAdded: 0, componentsAdded: 0 });
      assert.equal(sig.newExports.length, 7); // the 8 minus the pre-existing fetch
      assert.equal(sig.newVariants, 6);       // Mode +2, ROUTES +2, Verb +2 — all new domains
      assert.deepEqual(sig.newDomains, ["Mode (+2, new)", "ROUTES (+2, new)", "Verb (+2, new)"]);
      const v = noveltyVerdict(sig);
      assert.equal(v.level, "alarm");         // 13 surface items, zero anchors
      assert.equal(v.surface, 13);
      assert.equal(v.proviso, false);         // feature-shaped: deletions ≪ additions
    } finally { await cleanup(beforeRoot); await cleanup(afterRoot); }
  });
});
