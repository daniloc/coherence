// hook-text.test.ts — the project's voice at each lifecycle crossing: override replaces
// the canonical emission, append follows it, and a torn customization file costs exactly
// the customization (silent canon fallback at hook time, loud in `hooks review`).
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpProject, cleanup, cfg } from "./_helpers.ts";
import {
  HOOK_TEXT_DIR, hookTextPaths, readHookText, substituteHookTokens, composeHookText,
} from "../src/hook-text.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_CLI = join(HERE, "..", "src", "hook-cli.ts");
const CLI = join(HERE, "..", "src", "cli.ts");
const exec = promisify(execFile);

/** The fixture must resolve from its own root: scrub the host/root env a real Claude
 *  session may carry, or the spawned hook would run against the harness repo itself. */
function fixtureEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.COHERENCE_PROJECT_ROOT;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.COHERENCE_SESSION;
  delete env.COHERENCE_AGENT;
  delete env.COHERENCE_JOB;
  delete env.CODEX_THREAD_ID;
  return env;
}

function hook(root: string, event: "SessionStart" | "Stop", payload: object) {
  return spawnSync(process.execPath, [HOOK_CLI, event], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: fixtureEnv(),
  });
}

async function run(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return exec(process.execPath, [CLI, ...args], { cwd: root, env: fixtureEnv() })
    .then((result) => ({ code: 0, stdout: result.stdout, stderr: result.stderr }))
    .catch((error: { code: number; stdout: string; stderr: string }) => ({
      code: error.code, stdout: error.stdout, stderr: error.stderr,
    }));
}

/** A minimal adopting project (no git: SessionStart only opens the journal and emits,
 *  Stop only snapshots calibration — neither needs a repository). */
async function fixture(hookFiles: Record<string, string> = {}): Promise<string> {
  return tmpProject({
    "coherence.config.json": JSON.stringify({
      entryDir: "app", codeExt: ["ts"], language: "typescript", platform: null,
    }),
    "app/app.spec.md": "# app\n\nFixture.\n\n## works when\n\n- app.ts exists at this node\n",
    "app/app.ts": "export const value = 1;\n",
    ...hookFiles,
  });
}

test("hook text — override replaces, append follows, and damage degrades to the canonical emission", async (t) => {
  await t.test("pure: absent files are null and compose to the canonical text", async () => {
    const root = await tmpProject();
    try {
      assert.equal(HOOK_TEXT_DIR, join(".coherence", "hooks"));
      const paths = hookTextPaths(cfg(root), "SessionStart");
      assert.equal(paths.override, join(root, HOOK_TEXT_DIR, "SessionStart.override.md"));
      assert.equal(paths.append, join(root, HOOK_TEXT_DIR, "SessionStart.append.md"));
      const custom = readHookText(cfg(root), "SessionStart");
      assert.equal(custom.event, "SessionStart");
      assert.equal(custom.override, null);
      assert.equal(custom.append, null);
      assert.deepEqual(custom.problems, []);
      assert.equal(composeHookText("CANON", custom, {}), "CANON");
    } finally { await cleanup(root); }
  });

  await t.test("pure: append follows the canonical base and substitutes only supplied tokens", async () => {
    const root = await tmpProject({
      ".coherence/hooks/SessionStart.append.md": "APPEND-TEXT",
    });
    try {
      const custom = readHookText(cfg(root), "SessionStart");
      assert.equal(custom.override, null);
      assert.equal(custom.append?.text, "APPEND-TEXT");
      assert.deepEqual(custom.problems, []);
      assert.equal(composeHookText("CANON", custom, {}), "CANON\n\nAPPEND-TEXT");
    } finally { await cleanup(root); }

    const tokenRoot = await tmpProject({
      ".coherence/hooks/SessionStart.append.md":
        "run {{cli}} {{scope}} as {{agent}} keeping {{other}}",
    });
    try {
      const custom = readHookText(cfg(tokenRoot), "SessionStart");
      const composed = composeHookText("CANON", custom, {
        cli: "npx coherence", scope: '--session "s-1"',
      });
      assert.equal(composed,
        'CANON\n\nrun npx coherence --session "s-1" as {{agent}} keeping {{other}}',
        "supplied tokens substitute; an unsupplied token stays honestly literal, and"
          + " unknown {{...}} text is untouched");
      assert.equal(substituteHookTokens("{{session}}/{{session}}", { session: "s-9" }), "s-9/s-9");
    } finally { await cleanup(tokenRoot); }
  });

  await t.test("pure: override replaces the canonical base wholly", async () => {
    const root = await tmpProject({
      ".coherence/hooks/SessionStart.override.md": "OVERRIDE-BASE",
    });
    try {
      const custom = readHookText(cfg(root), "SessionStart");
      assert.equal(composeHookText("CANON", custom, {}), "OVERRIDE-BASE",
        "no canonical residue survives an override");
    } finally { await cleanup(root); }

    const bothRoot = await tmpProject({
      ".coherence/hooks/SessionStart.override.md": "OVERRIDE-BASE",
      ".coherence/hooks/SessionStart.append.md": "AND-APPEND",
    });
    try {
      const custom = readHookText(cfg(bothRoot), "SessionStart");
      assert.equal(composeHookText("CANON", custom, {}), "OVERRIDE-BASE\n\nAND-APPEND",
        "both files coexisting is not a conflict: override is the base, append follows it");
    } finally { await cleanup(bothRoot); }
  });

  await t.test("pure: an empty override silences the event unless an append speaks", async () => {
    const root = await tmpProject({
      ".coherence/hooks/SessionStart.override.md": "  \n\n  ",
    });
    try {
      const custom = readHookText(cfg(root), "SessionStart");
      assert.equal(custom.override?.text, "", "whitespace-only trims to the meaningful empty state");
      assert.equal(composeHookText("CANON", custom, {}), "");
    } finally { await cleanup(root); }

    const withAppend = await tmpProject({
      ".coherence/hooks/SessionStart.override.md": "\n",
      ".coherence/hooks/SessionStart.append.md": "APPEND ALONE",
    });
    try {
      const custom = readHookText(cfg(withAppend), "SessionStart");
      assert.equal(composeHookText("CANON", custom, {}), "APPEND ALONE");
    } finally { await cleanup(withAppend); }
  });

  await t.test("pure: an unreadable slot degrades to canon and names its problem", async () => {
    const root = await tmpProject();
    try {
      const overridePath = join(root, ".coherence", "hooks", "SessionStart.override.md");
      await mkdir(overridePath, { recursive: true }); // a directory squatting on the file path
      const custom = readHookText(cfg(root), "SessionStart");
      assert.equal(custom.override, null, "damage never throws and never half-loads");
      assert.equal(custom.problems.length, 1);
      assert.ok(custom.problems[0].includes(overridePath), "the problem names the exact path");
      assert.equal(composeHookText("CANON", custom, {}), "CANON",
        "a torn customization costs exactly the customization, never the session");
    } finally { await cleanup(root); }
  });

  await t.test("integration: the hook body speaks the composed text (pending hooks.ts integration)", async () => {
    // SessionStart with an append: canonical emission first, project voice last.
    const appendRoot = await fixture({
      ".coherence/hooks/SessionStart.append.md": "PROJECT VOICE {{session}} via {{cli}}",
    });
    try {
      const started = hook(appendRoot, "SessionStart", { session_id: "sess-a" });
      assert.equal(started.status, 0, started.stderr);
      const context = JSON.parse(started.stdout).hookSpecificOutput.additionalContext as string;
      assert.ok(context.includes("DECISION JOURNAL"), "the canonical emission survives an append");
      assert.ok(context.endsWith("PROJECT VOICE sess-a via npx coherence"),
        "{{session}} is the raw id and {{cli}} is the consumer command; the append is last");
    } finally { await cleanup(appendRoot); }

    // SessionStart with an override: the project text is the whole emission.
    const overrideRoot = await fixture({
      ".coherence/hooks/SessionStart.override.md": "ONLY THIS {{session}}",
    });
    try {
      const started = hook(overrideRoot, "SessionStart", { session_id: "sess-b" });
      assert.equal(started.status, 0, started.stderr);
      assert.equal(JSON.parse(started.stdout).hookSpecificOutput.additionalContext, "ONLY THIS sess-b",
        "no canonical text and no due lines survive an override");
    } finally { await cleanup(overrideRoot); }

    // SessionStart with an EMPTY override: the emission is silenced entirely.
    const silencedRoot = await fixture({
      ".coherence/hooks/SessionStart.override.md": "   \n",
    });
    try {
      const started = hook(silencedRoot, "SessionStart", { session_id: "sess-silent" });
      assert.equal(started.status, 0, started.stderr);
      assert.equal(started.stdout, "", "an empty override emits no JSON envelope at all");
    } finally { await cleanup(silencedRoot); }

    // Main Stop without customization stays byte-empty — a standing invariant this
    // surface must not break.
    const quietRoot = await fixture();
    try {
      const stopped = hook(quietRoot, "Stop", { session_id: "sess-c" });
      assert.equal(stopped.status, 0, stopped.stderr);
      assert.equal(stopped.stdout, "", "customization support must not buy main Stop a turn");
    } finally { await cleanup(quietRoot); }

    // Main Stop WITH a project append becomes the one thing the project chose to say —
    // and the loop guard still outranks the project voice.
    const stopVoiceRoot = await fixture({
      ".coherence/hooks/Stop.append.md": "AFTER STOP",
    });
    try {
      const stopped = hook(stopVoiceRoot, "Stop", { session_id: "sess-d" });
      assert.equal(stopped.status, 0, stopped.stderr);
      assert.equal(JSON.parse(stopped.stdout).hookSpecificOutput.additionalContext, "AFTER STOP");

      const active = hook(stopVoiceRoot, "Stop", { session_id: "sess-d", stop_hook_active: true });
      assert.equal(active.status, 0, active.stderr);
      assert.equal(active.stdout, "", "stop_hook_active silences even the project voice");
    } finally { await cleanup(stopVoiceRoot); }
  });
});

test("hooks review — every event's effective emission prints with provenance and damage is loud", async () => {
  const root = await fixture({
    ".coherence/hooks/SessionStart.append.md": "APPEND SS",
    ".coherence/hooks/SubagentStop.override.md": "OVERRIDE STOP",
  });
  try {
    const damaged = join(root, ".coherence", "hooks", "Stop.override.md");
    await mkdir(damaged, { recursive: true }); // a directory squatting on the override path

    const review = await run(root, ["hooks", "review"]);
    assert.equal(review.code, 1, `damage present must exit 1\n${review.stderr}`);
    // One section per lifecycle event, each carrying its provenance.
    assert.ok(review.stdout.includes("SubagentStart · canonical"));
    assert.ok(review.stdout.includes("SessionStart · canonical + append (.coherence/hooks/SessionStart.append.md)"));
    assert.ok(review.stdout.includes("SubagentStop · override (.coherence/hooks/SubagentStop.override.md)"));
    assert.match(review.stdout, /^--- Stop · /m, "the damaged event still gets its section");
    assert.match(review.stdout, /^--- PostToolUse · /m);
    // The effective project texts print verbatim.
    assert.ok(review.stdout.includes("APPEND SS"));
    assert.ok(review.stdout.includes("OVERRIDE STOP"));
    // Damage is loud here, exactly because it is silent at hook time.
    assert.match(review.stdout, /^warning: .*Stop\.override\.md/m,
      "the warning names the unreadable path");
    // The token legend teaches the substitution vocabulary.
    assert.ok(review.stdout.includes("{{session}}"));

    await rm(damaged, { recursive: true });
    const clean = await run(root, ["hooks", "review"]);
    assert.equal(clean.code, 0, `no damage must exit 0\n${clean.stderr}\n${clean.stdout}`);

    // review takes no flags — same refusal style as the rest of the hooks CLI.
    const flagged = await run(root, ["hooks", "review", "--json"]);
    assert.equal(flagged.code, 2, flagged.stderr);
    assert.match(JSON.parse(flagged.stdout).error, /unsupported flag/);
  } finally { await cleanup(root); }
});
