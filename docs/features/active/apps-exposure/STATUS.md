# Apps exposure: status

| Field | Value |
| --- | --- |
| Proposal | [apps-exposure.proposal.md](./apps-exposure.proposal.md) |
| Spec | [`spec/app-calls.md`](../../../../spec/app-calls.md), "App-to-app calls"; [`spec/error-codes.md`](../../../../spec/error-codes.md) (`CALL_NOT_GRANTED`); [`spec/plugin-manifest.md`](../../../../spec/plugin-manifest.md#k5-exposure), K5, and [`spec/plugin-manifest.core.v2.json`](../../../../spec/plugin-manifest.core.v2.json) |
| Origin | Loam phase 5, step 0b ([specification](../../../../endpoints/loam/docs/phases/5-copilot/spec.md), 7.5, 9 and 13; D30); [#884](https://github.com/lushly-dev/afd/issues/884) |
| Last verified | 2026-11-23, against `main` at `7613a835` plus Python and C++ parity (#1513) |

## Done

- **Spec, TypeScript and Rust,** in step 0b's pull request: the `expose` row and "App-to-app calls" in `spec/command-metadata.md`; `CALL_NOT_GRANTED` in the shared catalog (49 codes) and D4's `apps` row; core version 2 of the plugin manifest, which `scripts/plugin-manifest.test.mjs` holds to version 1 plus `expose.apps`; `ExposeOptions.apps`, `createCommandRegistry({ callGrant })` and `createAppCallRegistry` in `@lushly-dev/afd-core` and `@lushly-dev/afd-server` (its own module, so `/direct`'s smallest host grows 104 bytes, its budget raised from 39,400 to 39,500, and every export to 114,000; Loam's first paint grows about 110 bytes and its kernel about 110, within their limits); `createDirectRegistry`, `DirectClient`, `DirectTransport`, `createMcpServer`'s in-process calls and `replayJournal` refuse what they cannot check; `ExposeOptions::apps`, `CommandInterface::Apps` and `CommandRegistry::set_call_grant` in the `afd` crate.
- **Python and C++ parity ([#1513](https://github.com/lushly-dev/afd/issues/1513)):** `ExposeOptions.apps`, `call_not_granted()`, `CallGrant`, `create_command_registry(call_grant=...)`, `create_server(..., call_grant=...)`, `DirectCommandRegistry` refusing `interface='apps'`, and grant-checked `replay_journal` in Python; `ExposeOptions::apps`, `Interface::apps`, `call_not_granted()`, `CallGrant`, `CommandRegistryOptions::call_grant`, `CommandRegistry::set_call_grant`, `DirectClient` refusing `Interface::apps`, and grant-checked `replay_journal` on `CommandRegistry` in C++.
- **Vectors:** [`spec/vectors/app-calls.json`](../../../../spec/vectors/app-calls.json), 6 exposure, 17 call and 2 batch cases, with `gaps: {}`. TypeScript, Python, Rust and C++ all run and pass every case.

## Not done

- **Loam's part:** the `calls` grant in Loam's manifest, its port's use of `createAppCallRegistry`, the journal's `call-refused` event, and its profile's move to core version 2. Loam phase 5, milestone B, step 10. Step 10 also has to attribute an app's call: `late/documents.ts` and `late/project-summary.ts` read any interface but `agent` as the palette, which is unreachable today only because `SHELL_EXPOSE.apps` is off.
