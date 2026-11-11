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
`version`, and holds no mail command yet. So far it has:

- **The data directory** (`src/home.rs`): where it is, and the lock that lets one process own it.
- **The log** (`src/log.rs`): each message's bytes as the provider returned them, one compressed
  file each, named by the SHA-256 of the bytes and checked against it on every read.
- **The store** (`src/store/`): the SQLite tables that are not derived from the log. They hold
  accounts, mailboxes, each message's identity, which bytes are held, and what a provider showed.

It also holds the registry's rules, checked when the engine starts
and by its tests: a destructive command always requires approval, a command with an approval
policy is exposed to the command line only, and every command's name starts with `mail-`.

The [Loam plugins workflow](../../../../.github/workflows/loam-plugins.yml) runs those three
checks when this folder, apart from `docs/`, or the `afd` crate changes.
