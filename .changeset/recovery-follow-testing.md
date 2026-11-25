---
"@lushly-dev/afd-testing": minor
"@lushly-dev/afd-core": minor
---

Scenarios can check a refusal's structured recovery (`spec/recovery.md`). `expect.error.recovery` asserts its fields like `data`, and `follow` on a refused step takes the step the recovery describes (`call`, with `thenRetry` repeating the refused call; `fix-input`; `retry`) and fails unless it gets further: a followed call that comes back with the same refusal fails whatever the scenario expects, and a recovery with nothing a program can follow fails too. Each follow call's result is on the step result's `follow`. `follow.input` gives only the fields the recovery `needs`, so a scenario cannot correct a wrong recovery, and it takes step references; a recovery that names a field in both `input` and `needs` fails the step, and `expect.error.recovery` fails on a recovery no reader keeps. `validateScenario` checks `follow` in scenarios built in code, and `FollowExpectation` is exported. `@lushly-dev/afd-core/errors` is a new browser-safe entry for `CommandError`, `Recovery`, `isCommandRecovery` and the error helpers.
