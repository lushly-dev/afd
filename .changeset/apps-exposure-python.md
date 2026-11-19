---
"afd-python": minor
---

### Added

- **`ErrorCodes.CALL_NOT_GRANTED`**, which joins the shared catalog with app-to-app calls (`spec/command-metadata.md`, "App-to-app calls"; Loam phase 5 step 0b). Python does not emit it yet: the `apps` exposure flag and the call check are [#1513](https://github.com/lushly-dev/afd/issues/1513), and `spec/vectors/app-calls.json` lists Python as a documented gap. Meanwhile `replay_journal` refuses an entry recorded with the `apps` interface (status `error`) before any handler runs, since a target such as `SimpleRegistry` ignores the interface.
