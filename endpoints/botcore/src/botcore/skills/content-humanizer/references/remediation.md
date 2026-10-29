# Remediation Strategies Reference

Practical techniques for transforming AI-generated content into natural, human-sounding text.

## Strategy 1: Voice Sample First, Flagged Patterns for Audits

When generating, lead with a short sample of the target voice and name the audience (see the SKILL.md "Lead Generation With a Voice Sample" example). A generation prompt that lists banned words can anchor the model toward them, so use the lists below when reviewing a draft.

### Vocabulary to Flag

```
delve, tapestry, landscape, realm, pivotal, crucial, foster, leverage,
underscore, embark, navigate, robust, seamless, cutting-edge,
groundbreaking, game-changing
```

### Structural Patterns to Flag

```
- "It is important to note"
- "In conclusion" or "To summarize"
- More than one em-dash per paragraph
- "Furthermore," "Moreover," "Additionally" as sentence starters
```

### Tonal Patterns to Flag

```
- Hedging phrases
- Both-sides framing when taking a position
- Vague attributions ("some argue," "many believe")
- Announcing what you will discuss before discussing it
```

## Strategy 2: Perplexity Injection

Force variation and unpredictability into the text.

### Sentence Length Variation

Transform uniform sentences into varied rhythm:

**Before (uniform ~15 words each):**

> The project launched successfully last quarter. Team satisfaction improved across all departments. Customer feedback has been overwhelmingly positive. We anticipate continued growth.

**After (varied 4-25 words):**

> The project launched last quarter. Every department reports higher satisfaction. Customer feedback? Overwhelmingly positive. We expect the growth to continue.

### Vocabulary Variation

Replace repeated patterns with varied alternatives:

**Before:**

> The initiative played a crucial role. Security plays a crucial role. Communication plays a crucial role.

**After:**

> The initiative drove adoption. Security prevents breaches. Communication keeps teams aligned.

### Structure Variation

Mix sentence types:

- Declarative (statements)
- Interrogative (questions)
- Imperative (commands)
- Fragments (intentional incomplete sentences)

## Strategy 3: Grounded Specificity

Replace abstract claims with concrete details -- only details you can verify from the source material, the user, or a cited reference. Never invent numbers, names, dates, or quotes; a fabricated statistic is worse than a vague claim.

### The Abstraction Problem

AI defaults to abstract, unfalsifiable claims because they are "safe."

**Before (abstract):**

> This serves as a stark reminder of the crucial role that security plays in modern organizations.

**After (specific, figures from the incident report):**

> The breach exposed 2.3 million records in 48 hours -- exactly what proper encryption prevents.

### Specificity Techniques

1. **Numbers:** replace "significant improvement" with the measured figure from the report or dataset
2. **Names:** replace "industry leaders" with the people or organizations the source actually cites
3. **Examples:** replace "various tools" with the tools the project actually uses
4. **Timeframes:** replace "recently" with the date from the changelog, ticket, or source
5. **Consequences:** replace "important" with the measured effect, if one was measured

If no verified detail exists, state the claim plainly, cut it, or mark `[source needed]` for the author.

### Before/After Examples

| Abstract | Specific | Where the Detail Must Come From |
|---|---|---|
| The team achieved significant results | The team shipped 3 features ahead of schedule | Sprint report or release notes |
| Many users reported positive experiences | 847 users rated the feature 4.5/5 | Survey or analytics export |
| The process was streamlined | Processing time dropped from 6 hours to 45 minutes | Before/after measurement |
| Experts recommend this approach | [Named study you have read] recommends this | A citation you can link |

## Strategy 4: Voice Injection

Add personality and human idiosyncrasy.

### Conversational Markers

Add phrases humans use in speech:

- "Look," / "Here's the thing,"
- "Actually," / "Honestly,"
- "The real question is..."
- "What surprised me was..."

### Opinion Statements

Replace neutral framing with position:

**Before (neutral):**

> There are various approaches to this problem, each with merits and drawbacks.

**After (opinionated):**

> The waterfall approach wastes time. Agile works better for most product teams.

### Personal Reference

Where the author actually had the experience, add it in first person -- never invent one:

**Before:**

> Organizations often struggle with this transition.

**After:**

> We struggled with this transition for six months before finding what worked.

## Strategy 5: Structural Humanization

Break rigid AI patterns with intentional variation.

### Paragraph Restructuring

**AI pattern:** Every paragraph = Topic then Evidence then Conclusion

**Human variation:**

- Start with evidence, reveal point at end
- One-sentence paragraph for impact
- Continue thought across paragraph break
- End paragraph mid-thought

### List Restructuring

**AI pattern:**

```
- Topic 1: Description of topic 1
- Topic 2: Description of topic 2
- Topic 3: Description of topic 3
```

**Human variation:**

```
- Start with the biggest impact: the efficiency gain
- Team satisfaction improved too
- And costs dropped
```

### Opening Restructuring

**AI pattern:**

> In this article, we will explore the key principles of effective communication.

**Human pattern:**

> Good communication comes down to three things.

### Closing Restructuring

**AI pattern:**

> In conclusion, these strategies can significantly improve your outcomes.

**Human pattern:**

> Try one of these this week. See what happens.

## Strategy 6: The Read-Aloud Test

The most reliable human detector is reading text aloud.

### What to Listen For

1. **Monotony:** Does every sentence sound the same?
2. **Formality mismatch:** Does casual content sound like a legal document?
3. **Awkward phrasing:** Would a human actually say this?
4. **Robotic cadence:** Does it sound like a text-to-speech engine?

### Adjustment Process

1. Read paragraph aloud
2. Mark sentences that feel unnatural
3. Rewrite marked sentences as you would speak them
4. Read again to verify improvement

## Transformation Checklist

For each piece of content:

### Vocabulary Pass

- [ ] Searched for Tier 1 flagged words
- [ ] Replaced with specific alternatives
- [ ] Verified replacements fit context

### Structure Pass

- [ ] Varied sentence lengths
- [ ] Added at least one fragment or short sentence
- [ ] Removed explicit transitions where unnecessary
- [ ] Eliminated opening/closing announcements

### Specificity Pass

- [ ] Replaced abstract claims with concrete examples
- [ ] Added numbers only where a source provides them
- [ ] Every name, number, date, and quote traces to a source -- none invented

### Voice Pass

- [ ] Added conversational markers where appropriate
- [ ] Included opinion or perspective
- [ ] Verified tone matches audience

### Final Pass

- [ ] Read entire piece aloud
- [ ] Fixed remaining awkward phrases
- [ ] Confirmed natural rhythm

## Common Transformation Pairs

| AI Version | Human Version |
|---|---|
| It is important to note that X | X |
| delve into | look at, explore |
| rich tapestry of | mix of, variety of |
| plays a crucial role | matters, helps, affects |
| in today's fast-paced world | now, today |
| leverage best practices | use what works |
| a stark reminder | shows, proves |
| navigate challenges | handle problems |
| foster collaboration | build teamwork |
| seamless integration | works together |
| cutting-edge technology | new tech, modern tools |
| groundbreaking approach | new approach |
| paramount importance | critical, essential |
| Furthermore, | Also, Plus, And |
| In conclusion, | (end naturally) |
