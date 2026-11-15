# T4: The steward's requests

Your task is to build one screen of the seed library: the steward's list of requests for rare
seed. Read the library's rules in [the seed library](../seed-library.md#the-library) first.
The bare arm of step 0.1 is not given this file.

## Who uses it, and for what

The steward, deciding about twenty requests in an evening. A request is a loan of a rare
variety that was held when the desk asked for it; it waits until its hold expires, a day
later. The steward's approval makes the loan. The screen serves five jobs. Each scenario file
runs the job against the commands:

- [decide-a-request](../scenarios/13-decide-a-request.scenario.yaml): see who asked for what,
  and approve or decline it.
- [decide-several-at-once](../scenarios/14-decide-several-at-once.scenario.yaml): decide a set
  in one go and see which did not go through and why.
- [take-a-decision-back](../scenarios/15-take-a-decision-back.scenario.yaml): reopen a request
  approved or declined by mistake.
- [clear-a-past-season](../scenarios/16-clear-a-past-season.scenario.yaml): remove a past
  season's closed requests, knowingly, since they cannot be brought back.
- [nothing-waiting](../scenarios/17-nothing-waiting.scenario.yaml): be told plainly that
  nothing is waiting.

## Commands

The screen calls these, in process, through a DirectClient, as the signed-in steward. Their
inputs, results and refusals are in [the drafted commands](../seed-library.md#drafted-commands).

- `request-list`, `request-decide`, `request-reopen`, `request-clear`
- `waitlist-join`, for a member whose approval found nothing left
- `afd-batch`, to send several `request-decide` calls as one; its result has one entry per
  call, shaped as [`spec/wire/batch-result.json`](../../../../../../spec/wire/batch-result.json)

The application's data is [`steward.json`](../scenarios/fixtures/steward.json) on top of
[`library.json`](../scenarios/fixtures/library.json).

## Clearing asks first

`request-clear` is `destructive` and declares a `confirmPrompt`. A call made in process is
never held for a confirmation
([who calls, and through what](../seed-library.md#who-calls-and-through-what)): the
DirectClient would remove the requests at once. So the screen asks the steward before it
calls, with the command's `confirmPrompt`, and calls only if they confirm. The prompt is:

> Remove every closed request from before this date? They hold members' names against what
> they asked for, and they cannot be brought back. Requests still waiting are not touched.

## States

Each state's result is a file in
[`../results/t4-the-stewards-requests/`](../results/t4-the-stewards-requests/). `$command`
names the command that returned it and `$input` its input. Your fixture loader strips every
key that starts with `$`; what is left is the result as the DirectClient returns it.

| State | What the person sees it as | Result | What the person must be able to do | Pattern |
| --- | --- | --- | --- | --- |
| `loading` | The requests are being fetched | None: no call has answered | Tell that the requests are on their way | none |
| `waiting` | Three requests wait, oldest first: who asked, for what, when the request expires, and how many packets there are to give | [waiting.json](../results/t4-the-stewards-requests/waiting.json) | Approve or decline one, with a reason for a decline; choose several and decide them in one go | none |
| `approved` | The request was approved: the shelf was checked, the loan made, the member told | [approved.json](../results/t4-the-stewards-requests/approved.json) | See each step of the approval and the loan it made; take the decision back | Progress; an undo offer |
| `declined` | The request was declined, and the member told | [declined.json](../results/t4-the-stewards-requests/declined.json) | Take the decision back | An undo offer |
| `approved-member-not-told` | The request was approved and the loan made, but the member could not be told | [approved-member-not-told.json](../results/t4-the-stewards-requests/approved-member-not-told.json) | See which step did not happen and that the member still has to be told; take the decision back | Warnings; progress |
| `already-decided` | The request was decided before, so deciding it again was refused | [already-decided.json](../results/t4-the-stewards-requests/already-decided.json) | Reopen the request, then decide it again | An error with its recovery |
| `expired` | The request expired before it was decided | [expired.json](../results/t4-the-stewards-requests/expired.json) | See when it expired and that the member has to ask again at the desk | An error with its recovery |
| `batch-some-failed` | Three approvals sent in one go: two went through, and one found no packet left | [batch-some-failed.json](../results/t4-the-stewards-requests/batch-some-failed.json) | See which went through and which did not, and why; put that member on the waiting list and decline the request; take back either approval | A batch with some failures |
| `reopened` | The decision was taken back: the request waits again for a fresh day, and the loan it made is cancelled | [reopened.json](../results/t4-the-stewards-requests/reopened.json) | Decide it again | none |
| `confirm-clear` | The steward has asked to remove closed requests from before a date, and the screen is asking with the prompt above before it calls | [confirm-clear.json](../results/t4-the-stewards-requests/confirm-clear.json), the closed requests (`status: closed`); the prompt comes from the command's definition | Choose the date; confirm, which calls `request-clear`; or step back, which calls nothing | A confirmation before a destructive command |
| `cleared` | The closed requests from before the date were removed | [cleared.json](../results/t4-the-stewards-requests/cleared.json) | See how many were removed | none |
| `nothing-waiting` | Nothing is waiting for the steward | [nothing-waiting.json](../results/t4-the-stewards-requests/nothing-waiting.json) | Tell that nothing is waiting, and that nothing failed | An empty collection |
| `list-unavailable` | The requests cannot be read just now | [list-unavailable.json](../results/t4-the-stewards-requests/list-unavailable.json) | Try again; tell this apart from nothing waiting | A failed collection |

## What counts as done

- **One story file** for the screen, with one named story per state id above, named after the
  id. Each story mounts the screen with that state's result, loaded from its file.
- **The screen is built from `violet-elements`** where a component fits.
- **Each contract field the state's result carries** reaches the screen, and each thing the
  person must be able to do in that state is an operable control with a name.
- **The confirmation's story** shows the question open, with the prompt above, before any call.
