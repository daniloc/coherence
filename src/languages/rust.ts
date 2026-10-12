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
};
