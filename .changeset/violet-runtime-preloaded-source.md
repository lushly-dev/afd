---
'@lushly-dev/violet-runtime': minor
---

`VioletRuntime` applies a preloaded source with no token server: pass `source: { tokens }` in place of `apiUrl`, and `load()` applies those tokens without a request or the cache. `switchNode(nodeId, source)` takes the new node's tokens, and a `ThemeManager` theme may carry its own `source`, which the manager passes on. A token needs only `id` and `value`; `resolvedAt` defaults to the node. A source with `apiUrl` or `apiKey`, a malformed source, and a source given to an HTTP runtime are refused. `VioletConfig` is now the union of the new `VioletHttpConfig` and `VioletSourceConfig` types, so an interface that extended it extends `VioletHttpConfig` instead.

`ThemeManager.useSystemPreference(light, dark, highContrast)` takes an optional high-contrast theme, chosen whenever `(prefers-contrast: more)` or `(forced-colors: active)` matches, and follows changes to every query until unsubscribed.
