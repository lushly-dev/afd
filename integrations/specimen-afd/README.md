# Specimen AFD integration

**Preview,** like [Specimen](../../foundations/specimen/README.md): the commands can still change. Install it with Specimen and its AFD peers: `npm install @lushly-dev/specimen@preview @lushly-dev/specimen-afd@preview @lushly-dev/afd-core @lushly-dev/afd-server`.

`@lushly-dev/specimen-afd` adapts native Specimen operations to validated AFD definitions and CommandResult envelopes, including `specimen-list`, `specimen-validate`, `specimen-inspect`, `specimen-render`, `specimen-capture`, `specimen-compare`, `specimen-review`, `specimen-run`, `specimen-a11y`, `specimen-themes`, `specimen-migrate`, `specimen-diff`, `specimen-build`, `specimen-pack`, `specimen-pack-check`, `specimen-pack-export`, `specimen-point`, `specimen-point-move`, `specimen-point-check`, `specimen-note-add`, `specimen-note-list`, `specimen-note-check`, `specimen-note-move`, `specimen-note-resolve`, `specimen-note-reopen`, `specimen-job-create`, `specimen-job-run`, `decision-record`, `decision-get`, `decision-list` and `decision-check`. It supports Specimen `^2.2.0-preview`, its preview and the stable releases after it, and AFD core and AFD server `^2.2.0`; incompatible or missing peers must be resolved before using this integration.

```ts
import { createSpecimenBench } from '@lushly-dev/specimen';
import { createSpecimenCommands } from '@lushly-dev/specimen-afd';
const bench = await createSpecimenBench({ root: process.cwd() });
const commands = createSpecimenCommands(bench);
// Pass commands to an AFD MCP host. Its owner must await bench.close().
```

Exports: `createSpecimenCommands`, `executeSpecimenCommand`, `executeSpecimenDiff`, `ExecuteSpecimenCommandOptions`, `SpecimenCommandBench`, and native `buildOutputSchema`, `contextSchema`, `observationSchema`, `storyRunSchema`, `inspectResultSchema`, `themesRunSchema`, `pointSchema`, `pointResultSchema`, `pointCheckResultSchema`, `noteSchema`, `noteResultSchema`, `noteListResultSchema`, `noteCheckResultSchema`, `noteResolveResultSchema`. `specimen-themes` returns `data.valid: false` when an entry's frame stays the same in every theme and nothing declares it; gate on that. Importing the native foundation alone never imports this adapter. See [the unreleased transition](../../docs/features/complete/platform-monorepo/specimen-transition.md).
