# P15's relay part, the pending list

- Date: 2026-11-26
- Area: the ideas plugin and its host records
- Pull request: [#2759](https://github.com/lushly-dev/afd/pull/2759), on `lush/approval-relay-pending-list`, for [#2010](https://github.com/lushly-dev/afd/issues/2010) ([D219](../decisions.md))

AFD's Rust `HumanRelay::pending_list` (spec first) and Umbel's `person.pending_list`, off by
default: a client without URL-mode elicitation is refused with `CONFIRMATION_REQUIRED`,
`details.reason` `pending-list`, the decision and the list, and the same call runs once after the
person approves on the page. The decision and list pages show the decision's id. Decisions the
relay begins keep a MAC of the principal binding (person store schema 3, migrated in place after
copy-before-migration; a host before it refuses the migrated store).

Verified 2026-11-26 and 2026-11-27: `server_human_relay.rs` (30 tests), Umbel's
`plugins/ideas/tests/it/hosted.rs` (10, five of them new), the `config_v7`, `person_pending` and
`person_local` integration tests (39) and the person store, relay and configuration unit tests
(45), plus full `pnpm verify` (with #2819 filed for the local Loam browser capture flake).
TypeScript and Python parity: [#2722](https://github.com/lushly-dev/afd/issues/2722),
[#2723](https://github.com/lushly-dev/afd/issues/2723).
