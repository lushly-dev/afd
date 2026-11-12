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
| [`match.py`](match.py) | 0.2 | Embeds statements with local models, pools candidate pairs for labelling, and reports how each lane sorts them |
| [`prompts/label-pairs.md`](prompts/label-pairs.md), [`prompts/review-units.md`](prompts/review-units.md) | 0.2, 0.1 | The labelling and review prompts |
| [`test_prototype.py`](test_prototype.py) | | Tests on invented fixtures |

```sh
uv run --python 3.12 --with pytest --with numpy --with snowballstemmer \
    pytest docs/features/active/ideas/prototype -q
```

Python 3.10 or later. `corpus.py`, `sentences.py` and `ideas.py` use the standard library only;
`match.py` needs `numpy` and `snowballstemmer`, and `fastembed` to embed.

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
