# T4: The steward's requests

Your task is to build one screen of the seed library: the steward's list of requests for rare
seed. Read [the library's rules](../seed-library.md#the-library) first.

## Who uses it, and for what

The steward, deciding about twenty requests in an evening. A request is a loan of a rare
variety that was held when the desk asked for it; it waits until its hold expires, a day
later. The steward's approval makes the loan. The screen serves five jobs. Each scenario file
runs the job against the commands:

- [decide-a-request](../../../../../../packages/examples/seed-library/scenarios/13-decide-a-request.scenario.yaml): see who asked for what,
  and approve or decline it.
- [decide-several-at-once](../../../../../../packages/examples/seed-library/scenarios/14-decide-several-at-once.scenario.yaml): decide a set
  in one go and see which did not go through and why.
- [take-a-decision-back](../../../../../../packages/examples/seed-library/scenarios/15-take-a-decision-back.scenario.yaml): reopen a request
  approved or declined by mistake.
- [clear-a-past-season](../../../../../../packages/examples/seed-library/scenarios/16-clear-a-past-season.scenario.yaml): remove a past
  season's closed requests, knowingly, since they cannot be brought back.
- [nothing-waiting](../../../../../../packages/examples/seed-library/scenarios/17-nothing-waiting.scenario.yaml): be told plainly that
  nothing is waiting.

## Commands

The screen calls these, in process, through a DirectClient, as the signed-in steward. Their
inputs, results and refusals are in [the drafted commands](../seed-library.md#drafted-commands),
and the values they take in [States](../seed-library.md#states).

- `request-list`, `request-decide`, `request-reopen`, `request-clear`
- `waitlist-join`, for a member whose approval found nothing left
- `afd-batch`, to send several `request-decide` calls as one; its result has one entry per
  call, shaped as [`spec/wire/batch-result.json`](../../../../../../spec/wire/batch-result.json)

The application's data is [`steward.json`](../../../../../../packages/examples/seed-library/scenarios/fixtures/steward.json) on top of
[`library.json`](../../../../../../packages/examples/seed-library/scenarios/fixtures/library.json).

## Clearing asks first

`request-clear` is `destructive` and declares a `confirmPrompt`. A call made in process is
never held for a confirmation
([who calls, and through what](../seed-library.md#who-calls-and-through-what)): the
DirectClient would remove the requests at once. So the screen asks the steward, with the
command's `confirmPrompt`, before it calls, and calls only if they confirm. The prompt is:

> Remove every closed request from before this date? They hold members' names against what
> they asked for, and they cannot be brought back. Requests still waiting are not touched.

## States

The results are files in
[`../results/t4-the-stewards-requests/`](../results/t4-the-stewards-requests/). A state's
story mounts every result in its row: the first is the one that makes the state, and the rest
are the screen's other data at that moment, after any action the first one records.
`$command` names the command that returned a result, and `$input` its input or the screen's
selection it stands for. The fixture loader strips every key that starts with `$`.

The decisions follow one evening: `req-1` is approved, `req-2` declined and `req-3` approved,
in that order, from two packets on the shelf. `batch-some-failed` and `reopened` start again
from the three waiting.

| State | What the person sees it as | Mounts | What the person must be able to do |
| --- | --- | --- | --- |
| `loading` | The requests are being fetched | Nothing: no call has answered | Tell that the requests are on their way |
| `waiting` | Three requests wait, oldest first: who asked, for what, when the request expires, and how many packets there are to give | [waiting](../results/t4-the-stewards-requests/waiting.json) | Approve or decline one, with a reason for a decline; choose several and decide them in one go; see the closed requests |
| `approved` | The request was approved: the shelf was checked, the loan made, the member told; two still wait | [approved](../results/t4-the-stewards-requests/approved.json), [pending-after-approve](../results/t4-the-stewards-requests/pending-after-approve.json) | See each step of the approval and the loan it made; take the decision back |
| `declined` | The request was declined, and the member told; one still waits | [declined](../results/t4-the-stewards-requests/declined.json), [pending-after-decline](../results/t4-the-stewards-requests/pending-after-decline.json) | Take the decision back |
| `approved-member-not-told` | The last request was approved and the loan made, but the member could not be told; nothing still waits | [approved-member-not-told](../results/t4-the-stewards-requests/approved-member-not-told.json), [nothing-waiting](../results/t4-the-stewards-requests/nothing-waiting.json) | See which step did not happen and that the member still has to be told; take the decision back |
| `already-decided` | The list was loaded before the request was decided elsewhere, so deciding it here was refused | [already-decided](../results/t4-the-stewards-requests/already-decided.json), [waiting](../results/t4-the-stewards-requests/waiting.json) | See that it was decided already; reopen it, then decide it again; load the list again |
| `expired` | The list was loaded before the request's hold ran out, and approving it after was refused | [expired](../results/t4-the-stewards-requests/expired.json), [pending-before-expiry](../results/t4-the-stewards-requests/pending-before-expiry.json) | See when it expired and that the member has to ask again at the desk; load the list again |
| `batch-some-failed` | Three approvals sent in one go: two went through, and one found no packet left and still waits | [batch-some-failed](../results/t4-the-stewards-requests/batch-some-failed.json), [pending-after-batch](../results/t4-the-stewards-requests/pending-after-batch.json) | See which went through and which did not, and why; put that member on the waiting list and decline the request; take back either approval |
| `reopened` | The approval was taken back: the request waits again for a fresh day, and the loan it made is cancelled | [reopened](../results/t4-the-stewards-requests/reopened.json), [pending-after-reopen](../results/t4-the-stewards-requests/pending-after-reopen.json) | Decide it again |
| `confirm-clear` | The closed requests; the steward has asked to remove those from before a date, and the screen asks with the prompt above and has not called | [closed-requests](../results/t4-the-stewards-requests/closed-requests.json) | Choose the date; confirm, and only then is `request-clear` called; or not go ahead, and nothing is called |
| `cleared` | The closed requests from before the date were removed | [cleared](../results/t4-the-stewards-requests/cleared.json), [closed-after-clear](../results/t4-the-stewards-requests/closed-after-clear.json) | See how many were removed |
| `nothing-waiting` | Nothing is waiting for the steward | [nothing-waiting](../results/t4-the-stewards-requests/nothing-waiting.json) | Tell that nothing is waiting, and that nothing failed |
| `list-unavailable` | The requests cannot be read just now | [list-unavailable](../results/t4-the-stewards-requests/list-unavailable.json) | Try again; tell this apart from nothing waiting |

## What counts as done

- **One story file** for the screen, with one named story per state id above, named after the
  id. Each story mounts the screen with the results in its row, loaded from their files.
- **The screen is built from `violet-elements`** where a component fits.
- **Each contract field the state's results carry** reaches the screen, and each thing the
  person must be able to do in that state is an operable control with a name.
- **The `confirm-clear` story** is the moment the person is asked, with the prompt above,
  before any call is made.
