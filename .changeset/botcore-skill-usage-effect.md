---
"lushly-botcore": minor
---

### Added

- **`skill-usage-effect`** reports whether a loaded skill prevents the mistakes it names. A repository declares each checkable mistake in `[[skills.traps]]`: a skill, the paths a change must touch, and a regular expression over the lines a change adds or over its commit message, with `unless_paths` to exempt a change done the right way. Each merged change to those paths is judged as `skill-usage-triggers` judges it (`loaded`, `missed` or unknown, fleet cells included), and per trap the report gives each arm's `changes`, `hits` and `rate`, a `delta` once each arm has twenty judged changes, and the changes that made the mistake, with warnings when the comparison would mislead. It reads git and the usage record in a few batched calls, finds renames whatever git's settings say, runs nothing in the repository, never reports a matched line, and sees only what reached the default branch. A botcore without it refuses the `traps` key, so declare traps once every machine reading the repository has this release (#1829).
