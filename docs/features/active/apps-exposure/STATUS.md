# Apps exposure: status

| Field | Value |
| --- | --- |
| Proposal | [apps-exposure.proposal.md](./apps-exposure.proposal.md) |
| Spec | [`spec/command-metadata.md`](../../../../spec/command-metadata.md#app-to-app-calls), "App-to-app calls"; [`spec/error-codes.md`](../../../../spec/error-codes.md) (`CALL_NOT_GRANTED`); [`spec/plugin-manifest.md`](../../../../spec/plugin-manifest.md#k5-exposure), K5, and [`spec/plugin-manifest.core.v2.json`](../../../../spec/plugin-manifest.core.v2.json) |
| Origin | Loam phase 5, step 0b ([specification](../../../../endpoints/loam/docs/phases/5-copilot/spec.md), 7.5, 9 and 13; D30); [#884](https://github.com/lushly-dev/afd/issues/884) |
| Last verified | 2026-11-18, against `main` at `8f58c33e` plus this change |

## Done

- **Spec, TypeScript and Rust,** in step 0b's pull request: the `expose` row and "App-to-app calls" in `spec/command-metadata.md`; `CALL_NOT_GRANTED` in the shared catalog (49 codes) and D4's `apps` row; core version 2 of the plugin manifest, which `scripts/plugin-manifest.test.mjs` holds to version 1 plus `expose.apps`; `ExposeOptions.apps`, `createCommandRegistry({ callGrant })` and `createAppCallRegistry` in `@lushly-dev/afd-core` and `@lushly-dev/afd-server` (its own module, so `/direct` grows 19 bytes and Loam's first paint the same); `ExposeOptions::apps`, `CommandInterface::Apps` and `CommandRegistry::set_call_grant` in the `afd` crate.
- **Vectors:** [`spec/vectors/app-calls.json`](../../../../spec/vectors/app-calls.json), 6 exposure, 17 call and 2 batch cases. TypeScript runs them on the core registry and on `createAppCallRegistry`, Rust on `CommandRegistry`; Python and C++ load the file and skip every case as the documented gap.
- **The `CALL_NOT_GRANTED` constant** in all four languages.

## Not done

- **Python and C++ parity:** [#1513](https://github.com/lushly-dev/afd/issues/1513). Closing it removes the language from the vector file's `gaps`. Until then `apps` names no surface there, so a call naming it is `COMMAND_NOT_FOUND` or `COMMAND_NOT_EXPOSED`, and their journal replay refuses an `apps` entry.
- **Loam's part:** the `calls` grant in Loam's manifest, its port's use of `createAppCallRegistry`, the journal's `call-refused` event, and its profile's move to core version 2. Loam phase 5, milestone B, step 10. Step 10 also has to attribute an app's call: `late/documents.ts` and `late/project-summary.ts` read any interface but `agent` as the palette, which is unreachable today only because `SHELL_EXPOSE.apps` is off.
