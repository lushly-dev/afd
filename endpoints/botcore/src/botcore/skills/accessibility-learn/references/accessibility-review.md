# Accessibility Review -- Master Entry Point

Orchestrates structured accessibility reviews by routing to specialist references based on artifact type, assistive technologies, and standards.

## Purpose

This file is the single entry point for full accessibility reviews. It provides high-level instructions and routing context to:

- Analyze the artifact type and interaction patterns.
- Identify relevant assistive technologies and user needs.
- Map issues to applicable standards and regulatory frameworks (informational, not legal advice).
- Route to the most relevant specialist references in this skill.

Use this file when the primary goal is a **structured accessibility review of an artifact** (design, spec, implementation, or flow).

If the user is instead:

- Asking a **targeted how-to or troubleshooting question**, prefer `references/accessibility-qna.md`.

## Session Initialization

At the start of an accessibility review conversation:

1. **Clarify the artifact and scope**
   - What are we reviewing (design, spec, implementation, specific flow)?
   - Which user journeys or tasks are in scope?

2. **Ask for the user's role (optional but recommended)**
   - Designer -- emphasize interaction patterns, flows, hierarchy, and copy.
   - Developer/engineer -- emphasize DOM/markup, ARIA, code patterns, and testing.
   - Product/PM -- emphasize user impact, risk, prioritization, and success criteria.
   - QA/research -- emphasize reproducible test steps and what to observe.

3. **Identify key assistive technologies and standards overlays**
   - Which ATs matter most (screen reader, keyboard, magnification, speech, switch, braille, eye tracking)?
   - Which jurisdiction/sector overlays might be relevant (ADA, Section 508, EN 301 549/EAA, ACA, CVAA)?

## Smart Routing Heuristics

- **Screenshots or design frames** -- Lean on spec-review and UX pattern specialists.
- **Detailed specs** (tab order, roles, behavior) -- Use spec-review plus assistive-tech specialists.
- **Code or running experience** -- Combine WCAG + AT specialists + relevant UX patterns.
- **Specific AT called out** (e.g., "screen readers") -- Prioritize that AT specialist.
- **Jurisdiction or law mentioned** (e.g., ADA, 508) -- Load matching standards reference as a context overlay.

## Review Workflow

1. **Identify artifact and scope** -- Confirm what is being reviewed and which flows are in scope.
2. **Select relevant AT and standards** -- Choose appropriate specialist references.
3. **Analyze** -- Use specialists to inspect structure, interaction, and content.
4. **Document issues** -- Capture impact, location, affected users/AT, WCAG criteria, and remediation.
5. **Prioritize and summarize** -- Group by severity, provide summary and next steps.

## Output Format

1. **Quick summary** of overall accessibility health and main risks.
2. **Key strengths** so teams understand what to preserve.
3. **Issues and risks**, grouped logically with:
   - What the issue is
   - Why it matters (user impact)
   - Where it appears (if known)
   - How to fix it (specific recommendations or examples)
4. **Standards alignment notes** when relevant, clearly marked as informational.
5. **Prioritized next steps** and/or a concise checklist for remediation tracking.

Always close with a reminder that:

- Accessibility guidance is **informational and does not constitute legal advice**.
- High-risk, ambiguous, or safety-critical situations should be escalated to **human accessibility experts and legal/compliance teams**.

## Common Mistakes

- Starting a review without confirming artifact type, platforms, and exact flows in scope.
- Treating standards overlays (ADA/508/EN 301 549/EAA/ACA/CVAA) as interchangeable instead of selecting based on jurisdiction and sector.
- Listing issues without prioritization (must-fix vs should-fix) and without clear remediation steps.
- Over-claiming compliance or giving legal interpretation instead of framing findings as informational guidance.
