import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkClassification, type ClassificationFixture } from "../src/classification.ts";
import { cleanup, tmpProject } from "./_helpers.ts";

const exec = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");
const base = (over: Partial<ClassificationFixture> = {}): ClassificationFixture => ({
  schemaVersion: 1, component: "search-index", evidenceStatus: "supported", primary: "derived-state",
  facets: ["rebuildable"], authority: "documents-store", evidence: ["src/search/index.ts#rebuild"],
  dispositions: {
    "G-AUTHORITY.authority-named": { status: "satisfied", evidence: ["src/search/index.ts#source"] },
    "G-AUTHORITY.reconstruction": { status: "satisfied", evidence: ["test/search/rebuild.test.ts"] },
  }, ...over,
});

test("Phase 0 accepts a supported derived rebuildable component", () => {
  const result = checkClassification(base());
  assert.equal(result.ok, true);
  assert.deepEqual(result.activatedGuarantees.map((g) => g.id), ["G-AUTHORITY.authority-named", "G-AUTHORITY.reconstruction"]);
});

test("Phase 0 discriminates the six frozen broken cases", () => {
  const cases: Array<[string, ClassificationFixture, string]> = [
    ["missing authority", base({ authority: undefined }), "AUTHORITY_MISSING"],
    ["unknown class", base({ primary: "cache" }), "CLASS_UNKNOWN"],
    ["missing disposition", base({ dispositions: { "G-AUTHORITY.authority-named": { status: "satisfied", evidence: ["x"] } } }), "MANDATORY_DISPOSITION_MISSING"],
    ["unresolved reconstruction", base({ dispositions: { ...base().dispositions, "G-AUTHORITY.reconstruction": { status: "unresolved" } } }), "MANDATORY_UNRESOLVED"],
    ["unsupported extra", base({ dispositions: { ...base().dispositions, "G-OTHER.nope": { status: "satisfied", evidence: ["x"] } } }), "GUARANTEE_UNKNOWN"],
    ["unknown facet", base({ facets: ["rebuildable", "distributed"] }), "FACET_UNKNOWN"],
  ];
  for (const [label, fixture, code] of cases) {
    const result = checkClassification(fixture);
    assert.equal(result.ok, false, label);
    assert.ok(result.diagnostics.some((d) => d.code === code), label);
  }
});

test("CLI JSON is deterministic and unresolved mandatory guarantees exit one", async () => {
  const fixture = base({ dispositions: { ...base().dispositions, "G-AUTHORITY.reconstruction": { status: "unresolved" } } });
  const root = await tmpProject({ "classification.json": JSON.stringify(fixture) });
  const run = () => exec(process.execPath, [CLI, "classify-check", "classification.json", "--json"], { cwd: root })
    .then(({ stdout }) => ({ code: 0, stdout })).catch((e: { code: number; stdout: string }) => ({ code: e.code, stdout: e.stdout }));
  try {
    const first = await run(); const second = await run();
    assert.equal(first.code, 1); assert.equal(second.code, 1); assert.equal(first.stdout, second.stdout);
    assert.equal(JSON.parse(first.stdout).diagnostics[0].code, "MANDATORY_UNRESOLVED");
  } finally { await cleanup(root); }
});
