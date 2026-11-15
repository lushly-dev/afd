# The seed library: jobs and drafted commands

The application the [bench](../bench.md) is built on, written jobs first as the `afd` skill's
[guide](../../../../../.claude/skills/afd/references/jobs-first.md) sets it out: the jobs as
sentences, the commands they seem to need, then each job as a scenario file against those
commands. Read the [bench specification](../bench.md) first.

## Status

- **State:** built, 2026-11-15, against `03f68dc2`, and not merged. The application is
  [`packages/examples/seed-library`](../../../../../packages/examples/seed-library/README.md):
  the twenty-four commands below with their schemas, an in-memory store and the host's part.
  Its tests run all seventeen jobs, and all 113 steps pass. The drafted commands were a draft
  to write scenarios against; the code is now their specification
  ([What building it settled](#what-building-it-settled)).
- **Done:** seventeen jobs, each a scenario file, which moved beside the code to
  [`scenarios/`](../../../../../packages/examples/seed-library/scenarios/) once it was built,
  and twenty-four commands. The three checks pass ([Checks](#checks)). Three readers who did
  not write them walked the paths, and a fourth reviewed the result and walked the two
  commands the walks had added ([What the walks changed](#what-the-walks-changed)).
- **Decided by the owner on 2026-11-15:** three design points ([For the owner](#for-the-owner)).
  The list of jobs as a whole is still open. See [Not done](#not-done).
- **Not in this folder, on purpose:** the two jobs held back for the panel loop, and the
  checks, planted faults and persona cards. The bench specification says why.

## The library

A neighbourhood group lends packets of vegetable and flower seed. A volunteer at the desk
lends packets and takes them back. Another takes in donated packets. A steward decides who
gets the rare varieties. On the morning of a seed swap the desk lends to about sixty members,
one box of about forty donated packets is taken in, and about twenty requests wait for the
steward. Its rules:

- **A loan is one packet** of one variety, from its freshest lot.
- **A lot** is one batch of packets of a variety as it came in, with its harvest year. Each
  row of a donation and each return of saved seed makes its own lot. Each lot has an estimate
  of how well it will germinate, from the library's own test where there is one and from the
  seed's age where there is not. An estimate below 0.5 is old seed.
- **A rare variety is lent only with the steward's agreement.** `loan-create` for a rare
  variety is held, whoever asks. The application records the held loan as a request, one for
  a member and a variety however often it is asked. A request waits as long as its hold,
  which is set to twenty-four hours. The steward's approval makes the loan, and nothing else
  does: a hold cleared at the client (a DirectClient's `onApprovalNeeded`) reaches
  `loan-create`, which refuses rare seed with `FORBIDDEN`, and the request still waits. A
  waiting request can be withdrawn at the desk.
- **Only a person with the steward's role decides,** retires a variety or removes closed
  requests. A volunteer, or an agent acting for anyone, is refused.
- **A returned loan may bring saved seed,** which becomes a new lot.
- **A donated label is matched to a variety without a person only at a confidence of 0.9 or
  more.** Below that the row waits for someone to settle it.
- **Retiring a variety and removing closed requests cannot be undone.** Every other change
  has a way back. Where the change was itself a taking back, the way back is to do the thing
  again: lend again, ask again, enter the box again. A retired variety's open loans stay
  open and can still be returned.

## Outside the four screens

The application is four screens, not a whole library system. Nothing here:

- creates a member or a variety, or signs anyone in. Fixtures supply the members, the
  varieties and the lots;
- corrects a lot's count, withdraws one lot, or records a germination test. So a box entered
  twice cannot be put right here once its packets have started to go out;
- tells a member that seed they waited for has come in, or holds a returned packet for
  whoever is first on the waiting list;
- marks an approved loan as collected;
- pages a long list. The fixtures are small.

A donated label the library does not keep is corrected to one it does, or left out.

## Jobs

The screens are the bench's four tasks. T4 is the one held back from whoever writes the first
pattern statements.

| # | Screen | Job | Seat | Sentence |
| --- | --- | --- | --- | --- |
| 1 | T1 | [`lend-a-packet`](../../../../../packages/examples/seed-library/scenarios/01-lend-a-packet.scenario.yaml) | Desk volunteer | When a member asks at the desk for a variety, I want to find the member and the variety and lend a packet in one go, so that the member leaves with seed and the count on the shelf is right |
| 2 | T1 | [`out-of-seed`](../../../../../packages/examples/seed-library/scenarios/02-out-of-seed.scenario.yaml) | Desk volunteer | When the variety a member wants has run out, I want to offer a close substitute or put the member on the waiting list, so that they do not leave with nothing |
| 3 | T1 | [`rare-needs-the-steward`](../../../../../packages/examples/seed-library/scenarios/03-rare-needs-the-steward.scenario.yaml) | Desk volunteer | When a member asks for a rare variety, I want to ask the steward for it and see that it is waiting, so that rare seed leaves the library only with the steward's agreement |
| 4 | T1 | [`take-back-a-loan`](../../../../../packages/examples/seed-library/scenarios/04-take-back-a-loan.scenario.yaml) | Desk volunteer | When I lend the wrong packet or lend to the wrong member, I want to take the loan back at once, so that the count and the member's record are right again |
| 5 | T1 | [`warn-about-old-seed`](../../../../../packages/examples/seed-library/scenarios/05-warn-about-old-seed.scenario.yaml) | Desk volunteer | When the only packets left of a variety are old, I want to be told as I lend one, so that the member can sow more thickly or choose something else before they leave |
| 6 | T1 | [`nothing-to-show`](../../../../../packages/examples/seed-library/scenarios/06-nothing-to-show.scenario.yaml) | Desk volunteer | When a search finds nothing, or the catalogue cannot be read, I want to be told which of the two it is, so that I know whether to search again or to wait |
| 7 | T2 | [`take-in-a-donation`](../../../../../packages/examples/seed-library/scenarios/07-take-in-a-donation.scenario.yaml) | Intake volunteer | When someone hands in a box of packets, I want to enter them as one batch and see it worked through row by row, so that the shelf count is right without my entering each packet twice |
| 8 | T2 | [`settle-an-unclear-label`](../../../../../packages/examples/seed-library/scenarios/08-settle-an-unclear-label.scenario.yaml) | Intake volunteer | When a handwritten label could be several varieties, I want to see the likely matches, why each was offered, and choose one, so that seed is not shelved under the wrong name |
| 9 | T2 | [`fix-the-rows-that-failed`](../../../../../packages/examples/seed-library/scenarios/09-fix-the-rows-that-failed.scenario.yaml) | Intake volunteer | When some rows of a batch could not be taken in, I want to see which and why, and put them right without entering the rest again, so that one bad label does not hold up the box |
| 10 | T3 | [`see-a-variety`](../../../../../packages/examples/seed-library/scenarios/10-see-a-variety.scenario.yaml) | Desk volunteer | When I open a variety, I want its lots, how well each is expected to germinate and on what evidence, and who has it out, so that I can tell a member what to expect |
| 11 | T3 | [`record-a-return`](../../../../../packages/examples/seed-library/scenarios/11-record-a-return.scenario.yaml) | Desk volunteer | When a member brings back saved seed, I want to record the return and the new lot it makes, and to take it back if I got it wrong, so that the library grows by what members return |
| 12 | T3 | [`retire-a-variety`](../../../../../packages/examples/seed-library/scenarios/12-retire-a-variety.scenario.yaml) | Steward | When a variety has stopped coming true, I want to retire it knowingly, since it cannot be brought back, so that nobody lends seed the library no longer stands behind |
| 13 | T4 | [`decide-a-request`](../../../../../packages/examples/seed-library/scenarios/13-decide-a-request.scenario.yaml) | Steward | When a held loan is waiting for me, I want to see who asked for what and approve or decline it, so that each packet of rare seed goes to a member I chose |
| 14 | T4 | [`decide-several-at-once`](../../../../../packages/examples/seed-library/scenarios/14-decide-several-at-once.scenario.yaml) | Steward | When many requests are waiting, I want to decide a set of them in one go and see which did not go through and why, so that an evening's requests take minutes |
| 15 | T4 | [`take-a-decision-back`](../../../../../packages/examples/seed-library/scenarios/15-take-a-decision-back.scenario.yaml) | Steward | When I approve or decline the wrong request, I want to reopen it, so that a slip of mine does not cost a member their seed |
| 16 | T4 | [`clear-a-past-season`](../../../../../packages/examples/seed-library/scenarios/16-clear-a-past-season.scenario.yaml) | Steward | When a season is over, I want its closed requests removed knowingly, since they hold members' names against what they asked for and cannot be brought back, so that the library keeps no more about its members than it needs |
| 17 | T4 | [`nothing-waiting`](../../../../../packages/examples/seed-library/scenarios/17-nothing-waiting.scenario.yaml) | Steward | When nothing is waiting for me, I want the list to say so plainly, so that I do not wonder whether it failed to load |

- **Refusals and limits:** jobs 2, 3, 12 and 16. Each has a refusal as its first step.
- **Quiet ones:** jobs 6 and 17. An empty list is a success and says so.

## Drafted commands

Names, inputs, what `data` holds, the other result fields a command fills, and its refusals.
A `?` marks an optional field. The schemas are the application's, in
[`src/schemas.ts`](../../../../../packages/examples/seed-library/src/schemas.ts).

| Command | Kind | Input | `data` | Also returns | Refuses with | Trust |
| --- | --- | --- | --- | --- | --- | --- |
| `variety-list` | Query | `query?`, `kind?`, `includeRetired?` | `varieties` (`id`, `name`, `kind`, `rare`, `packetsAvailable`, `germination`, `retired`), `total` | | `SERVICE_UNAVAILABLE` | |
| `variety-get` | Query | `id` | `id`, `name`, `kind`, `rare`, `packetsAvailable`, `waiting` (`member`, `position`), `retired`, `retiredAt?` | | `NOT_FOUND` | |
| `variety-retire` | Mutation | `id` | `id`, `retired`, `retiredAt`, `packetsWithdrawn` | | `NOT_FOUND`, `CONFLICT`, `CONFIRMATION_REQUIRED`, `FORBIDDEN` | `destructive`, `confirmPrompt`; a person with the steward's role |
| `lot-list` | Query | `varietyId` | `lots` (`id`, `harvestYear`, `packets`, `source`, `germination`), `total` | `reasoning`, `confidence`, `sources`, `warnings` (`OLD_SEED`) | `NOT_FOUND` | |
| `substitute-suggest` | Query | `varietyId` | `variety` (`id`, `name`, `packetsAvailable`) | `reasoning`, `confidence`, `alternatives` | `NOT_FOUND`, `NO_SUBSTITUTE` | |
| `member-list` | Query | `query?` | `members` (`id`, `name`, `number`), `total` | | `SERVICE_UNAVAILABLE` | |
| `loan-create` | Mutation | `memberId`, `varietyId` | `id`, `status`, `lentAt`, `lot` (`id`, `harvestYear`, `germination`) | `undoCommand` (`loan-cancel`), `undoArgs`, `warnings` (`OLD_SEED`) | `NOT_FOUND`, `OUT_OF_STOCK`, `CONFLICT`, `APPROVAL_REQUIRED`, `FORBIDDEN` | `approval` for a rare variety; `undoable` |
| `loan-cancel` | Mutation | `id` | `id`, `status` | | `NOT_FOUND`, `CONFLICT` | |
| `loan-return` | Mutation | `id`, `savedSeed?` (`packets`, `harvestYear`) | `id`, `status`, `returnedAt`, `lot?` (`id`, `packets`) | `undoCommand` (`loan-reopen`), `undoArgs` | `NOT_FOUND`, `CONFLICT` | `undoable` |
| `loan-reopen` | Mutation | `id` | `id`, `status`, `lotRemoved?` | | `NOT_FOUND`, `CONFLICT` | |
| `loan-list` | Query | `varietyId?`, `memberId?`, `status?` | `loans` (`id`, `member`, `variety`, `lentAt`, `status`), `total` | | `SERVICE_UNAVAILABLE` | |
| `waitlist-join` | Mutation | `memberId`, `varietyId` | `position` | `undoCommand` (`waitlist-leave`), `undoArgs` | `NOT_FOUND`, `ALREADY_EXISTS`, `CONFLICT` | `undoable` |
| `waitlist-leave` | Mutation | `memberId`, `varietyId` | `left` | | `NOT_FOUND` | |
| `request-list` | Query | `status?` (a status, or `closed` for every status but `pending`), `memberId?` | `requests` (`id`, `member`, `variety`, `summary`, `askedAt`, `expiresAt`, `status`, `packetsAvailable`), `total` | | `SERVICE_UNAVAILABLE` | |
| `request-withdraw` | Mutation | `id` | `id`, `status` | | `NOT_FOUND`, `CONFLICT` | |
| `request-decide` | Mutation | `id`, `decision`, `reason?` | `id`, `status`, `decidedAt`, `loanId?`, `memberTold` | `plan`, `undoCommand` (`request-reopen`), `undoArgs`, `warnings` (`MEMBER_NOT_TOLD`) | `NOT_FOUND`, `CONFLICT`, `OUT_OF_STOCK`, `REQUEST_EXPIRED`, `FORBIDDEN` | `undoable`; a person with the steward's role |
| `request-reopen` | Mutation | `id` | `id`, `status`, `expiresAt`, `loanCancelled?` | | `NOT_FOUND`, `CONFLICT`, `FORBIDDEN` | A person with the steward's role |
| `request-clear` | Mutation | `closedBefore` | `removed` | | `CONFIRMATION_REQUIRED`, `FORBIDDEN` | `destructive`, `confirmPrompt`; a person with the steward's role |
| `donation-import` | Mutation | `donor?`, `rows` (`label`, `packets`, `harvestYear?`) | `id`, `status`, `succeeded`, `unsettled`, `failed`, `summary` | `plan`, `confidence`, `undoCommand` (`donation-cancel`), `undoArgs`, `warnings` (`PARTIAL_SUCCESS`) | `VALIDATION_ERROR` | `undoable` |
| `donation-get` | Query | `id` | As `donation-import` | `plan` | `NOT_FOUND` | |
| `donation-cancel` | Mutation | `id` | `id`, `cancelled`, `lotsRemoved` | | `NOT_FOUND`, `CONFLICT` | |
| `donation-match` | Query | `donationId`, `index` | `variety` (`id`, `name`), `label` | `confidence`, `reasoning`, `sources`, `alternatives` | `NOT_FOUND`, `CONFLICT` | |
| `donation-settle` | Mutation | `donationId`, `index`, `varietyId` | `index`, `varietyId`, `lotId` | | `NOT_FOUND`, `CONFLICT` | |
| `donation-correct` | Mutation | `donationId`, `index`, `label?`, `packets?`, `harvestYear?`, `leaveOut?` | `index`, `outcome`, `lotId?` | | `NOT_FOUND`, `INVALID_INPUT`, `CONFLICT` | |

- **Error codes.** Nine come from the shared catalog (`spec/error-codes.md`). The library adds
  three: `OUT_OF_STOCK`, `NO_SUBSTITUTE` and `REQUEST_EXPIRED`. Each of the library's own
  refusals carries a `suggestion` that names the next command.
- **A row of a donation fails by itself.** `donation-import` succeeds when some rows fail.
  Each entry of `failed` holds the row's `index` and its own `error`, with a `suggestion`.
- **A donation has three ways back.** `donation-cancel` removes the lots a whole batch made.
  `donation-settle` on a row already filed moves it to another variety. `donation-correct`
  puts a failed row right or, with `leaveOut`, drops it. Each is refused with `CONFLICT`
  once a packet from the lot has been lent.
- **Two shapes of a batch.** `donation-import` is one command over many rows and reports
  them in its own `data`, as the todo example's batch command does. Deciding several
  requests is several `request-decide` calls in one `afd-batch`, whose result is the
  meta-tool's (`spec/wire/batch-result.json`).
- **Who may decide.** `FORBIDDEN` for anyone but a person with the steward's role is the
  application's authorization, in middleware. It is separate from the `approval` on
  `loan-create`.

## States

The values a scenario asserts, which the commands table does not spell out:

| What | Values |
| --- | --- |
| A loan's `status` | `out`, `returned`, `cancelled` |
| A request's `status` | `pending`, `approved`, `declined`, `expired`, `withdrawn`. Every one but `pending` is closed, and `request-clear` removes closed requests |
| A donation's `status` | `in-progress` while its rows are worked through, then `complete` or `needs-attention`; `cancelled` once taken back |
| A row's `outcome` | `succeeded`, `unsettled`, `failed`, `left-out` |
| A donation's `summary` | `total`, `successCount`, `unsettledCount`, `failureCount`, `leftOutCount` |
| A failed row's `error.code` | `INVALID_INPUT` for a value that cannot be right, such as a harvest year in the future; `NOT_FOUND` for a label the library does not keep |
| A lot's `germination` | `estimate`, from 0 to 1, and `basis`: `tested` or `age`. On a `variety-list` row it is the freshest lot's, and absent when the variety has no packets |
| A donation's rows | Every entry of `succeeded`, `unsettled` and `failed`: `index`, `label`, `packets`, `harvestYear`. A `succeeded` entry adds `varietyId`, and `lotId` while its lot exists; a `failed` entry adds `error`. A row that waits for a person is a `pending` step in the batch's `plan` |
| A `member` inside an entry | `id`, `name`, `number` |
| A `variety` inside an entry | `id`, `name` |
| A donation's `confidence` | `successCount / total`, so 0 for a box whose rows all wait for a person |

## What the application asks of the host

The host is an AFD server. Its approval middleware holds a call and calls a hook. It keeps no
record of the held call and retries nothing (`packages/server/src/approval.ts:183`, `:472`).
So the application does the rest:

- **It records the request.** The middleware's `onApprovalRequired` hook writes a request for
  the held loan, or finds the one already waiting for that member and variety.
- **It says where the request went.** The hold's `summary` is the request's summary followed
  by where it waits: with the steward, in `request-list`. The refusal's `suggestion` quotes
  the summary (`packages/server/src/approval.ts:495`). The rest of that suggestion is the
  host's, and both its halves are wrong here: it tells the caller to ask the user to approve,
  and at the desk the user is the volunteer; and it says the application retries the call
  once the approval is recorded, where here `request-decide` makes the loan and nothing is
  retried.
- **It does not ask the person at the client.** `relay` stays off. With it on, the volunteer
  would be asked to approve rare seed for themselves.
- **`request-decide` makes the loan itself.** The held call's token is never retried, and
  never returned: `includeToken` is off. A token is bound to the actor who asked and works
  once, and the steward's decision is the approval.
- **A request expires when its hold does, by choice.** Nothing in the host makes it so. The
  request is the application's record and could wait a week. It is tied to the hold so that
  the `expiresAt` in the refusal, which is what a screen shows, is true. The price is the
  middleware's cap of twenty-four hours on `ttlMs` (`packages/server/src/approval.ts:234`).

## Who calls, and through what

- **A screen calls in process,** through a DirectClient, as the person signed in: a volunteer
  or the steward. A call made in process is never held for a confirmation
  (`spec/command-metadata.md`, "Confirmations"). So the screen reads the command's
  `confirmPrompt` and asks before it calls.
- **An agent in the application has to be marked as one.** A DirectClient's actor is a person
  unless it is set otherwise (`packages/core/src/actor.ts:18`), and the rule that only a
  person decides rests on the actor.
- **Over MCP an agent can confirm by itself.** Under `enforce` the acknowledgement is the
  caller's, so "knowingly" holds for a person at a screen and not for an agent.

## Where each pattern arises

The bench specification's table said which screen needs which pattern. This says what
produces it.

| Pattern (proposal, 5.2) | T1 | T2 | T3 | T4 |
| --- | --- | --- | --- | --- |
| An error with its recovery | A loan of seed that has run out; no substitute | A failed row; a correction that is still wrong | A return recorded twice | A request already decided, expired, or approved with none left |
| An undo offer | `loan-create`, `waitlist-join` | `donation-import` | `loan-return` | `request-decide` |
| A confirmation before a destructive command | | | `variety-retire` | `request-clear` |
| An approval request | A held `loan-create` | | | |
| Progress | | `donation-import`, `donation-get` | | `request-decide`, approving |
| A choice among alternatives | `substitute-suggest` | `donation-match` | | |
| Warnings | Old seed, on `loan-create` | Some rows failed, on `donation-import` | Old seed, on `lot-list` | The member could not be told, on `request-decide` |
| Evidence for a result | | `donation-match` | `lot-list` | |
| A batch with some failures | | `donation-import` | | Several decisions in one `afd-batch` |
| An empty collection, a failed collection | `variety-list`, `member-list` | | `loan-list` | `request-list` |

- **The steward's screen shows the other side of an approval:** the held loans, with what was
  asked and until when. No command on that screen declares `approval`, and no default
  pattern covers the approver's side, so the cell is empty.

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
- **Five cells of the pattern table changed.** Warnings now arise on T2 and T4, an error with
  its recovery on T3, and an undo offer on T2. The approval request left T4. Alternatives,
  evidence and the approval request are missing from the held-back screen. The bench
  specification's table and its limit are updated.

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

What the review changed. An independent reviewer read the result the same day and walked the
two commands the walks had added:

- **Who calls, and through what, is written down.** The confirmation steps and the rule that
  only a person decides could not both hold for one caller on one surface, and the draft did
  not say which surface a screen, an agent or a scenario uses.
- **The twenty-four hours is a choice.** The draft called it a limit of the host. The host
  caps a hold, and nothing ties a request to its hold but this design.
- **The approval request left T4.** The reviewer found it a look-alike there.
- **The way-back rule says what it means.** `request-withdraw` and `donation-cancel` are
  takings back, undone by doing the thing again.
- **Smaller:** `variety-retire` is the steward's; the statuses and outcomes are listed; eight
  more refusals assert their `suggestion`; a harvest year in the future is `INVALID_INPUT`.

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
- **Marking `donation-cancel` destructive.** It would put a confirmation in front of an undo.
  Its own way back is entering the box again, which the rules now say.

## What a scenario could not express

Each file says at its top what it leaves out. Together:

- **`warnings`, `alternatives`, `sources`, `plan`, `undoCommand` and `undoArgs`** cannot be
  asserted. Five of the ten patterns render those fields. The steps assert the `data` the
  fields are built from, and run the command an undo names.
- **`confidence` is a floor.** A step can show that a match is at least 0.5 and cannot show
  that it is below 0.9. That a label was left for a person shows it.
- **One actor.** A scenario runs as one actor. The application's tests give every step a person
  with the steward's role, in place of the runner's test actor, which the application treats as
  nobody's. So no file shows a volunteer or an agent refused with `FORBIDDEN`; the
  application's own tests do.
- **A service that fails.** Jobs 6 and 17 are half shown: the empty list, and not the list
  that cannot be read (`SERVICE_UNAVAILABLE`).
- **One call a step.** Job 14's three decisions are three steps where the screen sends one
  `afd-batch`.
- **Work in progress.** The commands answer at once, so no step shows a batch that is still
  running.
- **A confirmation.** Its wording is the command's `confirmPrompt`, which a step cannot read.
  It is a fixed string on the command's definition, so it cannot name the variety or the date
  it is about; the screen shows the record beside it.
  The first steps of jobs 12 and 16, which expect `CONFIRMATION_REQUIRED`, would carry the
  command out in process. They pass against a server run with `confirmations: 'enforce'`
  whose `createContext` gives the runner a person with the steward's role; without that the
  server's actor is an agent (`packages/server/src/server-types.ts:193`), and the steward's commands
  are refused. They write `confirm` inside
  `input`, where an individual tool takes it; a grouped tool and `afd-call` take it beside
  the input.
- **An earlier step's result in `expect`.** The runner resolves a step reference only in
  `input`, and the parse and dry-run checks accept one in `expect` without saying so. Three
  steps compared a result with an earlier step's (jobs 1, 11 and 15); running them showed it,
  and they now name the id the fixture's counters give: `loan-2` and `lot-borlotti-29-r1`.

A screen's builder is given a fixture of each result as well, so the fields a scenario cannot
assert still reach the screen. They are in [`results/`](results/), and each state of a
screen's [task](tasks/README.md) names the ones its story mounts.

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

Since the application was built, its tests run the files instead
([What building it settled](#what-building-it-settled)).

## What building it settled

Built 2026-11-15 in `packages/examples/seed-library`. The commands, fields, refusals, trust
metadata, states and the host's part are as drafted above. Where the draft was silent, the
code chose the reading the scenarios and the results need:

- **Who is the steward.** A person (`actor.kind` `human`) whose id is one of the application's
  steward ids. Nobody else is: not an agent, not the scenario runner's test actor, and not a
  call with no actor.
- **Rare seed only through `request-decide`.** `loan-create` refuses a rare variety with
  `FORBIDDEN` when a cleared hold reaches it, naming `request-list` and the steward's
  `request-decide`. `FORBIDDEN` because the caller is known and not allowed this way, whoever
  it is; `CONFLICT` would say the state is wrong, and it is not.
- **A call with no actor** is held, as a policy fails closed, whatever the variety. For a rare
  variety the hold is the usual one: it records the request and its summary says it waits for
  the steward. For any other variety it records nothing, and its summary says it was held
  because the call names no actor; the same call with an actor lends.
- **One waiting request a member and variety.** `request-reopen` refuses with `CONFLICT`, naming
  `request-withdraw`, while another request for the pair waits.
- **Asking again** for a request that is waiting moves its `expiresAt` to the new hold's, so
  the expiry a refusal shows stays the request's. A reopened request waits a day from the
  reopening; no hold is made for it.
- **A request expires when it is next read or decided** after its hold ran out.
  `request-clear` takes a closed request's time as its decision, its withdrawal or the end of
  its hold, and `closedBefore` takes a date or a time.
- **The freshest lot** is the newest harvest, the better estimate first. A lot made by the
  library has an estimate from its age: 0.9 in its first year and 0.05 less each year after,
  so a 2029 lot is 0.85 in 2030. `lot-list`'s confidence weighs a tested lot at 0.9 and one
  judged by age at 0.6, by packets.
- **Ids** come from a counter per prefix (`loan-2`, `req-1`, `don-1`); a donated row's lot is
  `lot-<donation>-<index>`, and a return's lot is its loan's lot with `-r<n>`. A returned
  loan's own packet does not come back to the shelf; its saved seed does.
- **A label** matches a variety whose name it is, at a confidence of 1, or one the
  fixture's label matches offer; a retired variety's name fails the row with `NOT_FOUND`. A
  donated row without a harvest year is taken as last year's.
- **Moving a filed row** moves its lot, which keeps its id. A correction that is still wrong
  leaves the row as it was; one whose new label is unclear leaves the row for a person.
- **More refusals of the drafted kinds:** `loan-reopen` when packets of the return's lot have
  been lent, `request-reopen` when the approval's loan was returned, `waitlist-join` for a
  retired variety, each `CONFLICT`.
- **A list that cannot be read** is a flag on the store that only a test sets.

## Not done

- **The tasks and results for building sessions are drafted** in [`tasks/`](tasks/README.md)
  and [`results/`](results/): four screens, 50 states, 74 results. No reader other than their
  author and one reviewer has read them. A test in the application checks each result against
  its command's output schema and refusals; it does not check that the results follow one
  another.

- **The application is not merged,** and no reader other than its author has reviewed it.

## For the owner

On 2026-11-15 the owner accepted three design points: approval as a held loan, job 16, and the
approval request off T4, recorded as a limit in the bench specification. The list of jobs as
a whole is still open.

1. **The jobs.** Cut, add or change them. *Recommendation: keep the seventeen,* because each
   screen then meets every pattern the bench specification gives it, and three readers found
   no job missing inside the four screens. Confidence: medium.
2. **Job 16.** **Decided 2026-11-15: kept.** Removing a past season's closed requests is
   what gives T4 a command that cannot be undone. Without it a confirmation is tested only on
   T3, a screen the statements may be written from.
3. **Approval as a held loan.** **Decided 2026-11-15: kept.** The steward's request is a held
   `loan-create`, not a command of its own, because it tests the contract's `approval` and not
   a look-alike. It has a price, which this design chooses: a request
   expires with its hold, at most twenty-four hours later, so that the expiry a screen shows
   is the contract's. A request the steward does not decide within a day expires and the
   member asks again. The alternative is a request that outlives its hold and shows an
   expiry of the application's own.
