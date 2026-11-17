---
'@lushly-dev/violet-afd': minor
'@lushly-dev/violet-server': minor
'@lushly-dev/violet-cli': patch
---

Deprecate `compare.nodes` in favour of `tokens.compare` (#500), which compares two to four nodes and also counts absent and subtracted tokens; `violet compare` already runs it. `compare.nodes` will be removed in `@lushly-dev/violet-afd` 0.5.0. Until then it still works: its description starts with "Deprecated", a successful result carries a `DEPRECATED_COMMAND` warning, a `deprecated` metadata flag and a note in `reasoning`, and the HTTP API answers it with `Deprecation: true` and a `Link: </api/v1/tokens/compare>; rel="successor-version"` header, and lists it with `deprecated: true` in `GET /api/commands`. `CommandDefinition` gains an optional `deprecated` field (`{ replacement, removal }`) for other commands to use. The hosted OpenAPI document never described `compare.nodes`, so it has nothing to mark.
