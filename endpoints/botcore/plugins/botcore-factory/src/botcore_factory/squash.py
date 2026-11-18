"""The body a squash merge is given, so that GitHub credits no co-author.

Without a body, GitHub writes its default squash message, which adds a ``Co-authored-by:``
line for every commit author whose address isn't the merging account's. A cell's base merges
are committed as ``botcore-factory``, so every lane squash that held one credited the factory as
a co-author. A commit made under a stale address did the same. The branch's own messages,
given as the body, keep each commit's ``Assisted-by:`` trailer and credit nobody else.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

_CO_AUTHOR = re.compile(r"^\s*co-authored-by:", re.IGNORECASE)


def squash_body(commits: Iterable[dict]) -> str:
    """The branch's commit messages, from GitHub's list of a pull request's commits (REST).

    Merge commits (more than one parent) are left out, as GitHub's default leaves them out, unless
    the branch holds nothing else: a blank body might be taken as none, and get the default
    message back. Every ``Co-authored-by:`` line is left out.
    """
    commits = list(commits)
    own = [commit for commit in commits if len(commit.get("parents") or ()) <= 1]
    messages = []
    for commit in own or commits:
        message = (commit.get("commit") or {}).get("message") or ""
        kept = [line for line in message.splitlines() if not _CO_AUTHOR.match(line)]
        text = "\n".join(kept).strip()
        if text:
            messages.append(text)
    return "\n\n".join(messages)
