---
"@lushly-dev/specimen": patch
---

Fix `motion: 'settled'` instrumentation throwing `DOMException` on shadow roots created in secondary documents (such as inert documents used by scoped custom element registries) by constructing per-document `CSSStyleSheet` instances via `ownerDocument.defaultView?.CSSStyleSheet` and cleaning up managed sheets and fallback styles across mode and document transitions (#2384).
