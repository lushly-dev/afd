"""A squash's body: the branch's own messages, crediting no co-author."""

from __future__ import annotations

from botcore_factory.squash import squash_body


def commit(message, parents=1):
    return {"parents": [{"sha": str(n)} for n in range(parents)], "commit": {"message": message}}


def test_the_body_keeps_each_commits_own_message_and_credit():
    commits = [
        commit("feat: a\n\nWhy a.\n\nAssisted-by: Claude Code"),
        commit("Merge commit 'abc' into HEAD", parents=2),
        commit("fix: b\n\nco-authored-by: botcore-factory <factory@localhost>\nAssisted-by: Codex"),
        commit("\n"),
    ]
    assert squash_body(commits) == (
        "feat: a\n\nWhy a.\n\nAssisted-by: Claude Code\n\nfix: b\n\nAssisted-by: Codex"
    )


def test_a_branch_of_merges_alone_keeps_their_messages_so_the_body_is_never_blank():
    merge = commit("Merge origin/main\n\nCo-authored-by: botcore-factory <factory@localhost>", 2)
    assert squash_body([merge]) == "Merge origin/main"
