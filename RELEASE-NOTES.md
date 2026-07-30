# Release notes

Newest first. v0.10.1 through v0.12.0 shipped on 2026-07-28 in one burst, on top of
v0.9.0 (2026-07-11); v0.13.0 through v0.16.0 followed on 2026-07-29, and v0.17.0 on
2026-07-30.

The whole run has a single theme. Coherence gates a build on claims a project
writes about itself, and every release here is a consequence of one uncomfortable
question: **what happens when the claim being enforced is wrong?** A harness that
prevents drift and a harness that cements a bug are the same machine viewed from
two sides. 0.10.x gives a project the vocabulary to say which one it is looking
at; 0.11.x builds the record of what agents decided and why; 0.12.0 protects the
evidence inside that record.

---

## v0.17.0 — the twenty-minute full tier is retired, not made optional

This release **removes a default**. Until now `verify`'s executable tier shelled
`config.test` once per claim — `vitest run -t "<name>"` — and every one of those invocations
booted the consuming project's entire test pool to execute milliseconds of assertions. Two
repos, measured:

- a workerd/vitest pool at 15–30s per boot × ~70 executable claims = **20–35 minutes**, for a
  suite that runs end-to-end in **under two**;
- a second project: one targeted oracle run took **4.51s** and reported
  `7 passed | 291 skipped` — it paid the import and transform cost of **298 tests in order to
  run 7**. × 17 claims ≈ 77s, ~60s of it fixed overhead, **on top of** an outer `check.mjs`
  that had already run the whole suite for its own reasons. Their full tier: **8 minutes**.

Nothing in those numbers is about test count. The full tier paid one suite's import cost
**eighteen times**, and that project paid it a nineteenth time before coherence even started.

The first cut of this shipped as an opt-in `testBatch` key, faithful to the harness's own
"no behaviour change unless configured" discipline. That was wrong, and the second
measurement is why: **the projects that most need the fast path are the least likely to have
found the knob.** That repo was re-deriving evidence it already had, eighteen times, and
nobody noticed because the slow profile never announces itself. An additive fix is right for
a feature and wrong for a defect.

So batching is now **the default**, and it needs no configuration at all: if `config.test`
names vitest, coherence **derives** the whole-suite command itself.

### The four modes, and a refusal

| Mode | How you get it | What happens |
| --- | --- | --- |
| `--from-report <file>` | the flag | resolves from a report you already have — runs **no tests** |
| serial | `--serial-oracles` / `"oracleExecution": "serial"` | one full pool boot **per claim** |
| batch (configured) | `config.testBatch` | your command, once |
| batch (derived) | **nothing — the default** | synthesized from `config.test` |

Unrecognized runner, no `testBatch`, no report, no explicit serial → the full tier **fails
loud**, listing all three ways out. It will not quietly buy you N pool boots. A consumer has
to **type the name of the expensive profile** to get it, and when serial does run — by request
or as the batch-crash fallback — it states its cost every single time and names the config
that retires it.

### The third state is the other half of the point

Speed is what you notice. What matters as much is that a report distinguishes something an
exit code cannot. `vitest -t` exits **0** when its filter matched nothing — so under the old
path a renamed or deleted oracle read as a **pass**, and the only thing between that and a
laundered green was `config.testMatch`, a regex the project had to know to hand-configure over
the runner's *output*.

| | serial | batch |
| --- | --- | --- |
| test ran, passed | green | green |
| test ran, failed | red | red, naming the failing test |
| **test does not exist** | *green* unless `testMatch` is set | **red — `VANISHED ORACLE`** |

Under batch mode absence is directly observable, and zero matching tests is its own verdict
that says so in those words. **`testMatch` has nothing left to do for a batched claim** — the
same move as an unknown claim kind or a typo'd verb, where the failure mode is *eliminated*
rather than covered by a knob whose absence is silent.

Chasing that turned up something worse, on Node 25.2.1: for `node --test`, `testMatch` does
not work **at all**. A `--test-name-pattern` matching nothing still reports the *file* as one
passing test and exits 0, satisfying any "N passed" regex — and because node stops parsing its
own options at the first positional, a `config.test` of
`["node","--test","<glob>","--test-name-pattern"]` hands the filter to the *script*, where it
is silently ignored and the whole suite runs and passes. Every claim in such a project has
been green for free. That is now written down in the README, and it is the strongest argument
for the batch path there is.

### Mirroring `-t`, verified rather than assumed

Batching is only allowed to exist because it reproduces the per-claim verdicts exactly, so the
semantics were checked against the real binary before any of it was written. `-t` is an
**unanchored regex** over the report's `fullName` — the reporter's own
`ancestorTitles.join(" ")` plus the title — and the serial path always regex-**escapes** the
name first. An escaped pattern matched unanchored *is* a literal substring test, so that is
what batch matching is. `-t "totality covers"` really does run
`write policy totality covers every op`, and a claim anchored to a `describe` title matches
every test beneath it; equality would have red-lined that entire common case. The same run
confirmed why escaping is load-bearing: unescaped, `-t "rejects unknown (a+b)"` matched
**zero** tests and still exited 0.

Green requires ≥1 matching test that **passed** and none that **failed**. Skipped tests are
neither evidence nor failure — deliberately, because that is what the runner concludes too,
and a batch stricter than the path it replaces would invent reds in repos that were honestly
green.

### Four things it refuses to do quietly

- **Attribution stays per claim.** The batch is shared *evidence*, never a shared verdict.
  Each claim fails alone, naming its own oracle and the test that failed. "The suite is red"
  would have been simpler and would have been a regression.
- **A crash falls back, out loud** — with the serial cost framing, because that is the one
  remaining route into the expensive profile that nobody typed. A **nonzero exit is not a
  crash**: a suite with a red test exits nonzero, and that is exactly the run whose report is
  worth reading. (Relatedly, `spawnSync`'s default 1 MiB `maxBuffer` is now 64 MiB — a vitest
  report embeds a stack trace per failure, so the *failing* run was the one whose report would
  have arrived truncated.)
- **A stale report is refused.** The report file must postdate the run that was meant to write
  it. Found while chasing a suspiciously fast smoke run: a runner that exits without writing,
  over a leftover report, resolves every claim from evidence about code that no longer exists
  — and looks perfectly healthy. Strictly worse than a crash, which at least falls back.
- **A typo'd `testBatchFormat` fails the run.** Falling back would produce a correct-looking
  green that took thirty minutes.

`--fast` never boots any of it: resolution is a lazy memoized thunk, like `typecheck`, so the
executable tier skips before asking and a `--fast` run cannot be refused either. Scoped runs
(`--staged`/`--since`) *do* batch the whole suite once and resolve only in-scope claims from it
— one boot is already cheaper than three scoped per-claim boots.

### What it does not fix

Batching stops you **repaying import overhead**. It does nothing for an oracle that is
genuinely slow: a convergence ensemble doing ~140s of real work costs ~140s whether it is
reached through one boot or seventeen. If the full tier is slow because the *tests* are slow,
this is not the lever.

**`node --test` cannot be batched yet** — it ships no JSON reporter (only `default`, `dot`,
`junit`, `lcov`, `spec`, `tap`), and its `--test-name-pattern` matches each individual test
name rather than a concatenated one, so a batch would need a second, unverified matching rule.
node:test projects are recognized and told so rather than guessed at.

### Upgrading

**A vitest project needs to do nothing** and gets batching automatically — but do one thing
deliberately the first time: run a full `verify` **before and after** upgrading. Identical
verdicts are the acceptance test. If the batch surfaces new reds, read them: a
`VANISHED ORACLE` is a claim that was green because nothing was checking it.

Keep `config.test` configured — it is what a failed batch falls back to. `testMatch` can stay
(it still guards the serial arm) but no longer carries the renamed-oracle guarantee on its own.

**Two cases must act:**

- **Any runner that is not vitest** (jest, node:test, a custom script) now **fails the full
  tier** until you choose a mode: set `config.testBatch`, pass `--from-report <file>`, or
  accept the old profile with `--serial-oracles` / `"oracleExecution": "serial"`. This is
  deliberate — it is the one change here that can break a green build, and it breaks it with
  instructions rather than with a twenty-minute wait.
- **CI that wants the old behaviour** should add `"oracleExecution": "serial"` explicitly.
  Nothing infers it any more.

---

## v0.16.0 — the journal stops drowning its own pull request

One file per session is right when the sessions are real. A consuming project produced
**~20 new `.jsonl` files in one day**, and twenty new files is not a diff anybody reads —
so the record became noise at exactly the moment it was supposed to be read.

The cause was **one line**: with no `--session` and no `COHERENCE_SESSION`,
`appendDecision` fell back to `newSessionId()`, a *random* id, so every hookless
`coherence decide` minted a fresh file. Randomness is correct for a hook-minted session,
where five agents genuinely are concurrent. It was never correct as a fallback, where the
caller is a person or a lone agent typing a shell line.

### A derived fallback: `<branch>-<agent>-<YYYY-MM-DD>`

Same branch, same agent, same UTC day now **appends to one file**. Hook-minted sessions
keep their random `s-<12 hex>`.

**The branch stays in the filename.** Distinct filenames are the whole reason two parallel
branches never conflict on the journal, and a tidier PR is not worth trading a merge
conflict for. Sanitising is injective — a digest of the raw name is appended whenever
flattening changes anything, so `feat/x` and `feat-x` cannot land on one file — and a name
that was already safe passes through untouched, so every id ever written still maps where
it did. It also closes a hole that predated it: `--session` went straight into a path.

The residual collision — two agents both defaulting to agent `main` on one branch — is safe
four ways over, the strongest being structural: same branch means same checkout, and git
refuses to check one branch out in two worktrees, so genuinely concurrent agents have
different branches *by construction*.

### `coherence decisions --compact` — and the test that it changes nothing

What the derived id prevents going forward, this folds after the fact: one file per
**(branch, month)**. It coexists with append-only because **it only folds files whose blobs
are already committed** — the originals stay in git history, where `git log -- <path>` and
`git show <commit>:<path>` recover any individual session, so the working tree is tidied and
the record is untouched.

- A tracked journal file that differs from HEAD is a **refusal**; nothing is folded.
- A file git has never seen is **skipped** — that would be a deletion. Checked with
  `git ls-tree HEAD` rather than `git status`, which says nothing about *ignored* files.
- A file written in the last **two hours** is skipped: the window must exceed one agent's
  worst intra-session append gap (14.1 min measured here) and stay well under a day, or it
  would refuse the very case it exists for.

**The acceptance test is that the render does not move** — `coherence decisions` before and
after, character for character. Two properties make that checkable: lines are copied byte
for byte, never re-serialised; and `readJournal`'s sort became **total** over
`(at, id, session)`, so the render is a function of the *set* of records rather than of the
file layout. A file with an unreadable line is left alone, because dropping that line would
quietly lower the render's `N unreadable line(s)` warning.

Dogfooded on this repo's own journal: **15 files → 5**, nine render shapes byte-identical,
78 records and 15 sessions preserved. Watched to fail, too: disabling the unreadable-line
guard turns the identity test red on exactly the missing `WARNING:` line — and the first
negative control (reversing the concatenation order) leaves it *green*, which is correct and
is why the ordering property carries its own assertion against file content.

---

## v0.15.0 — the harness takes its own advice

`coherence redundancy` had been printing the same finding on every run since it
shipped: `src/cli.ts` spelled the command list twice — once as the pipe-separated
alternation literal in the usage banner, once as the `cmd === "…"` dispatch chain —
with *nothing keeping the spellings equal*. 31 shared tokens, score 31.30, and the
verdict "the two spellings ALREADY disagree", because the dispatch accepted
`resolve` and the banner had never heard of it.

It was right, and the cost was measurable. The banner produced v0.14.0's **only
merge conflict** — two branches hand-editing the same line. Banner vs dispatch
measured 29 vs 30. And README's `## Commands` reference, a *third* spelling nobody
had counted, measured **20 vs 32**: twelve commands undocumented, including
`dismiss` listed while its six sibling journal verbs were not, so a reader found a
verb for retiring conjectures with nothing on the page explaining what a conjecture
is. A convention-tier rule the tool itself kept flagging.

### One declarative home, two derived spellings

`src/commands.ts` holds `COMMANDS` — an ordered `{ name, summary, usage?, group,
aliases? }` registry in the shape `CLAIM_FORMS` already established for the claim
grammar. From it:

- **the usage banner** is `.map`ped and joined. No command-name string literal
  survives in `cli.ts`'s help text, so there is no line left for two branches to
  conflict on, and the banner is now *complete* — it used to omit the details of
  eight commands it listed.
- **a third owned block in README.md**, fenced like CLAUDE.md's and spliced by the
  same `spliceBlock` (which now takes the fence as an argument — one splice
  implementation, two marker pairs, not two copies). `coherence docs` writes it;
  `coherence docs --check` fails on it when stale.

The registry lives in its own file rather than beside the dispatch for a blunt
reason: `cli.ts` **executes at import**, so a test cannot read it. A source of
truth its own oracle cannot import is not one.

### The totality oracle is the point

`test/commands.test.ts` parses `src/cli.ts` and pulls every `cmd === "<literal>"`
out of the **TypeScript AST**, then asserts set equality with the registry —
aliases counted on the dispatch side, so `resolve` is dispatched without being
advertised as a command of its own. A hand-written expected list was rejected: it
would be a fourth spelling of the same domain, drifting like the other three.

The AST rather than a regex, because a regex also matches `cmd === "x"` inside a
comment, and an oracle a code comment can fool is not one. And the scanner is
**checked before it is trusted** — the first test asserts it found a dispatch of
plausible size, because a scan that silently returned `[]` would compare two empty
sets, pass, and report perfect agreement with nothing. That is this harness's
signature defect and it does not get a free pass for living inside the harness.

### Index vs detail: completeness and depth are different debts

The generated block is an **index** — name, argument shape, one line, all 31 of
them. The reasoning stays authored below it under **In detail**, and is *not*
expected to cover every command. Completeness is what a derivation owes; depth is
what prose owes; the section that drifted three times was trying to be both.

Two smaller consequences of taking the advice seriously:

- the block is a **bullet list, not a table** — `redundancy` reads a markdown
  table's first column as an enumerated domain, so a generated table would have
  handed it a fresh README↔dispatch pair. A generated block the project's own
  detector still flags has fixed nothing.
- the block carries **no timestamp**, so its freshness gate is a byte-for-byte
  compare with *nothing* normalized away. Every normalization a gate needs is a
  hole in it.

**Measured, after:** `coherence redundancy` goes from 42 candidate pairs to 37 —
five removed, **zero added**. The banner/dispatch pair is gone from the pair set
entirely, not demoted below the reporting floor.

`docs --check` treats an absent README fence pair as *not owned*, not as stale:
`docs` runs in every consuming project, and a gate that fails on a file the project
never opted into is a gate that gets switched off wholesale. It is not silent about
it — `coherence docs` prints the marker pair to paste.

---

## v0.14.0 — the advisories get to ask

0.13.0 gave the journal a record for a suspicion. It then wired exactly one
generator. `coherence observed` wrote conjectures; `verify`, `redundancy`,
`novelty`, `drift`, `why-lint`, `conventions`, `atlas` and `contracts` wrote
zero — while every one of them already *forms* a suspicion and throws it away by
printing it. Redundancy's own words: *"the two spellings ALREADY disagree —
either the difference is intended (say so), or one side drifted."* That is a
conjecture with two candidates, scrolled past once per run forever.

### `--raise` — an advisory opens a question instead of printing one

    coherence redundancy --raise
    coherence verify --raise [--raise-cap N]

**The identity problem is the whole feature.** `observed` dedupes on a label the
caller supplies; an advisory has nobody to ask and must derive identity *from the
finding*. Too volatile and every run mints a new question; too coarse and two real
findings collapse, the second one silently. The rule: **the key is the finding's
SUBJECT** — for a redundancy pair, the pair of sites; for a never-red claim, the
node and the claim text. Excluded, deliberately: the score (redundancy's `df` is
global, so an unrelated file re-ranks every pair in the repo), the run count
(changes every run by construction, and it is the field that makes a finding feel
urgent), and the line number (navigation, never structure).

**Three volume layers, because a first run that opens two hundred questions kills
the mechanism on contact.** Opt-in — raising *writes*, and a surprising write gets
a feature switched off rather than tuned. The advisory's own reporting floor —
`redundancy --all` drops the score floor to expose the tail, and raising ignores
that (42 pairs shown on this repo, 7 eligible). And a per-run cap of 3 that names
what it withheld, per advisory.

Dogfooding refuted the first cap design immediately: strict priority order left
every warned-kind question queued behind twelve never-red ones, on the one project
whose config declares that kind the suspect one. The cap is now spent round-robin.

### `dismiss` — we decided not to ask

    coherence dismiss <id> --because "<why this is not worth chasing>"

The escape valve, and it has to be as cheap as `resolved` or the noisy question
stays and the whole `--open` list gets skipped. It is **not** a resolution: "we
answered this" and "we decided not to ask" are different facts, so a dismissal is
its own record kind, its own bucket, and its own section — *"Dismissed — NOT WORTH
CHASING (no answer was found; none was sought)"*. An append like everything else.
A dismissed finding is never raised again; a **retracted** one may be, because a
retraction claims the observation was never real and a detector that keeps
producing it is evidence against the retraction.

Precedence: retraction > resolution > dismissal.

---

## v0.13.0 — the abductive turn

Everything before this release answers a question somebody already asked. This one
is the first attempt at the other half: noticing that a question is owed.

### `conjecture` / `resolved` — what an agent WONDERED

The journal recorded `decide` (a choice made), `blocked` (could not determine) and
`retract`. Nothing recorded a suspicion.

    coherence conjecture "<the surprising observation>" \
      --could-be "<explanation>" --discriminated-by "<the test that separates them>"
    coherence resolved <id> --because "<what the test showed>" --as "<which won>"

Three properties do the work. **`[instrument] the instrument is wrong` is injected
as a candidate whether or not the author supplies it** — it is the highest-prior
explanation for a surprising measurement and the one people skip. **An unresolved
conjecture is loud**: its own section, its own count, capitalised, because a
question someone stopped asking must not look like one they answered. And
resolution is an append that crosses session files, so the agent who settles a
question need not be the one who raised it.

### `redundancy` — the parity claims nobody wrote

`parity … over <domain> between <fnA> and <fnB>` already existed, but it is
DECLARED: somebody had to already suspect two things should agree. This finds the
complement — one enumerated domain spelled in more than one place, with nothing
tying the spellings together — and ranks what it finds.

Against this repo: 147 domain sites, 41 overlapping pairs, 5 above the reporting
floor, 14 suppressed as compiler-enforced. It flagged the CLI usage banner and the
command dispatch chain as "identical today, tied together by nothing." An hour
later two feature branches both hand-edited that banner and produced the only merge
conflict of the release. The detector was right, on this repo, about this repo,
before it happened.

### `observed` — a moved metric that nobody explained becomes a question

    coherence observed "<label>" --value <n> --baseline <n> --threshold <n> [--why "…"]

Inside the band, silence. Outside with a `--why`, the explanation lands in the
journal instead of only in a source file. **Outside with no explanation, it opens a
conjecture** — so a harness that noticed something hands coherence a question rather
than printing to a terminal that scrolls away.

Deduped on LABEL, not on content: a metric that sits outside its band for ten runs
produces one open question, not ten. A metric drifting back inside its band does NOT
auto-resolve, because a number wandering back is not an explanation.

**The division of labour this settles:** the project owns what counts as notable —
that is domain knowledge, a physics `notableDelta` — and coherence owns what happens
when something notable goes unexplained.

### `.coherence/` is no longer gitignored

Found by dogfooding: this repo was ignoring the exact folder its own README tells
consumers to commit, so the decision journal it had just written about itself was one
clean checkout from gone. Now split — `verify-jobs.json` stays ignored because it is
genuinely a cache; `decisions/` and `status.json` are the record and are tracked.

356 tests.


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
