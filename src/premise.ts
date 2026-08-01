// premise.ts — structural leases for cached decisions.
//
// A journal decision caches judgement: a future reader can reuse the conclusion instead
// of reconstructing the whole argument. The cache becomes dangerous when the structure
// that argument referred to moves while the sentence remains perfectly readable. A
// PREMISE LEASE is the deliberately smaller question we can answer mechanically:
// "do the repository addresses this decision named still resolve?"
//
// It is NOT a semantic validator. A file can still exist after its behaviour changes,
// and a symbol can still resolve after its contract changes. Every render says that
// explicitly; `valid` means "the address is live", never "the rationale is true".
//
// TRUST IS ASYMMETRIC. `DecisionRecord.files` is an authored, structured assertion and
// is therefore a STRONG lease. Prose extraction is a fallback only: paths in `chose` or
// `because`, and code-shaped backticked tokens, are useful clues but may merely be
// examples. Their findings are advisory. This distinction is also what keeps `--check`
// conservative: only a broken authored file address can make it non-zero.
import { existsSync } from "node:fs";
import { basename, isAbsolute, posix, relative, resolve, sep } from "node:path";
import type { Config, Graph } from "./types.ts";
import { readJournal, resolve as resolveJournal, type DecisionRecord } from "./decisions.ts";

export type PremiseReferentKind = "file" | "symbol";
export type PremiseLeaseSource =
  | "files"
  | "chose-path" | "because-path"
  | "chose-symbol" | "because-symbol";
export type PremiseLeaseStrength = "strong" | "inferred";
export type PremiseLeaseStatus = "valid" | "missing" | "moved-or-ambiguous";
export type DecisionPremiseStatus = PremiseLeaseStatus | "unleased";

export interface PremiseReferent {
  kind: PremiseReferentKind;
  value: string;
  source: PremiseLeaseSource;
  strength: PremiseLeaseStrength;
}

export interface PremiseLease extends PremiseReferent {
  status: PremiseLeaseStatus;
  /** Current graph addresses that explain `valid` or `moved-or-ambiguous`. */
  matches: string[];
}

export interface DecisionPremiseAudit {
  decisionId: string;
  chose: string;
  leases: PremiseLease[];
  status: DecisionPremiseStatus;
  /** Only a broken structured `files` lease is gate-grade. */
  checkFailure: boolean;
}

export interface PremiseStructure {
  files: string[];
  symbols: Array<{ name: string; path: string }>;
}

export interface PremiseAuditOptions {
  /** Used only to turn an absolute path under the project root into a repo-relative one. */
  root?: string;
  /** Injected so the classifier stays pure in tests; omitted means graph paths are current. */
  pathExists?: (repoPath: string) => boolean;
}

const FILE_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "pyw", "rs", "go",
  "java", "kt", "kts", "rb", "php", "cs", "fs", "fsx", "swift", "scala", "c", "cc",
  "cpp", "cxx", "h", "hh", "hpp", "sh", "bash", "zsh", "fish", "ps1", "sql", "proto",
  "graphql", "gql", "css", "scss", "sass", "less", "html", "htm", "vue", "svelte",
  "md", "mdx", "txt", "json", "jsonl", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "xml", "lock",
]);

// Extensionless paths are accepted from these conventional repository roots only. That
// deliberately misses an exotic prose-only directory rather than leasing phrases such as
// "read/write" or "producer/consumer" as if they were files.
const PATH_ROOTS = new Set([
  "src", "test", "tests", "lib", "app", "apps", "pkg", "packages", "docs", "config",
  "scripts", "bin", "public", ".coherence", ".github", ".claude", ".codex",
]);
const SPECIAL_FILES = new Set([
  "Dockerfile", "Makefile", "Justfile", ".gitignore", ".gitattributes", ".npmrc", ".nvmrc",
]);

/** Strip a navigation suffix and express a safe address relative to `root`. */
export function normalizePremisePath(raw: string, root = ""): string | null {
  let value = raw.trim().replace(/^['"`]+|['"`]+$/g, "")
    .replace(/#L\d+(?:-L?\d+)?$/i, "")
    .replace(/:\d+(?::\d+)?$/, "");
  if (!value || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;

  if (isAbsolute(value)) {
    if (!root) return null;
    const base = resolve(root);
    const rel = relative(base, resolve(value));
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
    value = rel;
  }

  value = posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (!value || value === "." || value === ".." || value.startsWith("../") || value.startsWith("/")) return null;
  return value;
}

function looksLikeTextPath(raw: string, root: string): boolean {
  const value = normalizePremisePath(raw, root);
  if (!value) return false;
  const base = basename(value);
  if (SPECIAL_FILES.has(base)) return true;
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
  if (FILE_EXTENSIONS.has(ext)) return true;
  return value.includes("/") && PATH_ROOTS.has(value.split("/")[0] ?? "");
}

// A wide tokeniser followed by the deliberately narrow predicate above. Keeping those
// jobs separate makes punctuation handling boring without making path policy permissive.
const TEXT_TOKEN = /(?:^|[\s("'`<])((?:\.{0,2}\/|\/)?[A-Za-z0-9_@.+-]+(?:\/[A-Za-z0-9_@.+-]+)*(?::\d+(?::\d+)?)?)(?=$|[\s)"'`,;!?>])/g;
const BACKTICK = /`([^`\n]+)`/g;

function textPaths(text: string, root: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TEXT_TOKEN)) {
    if (!looksLikeTextPath(m[1], root)) continue;
    const path = normalizePremisePath(m[1], root);
    if (path) out.add(path);
  }
  return [...out].sort();
}

/** A backtick is not sufficient evidence by itself: ordinary lowercase words are prose.
 *  Require a code cue (qualification, call syntax, uppercase, `_`, or `$`). */
function backtickedSymbols(text: string, root: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(BACKTICK)) {
    const raw = m[1].trim();
    if (looksLikeTextPath(raw, root)) continue;
    const hit = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)(\(\))?$/.exec(raw);
    if (!hit) continue;
    const codeCue = !!hit[2] || hit[1].includes(".") || /[A-Z_$]/.test(hit[1]);
    if (codeCue) out.add(hit[1] + (hit[2] ?? ""));
  }
  return [...out].sort();
}

/** Extract the leases one decision itself supplied.
 *
 *  Structured `files` WIN ENTIRELY when present; additionally mining the rationale in
 *  that case produces weaker duplicates and unrelated examples, increasing noise without
 *  adding an address the author did not already have a direct way to name. */
export function extractPremiseReferents(record: DecisionRecord, root = ""): PremiseReferent[] {
  const explicit = [...new Set((record.files ?? [])
    .map((p) => normalizePremisePath(p, root))
    .filter((p): p is string => p !== null))]
    .sort()
    .map((value): PremiseReferent => ({ kind: "file", value, source: "files", strength: "strong" }));
  if (explicit.length) return explicit;

  const refs = new Map<string, PremiseReferent>();
  const add = (ref: PremiseReferent) => { if (!refs.has(`${ref.kind}:${ref.value}`)) refs.set(`${ref.kind}:${ref.value}`, ref); };
  for (const [field, text] of [["chose", record.chose], ["because", record.because]] as const) {
    for (const value of textPaths(text, root))
      add({ kind: "file", value, source: `${field}-path`, strength: "inferred" });
    for (const value of backtickedSymbols(text, root))
      add({ kind: "symbol", value, source: `${field}-symbol`, strength: "inferred" });
  }
  return [...refs.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
}

/** Project the current graph into the only address spaces this advisory understands. */
export function premiseStructure(graph: Graph): PremiseStructure {
  const files = new Set<string>();
  const symbols = new Map<string, { name: string; path: string }>();
  for (const node of graph.nodes) {
    if (node.path) {
      const path = normalizePremisePath(node.path);
      if (path) files.add(path);
    }
    if (node.kind === "symbol") {
      const path = normalizePremisePath(node.path ?? "") ?? "";
      const key = `${node.label}\u0000${path}`;
      symbols.set(key, { name: node.label, path });
    }
  }
  return {
    files: [...files].sort(),
    symbols: [...symbols.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)),
  };
}

function renderSymbolAddress(s: { name: string; path: string }): string {
  return s.path ? `${s.path}#${s.name}` : s.name;
}

/** Classify one extracted address against an injected current structure. */
export function classifyPremiseReferent(
  ref: PremiseReferent,
  structure: PremiseStructure,
  pathExists?: (repoPath: string) => boolean,
): PremiseLease {
  if (ref.kind === "file") {
    const exists = pathExists ? pathExists(ref.value) : structure.files.includes(ref.value);
    if (exists) return { ...ref, status: "valid", matches: [ref.value] };
    const sameName = structure.files.filter((p) => basename(p) === basename(ref.value));
    return sameName.length
      ? { ...ref, status: "moved-or-ambiguous", matches: sameName }
      : { ...ref, status: "missing", matches: [] };
  }

  const noCall = ref.value.replace(/\(\)$/, "");
  const wholeForms = new Set([ref.value, noCall, `${noCall}()`]);
  const leaf = noCall.includes(".") ? noCall.slice(noCall.lastIndexOf(".") + 1) : noCall;
  const leafForms = new Set([leaf, `${leaf}()`]);
  const exactWhole = structure.symbols.filter((s) => wholeForms.has(s.name));
  const exact = exactWhole.length ? exactWhole : structure.symbols.filter((s) => leafForms.has(s.name));
  if (exact.length === 1)
    return { ...ref, status: "valid", matches: exact.map(renderSymbolAddress) };
  if (exact.length > 1)
    return { ...ref, status: "moved-or-ambiguous", matches: exact.map(renderSymbolAddress).sort() };

  // Case-only movement is worth pointing at; broader fuzzy matching would turn every
  // short identifier into a rename candidate and is intentionally absent.
  const lower = new Set([...wholeForms, ...leafForms].map((s) => s.toLowerCase()));
  const caseMoved = structure.symbols.filter((s) => lower.has(s.name.toLowerCase()));
  return caseMoved.length
    ? { ...ref, status: "moved-or-ambiguous", matches: caseMoved.map(renderSymbolAddress).sort() }
    : { ...ref, status: "missing", matches: [] };
}

/** Audit the STANDING decisions in raw journal records. Retractions are applied before
 *  inspection so a withdrawn cache cannot keep producing stale-address findings. */
export function auditPremiseLeases(
  records: DecisionRecord[], graph: Graph, opts: PremiseAuditOptions = {},
): DecisionPremiseAudit[] {
  const structure = premiseStructure(graph);
  const standing = resolveJournal(records).standing.filter((r) => r.kind === "decision");
  return standing.map((record) => {
    const leases = extractPremiseReferents(record, opts.root)
      .map((ref) => classifyPremiseReferent(ref, structure, opts.pathExists));
    const status: DecisionPremiseStatus = !leases.length ? "unleased"
      : leases.some((l) => l.status === "missing") ? "missing"
      : leases.some((l) => l.status === "moved-or-ambiguous") ? "moved-or-ambiguous"
      : "valid";
    return {
      decisionId: record.id,
      chose: record.chose,
      leases,
      status,
      checkFailure: leases.some((l) => l.strength === "strong" && l.status !== "valid"),
    };
  }).sort((a, b) => a.decisionId.localeCompare(b.decisionId));
}

const mark = (status: DecisionPremiseStatus): string =>
  status === "valid" ? "✓" : status === "missing" ? "✗" : status === "moved-or-ambiguous" ? "?" : "·";

function action(audit: DecisionPremiseAudit): string {
  if (audit.status === "moved-or-ambiguous")
    return `inspect ${audit.decisionId}; append a replacement naming the current unambiguous address, or retract it if the premise fell`;
  return `inspect ${audit.decisionId}; restore/rename the address, append a replacement decision, or run coherence retract ${audit.decisionId} --because \"...\"`;
}

/** Deterministic, actionable text. Valid rows collapse into the summary; every finding is
 *  keyed by decision id so a reader can act on the append-only record directly. */
export function renderPremiseAudit(audits: DecisionPremiseAudit[], unreadable = 0): string {
  const valid = audits.filter((a) => a.status === "valid").length;
  const unleased = audits.filter((a) => a.status === "unleased").length;
  // No address means no stale-address finding. Coverage matters, but expanding every old
  // unleased decision into a row drowns the smaller list that actually has somewhere to go.
  const findings = audits.filter((a) => a.status !== "valid" && a.status !== "unleased");
  const gateFailures = audits.filter((a) => a.checkFailure).length;
  // THE POPULATION IS THE ADDRESSES, NOT THE DECISIONS. A journal of a hundred decisions
  // that named no path and no symbol leases NOTHING, and "every extracted address
  // resolves" over zero extracted addresses is the report saying it looked when it did
  // not. The count is printed on every run, healthy or empty.
  const leases = audits.reduce((n, a) => n + a.leases.length, 0);
  const out = [
    "",
    "  PREMISE LEASES — do standing decisions' named structural addresses still resolve?",
    "  semantic premises checked: NO — a live address does not prove the recorded rationale remains true.",
    "",
    `  ${audits.length} standing decision(s) · ${leases} extracted address(es) · ${valid} address-valid · ${unleased} unleased · ${findings.length} finding(s) · ${gateFailures} gate-grade failure(s)`,
  ];
  if (unreadable) out.push(`  WARNING: ${unreadable} unreadable journal line(s) were skipped.`);
  if (!leases)
    out.push(`  no address to check: ${audits.length} standing decision(s) named no file and no symbol — nothing to resolve.`);
  else if (!findings.length)
    out.push(`  ✓ every extracted address resolves (${leases} address(es) across ${audits.length - unleased} leased decision(s) examined; semantic validity remains untested).`);
  for (const a of findings) {
    out.push("", `  ${mark(a.status)} ${a.decisionId}  ${a.status}${a.checkFailure ? "  [CHECK]" : "  [advisory]"}`);
    out.push(`      chose: ${a.chose}`);
    for (const lease of a.leases) {
      const targets = lease.matches.length ? ` → ${lease.matches.join(", ")}` : "";
      out.push(`      ${lease.strength} ${lease.kind} ${lease.value}: ${lease.status}${targets}`);
    }
    out.push(`      action: ${action(a)}`);
  }
  out.push("");
  return out.join("\n");
}

/** Command-shaped adapter for cli.ts. Report mode is always advisory; check mode fails
 *  only when an explicit `DecisionRecord.files` address no longer resolves. */
export async function premise(
  cfg: Config, graph: Graph, mode: "report" | "check" = "report",
): Promise<number> {
  const journal = readJournal(cfg);
  const root = resolve(cfg.root);
  const audits = auditPremiseLeases(journal.records, graph, {
    root,
    pathExists: (repoPath) => existsSync(resolve(root, repoPath)),
  });
  console.log(renderPremiseAudit(audits, journal.unreadable));
  const failed = audits.some((a) => a.checkFailure);
  if (mode === "check") {
    // THE GATE'S OWN DENOMINATOR IS NARROWER THAN THE REPORT'S: only a STRONG lease — an
    // authored `files` address — is gate-grade, so the population this line speaks for is
    // the strong leases and not every extracted address. With none of them, there is
    // nothing to hold and the line says so rather than holding nothing.
    const strong = audits.reduce((n, a) => n + a.leases.filter((l) => l.strength === "strong").length, 0);
    console.log(failed
      ? "  ✗ premise --check FAILED — one or more explicit journal file leases no longer resolve.\n"
      : strong
        ? `  ✓ premise --check held — every explicit journal file lease resolves (${strong} authored \`files\` address(es) checked; semantics were not).\n`
        : `  premise --check has nothing to gate: ${audits.length} standing decision(s) carry 0 authored \`files\` address(es) (only those are gate-grade).\n`);
  }
  return mode === "check" && failed ? 1 : 0;
}
