# Loam Mail

Mail as a Loam plugin with an engine of its own: a Rust program that holds a person's mail on
their machine and serves it as AFD commands. The app over it comes later.

- [The engine's specification](docs/engine.spec.md): what is being built, and in what steps.
- [Status](../../../../docs/features/active/mail/STATUS.md): what is done and what is next.
- [The proposal](../../../../docs/features/active/mail/mail.proposal.md): why.

## The engine

`engine/` is the crate `loam_mail` and the program `loam-mail`. It is its own Cargo workspace
and is not part of `pnpm check`.

```sh
cd endpoints/loam/plugins/mail/engine
cargo run -- help
cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked
```

It is built a step at a time from the specification's section 15. It answers `help` and
`version` and runs a command the registry exposes to the command line, printing its result as
JSON: `loam-mail <command> [input]`. Its commands so far are `mail-account-add`,
`mail-account-list`, `mail-sync`, `mail-status`, `mail-rebuild`, and the read commands
`mail-thread-list`, `mail-thread-open`, `mail-message-open`, `mail-attachment-open`,
`mail-search`, `mail-sender-list`, `mail-sender-show` and `mail-message-list`, and screening's
`mail-sender-screen`, `mail-sender-suggest`, `mail-sender-accept` and `mail-sender-dismiss`. Whatever came from mail, a file's bytes included, sits in a part of a result
labelled `"trust": "content"`. It syncs an iCloud account over IMAP. To add one, at a terminal on macOS, with an
[app-specific password](https://support.apple.com/en-us/102654):

```sh
cargo run --release -- mail-account-add '{"provider": "icloud", "address": "<the address>"}'
cargo run --release -- mail-sync
cargo run --release -- mail-status
cargo run --release -- mail-thread-list '{"mailbox": <an id from mail-status>}'
cargo run --release -- mail-search '{"query": "invoice"}'
```

`mail-account-add` is a person's command: it says what it will do and asks, then asks for the
password without showing it, keeps it in the login keychain (service `loam-mail`), and signs in
to check it. Run from a script, it fails with `PERSON_REQUIRED`. So far it has:

- **The data directory** (`src/home.rs`): where it is, and the lock that lets one process own it.
- **The log** (`src/log.rs`): each message's bytes as the provider returned them, one compressed
  file each, named by the SHA-256 of the bytes and checked against it on every read.
- **The store** (`src/store/`): the SQLite tables. `mod.rs` holds what is not derived from the
  log: accounts, mailboxes, each message's identity, which bytes are held, and what a provider
  showed. `derived.rs` holds what is: a message's fields and parts, its thread, where each
  thread shows, and the rebuild that makes all of it again from the log. `senders.rs` holds each
  sender's history with the person, and `screening.rs` the report of the specification's 6.3.
  `classes.rs` holds each inbound message's screening class and each template's count,
  `decisions.rs` the person's decisions on senders and agents' suggestions (7.2 and 7.3), and
  `stories.rs` the stream stories: the bulk mail of each list, or each sender with no list,
  with its kinds and exceptions (section 8).
- **What code reads from a message** (`src/derive.rs`, `src/html.rs`): the sender, the subject,
  the date, the ids that join a thread, the parts and the text a person sees, with `mail-parser`
  and `html5ever`; and the evidence of the specification's section 6: hidden text, links, list
  headers, the provider's authentication results, files' real types, the template.
- **The search index** (`src/index.rs`): tantivy over each message's subject and text.
- **The provider interface** (`src/provider/`): what sync asks of a provider, in words that name
  no protocol, and its IMAP implementation, which only reads.
- **Sync** (`src/sync.rs`): a pass over an account, mailboxes taking turns, resumable after any
  stop; `src/store/sync.rs` is what it reads and records in the store.
- **The keychain** (`src/secrets.rs`): where an account's sign-in is kept.
- **The commands** (`src/commands.rs`, the read commands in `src/read.rs`, the sender
  commands in `src/senders.rs`, screening's in `src/screening.rs` and the stories' in
  `src/stories.rs`, over `src/engine.rs`); a message's body is fetched when it is opened
  (`src/fetch.rs`).

Sync is tested against a scripted IMAP server (`tests/support/imap.rs`), the test double the
specification's section 14 asks for. `tests/live.rs` runs a pass against a real iCloud account,
with the sign-in in two files, and reports counts only; it is ignored by default:

```sh
LOAM_MAIL_LIVE_ADDRESS_FILE=<file> LOAM_MAIL_LIVE_PASSWORD_FILE=<file> \
LOAM_MAIL_LIVE_DIR=<new directory> LOAM_MAIL_LIVE_OUT=<results file> \
  cargo test --release --test live -- --ignored --nocapture
```

`tests/live_screening.rs` makes steps C1's and C2's report on a copy of a synced store: it
derives every message again and counts Q2 and the stream stories each grouping would make, then
classes every message and makes every story, and times the lists, the stories and a decision on
the largest sender, counts and milliseconds only. It
refuses the data directory an engine would use (`LOAM_MAIL_HOME`'s or the platform's), since
opening a store brings its schema up to date:

```sh
LOAM_MAIL_LIVE_HOME=<a copy of the data directory> LOAM_MAIL_LIVE_OUT=<results file> \
  cargo test --release --test live_screening -- --ignored --nocapture
```

The readers of strangers' bytes are fuzzed with `cargo-fuzz` and nightly Rust, from `engine/fuzz/`,
for example `cargo +nightly fuzz run body`.

The limits of the specification's section 4.4 are measured by `tests/limits.rs` with made-up
mail. Its small run is part of the tests; the full run is ignored by default. At 500 000
messages every limit was met ([the results](docs/limits-500000-icloud.results.json)):

```sh
LOAM_MAIL_MEASURE_CENSUS=<counts file> LOAM_MAIL_MEASURE_OUT=<results file> \
  cargo test --release --test limits -- --ignored --nocapture
```

It also holds the registry's rules, checked when the engine starts
and by its tests: a destructive command always requires approval, a command with an approval
policy is exposed to the command line only, and every command's name starts with `mail-`.

The [Loam plugins workflow](../../../../.github/workflows/loam-plugins.yml) runs those three
checks when this folder, apart from `docs/`, or the `afd` crate changes.
