"""YAML frontmatter parse/write and SkillManifest model."""

from __future__ import annotations

import re
import textwrap
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict

# Deterministic field order for rendering
_FIELD_ORDER = ["name", "source", "description", "version", "triggers"]

# Descriptions longer than this are emitted as a folded block scalar
_FOLD_THRESHOLD = 60
_FOLD_WIDTH = 80

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)", re.DOTALL)


def _dump(data: object) -> str:
    """Safe-dump a value as block-style YAML without a trailing newline."""
    return yaml.safe_dump(
        data,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
        width=_FOLD_WIDTH,
    ).rstrip("\n")


def _render_description(val: str) -> str:
    """Render description, folding long single-paragraph text for readability.

    Falls back to a safe-dumped scalar whenever the folded form would not
    round-trip to exactly the same string.
    """
    text = val.removesuffix("\n")
    if len(text) > _FOLD_THRESHOLD and text and " ".join(text.split()) == text:
        indicator = ">" if val.endswith("\n") else ">-"
        wrapped = textwrap.wrap(
            text,
            width=_FOLD_WIDTH,
            initial_indent="  ",
            subsequent_indent="  ",
            break_long_words=False,
            break_on_hyphens=False,
        )
        folded = "\n".join([f"description: {indicator}", *wrapped])
        try:
            if yaml.safe_load(folded) == {"description": val}:
                return folded
        except yaml.YAMLError:
            pass
    return _dump({"description": val})


class SkillManifest(BaseModel):
    """Skill metadata parsed from YAML frontmatter."""

    model_config = ConfigDict(extra="allow")

    name: str = ""
    description: str = ""
    version: str = "0.0.0"
    source: str | None = None
    triggers: list[str] = []
    portable: bool = False
    category: str | None = None


def parse_frontmatter(content: str) -> tuple[SkillManifest, str]:
    """Split content at --- delimiters, YAML-parse the frontmatter.

    Returns:
        (manifest, body) where body is everything after the closing ---.
    """
    match = _FRONTMATTER_RE.match(content)
    if not match:
        return SkillManifest(), content

    yaml_str = match.group(1)
    body = match.group(2)

    try:
        data = yaml.safe_load(yaml_str)
    except yaml.YAMLError:
        return SkillManifest(), content

    if not isinstance(data, dict):
        return SkillManifest(), content

    return SkillManifest(**data), body


def render_frontmatter(manifest: SkillManifest, body: str = "") -> str:
    """Render a SkillManifest as YAML frontmatter + body.

    Fields are written in deterministic order: name, source, description,
    version, triggers, then remaining fields alphabetically.
    """
    data = manifest.model_dump(exclude_none=True, exclude_defaults=False)
    # Remove fields that are default/empty and not in the ordered set
    if not data.get("portable"):
        data.pop("portable", None)
    if not data.get("category"):
        data.pop("category", None)
    if not data.get("triggers"):
        data.pop("triggers", None)

    lines = ["---"]
    # Ordered fields first
    for key in _FIELD_ORDER:
        if key not in data:
            continue
        val = data.pop(key)
        if key == "triggers" and isinstance(val, list):
            lines.append("triggers:")
            lines.append(textwrap.indent(_dump(val), "  "))
        elif key == "description" and isinstance(val, str):
            lines.append(_render_description(val))
        else:
            lines.append(_dump({key: val}))

    # Remaining fields alphabetically
    for key in sorted(data):
        lines.append(_dump({key: data[key]}))

    lines.append("---")

    result = "\n".join(lines) + "\n"
    if body:
        if not body.startswith("\n"):
            result += "\n"
        result += body

    return result


def read_skill_manifest(skill_dir: Path) -> SkillManifest | None:
    """Read and parse SKILL.md frontmatter from a skill directory.

    Returns None if SKILL.md doesn't exist or has no valid frontmatter.
    """
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        skill_file = skill_dir / "skill.md"
    if not skill_file.exists():
        return None

    content = skill_file.read_text(encoding="utf-8")
    manifest, _ = parse_frontmatter(content)
    if not manifest.name:
        return None
    return manifest


def set_frontmatter_source(content: str, source: str | None) -> str | None:
    """Set or remove the top-level ``source:`` field with a minimal text edit.

    Only the ``source:`` line is touched; every other frontmatter line and the
    body are kept byte-for-byte. The new line is inserted right after
    ``name:`` when absent. Falls back to a full ``render_frontmatter`` if the
    targeted edit does not yield the expected manifest. Returns None when the
    content has no parseable frontmatter with a name.
    """
    match = _FRONTMATTER_RE.match(content)
    if not match:
        return None
    manifest, body = parse_frontmatter(content)
    if not manifest.name:
        return None

    lines = match.group(1).split("\n")
    kept: list[str] = []
    insert_at: int | None = None
    i = 0
    while i < len(lines):
        line = lines[i]
        if re.match(r"source\s*:", line):
            # Drop the key and any indented continuation lines of its value
            insert_at = len(kept)
            i += 1
            while i < len(lines) and lines[i][:1] in (" ", "\t"):
                i += 1
            continue
        kept.append(line)
        if insert_at is None and re.match(r"name\s*:", line):
            insert_at = len(kept)
        i += 1

    if source is not None:
        kept.insert(len(kept) if insert_at is None else insert_at, _dump({"source": source}))

    start, end = match.span(1)
    new_content = content[:start] + "\n".join(kept) + content[end:]

    expected = manifest.model_copy(update={"source": source})
    reparsed, _ = parse_frontmatter(new_content)
    if reparsed.model_dump() != expected.model_dump():
        return render_frontmatter(expected, body)
    return new_content


def update_skill_source(skill_dir: Path, source: str | None) -> bool:
    """Add or update the source: field in a skill's frontmatter.

    Preserves the body content. Returns True if the file was modified.
    """
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        skill_file = skill_dir / "skill.md"
    if not skill_file.exists():
        return False

    content = skill_file.read_text(encoding="utf-8")
    new_content = set_frontmatter_source(content, source)
    if new_content is None:
        return False

    skill_file.write_text(new_content, encoding="utf-8")
    return True
