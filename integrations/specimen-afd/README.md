# Specimen AFD integration

**Preview,** like [Specimen](../../foundations/specimen/README.md): the commands can still change. It is admitted for the npm `preview` prerelease, with Specimen.

`@lushly-dev/specimen-afd` adapts native Specimen operations to validated AFD definitions and CommandResult envelopes: `specimen-list`, `specimen-validate`, `specimen-inspect`, `specimen-render`, `specimen-run`, `specimen-migrate`, `specimen-diff` and `specimen-build`. It supports Specimen `^2.2.0-preview`, its preview and the stable releases after it, and AFD core and AFD server `^2.2.0`; incompatible or missing peers must be resolved before using this integration.

```ts
import { createSpecimenBench } from '@lushly-dev/specimen';
import { createSpecimenCommands } from '@lushly-dev/specimen-afd';
const bench = await createSpecimenBench({ root: process.cwd() });
const commands = createSpecimenCommands(bench);
// Pass commands to an AFD MCP host. Its owner must await bench.close().
```

Exports: `createSpecimenCommands`, `executeSpecimenCommand`, `executeSpecimenDiff`, `SpecimenCommandBench`, and native `buildOutputSchema`, `contextSchema`, `observationSchema`, `storyRunSchema`, `inspectResultSchema`. Importing the native foundation alone never imports this adapter. See [the unreleased transition](../../docs/features/active/platform-monorepo/specimen-transition.md).
