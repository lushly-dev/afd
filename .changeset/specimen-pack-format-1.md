---
'@lushly-dev/specimen': minor
'@lushly-dev/specimen-fast-af': patch
---

The component pack format is version 1 and fixed: `PACK_FORMAT_VERSION` is 1, every file's `format` is 1, and the JSON Schema files say so. Version 1 is version 0's shape, fixed once a real library's pack was built and served (the Component Briefs plan's step C4). A file still in format 0 is `FORMAT_UNSUPPORTED`; rebuild the records with `specimen pack` and export again. From now on any change to what a pack file may hold is a new version.

Exporting FAST-AF's pack found three faults, now fixed. `packCatalog`, and so `specimen-pack-export`, listed a catalog's components in file-path order, which puts `x-grid-cell` before `x-grid` and made the export `NOT_CANONICAL`; it lists them by tag. A guide that gives two roles for one state is `GUIDE_SCHEMA_INVALID` at `roles`: a record keeps one role a state, and the build kept the first while export compared both. And the FAST-AF plugin's schema source, which keeps an attribute the manifest lists apart from its property on that property, now takes what the manifest says of the attribute (its type, values, default and description) over what it says of the property, so a pack's record and export's recheck against the manifest agree.
