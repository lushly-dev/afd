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
from botcore_factory.world import WorldError

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
