---
'@lushly-dev/afd-cli': minor
---

Add `afd replay <file> --module <path>` (#423): replay a JSON Lines command journal against a fresh in-process registry with `replayJournal` and print each entry as `same`, `different` (with the changed paths) or `error`. Exits 1 on any divergence and 2 when the journal or module cannot be loaded, so it works as a CI regression check. Options: `--export`, `--ignore`, `--seed`, `--stop-on-divergence`, `--from`/`--to`, `--format json` and `--verbose`. The journal is bounded (64 MiB file, `--max-line-bytes` 1 MiB, `--max-entries` 10,000) before parsing. Replay over MCP is not supported, because a remote server cannot be given the recorded clock and random values. `@lushly-dev/afd-server` is now a runtime dependency of the CLI.
