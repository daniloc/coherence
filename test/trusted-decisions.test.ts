// trusted-decisions.test.ts — the fail-closed projection for verdict-bearing evidence.
//
// `readJournal` remains deliberately forensic: it salvages readable rows around damage.
// This guard pins the stronger contract used by regulation and orientation: one damaged
// surviving row makes the entire admissible population unavailable.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendDecision, readJournal, readTrustedJournal, sessionPath,
} from "../src/decisions.ts";
import { observeOrientation } from "../src/orient.ts";
import type { Config } from "../src/types.ts";
import { createWork } from "../src/work.ts";

const T = (n: number) => `2026-08-20T10:${String(n).padStart(2, "0")}:00.000Z`;

async function makeRoot(): Promise<Config> {
  return { root: await mkdtemp(join(tmpdir(), "coh-trusted-decisions-")) } as Config;
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function initializeGit(root: string): void {
  git(root, "init", "-q");
  git(root, "config", "user.email", "trusted-reader@example.invalid");
  git(root, "config", "user.name", "Trusted Reader Test");
}

async function rows(cfg: Config, session: string): Promise<Record<string, unknown>[]> {
  return (await readFile(sessionPath(cfg, session), "utf8"))
    .split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function replaceRows(
  cfg: Config, session: string, records: Record<string, unknown>[], suffix = "",
): Promise<void> {
  await writeFile(
    sessionPath(cfg, session),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n" + suffix,
  );
}

function assertRefusal(
  reading: ReturnType<typeof readTrustedJournal>, code: string, detail?: RegExp,
): void {
  assert.equal(reading.ok, false);
  if (reading.ok) assert.fail(`trusted projection admitted ${code} damage`);
  assert.deepEqual(reading.records, [], "damage must not expose a valid-looking subset");
  assert.deepEqual(reading.sessions, [], "damage must not expose derived session facts");
  assert.ok(
    reading.damage.some((damage) => damage.code === code && (!detail || detail.test(damage.detail))),
    `expected ${code} damage${detail ? ` matching ${detail}` : ""}: ${JSON.stringify(reading.damage)}`,
  );
}

test("trusted journal — any malformed, forged, displaced, conflicting, or dangling row refuses the verdict projection", async (t) => {
  await t.test("released legacy and structured rows are both admissible", async () => {
    const cfg = await makeRoot();
    const session = "s-valid";
    try {
      const legacy = appendDecision(cfg, {
        kind: "decision", chose: "preserve the old wire grade", because: "old addresses remain live",
        session, agent: "agent", now: T(1),
      });
      const structured = appendDecision(cfg, {
        kind: "decision", chose: "coordinate by explicit fields", because: "swarm readers need addresses",
        work: "wrk-17", subject: "architecture:journal-admission",
        scope: {
          components: ["Harness"],
          files: ["src/signal.ts", "src/decisions.ts", "src/signal.ts"],
        },
        authority: "orchestrator-accepted", session, agent: "agent", now: T(2),
      });
      const question = appendDecision(cfg, {
        kind: "conjecture", chose: "is the old terminal address still readable?", because: "",
        couldBe: ["[instrument] the fixture is wrong"], discriminatedBy: "strictly read the frozen grade",
        session, agent: "agent", now: T(3),
      });
      appendDecision(cfg, {
        kind: "resolution", chose: "the frozen grade is readable", because: "the target exists",
        supersedes: question.id, session, agent: "agent", now: T(4),
      });

      // Before the supersedes target joined terminal identity, this was the released
      // content address. One such row is valid history; a many-target collision below is not.
      const onDisk = await rows(cfg, session);
      onDisk[3].id = "d-" + createHash("sha256")
        .update(["resolution", "agent", "the frozen grade is readable", "", "the target exists"].join("\0"))
        .digest("hex").slice(0, 8);
      await replaceRows(cfg, session, onDisk);

      assert.equal(legacy.version, undefined, "an unstructured write stays byte-compatible V1");
      assert.equal(structured.version, 2);
      assert.deepEqual(structured.scope?.files, ["src/decisions.ts", "src/signal.ts"]);
      const trusted = readTrustedJournal(cfg);
      assert.equal(trusted.ok, true, trusted.ok ? undefined : JSON.stringify(trusted.damage));
      if (trusted.ok) assert.equal(trusted.records.length, 4);
    } finally { await rm(cfg.root, { recursive: true, force: true }); }
  });

  await t.test("malformed syntax and shape refuse all otherwise-readable rows", async () => {
    const cfg = await makeRoot();
    const session = "s-malformed";
    try {
      appendDecision(cfg, {
        kind: "decision", chose: "readable history", because: "the forensic surface keeps it",
        session, agent: "agent", now: T(1),
      });
      const onDisk = await rows(cfg, session);
      onDisk[0].at = "2026-08-20T10:01:00Z";
      onDisk[0].unexpected = "unknown fields cannot silently widen trusted evidence";
      await replaceRows(cfg, session, onDisk, "{not-json\n");

      assert.equal(readJournal(cfg).records.length, 1, "forensic recovery remains separately available");
      const trusted = readTrustedJournal(cfg);
      assertRefusal(trusted, "parse");
      assertRefusal(trusted, "shape", /unknown field/);
      assertRefusal(trusted, "timestamp", /canonical UTC/);
    } finally { await rm(cfg.root, { recursive: true, force: true }); }
  });

  await t.test("forged content refuses its stale content address", async () => {
    const cfg = await makeRoot();
    const session = "s-forged";
    try {
      appendDecision(cfg, {
        kind: "decision", chose: "keep the boundary", because: "the oracle owns it",
        session, agent: "agent", now: T(1),
      });
      const onDisk = await rows(cfg, session);
      onDisk[0].chose = "silently edited choice";
      await replaceRows(cfg, session, onDisk);

      assert.equal(readJournal(cfg).records.length, 1, "the tolerant reader can show the edited row");
      assertRefusal(readTrustedJournal(cfg), "identity", /does not match recomputed/);
    } finally { await rm(cfg.root, { recursive: true, force: true }); }
  });

  await t.test("a row displaced from its attributable session file refuses", async () => {
    const cfg = await makeRoot();
    try {
      appendDecision(cfg, {
        kind: "decision", chose: "stay attributable", because: "the file is structural identity",
        session: "s-right", agent: "agent", now: T(1),
      });
      await rename(
        sessionPath(cfg, "s-right"),
        join(cfg.root, ".coherence", "decisions", "s-wrong.jsonl"),
      );
      assertRefusal(readTrustedJournal(cfg), "session-file", /anchored by neither/);
    } finally { await rm(cfg.root, { recursive: true, force: true }); }
  });

  await t.test("two legacy terminal rows sharing one address but naming different targets refuse", async () => {
    const cfg = await makeRoot();
    const session = "s-conflict";
    try {
      const first = appendDecision(cfg, {
        kind: "conjecture", chose: "question one", because: "",
        couldBe: ["[instrument] counter"], discriminatedBy: "run one",
        session, agent: "agent", now: T(1),
      });
      const second = appendDecision(cfg, {
        kind: "conjecture", chose: "question two", because: "",
        couldBe: ["[instrument] counter"], discriminatedBy: "run two",
        session, agent: "agent", now: T(2),
      });
      appendDecision(cfg, {
        kind: "resolution", chose: "same answer", because: "same evidence",
        supersedes: first.id, session, agent: "agent", now: T(3),
      });
      appendDecision(cfg, {
        kind: "resolution", chose: "same answer", because: "same evidence",
        supersedes: second.id, session, agent: "agent", now: T(4),
      });
      const legacyId = "d-" + createHash("sha256")
        .update(["resolution", "agent", "same answer", "", "same evidence"].join("\0"))
        .digest("hex").slice(0, 8);
      const onDisk = await rows(cfg, session);
      onDisk[2].id = legacyId;
      onDisk[3].id = legacyId;
      await replaceRows(cfg, session, onDisk);

      assertRefusal(readTrustedJournal(cfg), "duplicate-conflict", /content address conflicts/);
    } finally { await rm(cfg.root, { recursive: true, force: true }); }
  });

  await t.test("a dangling terminal target refuses", async () => {
    const cfg = await makeRoot();
    try {
      appendDecision(cfg, {
        kind: "retraction", chose: "withdraw missing choice", because: "refuted",
        supersedes: "d-deadbeef", session: "s-dangling", agent: "agent", now: T(1),
      });
      assertRefusal(readTrustedJournal(cfg), "reference", /does not exist/);
    } finally { await rm(cfg.root, { recursive: true, force: true }); }
  });

  await t.test("storage framing and containment damage refuse instead of shrinking history", async () => {
    const renamed = await makeRoot();
    try {
      const record = appendDecision(renamed, {
        kind: "decision", chose: "keep all surviving history visible", because: "renames are evidence damage",
        session: "s-renamed", agent: "agent", now: T(1),
      });
      await writeFile(join(renamed.root, ".coherence", "decisions", "history.jsonl.bak"), JSON.stringify(record) + "\n");
      assertRefusal(readTrustedJournal(renamed), "storage", /unexpected journal entry/);
    } finally { await rm(renamed.root, { recursive: true, force: true }); }

    const torn = await makeRoot();
    try {
      appendDecision(torn, {
        kind: "decision", chose: "require append framing", because: "a partial final row must stay loud",
        session: "s-torn", agent: "agent", now: T(1),
      });
      const path = sessionPath(torn, "s-torn");
      await writeFile(path, (await readFile(path, "utf8")).trimEnd());
      assertRefusal(readTrustedJournal(torn), "storage", /no canonical final newline/);
    } finally { await rm(torn.root, { recursive: true, force: true }); }

    const blank = await makeRoot();
    try {
      appendDecision(blank, {
        kind: "decision", chose: "reject blank rows", because: "silent gaps can hide lost appends",
        session: "s-blank", agent: "agent", now: T(1),
      });
      await writeFile(sessionPath(blank, "s-blank"), (await readFile(sessionPath(blank, "s-blank"), "utf8")) + "\n");
      assertRefusal(readTrustedJournal(blank), "storage", /blank journal row/);
    } finally { await rm(blank.root, { recursive: true, force: true }); }

    const wrongShape = await makeRoot();
    try {
      await mkdir(join(wrongShape.root, ".coherence"), { recursive: true });
      await writeFile(join(wrongShape.root, ".coherence", "decisions"), "not a directory\n");
      assertRefusal(readTrustedJournal(wrongShape), "storage", /real repository directory/);
    } finally { await rm(wrongShape.root, { recursive: true, force: true }); }

    const linked = await makeRoot();
    const external = await mkdtemp(join(tmpdir(), "coh-trusted-external-"));
    try {
      await mkdir(join(external, "decisions"), { recursive: true });
      await symlink(external, join(linked.root, ".coherence"));
      assertRefusal(readTrustedJournal(linked), "storage", /never a symlink/);
      assert.throws(() => appendDecision(linked, {
        kind: "decision", chose: "do not redirect writes", because: "the repository boundary owns evidence",
        session: "s-linked", agent: "agent", now: T(1),
      }), /real repository directory|contained/);
      assert.deepEqual(await readdir(join(external, "decisions")), [],
        "a linked parent cannot receive a decision append outside the repository");
    } finally {
      await rm(linked.root, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });

  await t.test("case-distinct sessions use portable non-aliasing decision addresses", async () => {
    const cfg = await makeRoot();
    try {
      appendDecision(cfg, {
        kind: "decision", chose: "upper owner", because: "case is part of session identity",
        session: "Owner", agent: "agent", now: T(1),
      });
      appendDecision(cfg, {
        kind: "decision", chose: "lower owner", because: "case is part of session identity",
        session: "owner", agent: "agent", now: T(2),
      });
      assert.notEqual(sessionPath(cfg, "Owner"), sessionPath(cfg, "owner"));
      const trusted = readTrustedJournal(cfg);
      assert.equal(trusted.ok, true, trusted.ok ? undefined : JSON.stringify(trusted.damage));
      if (trusted.ok) assert.equal(trusted.records.length, 2);
    } finally { await rm(cfg.root, { recursive: true, force: true }); }
  });

  await t.test("committed nonempty history cannot disappear into adoption from zero", async () => {
    const cfg = await makeRoot();
    try {
      initializeGit(cfg.root);
      appendDecision(cfg, {
        kind: "decision", chose: "retain committed evidence", because: "history is the external deletion witness",
        session: "s-remembered", agent: "agent", now: T(1),
      });
      git(cfg.root, "add", ".coherence/decisions");
      git(cfg.root, "commit", "-qm", "remember a nonempty decision population");
      await rm(join(cfg.root, ".coherence"), { recursive: true, force: true });
      git(cfg.root, "add", "-u"); // the HEAD comparison must also see a staged deletion

      assertRefusal(readTrustedJournal(cfg), "storage", /HEAD owns 1 deleted decision file/);
    } finally { await rm(cfg.root, { recursive: true, force: true }); }

    const adoption = await makeRoot();
    try {
      initializeGit(adoption.root);
      await writeFile(join(adoption.root, "README.md"), "# first adoption\n");
      git(adoption.root, "add", "README.md");
      git(adoption.root, "commit", "-qm", "repository before its first decision");

      const trusted = readTrustedJournal(adoption);
      assert.equal(trusted.ok, true, trusted.ok ? undefined : JSON.stringify(trusted.damage));
      if (trusted.ok) assert.deepEqual(trusted.records, []);
    } finally { await rm(adoption.root, { recursive: true, force: true }); }
  });

  await t.test("decision corruption dominates dispatch without hiding healthy work evidence", async () => {
    const cfg = await makeRoot();
    try {
      const ready = createWork(cfg, {
        session: "s-worker", agent: "worker", objective: "perform dependency-clear work",
        criteria: ["result exists"],
        authority: { kind: "orchestrator-delegated", grantedBy: "orchestrator", boundary: "one fixture" },
        risk: "medium", writeScopes: ["src/ready.ts"], now: T(1),
      });
      appendDecision(cfg, {
        kind: "decision", chose: "retain the ready heading", because: "corruption must outrank it",
        session: "s-corrupt", agent: "agent", now: T(2),
      });
      const onDisk = await rows(cfg, "s-corrupt");
      onDisk[0].chose = "edited without re-addressing";
      await replaceRows(cfg, "s-corrupt", onDisk);

      const reading = await observeOrientation(cfg);
      assert.equal(reading.action, "refuse");
      assert.deepEqual(reading.sources.filter((source) => !source.ok).map((source) => source.name), ["decisions"]);
      assert.equal(reading.sources.find((source) => source.name === "work")?.ok, true);
      assert.deepEqual(reading.work?.ready, [ready.work], "the healthy competing source remains observable");
      assert.equal(reading.decisions, null, "no valid-looking subset escapes the damaged source");
    } finally { await rm(cfg.root, { recursive: true, force: true }); }
  });
});
