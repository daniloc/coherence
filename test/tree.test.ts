// tree.test.ts — THE ANTI-OVER-REPORT RULE, restored to direct evidence.
//
// WHY THIS FILE EXISTS, AND IT IS NOT A FLATTERING STORY. `claimedFilePaths` decides which
// of a component's files a claim BLESSES, and it drives the contract's `accounted` coverage
// numbers (src/promise.ts). Its whole doctrine is refusal: a claim token with several
// candidates blesses NONE, so a component with four `hooks.ts` can never read 4/4 claimed
// off one bare-basename claim. Over-reporting coverage is the failure it exists to prevent.
//
// Its only direct witness lived in `test/scene.test.ts`, and `scene` was evicted. The
// eviction was audited by TEST COUNT — 627 → 581, proven to be exactly the deleted suites
// and nothing else — and that audit was true and answered the wrong question. Counting what
// vanished says nothing about what the vanished tests were the SOLE WITNESS FOR. An
// adversarial review found the hole by mutation: flip the refusal to `for (const c of cands)
// blessed.add(c)` — bless every ambiguous candidate, the precise defect the function is
// built to prevent — and the full suite passes 593/593 while `verify` prints ✓ coherent. No
// spec anchor names this function, so the project's own "verify PLUS npm test" pre-deploy
// gate was blind to it in both directions at once.
//
// The asymmetry is the sharp part: mutating the function to bless NOTHING is caught (a
// promise.test.ts mass/accounted assertion reds), because under-reporting perturbs a number
// somebody already asserts. Only the OVER-report direction went dark — the direction that
// silently inflates a coverage figure a reader trusts. A guarantee is only defended in the
// direction someone actually tested.
//
// THE GENERAL LESSON, recorded here because it will recur: when a command is evicted, the
// question is not "did the test count drop by exactly the deleted suites" but "was any
// surviving guarantee ONLY witnessed there". The first is arithmetic; the second is the one
// that bites. This test is the deleted case ported to call `claimedFilePaths` directly,
// with no scene-model wrapper between the assertion and the rule.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedFilePaths } from "../src/tree.ts";
import type { GraphNode } from "../src/types.ts";

const file = (path: string): GraphNode => ({ id: `f:${path}`, label: path.split("/").pop()!, kind: "file", path } as GraphNode);

/** Four `hooks.ts` at different sub-paths plus a unique `index.ts` — the shape that makes
 *  the ambiguity rule observable at all. */
const FILES = ["index.ts", "a/hooks.ts", "b/hooks.ts", "c/hooks.ts", "d/hooks.ts"].map(file);

test("a UNIQUE basename claim blesses its file", () => {
  const blessed = claimedFilePaths(["index.ts exists at this node"], FILES);
  assert.deepEqual([...blessed], ["index.ts"]);
});

test("an AMBIGUOUS basename claim blesses NOTHING — the anti-over-report rule", () => {
  // The mutation that survived the whole suite was exactly this case returning all four.
  const blessed = claimedFilePaths(["hooks.ts exists at this node"], FILES);
  assert.deepEqual([...blessed], [],
    "four files carry the basename `hooks.ts`, so the claim names none of them unambiguously; blessing any of them over-reports coverage, and blessing all four reads as 4/4 claimed off a single claim");
});

test("a PATH-SUFFIX claim blesses exactly the file it names, and no same-named sibling", () => {
  const blessed = claimedFilePaths(["a/hooks.ts imports ./x", "b/hooks.ts exists at this node"], FILES);
  assert.deepEqual([...blessed].sort(), ["a/hooks.ts", "b/hooks.ts"]);
  for (const dark of ["c/hooks.ts", "d/hooks.ts"]) assert.ok(!blessed.has(dark), `${dark} was never named and must stay unblessed`);
});

test("the segment boundary is real: a suffix claim does not match a longer trailing segment", () => {
  // `hooks.ts` under `metadata/` must NOT be matched by a `data/hooks.ts` claim. A naive
  // `endsWith` passes the three tests above and fails this one — which is why it is here:
  // the deleted fixtures could not have caught it either (they had no overlapping
  // non-segment suffixes), so this is a gap the eviction merely revealed, not one it made.
  const files = [file("data/hooks.ts"), file("metadata/hooks.ts")];
  const blessed = claimedFilePaths(["data/hooks.ts exists at this node"], files);
  assert.deepEqual([...blessed], ["data/hooks.ts"], "`metadata/hooks.ts` ends with the string `data/hooks.ts` but not with the SEGMENT `data/`");
});

test("a boundary claim names a symbol, not a file, and blesses nothing here", () => {
  const blessed = claimedFilePaths(['boundary "x" at sym via test "t"'], FILES);
  assert.deepEqual([...blessed], []);
});

test("the fixture can actually be blessed (instrument check — an empty candidate set would make every assertion above vacuous)", () => {
  assert.equal(claimedFilePaths(["index.ts exists at this node"], FILES).size, 1);
  assert.equal(FILES.length, 5);
});
