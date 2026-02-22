---
name: ensure-accessibility
source: botcore
description: >
  Provides comprehensive accessibility review, guidance, and implementation patterns for WCAG 2.1+ AA compliance. Covers keyboard navigation, ARIA roles and states, screen reader support, assistive technology analysis, compliance frameworks (Section 508, ADA, EN 301 549, EAA, ACA, CVAA), UX component patterns, and accessible content authoring. Use when building interactive components, auditing UI for accessibility, implementing focus management, reviewing designs or specs against WCAG, mapping issues to compliance frameworks, or creating accessibility checklists. Triggers: accessibility, a11y, WCAG, ARIA, keyboard navigation, screen reader, assistive technology, focus management, inclusive design, compliance, Section 508, ADA.

version: 1.0.0
triggers:
  - accessibility
  - a11y
  - WCAG
  - ARIA
  - keyboard navigation
  - screen reader
  - assistive technology
  - focus management
  - inclusive design
  - compliance
  - Section 508
  - ADA
portable: true
---

# Ensuring Accessibility

Comprehensive accessibility review, guidance, and implementation patterns for WCAG 2.1+ AA compliance across designs, specs, and implementations.

## Capabilities

1. **Accessibility reviews** -- Structured reviews of designs, specs, and implementations against WCAG 2.1+ AA criteria.
2. **Keyboard and focus management** -- Tab order, focus trapping, keyboard shortcuts, roving tabindex, and visible focus indicators.
3. **ARIA patterns and semantic markup** -- Roles, states, properties, labeling, and live regions for custom interactive components.
4. **Screen reader analysis** -- Evaluate how screen reader users perceive, navigate, and operate an experience.
5. **Assistive technology coverage** -- Guidance for keyboard-only, speech recognition, magnification, braille display, eye tracking, and switch access users.
6. **Standards and compliance mapping** -- Informational mapping to WCAG 2.x, Section 508, ADA Title II/III, EN 301 549, EAA, ACA, and CVAA.
7. **UX component patterns** -- Accessible patterns for buttons, forms, dialogs, tooltips, loading states, headings, accordions, and breadcrumbs.
8. **Accessible content authoring** -- Plain language, alt text, link text, heading structure, multimedia, and form content.
9. **Targeted Q&A and troubleshooting** -- Focused answers to specific accessibility questions, tradeoffs, and implementation decisions.

## Routing Logic

Use the reference files to provide deep guidance on specific topics.

### Intent Routing

Start by identifying the user's primary intent, then choose the appropriate entry point:

| Intent | Cues | Primary reference |
|--------|------|-------------------|
| Full accessibility review | "Review this dialog/page/flow", "create a checklist", designs/specs/code | `references/accessibility-review.md` |
| Targeted Q&A / troubleshooting | "How do I fix this?", "Should I use this pattern?", "Why is this an issue?" | `references/accessibility-qna.md` |
| Learning / education | "Explain screen readers", "Teach me about WCAG", "What should I know about keyboard a11y?" | `references/accessibility-qna.md` + specialist references below |
| Standards and compliance | Jurisdiction, ADA, 508, EN 301 549, EAA, ACA, CVAA | `references/standards-requirements/` files by jurisdiction |

### Assistive Technology References

| Topic | Reference |
|-------|-----------|
| Screen reader UX | `references/assistive-tech/screen-reader.md` |
| Keyboard-only interaction and focus | `references/assistive-tech/keyboard.md` |
| Speech / voice control | `references/assistive-tech/speech-recognition.md` |
| High zoom / magnification | `references/assistive-tech/screen-magnification.md` |
| Braille display | `references/assistive-tech/braille-display.md` |
| Eye tracking / gaze input | `references/assistive-tech/eye-tracking.md` |
| Switch access / scanning | `references/assistive-tech/switch-devices.md` |

### Standards and Compliance References

| Topic | Reference |
|-------|-----------|
| WCAG 2.x criteria and remediation | `references/standards-requirements/wcag.md` |
| Section 508 (U.S. federal) | `references/standards-requirements/section-508.md` |
| ADA Title II/III (U.S. state/local, public) | `references/standards-requirements/ada-title-ii-iii.md` |
| EN 301 549 (EU ICT standard) | `references/standards-requirements/en-301-549.md` |
| European Accessibility Act (EAA) | `references/standards-requirements/european-accessibility-act-EAA.md` |
| Accessible Canada Act (ACA) | `references/standards-requirements/accessible-canada-act.md` |
| CVAA (communications / video) | `references/standards-requirements/cvaa.md` |

Use selectively based on jurisdiction and sector:
- **ADA Title II/III** for U.S. state/local governments and public accommodations.
- **Section 508** for U.S. federal agencies and federal procurement.
- **EN 301 549 / EAA** for EU public sector and EU consumer products/services.
- **Accessible Canada Act** for Canadian federal and federally regulated entities.
- **CVAA** when the product is primarily a communications or video service.
- **WCAG** when mapping issues to criteria without a specific legal framework.

### Implementation References

| Topic | Reference |
|-------|-----------|
| ARIA roles, states, and properties | `references/aria-patterns.md` |
| Keyboard navigation patterns | `references/keyboard-nav.md` |
| WCAG 2.1 AA quick reference | `references/wcag-guidelines.md` |
| Accessible content authoring | `references/accessible-content.md` |

### UX Component Pattern References

| Topic | Reference |
|-------|-----------|
| Buttons, toggles, calls to action | `references/ux-component-pattern/buttons.md` |
| Form fields, validation, errors | `references/ux-component-pattern/form-fields.md` |
| Error states and recovery flows | `references/ux-component-pattern/error-states.md` |
| Modal dialogs | `references/ux-component-pattern/modal-dialogs.md` |
| Tooltips and help affordances | `references/ux-component-pattern/tooltips.md` |
| Loading and busy states | `references/ux-component-pattern/loading-states.md` |
| Headings and structure | `references/ux-component-pattern/headings.md` |
| Accordions and disclosure | `references/ux-component-pattern/accordions.md` |
| Breadcrumb navigation | `references/ux-component-pattern/breadcrumbs.md` |

### Spec Review References

| Topic | Reference |
|-------|-----------|
| Accessibility annotations | `references/spec-review/accessibility-annotations.md` |
| Keyboard / tab order spec | `references/spec-review/keyboard-tab-order-spec-review.md` |
| Reflow / responsive spec | `references/spec-review/reflow-responsive-spec-review.md` |
| Screen reader annotations | `references/spec-review/screen-reader-annotations-spec-review.md` |

## Core Principles

1. **WCAG 2.1+ AA as baseline** -- Use WCAG 2.1 AA (or higher, such as 2.2 AA) as the primary reference, while acknowledging that guidance is informational and not legal advice.
2. **Semantic HTML first** -- Prefer native elements (`<button>`, `<nav>`, `<dialog>`) before reaching for ARIA. No ARIA is better than bad ARIA.
3. **Broad assistive technology coverage** -- Consider screen readers, keyboard-only, speech input, magnification, braille, eye tracking, and switch access. Avoid assumptions about a single "typical" user.
4. **Actionable over abstract** -- Prioritize concrete recommendations with specific markup, interaction patterns, or content examples over abstract theory.
5. **Severity classification** -- Clearly distinguish between **must-fix** conformance failures, **should-fix** usability risks, and **nice-to-have** enhancements.
6. **Human review required** -- Encourage usability testing with people with disabilities and consultation with accessibility experts for high-risk or ambiguous cases.

## Workflow

### Full Accessibility Review

1. **Identify the artifact and scope** -- Determine whether you are reviewing a design, specification, or implementation, and which user flows or pages are in scope.
2. **Select assistive technologies and standards** -- Based on the scenario, choose the appropriate assistive-tech and standards references from the routing tables.
3. **Analyze** -- Inspect structure, interaction patterns, content, and markup for accessibility issues using the relevant references.
4. **Document issues and recommendations** -- For each issue, capture impact, location, affected users/AT, relevant WCAG criteria, and concrete remediation guidance.
5. **Prioritize and summarize** -- Group findings by severity and impact, provide a concise summary, and outline clear next steps.

### Targeted Q&A

1. **Clarify the question and context** -- What component, flow, or platform is involved? What is the user trying to achieve?
2. **Identify relevant specialists** -- Map the question to relevant assistive-tech, UX pattern, or standards references.
3. **Provide targeted guidance** -- Explain the issue in clear terms with specific markup, interaction, or content recommendations.
4. **Suggest next steps** -- If the question suggests broader risks, recommend a full accessibility review.

### Review Output Format

Structure review outputs as:

1. **Quick summary** of overall accessibility health and main risks.
2. **Key strengths** so teams understand what to preserve.
3. **Issues and risks**, grouped logically with: what the issue is, why it matters (user impact), where it appears, how to fix it, and likely WCAG criteria (informational).
4. **Prioritized next steps** and/or a concise checklist for remediation tracking.

## Quick Reference

### WCAG 2.1 AA -- Four Principles

| Principle | Key Requirements |
|-----------|-----------------|
| **Perceivable** | Text alternatives for images; captions for video; color contrast 4.5:1 (text), 3:1 (large text/UI); don't use color alone |
| **Operable** | All functionality via keyboard; no keyboard traps; focus visible and not obscured; target size 24x24px minimum |
| **Understandable** | Consistent navigation; clear error messages; labels for all inputs; page language set |
| **Robust** | Valid HTML; unique IDs; custom controls expose name, role, value |

### Standard Keyboard Keys

| Key | Action |
|-----|--------|
| Tab / Shift+Tab | Move between focusable elements |
| Enter | Activate button or link |
| Space | Activate button, toggle checkbox |
| Escape | Close modal, menu, or popup |
| Arrow keys | Navigate within a composite widget |
| Home / End | Jump to first/last item in a list |

### Common ARIA Patterns

| Component | Role | Key Attributes |
|-----------|------|----------------|
| Button | `button` | `aria-pressed`, `aria-expanded` |
| Modal | `dialog` | `aria-modal`, `aria-labelledby` |
| Tab | `tab` / `tablist` | `aria-selected`, `aria-controls` |
| Menu | `menu` / `menuitem` | `aria-activedescendant` |
| Accordion | `button` + panel | `aria-expanded`, `aria-controls` |
| Alert | `alert` | Used for important announcements |
| Live region | -- | `aria-live="polite"` or `"assertive"` |

## Checklist

### Implementation Checklist

- [ ] All functionality is keyboard accessible (Tab, Enter, Space, Escape, Arrows)
- [ ] Focus is visible, has 3:1 contrast, and is not obscured
- [ ] Target size is at least 24x24px
- [ ] Semantic HTML is used before ARIA
- [ ] ARIA roles, states, and labels are correct and non-redundant
- [ ] Color contrast meets 4.5:1 (text) and 3:1 (large text/UI components)
- [ ] Images have appropriate alt text (or `alt=""` for decorative)
- [ ] Form inputs have associated labels and programmatic error messages
- [ ] Page language is set (`lang` attribute)
- [ ] Focus order matches visual order
- [ ] Modal dialogs trap focus and restore it on close
- [ ] Dynamic content changes are announced via live regions

### Testing Checklist

- [ ] Navigate entire flow with keyboard only (no mouse)
- [ ] Test with at least one screen reader (NVDA, JAWS, or VoiceOver)
- [ ] Verify at 200% and 400% zoom (reflow, no horizontal scroll at 320px)
- [ ] Check with increased text spacing (WCAG 1.4.12)
- [ ] Run automated scan (axe, Lighthouse, or equivalent)
- [ ] Confirm color is not the sole indicator of meaning
- [ ] Verify skip links and landmark regions work correctly

### Content Checklist

- [ ] Link text is descriptive and self-contained (no "click here")
- [ ] Headings follow a logical hierarchy (no skipped levels)
- [ ] Plain language is used; technical terms are explained
- [ ] Error messages are specific, polite, and actionable
- [ ] Video has captions; audio has transcripts
- [ ] Alt text is concise and describes purpose, not just appearance

## When to Escalate

Escalate to human accessibility experts, legal counsel, or governance teams when:

- Requests involve **formal conformance claims**, policy interpretation, or legal risk decisions.
- The experience is **safety-critical** (healthcare, financial authorization, emergency services) where accessibility failures could have severe consequences.
- There are **conflicting requirements** between standards, organizational policies, or product constraints that require judgment calls.
- **User feedback from people with disabilities** conflicts with heuristic guidance and needs deeper investigation.
- The question requires **legal interpretation** of ADA, Section 508, EN 301 549, EAA, ACA, CVAA, or other regulations -- guidance here is informational only, not legal advice.
