// mcp.ts — a stdio MCP server over the coherence CLI, using only Node built-ins.
// `coherence mcp` speaks newline-delimited JSON-RPC on stdin/stdout; every tool
// call shells this same CLI as a subprocess in the target project's cwd. The
// subprocess boundary is deliberate: the command implementations print to stdout
// and call process.exit, so running them in-process would corrupt the protocol
// stream and kill the server — a child per call keeps the stream clean, isolates
// each call's config load, and turns exit codes into data.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";

// Protocol revisions this server knows. initialize echoes the client's requested
// version when we support it, else offers the latest we do — per the MCP spec's
// version-negotiation rule.
const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const LATEST = "2025-06-18";

// Every tool accepts an optional project_root so a client managing several roots
// can aim a call; the default is the server's cwd (MCP clients launch stdio
// servers from the project directory).
const PROJECT_ROOT_PROP = {
  project_root: {
    type: "string",
    description:
      "Absolute path of the project to operate on. Defaults to the server's working directory.",
  },
} as const;

const CHECK_PROP = (what: string) => ({
  check: { type: "boolean", description: `Report-only freshness/drift gate: exit red if ${what}, without writing anything.` },
});

interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  argv: (a: Record<string, unknown>) => string[];
}

const obj = (properties: Record<string, unknown>, required?: string[]): McpTool["inputSchema"] =>
  ({ type: "object", properties: { ...properties, ...PROJECT_ROOT_PROP }, ...(required ? { required } : {}) });

export const TOOLS: McpTool[] = [
  {
    name: "verify",
    description:
      "Run the coherence verifier: re-evaluate every `## works when` claim in the spec tree against the code (typecheck, file/import checks, named tests, boundary/parity meta-oracles). Red exit = a claim no longer holds. This is the core reconciliation loop — run it after edits. A claim line matching no grammar form is SKIPPED, not red; check the reported skipped count after authoring claims.",
    inputSchema: obj({
      fast: { type: "boolean", description: "Skip the live and executable tiers (no test runs, no HTTP probes); structural checks and meta-oracles still run." },
      staged: { type: "boolean", description: "Scope to components whose files changed vs HEAD (including untracked) — fast reconciliation of just what you touched." },
      since: { type: "string", description: "Git ref: scope to components changed since this ref. Mutually exclusive with staged." },
    }),
    argv: (a) => ["verify", ...(a.fast ? ["--fast"] : []), ...(a.staged ? ["--staged"] : []), ...(typeof a.since === "string" ? ["--since", a.since] : [])],
  },
  {
    name: "docs",
    description:
      "Regenerate the derived artifacts: graph.json + _graph.html (the navigable outline) and _overview.html + AGENTS.md (the agent map). With check=true, compare against what's committed and report staleness instead of writing — the CI freshness gate.",
    inputSchema: obj(CHECK_PROP("the committed artifacts no longer match the code")),
    argv: (a) => ["docs", ...(a.check ? ["--check"] : [])],
  },
  {
    name: "claude_md",
    description:
      "Regenerate the coherence-owned fenced block inside CLAUDE.md (component map + invariant table). Authored prose outside the fence markers is never touched. With check=true, report staleness only.",
    inputSchema: obj(CHECK_PROP("the generated CLAUDE.md block is stale")),
    argv: (a) => ["claude", ...(a.check ? ["--check"] : [])],
  },
  {
    name: "phrasebook",
    description:
      "Print the claim grammar — every `## works when` form the verifier understands, rendered straight from the CLAIM_FORMS registry (the generated authority; first match wins). Consult this BEFORE authoring or editing claims: a line matching no form is silently skipped, never red, so a typo'd verb is a no-op.",
    inputSchema: obj({}),
    argv: () => ["phrasebook"],
  },
  {
    name: "scaffold",
    description:
      "Print paste-in spec fragments and an oracle skeleton for a new boundary, component, invariant, or parity claim — the fastest way to author a well-formed claim.",
    inputSchema: obj(
      {
        kind: { type: "string", enum: ["boundary", "component", "invariant", "parity"], description: "What to scaffold." },
        name: { type: "string", description: "Name for the new boundary/component/invariant/parity." },
      },
      ["kind", "name"],
    ),
    argv: (a) => ["scaffold", String(a.kind), String(a.name)],
  },
  {
    name: "onboard",
    description:
      "Bootstrap a repo that has no specs: derive the code graph, suggest a component decomposition, write a draft root spec plus why-from-history jobs under .coherence-out/. Output is proposals for review — it never mutates project source.",
    inputSchema: obj({}),
    argv: () => ["onboard"],
  },
  {
    name: "log",
    description:
      "The temporal ledger: a structural diff of the invariant/boundary set between two git refs — what ref_a → ref_b added, removed, or weakened — plus the novelty-vs-anchor advisory.",
    inputSchema: obj({
      ref_a: { type: "string", description: "Older ref (default HEAD)." },
      ref_b: { type: "string", description: "Newer ref (default: the working tree)." },
      strict: { type: "boolean", description: "Exit red on structural regressions." },
    }),
    argv: (a) => ["log", ...(typeof a.ref_a === "string" ? [a.ref_a] : []), ...(typeof a.ref_b === "string" ? [a.ref_b] : []), ...(a.strict ? ["--strict"] : [])],
  },
  {
    name: "atlas",
    description:
      "Render the trust-manifold atlas: trust charts, chokepoint crossings, and enforcement tiers derived from boundary claims plus the atlas config. With check=true, gate on drift between the declared manifold and the code.",
    inputSchema: obj(CHECK_PROP("the declared atlas and the code disagree")),
    argv: (a) => ["atlas", ...(a.check ? ["--check"] : [])],
  },
  {
    name: "contracts",
    description:
      "Render declared producer/consumer contracts across deploy artifacts and detect the uncovered cross-artifact surface. With check=true, fail contracts that dangle or that no boundary/parity claim anchors.",
    inputSchema: obj(CHECK_PROP("a contract dangles or is unanchored")),
    argv: (a) => ["contracts", ...(a.check ? ["--check"] : [])],
  },
  {
    name: "conventions",
    description:
      "The guard-vs-contract detector + growth ratchet: find convention-tier guard functions (assert*/require*/check*) not yet promoted to boundary claims. mode 'check' fails on ratchet regression; 'update-baseline' rewrites the baseline after an attested change.",
    inputSchema: obj({
      mode: { type: "string", enum: ["report", "check", "update-baseline"], description: "Default report." },
    }),
    argv: (a) => ["conventions", ...(a.mode === "check" ? ["--check"] : a.mode === "update-baseline" ? ["--update-baseline"] : [])],
  },
  {
    name: "lint_sinks",
    description:
      "The interpolation-surface ratchet over SQL/HTML sinks: count interpolations not matching the configured safe-by-construction patterns. mode 'check' fails on growth; 'update-baseline' rewrites the baseline after an attested change.",
    inputSchema: obj({
      mode: { type: "string", enum: ["report", "check", "update-baseline"], description: "Default report." },
    }),
    argv: (a) => ["lint-sinks", ...(a.mode === "check" ? ["--check"] : a.mode === "update-baseline" ? ["--update-baseline"] : [])],
  },
  {
    name: "why_lint",
    description:
      "Advisory lint of `## why` prose that merely restates a mechanism a boundary claim already anchors — why-space belongs to rationale, not mechanism. With check=true, exit red on findings.",
    inputSchema: obj(CHECK_PROP("restating prose is found")),
    argv: (a) => ["why-lint", ...(a.check ? ["--check"] : [])],
  },
];

// A tool result must stay a sane size for a model's context; verify transcripts can
// balloon (test runner output). Keep the head (the report structure) and the tail
// (the verdict/summary lines) and elide the middle.
const MAX_OUTPUT = 100_000;
function clip(s: string): string {
  if (s.length <= MAX_OUTPUT) return s;
  const head = s.slice(0, 70_000), tail = s.slice(-20_000);
  return `${head}\n…[${s.length - head.length - tail.length} chars elided]…\n${tail}`;
}

function runCli(args: string[], projectRoot?: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    // process.argv[1] is this same CLI entry (src/cli.ts under type-stripping, or
    // dist/cli.js built); execArgv carries any flags the parent needed to run it.
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1], ...args], {
      cwd: projectRoot ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: string[] = [];
    child.stdout.on("data", (d) => chunks.push(String(d)));
    child.stderr.on("data", (d) => chunks.push(String(d)));
    child.on("error", (e) => resolve({ code: 127, output: `failed to spawn the coherence CLI: ${e.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, output: chunks.join("") }));
  });
}

export async function runMcpServer(): Promise<void> {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
  const send = (m: object) => process.stdout.write(JSON.stringify(m) + "\n");
  const fail = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

  async function onLine(raw: string): Promise<void> {
    const line = raw.trim();
    if (!line) return;
    let msg: { id?: unknown; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> } };
    try { msg = JSON.parse(line); } catch { fail(null, -32700, "parse error"); return; }
    const { id, method, params } = msg;
    if (id === undefined) return; // a notification (initialized, cancelled, …) — nothing to answer
    try {
      if (method === "initialize") {
        const requested = params?.protocolVersion;
        send({
          jsonrpc: "2.0", id,
          result: {
            protocolVersion: requested && PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST,
            capabilities: { tools: {} },
            serverInfo: { name: "coherence", version: pkg.version ?? "0.0.0" },
          },
        });
      } else if (method === "ping") {
        send({ jsonrpc: "2.0", id, result: {} });
      } else if (method === "tools/list") {
        send({ jsonrpc: "2.0", id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
      } else if (method === "tools/call") {
        const tool = TOOLS.find((t) => t.name === params?.name);
        if (!tool) { fail(id, -32602, `unknown tool: ${params?.name}`); return; }
        const args = params?.arguments ?? {};
        const { code, output } = await runCli(tool.argv(args), typeof args.project_root === "string" ? args.project_root : undefined);
        // A red gate is a RESULT the model must read, but isError makes it salient;
        // the exit code is appended so 0/1/2 (green/red/usage) stays distinguishable.
        send({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: `${clip(output).trimEnd()}\n\n[exit ${code}]` }], isError: code !== 0 },
        });
      } else {
        fail(id, -32601, `method not found: ${method}`);
      }
    } catch (e) {
      fail(id, -32603, e instanceof Error ? e.message : String(e));
    }
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (l) => { void onLine(l); });
  await new Promise<void>((res) => rl.on("close", res)); // client hung up → clean shutdown
}
