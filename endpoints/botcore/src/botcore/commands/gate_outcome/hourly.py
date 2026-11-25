"""The hourly job's gate outcome step: a collection for each checkout the machine names.

The machine's settings (`gate_outcome_checkouts` in disk.toml) name the checkouts to collect
for; with none named, nothing is collected, since GitHub's hourly allowance belongs to the
account and the owner chooses which machine reads GitHub. For each checkout, in order:

1. The default branch is fetched from `origin` into a ref of the job's own (`OWN_REF`, under
   `refs/botcore/`), so the checks known are those at its tip without anything a session works
   with moving: no branch, remote-tracking branch or tag, no index or working tree, and no
   `FETCH_HEAD`. A fetch that fails is reported, and the collection reads what the checkout
   has: its landing branch, or an earlier fetch of the job's ref where that is newer.
2. `gate-outcome-collect` for the last seven days, every source this botcore collects, at its
   default limit and its stop at half the account's allowance. A refusal is reported and the
   next checkout goes on.
"""

from __future__ import annotations

from pathlib import Path

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.settings import expand
from botcore.commands.disk.steps import doing
from botcore.commands.gate_outcome import collect
from botcore.commands.gate_outcome.checks import OWN_REF

FETCH_SECONDS = 120.0
# A fetch that changes nothing but OWN_REF: no tags, no FETCH_HEAD, no submodules, no prune,
# no configured refspec (`--refmap=`, so origin/<branch> is not updated on the way), no
# origin/HEAD, and no housekeeping that could start in the checkout's repository meanwhile
FETCH = (
    "-c", "gc.auto=0", "-c", "maintenance.auto=false", "-c", "fetch.writeCommitGraph=false",
    "-c", "remote.origin.followRemoteHEAD=never", "-c", "credential.interactive=never",
    "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--no-recurse-submodules",
    "--no-prune", "--refmap=", "origin", f"+HEAD:{OWN_REF}",
)  # fmt: skip


def _tip(root: Path) -> str | None:
    try:
        return git_out(root, "rev-parse", "--verify", "--quiet", OWN_REF, ok_codes=(0, 1)).strip()
    except GitError:
        return None


def fetch_default(root: Path) -> dict:
    """Fetch origin's default branch into OWN_REF: `{ref, commit, moved}`, or `{ref, error}`
    when it could not be fetched (the commands then read the checkout's own landing branch)."""
    before = _tip(root) or None
    try:
        git_out(root, *FETCH, timeout=FETCH_SECONDS)
    except GitError as exc:  # (its text begins with the first arguments: the -c settings)
        return {"ref": OWN_REF, "error": "git fetch origin: " + str(exc).partition(": ")[2]}
    after = _tip(root) or None
    if after is None:
        return {"ref": OWN_REF, "error": "the fetch left no commit at the ref"}
    return {"ref": OWN_REF, "commit": after, "moved": after != before}


def _collected(result) -> dict:  # noqa: ANN001 - a CommandResult
    """What the job keeps of one checkout's collection."""
    if not result.success:
        error = result.error
        refused = {"code": error.code if error else "FAILED",
                   "message": error.message if error else "it failed"}  # fmt: skip
        if error is not None and error.suggestion:
            refused["suggestion"] = error.suggestion
        return {"error": refused}
    data = result.data or {}
    kept: dict = {"repository": data.get("repository"), "requests_used": data.get("requests_used")}
    kept["sources"] = [
        {key: source[key] for key in ("source", "status", "added", "why") if key in source}
        for source in data.get("sources", [])
    ]
    for key in ("folded", "shared", "warnings"):
        if key in data:
            kept[key] = data[key]
    return kept


def collect_checkouts(checkouts: list[str]) -> dict:
    """The step's work: each checkout's fetch and collection, in order. `refused` names the
    checkouts whose collection was refused or could not start."""
    entries: list[dict] = []
    for text in checkouts:
        root = expand(text)
        entry: dict = {"checkout": str(root)}
        doing("reading", root)
        if not root.is_dir():
            entry["error"] = {"code": "NO_WORKSPACE", "message": f"{root} is not a folder"}
            entries.append(entry)
            continue
        entry["fetch"] = fetch_default(root)
        entry.update(
            _collected(
                collect.collect_at(
                    root,
                    sources=list(collect.BUILT),
                    do_fetch=False,
                    fetch_error=entry["fetch"].get("error"),
                )
            )
        )
        entries.append(entry)
    return {
        "checkouts": entries,
        "refused": [entry["checkout"] for entry in entries if "error" in entry],
    }
