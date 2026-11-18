"""Local git integration for the validation checkout and AFD's pre-push decision.

The verify record here is synthetic fixture data, never a receipt for this repository.
No network or real repository refs are used.
"""

from __future__ import annotations

import json
import os
import shlex
from datetime import UTC, datetime
from pathlib import Path

import pytest

from botcore_factory.real_world import CliGit, make_runner
from botcore_factory.world import MergeOutcome, WorldError

ROOT = Path(__file__).resolve().parents[5]


def test_push_uses_the_worktree_record_accepted_by_the_real_pre_push_decision(
    tmp_path, monkeypatch
):
    for key in list(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    repo, slot, remote = (tmp_path / name for name in ("repo", "slot", "remote.git"))
    repo.mkdir()
    run = make_runner(str(repo))
    run(["git", "init", "--initial-branch=main"])
    run(["git", "config", "user.name", "Fixture"])
    run(["git", "config", "user.email", "fixture@localhost"])
    run(["git", "commit", "--allow-empty", "-m", "base"])
    base = run(["git", "rev-parse", "HEAD"]).strip()
    run(["git", "update-ref", "refs/remotes/origin/main", base])
    run(["git", "init", "--bare", str(remote)])
    run(["git", "remote", "add", "origin", str(remote)])
    run(["git", "commit", "--allow-empty", "-m", "candidate"])
    head = run(["git", "rev-parse", "HEAD"]).strip()
    run(["git", "worktree", "add", "--detach", str(slot), head])
    run(["git", "checkout", "--detach", base])
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    run(["git", "config", "core.hooksPath", str(hooks)])
    checker = tmp_path / "check-record.mjs"
    checker.write_text(
        "import {execFileSync} from 'node:child_process';\n"
        "import {readFileSync} from 'node:fs';\n"
        f"import {{decide}} from {json.dumps((ROOT / 'scripts/pre-push.mjs').as_uri())};\n"
        "const git = args => execFileSync('git', args, {encoding:'utf8'});\n"
        "const decision = decide({updates:readFileSync(0,'utf8'), git});\n"
        "if (!decision.accepted) {console.error(decision.reason); process.exit(1);}\n",
        encoding="utf-8",
    )
    hook = hooks / "pre-push"
    hook.write_text(f"#!/bin/sh\nexec node {shlex.quote(checker.as_posix())}\n", encoding="utf-8")
    hook.chmod(0o755)
    record = Path(
        run(["git", "-C", str(slot), "rev-parse", "--git-path", "afd-verify-record.json"]).strip()
    )
    record.write_text(
        json.dumps(
            {
                "schema": 1,
                "head": head,
                "base": base,
                "tree": run(["git", "-C", str(slot), "rev-parse", "HEAD^{tree}"]).strip(),
                "results": [{"name": "check (ci.yml)", "ok": True}],
                "finishedAt": datetime.now(UTC).isoformat(),
            }
        ),
        encoding="utf-8",
    )
    git = CliGit(run)
    with pytest.raises(WorldError, match="no verify record"):
        git.push_head(str(repo), "wrong-checkout", base, None)
    git.push_head(str(slot), "candidate", head, None)
    assert (
        run(["git", "--git-dir", str(remote), "rev-parse", "refs/heads/candidate"]).strip() == head
    )
    run(["git", "-C", str(slot), "checkout", "--detach", base])
    with pytest.raises(WorldError, match="no longer holds"):
        git.push_head(str(slot), "reused", head, None)
    assert not run(["git", "--git-dir", str(remote), "for-each-ref", "refs/heads/reused"]).strip()


def test_afd_s_review_evidence_accepts_only_the_recorded_head(tmp_path, monkeypatch):
    """AFD's adapter command, run as lane-enqueue runs it, against the real review-record script."""
    from types import SimpleNamespace

    from botcore.config import load_config

    from botcore_factory import FactoryPlugin
    from botcore_factory.queue import _check_review
    from botcore_factory.real_system import OsProcesses
    from botcore_factory.runtime import Refusal

    for key in list(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    config = load_config(workspace=ROOT, discovered_plugins={"factory": FactoryPlugin()})
    adapter = config.plugins["factory"]
    repo = tmp_path / "cell"
    (repo / "scripts").mkdir(parents=True)
    script = "scripts/review-record.mjs"
    (repo / script).write_bytes((ROOT / script).read_bytes())
    run = make_runner(str(repo))
    run(["git", "init", "--initial-branch=main"])
    run(["git", "config", "user.name", "Fixture"])
    run(["git", "config", "user.email", "fixture@localhost"])
    run(["git", "add", "."])
    run(["git", "commit", "-m", "base"])
    run(["git", "update-ref", "refs/remotes/origin/main", "HEAD"])
    run(["git", "checkout", "-b", "feat/cell"])
    run(["git", "commit", "--allow-empty", "-m", "reviewed"])
    head = run(["git", "rev-parse", "HEAD"]).strip()
    factory = SimpleNamespace(config=adapter, world=SimpleNamespace(processes=OsProcesses()))

    with pytest.raises(Refusal, match="no review is recorded") as missing:
        _check_review(factory, str(repo), head)
    assert missing.value.code == "REVIEW_MISSING"
    lanes = [{"lane": "general", "model": "fixture", "effort": "high", "verdict": "pass"}]
    run(["node", script, "write", "--lanes", json.dumps(lanes)])
    assert run(["git", "status", "--porcelain"]).strip() == ""
    _check_review(factory, str(repo), head)  # Accepted: no refusal.

    run(["git", "commit", "--allow-empty", "-m", "after the review"])
    moved = run(["git", "rev-parse", "HEAD"]).strip()
    with pytest.raises(Refusal, match=f"review recorded is of {head}, not {moved}"):
        _check_review(factory, str(repo), moved)

    missing_program = adapter.model_copy(update={"review_evidence": ["no-such-verifier-xyz"]})
    unrunnable = SimpleNamespace(config=missing_program, world=factory.world)
    with pytest.raises(Refusal, match="no-such-verifier-xyz is not on PATH") as cannot:
        _check_review(unrunnable, str(repo), moved)
    assert cannot.value.code == "REVIEW_MISSING"


def test_a_branch_that_rewrites_the_verifier_still_needs_its_review(tmp_path, monkeypatch):
    """lushly-dev/afd#1308: enqueue runs the branch's own verifier, which the branch can make
    always pass; the lane runs the base's copy from its review slot, which still refuses."""
    from types import SimpleNamespace

    from botcore.config import load_config

    from botcore_factory import FactoryPlugin
    from botcore_factory.lane import Step
    from botcore_factory.queue import _check_review
    from botcore_factory.real_system import OsProcesses

    for key in list(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    adapter = load_config(workspace=ROOT, discovered_plugins={"factory": FactoryPlugin()}).plugins[
        "factory"
    ]
    repo, cell = tmp_path / "repo", tmp_path / "cell"
    script = "scripts/review-record.mjs"
    (repo / "scripts").mkdir(parents=True)
    (repo / script).write_bytes((ROOT / script).read_bytes())
    run = make_runner(str(repo))
    run(["git", "init", "--initial-branch=main"])
    run(["git", "config", "user.name", "Fixture"])
    run(["git", "config", "user.email", "fixture@localhost"])
    run(["git", "add", "."])
    run(["git", "commit", "-m", "base"])
    base = run(["git", "rev-parse", "HEAD"]).strip()
    run(["git", "update-ref", "refs/remotes/origin/main", base])
    run(["git", "worktree", "add", "-b", "feat/cell", str(cell)])
    in_cell = make_runner(str(cell))
    in_cell(["git", "commit", "--allow-empty", "-m", "reviewed"])
    reviewed = in_cell(["git", "rev-parse", "HEAD"]).strip()
    lanes = [{"lane": "general", "model": "fixture", "effort": "high", "verdict": "pass"}]
    in_cell(["node", script, "write", "--lanes", json.dumps(lanes)])

    ejected: list[tuple[str, str]] = []
    world = SimpleNamespace(git=CliGit(run), processes=OsProcesses())
    lane = SimpleNamespace(
        config=adapter,
        world=world,
        cell=lambda branch: {"worktree": str(cell)},
        eject=lambda entry, cause, text, log=None: ejected.append((cause, text)),
    )
    assert Step.review_verified(lane, {"branch": "feat/cell", "head": reviewed}, base)
    assert not ejected

    (cell / script).write_text("process.exit(0);\n", encoding="utf-8")
    in_cell(["git", "commit", "-am", "a verifier that always passes"])
    head = in_cell(["git", "rev-parse", "HEAD"]).strip()
    cell_factory = SimpleNamespace(config=adapter, world=world)
    _check_review(cell_factory, str(cell), head)  # The branch's copy lets enqueue through.

    assert not Step.review_verified(lane, {"branch": "feat/cell", "head": head}, base)
    assert ejected[0][0] == "review-unverified"
    assert f"review recorded is of {reviewed}, not {head}" in ejected[0][1]
    slot = Path(CliGit(run)._slot_path("review"))
    assert (slot / script).read_bytes() == (ROOT / script).read_bytes()  # The base's copy ran.


def test_merge_tree_and_diff_names_read_a_moved_base_without_a_checkout(tmp_path, monkeypatch):
    for key in list(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    repo = tmp_path / "repo"
    repo.mkdir()
    run = make_runner(str(repo))
    run(["git", "init", "--initial-branch=main"])
    run(["git", "config", "user.name", "Fixture"])
    run(["git", "config", "user.email", "fixture@localhost"])

    def commit(files: dict[str, str], message: str) -> str:
        for name, text in files.items():
            (repo / name).parent.mkdir(parents=True, exist_ok=True)
            (repo / name).write_text(text, encoding="utf-8")
        run(["git", "add", "-A"])
        run(["git", "commit", "-q", "-m", message])
        return run(["git", "rev-parse", "HEAD"]).strip()

    base = commit({"a.txt": "a\n", "b.txt": "b\n"}, "base")
    head = commit({"a.txt": "a from the branch\n"}, "branch")
    run(["git", "checkout", "-q", "--detach", base])
    unrelated = commit({"b.txt": "b from main\n", "docs/c.md": "c\n"}, "main")
    conflicting = commit({"a.txt": "a from main\n"}, "main again")
    git = CliGit(run, str(repo))
    assert git.diff_names(base, unrelated) == ["b.txt", "docs/c.md"]
    clean = git.merges_cleanly(head, unrelated)
    assert clean.clean and len(clean.head) == 40
    conflict = git.merges_cleanly(head, conflicting)
    assert not conflict.clean and conflict.conflicts == ("a.txt",)
    with pytest.raises(WorldError):
        git.merges_cleanly(head, "0" * 40)


def test_a_repair_s_gate_edits_are_its_own_not_main_s_brought_in_by_a_rebase(tmp_path, monkeypatch):
    """lushly-dev/afd#1374: a rebased repair is not refused for main's gate changes."""
    for key in list(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    repo = tmp_path / "repo"
    repo.mkdir()
    run = make_runner(str(repo))

    def write(name: str, text: str) -> None:
        (repo / name).write_text(text, encoding="utf-8")

    def commit(message: str) -> str:
        run(["git", "add", "-A"])
        run(["git", "commit", "--quiet", "-m", message])
        return run(["git", "rev-parse", "HEAD"]).strip()

    run(["git", "init", "--quiet", "--initial-branch=main"])
    run(["git", "config", "user.name", "Fixture"])
    run(["git", "config", "user.email", "fixture@localhost"])
    run(["git", "config", "core.autocrlf", "false"])
    lines = "".join(f"line {n}\n" for n in range(1, 21))
    write("gate.yml", "gate: 1\n")
    write("shared-gate.yml", lines)
    write("src.ts", "a\n")
    base = commit("base")
    run(["git", "update-ref", "refs/remotes/origin/main", base])
    run(["git", "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"])

    # The branch, as ejected: a source change and a gate change of its own at the end.
    run(["git", "checkout", "--quiet", "-b", "fix/a"])
    write("src.ts", "b\n")
    write("shared-gate.yml", lines + "branch: tightened\n")
    ejected = commit("fix")

    # Main moves: it edits gate.yml, and shared-gate.yml far from the branch's change.
    run(["git", "checkout", "--quiet", "main"])
    write("gate.yml", "gate: 2\n")
    write("shared-gate.yml", "main: first\n" + lines)
    moved = commit("main moves")
    run(["git", "update-ref", "refs/remotes/origin/main", moved])

    git = CliGit(run)
    gate = lambda path: path.endswith(".yml")  # noqa: E731
    run(["git", "checkout", "--quiet", "fix/a"])
    run(["git", "rebase", "--quiet", "main"])
    rebased = run(["git", "rev-parse", "HEAD"]).strip()
    assert git.changed_files(str(repo), ejected) == ["gate.yml", "shared-gate.yml", "src.ts"]
    assert git.repair_edits(str(repo), moved, ejected, gate) == []
    assert git.repair_edits(str(repo), moved, None, gate) == ["shared-gate.yml"]

    # The base is the lane's commit: repointing origin/HEAD in the worktree changes nothing.
    run(["git", "symbolic-ref", "refs/remotes/origin/HEAD", "refs/heads/fix/a"])
    write("gate.yml", "gate: loosened\n")
    commit("loosen")
    assert git.repair_edits(str(repo), moved, ejected, gate) == ["gate.yml"]

    # Taking back its own gate change is still a gate edit.
    write("shared-gate.yml", "main: first\n" + lines)
    commit("take back")
    assert sorted(git.repair_edits(str(repo), moved, ejected, gate)) == [
        "gate.yml",
        "shared-gate.yml",
    ]

    # Re-indenting the branch's own gate lines is an edit: indentation is meaning in YAML.
    run(["git", "reset", "--quiet", "--hard", rebased])
    write("shared-gate.yml", "main: first\n" + lines + "  branch: tightened\n")
    commit("re-indent")
    assert git.repair_edits(str(repo), moved, ejected, gate) == ["shared-gate.yml"]

    # Renaming a gate file out of the gate globs is seen by its old name.
    run(["git", "reset", "--quiet", "--hard", rebased])
    run(["git", "mv", "gate.yml", "gate.off"])
    commit("rename away")
    assert git.repair_edits(str(repo), moved, ejected, gate) == ["gate.yml"]

    # The repository's config, which the cell's worktree shares, cannot hide an edit.
    run(["git", "reset", "--quiet", "--hard", rebased])
    write("shared-gate.yml", "main: first\n" + lines + "branch: tightened || true\n")
    commit("loosen its own line")
    for key, value in (("color.ui", "always"), ("color.diff", "always"), ("diff.external", "echo")):
        run(["git", "config", key, value])
        assert git.repair_edits(str(repo), moved, ejected, gate) == ["shared-gate.yml"], key
        run(["git", "config", "--unset", key])

    # Moving its own gate line elsewhere in the file is an edit, even with no diff context set.
    run(["git", "reset", "--quiet", "--hard", rebased])
    write("shared-gate.yml", "main: first\nbranch: tightened\n" + lines)
    commit("move its own line")
    run(["git", "config", "diff.context", "0"])
    assert git.repair_edits(str(repo), moved, ejected, gate) == ["shared-gate.yml"]
    run(["git", "config", "--unset", "diff.context"])

    # A repair that merges main instead of rebasing is judged the same way.
    run(["git", "checkout", "--quiet", "-B", "fix/merged", ejected])
    run(["git", "merge", "--quiet", "--no-edit", moved])
    assert git.repair_edits(str(repo), moved, ejected, gate) == []


def test_a_merge_left_open_for_generated_files_is_finished_or_aborted(tmp_path, monkeypatch):
    """lushly-dev/afd#1410: the slot's merge stays open only when ``keep_open`` accepts every
    conflict; it commits once nothing is unmerged, and aborts when something still is."""
    for key in list(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    repo = tmp_path / "repo"
    repo.mkdir()
    run = make_runner(str(repo))
    run(["git", "init", "--initial-branch=main"])
    run(["git", "config", "user.name", "Fixture"])
    run(["git", "config", "user.email", "fixture@localhost"])

    def commit(files: dict[str, str], message: str) -> str:
        for name, text in files.items():
            (repo / name).parent.mkdir(parents=True, exist_ok=True)
            (repo / name).write_text(text, encoding="utf-8")
        run(["git", "add", "-A"])
        run(["git", "commit", "-q", "-m", message])
        return run(["git", "rev-parse", "HEAD"]).strip()

    commit({"records/r.json": "base\n", "src/a.ts": "a\n"}, "base")
    run(["git", "checkout", "-q", "-b", "feat"])
    branch = commit({"records/r.json": "branch\n"}, "branch")
    run(["git", "checkout", "-q", "main"])
    main = commit({"records/r.json": "main\n"}, "main")
    git = CliGit(run)
    slot = git.prepare_slot("1", "", branch)
    records_only = lambda files: all(f.startswith("records/") for f in files)  # noqa: E731

    assert git.merge_main(slot, main) == MergeOutcome(False, conflicts=("records/r.json",))
    opened = git.merge_main(slot, main, keep_open=records_only)
    assert (opened.open, opened.conflicts) == (True, ("records/r.json",))
    finished = git.finish_merge(slot)  # Nothing regenerated it: still unmerged, so aborted.
    assert (finished.clean, finished.conflicts) == (False, ("records/r.json",))
    assert git.head(slot) == branch

    # The repository's hooks would check every file main brought in: the merge runs none.
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    (hooks / "pre-commit").write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    (hooks / "pre-commit").chmod(0o755)
    run(["git", "config", "core.hooksPath", str(hooks)])
    git.merge_main(slot, main, keep_open=records_only)
    (Path(slot) / "records/r.json").write_text("both\n", encoding="utf-8")
    run(["git", "-C", slot, "add", "records/r.json"])
    finished = git.finish_merge(slot)
    assert finished.clean
    parents = run(["git", "-C", slot, "rev-list", "--parents", "-n", "1", "HEAD"]).split()
    assert parents[1:] == [branch, main]


def test_a_kept_checkout_still_pushes_with_its_record_and_is_removed_after(tmp_path, monkeypatch):
    """lushly-dev/afd#1452: a validated slot given to the front of the queue moves aside with
    the git directory that holds its validation record, so the real pre-push decision still
    accepts its push, and the slot's path is checked out afresh."""
    import time

    for key in list(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    repo, remote = tmp_path / "repo", tmp_path / "remote.git"
    repo.mkdir()
    run = make_runner(str(repo))
    run(["git", "init", "--initial-branch=main"])
    run(["git", "config", "user.name", "Fixture"])
    run(["git", "config", "user.email", "fixture@localhost"])
    run(["git", "commit", "--allow-empty", "-m", "base"])
    base = run(["git", "rev-parse", "HEAD"]).strip()
    run(["git", "update-ref", "refs/remotes/origin/main", base])
    run(["git", "init", "--bare", str(remote)])
    run(["git", "remote", "add", "origin", str(remote)])
    run(["git", "commit", "--allow-empty", "-m", "candidate"])
    head = run(["git", "rev-parse", "HEAD"]).strip()
    run(["git", "checkout", "--detach", base])
    (repo / ".git" / "info" / "exclude").write_text("node_modules/\n", encoding="utf-8")
    git = CliGit(run, str(repo))
    slot = git.prepare_slot("1", "", head)
    (Path(slot) / "node_modules").mkdir()
    (Path(slot) / "node_modules" / "installed").write_text("x", encoding="utf-8")
    git_path = ["rev-parse", "--git-path", "afd-verify-record.json"]
    record = Path(slot) / run(["git", "-C", slot, *git_path]).strip()
    record.write_text(
        json.dumps(
            {
                "schema": 1,
                "head": head,
                "base": base,
                "tree": run(["git", "-C", slot, "rev-parse", "HEAD^{tree}"]).strip(),
                "results": [{"name": "check (ci.yml)", "ok": True}],
                "finishedAt": datetime.now(UTC).isoformat(),
            }
        ),
        encoding="utf-8",
    )
    kept = git.park_slot("1", "kept-fix-a")
    assert kept == str(Path(slot).with_name("kept-fix-a")) and not Path(slot).exists()
    assert (Path(kept) / "node_modules" / "installed").exists()  # Moved, not copied or lost.
    assert git.head(kept) == head
    # The slot's own path is free and is checked out afresh for the front of the queue.
    assert git.head(git.prepare_slot("1", "", base)) == base

    hooks = tmp_path / "hooks"
    hooks.mkdir()
    run(["git", "config", "core.hooksPath", str(hooks)])
    checker = tmp_path / "check-record.mjs"
    checker.write_text(
        "import {execFileSync} from 'node:child_process';\n"
        "import {readFileSync} from 'node:fs';\n"
        f"import {{decide}} from {json.dumps((ROOT / 'scripts/pre-push.mjs').as_uri())};\n"
        "const git = args => execFileSync('git', args, {encoding:'utf8'});\n"
        "const decision = decide({updates:readFileSync(0,'utf8'), git});\n"
        "if (!decision.accepted) {console.error(decision.reason); process.exit(1);}\n",
        encoding="utf-8",
    )
    hook = hooks / "pre-push"
    hook.write_text(f"#!/bin/sh\nexec node {shlex.quote(checker.as_posix())}\n", encoding="utf-8")
    hook.chmod(0o755)
    git.push_head(kept, "fix/a", head, None)
    assert run(["git", "--git-dir", str(remote), "rev-parse", "refs/heads/fix/a"]).strip() == head

    # Another session's worktree whose directory is missing (moved, or on a drive not mounted)
    # stays registered: removing the lane's checkout unregisters only that checkout.
    other = tmp_path / "other"
    run(["git", "worktree", "add", "--detach", str(other), base])
    other.rename(tmp_path / "other-elsewhere")
    git.remove_checkout(kept)
    assert not Path(kept).exists()
    listed = run(["git", "worktree", "list", "--porcelain"])
    assert str(other) in listed
    slots = Path(slot).parent
    deadline = time.monotonic() + 30
    while any(slots.glob(".removing-*")) and time.monotonic() < deadline:
        time.sleep(0.1)
    assert not any(slots.glob(".removing-*"))
    listed = run(["git", "worktree", "list", "--porcelain"])
    assert "kept-fix-a" not in listed and ".removing-" not in listed
    assert str(other) in listed
    git.remove_checkout(kept)  # Already gone: nothing to do.
