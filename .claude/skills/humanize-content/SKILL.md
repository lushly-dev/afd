---
name: humanize-content
source: botcore
description: >
  Identifies and remediates AI-generated text patterns including lexical signatures, syntactic rigidity, and structural tells that flag content as machine-written. Covers vocabulary replacement, sentence variation, specificity injection, and voice transformation across all content types. Use when reviewing content for authenticity, improving AI drafts, eliminating robotic writing patterns, or auditing text before publishing. Triggers: humanize, AI detection, sounds like AI, robotic writing, AI tells, machine-written, synthetic text, ai content, ai patterns, writing style.

version: 1.0.0
triggers:
  - humanize
  - AI detection
  - sounds like AI
  - robotic writing
  - AI tells
  - machine-written
  - synthetic text
  - ai content
  - humanize content
  - ai patterns
  - writing style
portable: true
---

# Humanizing Content

Identify and eliminate AI-generated text patterns to create authentic, human-sounding content.

## Capabilities

1. **Detect AI Patterns** -- Identify lexical, syntactic, and structural tells across any content
2. **Remediate Text** -- Transform robotic patterns into natural human voice using proven strategies
3. **Audit Content** -- Review documents for AI fingerprints before publishing
4. **Guide Generation** -- Apply negative constraints and variation techniques to prevent AI patterns during writing
5. **Inject Specificity** -- Replace abstract, unfalsifiable claims with concrete details, numbers, and named sources
6. **Inject Voice** -- Add personality, opinion, and conversational markers to break neutral-professional tone

## Routing Logic

| Request Type | Reference |
|---|---|
| Flagged vocabulary, banned words, lexical tells | [vocabulary.md](references/vocabulary.md) |
| Punctuation, sentence structure, syntactic patterns | [syntax.md](references/syntax.md) |
| Remediation techniques, transformation strategies | [remediation.md](references/remediation.md) |

## Core Principles

### 1. AI Patterns Are Statistical Artifacts

AI text is probabilistically average. Models optimize for the most likely next token, producing:

- Overused academic vocabulary (training data bias)
- Excessive hedging (safety alignment)
- Uniform sentence length (low burstiness)
- Grammatical perfection (lack of human idiosyncrasy)

Detection is about finding the absence of human variance, not finding errors.

### 2. Remediation Over Detection

The goal is to improve AI text, not catch it. Focus on:

- Replacing flagged vocabulary with specific, concrete alternatives
- Varying sentence structure and length dramatically
- Adding authentic voice through specificity and opinion
- Removing hedging and safety buffers when appropriate

### 3. Context Determines Appropriateness

Some AI tells are acceptable in formal contexts. Oxford commas belong in technical docs. Transitional phrases are expected in academic writing. Structured lists suit how-to content. The problem is when these patterns appear everywhere without variation.

### 4. Specificity Beats Abstraction

AI defaults to abstract, unfalsifiable claims because they are safe. Replace "significant improvement" with "40% improvement." Replace "industry leaders" with named people. Replace "recently" with "last Tuesday." Concrete details are the strongest humanization tool.

## Workflow

1. **Scan** -- Run vocabulary check against Tier 1 flagged words (see [vocabulary.md](references/vocabulary.md))
2. **Assess** -- Determine which patterns are contextually inappropriate vs. acceptable
3. **Transform** -- Replace flagged vocabulary with specific, concrete alternatives
4. **Vary** -- Introduce sentence length variation, structural diversity, and mixed sentence types
5. **Inject** -- Add specificity (numbers, names, examples) and voice (opinion, conversational markers)
6. **Verify** -- Read aloud to check for natural rhythm; apply the read-aloud test

## Quick Reference: High-Priority Flags

### Tier 1: Immediate Red Flags (Replace Always)

Words appearing 100x+ more frequently in AI text than human writing:

| Word/Phrase | Freq | Replacements |
|---|---|---|
| delve / delve into | ~1000x | explore, examine, investigate, look at |
| tapestry | ~500x | mix, combination, collection, range |
| landscape | ~300x | field, area, space, context |
| a stark reminder | 166x | shows, demonstrates, proves |
| play a crucial role | 151x | matter, contribute, help, affect |
| embark | ~200x | start, begin, launch, kick off |
| navigate | ~150x | work through, handle, manage |
| It is important to note | ~100x | Note that, or remove entirely |

### Tier 2: Structural Tells (Vary or Remove)

- **Em-dash overuse** -- Limit to 1-2 per document; replace with commas, parentheses, or new sentences
- **Colon headers** -- "Topic: Description" in every bullet; vary list item structures instead
- **Oxford comma rigidity** -- Vary usage contextually; omit in short unambiguous lists
- **Explicit signposting** -- "In conclusion" / "In summary" / "In this article we will" -- remove entirely

### Tier 3: Tonal Patterns (Adjust for Voice)

- **Hedging** -- "It is worth mentioning" -- state directly or remove
- **Both-sidesism** -- "On the other hand" when unnecessary -- take a position
- **Vague attributions** -- "Some experts argue" -- name specific sources
- **Hollow sophistication** -- "realm," "era," "symphony" for mundane topics -- use plain words

## Key Remediation Strategies

### Negative Constraints

Block high-probability AI paths by banning common patterns in prompts or edits:

- Ban Tier 1 vocabulary (delve, tapestry, landscape, realm, pivotal, crucial, foster, leverage)
- Ban structural tells ("It is important to note," "In conclusion," stacked em-dashes)
- Ban tonal patterns (hedging phrases, both-sides framing, vague attributions)

### Perplexity Injection

Force variation and unpredictability:

- **Sentence length waves** -- Short. Medium follows. Then a longer, more complex construction. Short again.
- **Mixed sentence types** -- Declarative, interrogative, imperative, and fragments
- **Vocabulary variation** -- Never repeat the same pattern phrase; use different verbs and structures

### Specificity Injection

Replace abstract claims with concrete details:

- Add numbers: "significant improvement" becomes "40% improvement"
- Add names: "industry leaders" becomes "Satya Nadella and Jensen Huang"
- Add examples: "various tools" becomes "Figma, VS Code, and Copilot"
- Add timeframes: "recently" becomes "last Tuesday"

### Voice Injection

Add personality and human idiosyncrasy:

- Conversational markers: "Look," "Here's the thing," "Actually,"
- Opinion statements replacing neutral framing
- Intentional fragments and sentences starting with "And" or "But"
- One-sentence paragraphs for impact

## Common Transformations

**Hedging removal:**
> Before: It is important to note that the new policy has had significant impact.
> After: The new policy reduced processing time by 40%.

**Vocabulary replacement:**
> Before: Let's delve into the rich tapestry of content design principles.
> After: Here's how content design principles work in practice.

**Specificity injection:**
> Before: This serves as a stark reminder of the crucial role that security plays.
> After: The breach exposed 2.3 million records in 48 hours -- exactly what proper encryption prevents.

**Structure variation:**
> Before: Furthermore, the implementation was successful. Additionally, the team exceeded expectations. Moreover, costs were reduced.
> After: The implementation succeeded. The team exceeded expectations. Costs dropped 15%.

## Checklist

Before publishing AI-assisted content:

- [ ] No Tier 1 flagged vocabulary remains (delve, tapestry, landscape, stark reminder, crucial role)
- [ ] Sentence lengths vary (mix short punchy with longer complex)
- [ ] Em-dashes appear no more than 2 times in the document
- [ ] No "In conclusion," "In summary," or explicit signposting
- [ ] Hedging phrases removed or replaced with direct statements
- [ ] At least one sentence fragment or intentional grammatical variation
- [ ] Content includes specific examples, numbers, or named sources -- not just abstract claims
- [ ] No stacked transitions (Furthermore / Additionally / Moreover in sequence)
- [ ] Vague attributions replaced with specific sources
- [ ] Read aloud passes the "robot voice" test -- natural rhythm, no monotonous cadence

## When to Escalate

- Content requires domain expertise beyond vocabulary substitution
- Original meaning would be lost through transformation
- Formal academic context where some AI patterns are appropriate and expected
- Legal or compliance content where hedging language is required
- Client or brand voice guide conflicts with humanization rules
