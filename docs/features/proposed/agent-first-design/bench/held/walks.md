# The walks

Drafted on 2026-11-15; frozen with the faults and the persona cards before the first walk. A
walk is one persona doing one job on the running reference build, clean or seeded, with the
journal recording every command its actions run. Each screen has one walked job. A persona is
given its card ([personas/](personas/README.md)) and the job's script below: the job's sentence
put as the person at the screen would meet it, and its starting state, without its steps
(proposal, section 5.5). It is not told which build it is on, that faults exist, or anything in
this folder but its card and the script.

## The scripts

The runner sets the starting state before the persona starts: it loads the fixture, makes the
calls listed under "Before the walk" as the steward, and opens the screen.

### T1: out of seed

- **Fixture:** `library.json`. **Before the walk:** nothing. **Screen:** the desk, signed in as
  a volunteer, nothing searched.
- **Script:** You are at the desk on the morning of a seed swap. Ines Marlow, member M-014, asks
  for a packet of Scarlet runner bean. She wants to go home with seed today, and if she cannot
  have Scarlet runner bean now she still wants it when there is some. Help her, then say you
  are done.
- **The job is done when** Ines Marlow has a loan of another runner bean and a place on the
  waiting list for Scarlet runner bean.
- **The scenario's steps for this walk:** `loan-create` for `var-runner`, refused with
  `OUT_OF_STOCK`; `substitute-suggest` for `var-runner`; `loan-create` for `var-painted` or
  `var-czar`; `waitlist-join` for `var-runner`.
- **The job's last command:** the later of the substitute's `loan-create` and the
  `waitlist-join`, each succeeding.

### T2: put right the rows that failed

- **Fixture:** `library.json`. **Before the walk:** `donation-import` of three rows: Borlotti
  bean, 4 packets, 2029; Pot marigold, 2 packets, 2031; Mystery squash, 1 packet, 2029. In a
  fresh store it is `don-1`; the screen's results call the same box `don-3`. **Screen:**
  intake, showing that donation's outcome.
- **Script:** You take in donated seed. A donor's box went in a moment ago, and not all of it
  was taken in. The donor is still at the table, and tells you the Pot marigold was harvested in
  2029. Get the box into the library as far as it can go, then say you are done.
- **The job is done when** the donation is complete: the second row (`index: 1`) corrected
  and the third (`index: 2`) left out.
- **The scenario's steps for this walk:** `donation-correct` with `index: 1` and
  `harvestYear: 2029`; `donation-correct` with `index: 2` and `leaveOut: true`.
- **The job's last command:** the later of those two, each succeeding.

### T3: record a return

- **Fixture:** `library.json`. **Before the walk:** nothing. **Screen:** the page of Borlotti
  bean.
- **Script:** You are at the desk. Tobias Reed, member M-027, brings back the Borlotti bean he
  borrowed last spring, with five packets of seed he saved from it, harvested in 2029. Record
  it, then say you are done.
- **The job is done when** `loan-1` is returned and its saved seed is a lot of 5 packets from
  2029.
- **The scenario's steps for this walk:** `loan-return` of `loan-1` with
  `savedSeed: { packets: 5, harvestYear: 2029 }`.
- **The job's last command:** that `loan-return`, succeeding with those values.

### T4: decide several at once

- **Fixture:** `steward.json` on `library.json`. **Before the walk:** nothing. **Screen:** the
  steward's requests, signed in as the steward.
- **Script:** You are the library's steward, deciding the evening's requests for rare seed.
  Three members asked for Glass Gem corn, and you want all three to have it. Decide them in one
  go. Settle anything that does not go through as you think best for the member, then say you
  are done.
- **The job is done when** no request is still waiting: two approved, and the third approved
  or declined.
- **The scenario's steps for this walk:** one `afd-batch` of three `request-decide` approvals,
  whose third entry fails with `OUT_OF_STOCK`; `waitlist-join` for `mem-wren` and
  `var-glassgem`; `request-decide` declining `req-3`.
- **The job's last command:** the decision that leaves no request waiting, succeeding.

## Reading a path

Step 0.4's rule compares paths by the job's last command and by a total of failed commands,
repeated commands and commands outside the scenario's steps (`bench.md`, "Rules for go"). These
readings are proposed in `bench.md` for the owner to confirm with the rules for "go"; until then
they are a draft:

- **A read is free.** A query (`variety-list`, `member-list`, `variety-get`, `lot-list`,
  `loan-list`, `request-list`, `donation-get`, `donation-match`, and `substitute-suggest` where
  it is not a listed step) does not count as outside the steps, since screens load and search.
  A failed read counts as failed.
- **A refusal the steps expect is a step,** such as T1's `OUT_OF_STOCK` or the third entry of
  T4's batch.
- **A batch is one command.** The journal records an `afd-batch` as one entry with its inner
  results. Deciding the three one at a time reaches the same end with two more commands, which
  count as outside the steps.
- **A repeat** is a mutation of the same command on the same record as an earlier one in the
  walk, whether or not its input differs, and an undo of an earlier mutation counts as one too.
  A return recorded wrong, taken back with `loan-reopen` and recorded again adds two.
- **A walk that ends without saying it is done,** or that reaches the walk's cap, ends where its
  journal ends.
- **The walk's cap** is 60 actions or 30 minutes, whichever comes first. The pilots check that
  the clean build's walks finish well inside it.
