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
