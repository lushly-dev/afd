"""Bundle uploads: what ``branch-push`` pushes from, read with git on the gateway's side.

An upload is a git bundle the caller made (``git bundle create head.bundle main..<branch>``)
and sent to ``POST /<route>/uploads?repo=<owner/name>``. The gateway fetches it, with object
checks on, into its bare mirror of that repository under ``refs/uploads/<id>/`` and reads,
from the objects themselves, the heads it carries and every commit not already on the
mirror's ``main``, with its author's email. Nothing the caller says about the bundle is
trusted. The bundle file is deleted once fetched; the objects stay in the mirror, from which
the gateway pushes.

Git runs under a lock per mirror, never the gateway's state lock, with one deadline for the
whole upload. A caller holds at most ``MAX_LIVE_UPLOADS`` live uploads. An upload lasts an hour;
when it expires its refs are deleted and the mirror is pruned of what nothing references.

The author check keeps credit honest; it authenticates no one, since anyone can set an
author email. Nothing treats it as an authorization control.
"""

from __future__ import annotations

import contextlib
import os
import secrets
import signal
import subprocess
import threading
import time
from datetime import timedelta
from pathlib import Path

from afd import Actor, CommandResult, error, success

from botcore_factory.gateway.claims import iso
from botcore_factory.gateway.service import Gateway

UPLOAD_LIFETIME = timedelta(hours=1)
#: Seconds one upload's git work may take in all.
UPLOAD_GIT_SECONDS = 300.0
#: Live uploads one caller may hold.
MAX_LIVE_UPLOADS = 5
MAIN = "refs/heads/main"

_mirror_locks: dict[Path, threading.Lock] = {}
_mirror_locks_guard = threading.Lock()


class GitError(Exception):
    pass


def _mirror_lock(mirror: Path) -> threading.Lock:
    with _mirror_locks_guard:
        return _mirror_locks.setdefault(mirror.resolve(), threading.Lock())


def git(mirror: Path, *arguments: str, deadline: float | None = None) -> str:
    """Run git against the bare mirror, within ``deadline`` (a ``time.monotonic()`` value).
    A non-zero exit, or running out of time, is GitError."""
    remaining = 300.0 if deadline is None else deadline - time.monotonic()
    if remaining <= 0:
        raise GitError("the upload ran out of time")
    # Its own process group, so a timeout also stops the helpers git starts (index-pack).
    process = subprocess.Popen(
        ["git", "--git-dir", str(mirror), *arguments],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
        env={
            **os.environ,
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
        },
    )
    try:
        stdout, stderr = process.communicate(timeout=remaining)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise GitError("the upload ran out of time") from None
    if process.returncode != 0:
        raise GitError(stderr.strip() or f"git {arguments[0]} failed")
    return stdout


def mirror_path(data_dir: Path, repo: str) -> Path:
    owner, _, name = repo.partition("/")
    return data_dir / "mirrors" / f"{owner}__{name}.git"


def ensure_mirror(data_dir: Path, repo: str) -> Path:
    """The repository's bare mirror, created empty when missing. The GitHub adapter keeps its
    ``main`` current; until it has fetched, every commit in a bundle counts as new."""
    mirror = mirror_path(data_dir, repo)
    if not (mirror / "HEAD").exists():
        mirror.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        git(mirror, "init", "--bare", "--quiet", str(mirror))
    return mirror


def mirror_contains(data_dir: Path, repo: str, head: str, commit: str) -> bool:
    """Whether ``head`` contains ``commit`` in the repository's mirror. A commit the mirror
    lacks is not contained: the push is refused rather than guessed."""
    mirror = mirror_path(data_dir, repo)
    if not (mirror / "HEAD").exists():
        return False
    try:
        git(mirror, "merge-base", "--is-ancestor", commit, head)
    except GitError:
        return False
    return True


def read_bundle(mirror: Path, bundle: Path, upload_id: str, deadline: float) -> dict:
    """Fetch ``bundle`` into ``mirror`` under ``refs/uploads/<id>/`` and read its heads and the
    commits it adds to main, newest first, with their authors' emails."""
    git(mirror, "bundle", "verify", "--quiet", str(bundle), deadline=deadline)
    heads = []
    for line in git(mirror, "bundle", "list-heads", str(bundle), deadline=deadline).splitlines():
        sha, _, ref = line.partition(" ")
        if sha and sha not in heads and ref != "HEAD":
            heads.append(sha)
    if not heads:
        raise GitError("the bundle names no branch")
    specs = [f"{sha}:refs/uploads/{upload_id}/{index}" for index, sha in enumerate(heads)]
    git(
        mirror,
        "-c",
        "transfer.fsckObjects=true",
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        str(bundle),
        *specs,
        deadline=deadline,
    )
    has_main = bool(git(mirror, "for-each-ref", MAIN, deadline=deadline).strip())
    log = git(
        mirror,
        "log",
        "--format=%H%x09%ae",
        *heads,
        *(["--not", MAIN] if has_main else []),
        deadline=deadline,
    )
    commits = []
    for line in log.splitlines():
        sha, _, email = line.partition("\t")
        commits.append({"sha": sha, "authorEmail": email})
    return {"heads": heads, "commits": commits}


class BundleUploads:
    """The gateway's upload handler: ``await uploads(route, actor, data, params)``."""

    def __init__(self, gateway: Gateway, data_dir: Path) -> None:
        self.gateway = gateway
        self.data_dir = data_dir
        self.directory = data_dir / "uploads"

    async def __call__(
        self, route: str, actor: Actor, data: bytes, params: dict | None = None
    ) -> CommandResult:
        import asyncio

        return await asyncio.to_thread(self.receive, route, actor, data, params or {})

    def receive(self, route: str, actor: Actor, data: bytes, params: dict) -> CommandResult:
        repo = params.get("repo", "")
        if repo not in self.gateway.config.repositories:
            served = ", ".join(self.gateway.config.repositories)
            return error(
                "VALIDATION_ERROR",
                f"Upload to ?repo=<owner/name>, one of: {served}",
                suggestion=f"POST the bundle to /{route}/uploads?repo=<one of: {served}>",
            )
        self.expire()
        live = [
            record
            for record in self.gateway.state.get("uploads", {}).values()
            if record.get("route") == route and record.get("by") == actor.id
        ]
        if len(live) >= MAX_LIVE_UPLOADS:
            return error(
                "RATE_LIMITED",
                f"You hold {len(live)} live uploads, the most a caller may",
                suggestion="Push or let the ones you hold expire (an hour), then upload again",
            )
        upload_id = f"upload-{secrets.token_hex(8)}"
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        bundle = self.directory / f"{upload_id}.bundle"
        descriptor = os.open(bundle, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
        deadline = time.monotonic() + UPLOAD_GIT_SECONDS
        try:
            mirror = ensure_mirror(self.data_dir, repo)
            with _mirror_lock(mirror):
                read = read_bundle(mirror, bundle, upload_id, deadline)
        except GitError as exc:
            self.discard(upload_id, {"repo": repo})
            return error(
                "BUNDLE_INVALID",
                f"The upload is not a bundle the gateway can read: {exc}",
                suggestion="Create it from main: git bundle create head.bundle main..<branch> "
                "(after fetching main), then upload it again",
            )
        finally:
            bundle.unlink(missing_ok=True)  # The objects are in the mirror now.
        expires = self.gateway.now() + UPLOAD_LIFETIME
        record = {
            **read,
            "repo": repo,
            "route": route,
            "by": actor.id,
            "expiresAt": iso(expires),
        }
        with self.gateway.state.lock:
            uploads = dict(self.gateway.state.get("uploads", {}))
            uploads[upload_id] = record
            self.gateway.state.put("uploads", uploads)
        return success(
            {
                "id": upload_id,
                "repo": repo,
                "heads": read["heads"],
                "commits": len(read["commits"]),
                "expiresAt": record["expiresAt"],
            },
            reasoning=f"Read {len(read['commits'])} new commit(s); pass {upload_id} to "
            "branch-push within the hour",
        )

    def discard(self, upload_id: str, record: dict) -> None:
        """Delete an upload's mirror refs. A ref left behind costs disk, not correctness:
        nothing pushes from an upload the state no longer holds."""
        mirror = mirror_path(self.data_dir, record.get("repo", ""))
        if not (mirror / "HEAD").exists():
            return
        try:
            with _mirror_lock(mirror):
                refs = git(
                    mirror, "for-each-ref", "--format=%(refname)", f"refs/uploads/{upload_id}/"
                )
                for ref in refs.split():
                    git(mirror, "update-ref", "-d", ref)
        except GitError:
            pass

    def prune(self, repo: str) -> None:
        """Drop the objects only expired uploads referenced. A fetch of many objects is kept
        as a pack, which ``prune`` alone never touches, so repack first."""
        mirror = mirror_path(self.data_dir, repo)
        if not (mirror / "HEAD").exists():
            return
        try:
            with _mirror_lock(mirror):
                git(mirror, "repack", "-a", "-d", "-q")
                git(mirror, "prune", "--expire=now")
        except GitError:
            pass

    def expire(self) -> None:
        """Forget uploads past their hour, delete their refs and prune their mirrors."""
        now = iso(self.gateway.now())
        with self.gateway.state.lock:
            uploads = dict(self.gateway.state.get("uploads", {}))
            expired = {
                upload_id: record
                for upload_id, record in uploads.items()
                if record.get("expiresAt") and record["expiresAt"] <= now
            }
            if expired:
                self.gateway.state.put(
                    "uploads", {k: v for k, v in uploads.items() if k not in expired}
                )
        for upload_id, record in expired.items():
            self.discard(upload_id, record)
        for repo in {record.get("repo", "") for record in expired.values()}:
            self.prune(repo)
