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
  process.exitCode = await runHook(await loadConfig(process.cwd()), event);
}
