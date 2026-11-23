"""Tests for SkillCatalog, skill_from_directory and S2–S6 rules (``spec/mcp-resources.md``)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from afd.server.skills import (
    MAX_SKILL_BYTES,
    MAX_SKILL_FILES,
    Skill,
    SkillCatalog,
    sha256_digest,
    skill_from_directory,
    skill_mime_type,
)


def _skill_md(name: str = "hello", description: str = "Greets.") -> str:
    return f"---\nname: {name}\ndescription: {description}\n---\n\nBody.\n"


def test_catalog_builds_manifest_order_digests_and_mime_types():
    catalog = SkillCatalog(
        [
            Skill(
                path="acme/hello",
                files={
                    "z.txt": "last",
                    "SKILL.md": _skill_md("hello"),
                    "a/script.PY": "print(1)\n",
                    "a/icon.SVG": "<svg/>",
                    "a/unknown.xyz": b"\xff\x00",
                },
            )
        ]
    )
    entries = catalog.entries()
    assert len(entries) == 1
    entry = entries[0]
    assert entry["uri"] == "skill://acme/hello/SKILL.md"
    assert [r["uri"] for r in entry["resources"]] == [
        "skill://acme/hello/SKILL.md",
        "skill://acme/hello/a/icon.SVG",
        "skill://acme/hello/a/script.PY",
        "skill://acme/hello/a/unknown.xyz",
        "skill://acme/hello/z.txt",
    ]
    resources = {r["uri"]: r for r in catalog.resources()}
    assert resources["skill://acme/hello/SKILL.md"]["name"] == "hello"
    assert resources["skill://acme/hello/SKILL.md"]["description"] == "Greets."
    assert resources["skill://acme/hello/a/script.PY"]["mimeType"] == "text/x-python"
    assert resources["skill://acme/hello/a/icon.SVG"]["mimeType"] == "image/svg+xml"
    assert resources["skill://acme/hello/a/unknown.xyz"]["mimeType"] == "application/octet-stream"
    assert "description" not in resources["skill://acme/hello/z.txt"]
    assert (
        resources["skill://acme/hello/z.txt"]["_meta"]["dev.afd/digest"]
        == sha256_digest(b"last")
    )


def test_skill_mime_type_table_is_case_insensitive():
    assert skill_mime_type("a.MD") == "text/markdown"
    assert skill_mime_type("a.yml") == "application/yaml"
    assert skill_mime_type("a.YAML") == "application/yaml"
    assert skill_mime_type("a.mjs") == "text/javascript"
    assert skill_mime_type("a.ts") == "text/x-typescript"
    assert skill_mime_type("a.sh") == "text/x-shellscript"
    assert skill_mime_type("a.jpeg") == "image/jpeg"
    assert skill_mime_type("a.pdf") == "application/pdf"
    assert skill_mime_type("Makefile") == "application/octet-stream"


def test_directory_read_lists_direct_children_in_utf8_order():
    catalog = SkillCatalog(
        [
            Skill(
                path="acme/hello",
                files={
                    "SKILL.md": _skill_md("hello"),
                    "refs/b.md": "b",
                    "refs/a.md": "a",
                    "refs/sub/c.md": "c",
                    "assets/x.bin": b"\x00",
                },
            )
        ],
        directory_read=True,
    )
    root = catalog.directory("skill://acme/hello")
    assert root is not None
    # S6 orders children by last path segment (SKILL.md, assets, refs); SKILL.md's S5 name is frontmatter name.
    assert [item["uri"] for item in root] == [
        "skill://acme/hello/SKILL.md",
        "skill://acme/hello/assets",
        "skill://acme/hello/refs",
    ]
    assert root[0]["name"] == "hello"
    assert root[1] == {
        "uri": "skill://acme/hello/assets",
        "name": "assets",
        "mimeType": "inode/directory",
    }
    assert root[2] == {
        "uri": "skill://acme/hello/refs",
        "name": "refs",
        "mimeType": "inode/directory",
    }

    refs = catalog.directory("skill://acme/hello/refs")
    assert refs is not None
    # Files use their S5 resource (name = file path); subdirectories use name = segment.
    assert [item["uri"] for item in refs] == [
        "skill://acme/hello/refs/a.md",
        "skill://acme/hello/refs/b.md",
        "skill://acme/hello/refs/sub",
    ]
    assert [item["name"] for item in refs] == ["refs/a.md", "refs/b.md", "sub"]
    assert refs[2]["mimeType"] == "inode/directory"

    # Trailing slash or unknown directory returns None.
    assert catalog.directory("skill://acme/hello/") is None
    assert catalog.directory("skill://acme/hello/missing") is None


def test_catalog_enforces_file_count_and_byte_limits():
    too_many: dict[str, str | bytes] = {"SKILL.md": _skill_md("many")}
    for i in range(MAX_SKILL_FILES):
        too_many[f"f{i:04d}.txt"] = "x"
    with pytest.raises(ValueError, match="512"):
        SkillCatalog([Skill(path="many", files=too_many)])

    skill_md = _skill_md("huge").encode("utf-8")
    over_bytes = MAX_SKILL_BYTES - len(skill_md) + 1
    with pytest.raises(ValueError, match="16"):
        SkillCatalog([Skill(path="huge", files={"SKILL.md": skill_md, "big.bin": b"0" * over_bytes})])


def test_catalog_enforces_description_length_and_path_rules():
    with pytest.raises(ValueError, match="description"):
        SkillCatalog([Skill(path="long", files={"SKILL.md": _skill_md("long", "a" * 1025)})])

    with pytest.raises(ValueError, match="1 to 64"):
        SkillCatalog([Skill(path="-bad", files={"SKILL.md": _skill_md("-bad")})])

    with pytest.raises(ValueError, match="1 to 64"):
        SkillCatalog([Skill(path="BAD/hello", files={"SKILL.md": _skill_md("hello")})])

    with pytest.raises(ValueError, match="hello"):
        SkillCatalog(
            [
                Skill(
                    path="hello",
                    files={
                        "SKILL.md": _skill_md("hello"),
                        "refs/./a.md": "x",
                    },
                )
            ]
        )


def test_skill_from_directory_reads_files_and_refuses_escaping_symlinks(tmp_path: Path):
    skill_dir = tmp_path / "hello"
    (skill_dir / "refs").mkdir(parents=True)
    (skill_dir / "SKILL.md").write_bytes(_skill_md("hello").encode("utf-8"))
    (skill_dir / "refs" / "guide.md").write_bytes(b"# Guide\n")

    skill = skill_from_directory("acme/hello", skill_dir)
    catalog = SkillCatalog([skill])
    assert catalog.file("skill://acme/hello/refs/guide.md") == (b"# Guide\n", "text/markdown")

    outside = tmp_path / "secret.txt"
    outside.write_text("secret", encoding="utf-8")
    escape_link = skill_dir / "escape.txt"
    try:
        os.symlink(outside, escape_link)
    except OSError:
        pytest.skip("symlinks are not permitted in this environment")

    with pytest.raises(ValueError, match="symbolic link"):
        skill_from_directory("acme/hello", skill_dir)


def test_catalog_refuses_cross_skill_normalized_uri_collision_and_whitespace_paths():
    with pytest.raises(ValueError, match="served by another skill"):
        SkillCatalog(
            [
                Skill(
                    path="group",
                    files={
                        "SKILL.md": _skill_md("group"),
                        "%6Eested/SKILL.md": "shadow",
                    },
                ),
                Skill(
                    path="group/nested",
                    files={"SKILL.md": _skill_md("nested")},
                ),
            ]
        )

    with pytest.raises(ValueError, match="whitespace"):
        SkillCatalog(
            [
                Skill(
                    path="hello",
                    files={"SKILL.md": _skill_md("hello"), "test file.txt": "x"},
                )
            ]
        )


def test_skill_from_directory_symlink_and_junction_edge_cases(tmp_path: Path):
    import subprocess
    import sys

    skill_dir = tmp_path / "hello"
    (skill_dir / "refs").mkdir(parents=True)
    (skill_dir / "SKILL.md").write_bytes(_skill_md("hello").encode("utf-8"))
    (skill_dir / "refs" / "target.md").write_bytes(b"ok\n")

    # On Windows, directory junctions must be refused even when unprivileged symlinks are off.
    if sys.platform == "win32":
        outside_dir = tmp_path / "outside"
        outside_dir.mkdir()
        (outside_dir / "secret.txt").write_bytes(b"secret")
        junction = skill_dir / "junc"
        res = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(junction), str(outside_dir)],
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode == 0:
            try:
                with pytest.raises(ValueError, match="symbolic link"):
                    skill_from_directory("hello", skill_dir)
            finally:
                os.rmdir(junction)

    # In-directory relative file symlink is allowed; symlink to dir and broken symlink refused.
    in_link = skill_dir / "alias.md"
    try:
        os.symlink(Path("refs") / "target.md", in_link)
    except OSError:
        pytest.skip("symlinks are not permitted in this environment")
    skill = skill_from_directory("hello", skill_dir)
    assert skill.files["alias.md"] == b"ok\n"
    in_link.unlink()

    dir_link = skill_dir / "dir-link"
    os.symlink(skill_dir / "refs", dir_link, target_is_directory=True)
    with pytest.raises(ValueError, match="symbolic link to a directory"):
        skill_from_directory("hello", skill_dir)
    dir_link.unlink()

    broken_link = skill_dir / "broken.md"
    os.symlink(skill_dir / "missing.md", broken_link)
    with pytest.raises(ValueError, match="cannot follow"):
        skill_from_directory("hello", skill_dir)
