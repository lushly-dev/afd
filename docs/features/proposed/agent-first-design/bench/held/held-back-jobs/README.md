# The two held-back jobs

Frozen on 2026-11-15. Two jobs that no building session is ever shown, written now and first
used in phase C's panel loop: if the jobs a builder was shown improve while these do not, the
loop is fitting its reviewers (proposal, section 5.5, "Jobs held out"). Each is a scenario file
in the seed library's format. Both pass against the application at `7c64d460`, 10 of 10 steps,
run in process as the steward through the package's own harness, and `afd scenario validate`
finds both valid.

| # | Job | Screens | Seat | Sentence |
| --- | --- | --- | --- | --- |
| 18 | [`a-return-without-its-loan`](18-a-return-without-its-loan.scenario.yaml) | T1, then T3 | Desk volunteer | When a member brings back saved seed and does not remember what they borrowed, I want to find their loans by their name and record the return against the right one, so that the seed is counted against the loan it came from |
| 19 | [`asked-for-a-retired-variety`](19-asked-for-a-retired-variety.scenario.yaml) | T1 | Desk volunteer | When a member asks for a variety the library has retired, I want to be told that it is retired rather than unknown, and to find them another of its kind, so that they do not leave with nothing or think they misremembered |

- **Why these two.** Each is inside what the application does and what the builders' extract
  describes, and neither is among the seventeen jobs. Job 18 crosses from the desk to a
  variety's page through a member's loans, which no shown job reaches: `loan-list` by member.
  Job 19 turns on a search that leaves retired varieties out unless asked, so a screen that
  shows "no match" for a retired variety fails the member.
- **What they use.** Only the application's 24 commands and its fixture. Neither needs a change
  to the application.
- **What a screen gains for them.** Job 18 needs `loan-list` by member, which no screen
  calls today: T1 lists varieties and T3 lists loans by variety. A screen that supports the job
  adds it, which is what the job tests. Job 19 repeats three steps of job 12, which T3's
  builders see: the refusal to lend a retired variety and the two searches. What it adds is the
  desk's seat and a search by kind. Both run in process, as the steward.
- **When they are committed:** with the rest of this folder, after the last run of phase 0, as
  `18-` and `19-` in the package's `scenarios/`. The harness's counts then become 19 files and
  123 steps.
- **An earlier draft was dropped.** Its two jobs, serving the waiting list in order and taking
  back a box entered twice after some was lent, sat in what the builders' extract lists as
  outside the four screens. A held-back job must be one a good screen could support.
