"""Skills kept outside a project's default skill folders (#1830): extra_dirs, aliases,
personal/external skill folders and recorded loaded file locations."""

# ruff: noqa: F811 - pytest fixtures imported from the collect and machines tests

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from botcore.commands.skill_usage import (
    skill_usage_collect,
    skill_usage_report,
    skill_usage_triggers,
    store,
)
from botcore.commands.skill_usage.events import skill_files_read_by
from tests.test_skill_usage import (  # noqa: F401 - fixtures
    T3Store,
    checkout,
    checkout_at,
    fail,
    git,
    rows,
    run,
    skill_text,
    stamp,
    state,
    t3_store,
)
from tests.test_skill_usage_machines import Machines, machines  # noqa: F401
from tests.test_skill_usage_triggers import link, merge, rule, session  # noqa: F401


def _write_skill(base: Path, name: str, description: str, size: int) -> Path:
    folder = base / name
    folder.mkdir(parents=True, exist_ok=True)
    skill_file = folder / "SKILL.md"
    skill_file.write_text(skill_text(name, description, size), encoding="utf-8")
    return skill_file


# ── repository extra_dirs and aliases ───────────────────────────────────────


def test_extra_dirs_gives_size_quiet_renames_and_typed_from_default_branch(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    src_skills = checkout / "src" / "skills"
    used_file = _write_skill(src_skills, "canonical-used", "Canonical used.", 260)
    _write_skill(src_skills, "canonical-quiet", "Canonical quiet.", 180)
    (checkout / "botcore.toml").write_text('[skills]\nextra_dirs = ["src/skills"]\n', "utf-8")
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "initial")

    # Rename a skill inside extra_dirs on main
    old_file = _write_skill(src_skills, "old-canonical", "Canonical renamed.", 210)
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "add old-canonical")
    (src_skills / "new-canonical").mkdir()
    git(checkout, "mv", str(old_file), str(src_skills / "new-canonical" / "SKILL.md"))
    git(checkout, "commit", "-q", "-m", "rename in extra_dirs")

    # Topic branch adds an unmerged skill: default branch inventory must not list it
    git(checkout, "checkout", "-q", "-b", "topic")
    _write_skill(src_skills, "unmerged-extra", "Only on topic.", 140)
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "topic skill")

    t1 = t3_store.thread("t1")
    t3_store.read_tool(t1, str(used_file), stamp(1))
    t2 = t3_store.thread("t2")
    t3_store.skill_tool(t2, "old-canonical", stamp(1))
    t3 = t3_store.thread("t3")
    # Outside 30d window: proves typed name was recognised while keeping skill quiet
    t3_store.message(t3, "$canonical-quiet please run", stamp(200))

    run(skill_usage_collect())
    data = run(skill_usage_report(project="garden"))
    by_name = rows(data)

    assert by_name["canonical-used"]["size_bytes"] == 260
    assert by_name["canonical-used"]["max_context_bytes"] == 260
    assert by_name["canonical-used"]["listing_chars"] == len("Canonical used.")
    assert by_name["new-canonical"]["also_loaded_as"] == ["old-canonical"]
    assert by_name["new-canonical"]["size_bytes"] == 210

    quiet_by_name = {item["skill"]: item for item in data["quiet"]}
    assert "canonical-quiet" in quiet_by_name
    assert quiet_by_name["canonical-quiet"]["size_bytes"] == 180
    assert quiet_by_name["canonical-quiet"]["listing_chars"] == len("Canonical quiet.")
    assert quiet_by_name["canonical-quiet"]["last_used"] is not None  # typed event was kept
    assert "unmerged-extra" not in quiet_by_name


def test_pyproject_skills_extra_dirs_and_custom_source_dir_and_non_git(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    _write_skill(checkout / "custom" / "skills", "custom-src", "From source_dir.", 175)
    _write_skill(checkout / "extra" / "skills", "from-extra", "From extra_dirs.", 195)
    (checkout / "pyproject.toml").write_text(
        '[tool.botcore.skills]\nsource_dir = "custom/skills"\nextra_dirs = ["extra/skills"]\n',
        "utf-8",
    )
    # botcore.toml must be ignored when pyproject.toml has [tool.botcore]
    (checkout / "botcore.toml").write_text('[skills]\nextra_dirs = ["ignored/skills"]\n', "utf-8")
    _write_skill(checkout / "ignored" / "skills", "should-ignore", "Ignored.", 150)
    t3_store.skill_tool(t3_store.thread("t1"), "custom-src", stamp(1))

    run(skill_usage_collect())
    data = run(skill_usage_report(project="garden"))

    assert rows(data)["custom-src"]["size_bytes"] == 175
    quiet_names = {item["skill"] for item in data["quiet"]}
    assert "from-extra" in quiet_names
    assert "should-ignore" not in quiet_names


def test_aliases_fold_canonical_and_exported_names_in_report_and_triggers(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    _write_skill(checkout / ".claude" / "skills", "maintain-gates", "Exported gates.", 240)
    canonical = _write_skill(
        checkout / "src" / "skills", "gate-discipline", "Canonical gates.", 310
    )
    _write_skill(checkout / "src" / "skills", "agent-config", "Only canonical.", 160)
    (checkout / "botcore.toml").write_text(
        '[skills]\nextra_dirs = ["src/skills"]\n\n'
        '[skills.aliases]\ngate-discipline = "maintain-gates"\n\n'
        '[[skills.required]]\nskill = "maintain-gates"\npaths = ["hooks.yml"]\n',
        "utf-8",
    )
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "remote", "add", "origin", "git@example.com:acme/garden.git")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "start")
    merge(checkout, "feat: add hook (#42)", "hooks.yml")

    t1 = t3_store.thread("t1")
    t3_store.skill_tool(t1, "maintain-gates", stamp(1))
    opener = session(t3_store, "opener", (42, stamp(1)))
    t3_store.read_tool(opener, str(canonical), stamp(2))

    run(skill_usage_collect())
    data = run(skill_usage_report(project="acme/garden"))
    by_name = rows(data)

    # Both loads fold into maintain-gates, keeping the exported file's size
    assert "gate-discipline" not in by_name
    row = by_name["maintain-gates"]
    assert (row["sessions"], row["loads"]) == (2, 2)
    assert row["also_loaded_as"] == ["gate-discipline"]
    assert row["size_bytes"] == 240
    assert row["listing_chars"] == len("Exported gates.")

    # gate-discipline does not appear as a duplicate in quiet; unaliased agent-config does
    quiet_names = {item["skill"] for item in data["quiet"]}
    assert "gate-discipline" not in quiet_names
    assert "maintain-gates" not in quiet_names
    assert "agent-config" in quiet_names

    # Triggers report recognises the canonical load as satisfying maintain-gates
    trig = rule(run(skill_usage_triggers(repo=str(checkout))))
    assert trig["skill"] == "maintain-gates"
    assert (trig["loaded"], trig["missed"]) == (1, 0)


def test_malformed_botcore_toml_falls_back_to_default_skill_dirs(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    (checkout / "botcore.toml").write_text("[skills\nbroken = true\n", "utf-8")
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "start")
    t3_store.skill_tool(t3_store.thread("t1"), "plant-beds", stamp(1))

    run(skill_usage_collect())
    data = run(skill_usage_report(project="garden"))
    assert rows(data)["plant-beds"]["size_bytes"] == 200


def test_upgrade_refreshes_cached_inventory_without_rebuild(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    _write_skill(checkout / "src" / "skills", "extra-one", "Extra one.", 220)
    (checkout / "botcore.toml").write_text('[skills]\nextra_dirs = ["src/skills"]\n', "utf-8")
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "start")
    t3_store.skill_tool(t3_store.thread("t1"), "plant-beds", stamp(1))
    run(skill_usage_collect())

    # Simulate state written by an older botcore (no inventory_version, empty extra-one)
    saved = store.load_state(state)
    saved.pop("inventory_version", None)
    saved["projects"]["garden"]["skills"]["held"].pop("extra-one", None)
    for account in saved["projects"]["garden"]["accounts"].values():
        account["held"].pop("extra-one", None)
    store.save_state(state, saved)

    run(skill_usage_collect())
    quiet_names = {item["skill"] for item in run(skill_usage_report(project="garden"))["quiet"]}
    assert "extra-one" in quiet_names


# ── recorded loaded skill files (outside configured folders) ────────────────


def test_loaded_external_plugin_file_measures_size_shares_without_paths_and_drops_when_removed(
    machines: Machines, tmp_path: Path
) -> None:
    plugin_root = tmp_path / "secret-plugins" / "acme" / "skills"
    plugin_file = _write_skill(plugin_root, "plugin-helper", "Help with plugins.", 275)
    shell_file = _write_skill(plugin_root, "shell-plugin", "Shell plugin.", 190)

    bench = machines.on("bench")
    t1 = bench.thread("t1")
    bench.read_tool(t1, str(plugin_file), stamp(1))
    bench.shell(t1, f'cat "{shell_file}"', stamp(1))
    run(skill_usage_collect())

    # Shared files must never leak the local plugin path
    secret_marker = "secret-plugins"
    for shared_file in (machines.shared / "bench").iterdir():
        assert secret_marker not in shared_file.read_text("utf-8")
    assert secret_marker not in (machines.record("bench") / store.EVENTS_FILE).read_text("utf-8")

    # Machine B (which never saw the plugin) gets the exact same sizes from the shared record
    machines.on("shed")
    shed_report = run(skill_usage_report(project="garden"))
    bench_report = None
    machines.on("bench")
    bench_report = run(skill_usage_report(project="garden"))
    for report in (bench_report, shed_report):
        by_name = rows(report)
        assert by_name["plugin-helper"]["size_bytes"] == 275
        assert by_name["plugin-helper"]["max_context_bytes"] == 275
        assert by_name["plugin-helper"]["listing_chars"] == len("Help with plugins.")
        assert by_name["shell-plugin"]["size_bytes"] == 190

    # Editing the plugin file updates its measured size on the next collection
    plugin_file.write_text(skill_text("plugin-helper", "Updated plugin.", 320), "utf-8")
    run(skill_usage_collect())
    assert rows(run(skill_usage_report(project="garden")))["plugin-helper"]["size_bytes"] == 320

    # Removing the file on mounted storage drops its observed entry on the next collection
    plugin_file.unlink()
    run(skill_usage_collect())
    assert "size_bytes" not in rows(run(skill_usage_report(project="garden")))["plugin-helper"]


def test_loaded_unconfigured_in_project_file_is_scoped_to_that_project(
    state: Path, t3_store: T3Store, checkout: Path, tmp_path: Path
) -> None:
    unlisted = _write_skill(checkout / "docs" / "skills", "local-note", "Local note.", 230)
    other = checkout_at(tmp_path / "other")
    t3_store.project("p2", other)

    t1 = t3_store.thread("t1", project_id="p1")
    t3_store.read_tool(t1, str(unlisted), stamp(1))
    t2 = t3_store.thread("t2", project_id="p2")
    t3_store.skill_tool(t2, "local-note", stamp(1))

    run(skill_usage_collect())
    garden_rows = rows(run(skill_usage_report(project="garden")))
    other_rows = rows(run(skill_usage_report(project="other")))

    assert garden_rows["local-note"]["size_bytes"] == 230
    assert "size_bytes" not in other_rows["local-note"]


def test_git_show_returns_no_disk_file_path() -> None:
    assert skill_files_read_by("git show HEAD:.claude/skills/foo/SKILL.md") == [("foo", None)]
    assert skill_files_read_by("cat /x/skills/foo/SKILL.md") == [("foo", "/x/skills/foo/SKILL.md")]


# ── personal / configured external skill folders ────────────────────────────


def test_user_skill_dirs_supply_sizes_typed_recognition_and_external_quiet(
    machines: Machines, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    personal = tmp_path / "my-personal-skills"
    _write_skill(personal, "personal-used", "Personal used.", 210)
    _write_skill(personal, "personal-quiet", "Personal quiet.", 155)
    monkeypatch.setenv(store.USER_DIRS_ENV, str(personal))

    bench = machines.on("bench")
    t1 = bench.thread("t1")
    # Loaded via skill_tool (no file path!) — size still comes from personal dir
    bench.skill_tool(t1, "personal-used", stamp(1))
    # Typed name recognised because personal dir holds it
    bench.message(t1, "$personal-quiet run later", stamp(200))
    run(skill_usage_collect())

    # Never leaks the personal folder path into the shared copy
    for shared_file in (machines.shared / "bench").iterdir():
        assert "my-personal-skills" not in shared_file.read_text("utf-8")

    # Full report (project=None): personal-used has size; personal-quiet is in quiet under external
    data = run(skill_usage_report())
    assert rows(data)["personal-used"]["size_bytes"] == 210
    ext_quiet = [item for item in data["quiet"] if item["project"] == "external"]
    assert ext_quiet == [
        {
            "project": "external",
            "skill": "personal-quiet",
            "last_used": stamp(200),
            "size_bytes": 155,
            "listing_chars": len("Personal quiet."),
        }
    ]

    # Filtering by project hides external quiet entries
    proj_only = run(skill_usage_report(project="garden"))
    assert all(item["project"] != "external" for item in proj_only["quiet"])

    # Filtering by skill=personal-quiet is accepted (known) and returns it in quiet
    by_skill = run(skill_usage_report(skill="personal-quiet"))
    assert len(by_skill["quiet"]) == 1 and by_skill["quiet"][0]["skill"] == "personal-quiet"

    # Machine B reads the shared folder with no personal dir of its own and gets the same report
    monkeypatch.setenv(store.USER_DIRS_ENV, "")
    machines.on("shed")
    shed_data = run(skill_usage_report())
    assert rows(shed_data)["personal-used"]["size_bytes"] == 210
    assert [item for item in shed_data["quiet"] if item["project"] == "external"] == ext_quiet


def test_machine_settings_skill_usage_dirs_and_relative_refusal(
    state: Path, t3_store: T3Store, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    extra_dir = tmp_path / "extra-plugin-skills"
    _write_skill(extra_dir, "from-settings", "From disk.toml.", 165)
    settings_file = tmp_path / "disk.toml"
    monkeypatch.setenv("BOTCORE_DISK_SETTINGS", str(settings_file))
    monkeypatch.delenv(store.USER_DIRS_ENV)
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "empty-claude"))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path / "empty-home"))

    settings_file.write_text(
        f"skill_usage_dirs = [{json.dumps(str(extra_dir))}]\n", encoding="utf-8"
    )
    t3_store.skill_tool(t3_store.thread("t1"), "plant-beds", stamp(1))
    run(skill_usage_collect())
    ext_quiet = [
        item for item in run(skill_usage_report())["quiet"] if item["project"] == "external"
    ]
    assert [item["skill"] for item in ext_quiet] == ["from-settings"]

    # Relative path in skill_usage_dirs is refused
    settings_file.write_text('skill_usage_dirs = ["relative/skills"]\n', encoding="utf-8")
    err = fail(skill_usage_collect())
    assert err.code == "INVALID_INPUT"


def test_user_dirs_env_supports_multiple_paths(
    state: Path, t3_store: T3Store, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    d1, d2 = tmp_path / "u1", tmp_path / "u2"
    _write_skill(d1, "alpha-user", "Alpha.", 130)
    _write_skill(d2, "beta-user", "Beta.", 140)
    monkeypatch.setenv(store.USER_DIRS_ENV, os.pathsep.join([str(d1), str(d2)]))
    t3_store.skill_tool(t3_store.thread("t1"), "plant-beds", stamp(1))

    run(skill_usage_collect())
    ext_quiet = {
        item["skill"]: item["size_bytes"]
        for item in run(skill_usage_report())["quiet"]
        if item["project"] == "external"
    }
    assert ext_quiet == {"alpha-user": 130, "beta-user": 140}


# ── review regression coverage ──────────────────────────────────────────────


def test_extra_dirs_not_named_skills_recognizes_reads_shell_and_edits(
    state: Path, t3_store: T3Store, checkout: Path
) -> None:
    guides = checkout / "guides"
    leaf_file = _write_skill(guides, "leaf", "Leaf guide.", 215)
    edited_file = _write_skill(guides, "stem", "Stem guide.", 185)
    (checkout / "botcore.toml").write_text('[skills]\nextra_dirs = ["guides"]\n', "utf-8")
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "guides")

    t1 = t3_store.thread("t1")
    t3_store.read_tool(t1, str(leaf_file), stamp(1))
    t2 = t3_store.thread("t2")
    t3_store.shell(t2, f'cat "{leaf_file}"', stamp(1))
    t3 = t3_store.thread("t3")
    t3_store.read_tool(t3, str(edited_file), stamp(1))
    t3_store.item(t3, "file_change", stamp(1), fileName="guides/stem/SKILL.md")

    run(skill_usage_collect())
    data = run(skill_usage_report(project="garden"))
    by_name = rows(data)

    assert (by_name["leaf"]["sessions"], by_name["leaf"]["loads"]) == (2, 2)
    assert by_name["leaf"]["size_bytes"] == 215
    quiet_names = {item["skill"] for item in data["quiet"]}
    assert "leaf" not in quiet_names
    # t3 edited guides/stem/SKILL.md, so stem is authoring, not use
    assert "stem" not in by_name
    stem_quiet = next(item for item in data["quiet"] if item["skill"] == "stem")
    assert stem_quiet["authoring_sessions"] == 1


def test_linked_worktree_unmerged_and_unconfigured_skills_stay_scoped(
    state: Path, t3_store: T3Store, checkout: Path, tmp_path: Path
) -> None:
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "main")
    worktree = tmp_path / "garden-wt"
    git(checkout, "worktree", "add", "-q", "-b", "topic", str(worktree))
    unmerged = _write_skill(worktree / ".claude" / "skills", "topic-only", "Unmerged.", 140)
    _write_skill(worktree / "docs" / "skills", "wt-local", "Worktree local.", 235)

    other = checkout_at(tmp_path / "other")
    t3_store.project("p2", other)

    t1 = t3_store.thread("t1", project_id="p1", extra={"worktreePath": str(worktree)})
    t3_store.read_tool(t1, str(unmerged), stamp(1))
    # Relative path resolved against worktreePath (load.cwd)
    t3_store.read_tool(t1, "docs/skills/wt-local/SKILL.md", stamp(1))
    t2 = t3_store.thread("t2", project_id="p2")
    t3_store.skill_tool(t2, "topic-only", stamp(1))
    t3_store.skill_tool(t2, "wt-local", stamp(1))

    run(skill_usage_collect())
    garden_rows = rows(run(skill_usage_report(project="garden")))
    other_rows = rows(run(skill_usage_report(project="other")))

    # Unmerged topic-branch skill inside linked worktree's .claude/skills gets no size anywhere
    assert "size_bytes" not in garden_rows["topic-only"]
    assert "size_bytes" not in other_rows["topic-only"]
    # Unconfigured worktree skill gets size in garden ONLY, never leaks globally to other
    assert garden_rows["wt-local"]["size_bytes"] == 235
    assert "size_bytes" not in other_rows["wt-local"]


def test_name_collision_with_project_skill_still_records_external_file(
    state: Path, t3_store: T3Store, checkout: Path, tmp_path: Path
) -> None:
    ext_file = _write_skill(tmp_path / "ext-plugins" / "skills", "plant-beds", "External.", 333)
    other = tmp_path / "bare"
    other.mkdir()
    t3_store.project("p2", other)

    t1 = t3_store.thread("t1", project_id="p1")
    t3_store.read_tool(t1, str(ext_file), stamp(1))
    t2 = t3_store.thread("t2", project_id="p2")
    t3_store.skill_tool(t2, "plant-beds", stamp(1))

    run(skill_usage_collect())
    # garden keeps its authoritative size (200); bare (no plant-beds) gets the external size (333)
    assert rows(run(skill_usage_report(project="garden")))["plant-beds"]["size_bytes"] == 200
    assert rows(run(skill_usage_report(project="bare")))["plant-beds"]["size_bytes"] == 333


def test_external_skill_named_like_bundled_rename_keeps_identity_and_size(
    state: Path, t3_store: T3Store, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    personal = tmp_path / "personal"
    _write_skill(personal, "review-code", "My personal review skill.", 250)
    monkeypatch.setenv(store.USER_DIRS_ENV, str(personal))

    t1 = t3_store.thread("t1")
    t3_store.skill_tool(t1, "review-code", stamp(1))
    run(skill_usage_collect())

    data = run(skill_usage_report())
    by_name = rows(data)
    assert "review-code" in by_name
    assert "code-reviewer" not in by_name
    assert by_name["review-code"]["size_bytes"] == 250
    assert all(item["skill"] != "review-code" for item in data["quiet"])


def test_removing_configured_alias_takes_effect_across_machines(
    machines: Machines,
) -> None:
    root = machines.project
    _write_skill(root / ".claude" / "skills", "exported", "Exported.", 200)
    _write_skill(root / "src" / "skills", "helper", "Helper.", 180)
    (root / "botcore.toml").write_text(
        '[skills]\nextra_dirs = ["src/skills"]\n[skills.aliases]\nhelper = "exported"\n',
        "utf-8",
    )
    git(root, "init", "-q", "-b", "main")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "with alias", at="2026-04-01T10:00:00+00:00")

    # Machine A (shed) collects at commit 1 (alias active)
    shed = machines.on("shed")
    shed.skill_tool(shed.thread("s1"), "helper", stamp(1))
    run(skill_usage_collect())
    assert "exported" in rows(run(skill_usage_report(project="garden")))

    # Commit 2 removes the alias; Machine B (bench) collects commit 2
    (root / "botcore.toml").write_text('[skills]\nextra_dirs = ["src/skills"]\n', "utf-8")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "drop alias", at="2026-04-02T10:00:00+00:00")
    bench = machines.on("bench")
    bench.skill_tool(bench.thread("b1"), "exported", stamp(1))
    run(skill_usage_collect())

    # Both machines now see helper and exported as separate skills
    for name in ("bench", "shed"):
        machines.on(name)
        by_name = rows(run(skill_usage_report(project="garden")))
        assert "helper" in by_name and "exported" in by_name
        assert by_name["helper"]["size_bytes"] == 180


def test_importing_copied_t3_store_preserves_local_personal_inventory(
    state: Path, t3_store: T3Store, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    personal = tmp_path / "personal"
    _write_skill(personal, "personal-keep", "Keep me.", 170)
    monkeypatch.setenv(store.USER_DIRS_ENV, str(personal))
    t3_store.skill_tool(t3_store.thread("t1"), "plant-beds", stamp(1))
    run(skill_usage_collect())

    copied = T3Store(tmp_path / "copied.sqlite", prefix="other")
    copied.project("p1", tmp_path / "elsewhere")
    copied.skill_tool(copied.thread("c1"), "plant-beds", stamp(1))
    run(skill_usage_collect(t3_store=str(copied.path), machine="other"))

    ext_quiet = [
        item["skill"]
        for item in run(skill_usage_report())["quiet"]
        if item["project"] == "external"
    ]
    assert ext_quiet == ["personal-keep"]


@pytest.mark.parametrize("bad_entry", ["C:\\allowed\\..\\alternate", "/a/../b", "/a\x00b"])
def test_skill_usage_dirs_and_env_reject_traversal_and_nul_with_suggestion(
    state: Path, t3_store: T3Store, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, bad_entry: str
) -> None:
    if "\x00" not in bad_entry:
        monkeypatch.setenv(store.USER_DIRS_ENV, bad_entry)
        err = fail(skill_usage_collect())
        assert err.code == "INVALID_INPUT"
        assert "BOTCORE_SKILL_USAGE_USER_DIRS" in err.suggestion

    monkeypatch.delenv(store.USER_DIRS_ENV, raising=False)
    settings_file = tmp_path / "disk.toml"
    monkeypatch.setenv("BOTCORE_DISK_SETTINGS", str(settings_file))
    settings_file.write_text(f"skill_usage_dirs = [{json.dumps(bad_entry)}]\n", encoding="utf-8")
    err2 = fail(skill_usage_collect())
    assert err2.code == "INVALID_INPUT"
    assert "skill_usage_dirs" in err2.suggestion


def test_claude_code_transcript_records_external_plugin_file_size(
    state: Path, checkout: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    git(checkout, "init", "-q", "-b", "main")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-q", "-m", "start")
    plugin_file = _write_skill(tmp_path / "cc-plugins" / "skills", "cc-plugin", "CC plugin.", 265)
    claude_dir = tmp_path / "claude-projects"
    proj_dir = claude_dir / "garden-proj"
    proj_dir.mkdir(parents=True)
    transcript = proj_dir / "sess-1.jsonl"
    rows_jsonl = [
        {
            "type": "assistant",
            "sessionId": "sess-1",
            "cwd": str(checkout),
            "entrypoint": "claude-desktop",
            "timestamp": stamp(1),
            "message": {
                "model": "claude-opus-5-5",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_cc1",
                        "name": "Read",
                        "input": {"file_path": str(plugin_file)},
                    }
                ],
            },
        },
        {
            "type": "user",
            "sessionId": "sess-1",
            "cwd": str(checkout),
            "entrypoint": "claude-desktop",
            "timestamp": stamp(1),
            "message": {
                "content": [{"type": "tool_result", "tool_use_id": "toolu_cc1", "is_error": False}]
            },
        },
    ]
    transcript.write_text("\n".join(json.dumps(r) for r in rows_jsonl) + "\n", encoding="utf-8")
    monkeypatch.setenv("BOTCORE_SKILL_USAGE_CLAUDE_DIR", str(claude_dir))

    run(skill_usage_collect())
    by_name = rows(run(skill_usage_report(project="garden")))
    assert by_name["cc-plugin"]["size_bytes"] == 265
    assert "cc-plugins" not in (state / store.EVENTS_FILE).read_text("utf-8")


def test_non_int_inventory_version_and_pruning_observed_files(
    state: Path, t3_store: T3Store, checkout: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    unlisted = _write_skill(checkout / "docs" / "skills", "later-added", "Later.", 205)
    personal = tmp_path / "personal"
    personal_file = _write_skill(personal, "in-user-dir", "In user dir.", 150)
    monkeypatch.setenv(store.USER_DIRS_ENV, str(personal))

    t1 = t3_store.thread("t1")
    t3_store.read_tool(t1, str(unlisted), stamp(1))
    t3_store.read_tool(t1, str(personal_file), stamp(1))
    run(skill_usage_collect())

    saved = store.load_state(state)
    # File inside user_dirs is not duplicated into external.files
    assert "in-user-dir" not in (saved.get("external") or {}).get("files", {})
    assert "later-added" in saved["projects"]["garden"]["observed_files"]

    # Non-int inventory_version refreshes cleanly; adding extra_dirs prunes observed entries
    saved["inventory_version"] = None
    store.save_state(state, saved)
    (checkout / "botcore.toml").write_text('[skills]\nextra_dirs = ["docs/skills"]\n', "utf-8")
    run(skill_usage_collect())
    after = store.load_state(state)
    assert "observed_files" not in after["projects"]["garden"]
    assert "observed" not in after["projects"]["garden"]["skills"]
    assert rows(run(skill_usage_report(project="garden")))["later-added"]["size_bytes"] == 205
