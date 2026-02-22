# Skill Manager

A meta-skill for creating, maintaining, and validating Claude Agent Skills.

## Features

- **Skill Linter** — Automated validation against 16 quality rules
- **Templates** — Ready-to-use skill and reference file templates
- **Specification** — Complete technical reference for skill authoring
- **Portability** — No project-specific dependencies

## Quick Start

### Lint Skills

```powershell
# Lint all skills in a directory
.\scripts\skill-lint.ps1 -Path "..\*"

# JSON output for CI
.\scripts\skill-lint.ps1 -Path ".." -Format json

# Strict mode (warnings = errors)
.\scripts\skill-lint.ps1 -Path ".." -Strict
```

### Create a New Skill

1. Copy `templates/skill.template.md` to `{skill-name}/SKILL.md`
2. Fill in the frontmatter and body
3. Run linter to validate

## Contents

```
skill-manager/
├── SKILL.md                    # Main skill file
├── README.md                   # This file
├── scripts/
│   └── skill-lint.ps1          # Linter script
├── references/
│   ├── format.md               # YAML frontmatter syntax
│   ├── routing.md              # Routing table patterns
│   ├── descriptions.md         # Trigger keywords
│   ├── reference-files.md      # Reference organization
│   ├── architecture.md         # Folder structure
│   ├── distributed-skills.md   # Multi-repo patterns
│   ├── linter-rules.md         # Rule documentation
│   └── skills-specification.md # Full technical spec
└── templates/
    ├── skill.template.md       # Skill starter
    └── reference.template.md   # Reference starter
```

## Installation

Copy this folder to your project's `.claude/skills/` directory.

## License

MIT
