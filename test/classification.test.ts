import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
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

test("CLI executes guarantee-owned falsifiers and appends content-addressed receipts", async () => {
  const executable = base({ dispositions: {
    "G-AUTHORITY.authority-named": { status: "satisfied", evidence: ["src/source.ts"], falsifier: { command: process.execPath, args: ["-e", "process.exit(0)"] } },
    "G-AUTHORITY.reconstruction": { status: "satisfied", evidence: ["test/rebuild.test.ts"], falsifier: { command: process.execPath, args: ["-e", "process.stdout.write('passed')"] } },
  } });
  const root = await tmpProject({ "classification.json": JSON.stringify(executable) });
  try {
    const { stdout } = await exec(process.execPath, [CLI, "classify-check", "classification.json", "--execute", "--journal", ".coherence/classification-receipts.jsonl", "--json"], { cwd: root });
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    assert.equal(result.receipts.length, 2);
    assert.ok(result.receipts.every((receipt: { passed: boolean; commandHash: string; catalogHash: string; evidenceHash: string; receiptHash: string }) =>
      receipt.passed && receipt.commandHash.length === 64 && receipt.catalogHash.length === 64 && receipt.evidenceHash.length === 64 && receipt.receiptHash.length === 64));
    const rows = (await readFile(join(root, ".coherence/classification-receipts.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(rows.length, 2);
    assert.deepEqual(rows, result.receipts);
  } finally { await cleanup(root); }
});

test("execution fails closed on missing and failing falsifiers", async () => {
  const failing = base({ dispositions: {
    "G-AUTHORITY.authority-named": { status: "satisfied", evidence: ["src/source.ts"] },
    "G-AUTHORITY.reconstruction": { status: "satisfied", evidence: ["test/rebuild.test.ts"], falsifier: { command: process.execPath, args: ["-e", "process.exit(7)"] } },
  } });
  const root = await tmpProject({ "classification.json": JSON.stringify(failing) });
  try {
    const run = await exec(process.execPath, [CLI, "classify-check", "classification.json", "--execute", "--json"], { cwd: root })
      .then(({ stdout }) => ({ code: 0, stdout })).catch((error: { code: number; stdout: string }) => ({ code: error.code, stdout: error.stdout }));
    const result = JSON.parse(run.stdout);
    assert.equal(run.code, 1);
    assert.equal(result.ok, false);
    assert.deepEqual(result.diagnostics.map((item: { code: string }) => item.code), ["FALSIFIER_FAILED", "FALSIFIER_MISSING"]);
    assert.equal(result.receipts[0].passed, false);
    const rows = (await readFile(join(root, ".coherence/classification-receipts.jsonl"), "utf8")).trim().split("\n");
    assert.equal(rows.length, 1, "--execute journals by default, including negative evidence");
  } finally { await cleanup(root); }
});

test("execution reports malformed falsifiers without invoking them", async () => {
  const malformed = base({ dispositions: {
    "G-AUTHORITY.authority-named": { status: "satisfied", evidence: ["src/source.ts"], falsifier: { command: "", timeoutMs: -1 } },
    "G-AUTHORITY.reconstruction": { status: "satisfied", evidence: ["test/rebuild.test.ts"], falsifier: { command: process.execPath, args: ["-e", "process.exit(0)"] } },
  } });
  const root = await tmpProject({ "classification.json": JSON.stringify(malformed) });
  try {
    const run = await exec(process.execPath, [CLI, "classify-check", "classification.json", "--execute", "--json"], { cwd: root })
      .then(({ stdout }) => ({ code: 0, stdout })).catch((error: { code: number; stdout: string }) => ({ code: error.code, stdout: error.stdout }));
    const result = JSON.parse(run.stdout);
    assert.equal(run.code, 1);
    assert.equal(result.diagnostics[0].code, "FALSIFIER_INVALID");
    assert.equal(result.receipts.length, 1);
  } finally { await cleanup(root); }
});
