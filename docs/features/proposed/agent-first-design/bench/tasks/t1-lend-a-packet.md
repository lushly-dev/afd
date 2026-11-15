# T1: Lend a packet

Your task is to build one screen of the seed library: the desk where a volunteer lends packets
of seed to members. Read the library's rules in [the seed library](../seed-library.md#the-library)
first. The bare arm of step 0.1 is not given this file.

## Who uses it, and for what

A desk volunteer, on the morning of a seed swap, lending to about sixty members. The screen
serves six jobs. Each scenario file runs the job against the commands:

- [lend-a-packet](../scenarios/01-lend-a-packet.scenario.yaml): find the member and the
  variety and lend a packet in one go.
- [out-of-seed](../scenarios/02-out-of-seed.scenario.yaml): when a variety has run out, offer
  a close substitute or put the member on the waiting list.
- [rare-needs-the-steward](../scenarios/03-rare-needs-the-steward.scenario.yaml): ask the
  steward for a rare variety and see that the request is waiting.
- [take-back-a-loan](../scenarios/04-take-back-a-loan.scenario.yaml): take a loan made by
  mistake back at once.
- [warn-about-old-seed](../scenarios/05-warn-about-old-seed.scenario.yaml): be told, as a
  packet is lent, that the only seed left is old.
- [nothing-to-show](../scenarios/06-nothing-to-show.scenario.yaml): tell a search that found
  nothing from a catalogue that cannot be read.

## Commands

The screen calls these, in process, through a DirectClient, as the signed-in volunteer. Their
inputs, results and refusals are in [the drafted commands](../seed-library.md#drafted-commands).

- `member-list`, `variety-list`, `variety-get`
- `loan-create`, `loan-cancel`, `loan-list`
- `substitute-suggest`, `waitlist-join`, `waitlist-leave`
- `request-list`, `request-withdraw`

A loan of a rare variety is held for the steward, whoever asks. The refusal is
`APPROVAL_REQUIRED`, and the application has already recorded it as a request; nothing at the
desk approves it. The application's data is in
[`library.json`](../scenarios/fixtures/library.json).

## States

Each state's result is a file in [`../results/t1-lend-a-packet/`](../results/t1-lend-a-packet/).
`$command` names the command that returned it and `$input` its input. Your fixture loader
strips every key that starts with `$`; what is left is the result as the DirectClient returns
it.

| State | What the person sees it as | Result | What the person must be able to do | Pattern |
| --- | --- | --- | --- | --- |
| `loading` | The catalogue is being fetched | None: no call has answered | Tell that the catalogue is on its way | none |
| `catalogue` | Every variety, with how many packets are on the shelf, whether it is rare, and how well the seed a loan would take is expected to germinate | [catalogue.json](../results/t1-lend-a-packet/catalogue.json) | Search for a variety; choose one to lend; tell an old, a rare and an empty variety from the rest before lending | none |
| `member-found` | The member the volunteer searched for, with the number that tells two of one name apart | [member-found.json](../results/t1-lend-a-packet/member-found.json) | Choose the member the loan is for | none |
| `lent` | The packet was lent, from the freshest lot | [lent.json](../results/t1-lend-a-packet/lent.json) | See which lot it came from; take the loan back at once | An undo offer |
| `lent-old-seed` | The packet was lent, and the seed in it is old | [lent-old-seed.json](../results/t1-lend-a-packet/lent-old-seed.json) | See how well the seed is expected to germinate and on what basis; take the loan back so the member can choose something else | Warnings |
| `loan-taken-back` | The loan was taken back and the packet is on the shelf again | [loan-taken-back.json](../results/t1-lend-a-packet/loan-taken-back.json) | Lend again, to the right member or of the right variety | none |
| `out-of-stock` | The variety asked for has run out | [out-of-stock.json](../results/t1-lend-a-packet/out-of-stock.json) | Ask for a substitute; put the member on the waiting list | An error with its recovery |
| `substitutes-offered` | The closest substitute on the shelf, how sure the library is of it, and the others it considered | [substitutes-offered.json](../results/t1-lend-a-packet/substitutes-offered.json) | Compare the substitutes and lend one of them; decline them all and join the waiting list instead | A choice among alternatives |
| `no-substitute` | The variety has run out and nothing the library keeps is like it | [no-substitute.json](../results/t1-lend-a-packet/no-substitute.json) | Put the member on the waiting list | An error with its recovery |
| `waitlist-joined` | The member is on the waiting list, at their place in it | [waitlist-joined.json](../results/t1-lend-a-packet/waitlist-joined.json) | See their position; take them off the list again | An undo offer |
| `held-for-steward` | The loan of a rare variety was not made; the request waits for the steward, until a stated time | [held-for-steward.json](../results/t1-lend-a-packet/held-for-steward.json) | See what was asked, where it waits and until when; find the request in `request-list` and withdraw it if the member changes their mind | An approval request |
| `no-variety-match` | The search found no variety | [no-variety-match.json](../results/t1-lend-a-packet/no-variety-match.json) | Search again with other words | An empty collection |
| `no-member-match` | The search found no member | [no-member-match.json](../results/t1-lend-a-packet/no-member-match.json) | Search again with another name or number | An empty collection |
| `catalogue-unavailable` | The catalogue cannot be read just now | [catalogue-unavailable.json](../results/t1-lend-a-packet/catalogue-unavailable.json) | Try again; tell this apart from a search that found nothing | A failed collection |

## What counts as done

- **One story file** for the screen, with one named story per state id above, named after the
  id. Each story mounts the screen with that state's result, loaded from its file.
- **The screen is built from `violet-elements`** where a component fits.
- **Each contract field the state's result carries** reaches the screen, and each thing the
  person must be able to do in that state is an operable control with a name.
