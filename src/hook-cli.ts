#!/usr/bin/env node
// hook-cli.ts — dependency-light lifecycle entrypoint; do not route high-frequency hooks
// through cli.ts, whose full command registry eagerly loads the TypeScript analysis stack.
import { loadConfig } from "./config.ts";
import { runHook } from "./hooks.ts";

const event = process.argv[2];
if (!event) {
  console.error("usage: coherence-hook <event>");
  process.exitCode = 2;
} else {
  // The stable Claude-side launcher resolves the (possibly nested) coherence root and
  // passes it explicitly. Direct/manual invocations retain the older host-root/cwd fallbacks.
  process.exitCode = await runHook(await loadConfig(
    process.env.COHERENCE_PROJECT_ROOT ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  ), event);
}
