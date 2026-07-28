# Release notes

Newest first. Every release below shipped on 2026-07-28, in one burst, on top of
v0.9.0 (2026-07-11).

The whole run has a single theme. Coherence gates a build on claims a project
writes about itself, and every release here is a consequence of one uncomfortable
question: **what happens when the claim being enforced is wrong?** A harness that
prevents drift and a harness that cements a bug are the same machine viewed from
two sides. 0.10.x gives a project the vocabulary to say which one it is looking
at; 0.11.x builds the record of what agents decided and why; 0.12.0 protects the
evidence inside that record.

---

## A note on v0.10.0

**There is no v0.10.0, and there is no tag for it.** The version in
`package.json` went from `0.9.0` straight to `0.10.1` in a single commit
(`0002271`). No commit reachable from any ref has ever carried version `0.10.0`.

If you are looking for "the 0.10.0 features", they are in **v0.10.1** below — it
is the first release of the 0.10 line, not a patch on one. The 0.10.1 commit
message refers in passing to how things behaved "in 0.10.0"; treat that as a
reference to 0.9.0 behaviour.

---

## v0.12.0 — cap the labels, never the evidence

**Tag:** `v0.12.0` · **Commit:** `0e87378`

### What changed

**A soft length cap on decision titles, and nothing else.** Journal entries have
three text fields: `chose` (what you picked), `over` (what you rejected), and
`because` (why). A 250-character cap across all three was proposed. Rather than
guess, it was measured against a real 53-entry journal, and the answer turned out
to differ per field:

- `chose` and `over` are already short — median 149 and 94 characters, with only
  5 of 107 values over 250. The handful that run long are entries where an agent
  crammed its reasoning into the title, so a nudge genuinely helps.
- `because` is long by design — median 609 characters, and **all 53 entries**
  exceeded 250. Capping it would have deleted 16 of 23 `file:line` citations and
  22 of 33 measured numbers, because **the evidence in a rationale sits at the
  end, after the claim**. A uniform cap would have cut the journal roughly in
  half (46,397 → 26,784 characters) by removing the half that makes it worth
  keeping — turning entries you can check into entries you can only take on
  faith.

The result: a soft cap of 200 characters on `chose` and `over` only. It prints a
warning to stderr and **writes the entry anyway**. Nothing is ever truncated on
write. The reasoning is that a journal which can reject a write is a journal an
agent abandons mid-job, and the entry it gives up on is the one it was too busy
to reword — exactly the one worth having.

**`coherence decisions --brief`.** Readability is a display problem, so it is
solved at display time. `--brief` clips each rationale on a word boundary and
**announces how much it withheld**, because a shortened rationale that looks
complete is worse than no rationale at all.

**Internal:** the test helper `runCaptured` now captures stderr separately, so a
notice that belongs on stderr can be asserted without polluting piped report
output.

### Upgrading

Nothing to do. No configuration, no format change. Long titles now produce a
stderr warning that does not affect the exit code.

---

## v0.11.2 — the markdown digest nests its detail lines

**Tag:** `v0.11.2` · **Commit:** `3af2625`

A display fix. In the markdown digest, the `- over: ...` line was rendered at the
same indentation as the decision it belongs to, so it read as a *separate
decision*. On a 230-line digest that is the one misreading this format cannot
afford, since the entire point of `over` is that it qualifies something else.
Detail lines are now nested under their parent.

---

## v0.11.1 — `hooks --check`, because a dead hook is silent

**Tag:** `v0.11.1` · **Commit:** `357e306`

### The problem

The first real-world test of the hook path in v0.11.0 failed with no signal
whatsoever. The settings block was present and well-formed. Running
`coherence hook SubagentStart` by hand emitted correct JSON. And the subagent
received nothing at all. Some harnesses simply do not execute project hooks, and
a hook that is never invoked cannot report that fact about itself.

A mechanism that looks installed and quietly does nothing is precisely the class
of defect this tool exists to catch, so it needed catching here.

### What changed

`coherence hooks --check` distinguishes three states, because each needs a
different fix:

1. **Not configured** — no hook block in settings.
2. **Configured but never fired** — the dangerous one, previously invisible.
3. **Firing** — working normally.

The detection is structural rather than heuristic: only the hook itself calls
`openSession()`, so a journal that has entries but **zero hook-opened sessions**
proves every entry was logged by an agent that was told to by hand.

For the dead case, the output prints a throwaway `PostToolUse` experiment that
settles the question either way, and states plainly that the journal still works
without the hook — `decide` is an ordinary command you can always call directly.

---

## v0.11.0 — the decision journal

**Tag:** `v0.11.0` · **Commit:** `c6d4de3`

### The problem

Five subagents at 400k tokens each generate more context than anything can read.
The report each one hands back is written by the agent that did the work, so it
records what was **concluded** and never what was **considered and discarded**.
The raw transcript contains that information and is unreadable; the report is
readable and has thrown it away.

This release is the third option: each agent writes one line per decision *as it
makes it*, and whoever is coordinating reads the merged journal.

### What changed

Four new commands:

| Command | Purpose |
| --- | --- |
| `coherence decide` | Record a choice: what you chose, what you rejected, why |
| `coherence blocked` | Record what you could **not** do — first-class, not a footnote |
| `coherence retract` | Withdraw an earlier decision by appending, never by editing |
| `coherence decisions` | Read the merged timeline across agents, jobs and branches |

The unit of record is a **decision** — a point where the work could have gone
more than one way and someone picked. An earlier draft had seven event types
(`OBSERVED`, `INFERRED`, `ASSUMED`, and so on); that was the wrong granularity,
because most of those are noise at the scale where context is actually lost.

**Two fields carry the value.** `over` — what was rejected — is what stops the
next agent re-litigating a settled question. And **status**: a retraction is an
*append* that points at what replaced it, and it can cross session files, because
one agent withdrawing another agent's verdict is the single most valuable event
in a parallel fan-out. An empty `over` renders explicitly as "(nothing — forced,
or no alternative considered)", so that a forced choice and an unexamined one do
not look alike.

### How it is stored

**One append-only file per agent session**, with the session id minted by the
hook. Two branches merge cleanly because distinct filenames never collide — a
single shared JSONL file conflicts on every parallel branch, which is exactly the
situation several concurrent agents create. Attribution is structural: the file
*is* the session. `coherence decisions` merges every file into one timeline.

Concurrency was measured before any of it was built: `appendFileSync` with 8
concurrent writers × 300 lines, at sizes from 200 B to 64 KB, gave 2400/2400
lines intact, 0 torn, 0 missing. The same probe run against a
read-then-write-at-offset writer lost 1242 of 2400 — so the probe can detect loss
when loss exists, and the clean result is not a blind control. There is no lock,
deliberately: a lock is something several agents can deadlock on.

### Two design commitments worth knowing

**It is a CLI, not an MCP server.** An MCP tool's schema is loaded into the
context of every agent that might call it — paid on every turn, whether a
decision gets logged or not. A mechanism that spends context in order to save
context defeats itself.

**It gates nothing.** The stop hook reports and never blocks. The moment this can
fail a build, it acquires an incentive to be *complete* — and a complete journal
is just a transcript again.

### Upgrading

Purely additive. Run `coherence hooks` to print the settings block that mints
session ids automatically, then `coherence hooks --check` (v0.11.1+) to confirm
it actually fires.

---

## v0.10.2 — spec intent is the first paragraph, not the first line

**Tag:** `v0.10.2` · **Commit:** `2d2254d`

### What changed

Specs are hard-wrapped at 80 columns, and `parseSpec` read exactly one line — so
every component intent longer than one line was silently chopped mid-clause. That
fragment is what the generated CLAUDE.md component map, the outline, the panel
and the scene all display. Since CLAUDE.md is loaded into the system prompt of
every run, the truncation was permanently resident noise in every agent's
context.

Observed on a consumer project: an intent rendering as *"The player's half of the
program: the four priced verbs (`tools.ts`), the one"* — ending on "the one".

Intent is now read as the first **paragraph**. `intentLine` marks the last line
consumed, so the prose scan still begins after the intent rather than re-reading
its tail.

### Also in this range: the kinded-claim parse bug (`09b7c40`)

This is the most consequential fix of the 0.10 line, and it is easy to miss
because it shipped **under the 0.10.1 version number, after the v0.10.1 tag**.
If you are bisecting, it lives in `v0.10.1..v0.10.2`.

The first implementation of claim kinds stripped the trailing `[kind]` suffix
inside `evalClaim`. Verification graded correctly, so it looked right. But
`BOUNDARY_RE` is anchored with `$`, and **every other consumer reads the raw
claim string**. The consequence: `parseBoundary` returned `null` for every kinded
claim, silently emptying the generated CLAUDE.md invariant table, the promise
graph, the panel and the scene.

Concretely: `parseBoundary(claim)` parsed, while
`parseBoundary(claim + " [structural]")` returned null. On one consumer project,
`coherence graph` went from 5 stale boundary rows to 17 once fixed. Verification
stayed green the entire time — which is exactly why nobody noticed, since the one
gate that stripped the suffix was the one gate watching.

The strip now happens in `parseSpec`: `claims` holds the bare text and the kind
travels alongside in `claimKinds`. Every downstream consumer therefore sees the
same string it saw before kinds existed, **including the status record's
identity** — so annotating an existing claim with a kind does not orphan its
history.

That commit also added `Kind` and `Refuted?` columns to the generated CLAUDE.md
invariant table, appearing only when a project actually uses those features. And
`coherence scaffold` emits an empty `## refutations` section with the format in a
comment — a pre-filled TODO would score as covered, which is the exact deception
the section exists to remove.

---

## v0.10.1 — claim kinds, refutations, and sticky red history

**Tag:** `v0.10.1` · **Commit:** `0002271`
*(First release of the 0.10 line. See the note above: v0.10.0 never shipped.)*

### Why

A consumer project — a chaotic simulation — hit the seam in this tool's premise.
Coherence exists to prevent behavioural **drift**; but on a system whose current
behaviour is itself a guess, preventing drift and locking in a bug are the same
act seen from two sides. That project's own evidence: seven seeds pinned at
2.99–3.00% land with every gate green, and a test that convicted the code for
getting *better*.

Three additions answer that, **all off by default**. A project that configures
none of them parses and grades exactly as it did in 0.9.0.

### Claim kinds

A claim may carry a trailing `[kind]`, for example:

```
the tick length is exact and bounded at every rung [mathematical]
```

The project declares which kinds exist and what each one's policy is, in
`claimKinds`. Coherence holds no opinion about which kinds *should* exist.

- `pin` — gates as usual.
- `warn` — still gates, but is reported on every run together with the project's
  own stated reason, so a category the project distrusts cannot be used quietly.
- An **undeclared kind fails the run**, so that a typo cannot silently grade as
  an unkinded claim.

The suffix is stripped in exactly one place before form matching, so no claim
form's grammar changes.

### Refutations

A `## refutations` section records, per invariant, the experiment that actually
made it go red — you break the chokepoint, run the oracle, and write down what it
said.

Verification **reports the gap but cannot fail on it**. A refutation is something
you *did*, and the harness has no way to know whether you did it. The section
exists because a green claim and an unfalsifiable claim are indistinguishable
from the outside, and only one of them is evidence.

### Sticky red history

`everFailed` is set the first time a claim goes red and is **never cleared**,
alongside `lastFailAt`, `lastFailCommit`, and a `runs` counter that a skipped run
does not advance.

From this comes the **never-red advisory**: green on every run, never once red,
and no recorded refutation. That combination is equally the signature of a claim
that nothing can break.

Advisory lists are capped at 8 entries with the overflow **announced**. The first
cut printed 17 advisory lines per run against a real project, which is how an
advisory becomes wallpaper.

### Upgrading

Nothing is required. To adopt:

1. Declare your kinds and their policies in `claimKinds` in your config.
2. Add `[kind]` suffixes to claims as you touch them.
3. Add a `## refutations` section to a spec (`coherence scaffold` emits an empty
   one).
4. Commit `.coherence/status.json` — added in `b012a54`. Without it in the repo a
   fresh clone starts with no history, nothing has ever been red, and the
   never-red advisory stays silent forever. On a merge conflict, keep the higher
   `runs` and `everFailed: true` if either side has it; both fields only ratchet.

**Do not upgrade to `v0.10.1` exactly if you use kinded claims** — see the parse
bug under v0.10.2 above. Use `v0.10.2` or later.
