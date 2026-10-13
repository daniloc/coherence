// novelty-rust.test.ts — rust feeds the zero-anchor alarm through the first-party pack's
// surface row: visible top-level items are exports, a visible enum's variants are a
// domain, and private, nested, and integration-test items are not surface.
import test from "node:test";
import assert from "node:assert/strict";
import { surfaceOfSource, isTestPath, scanSurface } from "../src/novelty.ts";
import { tmpProject, cleanup } from "./_helpers.ts";

const MODULE_RS = `//! A module.
pub fn fetch() {}
pub(crate) async fn stream() {}
fn private_helper() {}
pub struct Client;
pub enum Kind { Alpha, Beta, Gamma }
enum Hidden { X, Y }
pub trait Render {}
pub type Alias = u8;
pub const MODEL: &str = "small";
pub static COUNT: u8 = 0;
impl Client { pub fn method(&self) {} }
mod inner { pub fn nested() {} }
`;

test("rust surface — pub items and pub enum variants count; private and nested items do not", async () => {
  const s = await surfaceOfSource(MODULE_RS, "src/lib.rs");
  assert.deepEqual([...s.exports].sort(), ["Alias", "COUNT", "Client", "Kind", "MODEL", "Render", "fetch", "stream"],
    "any visibility modifier is surface; private items, impl methods and inline-mod items are not");
  assert.deepEqual([...s.domains].map(([k, v]) => [k, [...v].sort()]), [["Kind", ["Alpha", "Beta", "Gamma"]]],
    "a visible enum's variants are one domain; a private enum is not surface");

  assert.ok(isTestPath("tests/cli.rs") && isTestPath("crates/x/benches/b.rs"), "integration tests and benches are evidence");
  assert.ok(!isTestPath("src/tests.rs"), "a src module named tests is code, not an integration test");

  const root = await tmpProject({ "src/lib.rs": MODULE_RS, "tests/api.rs": "pub fn helper_in_test() {}\n" });
  try {
    const scanned = await scanSurface(root, ["src/lib.rs", "tests/api.rs"]);
    assert.ok(scanned.exports.has("fetch") && !scanned.exports.has("helper_in_test"), "scanSurface routes .rs files and skips tests/");
  } finally { await cleanup(root); }
});
