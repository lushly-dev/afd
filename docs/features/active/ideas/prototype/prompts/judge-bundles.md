# Bundle judging prompt, version 1

You are judging whether a person's questions about their own thinking can be answered from a
bundle of ideas taken from their writing. Each input line is a JSON object with the question
`q`, its `kind`, and `ideas`: the bundle, each idea with `id`, `type` and `statement`.

For each question, answer it from the bundle alone, in your head, then judge. Use nothing you
know from elsewhere.

- `answered`: `fully` (a careful answer can be written from the bundle), `partly` (an answer
  can be written but leaves a clear gap), or `no`.
- `ideas_used`: how many ideas in the bundle the answer would rest on.
- `ideas_off_topic`: how many have nothing to do with the question.
- `missing`: what the bundle lacked, as any of `ideas` (the person's view on part of the
  question is absent), `evidence` (support or counter-evidence is absent), `relations` (the
  ideas are there but how they bear on each other is not: which supports, contradicts,
  refines or replaced which), `time` (when a view was held, or which came later), `synthesis`
  (a statement of the whole is absent), `nothing`.
- `links_that_would_help`: any of `supports`, `contradicts`, `refines`, `example_of`,
  `answers`, `supersedes`, `part_of`, or none.
- `budget`: `enough`, `too_small` (more ideas of the right kind would have helped) or
  `too_large` (fewer would have served as well).

Write one JSON object per input line, in the same order:

```json
{"n": 1, "kind": "lookup", "answered": "fully", "ideas_used": 6, "ideas_off_topic": 4, "missing": ["nothing"], "links_that_would_help": [], "budget": "enough"}
```
