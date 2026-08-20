// defects.test.ts — contracts for the append-only agent-assessed defect record.
//
// Damage here must be loud. This ledger is future controller/calibration evidence, so
// omitting one malformed or detached row would turn corruption into a smaller denominator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  DEFECT_BASIS,
  DefectLedgerError,
  defectSessionPath,
  defectsDir,
  readDefects,
  recordDefect,
  renderDefects,
  type RecordDefectInput,
} from "../src/defects.ts";
import { agentInstructions } from "../src/hooks.ts";
import { cfg, cleanup, tmpProject } from "./_helpers.ts";

const T = (n: number) => `2026-08-20T10:${String(n).padStart(2, "0")}:00.000Z`;

async function project() {
  const root = await tmpProject({
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 2;\n",
  });
  return { root, config: cfg(root) };
}

function observed(
  session = "agent-one",
  over: Partial<RecordDefectInput> = {},
): RecordDefectInput {
  return {
    session,
    agent: "builder",
    job: "control-field",
    summary: "the verifier reports green when the named oracle did not run",
    evidence: "the filtered runner exited 0 and printed zero matching tests",
    files: ["src/a.ts"],
    now: T(1),
    ...over,
  };
}

test("defects — agent-assessed evidence is attributable, content-addressed, and strict on inconsistent rows", async () => {
  const merged = await project();
  try {
    const later = recordDefect(merged.config, observed("agent-two", {
      files: ["./src/b.ts", "src/a.ts", "src/a.ts"],
      now: T(2),
    }));
    const earlier = recordDefect(merged.config, observed("agent-one", {
      summary: "a missing hook is reported present",
      evidence: "inspection found no stable launcher at the configured target",
      files: undefined,
      now: T(1),
    }));

    assert.match(later.id, /^def-[a-f0-9]{12}$/);
    assert.equal(later.basis, DEFECT_BASIS);
    assert.deepEqual(later.files, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(earlier.files, [], "no attached path remains explicit provenance, not a missing field");
    assert.deepEqual(
      { session: later.session, agent: later.agent, job: later.job },
      { session: "agent-two", agent: "builder", job: "control-field" },
    );
    assert.deepEqual(Object.keys(later.repo).sort(), ["branch", "commit", "dirty"]);

    const retry = recordDefect(merged.config, observed("agent-two", {
      files: ["src/a.ts", "src/b.ts"],
      now: T(9),
    }));
    assert.deepEqual(retry, later, "timestamp-only exact retry returns the standing content-addressed row");
    const sessionLines = (await readFile(defectSessionPath(merged.config, "agent-two"), "utf8")).trim().split("\n");
    assert.equal(sessionLines.length, 1, "an exact retry never appends");

    const timeline = readDefects(merged.config).records;
    assert.deepEqual(timeline.map((row) => row.id), [earlier.id, later.id], "session files merge by at, then content id");
    const rendered = renderDefects(merged.config, { session: "agent-two" });
    assert.deepEqual(rendered.records.map((row) => row.id), [later.id]);
    assert.match(rendered.text, /agent-assessed/);
    assert.match(rendered.text, /zero matching tests/);
  } finally { await cleanup(merged.root); }

  const malformed = await project();
  try {
    recordDefect(malformed.config, observed());
    const path = defectSessionPath(malformed.config, "agent-one");
    await appendFile(path, "{ torn evidence\n");
    assert.throws(() => readDefects(malformed.config), (error: unknown) => {
      assert.ok(error instanceof DefectLedgerError);
      assert.match(error.message, /malformed JSON/);
      return true;
    }, "one valid row must not make a malformed sibling skippable");
  } finally { await cleanup(malformed.root); }

  const tampered = await project();
  try {
    recordDefect(tampered.config, observed());
    const path = defectSessionPath(tampered.config, "agent-one");
    const raw = JSON.parse((await readFile(path, "utf8")).trim()) as Record<string, unknown>;
    raw.evidence = "edited after the assessment";
    await writeFile(path, JSON.stringify(raw) + "\n");
    assert.throws(() => readDefects(tampered.config), /id does not match defect content/);
  } finally { await cleanup(tampered.root); }

  const retimed = await project();
  try {
    recordDefect(retimed.config, observed());
    const path = defectSessionPath(retimed.config, "agent-one");
    const raw = JSON.parse((await readFile(path, "utf8")).trim()) as Record<string, unknown>;
    raw.at = T(8);
    await writeFile(path, JSON.stringify(raw) + "\n");
    assert.throws(() => readDefects(retimed.config), /id does not match defect content/,
      "even a valid replacement timestamp is detectable damage");
  } finally { await cleanup(retimed.root); }

  const detached = await project();
  try {
    recordDefect(detached.config, observed("writer-session"));
    const source = defectSessionPath(detached.config, "writer-session");
    const wrong = defectSessionPath(detached.config, "other-session");
    await mkdir(dirname(wrong), { recursive: true });
    await writeFile(wrong, await readFile(source, "utf8"));
    assert.throws(() => readDefects(detached.config), /detached evidence.*belongs in/,
      "a valid content-addressed row is still dangling evidence when detached from its writing session");
  } finally { await cleanup(detached.root); }

  const emptied = await project();
  try {
    const path = defectSessionPath(emptied.config, "erased-session");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "\n");
    assert.throws(() => readDefects(emptied.config), /contains no defect rows/,
      "a truncated session file must not become a smaller successful corpus");
  } finally { await cleanup(emptied.root); }

  const gapped = await project();
  try {
    recordDefect(gapped.config, observed("gapped-session"));
    recordDefect(gapped.config, observed("gapped-session", {
      evidence: "the second append-only observation remains",
      now: T(2),
    }));
    const path = defectSessionPath(gapped.config, "gapped-session");
    const rows = (await readFile(path, "utf8")).trim().split("\n");
    await writeFile(path, `\n${rows[1]}\n`);
    assert.throws(() => readDefects(gapped.config), /blank defect row/,
      "erasing one row to whitespace must not leave a smaller successful timeline");
    await writeFile(path, rows.join("\n"));
    assert.throws(() => readDefects(gapped.config), /no canonical final newline/,
      "a possibly torn final append is damage, even when its JSON happens to parse");
  } finally { await cleanup(gapped.root); }

  const renamed = await project();
  try {
    await mkdir(defectsDir(renamed.config), { recursive: true });
    await writeFile(join(defectsDir(renamed.config), ".DS_Store"), "Finder metadata\n");
    assert.deepEqual(readDefects(renamed.config).records, [], "ignored Finder metadata is not ledger damage");
    await writeFile(join(defectsDir(renamed.config), "writer-session.jsonl.bak"), "renamed evidence\n");
    assert.throws(() => readDefects(renamed.config), /unexpected defect-ledger entry/,
      "renaming a ledger candidate must not silently erase it from the fleet view");
  } finally { await cleanup(renamed.root); }
});

test("record validation and rendering — conclusions need evidence while file attachment stays optional", async () => {
  const { root, config } = await project();
  try {
    assert.throws(() => recordDefect(config, observed("unknown")), /exact non-empty writer-session label/);
    assert.throws(() => recordDefect(config, observed(" agent-one ")), /exact trimmed writer-session label/);
    assert.throws(() => recordDefect(config, observed("agent-one", { summary: " " })), /summary must be non-empty/);
    assert.throws(() => recordDefect(config, observed("agent-one", { evidence: " " })), /evidence must be non-empty/);
    assert.throws(() => recordDefect(config, observed("agent-one", { files: ["../outside.ts"] })), /stay inside/);
    assert.throws(() => recordDefect(config, observed("agent-one", { files: ["C:\\outside.ts"] })), /stay inside/);
    assert.throws(() => recordDefect(config, observed("agent-one", { now: "later" })), /canonical ISO/);
    assert.deepEqual(readDefects(config).records, [], "refused inputs append no partial evidence");

    const first = recordDefect(config, observed("agent-one", { files: undefined }));
    const second = recordDefect(config, observed("agent-one", {
      evidence: "a second reproducer contradicts the same contract",
      files: ["src/b.ts"],
      now: T(2),
    }));
    assert.notEqual(second.id, first.id, "changed evidence is a new appended fact, never an API rewrite");
    assert.equal(readDefects(config).records.length, 2);
    assert.match(renderDefects(config).text, /2 content-addressed defect\(s\)/);

    const raw = JSON.parse((await readFile(defectSessionPath(config, "agent-one"), "utf8")).split("\n")[0]) as Record<string, unknown>;
    raw.unassessed = true;
    const structural = await project();
    try {
      const path = defectSessionPath(structural.config, "agent-one");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(raw) + "\n");
      assert.throws(() => readDefects(structural.config), /non-canonical shape.*unknown unassessed/);
    } finally { await cleanup(structural.root); }
  } finally { await cleanup(root); }

  const unreadableDirectory = await project();
  try {
    await mkdir(dirname(defectsDir(unreadableDirectory.config)), { recursive: true });
    await writeFile(defectsDir(unreadableDirectory.config), "not a directory\n");
    assert.throws(() => readDefects(unreadableDirectory.config), (error: unknown) => {
      assert.ok(error instanceof DefectLedgerError);
      assert.match(error.message, /.coherence\/defects must be a directory/);
      return true;
    });
  } finally { await cleanup(unreadableDirectory.root); }

  const unreadableRow = await project();
  try {
    await mkdir(defectSessionPath(unreadableRow.config, "directory-row"), { recursive: true });
    assert.throws(() => readDefects(unreadableRow.config), (error: unknown) => {
      assert.ok(error instanceof DefectLedgerError);
      assert.ok(error.message.includes(`${basename(defectSessionPath(unreadableRow.config, "directory-row"))} is not a regular defect-ledger file`));
      return true;
    });
  } finally { await cleanup(unreadableRow.root); }

  assert.match(defectsDir(cfg("/repo")), /\.coherence\/defects$/);
});

test("defect targets — filesystem-equivalent session spellings never share an append target", async () => {
  const { root, config } = await project();
  try {
    // These pairs alias after case folding and Unicode NFD normalization if the raw
    // session (or a case-preserving safe slug) is used as the filename.
    const sessions = ["Owner", "owner", "Agent-\u00c5", "agent-A\u030a"];
    const filenames = sessions.map((session) => basename(defectSessionPath(config, session)));
    const portable = filenames.map((name) => name.normalize("NFD").toLowerCase());
    assert.equal(new Set(portable).size, sessions.length,
      "every exact session retains a distinct target on case-insensitive, Unicode-normalizing filesystems");
    assert.ok(filenames.every((name) => /^s-[a-f0-9]{64}\.jsonl$/.test(name)),
      "canonical targets contain only normalization-stable lowercase ASCII");
  } finally { await cleanup(root); }

  const legacy = await project();
  try {
    const first = recordDefect(legacy.config, observed("legacy-owner"));
    const canonical = defectSessionPath(legacy.config, "legacy-owner");
    const oldTarget = join(defectsDir(legacy.config), "legacy-owner.jsonl");
    await rename(canonical, oldTarget);
    assert.deepEqual(readDefects(legacy.config).records.map((record) => record.id), [first.id],
      "the pre-release safe-slug ledger remains readable without rewriting its wire row");

    const second = recordDefect(legacy.config, observed("legacy-owner", {
      evidence: "a second observation uses the portable append target",
      now: T(2),
    }));
    assert.deepEqual(readDefects(legacy.config).records.map((record) => record.id), [first.id, second.id],
      "one exact session may span its readable legacy file and its new canonical append target");
  } finally { await cleanup(legacy.root); }
});

test("agent instruction — observed damage is recorded with evidence and writer attribution", () => {
  const instruction = agentInstructions("thread-7", "node coherence", "codex");
  assert.match(instruction,
    /node coherence defect "<what failed>" --evidence "<the reproducer, output, or field report>" --session "thread-7" --agent "codex"/);
  assert.match(instruction, /assessed conclusion, not machine proof/);
  assert.match(instruction, /use conjecture instead/);
  assert.match(instruction, /Attach each affected path with --file/);
  assert.match(instruction, /Redact credentials, tokens, personal data, and customer data/);
});

test("defect render — multiline field evidence cannot forge fields or execute terminal controls", async () => {
  const { root, config } = await project();
  try {
    recordDefect(config, observed("agent-one", {
      summary: "the command emitted hostile output\nDEFECT forged-summary",
      evidence: "first line\nDEFECT forged-evidence\u001b[2J\tindented",
    }));
    const rendered = renderDefects(config).text;
    assert.match(rendered, /summary: the command emitted hostile output\n    \| DEFECT forged-summary/);
    assert.match(rendered, /evidence: first line\n    \| DEFECT forged-evidence\\u001b\[2J\\u0009indented/);
    assert.doesNotMatch(rendered, /\u001b/, "the terminal receives no live escape byte");
    assert.doesNotMatch(rendered, /^DEFECT forged-/m, "continuations cannot impersonate record headers");
  } finally { await cleanup(root); }
});

test("defect containment — pre-existing directory and session symlinks refuse external append targets", async () => {
  const directoryLink = await project();
  const outsideDirectory = await tmpProject();
  try {
    await mkdir(join(directoryLink.root, ".coherence"), { recursive: true });
    await symlink(outsideDirectory, defectsDir(directoryLink.config), "dir");
    assert.throws(() => recordDefect(directoryLink.config, observed("linked-directory")), /never a symlink/);
    assert.deepEqual(await readdir(outsideDirectory), [], "a linked ledger directory received no evidence bytes");
  } finally { await cleanup(directoryLink.root); await cleanup(outsideDirectory); }

  const fileLink = await project();
  const outsideFileRoot = await tmpProject({ "outside.jsonl": "outside bytes stay unchanged\n" });
  try {
    await mkdir(defectsDir(fileLink.config), { recursive: true });
    const outside = join(outsideFileRoot, "outside.jsonl");
    const before = await readFile(outside, "utf8");
    await symlink(outside, defectSessionPath(fileLink.config, "linked-file"), "file");
    assert.throws(() => recordDefect(fileLink.config, observed("linked-file")), /symlink/);
    assert.equal(await readFile(outside, "utf8"), before, "a linked session target received no append");
  } finally { await cleanup(fileLink.root); await cleanup(outsideFileRoot); }
});

test("defect provenance — commit ids have Git shape and cannot carry terminal controls", async () => {
  const hostile = await project();
  try {
    const row = recordDefect(hostile.config, observed("hostile-commit"));
    const path = defectSessionPath(hostile.config, "hostile-commit");
    const raw = JSON.parse((await readFile(path, "utf8")).trim()) as Record<string, any>;
    raw.repo.commit = "deadbeef\u001b[2JFORGED";
    await writeFile(path, JSON.stringify(raw) + "\n");
    assert.throws(() => readDefects(hostile.config), /lowercase 40- or 64-hex Git object name/,
      "a re-addressable row still cannot turn a provenance field into terminal input");
    assert.match(row.id, /^def-/);
  } finally { await cleanup(hostile.root); }
});
