# The seed library: jobs and drafted commands

The application the [bench](../bench.md) is built on, written jobs first as the `afd` skill's
[guide](../../../../../.claude/skills/afd/references/jobs-first.md) sets it out: the jobs as
sentences, the commands they seem to need, then each job as a scenario file against those
commands. Read the [bench specification](../bench.md) first.

## Status

- **State:** draft, 2026-11-15, against `dfb153b2`. Nothing is built. The commands are a
  draft to write scenarios against, not a specification.
- **Done:** seventeen jobs, each a scenario file in [`scenarios/`](scenarios/), and
  twenty-four drafted commands. The three checks pass ([Checks](#checks)). Three readers
  who did not write them walked the paths ([What the walks changed](#what-the-walks-changed)).
- **Not done:** the two commands the walks added have not been walked, and the owner has not
  cut, added or ranked the jobs. See [Not done](#not-done).
- **Not in this folder, on purpose:** the two jobs held back for the panel loop, and the
  checks, planted faults and persona cards. The bench specification says why.

## The library

A neighbourhood group lends packets of vegetable and flower seed. A volunteer at the desk
lends packets and takes them back. Another takes in donated packets. A steward decides who
gets the rare varieties. On the morning of a seed swap the desk lends to about sixty members,
one box of about forty donated packets is taken in, and about twenty requests wait for the
steward. Its rules:

- **A loan is one packet** of one variety, from its freshest lot.
- **A lot** is the packets of a variety from one harvest. Each has an estimate of how well it
  will germinate, from the library's own test where there is one and from the seed's age
  where there is not. An estimate below 0.5 is old seed.
- **A rare variety is lent only with the steward's agreement.** `loan-create` for a rare
  variety is held, whoever asks. The application records the held loan as a request, one for
  a member and a variety however often it is asked. A request waits twenty-four hours, the
  longest an approval can last. The steward's approval makes the loan.
- **Only a person with the steward's role decides.** A volunteer, or an agent acting for
  anyone, is refused.
- **A returned loan may bring saved seed,** which becomes a new lot.
- **A donated label is matched to a variety without a person only at a confidence of 0.9 or
  more.** Below that the row waits for someone to settle it.
- **Retiring a variety and removing closed requests cannot be undone.** Everything else has a
  way back. A retired variety's open loans stay open and can still be returned.

## Outside the four screens

The bench is four screens, not a whole application. Nothing here:

- creates a member or a variety, or signs anyone in. Fixtures supply the members, the
  varieties and the lots;
- corrects a lot's count, withdraws one lot, or records a germination test;
- tells a member that seed they waited for has come in, or holds a returned packet for
  whoever is first on the waiting list;
- marks an approved loan as collected;
- pages a long list. The fixtures are small, and the bench does not test scale.

A donated label the library does not keep is corrected to one it does, or left out.

## Jobs

The screens are the bench's four tasks. T4 is the one held back from whoever writes the first
pattern statements.

| # | Screen | Job | Seat | Sentence |
| --- | --- | --- | --- | --- |
| 1 | T1 | [`lend-a-packet`](scenarios/01-lend-a-packet.scenario.yaml) | Desk volunteer | When a member asks at the desk for a variety, I want to find the member and the variety and lend a packet in one go, so that the member leaves with seed and the count on the shelf is right |
| 2 | T1 | [`out-of-seed`](scenarios/02-out-of-seed.scenario.yaml) | Desk volunteer | When the variety a member wants has run out, I want to offer a close substitute or put the member on the waiting list, so that they do not leave with nothing |
| 3 | T1 | [`rare-needs-the-steward`](scenarios/03-rare-needs-the-steward.scenario.yaml) | Desk volunteer | When a member asks for a rare variety, I want to ask the steward for it and see that it is waiting, so that rare seed leaves the library only with the steward's agreement |
| 4 | T1 | [`take-back-a-loan`](scenarios/04-take-back-a-loan.scenario.yaml) | Desk volunteer | When I lend the wrong packet or lend to the wrong member, I want to take the loan back at once, so that the count and the member's record are right again |
| 5 | T1 | [`warn-about-old-seed`](scenarios/05-warn-about-old-seed.scenario.yaml) | Desk volunteer | When the only packets left of a variety are old, I want to be told as I lend one, so that the member can sow more thickly or choose something else before they leave |
| 6 | T1 | [`nothing-to-show`](scenarios/06-nothing-to-show.scenario.yaml) | Desk volunteer | When a search finds nothing, or the catalogue cannot be read, I want to be told which of the two it is, so that I know whether to search again or to wait |
| 7 | T2 | [`take-in-a-donation`](scenarios/07-take-in-a-donation.scenario.yaml) | Intake volunteer | When someone hands in a box of packets, I want to enter them as one batch and see it worked through row by row, so that the shelf count is right without my entering each packet twice |
| 8 | T2 | [`settle-an-unclear-label`](scenarios/08-settle-an-unclear-label.scenario.yaml) | Intake volunteer | When a handwritten label could be several varieties, I want to see the likely matches, why each was offered, and choose one, so that seed is not shelved under the wrong name |
| 9 | T2 | [`fix-the-rows-that-failed`](scenarios/09-fix-the-rows-that-failed.scenario.yaml) | Intake volunteer | When some rows of a batch could not be taken in, I want to see which and why, and put them right without entering the rest again, so that one bad label does not hold up the box |
| 10 | T3 | [`see-a-variety`](scenarios/10-see-a-variety.scenario.yaml) | Desk volunteer | When I open a variety, I want its lots, how well each is expected to germinate and on what evidence, and who has it out, so that I can tell a member what to expect |
| 11 | T3 | [`record-a-return`](scenarios/11-record-a-return.scenario.yaml) | Desk volunteer | When a member brings back saved seed, I want to record the return and the new lot it makes, and to take it back if I got it wrong, so that the library grows by what members return |
| 12 | T3 | [`retire-a-variety`](scenarios/12-retire-a-variety.scenario.yaml) | Steward | When a variety has stopped coming true, I want to retire it knowingly, since it cannot be brought back, so that nobody lends seed the library no longer stands behind |
| 13 | T4 | [`decide-a-request`](scenarios/13-decide-a-request.scenario.yaml) | Steward | When a held loan is waiting for me, I want to see who asked for what and approve or decline it, so that each packet of rare seed goes to a member I chose |
| 14 | T4 | [`decide-several-at-once`](scenarios/14-decide-several-at-once.scenario.yaml) | Steward | When many requests are waiting, I want to decide a set of them in one go and see which did not go through and why, so that an evening's requests take minutes |
| 15 | T4 | [`take-a-decision-back`](scenarios/15-take-a-decision-back.scenario.yaml) | Steward | When I approve or decline the wrong request, I want to reopen it, so that a slip of mine does not cost a member their seed |
| 16 | T4 | [`clear-a-past-season`](scenarios/16-clear-a-past-season.scenario.yaml) | Steward | When a season is over, I want its closed requests removed knowingly, since they hold members' names against what they asked for and cannot be brought back, so that the library keeps no more about its members than it needs |
| 17 | T4 | [`nothing-waiting`](scenarios/17-nothing-waiting.scenario.yaml) | Steward | When nothing is waiting for me, I want the list to say so plainly, so that I do not wonder whether it failed to load |

- **Refusals and limits:** jobs 2, 3, 12 and 16. Each has a refusal as its first step.
- **Quiet ones:** jobs 6 and 17. An empty list is a success and says so.

## Drafted commands

Names, inputs, what `data` holds, the other result fields a command fills, and its refusals.
A `?` marks an optional field. No schema is written.

| Command | Kind | Input | `data` | Also returns | Refuses with | Trust |
| --- | --- | --- | --- | --- | --- | --- |
| `variety-list` | Query | `query?`, `kind?`, `includeRetired?` | `varieties` (`id`, `name`, `kind`, `rare`, `packetsAvailable`, `germination`, `retired`), `total` | | `SERVICE_UNAVAILABLE` | |
| `variety-get` | Query | `id` | `id`, `name`, `kind`, `rare`, `packetsAvailable`, `waiting` (`member`, `position`), `retired`, `retiredAt?` | | `NOT_FOUND` | |
| `variety-retire` | Mutation | `id` | `id`, `retired`, `retiredAt`, `packetsWithdrawn` | | `NOT_FOUND`, `CONFLICT`, `CONFIRMATION_REQUIRED` | `destructive`, `confirmPrompt` |
| `lot-list` | Query | `varietyId` | `lots` (`id`, `harvestYear`, `packets`, `source`, `germination`), `total` | `reasoning`, `confidence`, `sources`, `warnings` (`OLD_SEED`) | `NOT_FOUND` | |
| `substitute-suggest` | Query | `varietyId` | `variety` (`id`, `name`, `packetsAvailable`) | `confidence`, `alternatives` | `NOT_FOUND`, `NO_SUBSTITUTE` | |
| `member-list` | Query | `query?` | `members` (`id`, `name`, `number`), `total` | | `SERVICE_UNAVAILABLE` | |
| `loan-create` | Mutation | `memberId`, `varietyId` | `id`, `status`, `lentAt`, `lot` (`id`, `harvestYear`, `germination`) | `undoCommand` (`loan-cancel`), `undoArgs`, `warnings` (`OLD_SEED`) | `NOT_FOUND`, `OUT_OF_STOCK`, `CONFLICT`, `APPROVAL_REQUIRED` | `approval` for a rare variety; `undoable` |
| `loan-cancel` | Mutation | `id` | `id`, `status` | | `NOT_FOUND`, `CONFLICT` | |
| `loan-return` | Mutation | `id`, `savedSeed?` (`packets`, `harvestYear`) | `id`, `status`, `returnedAt`, `lot?` (`id`, `packets`) | `undoCommand` (`loan-reopen`), `undoArgs` | `NOT_FOUND`, `CONFLICT` | `undoable` |
| `loan-reopen` | Mutation | `id` | `id`, `status`, `lotRemoved?` | | `NOT_FOUND`, `CONFLICT` | |
| `loan-list` | Query | `varietyId?`, `memberId?`, `status?` | `loans` (`id`, `member`, `variety`, `lentAt`, `status`), `total` | | `SERVICE_UNAVAILABLE` | |
| `waitlist-join` | Mutation | `memberId`, `varietyId` | `position` | `undoCommand` (`waitlist-leave`), `undoArgs` | `NOT_FOUND`, `ALREADY_EXISTS`, `CONFLICT` | `undoable` |
| `waitlist-leave` | Mutation | `memberId`, `varietyId` | `left` | | `NOT_FOUND` | |
| `request-list` | Query | `status?`, `memberId?` | `requests` (`id`, `member`, `variety`, `summary`, `askedAt`, `expiresAt`, `status`, `packetsAvailable`), `total` | | `SERVICE_UNAVAILABLE` | |
| `request-withdraw` | Mutation | `id` | `id`, `status` | | `NOT_FOUND`, `CONFLICT` | |
| `request-decide` | Mutation | `id`, `decision`, `reason?` | `id`, `status`, `decidedAt`, `loanId?`, `memberTold` | `plan`, `undoCommand` (`request-reopen`), `undoArgs`, `warnings` (`MEMBER_NOT_TOLD`) | `NOT_FOUND`, `CONFLICT`, `OUT_OF_STOCK`, `REQUEST_EXPIRED`, `FORBIDDEN` | `undoable`; a person with the steward's role |
| `request-reopen` | Mutation | `id` | `id`, `status`, `expiresAt`, `loanCancelled?` | | `NOT_FOUND`, `CONFLICT`, `FORBIDDEN` | A person with the steward's role |
| `request-clear` | Mutation | `closedBefore` | `removed` | | `CONFIRMATION_REQUIRED`, `FORBIDDEN` | `destructive`, `confirmPrompt`; a person with the steward's role |
| `donation-import` | Mutation | `donor?`, `rows` (`label`, `packets`, `harvestYear?`) | `id`, `status`, `succeeded`, `unsettled`, `failed`, `summary` | `plan`, `confidence`, `undoCommand` (`donation-cancel`), `undoArgs`, `warnings` (`PARTIAL_SUCCESS`) | `VALIDATION_ERROR` | `undoable` |
| `donation-get` | Query | `id` | As `donation-import` | `plan` | `NOT_FOUND` | |
| `donation-cancel` | Mutation | `id` | `id`, `cancelled`, `lotsRemoved` | | `NOT_FOUND`, `CONFLICT` | |
| `donation-match` | Query | `donationId`, `index` | `variety` (`id`, `name`), `label` | `confidence`, `reasoning`, `sources`, `alternatives` | `NOT_FOUND`, `CONFLICT` | |
| `donation-settle` | Mutation | `donationId`, `index`, `varietyId` | `index`, `varietyId`, `lotId` | | `NOT_FOUND`, `CONFLICT` | |
| `donation-correct` | Mutation | `donationId`, `index`, `label?`, `packets?`, `harvestYear?`, `leaveOut?` | `index`, `outcome`, `lotId?` | | `NOT_FOUND`, `INVALID_FORMAT`, `CONFLICT` | |

- **Error codes.** Nine come from the shared catalog (`spec/error-codes.md`). The library adds
  three: `OUT_OF_STOCK`, `NO_SUBSTITUTE` and `REQUEST_EXPIRED`. Each of the library's own
  refusals carries a `suggestion` that names the next command.
- **A row of a donation fails by itself.** `donation-import` succeeds when some rows fail.
  Each entry of `failed` holds the row's `index` and its own `error`, with a `suggestion`.
- **A donation has three ways back.** `donation-cancel` removes the lots a whole batch made.
  `donation-settle` on a row already filed moves it to another variety. `donation-correct`
  puts a failed row right or, with `leaveOut`, drops it. Each is refused with `CONFLICT`
  once a packet from the lot has been lent.
- **Two shapes of a batch, on purpose.** `donation-import` is one command over many rows and
  reports them in its own `data`, as the todo example's batch command does. Deciding several
  requests is several `request-decide` calls in one `afd-batch`, whose result is the
  meta-tool's (`spec/wire/batch-result.json`). A screen meets both.
- **Who may decide.** `FORBIDDEN` for anyone but a person with the steward's role is the
  application's authorization, in middleware. It is separate from the `approval` on
  `loan-create`.

## What the application asks of the host

The host is an AFD server. Its approval middleware holds a call and calls a hook; it keeps no
record and retries nothing (`packages/server/src/approval.ts:179`, `:472`). So the
application does the rest:

- **It records the request.** The middleware's `onApprovalRequired` hook writes a request for
  the held loan, or finds the one already waiting for that member and variety.
- **It says where the request went.** The hold's `summary` says what was asked, that it
  waits for the steward, and names `request-list`. The refusal's `suggestion` quotes the
  summary (`packages/server/src/approval.ts:492`). The rest of that suggestion is the host's
  and tells the caller to ask the user to approve, and at the desk the user is the volunteer.
- **It does not ask the person at the client.** `relay` stays off. With it on, the volunteer
  would be asked to approve rare seed for themselves.
- **`request-decide` makes the loan itself.** The held call's token is never retried. A token
  is bound to the actor who asked and works once, and the steward's decision is the approval.
- **A request lasts as long as its hold:** `ttlMs` is set to twenty-four hours, the most the
  middleware allows (`packages/server/src/approval.ts:234`).
- **Confirmations are enforced.** `variety-retire` and `request-clear` answer
  `CONFIRMATION_REQUIRED` until the call is repeated with `confirm: true`. On a screen the
  person answers the command's `confirmPrompt`. Over MCP an agent can send that
  acknowledgement by itself, so "knowingly" holds for a person at a screen and not for an
  agent; a server that must hold an agent to it accepts only an elicitation.

## Where each pattern arises

The bench specification's table said which screen needs which pattern. This says what
produces it.

| Pattern (proposal, 5.2) | T1 | T2 | T3 | T4 |
| --- | --- | --- | --- | --- |
| An error with its recovery | A loan of seed that has run out; no substitute | A failed row; a correction that is still wrong | A return recorded twice | A request already decided, expired, or approved with none left |
| An undo offer | `loan-create`, `waitlist-join` | `donation-import` | `loan-return` | `request-decide` |
| A confirmation before a destructive command | | | `variety-retire` | `request-clear` |
| An approval request | A held `loan-create` | | | The held loan as the steward sees it |
| Progress | | `donation-import`, `donation-get` | | `request-decide`, approving |
| A choice among alternatives | `substitute-suggest` | `donation-match` | | |
| Warnings | Old seed, on `loan-create` | Some rows failed, on `donation-import` | Old seed, on `lot-list` | The member could not be told, on `request-decide` |
| Evidence for a result | | `donation-match` | `lot-list` | |
| A batch with some failures | | `donation-import` | | Several decisions in one `afd-batch` |
| An empty collection, a failed collection | `variety-list`, `member-list` | | `loan-list` | `request-list` |

## What writing the jobs changed

Against the eleven names sketched in the bench specification:

- **The ask is the held loan.** The sketch had no way to ask the steward. Writing job 3 showed
  that the contract already has one: `loan-create` declares `approval` for a rare variety and
  the call is held with `APPROVAL_REQUIRED`. So there is no `request-create`, and the
  steward's list is the record of held calls.
- **Every mutation that has a way back got its command:** `loan-cancel`, `loan-reopen`,
  `waitlist-leave` and `request-reopen`. The sketch had none.
- **Running out needed two commands,** `substitute-suggest` and `waitlist-join`. A refusal
  cannot carry `alternatives`, so the substitutes come from a query whose result can.
- **`lot-list` was added,** because the germination estimate and its evidence belong to a lot.
- **A donation needed more than import and match:** `donation-get` to follow it,
  `donation-match` as a query, `donation-settle` to choose, and `donation-correct` for a
  failed row.
- **T4 got a destructive command,** `request-clear`, and progress, as the `plan` of an
  approval: check the shelf, make the loan, tell the member.
- **Four cells of the pattern table changed.** Warnings now arise on T2 and T4, an error with
  its recovery on T3, and an undo offer on T2. Only alternatives and evidence are missing
  from the held-back screen, where the bench specification named three. Its table and its
  limit are updated.

## What the walks changed

Three readers who did not write the draft walked it on 2026-11-15, each in one of the seats
the jobs-first guide names, on Claude Opus 5.5. They read the first version: the same
seventeen jobs, with twenty-two commands.

- **The person** walked a first week, an ordinary day, a run of decisions, a year in, and
  mistakes by a person, an agent and a bulk run.
- **The job list** read the bench specification's four screens, wrote its own eighteen jobs,
  and then compared.
- **The calling agent** read the host's specification and counted calls, tokens and
  interruptions for each job at the stated volume.

What they changed:

- **Donations got a way back.** A wrong match, a wrong count or a box entered twice could not
  be reversed, against the library's own rule. `donation-cancel` was added, and
  `donation-settle` now moves a row already filed. Two seats found it.
- **The held loan no longer leans on the host.** The first version said the server files a
  held call as a request and makes the loan on approval. The host does neither.
  [What the application asks of the host](#what-the-application-asks-of-the-host) now says
  what the application does, and that the host's own wording would send the caller to the
  wrong person.
- **A held request can be withdrawn** by whoever asked, with `request-withdraw`, and
  `request-list` filters by member. The desk had no way back from a request made by mistake.
- **Only a person decides.** An agent acting for the steward could have approved twenty
  requests in one batch with nobody asked. The rule now refuses an agent.
- **Old seed shows before the loan.** `variety-list` carries the estimate of the lot a loan
  would come from. The warning used to arrive after the loan was made.
- **Seven scenarios now reach their "so that".** Jobs 4, 5, 10, 11, 14 and 15 stopped short:
  the right member never got the loan, the right return was never recorded, the wrongly
  declined member never got seed. Job 2 now shows who is waiting.
- **Job 16 has a reason.** It read as a command looking for a job. It is now about keeping
  no more about members than the library needs, and it removes expired requests too.
- **Smaller:** a member's number tells two of one name apart; `lotId` was cut from
  `loan-create`, with the refusal it needed; a reopened request waits a fresh day; a failed
  row's suggestion names `leaveOut`.

What was declined, and why:

- **A stock correction, a germination test, paging, serving the waiting list in order, and
  marking a loan collected.** Each is real, and each is outside the four screens. They are
  listed under [Outside the four screens](#outside-the-four-screens) so a reader does not
  take the gap for an oversight.
- **A confirmation on every decision.** It would stop an agent, and it would also put a
  question in front of the steward twenty times an evening. The rule that only a person
  decides does the first without the second.
- **A record of a member's past returns in the steward's list.** Job 13's outcome was
  reworded to what the list can show: the seed goes to a member the steward chose.
- **A key that makes a repeated import a refusal.** `donation-cancel` is the way back from a
  box entered twice.

## What a scenario could not express

Each file says at its top what it leaves out. Together:

- **`warnings`, `alternatives`, `sources`, `plan`, `undoCommand` and `undoArgs`** cannot be
  asserted. Five of the ten patterns render those fields. The steps assert the `data` the
  fields are built from, and run the command an undo names.
- **`confidence` is a floor.** A step can show that a match is at least 0.5 and cannot show
  that it is below 0.9. That a label was left for a person shows it.
- **One actor.** Every step runs as the test actor, so no file shows a volunteer or an agent
  refused with `FORBIDDEN` and the steward allowed.
- **A service that fails.** Jobs 6 and 17 are half shown: the empty list, and not the list
  that cannot be read (`SERVICE_UNAVAILABLE`).
- **One call a step.** Job 14's three decisions are three steps where the screen sends one
  `afd-batch`.
- **Work in progress.** The commands answer at once, so no step shows a batch that is still
  running.
- **A confirmation.** Its wording is the command's `confirmPrompt`, which a step cannot read.
  Jobs 12 and 16 need a server that enforces confirmations, since a call made in process is
  never gated. They write `confirm` inside `input`, where an individual tool takes it; a
  grouped tool and `afd-call` take it beside the input.

A screen's builder is given a fixture of each result as well, so the fields a scenario cannot
assert still reach the screen. Those fixtures are not written.

## Checks

Run 2026-11-15 at `dfb153b2`, after `pnpm -F "@lushly-dev/afd-cli..." build`, on the files as
they are after the walks. Nothing is built, so the files are checked and not run.

- **Parse:** `node packages/cli/dist/bin.js scenario validate` on the folder printed
  "All 17 scenario(s) are valid!".
- **Dry run,** with fixtures resolved: no errors in 17 files and 113 steps.
- **Coverage,** against the 24 commands and 12 error codes drafted above:
  - commands: 24 of 24 used, none undrafted;
  - errors: 10 of 12 shown. `SERVICE_UNAVAILABLE` and `FORBIDDEN` are the two a scenario
    cannot express.

## Not done

- **The two commands the walks added have not been walked.** The jobs-first guide asks for a
  second walk when fixes add commands. `request-withdraw` and `donation-cancel` have had
  none.
- **No schema.** Inputs and results are names in a table.
- **The tasks a building session is given** are not written: for each screen, its states and
  what the user must be able to do in each.
- **The result fixtures** that force each state are not written.
- **The application** in `packages/examples/seed-library` does not exist.

## For the owner

1. **The jobs.** Cut, add or change them. *Recommendation: keep the seventeen,* because each
   screen then meets every pattern the bench specification gives it, and three readers found
   no job missing inside the four screens. Confidence: medium.
2. **Job 16.** Removing a past season's closed requests is what gives T4 a command that
   cannot be undone. *Recommendation: keep it.* Without it a confirmation is tested only on
   T3, a screen the statements may be written from. Confidence: medium. The alternative is
   to drop it and add confirmation to the bench specification's limit.
3. **Approval as a held loan.** The steward's request is a held `loan-create`, not a command
   of its own. *Recommendation: keep it,* because it tests the contract's `approval` and not
   a look-alike. Confidence: medium. It has a cost: the approval middleware lets a hold last
   at most twenty-four hours, so a request the steward does not decide within a day expires
   and the member asks again.
