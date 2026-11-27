# Loam Mail

Mail as a Loam plugin with an engine of its own: a Rust program that holds a person's mail on
their machine and serves it as AFD commands, and `mailapp`, the native app over it, so far its
first slice: [replying to a thread](#the-mail-app).

- [The engine's specification](docs/engine.spec.md): what is being built, and in what steps.
- [The plugin's specification](docs/plugin.spec.md): mounting in Loam, approvals, taint per account and the native app.
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
JSON: `loam-mail <command> [input]`. It implements phases B through E and steps F0, F1, F2a, F2b,
F3, F4 and F5: accounts, tokens (agent and approver), sync, threads/messages/attachments/search, senders
and screening, stream/burst/proposed stories, selections, per-account policies, undoable mailbox
changes and proposals, drafts, SMTP send, unsubscribe, grounded records, reply sets, and the Loam
mount package. Whatever came from mail, a file's bytes included, sits in a part of a result
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
  with its kinds and exceptions (section 8), and `bursts.rs` the bursts: a day's flood of
  messages from many senders new to the person, each one flagged story (7.4).
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

## Mounting in Loam (by hand, until Loam's step 9)

`mount/` holds the Loam mount package (`mount/loam-app.toml`, `kind = "mounted"`, `plugin.id = "mail"`,
`mount = { prefix = "mail", transport = "http" }`) with `[[mount.tools]]` effects matching the
engine's MCP-exposed commands. See [the plugin specification](docs/plugin.spec.md#12-mounting-by-hand-until-loams-step-9)
for the full contract.

1. Start the engine on a fixed port:

   ```sh
   loam-mail serve --port 7461
   ```

2. At the engine's terminal on macOS, mint an approver token for Loam and approve the hold
   (`--out` is refused on Windows):

   ```sh
   loam-mail mail-token-create '{"name":"Loam","role":"approver"}' --out <token-file>
   ```

3. Pack the mount package into a directory containing `app-manifest.json`:

   ```sh
   loam app check endpoints/loam/plugins/mail/mount
   loam app pack endpoints/loam/plugins/mail/mount --out <packed-dir>
   ```

4. Add the mounted instance in a version-4 `loam.deployment.toml` (with `[host] kind = "desktop"`),
   naming the packed mount directory, bearer file, `labels = "per-part"`, `approvals = "shell"`,
   all four released MCP commands' previews (`mail-operation-approve`, `mail-draft-send`,
   `mail-unsubscribe`, and `mail-replyset-send`), `mail-replyset-submit` for fresh-context units,
   and every other command another app may call, the mail app's among them (`expose.apps` is set
   per command):

   ```toml
   deployment_version = 4

   [host]
   kind = "desktop"

   [apps.mail]
   app = "mail"
   package = "<packed-dir>"
   prefix = "mail"
   audience = "person"
   transport = "http"
   url = "http://127.0.0.1:7461/mcp"
   bearer_file = "<token-file>"
   labels = "per-part"
   approvals = "shell"
   expose = { agent = true, palette = true }

   [apps.mail.commands."mail-operation-approve"]
   expose = { agent = true, apps = true }
   preview = { command = "mail-operation-show", input = ["operation", "digest"] }

   [apps.mail.commands."mail-draft-send"]
   expose = { agent = true, apps = true }
   preview = { command = "mail-draft-show", input = ["draft", "revision"] }

   [apps.mail.commands."mail-unsubscribe"]
   expose = { agent = true, apps = true }
   preview = { command = "mail-unsubscribe-show", input = ["message", "digest"] }

   [apps.mail.commands."mail-replyset-send"]
   expose = { agent = true, apps = true }
   preview = { command = "mail-replyset-preview", input = ["replyset", "revision"] }

   [apps.mail.commands."mail-replyset-submit"]
   expose = { agent = true }

   # What the mail app calls: `expose.apps` is set per command, never on the instance.
   [apps.mail.commands."mail-thread-open"]
   expose = { agent = true, palette = true, apps = true }

   [apps.mail.commands."mail-draft-show"]
   expose = { agent = true, palette = true, apps = true }

   [apps.mail.commands."mail-draft-create"]
   expose = { agent = true, palette = true, apps = true }

   [apps.mail.commands."mail-draft-update"]
   expose = { agent = true, palette = true, apps = true }
   ```

5. Validate and write the desktop deployment:

   ```sh
   loam deployment check loam.deployment.toml
   loam deployment write --config loam.deployment.toml --host desktop --dist <bundled dist> --out <app data>/site --mounts-out <app data>/mounts.json
   ```

   `mounts.json` holds the copied bearer and must remain private to the person.

Loam's desktop suite mounts the engine with this entry on every Linux run (`test/mail.test.ts`, P5-A9),
against a test build seeded by `loam-mail test-world --seed loam-desktop`, with the mail app beside it.

## The mail app

`app/` is `mailapp`, titled Mail, a native Loam app ([the plugin's specification](docs/plugin.spec.md#13-the-native-app)).
So far it is the send slice of section 13.1: it opens a thread by id (its route, `thread/<id>`, or
a field), writes a reply to the thread's newest message as a draft, and sends it. Send asks in Loam's
slot with the draft as `mail-draft-show` shows it; if the draft changed since, it shows the draft
again and sends nothing. It holds no mail and has no commands of its own: its `calls` grant names
the mounted instance `mail`'s `mail-thread-open`, `mail-draft-create`, `mail-draft-update`,
`mail-draft-show` and `mail-draft-send`, which the instance's entry must expose to apps (step 4).

```sh
pnpm -F "@lushly-dev/loam-app-mail..." -F "!@lushly-dev/loam-host" build
pnpm -F @lushly-dev/loam-app-mail test
pnpm -F @lushly-dev/loam-app-mail run pack   # to dist/package
```

Add it beside the instance, in the same `loam.deployment.toml`:

```toml
[apps.mailapp]
app = "mailapp"
package = "<endpoints/loam/plugins/mail/app/dist/package>"
```
