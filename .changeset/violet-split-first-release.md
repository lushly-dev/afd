---
'@lushly-dev/violet-core': minor
'@lushly-dev/violet-runtime': minor
'@lushly-dev/violet-afd': minor
'@lushly-dev/violet-cli': minor
'@lushly-dev/violet-server': minor
---

First release from the AFD monorepo, with Violet split into foundations, an integration and endpoints. `@lushly-dev/violet-core` is now the native token engine and no longer contains AFD commands; they moved to the new `@lushly-dev/violet-afd`, which depends on `@lushly-dev/afd-core` 2.x. The CLI and server depend on `@lushly-dev/violet-afd`. Command, registry and `CommandResult` users add `@lushly-dev/violet-afd` and import from it instead of `@lushly-dev/violet-core`, keeping the same subpath. See docs/features/active/platform-monorepo/violet-transition.md.
