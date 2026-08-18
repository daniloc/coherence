// hook-text.ts — the project's declared voice at each lifecycle crossing.
//
// The canonical hook text is the HARNESS's voice: identical in every adopting project,
// asserted byte-wise by tests, printed verbatim by `coherence hooks`. But a project has
// things only it can say — a build convention, a deploy hazard, a house rule about who
// touches migrations — and the moment an agent starts is exactly when that voice must be
// heard. This module is the customization surface: per lifecycle event, a project may
// keep `.coherence/hooks/<Event>.override.md` (replaces the canonical emission wholly)
// and/or `.coherence/hooks/<Event>.append.md` (follows whatever the base is).
//
// ONE COMPOSITION RULE, and both files coexisting is not a conflict, because they answer
// different questions: the override decides WHAT THE BASE IS (project text instead of the
// harness's, including an empty override that silences the event entirely); the append
// decides WHAT FOLLOWS IT. Override-with-append is therefore an ordinary, meaningful
// state — the project's base, then the project's addendum.
//
// DAMAGE DEGRADES TO CANON HERE, LOUDLY ELSEWHERE. This code runs inside every agent
// session of every adopting project; a torn customization file (unreadable, a directory
// squatting on the path) must cost exactly the customization, never the session. So
// `readHookText` never throws — it records the problem and leaves the slot null, and the
// caller falls back to the canonical emission. The loud surface for that damage is
// `coherence hooks review`, which exists to be read by a human with time to fix things.
//
// Tokens are honest: `{{session}}`, `{{agent}}`, `{{cli}}`, `{{scope}}` substitute only
// when a value was actually supplied. An unsupplied token stays literal, so the reader
// can SEE it was never substituted instead of getting a silently empty hole.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type LifecycleHookEvent } from "./control.ts";
import type { Config } from "./types.ts";

export const HOOK_TEXT_DIR = join(".coherence", "hooks");

export interface HookTextFile { path: string; text: string }

export interface HookTextCustomization {
  event: LifecycleHookEvent;
  override: HookTextFile | null;
  append: HookTextFile | null;
  problems: string[];
}

export interface HookTextTokens { session?: string; agent?: string; cli?: string; scope?: string }

export function hookTextPaths(cfg: Config, event: LifecycleHookEvent): { override: string; append: string } {
  return {
    override: join(cfg.root, HOOK_TEXT_DIR, `${event}.override.md`),
    append: join(cfg.root, HOOK_TEXT_DIR, `${event}.append.md`),
  };
}

/** Absent is null; readable is trimmed text (a whitespace-only file is the meaningful
 *  "empty override silences the event" state); unreadable is null PLUS a named problem. */
function readSlot(path: string, problems: string[]): HookTextFile | null {
  if (!existsSync(path)) return null;
  try {
    return { path, text: readFileSync(path, "utf8").trim() };
  } catch (error) {
    problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function readHookText(cfg: Config, event: LifecycleHookEvent): HookTextCustomization {
  const paths = hookTextPaths(cfg, event);
  const problems: string[] = [];
  return {
    event,
    override: readSlot(paths.override, problems),
    append: readSlot(paths.append, problems),
    problems,
  };
}

/** One pass; only the four known tokens, only when supplied. Any other `{{...}}` text is
 *  the project's own to keep — this is a substitution, not a template language. */
export function substituteHookTokens(text: string, tokens: HookTextTokens): string {
  return text.replace(/\{\{(session|agent|cli|scope)\}\}/g, (whole, key: string) => {
    const value = tokens[key as keyof HookTextTokens];
    return typeof value === "string" ? value : whole;
  });
}

/** Override replaces the canonical base wholly (dynamic parts included — a project that
 *  overrides owns the whole emission); the append follows whatever the base turned out
 *  to be. An empty base with no append composes to "" and the caller emits nothing. */
export function composeHookText(canonical: string, custom: HookTextCustomization, tokens: HookTextTokens): string {
  const base = custom.override !== null ? substituteHookTokens(custom.override.text, tokens) : canonical;
  const app = custom.append !== null ? substituteHookTokens(custom.append.text, tokens) : "";
  return app ? (base ? base + "\n\n" + app : app) : base;
}
