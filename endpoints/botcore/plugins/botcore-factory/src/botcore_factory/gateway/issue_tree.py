"""Issue types and parents: ``issue-create`` and ``issue-set`` (G1, #2729).

``type`` is a type's name as the organization lists it (``Epic``), matched without regard to
case; ``parent`` is an issue's number in the same repository, open or closed. Both are checked
before anything is written, so a refusal leaves nothing behind. Filing with a ``parent`` is two
GitHub writes, so a retry its ``dedupe_key`` matches sets whichever of the two the issue still
lacks. GitHub's own limits (an issue as its own parent, a cycle, 100 sub-issues) come back as
``GITHUB_REFUSED``; triage's two levels stay the skill's rule.
"""

from __future__ import annotations

import difflib
from typing import Any

from afd import CommandResult, error, success

from botcore_factory.gateway.github import GitHubRefused, GitHubUnavailable
from botcore_factory.gateway.service import DEDUPE, Gateway, Refusal, refuse

#: An ``issue-set`` input left out, which leaves that field as it is (``None`` clears it).
KEEP: Any = object()


def known_type(gateway: Gateway, repo: str, name: str) -> str:
    """The organization's spelling of the type ``name``, or ``TYPE_UNKNOWN``."""
    offered = gateway.github.issue_types(repo)
    found = next((kind for kind in offered if kind.casefold() == name.casefold()), None)
    if found is not None:
        return found
    if not offered:
        suggestion = "This repository's organization defines no issue types: leave type out"
    else:
        meant = difflib.get_close_matches(name, offered, n=1, cutoff=0.5)
        listed = ", ".join(offered)
        suggestion = f"Use {meant[0]}; the types are {listed}" if meant else f"Use one of {listed}"
    raise refuse(
        "TYPE_UNKNOWN",
        f"{name} is not an issue type {repo}'s organization defines",
        suggestion + "; the gateway never creates one",
        type=name,
        types=offered,
    )


def parent_or_refuse(gateway: Gateway, repo: str, parent: int) -> None:
    if gateway.github.issue(repo, parent) is None:
        raise refuse(
            "PARENT_NOT_FOUND",
            f"{repo} has no issue {parent} to be the parent",
            "Pass the number of an issue in this repository, open or closed; a pull request "
            "cannot be a parent",
            parent=parent,
        )


def issue_create(  # noqa: PLR0913 - the command's inputs
    gateway: Gateway,
    repo: str,
    title: str,
    body: str,
    labels: list[str],
    dedupe_key: str | None,
    type: str | None = None,
    parent: int | None = None,
) -> CommandResult[Any]:
    gateway.repo(repo)
    gateway.text(title=title, body=body, dedupe_key=dedupe_key)
    gateway.labels_known(repo, labels)
    kind = known_type(gateway, repo, type) if type is not None else None
    if parent is not None:
        parent_or_refuse(gateway, repo, parent)
    if dedupe_key:
        tag = f"<!-- {DEDUPE} {dedupe_key} -->"
        for issue in gateway.github.issues(repo):
            author = (issue.get("author") or {}).get("login")
            if issue["state"] == "open" and author == gateway.config.bot and tag in issue["body"]:
                return _complete(gateway, repo, issue["number"], kind, parent, dedupe_key)
        body = f"{body}\n\n{tag}"
    # Every write the filing makes is counted before the first, so the budget refuses it whole.
    gateway.spend("issue-create", 2 if parent is not None else 1)
    number = gateway.github.create_issue(repo, title, body, labels, kind)
    if parent is not None:
        _attach(gateway, repo, number, parent, dedupe_key)
    return success(
        {"number": number, "created": True, "type": kind, "parent": parent},
        reasoning=f"Filed issue {number}" + (f" under {parent}" if parent is not None else ""),
    )


def _attach(gateway: Gateway, repo: str, number: int, parent: int, dedupe_key: str | None) -> None:
    """Make an issue already filed a sub-issue. A refusal or an outage names the issue left
    unattached. Repeating the call is safe only with a dedupe_key, which finds the issue and
    only attaches it; without one it would file a second issue, so the outage is then not
    retryable, the one GITHUB_UNAVAILABLE that is not."""
    retry = (
        "repeat this issue-create with the same dedupe_key, which only attaches it, or "
        if dedupe_key
        else ""
    )
    try:
        gateway.github.add_sub_issue(repo, parent, number)
    except GitHubUnavailable as exc:
        raise Refusal(
            error(
                "GITHUB_UNAVAILABLE",
                f"Issue {number} is filed, but GitHub did not answer the attach to {parent}: {exc}",
                suggestion=f"Do not file a new issue: {retry}call issue-set with number "
                f"{number} and parent {parent}",
                retryable=bool(dedupe_key),
                details={"number": number, "parent": parent},
            )
        ) from None
    except GitHubRefused as exc:
        raise refuse(
            "GITHUB_REFUSED",
            f"Issue {number} is filed, but GitHub refused to make it a sub-issue of {parent}: "
            f"{exc.message}",
            f"Read GitHub's message; then call issue-set with number {number} and a parent "
            "GitHub accepts" + (", or repeat this issue-create with one" if dedupe_key else ""),
            number=number,
            parent=parent,
        ) from None


def _complete(  # noqa: PLR0913 - a retried filing's inputs
    gateway: Gateway,
    repo: str,
    number: int,
    kind: str | None,
    parent: int | None,
    dedupe_key: str,
) -> CommandResult[Any]:
    """A retried filing: set the type or parent the issue still lacks, then answer it."""
    issue = gateway.issue_or_refuse(repo, number)
    has_type, has_parent = issue.get("type"), issue.get("parent")
    set_type = kind is not None and has_type is None
    set_parent = parent is not None and has_parent is None
    if set_type or set_parent:
        gateway.spend("issue-create", int(set_type) + int(set_parent))
    # The attach first: it is the write GitHub may refuse, so a refusal changes nothing.
    if set_parent and parent is not None:
        _attach(gateway, repo, number, parent, dedupe_key)
        has_parent = parent
    if set_type:
        gateway.github.set_issue_type(repo, number, kind)
        has_type = kind
    finished = " and finished filing it" if set_type or set_parent else ""
    return success(
        {"number": number, "created": False, "type": has_type, "parent": has_parent},
        reasoning=f"Issue {number} is already open under {dedupe_key}{finished}",
    )


def issue_set(
    gateway: Gateway, repo: str, number: int, type: Any, parent: Any
) -> CommandResult[Any]:
    """Change or clear an issue's type and parent; ``KEEP`` leaves a field as it is."""
    gateway.repo(repo)
    if type is KEEP and parent is KEEP:
        raise refuse(
            "VALIDATION_ERROR",
            "issue-set was given neither type nor parent",
            "Pass type (null clears it), parent (null detaches it), or both",
        )
    issue = gateway.issue_or_refuse(repo, number)
    previous = {"type": issue.get("type"), "parent": issue.get("parent")}
    kind = previous["type"] if type is KEEP else type
    if kind is not None and type is not KEEP:
        kind = known_type(gateway, repo, kind)
    above = previous["parent"] if parent is KEEP else parent
    if above is not None and parent is not KEEP:
        parent_or_refuse(gateway, repo, above)
    new_type, new_parent = kind != previous["type"], above != previous["parent"]
    if new_parent and above is None and isinstance(previous["parent"], str):
        raise refuse(
            "PARENT_IN_OTHER_REPO",
            f"Issue {number}'s parent, {previous['parent']}, is in another repository",
            "Detach it on GitHub, or set a parent in this repository, which replaces it",
            parent=previous["parent"],
        )
    if new_type or new_parent:
        gateway.spend("issue-set", int(new_type) + int(new_parent))
    # The parent first: it is the write GitHub may refuse (a cycle, 100 sub-issues), so a
    # refusal leaves the type as it was too.
    if new_parent and above is not None:
        gateway.github.add_sub_issue(repo, above, number)  # Replaces the parent it had.
    elif new_parent and isinstance(previous["parent"], int):
        gateway.github.remove_sub_issue(repo, previous["parent"], number)
    if new_type:
        gateway.github.set_issue_type(repo, number, kind)
    changed = new_type or new_parent
    return success(
        {"type": kind, "parent": above, "previous": previous, "changed": changed},
        reasoning=f"Issue {number}: type {kind or 'none'}, parent {above or 'none'}"
        + ("" if changed else ", as it was"),
    )
