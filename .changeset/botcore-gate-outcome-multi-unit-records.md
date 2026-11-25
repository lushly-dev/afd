---
"lushly-botcore": minor
---

### Changed

- **`gate-outcome-report` (`by: area`)** counts a fix commit in every unit it touches (each row carries `also_other_units` and `records_only`, totals still count each commit once with `multi_unit` and `records_only`, and `several` is removed) (#2551).
- **`gate-outcome-collect` (`main` source, `v` 2)** excludes records (changelogs, changeset fragments, provenance records, prose/status files and lockfiles) from unit attribution and `last_edit` blaming, marking record-only commits with `records_only` (#2551).
