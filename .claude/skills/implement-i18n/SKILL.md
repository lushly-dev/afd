---
name: implement-i18n
source: botcore
description: >
  Guides implementation of internationalization and localization in web applications. Covers string externalization, pluralization, date/number/currency formatting, RTL layout support, translation file structure, translation workflows, and library selection across JavaScript, React, Vue, and Python ecosystems. Use when adding multi-language support, preparing for international markets, handling RTL layouts, formatting locale-sensitive data, externalizing hardcoded strings, or setting up translation pipelines. Triggers: i18n, internationalization, l10n, localization, translations, RTL, locale, language, multi-language, right-to-left, Intl, pluralization, translation files, react-intl, i18next, vue-i18n, gettext, string externalization.

version: 1.0.0
triggers:
  - i18n
  - internationalization
  - l10n
  - localization
  - translations
  - RTL
  - locale
  - language
  - multi-language
  - right-to-left
  - Intl
  - pluralization
  - translation files
  - react-intl
  - i18next
  - vue-i18n
  - gettext
  - string externalization
portable: true
---

# Implementing i18n

Expert guidance for building applications that work across languages, regions, and writing directions.

## Capabilities

1. **String externalization** -- Extract hardcoded user-facing strings into translation files with interpolation support
2. **Pluralization** -- Implement correct plural forms across languages with varying grammatical rules
3. **Locale-aware formatting** -- Format dates, times, numbers, and currencies using `Intl` APIs or equivalent libraries
4. **RTL layout support** -- Adapt CSS and HTML for right-to-left scripts using logical properties and direction attributes
5. **Translation file architecture** -- Design scalable, namespace-organized translation file structures
6. **Translation workflow** -- Set up end-to-end pipelines for extracting, translating, reviewing, and importing strings
7. **Library selection** -- Choose the right i18n library for the framework and use case (i18next, react-intl, vue-i18n, gettext, fluent)
8. **Anti-pattern detection** -- Identify and correct common i18n mistakes such as string concatenation, hardcoded formats, and text in images

## Core Principles

### 1. Externalize Everything

No user-facing string should be hardcoded. All visible text must flow through a translation function with support for interpolation and context.

### 2. Use Platform APIs for Formatting

Never hand-roll date, number, or currency formatting. Use `Intl.DateTimeFormat`, `Intl.NumberFormat`, and equivalent APIs that respect locale conventions automatically.

### 3. Design for Text Expansion

Translated text can be 30-200% longer than English. Layouts must accommodate variable-length strings without breaking. Never assume fixed text widths.

### 4. Logical Properties Over Physical

CSS should use logical properties (`margin-inline-start`, `padding-inline-end`) instead of physical ones (`margin-left`, `padding-right`) so layouts adapt automatically for RTL scripts.

### 5. Respect Plural Rules

Different languages have different plural categories (English has 2, Russian has 4, Arabic has 6). Use ICU plural syntax or library-specific plural handling -- never assume "singular vs plural" is sufficient.

### 6. Provide Translator Context

Translation keys should be descriptive. Include comments or context strings so translators understand where and how text appears. Avoid reusing the same key for different UI contexts.

### 7. Namespace by Feature

Organize translation files by feature or page (e.g., `common.json`, `dashboard.json`, `errors.json`) to keep files manageable and enable lazy loading of translations.

## Workflow

### Implementing i18n in a Project

#### 1. Audit Existing Strings

- Scan the codebase for hardcoded user-facing strings
- Identify date, number, and currency formatting that bypasses locale
- Note any physical CSS properties that break under RTL
- Catalog images containing embedded text

#### 2. Choose an i18n Library

| Library | Platform | Notes |
|---------|----------|-------|
| `i18next` | JS/React | Feature-rich, extensive plugin ecosystem |
| `react-intl` | React | Part of FormatJS ecosystem, ICU message syntax |
| `vue-i18n` | Vue | Official Vue solution, deep framework integration |
| `gettext` | Python | Classic approach, widespread tooling support |
| `fluent` | Mozilla | Advanced grammar handling, asymmetric localization |

#### 3. Set Up Translation File Structure

```
locales/
  en/
    common.json
    errors.json
    dashboard.json
  es/
    common.json
    errors.json
    dashboard.json
  ar/
    ...
```

#### 4. Externalize Strings

```typescript
// BAD: Hardcoded strings
const message = "Welcome back, " + userName + "!";

// GOOD: Externalized with interpolation
const message = t('welcome_back', { name: userName });
// en.json: { "welcome_back": "Welcome back, {{name}}!" }
// es.json: { "welcome_back": "Bienvenido de nuevo, {{name}}!" }
```

#### 5. Implement Pluralization

```json
// en.json
{
  "items_count": {
    "zero": "No items",
    "one": "{{count}} item",
    "other": "{{count}} items"
  }
}

// ru.json (more plural forms)
{
  "items_count": {
    "one": "{{count}} \u044d\u043b\u0435\u043c\u0435\u043d\u0442",
    "few": "{{count}} \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u0430",
    "many": "{{count}} \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u043e\u0432",
    "other": "{{count}} \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u0430"
  }
}
```

#### 6. Apply Locale-Aware Formatting

```typescript
// Date formatting
const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'long',
  timeStyle: 'short',
});
dateFormatter.format(new Date()); // "30. Januar 2026 um 08:45"

// Number formatting
new Intl.NumberFormat('de-DE').format(1234567.89);
// "1.234.567,89"

// Currency formatting
new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
}).format(1000);
// "\uffe51,000"
```

#### 7. Implement RTL Support

```css
/* Use logical properties instead of physical */
.card {
  /* BAD: Physical properties */
  margin-left: 1rem;
  padding-right: 2rem;

  /* GOOD: Logical properties */
  margin-inline-start: 1rem;
  padding-inline-end: 2rem;
}

/* Set document direction */
html[dir="rtl"] {
  direction: rtl;
}
```

#### 8. Establish Translation Pipeline

1. **Extract** -- Scan code for translatable strings and generate key files
2. **Translate** -- Send to translators via platform (Crowdin, Lokalise, Phrase)
3. **Review** -- Native speaker QA for accuracy and context
4. **Import** -- Pull translations into the codebase
5. **Test** -- Verify in-context with pseudo-localization and visual review

## Quick Reference -- Anti-Patterns

| Avoid | Instead |
|-------|---------|
| String concatenation for messages | Template interpolation with `t()` |
| Hardcoded date/number formats | `Intl` APIs or library formatters |
| Assuming fixed text length | Flexible, responsive layouts |
| Images with embedded text | Separate text layer or CSS text overlay |
| `en` as implicit fallback for `en-GB` | Explicit fallback chain configuration |
| Same key for different UI contexts | Distinct keys with translator comments |
| Singular/plural only | Full ICU plural categories per language |

## Quick Reference -- Key Terms

| Term | Meaning |
|------|---------|
| **i18n** | Internationalization -- making code locale-aware |
| **l10n** | Localization -- adapting content for a specific locale |
| **Locale** | Language + region identifier (e.g., `en-US`, `fr-CA`) |
| **RTL** | Right-to-left scripts (Arabic, Hebrew, Farsi) |
| **ICU** | International Components for Unicode -- standard message format |
| **CLDR** | Common Locale Data Repository -- reference locale data |

## Checklist

- [ ] No hardcoded user-facing strings in the codebase
- [ ] All strings externalized to namespaced translation files
- [ ] Pluralization handled with correct plural categories per language
- [ ] Dates, numbers, and currencies formatted via `Intl` APIs or i18n library
- [ ] CSS uses logical properties (`inline-start/end`, `block-start/end`)
- [ ] RTL layout tested with Arabic or Hebrew locale (if applicable)
- [ ] Translation files complete with no missing keys across supported locales
- [ ] Translator context provided for ambiguous or context-dependent strings
- [ ] Pseudo-localization tested to catch layout overflow and truncation issues
- [ ] Fallback chain configured (e.g., `fr-CA` -> `fr` -> `en`)
- [ ] Translation pipeline integrated into development workflow
- [ ] Images reviewed for embedded text; text separated where found
- [ ] Text expansion accommodated in UI components (30-200% growth)

## When to Escalate

- **Bidirectional text mixing** -- Complex cases where LTR and RTL content coexist in the same paragraph or input field require specialist review
- **Legal or regulated content** -- Translations of legal terms, medical content, or financial disclosures require certified human translators, not machine translation
- **New script support** -- Adding support for CJK, Indic, or other complex scripts may require font loading strategies and specialized rendering review
- **Locale data conflicts** -- When CLDR data differs from business requirements (e.g., custom date formats for a specific market), escalate to product for a decision
- **Performance concerns** -- If loading all translation bundles degrades initial load time, escalate to architecture review for lazy loading or CDN-based translation delivery
- **Accessibility intersection** -- When i18n changes affect screen reader behavior or ARIA labels across languages, coordinate with accessibility review
