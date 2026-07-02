// python-oracle.test.ts — the meta-oracle's Python arm. Same classification contract
// as the TS arm, regex-based and conservative-to-LIVE; these fixtures pin each path.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { analyzeOracle } from "../src/oracle-domain.ts";
import { tmpProject, cleanup, cfg } from "./_helpers.ts";

const FIXTURE = `
import pytest
from products.registry import TRIGGER_TYPES

def test_live_for_in_over_import():
    assert len(TRIGGER_TYPES) >= 4
    for t in TRIGGER_TYPES:
        assert t

def test_live_no_floor():
    for t in TRIGGER_TYPES:
        assert t

@pytest.mark.parametrize("kind", ["a", "b", "c"])
def test_literal_parametrize(kind):
    assert kind

@pytest.mark.parametrize("kind", TRIGGER_TYPES)
def test_live_parametrize(kind):
    assert kind

def test_literal_for_in():
    for k in ["x", "y"]:
        assert k

def test_no_iteration():
    assert TRIGGER_TYPES is not None
`;

let root: string;
before(async () => { root = await tmpProject({ "test_oracles.py": FIXTURE }); });
after(async () => { await cleanup(root); });

const analyze = (name: string) => analyzeOracle(cfg(root), name);

test("PY LIVE + FLOOR — for-in over an import with a len() floor", async () => {
  const a = await analyze("test_live_for_in_over_import");
  assert.equal(a.verdict, "live");
  assert.equal(a.hasFloor, true);
});

test("PY LIVE, NO FLOOR — flagged vacuous-able", async () => {
  const a = await analyze("test_live_no_floor");
  assert.equal(a.verdict, "live");
  assert.equal(a.hasFloor, false);
  assert.match(a.detail, /no domain floor/);
});

test("PY LITERAL — parametrize over an inline list is a hand-list", async () => {
  assert.equal((await analyze("test_literal_parametrize")).verdict, "literal");
});

test("PY LIVE — parametrize over an imported registry", async () => {
  assert.equal((await analyze("test_live_parametrize")).verdict, "live");
});

test("PY LITERAL — for-in over an inline list", async () => {
  assert.equal((await analyze("test_literal_for_in")).verdict, "literal");
});

test("PY NO-ITERATION — an assertion with no domain loop", async () => {
  assert.equal((await analyze("test_no_iteration")).verdict, "no-iteration");
});

test("PY NOT-FOUND — unknown def name", async () => {
  assert.equal((await analyze("test_does_not_exist")).verdict, "not-found");
});
