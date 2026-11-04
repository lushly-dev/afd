"""YAML frontmatter parse/write and SkillManifest model.

Botcore's ownership fields (``source``, ``version``, ``portable``) live under the open
standard's ``metadata:`` map. Readers fall back to top-level copies written by older
Botcore releases; writers always move them under ``metadata:``.
"""

from __future__ import annotations

import re
import textwrap
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, ValidationError, model_validator

# Botcore's ownership fields, kept under ``metadata:``
OWNERSHIP_FIELDS = ("source", "version", "portable")
_DEFAULT_VERSION = "0.0.0"

# Deterministic order for the leading fields; others follow alphabetically, then metadata
_FIELD_ORDER = ["name", "description", "triggers"]

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
    """Skill metadata parsed from YAML frontmatter.

    ``source``, ``version`` and ``portable`` resolve from the ``metadata:`` map first,
    then from the top level (older copies). ``metadata`` keeps the map's other keys.
    ``triggers`` is read for older copies only; no writer adds it.
    """

    model_config = ConfigDict(extra="allow")

    name: str = ""
    description: str = ""
    version: str = _DEFAULT_VERSION
    source: str | None = None
    triggers: list[str] = []
    portable: bool = False
    category: str | None = None
    metadata: dict[str, Any] = {}

    @model_validator(mode="before")
    @classmethod
    def _resolve_ownership(cls, data: Any) -> Any:
        """Lift the ownership fields out of ``metadata:``, which wins over the top level.

        An unquoted ``version: 1.0`` is a YAML number; it becomes text rather than making
        the whole manifest invalid (which would hide the skill's owner). Lint flags it.
        """
        if not isinstance(data, dict):
            return data
        resolved = dict(data)
        metadata = resolved.pop("metadata", None)
        if isinstance(metadata, dict):
            metadata = dict(metadata)
            for key in OWNERSHIP_FIELDS:
                value = metadata.pop(key, None)
                if value is not None:
                    resolved[key] = value
            resolved["metadata"] = metadata
        elif metadata is not None:
            resolved["metadata"] = metadata  # rejected by validation
        version = resolved.get("version")
        if isinstance(version, int | float) and not isinstance(version, bool):
            resolved["version"] = str(version)
        return resolved


def ownership_metadata(manifest: SkillManifest) -> dict[str, Any]:
    """The ``metadata:`` map a writer emits: ownership fields first, then the other keys."""
    metadata: dict[str, Any] = {}
    if manifest.source is not None:
        metadata["source"] = manifest.source
    if manifest.version != _DEFAULT_VERSION:
        metadata["version"] = manifest.version
    if manifest.portable:
        metadata["portable"] = True
    for key, value in manifest.metadata.items():
        if key not in OWNERSHIP_FIELDS:
            metadata[key] = value
    return metadata


def split_frontmatter(content: str) -> tuple[dict | None, str]:
    """Return the raw frontmatter mapping and the body.

    Returns (None, content) when there is no ``---`` block or it is not a YAML mapping.
    """
    match = _FRONTMATTER_RE.match(content)
    if not match:
        return None, content

    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError:
        return None, content

    if not isinstance(data, dict):
        return None, content

    return data, match.group(2)


def parse_frontmatter(content: str) -> tuple[SkillManifest, str]:
    """Split content at --- delimiters, YAML-parse the frontmatter.

    Frontmatter that does not fit the manifest model (such as a ``metadata:`` value that
    is not a mapping) is treated like invalid YAML.

    Returns:
        (manifest, body) where body is everything after the closing ---.
    """
    data, body = split_frontmatter(content)
    if data is None:
        return SkillManifest(), content

    try:
        return SkillManifest(**data), body
    except (TypeError, ValidationError):
        return SkillManifest(), content


def render_frontmatter(manifest: SkillManifest, body: str = "") -> str:
    """Render a SkillManifest as YAML frontmatter + body.

    Fields are written in deterministic order: name, description, triggers (kept only
    when an older copy had them), remaining fields alphabetically, then ``metadata:``
    holding the ownership fields. No top-level ``source``, ``version`` or ``portable``.
    """
    data = manifest.model_dump(exclude_none=True, exclude_defaults=False)
    for key in (*OWNERSHIP_FIELDS, "metadata"):
        data.pop(key, None)
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

    metadata = ownership_metadata(manifest)
    if metadata:
        lines.append(_dump({"metadata": metadata}))

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


_KEY_RE = re.compile(r"([A-Za-z_][\w-]*)\s*:(?=\s|$)")


def _top_level_key(line: str) -> str | None:
    """The key a top-level frontmatter line opens, or None for any other line."""
    match = _KEY_RE.match(line)
    return match.group(1) if match else None


def _block_end(lines: list[str], start: int) -> int:
    """Index after the key at ``start`` and its value's lines (indented, or ``- `` items)."""
    end = index = start + 1
    while index < len(lines):
        line = lines[index]
        if line[:1] in (" ", "\t") or re.match(r"-(\s|$)", line):
            index += 1
            end = index
        elif not line.strip():
            index += 1  # a blank line belongs to the value only if indented lines follow
        else:
            break
    return end


def set_frontmatter_source(content: str, source: str | None) -> str | None:
    """Set or remove ``metadata.source`` with a minimal text edit.

    Top-level ``source:``, ``version:`` and ``portable:`` lines (older copies) are
    removed and their values moved under ``metadata:``. The ``metadata:`` block is
    rewritten in place, or appended when absent, and left byte-for-byte when it already
    holds the expected values; every other frontmatter line and the body are kept
    byte-for-byte. Falls back to a full ``render_frontmatter`` if the targeted edit does
    not yield the expected manifest. Returns None when the content has no parseable
    frontmatter with a name.
    """
    match = _FRONTMATTER_RE.match(content)
    if not match:
        return None
    manifest, body = parse_frontmatter(content)
    if not manifest.name:
        return None
    expected = manifest.model_copy(update={"source": source})
    metadata = ownership_metadata(expected)

    lines = match.group(1).split("\n")
    kept: list[str] = []
    old_block: list[str] | None = None
    insert_at: int | None = None
    moved = False
    i = 0
    while i < len(lines):
        key = _top_level_key(lines[i])
        if key in OWNERSHIP_FIELDS or key == "metadata":
            end = _block_end(lines, i)
            if key == "metadata" and old_block is None:
                insert_at = len(kept)
                old_block = lines[i:end]
            moved = moved or key != "metadata"
            i = end
            continue
        kept.append(lines[i])
        i += 1

    block = _dump({"metadata": metadata}).split("\n") if metadata else []
    if old_block is not None and not moved:
        try:
            if yaml.safe_load("\n".join(old_block)) == {"metadata": metadata}:
                block = old_block
        except yaml.YAMLError:
            pass
    at = len(kept) if insert_at is None else insert_at
    kept[at:at] = block

    start, end = match.span(1)
    new_content = content[:start] + "\n".join(kept) + content[end:]

    reparsed, _ = parse_frontmatter(new_content)
    if reparsed.model_dump() != expected.model_dump():
        return render_frontmatter(expected, body)
    return new_content


def update_skill_source(skill_dir: Path, source: str | None) -> bool:
    """Set or remove ``metadata.source`` in a skill's frontmatter.

    Also moves top-level ownership fields under ``metadata:``. Preserves the body
    content. Returns True if the file was modified.
    """
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        skill_file = skill_dir / "skill.md"
    if not skill_file.exists():
        return False

    content = skill_file.read_text(encoding="utf-8")
    new_content = set_frontmatter_source(content, source)
    if new_content is None or new_content == content:
        return False

    skill_file.write_text(new_content, encoding="utf-8")
    return True
