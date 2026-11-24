# Umbel status archive: phase 4, part 2 of 2

Moved verbatim from [STATUS.md](STATUS.md) on 2026-11-23 ([#1803](https://github.com/lushly-dev/afd/issues/1803)), which is the index and the
current record. A line here keeps the wording it had when it was moved and is not updated after:
a status recorded here may have changed since, though the detail of a phase still open (its
decisions, what its exit has not proven) still applies unless the index or the phase's
specification says otherwise. A link to `#heading` in a moved line named a heading of STATUS.md as
it stood then; the heading is in this file or, through "Headings in other files" at the end, in
another archive file, which the index lists under [Archive](STATUS.md#archive). A moved line is
never edited; a change of status goes in the index.

### Phase 4. Curator (continued)

- **Step 6 done (2026-11-03, merged in [#770](https://github.com/lushly-dev/afd/pull/770) as `6e1c0a0a`, from `9ea18e73`), auto-approval:**
  - `knowledge-auto-approve { space?, limit? }` (section 8.3, owner decision 1, D98), in the new
    `plugins/knowledge/src/proposal/auto.rs`: command line only, `store-write` and `workspace-write`, digest-journaled
    keeping `space` and `limit`, no AFD approval, and a plain `confirm_prompt` that a person answers at a terminal and
    `--yes` answers from cron (the stricter option the text allows; `require-human` would contradict a rule that
    applies "without a person"). Refused with `PROPOSAL_AUTO_NOT_ALLOWED` for any pipeline step the host attests, the
    curator's included, and for a caller that is not a person; the caller must be one of the area's approvers.
  - **`deprecate-declared`, off by default:** an area opts in with `auto = ["deprecate-declared"]` (default `[]`); the
    configuration schema and the area reader refuse any other value, and what is never applied is code. It applies a
    version 2 `deprecate` drafted by a still-listed drafter, scheduled, citing no memory, unflagged and not an
    alternative, when its area still governs the document, the document and its file are at the draft's `baseHash`,
    the frontmatter's `superseded_by` is the draft's `supersededBy`, **the document's one `derivedFrom` names an applied
    `create` or `update` of this instance, decided by a person, whose content and result are exactly those bytes and
    whose diff adds the declaring line**, and the successor resolves, is not deprecated and is readable by every reader
    of the target. So a declaration typed into a file, carried through a later edit or verification, or claimed by a
    forged envelope never triggers it.
  - **Recorded as the policy's decision:** `decision.by = { kind: "service", id: "policy:<area>" }`, `principal` the
    caller's, `channel = "policy"`, `policy.rule = "auto:deprecate-declared"` with a version covering the area's `auto`
    list, through approve's own compare-and-set steps (`apply::apply_by_policy`; `apply` takes a `Decider`). A stopped
    policy apply resumes only when the rule holds again in full; a person's stopped approval is left to the person.
  - Eleven [amendments](phases/4-curator/spec.md#amendments-from-step-6), none changing the trust model; the seventh
    closes two cases the text's predicate let through (a typed declaration followed by a person's verification, or
    carried as context through a person's edit). 11.3's `PROPOSAL_AUTO_NOT_ALLOWED` also covers a caller that is not a
    person.
  - **No host `src/`, `wit/`, `schemas/` or SDK file changed**, and no script or workflow: only the knowledge plugin
    (its manifest, configuration and input schemas, the proposal code), its tests, its skill and the README, and one
    `umbel-first-party` test. So no `Plugin-isolation-exempt:` line is needed.
  - Tests: `plugins/knowledge/tests/auto_approve.rs` (20) and 2 unit tests in `auto.rs`; `journal_modes.rs` adds the
    command to the digest set; the stand-in drafters gain a `<id>-auto` pipeline, and `tests/support/records.rs` an
    `overwrite`. `first-party/tests/curator_run.rs` (6, one new): the real curator's deprecate draft applied by the
    rule after a person declared the successor, and read back by the next run.
  - Verified 2026-11-03 on the owner's Mac: `cargo fmt --all --check`; the knowledge job's clippy (`-p umbel-store -p
    umbel-store-embedded -p umbel-okf -p umbel-scan -p umbel-plugin-sources-filesystem -p umbel-plugin-knowledge
    --all-targets -- -D warnings`) and `cargo test` (554 tests in 65 suites, `eval_gate` with the baseline untouched);
    `-p umbel-plugin-knowledge --no-default-features` clippy and tests (245 in 28); the `memory` job's clippy (`-p
    umbel-plugin-memory -p umbel-plugin-context -p umbel-plugin-curator -p umbel-first-party -p umbel-hook`) and `cargo
    test -p umbel-first-party` (20 in 9). Not run here: the curator's own tests (the crate is unchanged), the MSRV 1.97
    check (the toolchain is not installed), the tooling tests (no script or workflow changed) and the full gate, which
    is the owner's.
- **Step 7 done (2026-11-03, in the step 7 pull request, from `6e1c0a0a`), the binary and the exit:**
  - **`umbel-first-party` links the curator** (`first-party/Cargo.toml`, `src/main.rs`), so the binary has all five
    first-party plugins: `sources`, `knowledge`, `memory`, `context` and `curator`. The curator moved from a
    dev-dependency to a dependency; `Cargo.lock` is unchanged. The tests' `support::with_plugins` gains it too, so
    library actors see what the binary links.
  - **`first-party/tests/exit_curator.rs`** (1 test, about 4 seconds in a debug build) runs the exit criterion of
    [section 13](phases/4-curator/spec.md#13-exit-criterion-and-tests) through the real binary as a child process,
    on the `testkit` build's frozen clock and person at a terminal, with `sources`, `knowledge`, `memory` and
    `curator` in a space `alpha` (a `notes` collection, an area, the curator in `drafters` with the target
    `notes/learned`). The command line is `human:local`; `human:ada`'s memory is written and forgotten through the
    binary too, with `principal.local_id` switched for her calls. It writes a report of each point's numbers to
    `UMBEL_CURATOR_EXIT_REPORT`, which the `memory` job sets and uploads beside phase 3's in
    `memory-exit-report-<os>`.
  - **`first-party/tests/curator_leaks.rs`** (1 test, about 2 seconds): a differential probe of every curator surface
    and the knowledge plugin's proposal surfaces, on two workspaces that differ only in what bo cannot read; bo's 32
    answers are equal in both, none holds any of ada's 16 hidden ids, hashes, run ids or her lock's trace, and every
    curator record carries section 2.3's access set. Checked once by hand: planting one of ada's records in bo's
    readers made it fail at its first answer.
  - The test support gains `Bin::output`, `Bin::at_terminal` (stderr, where the preview and the prompts go),
    `Bin::configure`, the MCP client's `tool_names` and `call_raw`, and `Ws::with_config`.
  - **Host: no change**, and no plugin, schema, SDK or adapter change: the exit and the probes found no defect. No
    `Plugin-isolation-exempt:` line is needed.
  - CI: the `memory` job's test step sets `UMBEL_CURATOR_EXIT_REPORT` and its upload step takes both reports. The
    README gains "Run the curator": a working `umbel.toml` (checked with the built binary's `workspace doctor`,
    `curator-run` and `knowledge-auto-approve --yes`), the commands, and a cron example that runs `curator-run` and,
    only for an area listing `deprecate-declared`, `knowledge-auto-approve --yes`.
  - Eleven details settled in the specification's
    [Amendments from step 7](phases/4-curator/spec.md#amendments-from-step-7), none changing the trust model; the
    eleventh is the question for the owner below.
- **Exit criterion** (2026-11-03, the step 7 branch from `main` at `6e1c0a0a`, in `endpoints/umbel` with its own
  `CARGO_TARGET_DIR`, debug build, on the owner's Mac). Each point, from the report:
  1. **A scheduled draft.** Ada's fact (authority `person`, shared with the space, one constraint, canaries in its
     subject, text, tag and constraint, observed in 2 sessions) is `settling` on day 3 and `ready` on day 8, when
     `curator-run` drafts 1 version 2 proposal at `notes/learned/c-<20 hex>`. Its `drafter` names the plugin and
     instance `curator`, the pipeline `curator-run` and the run's own trace id; its 1 memory evidence entry's
     principal, authority, origin, constraints, access and content hash equal `memory-show`'s; `derivedFrom` names
     the record. The curator's own rendering, replayed beside the binary, returns the stored draft (`created:
     false`); with `authority` changed it is `PROPOSAL_DRAFT_MISMATCH`, check `copied-authority`, and nothing is
     stored. No canary is in the run's stdout (867 bytes), the journal, the log or the events.
  2. **Approved from the command line.** `knowledge-approve` at the terminal showed 38 preview lines (the id, the
     drafter, "verified against memory", the diff) before its prompt; the approver `human:local` is neither the
     source's principal (`human:ada`) nor a promoter, so `exception: null`, `decision.channel = "terminal"`.
  3. **Lands with full provenance.** The file is the curator's rendering byte for byte, with `Holds only`; the
     document is `agent-inferred`, `generated.by = "umbel:curator/curator"`, `generated.at` the candidate's
     `settledAt` (`2026-11-10T12:00:00.000Z`), `derivedFrom` the proposal, before and after `knowledge-refresh`;
     `knowledge-search` finds it (1 hit); the next run reads the apply back (`applied` 1) and the candidate is
     `applied` with `promotedTo` the document; events exist for `knowledge-propose-batch` and `knowledge-approve`;
     a further run drafts 0.
  4. **Promotion and self-approval.** The caller's private fact is `needs-promotion` while ada's two shared facts are
     drafted (a run of 2); after `curator-promote` at the terminal the next run drafts it, `mode = "promoted"`,
     `promotedBy = "human:local"`. Approving it is `PROPOSAL_SELF_APPROVAL` until the area sets
     `allow_self_approval`, then `exception: "self-approval"`.
  5. **Feedback.** A draft rejected at the terminal is read back (`rejected` 1), `quietUntil` 90 days on
     (`2027-02-18T12:00:00.000Z`), and a run on day 77 drafts 0.
  6. **Forgotten evidence.** After ada's `memory-forget` the next run withdraws 1 draft and redacts it
     (`source-erased`), checkpoint `clean`; its id and its path `notes/learned/c-<20 hex>` are unchanged. Its 4
     canaries and its source's hash are in none of `store.sqlite3`, its log and shared memory, the journal, log and
     events, the curator records, the run's stdout, or any other file of the workspace (0 files).
  7. **Not in the request path.** Over the binary's stdio MCP server, none of the 6 curator commands and pipeline and
     the 5 command-line-only proposal commands of the knowledge plugin is in `tools/list` (10 tools) or `afd-discover`
     (40 commands), and `afd-call`, `tools/call`, `afd-batch` and `afd-pipe` run none; no proposal changed state and
     the run records stayed at 8.
  - **Leak probes** (section 12's "hidden counts" and "private memory disclosed" rows): `curator_leaks.rs` passes, as
    above.
  - **Local checks:** `cargo fmt --all --check`; `cargo clippy --locked -j4 -p umbel-plugin-memory -p
    umbel-plugin-context -p umbel-plugin-curator -p umbel-first-party -p umbel-hook --all-targets -- -D warnings`; the
    `memory` job's tests as `umbel.yml` runs them, both report variables set (314 passed, 0 failed, in 61 suites:
    312 at step 6, and these 2); `node scripts/run-tooling-tests.mjs` (305 passed, on Node 24.18; the repository pins
    26). Not run here: the knowledge job (no knowledge file changed), the MSRV 1.97 check (the toolchain is not
    installed on this machine) and the full gate. **Full `pnpm verify` re-run, 2026-11-03, `main` at `6e1c0a0a`
    plus step 7, in one pass:** all 21 suites passed (the TypeScript check, Loam's build, Chromium-free units and
    `test:mounted`, Alfred, fmt, the workspace clippy, the components and `hello-mcp`, `cargo test --locked
    --workspace --exclude umbel-store-embedded` and the store crates, 206 test result lines with none failed, and
    every todo conformance run against Umbel with the external clients).**
- **Not done:** nothing in phase 4's [plan](phases/4-curator/spec.md#15-implementation-plan). There is no AFD step 0.
  Open: the specification's [follow-ups](phases/4-curator/spec.md#follow-ups), among them the host hook for
  configuration checks that need the workspace (a drafter target's collection), which was listed for step 7 and was
  not built there: neither the plan row nor the exit needs it, it is a new host interface, and every case still
  fails closed per draft; it now waits for real use, with the doctor API.
- **Next:** the phase 5 (auth and hosted) and phase 6 (backends) specifications, which phase 4's exit leaves as the
  open phases before phase 7. Each gets an independent review, a revision and the owner's answers (D24). Heavy steps
  follow each plan's build note.
- **Answered by the owner 2026-11-04** (phase 5 decision 11, D120), formerly waiting: one question, raised again at the exit
  ([step 7, amendment 11](phases/4-curator/spec.md#amendments-from-step-7)). Step 3b's amendment 12 stated a limit
  that no decision has accepted or closed: proposals are read under the caller's reader filter, so a draft whose
  proposer has since lost read access to it (removed from the target's readers after it was drafted) is reached by
  neither the run's re-check nor the `erased` notice, and is not redacted when its memory source is forgotten. Its
  text stays readable by the readers the record still admits, never wider than they were. Accept it as a stated
  limit, or close it with a redaction path outside the caller's filter (for example one the knowledge instance runs
  on a forget), which changes who may act on a record. Every other phase 4 decision is final. Answered 2026-11-04 by [phase 5 decision 11](phases/5-auth-hosted/spec.md#17-for-the-owner): a host-run, redaction-only sweep, amending D101 (D120); phase 5 step 11 builds it. Nothing of phase 4 waits on the owner.
- **Follow-ups:** the [specification's list](phases/4-curator/spec.md#follow-ups), which step 7 extended with the
  principal filter any future plugin-record surface needs and with the question above, now answered.
