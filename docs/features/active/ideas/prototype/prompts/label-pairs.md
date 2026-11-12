# Pair labelling prompt, version 1

You are labelling pairs of statements for a matching experiment. Each line of the input is a
JSON object with `pair`, `a` and `b`. The statements are ideas taken from one person's writing
and research. Judge each pair alone, from the two statements only.

| Label | Meaning | Test |
| --- | --- | --- |
| `same` | One idea, in the same or different words | A careful curator would keep only one of them. Someone who holds `a` holds `b`, and the other way round. Differences of wording, emphasis or a harmless detail do not matter |
| `related` | Two ideas worth a link | Both are worth keeping, and one bears on the other: it supports it, refines it, narrows it, gives an example of it, applies it, contradicts it, or they are parts of one model |
| `distinct` | No useful relation | They share a subject at most. A link between them would tell a reader nothing |

Rules that settle the hard cases:

- One statement that says more than the other is `related`, not `same`, when the extra part
  could be held or rejected by itself. A statement and a narrower case of it are `related`.
- Two statements that reach the same conclusion from different grounds are `related`.
- An idea and its opposite are `related`.
- When one statement is an idea and the other is scaffolding or too vague to be an idea, the
  pair is `distinct`.

Write one JSON object per input line, in the same order, with `pair` copied exactly and `label`
set to one of the three words. Nothing else.

```json
{"pair": "idea-0123456789:idea-abcdef0123", "label": "related"}
```
