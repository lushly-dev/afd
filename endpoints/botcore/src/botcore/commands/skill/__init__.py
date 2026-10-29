"""Botcore skill registry commands.

Commands are split into modules:
- frontmatter.py: YAML frontmatter parse/write + SkillManifest model
- _discovery.py: Discover bundled + plugin + local skills
- renames.py: Retired skill names -> current names
- seed.py: Seed skills into a project
- list.py: List available and installed skills
- status.py: Version drift detection
- adopt.py: Claim unmanaged skills
- lint.py: Skill quality rules (SK001-SK015)
- index.py: Generate _index.md
"""

from botcore.commands.skill.adopt import skill_adopt, skill_unadopt
from botcore.commands.skill.index import skill_index
from botcore.commands.skill.lint import skill_lint
from botcore.commands.skill.list import skill_list
from botcore.commands.skill.seed import skill_seed
from botcore.commands.skill.status import skill_status

__all__ = [
    "skill_seed",
    "skill_list",
    "skill_status",
    "skill_lint",
    "skill_adopt",
    "skill_unadopt",
    "skill_index",
]
