# Pack overrides found and checked on each call

- Date: 2026-11-27
- Area: the plugin contract, worlds and the component journal
- Pull request: [#2931](https://github.com/lushly-dev/afd/pull/2931), on `t3/umbel-pack-override-reload`, for [#2900](https://github.com/lushly-dev/afd/issues/2900)

Component Briefs step D4's host half, which the owner asked to start once `violet-elements` shipped
its pack in its npm package (#2862). D222 amends D46: `PackSet::effective` looks for the space's
override and checks it against section 8.2's rules each time a call first reads the pack, and
`CallServices` keeps that copy for the call's other reads. A new override is served without a
restart, a removed one gives way to the default, and one that breaks a rule after `seal` refuses
that call with `PACK_INVALID`'s message (as `Invalid`, which the components plugin answers as
`PACK_UNREADABLE`) instead of being served unchecked. At `seal` an invalid override still fails the
load. The phase 1 specification's section 8.2 and its implementation note, and the components
specification's open row, say so; the plugin's README follows in a pull request of its own, since
the plugin-isolation gate refuses `plugins/` and host code together.

Verified 2026-11-27 on Windows: `cargo test --locked --test it packs::` passes 12 of 12, four of
them new: an override written after `seal`, one removed, one changed to hold a stray file and then
1 002 files (refused each time and served again once put right), and one call that keeps the copy
it found first when the override goes between its two reads. That last test fails with the
per-call copy taken out. Left: `plugin-show` and the doctor's `plugins.pack_checks` still report
what `seal` saw, a follow-up row in the plugin contract's table. The owner accepted D222 as
written on 2026-11-27, on #2900.
