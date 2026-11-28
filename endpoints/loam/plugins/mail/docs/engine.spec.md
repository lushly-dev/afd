# Mail: the engine's specification

Phase A of the [Mail proposal](../../../../../docs/features/active/mail/mail.proposal.md). It specifies the engine: the Rust program that
holds a person's mail on their machine and serves it as AFD commands. Read the
[status](../../../../../docs/features/active/mail/STATUS.md) first, then the proposal; this document does not repeat the proposal's
reasons.

## Status

- **State:** approved. The owner approved it on 2026-11-11 by merging
  [#995](https://github.com/lushly-dev/afd/pull/995), and answered the four choices of
  [section 16](#16-for-the-owner) the same day. His answers added M28 and M29.
- **Written:** 2026-11-11, against `main` at `d2c30f72`. Moved to the plugin's folder by step B1.
- **Covers:** phases B to E of the proposal's [section 9](../../../../../docs/features/active/mail/mail.proposal.md#9-steps). Phase B is
  specified in full, apart from the points it names as decided by one of its steps. Phases C to E
  are fixed in shape; what each leaves open is listed as "decided by step" and is settled in that
  step's pull request, as Loam's phase specifications do.
- **Does not cover:** the Loam app (phase F) and composition with Umbel (phase G), which have
  their own specifications.
- **Read for this document:** the `afd` crate's README at version 0.2.1, and in its source the
  context hook, the approval middleware and the journal recorder; `spec/command-metadata.md`
  (exposure and tasks); Loam's workflow path filters; Umbel's decisions D67, D115 and D153 and
  its provenance envelope; the three census records and the store results in
  [`prototype/`](../../../../../docs/features/active/mail/prototype/README.md). The crates named in [section 2](#2-units-placement-and-crates)
  were looked up on crates.io on 2026-11-11 for licence, version and minimum Rust; none was built
  or run for this document. Statements about a provider that were not observed are marked
  "not verified".
- **Review:** one independent review on 2026-11-11 (revise; eleven blockers and its
  improvements, all applied), and one of the owner's answers the same day (revise; five small
  blockers, all applied), recorded in the [status](../../../../../docs/features/active/mail/STATUS.md#session-log).

## What phase 0 decided

| Run | Messages | Q1 | Q2 |
| --- | --- | --- | --- |
| iCloud, whole account | 296 697 | 3.9% | 98.4% |
| iCloud, without its largest mailbox | 21 248 | 12.1% | 60.9% |
| Gmail | 17 937 | 3.7% | 85.3% |

On 2026-11-11 the owner read these, said to continue, and agreed to two proposals:

1. **Extractors are left out of this specification.** Q1 is under one in ten in two runs and
   between the thresholds in the third. The design keeps room for them
   ([section 10.4](#104-extractors-deferred)).
2. **Screening is a lookup first.** What the lookup cannot decide, 2 359 messages on Gmail and
   about 4 600 on iCloud by the census's measure, is the part a caller's model may rank, by
   proposal.

What else the measurements fix for this document:

| Finding | Consequence here |
| --- | --- |
| SQLite and tantivy met every Q3 threshold at 500 000 messages, with the census's shape | The store in [section 4](#4-the-store). Its layout differs from the harness's, so step B2 measures it again |
| iCloud listed 8 259 messages it never returned, all in one mailbox, the same ones hours apart | Sync cannot wait for every listed message ([5.4](#54-messages-listed-and-not-returned)) |
| One mailbox held 93% of an account (283 721 messages) | Sync order ([5.3](#53-order-and-fairness)) and actions on a whole selection ([9.1](#91-selections)). The owner keeps that mailbox as the test for both |
| iCloud offers CONDSTORE, QRESYNC, IDLE and UIDPLUS, and not MOVE. Gmail's IMAP offers CONDSTORE, IDLE and MOVE, and not QRESYNC | [5.2](#52-imap) and [9.2](#92-the-commands) |
| iCloud marks only its sent and trash mailboxes with a special-use flag | [5.1](#51-the-provider-interface): a mailbox's role cannot be read from flags alone |
| The header pass read 197 messages a second on iCloud and 219 on Gmail's IMAP | A first sync of headers takes minutes for a normal account and about half an hour for the largest one. Body rates were not measured |
| Gmail's mail rose from 1 536 messages in 2024 to 4 964 in 2025 | A record the burst rule can be tried on ([7.4](#74-bursts)) |
| Gmail's API was not probed | Step B0 does it before any Gmail code is written |

The owner has also said that around 2024 or 2025 his mail was flooded to bury the alerts of a
card fraud, and that he has had more spam since. He did not say which account. The behaviours
this document gives in answer ([7.4](#74-bursts)) were its own proposal; he agreed to them on
2026-11-11.

## Terms

| Term | Meaning |
| --- | --- |
| Account | One mailbox service a person signs in to: an iCloud account, a Gmail account |
| Mailbox | A folder on an IMAP server, or a label in Gmail |
| Message | One piece of mail. The same message in two mailboxes is one message ([4.2](#42-what-makes-two-messages-the-same)) |
| Observation | The engine's record that a provider showed a message in a mailbox with some state, at some time |
| Sender | An address that mail came from, with what the engine knows of its history with the person |
| Template | A recurring shape of message from one sender ([6.3](#63-the-template-fingerprint)) |
| Selection | A set of messages named by a query, not by a list of rows ([9.1](#91-selections)) |
| Caller | Whoever runs a command: a person at a terminal, a script, an agent over MCP |
| Person | The account's human owner. "A person" beside a command means only they may run it |

## 1. Decisions of this specification

They continue the proposal's M1 to M14. The owner approved M15 to M27 on 2026-11-11; M28 and M29
record what he added when he answered [section 16](#16-for-the-owner).

| | Decision | Why |
| --- | --- | --- |
| M15 | The engine is one program, `loam-mail`, from one crate, `loam_mail`. One process at a time owns the store | One writer keeps SQLite and the search index simple and makes "is it syncing" a question with one answer |
| M16 | The engine has its own command line, in the same program. It adds no command line to the `afd` crate | The proposal left this open. A person must be able to sync, read and send with nothing else installed, and a terminal is where a person confirms a send until Loam can ([3.5](#35-commands-only-a-person-may-run)). `@lushly-dev/afd-cli` still reaches the engine over MCP like any client |
| M17 | Agents reach the engine over MCP on a loopback HTTP port, each with its own token. Stdio is offered only when no server is running | Mail must sync with no client attached, so the server is long-lived, and a stdio child would be a second process on the store |
| M18 | Commands only a person may run are exposed to `cli` alone, except four, which are also listed over MCP: `mail-draft-send`, `mail-replyset-send`, `mail-unsubscribe` and `mail-operation-approve` (released one step at a time from F2a). Each is held by its approval policy (`ApprovalPolicy::Required`) for every caller, and only the person at the terminal or an approver's evidence ([plugin.spec.md](plugin.spec.md#5-the-four-released-commands)) releases it. A caller that is not an approver gets `APPROVAL_REQUIRED` with no token. The approval's summary holds no content | Amended in step F2a (`plugin.spec.md` §5.4): the route by which a shell's approval reaches a mounted server now exists (AFD's approver carrier and Loam's 7.2) once Loam's desktop transport speaks MCP 2026-07-28. `rules.rs` enforces that only those four held commands may be exposed to `mcp` (never `agent` or `palette`, always `Required`) ([3.5](#35-commands-only-a-person-may-run)) |
| M19 | The log is a file per message, named by the hash of its bytes. SQLite holds what is derived, and the index holds the text | M3: one copy of the source, and everything else can be rebuilt from it by a command |
| M20 | On IMAP, a message of 1 MiB or less is fetched whole. A larger one is fetched as its headers and text, and its attachments when someone opens them | In the census 99.8% of iCloud messages and 99.2% of Gmail's are 1 MiB or less, so nearly all mail is held whole, and a few large attachments do not slow a first sync. For Gmail's API see [5.5](#55-gmail) |
| M21 | The engine does not encrypt its files itself in this version. They are readable only by the person's user account, and credentials are in the operating system's keychain | A key the engine could use unattended would sit beside the files it protects. Disk encryption covers a lost machine. A process running as the person can read the files either way. This is a choice the owner should see ([section 16](#16-for-the-owner)) |
| M22 | Sync runs newest first, headers before bodies, in turns across mailboxes, and resumes from a stored cursor after any stop | The client is useful in minutes, and one huge mailbox cannot starve the inbox |
| M23 | A listed message that never arrives is recorded as unreturned after repeated tries, counted, and tried again later | The iCloud finding. A mailbox must be able to reach "synced" |
| M24 | A command that changes many messages works on a set the engine resolved and froze beforehand, and the caller states that set's exact count | The owner's requirement. What was counted is exactly what is changed, so a wrong query cannot quietly touch 283 000 messages |
| M25 | Extractors are deferred. The template fingerprint and the record store they would need are still built, for stories and proposals | The owner agreed to leave them out on Q1 |
| M26 | Mail from a sender with a history is never placed below or inside a burst of strangers. A burst is one story, and it is flagged | An answer to the flood the owner described. Proposed by this document; the owner agreed on 2026-11-11 |
| M27 | Rust 1.100.0, the repository's Rust toolchain (1.98.0 until #1805). Every dependency is pinned by a committed lockfile | `mail-parser` declares 1.98 as its minimum; one toolchain for the repository's Rust |
| M28 | An agent may propose what it may not do: a change over its limits, or a decision on a sender. A proposal changes nothing. It takes effect only when the person approves it with a person's command that carries an approval policy ([9.4](#94-the-policy), [7.3](#73-the-persons-decisions)) | The owner's rule, 2026-11-11. His case is the 283 000-message mailbox: an agent should be able to offer to empty it, and the person has to agree. The limits stay as what an agent does with nobody present |
| M29 | A command that sends mail, or removes for good the person's mail, a draft or a credential, is declared destructive and carries an approval policy. A test over the registry fails the build if a command is destructive without one. The commands are named in [9.4](#94-the-policy) | The owner's rule, 2026-11-11: anything destructive and not recoverable needs the person's approval, enforced through AFD. The crate's middleware enforces the approval; it does not act on the destructive flag by itself, so the engine's test ties the two. That such a command is also absent from MCP is M18's rule, not his |

## 2. Units, placement and crates

**Where it lives.** The proposal's M14 puts the plugin in `endpoints/loam/plugins/mail/`. That
folder needs Loam's need L8, because Loam's workflow runs on any change under `endpoints/loam/`
but its documents. So:

- Step B1 created `endpoints/loam/plugins/mail/` with `engine/` (the crate) and `docs/` (this
  document, which was written in `docs/features/active/mail/` and moved here). The same pull
  request excluded `endpoints/loam/plugins/**` from both path lists of `loam.yml` (push and
  pull request) and added one workflow, `loam-plugins.yml`, whose affected-units gate runs only
  the plugin that changed. Loam's ledger records this as its D109.
- The proposal, the status file and the prototype stay in `docs/features/active/mail/`.
- The crate is its own Cargo workspace, as Umbel is, with `publish = false`. It depends on the
  `afd` crate by path, with the `native`, `approval`, `journal-file` and `server` features. Step
  B5 added `server` when it began to serve MCP, so that the lockfile carried the MCP SDK only once
  it was used. A change
  under `packages/rust/**` runs the plugin's workflow.
- `pnpm check` does not cover it. The workflow runs `cargo fmt --check`, clippy with
  `-D warnings` and `cargo test --locked`.

**Crates.** Looked up on crates.io on 2026-11-11 for licence, version and declared minimum Rust.
Each crate's maintenance history was not read.

| Crate | Version | Licence | Use | Open point |
| --- | --- | --- | --- | --- |
| `afd` | 0.2.1, by path | MIT | Registry, journal, approvals, tasks, MCP server | None |
| `rusqlite` | 0.43, bundled SQLite | MIT | The store | The version Umbel pins, so the repository carries one |
| `tantivy` | 0.27 | MIT | The search index | Built without its default features; with `mmap`, `stopwords`, `stemmer` and `lz4-compression`, as the phase 0 harness was |
| `sha2` | 0.11 | MIT or Apache-2.0 | The log's file names and a message's identity | The version the `afd` crate uses |
| `zstd` | 0.14 | BSD-3-Clause | Compressing the log | Builds the zstd C library, as `rusqlite` builds SQLite |
| `mail-parser` | 1.0.1 | Apache-2.0 or MIT | Parsing messages | The licence is stated on crates.io, which answers the proposal's follow-up |
| `ammonia` | 4.2 | MIT or Apache-2.0 | Cleaning HTML for display | Step B4 found that 4.2 depends on `cssparser` and `dtoa-short`, which are MPL-2.0, outside the licence check's allowlist. The owner allowed MPL-2.0 for those two crates by name on 2026-11-12; MPL is file-level copyleft, so their own files stay MPL and nothing else of the engine is touched. The licence check names them as exceptions, so no other crate brings MPL in unnoticed |
| `html5ever`, `markup5ever_rcdom` | 0.40, 0.40 | MIT or Apache-2.0 | Reading a message's HTML for its evidence ([6.1](#61-what-is-read)) | Added by step B4. The DOM crate is published as unofficial by html5ever's authors; the engine reads with it and builds nothing on it |
| `async-imap` | 0.12 | MIT or Apache-2.0 | IMAP | Checked by step B3. With `imap-proto` 0.17 it parses `VANISHED`, `HIGHESTMODSEQ`, `MODSEQ` and the `COPYUID` code, and it has `UID EXPUNGE`. It has no call that opens a mailbox with QRESYNC, and it sets aside on a bounded channel, dropping when full, any response its own calls do not expect. So the engine uses it for the connection, the sign-in and the parser, sends its own commands and reads every response itself. `imap-codec` is not needed |
| `rustls`, `tokio-rustls`, `rustls-native-certs` | 0.23, 0.26, 0.8 | MIT, Apache-2.0 or ISC | TLS to the provider, with the operating system's certificates | Added by step B3, with `ring` rather than the default `aws-lc-rs`, which needs CMake to build |
| `lettre` | 0.11 | MIT | SMTP, from phase D | Not added: step D3's second part spoke SMTP submission directly over `tokio` and `rustls` (reusing IMAP's TLS setup) for exact control over the handover boundary (`.\r\n` written -> `unknown`) with no new dependency |
| `keyring-core`, `apple-native-keyring-store` | 1, 1 | MIT or Apache-2.0 | The operating system's keychain | Step B3 took these in place of `keyring` 4.2, which advises an application that knows its platforms to link them directly. macOS only for now: on another platform adding an account says there is no keychain yet |
| `getrandom` | 0.4 | MIT or Apache-2.0 | The approval middleware's key, made afresh for each process; the tokens of [3.3](#33-callers); the SMTP Message-ID | Already in the lockfile through `tantivy` and `rmcp` (by `uuid` and `rand`). #1846 moved the engine's own dependency from 0.3 to 0.4 without changing its calls |
| `tokio` | 1 | MIT | Running a command from the command line; the `afd` crate's deadlines use it; the connection to the provider; the server | Step B5 added `rt-multi-thread`, `io-std` and `sync` to `rt`, `time`, `net`, `io-util`, `signal` and `macros` |
| `axum`, `tower` | 0.8, 0.5 | MIT | The server's routes and the layer in front of them ([3.4](#34-the-http-surface)) | Added by step B5, new to the lockfile with the crates they bring; `axum` without its default features, with `http1` and `tokio`. The MCP SDK's HTTP service is a `tower` service that `axum` mounts |
| `hyper`, `hyper-util`, `http-body-util` | 1, 0.1, 0.1 | MIT | The command line's call to a running server over loopback | Added by step B5; `axum` uses the same versions. A plain HTTP/1 connection, with no TLS and no pool |
| `serde` | 1 | MIT or Apache-2.0 | The forwarded call and `server.json` | Added by step B5; already in the lockfile through the `afd` crate |
| `async-trait`, `serde_json` | 0.1, 1 | MIT or Apache-2.0 | A command's handler and its input and result | The `afd` crate's own |
| `psl` | 2 | MIT or Apache-2.0; the list it compiles in is MPL-2.0 | A sender's registrable domain ([7.1](#71-senders)) | Added by step C1. Mozilla's Public Suffix List is compiled in unmodified, under MPL-2.0, which the manifest does not say: the owner allowed it by name on 2026-11-14, as for `cssparser`, and the licence check names it. A new suffix needs a new version of the crate, which is republished as the list changes |

Every crate here is permissively licensed. Step B1 added a licence check so a transitive
dependency cannot change that unnoticed: a test in the crate reads the lockfile's packages and
fails on a licence outside its allowlist, and the workflow runs it with the other tests.

## 3. Process and surfaces

### 3.1 The data directory

One directory holds everything: the platform's application-data directory for `loam-mail`
(`~/Library/Application Support/loam-mail` on macOS), or `LOAM_MAIL_HOME`. It is created with
mode `0700` and its files with `0600`. The program sets its file mode mask to `077`, so the files
a library creates with the default mode, such as the search index's, are the owner's alone too.
Where the engine runs inside another program, which keeps its own mask, the index's files may be
open to others, and its directory and the data directory, both `0700`, keep others from reaching
them.

| Entry | Holds |
| --- | --- |
| `mail.sqlite3` | The store ([section 4](#4-the-store)) |
| `index/` | The tantivy index |
| `blobs/` | The log: one file per message, and one per attachment fetched later |
| `journal.jsonl` | The `afd` command journal ([13.1](#131-the-journal)) |
| `server.json` | The running server's process id and port |
| `cli.token` | The command line's own token for a running server ([3.2](#32-modes)), in clear |
| `lock` | Held by the process that owns the store |

Account credentials and refresh tokens are in the keychain, never in this directory. On macOS
an account's sign-in is a generic password in the person's login keychain, with the service
`loam-mail` and the account `<provider>:<address>`. The tokens
agents present are stored as hashes. `cli.token` is the one secret kept here in clear, because the
command line has to read it. Whoever can read it can read the mail beside it, and can also act
as the person toward a running server ([3.5](#35-commands-only-a-person-may-run)).

### 3.2 Modes

| Invocation | Does |
| --- | --- |
| `loam-mail serve` | Takes the lock, opens the store, runs sync in the background, serves on `127.0.0.1` at a port it records in `server.json`. This is how the engine normally runs |
| `loam-mail <command> [input]` | Runs one command and prints its result as JSON, or as text with `--text`. Every command exposed to `cli` is reachable this way; `loam-mail help` lists them from the registry |
| `loam-mail mcp` | Serves MCP on stdio. It takes the lock itself, and fails with `STORE_IN_USE` and the server's address if a server is running |

When a server is running, `loam-mail <command>` does not open the store. It forwards the call to
the server over a private route on the same port, with `cli.token`. When none is running, it
takes the lock and runs the command itself. Either way the command passes through the same
registry, middleware and journal.

Every call a running server answers returns within a mounted call's limits: 60 seconds and a
reply of 4 MiB, the limits Loam sets on a mount (L5). No output budget's maximum is above 4 MiB.
Work that takes longer runs in the server and is read by its state: sync
([5.7](#57-what-synced-means)) and large changes ([9.1](#91-selections)). Only a command run
directly at a terminal, with no server, may run for longer, printing its progress.

**As step B5's first pull request built it.**

- `loam-mail serve [--port N]` listens on `127.0.0.1`, at port `N` or one the system gives. It
  takes the store, reads the agents' tokens, makes a new `cli.token`, then writes `server.json`
  (`{"pid", "port"}`). Both files are written whole to a new private file and renamed into place.
  It says on standard error where it serves, and on Ctrl-C or a request to end it stops taking
  calls and removes both files. It listens for those before it takes the store: one that
  comes while the store is opened stops it before it binds or writes anything, and one that
  comes after still removes the files. A server that is killed leaves them; the next one
  removes them as soon as it has the store, before it writes its own, so the command line never
  pairs an old port with a new token.
- The command line opens the store before running a command. When another process owns it and
  `server.json` names a server, the call goes to the server's `/cli` route: the command, its
  input, whether the command line has a terminal, and the approval token on a retry. A server
  that cannot be reached, or that refuses `cli.token`, gives `STORE_IN_USE` in the engine's
  words. The approval of [3.5](#35-commands-only-a-person-may-run) runs the same way either way,
  with the hold and the retry both going to the server.
- `loam-mail mcp` takes the store itself; when a server owns it, it fails with `STORE_IN_USE`
  and the server's MCP address.
- The server runs on several threads, and a command's work on the store leaves the async
  thread, so a long command does not stop the server answering others. The store is still one
  lock held for each command's work, so a `mail-sync` or `mail-rebuild` holds the others back
  until it ends.
- **Left to the second pull request** (now built; see below): sync every five minutes in the
  background, `mail-sync` and `mail-rebuild` as work the server carries on and `mail-status`
  reports, and the 60 seconds and 4 MiB of a call.

**As step B5's second pull request built it.**

- `loam-mail serve` and `loam-mail mcp` both run the server's work (`src/work.rs`) once they have
  the store. One piece runs at a time, in this order:
  - a rebuild, when one is asked for or a stop left one unfinished; until it ends, new mail waits
    to be derived;
  - a pass of sync over every account, at once and five minutes after each such pass ends;
  - a pass asked for. Requests merge: two accounts asked for become one pass of every account.
    Asking for one account's pass does not put off the next pass of every account.
- On a server, `mail-sync` checks that the account it names is there, asks for a pass and returns
  at once with `{"work", "queued", "running"}`. `follow` is refused on a server, which already
  syncs. `mail-rebuild` marks the store as rebuilding, throwing away what is derived, then asks
  for the work and returns at once. A rebuild asked for is therefore never lost: if the server
  stops first, the next one carries it on. Lists and search are empty from that moment, also while
  a pass that was already running finishes, which can take a few minutes. A rebuild asked for
  while one runs is covered by it. One that fails and leaves the store rebuilding is tried again
  five minutes later. A pass asked for and not begun is dropped at a stop; the next server syncs
  as it starts.
- `mail-status` gains `work`, which is `null` with no server.
  - For sync: what runs (the account, when it began), what waits, when the next pass of every
    account is due (`everyAccountDueAt`, in the past while one runs or waits), and how the last
    pass ended.
  - For a rebuild: what runs (the highest message id derived so far and the highest there is),
    whether one waits or waits to be tried again, and how the last ended.
  - An outcome is the command's own result, or its failure's code and message, in ids, counts
    and the engine's words. A panic in the work is recorded as `COMMAND_EXECUTION_ERROR`, and the
    work goes on.
- A rebuild takes the store for one batch at a time, the same way at the command line, so that on
  a server other commands run between its batches. While it runs, lists and search show what it
  has derived so far.
- **A call's limits.** Each command a call runs, on either route, has a 60-second deadline; one
  that outlasts it is stopped and fails with the `afd` crate's `TIMEOUT`.
  - The server refuses `afd-batch` and `afd-pipe` with `ONE_COMMAND_PER_CALL`, because they would
    run several commands, each within the limits, in one call.
  - A reply larger than 4 MiB fails with `REPLY_TOO_LARGE`, which says that a command that changes
    something has made its change. Over MCP the reply's size counts the result twice: the `afd`
    crate sends it as text and as structured content, and escapes the text.
  - So a read's largest output budget is 1.75 MiB (`read.rs`), and a reply over the limit needs a
    result that is mostly characters the escaping doubles.
  - Neither limit applies to a command the command line runs itself. The largest budget does: one
    maximum for every caller keeps the reads simple, so a person at a terminal reads a message's
    text, or a file's bytes, 1.75 MiB at a time, where before it was 4 MiB.
- When the server stops, its work stops between two steps of sync or two batches of a rebuild, and
  carries on from there next time.
- **Left to the third pull request** (now built): `mail-account-remove`
  ([3.5](#35-commands-only-a-person-may-run)), and where the 174 seconds of a pass with nothing new
  went ([5.2](#52-imap)).

### 3.3 Callers

| Caller | Interface | Actor |
| --- | --- | --- |
| The command line, with a terminal on standard input | `cli` | `human` |
| The command line, without one | `cli` | `script` |
| A client over MCP | `mcp` | `agent`, with its token's id |

- A token has a stable id, made when it is created, and a name for display. The id is the
  actor's id, so a token made later with a revoked token's name is a different caller and
  inherits nothing.
- Each token is a distinct caller, which is what lets the server create tasks over HTTP
  (`TaskOptions::with_callers_identified_by_hook`). Over stdio there is one caller.
- Whether the command line has a terminal is the command line's own report. A server that
  receives a forwarded call cannot check it ([3.5](#35-commands-only-a-person-may-run)).
- **As step B5 built it.** An agent's token is `lmail_agent_` and 64 hex digits from the
  operating system's random source; its id is `tok_` and 16 hex digits. The store keeps the id,
  the name, the SHA-256 and the time it was made (the `token` table, migration 6); a name is 1 to
  64 characters with no control characters, and two tokens may not share one. The server reads
  the hashes when it starts and again after a token is made or revoked, so a revoked token is
  refused from the next request. `cli.token` is `lmail_cli_` and 64 hex digits, made each time
  the server starts. Over HTTP the context hook turns the layer's caller into an `agent` actor
  with the token's id, and refuses a request the layer did not mark.

- **As step F1 built it** (migration 18, [plugin.spec.md](plugin.spec.md#4-the-approver-token)):
  each token has a `role`, `agent` (the default, and every pre-existing row) or `approver`,
  chosen by the person at the terminal when created (`mail-token-create { name, role? }`).
  An approver token is `lmail_approver_` and 64 hex digits; its approval summary names what it
  can do and notes that the engine cannot verify the person was asked. The command line gains
  `--out <file>` for `mail-token-create`, creating a new owner-only (`0600`) file on Unix and
  printing the path instead of the token; `--out` is refused on Windows until owner-only access
  lists are built. `mail-token-list` includes `role`, and `mail-status` reports
  `tokens: { agents, approvers }`. Over HTTP `/mcp`, `McpServer::with_approver` marks callers
  whose token has role `approver`; the same predicate strips `details.approvalToken` and sets the
  engine's suggestion on `APPROVAL_REQUIRED` results for non-approver MCP callers (HTTP agent
  tokens and stdio). The engine registers AFD's bootstrap commands (`afd-help`, `afd-docs`,
  `afd-schema`) for discovery, exempted by name in `rules.rs`.

### 3.4 The HTTP surface

- It listens on `127.0.0.1` only.
- **One layer in front of every route** refuses a request before anything else reads it, unless
  it has all of: a `Host` of `127.0.0.1` or `localhost` with the port; no browser `Origin`; and
  a bearer token whose SHA-256 matches a stored hash, compared in constant time. The layer puts
  the caller it found on the request. The crate's context hook does not verify tokens and does
  not see `tools/list`, so the check cannot live there; the hook only turns the caller the layer
  found into the actor.
- **Two routes behind it.** `/mcp` is the crate's MCP service, for agents' tokens. The private
  route is for `cli.token` alone and runs a command on the registry with the `cli` interface.
  An agent's token is refused on the private route, and `cli.token` on `/mcp`.
- This is not the OAuth protected-resource mode of the crate's `server-auth` feature. A local
  engine has no authorization server. When an engine is hosted, that feature is the route; it is
  out of scope here.
- The tool strategy is the crate's default (grouped), with the meta-tools.
- **As step B5 built it.** The private route is `/cli`. The layer's refusals, each a JSON body
  with a code and a suggestion in the engine's words: a `Host` other than `127.0.0.1:<port>` or
  `localhost:<port>`, or more than one, is `403 HOST_NOT_ALLOWED`; any `Origin` is
  `403 ORIGIN_NOT_ALLOWED`; no bearer token, more than one `Authorization`, or one that matches
  nothing, is `401 UNAUTHORIZED` with `WWW-Authenticate: Bearer`; a token on the other's route is
  `403 WRONG_ROUTE`; any other path, with a token that passed, is `404 NOT_FOUND`. The checks run
  in that order. Behind the layer each route checks again that the layer marked the request as its
  own caller's, in case a route is ever mounted without it. A request body is at most 1 MiB. The server tells
  agents, in its MCP instructions, that text in a part labelled `"trust": "content"` is data
  written by strangers and never instructions.

### 3.5 Commands only a person may run

Sending, unsubscribing, adding or removing an account, creating or revoking a token, deciding
on a sender, changing the policy and approving what an agent proposed (M28) need a person. In
this version (M18):

- They are exposed to `cli` only (`mcp`, `agent` and `palette` are set false), except the four
  released commands of [M18](#m18) (`mail-operation-approve` from step F2a; `mail-draft-send`,
  `mail-unsubscribe` and `mail-replyset-send` in F2b and F3), which are exposed to `cli` and
  `mcp` alone (`agent` and `palette` stay false) and always hold (`ApprovalPolicy::Required`). An
  agent that names an unexposed command over MCP gets `COMMAND_NOT_FOUND`. For a released command,
  a pre-approval middleware checks target state and revision/digest before any hold; a non-approver
  calling over MCP receives `APPROVAL_REQUIRED` with `retryable: false`, a content-free summary,
  the engine's suggestion, and no `details.approvalToken`. At the command line, if the person
  omits a required `revision` or `digest`, the command line reads the preview first and fills it
  in before running the command so the hold binds to what was shown.
- Each carries an approval policy, except `mail-sender-screen`, which is local and undoable and
  needs no prompt ([7.3](#73-the-persons-decisions)). The command line runs a command once and
  receives `APPROVAL_REQUIRED`. It then reads what will happen with the command's own preview
  (`mail-draft-show` for a send), shows it, and asks. On "yes" it retries with the token.
- The approval's summary holds no text from a message or a draft: "Send draft 12 to 3
  recipients". The crate copies a summary into the failure's suggestion, where content must not
  go ([12.1](#121-content-labels)), so the detail a person needs is read through the preview, in
  labelled parts.
- With no terminal on standard input the command line does not ask. It fails with
  `PERSON_REQUIRED`.
- A credential never passes through a command. The command line reads it from the terminal
  without echo, or runs the provider's sign-in in the system browser with a loopback redirect,
  and writes the result to the keychain itself. `mail-account-add` takes the provider and the
  address, reads the keychain, and checks that the sign-in works. A running server reads the
  same keychain item.
- **As step B3 built it.** The approval middleware signs tokens with a key made afresh for each
  process and kept nowhere, so a token is good only within the command line's run, for at most
  30 minutes. The command line runs the command, shows the summary ("Add the icloud account
  <address>, and sign in to check that the sign-in works"), and asks "Go ahead?". On "yes" it
  asks for any secret the command needs (an app-specific password for `mail-account-add`), after
  checking that the keychain can be used, takes a fresh hold so that the time spent making the
  password does not expire the approval, keeps the secret in the keychain, and retries with the
  token. No token is printed. If the command fails, or the person stops it (Ctrl-C, closing the
  terminal, or a request to end), the
  keychain is put back as it was, so a mistyped password does not take the place of one that
  works. A Ctrl-C at the very moment the password is kept, before the sign-in starts, is the one
  gap. Input the command would refuse is refused without asking: `mail-account-add`'s policy
  holds only an account it could add. An address's domain is kept in lower case, so a difference
  of case does not add an account twice.
- **As step B5 built it.** A server builds its registry once, so its key lasts as long as the
  server runs, and a forwarded hold and its retry are checked by the same key. A server's key is
  still kept nowhere: a hold taken before the server stops is no good after.
  `mail-token-create` asks "Make a token named "<name>", for an agent to reach your mail over MCP
  while `loam-mail serve` runs", and `mail-token-revoke` "Revoke the token <id>: an agent that
  presents it is refused from then on, and it cannot be brought back". A token's name is the
  person's own words, typed at the terminal, so it may appear in a summary. `mail-token-list` is
  a read and asks nothing.
- **`mail-account-remove`, as step B5 built it.** It takes the account's id, and always asks.
  - **What the person is asked.** The summary names the account's provider and address, its
    number of mailboxes, and the number of messages only it has shown: no other account's
    mailbox has shown them, now or before. On a server the counts can grow between the question
    and the answer. It says that these go
    from the store on this computer and the sign-in from the keychain, that nothing changes at the
    provider, and that adding the account again syncs its mail again. An address is the person's
    own, typed when they added the account.
  - **What goes:**
    - the account and its mailboxes;
    - every observation, unreturned message and repair waiting in them;
    - every message no other account's mailbox has shown, now or before, with its held bytes and
      structure;
    - the files in the log that no message left holds;
    - the sign-in in the keychain.
  - A message another account shows stays, with its bytes. The rows go in one transaction and the
    files after it, so a stop between leaves files nothing refers to, never a row whose file is
    gone.
  - **Derived mail is rebuilt.** Removal throws away everything derived first, as `mail-rebuild`
    does, and the rebuild then derives what is left. At the command line the rebuild runs inside
    the call; on a server it runs as the server's work.
  - **On a server, removal waits for no work.** It holds the server's work back while it removes,
    and fails with `WORK_RUNNING`, which can be retried, while a pass or a rebuild runs. A pass
    asked for that account alone is dropped.
  - **A removal that fails** after what was derived is thrown away still leads to a rebuild,
    inside the call or as the server's work, so the mail does not stay unlisted.
  - A store test lists every table that refers to a message, a mailbox or an account, so a table
    added later fails until removal handles it.
- **A gap in the forwarded call.** When the person stops `mail-account-add` while it runs on a
  server, the command line drops the call and puts the keychain back, but the server may still
  finish adding the account with the password it had already read. The account then exists with
  the earlier password, or none, and the next sync reports `SIGN_IN_REQUIRED`. Accepted with step
  B5's third pull request: the person sees the account in `mail-account-list`, and can remove it
  with `mail-account-remove` or add it again.

**What this proves, and what it does not.**

- The assurance is `terminal`, in Umbel's vocabulary (its D115): a person, or a program that can
  drive a terminal as that person.
- A program with a shell as the person can read `cli.token` and call the private route, saying
  it has a terminal. It can then do anything the person can: send, trash, change the policy. A
  coding agent with a shell on the same machine is such a program. Nothing in this version stops
  it. That program can also read the mail in the data directory. Whether it could read the
  keychain without the person seeing a prompt is not verified, and may differ by platform; if
  it could not, `cli.token` is what lets it send without one, and the Loam app's stronger
  approval is what closes that.
- So the rule protects against exactly one kind of caller: an agent that reaches the engine over
  MCP and has no shell on the machine, or whose shell is sandboxed away from the data directory.
  That is the case for a hosted assistant connected over MCP, and for Loam's copilot.
- The approval token adds one thing on the private route: it is bound to the validated input, so
  what runs is what was previewed, and a change to the draft between the preview and the "yes"
  fails the retry.
- The stronger assurance, a decision made on a page that proves a person, arrives with the Loam
  app and L7.

## 4. The store

### 4.1 Layout

**The log.** `blobs/<first two hex>/<sha-256>` holds bytes exactly as fetched, compressed, under
the hash of those bytes. A file is written once and never changed. A message held whole is one
file. A message fetched in parts (M20) has a file for its header block, one for each text part,
and one for each attachment when it is fetched; its record says which parts are held. A part's
file is its body as the provider returned it, still in its transfer encoding. Its MIME structure,
as the provider described it, is a row of `structure` and not a file: like a message's reported
size, it is what the provider said, and a rebuild reads it beside the files.

- **A read is checked.** Every read recomputes the hash and fails if it is not the file's name,
  and stops at a size limit, so a damaged file is noticed and a hostile one cannot fill memory.
- **A batch is on the disk before it is recorded.** A file appears under its name only when it
  is written in full. The files of a batch are then flushed together, and only after that does
  the store record them as held, so a row never names a file a power failure could take. One
  flush covers the batch: a plain `fsync` for each file and one `F_FULLFSYNC` on macOS, `syncfs`
  on Linux, a flush for each file elsewhere. Flushing each file fully held the log to about 260
  header blocks a second on macOS, under [4.4](#44-limits-to-meet)'s limit; a flush for each
  batch of 250 stored between 1 700 and 3 100 a second over five runs, and no flush at all 4 400.
- **A batch is written on several threads.** Creating a small file costs the file system a few
  hundred microseconds whatever its size, which held the store just under
  [4.4](#44-limits-to-meet)'s import limit when a batch's files were written one after another.
- **Storing again repairs.** Storing bytes that are already held reads the file there first. A
  damaged one is moved to `blobs/damaged/`, never deleted, and written afresh. So fetching a
  message again mends its file, whatever damaged it.

**The tables.** Step B2 fixed the columns of the tables it created: its first half what is not
derived, its second half a message's fields, its parts, threads and where they show. The rows
for later phases are a sketch, fixed by the step that creates each.

| Table | One row for | Derived from the log |
| --- | --- | --- |
| `account` | An account and its provider | No |
| `mailbox` | A mailbox, with its provider identity, its role, its sync cursor, how many ids its last listing named, and when the provider stopped listing it | No |
| `message` | A message's identity: the hash of its header block, the size the provider reports, when it was first seen and when the provider received it | No |
| `envelope` | What a message's bytes say: its date, sender, subject, a snippet, how many attachments, its thread, the parser's version, and why it could not be read when it could not. Step B4 added its evidence ([6.1](#61-what-is-read)): the list and bulk headers, `Reply-To` and whether it differs from the sender, the topmost authentication header's server and results, how much text is hidden, how many links and how many of them name a host other than their target, the template key and the body's shape. Step C1 added the key of its own Message-ID and of the one it answers, when the provider received it (else when it was first seen), which a sender's dates are read from, and who redirected it (its topmost `Resent-From`) | Yes |
| `link` | A link in a message held whole: its target, its target's host, the host its shown text names, and whether the two differ | Yes |
| `held` | Which of a message's bytes the log holds: the header block, the whole, a text part or an attachment, each with its hash | No |
| `observation` | A message seen in a mailbox: the provider's ids, the flags and labels seen, when. A later observation supersedes an earlier one; none is deleted: a row is ended, as superseded, removed or closed by a new `UIDVALIDITY`, and a new row is written | No: it is the record of what the provider showed |
| `unreturned` | A listed message that did not arrive: the mailbox, the provider's id, how many tries, when | No |
| `structure` | A message held in parts (M20): its MIME structure as the provider described it, as JSON, each part's parameters kept as the provider gave them, up to the limits of [6.4](#64-parsing-strangers-bytes) with the limit it broke. Step B4 created it (migration 5). A message is held in parts when it has this row; the parts holding its text are recorded in the same transaction | No |
| `refetch` | A message's file that a read found damaged or missing, for sync to fetch again: its header block, the whole, or a part of a message held in parts; after three fetches that return other bytes, it is left for a person | No |
| `body_missing` | A message whose body the provider did not return when asked: how many tries, when ([5.3](#53-order-and-fairness)) | No |
| `part` | A part of a message held whole: its place as IMAP numbers it, its type, its file name, its size once decoded, and whether it is offered as an attachment; for a file, its type as its bytes show it, whether that differs from what it says it is, and the hash of its content. Whether a part fetched alone is held is in `held` | Yes |
| `thread` | A thread, with what a list needs: last date, counts, the subject of its oldest message, the snippet and sender of its newest. Its id is the lowest id of its messages | Yes |
| `thread_key` | A Message-ID a message has or names, as 16 bytes of its SHA-256, and the thread it belongs to ([5.6](#56-threads-on-imap)) | Yes |
| `thread_place` | A thread in a mailbox: how many of its messages the mailbox currently shows, how many of those are unread (no `\Seen` flag), and the date of the newest of them. Indexed by mailbox and date, newest first | Yes, from `envelope` and `observation` |
| `index_pending`, `engine_state` | Which messages' documents the index has not yet committed, the highest it has, and how far a rebuild has come | No: the derivation's own bookkeeping |
| `recipient` | An address a message was sent to, from its `To`, `Cc` and `Bcc` (step C1) | Yes |
| `sender` | An address that is not the person's, and its history with them ([7.1](#71-senders)): its domain, the name on its newest message, its messages and how many carry a list or bulk header, when the first and last arrived, how many of the person's messages went to it and when the last did, and how many of its messages the person answered. Fixed by step C1. The person's decisions on senders are step C2's, in `sender_decision`, which is not derived | Yes |
| `template` | A template key and how many held messages have it, wherever they are (step C2, migration 8) | Yes |
| `screening` | An inbound message's screening class, with its date and sender for the lists by class, and whether a mailbox other than junk and trash shows it now (`listed`) ([7.2](#72-the-screening-class)); the person's own mail has no row (step C2) | Yes, from `envelope`, `sender`, `template`, `sender_decision`, the person's own addresses (`account` and the sent mailboxes), `observation` and `mailbox.role` |
| `sender_decision`, `sender_suggestion` | The person's decision on an address (in, out or theirs), with the suggestion it came from; an agent's suggestion, its proposer and where it stands ([7.3](#73-the-persons-decisions), step C2) | No |
| `change` | One row per change to anything a view shows, with a growing sequence number | No |
| `story`, `story_member` | Stories and their messages ([section 8](#8-stories)). Step C2 built stream stories (migration 9): `story_member` holds each bulk message a mailbox other than junk and trash shows, with its stream, date, template key, body shape and whether it is an exception; `story_shape` and `story_kind` count each story's body shapes and template keys; `story` is a stream with members, a story from its fifth, with its counts, title and dates. `stream` gives each list or sender the id its story keeps | Stream and burst stories yes: stream stories from `screening` and `envelope`. `stream` no: its ids are kept, and a rebuild drops only the streams of mail no longer held |
| `first_contact`, `contact_day`, `burst`, `burst_message` | Bursts ([7.4](#74-bursts), step C3, migration 10; migration 11 raised their rule): each account's first contacts, whether each is kept, its counts of them for each day, its bursts and the first contacts each holds. Migration 10 also adds `sender.first_written`, `sender_decision.first_in_at`, `mailbox.first_listed_at` and `account.listed_at` | Yes, from `sender`, `envelope`, `observation` and `mailbox`; `first_in_at`, `first_listed_at` and `listed_at` no |
| `selection`, `operation` | A frozen set of messages, and a change the engine made to one ([section 9](#9-changing-the-mailbox)) | No |
| `policy`, `token` | The person's policy; hashed tokens | No |
| `draft`, `outbound`, `record` | From phases D and E | No |

**The index.** tantivy, with the subject and the text indexed and not stored.

- **It holds what belongs to the message alone:** its id, its date, its sender, its subject and
  its text. A message's thread, its mailboxes and its screening class change after it is
  indexed, and the text is not stored, so changing a field of a document would mean reading the
  message from the log again. Step B2 reads those from the tables after a search. Whether
  `mail-search` needs any of them as a filter inside the index is decided by step B4, with that
  cost.
- **It never claims a document it lacks.** The transaction that derives a message notes in
  `index_pending` that the index lacks its document. The document goes to the index after that
  transaction commits. A commit of the index carries the highest number it holds, and only then
  are the notes up to it removed. After a stop, what is still noted is made again from the log.
  The index is flushed harder than SQLite (whose commits are `synchronous = NORMAL`), so after a
  power failure, or a database restored from an older copy, the index can be ahead of the
  tables; new notes are then numbered above what the index holds, so none is removed unmade.
  A file that cannot be read for the moment leaves its note in place; one that is gone or
  damaged leaves the subject searchable.
- **It is committed** when 5 000 documents wait, before a search, and when a rebuild ends, so a
  search sees everything recorded.
- **An index older than the tables is reported**, not searched: the directory was removed or
  restored from elsewhere. Recording and searching fail with `INDEX_STALE` until `mail-rebuild`
  makes it again; lists do not need the index and go on working.

**What is derived when.** In the transaction that records a batch of headers, each new message
gets its `envelope` row, its thread and its document. In the transaction that records a message
whole, it gets its snippet, its parts and its text. A thread's row and a thread's place in a
mailbox are never adjusted: each is computed again from the messages, once for each batch that
touched it. That is what lets a rebuild give exactly the rows that were there; a test compares
every derived table before and after a rebuild, including threads that merge across mailboxes.

**What a view reads.** A list of a mailbox's threads reads `thread_place` and `thread`, paged
from the last row of the page before. Opening a message parses its file. Search asks the index
for ids and reads `envelope` and `thread`.

### 4.2 What makes two messages the same

Two observations are of the same message when the SHA-256 of the header block and the size the
provider reports for the whole message both match. Both are known for every message, held whole
or in part, so the rule is the same for all of them:

- A message copied to a second mailbox is one message with two observations.
- After a `UIDVALIDITY` change, messages are matched again by this identity and not fetched
  twice.
- A message first held in part and later fetched whole keeps its row and gains the hash of its
  whole bytes.

Whether a provider returns the same header block for one message in two mailboxes is checked on
the owner's accounts in step B3. If it does not, the two are stored as two messages: a duplicate
shown, never a message lost.

**Checked on iCloud by step B3** on 2026-11-11 ([the results](live-icloud-b3.results.json)):
of 293 369 messages in 36 mailboxes, 152 Message-IDs are in more than one mailbox, and every one
of them is held as several messages. In 150 the header blocks differ, as a copy delivered to the
inbox and the copy in the sent mailbox do; in 2 the header block is the same and the size iCloud
reports differs. No message was shown in two mailboxes as one. So on iCloud the rule above never
joined two copies, and the few it keeps apart are what a person would see twice in another client
too. Gmail, where a message is one message with several labels, is checked by step B6.

### 4.3 Rebuild and migration

- `mail-rebuild` recomputes every derived table and the index from the log and the tables that
  are not derived. It is the proof of M3 and the repair for a parser upgrade; it resumes after a
  stop. It removes the index first and the derived rows next, then derives the messages in the
  order of their ids, 200 to a transaction, recording how far it has come. Mail recorded while
  it runs is left for it to derive when it gets there. A message whose bytes cannot be read back
  gets a row that says so, and does not stop it; a file system that refuses for the moment
  stops it, to be carried on later. A store that already held mail when these tables were
  created is marked as needing a rebuild, and new mail waits for it as it does during any
  rebuild.
- The schema has a version. A migration runs forward only, on start, inside a transaction. A
  version newer than the program fails the start with `STORE_NEWER`.
- A row in `envelope` records the parser's version. Raising it marks rows stale, and the engine
  recomputes them in the background, oldest last. Step B4 raised it to 2 with the evidence of
  [6.1](#61-what-is-read). Each pass of sync, whether `mail-sync` runs it or a
  server does in the background (step B5), derives stale messages again for up to 30 seconds,
  newest first, and `mail-status` counts what is left; `mail-rebuild` derives everything.

### 4.4 Limits to meet

Step B2 measures this layout with the harness, with the census's shape, at 500 000 messages:

| Measure | Limit | Origin |
| --- | --- | --- |
| List 50 threads, 95th percentile | 50 ms | Q3 |
| Search and read back 50 threads, 95th percentile | 200 ms | Q3 |
| Import, store side | 500 messages a second | Q3 |
| The tables and the index, against the messages' bytes without attachments | 3 times | Q3 |
| Open one message, 95th percentile | 50 ms | New here |
| The whole data directory, log included, against the bytes of everything held | 1.5 times | New here |

The harness met Q3's four with the text kept in SQLite. This layout keeps it in the log instead,
which is why they are measured again. The last limit is separate because the log holds whole
messages with their attachments, which Q3's measure leaves out.

**Measured by step B2** on 2026-11-11, in a release build on the owner's Mac (Apple silicon, macOS),
with `tests/limits.rs` and the iCloud census's shape: 500 000 made-up messages, whole, with the
census's sizes (attachments above 64 KiB, capped at 2 MiB), in six mailboxes, one of them holding
five in six. Every limit is met ([the results](limits-500000-icloud.results.json)):

| Measure | Limit | Measured |
| --- | --- | --- |
| List 50 threads, 95th percentile | 50 ms | 0.21 ms |
| Search and read back 50, 95th percentile | 200 ms | 13.87 ms |
| Import, store side, headers and whole messages | 500 a second | 733 a second |
| The tables and the index, against the messages' bytes without attachments | 3 times | 0.23 times |
| Open one message, 95th percentile | 50 ms | 1.49 ms |
| The whole data directory on the disk, against the bytes held | 1.5 times | 0.89 times |

- **Import is the narrow one.** It has half again the limit's room. It was 494 a second before
  the log wrote a batch's files on several threads and the store kept its prepared statements.
  The machine was busy with other work during the run (load averages 6 to 29 on its 10 cores);
  the result records them. The Linux path, which flushes with `syncfs`, is not measured.
- **What the reads did not cover.** They ran on a store opened afresh, but with the operating
  system's file cache as the import left it; a cold cache is not measured. A search reads back
  50 messages with their threads, not 50 distinct threads.
- **What the mail does.** Two in three messages reply to an earlier one, one reply in fifty joins
  two threads, and every hundredth message joins one thread that grows to 5 000. The template
  copies share their template's text and add their own words.

**Measured again by step C2's second part** on 2026-11-15, the same way, on the Mac's own disk
with the machine otherwise idle, after senders (C1), classes (C2's first part) and stream
stories: every limit is met ([the results](limits-500000-c2.results.json)). Import is 515
messages a second; `main` before stories (`8da5804b`) gave 569 the same day on the same disk, so
stories cost about a tenth of it, and import's room over the limit is now 3%. Every made-up
message carries a list header, so all of it is `bulk` and in a stream, and a few senders' streams
hold tens of thousands. Where that tenth goes: a profile put most of it in the writes to
`story_member` and in the checkpoints those pages add. Two indexes keyed by a hash (by shape and by
template key) cost a fifth more import and were replaced by one index by date that holds both;
counting each touched story again for each batch cost more still (below). On the owner's external
drive, whose flushes are slower, `main` gave 565 and step C2 445 to 476 while the drive was being
indexed by Spotlight; the limits are the Mac's own disk's.
The stories' reads, which 4.4 sets no limit for, were timed in the same run: 2 370 stories, the
largest of 42 060 messages and 517 kinds; a page of 50 stories 0.04 ms at the 95th percentile,
the largest story opened as `mail-story-open` reads it (its row, its ten most common kinds and 50
of its messages) 0.38 ms, and a page of the least common of those kinds 1.88 ms.

**Measured by step B7** on 2026-11-13 on the owner's iCloud account, synced from empty by the
release build's `serve`: 293 929 messages in 36 mailboxes (293 932 counted once in each mailbox
that shows one), 7.1 GB held, with an agent's token
over MCP, 100 calls each ([the results](live-icloud-b7.results.json)):

| Measure | Limit | Measured |
| --- | --- | --- |
| List 50 threads, 95th percentile | 50 ms | 0.57 ms |
| Search and read back 50, 95th percentile | 200 ms | 4.21 ms |
| Import, store side | 500 a second | Not measured: a first sync waits on iCloud, and the engine used under 2% of a core |
| The tables and the index, against the messages' bytes without attachments | 3 times | 0.27 times |
| Open one message, 95th percentile | 50 ms | 3.27 ms |
| The whole data directory on the disk, against the bytes held | 1.5 times | 0.76 times |

The largest table is `link`, 1.11 GB of the database's 1.52 GB: 7.2 million links in 289 000
messages, most of them in the largest mailbox.

## 5. Sync

### 5.1 The provider interface

Everything above this line is the same for every account. A provider implements:

| Operation | Returns |
| --- | --- |
| List mailboxes | Each mailbox with its identity and, where the provider says, its role |
| List a mailbox | The provider's ids of the messages in it, newest first, in pages |
| Fetch headers | For a batch of ids: size, dates, flags or labels, the header block, the provider's thread id if it has one |
| Fetch a message, or a part | Bytes |
| Changes since a cursor | Messages added, removed and changed, and a new cursor; or "cursor too old" |
| Wait for a change | Returns when the provider signals one, where it can |
| Apply a change (phase D) | Flags, labels, a move, an append; reports each message's outcome and its new id where it has one |
| Send (phase D) | The provider's id for the sent message |

The interface names no protocol. iCloud implements it over IMAP and SMTP, Gmail over its API.

**A mailbox's role** is inbox, sent, trash, junk, archive, all or none. The engine takes it from
the provider's special-use flag where there is one; otherwise from a table of each provider's
known mailbox names, which is data; otherwise the person names it in `mail-account-add`. iCloud
flags only its sent and trash mailboxes, so its junk and archive mailboxes come from the table.
A command that needs a role the account has no mailbox for fails with `MAILBOX_NOT_FOUND` and
says which role.

### 5.2 IMAP

- **Reading never changes the mailbox.** The connection opens a mailbox with `EXAMINE` and
  fetches with `BODY.PEEK`. `SELECT` is used only by a command that writes.
- **Identity in a mailbox.** A message in a mailbox is its `UIDVALIDITY` and UID. If
  `UIDVALIDITY` changes, the mailbox's observations are closed and it is listed again; messages
  already in the log are matched ([4.2](#42-what-makes-two-messages-the-same)).
- **What is sent.** Step B3's connection sends `CAPABILITY`, `LOGIN`, `ENABLE QRESYNC`, `LIST`,
  `EXAMINE`, `UID SEARCH`, `UID FETCH` with `BODY.PEEK`, and `LOGOUT`, and nothing else; a test
  over the scripted server fails if any other command is sent. Step B4 adds `UID FETCH` of
  `BODYSTRUCTURE`, and of `BODY.PEEK` at a part's place, for a message fetched in parts (M20).
  Step D1 adds, for an operation alone ([9.2](#92-the-commands)), `SELECT`, `STATUS`,
  `UID STORE`, `UID COPY`, `UID MOVE` where the server offers `MOVE`, and `UID EXPUNGE`; changing
  mail needs `UIDPLUS`.
- **First sync.** `UID SEARCH ALL`, then headers in batches of 250, newest first, then bodies
  in batches of up to 400 or 8 MiB. Step B7 measured iCloud at about 2.8 seconds for each request
  and 36 milliseconds for each message in it: 50 messages a request read 10 to 12 a second, 400
  read 22 to 26.
  The cursor (the next UID and the highest mod-sequence) is stored once every listed message has
  been tried. A mailbox that stops before then is listed again on the next pass, and only what it
  does not yet show is fetched: the stop costs one listing, and the flags of what it already
  shows, never a batch already stored. The flags are read because the cursor that listing stores
  will not cover a change made while the pass was stopped.
- **Later syncs.** With QRESYNC, the mailbox is opened with the stored cursor, and the server
  names what vanished and the flags that changed. With CONDSTORE alone, `CHANGEDSINCE` finds
  changed flags and `UID SEARCH ALL` what remains. With neither, every message's flags are read
  and `UID SEARCH ALL` says what remains: a message the server lists and never returns is missing
  from a `FETCH` and has not left. New mail is the UIDs from the cursor's next UID on. A
  generation that changes between two openings in one pass begins the mailbox again.
- **Mail that leaves unreported** (step D2's large run). A mailbox whose `EXISTS` is below what the store
  still shows there has lost messages no `VANISHED` named and a search may still list: 491
  messages left iCloud's trash that way, and its search went on listing about 10 000 that had
  left the large mailbox. Then the UIDs a `UID FETCH 1:* (UID)` returns are what the mailbox
  holds, and a message the mailbox shows, which the server once returned, has left when that
  answer leaves it out. This is not the rule above, which is about messages never returned:
  those are never shown, so never ended here. The answer is used only when it returned at least
  `EXISTS` messages, since one cut short would end mail still there. A pass whose count agrees
  asks nothing more; a departure hidden by mail that arrived in the same pass is found on the
  next, and a pass that lists the mailbox in full does not check the count. The answer is counted
  only by the UIDs below the next UID the mailbox had when opened, the moment its `EXISTS`
  describes; a message the mailbox shows at or past that UID, such as a copy the engine made
  during the pass, is in the answer and is never ended here. A server that gives no `UIDNEXT` is
  checked this way only when its `EXISTS` said the mailbox was empty, since new mail could not be
  told from old. On a
  server whose `EXISTS` counts messages it never returns, each such message hides one departure
  for good; iCloud's does not count them.
- **Flags** are kept as the server gives them, with the system flags written one way whatever
  their case. `\Recent` is left out: it belongs to a session, not to the message.
- **Waiting.** `IDLE` on the inbox where the server offers it; other mailboxes are polled. Step
  B3 polls every five minutes, in `mail-sync` with `follow`; `IDLE` arrives with `serve` (step
  B5), where sync runs in the background.
- **A dropped connection** is opened again with backoff (one second, doubling, five times), and
  the step that failed is tried again. A batch is the unit of progress: the cursor moves only
  after a batch is stored.
- **A request that keeps failing** on a connection that can be opened is asked again with a new
  connection, without counting toward giving up the pass. After two failures the messages that
  request asked for are asked for one at a time, and those after them in batches again; a message whose request fails alone four times is passed over and
  counted as not returned ([5.4](#54-messages-listed-and-not-returned)), so a message the engine
  cannot read never holds back its mailbox. Twenty-four such failures in a row across the
  account end the pass with `PROVIDER_UNAVAILABLE`.
- **Signing in.** A `NO` to `LOGIN` is `SIGN_IN_REQUIRED`, unless its code is `UNAVAILABLE`,
  which is the server refusing for the moment. The reply is read for its code alone.
- **A mailbox the provider stops listing** shows nothing: its observations are closed. If it is
  listed again, it is listed in full and its messages are matched by their identity. A listing
  that does not name the inbox retires nothing.
- **One request a mailbox, when nothing is new** (step B5). A pass opens a mailbox that has a
  cursor and asks what changed since it in one `EXAMINE` that names the stored `UIDVALIDITY` and
  the cursor's mod-sequence (QRESYNC, RFC 7162 section 3.2.5). The server reports what vanished
  and the flags that changed, and the pass asks for new UIDs only when `UIDNEXT` moved. A server
  that answers for another `UIDVALIDITY` ignores the parameters; the mailbox is then listed again.
  A mailbox that now keeps no mod-sequences (`NOMODSEQ`) has its flags and what remains read in
  full. Without QRESYNC, a pass opens the mailbox and then asks, as before.
- **What a pass with nothing new costs** (step B5, measured on the owner's iCloud account,
  2026-11-13, reading only; counts in the plugin's `docs/live-icloud-b5.results.json`).
  - The 174 seconds step B3 measured did not come back. A pass with nothing new took 22.3
    seconds, all but 0.5 of them waiting for iCloud's replies: 72 requests in turn, two for each
    of the 36 mailboxes. The pass before it, which found 9 new messages and 1 changed, took 26.0.
  - The store's reads a pass makes, timed apart after the passes, took 0.3 seconds in all and
    113 ms at most for one mailbox, the largest of which shows 271 167 messages. Timed again
    after the second run they took 0.9 seconds and 258 ms.
  - B3's second pass came straight after a first that fetched bodies only for a sample, and is
    likely to have spent its time on bodies that sample left; that was not measured.
  - With one request a mailbox, two passes took 12.7 and 12.1 seconds: 0.27 seconds for each
    mailbox, a second to sign in, and 0.6 seconds of the engine's own.

### 5.3 Order and fairness

- Mailboxes take turns, a batch each, so the inbox of a new account is listed and readable while
  a mailbox of 283 000 messages is still arriving.
- Within a mailbox, newest first. Within an account, the inbox and the sent mailbox go first:
  the sent mailbox is what tells the engine whom the person has written to.
- Bodies follow headers, in each mailbox: a mailbox fetches its bodies once its headers are in,
  while a larger one is still fetching headers. A turn with nothing to fetch opens nothing. A
  message someone opens is fetched at once, ahead of the queue (step B4).
- A message over 1 MiB is fetched in parts (M20), on its own turn: its `BODYSTRUCTURE`, then in
  one request the parts that hold its text, recorded together. Which parts hold its text is read
  from the structure alone: the plain and HTML parts a reader of the whole message would show,
  not those of a message carried inside it, and none over 16 MiB as sent (the engine reads 4 MiB
  of HTML; a larger part can still be opened as a file). Its files wait until someone opens one,
  and are then fetched one at a time, up to the 256 MiB the log reads back. A message whose
  structure, or one of whose text parts, the provider does not return counts a try, as a body
  does. One whose structure nests deeper than the engine reads is held as that
  ([6.4](#64-parsing-strangers-bytes)) and not asked for again.
- A body that conflicts with bytes already held for its message is set aside, and the rest of its
  batch is recorded.
- A body the provider does not return when asked follows the rule of
  [5.4](#54-messages-listed-and-not-returned): a try counts at most once an hour, and after three
  it no longer holds the mailbox back from "synced". It is asked for again weekly, and
  `mail-status` counts it.
- The junk and trash mailboxes are **header-only**: their bodies are fetched only when someone
  opens a message. They are shown apart, and are in no story and in no count the person did not
  ask for. Their headers still count toward a burst ([7.4](#74-bursts)). On Gmail their headers
  come from the metadata form, without a header block ([5.5](#55-gmail)).

### 5.4 Messages listed and not returned

A fetch that succeeds and returns nothing for a listed message is not an error. The engine:

1. Counts the try in `unreturned`.
2. After three tries in separate sync passes, at least an hour apart, stops trying each pass. The
   message is **unreturned**: it does not hold the mailbox back from "synced", and
   `mail-status` reports the count for each mailbox.
3. Tries unreturned messages again once a week, and whenever the mailbox is listed again in full.
   One that answers is stored like any other and leaves the table.
4. Never invents a message for them. Nothing unreturned appears in a list of mail, a count of
   mail or a story.
5. Still lets a person act on them. A selection that names a whole mailbox includes its
   unreturned messages, counted apart, so that emptying a mailbox can empty it
   ([9.1](#91-selections)).

A message that disappears from the listing is a removal, recorded as an observation.

A message's file that a read finds damaged or missing is noted, and the next pass fetches its
bytes again from a mailbox that shows it. Storing the same bytes repairs the file
([4.1](#41-layout)), and the message is derived again, so that what was derived while the file
could not be read gives way to what a rebuild would give. A provider that returns other bytes
three times leaves the note for a person.

### 5.5 Gmail

**Step B0's probe.** Before any Gmail code, step B0 probes the owner's account read-only with
[`prototype/gmail_probe.py`](../../../../../docs/features/active/mail/prototype/README.md#the-gmail-api-probe):
first on 2026-11-24 ([the counts](../../../../../docs/features/active/mail/prototype/gmail-probe.results.json)),
then again a week after signing in. What it has not observed is marked "not verified".

What the first run observed, on an account of 18 247 messages in 17 372 threads, one request
at a time:

- **Sign-in.** A Desktop app client of the owner's own, in a Google Cloud project whose consent
  screen the owner set to testing status (the owner's word; the record cannot show it), signed in through the system browser and a loopback redirect on
  127.0.0.1 with PKCE, and Google issued a refresh token for `gmail.readonly` alone. That scope
  reads the profile, the labels, the listing, a message in raw and in metadata form, and the
  history. Whether a client in testing status expires its refresh token in a week: not verified;
  the second run answers it.
- **Rate.** Listing ids, 500 a page, read 1 495 ids a second. Fetching a message in raw form
  took about 0.23 seconds a request for the newest 200 messages (10.6 MB in all) and about 1.4
  seconds for 20 messages over 1 MiB (116 MB in all), refused requests included. Gmail refused
  12 of the 232 raw-form requests with `403` and the reason `rateLimitExceeded`, about one in
  19, with requests made one at a time; every one was answered on a retry with backoff, and no
  other kind of request was refused. Whether the limit is per user, per project or per kind of
  request, and whether more requests in flight raise or lower the rate reached: not verified.
- **Quota.** Gmail does not report what a call costs. By Google's published cost of each
  method, a first sync of this account spends about 185 units listing and 91 235 fetching each
  message in raw form.
- **History.** A sync from a history id 12 300 behind the current one returned 678 records,
  202 of them adding messages. A history id far older than any history kept (1, against a
  current id 2 384 409) returned `404` with the status `NOT_FOUND` and the reason `notFound`.
  Google documents `404` for a history id that is out of date; one that once worked and then
  expired was not observed, and how long Gmail keeps history: not verified.
- **Header blocks.** The metadata form returns a message's headers by name and value, not its
  header block as bytes. Its names matched the raw form's, in order, in all 220 messages
  compared; after unfolding and collapsing spaces, its values matched in 84 of the 200 newest
  and in none of the 20 over 1 MiB. Why the others differ was not examined; Gmail may decode
  them. Of Gmail's four forms (full, metadata, minimal and raw), only raw holds the message's
  bytes, so a header block can be had as bytes only by fetching the whole message.
- **Labels.** The account has 14 system labels (among them `INBOX`, `SENT`, `TRASH`, `SPAM` and
  the five categories) and 2 of the owner's.

Not yet probed, because each changes the mailbox and needs a wider scope and the owner's
approval: which scope a label change and a send each need (`gmail.modify` and `gmail.send` are
expected; not verified), whether a batch label change can move messages to trash, and whether a
sent message is kept in the sent mailbox without an append. They wait for the owner to approve
the wider scopes and a message to change.

The design:

- **Sign-in.** OAuth with the person's own client, through the system browser and a loopback
  redirect that the command line runs. The refresh token goes to the keychain. Phase B asks for
  read access only; phase D adds the scopes to modify and to send.
- **Identity in a mailbox.** Gmail's message id and thread id. Labels are mailboxes; a message
  has one observation per label.
- **First sync.** List message ids, newest first, then fetch each in raw form. The rate is
  Gmail's to set, not the engine's: a request Gmail refuses for its rate (`429`, or `403` with
  `rateLimitExceeded` or `userRateLimitExceeded`) is retried with backoff and does not count
  toward giving up the pass, up to a bound: the backoff doubles to a ceiling, and refusals for
  the rate with no request answered in between end the pass with `PROVIDER_UNAVAILABLE` after a
  time. Step B6 sets the ceiling and the time. At the first run's rate, one request at a time,
  a first sync of the owner's account takes about two hours: 18 247 raw requests at 0.23
  seconds is 71 minutes, and the backoff added about half to the time in requests. The inbox and the
  sent mailbox go first ([5.3](#53-order-and-fairness)).
- **Large messages.** Gmail's raw form is the whole message or nothing, and the metadata form
  gives headers, not their bytes, so a Gmail message is fetched whole whatever its size, and
  M20 applies to IMAP alone. The census found 143 Gmail messages over 1 MiB.
- **Header-only mailboxes.** Gmail's spam and trash are header-only ([5.3](#53-order-and-fairness))
  and cannot have a header block without the whole message. Their messages are held from the
  metadata form, as headers by name and value with no header block, and fetched whole when
  someone opens one. What reads a header block (the evidence of [6.1](#61-what-is-read))
  reads those headers instead for these messages; step B6 says what that changes. A message
  that also carries a label of a mailbox that is not header-only is held whole.
- **Later syncs.** The history from the stored history id. If Gmail answers `404` for it, the
  id is too old: the engine lists ids again and compares, fetching only what it lacks.
- **Threads** are Gmail's own.

### 5.6 Threads on IMAP

A message joins the thread of any message its `References` or `In-Reply-To` names, or that
names it. A message that names none starts a thread. When a message names messages of two
threads, they become one. Two messages that name the same message are one thread, whether or
not that message is held. A thread's id is the lowest id of its messages, so the order in which
mail arrives does not change it. The last 200 ids of a `References` header and the first 200 of `In-Reply-To` are read.

A shared subject does not join two messages. Step B4 counted, on the owner's iCloud account
without its largest mailbox ([the counts](live-icloud-b4.results.json)): of 2 466 subjects
shared by two messages or more, with `Re:` and the like removed, 1 159 were in threads their
headers keep apart, so joining by subject would have been wrong for nearly half of them, under
6 075 messages. 16 214 of the 22 612 messages name no other message, and stay a thread of their
own until one names them.

### 5.7 What "synced" means

`mail-status` reports, for each mailbox: messages listed, headers held, bodies held, unreturned,
the last successful pass, and the last error.

- A mailbox is **listed** when every listed message has headers or is unreturned.
- A mailbox is **synced** when it is listed and every message the engine means to hold is held:
  on IMAP, whole when it is 1 MiB or less and in parts when it is larger; on Gmail, whole
  whatever its size. A header-only mailbox is synced when it is listed; on Gmail, when every
  listed message's headers are held from the metadata form ([5.5](#55-gmail)). `mail-status` counts a message held in parts among its bodies
  held.
- An account is synced when its mailboxes are.

`mail-sync` does not wait for any of this. Under `serve` it asks the background sync to run a
pass now and returns at once; `mail-status` reports the pass ([3.2](#32-modes)). Run directly with no server, it runs one pass, until each
mailbox has fetched what it can, and returns what the pass did, in counts; at a terminal it prints
progress, ids and counts only. With `follow`, which only the command line may ask for, it keeps
syncing until stopped, a pass every five minutes (step B3's interval; see [5.2](#52-imap)).

## 6. Evidence

Evidence is what code can read from a message without judging it. It is recomputed, never edited.

### 6.1 What is read

| Evidence | Rule |
| --- | --- |
| Structure | The MIME tree: each part's type, size, name and hash |
| Visible text | The text a person would see: the plain part, or the HTML with markup removed |
| Hidden text | Text in the HTML a person would not see ([6.2](#62-hidden-text)). Kept apart; never in the snippet or the index's main field |
| Links | Each link's target and its visible text, and whether the text names a different host from the target |
| The authentication header | The `Authentication-Results` header. Any server on the way can write one, so it is content unless the account's own provider added it. Only that one becomes the engine's own fact. Fixed by step B4 below |
| List and bulk headers | `List-Id`, `List-Unsubscribe`, `List-Unsubscribe-Post`, `Precedence`, `Auto-Submitted` |
| `Reply-To` | Recorded, and flagged when it differs from the sender |
| Attachments | Type by content, not by name, where the bytes are held; name; size; hash. Every part with a name or offered as an attachment is read, whatever type it declares; it is marked when its bytes are a program and its name is not a program's, or when they are another kind of file than its name's ending (or, without one, its type) says |
| Thread | [5.5](#55-gmail) and [5.6](#56-threads-on-imap) |
| Template | [6.3](#63-the-template-fingerprint) |

**The provider's authentication header** (step B4, on the owner's iCloud account,
[the counts](live-icloud-b4.results.json), which the probe in `engine/tests/live_evidence.rs`
writes). iCloud writes one header for each check (`spf.icloud.com`, `dkim-verifier.icloud.com`,
`dmarc.icloud.com`, `bimi.icloud.com`, and in older mail servers under `me.com`, `mac.com` and
`apple.com`). They are never the first fields of the block: iCloud's own `Received` fields come
first, the one where the message came in from outside among them, then its results, often with
other fields between them, then the sender's first `Received` field. So the engine:

- passes over the fields at the top, and refuses to vouch for anything if one of them is a
  `Received` field taken by a server with a domain that is no known provider's: that is the
  sender's, and what follows the provider did not write;
- reads the `Authentication-Results` fields from the first one down to the next `Received`
  field, from servers of the provider the first one names (a table of each provider's domains,
  which is data), and takes each check's first result;
- reads results with their comments and quoted strings removed, the first word of each part
  only (RFC 8601).

Of 22 612 header blocks, 14 141 had such headers; the engine reads iCloud's results for 13 543 of
them and vouches for nothing in 598, mostly older mail laid out otherwise. The results are the
engine's own fact only when the provider is the account's. **What is not verified:** whether
iCloud removes a header a sender wrote with its servers' names. If it does not, such a header
placed directly under iCloud's own, by a sender who talks to iCloud's servers directly, could fill
a check iCloud did not report, and when iCloud reported nothing it could stand for iCloud's. A sender can also write a `Received` field naming an internal host or an
address, which the refusal above takes for the provider's; it catches only an honest layout.
Until that is checked, an authentication result orders and flags mail; it is never a reason to act
without the person.

### 6.2 Hidden text

Text is hidden when its element, by its own style or an ancestor's, has `display: none`,
`visibility: hidden`, zero opacity, a font size under 2 pixels, a colour equal to its background,
or a position off the page; and zero-width characters are removed from visible text. The engine
reads inline styles and the message's own style blocks. It loads nothing from the network. The
rule list is data, and the test corpus in [section 14](#14-exit-criteria-and-tests) grows with
each case found.

As step B4 built it (`engine/src/html.rs`):

- A style block's rule applies when its selector is a tag, a class, an id, or a tag with a class
  or an id; a rule with any other selector, or inside an at-rule (`@media`, `@font-face`), is not
  applied, so text hidden only by such a rule reads as visible. `!important` is honoured, over
  an element's own style too; otherwise rules apply in order, without CSS's specificity, so a
  less specific rule written later can hide text a browser shows (it never shows hidden text).
  `mso-hide`, which hides only in Outlook, does not hide: iCloud shows it.
- What hides: `display: none`, `visibility: hidden` (which a descendant can undo), opacity of
  0.05 or less, a font size under 2 pixels or points or under 0.15 em, a zero height or width
  with `overflow: hidden`, a position 500 pixels or more off the page, `clip` and `clip-path`
  that show nothing, `transform: scale(0)`, the `hidden` attribute, and text
  the colour of its background or with no colour at all. Under a background image the colour
  behind the text is unknown, and the text is taken as shown.
- What is never rendered (`<head>`, `<script>`, `<style>`, `<template>`, `<noscript>`,
  `<object>`, `<iframe>`) is not text: neither shown nor counted as hidden.
- Characters no one can see (zero-width characters, bidirectional controls, Unicode's tag
  characters and the other default-ignorable code points) are removed from visible text,
  plain or HTML, and counted as hidden.
- When a message has HTML, what a person sees is its HTML; its plain part is not read, since a
  client shows the HTML. Hidden text is counted, kept out of the snippet and the index, and not
  stored: a read command that shows it reads it from the log.
- A link's host is read as a browser reads it (backslashes, missing slashes, `//host`,
  international names, IPv6); text that is an address naming another site than the link's, or
  an address shown for a link whose host cannot be read, marks the link.

### 6.3 The template fingerprint

The engine computes two values for every message:

| Value | Made from | Used by |
| --- | --- | --- |
| The **template key** | The sender or list id, the MIME structure and the subject's shape with numbers and identifiers removed. This is the census's measure | Screening ([7.2](#72-the-screening-class)), so the engine's rule is the one Q2 was measured with |
| The **body shape** | A hash of the body's skeleton: an HTML body's elements with the text removed, or a plain body's line shapes | With the key, stream stories ([section 8](#8-stories)) and, later, extractors |

The engine's template key is the census's measure exactly: `census.py`'s subject shape and its
reading of the MIME structure from `BODYSTRUCTURE` are ported, with a test of the census's own
outputs, and the source is the `List-Id` header as written or else the sender's address.

The template key needs the structure, which a message held whole or in parts gives, so a message
held as its headers alone (in junk and trash, until someone opens it) has none yet. A message
held in parts gets the key a whole one would ([6.4](#64-parsing-strangers-bytes)).

The census's body check agreed with the template key on 13% of sampled templates on iCloud and
43% on Gmail, so the key alone groups mail whose bodies differ. That is acceptable for
screening, which asks only "is this recurring mail", and not for a story's exceptions or an
extractor, which need the bodies to match. Step C1 reports, on the owner's accounts, Q2 as the
engine computes it beside the census's figure, and how many stream stories each grouping gives.

**Step C1's report** (on the owner's iCloud account, 2026-11-14,
[the counts](live-icloud-c1.results.json), which `engine/tests/live_screening.rs` writes; Gmail
waits for step B6). The engine's Q2 is the census's: 98.3% of 283 365 messages from strangers,
counted as the census counted (every mailbox but junk and trash; census 98.4%), and 60.5% of
12 121 without the largest mailbox (census 60.9%). A header decides
almost all of it; a template seen five times decides 1 921 more. Stream stories, of the bulk mail
from strangers outside the largest mailbox (7 329 messages):

| Grouping | Stories | Messages in them | Groups in all |
| --- | --- | --- | --- |
| List id, or else sender and template key | 269 | 2 885 (39%) | 4 367 |
| List id, or else sender, template key and body shape | 195 | 1 898 (26%) | 5 085 |
| List id, or else sender alone (not one of section 8's) | 370 | 5 964 (81%) | 1 234 |

The template key holds the subject's shape, so mail whose subject changes with each issue makes a
group of one each time: by key, most bulk mail is in no story. The body shape splits groups
further. The owner chose the grouping by sender on 2026-11-14 ([section 8](#8-stories)). One
difference from the census: the engine counts a template as recurring when the store holds five
messages with its key, wherever they are, where the census counted among the inbound messages of
its scope, once for each mailbox showing them; the scopes above choose which messages are
counted, not where their templates are. Since step C2 the report's own addresses include any the
person said are theirs ([7.3](#73-the-persons-decisions)), which the census had no way to know.

### 6.4 Parsing strangers' bytes

- The parser and everything that reads its output are fuzzed (`cargo-fuzz`), with a corpus kept
  in the repository. The fuzz targets (`engine/fuzz/`: a header block, a whole message, HTML,
  and the structure of a message held in parts with bytes in its parts, built by step B4) run
  locally with nightly Rust whenever the parsing code changes, not in the
  workflow: the owner decided on 2026-11-12 that fuzzing stays local, since a daily run spends CI
  time.
- Limits are enforced before work is done: a message's size, its depth of nesting, its number of
  parts, a header's length. A message over a limit is stored in the log, marked `unparsed` with
  the limit it broke, and shown with its headers alone. Step B4's limits: a header block of
  1 MiB, a message of 64 MiB, 1 000 parts, parts nested 20 deep. A text part is decoded only up
  to the 1 MiB of text the index keeps, and an HTML part up to 4 MiB. HTML is read only up to its
  10 000th tag and while no more than 256 elements, and no more than 16 formatting elements
  (`b`, `i`, `a` and the like, which the parser makes again for each block), are open, counted as
  the parser counts them; at most 1 000 style rules are kept. The HTML parser and style matching
  slow sharply, and use gigabytes, on hostile documents past these.
- A panic while parsing one message marks that message `unparsed` and does not stop a sync.
- A message held in parts is read by the code that reads a whole one. The engine writes a message
  from its structure, with each text part held in its place and an empty body for every other
  part, and reads that; each file held is decoded and read for what it is on its own, one at a
  time, so the files someone opens never make the message larger than the engine reads. So its
  parts, text, links, hidden text, body shape and template key are what the whole message gives,
  which a test checks for names written as RFC 2047 encoded words and RFC 2231 values and for a
  forwarded message inside it; a file not yet fetched has no hash and no type read from its
  bytes, and its size is estimated from its encoded size. A part's parameters are written back as
  the provider gave them: an RFC 2231 value only when it holds nothing but what such a value
  may, any other as a quoted string with its quotes and backslashes escaped and no control
  character; a type, a disposition or a subtype only when it is a MIME token; and each boundary
  is made from the hash of the text held. So a stranger's names and types add no header and no
  boundary. A text part's file that is damaged or missing leaves the message read as though that
  part were not held until sync fetches it again. A structure past the limits above is kept up
  to them and marks the message `unparsed`.
- The IMAP parser (`imap-proto`) reads a nested list by recursion, with no limit of its own. It
  measured about 8 KiB of stack a level when optimised and 60 KiB when not, so a message whose
  parts nest a thousand deep gives a `BODYSTRUCTURE` that aborts the process, every pass. The
  connection's reader therefore follows the parentheses of what the server sends, outside its
  quoted strings and literals (a literal's line break is inside the reply, and keeps its depth),
  and refuses a reply nested deeper than 32, which a message within the 20 levels above keeps
  under. The request fails with an error of its own, not as a dropped connection, and the
  connection is closed: the message is held as a structure that broke the depth limit, marked
  `unparsed` and shown with its headers alone, and its structure is not asked for again. A
  request for a batch of messages refused that way is narrowed and passed over as one the engine
  cannot read ([5.2](#52-imap)); any other, such as opening the mailbox, names no message, and
  the mailbox stops for that pass with the error.
- HTML handed to a caller for display is cleaned with `ammonia`: no script, no form, no frame,
  and every remote reference reported so the caller decides whether to load it. The engine
  loads none. As step B4 built it, a relative address is removed (a message has no page to
  resolve it against), a `cid:` image of the message is kept, and the remote references are read
  from the cleaned HTML as a browser parses it, so an address spelled to slip past a check (a tab
  inside `https`, say) is still counted. `mail-message-open` counts the remote references for
  every caller, and gives the cleaned HTML, the references themselves and the hidden text only to
  a person at a terminal who asks (`cli` and `human`): an agent, at the command line as `script`
  or over MCP, reads the visible text. Whether Loam's app gets the HTML over its mount is step
  B5's, with `serve`.

## 7. Relationships and screening

Phase C. Everything in this section is code and the person's own decisions; no model.

### 7.1 Senders

A sender is an address. The engine also groups addresses by registrable domain for display, and
never treats two addresses as the same person because a domain or a display name matches.

For each sender the engine derives: whether the person has ever written to it, how many times,
how many of its messages the person answered, when it was first and last seen, and whether its
mail carries list or bulk headers. The person's own addresses are the account's address, every
address on a message in a sent mailbox, and any the person adds.

As step C1 built it (`engine/src/store/senders.rs`):

- **The person's messages** are those a sent mailbox has shown, now or before: the provider put
  them there because the person sent them, and moving one out later does not unsend it. A
  message's `From` never makes it the person's: otherwise a stranger could write a message "from"
  the person, copied to themselves, and be taken for someone the person wrote to. A mailbox that
  becomes a sent mailbox, or stops being one, changes this, and every sender is computed again.
- **The person's own addresses** are every account's address and the sender of every message of
  the person's ("every address on a message in a sent mailbox" above means its sender), which
  covers aliases and send-as addresses, as the census's did. A message the person redirected
  keeps its first sender's `From`, a stranger's: its `Resent-From` is the person's instead. They
  have no sender row; a row that goes because its address turned out to be the person's is a
  change like any other. An address the person adds by hand is a decision of theirs, `mine`
  ([7.3](#73-the-persons-decisions)); it is theirs from then on, and its mail is not inbound,
  but its messages do not become the person's, so a stranger who writes "from" it is never
  taken for someone the person wrote to.
- **Written to** counts the person's messages with the sender among their `To`, `Cc` and `Bcc`,
  or, for a message the person redirected, the `Resent-To`, `Resent-Cc` and `Resent-Bcc` of its
  topmost redirect: the run of `Resent-` fields from the first, never a field from a lower block,
  which whoever sent the message could have written. A redirect answers nothing of the person's:
  it keeps its first sender's `In-Reply-To`. **Answered** counts the sender's messages, each Message-ID once, that a message
  of the person's answers: the one its first `In-Reply-To` id names, or else the last id of its
  `References`.
- **First and last seen** are when the provider received its first message and its last (the
  `INTERNALDATE`, else when the engine first saw it), never the `Date` header, which the sender
  writes: a flood with old dates would otherwise pass for mail from senders long known
  ([7.4](#74-bursts)).
- **List or bulk** counts the sender's messages with a `List-Id`, a `List-Unsubscribe`, a
  `Precedence` of bulk, list or junk, or an `Auto-Submitted` other than `no`: 7.2's rule 3, as the
  census read it.
- **The registrable domain** is read with the public suffix list (`alerts@mail.example.co.uk`
  gives `example.co.uk`).
- **A sender's row is derived** like a thread's: never adjusted, computed again from the messages
  once for each batch that touched it (a message from it, a message of the person's naming it or
  answering it, before and after the message is derived again), so a rebuild gives the same rows;
  tests compare them, over one batch and over several. Each count reads the sender's own range of
  an index, or starts from the sent mailboxes and reads the person's few thousand messages; none
  reads the whole of the mail, and a test checks the plan of every query. The sender's own range
  is long for a large sender: 22 milliseconds for each batch that touches the sender of 272 221
  messages. Its id is the first 52 bits of its address's SHA-256, so a rebuild gives the same id
  and a JSON reader keeps it exactly.
- **While messages wait to be derived again** after a new version of the derivation, as after
  step C1's, their senders' rows count them only once they are; `mail-status` gives how many
  wait (`stale`). Screening that reads these rows waits for none to, and for no rebuild: as step
  C2 built it, a read of classes fails with `SCREENING_NOT_READY`, which can be retried, and
  `mail-status` says `screening.ready`. A decision is recorded whatever waits.
- **The commands.** `mail-sender-list` gives the senders the most recent first (the later of
  their last message and the person's last to them), paged by cursor, and filters by registrable
  domain or to those the person has written to. `mail-sender-show` gives one sender with the
  mailboxes its messages are in now and the ten lists they came through most. An address, a
  name, a domain and a list id came from messages, so they sit in a content part ([12.1](#121-content-labels)).

### 7.2 The screening class

Every inbound message gets one class, by the first rule that matches:

| | Class | Rule |
| --- | --- | --- |
| 1 | `blocked` | The person screened the sender out |
| 2 | `known` | The person screened the sender in, or has written to it |
| 3 | `bulk` | The message carries a list or bulk header, or its template key was seen at least five times |
| 4 | `unknown` | Everything else |

- `known` mail is the inbox. `bulk` mail is shown as stream stories ([section 8](#8-stories)).
  `unknown` mail waits in a queue to be screened: the person answers once for a sender, and the
  answer is rule 1 or 2 from then on. `blocked` mail is kept, and shown only when asked for.
- The class is derived, so a new decision or a better rule reclassifies old mail.
- A class never moves, deletes or marks a message at the provider.
- Rules 3 and 4 are the census's Q2, so the figures the owner saw describe this queue.

**As step C2 built it** (`engine/src/store/classes.rs`, migration 8):

- **Inbound** means the sender is not one of the person's own addresses ([7.1](#71-senders)),
  as the census and step C1 counted. The person's own mail has no class; a result that lists a
  message gives it `own`.
- **A class is derived like a thread**: never adjusted, computed again, so a rebuild gives the
  same rows, which tests compare after each change and against classing everything from
  nothing. It depends on the message's row, on whether its sender is the person's and whether
  the person has written to it, on whether its template key has reached five, and on the
  person's decision. Each batch classes again the messages it derived; a sender for which one
  of the two turned, a template that reached five or fell below, and a sender the person
  decided on have every one of their messages classed again. So a batch that adds mail to the
  sender of 272 221 messages touches none of its others.
- **Templates are counted** in `template`, wherever their messages are, as step C1 reported. A
  message held as its headers alone has no template key until its body is held
  ([6.3](#63-the-template-fingerprint)).
- **A store that held mail before** is classed once when it is next opened after migration 8.
- **The lists by class.** `mail-message-list` gives one class's messages, newest first, paged by
  cursor: `known` is the inbox, `unknown` the queue, `blocked` and `bulk` when asked for. It lists
  a message only while a mailbox other than junk and trash shows it, the census's scope, so
  junk does not fill the queue and what the person deleted leaves it; the class itself is kept
  wherever the message is. Whether a message is listed is a derived flag beside its class, so a
  list reads a partial index of the listed rows and never looks at where each row's message is:
  it is computed again for each message whose observations a batch changed, and for every
  message of a mailbox that closed its observations (a new generation, or gone) or became junk
  or trash or stopped being. `mail-thread-open` gives each message's class, `own`, or null while
  screening waits. `mail-status` gives the queue: its messages and how many senders they come
  from. `mail-sender-list` with `waiting` gives the senders whose mail is in the queue, which is
  where the person answers once for each.

**What a model adds.** The `unknown` queue is ordered by date. A caller may propose an order or
a category for its messages as records ([10.1](#101-records)); the engine stores them with their
proposer and shows them as suggestions. It does not act on them. Records are step E1's, so until
then the queue is ordered by date alone.

### 7.3 The person's decisions

A decision on a sender is in, out or undecided, and is the person's alone.

- `mail-sender-screen` records one. It is a person's command, run at the terminal and, later,
  in the app. It needs no approval prompt of its own beyond being unavailable over MCP: it is
  local and undoable.
- An agent cannot decide. It can call `mail-sender-suggest`, which stores a suggestion with its
  proposer. A suggestion changes no class. The person accepts it with `mail-sender-accept`, a
  person's command, or drops it with `mail-sender-dismiss` (M28). A caller may have 20
  suggestions waiting.
- `mail-sender-accept` carries an approval policy where `mail-sender-screen` does not, because
  the idea was not the person's. Its preview, through `mail-sender-show`, gives the sender in a
  labelled part, the suggested decision, the proposer, how many held messages would change
  class, and whether the person has ever written to that sender. The approval's summary holds
  no address: "Accept suggestion 7: block 1 sender; 412 held messages change class". Otherwise a
  message could talk an agent into hiding the bank's alerts, or into putting a stranger in the
  inbox.
- `mail-status` lists the senders blocked in the last 30 days and by whom, so a wrong block is
  seen.
- A decision survives a rebuild.

**As step C2 built it** (`engine/src/store/decisions.rs`, `engine/src/screening.rs`):

- **A decision is in, out or `mine`**, the last for an address the person says is theirs
  ([7.1](#71-senders)); `undecided` removes one. It is kept by address, with the address's sender
  id, so an address that is theirs, which has no sender row, is still found by its id.
- **`mail-sender-screen`** is the person's at a terminal alone: a script at the command line,
  such as an agent's shell, is refused with `PERSON_REQUIRED`, as every other person's command
  is through its approval. It takes a sender's id, or an address the person types in full, and a
  decision. It refuses in or out on an address that is the person's by an account or by their
  sent mail. It returns the decision before (`previous`), which undoes it, and how many held
  messages changed class or gained or lost one.
- **The person's decision closes every suggestion still open for that address**, as superseded:
  the question is answered. A proposer's new suggestion for an address supersedes its own earlier
  one, so it never counts twice toward its 20. A caller is the actor of the call: an agent by its
  token's id over HTTP, the one agent of stdio, or a person or script at the command line. A 21st
  waiting is refused with `POLICY_LIMIT`.
- **A suggestion is in or out.** An agent cannot suggest that an address is the person's.
- **`mail-sender-accept`** is held for approval every time (`ApprovalPolicy::Required`), so the
  middleware checks the person's approval of each call, and nothing that changes between a
  check and the run can let one through unasked. After the approval it refuses what cannot be
  accepted now: a suggestion not open (`PROPOSAL_NOT_OPEN`), screening not ready, so the
  preview's count could be wrong (`SCREENING_NOT_READY`), or an address now the person's
  (`SENDER_NOT_FOUND`). The preview says whether it can (`acceptable`, and `refusal` with the
  code), and the command line asks nothing, and does nothing, when it cannot or when the preview
  cannot be read. At the terminal the command line reads the preview, `mail-sender-show`
  with the suggestion, and shows the sender's address and name, each named as written in its
  mail and with control characters and the marks that reorder text replaced, whether the person
  has written to it, and who suggested it, before the summary and the question.
- **`mail-sender-dismiss`** is the person's at a terminal, for any suggestion, and any other
  caller's for its own alone (`FORBIDDEN` otherwise): an agent's by its token, stdio's one
  caller's, a script's.
- **`mail-sender-show`** gives the decision, how many of the sender's messages are in each class
  (null while screening waits), and its open suggestions; with a suggestion's id in place of a
  sender's, it is the preview. `mail-sender-list` gives each sender's decision, and filters to
  the senders whose mail waits to be screened (`waiting`), with a suggestion waiting
  (`suggested`), or that the person screened in or out (`decision`).
- **`mail-status`** gives `screening`: whether it is ready, the queue, how many suggestions wait,
  and the 20 latest of the senders blocked in the last 30 days (`blockedLately`, with
  `blockedLatelyTotal` for all of them), each with the person or the suggestion and proposer it
  came from, and its address in a labelled part. `mail-sender-list` with `decision` gives every
  sender with mail that the person screened out, at any time; an address screened before any of
  its mail arrived has no sender row, and is found by `mail-sender-show` with its id.

### 7.4 Bursts

A **burst** is many messages in a short time from senders never seen before. For each account, the
engine detects one when the count of messages from first-time senders in any 24 hours is at least
30 and at least ten times the median daily count over the previous 90 days, and they come from at
least 10 different senders (added with the owner's agreement on 2026-11-15, after step C3's first
try). On a quiet account that median is zero and the first number governs. Headers in the junk
mailbox count: a flood the provider filed there is still a flood.

- The messages of a burst form one story, of kind `burst`, in place of a row or a queue entry
  each. A message that is both in a burst and `bulk` belongs to the burst story and to no
  stream story: sign-up confirmations carry list headers, and a flood of them must not be
  scattered across fifty streams.
- The story is flagged in `mail-status` and on its card: a flood can be sent to hide another
  message, so the flag names the `known` senders that wrote during the burst.
- A message from a `known` sender, or from any sender first seen more than 30 days before the
  burst, is never in a burst story and is never ordered below one.

The thresholds are data. Step C3 tries them on a period and an account the owner names, and
reports what the rule would have shown; Gmail's 2025 is the candidate the census points to.

**As step C3 built it** (`engine/src/store/bursts.rs`, migration 10):

- **A first contact** is a message from a sender whose first message the provider received less
  than 24 hours before it, and who was new to the person when it came: they had not written to it
  before (`sender.first_written`, when they first did), nor screened it in before
  (`sender_decision.first_in_at`, kept when they block it and undo that). A sender they knew is no
  stranger on its first message, so the 30 days of the rule above are met by construction. A
  first contact counts in each account whose mailboxes have shown it, every mailbox included and
  mail deleted since: a flood the provider filed away, or the person threw away, was still a
  flood. It is **kept** when a mailbox of the account other than junk and trash has shown it.
- **A burst** is found where an account's first contacts in any 24 hours, a window that starts at
  one of them, pass the thresholds, and come from at least 10 different senders; windows that
  overlap are one burst, which holds every first contact in them, whatever its class. Days are
  days in UTC. The owner agreed to the senders' minimum on 2026-11-15, after the first try below:
  a few new senders' busy first day, such as a service the person has just joined, is no burst,
  since blocking them is enough, while a flood of sign-ups comes from many sites.
- **Days with no history are not quiet days.** Providers empty junk and trash, so a window is
  judged twice and is a burst when either passes: all its first contacts and their senders,
  against the median over the covered days from where the history of every junk and trash
  mailbox starts, and the account's own; and its kept ones and their senders, against the median
  of kept ones from the account's earliest. A junk or trash mailbox the account had when it was
  first listed whole has seen all that came to it since the engine first listed it, so its
  history starts then, or at the oldest first contact the engine has seen in it if that is
  older, a start kept after the provider empties it; one that appeared later held nothing before
  it did, and sets no start. This is the rule's third version, raised on 2026-11-16 with the
  owner's agreement: the second started a mailbox's history at its oldest first contact alone,
  so a trash mailbox's first first contact, months after the first sync, hid junk floods for a
  month. A store from before bursts had only each mailbox's last pass before migration 10 to
  stand for its first listing; migration 11 puts it back to when the engine first saw its
  account's mail, about the first sync, for each mailbox the account had then. It does this for
  every store it upgrades: in one made with bursts, a mailbox first listed late in the first sync
  counts from that sync's start, and what came there and went before its first pass, hours at
  most, is not seen. An account none of whose mailboxes was ever listed waits. A median needs 30
  covered days before the window, so a flood in the first month of an account's history is never
  a burst, and nor is one wholly in junk or trash before where their history starts or within a
  month after it: at the first sync, the oldest first contact each holds, or the sync itself for
  one that holds none. With providers that delete each message 30 days after it arrives, the gap
  is the month before the first sync; with one that empties a mailbox all at once, or a mailbox
  that holds no first contact then, it runs up to a month past the first sync, and does not come
  back. A time the engine does not sync for longer than the provider keeps junk leaves days that
  read as quiet.
  The messages moved out of junk are kept, and are judged on their own against the account's
  whole history of kept ones; a message stays kept after it is deleted. The owner accepted the
  gap on 2026-11-16: in junk, a flood the provider filed away and nobody moved out did not reach
  the person; in trash, it is mail from before the engine ran.
- **A flood that lasts weeks is one burst while it is unusual.** Its windows overlap from day to
  day, so it is one burst, and it stays one while fewer than half the covered days of the 90
  before a window are its days; after that it is the account's usual day. Thirty new senders a
  day after quiet months are one burst of about 45 days (a day either way, by how full its first
  UTC day is), and what comes after is not; fewer than 30 in any 24 hours, or from fewer than 10
  senders, is no burst. The owner's own flood spiked over a few days and went on for weeks: its
  spike and first weeks would be found if its mail is still held and its tail brought 30 new
  senders a day, which a run on that account would show.
- **An account's bursts are found once it has been listed whole**, every mailbox it had then
  listed at least once (`mailbox.first_listed_at`, `account.listed_at`). Sync fetches newest
  first, so until then each sender's oldest message so far looks like its first. Nor while a
  rebuild runs: its end finds every account's. First contacts and daily counts are kept
  meanwhile; a mailbox that appears later does not hold the bursts back. `mail-status` names the
  accounts that wait.
- **Derived**, so a rebuild gives the same rows. First contacts are computed again for each sender
  a batch touches and written only where they changed, and each day's counts for the days that
  changed. Each listed account whose first contacts changed, or whose junk or trash started or
  stopped showing one of them, has its bursts found again from all its first contacts, which an
  account holds thousands of rather than hundreds of thousands; only the bursts that changed are
  written. A mailbox that moves into or out of junk and trash has its account's first contacts
  made again, and one that turns sent, every account's. The tests compare every row with finding
  them from nothing after each change and through random sequences of floods, older mail, sent
  mail, decisions, mail thrown away, mailboxes that change role, appear, go and come back, two
  accounts and rebuilds; and the window's counts against counting each window whole, on random
  first contacts. The rule has a number, kept in `engine_state` as `burst-rule` and raised
  with any change to it, a threshold included: a store whose bursts another rule found finds every
  account's again when it is opened, and the stories they change. Once builds of a rule are in
  use, the next comes with a migration, so that they refuse a store a later rule found bursts
  in: rule 3 with migration 11.
- **A burst's story** holds its first contacts that are `unknown` or `bulk` and listed, in place of
  a queue entry or a stream story each: they leave the queue, the `unknown` and `bulk` lists and
  `mail-sender-list`'s `waiting`. A message two accounts hold is in its earliest burst's story. A
  burst is a story whatever its size, of kind `burst`, titled with its count of messages and of
  senders; one whose mail is all in junk has no story. Its id is made from its account and its
  first message's time, so a burst that grows back in time takes a new one.
- **The flag.** Every burst is listed in `mail-status`'s `screening.bursts` and marked on its card
  (`by: "burst"` and a `burst` part): its account, its first and last first contact, how many
  there are, and `knownDuring`, the `known` senders whose listed mail the provider received within
  an hour of it (read from the mail dated within a day of it), their ids outside and addresses in
  a labelled part. `screening.bursts` gives `lately` (the bursts of the last 30 days, up to 20,
  each with its `story` or null), `latelyTotal`, `total` and `waitingAccounts`.
- **Never ordered below one**: a `known` sender's mail is the inbox, and a burst is a story; no
  list the engine gives mixes the two. Ordering them in one view is the app's.

**Tried on the owner's mail** on 2026-11-15, with `engine/tests/live_screening.rs` on the copy of
the iCloud store ([the counts](live-icloud-c3.results.json)). The owner named 2024 and 2025, but
had deleted most of that flood's mail, so the store holds none of it; and the owner reports no
flood on Gmail. Of 3 600 first contacts, the busiest 24 hours held 73. The rule as first built,
on messages alone, found one burst: 75 messages in February 2022, every one `bulk`, from 4 new
senders through 16 lists, 72 of them in one folder: one service's first day, not a flood of
strangers. With the senders' minimum it finds none, on the same copy
([the counts](live-icloud-c3-senders.results.json)): opening the copy, which found every burst
again by the new rule, took 225 ms, and the burst's story is gone, its messages back in their
streams. Its other timings were taken while another session loaded the machine (a load average
near 13), so `classifyEverythingMs`, 22 446 against 16 941, is no measure of the change; finding
an account's bursts reads each first contact's sender as well; the 4.4 import, measured again
with no other session running, is below.

**Import with bursts** ([4.4](#44-limits-to-meet)): during an account's first sync its bursts are
not found, and a batch rechecks the first contacts of only the senders whose first day it touches
(a message within it, a first contact derived again, or a sender whose first message, or first
message from the person, moved). Measured at 500 000 made-up messages beside `main` at
`b21c98f2`, one after the other on the Mac's own disk, while another session loaded the machine:
431 messages a second against `main`'s 407, so no cost the noise shows
([the results](limits-500000-c3.results.json), [`main`'s](limits-500000-c3-main.results.json));
neither met 500 under that load. Listing the account found its bursts in about a millisecond, and
a batch of 250 headers after it took 184 ms.

**Measured again** on 2026-11-16, after the senders' minimum merged, on the Mac's own disk with no
other session running (at the start Spotlight and the file provider used about a core each; the
1-minute load average went 2.9 to 8.8, 6.4 to 6.0 and 3.3 to 2.0 across the three runs): `main`
at `70d6c136`, with bursts, then `main` just before them (`1c53dae8`), then `70d6c136` again.
Every limit of 4.4 is met in all three. Import is 511 and 513 messages a second with bursts
against 521 without: bursts cost at most about 2%, from one run without them, and within the
noise, since the header and body phases each moved about 7% between the runs, in opposite
directions. Import's room over the limit is now 2%
([the results](limits-500000-c3-idle.results.json),
[before bursts](limits-500000-c3-idle-main.results.json),
[the second run](limits-500000-c3-idle-2.results.json)). Listing the account found its bursts in
1.3 to 1.5 ms, and a batch of 250 headers after it took 159 to 211 ms.

**The rule's third version** changes only where a junk or trash mailbox's history starts, which
is read when an account's bursts are found, never during its first sync. Measured on 2026-11-16
and 17 beside `main` at `91de6663`, in turn on the Mac's own disk, while other sessions loaded
the machine (load averages from 4 to 35): import 370, 380 and 368 messages a second against
`main`'s 477 and 379, so the noise is larger than any cost, and neither met 500 under that load
([the third run](limits-500000-c3-rule3.results.json),
[`main`'s second](limits-500000-c3-rule3-main.results.json)). Listing the account found its
bursts in 1.4 to 1.5 ms beside 1.4 (11 ms in the run that began at a load of 35), and a batch of
250 headers after it took 174 to 268 ms beside 192 to 211.

## 8. Stories

A story is a view (M9). A message in a story is still in every list it was in.

- **Stream stories** (phase C) are made by code. One story per list id, or per sender where
  there is no list id. A stream story needs at least five messages. The template key and the
  body shape do not split a story: they mark its exceptions. **Decided by the owner on
  2026-11-14**, with step C1's counts ([6.3](#63-the-template-fingerprint)): outside the largest
  mailbox, grouping by sender puts 81% of the bulk mail in a story, by sender and template key
  39%, and with the body shape too 26%, because the template key holds the subject's shape and a
  newsletter whose subject changes each issue would be a group of one each time. Grouping by
  sender also keeps an odd message in its sender's story, flagged, where a grouping by template
  would leave it in no story at all. Built by step C2's second pull request.
- **Burst stories** (phase C): [7.4](#74-bursts).
- **Situation and cohort stories** (phase E) are proposed by a caller
  ([10.2](#102-situation-and-cohort-stories)).

A story has a stable id, a kind, a title the engine builds from the sender or list, counts, the
date of its last change, and its exceptions: members that are not routine. For a stream story an
exception is a message whose body shape differs from the story's usual ones. A story's card also
gives the kinds of mail in it, by template key, with a count each, so that a sender that sends
receipts, offers and alerts from one address does not hide one in a single total.

`mail-story-changes` takes a cursor and returns what changed in each story since, from the
`change` table, with a new cursor. The caller keeps its cursor; the engine stores none.

**As step C2's second part built it** (`engine/src/store/stories.rs`, `engine/src/stories.rs`,
migration 9):

- **A stream's members** are its `bulk` messages that a mailbox other than junk and trash shows,
  the lists' scope ([7.2](#72-the-screening-class)): mail the person screened in, wrote to,
  blocked or said is theirs is in none, and neither is mail only junk or trash shows. The stream
  is the list's id, the one inside `List-Id` in lower case, or else the sender's address, as
  step C1 grouped them. Every such message has a member row from the first; a stream is a story,
  listed and opened, from its fifth.
- **Stories are derived**, so a rebuild gives the same rows. Each message derived again, or
  whose class or place in the lists changed, has its membership computed again; a message whose
  flags alone changed is not read. Each story a member left, joined or changed in is noted in
  `change`; so is one whose newest member was derived again, when its row changes. Every stream
  with members has a row; the commands show those of five or more, and every burst.
- **A story's counts are kept, not counted again**: an exception, for stories alone, to the rule
  that a derived row is computed again for each batch (threads and their places, senders and
  classes keep it). A stream's members, each body shape's and template key's count in
  `story_shape` and `story_kind`, its kinds, its exceptions and its usual shapes are kept by what
  each batch changed. Every made-up message of the 4.4 harness carries a list header, so its
  largest senders' stories hold tens of thousands, and counting each touched story's members
  again for each batch took the import from 565 messages a second to 320, under the limit
  (measured 2026-11-15 on the owner's external drive, `main` and this step one after the other);
  with the counts kept import is 515, against `main`'s 569, on the Mac's own disk
  ([4.4](#44-limits-to-meet)). What keeps them right: the tests compare every row with making
  every story from nothing after each change, across a rebuild, and through random sequences of
  mail arriving, moving, being decided on and derived again; a rebuild makes them from nothing;
  and a batch that finds a story counted wrong (a count it would take below nothing, or a row
  whose members are not what it says) counts that story again whole from its members instead of
  failing, and `mail-status`'s `screening.storiesRecounted` says how many times, which is
  nothing unless the engine has a bug. A story's first and last dates are read from the two ends
  of its index, and its title from its newest member. Its members are indexed by date with each
  one's template key and body shape, so a kind's or a shape's members are read from the story's
  range, and a body that arrives rewrites its entry in place rather than in indexes keyed by a
  hash, which cost a fifth more import; its exceptions have an index of their own; a story's row
  counts its usual shapes, which its exceptions read.
- **A story's id** is its stream's, from `stream`, which is not derived: an id once given to a
  list or a sender is kept, so a rebuild keeps it and no two streams share one (an id made from
  a hash of the stream would let a sender who searched for a collision join another's story). A
  rebuild that finishes drops the streams of mail no longer held, such as a removed account's; a
  stream whose mail is held but in no story now, screened in or only in junk, keeps its id. Its **title** is the list's id, or else the name on its newest message, or else the
  address; it sits with the list's id and the sender's address in a labelled part.
- **An exception** is a member whose body shape is not one of its story's usual ones, a shape at
  least five of its messages have. A story with no usual shape has no exceptions, since nothing
  in it is routine to differ from, and a message whose body is not held yet has no shape and is
  none. A shape that becomes usual or stops being has its members' exceptions computed again; a
  story that gains its first usual shape or loses its last, every shaped member's.
- **Its kinds** are its template keys, each with how many of its messages hold it.
  `mail-story-open` gives up to the ten most common, each with the subject of its newest message
  in a labelled part, in at most a quarter of its budget (`kindsCut` says some were left out),
  and `kinds` counts them all; it lists all the story's messages newest first, its exceptions
  alone (`exceptions`), or one kind's (`kind`).
- **The date of its last change** is its newest message's date (`lastDate`), which orders
  `mail-story-list`; what else changed is `mail-story-changes`'.
- **`mail-story-changes`**' cursor is the stories' epoch and a change's number. With no cursor it
  gives none and the cursor of now: a caller starts there, then reads `mail-story-list`, and
  follows the changes after, so nothing falls between. With one it gives each story that changed
  after it once, at its latest change: `current` with what the list gives, or `gone` when it is
  no longer a story. `more` says another page waits. The epoch grows by a random step with each
  rebuild, which removing an account also runs: a cursor of another epoch (from before a
  rebuild, or most likely another store's), or one naming a change the store never noted, gets
  `reset`, no changes and the cursor of now, so the caller reads the list again.
- **Stories wait with screening**: the commands fail with `SCREENING_NOT_READY` while it waits.
  `mail-status` gives `screening.stories`, and `mail-message-list` and `mail-thread-open` give
  each message's story.
- **A store that held mail before** is given its stories once when it is next opened after
  migration 9.
- **Bursts** (step C3, [7.4](#74-bursts)): a burst's `unknown` and `bulk` mail is its burst's
  story's and in no stream story; a burst is a story at any size.
- **Proposed stories** (step E2, [10.2](#102-situation-and-cohort-stories), migration 22):
  `situation` and `cohort` stories live in non-derived `proposed_story` and
  `proposed_story_member` tables, allocate ids from `stream` (`proposed <id>`) so they never
  collide with stream or burst ids and survive `mail-rebuild`, and appear alongside stream and
  burst stories in `mail-story-list`, `mail-story-open`, `mail-story-changes`,
  `mail-selection-create` and `mail-replyset-create`.

**Measured on the owner's mail** on 2026-11-15, with `engine/tests/live_screening.rs` in a release
build on a copy of the iCloud store the B7 server keeps, made by the copying rules and kept in an
encrypted image ([the counts](live-icloud-c2.results.json)). The copy's 294 086 messages were all
derived again by the current derivation (21 minutes), then classed and given their stories from
nothing (18 seconds for both).

| Classes | Held | Listed |
| --- | --- | --- |
| `known` | 5 231 | 5 229 |
| `bulk` | 279 930 | 278 654 |
| `unknown` (the queue) | 4 889 | 4 793, from 1 610 senders |
| `blocked` | 0 | 0 |

- **Stories**: 447 (132 by list, 315 by sender) of 1 403 streams hold 277 173 of the 278 654
  listed bulk messages, 99.5%. The largest holds 94 274 messages and 10 748 kinds; 106 have one
  kind. 266 have no usual shape, and so no exceptions; the 129 with exceptions have 26 266, a
  tenth of the mail in stories.
- **Reads**, at the 95th percentile: a page of 50 stories 0.07 ms, what changed since the store's
  first change (100 stories) 0.15 ms, the largest story opened as `mail-story-open` reads it
  10.02 ms (its kinds are sorted from 10 748 at each open), its exceptions 0.29 ms, and a batch's
  work on it 0.18 ms. The lists by class, 50 messages, 0.13 to 0.54 ms.
- **A decision on the largest sender** (272 282 messages, every one changing class) took 12.8 s to
  block and 18.7 s to undo, its preview 8 ms: the person's command at a terminal, which waits that
  long for one so large.
- **The database** grew from 1.52 GB to 1.93 GB, 1.54 GB once packed: deriving every message
  again rewrites rows, as step C1 found.

## 9. Changing the mailbox

Phase D. Every change to mail here is made at the provider, can be undone, and is journaled. A
proposal ([9.4](#94-the-policy)) changes nothing until a person approves it.

### 9.1 Selections

A command that changes mail takes either a list of ids or a **selection**. A selection is made
from a query and then frozen:

- **The query** names any of: an account, a mailbox, a sender, a story, a screening class, a
  date range, read or unread, and search text.
- **`mail-selection-create`** resolves the query once, stores the resulting set of messages, and
  returns the selection's id, its exact counts of messages and threads, and a sample. A
  selection that names a whole mailbox and nothing else also includes that mailbox's unreturned
  messages, counted apart. A selection expires after an hour.
- **A change command** given a selection must also be given `expectedCount`, and it must equal
  the selection's count exactly. Otherwise nothing changes and the call fails with
  `SELECTION_MISMATCH`. The command changes the messages in the frozen set and no others: mail
  that arrived or matched after the selection was made is untouched.
- **A list of ids** may hold at most 200. Anything larger goes through a selection.

**As step D1 built it** (migration 12):

- **What is frozen** is each message in each mailbox that shows it, as the provider names it
  there: the mailbox, its generation and the message's id in it. A message two mailboxes show is
  one message and two items, and so are two copies of it in one mailbox. A query that names a
  mailbox holds that mailbox's items. One that names none holds the items outside junk and
  trash, as the lists by class do ([7.2](#72-the-screening-class)), so that a change meant for a
  sender's mail does not pull its copies out of the trash; naming junk or trash selects there.
  An unreturned message is an item with no message.
- **The query's fields** narrow it together, and at least one is named: an account, a mailbox (of
  that account, or the call is refused with `MAILBOX_NOT_FOUND`), a sender by its id, a story by
  its id (the messages its list shows: a burst's unknown and bulk first contacts, never a known
  sender's; a story holds mail a mailbox outside junk and trash shows, so with junk or trash named
  it selects only those messages' copies there), a class, `after` and `before` (the date a message is listed under, in
  milliseconds), `unread` (per mailbox, by its flags) and `text`. Every word of `text` must
  match the subject or the text held: mail of a header-only mailbox matches by its subject until
  someone opens it ([5.3](#53-order-and-fairness)). It selects every match, not a search's
  first 1 000, and a text that cannot be read in full is refused with `INVALID_INPUT` rather
  than searched for less.
- **The counts.** `count` is the messages and the unreturned ones together; a change states it as
  `expectedCount`. The result also gives the threads, when it expires and a sample of the five
  newest messages, labelled as content ([12.1](#121-content-labels)). The journal keeps the
  query and the counts, not the sample ([13.1](#131-the-journal)).
- **It waits for the derivation.** While messages wait to be derived again, or a rebuild is under
  way, a selection fails with `SCREENING_NOT_READY`, which can be retried: classes, stories and
  threads could count only some of the mail the query names.
- **Each caller may hold ten** that have not expired; an eleventh fails with `POLICY_LIMIT`, so
  that mail that steers an agent cannot fill the disk with them. Expired ones are removed when
  the next is made.
- **Not derived.** A rebuild keeps selections. Removing an account drops every selection that
  holds its mail, which no longer counts what it counted.

**How a change runs.** Each change is an `operation`: the command, the frozen set, and for each
message its place and state before, and its outcome.

- The engine works through the set in batches and records each batch as it finishes.
- A change the policy lets an agent make is small enough to finish within a call
  ([9.4](#94-the-policy)), and returns its outcome.
- A larger one is a person's: one they started, or one an agent proposed and they approved
  ([9.4](#94-the-policy)). Under `serve`, the call returns the operation's id at once and the
  server carries on; `mail-operation-show` reports its progress, and `mail-operation-cancel`
  stops it after the batch in hand. Run directly at a terminal with no server, it runs to the
  end, printing progress, and an interrupt stops it after the batch in hand.
- A stopped or interrupted operation is resumed with `mail-operation-resume`. It continues with
  the same frozen set; the query is never resolved again.
- An unreturned message in the set is changed by its provider id like any other. Its outcome is
  reported per message, so if the provider ignores the request the operation says how many
  remain.

**As step D1 built it** (its second part, migration 13):

- **An operation** is a row with its command, what it does to each message (move, copy, remove a
  copy, or set flags), the policy's limit it counts against, what the caller asked (ids and
  booleans), the selection and its query when it came from one, who made it, its state
  (`running`, `stopped` or `done`) and why it stopped, in the engine's words. Each item is a
  message in a mailbox as the provider named it when the operation was made, and the step it
  reached: `waiting`, `copying`, `copied`, `flagged`, then `done`, `unchanged` (already as the
  change would leave it), `missing` (it had moved or gone, and was left alone) or `ignored` (the
  provider answered and did not act on it, which is how an unreturned message the provider will
  not move is reported). Results count items, as `places`, beside the `messages` the operation
  was made with. When an item is done the store shows the change at once, as the next pass of sync
  finds it.
- **A change names** a selection and its `expectedCount`, or `messages`: 1 to 200 ids, each
  acting on its copies outside junk and trash, as a selection that names no mailbox does. An id
  shown nowhere there is `MESSAGE_NOT_FOUND`. A wrong count, or a selection expired or not there,
  is `SELECTION_MISMATCH`, and nothing is asked of the provider.
- **Batches** are 100 items of one mailbox going to one place. A change of at most 1 000
  messages runs inside the call; on a server, a person's larger one returns its id at once with
  the state `running` and runs as the server's work, 20 batches at a time, behind a pass of sync
  that is due or asked for. A call on a server that runs out three quarters of its time hands the
  rest to the server's work the same way. At a terminal with no server it runs to its end,
  printing each batch, and Ctrl-C stops it after the batch in hand.
- **A stop** of any kind leaves the operation `stopped`, resumable: Ctrl-C, `mail-operation-cancel`,
  a provider's failure (whose failure names the operation in its details), a call cut off, or the
  program ending, which the next process to open the store records. `mail-operation-resume`
  carries on from the step each item reached; an operation that runs already, here or as the
  server's work, is `WORK_RUNNING`, which can be retried, and one that is done or was undone is
  refused. `mail-operation-list` gives the operations newest first, paged by cursor;
  `mail-operation-show` one with its counts and a page of its items (each item's message,
  mailbox, destination and step). `mail-status` counts the operations running and stopped, and on
  a server its work names the operation that runs and those that wait. A result gives the
  selection's query labelled as content ([12.1](#121-content-labels)): it is the caller's words,
  which mail may have steered.
- **Beside a pass of sync.** A change inside a call can run while a pass does. A pass that
  listed a mailbox in full before a change and compares after it may take a copy the change just
  recorded for gone; the next pass finds it again. Nothing is lost at the provider, which is the
  record.

### 9.2 The commands

| Command | At an IMAP provider | At Gmail |
| --- | --- | --- |
| `mail-archive` | Move to the archive mailbox | Remove the inbox label |
| `mail-label` | Move or copy to a mailbox | Add or remove labels |
| `mail-mark` | Set or clear the read and flagged flags | The same, as labels |
| `mail-trash` | Move to the trash mailbox | Move to trash |

**A move on iCloud.** iCloud does not offer `MOVE`, so a move is three steps: copy, set the
delete flag, and `UID EXPUNGE` of exactly the copied messages (UIDPLUS).

- The engine records the new UIDs the server reports for the copy (`COPYUID`) on the operation,
  because an undo needs each message's new place.
- Each message's step is recorded: copied, flagged, removed. A stop between steps is resumed
  from the step reached, so a message is never copied twice and never removed before its copy
  is confirmed.
- The engine never issues a bare `EXPUNGE`, which would remove messages another client had
  flagged.

**Edges.** Trashing a message already in the trash, or archiving one already archived, changes
nothing and is reported as unchanged. Mail is never deleted for good by the engine; the provider
empties its trash on its own schedule.

**As step D1 built it** (its second part):

- **`mail-archive`** takes mail out of the inbox: each copy the inbox shows moves to the
  account's archive mailbox, as Gmail's archive removes the inbox label. A copy elsewhere is left
  as it is and reported as unchanged, so archiving a sender's mail does not empty the person's own
  mailboxes; `mail-label` moves mail from any mailbox.
- **`mail-trash`** moves each copy to the account's trash; one there already is unchanged. An
  account with no archive or trash mailbox the engine knows is `MAILBOX_NOT_FOUND`, naming the
  role.
- **`mail-label`** takes a mailbox's id and `copy` (a move by default). The mailbox must be one
  the provider still lists, of the same account as every message named; a copy in that mailbox
  already is unchanged. A move into the trash, or into junk, which the provider may empty too,
  counts as trash against the policy.
- **A move** by `mail-trash` or `mail-label` leaves the copies in the person's sent mailbox, and
  in Gmail's All Mail, unless the selection named that mailbox, so that a change meant for mail
  received does not take the person's own copies with it; they are reported as unchanged.
- **`mail-mark`** takes `read`, `flagged` or both, true or false, and sets or clears `\Seen` and
  `\Flagged`. A message's flags are recorded before the change is asked for, so a change whose
  answer was lost is still known as made.
- **A copy or a move** records the destination's generation and next id (`STATUS`) before it
  asks. Resumed after its answer was lost, it looks among the destination's ids from there, by
  each message's identity ([4.2](#42-what-makes-two-messages-the-same)). An unreturned message
  has none, and its copy is never guessed at: another such message's copy could pass for it, and
  the original be removed with no copy made. It is asked for again, which at worst leaves two
  copies. A copy the provider's `COPYUID` leaves out was not made, and the message is `ignored`;
  a move answered without it is checked, and a message no longer in its mailbox is taken to have
  moved and is looked for where it went by its identity (one another client removed in between
  is recorded as moved, with no place to undo it to). With `MOVE` the move is one step;
  without it, the delete flag goes on exactly the messages whose copies were confirmed, and
  `UID EXPUNGE` removes exactly those. A test drops the connection before each command of a run,
  and after each change with its answer lost, and finds each message moved once.
- **A message moved** keeps its flags; one that already carried the delete flag from another
  client carries it into the destination too, where that client's next `EXPUNGE` would remove
  it. Not handled: no such message has been seen.

**As step D2's large run tried it** on the owner's iCloud account ([the counts](live-icloud-d2-large.results.json)),
in its largest mailbox, which the owner keeps for tests: 1 000 messages flagged and undone, 1 000
marked unread (all were already) and undone, 50 copied into junk by an agent within the policy
and undone, 10 moved to the inbox, archived, the archive undone and the 10 moved back, and an
agent's trash of 10 000, proposed, previewed, approved, undone, the undo cancelled at half and
resumed. Every message came back where it was, with its flags. iCloud offered no `MOVE`, so every
move was the three steps. A message counts as in its mailbox when either `UID SEARCH` or `FETCH`
returns it, since iCloud's search lists messages its `FETCH` never returns and messages that
have left; asking for one that is not there costs nothing. A trash of 10 000 took 11 minutes and
its undo as long, cancel and resume included, about 65 ms a message; 1 000 flags took 15
seconds.

### 9.3 Undo

`mail-operation-undo` puts back what an operation changed, from the places and states it
recorded, and is itself an operation. An undo of a trash is possible only while the provider
still holds the message; the operation records the date after which it may not be, where the
provider states one, and an undo after that fails for those messages with `UNDO_NOT_POSSIBLE`.

**As step D1 built it** (its second part): the undo acts on the items the operation changed. A
move is moved back from where it went; a copy is removed, and only while the message it was
copied from is still where it was and not flagged to be deleted, checked again before a copy
flagged by the undo is removed, so the engine never removes the last of a message (the copy
whose original went is reported `missing`, and loses the flag); a removed copy is copied again;
flags are set back to what each message had before the change was first asked for, for the
flags the change named. An operation is undone once: a second undo is refused, and an undone
operation is not resumed; undoing the undo makes the change again. An operation with messages
part-way through a step (copied and the original not yet removed, or flagged to be) is refused
until those messages are finished, since an original left flagged could be removed for good by
another client: a resume finishes them in its first batches, and a cancel then stops it. An operation that runs is `WORK_RUNNING` until it stops, after the batch in
hand once cancelled. iCloud states no date
after which its trash may be emptied, so none is recorded; a message the provider no longer
holds is reported `missing` rather than failing the undo. Gmail's date, and
`UNDO_NOT_POSSIBLE` with it, arrive with step B6.

**As step D2 built it** (its iCloud half): an undo acts on each message where the store shows it
now. A later change that moved a message away and back (an archive and its undo) leaves it in the
same mailbox under a new id, so undoing the changes in reverse order found each earlier one
`missing`. Each place an undo would act on, when the store no longer shows the message there, is
taken from the one place the store shows that message in the same mailbox and generation
(`UIDVALIDITY`), by its identity ([4.2](#42-what-makes-two-messages-the-same)), among the
places it first saw after the operation began, so that a copy of the same message that was
there before is never taken for one the operation made. Two such places, and a place another of the undo's items holds already, are not
guessed at: the undo acts on the place it recorded, and finds the message `missing` there, as
before. A message the provider never returned has no identity, so it is only ever looked for at
the place recorded. The message a removed copy was made from, which an undo checks before it removes the copy,
is not followed: a copy whose original moved away and back stays, reported `missing`. Found by
the run on the scripted server that the owner's run repeats on iCloud.

**Found with it** (5.2): a change records the copy it made at an id at or past the mailbox's
cursor, before a pass covers it, and a pass with QRESYNC took what vanished, and flags that
changed, only below the cursor. A copy that another client removed or marked before the next pass
stayed in the store as it was, for good. Both are now read up to the mailbox's next id, and so are the flags read without QRESYNC.

**Found by the large run** ([the counts](live-icloud-d2-large.results.json)). An undo of a trash on iCloud is only as good as the trash's hold on the
mail: in the first run, 491 of 10 000 messages left iCloud's trash while the undo was paused, and
were in no mailbox after, so the undo reported them `missing`, as it should. What removed them is
not known: the owner empties the trash by hand, and a message from 2022 put there was still there
two hours later. Before a copy is removed, its original must be returned by `FETCH` without `\Deleted`; a
search's listing is not enough, since on iCloud it still lists messages that left, and the copy
could then be the last of its message.

### 9.4 The policy

The person's policy says what each kind of actor may change without them. It is data, changed
only by a person. The default:

| Actor | Local commands | Archive, label, mark | Trash |
| --- | --- | --- | --- |
| `human` | Yes | Any size; above 200 messages the command line shows the count and asks | The same |
| `agent`, `script` | Yes, apart from a person's commands | Up to 500 messages a call | Up to 50 messages a call, and 200 a day for each caller |

The engine applies the policy itself, to every caller, because Loam's autonomy policy reaches
only Loam's copilot. The limits are what an agent may do with nobody present.

**As step D1 built it** (migration 12): the policy is one row. `mail-policy-show` gives it, its
default and how many selections a caller may hold. `mail-policy-set` changes any of its four
numbers: what an agent or a script may archive, label and mark in a call, what it may trash in a
call and in any 24 hours, and the count above which the command line asks the person. It is held for
the person's approval, whose summary gives the policy as it would be, in numbers alone (input no
policy could take is refused without asking), and it returns the numbers before, which setting again
undoes. A limit a call is at most 1 000 messages, what a call can finish within its 60 seconds; a
day's trash at most 10 000, and not below a call's; 0 means an agent or a script makes no such
change alone.

**As step D1 built it** (its second part): a change, a resume or an undo by any caller but a
person is checked against the policy before anything is asked of the provider: a change of more
messages than its call's limit, or a trash that would take the caller's last 24 hours over the
day's, changes nothing at the provider; the third part makes it a proposal. The
day counts the messages of the trash operations the caller made, whether they finished or not; a
resume is checked against the call's limit by what is left, and is not counted again. A script
shares one day with every other script. At a terminal, the command line shows a change, a resume
or an undo larger than `askAbove` by its count ("Archive 300 messages") and asks before it runs.

**Over a limit: a proposal (M28).** A change command from an agent or a script that is over a
limit changes nothing at the provider. It stores the operation in the state `proposed`, with its
frozen set and its proposer, and returns the operation's id and that state. The stated
`expectedCount` is checked as for any change.

- The frozen set is kept with the proposal, so it outlives the selection's hour. A proposal
  expires after seven days.
- `mail-status` and `mail-operation-list` show what awaits the person: the command, the exact
  counts, the proposer.
- **`mail-operation-approve`** is a person's command with an approval policy
  ([3.5](#35-commands-only-a-person-may-run)). The command line shows the proposal through
  `mail-operation-show` and asks. The agent wrote the query, and mail may have steered it, so
  the preview shows more than a count and a sample: the command; the proposer; the selection's
  query; the counts by account, by mailbox and by screening class; and a line of its own when
  the set holds mail from known senders, with how many. The approval token is bound to the operation's id, and the operation's set is frozen, so
  what runs is what was shown. The summary holds counts only: "Trash 283 721 messages, proposed
  by agent 3".
- Once approved, the operation runs as the person's: no limit applies, and it does not count
  against the proposer's daily limit. It can be undone like any other. Each message's place and
  state before are recorded when the operation runs, not when it was proposed; a message that
  moved or went in between is reported and left alone.
- An agent's resume or undo of an operation is under the same policy by the operation's size:
  over a limit it is a proposal. An agent may always cancel.
- `mail-operation-dismiss` discards a proposal. The person or its proposer may run it.
- A caller may have five proposals waiting. A further one fails with `POLICY_LIMIT`, so mail
  that steers an agent cannot bury the person in requests.

**As step D1 built it** (its third part, migration 14):

- **A proposal is an operation** in the state `proposed`, beside `running`, `stopped` and `done`.
  Migration 14 makes the `operation` table again to widen its states, keeping every row, id and
  reference and the next id, so an id is never given twice. A change, a resume or an undo by an
  agent or a script that is over a limit is made one; the result is the operation, with
  `proposal`: its proposer, when it was proposed and when it expires, why it waits in the
  engine's words, and what comes next. It is checked as any change is first: a wrong count, an
  expired selection or a message not found is refused, and nothing is proposed.
- **What is proposed.** A change or an undo is a new operation that has never run: its frozen
  set is kept with it as its items, and `startedAt` is null until it is approved. A resume
  proposes the stopped operation itself: it waits in `proposed` with what it did so far kept.
  While an undo of an operation waits, that operation is neither resumed nor undone again, by
  anyone, so that what the person approves is still what it would undo; the person approves or
  dismisses the waiting undo first.
- **The five.** A sixth proposal from a caller that has five waiting fails with `POLICY_LIMIT`
  and proposes nothing. Each token is a caller; scripts share one, as they share a day.
- **Seven days.** A proposal not approved seven days after it was proposed goes: a change that
  never ran is `expired`, and a resume proposed is stopped again. The engine ends them when a
  command reads or acts on operations, and when a process opens the store.
- **Dismissed.** `mail-operation-dismiss` takes the operation's id. The person at the terminal
  may dismiss any proposal, and a caller its own; anyone else's is `FORBIDDEN`. A change that
  never ran is `dismissed`; a resume proposed is stopped again. A change dismissed or expired
  drops its items, so that proposals refused do not fill the disk: its row keeps the command,
  the count and the proposer. It is not approved, resumed or undone after. A resume proposed
  and then dismissed or expired keeps when its run stopped. An id with no operation is
  `PROPOSAL_NOT_OPEN` to approve or dismiss.
- **Removing an account** removes an undo proposal with the operation it would undo, as it
  removes any undo, though a dismissed or expired one holds no items of that account.
- **The preview** is `mail-operation-show` of a proposal, which adds `preview`: whether it can
  be approved now and, if not, why; its places by account and by mailbox, and by the mailbox a
  move or a copy puts them in, each mailbox's name labelled as content; its messages by
  screening class, each message once, with `own` for the person's own mail, which has no class;
  how many of its messages come from senders the person knows, and how many such senders; and
  how many of its places are messages the provider never returned. It counts the places not yet
  finished, so a resume proposed shows what is left. The query is the operation's own `query`,
  labelled as content. The command line shows each of these, names each value from mail as it
  shows it ("its name, as the provider writes it"), gives the known senders a line of its own
  ("Mail from senders you know: it holds 4 messages from 1 sender you know"), and asks nothing
  of a proposal that cannot be approved now.
- **`mail-operation-approve`** takes the operation's id and is held for the person's approval
  every time. Its summary is the proposal's command and count and its proposer, with a token's
  name, which is the person's own words: "Approve operation 12: move 283721 messages to the
  trash, proposed by the agent with the token "laptop" (tok_…)". It is refused, even when
  approved, when the proposal is not open (`PROPOSAL_NOT_OPEN`), when the operation an undo
  would undo runs or was undone since, and while screening is not ready
  (`SCREENING_NOT_READY`, which can be retried), because the preview's classes could be wrong.
  Approved, it runs as a person's change does: inside the call, or as the server's work when it
  is larger than a call finishes; `approvedAt` records when.
- **Its proposer's day.** An operation made as a proposal counts against no caller's day of
  trash, approved or not. A resume proposed is the operation's own, which counted once when it
  was made.
- **As step F2a built it (migration 20):** `operation` gains `proposal_generation` (existing
  proposals start at 1; incremented on each `propose_resume`), exposed as `proposal.generation`
  and `preview.proposal`. `mail-operation-show` declares `MOST_BUDGET` as both default and
  maximum output budget, adds `preview.digest` (43-char base64url SHA-256 of canonical
  `{ operation, proposal, proposer, command, asked, query, items }`), and accepts an optional
  `digest` parameter: when given, it returns the stable preview-only shape (`operation`,
  `command`, `asked`, labelled `query`, `proposal`, and `preview` without `items`, `nextCursor`,
  or `preview.refused`), failing with `PREVIEW_CHANGED` on mismatch or `PREVIEW_TOO_LARGE` when
  the preview exceeds `MOST_BUDGET` or the 3.5 MiB MCP reply cap. `mail-operation-approve`
  requires `{ operation, digest }`, is exposed to `cli` and `mcp` (`ApprovalPolicy::Required`),
  checks `PROPOSAL_NOT_OPEN` → `undo_of` → `SCREENING_NOT_READY` → `PREVIEW_CHANGED` both before
  the hold and atomically inside the approval transaction, and runs as the person's once
  released by the terminal or an approver's MCP 2026-07-28 evidence (counts against no caller's
  day). At the terminal, omitting `digest` auto-fills it from the preview.
- **What awaits the person.** `mail-status` counts the proposals waiting and names the 20 most
  recently proposed, each with its command, its count, its places left and its proposer.
  `mail-operation-list` with `proposed` lists only the proposals waiting, in the same order and
  paged by a cursor of its own, since a resume proposed keeps its operation's older id.
  `mail-policy-show` gives the five and the seven days.
- **As step F4 built it (migration 21, M36, taint per account):** `account_policy` stores nullable
  per-account overrides (`change_per_call`, `trash_per_call`, `trash_per_day`, `ask_above`,
  `set_at`), not derived and deleted when its account is removed. Each null column falls back to
  the default `policy` row. `mail-policy-set` accepts optional `account` (validated against
  `ACCOUNT_NOT_FOUND`) and `reset: true` (requiring `account` with no limit fields) to set or clear
  per-account overrides, still held for the person's approval with a number-only summary naming the
  account id. `mail-policy-show` returns `"accounts"` (all accounts with overrides, resolved and
  raw) and accepts optional `account` to return that account's effective policy and overrides. Any
  non-human change (`mail-archive`, `mail-label`, `mail-mark`, `mail-trash`), resume
  (`mail-operation-resume`) or undo (`mail-operation-undo`) whose frozen or remaining items span
  more than one account is refused with non-retryable `SELECTION_SPANS_ACCOUNTS` (suggestion
  `"Make one selection per account."`) whether or not any account has overrides; a human caller at
  the terminal may still span accounts. Single-account non-human changes, resumes and undos check
  the effective policy and daily trash count for that account (a guarded account with limits of 0
  forces every non-human change to become a proposal while other accounts keep the default policy).

**What cannot be undone (M29).** Every change to mail in this section can be undone, which is
why an agent may make small ones alone. A command that sends mail, or removes for good the
person's mail, a draft or a credential, is declared destructive and carries an approval policy.
Today those are `mail-draft-send`, `mail-replyset-send`, `mail-unsubscribe`,
`mail-account-remove` and `mail-token-revoke`, and each is also a person's command (M18). Any
later command that deletes mail for good joins them.

- A test reads the registry and fails if a command is destructive without an approval policy.
  The flag is declared, not derived, so a new command is checked against this paragraph in
  review.
- Discarding a draft is kept recoverable so that it stays open to agents: a discarded draft is
  held for 30 days and `mail-draft-restore` returns it.
- Dismissing a proposal or a suggestion, and withdrawing a proposed record, are outside the
  rule: nothing of the person's is lost, and the proposer can propose again.

### 9.5 Drafts and sending

- A draft is the engine's own record: recipients, subject, body, the message it answers, and who
  wrote each part. Drafts are not synced to the provider's drafts mailbox in this version.
- `mail-draft-send` is a person's command (M18). The engine checks every recipient against the
  proposal's rule: a participant of the thread being answered, an address the person has written
  to, or one the person typed at the terminal for this send. Any other recipient fails the send
  with `RECIPIENT_NOT_ALLOWED`.
- A send is recorded in `outbound` before it is attempted and after. A send whose outcome is not
  known, because the connection dropped after the message was handed over, is marked `unknown`
  and is never retried by the engine. The person sees it in `mail-status` and decides.
- iCloud sends over SMTP and the engine appends a copy to the sent mailbox. Whether Gmail's API
  keeps the copy itself is for step B0.
- `mail-unsubscribe` is a person's command. It uses only the message's `List-Unsubscribe`
  headers: a one-click HTTPS post where the message declares one, or else a mail to the address
  given. Its preview shows the target, and it never opens a link in a browser.

**As step D3 built it** (its first part, migration 15): drafts and snoozed threads, which are
local and open to every caller. Sending and unsubscribing are its second and third parts.

- **A draft** is a row of the store, not derived: its account, the message it answers, its To, Cc
  and Bcc, its subject and its body as plain text, who wrote each of the recipients, the subject
  and the body (the caller who last set it, with its token's id), and who made it. Its
  recipients are bare ASCII addresses: a local part of RFC 5322's dot-atom characters with no dot
  at either end or two together and no `=?`, which begins an encoded word, and a domain of two or more labels of letters, digits and inner
  hyphens, kept in lower case. No names, no brackets, nothing a header would read as a second
  address; addresses outside ASCII wait for SMTPUTF8. At most 100 recipients; a subject of at
  most 998 characters with no control character but a tab, no line or paragraph separator and
  none of the characters a person cannot see that evidence counts as hidden (6.2's list: zero-width,
  direction and tag characters among them); and a body of at most 48 KiB.
  Input outside those is refused without repeating it. `mail-draft-show` gives the whole of the
  largest such draft by default, at its largest budget, since it is the preview of a send and is
  never cut.
- **Its account** is the one named; else, for a draft that answers a message, the one account
  whose mailboxes show that message; else the only account. A named account must show the message
  answered.
- **A revision** rises with every change, a discard and a restore included.
  `mail-draft-update` takes the revision the caller read and replaces the parts it names (the
  three lists of recipients together); a draft changed since is `DRAFT_CHANGED`, and two callers
  that read the same revision cannot both change it. A send names the revision it previewed
  (step F's specification, where a mismatch is `PREVIEW_CHANGED`).
- **Content.** The recipients, subject and body are content: a caller wrote them, and mail may
  have steered it. Every result gives them in one labelled part, with who wrote each beside it.
- **Discarded** drafts are listed apart with when each goes, are neither changed nor sent, and
  are restored by `mail-draft-restore` within 30 days. A draft discarded longer ago goes when a
  draft command next runs.
- **Removing an account** removes its drafts, which nothing could send and which are kept nowhere
  else: the person is told how many go for good before approving. Another account's draft that
  answers mail that goes keeps its text and answers nothing, at a new revision.
- **The journal** keeps a draft's text as the input that wrote it ([13.1](#131-the-journal)),
  beyond the draft's 30 days. The results of `mail-draft-create`, `-update`, `-discard` and
  `-restore` are journaled without the draft's text, so that a discard or a restore copies none
  in.
- **`mail-thread-snooze`** takes a thread and a time within the next year, and keeps the snooze by
  the thread's id, its lowest message, so that a rebuild keeps it. A snoozed thread leaves
  `mail-thread-list` until its time, or until mail arrives in the thread after it was snoozed: a
  message whose id is above the highest the store held when it was snoozed, which tells two events
  in one millisecond apart. A pass of sync removes a snooze so ended, so that it stays ended when
  that mail goes. Removing an account brings each mark down to the highest id left, since the
  store gives a removed message's id to the next one. `mail-thread-list` with `snoozed` lists only the snoozed threads, with when each
  comes back, found from the snoozes rather than the mailbox's threads; the 4.4 measurement times
  both lists.
  Without a time it ends the snooze. Its result gives the time before, which undoes it. Removing
  an account removes the snoozes of the mail that goes.

**As step D3 built it** (its second part, migration 16): sending drafts at the terminal over SMTP,
tested on scripted SMTP and IMAP servers.

- **Subject characters.** Draft subjects allow the zero-width joiner (`U+200D`) and emoji variation
  selector 16 (`U+FE0F`) so ordinary emoji sequences work, while continuing to refuse hidden
  formatting characters (zero-width spaces, direction controls, tags).
- **Send state and `outbound` (migration 16).** `draft` gains `send_state` (`none`, `sending`,
  `sent`, `unknown`), and a new `outbound` table records each send attempt before and after
  handover (account, draft, approved `draft_revision`, Message-ID, sender, state, sent-copy flag,
  reason, timestamps). Active draft lists show only open (`send_state = 'none'`) drafts; sent and
  unknown drafts stay in the store as audit records and are neither editable nor discardable.
  Reopening a store marks any interrupted `sending` row as `unknown`, and an in-flight send carries
  a drop guard so a server call timeout or terminal interrupt immediately marks it `unknown` rather
  than leaving it stuck in `sending`. `mail-account-remove` refuses with `WORK_RUNNING` while a
  send is in flight, reports unknown sends in its removal summary, and deletes the account's
  `outbound` rows.
- **Recipient rule and preview.** `mail-draft-show` (and create/update results) add `state`,
  `recipientBasis` (`own`, `thread`, `written-to` or `new` per recipient, in parallel arrays) and
  `replyToDiffers`. Thread participants are classified when a recipient is added to a draft from
  messages currently shown in the draft's account outside junk and trash that are reachable from the
  answered message through non-junk/trash `Message-ID`/`In-Reply-To`/`References` links (never from
  a differing `Reply-To`, never from a junk/trash answered message, and never across a junk bridge).
  From step F2b (migration 23), each recipient's `basis` is stored with the draft when added (and
  backfilled on open for pre-migration-23 drafts) so `mail-draft-show` stays stable at an unchanged
  revision and retained recipients keep their basis across updates; `mail-account-remove` refreshes
  surviving drafts whose `answers_message_id` is cleared or whose `own` recipient belonged to the
  removed account, bumping their revision. `mail-label` refuses filing mail into a `Sent` mailbox so
  an agent cannot forge `own` or `written-to` evidence. Before asking for approval at the terminal,
  the command line strips any pre-supplied `typedRecipients` from JSON input, prints the labelled
  preview and bases, flags a differing `Reply-To`, and asks the person to type every `new` address
  verbatim (preserving local-part case) for this send. The engine accepts `mail-draft-send` from a
  human over `cli` or an approver over MCP (`PERSON_REQUIRED` otherwise): terminal sends refuse any
  untyped `new` recipient with `RECIPIENT_NOT_ALLOWED`, while approver-released MCP sends allow
  `new` recipients marked `"new"` in preview (Q2 (a)).
- **`mail-draft-send`** is a person's command, destructive and held for approval (M18 amended in
  F2a/F2b, M29), exposed to `cli` and `mcp` (never `agent` or `palette`). It takes `draft` and
  `revision` (the command line fills in `revision` only when omitted); a mismatch fails with
  `PREVIEW_CHANGED` before any hold and again inside the send transaction. It atomically checks the
  revision and recipients, records `outbound` as `sending`, builds an RFC 5322 plain-text message
  (RFC 2047 UTF-8 subject, folded `References`, quoted-printable UTF-8 body, `In-Reply-To` when
  answering, and no `Bcc:` header on the SMTP wire, preserving local-part case in envelope
  deduplication), and submits it over SMTP (`smtp.mail.me.com:587` with STARTTLS, `AUTH PLAIN` with
  `AUTH LOGIN` fallback; plain TCP refused on non-loopback hosts).
- **Handover and sent copy.** A failure before `.\r\n` or an explicit 4xx/5xx complete reply after
  `DATA` marks the attempt `failed` and returns the draft to `open` (452 maps to retryable
  `PROVIDER_LIMIT`, permanent 5xx such as 550/552 maps to non-retryable `PROVIDER_REFUSED`). A drop,
  truncated reply line, unexpected non-2xx/4xx/5xx code, or timeout at or after `.\r\n` marks both
  `outbound` and `draft` `unknown` and returns non-retryable `SEND_OUTCOME_UNKNOWN`; `mail-status`
  reports `sending` and `unknown` sends under `outbound`, and the engine never retries them. On 2xx,
  the draft becomes `sent` and the engine makes a bounded best-effort IMAP `APPEND` of the sent copy
  (with `Bcc:` and `\Seen`) to the account's sent mailbox; if that append fails or times out, the
  send still succeeds with `sentCopy: false` and warning `SENT_COPY_FAILED`.

**As step D3 built it** (its third part): `mail-unsubscribe-show` and `mail-unsubscribe` at the
terminal, tested on scripted HTTPS and SMTP doubles.

- **Headers and selection.** Reads only the message's held `List-Unsubscribe` and
  `List-Unsubscribe-Post` headers from the log. When `List-Unsubscribe-Post` declares RFC 8058
  `List-Unsubscribe=One-Click` (case-insensitive) and `List-Unsubscribe` holds a valid `https://`
  URL (no embedded credentials, no `localhost`/`.local`/non-global IP literals, at most 2 048
  characters), `one-click` HTTPS POST is chosen; otherwise a single valid bare-ASCII `mailto:`
  address (rejecting multiple recipients, `to`/`cc`/`bcc`/`from`/`reply-to` query parameters,
  unsafe subjects, or overlong targets) is chosen. Browser-only `https://` links without
  `List-Unsubscribe-Post`, plain `http://` links, and missing or malformed headers are refused with
  `UNSUBSCRIBE_NOT_AVAILABLE` (`retryable: false`); the engine never opens a link in a browser.
- **Preview and digest.** `mail-unsubscribe-show` (`cli, mcp`; default output budget equal to its
  largest budget, matching `mail-draft-show`) contacts nothing and returns `unsubscribe` with `message`, `account`, `method`, the exact target,
  `listId`, sender, subject (and `mailto` fields for `mail`) inside `"trust": "content"`, and the
  43-character base64url SHA-256 `digest` of canonical `{ message, account, method, target }`.
  Passing a stale `digest` to `mail-unsubscribe-show` or `mail-unsubscribe` fails with
  `PREVIEW_CHANGED` before any approval hold.
- **Execution and `outbound`.** `mail-unsubscribe` is person-only, destructive, held for approval
  (`ApprovalPolicy::Required`), and exposed to `cli` alone (M18, M29). Its approval summary holds
  no content from mail; at a terminal the command line reads `mail-unsubscribe-show`, fills in an
  omitted `digest`, prints the labelled target (sanitized for the terminal), and asks. Every attempt
  is recorded in `outbound` (`kind = 'unsubscribe'`) before handover with an in-flight drop guard.
  `one-click` sends HTTP/1.1 `POST` (`Content-Type: application/x-www-form-urlencoded`, body
  `List-Unsubscribe=One-Click`) over TLS to globally routable IPs only, refuses 3xx redirects
  (`PROVIDER_REFUSED`, never followed), maps 429 to retryable `PROVIDER_LIMIT`, 4xx to
  `PROVIDER_REFUSED`, 5xx to retryable `PROVIDER_UNAVAILABLE`, and post-write drops or timeouts to
  non-retryable `SEND_OUTCOME_UNKNOWN`. `mail` submits over SMTP and appends a best-effort `\Seen`
  copy to the sent mailbox, sharing the same handover and `SEND_OUTCOME_UNKNOWN` rules as
  `mail-draft-send`.

**As step F2b built it** (migration 23; `plugin.spec.md` sections 5–8, Q2 (a)):

- **Released over MCP.** `mail-draft-send` and `mail-unsubscribe` are exposed to `cli` and `mcp`
  (`ApprovalPolicy::Required`, M18 amended) and listed in `mount/loam-app.toml` with
  `effects = ["external"]`. Non-approver MCP/stdio callers receive `APPROVAL_REQUIRED` with
  `retryable: false`, a content-free summary, the engine's suggestion and no `approvalToken`;
  an approver token on MCP 2026-07-28 releases either command once with `_meta["dev.afd/approval"]`.
  Under Q2 (a), an approver-released `mail-draft-send` allows `new` recipients (marked
  `"basis": "new"` in `mail-draft-show`); terminal sends continue to require verbatim typing.
- **Fixed recipient bases (migration 23).** `draft` gains `recipient_bases`, computed and stored
  when a draft is created (and backfilled on store open for pre-migration-23 rows when no rebuild
  is running), preserving each retained recipient's basis across `mail-draft-update` while
  classifying newly added recipients, so `mail-draft-show` stays identical in canonical JSON for an
  unchanged revision even if sync later changes mailboxes or sent history. `mail-account-remove`
  refreshes surviving drafts whose `answers_message_id` is cleared and downgrades any `own` or
  `written-to` recipients whose evidence belonged solely to the removed account (bumping revision),
  deriving surviving evidence directly from surviving accounts and held sent-mailbox headers.
- **Preview revision checks and size caps.** `mail-draft-show` accepts optional `revision`
  (`PREVIEW_CHANGED` on mismatch), and `mail-draft-send` checks state, `revision`, `typedRecipients`
  validity, non-empty recipients and account existence before the approval middleware holds the
  call. `mail-unsubscribe` also checks `PREVIEW_TOO_LARGE` before any hold. `mail-draft-create`
  and `mail-draft-update` measure the rendered preview (with worst-case state/id/basis headroom) against
  `MOST_BUDGET` and the 3.5 MiB MCP reply cap before committing (`PREVIEW_TOO_LARGE`); both
  `mail-draft-show` and `mail-unsubscribe-show` return `PREVIEW_TOO_LARGE` when a preview exceeds
  either cap. Scenarios 1, 2 and 4 run alongside Scenario 3 in `loam-plugins.yml`.

## 10. Records, proposed stories and reply sets

Phase E. Its shape is the proposal's ([4.3](../../../../../docs/features/active/mail/mail.proposal.md#43-layers),
[4.7](../../../../../docs/features/active/mail/mail.proposal.md#47-stories), [4.8](../../../../../docs/features/active/mail/mail.proposal.md#48-outbound-mail-and-reply-sets)); what
this document adds is below. The record types, their fields and a proposal's size limits are
decided by step E1.

### 10.1 Records

- A record has a type, a message, its fields, the passages it rests on, its proposer and a time.
- `mail-record-propose` checks each passage: it must be found, exactly, in the visible text of
  the message the record names. A record with a passage that is not found is refused whole, with
  `PASSAGE_NOT_FOUND`. A passage found only in hidden text is refused the same way.
- A record never changes a message's screening class, never sends and never moves mail. It
  informs views and search, labelled with its proposer.
- A record is superseded by a later one from the same proposer for the same message and type,
  and withdrawn by `mail-record-withdraw`. None is edited.

**As step E1 built it** (`engine/src/store/records.rs`, `engine/src/records.rs`, migration 17):

- **Closed record vocabulary and strict per-type fields (9 types):**
  - `request`: required `summary`; optional `dueAt`, `urgency` (`low` | `normal` | `high`).
  - `commitment`: required `summary`, `by` (`person` | `sender` | `other`); optional `dueAt`.
  - `deadline`: required `summary`, `dueAt`; optional `timezone`.
  - `order`: required `merchant`; optional `orderNumber`, `status`, `amount`, `currency`, `trackingNumber`, `expectedAt`.
  - `booking`: required `title`, `startsAt`; optional `endsAt`, `location`, `confirmationCode`, `provider`.
  - `bill`: required `vendor`, `amount`, `currency`; optional `dueAt`, `invoiceNumber`, `autopay` (bool).
  - `code`: required `service`, `code`; optional `expiresAt`.
  - `category`: required `category`; optional `reason`.
  - `priority`: required `level` (`low` | `normal` | `high` | `urgent`); optional `rank` (integer 1–100), `reason`.
  Unknown field keys are refused with `INVALID_INPUT` without repeating the caller's key; string fields are non-empty, at most 500 characters, and forbid control and invisible formatting/bidi characters (allowing `U+200D` and `U+FE0F`). Serialized canonical `fields` JSON is capped at 4 KiB.
- **Passage verification and size caps:** `mail-record-propose` requires 1 to 8 non-blank passages of at most 1 000 characters each. It reads the message's held bytes from the log (returning retryable `NOT_HELD` if the body is not held yet; never contacting a provider) and verifies each passage verbatim against the message's visible body text (`derive::reading`, hidden HTML and invisible characters removed per [6.2](#62-hidden-text)) or decoded `Subject` (invisible characters removed). Any missing passage or hidden-only passage refuses the entire proposal with non-retryable `PASSAGE_NOT_FOUND` naming only the passage index.
- **Storage, supersession and limits (migration 17):** `record` is a non-derived `STRICT` table that survives `mail-rebuild` and stores the 32-byte SHA-256 `content_hash` over canonical `{ message, type, fields, passages }`. A unique partial index enforces at most one `active` row per `(message_id, record_type, proposer_kind, proposer_id)`; a newer proposal from the same proposer atomically marks the prior active row `superseded` (`superseded_by` and `ended_at` set). Each proposer may hold at most 10 000 active records (`POLICY_LIMIT`; superseding an existing slot is allowed at the cap). `mail-record-withdraw` marks an active row `withdrawn` for the person at a terminal or its own proposer (`FORBIDDEN` otherwise; `RECORD_NOT_FOUND` if missing; non-destructive per M29). `mail-account-remove` clears records for removed messages.
- **Content labels, listing and journal:** `mail-record-list` (`cli, mcp`, cursor-paged, `limit` 1–200, default 50, `LIST_BUDGET`..`MOST_BUDGET`) filters by `message`, `thread`, `type`, `proposer` (actor kind or token id) and `includeEnded` (default false). Every record's `fields` and `passages` are returned inside `"content": { "trust": "content", ... }` ([12.1](#121-content-labels)), `mail-message-open` reports the message's active record count (`records`), and `journal.jsonl` keeps `mail-record-propose`'s input while stripping `content` from its journaled result ([13.1](#131-the-journal)). Because every passage is already in the message's indexed visible text, tantivy is unchanged in E1.

### 10.2 Situation and cohort stories

A caller proposes a story and its members with `mail-story-propose`. Each membership carries an
answer of yes, no or unsure and a passage; only yes is stored. A proposed story is shown as
proposed, with its proposer, and the person can dismiss it.

**As step E2 built it** (`engine/src/store/proposed_stories.rs`, `engine/src/stories.rs`, migration 22):

- **Storage and id allocation (migration 22):** `proposed_story` and `proposed_story_member` are
  non-derived `STRICT` tables that survive `mail-rebuild`. Each new proposed story allocates its
  id from `stream` (key `'proposed <id>'`, kept by `stream` pruning while referenced by
  `proposed_story`) so ids never collide with stream or burst stories. Each proposer may hold at
  most 200 active proposed stories (`POLICY_LIMIT`).
- **`mail-story-propose` (`cli, mcp`, local mutation):** accepts `kind` (`"situation"` or
  `"cohort"`), `title` (1–200 characters, rejecting control/bidi/hidden characters while allowing
  emoji ZWJ/VS16), and `members` (1–200 unique message ids, each `{ message, answer: "yes" | "no" |
  "unsure", passage }`). Every member's message must exist and be shown outside junk and trash
  (`MESSAGE_NOT_FOUND`), its body must be held in the log (retryable `NOT_HELD` otherwise; never
  contacting a provider), and its `passage` (non-blank, up to 1 000 characters) is verified
  verbatim against the message's visible body text or decoded `Subject` via E1's passage verifier
  (hidden HTML or missing passages fail the entire proposal with `PASSAGE_NOT_FOUND` naming the
  member index). At least one member must answer `"yes"`; only `"yes"` members and their verified
  passages are stored. Notes the new story in `change`.
- **`mail-story-dismiss` (`cli, mcp`, local mutation, non-destructive per M29):** marks an active
  proposed story `dismissed` and notes it in `change`. Allowed for the person at a terminal or the
  story's own proposer (`FORBIDDEN` otherwise; `STORY_NOT_FOUND` if missing; `INVALID_INPUT` if
  already dismissed or not a proposed story).
- **Listing, opening, selections, reply sets and removal:** `mail-story-list`, `mail-story-open`
  and `mail-story-changes` include active proposed stories alongside stream and burst stories,
  marked `by: "proposed"`, `proposed: true`, `proposer` and `proposedAt`, with the title inside
  `"content": { "trust": "content", ... }`. `mail-story-open` includes each member's verified
  `passage` inside the member's `content` part. `mail-selection-create { story }` and
  `mail-replyset-create { story }` (with or without explicit `messages`) resolve active proposed
  story members. `mail-account-remove` removes members whose messages were removed, updates
  counts/dates, and drops proposed stories left with no members. `journal.jsonl` keeps accepted
  `mail-story-propose` inputs while stripping `content` from its journaled result and scrubbing
  `title` and member `passage` strings from refused `mail-story-propose` inputs
  ([13.1](#131-the-journal)).

### 10.3 Reply sets

As the proposal describes. The engine adds two rules: the recipient of each reply is set by the
engine from the source message and cannot be set by the caller; and `mail-replyset-send` is a
person's command whose preview lists every recipient and marks every reply whose text differs
from the shared text.

**As step E3 built it** (`engine/src/store/replysets.rs`, `engine/src/replysets.rs`, migration 19):

- **Storage and immutable recipients (migration 19):** `replyset`, `replyset_reply`,
  `replyset_question`, `replyset_question_reply` and `replyset_event` are non-derived `STRICT`
  tables that survive `mail-rebuild`. `mail-replyset-create` accepts 1 to 50 unique source message
  ids (shown outside junk and trash in one sending account, each with a valid bare-ASCII non-own
  sender address), optional `story`, optional `sharedText` (up to 32 768 characters) and up to 50
  cohort `questions` (`{ question, messages, answer? }`, marked `individual: true` when only one
  message asks them). Each reply's recipient (`recipient_address` preserving local-part case from
  the held `From` header, `recipient_name`), `replyToDiffers` flag and safe `Re:` subject (UTF-8
  boundary-safe) are derived by the engine from the source message's `From` header (never
  `Reply-To` and never caller input) and stored at creation so re-deriving mail never alters them.
  Author and creator token names are captured at write time so later token revocation never changes
  a preview under the same `revision`.
- **Revisions, edits and size bounds:** every change raises `replyset.revision` (including clean
  pre-handover send failures that update a reply's state and `outbound` id), and a reply's
  `generation` rises whenever its text or linked answers change, invalidating any open unit
  `rsu_<set>_<reply>_<gen>`. `mail-replyset-update` takes `{ replyset, revision }`
  (`REPLYSET_CHANGED` on mismatch) to record question answers, update `sharedText`, or edit a
  reply's text (`source: "edited"`). Every create, update and submit checks both the rendered
  `mail-replyset-show` preview and its worst-case post-send metadata expansion inside its
  transaction and refuses atomically with `PREVIEW_TOO_LARGE` if either exceeds `MOST_BUDGET`
  (1.75 MiB) or 3.5 MiB as an MCP reply (step F's M39 and §6).
- **Per-reply unit isolation (`mail-replyset-next`):** called with `{ replyset }`, returns only the
  next unwritten reply's own source message visible text (hidden HTML excluded; retryable `NOT_HELD`
  when the body is not held yet) and only the answers linked to that reply, with its `unit` id and
  `inputs` (`message`, `sourceTextDigest`, `answers`), recording the exact handed-out unit,
  budget-fitted source digest and answer snapshot on the reply, or `{ done: true }` when every
  reply has text. Called with `{ replyset, reply, text, [unit] }`, verifies the reply still has an
  open handout for its current generation and answers (`UNIT_NOT_OPEN` if never handed out, edited,
  or answers changed since handout), records the composed text (`source: "submitted"`) with the
  exact handed-out `inputs` snapshot, and appends a `replyset_event` audit row.
- **Preview (`mail-replyset-show`) and send (`mail-replyset-send`):** `mail-replyset-show` (`cli, mcp`,
  `MOST_BUDGET` default and max, optional `revision` check returning `PREVIEW_CHANGED`) returns the
  whole set deterministically with `"trust": "content"` on shared text, questions, recipients, subjects
  and reply texts, marking each reply's `differs` boolean against `sharedText` (every reply marked
  differing when `sharedText` is empty). `mail-replyset-preview` (D175, #2410; same input and budget)
  is the send's confirmation preview in Loam: the set's id, revision, state and sending address, the
  shared text, the recipients of replies already sent (`alreadySent`), and for each reply the send
  would send its `differs`, `replyToDiffers`, author (token id, or kind without one) and saved token
  name and a labelled part with `to`, `toName`, `subject` and `text`; nothing of the set's audit. It
  fails with the send's own error wherever the send fails before its hold. It is 11 + 11·u + s JSON
  values for u replies to send and s sent, which Loam shows while it is at most 200: 17 to send fit
  with up to 2 sent, fewer to send leave room for more (plugin.spec.md §6). `mail-replyset-send` is person-only, destructive, held for
  approval (`ApprovalPolicy::Required`), exposed to `cli` alone (M18, M29), with a content-free
  summary. Pre-approval middleware and the send transaction both check `revision` (`PREVIEW_CHANGED`)
  and completeness (`REPLYSET_INCOMPLETE`) before holding or sending. At a terminal the command line
  fills an omitted `revision` from `mail-replyset-show`, prints the shared text once and every
  recipient (labelling already-sent replies in a `partial` set while excluding them from SMTP) with
  `[matches shared text]` or `[DIFFERS from shared text]` and `Reply-To` warnings. Each unsent
  reply submits over SMTP to its stored recipient with threading headers, records `outbound`
  (`kind = 'replyset'`) with an in-flight drop guard, and makes a best-effort `\Seen` Sent copy over
  a reused IMAP session (`SENT_COPY_FAILED` warning on failure). Clean pre-handover failures leave
  the set `partial` (when earlier replies sent) or `open` at a bumped revision so only unsent
  replies send on re-approval; post-handover drops/timeouts/crashes mid-SMTP mark the reply,
  `outbound` and set `unknown` (`SEND_OUTCOME_UNKNOWN`, shown in `mail-status`, never retried),
  while restarts between replies or after the last acceptance recover cleanly from persisted child
  states (`partial` or `sent`). `mail-account-remove` refuses `WORK_RUNNING` while sending and
  removes the account's reply sets cleanly.

- **As step F3 amended it** (`engine/src/replysets_units.rs`, `engine/src/replysets_send.rs`,
  `engine/src/store/replysets_send.rs`, migration 24, `plugin.spec.md` §§5, 9, 11, 18):
  - **Persistent claim key and instructions version (migration 24):** non-derived table
    `replyset_claim_key` holds one 32-byte key initialized once from the OS random source on store
    open; it survives restarts and `mail-rebuild` and never appears in any result, error or
    journal entry. `replyset_reply` and `replyset_event` gain `instructions_version`, exposed in
    `mail-replyset-show`'s `reply.inputs.instructionsVersion`.
  - **`mail-replyset-next` is a pure read (`cli, mcp`, `mutation: false`):** stores nothing and is
    not journaled. Input `{ replyset }` returns `{ replyset, revision, done: true }` when every
    reply has text, or the next unwritten reply with `unit = rsu_<set>_<reply>_<generation>`,
    43-character unpadded base64url HMAC-SHA256 `claim` over `(unit, sourceTextDigest)`, a
    `"dev.loam/unit"` marker (`id`, `submit: { command: "mail-replyset-submit", input: { replyset,
    reply, unit, claim }, field: "text" }`, and versioned `instructions` within 4 096 characters),
    and `"content": { "trust": "content", recipient, message, answers }` holding only that reply's
    own visible message text and linked answers.
  - **`mail-replyset-submit` (`cli, mcp`, non-destructive mutation, no approval):** takes only
    `{ replyset, reply, unit, claim, text }` (1–32 768 chars; no `recipient`, `subject`, or
    `account` parameters — the engine derives them from the source message). Inside one transaction verifies the set is open or
    partial, the reply has no text yet, `unit` matches the reply's current generation, linked
    answers match, and `claim` matches the constant-time HMAC-SHA256 for `(unit, sourceTextDigest)`
    (`UNIT_NOT_OPEN` otherwise, with suggestion naming `mail-replyset-next`). Checks
    `PREVIEW_TOO_LARGE` before commit, records `source: "submitted"` with `instructions_version`
    and audit row in `replyset_event`, raises `generation` (spending the claim) and `revision`,
    and returns `{ reply: { reply, source, unit }, revision }` without echoing `text` or `claim`.
    The journal's redaction strips `claim` from every `mail-replyset-submit` input (succeeded or
    failed).
  - **`mail-replyset-send` released over MCP (M18 amended):** exposed to `cli` and `mcp`
    (`agent: false, palette: false`), `ApprovalPolicy::Required`, accepted from a terminal human or
    an HTTP MCP approver token. Pre-approval middleware also verifies account existence and
    `PREVIEW_TOO_LARGE` before any hold.

### 10.4 Extractors, deferred

Not built. What is kept so they can come later without a change of design: the template
fingerprint ([6.3](#63-the-template-fingerprint)), the record store with passages, and the
rule that a person approves anything that writes records unattended. The proposal's
`mail-extractor-*` commands are not registered.

## 11. Commands

Every command is in the `mail` domain, returns `success()` or `failure()`, and declares its
metadata. "Remote" means it changes mail at the provider. A person's command is exposed to `cli`
alone, with `mcp`, `agent` and `palette` false, and carries an approval policy unless the row
says otherwise.

| Command | Phase | Class | Exposed to | Notes |
| --- | --- | --- | --- | --- |
| `mail-status` | B | Read | cli, mcp | Sync state per mailbox ([5.7](#57-what-synced-means)), bursts, recent blocks, sends of unknown outcome (`outbound`, step D3). Step B5: and the server's work ([3.2](#32-modes)). Step D1: the operations running and stopped, and the proposals waiting for the person ([9.4](#94-the-policy)). Step F0: `build: { testDoubles: true }` in `test-doubles` builds. Step F1: `tokens: { agents, approvers }` |
| `mail-account-list` | B | Read | cli, mcp | |
| `mail-account-add`, `mail-account-remove` | B | Local; a person; removing is destructive | cli | Removing an account deletes its mail from the store, not from the provider, and its preview says so. Adding is step B3's; removing is step B5's ([3.5](#35-commands-only-a-person-may-run)) |
| `mail-token-create`, `mail-token-revoke` | B | Local; a person; revoking is destructive | cli | The new token is shown once (or written to a new `0600` file via `--out` on Unix; refused on Windows). Its result is removed from the journal ([13.1](#131-the-journal)). Step B5: creating asks for approval and refuses a name another token has; revoking an id that is not there is `TOKEN_NOT_FOUND`. Step F1: `role` (`agent` or `approver`, `lmail_approver_` prefix) |
| `mail-token-list` | B | Read | cli | Each token's id, name, `role` (step F1) and when it was made; never the token, which the store does not have. A read, so no approval (step B5) |
| `mail-sync` | B | Local | cli, mcp | Returns counts only ([5.7](#57-what-synced-means)). On a server it asks for a pass and returns at once (step B5) |
| `mail-thread-list`, `mail-thread-open`, `mail-message-open` | B | Read | cli, mcp | An output budget on each; lists are paged by cursor. Step B4: `mail-thread-list` takes a mailbox's id and gives its threads newest first; `mail-thread-open` a thread's messages oldest first, with each message's evidence; `mail-message-open` fetches a message's body when it is not held, whole when it is 1 MiB or less and in parts when it is larger (M20), trying each mailbox that shows it, and gives its recipients, evidence, links, files and a window of its visible text, with where the next window starts. The window is fitted to the budget as the budget measures the result; when even a small window does not fit, the HTML, then the hidden text, then half the links are left out and named in `leftOut`, and past that the call fails rather than give an empty window. A person at a terminal gets each command's largest budget |
| `mail-attachment-open` | B | Read | cli, mcp | Fetches the attachment if it is not held. Returns a path in the data directory to the command line, and bytes within the budget over MCP. Step B4 opens a file of a message held whole, fetching the message first, and a file of a message held in parts, fetching that part alone when it is not held, up to 256 MiB; its bytes are then decoded on their own (a part of a forwarded message held whole is read from that message), its type read from them and the message derived again. The file at the command line is named by the engine (the part's place, and an ending for what its bytes show), never by the message; over MCP the bytes are base64 inside the content part, a window at a time from `from`, with where the next starts |
| `mail-search` | B | Read | cli, mcp | Step B4: the best matches first, paged by cursor up to the first 1 000 |
| `mail-rebuild` | B | Local | cli | Under `serve` it runs in the server and reports through `mail-status` (step B5) |
| `mail-sender-list`, `mail-sender-show` | C | Read | cli, mcp | Step C1 ([7.1](#71-senders)): the list paged by cursor, most recent first, with a domain and a written-to filter; one sender with its mailboxes and lists. Step C2 ([7.3](#73-the-persons-decisions)): each sender's decision; the list's `waiting` and `suggested` filters; the show's classes and suggestions, and the preview of a suggestion by its id |
| `mail-sender-screen` | C | Local, undoable; a person | cli | No approval prompt ([7.3](#73-the-persons-decisions)). Step C2: in, out, mine or undecided, by a sender's id or a typed address |
| `mail-sender-suggest` | C | Local | cli, mcp | Changes no class. Step C2: in or out, at most 20 waiting for each caller |
| `mail-sender-accept` | C | Local, undoable; a person | cli | Accepts an agent's suggestion (M28) |
| `mail-sender-dismiss` | C | Local | cli, mcp | The person's or the proposer's |
| `mail-message-list` | C | Read | cli, mcp | Added by step C2 ([7.2](#72-the-screening-class)): one class's messages, newest first, paged by cursor, while a mailbox other than junk and trash shows them |
| `mail-story-list`, `mail-story-open`, `mail-story-changes` | C, E | Read | cli, mcp | Step C2's second part ([section 8](#8-stories)): the list newest first and the open paged by cursor, the open with a story's kinds and its exceptions; the changes with a cursor of the stories' epoch and a change's number. Step E2 ([10.2](#102-situation-and-cohort-stories)): includes active proposed stories (`by: "proposed"`, `proposed: true`, `proposer`, `proposedAt`) and each member's verified `passage` in `content` |
| `mail-selection-create` | D | Local | cli, mcp | Step D1 ([9.1](#91-selections)): the query's fields, the items it freezes, its counts and a labelled sample; ten a caller |
| `mail-archive`, `mail-label`, `mail-mark`, `mail-trash` | D | Remote, undoable | cli, mcp | Under the policy; over a limit, a proposal ([9.4](#94-the-policy)). Step D1's second part ([9.2](#92-the-commands)): a selection with its count or up to 200 ids. Its third part: over a limit, the operation waits in `proposed`, five a caller |
| `mail-operation-approve` | D, F2a | Remote, undoable; a person (released) | cli, mcp | Runs an agent's proposal (M28). Step D1's third part; released over MCP in step F2a (`{ operation, digest }`, `ApprovalPolicy::Required`, pre-hold + transactional check, CLI auto-fills `digest`) |
| `mail-operation-dismiss` | D | Local | cli, mcp | The person's or the proposer's. Step D1's third part: a change that never ran is dropped with its items; a resume proposed is stopped again |
| `mail-operation-list`, `mail-operation-show` | D, F2a | Read | cli, mcp | Step D1's second part ([9.1](#91-selections)): the list newest first, the show with a page of items, both by cursor. Third part: `proposed` filter and proposal preview. Step F2a: `mail-operation-show` gains `MOST_BUDGET` default/max, `preview.proposal`, `preview.digest`, and optional `digest` preview-only mode (`PREVIEW_CHANGED`, `PREVIEW_TOO_LARGE`) |
| `mail-operation-undo`, `mail-operation-resume`, `mail-operation-cancel` | D | Remote, undoable | cli, mcp | Under the policy, as the operation's own command. Step D1's second part: cancel stops after the batch in hand, for any caller. Its third part: an undo or a resume over a limit is a proposal |
| `mail-thread-snooze` | D | Local, undoable | cli, mcp | Step D3: until a time within a year, or until mail arrives in the thread; `mail-thread-list` with `snoozed` lists the snoozed threads ([9.5](#95-drafts-and-sending)) |
| `mail-draft-create`, `mail-draft-update` | D | Local | cli, mcp | Step D3: an update names the revision it read ([9.5](#95-drafts-and-sending)) |
| `mail-draft-discard`, `mail-draft-restore` | D | Local, undoable | cli, mcp | A discarded draft is held for 30 days (M29) |
| `mail-draft-list`, `mail-draft-show` | D, F2b | Read | cli, mcp | `mail-draft-show` is the preview of a send (step D3: adds `state`, `recipientBasis` and `replyToDiffers`; step F2b: fixed stored bases via migration 23, optional `revision` check (`PREVIEW_CHANGED`), `MOST_BUDGET` / 3.5 MiB MCP cap (`PREVIEW_TOO_LARGE`)) |
| `mail-draft-send` | D, F2b | Remote, destructive; a person (released) | cli, mcp | Step D3's second part ([9.5](#95-drafts-and-sending)): names the previewed `revision`, enforces the recipient rule, submits over SMTP, appends a sent copy with `Bcc:` and records `outbound`. Released over MCP in step F2b (`ApprovalPolicy::Required`, pre-hold + transactional check, Q2 (a) allows `new` recipients on approver-released sends) |
| `mail-unsubscribe-show` | D, F2b | Read | cli, mcp | Step D3's third part ([9.5](#95-drafts-and-sending)): previews the exact `List-Unsubscribe` target labelled as content with its `digest`; contacts nothing; step F2b enforces `PREVIEW_TOO_LARGE` over budget / 3.5 MiB MCP cap |
| `mail-unsubscribe` | D, F2b | Remote, destructive; a person (released) | cli, mcp | Step D3's third part ([9.5](#95-drafts-and-sending)): names the previewed `digest`, sends RFC 8058 one-click HTTPS POST (no redirects) or RFC 2369 `mailto:` over SMTP, and records `outbound`. Released over MCP in step F2b (`ApprovalPolicy::Required`, pre-hold + handler digest check) |
| `mail-policy-show` | D, F4 | Read | cli, mcp | Step D1 ([9.4](#94-the-policy)); step F4 adds `accounts` overrides list and optional `account` filter |
| `mail-policy-set` | D, F4 | Local; a person | cli | Step D1: held for approval, its summary in numbers alone; returns the numbers before. Step F4: optional `account` and `reset: true` for per-account overrides (M36) |
| `mail-record-list` | E | Read | cli, mcp | Step E1 ([10.1](#101-records)): newest first, cursor-paged (`proposedAt.record`), filters by `message`, `thread`, `type`, `proposer` and `includeEnded`; `fields` and `passages` labelled as content |
| `mail-record-propose`, `mail-record-withdraw` | E | Local | cli, mcp | Step E1 ([10.1](#101-records)): 9 closed types with strict fields, verbatim visible-text/subject passage verification (`NOT_HELD`/`PASSAGE_NOT_FOUND`), 10 000 active/proposer cap, atomic supersession; withdrawal by person or proposer (`FORBIDDEN` otherwise; non-destructive per M29) |
| `mail-story-propose`, `mail-story-dismiss` | E | Local | cli, mcp | Step E2 ([10.2](#102-situation-and-cohort-stories)): `situation` or `cohort`, `yes`/`no`/`unsure` with verbatim passage check (only `yes` stored, 200 active/proposer cap); dismissing is the person's or the proposer's (`FORBIDDEN` otherwise; non-destructive per M29) |
| `mail-replyset-create`, `mail-replyset-update` | E | Local | cli, mcp | Step E3 ([10.3](#103-reply-sets)): 1–50 source messages with engine-derived stored recipients, cohort questions/answers, optimistic `revision` updates (`REPLYSET_CHANGED`), `PREVIEW_TOO_LARGE` guard |
| `mail-replyset-next` | E, F3 | Read | cli, mcp | Step E3/F3 ([10.3](#103-reply-sets)): pure stateless read (not journaled); hands out the next unwritten reply as `dev.loam/unit` with only its own source message visible text (`NOT_HELD` if body missing), linked answers, and a 43-char HMAC-SHA256 `claim` |
| `mail-replyset-submit` | F3 | Local | cli, mcp | Step F3 ([10.3](#103-reply-sets)): non-destructive mutation, no approval; takes `{ replyset, reply, unit, claim, text }` (1–32 768 chars, no recipient/subject/account), records `instructions_version` and audit event, spends claim (`UNIT_NOT_OPEN`), checks `PREVIEW_TOO_LARGE` |
| `mail-replyset-show` | E, F3 | Read | cli, mcp | Step E3/F3 ([10.3](#103-reply-sets)): whole deterministic preview (`MOST_BUDGET`), optional `revision` check (`PREVIEW_CHANGED`), marks every reply's `differs` against `sharedText`, exposes `unit`, `source`, `inputs` (including `instructionsVersion`) and submission/edit counts |
| `mail-replyset-preview` | F3 | Read | cli, mcp | D175 ([#2410](https://github.com/lushly-dev/afd/issues/2410)): the send's confirmation preview, with `mail-replyset-show`'s input and budget; every recipient, subject and text the send would send with `differs`, `replyToDiffers` and author (token id), the shared text and `alreadySent`; fails as the send does before its hold; 11 + 11·u + s JSON values (u to send, s sent), at most 200 for Loam's ceiling: 17 to send with up to 2 sent |
| `mail-replyset-send` | E, F3 | Remote, destructive; a person (released) | cli, mcp | Step E3 ([10.3](#103-reply-sets)): names previewed `revision`, refuses incomplete (`REPLYSET_INCOMPLETE`), oversized (`PREVIEW_TOO_LARGE`) or stale (`PREVIEW_CHANGED`) before hold, sends each unsent reply over SMTP with `outbound` (`kind = 'replyset'`) and Sent copy. Released over MCP in step F3 (`ApprovalPolicy::Required`, pre-hold + transactional check) |
| `afd-help`, `afd-docs`, `afd-schema` | F1 | Read (AFD bootstrap) | mcp | Registered via `afd::register_bootstrap_commands` for discovery (e.g. Loam's `afd-help { format: "full" }`); exempted by name in `rules.rs` |

Differences from the proposal's draft list:

- `mail-thread-archive`, `-label`, `-mark` and `-trash` lose `thread` from their names because
  they take a selection.
- `mail-sender-screen` becomes a person's command, and `mail-sender-suggest` is added for
  agents.
- `mail-sender-accept`, `mail-sender-dismiss`, `mail-operation-approve` and
  `mail-operation-dismiss` carry the owner's rule that an agent proposes and a person approves.
- Added: `mail-message-list` (step C2), `mail-token-*`, `mail-selection-create`, `mail-operation-*`, `mail-policy-*`,
  `mail-rebuild`, `mail-draft-discard`, `mail-draft-restore`, `mail-draft-show`, `mail-record-withdraw`,
  `mail-story-propose` and `mail-story-dismiss`.
- The extractor commands are deferred.

No command here declares task support. The crate refuses `task` beside an approval policy, the
command line always runs inline, and a call must return within a mount's 60 seconds, so long
work is the server's and is read by its state. Tasks may be added to `mail-sync` and the
operation commands when Loam has a surface for them (L3).

## 12. Results

### 12.1 Content labels

Text that came from a message is content: a body, a subject, a display name, an address as
written in a header, an attachment's name and text, a link's text and target, the
authentication header until [6.1](#61-what-is-read) says otherwise. In every result each such
value sits in a part labelled `trust: "content"`, the label Umbel uses (its D67). Outside those
parts a result holds only what the engine vouches for: ids, counts, dates it observed and
classes.

Content never appears in a result's `reasoning`, `suggestions` or `warnings`, in an error's
message or suggestion, or in an approval's summary. A person sees content before deciding only
through a preview command's labelled parts, and the command line names each value as it shows
it ("Subject, as written by the sender").

The shape, decided by step B4 against the one Umbel's knowledge plugin returns so that one reader
handles both: a labelled part is a JSON object with `"trust": "content"` beside the values that
came from mail, as Umbel's hits and windows are. A message in a list, for example, is
`{ "message": 12, "date": ..., "evidence": {...}, "content": { "trust": "content", "subject": ...,
"sender": {...}, "snippet": ... } }`. A mailbox's name is the provider's text, so `mail-status`
labels it the same way.

### 12.2 Provenance

Every stored item records where it came from, with the fields of Umbel's envelope where they
apply: origin kind, the principal, the time observed, the content hash, what it was derived from.
For the log the origin is the provider and account. For evidence it is the message and the
parser's version. For a record it is the proposer and its passages.

### 12.3 Error codes

Beside the crate's own codes:

| Code | When |
| --- | --- |
| `STORE_IN_USE` | Another process owns the store |
| `STORE_NEWER` | The store's schema is newer than the program |
| `STORE_FAILED` | The data directory, the log or the database refused; the message is the engine's own |
| `INDEX_STALE` | The search index is older than the tables, or gone; `mail-rebuild` makes it again |
| `ACCOUNT_NOT_FOUND`, `MAILBOX_NOT_FOUND`, `MESSAGE_NOT_FOUND`, `THREAD_NOT_FOUND`, `SENDER_NOT_FOUND`, `STORY_NOT_FOUND`, `OPERATION_NOT_FOUND` | A named thing does not exist. `SENDER_NOT_FOUND` also when a suggestion's address has become one of the person's own |
| `SIGN_IN_REQUIRED` | The provider refused the stored credential |
| `PROVIDER_UNAVAILABLE` | The provider could not be reached; retryable |
| `PROVIDER_REFUSED` | The provider permanently refused a send (5xx); not retryable (step D3) |
| `PROVIDER_LIMIT` | The provider's rate or quota limit; retryable after the time given |
| `NOT_HELD` | The bytes asked for are not in the log and could not be fetched now |
| `PART_NOT_FOUND` | A message has no part at the place named |
| `WORK_RUNNING` | `mail-account-remove` on a server while a pass or a rebuild runs; a resume or an undo of an operation that runs; retryable |
| `REPLY_TOO_LARGE` | A reply larger than a call to a running server may return ([3.2](#32-modes)) |
| `ONE_COMMAND_PER_CALL` | `afd-batch` or `afd-pipe` called on a server ([3.2](#32-modes)) |
| `TOKEN_NOT_FOUND` | No agent's token has the id named |
| `PERSON_REQUIRED` | A person's command with no terminal |
| `POLICY_LIMIT` | More proposals, suggestions waiting, active records or active proposed stories than the policy allows this caller (10 000 active records per proposer in step E1; 200 active proposed stories per proposer in step E2) |
| `PROPOSAL_NOT_OPEN` | The proposal or suggestion named was already approved, dismissed or expired, or there is none with that id |
| `SCREENING_NOT_READY` | Classes or stories are read while messages wait to be derived again or a rebuild is under way ([7.1](#71-senders)); retryable |
| `SELECTION_MISMATCH` | The count stated is not the selection's count, or the selection has expired |
| `SELECTION_SPANS_ACCOUNTS` | A non-human change, resume or undo spans more than one account (step F4, M36; not retryable) |
| `RECIPIENT_NOT_ALLOWED` | A recipient the rule does not allow |
| `SEND_OUTCOME_UNKNOWN` | The send may or may not have gone |
| `UNDO_NOT_POSSIBLE` | The provider no longer holds what an undo needs |
| `PASSAGE_NOT_FOUND` | A proposed record's or proposed story member's passage is not in the message's visible text or subject (steps E1, E2) |
| `RECORD_NOT_FOUND` | No record has the id named (step E1) |
| `DRAFT_NOT_FOUND` | No draft has the id named; a discarded draft goes after 30 days (step D3) |
| `DRAFT_CHANGED` | A change names a revision the draft is no longer at (step D3) |
| `PREVIEW_CHANGED` | A released command or its preview (`mail-draft-send`, `mail-replyset-send`, `mail-unsubscribe`, `mail-operation-approve`, and their `-show` previews) names a revision or digest that is no longer current since its preview was read (steps D3, E3, F2a, F2b, F3) |
| `PREVIEW_TOO_LARGE` | A draft, unsubscribe, reply set or proposal preview would exceed `MOST_BUDGET` or the 3.5 MiB MCP reply cap (steps E3, F2a, F2b, F3) |
| `REPLYSET_NOT_FOUND` | No reply set has the id named (step E3) |
| `REPLYSET_CHANGED` | `mail-replyset-update` names a revision the reply set is no longer at (step E3) |
| `REPLYSET_INCOMPLETE` | `mail-replyset-send` attempted while one or more replies have no text (step E3) |
| `UNIT_NOT_OPEN` | `mail-replyset-submit` names a unit or claim that is not the reply's current open one (guessed, another reply's, already submitted, edited, linked answers changed, or derived source text changed; step F3) |
| `UNSUBSCRIBE_NOT_AVAILABLE` | A message has no usable `List-Unsubscribe` / `List-Unsubscribe-Post` header (one-click HTTPS POST or valid `mailto:`); the engine never opens a browser link (step D3) |

Each failure carries a suggestion in the engine's words.

## 13. Security

- **The boundary.** The engine defends a person's mail against callers that have only MCP, and
  against the content of the mail itself. It does not defend against a program running as the
  person, which can read the data directory and call the private route
  ([3.5](#35-commands-only-a-person-may-run)).
- **Mail is input, not instruction.** No command takes a recipient, a link, a query or a command
  name from message text. [7.3](#73-the-persons-decisions), [9.5](#95-drafts-and-sending) and
  [12.1](#121-content-labels) are the rules.
- **Nothing is fetched because a message says so.** The engine contacts the account's provider,
  and, for an unsubscribe a person confirmed, the one target shown. It loads no image, follows
  no link and resolves no name found in mail.
- **The network surface** is one loopback port. One layer checks the host, the origin and the
  token of every request on both routes before anything else reads it
  ([3.4](#34-the-http-surface)).
- **Secrets.** Credentials and refresh tokens are in the keychain and pass through no command.
  An agent's token is shown once and stored hashed.
- **At rest.** M21.
- **Logs** carry ids and counts, never addresses, subjects or text.

### 13.1 The journal

The journal is the crate's record of each accepted command: its input, its result, the actor.
It is in the data directory and is as private as the mail.

- **It holds text from mail and from the person.** A proposed record's passages, a sender's
  address in a decision or suggestion, a selection's search text and a draft's text are all
  command input, and are journaled. That is what makes those changes replayable and auditable,
  and it means the journal must never be shared or uploaded as a log. A draft's text stays in it
  after the draft is discarded and gone; a draft command's result is journaled without the text
  (step D3), `mail-record-propose`'s and `mail-story-propose`'s results are journaled without
  their `content` parts (steps E1, E2), `mail-replyset-create` and `-update` results are journaled
  without their `content` parts (step E3), `mail-replyset-next` is a read and is not journaled,
  and `mail-replyset-submit` strips `claim` from every journaled input (step F3).
- **It does not hold what was read.** Read commands are left out by the recorder's filter, so
  opening and searching mail copies nothing into it.
- **It holds no secret.** `mail-token-create` returns one and declares `secret`
  (`spec/journal.md`), and the recorder's redaction, told the declaration with each record,
  removes the result's data and the tape of random values from a secret call's entry before it
  is stored, and every field of its input but `name`, `role` and `source`, so a secret a command
  takes in its input is never kept either; the entry keeps its outcome. A command that declares
  `secret` must name no secret `name`, `role` or `source`. `mail-replyset-submit`'s single-use
  `claim` is removed by name (step F3). It decides by the declaration,
  never the command's name (#2588), and `pair`'s record of the token it makes is redacted the
  same way. The token is drawn from the operating system's random source, not from the command
  context's, so the tape could not rebuild it in any case.
- **It records refusals without content.** Failures are recorded, approval holds among them;
  an approval's summary holds no content ([3.5](#35-commands-only-a-person-may-run)), and refused
  `mail-story-propose` entries strip `title` and member `passage` strings from the journaled input.
- **As step B5 built it.** The file is `journal.jsonl`, `0600`, written by the crate's file sink,
  which allows one writer. Only the process that owns the store writes it: a call another process
  refused because a server or `loam-mail mcp` held the store is not recorded. Before each entry
  the engine makes the file private again if something opened it to others. The filter keeps
  the commands declared as mutations. The redaction also removes the approval token from each
  held call's details, since whoever read the file could otherwise use it to run the command it
  was issued for within its 30 minutes. A failure to write the journal is reported on the
  engine's progress line and does not fail the command.

## 14. Exit criteria and tests

**Test doubles, built in phase B and used by every later phase:**

- A scripted IMAP server, grown from the census's fake connection. It can list a message it
  never returns, drop a connection mid-batch, change `UIDVALIDITY`, and answer with or without
  CONDSTORE, QRESYNC, IDLE and MOVE.
- A scripted SMTP submission server on loopback (step D3), recording envelopes and raw bytes and
  injecting pre- and post-handover faults, STARTTLS errors, stalls and malformed replies.
- A scripted Gmail API with a history that expires.
- A corpus of messages: ordinary mail, malformed mail, hidden-text cases, and the parser's fuzz
  findings. It holds no real person's mail.

**Per phase.** Each row's tests run in the workflow against the doubles. Each phase also has an
acceptance run on the owner's accounts, recorded in the status file as counts.

| Phase | Exit | Tests that must pass |
| --- | --- | --- |
| B | The owner's iCloud and Gmail accounts synced; mail read and searched from the command line and by an agent over MCP; the large mailbox reaches "synced" with its unreturned messages counted; the limits of [4.4](#44-limits-to-meet) met | Sync resumes after a stop at every batch boundary; a read never sends a command that can change a mailbox; unreturned messages follow [5.4](#54-messages-listed-and-not-returned); a header-only mailbox reaches "synced"; a rebuild reproduces every derived table; a request with no token, a wrong `Host` or a browser `Origin` is refused on both routes, `tools/list` included, and each token is refused on the other's route; of person-only commands, only the four of M18 are listed over MCP (from F2a onward) and none runs without evidence from the terminal or an approver; no content outside a labelled part in any result, failure or journal entry of a refusal; a new token is not in the journal; the fuzz targets run clean for the time the workflow gives them |
| C | Stream stories and the screening queue on the owner's mail with no model; the burst rule tried on the period the owner names | Each class's rule; a decision reclassifies old mail; an agent's suggestion changes no class until a person accepts it, and accepting needs an approval; a burst is one story, a bulk message in it is in no stream story, and a known sender's message is never in it |
| D | An agent archives and labels under the policy and cannot send; an agent proposes emptying a large mailbox and nothing changes until the owner approves; a person sends at the terminal; the owner moves a large selection to trash, with its unreturned messages reported, and undoes part of it | Every remote command's inverse restores the prior state on both doubles; a move without `MOVE` resumes correctly from a stop after each of its steps; a change touches the frozen set and nothing that matched later; a wrong `expectedCount` changes nothing; a call over the policy changes nothing and becomes a proposal, which runs only after a person's approval and then touches exactly its frozen set; a sixth waiting proposal is refused; an approval's preview gives the query, the counts by mailbox and by class, and a line for known senders' mail when the set holds any; every destructive command has an approval policy; a send to a recipient outside the rule is refused; a dropped connection during a send yields `SEND_OUTCOME_UNKNOWN` and no retry |
| E | A reply set sent from a reviewed batch, each reply traceable to its inputs | A record with a passage not in the visible text is refused; a reply's recipient cannot be set by the caller |

## 15. Implementation plan

Each step is one pull request unless it says otherwise, with its tests, and updates the status
file.

| Step | What |
| --- | --- |
| B0 | The Gmail API probe ([5.5](#55-gmail)), as a prototype beside the census. Corrects this document |
| B1 | The plugin folder, the crate's skeleton, the workflow and the Loam exclusion (L8); `loam-mail help` runs |
| B2 | The store, in two pull requests. First: the data directory and its lock, the log, migrations, and the tables that are not derived (`account`, `mailbox`, a message's identity, `held`, `observation`, `unreturned`, `change`). Second: the derived tables, the index, `mail-rebuild`, and the harness run against it for [4.4](#44-limits-to-meet). The second built what a list, a thread and a search need (`envelope`, `part`, `thread`, `thread_key`, `thread_place`), and the command line's running of a command. Left to the step that owns each: unread counts, with the provider interface's flags (B3); the parts of a message fetched in parts, which need its structure from the provider (B3); hidden text, the template, the limits of [6.4](#64-parsing-strangers-bytes) and the index's filters (B4); Gmail's own threads (B6); `sender`, `template` and `story` (phase C) |
| B3 | In two pull requests, as B2. First: the provider interface, IMAP, the scripted IMAP server, iCloud sync with resume and unreturned messages, unread counts, repairs of damaged files, `mail-sync` and `mail-status`, and the checks on the owner's account ([4.2](#42-what-makes-two-messages-the-same) and the IMAP crate of [section 2](#2-units-placement-and-crates)). Second: `mail-account-add` and `mail-account-list`, the keychain, and the command line's approval of a person's command ([3.5](#35-commands-only-a-person-may-run)). The headers and text of a message over 1 MiB (M20) moved to B4, which builds the fetching of a part that opening a message or an attachment needs; such a message does not hold a mailbox back from "synced" ([5.7](#57-what-synced-means)) |
| B4 | In three pull requests. First: the evidence of [6.1](#61-what-is-read) and [6.3](#63-the-template-fingerprint), the limits of [6.4](#64-parsing-strangers-bytes), the parser's version raised and stale rows derived again, the fuzz targets, and the two decisions on the owner's mail: which authentication header is the provider's, and whether a shared subject joins a thread ([5.6](#56-threads-on-imap)). Second: labels on results ([12.1](#121-content-labels)); the read commands and `mail-search`; cleaning HTML for display; fetching a message's body when it is opened. Third: a message over 1 MiB (M20): its structure, its text parts at sync, and a file of it fetched when it is opened |
| B5 | In three pull requests. First: `serve`, tokens, the layer and the two routes, stdio, the command line forwarding to a running server, and the journal ([13.1](#131-the-journal)). Second: sync every five minutes in the background, `mail-sync` and `mail-rebuild` as the server's work reported by `mail-status`, the 60 seconds and 4 MiB of a call ([3.2](#32-modes)), and a store that does not hold every command back during a rebuild. Third: where the 174 seconds of a pass with nothing new go, measured on the owner's account (they did not come back; the pass now asks one request a mailbox, [5.2](#52-imap)), and `mail-account-remove` ([3.5](#35-commands-only-a-person-may-run)) |
| B6 | Gmail sync through the API, with the scripted API |
| B7 | The acceptance run on the owner's accounts, in two pull requests: iCloud first, then Gmail after B0 and B6. The iCloud half also raised the body batch from 50 to 400, narrowed a failing batch to its own messages, stopped a mailbox for the pass when its opening nests too deep, and made every file the program creates the owner's alone (the index's directory `0700`, the program's mask `077`), all found by the run |
| C1 | Senders, and the report on Q2 and the two groupings ([6.3](#63-the-template-fingerprint)). Built: `recipient` and `sender` (migration 7, the derivation's version 3), `mail-sender-list` and `mail-sender-show` ([7.1](#71-senders)), and the report, run on a copy of the owner's iCloud store; the Gmail half of the report waits for step B6. An address the person adds as theirs comes with their decisions in C2 |
| C2 | In two pull requests. First: screening classes, the person's decisions (an address the person adds as theirs among them) and agents' suggestions, and screening that waits until no message waits to be derived again ([7.2](#72-the-screening-class), [7.3](#73-the-persons-decisions)), with `mail-message-list`. Second: stream stories, by list id or else sender, with their exceptions and `mail-story-*` ([section 8](#8-stories)) |
| C3 | Bursts, tried on the period the owner names. Built ([7.4](#74-bursts)): first contacts and bursts (migration 10), each burst a story in place of its queue entries and stream stories, flagged in `mail-status` with the known senders that wrote during it. Tried on the owner's iCloud mail ([the counts](live-icloud-c3.results.json)): one burst, in February 2022, of 75 messages from 4 new senders through 16 lists, one service's first day rather than a flood of strangers; so a burst also needs 10 new senders, which the owner agreed to, and finds none there ([the counts](live-icloud-c3-senders.results.json)); the flood the owner remembers from 2024 and 2025 was deleted, and the owner reports none on Gmail. Tested on made-up floods. Then rule 3 (migration 11): a junk or trash mailbox's history starts no later than when the engine first listed it |
| D1 | Selections, the policy, proposals and their approval, operations and undo, on the doubles. In three pull requests. First: selections and the policy (migration 12), `mail-selection-create`, `mail-policy-show` and `mail-policy-set`. Second: the change commands at the provider within the policy, on the scripted IMAP server: operations and their batches (migration 13), `mail-operation-list`, `-show`, `-resume`, `-cancel` and `-undo`. Third: a change over the policy as a proposal (M28), `mail-operation-approve` and `-dismiss` (migration 14). The scripted Gmail API's half waits for step B6. `mail-thread-snooze`, local like the drafts, moves to D3 |
| D2 | The four remote commands on iCloud and Gmail. iCloud: the run the owner makes on a mailbox of 1 to 20 messages he names ([9.3](#93-undo)), and a large run on the account's largest mailbox ([the counts](live-icloud-d2-large.results.json)), with what it found fixed: presence read by search or `FETCH`, an original confirmed by `FETCH` before its copy goes ([9.3](#93-undo)), and mail that leaves unreported found by the mailbox's count ([5.2](#52-imap)). Gmail's half after B0 and B6 |
| D3 | Drafts, send and unsubscribe at the terminal, and `mail-thread-snooze` |
| E1 to E3 | Records; proposed stories; reply sets |

## 16. For the owner

The owner approved M15 to M27 by merging this document. Four points were choices more than
engineering. His answers, 2026-11-11:

| | Choice | The owner's answer |
| --- | --- | --- |
| M21 | No encryption of the engine's own; rely on the disk's, with files private to the user account and credentials in the keychain | Agreed |
| M26 | Bursts: known senders stay on top, a flood becomes one flagged story | Agreed |
| The default policy ([9.4](#94-the-policy)) | An agent may archive, label and mark up to 500 messages a call, and trash up to 50 a call and 200 a day | Agreed as the limits for an agent acting alone. Added: an agent may offer a larger change, such as emptying the large mailbox, and the person must approve it (M28). Anything destructive and not recoverable needs the person's approval, enforced through AFD (M29) |
| Decisions on senders ([7.3](#73-the-persons-decisions)) | Only the person blocks or admits a sender; an agent suggests | Treated like the policy: an agent offers, and the person approves (M28) |

One limit to know ([3.5](#35-commands-only-a-person-may-run)): "only a person may send", and
"only a person approves", hold against an assistant connected over MCP. They do not hold against
a coding agent that has a shell on the owner's machine, because such an agent can do whatever he
can at a terminal. The Loam app's approval (L7) is the stronger assurance; whether it closes
this fully depends on the keychain point in [3.5](#35-commands-only-a-person-may-run), which is
not verified.

Still needed from the owner: the account and period of the flood for step C3. The OAuth client
for step B0 was created in Google's console on 2026-11-22. Loam's L8 comes as step B1's pull request.

## 17. Out of scope

Beside the proposal's [section 12](../../../../../docs/features/active/mail/mail.proposal.md#12-out-of-scope):

- A hosted engine and the OAuth resource-server mode.
- Extractors ([10.4](#104-extractors-deferred)).
- Syncing drafts with the provider.
- Encryption of the engine's own (M21).
- Task support on any command, until Loam has a surface for tasks (L3).
- Windows and Linux are not excluded, and nothing here is specific to macOS but the path named
  in [3.1](#31-the-data-directory); they are not tested until someone needs them.
