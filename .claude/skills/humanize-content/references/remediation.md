# Remediation Strategies Reference

Practical techniques for transforming AI-generated content into natural, human-sounding text.

## Strategy 1: Negative Constraints

Block high-probability AI paths by explicitly prohibiting common patterns.

### Vocabulary Constraints

When prompting or editing, explicitly ban:

```
Do not use these words: delve, tapestry, landscape, realm, pivotal,
crucial, foster, leverage, underscore, embark, navigate, robust,
seamless, cutting-edge, groundbreaking, game-changing
```

### Structural Constraints

```
Do not use:
- "It is important to note"
- "In conclusion" or "To summarize"
- More than one em-dash per paragraph
- "Furthermore," "Moreover," "Additionally" as sentence starters
```

### Tonal Constraints

```
Avoid:
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

> The project launched. Not just launched—it exceeded every metric we tracked. Team satisfaction jumped. Customer feedback? Overwhelmingly positive. Growth looks inevitable.

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

## Strategy 3: Specificity Injection

Replace abstract claims with concrete details.

### The Abstraction Problem

AI defaults to abstract, unfalsifiable claims because they're "safe."

**Before (abstract):**

> This serves as a stark reminder of the crucial role that security plays in modern organizations.

**After (specific):**

> The breach exposed 2.3 million records in 48 hours—exactly what proper encryption prevents.

### Specificity Techniques

1. **Add numbers:** "significant improvement" → "40% improvement"
2. **Add names:** "industry leaders" → "Satya Nadella and Jensen Huang"
3. **Add examples:** "various tools" → "Figma, VS Code, and Copilot"
4. **Add timeframes:** "recently" → "last Tuesday"
5. **Add consequences:** "important" → "saves 3 hours per week"

### Before/After Examples

| Abstract                                 | Specific                                             |
| ---------------------------------------- | ---------------------------------------------------- |
| The team achieved significant results    | The team shipped 3 features ahead of schedule        |
| Many users reported positive experiences | 847 users rated the feature 4.5/5                    |
| The process was streamlined              | Processing time dropped from 6 hours to 45 minutes   |
| Experts recommend this approach          | Nielsen Norman Group's 2024 research recommends this |

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

> The waterfall approach wastes time. Agile works better for 90% of teams.

### Personal Reference

Where appropriate, add first-person experience:

**Before:**

> Organizations often struggle with this transition.

**After:**

> We struggled with this transition for six months before finding what worked.

## Strategy 5: Structural Humanization

Break rigid AI patterns with intentional variation.

### Paragraph Restructuring

**AI pattern:** Every paragraph = Topic → Evidence → Conclusion

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
- Start with the biggest impact: the 40% efficiency gain
- Team satisfaction improved too
- And costs dropped—not by a little, by 15%
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
- [ ] Added numbers where possible
- [ ] Named specific people/tools/sources

### Voice Pass

- [ ] Added conversational markers where appropriate
- [ ] Included opinion or perspective
- [ ] Verified tone matches audience

### Final Pass

- [ ] Read entire piece aloud
- [ ] Fixed remaining awkward phrases
- [ ] Confirmed natural rhythm

## Common Transformation Pairs

| AI Version                     | Human Version           |
| ------------------------------ | ----------------------- |
| It is important to note that X | X                       |
| delve into                     | look at, explore        |
| rich tapestry of               | mix of, variety of      |
| plays a crucial role           | matters, helps, affects |
| in today's fast-paced world    | now, today              |
| leverage best practices        | use what works          |
| a stark reminder               | shows, proves           |
| navigate challenges            | handle problems         |
| foster collaboration           | build teamwork          |
| seamless integration           | works together          |
| cutting-edge technology        | new tech, modern tools  |
| groundbreaking approach        | new approach            |
| paramount importance           | critical, essential     |
| Furthermore,                   | Also, Plus, And         |
| In conclusion,                 | (end naturally)         |
