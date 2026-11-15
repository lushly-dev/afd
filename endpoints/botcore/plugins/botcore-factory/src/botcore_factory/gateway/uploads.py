"""Bundle uploads: what ``branch-push`` pushes from, read with git on the gateway's side.

An upload is a git bundle the caller made (``git bundle create head.bundle main..<branch>``)
and sent to ``POST /<route>/uploads?repo=<owner/name>``. The gateway fetches it into its bare
mirror of that repository and reads, from the objects themselves, the heads it carries and
every commit not already on the mirror's ``main``, with its author's email. Nothing the caller
says about the bundle is trusted: ``branch-push`` checks credit against what git read here.

An upload lasts an hour; its bundle file is deleted when it expires.
"""

from __future__ import annotations

import os
import secrets
import subprocess
from datetime import timedelta
from pathlib import Path

from afd import Actor, CommandResult, error, success

from botcore_factory.gateway.claims import iso
from botcore_factory.gateway.service import Gateway

UPLOAD_LIFETIME = timedelta(hours=1)
MAIN = "refs/heads/main"


class GitError(Exception):
    pass


def git(mirror: Path, *arguments: str) -> str:
    """Run git against the bare mirror; a non-zero exit is GitError with its stderr."""
    completed = subprocess.run(
        ["git", "--git-dir", str(mirror), *arguments],
        capture_output=True,
        text=True,
        timeout=300,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_NOSYSTEM": "1"},
    )
    if completed.returncode != 0:
        raise GitError(completed.stderr.strip() or f"git {arguments[0]} failed")
    return completed.stdout


def mirror_path(data_dir: Path, repo: str) -> Path:
    owner, _, name = repo.partition("/")
    return data_dir / "mirrors" / f"{owner}__{name}.git"


def ensure_mirror(data_dir: Path, repo: str) -> Path:
    """The repository's bare mirror, created empty when missing. The GitHub adapter keeps its
    ``main`` current; until it has fetched, every commit in a bundle counts as new."""
    mirror = mirror_path(data_dir, repo)
    if not (mirror / "HEAD").exists():
        mirror.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "init", "--bare", "--quiet", str(mirror)], check=True, capture_output=True
        )
    return mirror


def read_bundle(mirror: Path, bundle: Path, upload_id: str) -> dict:
    """Fetch ``bundle`` into ``mirror`` under ``refs/uploads/<id>/`` and read its heads and the
    commits it adds to main, newest first, with their authors' emails."""
    git(mirror, "bundle", "verify", str(bundle))
    heads = []
    for line in git(mirror, "bundle", "list-heads", str(bundle)).splitlines():
        sha, _, ref = line.partition(" ")
        if sha and sha not in heads and ref != "HEAD":
            heads.append(sha)
    if not heads:
        raise GitError("the bundle names no branch")
    specs = [f"{sha}:refs/uploads/{upload_id}/{index}" for index, sha in enumerate(heads)]
    git(mirror, "fetch", "--quiet", "--no-tags", str(bundle), *specs)
    has_main = bool(git(mirror, "for-each-ref", MAIN).strip())
    log = git(
        mirror,
        "log",
        "--format=%H%x09%ae",
        *heads,
        *(["--not", MAIN] if has_main else []),
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
        upload_id = f"upload-{secrets.token_hex(8)}"
        self.directory.mkdir(parents=True, exist_ok=True)
        bundle = self.directory / f"{upload_id}.bundle"
        descriptor = os.open(bundle, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
        try:
            with self.gateway.state.lock:
                read = read_bundle(ensure_mirror(self.data_dir, repo), bundle, upload_id)
        except (GitError, subprocess.TimeoutExpired) as exc:
            bundle.unlink(missing_ok=True)
            return error(
                "BUNDLE_INVALID",
                f"The upload is not a bundle the gateway can read: {exc}",
                suggestion="Create it from main: git bundle create head.bundle main..<branch> "
                "(after fetching main), then upload it again",
            )
        expires = self.gateway.now() + UPLOAD_LIFETIME
        record = {
            **read,
            "repo": repo,
            "route": route,
            "by": actor.id,
            "file": bundle.name,
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
        """Delete an expired upload's bundle and the mirror refs it was fetched to."""
        if record.get("file"):
            (self.directory / record["file"]).unlink(missing_ok=True)
        mirror = mirror_path(self.data_dir, record.get("repo", ""))
        if not (mirror / "HEAD").exists():
            return
        try:
            refs = git(mirror, "for-each-ref", "--format=%(refname)", f"refs/uploads/{upload_id}/")
            for ref in refs.split():
                git(mirror, "update-ref", "-d", ref)
        except GitError:
            pass  # A ref left behind costs disk, not correctness: nothing pushes from it.

    def expire(self) -> None:
        """Forget uploads past their hour and delete their bundles."""
        now = self.gateway.now()
        with self.gateway.state.lock:
            uploads = dict(self.gateway.state.get("uploads", {}))
            live = {}
            for upload_id, record in uploads.items():
                expires = record.get("expiresAt")
                if expires and expires <= iso(now):
                    self.discard(upload_id, record)
                    continue
                live[upload_id] = record
            if live != uploads:
                self.gateway.state.put("uploads", live)
