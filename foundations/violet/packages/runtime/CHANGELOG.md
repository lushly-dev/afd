# @lushly-dev/violet-runtime

## 0.3.0-preview.6

### Minor Changes

- [#2358](https://github.com/lushly-dev/afd/pull/2358) [`b79c7e3`](https://github.com/lushly-dev/afd/commit/b79c7e308bfe7e2ad19836a884f9ceb8734a2a85) Thanks [@Falkicon](https://github.com/Falkicon)! - `VioletRuntime.adopt(target?, { preset? })` adopts one constructed stylesheet holding the loaded tokens into a document or shadow root, with `@lushly-dev/violet-elements`' theme selectors (`:root` and `[data-violet-theme-root]`, narrowed to `[data-violet-theme="<preset>"]` when a preset is given), and rewrites it on every `load()` and `switchNode()` ([#1786](https://github.com/lushly-dev/afd/issues/1786)). It writes no inline style, so a page whose Content Security Policy forbids inline styles needs no exception; `unadopt(target?)` removes it. Once `adopt()` is called, `autoApply` no longer writes inline properties and those it already wrote are removed; `removeFromDocument()` now undoes only the inline properties this runtime wrote that still hold its value, restoring the value the page had before the first write; a property the page changed since is left as it is. `adopt()` throws a `TypeError` for a target that is neither a document nor a shadow root, and for a document with no window (one from `createHTMLDocument` or `DOMParser`, or a removed iframe's); a refused call changes nothing. A sheet that can no longer be rewritten is reported with `console.error` and dropped, and the others are still rewritten.

  Adopted sheets come after a document's or shadow root's own `<style>` and `<link>` sheets, and `adopt()` appends after the sheets already adopted there: a page's own adopted override sheet must be adopted after it, or use more specific selectors, and in a shadow root a host's `<style>` that overrides a token on a `[data-violet-theme-root]` child with equal specificity loses to it. A token set on `body` is overridden again inside a descendant `[data-violet-theme-root]`. The returned sheet belongs to the runtime: each load and switch rewrites it, so an edit made to it lasts until then, and a repeated `adopt()` does not undo it.

  `applyToDocument()`, `removeFromDocument()` and the `autoApply` option are deprecated in favour of `adopt()` and will be removed in a later release; `autoApply` still defaults to `true` until then.

## 0.3.0-preview.5

No changes in this release.

## 0.3.0-preview.4

No changes in this release.

## 0.3.0-preview.3

No changes in this release.

## 0.3.0-preview.2

No changes in this release.

## 0.3.0-preview.1

No changes in this release.

## 0.3.0-preview.0

### Minor Changes

- [#627](https://github.com/lushly-dev/afd/pull/627) [`6598666`](https://github.com/lushly-dev/afd/commit/6598666b58ec82a6226468ddd9db967fb85cd29b) Thanks [@Falkicon](https://github.com/Falkicon)! - `VioletRuntime` applies a preloaded source with no token server: pass `source: { tokens }` in place of `apiUrl`, and `load()` applies those tokens without a request or the cache. `switchNode(nodeId, source)` takes the new node's tokens, and a `ThemeManager` theme may carry its own `source`, which the manager passes on. A token needs only `id` and `value`; `resolvedAt` defaults to the node. A source with `apiUrl` or `apiKey`, a malformed source, and a source given to an HTTP runtime are refused. `VioletConfig` is now the union of the new `VioletHttpConfig` and `VioletSourceConfig` types, so an interface that extended it extends `VioletHttpConfig` instead.

  `ThemeManager.useSystemPreference(light, dark, highContrast)` takes an optional high-contrast theme, chosen whenever `(prefers-contrast: more)` or `(forced-colors: active)` matches, and follows changes to every query until unsubscribed.

- [#488](https://github.com/lushly-dev/afd/pull/488) [`0a35249`](https://github.com/lushly-dev/afd/commit/0a352499b6f7417ab6a9a0a9493686b49a013776) Thanks [@Falkicon](https://github.com/Falkicon)! - First release from the AFD monorepo, with Violet split into foundations, an integration and endpoints. `@lushly-dev/violet-core` is now the native token engine and no longer contains AFD commands; they moved to the new `@lushly-dev/violet-afd`, which depends on `@lushly-dev/afd-core` 2.x. The CLI and server depend on `@lushly-dev/violet-afd`. Command, registry and `CommandResult` users add `@lushly-dev/violet-afd` and import from it instead of `@lushly-dev/violet-core`, keeping the same subpath. Its re-exported `isSuccess` and `isFailure` follow afd-core 2.x and check `success` alone. `violet --version`, the server version `violet mcp start` reports, the MCP server's default version and `system.doctor`'s `packageVersion` now report the installed package version instead of `0.1.0`. See docs/features/complete/platform-monorepo/violet-transition.md.

## 0.2.0

### Minor Changes

- [#106](https://github.com/lushly-dev/violet/pull/106) [`6c6cf14`](https://github.com/lushly-dev/violet/commit/6c6cf1420247f0b058535bfb4bae745a0050ef27) Thanks [@Falkicon](https://github.com/Falkicon)! - `VioletRuntime` no longer defaults `apiUrl` to the `api.violet.design` placeholder, which is not a Violet deployment. Passing `apiKey` without `apiUrl` now throws, so a key is only ever sent to a URL you chose. Without a key, `apiUrl` defaults to the page's own origin.

### Patch Changes

- [#64](https://github.com/lushly-dev/violet/pull/64) [`ee58bfa`](https://github.com/lushly-dev/violet/commit/ee58bfa5d22dac99ed8f7f2284d81f81a840ca02) Thanks [@Falkicon](https://github.com/Falkicon)! - Relicense under MIT and publish publicly to npm. Each package now ships a README and full npm metadata (repository, homepage, bugs, keywords, engines).
