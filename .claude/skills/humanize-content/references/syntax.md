# Syntactic and Structural Patterns Reference

Guide to identifying and correcting sentence-level and document-level patterns that signal AI generation.

## Punctuation Patterns

### The Em-Dash Problem

AI models overuse em-dashes as a structural crutch to insert explanatory clauses, create "thoughtful" pauses, and append additional context without new sentences.

**Detection:** Count em-dashes per document. More than 2-3 in a short piece suggests AI.

**Remediation:**

- Replace with commas for light interruptions
- Use parentheses for true asides
- Create new sentences for substantial additions
- Remove entirely if the clause is not essential

**Example:**

> Before: The project -- which had been in development for two years -- finally launched -- bringing with it a new era of productivity.

> After: The project launched after two years of development, bringing measurable productivity gains.

### The Oxford Comma Rigidity

AI consistently applies the Oxford comma because it reduces ambiguity mathematically. The pattern is not wrong -- it is the unfailing consistency that is the tell.

**Detection:** Check if every list uses Oxford comma, even in casual contexts.

**Remediation:**

- Vary usage based on context
- Omit in short, unambiguous lists
- Keep for complex lists where needed

**Example:**

> Before: She likes coffee, tea, and water. He prefers juice, soda, and milk. They enjoy breakfast, lunch, and dinner.

> After: She likes coffee, tea and water. He prefers juice, soda, and milk. They all enjoy good food.

### The Colon Header Pattern

AI uses "Topic: Description" structure for every list item.

**Detection:**

```
- Efficiency: The process was streamlined.
- Quality: The output improved significantly.
- Speed: The timeline was reduced.
```

**Remediation:**

- Vary list item structures
- Use complete sentences for some items
- Remove colons where unnecessary

**Better:**

```
- The streamlined process improved efficiency
- Output quality increased measurably
- Timeline dropped from 6 weeks to 4
```

## Sentence Structure Patterns

### The Uniform Length Problem (Low Burstiness)

AI produces sentences of remarkably consistent length and complexity. Human writing has bursts -- long explanations followed by short punches.

**Detection:** Check standard deviation of sentence lengths. AI text clusters around the mean.

**AI Pattern:**

> The new system improved efficiency across the organization. Team members reported higher satisfaction with the workflow. Customer complaints decreased significantly after implementation. The investment proved worthwhile for all stakeholders.

**Human Pattern:**

> The new system worked. Not just worked -- it transformed how the team operated. Customer complaints dropped 40% in the first month. People actually liked using it.

**Remediation Techniques:**

1. **Add fragments:** "Not just worked -- it transformed everything."
2. **Vary dramatically:** Follow 25-word sentence with 5-word punch
3. **Use questions:** "What changed? Everything."
4. **Allow run-ons:** Occasional conversational run-ons feel human

### The Perfect Grammar Problem

Paradoxically, flawless grammar signals AI. Human writing contains:

- Intentional fragments
- Conversational asides
- Occasional comma splices
- Starting sentences with "And" or "But"

**AI tells:**

- Never starts sentences with conjunctions
- No sentence fragments
- Perfect subject-verb agreement always
- Semicolons used "correctly" everywhere

**Remediation:**

- Start occasional sentence with "And" or "But"
- Include intentional fragment for emphasis
- Use conversational phrasing

**Example:**

> Before: Additionally, the team achieved significant results. Furthermore, they exceeded all expectations.

> After: The team achieved significant results. And exceeded expectations while doing it.

### The Topic-Evidence-Conclusion Template

AI paragraphs follow rigid structure:

1. Topic sentence (states the point)
2. Evidence/explanation (supports it)
3. Concluding thought (wraps it up)

Every. Single. Paragraph.

**Detection:** Check if every paragraph has exactly this structure.

**Remediation:**

- Start some paragraphs with evidence, not claims
- End mid-thought occasionally (continue in next paragraph)
- Vary paragraph lengths dramatically
- Use one-sentence paragraphs for impact

## Document-Level Patterns

### The Signposted Transitions

AI uses explicit transition markers between every paragraph: "Furthermore," "In addition," "Moreover," "Conversely," "On the other hand."

**Detection:** Count transition words per page. More than 3-4 suggests AI.

**Remediation:**

- Remove transition and let ideas connect semantically
- Use varied transitions: "This leads to...", "So...", "The result?"
- Start paragraphs with subject, not transition

### The Announcement Opening

AI often announces what it will do:

> "In this document, we will explore the key aspects of project management..."

Humans just start:

> "Project management breaks down into three areas..."

**Remediation:** Delete opening announcements. Start with content.

### The Explicit Conclusion

AI signals endings explicitly with "In conclusion," "To summarize," "In summary," "To wrap up."

**Remediation:** End naturally without announcement. The reader knows it is ending.

## Rhythm and Flow

### The Monotonous Cadence

AI text has a metronomic quality -- steady, predictable, even. Human writing has rhythm variation.

**Test:** Read text aloud. Does it sound like a robot reading a teleprompter?

**Remediation techniques:**

1. **Syllable variation:** Mix polysyllabic words with short Anglo-Saxon ones
2. **Sentence length waves:** Short. Medium length follows. Then a longer, more complex construction that takes time to parse. Short again.
3. **Paragraph length variation:** Use 1-sentence paragraphs strategically
4. **Questions:** Break monotony with rhetorical questions

### The Safety Tone

AI defaults to "neutral professional" -- confident but bland, helpful but devoid of personality.

**Characteristics:**

- No humor or irony
- No strong opinions
- No personal anecdotes
- No regional voice
- No idiosyncratic word choices

**Remediation:**

- Add opinion where appropriate
- Include specific examples from experience
- Use conversational phrases ("look," "here's the thing")
- Allow personality to emerge

## Quick Syntax Checklist

Before publishing, verify:

- [ ] Em-dashes appear no more than 2 times
- [ ] Sentence lengths vary (short + long)
- [ ] At least one sentence fragment exists
- [ ] At least one sentence starts with "And" or "But"
- [ ] Transition words appear fewer than 4 times
- [ ] No "In conclusion" or "To summarize"
- [ ] No "In this article, we will..."
- [ ] Paragraph lengths vary
- [ ] Text reads naturally aloud
