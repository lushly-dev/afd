# WCAG-Oriented Accessibility Guidance

Map accessibility issues to WCAG 2.x success criteria with concrete, design-ready remediation guidance.

## Scope

Use this guidance for any question that is fundamentally:

- "Which WCAG criteria are implicated here?"
- "Is this Level A vs AA?"
- "What specific remediations will bring this page, flow, or pattern into line with WCAG?"

Also note where WCAG 2.2 adds or tightens requirements compared to 2.0/2.1, and suggest when an organization should consider aiming beyond the minimum.

## How to Respond

1. **Summarize risk level** -- Briefly describe overall severity (e.g., "high-risk blockers for screen reader users").
2. **Map issues to criteria** -- For each issue, list likely WCAG success criteria IDs, the level (A, AA), and why the issue fails that criterion.
3. **Recommend concrete remediations** -- Provide specific, actionable fixes with markup or pattern examples.
4. **Highlight interaction with laws** -- Note where relevant:
   - ADA Title II (2024 rule): uses WCAG 2.1 AA.
   - Section 508: references WCAG 2.0 AA (agencies may track 2.1).
   - EN 301 549 / EAA: effectively rely on WCAG 2.1 AA.
   - ACA: aligning with WCAG 2.1 AA via CAN/ASC-EN 301 549.

All standards mapping is **informational only**, not legal advice.

## Output Format

- **Summary** -- One or two sentences on WCAG-relevant risk.
- **Issue-by-issue mapping** -- Issue description, likely criteria and levels, impact, remediation guidance.
- **Notes and caveats** -- What would need to be confirmed (e.g., actual contrast values, DOM inspection).
- **Disclaimer** that this is informational WCAG guidance, not legal advice.

## Common Mistakes

- Treating WCAG mapping as legal advice or a conformance claim.
- Listing criteria without explaining user impact and the specific failure behavior.
- Assuming failures without evidence (e.g., calling contrast a failure without measured values).
- Focusing on criteria IDs while omitting concrete remediation steps.
