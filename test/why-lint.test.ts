// why-lint.test.ts — pins both halves of the `## why` discipline. The mechanism-
// restatement check (#1) was the original; the paragraph↔invariant anchoring check
// (#2) is the harder one — it must be advisory, not a hard gate, and it must
// distinguish a real anchor from a passing mention while staying lenient on form
// (bold lead-in, inline reference, hyphen/space variants all count).
import { test } from "node:test";
import assert from "node:assert/strict";
import { whyLint } from "../src/why-lint.ts";
import { runCaptured, comp, sym, graph } from "./_helpers.ts";

test("mechanism-restatement: a sentence naming an anchored symbol + an oracle-verb is flagged", async () => {
  const g = graph([
    comp("a", {
      claims: ['boundary "x" at chokepointFoo via test "oracleBar"'],
      invariants: ["x"],
      why: "**x.** chokepointFoo iterates the live domain — the whack-a-mole alternative shipped a bug.",
    }),
    sym("chokepointFoo"),
  ]);
  const { code, out } = await runCaptured(async () => whyLint(g, "check"));
  assert.equal(code, 1, "check mode exits nonzero on a finding");
  assert.match(out, /names anchored "chokepointFoo"/);
});

test("mechanism-restatement: a clean why with no symbol+verb collision passes", async () => {
  const g = graph([
    comp("a", {
      claims: ['boundary "x" at chokepointFoo via test "oracleBar"'],
      invariants: ["x"],
      why: "**x.** The bug it kills: the previous design stored the rule in two places and they drifted.",
    }),
    sym("chokepointFoo"),
  ]);
  const { code, out } = await runCaptured(async () => whyLint(g, "check"));
  assert.equal(code, 0);
  assert.match(out, /no ## why sentence restates an anchored chokepoint\/oracle mechanism/);
});

test("anchored-paragraph: every paragraph mentions an invariant and every invariant is mentioned — clean", async () => {
  const g = graph([
    comp("a", {
      invariants: ["alpha rule", "beta rule"],
      why: "**alpha rule.** Past bug: the alpha case shipped without a chokepoint.\n\n**beta rule.** Rejected alternative: a guard at each site.",
    }),
  ]);
  const { code, out } = await runCaptured(async () => whyLint(g, "check"));
  assert.equal(code, 0);
  assert.match(out, /every ## why paragraph anchors to a declared invariant/);
});

test("anchored-paragraph: a paragraph that anchors no invariant is flagged as drift", async () => {
  const g = graph([
    comp("a", {
      invariants: ["alpha rule"],
      why: "**alpha rule.** Past bug.\n\nUnrelated narrative about how nice the system is, naming no declared invariant.",
    }),
  ]);
  const { code, out } = await runCaptured(async () => whyLint(g, "check"));
  assert.equal(code, 1);
  assert.match(out, /paragraph anchors no declared invariant/);
  assert.match(out, /Unrelated narrative/);
});

test("anchored-paragraph: a declared invariant with no anchoring paragraph is flagged as missing rationale", async () => {
  const g = graph([
    comp("a", {
      invariants: ["alpha rule", "beta rule"],
      why: "**alpha rule.** Past bug.",
    }),
  ]);
  const { code, out } = await runCaptured(async () => whyLint(g, "check"));
  assert.equal(code, 1);
  assert.match(out, /invariant "beta rule" has no ## why paragraph/);
});

test("anchored-paragraph: a parenthetical paragraph is treated as meta-framing and exempt", async () => {
  const g = graph([
    comp("a", {
      invariants: ["alpha rule"],
      why: "(This section records the non-derivable rationale; the mechanism is in the boundary claim.)\n\n**alpha rule.** Past bug.",
    }),
  ]);
  const { code } = await runCaptured(async () => whyLint(g, "check"));
  assert.equal(code, 0, "the leading parenthetical is exempt");
});

test("anchored-paragraph: hyphen/space/slash normalization — `facet/kernel-column collision` matches prose `facet kernel column collision`", async () => {
  const g = graph([
    comp("a", {
      invariants: ["facet/kernel-column collision"],
      why: "The facet kernel column collision was a real shipped bug.",
    }),
  ]);
  const { code } = await runCaptured(async () => whyLint(g, "check"));
  assert.equal(code, 0);
});

test("anchored-paragraph: components without ## invariants are exempt (free-form why is fine)", async () => {
  const g = graph([
    comp("a", {
      why: "This component exists because we needed a place for X. No declared invariants, no anchoring requirement.",
    }),
  ]);
  const { code } = await runCaptured(async () => whyLint(g, "check"));
  assert.equal(code, 0);
});

test("mechanism-restatement: a bold anchor lead-in is NOT itself flagged as mechanism (it IS the anchor)", async () => {
  // Without the lead-in strip, the anchor `**egress-sensitivity totality.**` trips
  // its own check: the symbol "egress-sensitivity totality" sits in the same
  // sentence as the verb "totality" (part of the invariant name). The lead-in IS
  // the anchoring mechanism — it must be exempt.
  const g = graph([
    comp("a", {
      claims: ['boundary "egress-sensitivity totality" at SENSITIVE_COLUMNS via test "egress-sensitivity totality"'],
      invariants: ["egress-sensitivity totality"],
      why: "**egress-sensitivity totality.** The rejected design had two parallel hand-lists.",
    }),
    sym("SENSITIVE_COLUMNS"),
  ]);
  const { code } = await runCaptured(async () => whyLint(g, "check"));
  assert.equal(code, 0, "the bold lead-in is the anchor, not mechanism prose");
});

test("mechanism-restatement: sentence-splitter handles `.)` and `.**` terminators (paragraphs don't fuse)", async () => {
  // The naive `(?<=[.!?])\s+` split misses `.)` and `.**`, fusing what reads as two
  // sentences (or two paragraphs!) into one. That produced false positives where a
  // parenthetical closer flowed into the next paragraph's bold anchor + prose.
  const g = graph([
    comp("a", {
      claims: ['boundary "x totality" at chokepointFoo via test "x totality"'],
      invariants: ["x totality"],
      // Two paragraphs: a parenthetical and an anchored one. Without paragraph-first
      // splitting + the `.)` terminator, these fuse into one long "sentence" that
      // mentions chokepointFoo AND an oracle-verb.
      why: "(Intro framing that mentions nothing dangerous.)\n\n**x totality.** The rejected design was the hand-list.",
    }),
    sym("chokepointFoo"),
  ]);
  const { code } = await runCaptured(async () => whyLint(g, "check"));
  assert.equal(code, 0, "paragraphs are checked independently and `.)` ends a sentence");
});

test("report mode never exits nonzero, even with findings", async () => {
  const g = graph([
    comp("a", {
      invariants: ["alpha rule"],
      why: "Narrative that anchors no invariant.",
    }),
  ]);
  const { code } = await runCaptured(async () => whyLint(g, "report"));
  assert.equal(code, 0, "report mode is advisory; the exit code is reserved for --check");
});
