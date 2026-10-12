// rust-graph.test.ts — the rust pack's graph tier: symbols at the declared positions,
// rustdoc prose through attributes, and module-path imports resolved through the crate's
// file tree. Each fixture shape is one the corpus gate measured (naga, ripgrep): the
// doc above `#[derive]`, `mod foo;` → foo.rs and foo/mod.rs, `crate::a::B` → a.rs.
import test from "node:test";
import assert from "node:assert/strict";
import { tmpProject, cleanup, cfg } from "./_helpers.ts";
import { buildGraph, resolveLanguageAdapter, expandUseTree, resolveRustModule } from "../src/derive.ts";
import { registerLanguagePack, languagePackProblems } from "../src/language-registry.ts";
import { rustPack } from "../src/languages/rust.ts";
import { Unrunnable } from "../src/floor.ts";

const LIB = `//! The crate root.
//! Second line of the file doc.

pub mod value;
mod store;
mod util;

use crate::value::{Name, Value};
use std::collections::HashMap;
use indexmap::IndexMap;

/// A parsed program.
#[derive(Clone, Debug)]
#[serde(
    rename_all = "snake_case",
)]
pub struct Program {
    pub items: Vec<Name>,
}

// a plain comment is not rustdoc
fn helper() -> usize { 0 }

impl Program {
    /// Count the items.
    pub fn len(&self) -> usize { self.items.len() }
}

pub trait Render {
    fn render(&self) -> String;
}

pub const LIMIT: usize = 3;
macro_rules! here { () => {} }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Table;
    #[test]
    fn nested_is_not_a_symbol() {}
}
`;

test("rust graph — top-level items and impl methods are symbols, rustdoc reads through attributes, module paths resolve to files", async () => {
  const root = await tmpProject({
    "app.spec.md": "# app\n\nFixture.\n",
    "src/lib.rs": LIB,
    "src/value.rs": "//! Values.\nuse super::store::Table;\npub enum Value { Nil, Num(f64) }\npub struct Name;\n",
    "src/store/mod.rs": "use crate::value::Value;\nuse BinOp::*;\npub struct Table;\n",
    "src/util.rs": "use self::missing::Thing;\nfn noop() {}\n",
  });
  try {
    const g = await buildGraph(cfg(root, { language: "rust", codeExt: ["rs"] }));
    const syms = g.nodes.filter((n) => n.kind === "symbol" && n.path === "src/lib.rs");
    const kinds = Object.fromEntries(syms.map((s) => [s.label, s.sub]));
    assert.deepEqual(kinds, {
      value: "module", store: "module", util: "module", Program: "struct", helper: "function",
      "len()": "method", Render: "trait", "render()": "method", LIMIT: "const", here: "macro", tests: "module",
    }, "every top-level item, private ones included; items inside the inline mod are not symbols");

    const prose = (label: string) => syms.find((s) => s.label === label)?.prose;
    assert.equal(prose("Program"), "A parsed program.", "/// above #[derive] and a rustfmt-wrapped attribute is still the item's doc");
    assert.equal(prose("len()"), "Count the items.");
    assert.equal(prose("helper"), undefined, "a plain // comment is not rustdoc");
    const file = g.nodes.find((n) => n.id === "f:src/lib.rs");
    assert.equal(file?.prose, "The crate root.\nSecond line of the file doc.", "//! is the file doc");

    const imports = (from: string) => g.edges.filter((e) => e.source === `f:${from}` && e.kind === "imports").map((e) => e.target).sort();
    assert.deepEqual(imports("src/lib.rs"), [
      "f:src/store/mod.rs", "f:src/util.rs", "f:src/value.rs", "x:indexmap", "x:std",
    ], "mod foo; reaches foo.rs and foo/mod.rs, crate:: paths are files, other crates one node per root; mod tests' crate:: use is kept, its super::* is not");
    assert.deepEqual(imports("src/value.rs"), ["f:src/store/mod.rs"], "super:: climbs to the parent module");
    assert.deepEqual(imports("src/store/mod.rs"), ["f:src/value.rs"], "a capitalized head is an item in scope, never a crate");
    assert.deepEqual(imports("src/util.rs"), [], "an unresolved self:: path links nothing rather than an external");
    assert.ok(!g.nodes.some((n) => n.kind === "external" && /^x:(crate|self|super|BinOp)/.test(n.id)));
  } finally { await cleanup(root); }
});

test("rust module paths — use trees expand and resolve by longest module prefix", () => {
  assert.deepEqual(expandUseTree("crate::a::{self, b::{C as D, e::*}}"), [["crate", "a"], ["crate", "a", "b", "C"], ["crate", "a", "b", "e"]]);
  assert.deepEqual(expandUseTree("{ColType::*, FieldTy::Col}"), [["ColType"], ["FieldTy", "Col"]]);
  assert.deepEqual(expandUseTree("::std::fmt"), [["::", "std", "fmt"]]);
  const known = new Set(["src/main.rs", "src/a.rs", "src/a/b.rs", "src/c/mod.rs"]);
  const has = (f: string) => known.has(f);
  assert.deepEqual(resolveRustModule("crate::a::b::Item", "src/c/mod.rs", has), [{ file: "src/a/b.rs" }]);
  assert.deepEqual(resolveRustModule("super::super::c::X", "src/a/b.rs", has), [{ file: "src/c/mod.rs" }]);
  assert.deepEqual(resolveRustModule("pub(crate) mod b;", "src/a.rs", has), [{ file: "src/a/b.rs" }], "a non-mod.rs file's children live in its own directory");
  assert.deepEqual(resolveRustModule("mod gone;", "src/a.rs", has), [], "an unresolvable mod declaration links nothing");
  assert.deepEqual(resolveRustModule("serde::{Deserialize, Serialize}", "src/a.rs", has), [{ crate: "serde" }, { crate: "serde" }]);
});

test("rust language — the bare name resolves to the first-party pack; a project pack cannot take its name", async () => {
  const adapter = await resolveLanguageAdapter(cfg("/nonexistent", { language: "rust" }));
  assert.deepEqual(adapter.exts, ["rs"]);
  assert.equal(adapter.importResolution, "rust-module");
  assert.deepEqual(languagePackProblems(rustPack), [], "the first-party pack is function-free data");
  assert.throws(() => registerLanguagePack({ ...rustPack }), /built-in language/);
  await assert.rejects(() => resolveLanguageAdapter(cfg("/nonexistent", { language: "go" })),
    (e: unknown) => e instanceof Unrunnable && e.report.some((l) => /built-ins: .*rust/.test(l)));
});
