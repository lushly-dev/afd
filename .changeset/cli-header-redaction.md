---
"@lushly-dev/afd-cli": patch
---

A malformed request header is never repeated in an error, since it may hold a credential (#1836). A mistyped `-H "Authorization Bearer sk-..."` or `AFD_HEADERS` line used to print the whole header, token included, through `parseHeader` or Commander's own "argument '...' is invalid" message. The error now names only where the header came from (`--header 2`, or `AFD_HEADERS line 3`, counting blank lines) and exits 1. A header value is also limited to the characters HTTP allows (tab, visible ASCII, space and 0x80–0xFF), checked before only spaces and tabs are trimmed, so a control character is refused before any request (`trim()` used to drop a trailing vertical tab or U+2028 first, and a no-break space that belonged to the value). `-H` is now checked when the command runs rather than while Commander parses the command line, so it also stops a `call --module` before the module runs.
