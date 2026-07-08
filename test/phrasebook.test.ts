// phrasebook.test.ts — the claim grammar-as-data registry. The engine (verify.ts) is now
// a thin loop over CLAIM_FORMS, so these lock the properties that loop depends on: the
// ORDER (= precedence, first match wins), that every historical form still matches its
// canonical line, and that a line matching nothing is a dialect-gap skip (never red). The
// `coherence phrasebook` verb renders straight from this registry, so its output must name
// every form (the README's generated authority).
import test from "node:test";
import assert from "node:assert/strict";
import { CLAIM_FORMS, parseWord } from "../src/phrasebook.ts";

test("registry — order IS the historical precedence (typechecks → conforms to)", () => {
  assert.deepEqual(
    CLAIM_FORMS.map((f) => f.name),
    ["typechecks", "exists", "imports", "responds", "passes test", "boundary", "conforms to"],
  );
});

test("registry — each form matches its own canonical example line", () => {
  for (const f of CLAIM_FORMS) {
    const m = f.match(f.example);
    assert.ok(m, `form "${f.name}" should match its own example: ${f.example}`);
  }
});

test("registry — first match wins: `typechecks` resolves to the typechecks form, not a later one", () => {
  const first = CLAIM_FORMS.find((f) => f.match("typechecks"));
  assert.equal(first?.name, "typechecks");
});

test("registry — every canonical claim line matches exactly ONE form (no ambiguous grammar)", () => {
  const lines = [
    "typechecks",
    "wrangler.jsonc exists at root",
    "main.ts imports ./registry",
    'http://localhost:8787/health responds 200 with "ok"',
    'passes test "write policy totality"',
    'boundary "x" at Choke via guard "g"',
    "conforms to OwnedScope",
  ];
  for (const l of lines) {
    const hits = CLAIM_FORMS.filter((f) => f.match(l));
    assert.equal(hits.length, 1, `"${l}" should match exactly one form, matched: ${hits.map((h) => h.name).join(", ")}`);
  }
});

test("dialect gap — a line matching no form is recognized by NONE (verify then skips it)", () => {
  const gibberish = "this is prose, not a claim";
  assert.equal(CLAIM_FORMS.filter((f) => f.match(gibberish)).length, 0);
});

test("tiers — each form declares one of the four known tiers", () => {
  const tiers = new Set(["deterministic", "live", "executable", "hybrid"]);
  for (const f of CLAIM_FORMS) assert.ok(tiers.has(f.tier), `form "${f.name}" has an unknown tier ${f.tier}`);
});

test("parseWord — heading + intent + commitments; markdown escapes stripped", () => {
  const w = parseWord(
    ["# OwnedScope", "Reads and writes stay inside the owner's scope.", "", "## commitments", "- typechecks", '- boundary "scoped" at \\_query via guard "g"'].join("\n"),
  );
  assert.ok(w);
  assert.equal(w!.name, "OwnedScope");
  assert.equal(w!.intent, "Reads and writes stay inside the owner's scope.");
  assert.deepEqual(w!.commitments, ["typechecks", 'boundary "scoped" at _query via guard "g"']);
});

test("parseWord — no heading, or no `## commitments` section, is unparseable (null → RED)", () => {
  assert.equal(parseWord("just prose, no heading"), null);
  assert.equal(parseWord("# Word\nan intent but no commitments section"), null);
});
