// parse.test.ts — the spec parser is foundational: derive, every renderer, and verify
// all consume what parseSpec extracts. A parse bug silently mis-reports the whole graph.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSpec, splitWhy, ownerOf } from "../src/walk.ts";

test("parseSpec — full spec splits intent / claims / invariants / why / prose", () => {
  const s = parseSpec(
    [
      "# Hive",
      "The per-user durable object.",
      "",
      "Some prose paragraph that is neither a claim nor a why.",
      "",
      "## invariants",
      "- kernel write capability",
      "- egress totality",
      "",
      "## works when",
      "- data.ts exists at this node",
      '- boundary "kernel write capability" at executeMutate via guard "ctx totality"',
      "",
      "## why",
      "Because writes must funnel through one chokepoint.",
    ].join("\n"),
  );
  assert.equal(s.name, "Hive");
  assert.equal(s.intent, "The per-user durable object.");
  assert.deepEqual(s.invariants, ["kernel write capability", "egress totality"]);
  assert.deepEqual(s.claims, [
    "data.ts exists at this node",
    'boundary "kernel write capability" at executeMutate via guard "ctx totality"',
  ]);
  assert.equal(s.why, "Because writes must funnel through one chokepoint.");
  // prose carries the free paragraph but NONE of the special sections
  assert.match(s.prose, /Some prose paragraph/);
  assert.doesNotMatch(s.prose, /works when|funnel through|egress totality/);
});

test("parseSpec — section headings are case-insensitive", () => {
  const s = parseSpec("# X\nintent\n\n## Works When\n- a exists at root\n\n## WHY\nr\n\n## Invariants\n- inv");
  assert.deepEqual(s.claims, ["a exists at root"]);
  assert.equal(s.why, "r");
  assert.deepEqual(s.invariants, ["inv"]);
});

test("parseSpec — missing optional sections yield empty collections, not crashes", () => {
  const s = parseSpec("# Bare\njust an intent line\n");
  assert.equal(s.name, "Bare");
  assert.equal(s.intent, "just an intent line");
  assert.deepEqual(s.claims, []);
  assert.deepEqual(s.invariants, []);
  assert.equal(s.why, "");
});

test("parseSpec — a heading immediately after H1 leaves intent empty (no false intent)", () => {
  const s = parseSpec("# X\n## works when\n- a exists at root");
  assert.equal(s.intent, "");
  assert.deepEqual(s.claims, ["a exists at root"]);
});

test("parseSpec — only `- ` bullets are claims, and the list stops at the next heading", () => {
  const s = parseSpec("# X\ni\n\n## works when\n- one\nnot a bullet\n- two\n\n## why\nr");
  assert.deepEqual(s.claims, ["one", "two"]);
});

test("splitWhy — no @why marker means it is all derivable `what`", () => {
  assert.deepEqual(splitWhy("plain description"), { what: "plain description", why: "" });
});

test("splitWhy — @why partitions derivable what from authored why", () => {
  assert.deepEqual(splitWhy("does the thing\n@why: because the bug bit us"), {
    what: "does the thing",
    why: "because the bug bit us",
  });
});

test("splitWhy — empty input is safe", () => {
  assert.deepEqual(splitWhy(""), { what: "", why: "" });
});

test("ownerOf — a file resolves to its deepest spec'd ancestor", () => {
  const dirs = [".", "entities/Hive", "shared/Auth"];
  assert.equal(ownerOf("entities/Hive/data.ts", dirs), "entities/Hive");
  assert.equal(ownerOf("shared/Auth/passkey.ts", dirs), "shared/Auth");
  assert.equal(ownerOf("src/top.ts", dirs), "."); // no nested owner → root
});
