---
"@lushly-dev/afd-core": minor
---

`JournalRange` gains `last`: `sink.read({ last: n })` returns at most `n` entries from the end of the range, still in `seq` order, so `read({ last: 1 })` gives a journal's last `seq` without reading the rest. `IndexedDbJournalSink` walks a reverse cursor for it and reads no more entries than it returns; the memory and file sinks select from what they hold. A `last` that is not a safe integer, 0 or more, rejects with a `RangeError`, before any read. A custom sink written before this field returns the whole range; take its tail with `n === 0 ? [] : entries.slice(-n)` (#663).
