# Specimen AFD integration

`@lushly-dev/specimen-afd` adapts native Specimen operations to validated AFD definitions and CommandResult envelopes: `specimen-list`, `specimen-validate`, `specimen-render`, `specimen-run`, `specimen-diff` and `specimen-build`. It supports Specimen, AFD core and AFD server versions `^2.2.0`; incompatible or missing peers must be resolved before using this integration.

```ts
import { createSpecimenBench } from '@lushly-dev/specimen';
import { createSpecimenCommands } from '@lushly-dev/specimen-afd';
const bench = await createSpecimenBench({ root: process.cwd() });
const commands = createSpecimenCommands(bench);
// Pass commands to an AFD MCP host. Its owner must await bench.close().
```

Exports: `createSpecimenCommands`, `executeSpecimenCommand`, `executeSpecimenDiff`, `SpecimenCommandBench`, and native `buildOutputSchema`, `contextSchema`, `observationSchema`, `storyRunSchema`. Importing the native foundation alone never imports this adapter. See [the unreleased transition](../../docs/features/active/platform-monorepo/specimen-transition.md). Publication remains quarantined.
