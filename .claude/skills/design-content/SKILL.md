---
name: design-content
source: botcore
description: >
  Guides UX writing for user-facing interface text. Covers UI labels, button text, error messages, empty states, tooltips, dialog copy, headings, capitalization rules, voice and tone, and product terminology. Use when writing or reviewing any user-facing text in a prototype or production UI, crafting error messages, defining empty state copy, choosing button labels, or enforcing consistent terminology. Triggers: content design, UX writing, UI text, error message, button label, empty state, tooltip, dialog text, capitalization, terminology, microcopy, voice and tone.

version: 1.0.0
triggers:
  - content design
  - UX writing
  - UI text
  - error message
  - button label
  - empty state
  - tooltip
  - dialog text
  - capitalization
  - terminology
  - microcopy
  - voice and tone
  - sentence case
  - copy review
portable: true
---

# Design Content

Write clear, consistent, human-sounding text for every surface of a user interface.

## Capabilities

1. **Voice and Tone** --- Apply a warm, crisp, helpful voice across all UI text
2. **UI Labels** --- Write button labels, headings, menu items, and navigation text
3. **Error Messages** --- Compose error text that explains what happened and what to do next
4. **Empty States** --- Write first-use, no-results, and error empty state copy
5. **Tooltips and Dialogs** --- Draft concise help text, confirmation dialogs, and inline guidance
6. **Terminology** --- Enforce correct product names and avoid ambiguous synonyms
7. **Capitalization and Grammar** --- Apply sentence case, contractions, active voice, and present tense

## Core Principles

### 1. Warm and Relaxed

Write conversationally, not formally. The interface should sound like a knowledgeable colleague, not a legal document.

### 2. Crisp and Clear

Use simple words and short sentences. If a shorter word works, prefer it. Remove filler.

### 3. Ready to Lend a Hand

Be helpful without being condescending. Guide the user toward their next action.

### 4. User-Addressed

Always address the user as "you" and "your." Never refer to "the user" in UI text.

### 5. Action-Led

Lead with verbs for actions. Use "Save" not "Click Save." Use "select" not "click" or "tap."

## Quick Reference

### Essential Rules

| Rule | Do | Don't |
|------|-----|-------|
| Sentence case | "Create a new item" | "Create A New Item" |
| Contractions | "it's", "you'll", "don't" | "it is", "you will", "do not" |
| Second person | "You can create..." | "A project can be created..." |
| Verb-led actions | "Save" | "Click Save" |
| Use "select" | "Select a workspace" | "Click a workspace" |
| No "please" | "Enter your name" | "Please enter your name" |
| Present tense | "File saves" | "File will be saved" |
| Active voice | "You can export..." | "The report can be exported..." |

### Button Labels

Write button labels with verbs first. Keep them under three words. Match the action the button performs.

| Do | Don't |
|----|-------|
| Save | Save changes |
| Delete | Delete item |
| Create project | Create a new project |
| Cancel | Go back |
| Try again | Retry operation |

### Error Messages

Follow the pattern: **[What happened]** + **[What to do about it]**.

| Do | Don't |
|----|-------|
| "Couldn't load workspaces. Check your connection and try again." | "Error: Network request failed (ERR_NETWORK)" |
| "You don't have access to this workspace. Ask the owner for permission." | "403 Forbidden" |
| "Something went wrong. Try again in a few minutes." | "An unexpected error has occurred. Please contact your administrator." |

Guidelines:
- Use contractions ("couldn't" not "could not")
- Never expose technical codes or stack traces to the user
- Always include a recovery action or next step
- Keep the tone calm and reassuring

### Empty States

Follow the pattern: **[Title: What's missing]** + **[Body: Why + what to do]**.

| Scenario | Title | Body |
|----------|-------|------|
| First use | "No items yet" | "Create your first item to get started." |
| No results | "No results found" | "Try different search terms or remove filters." |
| Error | "Couldn't load items" | "Check your connection and try again." |

Guidelines:
- Title describes what is absent, not what went wrong
- Body gives a clear action the user can take
- First-use empty states should be encouraging and orient the user

### Tooltips

- Keep to one sentence when possible
- Describe what the control does, not how to use it
- Do not repeat the label text

### Dialog Text

- Title: State the action or decision ("Delete this item?")
- Body: Explain consequences concisely
- Primary button: Verb matching the action ("Delete")
- Secondary button: "Cancel"

## Workflow

### Writing New UI Text

1. **Identify the surface** --- Is it a button, heading, error, empty state, tooltip, or dialog?
2. **Draft** --- Write the text following the pattern for that surface type
3. **Apply rules** --- Check sentence case, contractions, active voice, verb-led actions, second person
4. **Check terminology** --- Verify product names against the terminology table
5. **Review** --- Read the text aloud; if it sounds stiff or robotic, rewrite

### Reviewing Existing Text

1. **Scan for Title Case** --- Convert any Title Case headings or labels to sentence case
2. **Scan for passive voice** --- Rewrite "X can be done" as "You can do X"
3. **Scan for "please"** --- Remove from instructions
4. **Scan for jargon** --- Replace technical codes and internal terms with user-friendly language
5. **Check error messages** --- Ensure each includes a recovery action

## Terminology

Use official product names consistently. When the product context is ambiguous, spell out the full name on first mention.

| Correct | Avoid |
|---------|-------|
| Workspace | Project, folder |
| Dashboard | Report page, analytics view |
| Settings | Preferences, options, config |

> **Note:** Replace these example entries with your product's canonical terms. The key principle: pick one name per concept and use it everywhere.

## Checklist

Before finalizing any user-facing text:

- [ ] Sentence case applied (not Title Case)
- [ ] Contractions used ("it's" not "it is")
- [ ] Active voice throughout
- [ ] No jargon or technical codes exposed to users
- [ ] Error messages include a recovery suggestion
- [ ] Product terminology matches the canonical term list
- [ ] Button labels are verb-led and under three words
- [ ] Empty states include a clear next action
- [ ] Tooltips do not repeat the label
- [ ] Dialog text states consequences and uses matching verb on primary button

## When to Escalate

- Legal, compliance, or regulatory text that requires review by a legal team
- Accessibility-specific text (alt text, ARIA labels) --- defer to an accessibility specialist or skill
- Localization and translation concerns that affect meaning across languages
- Brand voice conflicts between product teams requiring a cross-team decision
- Terminology disputes where multiple product names exist for the same concept
