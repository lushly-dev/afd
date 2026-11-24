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
        check=True,
        capture_output=True,
        text=True,
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
    settings.write_text(f"repos = [{json.dumps(str(main))}]\ncaches = []\n", encoding="utf-8")
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
    reflog.write_text("".join(lines), encoding="utf-8", newline="\n")


@pytest.mark.parametrize(
    "entries_at",
    [OLD, 1_600_000_000],
    ids=["entries kept", "entries expired, reflog emptied"],
)
def test_git_gc_rewriting_reflogs_leaves_an_idle_worktree_idle(
    repo: dict[str, Path],
    entries_at: float,
) -> None:
    old = repo["old"]
    reflog = Path(git(old, "rev-parse", "--absolute-git-dir").strip()) / "logs" / "HEAD"
    date_reflog(reflog, entries_at)
    age_worktree(repo["main"], old)
    # What `git gc` runs, twice: it rewrites every worktree's reflog and adds no entry. The
    # expiry is pinned so the machine's git config can't change it, and the file's time is set
    # to now so the test doesn't depend on the installed git rewriting it.
    for _ in range(2):
        git(
            repo["main"],
            "reflog",
            "expire",
            "--all",
            "--expire=90.days.ago",
            "--expire-unreachable=90.days.ago",
        )
        if reflog.exists():
            os.utime(reflog, None)
    by = rows(run_report())
    assert by["old"]["tier"] == 1 and by["old"]["idle_days"] >= 9


def test_reflog_time_is_the_earlier_of_file_and_last_entry(tmp_path: Path) -> None:
    reflog = tmp_path / "HEAD"
    now = time.time()
    old, new = "0" * 40, "1" * 40

    def entry(when: float | str, message: str = "\tcommit: x") -> str:
        return f"{old} {new} A B <a@example.com> {when} -0800{message}\n"

    def read(text: str) -> float | None:
        reflog.write_text(text, encoding="utf-8", newline="\n")
        return scan.reflog_time(reflog)

    assert read(entry(int(OLD))) == pytest.approx(OLD, abs=1)  # rewritten now, entry old
    assert read(entry(int(OLD), "")) == pytest.approx(OLD, abs=1)  # an entry with no tab
    assert read(entry(int(OLD), "\tfix <x@y> 7 +0000")) == pytest.approx(OLD, abs=1)
    os.utime(reflog, (OLD - 86400, OLD - 86400))
    assert scan.reflog_time(reflog) == pytest.approx(OLD - 86400, abs=1)  # entry newer than file
    # Not an entry: the file's time, never a number taken from the message.
    assert read("not a reflog\n") == pytest.approx(now, abs=60)
    assert read(entry("9" * 400)) == pytest.approx(now, abs=60)
    longer = entry(int(OLD)) + entry(int(OLD), "\t" + "m" * scan.REFLOG_TAIL + " 7 +0000")
    assert read(longer) == pytest.approx(now, abs=60)  # the last line starts before the tail
    # gc empties a reflog whose entries all expired: no activity from it at all.
    assert read("") is None
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
    repo: dict[str, Path],
    monkeypatch: pytest.MonkeyPatch,
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
    (main / "botcore.toml").write_text("[disk]\nfuture_key = 1\n", encoding="utf-8")
    git(main, "commit", "-q", "-am", "newer config")
    data = run_report()
    assert "not valid for this botcore" in data["repos"][0]["error"]
    assert data["repos"][0]["worktrees"] == []


def test_invalid_machine_settings_are_an_error(repo: dict[str, Path]) -> None:
    repo["settings"].write_text("repos = 3\n", encoding="utf-8")
    result = asyncio.run(report.disk_report())
    assert not result.success and result.error.code == "DISK_SETTINGS_INVALID"


def test_t3_code_worktrees_are_marked(
    repo: dict[str, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    t3 = repo["tmp"] / "t3.json"
    t3.write_text(
        json.dumps(
            {
                "worktreesDirectory": str(repo["old"].parent),
                "previousWorktreesDirectories": ["Dev", "/"],
            }
        )
    )
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


def test_unclassified_skips_collapsed_folder_holding_only_covered_children(
    repo: dict[str, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from botcore.commands.disk import unclassified

    main, old = repo["main"], repo["old"]
    (main / "botcore.toml").write_text(
        DISK_TOML.replace(
            '{ path = "node_modules", when = "pressure" }',
            '{ path = "**/node_modules", when = "pressure" }',
        ),
        encoding="utf-8",
    )
    (main / ".gitignore").write_text(GITIGNORE + "secret.local\nempty_ignored/\n", encoding="utf-8")
    git(main, "commit", "-q", "-am", "recursive node_modules rule")
    git(old, "merge", "-q", "main")

    # Separate top-level collapsed folder holding ONLY node_modules -> must be skipped.
    nm = old / "only_nm" / "examples" / "vanilla" / "node_modules" / "pkg"
    nm.mkdir(parents=True)
    (nm / "index.js").write_text("export {};\n", encoding="utf-8")

    # Separate top-level collapsed folder holding node_modules AND an uncovered file -> reported.
    mixed = old / "mixed_pkg" / "app"
    (mixed / "node_modules" / "pkg").mkdir(parents=True)
    (mixed / "node_modules" / "pkg" / "index.js").write_text("x", encoding="utf-8")
    (mixed / "secret.local").write_text("keep", encoding="utf-8")

    # Empty ignored folder with no matching rule -> fails safe as unclassified.
    (old / "empty_ignored").mkdir()

    listed = rows(run_report(unclassified=True))["old"]["unclassified"]
    assert "only_nm/" not in listed and not any("only_nm" in entry for entry in listed), listed
    assert "mixed_pkg/" in listed
    assert "empty_ignored/" in listed

    # Exceeding WALK_ENTRIES inside a single directory fails safe and reports the folder.
    (old / "only_nm" / "examples" / "vanilla" / "dist").mkdir()
    (old / "only_nm" / "examples" / "vanilla" / "gen").mkdir()
    with monkeypatch.context() as mp:
        mp.setattr(unclassified, "WALK_ENTRIES", 2)
        listed_bounded = rows(run_report(unclassified=True))["old"]["unclassified"]
    assert "only_nm/" in listed_bounded

    # Symlink matching a regenerable name inside a collapsed folder fails safe.
    if sys.platform != "win32":
        outside = repo["tmp"] / "symlink_target"
        outside.mkdir()
        (outside / "file.txt").write_text("x", encoding="utf-8")
        sym_parent = old / "linked_nm"
        sym_parent.mkdir()
        (sym_parent / "node_modules").symlink_to(outside, target_is_directory=True)
        # "node_modules/" in .gitignore matches directories only; ignore the link itself too.
        with (main / ".git" / "info" / "exclude").open("a", encoding="utf-8") as exclude:
            exclude.write("linked_nm/node_modules\n")
        listed_link = rows(run_report(unclassified=True))["old"]["unclassified"]
        assert "linked_nm/" in listed_link


def test_orphan_worktree_folders_are_reported(repo: dict[str, Path]) -> None:
    orphan = repo["tmp"] / "roots" / "proj" / "lost"
    orphan.mkdir(parents=True)
    (orphan / ".git").write_text("gitdir: /nowhere/worktrees/lost\n", encoding="utf-8")
    text = repo["settings"].read_text(encoding="utf-8")
    text = f"worktree_roots = [{json.dumps(str(repo['tmp'] / 'roots'))}]\n" + text
    repo["settings"].write_text(text, encoding="utf-8")
    orphans = run_report()["orphans"]
    assert [o["path"] for o in orphans] == [str(orphan)]
    assert orphans[0]["reason"] == "its repository's record of it is gone"


def test_cli_prints_json(repo: dict[str, Path]) -> None:
    from botcore.cli import cli

    out = CliRunner().invoke(cli, ["disk-report", "--repo", str(repo["main"]), "--json"])
    assert out.exit_code == 0, out.output
    assert json.loads(out.output)["data"]["repos"][0]["main"] == str(repo["main"])


def test_file_candidate_mtime_counts_toward_worktree_activity(repo: dict[str, Path]) -> None:
    """lushly-dev/afd#1939: report.py counts file candidates (like *.tsbuildinfo) toward a
    worktree's last activity so a recent typecheck agrees with reclaim's recheck."""
    main, old = repo["main"], repo["old"]
    (main / "botcore.toml").write_text(
        '[disk]\nregenerable = ["dist", "**/*.tsbuildinfo"]\n', encoding="utf-8",
    )
    (main / ".gitignore").write_text(GITIGNORE + "*.tsbuildinfo\n", encoding="utf-8")
    git(main, "commit", "-q", "-am", "add tsbuildinfo")
    git(old, "merge", "-q", "main")
    build_info = old / "tsconfig.tsbuildinfo"
    build_info.write_text("{}", encoding="utf-8")
    age_worktree(main, old)
    assert rows(run_report())["old"]["tier"] == 1

    # Touching only build info makes the worktree active again in disk-report.
    os.utime(build_info, None)
    row = rows(run_report())["old"]
    assert row["tier"] == 3 and row["idle_days"] < 1
    assert not any(item["ready"] for item in row["strip"])


def test_unclassified_collapses_ignored_folders_and_marks_truncation(
    repo: dict[str, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """lushly-dev/afd#1955: ignored folders (including self-ignoring .pytest_cache) collapse to
    one entry, truncated lists carry unclassified_truncated and unclassified_omitted, and
    budget cutoffs mark unclassified_incomplete."""
    from botcore.commands.disk import unclassified

    main, old = repo["main"], repo["old"]
    (main / ".gitignore").write_text(GITIGNORE + "glob_dir/*\nu_*.tmp\n", encoding="utf-8")
    git(main, "commit", "-q", "-am", "add ignored patterns for unclassified test")
    git(old, "merge", "-q", "main")

    # Self-ignoring .pytest_cache (has its own `.gitignore` with `*` and CACHEDIR.TAG).
    pytest_cache = old / ".pytest_cache"
    (pytest_cache / "v" / "cache").mkdir(parents=True)
    (pytest_cache / ".gitignore").write_text("*\n", encoding="utf-8")
    (pytest_cache / "CACHEDIR.TAG").write_text("Signature: 8a477f597d28d172789f06886806bc55\n",
                                               encoding="utf-8")
    (pytest_cache / "v" / "cache" / "nodeids").write_text("[]\n", encoding="utf-8")

    # Folder ignored with `glob_dir/*`.
    glob_dir = old / "glob_dir"
    glob_dir.mkdir()
    (glob_dir / "a.bin").write_text("1", encoding="utf-8")
    (glob_dir / "b.bin").write_text("2", encoding="utf-8")

    listed = rows(run_report(unclassified=True))["old"]["unclassified"]
    assert ".pytest_cache/" in listed
    assert not any(e.startswith(".pytest_cache/") and e != ".pytest_cache/" for e in listed), listed
    assert "glob_dir/" in listed
    assert not any(e.startswith("glob_dir/") and e != "glob_dir/" for e in listed), listed

    # Exceeding LIMIT sets unclassified_truncated and unclassified_omitted instead of silent cutoff.
    for idx in range(5):
        (old / f"u_{idx}.tmp").write_text("x", encoding="utf-8")
    with monkeypatch.context() as mp:
        mp.setattr(unclassified, "LIMIT", 3)
        row = rows(run_report(unclassified=True))["old"]
    assert len(row["unclassified"]) == 3
    assert row["unclassified_truncated"] is True
    assert row["unclassified_omitted"] == 4  # 7 total (.pytest_cache/, glob_dir/, 5 u_*.tmp) - 3

    # Exhausting WALK_ENTRIES inside a collapsed folder also marks the scan incomplete.
    nested = old / "nested_only" / "a" / "b"
    nested.mkdir(parents=True)
    (nested / "c.bin").write_text("c", encoding="utf-8")
    (main / ".gitignore").write_text(
        GITIGNORE + "glob_dir/*\nu_*.tmp\nnested_only/\n", encoding="utf-8"
    )
    git(main, "commit", "-q", "-am", "ignore nested_only")
    git(old, "merge", "-q", "main")
    with monkeypatch.context() as mp:
        mp.setattr(unclassified, "WALK_ENTRIES", 1)
        limited = run_report(unclassified=True)
    assert limited["complete"] is False
    assert rows(limited)["old"].get("unclassified_incomplete") is True
    summary = unclassified.format_unclassified_summary(limited)
    assert "Incomplete scans:" in summary
    assert f"{old}: scan budget spent" in summary

    # Expired budget marks the scan incomplete and sets report complete=False.
    expired = run_report(unclassified=True, budget_seconds=-1)
    assert expired["complete"] is False
    assert rows(expired)["old"].get("unclassified_incomplete") is True


def test_cli_disk_report_unclassified_prints_grouped_summary(
    repo: dict[str, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """lushly-dev/afd#1955: plain-text `disk-report --unclassified` prints a grouped summary
    with worktree counts and incomplete scans, while `--json` keeps the full JSON result."""
    from botcore.cli import cli
    from botcore.commands.disk import unclassified

    main, old, fresh = repo["main"], repo["old"], repo["fresh"]
    (main / ".gitignore").write_text(GITIGNORE + "extra_*.tmp\n", encoding="utf-8")
    git(main, "commit", "-q", "-am", "add extra tmp ignore")
    git(old, "merge", "-q", "main")
    git(fresh, "merge", "-q", "main")

    for wt in (old, fresh):
        (wt / ".cache").mkdir()
        (wt / ".cache" / "x").write_text("x", encoding="utf-8")
    pc = old / ".pytest_cache"
    pc.mkdir()
    (pc / ".gitignore").write_text("*\n", encoding="utf-8")
    (pc / "CACHEDIR.TAG").write_text("tag\n", encoding="utf-8")
    for idx in range(3):
        (fresh / f"extra_{idx}.tmp").write_text("x", encoding="utf-8")

    monkeypatch.setattr(unclassified, "LIMIT", 2)
    plain = CliRunner().invoke(cli, ["disk-report", "--repo", str(main), "--unclassified"])
    assert plain.exit_code == 0, plain.output
    assert not plain.output.lstrip().startswith("{")
    assert "2 worktrees  .cache/" in plain.output
    assert "1 worktree   .pytest_cache/" in plain.output
    assert "CACHEDIR.TAG" not in plain.output
    assert "Incomplete scans:" in plain.output
    assert f"{fresh}: truncated (2 omitted)" in plain.output

    as_json = CliRunner().invoke(
        cli, ["disk-report", "--repo", str(main), "--unclassified", "--json"]
    )
    assert as_json.exit_code == 0, as_json.output
    parsed = json.loads(as_json.output)["data"]
    fresh_row = rows(parsed)["fresh"]
    assert fresh_row["unclassified_truncated"] is True
    assert fresh_row["unclassified_omitted"] == 2


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


def test_aged_descends_into_cargo_hash_buckets_and_preserves_non_buckets(tmp_path: Path) -> None:
    from botcore.commands.disk.settings import MachineSettings

    now = time.time()
    root = tmp_path / "cargo-build"

    def make_tree(rel: str, days_ago: float) -> Path:
        folder = root / rel
        leaf = folder / "debug" / "deps"
        leaf.mkdir(parents=True)
        artifact = leaf / "crate.rlib"
        artifact.write_bytes(b"x" * 4096)
        when = now - days_ago * 86400
        for p in (artifact, leaf, leaf.parent, folder):
            os.utime(p, (when, when))
        return folder

    fresh_ws = make_tree("ab/0305f56e9b9616", 0.05)
    stale_ws = make_tree("ab/11223344556677", 5.0)
    other_stale = make_tree("cd/deadbeef001122", 4.0)
    manual_dir = make_tree("afd-p4", 5.0)
    # Non-bucket 2-hex folder holding regular files must stay a single entry.
    non_bucket = root / "01"
    non_bucket.mkdir(parents=True)
    (non_bucket / "archive.tar").write_bytes(b"a" * 1024)
    os.utime(non_bucket / "archive.tar", (now - 5 * 86400, now - 5 * 86400))
    os.utime(non_bucket, (now - 5 * 86400, now - 5 * 86400))
    # Empty 2-hex bucket stays an entry itself so it can age out.
    empty_bucket = root / "ef"
    empty_bucket.mkdir()
    os.utime(empty_bucket, (now - 5 * 86400, now - 5 * 86400))

    settings = MachineSettings(aged=[{"path": f"{root}/*", "max_age_days": 3}])
    entries = {
        e["path"]: e
        for e in caches.report_aged(settings, now, time.monotonic() + 60)[0]["entries"]
    }
    assert str(root / "ab") not in entries
    assert str(fresh_ws) in entries and not entries[str(fresh_ws)]["eligible"]
    assert str(stale_ws) in entries and entries[str(stale_ws)]["eligible"]
    assert str(other_stale) in entries and entries[str(other_stale)]["eligible"]
    assert str(manual_dir) in entries and entries[str(manual_dir)]["eligible"]
    assert str(non_bucket) in entries and entries[str(non_bucket)]["eligible"]
    assert str(empty_bucket) in entries and entries[str(empty_bucket)]["eligible"]

    # Explicit `/*/*` pattern also lists the leaf workspace directories.
    double = MachineSettings(aged=[{"path": f"{root}/*/*", "max_age_days": 3}])
    double_paths = {
        e["path"]
        for e in caches.report_aged(double, now, time.monotonic() + 60)[0]["entries"]
    }
    assert {str(fresh_ws), str(stale_ws), str(other_stale)} <= double_paths


def test_home_and_roots_are_never_aged_folders() -> None:
    assert caches.unsafe_aged_root(Path.home()) is not None
    assert caches.unsafe_aged_root(Path(Path.home().anchor)) is not None
    assert caches.unsafe_aged_root(Path.home() / "some-cache-folder") is None
