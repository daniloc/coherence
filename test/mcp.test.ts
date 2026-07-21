// mcp.test.ts — the stdio MCP server end-to-end: spawn `cli.ts mcp`, speak
// newline-delimited JSON-RPC over its stdin/stdout, and drive the real protocol
// (initialize → tools/list → tools/call). phrasebook is the config-free fixture;
// verify against a throwaway project proves a red gate surfaces as isError with
// the report text intact — the property the whole MCP surface exists to deliver.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { tmpProject, cleanup } from "./_helpers.ts";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");

type Rpc = (method: string, params?: object) => Promise<{ result?: any; error?: any }>;

/** Spawn a server in `cwd`, hand the test a request fn, and always tear down. */
async function withServer(cwd: string, fn: (call: Rpc) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, [CLI, "mcp"], { cwd, stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map<number, (v: any) => void>();
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += String(d);
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
  let nextId = 1;
  const call: Rpc = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, res);
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${method}`)), 60_000);
      t.unref();
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  try {
    await fn(call);
  } finally {
    child.stdin.end();
    child.kill();
  }
}

test("mcp — initialize negotiates a version and lists the tool surface", async () => {
  const root = await tmpProject({});
  try {
    await withServer(root, async (call) => {
      const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
      assert.equal(init.result.protocolVersion, "2025-06-18");
      assert.equal(init.result.serverInfo.name, "coherence");
      assert.ok(init.result.capabilities.tools);

      // An unknown requested version gets the latest we support, not an error.
      const odd = await call("initialize", { protocolVersion: "1999-01-01" });
      assert.equal(odd.result.protocolVersion, "2025-06-18");

      const list = await call("tools/list");
      const names = list.result.tools.map((t: any) => t.name);
      for (const n of ["verify", "docs", "phrasebook", "scaffold", "onboard"]) assert.ok(names.includes(n), n);
      const verify = list.result.tools.find((t: any) => t.name === "verify");
      assert.equal(verify.inputSchema.type, "object");
      assert.ok(verify.inputSchema.properties.fast);
    });
  } finally { await cleanup(root); }
});

test("mcp — tools/call runs the CLI: phrasebook green, red verify → isError with report", async () => {
  const root = await tmpProject({
    "coherence.config.json": JSON.stringify({ typecheck: ["true"] }),
    "proj.spec.md": '# proj\nA fixture.\n\n## works when\n- missing.txt exists at root\n',
  });
  try {
    await withServer(root, async (call) => {
      const pb = await call("tools/call", { name: "phrasebook", arguments: {} });
      assert.equal(pb.result.isError, false);
      assert.match(pb.result.content[0].text, /boundary/);
      assert.match(pb.result.content[0].text, /\[exit 0\]/);

      const v = await call("tools/call", { name: "verify", arguments: { fast: true } });
      assert.equal(v.result.isError, true);
      assert.match(v.result.content[0].text, /coherence failure/);
      assert.match(v.result.content[0].text, /\[exit 1\]/);

      const bad = await call("tools/call", { name: "no-such-tool", arguments: {} });
      assert.equal(bad.error.code, -32602);

      const nope = await call("frobnicate");
      assert.equal(nope.error.code, -32601);
    });
  } finally { await cleanup(root); }
});
