# T2: Take in a donation

Your task is to build one screen of the seed library: where a volunteer takes in a box of
donated packets as one batch. Read the library's rules in
[the seed library](../seed-library.md#the-library) first. The bare arm of step 0.1 is not given
this file.

## Who uses it, and for what

An intake volunteer, with a box of about forty donated packets, some with handwritten labels.
The screen serves three jobs. Each scenario file runs the job against the commands:

- [take-in-a-donation](../scenarios/07-take-in-a-donation.scenario.yaml): enter a box as one
  batch, see it worked through row by row, and take back a box entered twice.
- [settle-an-unclear-label](../scenarios/08-settle-an-unclear-label.scenario.yaml): see the
  likely matches for a label, why each was offered, and choose one.
- [fix-the-rows-that-failed](../scenarios/09-fix-the-rows-that-failed.scenario.yaml): see which
  rows failed and why, and put them right without entering the rest again.

## Commands

The screen calls these, in process, through a DirectClient, as the signed-in volunteer. Their
inputs, results and refusals are in [the drafted commands](../seed-library.md#drafted-commands).

- `donation-import`, `donation-get`, `donation-cancel`
- `donation-match`, `donation-settle`, `donation-correct`

`donation-import` is one command over many rows. It succeeds when some rows fail, and reports
each row in its own `data`: `succeeded`, `unsettled` and `failed`, each entry with the row's
`index`. A label is matched without a person only at a confidence of 0.9 or more; below that
the row is unsettled. The application's data is in
[`library.json`](../scenarios/fixtures/library.json).

## States

Each state's result is a file in
[`../results/t2-take-in-a-donation/`](../results/t2-take-in-a-donation/). `$command` names the
command that returned it and `$input` its input. Your fixture loader strips every key that
starts with `$`; what is left is the result as the DirectClient returns it.

| State | What the person sees it as | Result | What the person must be able to do | Pattern |
| --- | --- | --- | --- | --- |
| `new-box` | Nothing entered yet | None: no call has been made | Enter the rows of a box, each with its label, packets and harvest year, and send them as one batch | none |
| `importing` | The box is being worked through: one row in, one under way, one still to come | [importing.json](../results/t2-take-in-a-donation/importing.json) | Follow each row as it goes in | Progress |
| `imported` | Every row went in, each as a new lot | [imported.json](../results/t2-take-in-a-donation/imported.json) | See what each row became; take the whole box back if it was entered twice | An undo offer |
| `some-rows-failed` | One row went in and two could not, each for its own reason | [some-rows-failed.json](../results/t2-take-in-a-donation/some-rows-failed.json) | See which rows failed and why; put each right or leave it out, without entering the good row again | A batch with some failures; warnings |
| `label-unsettled` | The box went in, but one label could be several varieties and waits for a person | [label-unsettled.json](../results/t2-take-in-a-donation/label-unsettled.json) | Open the unsettled row to see its likely matches | none |
| `match-offered` | The likeliest variety for a label, how sure the library is, why, what that rests on, and the other varieties it could be | [match-offered.json](../results/t2-take-in-a-donation/match-offered.json) | Compare the matches and the reason for each; choose any one of them | A choice among alternatives; evidence for a result |
| `row-settled` | The label was filed under the chosen variety, as a new lot | [row-settled.json](../results/t2-take-in-a-donation/row-settled.json) | Move the row to another variety if the choice was wrong | none |
| `correction-refused` | A corrected row is still wrong and stays failed | [correction-refused.json](../results/t2-take-in-a-donation/correction-refused.json) | See what is still wrong; correct it again | An error with its recovery |
| `row-corrected` | The corrected row went in | [row-corrected.json](../results/t2-take-in-a-donation/row-corrected.json) | Go on to the next row that needs attention | none |
| `row-left-out` | The row was left out of the batch | [row-left-out.json](../results/t2-take-in-a-donation/row-left-out.json) | Go on to the next row that needs attention | none |
| `donation-complete` | Nothing is left to put right; the batch says what went in and what was left out | [donation-complete.json](../results/t2-take-in-a-donation/donation-complete.json) | See the outcome of every row; start the next box | none |
| `donation-cancelled` | The box entered twice was taken back, and its lots with it | [donation-cancelled.json](../results/t2-take-in-a-donation/donation-cancelled.json) | See how many lots were removed; enter the box again if it was taken back by mistake | none |
| `validation-refused` | A batch with no rows was refused | [validation-refused.json](../results/t2-take-in-a-donation/validation-refused.json) | Add a row and send the batch again | An error with its recovery |

`importing` is the one state no scenario shows: the commands answer at once, so only this
fixture puts a batch that is still running on the screen.

## What counts as done

- **One story file** for the screen, with one named story per state id above, named after the
  id. Each story mounts the screen with that state's result, loaded from its file.
- **The screen is built from `violet-elements`** where a component fits.
- **Each contract field the state's result carries** reaches the screen, and each thing the
  person must be able to do in that state is an operable control with a name.
