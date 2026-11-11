# Mail phase 0: measurement tools

These tools produce the numbers the [proposal](../mail.proposal.md#7-measurement-and-exit-criteria)
asks for before any specification is written. They are not the engine.

| Tool | Step | State |
| --- | --- | --- |
| [`census.py`](census.py) | 0.1 and 0.2: counts from a real mailbox, and what the provider offers | Written, with tests; not yet run on a real account |
| The store harness | 0.3: a local store at mailbox size | Not written |

## The census

`census.py` opens one account over IMAP and writes a file of counts. Python 3.10 or later, standard
library only.

```sh
# A trial on the first 500 messages of each mailbox, then the whole account.
python3 census.py --provider icloud --user you@icloud.com --limit 500 --out trial.counts.json
python3 census.py --provider icloud --user you@icloud.com --out icloud.counts.json
python3 census.py --provider gmail --user you@gmail.com --out gmail.counts.json
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
`"complete": false` and the exit code is 6, so a partial run cannot pass for a whole one. A message
deleted while the census runs is counted as vanished and does not make the run incomplete.

**A known limit.** The body comparison reads only the first 128 KiB of a message and does not
collapse repeated table rows, so it under-reports how often two messages share a body shape. It is
a check on the header-level template, not a measure the thresholds use.

## Tests

```sh
python3 -m unittest test_census -v
```

They cover the fingerprints, the response splitter, the aggregation, and whole runs against a fake
connection: an iCloud-like and a Gmail-like account, a mailbox name sent as a literal, a dropped
connection that recovers and one that does not, a mailbox that cannot be listed or opened,
structures that cannot be fetched, a message deleted mid-run, and the byte cap. They assert that only commands
that cannot change anything are sent, and that no address, subject, mailbox name or hash reaches
the output. They use no network.
