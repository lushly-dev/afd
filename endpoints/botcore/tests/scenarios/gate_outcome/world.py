"""The invented worlds of the gate outcome jobs: a repository `bench-org/beds`, its workflows at
the default branch's tip, and what GitHub's Actions API answers about a week of its runs. Every
name, number and line of log is made up, and the same on every run of the tests.

Scenario 01's week (the seven UTC days ending on `NOW`), as the scenario reads it:

- On pull requests, 409 runs: 240 of `beds.yml` (214 passed, two of them on a second attempt
  after the tests failed, 12 failed at their tests, 14 cancelled) and 169 of `shed.yml` (136
  passed, one on a second attempt after the browser tests failed, 2 failed at the browser
  tests, 9 failed at the Windows desktop tests, the browser tests then not run, 16 cancelled
  and 6 waiting for approval, which ran nothing). Today, 12 of shed's runs ran, one failing on
  Windows.
- In the merge queue, 90 runs of `shed.yml` on 90 groups, 5 failing at the browser tests, each
  12 minutes from creation to its last update.
- Beds' `gate` job runs `pnpm check`, Lefthook's `check` group, whose one command
  `boundaries` never fails; each log ends with Lefthook's summary.

Scenario 03's repository has one check in each of two workflows, and no GitHub at all.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

REPO = "bench-org/beds"
NOW = datetime(2026, 3, 12, 18, 0, tzinfo=UTC)
NOISE = "NOISE-a91c: output a log holds and the record never does"

BEDS = """\
name: Beds
on: [pull_request, merge_group]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:beds
  gate:
    runs-on: ubuntu-latest
    steps:
      - name: Quality gate
        run: pnpm check
"""
SHED = """\
name: Shed
on: [pull_request, merge_group]
jobs:
  desktop:
    strategy:
      matrix:
        os: [windows]
    runs-on: ${{ matrix.os }}-latest
    steps:
      - run: pnpm test:desktop
  browser:
    needs: desktop
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - if: needs.desktop.result == 'success'
        run: pnpm test:browser
"""
PACKAGE = '{\n  "scripts": {\n    "check": "lefthook run check"\n  }\n}\n'
LEFTHOOK = """\
check:
  commands:
    boundaries:
      run: pnpm check:boundaries
"""
BEDS_ONLY = """\
name: Beds
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:beds
"""
SHED_ONLY = """\
name: Shed
on: [pull_request]
jobs:
  browser:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:browser
"""


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def sha(n: int) -> str:
    return f"{n:040x}"


def lefthook_log(seconds: float) -> str:
    lines = [
        "##[group]Run pnpm check",
        "pnpm check",
        "##[endgroup]",
        "$ lefthook run check",
        f"src/beds.ts: {NOISE}",
        f"summary: (done in {seconds:.2f} seconds)",
        f"✔️ boundaries ({seconds:.2f} seconds)",
    ]
    return "".join(f"2026-03-01T00:00:00.0000000Z {line}\n" for line in lines)


class World:
    """Runs, their attempts, jobs and logs, as the Actions API gives them."""

    def __init__(self) -> None:
        self.runs: list[dict] = []
        self.attempts: dict[str, dict] = {}
        self.jobs: dict[str, list[dict]] = {}
        self.logs: dict[str, str] = {}
        self.next_run = 7000
        self.next_job = 90000

    def job(self, name: str, created: datetime, steps: list[tuple], log: str | None = None) -> dict:
        """A job: GitHub's own first and last steps around `steps` (name, conclusion, seconds)."""
        self.next_job += 1
        at = created
        listed = [
            {
                "name": "Set up job",
                "number": 1,
                "status": "completed",
                "conclusion": "success",
                "started_at": iso(at),
                "completed_at": iso(at),
            }
        ]
        for number, (step, end, seconds) in enumerate(steps, start=2):
            took = timedelta(seconds=seconds)
            listed.append({"name": step, "number": number, "status": "completed",
                           "conclusion": end, "started_at": iso(at),
                           "completed_at": iso(at + took)})  # fmt: skip
            at += took
        listed.append(
            {
                "name": "Complete job",
                "number": len(steps) + 2,
                "status": "completed",
                "conclusion": "success",
                "started_at": iso(at),
                "completed_at": iso(at),
            }
        )
        ends = [end for _, end, _ in steps]
        conclusion = next((e for e in ("failure", "cancelled") if e in ends), "success")
        if log is not None:
            self.logs[str(self.next_job)] = log
        return {"id": self.next_job, "name": name, "status": "completed",
                "conclusion": conclusion, "started_at": iso(created),
                "completed_at": iso(at), "steps": listed}  # fmt: skip

    def run(  # noqa: PLR0913 - a run's facts
        self, workflow: str, event: str, created: datetime, minutes: float,
        attempts: list[tuple[str, list[dict]]],
    ) -> None:  # fmt: skip
        """A run; `attempts` gives each attempt's conclusion and jobs, oldest first."""
        self.next_run += 1
        run_id = self.next_run
        names = {"beds": "Beds", "shed": "Shed"}
        base = {
            "id": run_id,
            "name": names[workflow],
            "path": f".github/workflows/{workflow}.yml",
            "event": event,
            "status": "completed",
            "head_sha": sha(run_id),
            "head_branch": f"gh-readonly-queue/main/pr-{run_id % 500}-{sha(42)}"
            if event == "merge_group"
            else f"feature/{run_id}",
            "pull_requests": [{"number": run_id % 500, "base": {"sha": sha(42)}}]
            if event == "pull_request"
            else [],
            "created_at": iso(created),
            "run_started_at": iso(created),
            "updated_at": iso(created + timedelta(minutes=minutes)),
        }
        for number, (conclusion, jobs) in enumerate(attempts, start=1):
            attempt = {**base, "run_attempt": number, "conclusion": conclusion}
            self.attempts[f"{run_id}:{number}"] = attempt
            self.jobs[f"{run_id}:{number}"] = jobs
        self.runs.append(self.attempts[f"{run_id}:{len(attempts)}"])

    def answers(self) -> dict:
        return {"now": iso(NOW), "github": {"runs": self.runs, "attempts": self.attempts,
                                            "jobs": self.jobs, "logs": self.logs}}  # fmt: skip


def moment(day: int, index: int, count: int) -> datetime:
    """The `index`th of `count` moments spread over a day `day` days before NOW's; today's all
    fall before NOW."""
    start = NOW.replace(hour=0, minute=0, second=0) - timedelta(days=day)
    span = (NOW - start - timedelta(hours=1)) if day == 0 else timedelta(days=1)
    return start + timedelta(minutes=5) + (span - timedelta(minutes=10)) * index / max(count, 1)


def spread(kinds: list[str], days: range) -> list[tuple[int, str]]:
    """Each kind of run on a day of `days`, round robin."""
    return [(days[i % len(days)], kind) for i, kind in enumerate(kinds)]


def _beds(world: World, placed: list[tuple[int, str]], counts: dict[int, int]) -> None:
    boundaries = [10.62] * 225 + [10.5]  # 2,400 seconds over the 226 group steps that passed
    for i, (day, kind) in enumerate(placed):
        created = moment(day, i // 7, counts[day])

        def jobs(test: str, gate: str, seconds: float | None) -> list[dict]:
            log = lefthook_log(seconds) if seconds is not None else None
            return [
                world.job("test", created, [("Run pnpm test:beds", test, 300)]),  # noqa: B023
                world.job("gate", created, [("Quality gate", gate, 20)], log),  # noqa: B023
            ]

        if kind == "cancel":
            world.run(
                "beds",
                "pull_request",
                created,
                10,
                [("cancelled", jobs("cancelled", "cancelled", None))],
            )
            continue
        seconds = boundaries.pop()
        latest = jobs("failure" if kind == "fail" else "success", "success", seconds)
        attempts = [("failure" if kind == "fail" else "success", latest)]
        if kind == "rerun":
            attempts.insert(0, ("failure", jobs("failure", "success", 11.0)))
        world.run("beds", "pull_request", created, 10, attempts)


def _shed(world: World, placed: list[tuple[int, str]], counts: dict[int, int], event: str) -> None:
    browser = [818] * 150 + [825] * 4  # 126,000 seconds over the 154 runs of the browser tests
    for i, (day, kind) in enumerate(placed):
        created = moment(day, i // 7 + 3, counts[day])
        if kind == "approval":
            world.run("shed", event, created, 0, [("action_required", [])])
            continue

        def jobs(desktop: str, test: str, seconds: int) -> list[dict]:
            return [
                world.job("desktop (windows)", created, [("Run pnpm test:desktop", desktop, 300)]),  # noqa: B023
                world.job("browser", created, [("Run pnpm test:browser", test, seconds)]),  # noqa: B023
            ]

        took = 0 if kind == "desktop" else browser.pop() if event == "pull_request" else 600
        ends = {
            "pass": ("success", "success", "success"),
            "rerun": ("success", "success", "success"),
            "browser": ("failure", "success", "failure"),
            "desktop": ("failure", "failure", "skipped"),
            "cancel": ("cancelled", "cancelled", "cancelled"),
        }[kind]
        attempts = [(ends[0], jobs(ends[1], ends[2], took))]
        if kind == "rerun":
            attempts.insert(0, ("failure", jobs("success", "failure", 818)))
        world.run("shed", event, created, 12 if event == "merge_group" else 15, attempts)


def scenario_01() -> dict:
    world = World()
    week = range(6, 0, -1)
    beds = spread(["rerun"] * 2 + ["pass"] * 212 + ["fail"] * 12 + ["cancel"] * 14, range(7))
    shed_today = [(0, "pass")] * 11 + [(0, "desktop")]
    shed_week = spread(
        ["rerun"] + ["pass"] * 124 + ["browser"] * 2 + ["desktop"] * 8 + ["cancel"] * 16
        + ["approval"] * 6,
        week,
    )  # fmt: skip
    queue = spread(["pass"] * 85 + ["browser"] * 5, range(7))
    counts: dict[int, int] = {}
    for day, _ in [*beds, *shed_today, *shed_week, *queue]:
        counts[day] = counts.get(day, 0) + 1
    _beds(world, beds, counts)
    _shed(world, shed_today + shed_week, counts, "pull_request")
    _shed(world, queue, counts, "merge_group")
    files = {".github/workflows/beds.yml": BEDS, ".github/workflows/shed.yml": SHED,
             "package.json": PACKAGE, "lefthook.yml": LEFTHOOK}  # fmt: skip
    return {"files": files, "github": world.answers()}


def scenario_03() -> dict:
    files = {".github/workflows/beds.yml": BEDS_ONLY, ".github/workflows/shed.yml": SHED_ONLY}
    return {"files": files, "github": {"now": iso(NOW), "github": None}}


def build(scenario: str) -> dict:
    if scenario.startswith("01-"):
        return scenario_01()
    if scenario.startswith("03-"):
        return scenario_03()
    raise SystemExit(f"No world for {scenario}")
