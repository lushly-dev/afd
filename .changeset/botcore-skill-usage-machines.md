---
"lushly-botcore": minor
---

### Added

- **Skill usage on every machine.** The hourly job that `disk-setup` installs now runs `skill-usage-collect`; a failure there never fails the job, and `disk-status` warns of it at once and reports it as a problem after a day. A machine names itself and a folder every machine can see in its machine settings (`skill_usage_machine`, `skill_usage_shared`; `skill_usage_collect = false` turns the hourly collection off). Collection then also writes the machine's record to its own folder there, and `skill-usage-report` and `skill-usage-triggers` read every machine's record, each session once, naming a machine whose record is old. A copy that a sync has only partly delivered is not read, and is named. Botcore neither creates nor syncs the shared folder (#1818).

### Changed

- **`skill-usage-collect`** refuses a machine name that cannot name a folder, and machine settings it cannot read (`MACHINE_SETTINGS_INVALID`).
