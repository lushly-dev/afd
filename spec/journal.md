# Command journal

A journal is an ordered, append-only record of executed commands. It is used to reproduce an
agent session, to turn a recorded session into a regression test, and to audit who ran what, in
what order and with what result. The golden fixture is [`wire/journal.jsonl`](./wire/journal.jsonl).

TypeScript (#273) and C++ (#427) implement it. Python and Rust do not yet; their parity is
tracked in follow-up issues.

## File format

A journal file is [JSON Lines](https://jsonlines.org/): UTF-8, one JSON object per line, each
line ending in `\n`. Readers skip blank lines and accept `\r\n`. A line that is not JSON, or not
an entry, is an error that names the line number. The conventional extension is `.jsonl`.

Entries are in increasing `seq` order. `seq` starts at 1 and is assigned by the sink, so a journal
reopened after a restart continues its numbering. Gaps are allowed (a recorder may skip calls).

## Entry

Keys are camelCase. Optional fields that are not set are omitted, never `null`.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `seq` | integer ≥ 1 | yes | Position in the journal |
| `timestamp` | string | yes | When the call started, ISO 8601, from `context.clock` |
| `traceId` | string | no | `context.traceId` |
| `command` | string | yes | The command name |
| `input` | JSON | yes | The validated input the handler received |
| `actor` | object | no | The caller: `kind` (`human`, `agent`, `service`, `script` or `test`), and `id`, `label` and `onBehalfOf` when set. No other actor field is kept |
| `contextDigest` | object | yes | `hash`, and `interface` when set (below) |
| `result` | `CommandResult` | yes | The result, `metadata` included (the shapes in [`wire/`](./wire/README.md)) |
| `durationMs` | number | yes | Duration of the call through the rest of the middleware chain |
| `tape` | object | no | The clock and random values the handler read (below). Omitted when it read none |

### Context digest: no secrets

A journal never stores a value from the command context outside an allowlist: the actor (as
`actor`), the interface (as `contextDigest.interface`) and the trace ID (as `traceId`). Auth
sessions, tokens, headers, cookies and every other context value are left out.

`contextDigest.hash` is `sha256:` followed by the lowercase hex SHA-256 of the canonical JSON
(object keys sorted, no whitespace) of:

```json
{"actor": <actor or null>, "interface": <string or null>, "keys": [<names>], "traceId": <string or null>}
```

`keys` is the sorted list of the names of the other context keys that have a value. Only the
names enter the hash, never the values, so a secret cannot be recovered from the journal even by
guessing. Two calls with the same hash had the same allowlisted values and the same context shape.
Replay does not compare hashes: the replaying surface builds its own context. Hashes compare only
within one implementation, because the context key names (`clock`, `random` and the rest) differ
between languages.

Inputs and results are recorded as they are. A command that takes or returns a secret (a password
argument, an issued token) must be filtered out or redacted by the recorder. The TypeScript
middleware skips commands named `auth-*` by default and has `filter` and `redact` options for the
rest. When a secret is derived from `context.random`, the redaction must drop the tape too: its
random values would rebuild the secret.

### Tape: clock and random

The tape holds every value the handler (and the server's own timing of the handler) read from
`context.clock` and `context.random`, in order:

| Field | Type | Meaning |
|---|---|---|
| `clock` | number[] | Required (may be empty). Each `context.clock.now()` reading, in epoch milliseconds. C++ clocks have two readings, `steady_ms()` and `wall_ms()`; both go here, in the order they were read |
| `random` | number[] | Required (may be empty). Each `context.random.next()` value, in [0, 1) |
| `truncated` | boolean | Present and `true` when the handler read more values than the recorder keeps |

Replay feeds the tape back, so the handler sees the same times and the same random numbers on
any surface, with the real clock or a seeded one. A seed alone would not be enough: the random
source is shared across calls, so its state at a given call depends on everything drawn before.

## Replay

A replayer re-executes entries in `seq` order against a fresh registry (or one reset to the state
the recording started from), and compares each result with the recorded one. For each call it
restores:

- `traceId`, `actor` and `interface` from the entry;
- a clock that returns the `tape.clock` readings in order, then repeats the last one;
- a random source that returns the `tape.random` values in order, then continues with a seeded
  source.

An entry without a tape gets a clock fixed at its `timestamp` and a random source seeded with
`<seed>:<seq>` (TypeScript's default seed is `afd-replay`).

Each entry is reported as one of:

- `same`: the replayed result equals the recorded one (as JSON, ignoring configured exact paths,
  `metadata.executionTimeMs` by default);
- `different`: the results differ. The report lists each difference with its path
  (`data.items[0].title`), its kind (`changed`, `added` or `removed`) and both values;
- `error`: the replay threw instead of returning a result.

Replay reports divergence; it does not guarantee determinism. AFD restores only the clock and
the random source. Handlers that read time or randomness elsewhere, perform I/O or depend on
global state can diverge, and the report says so. A note marks a tape that ran out or was not used
up, which usually points at the cause.

The tape starts where the recording middleware sits. Replay marks each call, and a recording
middleware in the replayed chain restarts the tape at its own position (and records nothing), so
middleware outside it can read the clock without shifting what the handler gets. Replay through
the same kind of surface, with the same middleware, that recorded the journal: the server reads the
clock twice around each handler for `executionTimeMs`, and those readings are on the tape. Without
a recording middleware in the chain, any middleware that reads the clock or the random source
consumes tape values meant for the handler.

The entry holds the input after validation, and replay validates it again. A schema whose
transform is not idempotent (`z.string().transform(Number)`, a default that depends on the clock)
can make a replayed entry fail validation or differ.

A handler that throws is recorded with the result the server returns outside development mode:
`COMMAND_EXECUTION_ERROR`, "An internal error occurred", never the exception message. Replayed
against a server in development mode, which returns the message, such an entry is `different`.

A handler that calls another command with its own context passes the replay marker on. Only the
first recording middleware restarts the tape, so the nested call reads on from the same tape, as
it did when recorded.

## Fixture

[`wire/journal.jsonl`](./wire/journal.jsonl) is compared byte for byte by the TypeScript test, so
its key order is TypeScript's (the order of the table above). Other implementations should compare
entries as JSON values, not as text.

## Out of scope

- Event sourcing (making the journal an application's source of truth, with state derived by
  replay). Applications can build it on these primitives.
- Determinism beyond the clock and the random source.
- A command-line replayer (`afd replay <file>`).
