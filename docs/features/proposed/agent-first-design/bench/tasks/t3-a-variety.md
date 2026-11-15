# T3: A variety's page

Your task is to build one screen of the seed library: the page of one variety, with its lots
and its loans. Read [the library's rules](../seed-library.md#the-library) first.

## Who uses it, and for what

A desk volunteer, telling a member what to expect of a variety and recording returns, and the
steward, who retires a variety that has stopped coming true. The screen serves three jobs.
Each scenario file runs the job against the commands:

- [see-a-variety](../../../../../../packages/examples/seed-library/scenarios/10-see-a-variety.scenario.yaml): see the variety's lots, how
  well each is expected to germinate and on what evidence, and who has it out.
- [record-a-return](../../../../../../packages/examples/seed-library/scenarios/11-record-a-return.scenario.yaml): record a return and the
  new lot its saved seed makes, and take the return back if it was wrong.
- [retire-a-variety](../../../../../../packages/examples/seed-library/scenarios/12-retire-a-variety.scenario.yaml): retire the variety
  knowingly, since it cannot be brought back.

## Commands

The screen calls these, in process, through a DirectClient, as the signed-in person. Their
inputs, results and refusals are in [the drafted commands](../seed-library.md#drafted-commands),
and the values they take in [States](../seed-library.md#states).

- `variety-get`, `lot-list`, `loan-list`, and `variety-list` to reach another variety
- `loan-return`, `loan-reopen`
- `variety-retire`, which only a person with the steward's role may call

The application's data is in [`library.json`](../../../../../../packages/examples/seed-library/scenarios/fixtures/library.json).

## Retiring asks first

`variety-retire` is `destructive` and declares a `confirmPrompt`. A call made in process is
never held for a confirmation
([who calls, and through what](../seed-library.md#who-calls-and-through-what)): the
DirectClient would retire the variety at once. So the screen asks the person, with the
command's `confirmPrompt`, before it calls, and calls only if they confirm. The prompt is:

> Retire this variety? Its packets on the shelf are withdrawn and nobody can borrow it again.
> Loans already out stay open. This cannot be undone.

## States

The results are files in [`../results/t3-a-variety/`](../results/t3-a-variety/). A state's
story mounts every result in its row: the first is the one that makes the state, and the rest
are the page's other data at that moment, after any action the first one records. `$command`
names the command that returned a result, and `$input` its input or the screen's selection it
stands for. The fixture loader strips every key that starts with `$`.

Each state is a whole page of one variety: Borlotti bean, out on loan to one member; Parsnip,
whose only lot is old; or Love-in-a-mist, which the steward retires.

| State | What the person sees it as | Mounts | What the person must be able to do |
| --- | --- | --- | --- |
| `loading` | The variety is being fetched | Nothing: no call has answered | Tell that the variety is on its way |
| `variety` | Borlotti bean: its kind, whether it is rare, how many packets are on the shelf, its one lot with an estimate from the library's own test and the test it rests on, and who has it out and since when | [variety](../results/t3-a-variety/variety.json), [lots-tested](../results/t3-a-variety/lots-tested.json), [on-loan](../results/t3-a-variety/on-loan.json) | See how the estimate was reached and what it rests on; record the return of the loan, with any saved seed it brings |
| `old-seed` | Parsnip: its only lot is old seed, judged by its age, why the estimate is low and what it rests on; nobody has it out | [lots-old-seed](../results/t3-a-variety/lots-old-seed.json), [variety-parsnip](../results/t3-a-variety/variety-parsnip.json), [none-on-loan](../results/t3-a-variety/none-on-loan.json) | See that the seed is old before lending it, and why; tell that nobody has it out, and that nothing failed |
| `loans-unavailable` | Borlotti bean, but its loans cannot be read just now | [loans-unavailable](../results/t3-a-variety/loans-unavailable.json), [variety](../results/t3-a-variety/variety.json), [lots-tested](../results/t3-a-variety/lots-tested.json) | Try again; tell this apart from nobody having it out |
| `returned` | The loan was returned, its saved seed is a new lot, and the shelf has three more packets | [returned](../results/t3-a-variety/returned.json), [variety-after-return](../results/t3-a-variety/variety-after-return.json), [lots-after-return](../results/t3-a-variety/lots-after-return.json), [loans-after-return](../results/t3-a-variety/loans-after-return.json) | See the new lot; take the return back if it was entered wrong |
| `return-refused` | The return was already recorded, so recording it again was refused | [return-refused](../results/t3-a-variety/return-refused.json), [variety-after-return](../results/t3-a-variety/variety-after-return.json), [lots-after-return](../results/t3-a-variety/lots-after-return.json), [loans-after-return](../results/t3-a-variety/loans-after-return.json) | Take the earlier return back, then record it again |
| `return-taken-back` | The return was taken back: the loan is out again and the lot it made is gone | [return-taken-back](../results/t3-a-variety/return-taken-back.json), [variety](../results/t3-a-variety/variety.json), [lots-tested](../results/t3-a-variety/lots-tested.json), [on-loan](../results/t3-a-variety/on-loan.json) | Record the return again, with the right count |
| `confirm-retire` | Love-in-a-mist, which the steward has asked to retire; the screen asks with the prompt above and has not called | [variety-nigella](../results/t3-a-variety/variety-nigella.json), [lots-nigella](../results/t3-a-variety/lots-nigella.json), [loans-nigella](../results/t3-a-variety/loans-nigella.json) | Confirm, and only then is `variety-retire` called; or not go ahead, and nothing is called |
| `retired` | Love-in-a-mist is retired and its packets were withdrawn | [retired](../results/t3-a-variety/retired.json), [variety-nigella-retired](../results/t3-a-variety/variety-nigella-retired.json), [lots-nigella-retired](../results/t3-a-variety/lots-nigella-retired.json), [loans-nigella](../results/t3-a-variety/loans-nigella.json) | See when it was retired and how many packets were withdrawn |
| `variety-not-found` | The library has no such variety | [variety-not-found](../results/t3-a-variety/variety-not-found.json), [varieties](../results/t3-a-variety/varieties.json) | Find the variety meant among the library's varieties |

## What counts as done

- **One story file** for the screen, with one named story per state id above, named after the
  id. Each story mounts the screen with the results in its row, loaded from their files.
- **The screen is built from `violet-elements`** where a component fits.
- **Each contract field the state's results carry** reaches the screen, and each thing the
  person must be able to do in that state is an operable control with a name.
- **The `confirm-retire` story** is the moment the person is asked, with the prompt above,
  before any call is made.
