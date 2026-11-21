---
"afd-python": minor
---

### Breaking changes

- **The bootstrap tools are opt-in** (parity decision D5, #542): `create_server` no longer registers `afd-help`, `afd-docs` and `afd-schema` unless it is given `bootstrap=True` (also `ServerConfig.bootstrap`), as TypeScript's `bootstrap: true`. With it, the default instructions add "afd-help, afd-docs and afd-schema describe this server." The meta-tools and the context tools are listed either way. Pass `bootstrap=True` to keep the earlier tool list.

### Fixed

- **`create_server(instructions="")` keeps the empty string** instead of generating the default instructions, as TypeScript's does (#542).
- **A command tool's `_meta` carries its `category`** (`spec/command-metadata.md`), first, an empty one included, as TypeScript's does, so `afd validate --surface` and other clients reading `tools/list` see it without `afd-help` (#542).
