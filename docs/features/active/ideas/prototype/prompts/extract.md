# Extraction prompt, version 2

The prompt an extractor is given in phase 0. Version 2 adds the tests for one idea and for
standing alone after version 1's review found two ideas in one the commonest fault, and
word-for-word ideas that lean on their neighbours. Version 1 is in the history of this file.

---

You are mining a document for the ideas it holds. The document is given as numbered units:
sentences of prose, sentences of list items, headings, table rows. You cite units by number and
you never retype the author's words.

## What an idea is

One thing the author holds, reports or asks, which someone could use without having read the
document:

| Type | It is |
| --- | --- |
| `position` | A stance the author takes on a question that could be argued the other way |
| `principle` | A rule the author works by, or recommends working by |
| `model` | A distinction, a named structure, a set of stages or roles: a way of dividing something up |
| `evidence` | A finding, a figure or a reported fact, with where it came from |
| `example` | A concrete case that shows an idea at work |
| `question` | Something the author says is open or undecided |
| `synthesis` | A statement that sums up what several ideas in an area amount to |

An idea stands alone. It names what it is about, so "this approach" or "the framework" with
nothing to say which one is not an idea yet. It is one thing: if it says two things that could be
held or rejected separately, it is two ideas. It is whole: a clause that only makes sense beside
its neighbours is part of an idea, not one.

Leave out what is about the document and not about the world: what a section will cover,
instructions to an editor, status fields, tables of contents, links, acknowledgements. Leave out
what the author quotes only to reject it, unless the rejection is the idea. Capture each idea
once for the document, where it is stated best, even when the document repeats it.

## Two tests before you write each idea

1. **One idea.** Could someone hold one part of it and reject another? Then it is two ideas: a
   claim and its reason, a rule and its exception, two items of a list joined by "and", a
   finding and what the author makes of it. Write each one. A model made of named parts is one
   idea only when the parts mean nothing apart.
2. **Alone.** Read the statement with nothing around it. If it says "this", "these", "that
   approach", "the above", "here" or "it" and nothing in it says what is meant, or if it
   answers a heading that it does not carry, it does not stand alone. Then add the unit that
   supplies the missing part to `cites` and give a `statement` that carries it.

## How to write one

Write one JSON object per idea, one per line:

```json
{"source": "src-0123456789ab", "type": "principle", "cites": [12], "tags": ["soil", "drainage"]}
{"source": "src-0123456789ab", "type": "position", "cites": [31, 32, 40], "statement": "Raised beds are worth their cost only on clay.", "tags": ["beds", "cost"]}
```

- `cites`: the numbers of the units the idea rests on. Always given.
- **Prefer the author's own words.** When one unit, or two or three units next to each other,
  state exactly one idea and pass the test of standing alone, cite them and give no `statement`. The idea is then exactly
  those units, in order.
- **Restate only when you must:** when the idea is spread over the text, when the sentences lean
  on what came before, or when the wording carries scaffolding. Then give a `statement` in plain
  words, one to three sentences, that says nothing the cited units do not say, and cite every
  unit it rests on.
- `type`: one of the seven above.
- `tags`: one to four short lowercase topic words, the subject and not the type.

Do not number ideas, add other fields or write anything but JSON lines.
