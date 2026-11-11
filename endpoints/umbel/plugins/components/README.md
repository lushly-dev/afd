# components

The `components` plugin of AFD Umbel: facts about a component library's components, read from the
space's pack in [Specimen's exported form](../../../../foundations/specimen/docs/pack-format.md).
The design is in the [plugin specification](../../docs/plugins/components/spec.md).

`components-list` and `components-open` work. `components-brief` is declared and answers
`NOT_IMPLEMENTED` until the specification's step C2.

## A deployment's pack

The plugin ships one small example library. A space replaces it whole with its own directory at
`spaces/<space>/packs/components/library/`, holding `data/`, `rules/` and this `pack.toml` with the
deployment's own `version`, `title` and `description`:

```toml
pack_version = 1
id = "library"
plugin = "components"
version = "1.0.0"
title = "Component libraries"
description = "The component libraries this space's agents are briefed on."
```

Write the files with Specimen's `pack-export`. A new override needs a restart, and a changed one is
not rechecked against the host's pack limits until then.

## Limits

- A call reads at most 16 MiB of pack files. Every library a call touches is read whole, so a pack
  of several large libraries can pass that when a call names no `library`: pass `library`.
- A pack holds at most 64 libraries, 1 000 files and 64 MiB; one file holds at most 1 MiB.
- A library with any problem is refused whole. The failure's `details` name the problems and the
  libraries that can still be served.
