# T3: A variety's page

Your task is to build one screen of the seed library: the page of one variety, with its lots
and its loans. Read the library's rules in [the seed library](../seed-library.md#the-library)
first. The bare arm of step 0.1 is not given this file.

## Who uses it, and for what

A desk volunteer, telling a member what to expect of a variety and recording returns, and the
steward, who retires a variety that has stopped coming true. The screen serves three jobs.
Each scenario file runs the job against the commands:

- [see-a-variety](../scenarios/10-see-a-variety.scenario.yaml): see the variety's lots, how
  well each is expected to germinate and on what evidence, and who has it out.
- [record-a-return](../scenarios/11-record-a-return.scenario.yaml): record a return and the
  new lot its saved seed makes, and take the return back if it was wrong.
- [retire-a-variety](../scenarios/12-retire-a-variety.scenario.yaml): retire the variety
  knowingly, since it cannot be brought back.

## Commands

The screen calls these, in process, through a DirectClient, as the signed-in person. Their
inputs, results and refusals are in [the drafted commands](../seed-library.md#drafted-commands).

- `variety-get`, `lot-list`, `loan-list`
- `loan-return`, `loan-reopen`
- `variety-retire`, which only a person with the steward's role may call

The application's data is in [`library.json`](../scenarios/fixtures/library.json).

## Retiring asks first

`variety-retire` is `destructive` and declares a `confirmPrompt`. A call made in process is
never held for a confirmation
([who calls, and through what](../seed-library.md#who-calls-and-through-what)): the
DirectClient would retire the variety at once. So the screen asks the person before it
calls, with the command's `confirmPrompt`, and calls only if they confirm. The prompt is:

> Retire this variety? Its packets on the shelf are withdrawn and nobody can borrow it again.
> Loans already out stay open. This cannot be undone.

## States

Each state's result is a file in [`../results/t3-a-variety/`](../results/t3-a-variety/).
`$command` names the command that returned it and `$input` its input. Your fixture loader
strips every key that starts with `$`; what is left is the result as the DirectClient returns
it.

| State | What the person sees it as | Result | What the person must be able to do | Pattern |
| --- | --- | --- | --- | --- |
| `loading` | The variety is being fetched | None: no call has answered | Tell that the variety is on its way | none |
| `variety` | The variety: its kind, whether it is rare, how many packets are on the shelf, and who is waiting for it | [variety.json](../results/t3-a-variety/variety.json) | See its lots and loans; record a return; retire it, as the steward | none |
| `lots-tested` | Its lots, each with how well it is expected to germinate, from the library's own test, and what that rests on | [lots-tested.json](../results/t3-a-variety/lots-tested.json) | Tell a tested estimate from one judged by age; see the test it rests on | Evidence for a result |
| `lots-old-seed` | Its only lot is old seed, judged by its age, and why the estimate is low | [lots-old-seed.json](../results/t3-a-variety/lots-old-seed.json) | See that the seed is old before lending it; see what the estimate rests on | Warnings; evidence for a result |
| `on-loan` | Who has the variety out, and since when | [on-loan.json](../results/t3-a-variety/on-loan.json) | Record the return of a loan, with any saved seed it brings | none |
| `none-on-loan` | Nobody has the variety out | [none-on-loan.json](../results/t3-a-variety/none-on-loan.json) | Tell that nobody has it, and that nothing failed | An empty collection |
| `loans-unavailable` | The loans cannot be read just now | [loans-unavailable.json](../results/t3-a-variety/loans-unavailable.json) | Try again; tell this apart from nobody having it out | A failed collection |
| `returned` | The loan was returned, and its saved seed is a new lot | [returned.json](../results/t3-a-variety/returned.json) | See the new lot; take the return back if it was entered wrong | An undo offer |
| `return-refused` | The return was already recorded, so recording it again was refused | [return-refused.json](../results/t3-a-variety/return-refused.json) | Take the earlier return back, then record it again | An error with its recovery |
| `return-taken-back` | The return was taken back: the loan is out again and the lot it made is gone | [return-taken-back.json](../results/t3-a-variety/return-taken-back.json) | Record the return again, with the right count | none |
| `confirm-retire` | The steward has asked to retire the variety, and the screen is asking with the prompt above before it calls | [confirm-retire.json](../results/t3-a-variety/confirm-retire.json), the variety being retired; the prompt comes from the command's definition | Confirm, which calls `variety-retire`; or step back, which calls nothing | A confirmation before a destructive command |
| `retired` | The variety is retired and its packets were withdrawn | [retired.json](../results/t3-a-variety/retired.json) | See when it was retired and how many packets were withdrawn; still record returns of loans already out | none |
| `variety-not-found` | The library has no such variety | [variety-not-found.json](../results/t3-a-variety/variety-not-found.json) | Go to the list of varieties to find the one meant | An error with its recovery |

## What counts as done

- **One story file** for the screen, with one named story per state id above, named after the
  id. Each story mounts the screen with that state's result, loaded from its file.
- **The screen is built from `violet-elements`** where a component fits.
- **Each contract field the state's result carries** reaches the screen, and each thing the
  person must be able to do in that state is an operable control with a name.
- **The confirmation's story** shows the question open, with the prompt above, before any call.
