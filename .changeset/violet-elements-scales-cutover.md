---
"@lushly-dev/violet-elements": minor
---

**Breaking (preview minor): Scales two-stage token cutover (`contractVersion` 5) ([#1111](https://github.com/lushly-dev/afd/issues/1111), [#2197](https://github.com/lushly-dev/afd/issues/2197)).** `tokens/interface.json` moves to `contractVersion` 5 (96 ids, down from 98) and `tokens/violet-theme.export.json` moves to `contractVersion` 2 (104 component ids):

- **Retired:** `size.font.sm` (`--violet-size-font-sm`) and `size.font.md` (`--violet-size-font-md`); components now read `type.caption.size` and `type.body.size`. Loam's built-in export also retires the remaining 14 makeshift ladder tokens (`size.font.{xs,lg,xl}`, `size.line.{xs..xl}`, `size.space.{xs..xl}`, `space.inline.lg`) and adds `space.inline.hairline` (`2px`).
- **Renamed to purpose names:**
  - Type: `type.caption.xs.*` → `type.caption.*`, `type.label.sm.*` → `type.label.*`, `type.body.md.*` → `type.body.*`, `type.title.sm.*` → `type.heading.section.*`, `type.title.md.*` → `type.heading.page.*`.
  - Radius: `radius.sm` → `radius.inset`, `radius.md` → `radius.control`, `radius.lg` → `radius.floating`.
  - Space: `space.inline.sm` → `space.inline.tight`, `space.inline.md` → `space.inline.group`, `space.stack.xs` → `space.stack.tight`, `space.stack.sm` → `space.stack.group`, `space.stack.md` → `space.stack.section`, `space.layout.sm` → `space.layout.panel`, `space.layout.md` → `space.layout.page`.

Product theme sets that supply their own token trees must update those ids to match `tokens/interface.json` version 5 (`findVioletThemeSetGaps` reports any missing id).
