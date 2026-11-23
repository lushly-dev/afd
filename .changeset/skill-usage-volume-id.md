---
"lushly-botcore": patch
---

### Changed

- **Know a folder's volume by its identifier** (lushly-dev/afd#2245). `skill-usage-collect` now records a volume's stable identifier (`volume_id`) with each project folder where the operating system provides one, falling back to the device number (`st_dev`) only where there is none. A volume remounted under a different device number is still recognised so a removed checkout's skills drop on the next collection, while another disk mounted at the same mount point (even with the same device number) is not mistaken for the original volume.
