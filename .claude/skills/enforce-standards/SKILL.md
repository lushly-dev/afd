---
name: enforce-standards
source: botcore
description: >
  Enforces language-specific coding conventions for Python, TypeScript, HTML, and CSS. Covers style rules, naming conventions, type safety, error handling, security practices, and performance patterns. Use when writing new code, reviewing pull requests, refactoring existing code, or applying linting and formatting rules. Triggers: code review, coding standards, Python style, TypeScript conventions, ESLint, Prettier, formatting, linting, BEM, PEP 8, type hints, error handling, security, performance, naming conventions.

version: 1.0.0
triggers:
  - coding standards
  - code review
  - python style
  - typescript conventions
  - eslint
  - prettier
  - formatting
  - linting
  - pep 8
  - type hints
  - error handling
  - security
  - performance
  - naming conventions
  - bem
  - html semantics
  - css tokens
portable: true
---

# Enforcing Standards

Language-specific coding conventions for Python, TypeScript, HTML, and CSS.

## Capabilities

1. **Code review** -- Check code against language-specific standards and flag violations
2. **Style enforcement** -- Apply consistent formatting, naming, and structural conventions
3. **Quality assurance** -- Identify error handling, security, and performance issues
4. **Refactoring guidance** -- Suggest standards-compliant improvements to existing code
5. **Cross-language consistency** -- Maintain shared principles across Python, TS, HTML, and CSS

## Routing Logic

| Request type                         | Load reference                                                             |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Python code, PEP 8, type hints       | [references/python.md](references/python.md)                              |
| JavaScript, TypeScript, ESLint       | [references/javascript-typescript.md](references/javascript-typescript.md) |
| HTML, CSS, semantic markup, BEM      | [references/html-css.md](references/html-css.md)                          |
| Performance optimization             | [references/performance.md](references/performance.md)                    |
| Error handling patterns              | [references/error-handling.md](references/error-handling.md)              |
| Security best practices              | [references/security.md](references/security.md)                         |

## Core Principles

### 1. Clarity Over Cleverness

- Prioritize readable, self-documenting code
- Use meaningful names for variables, functions, classes, and files
- Comment only complex or non-obvious logic; avoid commenting the obvious
- Keep functions focused on a single responsibility

### 2. Follow Language Conventions

- **Python:** PEP 8 compliance, Black/Ruff formatting, type hints on all signatures
- **TypeScript:** Strict mode, strong typing (no `any`), ESLint + Prettier
- **HTML:** Semantic HTML5 elements, accessibility attributes (alt, aria-label, label)
- **CSS:** BEM naming, design tokens over hardcoded values, Flexbox/Grid for layout

### 3. Naming Conventions

| Language   | Variables     | Functions      | Classes      | Constants        | Files          |
| ---------- | ------------- | -------------- | ------------ | ---------------- | -------------- |
| Python     | snake_case    | snake_case     | PascalCase   | SCREAMING_SNAKE  | snake_case.py  |
| TypeScript | camelCase     | camelCase      | PascalCase   | SCREAMING_SNAKE  | kebab-case.ts  |
| CSS        | BEM classes   | --             | --           | --custom-props   | kebab-case.css |

### 4. Error Handling

- Validate inputs early (fail fast)
- Use specific, descriptive error messages with context
- Catch specific exception types, never bare `except` or generic `catch`
- Clean up resources in `finally` blocks or context managers
- See [references/error-handling.md](references/error-handling.md) for patterns

### 5. Security by Default

- Never commit secrets; use environment variables and `.gitignore`
- Sanitize all user input; use parameterized queries for databases
- Escape output to prevent XSS; use `textContent` over `innerHTML`
- Use HTTPS for all external requests; audit dependencies regularly
- See [references/security.md](references/security.md) for details

### 6. Performance Awareness

- Measure before optimizing; profile to find hot paths
- Cache expensive computations; hoist invariants out of loops
- Parallelize independent async operations with `Promise.all` or equivalent
- Use appropriate data structures (sets for membership, generators for large data)
- Use CSS `transform`/`opacity` for animations (GPU-accelerated)
- See [references/performance.md](references/performance.md) for patterns

### 7. Cross-Platform Compatibility

All code must work on both Windows and macOS:

- **Paths:** Use `pathlib.Path` (Python) or `path.join` (Node.js)
- **Subprocesses:** Use list-form args, never `shell=True` with platform syntax
- **Line endings:** Configure `.gitattributes`; do not assume `\n` or `\r\n`
- **Scripts:** Prefer Python or bash; provide bash equivalents for PowerShell
- **Env vars:** Use `os.environ` (Python) or `process.env` (Node.js)

## Workflow

1. **Identify language** -- Determine the language or framework involved
2. **Load relevant references** -- Consult the appropriate reference file for detailed rules
3. **Check against standards** -- Verify naming, style, types, error handling, and security
4. **Report findings** -- List issues with the violated rule and a suggested fix
5. **Provide corrected code** -- Show the standards-compliant version

### Output Format for Reviews

```
**Issues found:**
1. [Issue] -- [Rule violated] -- [Suggested fix]

**Revised code:**
[Corrected version]
```

### Output Format for Questions

```
**Recommendation:**
[Guidance]

**Example:**
[Code sample]

**Rationale:**
[Why this approach]
```

## Quick Reference

### Python

- **Formatter:** Black or Ruff format (88-char line length)
- **Linter:** Ruff or Flake8
- **Imports:** Organized with isort
- **Type hints:** Required on all function signatures
- **Docstrings:** Google-style (Args, Returns, Raises)

### TypeScript

- **Linter:** ESLint with strict config
- **Formatter:** Prettier
- **Variables:** `const` by default, `let` only when reassignment needed, never `var`
- **Typing:** Strong types, `unknown` over `any`, interfaces for object shapes
- **Features:** Arrow functions, async/await, template literals, optional chaining

### HTML/CSS

- **HTML:** Semantic elements (header, main, nav, article, section, footer)
- **Accessibility:** Alt text, form labels, aria attributes, keyboard navigation
- **CSS naming:** BEM (Block__Element--Modifier)
- **CSS values:** Design tokens via custom properties, not hardcoded values
- **Layout:** Flexbox for 1D, Grid for 2D, no floats

## Checklist

- [ ] Code follows language-specific naming conventions
- [ ] Formatting applied (Black/Ruff for Python, Prettier for TS)
- [ ] Linting passes (Ruff/Flake8 for Python, ESLint for TS)
- [ ] Type annotations present on all function signatures
- [ ] Functions are focused, single-responsibility, and reasonably sized
- [ ] Error handling uses specific exceptions with descriptive messages
- [ ] No secrets in code or version control
- [ ] User input validated and sanitized
- [ ] Performance anti-patterns avoided (unnecessary loops, uncached computations)
- [ ] CSS uses design tokens and BEM naming
- [ ] HTML uses semantic elements with accessibility attributes
- [ ] Code is cross-platform compatible (Windows + macOS)
- [ ] Tests cover key functionality

## When to Escalate

- **Architecture decisions** -- Standards enforcement does not cover system design choices; escalate to architecture review
- **New language or framework** -- If the codebase introduces a language not covered here, request a standards extension
- **Conflicting rules** -- When project-specific config (e.g., custom ESLint rules) contradicts these standards, defer to the project config and flag the discrepancy
- **Security incidents** -- Actual vulnerabilities found in production code should be escalated to the security team immediately, not just flagged in review
