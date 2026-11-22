---
"lushly-botcore": patch
---

### Fixed

- **A removed checkout's skills leave the reports** (lushly-dev/afd#2123). The collection keeps each project folder's last account of what the project holds, so that a folder on a volume that is away still speaks. A folder removed for good kept its account too, and every machine's report went on listing its skills, in `quiet` and with sizes. When a folder is read, the machine now records what it is kept on: its volume's mount point and number, as its links resolve, or a cloud drive's own folder. A folder known not to be there, on storage that is there, was removed, and its account is dropped at the next collection; the project then holds what its other folders do, or nothing, and its loads are still counted. Where that storage is away too, or nothing was recorded of it (an account an earlier botcore wrote), the folder may only be away, and it keeps speaking for thirty days from when it was first found missing. A folder the user may not look at is never taken as gone, and no longer stops a collection on Python before 3.14.
