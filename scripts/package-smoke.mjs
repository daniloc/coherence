#!/usr/bin/env node

// Exercise the bytes we publish, not the source tree that produced them. `npm pack`
// may run prepare (and therefore build), but this script deliberately never invokes the
// test suite: CI and the publish workflow run it once, immediately before this gate.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import {
  access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const git = process.platform === "win32" ? "git.exe" : "git";

function withoutHostSession(env = process.env) {
  const clean = { ...env };
  for (const key of [
    "CLAUDE_PROJECT_DIR",
    "CLAUDE_SESSION_ID",
    "CODEX_THREAD_ID",
    "COHERENCE_AGENT",
    "COHERENCE_HOOK_BUNDLE_FINGERPRINT",
    "COHERENCE_HOOK_HOST",
    "COHERENCE_HOOK_TRANSPORT",
    "COHERENCE_JOB",
    "COHERENCE_PROJECT_ROOT",
    "COHERENCE_SESSION",
  ]) delete clean[key];
  return clean;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
    env: options.env ?? withoutHostSession(),
    input: options.input,
    timeout: options.timeout ?? 120_000,
  });
  if (result.error) throw result.error;
  const expected = options.status ?? 0;
  assert.equal(
    result.status,
    expected,
    [
      `${command} ${args.join(" ")} exited ${result.status}; expected ${expected}`,
      result.stdout && `stdout:\n${result.stdout}`,
      result.stderr && `stderr:\n${result.stderr}`,
    ].filter(Boolean).join("\n"),
  );
  return { stdout: result.stdout, stderr: result.stderr };
}

async function executable(path) {
  await access(path, constants.X_OK);
  assert.notEqual((await stat(path)).mode & 0o111, 0, `${path} is not executable`);
}

function parseHookEmission(stdout, event, session) {
  const envelope = JSON.parse(stdout.trim());
  assert.equal(envelope.hookSpecificOutput?.hookEventName, event);
  const text = envelope.hookSpecificOutput?.additionalContext;
  assert.equal(typeof text, "string", `${event} did not emit agent context`);
  assert.match(text, /coherence defect "<what failed>" --evidence/);
  assert.match(text, /coherence orient/);
  assert.match(text, /coherence work inspect/);
  assert.match(text, /coherence work create/);
  assert.match(text, /coherence consequence inspect "work:WORK_ID"/);
  assert.ok(text.includes(`YOUR SESSION ID IS ${session}.`), "SessionStart omitted the exact session id");
  assert.ok(text.includes(`--session ${JSON.stringify(session)}`), "defect instruction omitted the exact session scope");
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "coherence-package-smoke-"));
try {
  const packedDir = join(temporaryRoot, "packed");
  const consumer = join(temporaryRoot, "consumer");
  await mkdir(packedDir);
  await mkdir(join(consumer, "src"), { recursive: true });

  run(npm, ["pack", "--pack-destination", packedDir], { cwd: packageRoot });
  const tarballs = (await readdir(packedDir)).filter((name) => name.endsWith(".tgz"));
  assert.equal(tarballs.length, 1, `npm pack produced ${tarballs.length} tarballs`);
  const tarball = join(packedDir, tarballs[0]);

  await writeFile(join(consumer, "package.json"), `${JSON.stringify({
    name: "coherence-package-smoke-consumer",
    version: "1.0.0",
    private: true,
    type: "module",
  }, null, 2)}\n`);
  await writeFile(join(consumer, "coherence.config.json"), "{}\n");
  await writeFile(join(consumer, ".gitignore"), "node_modules/\n.coherence/\n.claude/\n.codex/\n");
  await writeFile(join(consumer, "src", "index.js"), "export const consumer = true;\n");

  run(git, ["init", "-q", "-b", "main"], { cwd: consumer });
  run(git, ["config", "user.name", "Coherence package smoke"], { cwd: consumer });
  run(git, ["config", "user.email", "package-smoke@invalid.example"], { cwd: consumer });
  run(npm, ["install", "--no-audit", "--no-fund", tarball], { cwd: consumer });
  run(git, ["add", "."], { cwd: consumer });
  run(git, ["commit", "-q", "-m", "fresh consumer"], { cwd: consumer });
  const consumerCommit = run(git, ["rev-parse", "HEAD"], { cwd: consumer }).stdout.trim();

  const installed = join(consumer, "node_modules", "@danilocampos", "coherence");
  assert.equal(existsSync(join(installed, "dist", "defects.js")), true, "packed dist/defects.js is absent");
  assert.equal(existsSync(join(installed, "dist", "cli.js")), true, "packed dist/cli.js is absent");
  assert.equal(existsSync(join(installed, "dist", "hook-cli.js")), true, "packed dist/hook-cli.js is absent");
  const coherence = join(consumer, "node_modules", ".bin", "coherence");
  const coherenceHook = join(consumer, "node_modules", ".bin", "coherence-hook");
  await executable(coherence);
  await executable(coherenceHook);

  // Reject malformed evidence before the recorder creates even an empty ledger directory.
  run(coherence, ["defect", "invalid record", "--session", "invalid-session"], {
    cwd: consumer,
    status: 2,
  });
  assert.equal(
    existsSync(join(consumer, ".coherence", "defects")),
    false,
    "invalid defect input left ledger residue",
  );

  const firstArgs = [
    "defect", "packed consumer contradicts its parser contract",
    "--evidence", "the package-smoke reproducer observed exit zero",
    "--file", "src/index.js",
    "--session", "package-session-one",
    "--agent", "package-smoke",
    "--job", "release-gate",
  ];
  const first = run(coherence, firstArgs, { cwd: consumer });
  assert.match(first.stdout, /^def-[a-f0-9]{12}\s+agent-assessed defect recorded by package-session-one/m);
  const ledgerDir = join(consumer, ".coherence", "defects");
  const firstLedgers = (await readdir(ledgerDir)).filter((name) => name.endsWith(".jsonl"));
  assert.equal(firstLedgers.length, 1, "one writing session did not produce exactly one ledger file");
  const firstLedger = join(ledgerDir, firstLedgers[0]);
  const firstBytes = await readFile(firstLedger, "utf8");
  assert.equal(firstBytes.trim().split("\n").length, 1);
  assert.deepEqual(JSON.parse(firstBytes).repo, {
    branch: "main",
    commit: consumerCommit,
    dirty: false,
  }, "packed recorder did not preserve the exact clean consumer revision");

  const retry = run(coherence, firstArgs, { cwd: consumer });
  assert.equal(retry.stdout, first.stdout, "exact retry did not return the original defect");
  assert.equal(await readFile(firstLedger, "utf8"), firstBytes, "exact retry appended a duplicate row");

  run(coherence, [
    "defect", "second session observed another contradiction",
    "--evidence", "the independent reproducer failed deterministically",
    "--session", "package-session-two",
    "--agent", "package-smoke",
    "--job", "release-gate",
  ], { cwd: consumer });

  const fleet = JSON.parse(run(coherence, ["defects", "--json"], { cwd: consumer }).stdout);
  assert.deepEqual(
    fleet.defects.map((record) => record.session).sort(),
    ["package-session-one", "package-session-two"],
  );
  const fleetText = run(coherence, ["defects"], { cwd: consumer }).stdout;
  assert.match(fleetText, /DEFECT RECORD — agent-assessed contradictions/);
  assert.match(fleetText, /packed consumer contradicts its parser contract/);
  const narrowed = JSON.parse(run(coherence, [
    "defects", "--session", "package-session-one", "--json",
  ], { cwd: consumer }).stdout);
  assert.deepEqual(narrowed.defects.map((record) => record.session), ["package-session-one"]);

  // Both hosts must install from the consumer's packed bin and independently satisfy the
  // structural control bit. No session selector is supplied: this is presence, not a claim
  // that the current runner process was launched by either host.
  for (const host of ["claude", "codex"]) {
    run(coherence, ["hooks", "install", "--host", host], { cwd: consumer });
    run(coherence, ["hooks", "--check", "--host", host], { cwd: consumer });
  }

  const claudeSession = "package-claude-session";
  const claudeEmission = run(join(consumer, ".claude", "coherence-hook"), ["SessionStart"], {
    cwd: consumer,
    env: { ...withoutHostSession(), CLAUDE_PROJECT_DIR: consumer },
    input: `${JSON.stringify({ session_id: claudeSession, agent_type: "main" })}\n`,
  });
  parseHookEmission(claudeEmission.stdout, "SessionStart", claudeSession);

  const codexSession = "package-codex-session";
  const codexEmission = run(join(consumer, ".codex", "coherence-hook"), ["SessionStart"], {
    cwd: consumer,
    input: `${JSON.stringify({ session_id: codexSession, agent_type: "main" })}\n`,
  });
  parseHookEmission(codexEmission.stdout, "SessionStart", codexSession);

  // Content changed without a matching address must make both surfaces refuse the corpus.
  const tampered = JSON.parse(firstBytes.trim());
  tampered.summary = "edited after the package recorded it";
  await writeFile(firstLedger, `${JSON.stringify(tampered)}\n`);
  run(coherence, ["defects"], { cwd: consumer, status: 2 });
  run(coherence, ["defects", "--json"], { cwd: consumer, status: 2 });

  console.log("package smoke: packed artifact passed in an isolated git consumer");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
