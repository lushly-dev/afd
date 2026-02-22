# Accessibility Q&A -- Targeted Guidance

Focused troubleshooting and guidance for specific accessibility questions, patterns, and decisions.

## Purpose

This file handles **targeted questions and problem-solving** that do not require a full structured artifact review. Use it when the user is asking for help with a specific accessibility issue, pattern, or decision.

Examples:
- "Should I use `role="dialog"` or a native `<dialog>` element here?"
- "How do I fix this focus trap problem in my modal?"
- "What is the best way to expose this custom control to screen readers?"
- "Why is this pattern considered an accessibility anti-pattern?"

## Session Flow

1. **Clarify the question and context**
   - What component, flow, or platform is involved?
   - What is the user trying to achieve, and what is currently going wrong?

2. **Identify relevant specialists**
   - Map the question to relevant assistive-tech, UX pattern, or standards references.

3. **Provide targeted guidance**
   - Explain the issue or decision in clear, concise terms.
   - Offer specific markup, interaction, or content recommendations.
   - When helpful, show short code or pseudo-code snippets.

4. **Suggest next steps**
   - If the question suggests broader risks, recommend running a full accessibility review via the master entry point.
   - Point to relevant standards as informational context only.

## Output Format

1. **Direct answer** to the question in plain language.
2. **Rationale and user impact** so the team understands why it matters.
3. **Concrete recommendations or examples** that can be applied immediately.
4. **Optional references or next steps**, such as running a full review or consulting specific specialist files.

## Common Mistakes

- Answering without clarifying platform, component type, and constraints.
- Jumping to ARIA-heavy solutions instead of starting with native semantics.
- Presenting guidance as a definitive compliance/legal interpretation rather than technical best practice.
- Forgetting to suggest validation steps (keyboard test, screen reader spot-check, zoom) to confirm the fix.
