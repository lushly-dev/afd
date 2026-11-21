---
"lushly-botcore": minor
---

### Added

- **Skill usage on every machine.** The hourly job that `disk-setup` installs now runs `skill-usage-collect` after the disk work, for at most five minutes; a failure there never fails or holds the job, and `disk-status` warns of it at once and reports it as a problem once it has failed for a day. A machine names itself and a folder every machine can see in its machine settings (`skill_usage_machine`, which `disk-setup` writes down from the hostname, and `skill_usage_shared`; `skill_usage_collect = false` turns the hourly collection off). Collection then also writes what it read of the machine's record to its own folder there, and `skill-usage-report` and `skill-usage-triggers` read every machine's record, each session once, naming a machine whose record is old. A copy that a sync has only partly delivered is not read, and is named. Botcore neither creates nor syncs the shared folder, and a machine never writes over another record's folder (#1818).

### Changed

- **`skill-usage-triggers`** calls a change a miss only once every machine's record reaches the change's merge; until then it is unknown (`incomplete_record`), and the report names the machines it waits for. A machine the owner knows is switched off is named in `skill_usage_away` and is then not waited for. It also reads a skill's renames from the checkout it is given, and allows five minutes between a machine's clock and the forge's.
- **`skill-usage-collect`** refuses a machine name that cannot name a folder and a shared folder that is not a full path (`INVALID_INPUT`), and machine settings it cannot read (`MACHINE_SETTINGS_INVALID`). It reads a thread that was moved to the machine from its start, names a project of a store copied from another system by its folder, never by the whole path, and takes a half-written event that an interrupted collection left at the end of the record off it, instead of keeping it as a line that cannot be read.

### Fixed

- **`disk-setup`** writes a setting that holds a character outside the basic plane as TOML reads it; before, the next run refused the file.
