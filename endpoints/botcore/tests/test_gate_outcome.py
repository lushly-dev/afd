"""gate-outcome-collect and gate-outcome-report, against recorded GitHub answers.

Every answer here is invented: a repository `bench-org/beds` with workflows named after a
garden. `FakeGitHub` stands in for `github.call`, the one function that runs `gh api`, and
answers as the Actions API does, including its cap of 1,000 runs for one query.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

from botcore.commands.disk.lock import RunLock
from botcore.commands.gate_outcome import collect, github, record
from botcore.commands.gate_outcome import gate_outcome_collect as collect_cmd
from botcore.commands.gate_outcome import gate_outcome_report as report_cmd
from botcore.commands.skill_usage import store

REPO = "bench-org/beds"
CANARY = "CANARY-7f3a-never-in-the-record"
NOW = datetime.now(UTC).replace(microsecond=0)
TODAY = NOW.replace(hour=0, minute=0, second=0)


def day(days_ago: int, hour: int = 12, minute: int = 0) -> datetime:
    """A moment in a whole UTC day before today: safe whatever the hour the tests run."""
    return TODAY - timedelta(days=days_ago) + timedelta(hours=hour, minutes=minute)


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def sha(n: int) -> str:
    return f"{n:040x}"


class FakeGitHub:
    """The Actions API of one repository, from runs built in the test."""

    def __init__(self) -> None:
        self.runs: dict[int, dict] = {}  # id -> the latest attempt, as the list gives it
        self.attempts: dict[tuple[int, int], dict] = {}
        self.jobs: dict[tuple[int, int], list[dict]] = {}
        self.calls: list[str] = []
        self.remaining = 5000
        self.fail: dict[str, github.Answer | Exception] = {}  # endpoint prefix -> answer
        self.next_id = 1000
        # (workflow, conclusion, created, minutes, attempt) -> the attempt's jobs; a job's
        # `_log` is its log's text
        self.make_jobs = None
        self.logs: dict[int, str] = {}
        self.next_job = 5000

    def add(  # noqa: PLR0913 - a run's facts
        self, workflow: str = "beds", event: str = "pull_request",
        conclusion: str | None = "success",
        created: datetime | None = None, minutes: float = 10, attempt: int = 1,
        status: str = "completed", head: int | None = None, earlier: tuple = (),
    ) -> int:  # fmt: skip
        """A run; `earlier` gives the conclusions of its earlier attempts, oldest first."""
        self.next_id += 1
        run_id = self.next_id
        created = created or day(3)
        names = {"beds": "Beds", "shed": "Shed", "verdict": "Verdict", "pages": "Pages"}
        base = {
            "id": run_id,
            "name": names.get(workflow, workflow.title()),
            "path": f".github/workflows/{workflow}.yml",
            "event": event,
            "status": status,
            "head_sha": sha(head if head is not None else run_id),
            "head_branch": f"gh-readonly-queue/main/pr-7-{sha(99)}"
            if event == "merge_group"
            else f"feature/{CANARY}",
            "display_title": f"Plant the beds {CANARY}",
            "head_commit": {"message": f"fix: {CANARY}", "author": {"email": "a@example.com"}},
            "actor": {"login": CANARY},
            "pull_requests": [{"number": 7, "base": {"sha": sha(42)}, "head": {"sha": sha(1)}}]
            if event == "pull_request"
            else [],
            "created_at": iso(created),
            "run_started_at": iso(created),
        }
        for number, ended in enumerate(earlier, start=1):
            self.attempts[(run_id, number)] = {
                **base, "run_attempt": number, "conclusion": ended,
                "updated_at": iso(created + timedelta(minutes=minutes)),
            }  # fmt: skip
            self.jobs[(run_id, number)] = self._jobs(ended, created, minutes, workflow, number)
        attempt = max(attempt, len(earlier) + 1)
        latest = {
            **base,
            "run_attempt": attempt,
            "conclusion": conclusion,
            "updated_at": iso(created + timedelta(minutes=minutes)),
        }
        self.runs[run_id] = latest
        self.attempts[(run_id, attempt)] = latest
        self.jobs[(run_id, attempt)] = self._jobs(conclusion, created, minutes, workflow, attempt)
        return run_id

    def _jobs(  # noqa: PLR0913 - an attempt's facts
        self, conclusion: str | None, created: datetime, minutes: float, workflow: str = "beds",
        attempt: int = 1,
    ) -> list[dict]:  # fmt: skip
        if self.make_jobs is not None:
            jobs = self.make_jobs(workflow, conclusion, created, minutes, attempt)
            for job in jobs:
                self.next_job += 1
                job.setdefault("id", self.next_job)
                log = job.pop("_log", None)
                if log is not None:
                    self.logs[job["id"]] = log
            return jobs
        end = created + timedelta(minutes=minutes)
        failing = conclusion if conclusion not in (None, "success") else "success"
        return [
            {
                "id": 1, "name": "test (ubuntu)", "conclusion": conclusion, "status": "completed",
                "started_at": iso(created), "completed_at": iso(end), "runner_name": CANARY,
                "labels": [CANARY],
                "steps": [
                    {"name": "Set up job", "number": 1, "conclusion": "success",
                     "started_at": iso(created),
                     "completed_at": iso(created + timedelta(seconds=5))},
                    {"name": "pnpm test:beds", "number": 2, "conclusion": failing,
                     "started_at": iso(created + timedelta(seconds=5)), "completed_at": iso(end),
                     "log": f"Error: {CANARY}"},
                ],
            }
        ]  # fmt: skip

    def call(self, endpoint: str) -> github.Answer:
        self.calls.append(endpoint)
        for prefix, answer in self.fail.items():
            if endpoint.startswith(prefix):
                if isinstance(answer, Exception):
                    raise answer
                return answer
        if endpoint == "rate_limit":
            return github.Answer(200, {"resources": {"core": {"remaining": self.remaining,
                                                              "limit": 5000}}})  # fmt: skip
        path, query = urlsplit(endpoint).path, parse_qs(urlsplit(endpoint).query)
        if path.startswith(f"repos/{REPO}/actions/jobs/") and path.endswith("/logs"):
            log = self.logs.get(int(path.split("/")[-2]))
            if log is None:
                return github.Answer(404, None, "Not Found (HTTP 404)")
            return github.Answer(200, None, text=log)
        parts = path.removeprefix(f"repos/{REPO}/actions/runs").strip("/").split("/")
        if parts == [""]:
            return self._list(query)
        run_id, attempt = int(parts[0]), int(parts[2])
        if len(parts) == 3:  # noqa: PLR2004
            found = self.attempts.get((run_id, attempt))
            return github.Answer(200, found) if found else github.Answer(404, None, "(HTTP 404)")
        jobs = self.jobs.get((run_id, attempt))
        if jobs is None:
            return github.Answer(404, None, "Not Found (HTTP 404)")
        return github.Answer(200, {"total_count": len(jobs), "jobs": jobs})

    def _list(self, query: dict) -> github.Answer:
        begun, _, ended = query["created"][0].partition("..")
        low, high = record.parse_time(begun), record.parse_time(ended)
        assert low is not None and high is not None
        found = sorted(
            (run for run in self.runs.values()
             if low <= record.parse_time(run["created_at"]) <= high),  # type: ignore[operator]
            key=lambda run: (run["created_at"], run["id"]), reverse=True,
        )  # fmt: skip
        page, per_page = int(query["page"][0]), int(query["per_page"][0])
        if page * per_page > collect.CAP:  # GitHub gives no run past the thousandth
            return github.Answer(200, {"total_count": len(found), "workflow_runs": []})
        return github.Answer(
            200,
            {
                "total_count": len(found),
                "workflow_runs": found[(page - 1) * per_page : page * per_page],
            },
        )

    def asked(self, kind: str) -> list[str]:
        """The endpoints of one kind that were asked for: lists, attempts or jobs."""
        if kind == "lists":
            return [c for c in self.calls if "/actions/runs?" in c]
        if kind == "jobs":
            return [c for c in self.calls if c.split("?")[0].endswith("/jobs")]
        if kind == "logs":
            return [c for c in self.calls if c.endswith("/logs")]
        return [c for c in self.calls if "/attempts/" in c and "/jobs" not in c]


class Bench:
    """A checkout of the invented repository, this machine's record and a shared folder."""

    def __init__(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        self.tmp, self.monkeypatch = tmp_path, monkeypatch
        self.checkout = tmp_path / "beds"
        self.checkout.mkdir()
        subprocess.run(["git", "init", "-q", str(self.checkout)], check=True)
        subprocess.run(
            ["git", "-C", str(self.checkout), "remote", "add", "origin",
             f"https://github.com/{REPO}.git"], check=True,
        )  # fmt: skip
        monkeypatch.chdir(self.checkout)
        self.github = FakeGitHub()
        monkeypatch.setattr(github, "call", self.github.call)
        self.shared = tmp_path / "shared"
        self.on("bench")

    def on(self, machine: str, shared: bool = False) -> Path:
        """Sit down at a machine; with `shared`, it names the shared folder."""
        if shared:
            self.shared.mkdir(exist_ok=True)
        state = self.tmp / f"record-{machine}"
        self.monkeypatch.setenv(record.STATE_ENV, str(state))
        self.monkeypatch.setenv(store.MACHINE_ENV, machine)
        self.monkeypatch.setenv(store.SHARED_ENV, str(self.shared) if shared else "")
        return state

    def tip(self, files: dict[str, str], message: str = "tip") -> str:
        """Commit `files` and make the commit the default branch's tip (origin/main)."""
        for name, text in files.items():
            path = self.checkout / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        git = ["git", "-C", str(self.checkout), "-c", "user.name=Bench",
               "-c", "user.email=bench@example.invalid", "-c", "commit.gpgsign=false"]  # fmt: skip
        subprocess.run([*git, "add", "-A"], check=True)
        subprocess.run([*git, "commit", "-q", "--allow-empty", "-m", message], check=True)
        subprocess.run([*git, "update-ref", "refs/remotes/origin/main", "HEAD"], check=True)
        return subprocess.run(
            [*git, "rev-parse", "HEAD"], check=True, capture_output=True, text=True
        ).stdout.strip()

    def folder(self, machine: str = "bench") -> Path:
        return record.repo_folder(self.tmp / f"record-{machine}", REPO)


@pytest.fixture
def bench(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Bench:
    return Bench(tmp_path, monkeypatch)


def ok(coro) -> dict:
    result = asyncio.run(coro)
    assert result.success, result.error
    return result.data


def refused(coro, code: str) -> object:
    result = asyncio.run(coro)
    assert not result.success, result.data
    assert result.error.code == code, result.error
    assert result.error.suggestion
    return result.error


def ci(data: dict) -> dict:
    (source,) = data["sources"]
    return source


def row(data: dict, workflow: str, where: str = "pull_request") -> dict:
    (found,) = [r for r in data["rows"] if r["workflow"] == workflow and r["where"] == where]
    return found


# ── Collecting ──────────────────────────────────────────────────────────────


def test_a_collection_reads_lists_attempts_and_steps_and_says_it_read_all(bench: Bench) -> None:
    passed = bench.github.add(conclusion="success")
    failed = bench.github.add(conclusion="failure")
    data = ok(collect_cmd(since_days=7))
    assert data["machine"] == "bench" and data["repository"] == REPO
    assert ci(data)["status"] == "read" and ci(data)["found"] == 2  # noqa: PLR2004
    assert data["requests_used"] == len(bench.github.calls)
    lines, unreadable = record.parse_lines((bench.folder() / record.RECORD_FILE).read_bytes())
    assert unreadable == 0
    steps = {line["run"]: line for line in lines if line["kind"] == "steps"}
    assert set(steps) == {passed, failed}
    # a run that passed holds seconds only; one that did not also holds each conclusion
    assert "conclusions" not in steps[passed]
    assert steps[failed]["conclusions"] == [["failure", ["success", "failure"]]]
    assert steps[passed]["seconds"] == [[600, [5, 595]]]
    shapes = [line for line in lines if line["kind"] == "shape"]
    assert len(shapes) == 1, "the names are kept once for the workflow's version"
    assert shapes[0]["jobs"] == [["test (ubuntu)", ["Set up job", "pnpm test:beds"]]]


def test_a_window_over_a_thousand_runs_is_split_until_each_part_fits(bench: Bench) -> None:
    for n in range(2600):
        bench.github.add(created=day(2, minute=0) + timedelta(seconds=30 * n))
    data = ok(collect_cmd(since_days=7, requests=5000))
    assert ci(data)["found"] == 2600  # noqa: PLR2004
    for endpoint in bench.github.asked("lists"):
        query = parse_qs(urlsplit(endpoint).query)
        assert int(query["page"][0]) <= collect.CAP // collect.PAGE
    pages_past_cap = [
        e for e in bench.github.asked("lists") if int(parse_qs(urlsplit(e).query)["page"][0]) > 10
    ]
    assert not pages_past_cap


def test_every_event_is_listed_and_only_the_five_get_rows(bench: Bench) -> None:
    for event in ("pull_request", "merge_group", "schedule", "push", "workflow_dispatch"):
        bench.github.add(event=event)
    bench.github.add(event="dynamic", workflow="pages")
    bench.github.add(event="release", workflow="pages")
    assert ci(ok(collect_cmd(since_days=7)))["found"] == 7  # noqa: PLR2004
    for endpoint in bench.github.asked("lists"):
        assert "event=" not in endpoint, "the lists are read without an event filter"
    data = ok(report_cmd(days=7))
    assert {r["where"] for r in data["rows"]} == {
        "pull_request", "merge_group", "schedule", "push", "workflow_dispatch",
    }  # fmt: skip
    assert data["coverage"]["other_events_left_out"] == {"dynamic": 1, "release": 1}
    assert any("2 runs of other events are left out" in w for w in data["warnings"])


def test_earlier_attempts_are_read_and_a_pass_after_a_failure_is_counted(bench: Bench) -> None:
    after_failing = bench.github.add(earlier=("failure",))
    bench.github.add(earlier=("cancelled",))
    bench.github.add(earlier=("failure", "cancelled"))
    bench.github.add(earlier=("success",))  # passed again after passing: nothing to follow
    data = ok(collect_cmd(since_days=7))
    assert ci(data)["status"] == "read"
    asked = bench.github.asked("attempts")
    assert f"repos/{REPO}/actions/runs/{after_failing}/attempts/1" in asked
    assert len(asked) == 5  # noqa: PLR2004 - each earlier attempt once
    assert len(bench.github.asked("jobs")) == 4 + 5  # noqa: PLR2004 - latest and earlier
    report = ok(report_cmd(days=7))
    beds = row(report, "Beds")
    assert beds["runs"] == 4 and beds["passed"] == 4  # noqa: PLR2004 - each run once
    assert beds["passed_on_later_attempt"] == 3  # noqa: PLR2004
    assert report["totals"]["passed_after"] == {"failed": 2, "cancelled": 1, "unknown": 0}
    assert beds["passed_after"] == {"failed": 2, "cancelled": 1, "unknown": 0}


def test_a_limited_collection_goes_on_without_reading_a_run_twice(bench: Bench) -> None:
    for n in range(30):
        bench.github.add(
            conclusion="failure" if n % 5 == 0 else "success",
            created=day(n % 6 + 1, minute=n),
            earlier=("failure",) if n % 7 == 0 else (),
        )
    # one look at the allowance, a list for each of the seven days, the five earlier
    # attempts, then the jobs of five attempts
    first = ok(collect_cmd(since_days=7, requests=18))
    source = ci(first)
    assert source["status"] == "partly" and "requests" in source["why"]
    assert first["requests_used"] == 18  # noqa: PLR2004
    assert source["reached"]["step"] == "jobs" and source["reached"]["steps_left"] > 0
    assert source["reached"]["window_listed"] == 1.0
    read_first = [tuple(int(part) for part in endpoint.split("/runs/")[1].split("/")[0:3:2])
                  for endpoint in bench.github.asked("jobs")]  # fmt: skip
    assert len(read_first) == 5  # noqa: PLR2004
    # those that did not pass come first
    for run_id, attempt in read_first:
        assert bench.github.attempts[(run_id, attempt)]["conclusion"] == "failure"

    calls_before = len(bench.github.calls)
    second = ok(collect_cmd(since_days=7))
    assert ci(second)["status"] == "read"
    later = bench.github.calls[calls_before:]
    for kind in ("jobs", "attempts"):
        asked = bench.github.asked(kind)
        assert len(asked) == len(set(asked)), f"a {kind} answer was asked for twice"
    # spans listed within the hour are not listed again: only the time since the last
    for endpoint in [c for c in later if "/actions/runs?" in c]:
        begun, _, ended = parse_qs(urlsplit(endpoint).query)["created"][0].partition("..")
        span = record.parse_time(ended) - record.parse_time(begun)  # type: ignore[operator]
        assert span < timedelta(minutes=1), endpoint

    third = ok(collect_cmd(since_days=7))
    assert ci(third)["status"] == "read" and ci(third)["added"] == 0
    assert ci(third)["found"] == 30  # noqa: PLR2004


def test_a_collection_stops_when_the_allowance_is_down_to_half(bench: Bench) -> None:
    bench.github.add()
    bench.github.remaining = 2500
    data = ok(collect_cmd(since_days=7))
    source = ci(data)
    assert source["status"] == "partly" and "allowance" in source["why"]
    assert data["allowance"] == {"remaining": 2500, "limit": 5000}
    assert data["requests_used"] == 1


def test_a_run_github_no_longer_has_is_kept_unreadable_and_not_asked_for_again(
    bench: Bench,
) -> None:
    gone = bench.github.add(conclusion="failure")
    del bench.github.jobs[(gone, 1)]
    assert ci(ok(collect_cmd(since_days=7)))["status"] == "read"
    ok(collect_cmd(since_days=7, requests=50))
    assert len(bench.github.asked("jobs")) == 1
    coverage = ok(report_cmd(days=6, ending_days_ago=1))["coverage"]
    assert coverage["steps_share"] == 0.0 and coverage["steps_unreadable"] == 1
    assert coverage["sources"]["ci"] == "read", "a run GitHub no longer has is on record as that"


def test_rebuild_asks_again_and_keeps_what_github_no_longer_answers(bench: Bench) -> None:
    kept = bench.github.add(conclusion="failure")
    ok(collect_cmd(since_days=7))
    del bench.github.jobs[(kept, 1)]
    data = ok(collect_cmd(since_days=7, rebuild=True))
    assert ci(data)["status"] == "read"
    assert len(bench.github.asked("jobs")) == 2  # noqa: PLR2004
    lines, _ = record.parse_lines((bench.folder() / record.RECORD_FILE).read_bytes())
    newest = [line for line in lines if line["kind"] == "steps"][-1]
    assert newest["unreadable"] is True and newest["seconds"] == [[600, [5, 595]]]
    assert "rebuild" not in record.load_state(bench.folder())


def test_a_rebuild_keeps_an_earlier_attempt_github_no_longer_has(bench: Bench) -> None:
    run_id = bench.github.add(earlier=("failure",))
    ok(collect_cmd(since_days=7))
    assert ok(report_cmd(days=7))["totals"]["passed_after"]["failed"] == 1
    del bench.github.attempts[(run_id, 1)]
    ok(collect_cmd(since_days=7, rebuild=True))
    report = ok(report_cmd(days=7))
    assert report["totals"]["passed_after"] == {"failed": 1, "cancelled": 0, "unknown": 0}
    lines, _ = record.parse_lines((bench.folder() / record.RECORD_FILE).read_bytes())
    newest = [line for line in lines if line["id"] == f"run:{run_id}:1"][-1]
    assert newest["conclusion"] == "failure" and newest["unreadable"] is True


def test_an_earlier_attempt_never_read_and_gone_is_an_unknown_end(bench: Bench) -> None:
    run_id = bench.github.add(earlier=("failure",))
    del bench.github.attempts[(run_id, 1)]
    ok(collect_cmd(since_days=7))
    report = ok(report_cmd(days=7))
    assert report["totals"]["passed_after"] == {"failed": 0, "cancelled": 0, "unknown": 1}
    ok(collect_cmd(since_days=7))
    assert len(bench.github.asked("attempts")) == 1, "not asked for again"


def test_a_rebuild_cut_short_goes_on_over_its_own_window_only(bench: Bench) -> None:
    for days_ago in (1, 2, 20):
        bench.github.add(created=day(days_ago))
    ok(collect_cmd(since_days=30))
    jobs = len(bench.github.asked("jobs"))
    source = ci(ok(collect_cmd(since_days=7, rebuild=True, requests=2)))
    assert source["status"] == "partly"
    assert "rebuild" in record.load_state(bench.folder())
    ok(collect_cmd(since_days=30))
    # the two runs of the rebuild's seven days are read again, not the one of 20 days ago
    assert len(bench.github.asked("jobs")) == jobs + 2  # noqa: PLR2004
    ok(collect_cmd(since_days=7))
    assert "rebuild" not in record.load_state(bench.folder())


def test_a_listed_span_replaces_the_spans_it_holds(bench: Bench) -> None:
    bench.github.add(created=day(1))
    ok(collect_cmd(since_days=2))
    ok(collect_cmd(since_days=2, rebuild=True))
    keys = list(record.load_state(bench.folder())["lists"])
    starts = [key.split("/")[0] for key in keys]
    assert len(starts) == len(set(starts)), keys


def test_two_machines_records_read_as_one_and_the_second_adds_nothing(bench: Bench) -> None:
    for _ in range(3):
        bench.github.add()
    bench.on("bench", shared=True)
    first = ok(collect_cmd(since_days=7))
    assert first["shared"]["written"] is True
    copy = bench.shared / "bench" / record.SHARED_FOLDER / "bench-org" / "beds"
    assert (copy / record.RECORD_FILE).is_file() and (copy / record.STATE_FILE).is_file()

    bench.on("potting-shed", shared=True)
    report = ok(report_cmd(days=7))  # before this machine collects: the other's record
    assert row(report, "Beds")["runs"] == 3  # noqa: PLR2004
    assert set(report["machines"]) == {"bench"}
    calls = len(bench.github.calls)
    second = ok(collect_cmd(since_days=7))
    assert ci(second)["added"] == 0 and ci(second)["status"] == "read"
    asked = bench.github.calls[calls:]
    # what the other machine read is not asked for again: only the time since it listed
    assert not [call for call in asked if "/attempts/" in call], asked
    lists = [call for call in asked if "/actions/runs?" in call]
    assert len(lists) <= 1 and all(TODAY.strftime("%Y-%m-%d") in call for call in lists)
    report = ok(report_cmd(days=7))
    assert row(report, "Beds")["runs"] == 3  # noqa: PLR2004 - each run once
    assert set(report["machines"]) == {"bench", "potting-shed"}


def test_a_copy_part_way_through_a_sync_is_not_read_and_is_named(bench: Bench) -> None:
    bench.github.add()
    bench.on("bench", shared=True)
    ok(collect_cmd(since_days=7))
    copy = bench.shared / "bench" / record.SHARED_FOLDER / "bench-org" / "beds"
    with (copy / record.RECORD_FILE).open("ab") as handle:
        handle.write(b'{"kind":"run"}\n')  # the record moved on; the state has not yet
    bench.on("potting-shed", shared=True)
    refused(report_cmd(days=7), "NOT_COLLECTED")
    ok(collect_cmd(since_days=7))
    report = ok(report_cmd(days=7))
    assert any("bench's copy in the shared folder is not whole" in w for w in report["warnings"])


def test_the_record_holds_no_output_titles_branches_or_contents(bench: Bench) -> None:
    bench.github.add(conclusion="failure", earlier=("failure",))
    bench.github.add(event="merge_group", head=5)
    bench.on("bench", shared=True)
    ok(collect_cmd(since_days=7))
    for path in [*bench.folder().rglob("*"), *bench.shared.rglob("*")]:
        if path.is_file():
            data = path.read_bytes()
            assert CANARY.encode() not in data, path
            assert b"example.com" not in data, path
            assert b"\r\n" not in data, path  # the same bytes on every system


def test_a_run_with_no_name_is_kept_by_its_path_and_counted(bench: Bench) -> None:
    run = bench.github.add(event="workflow_run", conclusion="startup_failure")
    bench.github.runs[run].update(name="", path="BuildFailed")
    ok(collect_cmd(since_days=7))
    lines, _ = record.parse_lines((bench.folder() / record.RECORD_FILE).read_bytes())
    (line,) = [line for line in lines if line["kind"] == "run"]
    assert (line["name"], line["workflow"]) == ("BuildFailed", "BuildFailed")
    data = ok(report_cmd(days=7))
    assert data["coverage"]["other_events_left_out"] == {"workflow_run": 1}


def test_the_base_of_a_queue_group_and_a_pull_request_is_kept(bench: Bench) -> None:
    pull = bench.github.add()
    queued = bench.github.add(event="merge_group")
    ok(collect_cmd(since_days=7))
    lines, _ = record.parse_lines((bench.folder() / record.RECORD_FILE).read_bytes())
    runs = {line["run"]: line for line in lines if line["kind"] == "run"}
    assert runs[pull]["base"] == sha(42) and runs[pull]["pr"] == 7  # noqa: PLR2004
    assert runs[queued]["base"] == sha(99) and runs[queued]["pr"] == 7  # noqa: PLR2004


def test_an_unfinished_last_line_does_not_spoil_the_next(bench: Bench) -> None:
    bench.github.add()
    ok(collect_cmd(since_days=7))
    with (bench.folder() / record.RECORD_FILE).open("ab") as handle:
        handle.write(b'{"id": "run:1')  # a write cut short
    bench.github.add()
    ok(collect_cmd(since_days=7, rebuild=True))
    report = ok(report_cmd(days=7))
    assert row(report, "Beds")["runs"] == 2  # noqa: PLR2004
    assert any("1 lines of bench's record could not be read" in w for w in report["warnings"])


# ── Collection refusals ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("inputs", "named"),
    [
        ({"since_days": 0}, "since_days"),
        ({"since_days": 366}, "since_days"),
        ({"requests": 0}, "requests"),
        ({"requests": 5001}, "requests"),
        ({"sources": ["ci", "logs"]}, "ci, main, reviews, runs"),
        ({"sources": []}, "ci, main, reviews, runs"),
        ({"sources": ["runs"]}, "ci, main"),
        ({"sources": ["reviews"]}, "ci, main"),
    ],
)
def test_collect_refuses_a_value_outside_its_list_or_range(
    bench: Bench, inputs: dict, named: str
) -> None:
    error = refused(collect_cmd(**inputs), "VALIDATION_ERROR")
    assert named in error.suggestion
    assert not bench.github.calls


def test_collect_refuses_outside_a_github_checkout(bench: Bench, tmp_path: Path) -> None:
    elsewhere = tmp_path / "loose"
    elsewhere.mkdir()
    (elsewhere / "pyproject.toml").write_text("[project]\nname = 'loose'\n", encoding="utf-8")
    bench.monkeypatch.chdir(elsewhere)
    refused(collect_cmd(), "NO_WORKSPACE")
    refused(report_cmd(), "NO_WORKSPACE")


def test_collect_refuses_when_github_cannot_be_asked(bench: Bench) -> None:
    bench.github.fail["rate_limit"] = github.ServiceUnavailable("gh is not installed")
    error = refused(collect_cmd(), "SERVICE_UNAVAILABLE")
    assert "gh auth status" in error.suggestion
    assert error.retryable is True
    bench.github.fail["rate_limit"] = github.Answer(503, None, "(HTTP 503)")
    refused(collect_cmd(), "SERVICE_UNAVAILABLE")
    # a collection that read nothing leaves nothing to report from
    refused(report_cmd(), "NOT_COLLECTED")


def test_the_allowance_is_asked_for_every_hundred_requests_even_after_a_retry(
    bench: Bench,
) -> None:
    for n in range(150):
        bench.github.add(conclusion="failure", created=day(1, minute=n))
    bench.github.fail[f"repos/{REPO}/actions/runs/1001/attempts/1/jobs"] = github.Answer(
        502, None, "(HTTP 502)"
    )
    ok(collect_cmd(since_days=2, requests=300))
    looks = [n for n, call in enumerate(bench.github.calls) if call == "rate_limit"]
    assert looks[0] == 0 and len(looks) >= 2  # noqa: PLR2004
    assert all(b - a <= github.CHECK_EVERY + 1 for a, b in zip(looks, looks[1:], strict=False))


def test_collect_refuses_when_github_will_not_give_the_runs(bench: Bench) -> None:
    bench.github.fail[f"repos/{REPO}/actions/runs?"] = github.Answer(
        403, {"message": "Resource not accessible"}, "Resource not accessible (HTTP 403)"
    )
    error = refused(collect_cmd(), "SOURCE_UNREADABLE")
    assert f"repos/{REPO}/actions/runs" in error.suggestion
    bench.github.fail[f"repos/{REPO}/actions/runs?"] = github.Answer(404, None, "(HTTP 404)")
    refused(collect_cmd(), "SOURCE_UNREADABLE")


def test_github_that_stops_answering_part_way_leaves_a_partly_read_source(bench: Bench) -> None:
    run_id = bench.github.add(conclusion="failure")
    bench.github.fail[f"repos/{REPO}/actions/runs/{run_id}/attempts/1/jobs"] = github.Answer(
        502, None, "Bad Gateway (HTTP 502)"
    )
    source = ci(ok(collect_cmd(since_days=7)))
    assert source["status"] == "partly" and "github" in source["why"]
    assert source["reached"]["step"] == "jobs"


def test_collect_refuses_while_another_collects(bench: Bench) -> None:
    state = bench.on("bench")
    with RunLock(state / record.LOCK_FILE):
        refused(collect_cmd(), "CONFLICT")


def test_collect_and_report_refuse_a_record_that_cannot_be_used(bench: Bench) -> None:
    state = bench.on("bench")
    state.write_text("not a folder", encoding="utf-8")
    refused(collect_cmd(), "RECORD_UNAVAILABLE")
    refused(report_cmd(), "RECORD_UNAVAILABLE")


# ── Reporting ───────────────────────────────────────────────────────────────


def test_each_way_a_run_ended_is_counted_apart(bench: Bench) -> None:
    for ended in ("success", "failure", "timed_out", "startup_failure", "cancelled",
                  "action_required", "skipped", "neutral"):  # fmt: skip
        bench.github.add(conclusion=ended)
    ok(collect_cmd(since_days=7))
    beds = row(ok(report_cmd(days=7)), "Beds")
    assert {k: beds[k] for k in ("runs", "passed", "failed", "cancelled", "action_required",
                                 "skipped", "other")} == {
        "runs": 8, "passed": 1, "failed": 3, "cancelled": 1, "action_required": 1,
        "skipped": 1, "other": 1,
    }  # fmt: skip
    # a run that ended action_required or skipped ran no step: its jobs are not asked for
    assert len(bench.github.asked("jobs")) == 6  # noqa: PLR2004


def test_action_required_runs_are_in_the_workflow_totals_and_wall_hours(bench: Bench) -> None:
    for _ in range(3):
        bench.github.add(conclusion="action_required", minutes=0)
    bench.github.add(conclusion="success", minutes=60)
    ok(collect_cmd(since_days=7))
    data = ok(report_cmd(days=7, where="pull_request"))
    assert data["totals"]["runs"] == 4 and data["totals"]["action_required"] == 3  # noqa: PLR2004
    assert row(data, "Beds")["wall_hours"] == 1.0
    assert data["coverage"]["steps_share"] == 1.0, "a run that ran no step needs none"


def test_wall_hours_run_from_creation_to_last_update_capped_at_six(bench: Bench) -> None:
    bench.github.add(minutes=90)
    bench.github.add(minutes=60 * 9)  # a run left waiting: six hours at most
    ok(collect_cmd(since_days=7))
    assert row(ok(report_cmd(days=7)), "Beds")["wall_hours"] == 7.5  # noqa: PLR2004


def test_queue_groups_and_how_many_had_a_failure(bench: Bench) -> None:
    for head in range(1, 6):
        bench.github.add(event="merge_group", head=head, conclusion="success")
        bench.github.add(
            event="merge_group", workflow="shed", head=head,
            conclusion="failure" if head in (2, 4) else "success",
        )  # fmt: skip
    bench.github.add(event="merge_group", workflow="beds", head=4, conclusion="failure")
    ok(collect_cmd(since_days=7))
    data = ok(report_cmd(days=7, where="merge_group"))
    shed = row(data, "Shed", "merge_group")
    assert (shed["runs"], shed["groups"], shed["groups_failed"]) == (5, 5, 2)
    beds = row(data, "Beds", "merge_group")
    assert (beds["runs"], beds["groups"], beds["groups_failed"]) == (6, 5, 1)
    assert data["totals"]["groups"] == 5 and data["totals"]["groups_failed"] == 2  # noqa: PLR2004
    assert data["totals"]["failed"] == 3  # noqa: PLR2004


def test_a_rate_needs_twenty_runs_that_passed_or_failed(bench: Bench) -> None:
    for n in range(19):
        bench.github.add(conclusion="failure" if n == 0 else "success")
    for _ in range(5):
        bench.github.add(conclusion="cancelled")  # not in what a rate is over
    for n in range(20):
        bench.github.add(workflow="shed", conclusion="failure" if n < 2 else "success")  # noqa: PLR2004
    ok(collect_cmd(since_days=7, requests=500))
    data = ok(report_cmd(days=7))
    beds = row(data, "Beds")
    assert beds["rates"] == "too-few" and "failed_per_100_completed" not in beds
    assert beds["failed"] == 1 and beds["runs"] == 24  # noqa: PLR2004 - the count is given
    shed = row(data, "Shed")
    assert shed["rates"] == "given" and shed["failed_per_100_completed"] == 10.0  # noqa: PLR2004


def test_the_window_is_whole_utc_days_ending_days_ago(bench: Bench) -> None:
    for days_ago in range(1, 10):
        bench.github.add(created=day(days_ago, hour=0, minute=1))
        bench.github.add(created=day(days_ago, hour=23, minute=59))
    ok(collect_cmd(since_days=10))
    data = ok(report_cmd(days=7, ending_days_ago=2))
    assert data["window"]["last_day"] == (TODAY - timedelta(days=2)).date().isoformat()
    assert data["window"]["first_day"] == (TODAY - timedelta(days=8)).date().isoformat()
    assert row(data, "Beds")["runs"] == 14  # noqa: PLR2004 - two a day, seven days
    assert data["coverage"]["sources"]["ci"] == "read"


def test_a_window_the_record_does_not_cover_says_so_and_gives_no_zeros(bench: Bench) -> None:
    bench.github.add(created=day(1))
    ok(collect_cmd(since_days=3))
    data = ok(report_cmd(days=7, ending_days_ago=10))
    assert data["rows"] == [] and data["coverage"]["sources"]["ci"] == "absent"
    assert data["totals"] is None, "no zeros for what was not read"
    assert any("does not hold every run" in w for w in data["warnings"])
    part = ok(report_cmd(days=7))
    assert part["coverage"]["sources"]["ci"] == "partly"
    assert 0 < part["coverage"]["window_listed"] < 1


def test_the_default_window_reads_all_read_right_after_a_collection(bench: Bench) -> None:
    bench.github.add(created=day(1))
    ok(collect_cmd(since_days=7))
    data = ok(report_cmd())
    assert data["coverage"]["sources"]["ci"] == "read"
    assert data["coverage"]["window_listed"] == 1.0
    assert not [w for w in data["warnings"] if "does not hold every run" in w]
    assert data["coverage"]["listed_until"]

    # a span of an earlier day listed just now does not stand for the rest of today: only a
    # span that reached its collection's own moment does, and today's was three hours ago
    state = record.load_state(bench.folder())
    today = iso(TODAY)[:10]
    lists = {}
    for key, entry in state["lists"].items():
        if key.startswith(today):
            key = f"{iso(TODAY)}/{iso(TODAY + timedelta(minutes=1))}"
            entry = {**entry, "at": iso(NOW - timedelta(hours=3)), "to_now": True}
        else:
            entry = {**entry, "at": iso(NOW), "to_now": False}
        lists[key] = entry
    state["lists"] = lists
    record.save_state(bench.folder(), state)
    if NOW - TODAY > timedelta(minutes=2):  # noqa: SIM102 - else today has no tail to miss
        assert ok(report_cmd())["coverage"]["sources"]["ci"] == "partly"


def test_a_readable_run_line_outranks_an_unreadable_one_from_either_machine() -> None:
    known = {"id": "run:5:1", "kind": "run", "v": 1, "at": iso(day(2)), "run": 5, "attempt": 1,
             "workflow": ".github/workflows/beds.yml", "name": "Beds", "event": "pull_request",
             "status": "completed", "conclusion": "failure", "head": sha(5), "base": None,
             "pr": None, "created": iso(day(3)), "started": None,
             "updated": iso(day(3))}  # fmt: skip
    gone = {**known, "at": iso(day(1)), "status": "unreadable", "conclusion": None,
            "updated": iso(day(1))}  # fmt: skip
    for order in (
        ((known, "bench"), (gone, "potting-shed")),
        ((gone, "potting-shed"), (known, "bench")),
    ):
        merged = record.Record()
        for line, machine in order:
            merged.add(record.checked(line), machine)  # type: ignore[arg-type]
        assert merged.runs["run:5:1"]["conclusion"] == "failure"


def test_two_shared_folders_of_one_machine_name_are_not_read_twice(bench: Bench) -> None:
    bench.github.add()
    bench.on("bench", shared=True)
    ok(collect_cmd(since_days=7))
    shutil.copytree(bench.shared / "bench", bench.shared / "twin")
    try:
        shutil.copytree(bench.shared / "bench", bench.shared / "TWIN")
    except FileExistsError:
        pytest.skip("this file system does not tell twin from TWIN")
    bench.on("potting-shed", shared=True)
    report = ok(report_cmd(days=7))
    assert any("twin's copy in the shared folder is not whole" in w for w in report["warnings"])
    assert row(report, "Beds")["runs"] == 1


def test_a_window_missing_minutes_is_partly_read_never_read(bench: Bench) -> None:
    bench.github.add(created=day(1))
    ok(collect_cmd(since_days=2))
    state = record.load_state(bench.folder())
    # a span listed to a minute short of midnight: the day is not all listed
    lists = {}
    for key, entry in state["lists"].items():
        begun, _, ended = key.partition("/")
        if begun.startswith((TODAY - timedelta(days=1)).strftime("%Y-%m-%d")):
            key = f"{begun}/{iso(TODAY - timedelta(minutes=1))}"
        lists[key] = entry
    state["lists"] = lists
    record.save_state(bench.folder(), state)
    data = ok(report_cmd(days=1, ending_days_ago=1))
    assert data["coverage"]["sources"]["ci"] == "partly"
    assert data["coverage"]["window_listed"] == 0.999  # noqa: PLR2004
    assert data["totals"]["runs"] == 1


def test_runs_kept_from_a_list_cut_short_are_partly_read_not_absent(bench: Bench) -> None:
    for n in range(150):
        bench.github.add(created=day(1, minute=n))
    # the allowance, today's list, the first page of yesterday's, and no more
    ok(collect_cmd(since_days=2, requests=3))
    data = ok(report_cmd(days=1, ending_days_ago=1))
    assert data["coverage"]["sources"]["ci"] == "partly"
    assert data["totals"]["runs"] == 100  # noqa: PLR2004


def test_a_run_still_going_is_in_no_count_and_is_named(bench: Bench) -> None:
    going = bench.github.add(status="in_progress", conclusion=None)
    bench.github.add()
    source = ci(ok(collect_cmd(since_days=7)))
    assert source["still_going"] == 1 and source["status"] == "read"
    data = ok(report_cmd(days=7))
    assert row(data, "Beds")["runs"] == 1
    assert any(str(going) in w and "still going" in w for w in data["warnings"])


def test_rows_are_sorted_and_limited_with_more(bench: Bench) -> None:
    for workflow, count, minutes in (("beds", 3, 5), ("shed", 1, 120), ("verdict", 2, 1)):
        for _ in range(count):
            bench.github.add(workflow=workflow, minutes=minutes, conclusion="failure"
                             if workflow == "verdict" else "success")  # fmt: skip
    ok(collect_cmd(since_days=7))
    by_minutes = ok(report_cmd(days=7, limit=2))
    assert [r["workflow"] for r in by_minutes["rows"]] == ["Shed", "Beds"]
    assert by_minutes["more"] == {"rows": 1}
    assert by_minutes["totals"]["runs"] == 6, "totals are over every row, shown or not"  # noqa: PLR2004
    assert [r["workflow"] for r in ok(report_cmd(days=7, sort="runs"))["rows"]][0] == "Beds"
    assert [r["workflow"] for r in ok(report_cmd(days=7, sort="failed"))["rows"]][0] == "Verdict"
    only = ok(report_cmd(days=7, workflow="shed.yml"))
    assert [r["workflow"] for r in only["rows"]] == ["Shed"]
    assert [r["workflow"] for r in ok(report_cmd(days=7, workflow="SHED"))["rows"]] == ["Shed"]


def test_the_commands_are_served_by_the_command_line_and_the_server(bench: Bench) -> None:
    from click.testing import CliRunner

    from botcore.cli import cli
    from botcore.docs import CORE_DOCS
    from botcore.server import build_namespace

    runner = CliRunner()
    helped = runner.invoke(cli, ["gate-outcome-report", "--help"])
    assert helped.exit_code == 0
    for word in ("--days", "--ending-days-ago", "--by", "--where", "--workflow", "--sort",
                 "--limit", "merge_group", "minutes"):  # fmt: skip
        assert word in helped.output
    helped = runner.invoke(cli, ["gate-outcome-collect", "--help"])
    for word in ("--since-days", "--source", "--requests", "--rebuild", "ci"):
        assert word in helped.output
    bench.github.add()
    collected = runner.invoke(cli, ["gate-outcome-collect", "--json"])
    assert json.loads(collected.output)["data"]["sources"][0]["status"] == "read"
    reported = runner.invoke(cli, ["gate-outcome-report", "--json", "--where", "pull_request"])
    assert json.loads(reported.output)["data"]["rows"][0]["runs"] == 1
    namespace, _registry = build_namespace()
    assert {"gate_outcome_collect", "gate_outcome_report"} <= set(namespace)
    for field in ("requests_used", "window_listed", "groups_failed", "too-few", "NOT_COLLECTED"):
        assert field in CORE_DOCS["gate-outcome"]


def test_a_report_before_any_collection_is_refused(bench: Bench) -> None:
    error = refused(report_cmd(), "NOT_COLLECTED")
    assert "gate-outcome-collect" in error.suggestion


@pytest.mark.parametrize(
    ("inputs", "named"),
    [
        ({"days": 0}, "days"),
        ({"days": 366}, "days"),
        ({"ending_days_ago": -1}, "ending_days_ago"),
        ({"ending_days_ago": 366}, "ending_days_ago"),
        ({"by": "team"}, "workflow"),
        ({"by": "decision"}, "workflow, check or area"),
        ({"by": "class"}, "workflow, check or area"),
        ({"where": "pull-request"}, "merge_group"),
        ({"where": "local"}, "pull_request"),
        ({"sort": "seconds"}, "minutes, failed, runs"),
        ({"limit": 0}, "75"),
        ({"limit": 76}, "75"),
    ],
)
def test_report_refuses_a_value_outside_its_list_or_range(
    bench: Bench, inputs: dict, named: str
) -> None:
    error = refused(report_cmd(**inputs), "VALIDATION_ERROR")
    assert named in error.suggestion


def test_a_workflow_that_is_not_known_is_refused_with_the_closest(bench: Bench) -> None:
    bench.github.add()
    bench.github.add(workflow="shed")
    ok(collect_cmd(since_days=7))
    error = refused(report_cmd(workflow="Bedz"), "INVALID_INPUT")
    assert "Beds" in error.suggestion and "knows 2 workflows" in error.suggestion


def test_the_report_names_each_machine_and_how_its_collection_ended(bench: Bench) -> None:
    for _ in range(4):
        bench.github.add(conclusion="failure")
    ok(collect_cmd(since_days=7, requests=10))  # the allowance, seven lists, two jobs
    data = ok(report_cmd(days=7))
    assert data["machines"]["bench"]["ci"] == "partly"
    assert "requests" in data["machines"]["bench"]["why"]
    assert data["coverage"]["sources"]["ci"] == "partly"
    assert data["coverage"]["steps_share"] < 1


def test_the_answers_name_no_field_a_later_piece_builds(bench: Bench) -> None:
    bench.github.add()
    collected = ok(collect_cmd(since_days=7))
    reported = ok(report_cmd(days=7))
    text = json.dumps([collected, reported])
    for later in ("pairs", "unresolved", "superseded", "undecided"):
        assert f'"{later}"' not in text


def test_a_line_another_program_wrote_cannot_put_text_in_the_shared_copy(bench: Bench) -> None:
    bench.github.add()
    ok(collect_cmd(since_days=7))
    line = {"id": "run:1:1", "kind": "run", "v": 1, "at": iso(NOW), "run": 1, "attempt": 1,
            "workflow": ".github/workflows/beds.yml", "name": "Beds", "event": "push",
            "status": "completed", "conclusion": "success", "head": sha(1), "base": None,
            "pr": None, "created": iso(day(2)), "started": None, "updated": iso(day(2)),
            "note": CANARY}  # fmt: skip
    with (bench.folder() / record.RECORD_FILE).open("ab") as handle:
        handle.write((json.dumps(line) + "\n").encode())
    bench.on("bench", shared=True)
    ok(collect_cmd(since_days=7))
    for path in bench.shared.rglob("*"):
        if path.is_file():
            assert CANARY.encode() not in path.read_bytes()
