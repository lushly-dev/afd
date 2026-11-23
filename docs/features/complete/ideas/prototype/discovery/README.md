# Discovery probe (phase 0.10, in part)

Does an agent with no skill find the store, given only an instance's tool list and instructions?
The plan's step 0.10 asks this of real harnesses against a hosted instance, which does not exist
yet. This probe asks it on paper: a model is shown the server's instructions and the tool list a
harness would see, and says which tool it would call first for each of 24 invented everyday
requests. Nothing is called.

| File | What it is |
| --- | --- |
| [`conditions.json`](conditions.json) | Three tool lists, each the five meta-tools and eight first-class tools, with the instructions |
| [`requests.jsonl`](requests.jsonl), [`expected.json`](expected.json) | 24 requests (8 to save an idea, 6 to ask, 4 to draft, 4 ordinary memory, 2 documents) and the tool each should reach |
| [`prompt.md`](prompt.md) | What the model is told |
| [`runs/`](runs/) | Each model's answers |
| [`score.py`](score.py) | `python3 score.py runs --out ../results/discovery.counts.json` |

The first-party descriptions are the manifests' text on `main`, except `workspace-show` and
`event-list`, which are paraphrased from their source. The Ideas descriptions and the
instructions paragraph are this probe's drafts of what the plan's section 4.16 describes.

## The run of 2026-11-11

One run per condition and model; Claude Sonnet 5.5 and Claude Haiku 5.5.

| Condition | First-class tools | Sonnet | Haiku |
| --- | --- | --- | --- |
| A. The host's default order: seven first-party, then `ideas-capture` | workspace-show, event-list, components-brief, context-bundle, memory-remember, knowledge-search, knowledge-open, ideas-capture | 14 of 24 | 14 of 24 |
| B. The plan's recommendation: the three Ideas commands, `memory-remember` out | workspace-show, components-brief, context-bundle, knowledge-search, knowledge-open, ideas-capture, ideas-ask, ideas-guide | 20 of 24 | 2 of 24 |
| C. The three Ideas commands, `memory-remember` kept, `workspace-show` and `event-list` out | components-brief, context-bundle, memory-remember, knowledge-search, knowledge-open, ideas-capture, ideas-ask, ideas-guide | 24 of 24 | 24 of 24 |

- **A.** Saving works, since `ideas-capture` is listed. No question or draft reached the store:
  Haiku took them to `context-bundle` or `knowledge-search`, and Sonnet to `afd-discover` with a
  search for ideas, which would find `ideas-ask` a call later.
- **B.** With `memory-remember` out of the list, neither model looked for it: every request to
  remember a preference was answered with no tool. Haiku called `ideas-guide` first for every
  idea request, following the instruction to call it once before working with ideas.
- **C.** Every request reached the right tool, in both models.

**Limits.** One run each, on invented requests, with no tool answering, in no real harness. It
shows what a model does on first contact with a list; the plan's 0.10 still asks for real
harnesses and the owner's everyday requests.
