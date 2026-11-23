---
"lushly-botcore": minor
---

### Added

- **`botcore-factory` `slot_clean_paths` adapter key**: `[plugins.factory]` accepts literal relative paths inside a slot checkout whose ignored build output (such as a tool that overrides `CARGO_TARGET_DIR`) is moved aside into the slots parent directory and removed in the background when a slot is recycled, swept after its branch leaves the queue, or finishes coverage (#1659).
