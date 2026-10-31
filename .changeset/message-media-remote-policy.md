---
"@lushly-dev/violet-elements": minor
---

`violet-message-media` now shows its generic file row (filename and type) when a remote image fails to load, and gains an opt-in `allowed-origins` attribute: when set, sources that are not relative, same-origin, `data:` or `blob:` and whose origin is not listed are never requested and render the file row instead. Without the attribute, behaviour is unchanged.
