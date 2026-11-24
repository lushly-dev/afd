---
"lushly-botcore": patch
---

### Fixed

- **`botcore-factory` suggestions name served commands:** `lane-enqueue`'s `NOT_LANE_HOST` refusal told the cell to use `lane-handoff`, which is planned and not built. It now tells the cell to stop and tell the foreman, naming the lane host and `lane-enqueue`. A test reads every refusal's suggestion in the plugin, including those built from variables and helpers, and fails on any hyphenated name that is neither a command the factory serves nor a listed skill, event or setting.
