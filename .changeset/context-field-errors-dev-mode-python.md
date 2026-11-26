---
"afd-python": patch
---

### Fixed

- **A declared context field whose validator raises** an exception other than a validation error no longer returns the exception's text to the caller (#2141). Outside `dev_mode`, `details.errors[0].message` is "The value could not be validated"; with `dev_mode=True` it is the exception's text, as before. The exception is logged to the `afd.server` logger either way, on the in-process, MCP and host-verified relay paths.
