// typescript.ts — language adapter: how to read TypeScript symbols, imports, docblocks.
// All TS-specific parsing lives here. Swap this module to support another language.
import type { LanguageAdapter } from "../types.ts";

function symbols(src: string) {
  const lines = src.split("\n");
  const out: Array<{ name: string; kind: string; line: number }> = [];
  const hasClass = /\bclass\s+\w/.test(src);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const top = /^export\s+(?:default\s+)?(?:async\s+)?(function|const|let|class|interface|type|enum)\s+([A-Za-z0-9_]+)/.exec(l.trim());
    if (top) { out.push({ name: top[2], kind: top[1], line: i + 1 }); continue; }
    if (hasClass) {
      const meth = /^  (?:public |private |protected |static |async |get |set )*([A-Za-z_]\w*)\s*\([^)]*\)\s*[:{]/.exec(l);
      if (meth && !/^(if|for|while|switch|catch|return|constructor)$/.test(meth[1]))
        out.push({ name: meth[1] + "()", kind: "method", line: i + 1 });
    }
  }
  return out;
}

function imports(src: string) {
  const specs: string[] = [];
  const re = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) specs.push(m[1] ?? m[2]);
  return specs;
}

function cleanComment(raw: string[]): string {
  const c = raw
    .map((l) => l.replace(/^\s*\/\*\*?/, "").replace(/\*\/\s*$/, "").replace(/^\s*\*\s?/, "").replace(/^\s*\/\/\s?/, ""))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return /^[\s\-─=*]+$/.test(c) ? "" : c;
}

function docAbove(lines: string[], lineNo: number): string {
  const i = lineNo - 2;
  if (i < 0) return "";
  const t = lines[i].trim();
  if (t.endsWith("*/")) { const b: string[] = []; let j = i; while (j >= 0 && !lines[j].includes("/*")) { b.unshift(lines[j]); j--; } if (j >= 0) b.unshift(lines[j]); return cleanComment(b); }
  if (t.startsWith("//")) { const b: string[] = []; let j = i; while (j >= 0 && lines[j].trim().startsWith("//")) { b.unshift(lines[j]); j--; } return cleanComment(b); }
  return "";
}

function fileDoc(lines: string[]): string {
  let i = 0;
  if (lines[0]?.startsWith("#!")) i = 1;
  while (i < lines.length && !lines[i].trim()) i++;
  const t = lines[i]?.trim() || "";
  if (t.startsWith("/*")) { const b: string[] = []; let j = i; while (j < lines.length && !lines[j].includes("*/")) { b.push(lines[j]); j++; } if (j < lines.length) b.push(lines[j]); return cleanComment(b); }
  if (t.startsWith("//")) { const b: string[] = []; let j = i; while (j < lines.length && lines[j].trim().startsWith("//")) { b.push(lines[j]); j++; } return cleanComment(b); }
  return "";
}

export const typescript: LanguageAdapter = { exts: ["ts"], symbols, imports, docAbove, fileDoc };
