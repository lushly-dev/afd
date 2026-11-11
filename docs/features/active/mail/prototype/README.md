# Mail phase 0: measurement tools

These tools produce the numbers the [proposal](../mail.proposal.md#7-measurement-and-exit-criteria)
asks for before any specification is written. They are not the engine.

| Tool | Step | State |
| --- | --- | --- |
| [`census.py`](census.py) | 0.1 and 0.2: counts from a real mailbox, and what the provider offers | Run on the owner's iCloud account 2026-11-10; Gmail not yet run |
| [`store-bench/`](store-bench/src/main.rs) | 0.3: a local store at mailbox size | Run with a default shape and with the iCloud census's shape; every threshold met |

## The census

`census.py` opens one account over IMAP and writes a file of counts. Python 3.10 or later, standard
library only.

```sh
# A trial on the first 500 messages of each mailbox, then the whole account.
python3 census.py --provider icloud --user you@icloud.com --limit 500 --out trial.counts.json
python3 census.py --provider icloud --user you@icloud.com --out icloud.counts.json
python3 census.py --provider gmail --user you@gmail.com --out gmail.counts.json
# Leave out any mailbox that lists more than 100 000 messages:
python3 census.py --provider icloud --user you@icloud.com --skip-over 100000 --out rest.counts.json
```

It prompts for the password, or reads it from `--password-file`; it is never an argument. iCloud
needs an app-specific password. Gmail needs an app password; if Gmail refuses one, the census needs
an OAuth sign-in it does not have yet.

**What it reads.** For every message: the size, the date, the structure and a fixed list of headers
(sender, recipients, subject, the list and bulk headers, the threading headers and whether an
authentication result is present). For a sample of messages in recurring templates: the first
128 KiB of the body, up to `--sample-mb` megabytes in all (300 by default), because Gmail limits
IMAP downloads to 2 500 MB a day.

**What it cannot change.** Every mailbox is opened read-only and every fetch uses `BODY.PEEK`, so no
message is marked read and nothing is moved or deleted.

**What it writes.** Counts and distributions only. Addresses, subjects and thread ids are hashed
with a key that exists in memory for the run alone, and no hash is written. Mailbox names are not
written. The file can be committed here as the record of the run.

**What it answers.** Q1, the share of all messages in a recurring template with no
list-unsubscribe header, with the share of inbound mail alone and a variant that leaves replies out
beside it; Q2, the share of mail from senders the person never wrote to that a lookup can decide; the
size, thread, sender and year distributions; how often two messages that share a template by their
headers also share one by their body; the server's capabilities before and after sign-in; and the
fetch rates it saw.

**Whose mail is yours.** Mail from the account's address counts as yours, as does mail from any
address found on your sent messages, which covers aliases and send-as addresses. Add others with
`--alias`.

**If the connection drops.** The census reconnects once per batch and carries on. The file records
how many messages were listed and how many were read. A run is complete only when every mailbox
was listed and every listed message was read in full; otherwise the file is marked
`"complete": false` and the exit code is 6, so a partial run cannot pass for a whole one.

**Messages the server lists but does not return.** When a fetch succeeds and has no answer for a
listed message, the census counts it as `listed_not_returned` and the run stays complete. A message
deleted during the run looks like this. So do messages iCloud lists and never returns: see the
iCloud run below.

**A known limit.** The body comparison reads only the first 128 KiB of a message and does not
collapse repeated table rows, so it under-reports how often two messages share a body shape. It is
a check on the header-level template, not a measure the thresholds use.

## The iCloud run

Run 2026-11-10 on the owner's iCloud account, whole account, with version 3 of the tool. The record
is [`icloud.counts.json`](icloud.counts.json). Version 3 named the count of messages listed but not
returned `vanished_before_fetch`; version 4 calls it `listed_not_returned`.

| Measure | Result | Threshold | Outcome |
| --- | --- | --- | --- |
| Q1: messages in a recurring template with no list-unsubscribe header, of all messages | 3.9% | at least 2 in 10 puts extractors in the first specification; under 1 in 10 leaves them out | Left out |
| Q2: mail from senders never written to that a lookup decides | 98.4% | at least 8 in 10 | Met |

The run read 296 697 messages (7.9 GB) in 32 mailboxes, complete and with no errors. 93% of inbound
mail carries a list-unsubscribe header, 95% of it comes from the ten largest senders, and 4 583
messages from strangers are left for judgment. The header pass read 197 messages a second.

**Listed but not returned: 8 259 messages.** The server listed 304 956 messages and returned
296 697. A second read-only pass hours later found the same 8 259 missing: all in the largest
mailbox, among its highest UIDs, with no duplicates and nothing lost in parsing. A fetch for one of
them alone succeeds and returns nothing. The owner deleted nothing during the run. The cause is not
known; entries the server's listing keeps for messages it cannot serve would explain it. One other
report of the same behaviour on an Apple account exists
([imap-mcp issue 54](https://github.com/lswith/imap-mcp/issues/54)), also unexplained. At 2.9% of the
mailbox's listing they cannot move Q1 or Q2 across a threshold. The engine's sync must expect them:
it cannot wait for every listed message before it calls a mailbox synced.

**One folder is 93% of the account.** The largest mailbox holds 283 721 of the 304 956 listed
messages. The owner identified it as mail from GitHub that an automation files there, which he means
to delete. So the whole-account figures mostly describe GitHub notifications. A second run on
2026-11-11 left that mailbox out (`--skip-over 100000`, tool version 5;
[`icloud-without-largest.counts.json`](icloud-without-largest.counts.json)): 21 248 messages,
complete, every listed message returned.

| Measure | Whole account | Without the largest mailbox | Threshold |
| --- | --- | --- | --- |
| Q1 | 3.9% | 12.1% (15.1% of inbound) | at least 2 in 10 in; under 1 in 10 out |
| Q2 | 98.4% | 60.9% | at least 8 in 10 |
| Inbound mail with a list-unsubscribe header | 93% | 31% | |
| Inbound mail from the ten largest senders | 95% | 19% | |
| Messages from strangers left for judgment | 4 583 | 4 584 | |

Without that mailbox Q1 falls between its two thresholds and Q2 is not met: four in ten messages
from strangers carry no list or bulk header and fit no recurring template. Most of this mail is
from 2010 to 2021. Which figures describe the mail the client is for is the owner's decision in
step 0.4.

**Not yet run:** Gmail.

## The store measurement

`store-bench` imports synthetic messages into SQLite tables shaped for mail and a tantivy index, then
measures what the proposal's Q3 asks for. It needs a Rust toolchain; it uses the `rusqlite` and
`tantivy` versions Umbel's embedded store pins.

```sh
cd store-bench
cargo build --release
./target/release/loam_mail_store_bench --messages 500000 --out ../store-500000.results.json
# With a census file, the shares of templated mail and of replies follow it:
./target/release/loam_mail_store_bench --messages 500000 --census ../icloud.counts.json
```

Results of 2026-11-10 on an Apple silicon Mac, with the default shape (six in ten
messages from recurring templates, three in ten joining an existing thread):

| Measure | Threshold | 100 000 messages | 500 000 messages |
| --- | --- | --- | --- |
| Import, store side | at least 500 a second | 9 169 a second | 11 443 a second |
| List 50 threads, 95th percentile | 50 ms | 1.85 ms | 7.36 ms |
| Search and read back 50 threads, 95th percentile | 200 ms | 0.94 ms | 1.82 ms |
| Size on disk against the messages' bytes | at most 3 times | 1.63 times | 1.61 times |

With the iCloud census's shape (82% of messages from recurring templates, 67% joining an existing
thread, 2 906 senders), 500 000 messages gave: import 14 455 a second, list 4.13 ms, search 1.83 ms
and 1.66 times the size ([`store-500000-icloud.results.json`](store-500000-icloud.results.json)).
Every threshold is met.

The files are [`store-100000.results.json`](store-100000.results.json) and
[`store-500000.results.json`](store-500000.results.json). At 500 000 messages the tables took
1.74 GB and the index 0.52 GB for 1.41 GB of text.

**What these numbers do not show.** The text is made up: pseudo-words drawn so that a few are common
and most are rare, in plain text with no HTML. Only the shares of templates, threads and senders follow the census; the text does not. Queries ran
straight after the import, with the files still in the operating system's cache, so a first read
after a restart will be slower. One process wrote and read; nothing ran beside it. The list reads
by offset, and its slowest reads are the deepest pages. The harness was not independently
reviewed. The time and rate thresholds are met by a factor of six or more, and the size is a little over
half its limit, so these gaps would have to matter a great deal to change the answer.

## Tests

```sh
python3 -m unittest test_census -v
```

They cover the fingerprints, the response splitter, the aggregation, and whole runs against a fake
connection: an iCloud-like and a Gmail-like account, a mailbox name sent as a literal, a dropped
connection that recovers and one that does not, a mailbox that cannot be listed or opened,
structures that cannot be fetched, a message listed but not returned, a mailbox left out by size, and the byte cap. They assert that only commands
that cannot change anything are sent, and that no address, subject, mailbox name or hash reaches
the output. They use no network.
