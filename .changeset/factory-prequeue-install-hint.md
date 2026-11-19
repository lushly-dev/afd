---
"lushly-botcore": patch
---

### Fixed

- **Factory `lane-enqueue`**: a `PREQUEUE_FAILED` refusal now names the adapter's `install`
  command in its suggestion and in `details.install`, so a cell whose new worktree was never
  installed knows to run it and enqueue again with nothing to commit (#1594).
