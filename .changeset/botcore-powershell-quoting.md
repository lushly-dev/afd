---
"lushly-botcore": patch
---

### Fixed

- **`skill-usage-collect`** handles PowerShell quoting in the shell reader: ignores here-strings inside POSIX `<<` here-documents, stops treating `\"` as an escaped quote inside PowerShell scripts, and honours PowerShell backtick escapes inside double quotes (#1847).
