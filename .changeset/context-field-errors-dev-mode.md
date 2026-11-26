---
"@lushly-dev/afd-server": patch
---

A declared context field whose schema throws (a Zod callback such as `.transform`, a refinement or an error map) no longer returns the exception's text to the caller. Outside `devMode`, `details.errors[0].message` is now "The value could not be validated"; with `devMode` it is the exception's text, as before. The exception now always reaches `onError` on the server, handler or direct registry, including on the host-verified relay path, and an `onError` that throws or returns a rejected promise is contained.
