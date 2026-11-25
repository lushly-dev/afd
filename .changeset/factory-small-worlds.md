---
"lushly-botcore": patch
---

### Fixed

- **`lane-report` on a lane that has not run** now sends the caller to `lane-status` instead of `lane-start`. `lane-start` refuses on a machine that does not host the lane, and starting a lane is not how to read a report. The factory's new small-worlds test found it: it follows every refusal's recovery over short command sequences from the scenario fixtures.
