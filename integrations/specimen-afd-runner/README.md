# `@lushly-dev/specimen-afd-runner`

Private Specimen integration that connects AFD `.scenario.yaml` job scenarios to Specimen's browser bench without coupling `foundations/specimen` to AFD or conflating this runner with `@lushly-dev/specimen-afd`'s command bindings.

## Entries

- **`@lushly-dev/specimen-afd-runner` (browser-safe):** registers the `'afd'` Specimen `CommandRunner` (dispatches application commands through a target element's `call(name, input)`) and the `'afd'` in-page `JobDriver` (runs `@lushly-dev/afd-testing/browser`'s `runScenario`, `evaluateStep`, and `applyFixture` inside the page with awaited `beforeStep` person actions, `afterStep` captures gated on step and prior-step success, and `AbortSignal` cancellation).
- **`@lushly-dev/specimen-afd-runner/job-source` (Node):** exports `afdJobSource()` (`defineJobSource`) to parse AFD `.scenario.yaml` files, load and merge sandbox-contained JSON fixtures, and validate job entries (`JOB_SCENARIO_INVALID`, `CAPTURE_STEP_UNKNOWN`, `CAPTURE_STEP_AMBIGUOUS`, `STEP_HAS_NO_DESCRIPTION`) for both `specimen-validate` and `bench.runJob()`.

## Usage

Browser plugin module (configured under `plugins` in `specimen.config.json`):

```ts
import { afdRunner } from '@lushly-dev/specimen-afd-runner';

export default afdRunner();
```

Node job source module (configured under `jobSources` in `specimen.config.json`, or passed via `createSpecimenBench({ root, jobSources: [afdJobSource()] })`):

```ts
import { afdJobSource } from '@lushly-dev/specimen-afd-runner/job-source';

export default afdJobSource();
```
