---
name: humanize-content
description: >
  Identify and remediate AI-generated text patterns. Covers lexical signatures,
  syntactic rigidity, and structural tells that flag content as machine-written.
  Use when reviewing content for authenticity, improving AI drafts, or eliminating
  robotic writing patterns.
version: "1.0.0"
triggers:
  - humanize
  - AI detection
  - sounds like AI
  - robotic writing
  - delve
  - AI tells
  - machine-written
  - synthetic text
  - ai content
  - humanize content
  - ai patterns
  - writing style
portable: true
---

# Humanize Content

Expert guidance for identifying and eliminating AI-generated text patterns to create more authentic, human-sounding content.

## Capabilities

1. **Detect AI Patterns** — Identify lexical, syntactic, and structural tells in content
2. **Remediate Text** — Transform robotic patterns into natural human voice
3. **Review Content** — Audit documents for AI fingerprints before publishing
4. **Guide Writing** — Apply techniques to prevent AI patterns during generation

## Routing Logic

| Request type                                        | Load reference                                         |
| --------------------------------------------------- | ------------------------------------------------------ |
| Flagged vocabulary, banned words, lexical tells     | [references/vocabulary.md](references/vocabulary.md)   |
| Punctuation, sentence structure, syntactic patterns | [references/syntax.md](references/syntax.md)           |
| Remediation techniques, transformation strategies   | [references/remediation.md](references/remediation.md) |

## Core Principles

### 1. AI Patterns Are Statistical Artifacts

AI text isn't "bad"—it's probabilistically average. Models optimize for the most likely next token, resulting in:

- Overused academic vocabulary (training data bias)
- Excessive hedging (safety alignment)
- Uniform sentence length (low burstiness)
- Grammatical perfection (lack of human idiosyncrasy)

Detection isn't about finding errors—it's about finding the absence of human variance.

### 2. Remediation Over Detection

The goal isn't to "catch" AI text—it's to improve it. Focus on:

- Replacing flagged vocabulary with specific, concrete alternatives
- Varying sentence structure and length
- Adding authentic voice through specificity
- Removing hedging and safety buffers when appropriate

### 3. Context Determines Appropriateness

Some "AI tells" are acceptable in formal contexts:

- Oxford comma is fine in technical documentation
- Transitional phrases are expected in academic writing
- Structured lists belong in how-to content

The issue is when these patterns appear where they don't belong—or when they appear in every paragraph without variation.

## Quick Reference: High-Priority Flags

### Tier 1: Immediate Red Flags (Replace Always)

| Word/Phrase            | Frequency Multiplier | Replacements                           |
| ---------------------- | -------------------- | -------------------------------------- |
| delve                  | ~1000x               | explore, examine, investigate, look at |
| tapestry               | ~500x                | mix, combination, collection           |
| landscape              | ~300x                | field, area, context, situation        |
| a stark reminder       | 166x                 | shows, demonstrates, proves            |
| play a crucial role    | 151x                 | matter, contribute, help, affect       |
| It's important to note | ~100x                | Note that, (often remove entirely)     |
| rich tapestry          | ~200x                | diverse mix, varied collection         |

### Tier 2: Structural Tells (Vary or Remove)

- **Em-dash overuse** — Limit to 1-2 per document
- **Colon headers** — "Topic: Description" in every bullet
- **Oxford comma rigidity** — Vary usage contextually
- **"In conclusion" / "In summary"** — End naturally instead

### Tier 3: Tonal Patterns (Adjust for Voice)

- **Hedging** — "It is worth mentioning" → state directly
- **Both-sidesism** — "On the other hand" when unnecessary
- **Vague attributions** — "Some experts argue" → name sources
- **Hollow sophistication** — "realm," "era," "symphony" for mundane topics

## Workflow

1. **Scan** — Identify flagged vocabulary and patterns
2. **Assess** — Determine which patterns are contextually inappropriate
3. **Transform** — Replace with specific, concrete alternatives
4. **Vary** — Introduce sentence length variation and structural diversity
5. **Verify** — Read aloud to check for natural rhythm

## Checklist

Before publishing AI-assisted content:

- [ ] No Tier 1 flagged vocabulary remains
- [ ] Sentence lengths vary (mix short punchy with longer complex)
- [ ] Em-dashes appear ≤2 times in document
- [ ] No "In conclusion" or explicit signposting
- [ ] Hedging phrases removed or replaced with direct statements
- [ ] At least one sentence fragment or intentional variation
- [ ] Content includes specific examples, not just abstract claims
- [ ] Read aloud passes the "robot voice" test

## Common Transformations

### Before → After Examples

**Hedging removal:**

> ❌ It is important to note that the new policy has had significant impact.
> ✅ The new policy reduced processing time by 40%.

**Vocabulary replacement:**

> ❌ Let's delve into the rich tapestry of content design principles.
> ✅ Here's how content design principles work in practice.

**Specificity injection:**

> ❌ This serves as a stark reminder of the crucial role that security plays.
> ✅ The breach exposed 2.3 million records—exactly what security protocols prevent.

**Structure variation:**

> ❌ Furthermore, the implementation was successful. Additionally, the team exceeded expectations. Moreover, costs were reduced.
> ✅ The implementation succeeded. The team exceeded expectations. Costs dropped 15%.

## When to Escalate

- Content requires domain expertise beyond vocabulary substitution
- Original meaning would be lost through transformation
- Formal academic context where some patterns are appropriate
- Legal or compliance content where hedging is required
