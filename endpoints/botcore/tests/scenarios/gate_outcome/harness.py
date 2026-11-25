"""The gate outcome jobs' harness: AFD's CLI contract over a prepared repository, recorded
invented GitHub answers and a temporary record.

AFD's TypeScript scenario runner (`run.mjs` beside this file) calls, through `cli.mjs`::

    python harness.py prepare <run dir> <scenario file name>
    python harness.py call <command> '<json>' --format json

`prepare` writes `<run dir>/repository`, a git checkout whose origin is
github.com/bench-org/beds and whose origin/main holds the scenario's workflows (and, where the
world has them, its commits, each landing at its own time), and `<run dir>/github.json`, the
recorded answers of the scenario's world (world.py): every run, attempt, job and job log, the
pull requests and issues the GraphQL API gives, or no GitHub at all. `call` runs one gate
outcome command from that checkout, with `GATE_OUTCOME_RUN` naming the run directory: `gh api`
is answered from the file, fetching the default branch does nothing, the clock is held at the
world's `now`, and the record, the machine's name and its settings are the run directory's, so
nothing of the machine running it is read or written.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import world

RUN_ENV = "GATE_OUTCOME_RUN"
COMMANDS = ("gate-outcome-collect", "gate-outcome-report")
CAP = 1000  # the most runs GitHub gives for one query


def _write(repository: Path, files: dict[str, str | None]) -> None:
    for name, text in files.items():
        path = repository / name
        if text is None:
            path.unlink()
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


def prepare(run_dir: Path, scenario: str) -> None:
    built = world.build(scenario)
    repository = run_dir / "repository"
    repository.mkdir(parents=True)
    git = ["git", "-C", str(repository), "-c", "user.name=Bench",
           "-c", "user.email=bench@example.invalid", "-c", "commit.gpgsign=false"]  # fmt: skip
    for args in (
        ["init", "-q"],
        ["remote", "add", "origin", f"https://github.com/{world.REPO}.git"],
    ):
        subprocess.run([*git, *args], check=True, capture_output=True)  # noqa: S603
    commits = built.get("commits") or [
        {"files": built["files"], "message": "The default branch's tip", "at": None}
    ]
    for commit in commits:
        _write(repository, commit["files"])
        moment = {} if commit["at"] is None else {
            "GIT_AUTHOR_DATE": commit["at"], "GIT_COMMITTER_DATE": commit["at"]
        }  # fmt: skip
        subprocess.run([*git, "add", "-A"], check=True, capture_output=True)  # noqa: S603
        subprocess.run(  # noqa: S603
            [*git, "commit", "-q", "--allow-empty", "-F", "-"], input=commit["message"],
            text=True, check=True, capture_output=True, env={**os.environ, **moment},
        )  # fmt: skip
    subprocess.run(  # noqa: S603
        [*git, "update-ref", "refs/remotes/origin/main", "HEAD"], check=True, capture_output=True
    )
    (run_dir / "github.json").write_text(json.dumps(built["github"]), encoding="utf-8")


class Recorded:
    """GitHub's Actions API, answered from the recorded world."""

    def __init__(self, answers: dict) -> None:
        self.answers = answers

    def call(self, endpoint: str, query: str | None = None):  # noqa: ANN201 - a github.Answer
        from botcore.commands.gate_outcome import github

        if self.answers.get("github") is None:
            raise github.ServiceUnavailable("gh is not installed or not on PATH")
        found = self.answers["github"]
        if endpoint == "rate_limit":
            allowance = {"remaining": 5000, "limit": 5000}
            return github.Answer(200, {"resources": {"core": allowance, "graphql": allowance}})
        if endpoint == "graphql" and query is not None:
            return self._graphql(found, query)
        path, query = urlsplit(endpoint).path, parse_qs(urlsplit(endpoint).query)
        prefix = f"repos/{world.REPO}/actions/"
        if path.startswith(prefix + "jobs/") and path.endswith("/logs"):
            log = found["logs"].get(path.split("/")[-2])
            if log is None:
                return github.Answer(404, None, "Not Found (HTTP 404)")
            return github.Answer(200, None, text=log)
        parts = path.removeprefix(prefix + "runs").strip("/").split("/")
        if parts == [""]:
            return github.Answer(200, self._list(found["runs"], query))
        key = f"{parts[0]}:{parts[2]}"
        if len(parts) == 3:  # noqa: PLR2004 - one attempt
            attempt = found["attempts"].get(key)
            return (
                github.Answer(200, attempt) if attempt else github.Answer(404, None, "(HTTP 404)")
            )
        jobs = found["jobs"].get(key)
        if jobs is None:
            return github.Answer(404, None, "Not Found (HTTP 404)")
        page, per_page = int(query["page"][0]), int(query["per_page"][0])
        shown = jobs[(page - 1) * per_page : page * per_page]
        return github.Answer(200, {"total_count": len(jobs), "jobs": shown})

    @staticmethod
    def _graphql(found: dict, query: str):  # noqa: ANN205 - a github.Answer
        """GitHub's GraphQL answer for `issueOrPullRequest` fields, from the world's pull
        requests (number -> the issues it closes) and issues (number -> state, labels)."""
        from botcore.commands.gate_outcome import github

        issues, pulls = found.get("issues", {}), found.get("pulls", {})

        def issue(number: str) -> dict:
            state, labels = issues[number]
            return {"number": int(number), "state": state.upper(),
                    "repository": {"nameWithOwner": world.REPO},
                    "labels": {"nodes": [{"name": label} for label in labels]}}  # fmt: skip

        nodes: dict = {}
        errors = []
        for alias, number in re.findall(r"(\w+): issueOrPullRequest\(number: (\d+)\)", query):
            if number in pulls:
                nodes[alias] = {"__typename": "PullRequest", "closingIssuesReferences": {
                    "nodes": [issue(str(n)) for n in pulls[number]]}}  # fmt: skip
            elif number in issues:
                nodes[alias] = {"__typename": "Issue", **issue(number)}
            else:
                nodes[alias] = None
                errors.append({"type": "NOT_FOUND", "path": ["repository", alias]})
        for alias, _sha in re.findall(r'(\w+): object\(oid: "([0-9a-f]{40})"\)', query):
            nodes[alias] = {"associatedPullRequests": {"nodes": []}}  # no pull request
        body: dict = {"data": {"repository": nodes}}
        if errors:
            body["errors"] = errors
        return github.Answer(200, body)

    @staticmethod
    def _list(runs: list[dict], query: dict) -> dict:
        begun, _, ended = query["created"][0].partition("..")
        low, high = world.parse(begun), world.parse(ended)
        found = sorted(
            (run for run in runs if low <= world.parse(run["created_at"]) <= high),
            key=lambda run: (run["created_at"], run["id"]),
            reverse=True,
        )
        page, per_page = int(query["page"][0]), int(query["per_page"][0])
        if page * per_page > CAP:  # GitHub gives no run past the thousandth
            return {"total_count": len(found), "workflow_runs": []}
        return {
            "total_count": len(found),
            "workflow_runs": found[(page - 1) * per_page : page * per_page],
        }


def call(command: str, arguments: dict, run_dir: Path) -> dict:
    os.environ.update({
        "BOTCORE_GATE_OUTCOME_STATE": str(run_dir / "state"),
        "BOTCORE_SKILL_USAGE_MACHINE": "bench",
        "BOTCORE_SKILL_USAGE_SHARED": "",
        "BOTCORE_SKILL_USAGE_STATE": str(run_dir / "skill-usage"),
        "BOTCORE_SKILL_USAGE_T3_STORE": "",
        "BOTCORE_SKILL_USAGE_CLAUDE_DIR": "",
        "BOTCORE_DISK_SETTINGS": str(run_dir / "no-machine-settings.toml"),
        "GH_PROMPT_DISABLED": "1",
    })  # fmt: skip
    from afd import error

    from botcore.cli import _to_dict
    from botcore.commands.gate_outcome import (
        gate_outcome_collect,
        gate_outcome_report,
        github,
        main,
        record,
    )

    answers = json.loads((run_dir / "github.json").read_text(encoding="utf-8"))
    github.call = Recorded(answers).call  # type: ignore[assignment]
    main.fetch = lambda _root, _branch: None  # type: ignore[assignment] - origin is invented
    held = world.parse(answers["now"])
    record.now = lambda: held  # type: ignore[assignment]
    functions = {"gate-outcome-collect": gate_outcome_collect,
                 "gate-outcome-report": gate_outcome_report}  # fmt: skip
    if command not in functions:
        result = error("UNKNOWN_COMMAND", f"The harness does not run {command}",
                       suggestion=f"Use one of: {', '.join(COMMANDS)}")  # fmt: skip
    else:
        try:
            result = asyncio.run(functions[command](**arguments))
        except TypeError as exc:
            result = error("VALIDATION_ERROR", str(exc), suggestion="Pass the command's inputs")
    return _to_dict(result)


def main(argv: list[str]) -> int:
    if len(argv) >= 3 and argv[0] == "prepare":  # noqa: PLR2004
        prepare(Path(argv[1]), argv[2])
        return 0
    if len(argv) >= 2 and argv[0] == "call":  # noqa: PLR2004
        run_dir = os.environ.get(RUN_ENV)
        if not run_dir:
            sys.stderr.write(f"{RUN_ENV} is not set\n")
            return 2
        arguments = json.loads(argv[2]) if len(argv) > 2 and not argv[2].startswith("--") else {}  # noqa: PLR2004
        result = call(argv[1], arguments, Path(run_dir))
        sys.stdout.write(json.dumps(result, default=str) + "\n")
        return 0 if result.get("success") else 1
    sys.stderr.write("Usage: harness.py prepare <run dir> <scenario> | call <command> [<json>]\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
