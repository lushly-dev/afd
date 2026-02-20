# Flagged Vocabulary Reference

Comprehensive list of words and phrases that signal AI-generated content, organized by category and severity.

## Tier 1: Critical Flags (Replace Always)

These words appear 100x+ more frequently in AI text than human writing. Replace in all contexts.

### Transitional Verbs

| Flagged            | Frequency | Alternatives                                             |
| ------------------ | --------- | -------------------------------------------------------- |
| delve / delve into | ~1000x    | explore, examine, investigate, look at, dig into, unpack |
| embark             | ~200x     | start, begin, launch, kick off                           |
| navigate           | ~150x     | work through, handle, manage, figure out                 |
| underscore         | ~100x     | emphasize, highlight, show                               |
| foster             | ~100x     | encourage, build, develop, grow                          |
| leverage           | ~80x      | use, apply, take advantage of                            |

### Metaphorical Nouns

| Flagged     | Frequency | Alternatives                           |
| ----------- | --------- | -------------------------------------- |
| tapestry    | ~500x     | mix, combination, collection, range    |
| landscape   | ~300x     | field, area, space, context, situation |
| realm       | ~200x     | area, field, domain, world             |
| symphony    | ~150x     | combination, blend, mix                |
| mosaic      | ~100x     | mix, variety, collection               |
| cornerstone | ~100x     | foundation, basis, key element         |
| bedrock     | ~80x      | foundation, base, core                 |
| pillar      | ~80x      | support, element, component            |

### Intensifying Phrases

| Flagged                        | Frequency | Alternatives                             |
| ------------------------------ | --------- | ---------------------------------------- |
| a stark reminder               | 166x      | shows, demonstrates, proves, is evidence |
| play a crucial role            | 151x      | matter, contribute to, help, affect      |
| pivotal role                   | 120x      | key part, important function             |
| of paramount importance        | 100x      | critical, essential, necessary           |
| in today's fast-paced world    | ~200x     | now, currently, today                    |
| in the ever-evolving landscape | ~150x     | as X changes, with changes to X          |

### Hollow Qualifiers

| Flagged        | Frequency             | Alternatives                  |
| -------------- | --------------------- | ----------------------------- |
| rich           | (with tapestry) ~200x | diverse, varied, wide         |
| robust         | ~100x                 | strong, solid, reliable       |
| seamless       | ~100x                 | smooth, easy, simple          |
| cutting-edge   | ~80x                  | new, modern, advanced         |
| groundbreaking | ~80x                  | new, innovative, novel        |
| game-changing  | ~80x                  | significant, important, major |

## Tier 2: Hedging and Safety Buffers

These phrases appear when AI is being "careful." Often removable.

### Pre-statement Hedges

| Flagged                      | Alternative                                |
| ---------------------------- | ------------------------------------------ |
| It is important to note that | Note that (or remove entirely)             |
| It is worth mentioning that  | (remove—just state the thing)              |
| It should be noted that      | (remove)                                   |
| It bears mentioning that     | (remove)                                   |
| One might argue that         | (state directly or attribute specifically) |

### Mid-statement Hedges

| Flagged                            | Alternative                                     |
| ---------------------------------- | ----------------------------------------------- |
| However, it is crucial to consider | But, However,                                   |
| On the other hand                  | (remove if not presenting genuine alternatives) |
| Conversely                         | But, However, (or remove)                       |
| That being said                    | But, Still,                                     |
| With that in mind                  | So, Given this,                                 |

### Post-statement Hedges

| Flagged                   | Alternative       |
| ------------------------- | ----------------- |
| ...and so on and so forth | etc., and more    |
| ...among others           | (often removable) |
| ...to name a few          | (often removable) |

## Tier 3: Structural Signposts

These are appropriate in formal writing but flag as AI when overused or misplaced.

### Opening Signposts

| Flagged                             | When to Use | When to Remove            |
| ----------------------------------- | ----------- | ------------------------- |
| In this article, we will explore... | Never       | Always—just start writing |
| Let's delve into...                 | Never       | Always                    |
| In order to understand...           | Rarely      | Usually—just explain      |

### Transitional Signposts

| Flagged      | When to Use     | Alternative     |
| ------------ | --------------- | --------------- |
| Furthermore  | Formal/academic | Also, Plus, And |
| Moreover     | Formal/academic | Also, Plus, And |
| Additionally | Formal/academic | Also, Plus, And |
| In addition  | Formal/academic | Also, Plus, And |

### Closing Signposts

| Flagged       | When to Use          | Alternative     |
| ------------- | -------------------- | --------------- |
| In conclusion | Academic papers only | (end naturally) |
| In summary    | Long technical docs  | (end naturally) |
| To summarize  | Long technical docs  | (end naturally) |
| All in all    | Never                | (end naturally) |

## Tier 4: Vague Attributions

Wikipedia editors specifically flag these as AI indicators.

| Flagged                    | Alternative                         |
| -------------------------- | ----------------------------------- |
| Some argue that...         | [Author/School] argues that...      |
| Many experts believe...    | [Specific experts] found that...    |
| It is widely considered... | Research shows... (with citation)   |
| Studies have shown...      | [Specific study] found...           |
| Research suggests...       | [Specific research] demonstrates... |

## Tier 5: Grandiloquent Register

Words that attempt "hollow sophistication"—elevated language for mundane topics.

### Context-Inappropriate Elevation

| Flagged  | Context Where Inappropriate                          |
| -------- | ---------------------------------------------------- |
| tapestry | describing business processes, code, data            |
| symphony | describing workflows, systems, methods               |
| realm    | describing any concrete domain                       |
| era      | describing anything less than decades                |
| epoch    | almost any business context                          |
| paradigm | most contexts (use "approach" or "model")            |
| holistic | most contexts (use "complete" or "full")             |
| synergy  | almost always (use "combination" or "collaboration") |

### The "Vibrant" Problem

AI loves these energetic but vague adjectives:

- vibrant → active, busy, growing
- dynamic → changing, active, varied
- thriving → successful, growing, healthy
- bustling → busy, active
- burgeoning → growing, expanding

## Word Replacement Strategy

### Step 1: Identify the Core Meaning

Ask: What is this word actually saying?

- "delve into" = look at closely
- "rich tapestry" = varied collection
- "navigate challenges" = deal with problems

### Step 2: Choose Concrete Alternative

Select based on:

- Specificity (prefer precise over general)
- Register (match formality to context)
- Rhythm (vary syllable counts)

### Step 3: Verify Natural Flow

Read the sentence aloud. Does it sound like something a human would say in conversation?

## Frequency Multiplier Sources

Frequency multipliers based on research analyzing millions of documents comparing AI output vs. human baseline:

- "Delve" analysis from academic paper submissions (arXiv)
- "Stark reminder" from GPTZero vocabulary studies
- General frequencies from Wikipedia AI detection research
