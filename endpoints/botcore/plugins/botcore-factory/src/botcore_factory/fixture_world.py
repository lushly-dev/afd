"""A world read from a software-factory scenario fixture, persisting its writes.

The fixture format is the one in ``docs/features/proposed/software-factory/scenarios/fixtures``
(``fresh.json`` is every fixture's base). ``split_fixture`` separates what is outside the lane
(GitHub, git, the clock, the machine, plans) from the lane's own state, which the harness seeds
into a ``StateStore``. ``FixtureWorld`` keeps the outside part in one JSON file and rewrites it
after every write, so a sequence of separate CLI processes sees one consistent world.

Claims are converted into claim comments when the world is created, so the plugin reads them
the way it reads GitHub. Nothing here calls GitHub, git, T3 Code or the operating system.
"""

from __future__ import annotations

import copy
import json
import os
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path

from botcore_factory.claims import Claim, claim_body, parse_time
from botcore_factory.world import (
    LANE_HOST_VARIABLE,
    Comment,
    Completed,
    HostRecord,
    Issue,
    Plan,
    PullRequest,
    World,
    WorldError,
)

#: Fixture keys the world answers for; the rest of a fixture is the lane's own state.
WORLD_KEYS = frozenset(
    {
        "repository",
        "issues",
        "claims",
        "laneHost",
        "requiredCheckOnMain",
        "now",
        "thisMachine",
        "host",
        "machines",
        "plans",
        "worktrees",
        "originQueueRefs",
        "processes",
        "pullRequests",
        "variables",
        "plansUnreadable",
    }
)
STATE_KEYS = frozenset(
    {
        "lane",
        "cells",
        "queue",
        "held",
        "events",
        "runs",
        "dials",
        "baseline",
        "review",
        "window",
        "experiments",
        "watching",
        "slots",
    }
)
IGNORED_KEYS = frozenset({"$schema", "app", "description", "version"})
DEFAULT_NOW = "2030-01-01T00:00:00Z"


def deep_merge(base: dict, override: dict) -> dict:
    """Merge as AFD's fixture loader does: objects recursively, arrays and values replaced."""
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def load_fixture(path: Path, base: str | None = None, overrides: dict | None = None) -> dict:
    """A fixture file merged over its base (relative to the fixture's directory), then overrides."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if base:
        data = deep_merge(json.loads((path.parent / base).read_text(encoding="utf-8")), data)
    return deep_merge(data, overrides or {})


def split_fixture(fixture: dict) -> tuple[dict, dict]:
    """The world part and the lane-state part of a fixture. Unknown keys are refused."""
    unknown = set(fixture) - WORLD_KEYS - STATE_KEYS - IGNORED_KEYS
    if unknown:
        raise ValueError(f"Fixture keys neither world nor lane state: {', '.join(sorted(unknown))}")
    world = {key: copy.deepcopy(value) for key, value in fixture.items() if key in WORLD_KEYS}
    state = {key: copy.deepcopy(value) for key, value in fixture.items() if key in STATE_KEYS}
    return world, state


def normalize_world(data: dict) -> dict:
    """Turn fixture ``claims`` into claim comments on their issues; idempotent."""
    data = copy.deepcopy(data)
    issues = {issue["number"]: issue for issue in data.get("issues", [])}
    for claim in data.pop("claims", []):
        issue = issues.get(claim["number"])
        if issue is None:
            raise ValueError(f"Claim on #{claim['number']}, which the fixture does not list")
        body = claim_body(Claim(claim["branch"], claim["machine"], claim["leaseUntil"]))
        issue.setdefault("comments", []).append({"body": body, "author": "factory"})
    for issue in data.get("issues", []):
        comments = issue.setdefault("comments", [])
        for field, author in (("question", "factory"), ("ownerReply", "owner")):
            if field in issue:
                comments.append({"body": issue.pop(field), "author": author})
        for index, comment in enumerate(comments, 1):
            comment.setdefault("id", f"{issue['number']}-{index}")
    return data


class FixtureWorld:
    """The world of one scenario run, stored in ``path``."""

    def __init__(self, path: Path) -> None:
        self.path = path
        try:
            self.data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise WorldError(f"Cannot read the fixture world {path}: {exc}") from exc

    @classmethod
    def create(cls, path: Path, world: dict) -> FixtureWorld:
        """Write a world from a fixture's world part and open it."""
        path.parent.mkdir(parents=True, exist_ok=True)
        _write(path, normalize_world(world))
        return cls(path)

    def save(self) -> None:
        _write(self.path, self.data)

    def world(self) -> World:
        return World(
            github=FixtureGitHub(self),
            git=FixtureGit(self),
            clock=FixtureClock(self),
            machine=FixtureMachine(self),
            plans=FixturePlans(self),
            processes=FixtureProcesses(self),
        )

    def issue_data(self, number: int) -> dict:
        for issue in self.data.get("issues", []):
            if issue["number"] == number:
                return issue
        raise WorldError(f"Issue #{number} not found")

    def this_machine(self) -> dict:
        machine_id = self.data.get("thisMachine") or "workstation"
        for record in self.data.get("machines", []):
            if record.get("id") == machine_id:
                return record
        return {"id": machine_id}


def _write(path: Path, data: dict) -> None:
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _issue(data: dict) -> Issue:
    return Issue(
        number=data["number"],
        title=data.get("title", f"Issue {data['number']}"),
        labels=tuple(data.get("labels", [])),
        assignees=tuple(data.get("assignees", [])),
        created_at=data.get("createdAt", ""),
        state=data.get("state", "OPEN"),
    )


class FixtureGitHub:
    def __init__(self, store: FixtureWorld) -> None:
        self.store = store

    def repository(self) -> str:
        return self.store.data.get("repository") or "example-org/example-repo"

    def list_issues(self) -> list[Issue]:
        return [
            _issue(issue)
            for issue in self.store.data.get("issues", [])
            if issue.get("state", "OPEN") == "OPEN"
        ]

    def get_issue(self, number: int) -> Issue:
        return _issue(self.store.issue_data(number))

    def comments(self, number: int) -> list[Comment]:
        return [
            Comment(c["id"], c["body"], c.get("author", ""), c.get("createdAt", ""))
            for c in self.store.issue_data(number).get("comments", [])
        ]

    def edit_labels(self, number: int, add: Sequence[str] = (), remove: Sequence[str] = ()) -> None:
        issue = self.store.issue_data(number)
        labels = [label for label in issue.get("labels", []) if label not in set(remove)]
        labels += [label for label in add if label not in labels]
        issue["labels"] = labels
        self.store.save()

    def add_comment(self, number: int, body: str) -> Comment:
        issue = self.store.issue_data(number)
        comments = issue.setdefault("comments", [])
        comment = {
            "id": f"{number}-{len(comments) + 1}",
            "body": body,
            "author": "factory",
            "createdAt": FixtureClock(self.store).stamp(),
        }
        comments.append(comment)
        self.store.save()
        return Comment(comment["id"], body, "factory", comment["createdAt"])

    def open_pull_requests(self) -> list[PullRequest]:
        closes: dict[int, set[int]] = {}
        for issue in self.store.data.get("issues", []):
            for pr in issue.get("openPrs", []):
                number = pr if isinstance(pr, int) else pr["number"]
                closes.setdefault(number, set()).add(issue["number"])
        listed = {pr["number"]: pr for pr in self.store.data.get("pullRequests", [])}
        for number, pr in listed.items():
            closes.setdefault(number, set()).update(pr.get("closes", []))
        return [
            PullRequest(number, listed.get(number, {}).get("branch", ""), tuple(sorted(issues)))
            for number, issues in sorted(closes.items())
        ]

    def get_variable(self, name: str) -> str | None:
        if name == LANE_HOST_VARIABLE:
            return self.store.data.get("laneHost")
        return self.store.data.get("variables", {}).get(name)

    def set_variable(self, name: str, value: str) -> None:
        if name == LANE_HOST_VARIABLE:
            self.store.data["laneHost"] = value
        else:
            self.store.data.setdefault("variables", {})[name] = value
        self.store.save()


class FixtureGit:
    def __init__(self, store: FixtureWorld) -> None:
        self.store = store

    def host_records(self) -> list[HostRecord]:
        records = []
        for raw in self.store.data.get("machines", []):
            records.append(
                HostRecord(
                    id=raw["id"],
                    name=raw.get("name", raw["id"]),
                    cores=raw.get("cores"),
                    memory_gb=raw.get("memoryGb"),
                    free_disk_gb=raw.get("freeDiskGb"),
                    missing=tuple(raw.get("missing", [])),
                    measured=bool(raw.get("measured", False)),
                    suggested_slots=int(raw.get("suggestedSlots", 1)),
                    probed_at=raw.get("probedAt"),
                    extra={k: v for k, v in raw.items() if k == "reachable"},
                )
            )
        return records

    def _worktree(self, worktree: str) -> dict:
        found = self.store.data.get("worktrees", {}).get(worktree)
        if found is None:
            raise WorldError(f"No worktree {worktree}")
        return found

    def head(self, worktree: str) -> str:
        return self._worktree(worktree).get("head", "")

    def branch(self, worktree: str) -> str | None:
        return self._worktree(worktree).get("branch")

    def is_clean(self, worktree: str) -> bool:
        return not self._worktree(worktree).get("dirty", False)


class FixtureClock:
    def __init__(self, store: FixtureWorld) -> None:
        self.store = store

    def now(self) -> datetime:
        return parse_time(self.store.data.get("now") or DEFAULT_NOW)

    def stamp(self) -> str:
        return self.now().isoformat().replace("+00:00", "Z")


class FixtureMachine:
    def __init__(self, store: FixtureWorld) -> None:
        self.store = store

    def id(self) -> str:
        return self.store.data.get("thisMachine") or "workstation"

    def cores(self) -> int:
        return int(self.store.this_machine().get("cores", 1))

    def memory_gb(self) -> float:
        return float(self.store.this_machine().get("memoryGb", 0))

    def free_memory_gb(self) -> float:
        host = self.store.data.get("host", {})
        if "freeMemoryGb" not in host:
            raise WorldError("The fixture does not say how much memory is free (host.freeMemoryGb)")
        return float(host["freeMemoryGb"])

    def free_disk_gb(self, path: str) -> float:
        return float(self.store.this_machine().get("freeDiskGb", 0))


class FixturePlans:
    def __init__(self, store: FixtureWorld) -> None:
        self.store = store

    def read(self) -> list[Plan]:
        if self.store.data.get("plansUnreadable"):
            raise WorldError("The fixture's plans are unreadable")
        return [
            Plan(
                raw["id"],
                raw.get("provider", ""),
                float(raw["used"]),
                float(raw["elapsed"]),
                raw.get("resetsAt"),
            )
            for raw in self.store.data.get("plans", [])
        ]


class FixtureProcesses:
    """Only this process, and pids the fixture lists as alive, are running."""

    def __init__(self, store: FixtureWorld) -> None:
        self.store = store

    def alive(self, pid: int, started_at: float | None = None) -> bool:
        return pid == os.getpid() or pid in self.store.data.get("processes", {}).get("alive", [])

    def start_time(self, pid: int) -> float | None:
        return None

    def run(self, args: Sequence[str], cwd: str, timeout: float | None = None) -> Completed:
        commands = self.store.data.get("processes", {}).get("results", {})
        key = " ".join(args)
        if key not in commands:
            raise WorldError(f"The fixture has no result for: {key}")
        result = commands[key]
        return Completed(
            tuple(args),
            result.get("returncode", 0),
            result.get("stdout", ""),
            result.get("stderr", ""),
        )
