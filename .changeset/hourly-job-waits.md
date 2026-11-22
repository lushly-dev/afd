---
"lushly-botcore": patch
---

### Fixed

- **The hourly job always ends, and says what it waited for** (lushly-dev/afd#1902). macOS asks the owner at the screen before a scheduled program reads an external volume, and holds the read until someone answers. The first reclaim the schedule ran by itself waited there for ever, and a scheduler starts no run while one is alive: no check, no reclaim and no collection of skill usage until the process was ended. `disk-run` now reads each folder it will need before anything else, so that the question comes up in the run `disk-setup` starts, and runs the disk work as a step it can stop waiting for. A step that works says what it is doing and is never cut short; one that waits is left behind when the run is 50 minutes old. `disk-status` names the folder it waited for and the program to allow (`disk_work`), as a problem, and warns when the job has not checked in for three hours. New errors: `DISK_RUN_STALLED`, `DISK_RUN_FAILED`.
- **A shared folder that does not answer no longer reads as a collection that failed** (lushly-dev/afd#1903). The same question is asked before a scheduled program reads a folder in a cloud drive that fetches files on demand. The collection writes this machine's record before it shares it, and the job now says so: `this machine's record was collected, but the shared folder did not answer`, with the folder and what to allow. The disk work no longer holds the collection either: it waits only while the disk work is working.
