// prose.ts — the PROSE-ROT detector: one argument cached in two places, and whether the
// copies still agree.
//
// The doctrine this repo already holds says a cached fact is worth its cost only while it
// is cheaper than re-deriving — and the repo's own reading surfaces cache the SAME
// argument in README, RELEASE-NOTES and module headers with nothing tying the spellings
// together. That is `redundancy`'s definition of its finding, applied to prose, which
// `redundancy` deliberately does not scan (its unit is an enumerated domain, not a
// sentence). The historical record here is unambiguous: the command index drifted three
// times in two days until it was DERIVED; the hand-kept tables that stayed hand-kept
// drifted. Prose copies rot the same way, and no compiler, test, or claim will ever see it.
//
// THE SIGNAL IS DIVERGENCE, NOT DUPLICATION. "You repeated yourself" is a style remark;
// a summary legitimately restates a fuller argument and must not read as a defect. The
// finding worth a reader's attention is "you repeated yourself AND the copies no longer
// agree" — that is rot a reader cannot detect without diffing both sites, because each
// copy reads as authoritative on its own. So every reported pair is labeled IDENTICAL
// (agreeing today, tied together by nothing) or DIVERGED (already disagreeing), and
// DIVERGED ranks first.
//
// WHAT THE FLOOR GIVES UP, ON PURPOSE. Pairs are sentences sharing 6-word shingles at
// Jaccard ≥ the floor. Six words in a row is already a copy signature — an independent
// paraphrase of the same idea almost never reproduces six-word runs — and the floor on
// top of it is precision-first: below it, a heavily-rewritten copy and a fresh paraphrase
// are indistinguishable from text alone, so BOTH are ignored. That makes this a LOWER
// BOUND on rot, the same way calibration.ts names its trace a lower bound: the copies
// that drifted FURTHEST are exactly the ones this cannot see.
//
// WHAT IT CANNOT SEE AT ALL, and the render says so: it compares text, not meaning. It
// cannot tell a deliberate summary from a rotted copy, and a DIVERGED pair whose
// difference is intended is a question to dismiss, not a defect to fix.
//
// Deliberately NOT scanned: inline comments below a module's header essay (they narrate
// local code, and pairing them would drown the reading-surface signal), test files
// (evidence, not a reading surface), generated markdown (AGENTS.md, CHANGELOG.md, and
// `<!-- coherence:* -->` blocks — derived text restates by construction), and code
// itself (`redundancy` owns enumerated domains; this module owns sentences).
//
// Output is ADVISORY and it gates nothing — always exits 0. This is the advisory class
// where one false positive teaches people to ignore the instrument, so the default report
// is capped and floored; `--all` uncaps so precision can be judged rather than trusted.
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import type { Config } from "./types.ts";
import { isTestPath } from "./novelty.ts";
import { readJournal } from "./decisions.ts";
import { raiseFindings, formatRaise, type Finding } from "./raise.ts";
import { NOISE_DIRS } from "./oracle-domain.ts";

/** One sentence, as found on a reading surface. `line` is a navigation aid, never
 *  identity — the same rule redundancy.ts and cli.ts already enforce. */
export interface ProseUnit {
  file: string;
  line: number;
  /** The sentence as written, for display. */
  text: string;
  /** Normalized tokens — lowercased, punctuation stripped. Identity and shingles. */
  words: string[];
}

export const SHINGLE = 6;

/** Lowercase, strip everything but letters/digits, split. Both sides of a pair pass
 *  through the same rule, so a crude normalization stays symmetric. */
export const normalizeWords = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);

/** k-word shingles as strings. Fewer than k words → empty set (the unit cannot pair). */
export function shinglesOf(words: string[], k = SHINGLE): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + k <= words.length; i++) out.add(words.slice(i, i + k).join(" "));
  return out;
}

// ── sentence extraction ───────────────────────────────────────────────────────────────

/** Strip inline markdown so a sentence yields its own words (same moves as redundancy's
 *  plainCell, over running text instead of a table cell). */
const plainText = (s: string) =>
  s.replace(/`([^`]*)`/g, "$1").replace(/\*\*?([^*]*)\*\*?/g, "$1")
   .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1").trim();

/** Crude sentence split. Mis-splits are symmetric (both copies split by the same rule),
 *  so a wrong boundary costs recall, never a false pair. */
const splitSentences = (paragraph: string): string[] =>
  paragraph.split(/(?<=[.!?])\s+(?=[A-Z"'`(—·-])/).map((s) => s.trim()).filter(Boolean);

/** The shared paragraph→sentence pass. `lines[i]` is the cleaned text of source line
 *  i+offset, or null for a paragraph break / skipped line. */
export function unitsFromLines(lines: (string | null)[], file: string, offset = 1): ProseUnit[] {
  const out: ProseUnit[] = [];
  let buf: string[] = [];
  let start = 0;
  const flush = () => {
    if (!buf.length) return;
    for (const text of splitSentences(buf.join(" "))) {
      const words = normalizeWords(text);
      if (words.length) out.push({ file, line: start + offset, text, words });
    }
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === null || !l.trim()) { flush(); continue; }
    if (!buf.length) start = i;
    buf.push(l.trim());
  }
  flush();
  return out;
}

/** Pure — the sentences of one markdown document. Skips fenced code, tables, headings,
 *  and `<!-- coherence:* -->` generated blocks (derived text restates by construction). */
export function proseOfMarkdown(text: string, file: string): ProseUnit[] {
  const raw = text.split("\n");
  let fenced = false, generated = false;
  const lines = raw.map((l): string | null => {
    if (/^\s*```/.test(l)) { fenced = !fenced; return null; }
    if (fenced) return null;
    if (/^<!-- coherence:.*begin -->\s*$/.test(l)) { generated = true; return null; }
    if (/^<!-- coherence:.*end -->\s*$/.test(l)) { generated = false; return null; }
    if (generated) return null;
    if (/^#{1,6}\s/.test(l)) return null;          // headings are labels, not sentences
    if (l.trim().startsWith("|")) return null;      // tables are redundancy's surface
    if (/^\s*(?:[-*+]|\d+\.|>)\s/.test(l)) return plainText(l.replace(/^\s*(?:[-*+]|\d+\.|>)\s+/, ""));
    return plainText(l);
  });
  return unitsFromLines(lines, file);
}

/** Pure — the leading comment block of a source file (the module header essay), as
 *  cleaned lines. Stops at the first line that is neither comment nor blank-inside-the-
 *  block; comments further down narrate local code and are deliberately out of scope. */
export function headerLines(src: string): (string | null)[] {
  const raw = src.split("\n");
  const out: (string | null)[] = [];
  let i = 0;
  if (raw[0]?.startsWith("#!")) { out.push(null); i = 1; }
  let inBlock = false;
  for (; i < raw.length; i++) {
    const l = raw[i];
    if (inBlock) {
      const end = l.indexOf("*/");
      const body = end >= 0 ? l.slice(0, end) : l;
      out.push(body.replace(/^\s*\*\s?/, "").trim() || null);
      if (end >= 0) break;
      continue;
    }
    if (/^\s*\/\//.test(l)) {
      const body = l.replace(/^\s*\/\/\s?/, "").replace(/[─│┌┐└┘├┤]+/g, " ").trim();
      // a `── section ──` rule or a bare `·` bullet marker is layout, not prose
      out.push(body && !/^[·\s-]*$/.test(body) ? plainText(body.replace(/^·\s*/, "")) : null);
      continue;
    }
    if (/^\s*\/\*/.test(l)) { inBlock = true; out.push(l.replace(/^\s*\/\*+\s?/, "").trim() || null); continue; }
    break; // first non-comment line ends the header
  }
  return out;
}

export const proseOfHeader = (src: string, file: string): ProseUnit[] =>
  unitsFromLines(headerLines(src), file);

// ── the walk ──────────────────────────────────────────────────────────────────────────

const CODE_RE = /\.[mc]?[jt]sx?$/;
/** Same rationale as redundancy's set: generated artifacts restate by construction. */
const GENERATED_MD = new Set(["AGENTS.md", "CHANGELOG.md"]);

/** Every prose surface: markdown documents (minus generated ones) plus module header
 *  essays of code files under `cfg.sources` (default: the entry dir). */
export async function collectProse(cfg: Config): Promise<ProseUnit[]> {
  const ignore = new Set([...NOISE_DIRS, ...(cfg.ignore ?? []), cfg.outputDir]);
  const srcDirs = cfg.sources?.length ? cfg.sources : [cfg.entryDir];
  const inSources = (rel: string) =>
    srcDirs.some((d) => d === "." || rel === d || rel.startsWith(d.replace(/\/+$/, "") + "/"));
  const out: ProseUnit[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".") || ignore.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { await visit(p); continue; }
      const rel = relative(cfg.root, p);
      if (isTestPath(rel)) continue;
      const wantMd = e.name.endsWith(".md") && !GENERATED_MD.has(e.name);
      const wantHeader = CODE_RE.test(e.name) && inSources(rel);
      if (!wantMd && !wantHeader) continue;
      const src = await readFile(p, "utf8").catch(() => null);
      if (src === null) continue;
      out.push(...(wantMd ? proseOfMarkdown(src, rel) : proseOfHeader(src, rel)));
    }
  };
  await visit(cfg.root);
  return out;
}

// ── pairing ───────────────────────────────────────────────────────────────────────────

export interface ProsePair {
  a: ProseUnit; b: ProseUnit;
  /** Jaccard over the two units' 6-word shingle sets. */
  similarity: number;
  /** Shared shingle count — how much verbatim run the two copies still hold. */
  shared: number;
  /** Normalized word sequences equal: agreeing today, tied together by nothing. */
  identical: boolean;
}

export interface ProseSuppressed { short: number; belowFloor: number; }

export interface ProseOpts {
  minWords?: number; // a sentence shorter than this cannot pair — idiom, not an argument
  floor?: number;    // Jaccard floor over 6-word shingles for the default report
  maxDf?: number;    // a shingle in more than this many sentences is idiom, not a copy signature
  top?: number;      // how many ranked pairs the default report prints
}
export const PROSE_DEFAULTS: Required<ProseOpts> = { minWords: 12, floor: 0.5, maxDf: 6, top: 12 };

/**
 * Pure — pair the sentences and rank them: DIVERGED first (the rot signal), then by
 * similarity, so the most-verbatim disagreement — the clearest case of a copy that
 * stopped being maintained — leads the report. Same-file pairs are excluded: repetition
 * within one document is visible to its reader; the invisible rot is cross-file.
 */
export function pairProse(units: ProseUnit[], opts: ProseOpts = {}): { pairs: ProsePair[]; suppressed: ProseSuppressed } {
  const o = { ...PROSE_DEFAULTS, ...opts };
  const suppressed: ProseSuppressed = { short: 0, belowFloor: 0 };
  const live = units.filter((u) => {
    if (u.words.length >= o.minWords) return true;
    suppressed.short++; return false;
  });
  const sets = live.map((u) => shinglesOf(u.words));

  const df = new Map<string, number>();
  for (const s of sets) for (const sh of s) df.set(sh, (df.get(sh) ?? 0) + 1);

  // candidates come only from a shared, sub-idiom shingle — linear in co-occurrences
  const byShingle = new Map<string, number[]>();
  for (let i = 0; i < live.length; i++)
    for (const sh of sets[i])
      if ((df.get(sh) ?? 0) <= o.maxDf) (byShingle.get(sh) ?? byShingle.set(sh, []).get(sh)!).push(i);

  const seen = new Set<string>();
  const pairs: ProsePair[] = [];
  for (const group of byShingle.values()) {
    for (let x = 0; x < group.length; x++) for (let y = x + 1; y < group.length; y++) {
      const [i, j] = [group[x], group[y]];
      const a = live[i], b = live[j];
      if (a.file === b.file) continue;
      const key = i < j ? `${i}|${j}` : `${j}|${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let inter = 0;
      for (const sh of sets[i]) if (sets[j].has(sh)) inter++;
      const union = sets[i].size + sets[j].size - inter;
      const similarity = union ? inter / union : 0;
      if (similarity < o.floor) { suppressed.belowFloor++; continue; }
      pairs.push({
        a, b, shared: inter,
        similarity: Math.round(similarity * 100) / 100,
        identical: a.words.join(" ") === b.words.join(" "),
      });
    }
  }
  pairs.sort((p, q) =>
    Number(p.identical) - Number(q.identical) || q.similarity - p.similarity || q.shared - p.shared);
  return { pairs, suppressed };
}

// ── stable identity, for the journal ──────────────────────────────────────────────────

/** A sentence has no name, so its identity is a digest of its own normalized words —
 *  the same call redundancy.ts makes for positional alternation sites, with the same
 *  honesty argument: an edited sentence IS a different sentence, so re-keying on edit is
 *  correct behaviour, not a leak. No line, no score. */
export const unitSubject = (u: ProseUnit): string =>
  `${u.file}#prose:${createHash("sha256").update(u.words.join(" ")).digest("hex").slice(0, 6)}`;

/** A|B and B|A are one question. */
export const prosePairSubject = (p: ProsePair): string =>
  [unitSubject(p.a), unitSubject(p.b)].sort().join("|");

// ── render ────────────────────────────────────────────────────────────────────────────

const clip = (s: string, n = 96) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

/** THE REPORTING FLOOR, in one place — what the render shows is exactly what may raise,
 *  by construction (the same rule redundancy.ts states at shownPairs). */
export function shownProse(pairs: ProsePair[], opts: ProseOpts = {}): ProsePair[] {
  const o = { ...PROSE_DEFAULTS, ...opts };
  return pairs.slice(0, o.top);
}

export function renderProse(pairs: ProsePair[], suppressed: ProseSuppressed, unitCount: number, opts: ProseOpts = {}): string {
  const o = { ...PROSE_DEFAULTS, ...opts };
  const shown = shownProse(pairs, o);
  const diverged = pairs.filter((p) => !p.identical).length;
  const out: string[] = ["\n  PROSE ROT — the same prose cached in more than one place, and whether the copies still agree\n"];
  out.push(`  ${unitCount} sentence(s) scanned (${suppressed.short} under ${o.minWords} words ignored) · `
    + `${pairs.length} linked pair(s) at Jaccard ≥ ${o.floor} over ${SHINGLE}-word shingles · `
    + `${diverged} DIVERGED · ${pairs.length - diverged} identical`);
  out.push(`  LOWER BOUND: below the floor a heavily-rewritten copy and a fresh paraphrase are indistinguishable`);
  out.push(`  from text alone, so both are ignored — the copies that drifted furthest are the ones this cannot see.`);
  out.push(`  ${suppressed.belowFloor} candidate pair(s) fell below the floor` + (pairs.length > shown.length ? ` · ${pairs.length - shown.length} above it not shown (--all)` : "") + ".");
  // THE COMPARABLE POPULATION, not the scanned one: a sentence under `minWords` cannot
  // pair, so a tree of nothing but short lines has a denominator of zero however many
  // sentences were read. With nothing comparable there is no ✓ — "no copies" and "no
  // sentences" are the same silence, and only the count tells them apart.
  const comparable = unitCount - suppressed.short;
  if (comparable <= 0) {
    out.push(`\n  no prose to compare: ${comparable === 0 && unitCount ? `all ${unitCount} sentence(s) fell under ${o.minWords} words` : "0 sentence(s) scanned"} —`);
    out.push("  nothing here is long enough to be a copy of anything else.\n");
    return out.join("\n");
  }
  if (!shown.length) {
    out.push(`\n  ✓ no duplicated prose above the floor (${comparable} comparable sentence(s) and ${pairs.length} linked pair(s) examined).\n`);
    return out.join("\n");
  }
  out.push("");
  for (const [i, p] of shown.entries()) {
    const tag = p.identical ? "IDENTICAL" : "DIVERGED ";
    out.push(`  ${String(i + 1).padStart(2)}. ${tag}  similarity ${p.similarity.toFixed(2)}  ·  ${p.a.file}:${p.a.line}  ⇄  ${p.b.file}:${p.b.line}`);
    if (p.identical) {
      out.push(`      "${clip(p.a.text)}"`);
      out.push(`      → agreeing today, tied together by nothing — the next edit to either copy rots the other.`);
    } else {
      out.push(`      A  "${clip(p.a.text)}"`);
      out.push(`      B  "${clip(p.b.text)}"`);
      out.push(`      → the copies no longer agree. Either the difference is intended (say so), or one side rotted.`);
    }
    out.push("");
  }
  out.push("  This compares TEXT, not meaning: it cannot tell a deliberate summary from a rotted copy.");
  out.push("  The durable fix is the one this repo already proved on its command index: keep ONE spelling");
  out.push("  and DERIVE or reference the others. (advisory — gates nothing, always exits 0)\n");
  return out.join("\n");
}

// ── raising ───────────────────────────────────────────────────────────────────────────

/** Only DIVERGED pairs become questions. An identical pair is a maintenance remark; a
 *  diverged pair is the two-candidate conjecture the render already prints and throws
 *  away — "intended, or rotted" — which is exactly a Finding. */
export function proseFindings(pairs: ProsePair[]): Finding[] {
  return pairs.filter((p) => !p.identical).map((p) => ({
    advisory: "prose",
    subject: prosePairSubject(p),
    observation:
      `${p.a.file} and ${p.b.file} hold near-verbatim copies of one sentence that no longer agree`,
    because:
      `A at ${p.a.file}:${p.a.line} reads "${clip(p.a.text, 120)}"; B at ${p.b.file}:${p.b.line} reads `
      + `"${clip(p.b.text, 120)}" (similarity ${p.similarity.toFixed(2)} over ${SHINGLE}-word shingles). `
      + `Each copy reads as authoritative on its own, so a reader of one cannot see that the other `
      + `disagrees — that is rot only a diff can surface, and nothing runs that diff.`,
    couldBe: [
      "one side rotted — the argument was updated at one spelling and not at the other, and there was nothing there to notice",
      "the difference is intended — one site deliberately summarizes or re-frames the other, and nobody wrote that down",
    ],
    discriminatedBy:
      "put the two sentences side by side. If one is the stale copy, update or delete it and keep ONE"
      + " authoritative spelling (derive or reference it — the command-index fix). If the difference is"
      + " deliberate, dismiss this question saying so.",
    files: [p.a.file, p.b.file],
  }));
}

export interface ProseCmdOpts extends ProseOpts { all?: boolean; raise?: boolean; raiseCap?: number; session?: string; agent?: string }

/** The `coherence prose` command. Advisory: always returns 0. */
export async function prose(cfg: Config, opts: ProseCmdOpts = {}): Promise<number> {
  const { all, raise: doRaise, raiseCap, session, agent, ...thresholds } = opts;
  const units = await collectProse(cfg);
  const base: ProseOpts = { ...(cfg.prose ?? {}), ...thresholds };
  const eff: ProseOpts = { ...base, ...(all ? { top: Number.MAX_SAFE_INTEGER } : {}) };
  const { pairs, suppressed } = pairProse(units, eff);
  console.log(renderProse(pairs, suppressed, units.length, eff));

  // RAISING READS `base`, NEVER `eff` — the flag whose job is to show more must not also
  // mean write more (redundancy.ts states the rule; this holds it).
  const report = raiseFindings(cfg, readJournal(cfg).records, proseFindings(shownProse(pairs, base)), {
    enabled: doRaise, cap: raiseCap, session, agent,
  });
  for (const line of formatRaise(report)) console.log(line);
  return 0;
}
