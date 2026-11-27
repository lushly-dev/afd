"""A managed host serves its skills over MCP's Skills extension (lushly-dev/afd#2504)."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from afd.server.skills import Skill, SkillCatalog, sha256_digest
from starlette.testclient import TestClient

from botcore import (
    CommandHost,
    ExecutionContext,
    HostSkills,
    build_host,
    create_host_mcp_server,
)
from botcore.commands.skill._discovery import get_bundled_skills_dir
from botcore.host_skills import host_skill_catalog
from botcore.plugin import PluginRegistry

MODERN = "2026-07-28"
# Read apart from the code under test: each bundled folder is named for its skill.
BUNDLED = sorted(path.parent.name for path in get_bundled_skills_dir().glob("*/SKILL.md"))


def _write_skill(root: Path, name: str, description: str) -> Path:
    folder = root / name
    (folder / "references").mkdir(parents=True)
    (folder / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n", encoding="utf-8"
    )
    (folder / "references" / "notes.md").write_text("Notes.\n", encoding="utf-8")
    return folder


class _SkillPlugin:
    host_context_safe = True

    def __init__(self, skills_dir: Path) -> None:
        self.skills_dir = skills_dir

    def register(self, registry: PluginRegistry) -> None:
        registry.add_skills_dir(self.skills_dir)


def _host(tmp_path: Path, skills_dir: Path | None = None) -> Any:
    tmp_path.mkdir(parents=True, exist_ok=True)
    plugins = {"notes": _SkillPlugin(skills_dir)} if skills_dir is not None else {}
    with patch("botcore.plugin.discover_plugins", return_value=plugins):
        return build_host("notes", ExecutionContext(tmp_path), plugins=tuple(plugins))


def _rpc(client: TestClient, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    headers = {
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": MODERN,
        "Mcp-Method": method,
    }
    if method == "resources/read" and params:
        headers["Mcp-Name"] = params["uri"]
    meta = {
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientCapabilities": {},
    }
    response = client.post(
        "/mcp",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": {**(params or {}), "_meta": meta},
        },
    )
    assert response.status_code == 200, response.text
    body = response.text
    if body.startswith("event"):
        return json.loads(next(line for line in body.splitlines() if line.startswith("data: "))[6:])
    return response.json()  # type: ignore[no-any-return]


def _client(server: Any) -> TestClient:
    return TestClient(
        server.streamable_http_app(stateless_http=True), base_url="http://127.0.0.1:8000"
    )


def _read_bytes(client: TestClient, uri: str) -> bytes:
    (content,) = _rpc(client, "resources/read", {"uri": uri})["result"]["contents"]
    if "blob" in content:
        return base64.b64decode(content["blob"])
    return content["text"].encode("utf-8")  # type: ignore[no-any-return]


def _names(client: TestClient) -> list[str]:
    skills = _rpc(client, "skills/list")["result"]["skills"]
    return [skill["frontmatter"]["name"] for skill in skills]


def _serves_skills(server: Any) -> bool:
    with _client(server) as client:
        capabilities = _rpc(client, "server/discover")["result"]["capabilities"]
    extensions = capabilities.get("extensions", {})
    return "io.modelcontextprotocol/skills" in extensions or "resources" in capabilities


def test_every_bundled_skill_is_served(tmp_path: Path) -> None:
    assert len(BUNDLED) == 12
    with _client(create_host_mcp_server(_host(tmp_path))) as client:
        assert sorted(_names(client)) == BUNDLED


def test_host_lists_bundled_and_plugin_skills_with_matching_digests(tmp_path: Path) -> None:
    plugin_skills = tmp_path / "plugin-skills"
    _write_skill(plugin_skills, "notes-guide", "Use the notes host.")
    server = create_host_mcp_server(_host(tmp_path / "work", plugin_skills))

    with _client(server) as client:
        discover = _rpc(client, "server/discover")["result"]
        assert "io.modelcontextprotocol/skills" in discover["capabilities"]["extensions"]

        skills = _rpc(client, "skills/list")["result"]["skills"]
        names = [skill["frontmatter"]["name"] for skill in skills]
        assert sorted(names) == sorted([*BUNDLED, "notes-guide"])

        for skill in skills:
            for resource in skill["resources"]:
                data = _read_bytes(client, resource["uri"])
                assert sha256_digest(data) == resource["digest"], resource["uri"]
                assert len(data) == resource["size"]

    guide = next(skill for skill in skills if skill["frontmatter"]["name"] == "notes-guide")
    assert [resource["uri"] for resource in guide["resources"]] == [
        "skill://notes-guide/SKILL.md",
        "skill://notes-guide/references/notes.md",
    ]


def test_plugin_skill_replaces_a_bundled_skill_of_the_same_name(tmp_path: Path) -> None:
    plugin_skills = tmp_path / "plugin-skills"
    _write_skill(plugin_skills, BUNDLED[0], "The plugin's own version.")
    server = create_host_mcp_server(_host(tmp_path / "work", plugin_skills))

    with _client(server) as client:
        skills = _rpc(client, "skills/list")["result"]["skills"]
        served = [skill for skill in skills if skill["frontmatter"]["name"] == BUNDLED[0]]
        assert len(served) == 1
        assert served[0]["frontmatter"]["description"] == "The plugin's own version."


def test_workspace_include_limits_what_the_host_serves(tmp_path: Path) -> None:
    work = tmp_path / "work"
    work.mkdir()
    (work / "botcore.toml").write_text(f'[skills]\ninclude = ["{BUNDLED[1]}"]\n', encoding="utf-8")
    with _client(create_host_mcp_server(_host(work))) as client:
        assert _names(client) == [BUNDLED[1]]


def test_workspace_skip_and_seeded_copies_are_not_served(tmp_path: Path) -> None:
    work = tmp_path / "work"
    _write_skill(work / ".claude" / "skills", BUNDLED[2], "A seeded copy.")
    (work / "botcore.toml").write_text(f'[skills]\nskip = ["{BUNDLED[1]}"]\n', encoding="utf-8")
    with _client(create_host_mcp_server(_host(work))) as client:
        assert sorted(_names(client)) == [name for name in BUNDLED if name not in BUNDLED[1:3]]


def test_a_folder_is_served_under_its_frontmatter_name(tmp_path: Path) -> None:
    plugin_skills = tmp_path / "plugin-skills"
    folder = plugin_skills / "folder-name"
    folder.mkdir(parents=True)
    # YAML 1.2, which the Skills extension reads, takes `yes` as a string.
    (folder / "SKILL.md").write_text(
        "---\nname: yes\ndescription: Named in its frontmatter.\n---\n", encoding="utf-8"
    )
    with _client(create_host_mcp_server(_host(tmp_path / "work", plugin_skills))) as client:
        names = _names(client)
    assert "yes" in names
    assert "folder-name" not in names


def test_skills_none_serves_no_skills(tmp_path: Path) -> None:
    assert not _serves_skills(create_host_mcp_server(_host(tmp_path), skills=None))


def test_a_host_not_built_by_build_host_serves_none_until_given_sources(tmp_path: Path) -> None:
    host = CommandHost("bare", ExecutionContext(tmp_path))
    assert not _serves_skills(create_host_mcp_server(host))

    host.skills = HostSkills(include=(BUNDLED[0],))
    with _client(create_host_mcp_server(host)) as client:
        assert _names(client) == [BUNDLED[0]]


def test_a_catalog_passed_in_replaces_the_default(tmp_path: Path) -> None:
    files = {"SKILL.md": "---\nname: own-skill\ndescription: Its own.\n---\n"}
    catalog = SkillCatalog([Skill(path="own-skill", files=files)])
    with _client(create_host_mcp_server(_host(tmp_path), skills=catalog)) as client:
        assert _names(client) == ["own-skill"]


_VALID = b"---\nname: broken-skill\ndescription: Breaks a rule.\n---\n"


@pytest.mark.parametrize(
    ("files", "problem"),
    [
        # Botcore's seeding copies each of these; the Skills extension cannot serve them.
        ({"SKILL.md": _VALID, "my notes.md": b"Notes."}, "whitespace"),
        ({"skill.md": _VALID}, "not skill.md"),
        ({"SKILL.md": b"---\ndescription: No name.\n---\n"}, "no name"),
        ({"SKILL.md": b"---\nname: [unclosed\n---\n"}, "YAML"),
        ({"SKILL.md": b"---\nname: broken-skill\ndescription: \xff\n---\n"}, "UTF-8"),
    ],
)
def test_a_broken_plugin_skill_refuses_the_server_naming_its_folder(
    tmp_path: Path, files: dict[str, bytes], problem: str
) -> None:
    folder = tmp_path / "plugin-skills" / "broken-folder"
    folder.mkdir(parents=True)
    for name, data in files.items():
        (folder / name).write_bytes(data)

    with pytest.raises(ValueError, match="skills=None") as refused:
        create_host_mcp_server(_host(tmp_path / "work", folder.parent))
    assert str(folder) in str(refused.value)
    assert problem in str(refused.value)


def test_folders_without_a_skill_are_ignored(tmp_path: Path) -> None:
    plugin_skills = tmp_path / "plugin-skills"
    (plugin_skills / "__pycache__").mkdir(parents=True)
    (plugin_skills / "README.md").write_text("Not a skill.", encoding="utf-8")
    catalog = host_skill_catalog(_host(tmp_path / "work", plugin_skills))
    assert catalog is not None
    assert len(catalog) == len(BUNDLED)


def test_a_host_on_a_target_folder_finds_skills_seeded_at_the_worktree_root(tmp_path: Path) -> None:
    _write_skill(tmp_path / ".claude" / "skills", BUNDLED[0], "Seeded at the root.")
    (tmp_path / "packages" / "core").mkdir(parents=True)
    with patch("botcore.plugin.discover_plugins", return_value={}):
        host = build_host("notes", ExecutionContext(tmp_path, tmp_path / "packages" / "core"))
    with _client(create_host_mcp_server(host)) as client:
        assert BUNDLED[0] not in _names(client)
