"""The body a squash merge is given, so that GitHub credits no co-author, and the message of the
one commit the lane folds a branch into (``fold_message``).

Without a body, GitHub writes its default squash message, which adds a ``Co-authored-by:``
line for every commit author whose address isn't the merging account's. A cell's base merges
are committed as ``botcore-factory``, so every lane squash that held one credited the factory as
a co-author. A commit made under a stale address did the same. The branch's own messages,
given as the body, keep each commit's ``Assisted-by:`` trailer and credit nobody else.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Sequence
from typing import Any

#: As ``commit-credit.mjs`` reads one: spacing before the colon still makes it a trailer.
_CO_AUTHOR = re.compile(r"^[ \t]*co-authored-by[ \t]*:", re.IGNORECASE)


def squash_body(commits: Iterable[dict[str, Any]]) -> str:
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


#: A trailer line as git reads one: a token, then a colon.
_TRAILER = re.compile(r"^[A-Za-z0-9][\w-]*[ \t]*:")
_CONTINUATION = re.compile(r"^[ \t]+\S")


def clean_message(text: str) -> str:
    """A message as git stores one: LF line endings, no trailing spaces, no leading or trailing
    blank lines and no runs of them, as ``git commit --cleanup=whitespace`` leaves it. ``#``
    lines are kept: a message that starts a line with ``#1809`` is not a comment."""
    lines = [line.rstrip(" \t") for line in re.sub(r"\r\n?", "\n", text).split("\n")]
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    while out and not out[-1]:
        out.pop()
    return "\n".join(out) + "\n" if out else ""


def _trailer_key(trailer: str) -> str:
    """A trailer compared without the case of its key or the spacing around its colon."""
    key, _, value = trailer.partition(":")
    return key.strip().lower() + ": " + value.lstrip(" \t")


def split_trailers(message: str) -> tuple[str, list[str]]:
    """A message's text and its closing trailer block, one entry per trailer with any
    continuation lines kept on it. A last paragraph is a trailer block when its first line is a
    trailer and every other line a trailer or a continuation, as git reads it."""
    paragraphs = clean_message(message).rstrip("\n").split("\n\n")
    last = paragraphs[-1].split("\n")
    block = (
        len(paragraphs) > 1
        and bool(_TRAILER.match(last[0]))
        and all(_TRAILER.match(line) or _CONTINUATION.match(line) for line in last)
    )
    if not block:
        return "\n\n".join(paragraphs), []
    trailers: list[str] = []
    for line in last:
        if _TRAILER.match(line):
            trailers.append(line)
        else:
            trailers[-1] += f"\n{line}"
    return "\n\n".join(paragraphs[:-1]), trailers


def fold_message(messages: Sequence[str]) -> str:
    """The message of the one commit a branch is folded into, from its own commits' messages,
    oldest first: one commit's own, or the oldest's text, each later subject as a list item and
    each distinct trailer once. Every ``Co-authored-by:`` line is left out, as ``squash_body``
    leaves it out. The same fold as AFD's ``pnpm branch:squash`` (``scripts/branch-squash.mjs``).
    """
    kept = [
        "\n".join(line for line in message.split("\n") if not _CO_AUTHOR.match(line))
        for message in messages
    ]
    if len(kept) == 1:
        return clean_message(kept[0])
    parts = [split_trailers(message) for message in kept]
    subjects = [text.split("\n", 1)[0] for text, _ in parts[1:]]
    sections = [parts[0][0], "\n".join(f"- {subject}" for subject in subjects)]
    seen: set[str] = set()
    trailers: list[str] = []
    for _, found in parts:
        for trailer in found:
            if _trailer_key(trailer) not in seen:
                seen.add(_trailer_key(trailer))
                trailers.append(trailer)
    if trailers:
        sections.append("\n".join(trailers))
    return clean_message("\n\n".join(sections))


#: The trailer that names a session which made a folded change (lushly-dev/afd#1887). The lane
#: opens the pull request, so no harness records the cell's thread as its opener; botcore's
#: ``skill-usage-triggers`` reads this trailer from ``main`` instead.
SESSION_TRAILER = "Factory-session"


def session_tag(thread: str) -> str:
    """A thread's id as the trailer gives it: opaque in public history, and matched by
    ``skill-usage-triggers`` against the sessions its record holds (``sha256:`` and the first
    24 hex digits of the id's SHA-256)."""
    return "sha256:" + hashlib.sha256(thread.encode("utf-8")).hexdigest()[:24]


def with_sessions(message: str, threads: Sequence[str]) -> str:
    """``message`` with one ``Factory-session:`` trailer for each of ``threads`` it does not
    already carry, after its other trailers. Trailers an earlier fold wrote stay, so a cell
    repaired by another thread names both."""
    text, trailers = split_trailers(message)
    seen = {_trailer_key(trailer) for trailer in trailers}
    for thread in threads:
        line = f"{SESSION_TRAILER}: {session_tag(thread)}"
        if thread.strip() and _trailer_key(line) not in seen:
            seen.add(_trailer_key(line))
            trailers.append(line)
    if not trailers:
        return clean_message(message)
    return clean_message(text + "\n\n" + "\n".join(trailers))
