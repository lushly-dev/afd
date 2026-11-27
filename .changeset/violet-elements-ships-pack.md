---
"@lushly-dev/violet-elements": minor
---

The package carries its component pack, the briefs an agent reads before it writes markup with these components, in Specimen's exported form at `dist/pack/`, reachable as `@lushly-dev/violet-elements/pack/*`. A deployment copies `dist/pack/data` and `dist/pack/rules` beside its own `pack.toml` (for Umbel's `components` plugin, into `spaces/<space>/packs/components/library/`), with no checkout of this repository and no Specimen run. The build writes it from the committed records, stamped with the package's name and version ([#1157](https://github.com/lushly-dev/afd/issues/1157)).
