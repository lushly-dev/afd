# Violet Icon Sources

This directory holds raw icon source sets and attribution metadata used to
build the internal Violet icon registry.

## Structure

- `sources/<source-id>/source.json`
  Source metadata, licensing, attribution, and notes.
- `sources/<source-id>/raw/*.svg`
  Raw source SVG files imported from the original set.

## Policy

- Raw source sets are vendored into FAST-AF and normalized into Violet's own
  generated registry.
- FAST-AF consumes the generated registry, not third-party package APIs.
- Each source set must include clear license and attribution metadata.
- Lushly can surface end-user attribution later from the same metadata.

## Current Seed Set

- `system`
  Small hand-authored seed icons used to validate the icon pipeline before
  third-party sets are imported.
