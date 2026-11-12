# Ideas phase 0: measurement tools and results

These tools produce the numbers the [plan's phase
0](../ideas.proposal.md#8-phase-0-measure-before-specifying) asks for before anything is specified.
They are not the plugin. The corpus they ran on is the owner's and stays in his private repository;
only counts, rates and the tools are here. Every example in this folder is invented.

| Tool | Step | What it does |
| --- | --- | --- |
| [`corpus.py`](corpus.py) | 0.1 | Census of an archive: files, copies byte for byte, copies that differ only in line endings or trailing space, likely earlier drafts |
| [`sentences.py`](sentences.py) | 0.1, 0.4 | The sentence rule: a source as numbered units (prose and list sentences, headings, table rows, quotes, code), so an extractor cites by number |
| [`prompts/extract.md`](prompts/extract.md) | 0.1 | The one extraction prompt every model was given |
| [`ideas.py`](ideas.py) | 0.1, 0.4 | Checks an extraction against its sources, marks what is word for word, counts it, and draws a review sample |
| [`themes.py`](themes.py) | 0.5 | Derives themes two ways from statement embeddings and compares them with each other, across models and with a given grouping |
| [`ask.py`](ask.py) | 0.3 | Builds a bundle of ideas for each question and counts a judge's verdicts |
| [`violet/`](violet/README.md) | 0.6 | Invented ideas loaded into Violet's engine as composite values in a tree of framings, with fifteen checks |
| [`match.py`](match.py) | 0.2 | Embeds statements with local models, pools candidate pairs for labelling, and reports how each lane sorts them |
| [`prompts/label-pairs.md`](prompts/label-pairs.md), [`prompts/review-units.md`](prompts/review-units.md), [`prompts/judge-bundles.md`](prompts/judge-bundles.md) | 0.2, 0.1, 0.3 | The labelling, review and judging prompts |
| [`test_prototype.py`](test_prototype.py) | | Tests on invented fixtures |

```sh
uv run --python 3.12 --with pytest --with numpy --with scipy --with snowballstemmer \
    pytest docs/features/active/ideas/prototype -q
```

Python 3.10 or later. `corpus.py`, `sentences.py` and `ideas.py` use the standard library only;
`match.py` and `ask.py` need `numpy` and `snowballstemmer`, and `fastembed` to embed; `themes.py`
needs `numpy` and `scipy`.

## The run of 2026-11-11

**Corpus.** The owner's archive of writing and research on one subject, in his private repository:
107 Markdown files, 314 118 words. Each source was given a kind by hand from its name and place
(42 his own writing, 13 research reports, 2 other people's, 9 indexes and notes left out). The
kinds and dates are a model's reading of file names, not the owner's; he has not checked them.

**Extractors.** Extractor `a` is Claude Fable 5.2, on 42 own sources, 2 others and 5 of the 13
research reports. Extractor `b` is Claude Sonnet 5.5 on 12 of the own sources, so that one
document mined twice can be compared. Both had the same prompt, the numbered text and nothing
else. One agent per batch of about 10 000 words.

**Labels.** Pairs were labelled by models, one pair at a time, from the two statements alone: the
first 60 of each of six parts by Claude Fable 5.2, the rest by Claude Opus 5.5. A second labeller,
Claude Sonnet 5.5, labelled 200 of them independently. The review sample was judged by Claude Opus
5.5. **The owner has labelled nothing yet**: every rate below is a model's judgment, and the
plan's phase 0 asks for his check of a sample of each.

### 0.1 The unit and the types

[`results/corpus.counts.json`](results/corpus.counts.json),
[`results/sentences.counts.json`](results/sentences.counts.json),
[`results/ideas.counts.json`](results/ideas.counts.json),
[`results/review.counts.json`](results/review.counts.json).

- **What the archive is.** 107 files are 97 distinct by their bytes and 66 once line endings and
  trailing space are set aside: 10 are byte-for-byte copies and 31 differ from another only in
  line endings or trailing space. No two distinct files share half their 8-word shingles, so no
  earlier drafts were found. One file has front matter.
- **How much comes out.** Extractor `a` took 3 233 ideas from 115 214 words: 28 per 1 000 words,
  30 from the owner's own writing and 19 from research. A median source gives 65, the largest 205.
- **Size.** A statement's median is 23 words (90th percentile 43, largest 96); 12% are over 40
  words and 1% over 60.
- **Types.** Position 1 071, principle 1 051, model 464, evidence 321, question 155, example 131,
  synthesis 40. The reviewer accepted the type of 93% of the sample.
- **Is the unit right?** The reviewer judged 90% of `a`'s 120 sampled ideas the right size and
  8% too big (two ideas in one); for `b`'s 92, 73% and 20%. The sample over-weights `b`, so the
  pooled 83% stands for neither. 89% of the sample say alone what the author meant in place; 10%
  depend on sentences around them that they do not carry. Of 92 restatements, 87 say only what
  their cited sentences say.
- **Prompt version 2.** [`prompts/extract.md`](prompts/extract.md) adds a test for one idea and
  one for standing alone. Claude Opus 5.5 ran it on four of the owner's sources that both earlier
  extractors had read, and a reviewer judged 40 ideas from each extractor on those sources, mixed
  and unlabelled ([`results/prompt-v2.counts.json`](results/prompt-v2.counts.json)):

  | Extractor | Ideas | Word for word | Right size | Lean on neighbours |
  | --- | --- | --- | --- | --- |
  | Fable 5.2, version 1 | 276 | 55% | 38 of 40 | 2 of 40 |
  | Sonnet 5.5, version 1 | 199 | 89% | 22 of 40 | 14 of 40 |
  | Opus 5.5, version 2 | 317 | 27% | 39 of 40 | 1 of 40 |

  Version 2 gives more, shorter ideas that stand alone, and restates far more often, so fewer would
  attest; 2 of its 40 restatements said more than their sentences. The model changed with the
  prompt, so the two effects are not separated, and 40 a side is small. What it shows: the
  extractor decides most of the quality, and keeping to the author's words trades against ideas
  that stand alone.
- **Tags.** 1 656 distinct tags on 3 233 ideas, 729 of them used once. Free tags do not converge.

### 0.2 Can matching be trusted to refuse?

[`results/matching.counts.json`](results/matching.counts.json),
[`results/labels.agreement.json`](results/labels.agreement.json).

**Method.** 150 ideas of extractor `a` were matched against its ideas from *other* sources (the
same idea met in another document), and 60 ideas of extractor `b` against `a`'s ideas from the
*same* source (one document mined again by another model). For each, the three nearest candidates
by words and by three models (`all-MiniLM-L6-v2`, `bge-small-en-v1.5` and `potion-base-8M`) were
pooled: 1 717 pairs, labelled 99 same, 865 related and 753 distinct. The words lane is BM25 over
stemmed tokens, as tantivy's `en_stem` analyser and default parameters give, scaled so that a
statement scores 1 against itself. Eight local models from `fastembed` 0.9.1 were then scored on
the pooled pairs, five of them on a pool they did not help build.

**Labels agree.** On 200 pairs labelled twice, the labellers agree on 85% (Cohen's kappa 0.72),
and on same against not same on 97% (kappa 0.80). Most disagreements are related against distinct.

**Refusing fails where it matters.** Within one document mined twice, a threshold that refused
none of the 5 probes without a duplicate still catches 71% to 76% of duplicates, and by words, or
by words and meaning fused, the duplicate is among the first three candidates every time. Across
documents, which is how an archive repeats itself, no lane can refuse safely:

| Lane | Duplicates missed with at most 2% of captures wrongly refused | At most 5% |
| --- | --- | --- |
| Words | 54% | 51% |
| Best model alone (`bge-base-en-v1.5`) | 66% | 54% |
| Words and `bge-base-en-v1.5`, fused | 57% | 46% |

**Offering candidates works.** Ranked by words and meaning fused, the true duplicate is among the
first five candidates for 91% to 97% of the 35 probes that have one, and among the first ten for
94% to 100%. Words alone give 89% and 91%:

| Lane, across documents | First 1 | First 3 | First 5 | First 10 |
| --- | --- | --- | --- | --- |
| Words | 57% | 83% | 89% | 91% |
| Words and `nomic-embed-text-v1.5-Q` | 74% | 91% | 97% | 100% |
| Words and `bge-base-en-v1.5` | 80% | 94% | 94% | 97% |
| Words and `granite-embedding-small-english-r2` | 71% | 91% | 94% | 100% |
| Words and `potion-base-8M` (a static model) | 69% | 86% | 91% | 94% |

The meaning lane found 9 of the 99 duplicates that the words lane did not reach; the words lane
found 1 that no model did. Separating related from distinct is weak in every lane (the best area
under the curve is 0.75, best precision 0.65), so link candidates need a judgment too.

Throughput embedding in batches of 64 on an Apple M5's CPU, through ONNX: 9 to 78 statements a
second for the transformer models, and 17 700 for `potion-base-8M`, which is a lookup table and
needs no inference runtime.

**Limits.** Only pooled pairs are labelled, which biases both measures. A lane's own nearest
candidate may never have been labelled, so its wrong refusals are undercounted, most for the five
models that did not build the pool. Recall counts only duplicates the pool found, and an
unlabelled candidate ranked above a found one may itself be a duplicate, so the rates can be
wrong in either direction. 35 probes across documents have a duplicate, which is few. The weights
that fuse two lanes were chosen on the same labels. The store held about 3 200 ideas; a duplicate
falls further down the list as a store grows, so recall at a fixed number of candidates will
fall with it.

### 0.3 Can questions be answered from ideas?

[`results/bundles.counts.json`](results/bundles.counts.json).

**Method.** A model drafted twenty questions in the owner's voice from his own summary of the
subject: six lookups ("what do I think about"), four about a whole area, three about evidence,
three about tensions or changes of mind, and four that gather material for a piece. For each,
`ask.py` built a bundle of 25 of extractor `a`'s ideas by words and meaning fused (weight 0.7 on
`bge-base-en-v1.5`), with no links, themes or syntheses, since none exist yet. A judge, Claude Opus
5.5, answered each from its bundle alone and said what was missing. The questions are a model's,
not the owner's; the plan asks for twenty of his own.

| Kind | Questions | Fully | Partly | Not at all |
| --- | --- | --- | --- | --- |
| Lookup | 6 | 5 | 1 | 0 |
| Area | 4 | 0 | 4 | 0 |
| Evidence | 3 | 1 | 2 | 0 |
| Tension | 3 | 2 | 0 | 1 |
| Draft | 4 | 2 | 2 | 0 |
| All | 20 | 10 | 9 | 1 |

- **Lookups work from retrieval alone.** Five of six were answered fully.
- **What was missing was mostly relations.** The judge named how ideas bear on each other 11
  times, a view of the owner's 7, when a view was held 6, evidence 4 and a statement of the whole
  3. None of the four questions about a whole area was answered fully: three lacked relations
  and two a statement of the whole.
- **The links it asked for.** Refines 12 times, supersedes 8, part of 7, contradicts 5, supports
  4, example of 3. The judge chose from a list that differed from the plan's: it offered
  *supersedes* and *part of*, which the plan does not have, called *challenges* contradicts, and
  left out *depends-on* and *summarises*. So the two kinds it asked for are a lead, not a finding,
  until a judge chooses from the plan's own list.
- **The budget.** 25 was enough for 12 questions, too small for 6 and too large for 2. 37% of the
  ideas in a bundle had nothing to do with the question; 38% were used.

### 0.6 Does a hierarchy of framings fit ideas?

[`violet/README.md`](violet/README.md), [`violet/results.json`](violet/results.json). Invented
ideas, so this step touched no private material.

Violet's engine, as it is on `main`, holds ideas as composite values in a tree of framings. Of
fifteen checks, seven work as they are: an idea resolves everywhere, an override stays in its
framing, a change at the root reaches every framing that did not override, an omission hides an idea
from descendants, an idea of a framing's own, lineage, and compare. Copy works awkwardly: it follows
its source and cannot be pinned. Load and resolve are fast: 3 000 ideas load in about a quarter of a
second, a framing resolves in under 10 ms and two framings compare in about 35 ms.

What does not fit:

- Every gap the plan's P7 names is confirmed: no pinned copy, no reading the tree as it was, no
  change to one field of a value (a value given only `tags` is accepted and erases the
  statement), no preview of a batch across framings (one node and 50 changes at most), and no
  idea held back until released.
- Two the plan did not name. **An omission cannot be undone**: reset of an omitted idea is
  accepted and does nothing, and no command removes it. **Rules report and do not refuse**: a
  write that breaks a constraint is accepted and reported, and a rule is a regular expression
  over the value's JSON text.
- Design-token defaults ride along on every idea, and the engine refuses `framing` as a node type.

### 0.4 The sentence rule and attested (in part)

- **Whole sentences.** Over the 66 distinct sources, 23% of prose and list sentences end without
  a full stop, question mark, exclamation mark or colon, 83% of them list items. Table rows hold
  16% of the words and are never a sentence. 77 sentences run over 60 words.
- **How much would attest.** Of extractor `a`'s ideas from the owner's own writing, 48% are his
  prose or list sentences word for word; from research, 26%. On the 12 sources both read, `b` gave
  93% word for word and `a` 61%. The share that would attest depends more on the extractor than
  on the source.
- **Word for word is not always self-contained.** The reviewer found 8% of `a`'s and 22% of `b`'s
  word-for-word ideas depend on sentences around them, where restatements depend on them 2% and
  9% of the time.
- **Transcripts.** None was found by reading the file list; the count in the results is zero by
  construction, since no file was listed as one. The rule first guessed that a file of
  alternating labels ("Goal: ... Keywords: ...") was a conversation. No rule on the text tells
  labelled fields from speakers, so in rule version 3 whether a source is a transcript is a
  setting and nothing is guessed, as the plan's section 4.9 already has the deployer or the person
  decide.
- **Not measured.** How many attested statements the owner would disown, and how long a sitting of
  decisions takes. Both need the owner.

### 0.5 Do derived themes group ideas as the owner would? (in part)

[`results/themes.counts.json`](results/themes.counts.json).

**Method.** Extractor `a`'s 3 233 ideas, embedded with `bge-base-en-v1.5`, grouped two ways: a
graph that joins each idea to those of its ten nearest neighbours that also count it among
theirs, above a similarity floor, with themes as the graph's communities by label propagation in
a fixed order; and average-linkage clustering cut at a cosine distance. Each was run again with
`nomic-embed-text-v1.5-Q` to see whether the themes belong to the ideas or to the model. The
owner's own grouping is not yet given, so each idea's source document and section stand in for
it.

| Run | Themes | Ideas in a theme | Median size | Largest | Over 10 ideas | Across documents |
| --- | --- | --- | --- | --- | --- | --- |
| Graph, floor 0.70 | 473 | 91% | 4 | 47 | 68 | 82% |
| Graph, floor 0.75 | 457 | 71% | 3 | 46 | 47 | 78% |
| Graph, floor 0.80 | 376 | 41% | 3 | 24 | 14 | 70% |
| Tree, distance 0.25 | 682 | 63% | 2 | 38 | 9 | 69% |
| Tree, distance 0.30 | 656 | 84% | 3 | 135 | 37 | 75% |
| Tree, distance 0.35 | 469 | 95% | 3 | 358 | 50 | 83% |

- **Themes are only partly stable.** Two methods, or one method on two models, agree above chance
  and far from fully: an adjusted Rand index of 0.06 to 0.49 between methods (most pairs 0.13 to
  0.49) and 0.26 to 0.30 between models, where chance is 0 and identical groupings 1. Normalised
  mutual information looks high (0.78 to 0.96) but groupings of the same shapes shuffled at random
  score 0.54 to 0.91 on it, so it says little here. The model comparison also applied one similarity
  floor to two models whose similarities run on different scales. A theme is a view of the ideas at
  a moment, not something with an identity of its own.
- **The graph avoids one giant theme; the tree does not.** Cut loosely, the tree chains: at 0.35
  one theme holds 11% of all ideas. The graph's largest theme stays under 1.5%.
- **Themes cut across documents.** Seven to eight in ten join ideas from more than one document,
  and they agree only loosely with the documents' own sections (adjusted Rand index at most
  0.09). That is what themes are for: the same thought met in several places.
- **Not measured.** Whether they match how the owner groups his ideas. That needs his grouping of
  a sample, and is added to his check (Q5).

### 0.7 Records or documents?

From what 0.1 to 0.6 found. An archive of 115 000 words becomes about 3 200 statements of a median
23 words. Each needs its own standing, version, sources, links, themes and place in each framing;
matching, review, attested and erasure all act on one statement at a time, and Violet's engine
resolves thousands of such values in milliseconds. As documents, every idea would be a file of
two sentences with all of that in front matter, and the knowledge plugin's verify-by date and
proposals would act on files a person never reads. **Ideas are records**, indexed through P2, as
the plan's question 2 recommends.

## What this means for the plan

Each is proposed for the plugin's specification (step A3) and recorded in [STATUS.md](../STATUS.md).

1. **Matching offers; a model judges; refusal is the exception.** Every capture returns its nearest
   five to ten ideas with their wordings, and the calling model says whether one is the same idea.
   The engine refuses on its own only above a threshold that phase 0's labels show never refuses
   wrongly, which is for near-identical wording. Measure 1 becomes "the duplicate is offered", at
   rates set on a larger, owner-checked sample, plus a model's judgment of what is offered, held to
   the label agreement. How many candidates to offer depends on the size of the store.
2. **Both lanes.** Meaning adds 3 to 9 points of recall over words alone, at five candidates and
   at ten, on 35 probes. A static model (`potion-base-8M`) gives about a third of that gain,
   within noise at this size, with no inference runtime, which matters for a Rust host; a
   transformer model gives the rest. The choice belongs to the host's matching specification (P3,
   step A2).
3. **The unit holds, depending on the extractor.** Nine in ten of `a`'s ideas and three in four
   of `b`'s are the right size. The common fault is two ideas in one; the extraction prompt should
   say more about it, and the choice of extractor matters.
4. **Tags need a vocabulary.** Free tags scatter. The pack should hold the tags in use and offer
   them, which is job 27.
5. **Review load is large.** An archive of 115 000 words gives about 3 200 ideas, half of them
   restated. Attested standing takes the other half only if the sources are confirmed as the
   person's, and only with an extractor that keeps to whole sentences.
6. **Attested needs its context.** Between one in twelve and one in five word-for-word ideas lean on
   their neighbours, by extractor. A read of an attested idea should be able to return the sentences
   around it, and phase 0.4's check of what the owner would disown stays open.
7. **Themes are views; a synthesis attaches to its members.** The graph at a floor near 0.75 puts
   seven in ten ideas in a theme and never one giant theme, but its themes change with the method
   and the model. A synthesis should name the ideas it sums up, as the plan's section 4.7 has it,
   and never a theme by an id. A synthesis is worth asking for above about ten members, 47 themes
   in this archive. Both numbers wait on the owner's grouping, and each model needs its own floor.
8. **A later view is a link a model can state** (a lead from one judge and model-drafted
   questions, to confirm on the owner's twenty). In an archive nobody has reviewed, nothing is
   retired, so a question about a change of mind finds both views and cannot tell which came
   later. A model should be able to link a later view to an earlier one without retiring it,
   leaving retirement to the person, and a bundle should carry each idea's date.
9. **Part of** (the same lead). Ideas that are parts of one model or one list want a kind of their
   own; summarises runs the other way and is for syntheses.
10. **Bundles are relevant, not yet focused.** Retrieval alone gives a lookup what it needs. For
    an area or a tension the bundle needs the theme, the synthesis and the links around what it
    found, which is the plan's design; and a third of a bundle is noise that a model reranking
    the candidates, or a budget set by the kind of question, would remove.
11. **Framings fit, with seven engine changes.** The five P7 names, and two more: an omission must
    be releasable, and a rule must be able to refuse a write. A field-level change matters most
    for ideas, whose tags and type change far more often than their wording.
