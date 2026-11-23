---
"@lushly-dev/violet-core": minor
"@lushly-dev/violet-afd": minor
"@lushly-dev/violet-server": minor
---

Implement Scales Phase 1 (two-stage ramps, governed off-ramp exceptions, and Slice 1 scenarios, [#2195](https://github.com/lushly-dev/afd/issues/2195), epic [#1111](https://github.com/lushly-dev/afd/issues/1111)):

- **`@lushly-dev/violet-core`:** Expose `reason?: string` on `ResolvedToken` with exact propagation across `add`, `override` (clearing any prior ancestor reason when omitted/blank), `reset`, `copy`, and `include`; add `type: 'ramp'` (`RampConfigSchema`) and `pattern.target?: 'value' | 'id'` to `ConstraintConfigSchema`; add multi-violation registry evaluation (`validateValues` / `validateConstraintForToken`) with optional stable sub-check `code` (`ramp:broken-ref`, `ramp:wrong-family`, `ramp:unreasoned`, `ramp:pair`, `ramp:repeat`) and preserved advisory `'warning'` severity; persist optional `code` on `CheckIssueSchema`; export `validateConstraints(db, nodeId, options?)` and add `excludePrefixes?: string[]` to `resolveTokens` and `exportTokens`.
- **`@lushly-dev/violet-afd`:** Extend `constraints.set` (handler-level validation for `ramp` and `repeatThreshold >= 2` with field-specific suggestions), `constraints.validate` (core `validateConstraints` delegation and `onlyViolating`), `analyze.violations` (core delegation and violation `code`), `analyze.snapshot` (`code` + `severity` in `issueKey`), `tokens.resolve` (`reason` output and `excludePrefixes`), `export` (`excludePrefixes`), `interface.check` (`privatePrefixes` default `['ref.']` and sorted/deduped `leaked` reporting), `changes.impact` (`reason` on `add`/`override`, reason-only `diffViolations` including `reset`, `code`+`severity` violation keying), and `import.json`/`import.tree` (`reason: null` default unless `$extensions['dev.lushly.violet'].reason` is set on DTCG or Style Dictionary leaves). Add the `app: 'violet'` JTBD scenario fixture adapter and run Slice 1 scenarios 01–07 in Vitest.
- **`@lushly-dev/violet-server`:** Document `type: 'ramp'`, `merge: true`, `excludePrefixes: ['ref.']`, and `analyze.violations` in MCP server instructions.
