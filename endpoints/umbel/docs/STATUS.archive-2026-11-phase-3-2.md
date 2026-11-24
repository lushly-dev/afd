# Umbel status archive: phase 3, part 2 of 2

Moved verbatim from [STATUS.md](STATUS.md) on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)), which is the index and the
current record. A line here keeps the wording it had when it was moved and is not updated after:
a status recorded here may have changed since, though the detail of a phase still open (its
decisions, what its exit has not proven) still applies unless the index or the phase's
specification says otherwise. A link to `#heading` in a moved line named a heading of STATUS.md as
it stood then; the heading is in this file or, through "Headings in other files" at the end, in
another archive file, which the index lists under [Archive](STATUS.md#archive). A moved line is
never edited; a change of status goes in the index.

### Phase 3. Memory and context (continued)

- **Not done:** nothing in phase 3's plan. Open and recorded as follow-ups: the specification's
  [list](phases/3-memory-context/spec.md#follow-ups), including measuring whether labels, quoting or
  the scan protect a pushed record, the interactive CLI transcript re-check, and the step 10 question
  on a sharing writer changing another's shared record (answered 2026-11-04 by phase 5 decision 10, D119). There is no AFD step 0: the journal's
  `with_redact` already exists.
- **Next:** the phase 4 (curator) specification, which phase 3's exit unblocks, then the phase 5
  and phase 6 specifications. Each gets an independent review, a revision and the owner's approval
  (D24). Heavy steps follow the plan's build note.
- **Waiting on the owner:** nothing. These four are decided; do not ask again.
- **Follow-ups:** the [specification's list](phases/3-memory-context/spec.md#follow-ups).

#### Handoff, 2026-11-02: resume here

The session driving this epic ended here because its account ran out of capacity. The
epic is every phase in the table above, then further first-class plugins.

**Immediate work (done: the follow-up merged in [#723](https://github.com/lushly-dev/afd/pull/723) as `a92c5bd7`, and step 1 in [#729](https://github.com/lushly-dev/afd/pull/729)): merge the follow-up to [#685](https://github.com/lushly-dev/afd/pull/685)** on green.
#685 merged on 2026-11-02 as `e4c91f30`, from `3c30f48f`, before the four items decided after the key
design's review were written in. The follow-up writes them into the specification's body, tests, plan
and the decision log as D86 to D89. Item 1's design, the remember prompt, reuses the CLI's existing
prompt and the host-owned `dev.umbel/human-confirmed` mark, adds no new trust assumption, and stays
"not an attestation", so no third review was run.

**Then, in order:**

| Work | Notes |
| --- | --- |
| Phase 3 implementation | Done 2026-11-03: plan steps 1 to 10, the last in the step 10 pull request; exit criterion met |
| Phase 4, curator | **Done 2026-11-03: exit criterion met**, steps 1 to 7, the last in the step 7 pull request (see Phase 4 below). Before that: **specification approved 2026-11-03** ([spec](phases/4-curator/spec.md)) and merged in [#749](https://github.com/lushly-dev/afd/pull/749), with the owner's answers to its ten questions (attest and verify on 10); steps 1 (shapes), 2 (host), 3a (knowledge: record and journal), 3b (knowledge: the drafted path), 3c (knowledge: verifying drafts) and 4 (curator: candidates) merged 2026-11-03 in [#751](https://github.com/lushly-dev/afd/pull/751), [#753](https://github.com/lushly-dev/afd/pull/753), [#754](https://github.com/lushly-dev/afd/pull/754), [#763](https://github.com/lushly-dev/afd/pull/763), [#765](https://github.com/lushly-dev/afd/pull/765) and [#767](https://github.com/lushly-dev/afd/pull/767); step 5 (curator: runs) and step 6 (auto-approval) merged 2026-11-03 in [#768](https://github.com/lushly-dev/afd/pull/768) and [#770](https://github.com/lushly-dev/afd/pull/770) |
| Phase 5, auth and hosted | **Specification approved 2026-11-04** ([spec](phases/5-auth-hosted/spec.md)) with the owner's answers to its seventeen questions, after an independent review and a revision; **step 0a done 2026-11-07** (the AFD spec); **step 0b done 2026-11-07** (AFD's Rust `server-auth`); **step 0c done 2026-11-07** ([#532](https://github.com/lushly-dev/afd/issues/532) in three languages); **step 0d done 2026-11-07** (AFD's Rust relay); **step 0e done 2026-11-07** (AFD's Rust tasks; the AFD prerequisites 0a to 0e are complete); **steps 1 and 1b next**. Before that: **Next:** its specification, with an independent review, a revision and the owner's answers (D24); the D86 to D89 follow-up it waited on merged in [#723](https://github.com/lushly-dev/afd/pull/723). Includes `memory-erase`, [#532](https://github.com/lushly-dev/afd/issues/532), partitioned BM25 statistics, token verification, `credentials`, Tasks, the dynamic confirmation prompt, real proof of a person, and the Rust MCP approval relay with Umbel's use of it (phase 4's owner decision 2, D99) |
| Phase 6, backends | **Next**, beside phase 5: its specification, with an independent review, a revision and the owner's answers (D24) |
| Phase 7, distribution and guides | Needs phases 5 and 6 (phase 4 done 2026-11-03) |
| Further first-class plugins | content-design; federation needs O1 from the owner |

**Rules the owner set for this epic:** commit, open pull requests, auto-fix and merge on
green between phases without asking. Each phase specification gets an independent review,
then a revision, then merge, recorded here as approved under the owner's 2026-10-31
delegation. **Still ask the owner about:** publishing, tagging, unquarantining or merging a
release pull request; O1; anything that changes the trust model. Do not name the private
reference system in code or documents; all knowledge content is deployer-provided. Run
`pnpm verify` before the first push; never `--no-verify` or `--admin`.

**Shared Mac:** heavy gates only under one-minute load 20, `cargo -j4`, Vitest 1 worker; stop
under 5 GB free. Give each concurrent Rust agent its own `CARGO_TARGET_DIR`
(`~/.cache/umbel-target-<step>`, deleted after merge) with `CARGO_INCREMENTAL=0`, and export
it for `pnpm verify` too. Never stop other owners' jobs, or clear their build output.

**Known traps:** commitlint has no `umbel` scope and rejects `wip`. The local branch
`lush/umbel-phase-3-memory-spec` is held at an old commit by worktree `t3-08b48631`, so work
on another local branch and push to that remote name.
