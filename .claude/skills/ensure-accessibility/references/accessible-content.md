# Accessible Content Authoring Guide

Use this checklist when writing or reviewing any user-facing content (UI, help, docs, marketing).

## 1. Use Plain Language

- Write for about a middle-school reading level when possible.
- Prefer short, direct sentences over long, complex ones.
- Explain technical, legal, or product-specific terms the first time they appear.
- Avoid idioms, slang, and cultural references that may not translate.
- Use active voice and clear subjects ("You can..." instead of "It can be done...").

## 2. Make Content Easy to Scan

- Lead with the most important information.
- Break long text into short paragraphs, lists, and clear sections.
- Use descriptive headings that summarize the key point of each section.
- Put one main idea per paragraph or list item.

## 3. Write Effective Alt Text

- Give each meaningful image concise, descriptive alt text that explains its purpose.
- Use empty alt text (`alt=""`) for purely decorative images.
- Keep alt text short -- usually one or two sentences focused on what matters most.
- Don't repeat nearby captions or surrounding text.
- Don't start with "image of" or "picture of" (screen readers already announce it as an image).
- Mention the image type when important (logo, diagram, illustration).

## 4. Write Effective Links

- Make link text specific and self-contained ("Download the full report" instead of "Click here").
- Tell users what to expect from the link target (e.g., "(PDF)" or "opens in a new tab").
- Avoid repeating the same vague link text multiple times on a page.

## 5. Structure Information Clearly

- Use clear, concise page titles that reflect the page purpose.
- Ensure heading levels reflect information hierarchy (no skipping levels).
- Group related information and label sections logically.
- When content changes language, mark that change in code (`lang` attribute).

## 6. Write for Forms and Interactive UI

- Use clear labels that describe what users should enter or choose.
- Provide instructions and requirements before the field (format, limits, required).
- Keep error messages specific, polite, and actionable.
- Don't rely only on color to signal errors or success; pair with text or icons.

## 7. Make Multimedia Accessible

- Provide captions for all videos with speech or meaningful sound.
- Offer transcripts that capture spoken words, on-screen text, and important visuals.
- Use players that support captions and keyboard navigation.
- Add audio descriptions when visuals convey important information not in narration.

## 8. Test with Real Devices

- Navigate content using only a keyboard.
- Try a screen reader to confirm headings, links, images, and controls make sense.
- Check readability and scannability on small screens and at high zoom levels.

## Common Mistakes

- Using vague link text like "Click here" instead of descriptive labels.
- Using headings for visual styling or skipping heading levels.
- Writing alt text that is too long, redundant, or misses the image purpose.
- Relying on color alone to convey meaning without a text equivalent.
