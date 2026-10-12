// rust-oracle.test.ts — the meta-oracle's rust row, at python's indent-regex grade. The
// witness is the python row itself: each rust fixture is the structural twin of a python
// one, and the two rows must reach the same verdict per shape. The declared blind spot —
// the anchor is the first matching line, not the #[test] fn — is pinned so a fix to it
// is a deliberate change to this file, never a silent one.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { analyzeOracle, analyzeParityOracle } from "../src/oracle-domain.ts";
import { tmpProject, cleanup, cfg } from "./_helpers.ts";

const PY = `
from products.registry import KINDS

def test_live_floor():
    assert len(KINDS) >= 3
    for k in KINDS:
        assert k

def test_live_no_floor():
    for k in KINDS:
        assert k

def test_literal():
    for k in ["a", "b"]:
        assert k

def test_no_iteration():
    assert KINDS is not None
`;

const RS = `
use crate::registry::{KINDS, render};

pub fn shadowed() -> usize { 0 }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::KINDS;

    #[test]
    fn test_live_floor() {
        assert!(KINDS.len() >= 3);
        for k in KINDS {
            assert!(!render(k).is_empty());
        }
    }

    #[test]
    fn test_live_no_floor() {
        for k in KINDS.iter() {
            assert!(!k.is_empty());
        }
    }

    #[test]
    fn test_literal() {
        for k in ["a", "b"] {
            assert!(!k.is_empty());
        }
    }

    #[test]
    fn test_no_iteration() {
        assert_eq!(KINDS[0], "a");
    }

    #[test]
    fn test_const_floor() {
        assert!(!KINDS.is_empty());
        for k in KINDS { assert!(!k.is_empty()); }
    }

    #[test]
    fn shadowed() {
        for k in KINDS { assert!(!k.is_empty()); }
    }

    mod registry_totality {
        use crate::registry::{KINDS, render};
        #[test]
        fn parity() {
            for k in KINDS.iter() { assert_eq!(render(k), render(k)); }
        }
    }
}
`;

let pyRoot: string, rsRoot: string;
before(async () => {
  pyRoot = await tmpProject({ "test_oracles.py": PY });
  rsRoot = await tmpProject({ "src/oracles.rs": RS });
});
after(async () => { await cleanup(pyRoot); await cleanup(rsRoot); });

test("rust oracle — an imported domain with a floor is live; a literal array is literal; a vanished fn is not-found", async () => {
  const rs = (name: string) => analyzeOracle(cfg(rsRoot, { language: "rust", codeExt: ["rs"] }), name);
  const py = (name: string) => analyzeOracle(cfg(pyRoot, { language: "python", codeExt: ["py"] }), name);
  for (const shape of ["test_live_floor", "test_live_no_floor", "test_literal", "test_no_iteration", "test_vanished"]) {
    const [r, p] = [await rs(shape), await py(shape)];
    assert.equal(r.verdict, p.verdict, `${shape}: rust ${JSON.stringify(r)} vs python ${JSON.stringify(p)}`);
    assert.equal(r.hasFloor, p.hasFloor, `${shape}: floor detection agrees with the python twin`);
  }
  assert.match((await rs("test_vanished")).detail, /no oracle block named "test_vanished"/, "the not-found wording names no typescript construct");
  assert.equal((await rs("test_live_floor")).file, "src/oracles.rs", "every .rs file is a candidate: unit tests live inline");

  assert.equal((await rs("test_const_floor")).hasFloor, true, "!CONST.is_empty() is a floor; !element.is_empty() (test_live_no_floor) is not");

  const mod = await rs("registry_totality");
  assert.equal(mod.verdict, "live", "a `mod <name>` block anchors as a module-level oracle");

  // DECLARED BLIND SPOT: the first `fn shadowed(` line is the non-test fn above mod tests,
  // whose one-line body iterates nothing — the #[test] fn of the same name is never read.
  assert.equal((await rs("shadowed")).verdict, "no-iteration");

  const parity = await analyzeParityOracle(cfg(rsRoot, { language: "rust", codeExt: ["rs"] }), "registry_totality", "KINDS", "render", "render");
  assert.equal(parity.verdict, "ok", `the parity arm reads the same row: ${JSON.stringify(parity)}`);
});
