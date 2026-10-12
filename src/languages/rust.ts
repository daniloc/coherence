// rust.ts — the first-party Rust pack: one language, every instrument row, as DATA.
//
// FIRST-PARTY, NOT BUILT-IN-BY-TABLE. The three original languages live as rows inside
// each arm's own table; Rust is the first language to arrive as one pack through
// language-registry.ts, seeded from its static first-party list. That keeps the arms'
// tables closed and proves the registry path with a language users actually configure:
// `"language": "rust"` resolves to this pack exactly as a project's registered pack
// would, held to the same purity sweep (queries, patterns, and names of mechanism-owned
// strategies — never functions).
//
// THE MECHANISM OWNS EVERYTHING RUST NEEDED BEYOND ROWS, BY NAME. Three things a row
// could not say were measured on a real corpus before anything was named here: rustdoc
// comments sit above `#[…]` attributes (the default line scanner read nothing for 38 of
// 421 doc blocks), `use crate::…`/`super::…` paths are module paths, not file
// specifiers (unmodified, all 245 `use` paths of the corpus became external nodes), and
// format-string placeholders are text inside a macro token tree, not interpolation
// nodes. Each is a strategy NAME below (`docStyle: "rustdoc"`, `importResolution:
// "rust-module"`, …); the code behind each name lives with its instrument.
import { fileURLToPath } from "node:url";
import type { LanguagePack } from "../language-registry.ts";

/** The pack `"language": "rust"` resolves to. The grammar path resolves identically
 *  from src/ during dogfood and from dist/ in the shipped package, as the built-ins' do. */
export const rustPack: LanguagePack = {
  name: "rust",
  grammar: fileURLToPath(new URL("../../grammars/tree-sitter-rust.wasm", import.meta.url)),
  // Every top-level item, not only `pub` ones — following python, because chokepoint
  // claims routinely address private functions — plus functions in top-level impl and
  // trait bodies as `name()` methods. Items inside inline `mod x { … }` bodies (the
  // `#[cfg(test)] mod tests` idiom above all) are not symbols, as nested defs are not in
  // python. Corpus gate: every tags.scm definition at those positions is captured.
  graph: {
    exts: ["rs"],
    symbolQuery: `
      (source_file (function_item name: (identifier) @function))
      (source_file (struct_item name: (type_identifier) @struct))
      (source_file (enum_item name: (type_identifier) @enum))
      (source_file (union_item name: (type_identifier) @union))
      (source_file (trait_item name: (type_identifier) @trait))
      (source_file (type_item name: (type_identifier) @type))
      (source_file (const_item name: (identifier) @const))
      (source_file (static_item name: (identifier) @static))
      (source_file (mod_item name: (identifier) @module))
      (source_file (macro_definition name: (identifier) @macro))
      (source_file (impl_item body: (declaration_list (function_item name: (identifier) @method))))
      (source_file (trait_item body: (declaration_list (function_item name: (identifier) @method))))
      (source_file (trait_item body: (declaration_list (function_signature_item name: (identifier) @method))))
    `,
    // The file module's own scope: a use tree's whole text (the resolver expands
    // `a::{b, c::d}`) at top level and in top-level fn and method bodies; an out-of-line
    // `mod foo;` as its declaration text (a child-module edge, never an external); and
    // `extern crate` names. Inside an inline `mod x { … }` only `crate::` paths count —
    // `super::`/`self::` there are relative to a module the file path cannot name, and
    // the `mod tests { use super::*; }` idiom would otherwise link the parent module.
    importQuery: `
      (source_file (use_declaration argument: (_) @spec))
      (source_file (function_item body: (block (use_declaration argument: (_) @spec))))
      (source_file (impl_item body: (declaration_list (function_item body: (block (use_declaration argument: (_) @spec))))))
      (mod_item body: (declaration_list (use_declaration argument: (_) @spec (#match? @spec "^crate::"))))
      (source_file (mod_item !body) @spec)
      (source_file (extern_crate_declaration name: (identifier) @spec))
    `,
    lineComment: "//",
    docStyle: "rustdoc",
    importResolution: "rust-module",
  },
  // Behavioral surface: top-level items carrying ANY visibility modifier (`pub`,
  // `pub(crate)`, …: the crate's own API is surface for the zero-anchor alarm), and the
  // variants of a visible enum as an enumerated domain. Methods in impl blocks are not
  // counted, as class methods are not in typescript. Integration tests and benches are
  // evidence, not surface; inline `#[cfg(test)] mod tests` needs no path rule because
  // nested items are never captured.
  surface: {
    ext: /\.rs$/i,
    grammar: "rust",
    testPath: /(^|\/)(tests|benches)\/[^/]*\.rs$/,
    query: `
      (source_file (function_item (visibility_modifier) name: (identifier) @export))
      (source_file (struct_item (visibility_modifier) name: (type_identifier) @export))
      (source_file (enum_item (visibility_modifier) name: (type_identifier) @export))
      (source_file (union_item (visibility_modifier) name: (type_identifier) @export))
      (source_file (trait_item (visibility_modifier) name: (type_identifier) @export))
      (source_file (type_item (visibility_modifier) name: (type_identifier) @export))
      (source_file (const_item (visibility_modifier) name: (identifier) @export))
      (source_file (static_item (visibility_modifier) name: (identifier) @export))
      (source_file (enum_item (visibility_modifier) name: (type_identifier) @domain.name
        body: (enum_variant_list (enum_variant name: (identifier) @domain.member))))
    `,
  },
  // Duplicate-domain sites through the existing capture classes: enum variant lists,
  // struct field lists, string-array consts/statics/lets (through `&[…]`), string-literal
  // match arms, `==`/`!=` chains against string literals, and bracketed alternations in
  // literals. Deliberately absent: a match over enum variants (rustc already enforces
  // exhaustiveness — a compiler oracle, not an undeclared parity), or-patterns in match
  // arms (the grammar nests them left-deep, so "every branch a string" has no fixed-depth
  // spelling), `vec![…]` (its elements are an unparsed token tree), and raw strings.
  // `raw` strings strategy: it strips the `b`/`c` prefixes a byte or C string carries.
  sites: {
    ext: /\.rs$/,
    grammar: "rust",
    strings: "raw",
    compare: "operand",
    query: `
      (enum_item name: (type_identifier) @enum.name body: (enum_variant_list) @enum.body) @enum.decl
      (enum_variant_list (enum_variant name: (identifier) @enum.member)) @enum.of
      (struct_item name: (type_identifier) @shape.name body: (field_declaration_list) @shape.body) @shape.decl
      (field_declaration_list (field_declaration name: (field_identifier) @shape.member)) @shape.of
      (const_item name: (identifier) @var.name value: (_) @var.init) @var.decl
      (static_item name: (identifier) @var.name value: (_) @var.init) @var.decl
      (let_declaration pattern: (identifier) @var.name value: (_) @var.init) @var.decl
      (reference_expression value: (_) @peel.item) @peel.paren
      (array_expression) @list.body
      (array_expression (string_literal) @list.item) @list.of
      (array_expression (_) @list.alt) @list.of
      (match_expression value: (_) @switch.subject) @switch.subjof
      (match_expression body: (match_block) @switch.body) @switch.decl
      (match_block (match_arm pattern: (match_pattern . (string_literal) @switch.label .))) @switch.labelof
      (binary_expression left: [(identifier) (field_expression)] @cmp.expr operator: ["==" "!="] right: (string_literal) @cmp.lit) @cmp
      (binary_expression left: (string_literal) @cmp.lit operator: ["==" "!="] right: [(identifier) (field_expression)] @cmp.expr) @cmp
      (string_literal) @lit.text
      [(function_item) (closure_expression)] @scope
      [(line_comment) (block_comment)] @skip
    `,
  },
  // `via test` / parity at INDENT-REGEX grade, python's grade (d-3aa0cbff): the
  // grammar-query strategy hardcodes typescript node types, so a rust row could not use
  // it without a mechanism rewrite. The anchor is `fn <name>(` or `mod <name>` — the
  // name cargo's filter matches — and the block runs to the closing brace at the
  // anchor's indent (rustfmt output). Unit tests live inline in any `.rs` file, so every
  // one is a candidate; the name pre-filter keeps the walk cheap.
  // Declared blind spots: (1) the anchor is the FIRST line in a file that matches, so a
  // same-named fn in another impl or mod above the `#[test]` fn — not distinguished by
  // a line regex — is analyzed instead; (2) scope is imports only, so a same-file const
  // iterated by a test reads LIVE (opaque root), never LITERAL; (3) a multi-line
  // signature whose `) {` sits at the anchor's indent ends the block early;
  // (4) `use super::*` binds no names, so its domains read LIVE — the conservative side.
  oracle: {
    grade: "indent-regex",
    testFilePattern: /\.rs$/,
    anchorPatterns: [
      "^(\\s*)(?:pub(?:\\([^)]*\\))?\\s+)?(?:(?:const|async|unsafe)\\s+)*fn\\s+{name}\\s*[(<]",
      "^(\\s*)(?:pub(?:\\([^)]*\\))?\\s+)?mod\\s+{name}\\b",
    ],
    // `for x in <domain> {` and a receiver iterated in place (`REGISTRY.iter().all(…)`).
    domainPatterns: [
      /for\s+[\w,\s()&]+\s+in\s+&?(?:mut\s+)?([^{]+?)\s*\{/,
      /(?<![\w.:])((?:[A-Za-z_]\w*::)*[A-Za-z_]\w*(?:\.\w+)*)\.(?:iter|into_iter|keys|values)\(\)/,
    ],
    importPatterns: {
      fromImport: /^(?:pub(?:\([^)]*\))?\s+)?use\s+[\w:]+::\{([^}]+)\}\s*;/,
      plainImport: /^(?:pub(?:\([^)]*\))?\s+)?use\s+(?:\w+::)*(?:\w+\s+as\s+)?(\w+)\s*;/,
    },
    // An inline array or vec! literal, or a hand-chosen range bound.
    literalDomainPatterns: [/^\[/, /^vec!\s*\[/, /^&\[/, /^\d+\s*\.\./],
    // A len() lower-bound or non-emptiness assertion anywhere in the block.
    floorPattern: /assert!\(\s*[^\n]*\.len\(\)\s*>=?\s*\d|assert!\(\s*!\s*[^\n]*\.is_empty\(\)|assert_ne!\(\s*[^\n]*\.len\(\),\s*0\s*\)/,
    unwrapCalls: [],
    detailTemplates: {
      "inline-literal": "inline {expr40} literal",
      "call": "for-in/iter over {expr}",
      "imported": "for-in/iter over {expr}",
      "live-local": "for-in/iter over {expr}",
      "const-array": "inline {expr40} literal",
      "call-root": "for-in/iter over {expr}",
      "opaque-root": "for-in/iter over {expr}",
      "unresolved": "for-in/iter over {expr}",
    },
    noIterationDetail: "no for-in / .iter() over a domain",
  },
};
