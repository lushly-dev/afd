# Doc Site Setup and Index Generation

Browsable documentation site and automated skill indexing.

## Docsify Setup

Zero-build documentation site that reads skills directly as markdown.

### Directory Structure

```
docs/
  guide/
    index.html      # Docsify entry point
    _sidebar.md     # Navigation (auto-generated)
    README.md       # Landing page content
    .nojekyll       # Prevents Jekyll processing on GitHub Pages
```

### index.html

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Project Documentation</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify/themes/vue.css">
</head>
<body>
  <div id="app"></div>
  <script>
    window.$docsify = {
      name: 'Project',
      repo: '',
      loadSidebar: true,
      subMaxLevel: 2,
      search: 'auto',
      auto2top: true,
      alias: {
        '/skills/(.*)': '/.claude/skills/$1',
        '/_sidebar.md': '/_sidebar.md'
      }
    }
  </script>
  <script src="//cdn.jsdelivr.net/npm/docsify/lib/docsify.min.js"></script>
  <script src="//cdn.jsdelivr.net/npm/docsify/lib/plugins/search.min.js"></script>
</body>
</html>
```

### _sidebar.md Structure

Auto-generated from skills:

```markdown
* **Getting Started**
  * [Overview](README.md)

* **Core**
  * [Doc Management](/skills/doc-management/SKILL.md)
  * [Skill Manager](/skills/skill-manager/SKILL.md)

* **Development**
  * [Testing](/skills/testing/SKILL.md)
```

### Local Development

```bash
# Python
python -m http.server 3000 --directory docs/guide

# Node (npx)
npx serve docs/guide

# Then open http://localhost:3000
```

### GitHub Pages Deployment

1. Enable GitHub Pages in repo settings
2. Set source to `docs/guide` folder (or use GitHub Actions)
3. Push changes -- site updates automatically

### Theme Options

Replace `vue.css` with:
- `//cdn.jsdelivr.net/npm/docsify/themes/buble.css` -- minimal
- `//cdn.jsdelivr.net/npm/docsify/themes/dark.css` -- dark mode
- `//cdn.jsdelivr.net/npm/docsify/themes/pure.css` -- clean

### Plugins

```html
<!-- Copy code button -->
<script src="//cdn.jsdelivr.net/npm/docsify-copy-code"></script>

<!-- Syntax highlighting -->
<script src="//cdn.jsdelivr.net/npm/prismjs/components/prism-python.min.js"></script>
<script src="//cdn.jsdelivr.net/npm/prismjs/components/prism-typescript.min.js"></script>
```

### Migration Path

If you later want Hugo or Eleventy:
1. Skills remain unchanged (they are just markdown)
2. Replace `docs/guide/` contents with new generator
3. Update sidebar generation script

---

## Skill Index Generation

Auto-generate skill indexes and sidebars from frontmatter.

### Purpose

- Keep CLAUDE.md/AGENTS.md skill table in sync with actual skills
- Generate Docsify `_sidebar.md` automatically
- Ensure no orphan skills

### Generator Script

Located at `scripts/generate-skill-index.py`:

```python
#!/usr/bin/env python3
"""Generate skill index from frontmatter."""

import re
from pathlib import Path
from collections import defaultdict

import yaml


def parse_frontmatter(content: str) -> dict | None:
    """Extract YAML frontmatter from markdown."""
    match = re.match(r"^---\n(.+?)\n---", content, re.DOTALL)
    if match:
        return yaml.safe_load(match.group(1))
    return None


def generate_index(skills_dir: Path) -> dict[str, list[dict]]:
    """Generate skill index grouped by category."""
    skills_by_category = defaultdict(list)

    for skill_path in sorted(skills_dir.iterdir()):
        skill_md = skill_path / "SKILL.md"
        if not skill_md.exists():
            continue

        content = skill_md.read_text(encoding="utf-8")
        fm = parse_frontmatter(content)
        if not fm:
            continue

        category = fm.get("category", "uncategorized")
        skills_by_category[category].append({
            "name": fm.get("name", skill_path.name),
            "path": skill_path.name,
            "description": fm.get("description", "").split(".")[0].strip(),
            "triggers": fm.get("triggers", []),
        })

    return dict(skills_by_category)


def render_claude_table(skills: dict[str, list[dict]]) -> str:
    """Render skill table for CLAUDE.md."""
    lines = ["| Skill | Category | When to Use |", "|-------|----------|-------------|"]

    category_order = ["core", "development", "review", "quality", "uncategorized"]

    for category in category_order:
        if category not in skills:
            continue
        for skill in skills[category]:
            link = f"[{skill['name']}](.claude/skills/{skill['path']}/)"
            lines.append(f"| {link} | {category} | {skill['description']} |")

    return "\n".join(lines)


def render_docsify_sidebar(skills: dict[str, list[dict]]) -> str:
    """Render _sidebar.md for Docsify."""
    lines = ["* **Getting Started**", "  * [Overview](README.md)", ""]

    category_titles = {
        "core": "Core",
        "development": "Development",
        "review": "Review",
        "quality": "Quality",
        "uncategorized": "Other",
    }

    for category, title in category_titles.items():
        if category not in skills:
            continue
        lines.append(f"* **{title}**")
        for skill in skills[category]:
            lines.append(f"  * [{skill['name']}](/skills/{skill['path']}/SKILL.md)")
        lines.append("")

    return "\n".join(lines)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate skill index")
    parser.add_argument("--skills-dir", default=".claude/skills", help="Skills directory")
    parser.add_argument("--format", choices=["table", "sidebar", "json"], default="table")
    parser.add_argument("--output", help="Output file (default: stdout)")
    args = parser.parse_args()

    skills_dir = Path(args.skills_dir)
    skills = generate_index(skills_dir)

    if args.format == "table":
        output = render_claude_table(skills)
    elif args.format == "sidebar":
        output = render_docsify_sidebar(skills)
    else:
        import json
        output = json.dumps(skills, indent=2)

    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
        print(f"Written to {args.output}")
    else:
        print(output)
```

### Usage

```bash
# Generate CLAUDE.md skill table
python scripts/generate-skill-index.py --format table

# Generate Docsify sidebar
python scripts/generate-skill-index.py --format sidebar --output docs/guide/_sidebar.md

# Export as JSON (for tooling)
python scripts/generate-skill-index.py --format json
```

### Pre-commit Hook

```yaml
- repo: local
  hooks:
    - id: skill-index
      name: Update skill index
      entry: python scripts/generate-skill-index.py --format sidebar --output docs/guide/_sidebar.md
      language: python
      files: \.claude/skills/.*/SKILL\.md$
      pass_filenames: false
```

### CI Validation

```yaml
# .github/workflows/docs.yml
- name: Validate skill index
  run: |
    python scripts/generate-skill-index.py --format table > /tmp/expected.md
    grep -A 100 "## Skill Index" .claude/CLAUDE.md | diff - /tmp/expected.md
```
