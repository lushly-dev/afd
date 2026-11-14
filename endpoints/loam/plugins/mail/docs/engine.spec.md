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
| M18 | In phases B to E, commands only a person may run are not exposed over MCP at all. They run at the terminal | An elicitation's answer is the client's, not a person's, and the route by which a shell's approval reaches a mounted server does not exist yet (L7, A1). Not listing the command is the strongest rule available today. It holds against a caller that has only MCP, and not against one that also has a shell ([3.5](#35-commands-only-a-person-may-run)) |
| M19 | The log is a file per message, named by the hash of its bytes. SQLite holds what is derived, and the index holds the text | M3: one copy of the source, and everything else can be rebuilt from it by a command |
| M20 | On IMAP, a message of 1 MiB or less is fetched whole. A larger one is fetched as its headers and text, and its attachments when someone opens them | In the census 99.8% of iCloud messages and 99.2% of Gmail's are 1 MiB or less, so nearly all mail is held whole, and a few large attachments do not slow a first sync. For Gmail's API see [5.5](#55-gmail) |
| M21 | The engine does not encrypt its files itself in this version. They are readable only by the person's user account, and credentials are in the operating system's keychain | A key the engine could use unattended would sit beside the files it protects. Disk encryption covers a lost machine. A process running as the person can read the files either way. This is a choice the owner should see ([section 16](#16-for-the-owner)) |
| M22 | Sync runs newest first, headers before bodies, in turns across mailboxes, and resumes from a stored cursor after any stop | The client is useful in minutes, and one huge mailbox cannot starve the inbox |
| M23 | A listed message that never arrives is recorded as unreturned after repeated tries, counted, and tried again later | The iCloud finding. A mailbox must be able to reach "synced" |
| M24 | A command that changes many messages works on a set the engine resolved and froze beforehand, and the caller states that set's exact count | The owner's requirement. What was counted is exactly what is changed, so a wrong query cannot quietly touch 283 000 messages |
| M25 | Extractors are deferred. The template fingerprint and the record store they would need are still built, for stories and proposals | The owner agreed to leave them out on Q1 |
| M26 | Mail from a sender with a history is never placed below or inside a burst of strangers. A burst is one story, and it is flagged | An answer to the flood the owner described. Proposed by this document; the owner agreed on 2026-11-11 |
| M27 | Rust 1.98.0, the repository's Rust toolchain. Every dependency is pinned by a committed lockfile | `mail-parser` declares 1.98 as its minimum; one toolchain for the repository's Rust |
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
| `rusqlite` | 0.41, bundled SQLite | MIT | The store | The version Umbel pins, so the repository carries one. 0.42 is current |
| `tantivy` | 0.27 | MIT | The search index | Built without its default features; with `mmap`, `stopwords`, `stemmer` and `lz4-compression`, as the phase 0 harness was |
| `sha2` | 0.11 | MIT or Apache-2.0 | The log's file names and a message's identity | The version the `afd` crate uses |
| `zstd` | 0.14 | BSD-3-Clause | Compressing the log | Builds the zstd C library, as `rusqlite` builds SQLite |
| `mail-parser` | 1.0.1 | Apache-2.0 or MIT | Parsing messages | The licence is stated on crates.io, which answers the proposal's follow-up |
| `ammonia` | 4.2 | MIT or Apache-2.0 | Cleaning HTML for display | Step B4 found that 4.2 depends on `cssparser` and `dtoa-short`, which are MPL-2.0, outside the licence check's allowlist. The owner allowed MPL-2.0 for those two crates by name on 2026-11-12; MPL is file-level copyleft, so their own files stay MPL and nothing else of the engine is touched. The licence check names them as exceptions, so no other crate brings MPL in unnoticed |
| `html5ever`, `markup5ever_rcdom` | 0.40, 0.40 | MIT or Apache-2.0 | Reading a message's HTML for its evidence ([6.1](#61-what-is-read)) | Added by step B4. The DOM crate is published as unofficial by html5ever's authors; the engine reads with it and builds nothing on it |
| `async-imap` | 0.12 | MIT or Apache-2.0 | IMAP | Checked by step B3. With `imap-proto` 0.17 it parses `VANISHED`, `HIGHESTMODSEQ`, `MODSEQ` and the `COPYUID` code, and it has `UID EXPUNGE`. It has no call that opens a mailbox with QRESYNC, and it sets aside on a bounded channel, dropping when full, any response its own calls do not expect. So the engine uses it for the connection, the sign-in and the parser, sends its own commands and reads every response itself. `imap-codec` is not needed |
| `rustls`, `tokio-rustls`, `rustls-native-certs` | 0.23, 0.26, 0.8 | MIT, Apache-2.0 or ISC | TLS to the provider, with the operating system's certificates | Added by step B3, with `ring` rather than the default `aws-lc-rs`, which needs CMake to build |
| `lettre` | 0.11 | MIT | SMTP, from phase D | None |
| `keyring-core`, `apple-native-keyring-store` | 1, 1 | MIT or Apache-2.0 | The operating system's keychain | Step B3 took these in place of `keyring` 4.2, which advises an application that knows its platforms to link them directly. macOS only for now: on another platform adding an account says there is no keychain yet |
| `getrandom` | 0.3 | MIT or Apache-2.0 | The approval middleware's key, made afresh for each process; the tokens of [3.3](#33-callers) | Already in the lockfile through `tantivy` |
| `tokio` | 1 | MIT | Running a command from the command line; the `afd` crate's deadlines use it; the connection to the provider; the server | Step B5 added `rt-multi-thread`, `io-std` and `sync` to `rt`, `time`, `net`, `io-util`, `signal` and `macros` |
| `axum`, `tower` | 0.8, 0.5 | MIT | The server's routes and the layer in front of them ([3.4](#34-the-http-surface)) | Added by step B5, new to the lockfile with the crates they bring; `axum` without its default features, with `http1` and `tokio`. The MCP SDK's HTTP service is a `tower` service that `axum` mounts |
| `hyper`, `hyper-util`, `http-body-util` | 1, 0.1, 0.1 | MIT | The command line's call to a running server over loopback | Added by step B5; `axum` uses the same versions. A plain HTTP/1 connection, with no TLS and no pool |
| `serde` | 1 | MIT or Apache-2.0 | The forwarded call and `server.json` | Added by step B5; already in the lockfile through the `afd` crate |
| `async-trait`, `serde_json` | 0.1, 1 | MIT or Apache-2.0 | A command's handler and its input and result | The `afd` crate's own |

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

- They are exposed to `cli` only: `mcp`, `agent` and `palette` are set false, since the last two
  default to true. An agent that names one over MCP gets `COMMAND_NOT_FOUND`, as for any
  unexposed command.
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
| `envelope` | What a message's bytes say: its date, sender, subject, a snippet, how many attachments, its thread, the parser's version, and why it could not be read when it could not. Step B4 added its evidence ([6.1](#61-what-is-read)): the list and bulk headers, `Reply-To` and whether it differs from the sender, the topmost authentication header's server and results, how much text is hidden, how many links and how many of them name a host other than their target, the template key and the body's shape | Yes |
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
| `sender`, `sender_address` | A sender and its history with the person ([section 7](#7-relationships-and-screening)) | Counts yes; the person's decisions no |
| `template` | A template and how often it was seen | Yes |
| `change` | One row per change to anything a view shows, with a growing sequence number | No |
| `story`, `story_member` | Stories and their messages ([section 8](#8-stories)) | Stream and burst stories yes |
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
  ask for. Their headers still count toward a burst ([7.4](#74-bursts)).

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

**Step B0 comes first.** Nothing here was observed. Before any Gmail code, step B0 runs a probe
against the owner's account and records: the quota a sync spends and the rate it reaches; one
history sync, and what an expired history cursor returns; which scopes a read-only sync, a label
change and a send each need; whether an OAuth client in testing status expires its refresh token
in a week; whether a batch label change can move messages to trash; whether a sent message is
kept in the sent mailbox without an append; and whether a message's header block can be fetched
as bytes without the whole message. This section is then corrected in the same pull request.

The design the probe tests:

- **Sign-in.** OAuth with the person's own client, through the system browser and a loopback
  redirect that the command line runs. The refresh token goes to the keychain. Phase B asks for
  read access only; phase D adds the scopes to modify and to send.
- **Identity in a mailbox.** Gmail's message id and thread id. Labels are mailboxes; a message
  has one observation per label.
- **First sync.** List message ids, newest first, then fetch each in raw form.
- **Large messages.** Gmail's raw form is the whole message or nothing. Until step B0 finds a
  way to fetch a header block as bytes, a Gmail message is fetched whole whatever its size, and
  M20 applies to IMAP alone. The census found 143 Gmail messages over 1 MiB.
- **Later syncs.** The history from the stored history id. If Gmail says the id is too old, the
  engine lists ids again and compares, fetching only what it lacks.
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
  on IMAP, whole when it is 1 MiB or less and in parts when it is larger. A header-only mailbox
  is synced when it is listed. `mail-status` counts a message held in parts among its bodies
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

**What a model adds.** The `unknown` queue is ordered by date. A caller may propose an order or
a category for its messages as records ([10.1](#101-records)); the engine stores them with their
proposer and shows them as suggestions. It does not act on them.

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

### 7.4 Bursts

A **burst** is many messages in a short time from senders never seen before. For each account,
the engine detects one when the count of messages from first-time senders in any 24 hours is at
least 30 and at least ten times the median daily count over the previous 90 days. On a quiet
account that median is zero and the first number governs. Headers in the junk mailbox count:
a flood the provider filed there is still a flood.

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

## 8. Stories

A story is a view (M9). A message in a story is still in every list it was in.

- **Stream stories** (phase C) are made by code. One story per list id, or per sender and
  template (key and body shape) where there is no list id. A stream story needs at least five
  messages.
- **Burst stories** (phase C): [7.4](#74-bursts).
- **Situation and cohort stories** (phase E) are proposed by a caller
  ([10.2](#102-situation-and-cohort-stories)).

A story has a stable id, a kind, a title the engine builds from the sender or list, counts, the
date of its last change, and its exceptions: members that are not routine. For a stream story an
exception is a message whose body shape differs from the story's usual ones.

`mail-story-changes` takes a cursor and returns what changed in each story since, from the
`change` table, with a new cursor. The caller keeps its cursor; the engine stores none.

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

### 9.3 Undo

`mail-operation-undo` puts back what an operation changed, from the places and states it
recorded, and is itself an operation. An undo of a trash is possible only while the provider
still holds the message; the operation records the date after which it may not be, where the
provider states one, and an undo after that fails for those messages with `UNDO_NOT_POSSIBLE`.

### 9.4 The policy

The person's policy says what each kind of actor may change without them. It is data, changed
only by a person. The default:

| Actor | Local commands | Archive, label, mark | Trash |
| --- | --- | --- | --- |
| `human` | Yes | Any size; above 200 messages the command line shows the count and asks | The same |
| `agent`, `script` | Yes, apart from a person's commands | Up to 500 messages a call | Up to 50 messages a call, and 200 a day for each caller |

The engine applies the policy itself, to every caller, because Loam's autonomy policy reaches
only Loam's copilot. The limits are what an agent may do with nobody present.

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

### 10.2 Situation and cohort stories

A caller proposes a story and its members with `mail-story-propose`. Each membership carries an
answer of yes, no or unsure and a passage; only yes is stored. A proposed story is shown as
proposed, with its proposer, and the person can dismiss it.

### 10.3 Reply sets

As the proposal describes. The engine adds two rules: the recipient of each reply is set by the
engine from the source message and cannot be set by the caller; and `mail-replyset-send` is a
person's command whose preview lists every recipient and marks every reply whose text differs
from the shared text.

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
| `mail-status` | B | Read | cli, mcp | Sync state per mailbox ([5.7](#57-what-synced-means)), bursts, recent blocks, sends of unknown outcome. Step B5: and the server's work ([3.2](#32-modes)) |
| `mail-account-list` | B | Read | cli, mcp | |
| `mail-account-add`, `mail-account-remove` | B | Local; a person; removing is destructive | cli | Removing an account deletes its mail from the store, not from the provider, and its preview says so. Adding is step B3's; removing is step B5's ([3.5](#35-commands-only-a-person-may-run)) |
| `mail-token-create`, `mail-token-revoke` | B | Local; a person; revoking is destructive | cli | The new token is shown once. Its result is removed from the journal ([13.1](#131-the-journal)). Step B5: creating asks for approval and refuses a name another token has; revoking an id that is not there is `TOKEN_NOT_FOUND` |
| `mail-token-list` | B | Read | cli | Each token's id, name and when it was made; never the token, which the store does not have. A read, so no approval (step B5) |
| `mail-sync` | B | Local | cli, mcp | Returns counts only ([5.7](#57-what-synced-means)). On a server it asks for a pass and returns at once (step B5) |
| `mail-thread-list`, `mail-thread-open`, `mail-message-open` | B | Read | cli, mcp | An output budget on each; lists are paged by cursor. Step B4: `mail-thread-list` takes a mailbox's id and gives its threads newest first; `mail-thread-open` a thread's messages oldest first, with each message's evidence; `mail-message-open` fetches a message's body when it is not held, whole when it is 1 MiB or less and in parts when it is larger (M20), trying each mailbox that shows it, and gives its recipients, evidence, links, files and a window of its visible text, with where the next window starts. The window is fitted to the budget as the budget measures the result; when even a small window does not fit, the HTML, then the hidden text, then half the links are left out and named in `leftOut`, and past that the call fails rather than give an empty window. A person at a terminal gets each command's largest budget |
| `mail-attachment-open` | B | Read | cli, mcp | Fetches the attachment if it is not held. Returns a path in the data directory to the command line, and bytes within the budget over MCP. Step B4 opens a file of a message held whole, fetching the message first, and a file of a message held in parts, fetching that part alone when it is not held, up to 256 MiB; its bytes are then decoded on their own (a part of a forwarded message held whole is read from that message), its type read from them and the message derived again. The file at the command line is named by the engine (the part's place, and an ending for what its bytes show), never by the message; over MCP the bytes are base64 inside the content part, a window at a time from `from`, with where the next starts |
| `mail-search` | B | Read | cli, mcp | Step B4: the best matches first, paged by cursor up to the first 1 000 |
| `mail-rebuild` | B | Local | cli | Under `serve` it runs in the server and reports through `mail-status` (step B5) |
| `mail-sender-list`, `mail-sender-show` | C | Read | cli, mcp | |
| `mail-sender-screen` | C | Local, undoable; a person | cli | No approval prompt ([7.3](#73-the-persons-decisions)) |
| `mail-sender-suggest` | C | Local | cli, mcp | Changes no class |
| `mail-sender-accept` | C | Local, undoable; a person | cli | Accepts an agent's suggestion (M28) |
| `mail-sender-dismiss` | C | Local | cli, mcp | The person's or the proposer's |
| `mail-story-list`, `mail-story-open`, `mail-story-changes` | C | Read | cli, mcp | |
| `mail-selection-create` | D | Local | cli, mcp | |
| `mail-archive`, `mail-label`, `mail-mark`, `mail-trash` | D | Remote, undoable | cli, mcp | Under the policy; over a limit, a proposal ([9.4](#94-the-policy)) |
| `mail-operation-approve` | D | Remote, undoable; a person | cli | Runs an agent's proposal (M28) |
| `mail-operation-dismiss` | D | Local | cli, mcp | The person's or the proposer's |
| `mail-operation-list`, `mail-operation-show` | D | Read | cli, mcp | |
| `mail-operation-undo`, `mail-operation-resume`, `mail-operation-cancel` | D | Remote, undoable | cli, mcp | Under the policy, as the operation's own command |
| `mail-thread-snooze` | D | Local, undoable | cli, mcp | |
| `mail-draft-create`, `mail-draft-update` | D | Local | cli, mcp | |
| `mail-draft-discard`, `mail-draft-restore` | D | Local, undoable | cli, mcp | A discarded draft is held for 30 days (M29) |
| `mail-draft-list`, `mail-draft-show` | D | Read | cli, mcp | `mail-draft-show` is the preview of a send |
| `mail-draft-send` | D | Remote, destructive; a person | cli | |
| `mail-unsubscribe` | D | Remote, destructive; a person | cli | |
| `mail-policy-show` | D | Read | cli, mcp | |
| `mail-policy-set` | D | Local; a person | cli | |
| `mail-record-list` | E | Read | cli, mcp | |
| `mail-record-propose`, `mail-record-withdraw` | E | Local | cli, mcp | |
| `mail-story-propose`, `mail-story-dismiss` | E | Local | cli, mcp | Dismissing is the person's or the proposer's |
| `mail-replyset-create`, `mail-replyset-next` | E | Local | cli, mcp | |
| `mail-replyset-show` | E | Read | cli, mcp | |
| `mail-replyset-send` | E | Remote, destructive; a person | cli | |

Differences from the proposal's draft list:

- `mail-thread-archive`, `-label`, `-mark` and `-trash` lose `thread` from their names because
  they take a selection.
- `mail-sender-screen` becomes a person's command, and `mail-sender-suggest` is added for
  agents.
- `mail-sender-accept`, `mail-sender-dismiss`, `mail-operation-approve` and
  `mail-operation-dismiss` carry the owner's rule that an agent proposes and a person approves.
- Added: `mail-token-*`, `mail-selection-create`, `mail-operation-*`, `mail-policy-*`,
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
| `ACCOUNT_NOT_FOUND`, `MAILBOX_NOT_FOUND`, `MESSAGE_NOT_FOUND`, `THREAD_NOT_FOUND` | A named thing does not exist |
| `SIGN_IN_REQUIRED` | The provider refused the stored credential |
| `PROVIDER_UNAVAILABLE` | The provider could not be reached; retryable |
| `PROVIDER_LIMIT` | The provider's rate or quota limit; retryable after the time given |
| `NOT_HELD` | The bytes asked for are not in the log and could not be fetched now |
| `PART_NOT_FOUND` | A message has no part at the place named |
| `WORK_RUNNING` | `mail-account-remove` on a server while a pass or a rebuild runs; retryable |
| `REPLY_TOO_LARGE` | A reply larger than a call to a running server may return ([3.2](#32-modes)) |
| `ONE_COMMAND_PER_CALL` | `afd-batch` or `afd-pipe` called on a server ([3.2](#32-modes)) |
| `TOKEN_NOT_FOUND` | No agent's token has the id named |
| `PERSON_REQUIRED` | A person's command with no terminal |
| `POLICY_LIMIT` | More proposals or suggestions waiting than the policy allows this caller |
| `PROPOSAL_NOT_OPEN` | The proposal or suggestion named was already approved, dismissed or expired |
| `SELECTION_MISMATCH` | The count stated is not the selection's count, or the selection has expired |
| `RECIPIENT_NOT_ALLOWED` | A recipient the rule does not allow |
| `SEND_OUTCOME_UNKNOWN` | The send may or may not have gone |
| `UNDO_NOT_POSSIBLE` | The provider no longer holds what an undo needs |
| `PASSAGE_NOT_FOUND` | A proposed record's passage is not in the message |

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
  and it means the journal must never be shared or uploaded as a log.
- **It does not hold what was read.** Read commands are left out by the recorder's filter, so
  opening and searching mail copies nothing into it.
- **It holds no secret.** No command takes one. `mail-token-create` returns one, and the
  recorder's redaction removes that entry's result and its tape of random values before it is
  stored. The token is drawn from the operating system's random source, not from the command
  context's, so the tape could not rebuild it in any case.
- **It records refusals without content.** Failures are recorded, approval holds among them;
  an approval's summary holds no content ([3.5](#35-commands-only-a-person-may-run)).
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
- A scripted Gmail API with a history that expires.
- A corpus of messages: ordinary mail, malformed mail, hidden-text cases, and the parser's fuzz
  findings. It holds no real person's mail.

**Per phase.** Each row's tests run in the workflow against the doubles. Each phase also has an
acceptance run on the owner's accounts, recorded in the status file as counts.

| Phase | Exit | Tests that must pass |
| --- | --- | --- |
| B | The owner's iCloud and Gmail accounts synced; mail read and searched from the command line and by an agent over MCP; the large mailbox reaches "synced" with its unreturned messages counted; the limits of [4.4](#44-limits-to-meet) met | Sync resumes after a stop at every batch boundary; a read never sends a command that can change a mailbox; unreturned messages follow [5.4](#54-messages-listed-and-not-returned); a header-only mailbox reaches "synced"; a rebuild reproduces every derived table; a request with no token, a wrong `Host` or a browser `Origin` is refused on both routes, `tools/list` included, and each token is refused on the other's route; a person's command is not listed or callable over MCP; no content outside a labelled part in any result, failure or journal entry of a refusal; a new token is not in the journal; the fuzz targets run clean for the time the workflow gives them |
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
| C1 | Senders, and the report on Q2 and the two groupings ([6.3](#63-the-template-fingerprint)) |
| C2 | Screening classes, the person's decisions and agents' suggestions, stream stories |
| C3 | Bursts, tried on the period the owner names |
| D1 | Selections, the policy, proposals and their approval, operations and undo, on the doubles |
| D2 | The four remote commands on iCloud and Gmail |
| D3 | Drafts, send and unsubscribe at the terminal |
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

Still needed from the owner: an OAuth client created in Google's console for step B0, and the
account and period of the flood for step C3. Loam's L8 comes as step B1's pull request.

## 17. Out of scope

Beside the proposal's [section 12](../../../../../docs/features/active/mail/mail.proposal.md#12-out-of-scope):

- A hosted engine and the OAuth resource-server mode.
- Extractors ([10.4](#104-extractors-deferred)).
- Syncing drafts with the provider.
- Encryption of the engine's own (M21).
- Task support on any command, until Loam has a surface for tasks (L3).
- Windows and Linux are not excluded, and nothing here is specific to macOS but the path named
  in [3.1](#31-the-data-directory); they are not tested until someone needs them.
