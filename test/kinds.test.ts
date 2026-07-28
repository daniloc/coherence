// kinds.test.ts — the three additions of 0.10.1, each of which exists because a
// consumer (daniloc/planetizer, a chaotic simulation) discovered that PREVENTING
// DRIFT and LOCKING IN BAD BEHAVIOUR are the same act seen from two sides.
//
//   CLAIM KINDS       what a claim is ALLOWED to assert, declared BY THE PROJECT.
//   REFUTATIONS       the observed negative control for an invariant.
//   NEVER-RED         green every run + nobody ever tried to break it = suspect.
//
// The load-bearing property of all three is that they are OFF by default: a project
// that declares no kinds parses exactly as it did in 0.10.0, and every advisory is
// advisory. Coherence holds no opinion about any project's epistemics; it enforces
// what that project declared. These tests pin that as hard as they pin the features.
//
// OBSERVED NEGATIVE CONTROL (2026-07-28, three features neutered one at a time in a
// single run): unknown-kind check -> only "UNKNOWN kind is RED" went red; list cap
// removed -> only the cap test; the `if (refs.length)` gate removed -> only the nag
// test. 10 pass / 3 fail, each control firing its own test and no other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpec } from "../src/walk.ts";
import { mergeClaimRecords, type ClaimRecord } from "../src/status.ts";
import { runVerify } from "../src/verify.ts";
import { parseBoundary } from "../src/boundary.ts";
import { renderClaude } from "../src/render-claude.ts";
import { tmpProject, cleanup, runCaptured, cfg, comp, graph } from "./_helpers.ts";

const rec = (claim: string, kind: ClaimRecord["kind"], o: Partial<ClaimRecord> = {}): ClaimRecord =>
  ({ node: "A", claim, kind, at: "2026-01-01T00:00:00.000Z", commit: "aaaa111", tier: "full", ...o });

// ── ## refutations ───────────────────────────────────────────────────────────────

test("refutations — a `## refutations` section parses like `## invariants`, keyed by invariant", () => {
  const s = parseSpec(`# comp
intent line

## invariants
- one write site per shared scalar

## refutations
- one write site per shared scalar: deleted sumChannel's total check -> RED, "1 failed | 3 passed"

## works when
- typechecks
`);
  assert.deepEqual(s.invariants, ["one write site per shared scalar"]);
  assert.equal(s.refutations.length, 1);
  assert.match(s.refutations[0], /^one write site per shared scalar: deleted/);
  // and it must NOT leak into the prose the why-lint reads
  assert.ok(!s.prose.includes("sumChannel"), "refutations must be excised from prose like every other section");
});

test("refutations — absent section yields an empty list, not undefined (every existing spec is unaffected)", () => {
  const s = parseSpec("# comp\nintent\n\n## works when\n- typechecks\n");
  assert.deepEqual(s.refutations, []);
});

// ── sticky red history ───────────────────────────────────────────────────────────

test("history — everFailed is STICKY: one red, then green forever, still reads everFailed", () => {
  let out = mergeClaimRecords([], [rec('passes test "t"', "fail")], null);
  assert.equal(out[0].everFailed, true);
  assert.equal(out[0].lastFailCommit, "aaaa111");
  for (let i = 0; i < 5; i++) out = mergeClaimRecords(out, [rec('passes test "t"', "pass", { commit: "bbbb222" })], null);
  assert.equal(out[0].everFailed, true, "a claim that has ever been red must never be able to forget it");
  assert.equal(out[0].lastFailCommit, "aaaa111", "and the commit it happened at is preserved, not overwritten by the greens");
  assert.equal(out[0].runs, 6);
});

test("history — a claim green from birth accumulates runs and stays everFailed:false", () => {
  let out: ClaimRecord[] = [];
  for (let i = 0; i < 4; i++) out = mergeClaimRecords(out, [rec('passes test "t"', "pass")], null);
  assert.equal(out[0].runs, 4);
  assert.ok(!out[0].everFailed);
});

test("history — a SKIP advances nothing: it neither counts as a run nor erases the sticky bit", () => {
  // The --fast tier skips the executable claims every commit. If a skip counted, a
  // project that only ever runs --fast would look seasoned without having been tested.
  let out = mergeClaimRecords([], [rec('passes test "t"', "fail")], null);
  out = mergeClaimRecords(out, [rec('passes test "t"', "skip", { detail: "executable tier (--fast)" })], null);
  assert.equal(out[0].kind, "fail", "skip must not clobber the real verdict — and here that verdict was RED");
  assert.equal(out[0].everFailed, true);
  assert.equal(out[0].runs, 1, "the skip must not count as a run");
});

test("history — a scoped run leaves out-of-scope history untouched", () => {
  const prev = [
    { ...rec('passes test "a"', "pass"), runs: 9, everFailed: true },
    { ...rec('passes test "b"', "pass"), node: "B", runs: 2 },
  ];
  const out = mergeClaimRecords(prev, [rec('passes test "a"', "pass")], new Set(["A"]));
  const b = out.find((c) => c.node === "B")!;
  assert.equal(b.runs, 2, "B was not evaluated, so its history must not move");
  const a = out.find((c) => c.node === "A")!;
  assert.equal(a.runs, 10);
  assert.equal(a.everFailed, true);
});

// ── claim kinds, end to end through runVerify ────────────────────────────────────

test("kinds — an UNKNOWN kind is RED, because a typo must not silently grade as unkinded", async () => {
  const root = await tmpProject({});
  const c = cfg(root, { claimKinds: { structural: { policy: "pin" } } });
  const g = graph([comp(".", { label: "A", claims: ["typechecks"], claimKinds: { typechecks: "structrual" }, why: "w" })]);
  const { code, out } = await runCaptured(() => runVerify(c, g, { fast: true }));
  assert.match(out, /unknown claim kind "structrual"/);
  assert.notEqual(code, 0, "an unknown kind must fail the run, not warn");
  await cleanup(root);
});

test("kinds — a declared kind is stripped before form matching, so the claim still evaluates", async () => {
  const root = await tmpProject({});
  const c = cfg(root, { claimKinds: { structural: { policy: "pin" } } });
  const g = graph([comp(".", { label: "A", claims: ["typechecks"], claimKinds: { typechecks: "structural" }, why: "w" })]);
  const { out } = await runCaptured(() => runVerify(c, g, { fast: true }));
  assert.match(out, /claims: 1 · 1 green/, "a kinded claim still evaluates");
  assert.match(out, /kinds: 1\/1 declared/);
  await cleanup(root);
});

test("kinds — a `warn` kind passes but is REPORTED every time, carrying the project's own reason", async () => {
  const root = await tmpProject({});
  const c = cfg(root, { claimKinds: { measured: { policy: "warn", why: "chaotic simulation" } } });
  const g = graph([comp(".", { label: "A", claims: ["typechecks"], claimKinds: { typechecks: "measured" }, why: "w" })]);
  const { out } = await runCaptured(() => runVerify(c, g, { fast: true }));
  assert.match(out, /1 on a warned kind/);
  assert.match(out, /kind "measured" — 1 claim\(s\): chaotic simulation/);
  await cleanup(root);
});

test("kinds — OFF BY DEFAULT: with no claimKinds configured, nothing is reported and a bare claim is fine", async () => {
  const root = await tmpProject({});
  const g = graph([comp(".", { label: "A", claims: ["typechecks"], why: "w" })]);
  const { out } = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
  assert.ok(!/^kinds:/m.test(out), "a project that declared no kinds must see no kind output at all");
  await cleanup(root);
});

test("refutations — verify reports the gap between declared invariants and observed controls", async () => {
  const root = await tmpProject({});
  const g = graph([comp(".", {
    label: "A", claims: ["typechecks"], why: "w",
    invariants: ["alpha", "beta"],
    refutations: ["alpha: deleted the guard -> RED"],
  })]);
  const { out } = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
  assert.match(out, /refutations: 1\/2 invariants carry an observed negative control/);
  assert.match(out, /\[refutation\] "beta" — never observed failing/);
  await cleanup(root);
});

test("refutations — a project that has declared NONE gets the count, not a line per invariant", async () => {
  // The nag test. planetizer has 17 invariants and had adopted nothing; the first cut
  // printed 17 advisory lines every run, which is how an advisory becomes wallpaper.
  const root = await tmpProject({});
  const g = graph([comp(".", { label: "A", claims: ["typechecks"], why: "w", invariants: ["alpha", "beta"] })]);
  const { out } = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
  assert.match(out, /refutations: 0\/2 .* — none declared/);
  assert.ok(!/\[refutation\]/.test(out), "no per-invariant list until the project has used the feature once");
  await cleanup(root);
});

test("advisory lists are capped, and the overflow is ANNOUNCED rather than silently dropped", async () => {
  const root = await tmpProject({});
  const invariants = Array.from({ length: 12 }, (_, i) => `inv-${i}`);
  const g = graph([comp(".", {
    label: "A", claims: ["typechecks"], why: "w",
    invariants,
    refutations: ["inv-0: broke it -> RED"],
  })]);
  const { out } = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
  assert.equal((out.match(/\[refutation\]/g) || []).length, 8, "capped at 8");
  assert.match(out, /… and 3 more \(not shown\)/, "11 missing − 8 shown = 3, stated out loud");
  await cleanup(root);
});

// ── the strip lives at the PARSE site, and that is load-bearing ──────────────────

test("kinds — parseSpec separates the kind, leaving a claim byte-identical to the unkinded one", () => {
  const body = (suffix: string) => `# c\nintent\n\n## works when\n- boundary "one write site" at integrate via test "budget closes"${suffix}\n`;
  const bare = parseSpec(body(""));
  const kinded = parseSpec(body(" [structural]"));
  assert.deepEqual(kinded.claims, bare.claims, "adding a kind must not change the claim text by one byte");
  assert.deepEqual(kinded.claimKinds, { [bare.claims[0]]: "structural" });
  assert.deepEqual(bare.claimKinds, {});
});

test("kinds — a kinded boundary claim still parses as a boundary (the 0.10.1 regression)", () => {
  // BOUNDARY_RE is anchored with `$`. The first cut stripped the kind inside evalClaim
  // only, so verify graded correctly while parseBoundary returned null for every kinded
  // claim — silently emptying the CLAUDE.md invariant table, the promise graph, the
  // panel, and the scene. Verify being green is exactly why it went unnoticed.
  const s = parseSpec(`# c\nintent\n\n## works when\n- boundary "one write site" at integrate via test "budget closes" [structural]\n`);
  const b = parseBoundary(s.claims[0]);
  assert.ok(b, "a kinded boundary claim must still reach every downstream consumer");
  assert.equal(b.inv, "one write site");
  assert.equal(b.chokepoint, "integrate");
  assert.equal(b.oracle, "budget closes");
});

// ── the generated CLAUDE.md is where the two facts have to SURVIVE ───────────────

test("claude — the invariant table carries kind + refutation status, and only when used", async () => {
  const g = graph([comp(".", {
    label: "sim",
    claims: ['boundary "one write site" at integrate via test "budget closes"',
             'boundary "biome chart is whole" at rainAt via test "biome reachability"'],
    claimKinds: { 'boundary "one write site" at integrate via test "budget closes"': "structural",
                  'boundary "biome chart is whole" at rainAt via test "biome reachability"': "measured" },
    invariants: ["one write site", "biome chart is whole"],
    refutations: ["one write site: added a second write -> RED"],
    why: "w",
  })]);
  const md = renderClaude(g, "2026-07-28");
  assert.match(md, /\| Invariant \| Component \| Chokepoint \| Oracle \| Kind \| Refuted\? \|/);
  assert.match(md, /\| one write site \| sim \| `integrate` \| `budget closes` \| `structural` \| observed \|/);
  assert.match(md, /\| biome chart is whole \| sim \| `rainAt` \| `biome reachability` \| `measured` \| — \|/);

  // A project using neither feature must get the table it got before either existed.
  const plain = graph([comp(".", { label: "sim", claims: ['boundary "one write site" at integrate via test "budget closes"'], invariants: ["one write site"], why: "w" })]);
  const md2 = renderClaude(plain, "2026-07-28");
  assert.match(md2, /\| Invariant \| Component \| Chokepoint \| Oracle \|\n/);
  assert.ok(!/Kind|Refuted/.test(md2), "no columns for features the project does not use");
});

// ── the intent is what every renderer shows, so it must be a whole sentence ──────

test("intent — the first PARAGRAPH, not the first line of a hard-wrapped one", () => {
  const s = parseSpec(`# game

The player's half of the program: the four priced verbs (\`tools.ts\`), the one
chokepoint every action crosses (\`actions.ts\`), and the save format (\`save.ts\`).

Some later prose.

## works when
- typechecks
`);
  assert.equal(s.intent,
    "The player's half of the program: the four priced verbs (`tools.ts`), the one " +
    "chokepoint every action crosses (`actions.ts`), and the save format (`save.ts`).");
  assert.match(s.prose, /Some later prose\./);
  assert.ok(!s.prose.includes("priced verbs"), "the intent must not also appear in prose");
});

test("intent — a genuinely one-line intent is unchanged, and a spec with none is empty", () => {
  assert.equal(parseSpec("# c\nintent line\n\n## works when\n- typechecks\n").intent, "intent line");
  assert.equal(parseSpec("# c\n\n## works when\n- typechecks\n").intent, "");
});
