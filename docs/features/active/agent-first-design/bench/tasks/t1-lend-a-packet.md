# T1: Lend a packet

Your task is to build one screen of the seed library: the desk where a volunteer lends packets
of seed to members. Read [the library's rules](../seed-library.md#the-library) first.

## Who uses it, and for what

A desk volunteer, on the morning of a seed swap, lending to about sixty members. The screen
serves six jobs. Each scenario file runs the job against the commands:

- [lend-a-packet](../../../../../../packages/examples/seed-library/scenarios/01-lend-a-packet.scenario.yaml): find the member and the
  variety and lend a packet in one go.
- [out-of-seed](../../../../../../packages/examples/seed-library/scenarios/02-out-of-seed.scenario.yaml): when a variety has run out, offer
  a close substitute or put the member on the waiting list.
- [rare-needs-the-steward](../../../../../../packages/examples/seed-library/scenarios/03-rare-needs-the-steward.scenario.yaml): ask the
  steward for a rare variety and see that the request is waiting.
- [take-back-a-loan](../../../../../../packages/examples/seed-library/scenarios/04-take-back-a-loan.scenario.yaml): take a loan made by
  mistake back at once.
- [warn-about-old-seed](../../../../../../packages/examples/seed-library/scenarios/05-warn-about-old-seed.scenario.yaml): be told, as a
  packet is lent, that the only seed left is old.
- [nothing-to-show](../../../../../../packages/examples/seed-library/scenarios/06-nothing-to-show.scenario.yaml): tell a search that found
  nothing from a catalogue that cannot be read.

## Commands

The screen calls these, in process, through a DirectClient, as the signed-in volunteer. Their
inputs, results and refusals are in [the drafted commands](../seed-library.md#drafted-commands),
and the values they take in [States](../seed-library.md#states).

- `member-list`, `variety-list`, `variety-get`
- `loan-create`, `loan-cancel`
- `substitute-suggest`, `waitlist-join`, `waitlist-leave`
- `request-list`, `request-withdraw`

A loan of a rare variety is held for the steward, whoever asks. The refusal is
`APPROVAL_REQUIRED`, and the application has already recorded it as a request
([what the application asks of the host](../seed-library.md#what-the-application-asks-of-the-host));
nothing at the desk approves it. The application's data is in
[`library.json`](../../../../../../packages/examples/seed-library/scenarios/fixtures/library.json).

## States

The results are files in [`../results/t1-lend-a-packet/`](../results/t1-lend-a-packet/). A
state's story mounts every result in its row: the first is the one that makes the state, and
the rest are the screen's other data at that moment, after any action the first one records.
`$command` names the command that returned a result, and `$input` its input or the screen's
selection it stands for. The fixture loader strips every key that starts with `$`.

| State | What the person sees it as | Mounts | What the person must be able to do |
| --- | --- | --- | --- |
| `loading` | The desk's data is being fetched | Nothing: no call has answered | Tell that the data is on its way |
| `member-found` | The member the volunteer searched for, with the number that tells two of one name apart, and every variety with how many packets are on the shelf, whether it is rare, and how well the seed a loan would take is expected to germinate | [member-found](../results/t1-lend-a-packet/member-found.json), [catalogue](../results/t1-lend-a-packet/catalogue.json) | Choose the member; search for a variety; lend one; tell an old, a rare and an empty variety from the rest before lending |
| `lent` | The packet was lent, from the freshest lot, and the shelf has one fewer | [lent](../results/t1-lend-a-packet/lent.json), [shelf-after-lent](../results/t1-lend-a-packet/shelf-after-lent.json), [member-found](../results/t1-lend-a-packet/member-found.json) | See which lot it came from; take the loan back at once |
| `lent-old-seed` | The packet was lent, and the seed in it is old | [lent-old-seed](../results/t1-lend-a-packet/lent-old-seed.json), [shelf-after-old-seed](../results/t1-lend-a-packet/shelf-after-old-seed.json), [member-found](../results/t1-lend-a-packet/member-found.json) | See how well the seed is expected to germinate and on what basis; take the loan back so the member can choose something else |
| `loan-taken-back` | The loan was taken back and the packet is on the shelf again | [loan-taken-back](../results/t1-lend-a-packet/loan-taken-back.json), [shelf-after-cancel](../results/t1-lend-a-packet/shelf-after-cancel.json), [member-found](../results/t1-lend-a-packet/member-found.json) | Lend again, to the right member or of the right variety |
| `out-of-stock` | The variety asked for has run out | [out-of-stock](../results/t1-lend-a-packet/out-of-stock.json), [member-found](../results/t1-lend-a-packet/member-found.json), [catalogue](../results/t1-lend-a-packet/catalogue.json) | Ask for a substitute; put the member on the waiting list |
| `substitutes-offered` | The closest substitute on the shelf, why, how sure the library is of it, and the others it considered | [substitutes-offered](../results/t1-lend-a-packet/substitutes-offered.json), [member-found](../results/t1-lend-a-packet/member-found.json), [catalogue](../results/t1-lend-a-packet/catalogue.json) | Compare the substitutes and lend any one of them; take none and join the waiting list instead |
| `no-substitute` | The variety has run out and nothing the library keeps is like it | [no-substitute](../results/t1-lend-a-packet/no-substitute.json), [member-found](../results/t1-lend-a-packet/member-found.json), [catalogue](../results/t1-lend-a-packet/catalogue.json) | Put the member on the waiting list |
| `waitlist-joined` | The member is on the waiting list for the variety, at their place in it | [waitlist-joined](../results/t1-lend-a-packet/waitlist-joined.json), [runner-waiting](../results/t1-lend-a-packet/runner-waiting.json), [member-found](../results/t1-lend-a-packet/member-found.json), [catalogue](../results/t1-lend-a-packet/catalogue.json) | See their position and who is waiting; take them off the list again |
| `held-for-steward` | The loan of a rare variety was not made; the request waits for the steward, until a stated time | [held-for-steward](../results/t1-lend-a-packet/held-for-steward.json), [member-requests](../results/t1-lend-a-packet/member-requests.json), [member-found](../results/t1-lend-a-packet/member-found.json), [catalogue](../results/t1-lend-a-packet/catalogue.json) | See what was asked, where it waits and until when; withdraw the request if the member changes their mind |
| `request-withdrawn` | The member's request was withdrawn, and nothing of theirs waits for the steward | [request-withdrawn](../results/t1-lend-a-packet/request-withdrawn.json), [member-requests-none](../results/t1-lend-a-packet/member-requests-none.json), [member-found](../results/t1-lend-a-packet/member-found.json), [catalogue](../results/t1-lend-a-packet/catalogue.json) | Ask the steward again, by lending again |
| `no-variety-match` | The search found no variety | [no-variety-match](../results/t1-lend-a-packet/no-variety-match.json), [member-found](../results/t1-lend-a-packet/member-found.json) | Search again with other words |
| `no-member-match` | The search found no member | [no-member-match](../results/t1-lend-a-packet/no-member-match.json), [catalogue](../results/t1-lend-a-packet/catalogue.json) | Search again with another name or number |
| `catalogue-unavailable` | The catalogue cannot be read just now | [catalogue-unavailable](../results/t1-lend-a-packet/catalogue-unavailable.json), [member-found](../results/t1-lend-a-packet/member-found.json) | Try again; tell this apart from a search that found nothing |

## What counts as done

- **One story file** for the screen, with one named story per state id above, named after the
  id. Each story mounts the screen with the results in its row, loaded from their files.
- **The screen is built from `violet-elements`** where a component fits.
- **Each contract field the state's results carry** reaches the screen, and each thing the
  person must be able to do in that state is an operable control with a name.
