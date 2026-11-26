---
"lushly-botcore": patch
---

### Fixed

- **botcore-factory's `lane-start` keeps its lane running on Windows.** A venv's `python.exe` there is a launcher that runs the interpreter as its child, so the host lock and the lane's pid named the launcher and the lane refused its own lock. The lane process now takes the lock and the recorded pid over from the parent that lane-start started, so `lane-stop` stops, and `lane-status` sees, the real interpreter; a lock any other live process holds is still refused (#2671).
