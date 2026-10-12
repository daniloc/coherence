// rust-redundancy.test.ts — rust duplicate-domain sites through the first-party pack's
// site row and the shared capture-class engine. The pair shape is the one the corpus gate
// found in real code (a const op list and the dispatch switch that re-spells it); the
// match over enum variants is the one rustc already checks, so it must stay silent.
import test from "node:test";
import assert from "node:assert/strict";
import { sitesOfRust, collectSites, pairSites } from "../src/redundancy.ts";
import { tmpProject, cleanup, cfg } from "./_helpers.ts";

const OPS_RS = `pub const TABLE_OPS: &[&str] = &["get", "insert", "update", "delete"];
pub enum Op { Get, Insert, Update, Delete }
pub struct Row { id: u64, name: String, body: String }
`;
const MACHINE_RS = `fn run(op: &str) -> u8 {
    // a dispatch re-spelling the domain by hand
    match op { "get" => 1, "insert" => 2, "update" => 3, "delete" => 4, _ => 0 }
}
fn kind(o: Op) -> u8 {
    match o { Op::Get => 1, Op::Insert => 2, Op::Update => 3, Op::Delete => 4 }
}
fn mode(s: &str) -> bool { s == "fast" || s == "slow" || s == "auto" }
fn keys() { let k = b"zz"; let names = ["alpha", "beta", other()]; }
`;

test("rust redundancy — two spellings of one domain rank as a candidate; a match on enum variants does not", async () => {
  const sites = sitesOfRust(OPS_RS + MACHINE_RS, "src/ops.rs");
  const byKind = (k: string) => sites.filter((s) => s.kind === k).map((s) => `${s.name}:${s.keys.join(",")}`);
  assert.deepEqual(byKind("list"), ["TABLE_OPS:delete,get,insert,update"], "a string array behind & is a list; one with a non-literal element is not");
  assert.deepEqual(byKind("enum"), ["Op:Delete,Get,Insert,Update"]);
  assert.deepEqual(byKind("shape"), ["Row:body,id,name"]);
  assert.deepEqual(byKind("switch"), ["op:delete,get,insert,update"], "string-literal arms are a switch; the enum-variant match is not a site");
  assert.deepEqual(byKind("compare"), ["s:auto,fast,slow"]);

  const root = await tmpProject({ "src/ops.rs": OPS_RS, "src/machine.rs": MACHINE_RS, "tests/it.rs": OPS_RS });
  try {
    const all = await collectSites(cfg(root, { language: "rust", codeExt: ["rs"] }));
    assert.ok(!all.some((s) => s.file.startsWith("tests/")), "integration tests are evidence, not a second spelling");
    const { pairs } = pairSites(all, new Set());
    const pair = pairs.find((p) => [p.a.name, p.b.name].sort().join("|") === "TABLE_OPS|op");
    assert.ok(pair, `the hand-copied dispatch pairs with the const list it re-spells: ${JSON.stringify(pairs.map((p) => [p.a.name, p.b.name]))}`);
  } finally { await cleanup(root); }
});
