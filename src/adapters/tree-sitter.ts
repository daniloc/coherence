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
import { Parser, Language, Query } from "web-tree-sitter";
import type { LanguageAdapter } from "../types.ts";

export interface TreeSitterLanguageSpec {
  exts: string[];
  /** Query whose CAPTURE NAMES are the symbol kinds (`@method` → kind "method"). */
  symbolQuery: string;
  /** Query whose `@spec` captures are import specifier text (string content). */
  importQuery: string;
  /** Line-comment prefix for the doc scanners (block-comment forms are declared out of grade). */
  lineComment: string;
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
      const tree = parser.parse(src);
      if (!tree) return [];
      const out: Array<{ name: string; kind: string; line: number }> = [];
      const seen = new Set<string>();
      for (const match of symbolQuery.matches(tree.rootNode)) {
        for (const capture of match.captures) {
          if (capture.name.startsWith("_")) continue; // predicate-only capture
          const kind = capture.name;
          const name = kind === "method" ? `${capture.node.text}()` : capture.node.text;
          const line = capture.node.startPosition.row + 1;
          const key = `${name}@${line}`;
          if (!seen.has(key)) { seen.add(key); out.push({ name, kind, line }); }
        }
      }
      return out.sort((a, b) => a.line - b.line);
    },
    imports(src: string) {
      const tree = parser.parse(src);
      if (!tree) return [];
      const specs: string[] = [];
      for (const match of importQuery.matches(tree.rootNode)) {
        for (const capture of match.captures) {
          if (capture.name === "spec") specs.push(capture.node.text);
        }
      }
      return specs;
    },
    docAbove(lines: string[], lineNo: number) {
      let j = lineNo - 2; // lineNo is 1-based; start at the line above the symbol
      const block: string[] = [];
      while (j >= 0 && lines[j].trim().startsWith(commentPrefix)) { block.unshift(lines[j]); j--; }
      return cleanLineComments(block, commentPrefix);
    },
    fileDoc(lines: string[]) {
      let i = 0;
      if (lines[0]?.startsWith("#!")) i = 1;
      while (i < lines.length && !lines[i].trim()) i++;
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(commentPrefix)) { block.push(lines[i]); i++; }
      return cleanLineComments(block, commentPrefix);
    },
  };
}
