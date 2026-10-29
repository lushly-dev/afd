---
id: path-exports
title: Path Exports
layout: 3x
eleventyNavigation:
  key: path-exports3x
  parent: advanced3x
  title: Path Exports
navigationOptions:
  activeKey: path-exports3x
description: Package path exports for @lushly-dev/fast-element.
keywords:
  - exports
  - path exports
  - package exports
---

# Path Exports

`@lushly-dev/fast-element` exposes its implementation APIs from the root export.
Path exports are also available when you want to import a focused entrypoint
directly. Declarative, hydration, context, and dependency injection APIs are
path-only and should be imported from their listed paths.

This table is generated from the `exports` field in
`@lushly-dev/fast-element/package.json`.

Run `pnpm --filter @lushly-dev/fast-element doc:path-exports` after changing
package exports, and use
`pnpm --filter @lushly-dev/fast-element doc:path-exports:check` to verify the
generated table is current.

| Import path | Provides | Runtime target | Types |
|---|---|---|---|
| `@lushly-dev/fast-element` | Root implementation export for FAST Element APIs. | `./dist/esm/index.js` | `./dist/dts/index.d.ts` |
| `@lushly-dev/fast-element/arrays.js` | ArrayObserver class for observing array mutations, and array observation APIs. | `./dist/esm/observation/arrays.js` | `./dist/dts/observation/arrays.d.ts` |
| `@lushly-dev/fast-element/attr.js` | Attribute decorator and attribute definition APIs. | `./dist/esm/components/attributes.js` | `./dist/dts/components/attributes.d.ts` |
| `@lushly-dev/fast-element/attribute-map.js` | Schema-driven attribute map extension. | `./dist/esm/declarative/attribute-map.js` | `./dist/dts/declarative/attribute-map.d.ts` |
| `@lushly-dev/fast-element/binding.js` | Binding directives and binding helpers. | `./dist/esm/binding/exports.js` | `./dist/dts/binding/exports.d.ts` |
| `@lushly-dev/fast-element/children.js` | children directive. | `./dist/esm/templating/children.js` | `./dist/dts/templating/children.d.ts` |
| `@lushly-dev/fast-element/command.js` | Agent-first command discovery and execution APIs. | `./dist/esm/command/index.js` | `./dist/dts/command/index.d.ts` |
| `@lushly-dev/fast-element/context.js` | Path-only context protocol APIs. | `./dist/esm/context.js` | `./dist/dts/context.d.ts` |
| `@lushly-dev/fast-element/css.js` | CSS template tag APIs. | `./dist/esm/styles/css.js` | `./dist/dts/styles/css.d.ts` |
| `@lushly-dev/fast-element/debug.js` | Debug message helpers. | `./dist/esm/debug.js` | `./dist/dts/debug.d.ts` |
| `@lushly-dev/fast-element/declarative-utilities.js` | Declarative parser and observer-map utilities. | `./dist/esm/declarative/utilities.js` | `./dist/dts/declarative/utilities.d.ts` |
| `@lushly-dev/fast-element/declarative.js` | Path-only declarative template APIs. | `./dist/esm/declarative/index.js` | `./dist/dts/declarative/index.d.ts` |
| `@lushly-dev/fast-element/definition-schema.js` | Agent-facing component Definition Schema introspection APIs. | `./dist/esm/definition-schema/index.js` | `./dist/dts/definition-schema/index.d.ts` |
| `@lushly-dev/fast-element/di.js` | Path-only dependency injection APIs. | `./dist/esm/di/di.js` | `./dist/dts/di/di.d.ts` |
| `@lushly-dev/fast-element/dom-policy.js` | Trusted Types DOM policy helpers. | `./dist/esm/dom-policy.js` | `./dist/dts/dom-policy.d.ts` |
| `@lushly-dev/fast-element/dom.js` | DOM abstraction and DOM aspect APIs. | `./dist/esm/dom.js` | `./dist/dts/dom.d.ts` |
| `@lushly-dev/fast-element/fast-element.js` | FASTElement and the customElement decorator. | `./dist/esm/components/fast-element.js` | `./dist/dts/components/fast-element.d.ts` |
| `@lushly-dev/fast-element/html.js` | HTML template tag APIs. | `./dist/esm/templating/html.js` | `./dist/dts/templating/html.d.ts` |
| `@lushly-dev/fast-element/hydration.js` | Path-only opt-in hydration APIs. | `./dist/esm/hydration/exports.js` | `./dist/dts/hydration/exports.d.ts` |
| `@lushly-dev/fast-element/notifier.js` | Notifier APIs. | `./dist/esm/observation/notifier.js` | `./dist/dts/observation/notifier.d.ts` |
| `@lushly-dev/fast-element/observable.js` | Observable decorator and Observable APIs. | `./dist/esm/observation/observable.js` | `./dist/dts/observation/observable.d.ts` |
| `@lushly-dev/fast-element/observer-map.js` | Schema-driven observer map extension. | `./dist/esm/declarative/observer-map.js` | `./dist/dts/declarative/observer-map.d.ts` |
| `@lushly-dev/fast-element/ref.js` | ref directive. | `./dist/esm/templating/ref.js` | `./dist/dts/templating/ref.d.ts` |
| `@lushly-dev/fast-element/registry.js` | FASTElement definition and registry APIs. | `./dist/esm/registry.js` | `./dist/dts/registry.d.ts` |
| `@lushly-dev/fast-element/render.js` | Render directive APIs. | `./dist/esm/render.js` | `./dist/dts/render.d.ts` |
| `@lushly-dev/fast-element/repeat.js` | repeat directive. | `./dist/esm/templating/repeat.js` | `./dist/dts/templating/repeat.d.ts` |
| `@lushly-dev/fast-element/schema.js` | Schema and schema registry APIs. | `./dist/esm/schema.js` | `./dist/dts/schema.d.ts` |
| `@lushly-dev/fast-element/scoped.js` | Scoped custom element registry detection and authoring APIs. | `./dist/esm/scoped/index.js` | `./dist/dts/scoped/index.d.ts` |
| `@lushly-dev/fast-element/signal.js` | Signal binding helper. | `./dist/esm/binding/signal.js` | `./dist/dts/binding/signal.d.ts` |
| `@lushly-dev/fast-element/slotted.js` | slotted directive. | `./dist/esm/templating/slotted.js` | `./dist/dts/templating/slotted.d.ts` |
| `@lushly-dev/fast-element/state.js` | State and watch helpers. | `./dist/esm/state/exports.js` | `./dist/dts/state/exports.d.ts` |
| `@lushly-dev/fast-element/two-way.js` | Two-way binding helper. | `./dist/esm/binding/two-way.js` | `./dist/dts/binding/two-way.d.ts` |
| `@lushly-dev/fast-element/trust.js` | Event trust-signal types and inspection APIs. | `./dist/esm/trust/index.js` | `./dist/dts/trust/index.d.ts` |
| `@lushly-dev/fast-element/updates.js` | DOM update queue APIs. | `./dist/esm/observation/update-queue.js` | `./dist/dts/observation/update-queue.d.ts` |
| `@lushly-dev/fast-element/utilities.js` | DOM and view behavior utility helpers. | `./dist/esm/utilities.js` | `./dist/dts/utilities.d.ts` |
| `@lushly-dev/fast-element/volatile.js` | Volatile observable decorator. | `./dist/esm/observation/volatile.js` | `./dist/dts/observation/volatile.d.ts` |
| `@lushly-dev/fast-element/when.js` | when directive. | `./dist/esm/templating/when.js` | `./dist/dts/templating/when.d.ts` |
| `@lushly-dev/fast-element/package.json` | Package metadata. | `./package.json` | n/a |
