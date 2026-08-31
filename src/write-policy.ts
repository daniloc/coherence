import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Config } from "./types.ts";

export type CheckoutKind = "primary" | "linked" | "unknown";
export interface CheckoutIdentity {
  kind: CheckoutKind;
  topLevel: string | null;
  reason?: string;
}
export type WritePolicyState = "disabled" | "linked" | "protected-primary" | "unprovable";
export interface ProjectWritePolicy {
  state: WritePolicyState;
  writable: boolean;
  identity: CheckoutIdentity;
}

export type GitRunner = (args: readonly string[], cwd: string) => string;

const productionRunner: GitRunner = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 });

function canonical(path: string): string {
  return realpathSync(resolve(path));
}

function withoutLineEnding(value: string): string {
  return value.endsWith("\r\n") ? value.slice(0, -2) : value.endsWith("\n") ? value.slice(0, -1) : value;
}

interface WorktreeRecord { path: string; head: boolean }

function nulWorktrees(value: string): WorktreeRecord[] {
  const fields = value.split("\0"), records: WorktreeRecord[] = [];
  for (let i = 0; i < fields.length; i++) {
    if (!fields[i]!.startsWith("worktree ")) continue;
    const path = fields[i]!.slice("worktree ".length);
    const end = fields.findIndex((field, index) => index > i && field.startsWith("worktree "));
    records.push({ path, head: fields.slice(i + 1, end < 0 ? fields.length : end).some(field => field.startsWith("HEAD ")) });
  }
  return records;
}

function gitQuotedPath(value: string): string {
  if (!value.startsWith('"')) return value;
  if (!value.endsWith('"')) throw new Error("unterminated Git path quote");
  const bytes: number[] = [];
  for (let i = 1; i < value.length - 1; i++) {
    const char = value[i]!;
    if (char !== "\\") { bytes.push(...Buffer.from(char)); continue; }
    const escaped = value[++i];
    if (escaped === undefined) throw new Error("unterminated Git path escape");
    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      while (octal.length < 3 && /[0-7]/.test(value[i + 1] ?? "")) octal += value[++i];
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    const named: Record<string, string> = { a: "\x07", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r", "\\": "\\", '"': '"' };
    const decoded = named[escaped];
    if (decoded === undefined) throw new Error(`unknown Git path escape \\${escaped}`);
    bytes.push(...Buffer.from(decoded));
  }
  return Buffer.from(bytes).toString("utf8");
}

function lineWorktrees(value: string): WorktreeRecord[] {
  return value.split(/\n\n/).filter(Boolean).map(record => {
    const lines = record.split("\n"), first = lines[0] ?? "";
    if (!first.startsWith("worktree ")) throw new Error("malformed Git worktree record");
    return { path: gitQuotedPath(first.slice("worktree ".length)), head: lines.slice(1).some(line => line.startsWith("HEAD ")) };
  });
}

function administrativeCheckout(root: string, runGit: GitRunner): "primary" | "linked" {
  const gitDir = canonical(resolve(root, withoutLineEnding(runGit(["rev-parse", "--git-dir"], root))));
  const commonDir = canonical(resolve(root, withoutLineEnding(runGit(["rev-parse", "--git-common-dir"], root))));
  return gitDir === commonDir ? "primary" : "linked";
}

export function classifyGitCheckout(root: string, runGit: GitRunner = productionRunner): CheckoutIdentity {
  try {
    const reportedTop = withoutLineEnding(runGit(["rev-parse", "--show-toplevel"], root));
    if (!reportedTop) return { kind: "unknown", topLevel: null, reason: "Git did not report a top-level checkout" };
    const topLevel = canonical(reportedTop);
    const currentRoot = canonical(root);
    const escaped = relative(topLevel, currentRoot);
    if (escaped === ".." || escaped.startsWith("../") || isAbsolute(escaped)) {
      return { kind: "unknown", topLevel, reason: "configured root is outside Git's reported top-level" };
    }
    let records: WorktreeRecord[], legacy = false;
    try {
      records = nulWorktrees(runGit(["worktree", "list", "--porcelain", "-z"], root));
    } catch {
      legacy = true;
      records = lineWorktrees(runGit(["worktree", "list", "--porcelain"], root));
    }
    if (records.some(record => !record.path || !record.head)) {
      return { kind: "unknown", topLevel, reason: "Git returned a malformed worktree identity" };
    }
    let worktrees: string[];
    try { worktrees = records.map(record => canonical(record.path)); }
    catch {
      if (legacy) return { kind: administrativeCheckout(root, runGit), topLevel };
      throw new Error("Git returned an invalid NUL-delimited worktree path");
    }
    if (!worktrees.length) return { kind: "unknown", topLevel, reason: "Git returned no registered worktrees" };
    const index = worktrees.indexOf(topLevel);
    if (index < 0) {
      // A submodule's older porcelain may identify its administrative gitdir rather than
      // its checkout. The same Git identity comparison also survives unquoted newlines in
      // legacy porcelain paths, while modern `-z` remains the authoritative path registry.
      if (legacy) return { kind: administrativeCheckout(root, runGit), topLevel };
      try {
        const gitFile = readFileSync(resolve(root, ".git"), "utf8").trim();
        const gitdir = gitFile.startsWith("gitdir:") ? canonical(resolve(root, gitFile.slice("gitdir:".length).trim())) : null;
        if (gitdir && worktrees.length === 1 && worktrees[0] === gitdir) return { kind: "primary", topLevel };
      } catch { /* not a submodule or its identity is damaged */ }
      return { kind: "unknown", topLevel, reason: "current checkout is absent from Git's registered worktrees" };
    }
    return { kind: index === 0 ? "primary" : "linked", topLevel };
  } catch {
    return { kind: "unknown", topLevel: null, reason: "Git checkout identity could not be established" };
  }
}

export function projectWritePolicy(cfg: Pick<Config, "root" | "protectPrimaryCheckout">): ProjectWritePolicy {
  if (!cfg.protectPrimaryCheckout) {
    return { state: "disabled", writable: true, identity: { kind: "unknown", topLevel: null, reason: "protection disabled" } };
  }
  const identity = classifyGitCheckout(cfg.root);
  if (identity.kind === "linked") return { state: "linked", writable: true, identity };
  if (identity.kind === "primary") return { state: "protected-primary", writable: false, identity };
  return { state: "unprovable", writable: false, identity };
}

function displayedPath(path: string): string {
  return JSON.stringify(path).replace(/[\x7f-\x9f]/g, (char) =>
    `\\u${char.codePointAt(0)!.toString(16).padStart(4, "0")}`);
}

export function writeRefusal(policy: ProjectWritePolicy, operation: string): string[] | null {
  if (policy.writable) return null;
  const location = policy.identity.topLevel ? ` at ${displayedPath(policy.identity.topLevel)}` : "";
  const reason = policy.state === "protected-primary"
    ? `protectPrimaryCheckout is active for the protected primary checkout${location}`
    : `protectPrimaryCheckout is active, but safe Git checkout identity could not be established${location}`;
  return [`Cannot ${operation}: ${reason}.`, "Run from a registered linked worktree."];
}

export function lifecyclePersistenceNotice(policy: ProjectWritePolicy): string | null {
  if (policy.writable) return null;
  const location = policy.identity.topLevel ? ` at ${displayedPath(policy.identity.topLevel)}` : "";
  const identity = policy.state === "protected-primary"
    ? `protectPrimaryCheckout is active for Git's primary checkout${location}`
    : `protectPrimaryCheckout is active, but safe checkout identity could not be established${location}`;
  return `COHERENCE PERSISTENCE unavailable: ${identity}. Read-only guidance remains active and no evidence will be recorded in this checkout. Run from a registered linked worktree.`;
}
