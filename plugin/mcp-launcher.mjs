#!/usr/bin/env node
// mcp-launcher.mjs — self-bootstrapping entry for the Claude Code plugin's MCP server.
//
// The plugin cache is a plain git clone: no `npm install`, no build. The harness
// needs its devDependencies at runtime from source (the language adapter imports
// the `typescript` package), so on first launch this installs them — npm's
// `prepare` script then builds dist/ — and every launch after that goes straight
// to the built CLI. Plain .mjs on purpose: this file must run before any
// dependency or build product exists.
//
// stdout belongs to the MCP protocol from the moment the client connects, so every
// byte of bootstrap output (npm's included) is routed to stderr.
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url))); // plugin/ → repo root
const cli = join(root, "dist", "cli.js");

if (!existsSync(cli)) {
  console.error("[coherence] first launch: installing dependencies and building the harness (one-time)…");
  const r = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: root,
    stdio: ["ignore", 2, 2], // npm's stdout must NOT reach the MCP stream
    shell: process.platform === "win32", // npm is npm.cmd on Windows
  });
  // Gate on the artifact, not npm's exit status: the build script's trailing
  // `chmod +x` fails on Windows after tsc has already written dist/cli.js.
  if (!existsSync(cli)) {
    console.error(
      `[coherence] bootstrap failed (npm exit ${r.status ?? "?"}). ` +
      `Run \`npm install\` in ${root} by hand (Node >= 22 required), then reconnect the MCP server.`,
    );
    process.exit(1);
  }
}

// cwd stays the client's project directory — the CLI operates on cwd.
const child = spawn(process.execPath, [cli, "mcp"], { cwd: process.cwd(), stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));
