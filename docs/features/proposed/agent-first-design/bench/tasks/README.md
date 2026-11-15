# Bench tasks

What a building session of the [bench](../../bench.md#what-a-session-is-given) is given for one
screen of the [seed library](../seed-library.md), beside the jobs and the commands.

- **Tasks:** one file a screen, [T1](t1-lend-a-packet.md), [T2](t2-take-in-a-donation.md),
  [T3](t3-a-variety.md) and [T4](t4-the-stewards-requests.md). Each lists the screen's jobs,
  its commands, its states with what the person must be able to do in each, and what counts as
  done. T4 is held back from whoever writes the first pattern statements, and the bare arm of
  step 0.1 is given none of these files.
- **Results:** [`../results/`](../results/), one folder a screen and one CommandResult a state,
  as the command returns it on the wire. `$command` and `$input` say what produced it; a
  screen's fixture loader strips every key that starts with `$`.

## How the files map

A task's table has one row a state. The row's id names the story the session writes and the
result file that story mounts: state `lent` in T1 is
[`../results/t1-lend-a-packet/lent.json`](../results/t1-lend-a-packet/lent.json). A state
with no result, such as loading, says so in its row. A confirmation state's result is what the
screen shows while it asks; the question is the command's `confirmPrompt`, written in the task.

## Drafts

The results are drafts against the [drafted commands](../seed-library.md#drafted-commands),
which have no schema yet. They use the invented data in
[`../scenarios/fixtures/`](../scenarios/fixtures/) and agree with the scenario files. When a
command, a fixture or a scenario changes, the results and the tasks change with it.
