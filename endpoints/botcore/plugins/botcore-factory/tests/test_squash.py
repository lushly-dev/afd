"""A squash's body: the branch's own messages, crediting no co-author."""

from __future__ import annotations

from botcore_factory.cells import threads
from botcore_factory.squash import fold_message, session_tag, squash_body, with_sessions


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


# lushly-dev/afd#1809: the message of the one commit the lane folds a branch into.


def test_one_commit_keeps_its_own_message_as_git_stores_one():
    assert fold_message(["feat: a\r\n\r\n#1809 is why.  \r\n\r\n\r\nAssisted-by: Codex\r\n"]) == (
        "feat: a\n\n#1809 is why.\n\nAssisted-by: Codex\n"
    )


def test_later_commits_add_their_subjects_and_each_trailer_once():
    messages = [
        "feat: export\n\nWhy export.\n\nAssisted-by: Claude Code",
        "fix: an edge\n\nIts body is dropped.\n\nassisted-by:   Claude Code\nRefs: #12\n  more",
        "test: cover it",
    ]
    assert fold_message(messages) == (
        "feat: export\n\nWhy export.\n\n- fix: an edge\n- test: cover it\n\n"
        "Assisted-by: Claude Code\nRefs: #12\n  more\n"
    )


def test_a_fold_credits_no_co_author_and_reads_a_trailer_only_in_the_last_paragraph():
    messages = [
        "feat: a\n\nNote: this line is body text\nand so is this.\n\n"
        "Co-authored-by: Agent <agent@example.org>\nAssisted-by: Codex",
        "fix: b\n\nCO-AUTHORED-BY: Other <other@example.org>\nCo-authored-by : Spaced <s@x.org>",
    ]
    folded = fold_message(messages)
    assert "co-authored-by" not in folded.lower()
    assert folded == (
        "feat: a\n\nNote: this line is body text\nand so is this.\n\n- fix: b\n\n"
        "Assisted-by: Codex\n"
    )


# lushly-dev/afd#1887: the fold names the cell's threads, for botcore's skill-usage-triggers.


def test_a_session_tag_is_the_one_skill_usage_triggers_matches():
    from botcore.commands.skill_usage import triggers

    thread = "thread:delegated-task:command%3Amcp%3Aabc"
    assert session_tag(thread) == triggers.session_tag(thread)
    assert session_tag(thread).startswith("sha256:") and len(session_tag(thread)) == 31
    assert thread not in session_tag(thread)


def test_the_fold_names_each_thread_once_after_the_other_trailers():
    one, two = session_tag("t1"), session_tag("t2")
    assert with_sessions("feat: a\n\nWhy.\n\nAssisted-by: Codex\n", ["t1", "t2", "t1", " "]) == (
        f"feat: a\n\nWhy.\n\nAssisted-by: Codex\nFactory-session: {one}\nFactory-session: {two}\n"
    )
    # A subject alone gets a trailer block of its own; an earlier fold's trailer stays.
    assert with_sessions("feat: a", ["t1"]) == f"feat: a\n\nFactory-session: {one}\n"
    folded = with_sessions(f"feat: a\n\nFactory-session: {one}", ["t2"])
    assert folded == f"feat: a\n\nFactory-session: {one}\nFactory-session: {two}\n"
    assert with_sessions("feat: a\n", []) == "feat: a\n"


def test_a_cells_threads_are_its_list_and_none_for_a_cell_from_before_the_list():
    assert threads(None) == [] and threads({}) == []
    # Its earlier threads are not known: naming only the latest could make a miss of a load.
    assert threads({"thread": "t1"}) == []
    assert threads({"thread": "t2", "threads": ["t1", "t2", "t1", "", 3]}) == ["t1", "t2"]
