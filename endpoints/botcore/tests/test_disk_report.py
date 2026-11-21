"""disk-report: discovery, tiers and the safety rules that decide what may be stripped."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest
from click.testing import CliRunner
from pydantic import ValidationError

from botcore.commands.disk import caches, report, scan
from botcore.commands.disk.git import parse_worktree_list
from botcore.commands.disk.scan import Processes, busy_reason, compile_pattern
from botcore.config import DiskConfig

DISK_TOML = """\
[disk]
regenerable = [
  "dist",
  "build",
  "out",
  { path = "**/target", after_days = 1 },
  { path = "node_modules", when = "pressure" },
  "**/gen",
]
copies = [".env"]
"""

GITIGNORE = "dist/\nbuild/\ntarget/\nnode_modules/\ngen/\n.env\n.cache/\n"
OLD = time.time() - 10 * 86400


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(cwd), "-c", "user.email=t@example.com", "-c", "user.name=t", *args],
        check=True, capture_output=True, text=True,
    ).stdout


def age(path: Path, when: float = OLD) -> None:
    if path.exists():
        os.utime(path, (when, when))


def age_worktree(main: Path, worktree: Path) -> None:
    """Make a worktree look untouched for ten days: git's records and its build output."""
    admin = Path(git(worktree, "rev-parse", "--absolute-git-dir").strip())
    for name in ("HEAD", "index", "logs/HEAD", "ORIG_HEAD", "FETCH_HEAD"):
        age(admin / name)
    for folder, dirs, files in os.walk(worktree):
        dirs[:] = [d for d in dirs if d != ".git"]
        for name in files + dirs:
            path = Path(folder) / name
            if not path.is_symlink():
                age(path)


@pytest.fixture
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    main = tmp_path / "main"
    main.mkdir()
    git(main, "init", "-q", "-b", "main")
    (main / "botcore.toml").write_text(DISK_TOML, encoding="utf-8")
    (main / ".gitignore").write_text(GITIGNORE, encoding="utf-8")
    (main / "build").mkdir()
    (main / "build" / "keep.txt").write_text("tracked", encoding="utf-8")
    git(main, "add", "-f", ".")
    git(main, "commit", "-q", "-m", "init")
    trees = tmp_path / "trees"
    old = trees / "old"
    fresh = trees / "fresh"
    git(main, "worktree", "add", "-q", "-b", "old", str(old))
    git(main, "worktree", "add", "-q", "-b", "fresh", str(fresh))
    for wt in (old, fresh):
        (wt / "dist").mkdir()
        (wt / "dist" / "bundle.js").write_bytes(b"x" * 20000)
    settings = tmp_path / "disk.toml"
    settings.write_text(f'repos = [{json.dumps(str(main))}]\ncaches = []\n', encoding="utf-8")
    monkeypatch.setenv("BOTCORE_DISK_SETTINGS", str(settings))
    monkeypatch.setenv("BOTCORE_DISK_T3_SETTINGS", "")
    monkeypatch.setenv("CARGO_HOME", str(tmp_path / "cargo-home"))  # not the machine's own
    for name in ("CARGO_TARGET_DIR", "CARGO_BUILD_TARGET_DIR", "CARGO_BUILD_BUILD_DIR"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(report, "running_processes", lambda: Processes(method="test"))
    return {"main": main, "old": old, "fresh": fresh, "settings": settings, "tmp": tmp_path}


def run_report(**kwargs) -> dict:
    result = asyncio.run(report.disk_report(**kwargs))
    assert result.success, result.error
    return result.data


def rows(data: dict) -> dict[str, dict]:
    return {Path(w["path"]).name: w for r in data["repos"] for w in r["worktrees"]}


# ── Configuration ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("bad", ["../x", "/abs", "a\\b", ".git/hooks", "**", "C:/x", "a/./b", ""])
def test_disk_config_refuses_patterns_that_leave_the_worktree(bad: str) -> None:
    with pytest.raises(ValidationError):
        DiskConfig(regenerable=[bad])
    with pytest.raises(ValidationError):
        DiskConfig(regenerable=[{"path": bad}])


def test_disk_config_refuses_unknown_keys() -> None:
    with pytest.raises(ValidationError):
        DiskConfig(regenerable=[{"path": "dist", "when": "always"}])
    with pytest.raises(ValidationError):
        DiskConfig(remove_everything=True)


def test_pattern_globs() -> None:
    target = compile_pattern("**/target")
    assert target.match("target") and target.match("a/b/target")
    assert not target.match("atarget") and not target.match("target/x")
    dist = compile_pattern("apps/*/dist")
    assert dist.match("apps/web/dist") and not dist.match("apps/web/x/dist")


def test_parse_worktree_list_reads_locks_and_prunable() -> None:
    text = (
        "worktree /r\0HEAD abc\0branch refs/heads/main\0\0"
        "worktree /r/a\0HEAD def\0detached\0locked parked\0\0"
        "worktree /r/b\0HEAD 123\0branch refs/heads/b\0prunable gitdir file points nowhere\0\0"
    )
    main, a, b = parse_worktree_list(text)
    assert main.is_main and main.branch == "main"
    assert a.detached and a.locked == "parked" and not a.is_main
    assert b.prunable and b.branch == "b"


# ── Tiers ───────────────────────────────────────────────────────────────────


def test_idle_worktree_is_tier_1_and_fresh_one_waits(repo: dict[str, Path]) -> None:
    age_worktree(repo["main"], repo["old"])
    data = run_report()
    by = rows(data)
    assert by["old"]["tier"] == 1
    assert by["old"]["idle_days"] >= 9
    strip = {s["path"]: s for s in by["old"]["strip"]}
    assert strip["dist"]["ready"] and strip["dist"]["bytes"] >= 20000
    assert by["fresh"]["tier"] == 3
    assert any(r.startswith("idle 0") for r in by["fresh"]["reasons"])
    assert by["main"]["tier"] == 3 and "main checkout" in by["main"]["reasons"]
    assert not any(s["ready"] for s in by["main"]["strip"])
    assert data["totals"]["tier1_worktrees"] == 1


def date_reflog(reflog: Path, when: float) -> None:
    """Give every entry of a reflog the timestamp `when`, as if each was written then."""
    lines = []
    for line in reflog.read_text(encoding="utf-8").splitlines():
        head, tab, message = line.partition("\t")  # an entry without a message may have no tab
        prefix, _, zone = head.rsplit(" ", 2)
        lines.append(f"{prefix} {int(when)} {zone}{tab}{message}\n")
    reflog.write_text("".join(lines), encoding="utf-8")


def test_git_gc_rewriting_reflogs_leaves_an_idle_worktree_idle(repo: dict[str, Path]) -> None:
    old = repo["old"]
    reflog = Path(git(old, "rev-parse", "--absolute-git-dir").strip()) / "logs" / "HEAD"
    date_reflog(reflog, OLD)
    age_worktree(repo["main"], old)
    # What `git gc` runs: it rewrites every worktree's reflog, adding no entry. Set the file's
    # time to now as well, so the test does not depend on the installed git rewriting it.
    git(repo["main"], "reflog", "expire", "--all")
    os.utime(reflog, None)
    by = rows(run_report())
    assert by["old"]["tier"] == 1 and by["old"]["idle_days"] >= 9


def test_reflog_time_is_the_earlier_of_file_and_last_entry(tmp_path: Path) -> None:
    reflog = tmp_path / "HEAD"
    entry = "{} {} t <t@example.com> {} -0800\tcommit: x\n"
    reflog.write_text(entry.format("0" * 40, "1" * 40, int(OLD)), encoding="utf-8")
    assert scan.reflog_time(reflog) == pytest.approx(OLD, abs=1)  # rewritten now, entry old
    os.utime(reflog, (OLD - 86400, OLD - 86400))
    assert scan.reflog_time(reflog) == pytest.approx(OLD - 86400, abs=1)  # entry newer than file
    reflog.write_text("not a reflog\n", encoding="utf-8")
    assert scan.reflog_time(reflog) == pytest.approx(time.time(), abs=60)  # unreadable: file time
    reflog.write_text("", encoding="utf-8")
    assert scan.reflog_time(reflog) == pytest.approx(time.time(), abs=60)
    assert scan.reflog_time(tmp_path / "missing") is None


def test_tracked_and_unignored_paths_are_refused(repo: dict[str, Path]) -> None:
    old = repo["old"]
    (old / "out").mkdir()  # named by a pattern, but not ignored by git
    (old / "out" / "x").write_text("x", encoding="utf-8")
    age_worktree(repo["main"], old)
    refused = {r["path"]: r["reason"] for r in rows(run_report())["old"]["refused"]}
    assert refused["build"] == "holds a tracked file"
    assert refused["out"] == "not ignored by git"


def test_package_folders_are_never_searched(repo: dict[str, Path]) -> None:
    old = repo["old"]
    nested = old / "node_modules" / "pkg" / "gen"
    nested.mkdir(parents=True)
    (old / "src" / "gen").mkdir(parents=True)
    age_worktree(repo["main"], old)
    strip = {s["path"]: s for s in rows(run_report())["old"]["strip"]}
    assert "src/gen" in strip
    assert "node_modules/pkg/gen" not in strip
    assert strip["node_modules"]["when"] == "pressure" and not strip["node_modules"]["ready"]


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks need privileges on Windows")
def test_a_linked_candidate_is_a_link_and_never_followed(repo: dict[str, Path]) -> None:
    old = repo["old"]
    outside = repo["tmp"] / "outside"
    outside.mkdir()
    (outside / "precious").write_bytes(b"y" * 50000)
    (old / "gen").symlink_to(outside, target_is_directory=True)
    # "gen/" in .gitignore matches folders only; ignore the link itself too
    with (repo["main"] / ".git" / "info" / "exclude").open("a", encoding="utf-8") as exclude:
        exclude.write("gen\n")
    age_worktree(repo["main"], old)
    strip = {s["path"]: s for s in rows(run_report())["old"]["strip"]}
    assert strip["gen"]["kind"] == "link"
    assert strip["gen"]["bytes"] is None
    assert (outside / "precious").exists()


def test_busy_and_kept_worktrees_are_not_stripped(
    repo: dict[str, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    old, fresh = repo["old"], repo["fresh"]
    git(repo["main"], "worktree", "lock", "--reason", "parked for review", str(fresh))
    age_worktree(repo["main"], old)
    age_worktree(repo["main"], fresh)
    busy = Processes(cwds=[str(old / "dist")], method="test", sees_cwds=True)
    monkeypatch.setattr(report, "running_processes", lambda: busy)
    data = run_report()
    by = rows(data)
    assert by["old"]["tier"] == 3 and by["old"]["busy"]
    assert by["fresh"]["tier"] == 3
    assert "kept: parked for review" in by["fresh"]["reasons"]
    # protected rows advertise nothing: no ready path, no reclaimable bytes
    for row in (by["old"], by["fresh"]):
        assert not any(s["ready"] for s in row["strip"]) and row["strip_ready_bytes"] == 0
    assert data["totals"]["tier1_gb"] == 0


def test_missing_worktree_is_report_only(repo: dict[str, Path]) -> None:
    shutil.rmtree(repo["old"])
    by = rows(run_report())
    assert by["old"]["exists"] is False and by["old"]["tier"] == 3


def test_unverified_volume_blocks_the_repository(repo: dict[str, Path]) -> None:
    # The worktrees' parent is not a mount point, so a volume recorded there reads as unplugged
    trees = repo["old"].parent
    text = repo["settings"].read_text(encoding="utf-8")
    text += f'\n[[volume]]\nmount = {json.dumps(str(trees))}\nid = "recorded"\n'
    repo["settings"].write_text(text, encoding="utf-8")
    age_worktree(repo["main"], repo["old"])
    data = run_report()
    assert "not mounted" in data["repos"][0]["blocked"]
    old = rows(data)["old"]
    assert old["tier"] == 3 and old["strip"] == [] and old["reasons"][0].startswith("not inspected")


# ── Settings ────────────────────────────────────────────────────────────────


def test_disk_settings_come_from_a_commit_not_the_working_tree(repo: dict[str, Path]) -> None:
    main = repo["main"]
    (main / "botcore.toml").write_text(DISK_TOML.replace('"dist",', '"dist", "src",'))
    (repo["old"] / "src").mkdir()
    age_worktree(main, repo["old"])
    data = run_report()
    assert data["repos"][0]["config_ref"] == "refs/heads/main"
    assert "src" not in {s["path"] for s in rows(data)["old"]["strip"]}


def test_a_disk_section_this_botcore_cannot_read_skips_the_repository(
    repo: dict[str, Path],
) -> None:
    main = repo["main"]
    (main / "botcore.toml").write_text('[disk]\nfuture_key = 1\n', encoding="utf-8")
    git(main, "commit", "-q", "-am", "newer config")
    data = run_report()
    assert "not valid for this botcore" in data["repos"][0]["error"]
    assert data["repos"][0]["worktrees"] == []


def test_invalid_machine_settings_are_an_error(repo: dict[str, Path]) -> None:
    repo["settings"].write_text("repos = 3\n", encoding="utf-8")
    result = asyncio.run(report.disk_report())
    assert not result.success and result.error.code == "DISK_SETTINGS_INVALID"


def test_t3_code_worktrees_are_marked(
    repo: dict[str, Path], monkeypatch: pytest.MonkeyPatch,
) -> None:
    t3 = repo["tmp"] / "t3.json"
    t3.write_text(json.dumps({
        "worktreesDirectory": str(repo["old"].parent),
        "previousWorktreesDirectories": ["Dev", "/"],
    }))
    monkeypatch.setenv("BOTCORE_DISK_T3_SETTINGS", str(t3))
    data = run_report()
    assert rows(data)["old"]["managed_by"] == "t3-code"
    assert rows(data)["main"]["managed_by"] is None
    assert "/" not in data["t3_code_roots"]


def test_unclassified_lists_ignored_paths_no_rule_covers(repo: dict[str, Path]) -> None:
    old = repo["old"]
    (old / ".cache").mkdir()
    (old / ".cache" / "x").write_text("x", encoding="utf-8")
    (old / ".env").write_text("A=1", encoding="utf-8")
    listed = rows(run_report(unclassified=True))["old"]["unclassified"]
    assert ".cache/" in listed
    assert ".env" not in listed and "dist/" not in listed


def test_orphan_worktree_folders_are_reported(repo: dict[str, Path]) -> None:
    orphan = repo["tmp"] / "roots" / "proj" / "lost"
    orphan.mkdir(parents=True)
    (orphan / ".git").write_text("gitdir: /nowhere/worktrees/lost\n", encoding="utf-8")
    text = repo["settings"].read_text(encoding="utf-8")
    text = f'worktree_roots = [{json.dumps(str(repo["tmp"] / "roots"))}]\n' + text
    repo["settings"].write_text(text, encoding="utf-8")
    orphans = run_report()["orphans"]
    assert [o["path"] for o in orphans] == [str(orphan)]
    assert orphans[0]["reason"] == "its repository's record of it is gone"


def test_cli_prints_json(repo: dict[str, Path]) -> None:
    from botcore.cli import cli

    out = CliRunner().invoke(cli, ["disk-report", "--repo", str(repo["main"]), "--json"])
    assert out.exit_code == 0, out.output
    assert json.loads(out.output)["data"]["repos"][0]["main"] == str(repo["main"])


# ── Processes, caches and aged folders ──────────────────────────────────────


def test_busy_reason_respects_path_boundaries(tmp_path: Path) -> None:
    worktree = tmp_path / "t3-1"
    other = Processes(cmdlines=[f"node {tmp_path / 't3-10' / 'x.js'}"])
    assert busy_reason(worktree, other) is None
    hit = Processes(cmdlines=[f"node {worktree / 'x.js'} --flag"])
    assert busy_reason(worktree, hit) is not None
    cwd = Processes(cwds=[str(worktree / "src")])
    assert busy_reason(worktree, cwd) is not None


def test_pnpm_link_mode(tmp_path: Path) -> None:
    pkg = tmp_path / "a" / "node_modules" / ".pnpm" / "x@1" / "node_modules" / "x"
    pkg.mkdir(parents=True)
    (pkg / "package.json").write_text("{}", encoding="utf-8")
    assert caches.pnpm_link_mode([tmp_path / "a"]) == "clone-or-copy"
    os.link(pkg / "package.json", tmp_path / "store-copy")
    assert caches.pnpm_link_mode([tmp_path / "a"]) == "hardlink"
    assert caches.pnpm_link_mode([tmp_path / "none"]) == "unknown"


def test_aged_folders_by_age_and_size(tmp_path: Path) -> None:
    from botcore.commands.disk.settings import MachineSettings

    parent = tmp_path / "cache"
    for name, days, size in (("old", 9, 4000), ("mid", 3, 4000), ("new", 0, 4000)):
        folder = parent / name
        folder.mkdir(parents=True)
        (folder / "f").write_bytes(b"z" * size)
        when = time.time() - days * 86400
        os.utime(folder / "f", (when, when))
        os.utime(folder, (when, when))
    by_age = MachineSettings(aged=[{"path": f"{parent}/*", "max_age_days": 7}])
    rows_ = caches.report_aged(by_age, time.time(), time.monotonic() + 60)[0]["entries"]
    assert {Path(e["path"]).name for e in rows_ if e["eligible"]} == {"old"}
    by_size = MachineSettings(aged=[{"path": f"{parent}/*", "max_gb": 4000 * 1.5 / 1024**3}])
    rows_ = caches.report_aged(by_size, time.time(), time.monotonic() + 60)[0]["entries"]
    assert {Path(e["path"]).name for e in rows_ if e["eligible"]} == {"old", "mid"}


def test_home_and_roots_are_never_aged_folders() -> None:
    assert caches.unsafe_aged_root(Path.home()) is not None
    assert caches.unsafe_aged_root(Path(Path.home().anchor)) is not None
    assert caches.unsafe_aged_root(Path.home() / "some-cache-folder") is None
