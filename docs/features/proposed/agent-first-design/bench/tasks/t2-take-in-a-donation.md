# T2: Take in a donation

Your task is to build one screen of the seed library: where a volunteer takes in a box of
donated packets as one batch. Read [the library's rules](../seed-library.md#the-library) first.

## Who uses it, and for what

An intake volunteer, with a box of about forty donated packets, some with handwritten labels.
The screen serves three jobs. Each scenario file runs the job against the commands:

- [take-in-a-donation](../../../../../../packages/examples/seed-library/scenarios/07-take-in-a-donation.scenario.yaml): enter a box as one
  batch, see it worked through row by row, and take back a box entered twice.
- [settle-an-unclear-label](../../../../../../packages/examples/seed-library/scenarios/08-settle-an-unclear-label.scenario.yaml): see the
  likely matches for a label, why each was offered, and choose one.
- [fix-the-rows-that-failed](../../../../../../packages/examples/seed-library/scenarios/09-fix-the-rows-that-failed.scenario.yaml): see which
  rows failed and why, and put them right without entering the rest again.

## Commands

The screen calls these, in process, through a DirectClient, as the signed-in volunteer. Their
inputs, results and refusals are in [the drafted commands](../seed-library.md#drafted-commands),
and the values they take in [States](../seed-library.md#states).

- `donation-import`, `donation-get`, `donation-cancel`
- `donation-match`, `donation-settle`, `donation-correct`

`donation-import` is one command over many rows. It succeeds when some rows fail, and reports
each row in its own `data`: `succeeded`, `unsettled` and `failed`, each entry with the row's
`index`. A label is matched without a person only at a confidence of 0.9 or more; below that
the row is unsettled. The application's data is in
[`library.json`](../../../../../../packages/examples/seed-library/scenarios/fixtures/library.json).

## States

The results are files in [`../results/t2-take-in-a-donation/`](../results/t2-take-in-a-donation/).
A state's story mounts every result in its row: the first is the one that makes the state, and
the rest are the screen's other data at that moment, after any action the first one records.
`$command` names the command that returned a result, and `$input` its input or the screen's
selection it stands for. The fixture loader strips every key that starts with `$`.

The states follow three boxes: `don-1` goes in whole, `don-2` has a label that could be
several varieties, and `don-3` has two rows that fail.

| State | What the person sees it as | Mounts | What the person must be able to do |
| --- | --- | --- | --- |
| `new-box` | Nothing entered yet | Nothing: no call has been made | Enter the rows of a box, each with its label, packets and harvest year, and send them as one batch |
| `importing` | The box is being worked through: one row in, one under way, one still to come | [importing](../results/t2-take-in-a-donation/importing.json) | Follow each row as it goes in |
| `imported` | Every row went in, each as a new lot | [imported](../results/t2-take-in-a-donation/imported.json) | See what each row became; take the whole box back if it was entered twice |
| `donation-cancelled` | The box entered twice was taken back, and its lots with it | [donation-cancelled](../results/t2-take-in-a-donation/donation-cancelled.json), [don-1-cancelled](../results/t2-take-in-a-donation/don-1-cancelled.json) | See how many lots were removed; enter the box again if it was taken back by mistake |
| `label-unsettled` | The box went in, but one label could be several varieties and waits for a person | [label-unsettled](../results/t2-take-in-a-donation/label-unsettled.json) | Ask for the likely matches of the unsettled row |
| `match-offered` | The likeliest variety for a label, how sure the library is, why, what that rests on, and the other varieties it could be | [match-offered](../results/t2-take-in-a-donation/match-offered.json), [label-unsettled](../results/t2-take-in-a-donation/label-unsettled.json) | Compare the matches and the reason for each; choose any one of them |
| `row-settled` | The label was filed under the chosen variety, as a new lot, and the box is complete | [row-settled](../results/t2-take-in-a-donation/row-settled.json), [don-2-settled](../results/t2-take-in-a-donation/don-2-settled.json) | Move the row to another variety if the choice was wrong |
| `some-rows-failed` | One row went in and two could not, each for its own reason | [some-rows-failed](../results/t2-take-in-a-donation/some-rows-failed.json) | See which rows failed and why; put each right or leave it out, without entering the good row again |
| `correction-refused` | A corrected row is still wrong and stays failed | [correction-refused](../results/t2-take-in-a-donation/correction-refused.json), [some-rows-failed](../results/t2-take-in-a-donation/some-rows-failed.json) | See what is still wrong; correct it again |
| `row-corrected` | The corrected row went in; one row still needs attention | [row-corrected](../results/t2-take-in-a-donation/row-corrected.json), [don-3-corrected](../results/t2-take-in-a-donation/don-3-corrected.json) | Go on to the row that still needs attention |
| `row-left-out` | The last failed row was left out, and nothing is left to put right | [row-left-out](../results/t2-take-in-a-donation/row-left-out.json), [donation-complete](../results/t2-take-in-a-donation/donation-complete.json) | See that the batch is complete and what was left out |
| `donation-complete` | The batch says what went in and what was left out | [donation-complete](../results/t2-take-in-a-donation/donation-complete.json) | See the outcome of every row; start the next box |
| `validation-refused` | A batch with no rows was refused | [validation-refused](../results/t2-take-in-a-donation/validation-refused.json) | See why; add a row and send the batch again |

`importing` is the one state no scenario shows: the commands answer at once, so only this
result puts a batch that is still running on the screen. `validation-refused` is the host's
answer to input that fails the command's schema, so its `suggestion` names fields, not a
command.

## What counts as done

- **One story file** for the screen, with one named story per state id above, named after the
  id. Each story mounts the screen with the results in its row, loaded from their files.
- **The screen is built from `violet-elements`** where a component fits.
- **Each contract field the state's results carry** reaches the screen, and each thing the
  person must be able to do in that state is an operable control with a name.
