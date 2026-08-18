// python-parity.test.ts — the python arms grown in this change, pinned end to end:
// the PARITY meta-oracle now reads .py oracles (the `.py` skip in analyzeParityOracle is
// gone), and the redundancy detector extracts python domain sites at the same regex grade.
// Verdict semantics are the TS branch's, exactly: an oracle must enumerate the DECLARED
// domain (a hand-copied literal list is no-enumeration), and a vanished oracle is
// not-found — never a pass. On the redundancy side, the same precision filters apply
// unchanged: declared parity suppresses, and high-df idiom tokens never pair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeParityOracle } from "../src/oracle-domain.ts";
import { collectSites, pairSites, shownPairs, declaredParitySymbols } from "../src/redundancy.ts";
import { tmpProject, cleanup, cfg, graph, comp } from "./_helpers.ts";

test("python parity — a .py oracle that iterates the live domain passes; a literal list fails; a vanished oracle cannot pass", async () => {
  const root = await tmpProject({
    "registry.py": `TRIGGER_TYPES = {\n    "webhook": 1,\n    "cron": 2,\n    "manual": 3,\n    "email": 4,\n}\n`,
    "test_parity.py":
      `from registry import TRIGGER_TYPES\n` +
      `from views import live_view, settled_view\n` +
      `\n` +
      `# test_parity_vanished used to live here; only this comment remains.\n` +
      `\n` +
      `def test_parity_live():\n` +
      `    for name in TRIGGER_TYPES:\n` +
      `        assert live_view(name) == settled_view(name)\n` +
      `\n` +
      `def test_parity_literal_list():\n` +
      `    for name in ["webhook", "cron", "manual"]:\n` +
      `        assert live_view(name) == settled_view(name)\n` +
      `\n` +
      `def test_parity_one_sided():\n` +
      `    for name in TRIGGER_TYPES:\n` +
      `        assert settled_view(name) == settled_view(name)\n`,
  });
  try {
    const analyze = (oracle: string) =>
      analyzeParityOracle(cfg(root), oracle, "TRIGGER_TYPES", "live_view", "settled_view");

    // iterates the imported live domain and drives both projections → ok
    const live = await analyze("test_parity_live");
    assert.equal(live.verdict, "ok", live.detail);
    assert.equal(live.file, "test_parity.py");
    assert.match(live.detail, /TRIGGER_TYPES/);

    // loops a hardcoded literal list → no-enumeration, same meaning as the TS branch
    const literal = await analyze("test_parity_literal_list");
    assert.equal(literal.verdict, "no-enumeration");
    assert.match(literal.detail, /never the declared domain `TRIGGER_TYPES`/);

    // enumerates the domain but never drives live_view → one-sided (semantics mirrored)
    const oneSided = await analyze("test_parity_one_sided");
    assert.equal(oneSided.verdict, "one-sided");
    assert.match(oneSided.detail, /live_view/);

    // the vanished oracle: mentioned in the file, defined nowhere → not-found, never ok
    const vanished = await analyze("test_parity_vanished");
    assert.equal(vanished.verdict, "not-found");
    assert.notEqual(vanished.verdict, "ok", "a vanished oracle cannot pass");
  } finally { await cleanup(root); }
});

test("python redundancy — two spellings of one domain in .py rank as a candidate; declared parity and idiom do not", async () => {
  const root = await tmpProject({
    // one domain, two .py spellings tied together by nothing: a module-level dict…
    "src/registry.py": `TRIGGER_TYPES = {\n    "webhook": "hooks",\n    "cron": "clock",\n    "manual": "human",\n    "email": "inbox",\n}\n`,
    // …and an if/elif dispatch chain over the same string tokens
    "src/dispatch.py":
      `def dispatch(kind):\n` +
      `    if kind == "webhook":\n        return 1\n` +
      `    elif kind == "cron":\n        return 2\n` +
      `    elif kind == "manual":\n        return 3\n` +
      `    elif kind == "email":\n        return 4\n` +
      `    raise ValueError(kind)\n`,
    // project idiom: the same 3 tokens spread across 8 modules — vocabulary, not a domain
    ...Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`src/mod${i}.py`, `STATUS = ["queued", "running", "done"]\n`]),
    ),
    // a python test file spelling the domain again is evidence, not surface — never a site
    "src/test_dispatch.py": `COPY = ["webhook", "cron", "manual", "email"]\n`,
  });
  try {
    const sites = await collectSites(cfg(root));
    const dict = sites.find((s) => s.name === "TRIGGER_TYPES");
    const chain = sites.find((s) => s.name === "kind");
    assert.ok(dict && dict.kind === "table" && dict.file === "src/registry.py", "dict literal is a table site");
    assert.deepEqual(dict.keys, ["cron", "email", "manual", "webhook"]);
    assert.ok(chain && chain.kind === "compare" && chain.file === "src/dispatch.py", "if/elif chain is a compare site");
    assert.deepEqual(chain.keys, ["cron", "email", "manual", "webhook"]);
    assert.ok(!sites.some((s) => s.file === "src/test_dispatch.py"), "python test files are excluded");

    // undeclared: the dict/chain pair ranks above the reporting floor
    const { pairs } = pairSites(sites, new Set());
    const shown = shownPairs(pairs);
    const isPair = (p: { a: { name: string }; b: { name: string } }) =>
      [p.a.name, p.b.name].sort().join("|") === "TRIGGER_TYPES|kind";
    assert.ok(shown.some(isPair), "the two .py spellings must rank as a candidate");

    // idiom: STATUS tokens sit at 8 sites (> maxDf) — no STATUS pair anywhere, even unshown
    assert.ok(!pairs.some((p) => p.a.name === "STATUS" || p.b.name === "STATUS"), "high-df idiom must not pair");

    // declared: a parity claim naming the domain suppresses the pair — found → declared
    const g = graph([comp("src", {
      claims: ['parity "dispatch totality" over TRIGGER_TYPES between dispatch and describe_trigger via test "test_dispatch_parity"'],
    })]);
    const declared = pairSites(sites, declaredParitySymbols(g));
    assert.ok(!declared.pairs.some(isPair), "a declared pair is not a finding");
    assert.ok(declared.suppressed.declared >= 1, "the suppression is counted out loud");
  } finally { await cleanup(root); }
});
