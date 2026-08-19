// tree-sitter.ts — the grammar-backed adapter factory: a real parse behind the same
// five-member LanguageAdapter seam the regex adapters serve.
//
// WHY THIS EXISTS. The regex adapters scale in expert code: the python push measured
// ~900 hand-built lines across five instrument arms, per language, forever. A grammar
// plus a handful of QUERIES scales in data — modern tree-sitter grammar packages ship
// a prebuilt .wasm (no node-gyp, no native toolchain; `web-tree-sitter` runs it
// sandboxed), and the language-specific knowledge shrinks to capture patterns a
// contributor can write without touching harness internals. Phase 1 (this file) serves
// the GRAPH tier through the unchanged seam; the per-language instrument arms remain
// hand-built until a later phase ports them to query packs (d-7cdb271f holds the
// standing direction and its rejected alternatives).
//
// THE FACTORY IS ASYNC, THE ADAPTER IS NOT. Loading a wasm grammar is async once;
// every LanguageAdapter method stays sync, so nothing downstream changes shape. A
// project adapter module uses top-level await — `export default await
// makeTreeSitterAdapter(…)` — and derive.ts's dynamic import already awaits module
// evaluation, so the loader needed no change at all.
//
// CAPTURE NAME IS SYMBOL KIND. A spec's symbolQuery names its captures for the kinds
// they produce (@method @class @const …); `method` captures get the same `name()`
// spelling the typescript and python adapters use, so boundary claims address symbols
// identically whichever grade derived them.
import { fileURLToPath } from "node:url";
import { Parser, Language, Query, type Tree } from "web-tree-sitter";
import type { LanguageAdapter } from "../types.ts";

/**
 * THE ONLY SANCTIONED WAY TO PARSE. web-tree-sitter trees hold wasm heap that only an
 * explicit `tree.delete()` returns, and the emscripten heap is fixed-size — parse
 * without freeing and a large enough tree of files aborts the runtime mid-walk
 * (measured: an adopter's `verify` died at parse ~638; the same loop with delete runs
 * unbounded). A leak is a bug class an agent can hand-roll while everything works, so
 * it is dissolved rather than policed: every call site takes this helper, the tree
 * never escapes it, and forgetting to free is unrepresentable.
 */
export function withTree<T>(parser: Parser, src: string, empty: T, fn: (tree: Tree) => T): T {
  const tree = parser.parse(src);
  if (!tree) return empty;
  try { return fn(tree); } finally { tree.delete(); }
}

export interface TreeSitterLanguageSpec {
  exts: string[];
  /** Query whose CAPTURE NAMES are the symbol kinds (`@method` → kind "method"). */
  symbolQuery: string;
  /** Query whose `@spec` captures are import specifier text (string content). */
  importQuery: string;
  /** Line-comment prefix for the generic doc scanners (block forms need `docs`). */
  lineComment: string;
  /** Captured names to drop (e.g. `constructor` — a member the grammar names but the graph never should). */
  excludeSymbolNames?: RegExp;
  /** Prose-extraction strategy, NAMED from a closed set the mechanism owns — a pack
   *  carries data, never code (the pack-purity invariant). "line" reads lineComment
   *  blocks; "jsdoc" adds block comments; "docstring" prefers the literal below a
   *  def/class. Default "line". */
  docStyle?: "line" | "jsdoc" | "docstring";
  /** Escape hatch for PROJECT adapter modules only (rung 2 is code territory by
   *  definition). Built-in packs must not use it — the purity guard enforces that. */
  docs?: { docAbove(lines: string[], line: number): string; fileDoc(lines: string[]): string };
}

/** Ruby at query grade: methods, singleton methods, classes, modules, constants;
 *  `require`/`require_relative` string arguments as import edges; `#` doc blocks. */
export const ruby: TreeSitterLanguageSpec = {
  exts: ["rb"],
  symbolQuery: `
    (method name: (identifier) @method)
    (singleton_method name: (identifier) @method)
    (class name: (constant) @class)
    (module name: (constant) @module)
    (assignment left: (constant) @const)
  `,
  importQuery: `
    (call
      method: (identifier) @_require
      arguments: (argument_list (string (string_content) @spec))
      (#match? @_require "^require(_relative)?$"))
  `,
  lineComment: "#",
};

// ── prose extraction the regex adapters proved, ported verbatim ──────────────────────
// The symbol/import PARSING below is grammar-backed; prose extraction is line-oriented
// text work where byte-stable behavior across the migration matters more than a parse.

function cleanTsComment(raw: string[]): string {
  const c = raw
    .map((l) => l.replace(/^\s*\/\*\*?/, "").replace(/\*\/\s*$/, "").replace(/^\s*\*\s?/, "").replace(/^\s*\/\/\s?/, ""))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return /^[\s\-─=*]+$/.test(c) ? "" : c;
}

const typescriptDocs = {
  docAbove(lines: string[], lineNo: number): string {
    const i = lineNo - 2;
    if (i < 0) return "";
    const t = lines[i].trim();
    if (t.endsWith("*/")) { const b: string[] = []; let j = i; while (j >= 0 && !lines[j].includes("/*")) { b.unshift(lines[j]); j--; } if (j >= 0) b.unshift(lines[j]); return cleanTsComment(b); }
    if (t.startsWith("//")) { const b: string[] = []; let j = i; while (j >= 0 && lines[j].trim().startsWith("//")) { b.unshift(lines[j]); j--; } return cleanTsComment(b); }
    return "";
  },
  fileDoc(lines: string[]): string {
    let i = 0;
    if (lines[0]?.startsWith("#!")) i = 1;
    while (i < lines.length && !lines[i].trim()) i++;
    const t = lines[i]?.trim() || "";
    if (t.startsWith("/*")) { const b: string[] = []; let j = i; while (j < lines.length && !lines[j].includes("*/")) { b.push(lines[j]); j++; } if (j < lines.length) b.push(lines[j]); return cleanTsComment(b); }
    if (t.startsWith("//")) { const b: string[] = []; let j = i; while (j < lines.length && lines[j].trim().startsWith("//")) { b.push(lines[j]); j++; } return cleanTsComment(b); }
    return "";
  },
};

function cleanHash(raw: string[]): string {
  const c = raw.map((l) => l.replace(/^\s*#\s?/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return /^[\s\-─=*]+$/.test(c) ? "" : c;
}

/** Python prose lives in TWO places: `#` blocks above a symbol, and the docstring
 *  on the line(s) BELOW a def/class. Prefer the docstring when present. */
const pythonDocs = {
  docAbove(lines: string[], lineNo: number): string {
    let j = lineNo; // lineNo is 1-based; lines[lineNo] is the line AFTER the symbol
    while (j < lines.length && !lines[j].trim()) j++;
    const t = lines[j]?.trim() ?? "";
    const q = t.startsWith('"""') ? '"""' : t.startsWith("'''") ? "'''" : null;
    if (q) {
      const body: string[] = [];
      const s = t.slice(3);
      if (s.endsWith(q) && s.length >= 3) return s.slice(0, -3).trim();
      body.push(s);
      for (let k = j + 1; k < lines.length; k++) {
        const idx = lines[k].indexOf(q);
        if (idx >= 0) { body.push(lines[k].slice(0, idx)); return body.join("\n").trim(); }
        body.push(lines[k]);
      }
    }
    const i = lineNo - 2;
    if (i < 0) return "";
    if (lines[i].trim().startsWith("#")) {
      const b: string[] = []; let k = i;
      while (k >= 0 && lines[k].trim().startsWith("#")) { b.unshift(lines[k]); k--; }
      return cleanHash(b);
    }
    return "";
  },
  fileDoc(lines: string[]): string {
    let i = 0;
    if (lines[0]?.startsWith("#!")) i = 1;
    while (i < lines.length && (!lines[i].trim() || /^#.*coding[:=]/.test(lines[i]))) i++;
    const t = lines[i]?.trim() ?? "";
    const q = t.startsWith('"""') ? '"""' : t.startsWith("'''") ? "'''" : null;
    if (q) {
      const s = t.slice(3);
      if (s.endsWith(q) && s.length >= 3) return s.slice(0, -3).trim();
      const body = [s];
      for (let k = i + 1; k < lines.length; k++) {
        const idx = lines[k].indexOf(q);
        if (idx >= 0) { body.push(lines[k].slice(0, idx)); return body.join("\n").trim(); }
        body.push(lines[k]);
      }
    }
    if (t.startsWith("#")) {
      const b: string[] = []; let k = i;
      while (k < lines.length && lines[k].trim().startsWith("#")) { b.push(lines[k]); k++; }
      return cleanHash(b);
    }
    return "";
  },
};

/** The closed strategy set the `docStyle` field names. "line" is absent on purpose:
 *  it is the factory's default scanners below, parameterized by lineComment. */
const DOC_STRATEGIES: Record<string, { docAbove(lines: string[], line: number): string; fileDoc(lines: string[]): string } | undefined> = {
  jsdoc: typescriptDocs,
  docstring: pythonDocs,
};

/** TypeScript at query grade: exported top-level declarations + class methods. Mirrors
 *  the retired regex adapter's declared intent; corpus-diffed against it before the
 *  swap (63 files, 625 symbols, zero missed — the 2 deltas are regex over-reports). */
export const typescript: TreeSitterLanguageSpec = {
  exts: ["ts"],
  symbolQuery: `
    (export_statement declaration: (function_declaration name: (identifier) @function))
    (export_statement declaration: (generator_function_declaration name: (identifier) @function))
    (export_statement declaration: (lexical_declaration "const" (variable_declarator name: (identifier) @const)))
    (export_statement declaration: (lexical_declaration "let" (variable_declarator name: (identifier) @let)))
    (export_statement declaration: (class_declaration name: (type_identifier) @class))
    (export_statement declaration: (abstract_class_declaration name: (type_identifier) @class))
    (export_statement declaration: (interface_declaration name: (type_identifier) @interface))
    (export_statement declaration: (type_alias_declaration name: (type_identifier) @type))
    (export_statement declaration: (enum_declaration name: (identifier) @enum))
    (class_body (method_definition name: (property_identifier) @method))
  `,
  importQuery: `
    (import_statement source: (string (string_fragment) @spec))
    (export_statement source: (string (string_fragment) @spec))
  `,
  lineComment: "//",
  excludeSymbolNames: /^constructor$/,
  docStyle: "jsdoc",
};

/** Python at query grade: module-level defs/classes/assignments + class methods,
 *  decorated forms included. Corpus-diffed against the retired regex adapter over
 *  flask/src (24 files, 430 symbols; the 8 deltas were regex nesting mistakes). */
export const python: TreeSitterLanguageSpec = {
  exts: ["py"],
  symbolQuery: `
    (module (function_definition name: (identifier) @function))
    (module (decorated_definition (function_definition name: (identifier) @function)))
    (module (class_definition name: (identifier) @class))
    (module (decorated_definition (class_definition name: (identifier) @class)))
    (class_definition body: (block (function_definition name: (identifier) @method)))
    (class_definition body: (block (decorated_definition (function_definition name: (identifier) @method))))
    (module (expression_statement (assignment left: (identifier) @const)))
  `,
  importQuery: `
    (import_statement name: (dotted_name) @spec)
    (import_statement name: (aliased_import name: (dotted_name) @spec))
    (import_from_statement module_name: (dotted_name) @spec)
    (import_from_statement module_name: (relative_import) @spec)
  `,
  lineComment: "#",
  docStyle: "docstring",
};

function cleanLineComments(raw: string[], prefix: string): string {
  const stripped = raw.map((l) => l.replace(new RegExp(`^\\s*${prefix}\\s?`), ""))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return /^[\s\-─=*]+$/.test(stripped) ? "" : stripped;
}

export async function makeTreeSitterAdapter(
  spec: TreeSitterLanguageSpec,
  wasmPath: string,
): Promise<LanguageAdapter> {
  await Parser.init();
  const language = await Language.load(wasmPath);
  const symbolQuery = new Query(language, spec.symbolQuery);
  const importQuery = new Query(language, spec.importQuery);
  const parser = new Parser();
  parser.setLanguage(language);

  const commentPrefix = spec.lineComment;
  return {
    exts: spec.exts,
    symbols(src: string) {
      return withTree(parser, src, [] as Array<{ name: string; kind: string; line: number }>, (tree) => {
      const out: Array<{ name: string; kind: string; line: number }> = [];
      const seen = new Set<string>();
      for (const match of symbolQuery.matches(tree.rootNode)) {
        for (const capture of match.captures) {
          if (capture.name.startsWith("_")) continue; // predicate-only capture
          if (spec.excludeSymbolNames?.test(capture.node.text)) continue;
          const kind = capture.name;
          const name = kind === "method" ? `${capture.node.text}()` : capture.node.text;
          const line = capture.node.startPosition.row + 1;
          const key = `${name}@${line}`;
          if (!seen.has(key)) { seen.add(key); out.push({ name, kind, line }); }
        }
      }
      return out.sort((a, b) => a.line - b.line);
      });
    },
    imports(src: string) {
      return withTree(parser, src, [] as string[], (tree) => {
        const specs: string[] = [];
        for (const match of importQuery.matches(tree.rootNode)) {
          for (const capture of match.captures) {
            if (capture.name === "spec") specs.push(capture.node.text);
          }
        }
        return specs;
      });
    },
    docAbove: spec.docs?.docAbove ?? DOC_STRATEGIES[spec.docStyle ?? "line"]?.docAbove ?? ((lines: string[], lineNo: number) => {
      let j = lineNo - 2; // lineNo is 1-based; start at the line above the symbol
      const block: string[] = [];
      while (j >= 0 && lines[j].trim().startsWith(commentPrefix)) { block.unshift(lines[j]); j--; }
      return cleanLineComments(block, commentPrefix);
    }),
    fileDoc: spec.docs?.fileDoc ?? DOC_STRATEGIES[spec.docStyle ?? "line"]?.fileDoc ?? ((lines: string[]) => {
      let i = 0;
      if (lines[0]?.startsWith("#!")) i = 1;
      while (i < lines.length && !lines[i].trim()) i++;
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(commentPrefix)) { block.push(lines[i]); i++; }
      return cleanLineComments(block, commentPrefix);
    }),
  };
}

// ── the built-in registry ────────────────────────────────────────────────────────────
// One memoized async factory per shipped language. The wasm lives in grammars/ at the
// package root (vendored, provenance in grammars/PROVENANCE.md, refreshed by
// scripts/refresh-grammars.mjs), so the path resolves identically from src/ during
// dogfood and from dist/ in the shipped package.
const grammarPath = (wasm: string): string =>
  fileURLToPath(new URL(`../../grammars/${wasm}`, import.meta.url));

const BUILTIN_WASM: Record<string, string> = {
  typescript: "tree-sitter-typescript.wasm",
  python: "tree-sitter-python.wasm",
  ruby: "tree-sitter-ruby.wasm",
};

/** One memoized {language, parser} per built-in grammar — the graph adapter AND the
 *  instrument arms (phase 2b) query the same loaded grammar instead of re-reading wasm. */
export interface GrammarHandle { language: Language; parser: Parser }
const handleCache = new Map<string, Promise<GrammarHandle>>();
export function grammarHandle(name: keyof typeof BUILTIN_WASM | string): Promise<GrammarHandle> {
  let cached = handleCache.get(name);
  if (!cached) {
    const wasm = BUILTIN_WASM[name];
    if (!wasm) return Promise.reject(new Error(`no built-in grammar named ${JSON.stringify(name)}`));
    cached = (async () => {
      await Parser.init();
      const language = await Language.load(grammarPath(wasm));
      const parser = new Parser();
      parser.setLanguage(language);
      return { language, parser };
    })();
    handleCache.set(name, cached);
  }
  return cached;
}

const builtinCache = new Map<string, Promise<LanguageAdapter>>();
function memo(name: string, wasm: string, spec: TreeSitterLanguageSpec): () => Promise<LanguageAdapter> {
  return () => {
    let cached = builtinCache.get(name);
    if (!cached) { cached = makeTreeSitterAdapter(spec, grammarPath(wasm)); builtinCache.set(name, cached); }
    return cached;
  };
}

export const BUILTIN_LANGUAGES: Record<string, () => Promise<LanguageAdapter>> = {
  typescript: memo("typescript", "tree-sitter-typescript.wasm", typescript),
  python: memo("python", "tree-sitter-python.wasm", python),
  ruby: memo("ruby", "tree-sitter-ruby.wasm", ruby),
};
