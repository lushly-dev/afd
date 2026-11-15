# Bench tasks

What a building session of the [bench](../../bench.md#what-a-session-is-given) is given for one
screen of the [seed library](../seed-library.md). This README is not given to a session; the
bench specification says what each arm reads.

- **Tasks:** one file a screen, [T1](t1-lend-a-packet.md), [T2](t2-take-in-a-donation.md),
  [T3](t3-a-variety.md) and [T4](t4-the-stewards-requests.md). Each lists the screen's jobs,
  its commands, its states with what the person must be able to do in each, and what counts as
  done. A task names no pattern and links only the parts of the seed library that are in the
  builder's extract.
- **Results:** [`../results/`](../results/), one folder a screen, each file one CommandResult as
  the command returns it on the wire. `$command` names the command and `$input` its input; a
  screen's fixture loader strips every key that starts with `$`.

## How the files map

A task's table has one row a state. The state's id names the story the session writes. The row
lists every result that story mounts, so that each story mounts on its own:

- **The first result makes the state.** Its file is named after the state where it can be:
  state `lent` in T1 mounts [`lent.json`](../results/t1-lend-a-packet/lent.json) first.
- **The rest are the screen's other data at that moment,** after any action the first result
  records: `lent` also mounts the shelf with one packet fewer and the member it went to. A
  result may serve several states, and some results serve only as such data.
- **`$input` may stand for the screen's selection** rather than a call the state makes: the
  search the volunteer typed, the variety the page is about, or the list the steward has open.
- **A state with no result,** such as loading, says so in its row. A confirmation state mounts
  what the screen shows while it asks; the question is the command's `confirmPrompt`, written
  in the task.

## Drafts

The results were drafted against the [drafted commands](../seed-library.md#drafted-commands),
and a test in the application checks each against its command's output schema and refusals.
They use the invented data in
[the scenarios' fixtures](../../../../../../packages/examples/seed-library/scenarios/fixtures/) and agree with the scenario files. When a
command, a fixture or a scenario changes, the results and the tasks change with it.
