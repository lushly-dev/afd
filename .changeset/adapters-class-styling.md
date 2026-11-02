---
"@lushly-dev/afd-adapters": minor
---

Add `RenderOptions.styling`, `'inline'` by default, so existing callers render exactly as before. With `styling: 'classes'` the adapters write `class="afd-status-<type>"` and `afd-bold` instead of a `style` attribute, which a Content-Security-Policy of `style-src 'self'` refuses, and `css/afd-theme.css` defines those classes. Every `WebAdapter` render method now takes `RenderOptions`, and `styledSpan` takes the value as a fourth argument. A render method passed directly as an array callback, such as `messages.map(WebAdapter.renderError)`, still renders the same but no longer type-checks, since the index is not `RenderOptions`: write `messages.map((m) => WebAdapter.renderError(m))`.
