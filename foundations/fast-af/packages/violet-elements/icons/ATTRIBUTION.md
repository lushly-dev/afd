# Violet Icon Sources

This directory holds icon source sets and attribution metadata used to
build the internal Violet icon registry.

## Structure

- `sources/<source-id>/source.json`
  Source metadata, licensing, attribution, and notes.
- `sources/<source-id>/raw/*.svg`
  Flat SVG files, for a set imported from elsewhere.
- `sources/<source-id>/iconset.json`, `brief.md`, `provenance.md` and
  `icons/<name>/`
  A set drawn here with an icon kit: its spec, its brief, how its originality
  was checked, and per icon an `icon.json` (meaning, notes, reviews and
  approvals) beside its drawings. The build takes each icon's default drawing
  (`outline-24.svg`).

`pnpm -F @lushly-dev/violet-elements icons:build` writes the registry in
`src/icon/generated/` from these sources.

## Editing the system set

The system set is drawn, checked and reviewed with Bold Jump's icon kit
(`@boldjump/icon-kit`), which is private and is not a dependency: the build
reads only the SVGs. With a checkout of the kit on the same machine, point it
at this directory, which holds the kit's `icon-kit.json`:

```sh
bj-icon icon-set-get '{"set":"system"}' --root foundations/fast-af/packages/violet-elements/icons
bj-icon review --root foundations/fast-af/packages/violet-elements/icons
```

Save drawings with `icon-save`, never by hand, so they stay in the kit's normal
form and their reviews stay pinned to the exact drawing. Then run
`icons:build`. Without the kit, an icon can still be edited by hand: follow
`iconset.json` and `brief.md`, keep the drawing original, and say so in the
pull request. The kit then reports the drawing as changed and unreviewed until
someone with it checks and reviews it again. Sheets and review pages go to
`.icon-kit/`, which is ignored.

## Policy

- Source sets are kept in FAST-AF and normalized into Violet's own generated
  registry.
- FAST-AF consumes the generated registry, not third-party package APIs.
- Each source set must include clear license and attribution metadata.
- Lushly can surface end-user attribution later from the same metadata.

## Current Set

- `system`
  Violet's own system icons, MIT, by Lushly Dev. Every icon was drawn from
  scratch in the Key style: a 1.75 line on a 24 grid with round caps and joins,
  built from circles and straight runs, with corners rounded at 2 to 2.5 units
  to match the rounded controls the icons sit in. They were linted, rendered
  and reviewed with Bold Jump's icon kit, and checked for overlap against
  Feather and Lucide so that no icon carries another set's path data
  (lushly-dev/afd#2567). They
  replace the first seed set, four of whose icons matched Feather
  (lushly-dev/afd#2542).
