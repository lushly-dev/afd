# The pond: an event-sourced app on the command journal

A small simulation of a fish pond whose only stored state is its command journal. Every change
is recorded with `createJournalMiddleware` and a `FileJournalSink`, and on start the app builds an
empty pond and replays the journal into it with `replayJournal`, which gives each call the clock
readings and random values its tape recorded.

This is one way to build an application on AFD's journal, not something AFD requires. AFD keeps
the journal and can replay it; making the replay rebuild the same state is the application's
job, and most of this page is about that part.

It is an example, private to this repository and never published.

## What is here

- **`src/pond.ts`**: the state and its rules. Every rule takes the time and the random source
  as arguments; none reads them itself.
- **`src/commands.ts`**: four commands. `pond-stock`, `pond-tick` and `pond-net` change the pond
  (`mutation: true`); `pond-status` reads it. Each change returns `stateDigest`, a fingerprint
  of the pond it left.
- **`src/app.ts`**: `openPond({ journalPath })`, the event-sourced host. It reads the journal,
  replays it into a fresh pond with `stopOnDivergence`, throws `PondReplayError` if any entry
  replays to a different result, then runs new calls one at a time through the same registry,
  journaling each successful change.
- **`src/cli.ts`**: runs one command against a journal file, rebuilding the pond first.

## Running it

```bash
pnpm -F @afd/example-pond test
pnpm -F @afd/example-pond build
cd packages/examples/pond
node dist/cli.js pond-stock '{"species":"koi","count":3}'
node dist/cli.js pond-tick '{"days":5}'
node dist/cli.js pond-status    # the same pond, rebuilt from pond.jsonl on every run
```

`POND_JOURNAL` names another journal file. Each run starts from nothing but the file, and the
calls read the real clock and `Math.random()`-backed random source: the pond comes back the same
only because replay restores what each call read.

## What AFD restores, and what it does not

`replayJournal` restores, per entry, the command's input, its actor, trace ID and interface, the
context fields declared `journal: true`, and the values the call read from `context.clock` and
`context.random`. Nothing else. It then compares each replayed result with the recorded one.

Everything else that could make a replay come out different is the application's to keep
deterministic. In this example:

1. **Time and randomness only from the context.** Handlers read `context.clock` and
   `context.random`, never `Date.now()`, `new Date()`, `Math.random()` or
   `crypto.randomUUID()`. `src/pond.ts` takes both as arguments, so it cannot reach for the
   global ones. A value read around the context is not on the tape, and the replay gets a new
   one.
2. **All state starts empty and lives in one place.** The fish counter that numbers new fish is a
   field of `Pond`, not a module variable. A module-level counter would survive between the
   recording and a replay in the same process, or start again in a new process, and the ids
   would differ.
3. **Every change is a journaled command.** The journal is filtered to the `mutation: true`
   commands, and nothing changes the pond except through them. A change made outside a command
   (a timer, a background job, a direct write to `Pond`) is lost on restart. Reads are left out
   because they add nothing to rebuild from.
4. **A refused call changes nothing.** Only successful calls are journaled (the middleware's
   `recordFailures` defaults to `false`), so each handler checks everything that can refuse it
   before it changes the pond. A handler that changed the pond and then failed would leave a
   change that replay never repeats.
5. **One change at a time.** `run` queues calls, so the journal's order is the order the pond
   changed in. Two handlers that interleaved could change the pond in one order and be appended
   in another.
6. **No outside input.** Handlers read no file, network, environment variable or other process.
   Anything they depend on must arrive in the command's input, so it is journaled.
7. **Stable iteration and arithmetic.** Fish live in a `Map`, which iterates in insertion order.
   Lengths are rounded to a millimetre so they survive the trip through JSON. Avoid iteration
   whose order depends on anything but the calls (a hash order, a sort without a tiebreak), and
   floating-point results that depend on the platform.
8. **Results must show the state they leave.** Replay compares results, not state. Each change
   returns `stateDigest`, a fingerprint of the whole pond, so a pond that replayed differently
   cannot compare `same`. Without it, `pond-tick`, whose result lists only what hatched, could
   grow every fish differently and still pass.
9. **The tape must hold every read.** The journal keeps at most `maxTapeReads` clock readings and
   random values per call (1000 by default) and marks a longer tape `truncated`; replay cannot
   restore the rest. `pond-tick` reads two random values per fish per day, so one call on a full
   pond of 200 fish over 30 days reads 12,000. `openPond` sets `maxTapeReads` to that bound
   (`MAX_RANDOM_READS`), derived from the same limits the commands enforce.
10. **A journal written by other code may not replay.** Changing a rule changes what the same calls
    produce. `openPond` refuses to start on a divergence rather than open a pond that is not the
    one recorded. An application that must keep old journals working versions its rules, or
    migrates by replaying with the old code and writing a new journal or a snapshot.
11. **A change that was not written is not kept.** If appending to the journal fails, the call
    has already changed the pond in memory. `openPond` then refuses every later call with
    `JOURNAL_WRITE_FAILED`; reopening rebuilds the pond from what the journal holds.

Secrets are the other thing to watch: anything the middleware's `redact` option removes from an
entry is gone from the replay too, and an entry that no longer replays to the same result makes
`openPond` refuse. Keep secrets out of the commands that build the state.

## What it leaves out

- **Snapshots.** Every start replays the whole journal. A long-lived app would save the state
  every so often and replay only the entries after it.
- **Several writers.** A `FileJournalSink` is for one process at a time.
- **Undo.** The journal is append-only; taking a change back is another command.
