// python.ts — language adapter: how to read Python symbols, imports, docblocks.
// Regex-based like the TypeScript adapter — enough to graph module-level defs,
// classes, constants, and methods so `boundary "<inv>" at <symbol>` claims can
// resolve, and to surface docstrings/# comments as prose.
import type { LanguageAdapter } from "../types.ts";

function symbols(src: string) {
  const lines = src.split("\n");
  const out: Array<{ name: string; kind: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(l);
    if (m) { out.push({ name: m[1], kind: "function", line: i + 1 }); continue; }
    m = /^class\s+([A-Za-z_]\w*)/.exec(l);
    if (m) { out.push({ name: m[1], kind: "class", line: i + 1 }); continue; }
    // methods: def indented one level under a class
    m = /^    (?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(l);
    if (m) { out.push({ name: m[1] + "()", kind: "method", line: i + 1 }); continue; }
    // module-level bindings: CONSTANTS and annotated/plain top-level assignments
    m = /^([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*/.exec(l);
    if (m && !/^(if|for|while|with|try|else|elif|import|from|return)\b/.test(m[1]))
      out.push({ name: m[1], kind: "const", line: i + 1 });
  }
  return out;
}

function imports(src: string) {
  const specs: string[] = [];
  const re = /^(?:from\s+(\S+)\s+import|import\s+([A-Za-z_][\w.]*))/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) specs.push(m[1] ?? m[2]);
  return specs;
}

function cleanHash(raw: string[]): string {
  const c = raw.map((l) => l.replace(/^\s*#\s?/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return /^[\s\-─=*]+$/.test(c) ? "" : c;
}

/** Python prose lives in TWO places: `#` blocks above a symbol, and the docstring
 *  on the line(s) BELOW a def/class. Prefer the docstring when present. */
function docAbove(lines: string[], lineNo: number): string {
  // docstring below: first non-blank line after the def opens """ or '''
  let j = lineNo; // lineNo is 1-based; lines[lineNo] is the line AFTER the symbol
  while (j < lines.length && !lines[j].trim()) j++;
  const t = lines[j]?.trim() ?? "";
  const q = t.startsWith('"""') ? '"""' : t.startsWith("'''") ? "'''" : null;
  if (q) {
    const body: string[] = [];
    let s = t.slice(3);
    if (s.endsWith(q) && s.length >= 3) return s.slice(0, -3).trim();
    body.push(s);
    for (let k = j + 1; k < lines.length; k++) {
      const idx = lines[k].indexOf(q);
      if (idx >= 0) { body.push(lines[k].slice(0, idx)); return body.join("\n").trim(); }
      body.push(lines[k]);
    }
  }
  // fall back to a `#` block immediately above
  const i = lineNo - 2;
  if (i < 0) return "";
  if (lines[i].trim().startsWith("#")) {
    const b: string[] = []; let k = i;
    while (k >= 0 && lines[k].trim().startsWith("#")) { b.unshift(lines[k]); k--; }
    return cleanHash(b);
  }
  return "";
}

function fileDoc(lines: string[]): string {
  let i = 0;
  if (lines[0]?.startsWith("#!")) i = 1;
  while (i < lines.length && (!lines[i].trim() || /^#.*coding[:=]/.test(lines[i]))) i++;
  const t = lines[i]?.trim() ?? "";
  const q = t.startsWith('"""') ? '"""' : t.startsWith("'''") ? "'''" : null;
  if (q) {
    let s = t.slice(3);
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
}

export const python: LanguageAdapter = { exts: ["py"], symbols, imports, docAbove, fileDoc };
