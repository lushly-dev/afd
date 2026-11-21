---
"afd-python": minor
---

### Added

- **`afd batch` and `afd stream`** in the Python CLI, as in TypeScript (#548). `afd batch COMMANDS` sends one `afd-batch` call from a JSON array or a `.json` file (`name` and `args` are accepted for `command` and `input`) with `-s/--stop-on-error`, `-t/--timeout` (ms, default 30000), `-p/--parallel`, `-f/--format` and `-v/--verbose`, and exits 1 when the batch fails and 2 when some commands fail. A batch whose answer never arrives reports `OUTCOME_UNKNOWN`, since the server may have run commands. `afd stream NAME [ARGS]` reads the server's `POST /stream/<command>` events with `-t/--timeout` (ms, default 60000), `-f/--format` (json prints one chunk per line) and `--no-progress`. It ends with `STREAM_TIMEOUT` or `STREAM_TRUNCATED` when the server does not finish, and exits 1 on an error chunk and 130 on Ctrl+C. Both take the server as `--server` and `ARGS` as a JSON object. Text output strips terminal escape sequences from what the server sends.
