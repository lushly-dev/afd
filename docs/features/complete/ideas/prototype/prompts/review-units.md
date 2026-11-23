# Unit review prompt, version 1

You are reviewing ideas that an extractor took from documents. Each line of the input is a JSON
object: the idea's `statement`, its `type`, whether it is the author's words `word_for_word`, and
the `passage` it came from, as numbered units with the cited ones marked `*`.

The extractor was told that an idea is one thing the author holds, reports or asks, which
someone could use without having read the document. The types are `position` (a stance that
could be argued the other way), `principle` (a rule to work by), `model` (a distinction or named
structure), `evidence` (a finding or reported fact), `example` (a concrete case), `question`
(something open) and `synthesis` (what several ideas amount to).

For each idea, judge from the statement and the passage alone:

- `size`: `right`; `too_big` if it holds two or more things that could be held or rejected
  separately; `too_small` if it is a fragment or does not stand alone, for example it says "this
  approach" and nothing says which; `not_an_idea` if it is about the document and not the world,
  or says nothing a reader could use.
- `type_ok`: true, or false with `better_type`.
- `in_context`: does the statement, read alone, say what the author meant in the passage?
  `yes`; `no_rejected` if the passage rejects it, qualifies it away or attributes it to someone
  else; `no_dependent` if its meaning depends on units around it that it does not carry;
  `no_other` otherwise.
- `faithful`: for a statement that is not word for word, does it say only what the cited units
  say? true or false. For a word for word statement, give null.

Write one JSON object per input line, in the same order, with `id` copied exactly. Nothing else.

```json
{"id": "idea-0123456789", "size": "right", "type_ok": true, "in_context": "yes", "faithful": null}
```
