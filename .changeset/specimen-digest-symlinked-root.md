---
"@lushly-dev/specimen": patch
---

`computeSourceDigests` now hashes files named under a root that sits behind a symlink, such as macOS's `/var` temporary folders. It took each file's path relative to the root's real path only, so every file looked outside the root and a point recorded no source digests ([#2416](https://github.com/lushly-dev/afd/issues/2416)).
