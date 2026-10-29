# Skill Research Command

> Accelerate skill creation by crawling external documentation and drafting skill files.

## Summary

Creating skills from external documentation (Convex, Stripe, Fabric APIs, etc.) requires significant manual research and synthesis. A `skill-research` botcore command would automate the initial crawl-and-draft phase.

## Workflow

```bash
# Via any repo's CLI that surfaces botcore commands
<cli> skill-research --url https://docs.convex.dev --name convex
```

**Output:**
- Fetches key pages from documentation
- Extracts concepts, patterns, code examples
- Generates draft SKILL.md with suggested capabilities, triggers, and core concepts
- Generates draft reference file stubs

## Research Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `--mode quick` | Top 10 pages, basic structure | Familiar technology |
| `--mode standard` | 30-50 pages, full references | New skill |
| `--mode thorough` | Deep crawl, changelogs, blog | Finding newer features |

## Focus Flags

```bash
<cli> skill-research --url https://docs.convex.dev \
  --name convex \
  --focus "features released 2024-2026" \
  --focus "breaking changes" \
  --focus "best practices"
```

## Output Structure

```
.claude/skills/convex/
├── SKILL.md              # Draft, needs review
├── references/
│   ├── functions.md      # Drafted
│   ├── database.md       # Drafted
│   └── ...
└── .research/
    ├── sources.json      # URLs used
    ├── raw_content.md    # Extracted text
    └── generation.log    # LLM prompts/responses
```

The `.research/` folder provides transparency and allows manual refinement.

## Implementation Notes

- Botcore command, surfaced by each repo's CLI/MCP
- Respects `robots.txt` when crawling
- Uses LLM for synthesis (Gemini or configurable)
- Output follows managing-skills template and naming conventions
- Generated skills should pass `skill-lint` with at most warnings

## Status

Proposed — originated from managing-skills v2.1 upgrade planning.
