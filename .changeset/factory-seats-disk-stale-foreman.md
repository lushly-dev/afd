---
"lushly-botcore": minor
---

### Added

- **The Factory lane refuses work when the disk is short** (lushly-dev/afd#1565). A new dial, `host.minFreeDiskGb` (default 20), is the free disk kept where the lane's slots build, beside the checkout in `<repository>.factory-slots`. Below it, `cell-register` refuses `DISK_LOW`, `lane-status` gives `canStartCell: false` with the reason, and the lane pauses with a `lane-error` before it starts a validation, ejecting nothing. Each names the dial and the slots directory, whose build output (Rust target directories among it) is what fills the disk. A full system disk had ejected a good branch mid-build.
- **A superseded foreman session is refused `FOREMAN_STALE`** (lushly-dev/afd#1595). A session that another one took the lane from, after its lease ran out or through `foreman-handoff`, can no longer `cell-register`, `ejection-excuse`, `dial-set` or wait as the foreman, even with no lease held. A scheduled foreman that woke after a usage-limit reset had taken an expired lease and acted on an outdated brief after a newer foreman had done the work.

### Fixed

- **An ejected cell that waits on the owner no longer holds a seat** (lushly-dev/afd#1593). Once a cell's own ejections reach `cells.maxEjections`, it frees its seat toward `cells.max`, and `canStartCell` reflects that; the lane raises `queue-room` when that opens a seat, and `lane-status` counts the cell in `waitingOnOwner`. An ejected cell under the limit, which its foreman is repairing, keeps its seat, and an `ejection-excuse` that brings a cell back under the limit seats it again.
