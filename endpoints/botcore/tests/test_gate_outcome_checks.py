"""gate-outcome-report by check: the checks known, matrix legs, steps that did not run, hook
group steps split into their commands, the verdict workflow and the canary over a planted log.

Every answer is invented, as in test_gate_outcome.py, whose fake GitHub and bench these tests
use: a repository `bench-org/beds` whose default branch's tip the bench commits.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from botcore.commands.gate_outcome import checks, github, record, summary
from botcore.commands.gate_outcome import gate_outcome_collect as collect_cmd
from botcore.commands.gate_outcome import gate_outcome_report as report_cmd
from tests.test_gate_outcome import CANARY, NOW, Bench, day, iso, ok, refused

STAMP = "2026-01-05T10:00:00.1234567Z"
PACKAGE = json.dumps({"scripts": {"check": "lefthook run check", "gate": "pnpm check"}})
LEFTHOOK = """\
check:
  parallel: false
  commands:
    lint:
      run: pnpm lint
    test:
      run: pnpm test
    boundaries:
      run: pnpm check:boundaries
pre-commit:
  commands:
    format:
      run: pnpm format
"""
BEDS = """\
name: Beds
on: [pull_request, merge_group]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v9
      - run: pnpm lint:beds
      - run: pnpm test:beds
  gate:
    runs-on: ubuntu-latest
    steps:
      - name: Quality gate
        run: pnpm check
      - name: Upload coverage
        if: failure()
        run: pnpm coverage:upload
"""
SHED = """\
name: Shed
on: [pull_request]
jobs:
  desktop:
    strategy:
      matrix:
        os: [windows, linux]
    runs-on: ${{ matrix.os }}
    steps:
      - run: pnpm test:desktop
  node:
    name: Node ${{ matrix.node }}
    strategy:
      matrix:
        node: ${{ fromJSON(github.event_name == 'schedule' && '["22", "26"]' || '["26"]') }}
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:node
  queue:
    name: Queue paths
    uses: ./.github/workflows/paths.yml
"""
PATHS = """\
on:
  workflow_call:
jobs:
  decide:
    name: Decide
    runs-on: ubuntu-latest
    steps:
      - run: node decide.mjs
"""
VERDICT = """\
name: Verdict
on: [pull_request, merge_group]
jobs:
  verdict:
    runs-on: ubuntu-latest
    steps:
      - run: node verdict.mjs
"""
FILES = {
    "package.json": PACKAGE,
    "lefthook.yml": LEFTHOOK,
    ".github/workflows/beds.yml": BEDS,
    ".github/workflows/shed.yml": SHED,
    ".github/workflows/paths.yml": PATHS,
    ".github/workflows/verdict.yml": VERDICT,
}


@pytest.fixture
def bench(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Bench:
    bench = Bench(tmp_path, monkeypatch)
    bench.tip(FILES)
    return bench


def job(  # noqa: PLR0913 - a job as the jobs API gives it
    name: str, steps: list[tuple[str, str | None]], created: datetime,
    conclusion: str | None = None, log: str | None = None, seconds: int = 60,
) -> dict:  # fmt: skip
    """A job with GitHub's own first and last steps around `steps` (name, conclusion)."""
    at = created
    listed = [{"name": "Set up job", "number": 1, "conclusion": "success",
               "started_at": iso(at), "completed_at": iso(at)}]  # fmt: skip
    for number, (step_name, end) in enumerate(steps, start=2):
        took = 0 if end in ("skipped", None) else seconds
        listed.append(
            {
                "name": step_name,
                "number": number,
                "conclusion": end,
                "started_at": iso(at),
                "completed_at": iso(at + timedelta(seconds=took)),
            }
        )
        at += timedelta(seconds=took)
    listed.append({"name": "Complete job", "number": len(steps) + 2, "conclusion": "success",
                   "started_at": iso(at), "completed_at": iso(at)})  # fmt: skip
    if conclusion is None:
        conclusion = "failure" if any(end == "failure" for _, end in steps) else "success"
    if conclusion == "skipped" and not steps:
        listed = []  # a job skipped by its condition lists no step
    found = {"name": name, "conclusion": conclusion, "status": "completed",
             "started_at": iso(created), "completed_at": iso(at), "steps": listed}  # fmt: skip
    if log is not None:
        found["_log"] = log
    return found


def lefthook_log(*commands: tuple[str, str, float], noise: str = CANARY) -> str:
    """A job's log: the step's output, then Lefthook's summary of `commands`."""
    marks = {"passed": "✔️", "failed": "🥊"}
    lines = [
        "##[group]Run pnpm check",
        "pnpm check",
        "##[endgroup]",
        "$ lefthook run check",
        f"Error: {noise} in packages/beds/src/secret.ts",
        f"  ────────────────── {noise}",
        f"summary: (done in {sum(c[2] for c in commands):.2f} seconds)",
        *(f"{marks[end]} {name} ({seconds:.2f} seconds)" for name, end, seconds in commands),
        f"##[error]Process completed with exit code 1. {noise}",
    ]
    return "\n".join(f"{STAMP} {line}" for line in lines) + "\n"


def by_check(data: dict) -> dict[str, dict]:
    return {(r["check"]): r for r in data["rows"]}


def unseen(data: dict) -> dict[str, str]:
    return {entry["check"]: entry["why"] for entry in data["not_observed"]}


def record_bytes(bench: Bench) -> bytes:
    return (bench.folder() / record.RECORD_FILE).read_bytes()


# ── The checks known ────────────────────────────────────────────────────────


def test_the_checks_known_come_from_the_default_branchs_tip_not_the_working_tree(
    bench: Bench,
) -> None:
    (bench.checkout / ".github/workflows/beds.yml").write_text(
        BEDS + "  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm extra\n",
        encoding="utf-8",
    )
    (bench.checkout / ".github/workflows/branch-only.yml").write_text(VERDICT, encoding="utf-8")
    known = checks.read_known(bench.checkout)
    ids = known.ids({})
    assert known.ref == "refs/remotes/origin/HEAD" or known.ref == "refs/remotes/origin/main"
    assert "beds.yml / test / pnpm test:beds" in ids
    assert not any("extra" in i or "branch-only" in i for i in ids)
    # a workflow only another calls has no checks of its own; its jobs are the caller's
    assert not any(i.startswith("paths.yml") for i in ids)
    assert "shed.yml / Queue paths / Decide / node decide.mjs" in ids
    # a step goes by its name, or by its command where it has none
    assert "beds.yml / test / actions/checkout@v9" in ids
    assert "beds.yml / gate / Upload coverage" in ids


def test_a_group_step_is_one_check_for_each_of_its_groups_commands(bench: Bench) -> None:
    ids = checks.read_known(bench.checkout).ids({})
    gate = sorted(i for i in ids if i.startswith("beds.yml / gate / Quality gate"))
    assert gate == [
        "beds.yml / gate / Quality gate / boundaries",
        "beds.yml / gate / Quality gate / lint",
        "beds.yml / gate / Quality gate / test",
    ], "the step's command comes down through package.json to lefthook run check"
    assert "beds.yml / gate / Quality gate" not in ids


def test_matrix_legs_are_named_as_github_names_them() -> None:
    matrix = {
        "os": ["a", "b"],
        "py": [1, 2],
        "exclude": [{"os": "b", "py": 1}],
        "include": [{"os": "a", "extra": "x"}, {"os": "c", "py": 3}],
    }
    assert checks.expand(matrix) == [
        {"os": "a", "py": 1, "extra": "x"},
        {"os": "a", "py": 2, "extra": "x"},
        {"os": "b", "py": 2},
        {"os": "c", "py": 3},
    ]
    _, names, pattern = checks.legs("build", {"strategy": {"matrix": matrix}})
    assert names == ["build (a, 1, x)", "build (a, 2, x)", "build (b, 2)", "build (c, 3)"]
    assert pattern is None
    _, names, _ = checks.legs("t", {"name": "Plugin on ${{ matrix.os }}", "strategy": {
        "matrix": {"os": ["linux"], "include": [{"os": "mac"}]}}})  # fmt: skip
    assert names == ["Plugin on linux", "Plugin on mac"]
    _, names, _ = checks.legs("check", {"name": "Umbel (fmt)", "strategy": {"matrix": {
        "os": ["ubuntu-latest"]}}})  # fmt: skip
    assert names == ["Umbel (fmt) (ubuntu-latest)"], "values not in the name are appended"
    template, names, pattern = checks.legs("lint", {
        "name": "TypeScript (Node ${{ matrix.node }})",
        "strategy": {"matrix": {"node": "${{ fromJSON('[\"26.x\"]') }}"}}})  # fmt: skip
    assert names == [] and pattern is not None and pattern.fullmatch("TypeScript (Node 26.x)")
    assert template == "TypeScript (Node ${{ matrix.node }})"


def test_a_leg_an_expression_decides_is_listed_once_until_the_record_sees_one(
    bench: Bench,
) -> None:
    known = checks.read_known(bench.checkout)
    assert "shed.yml / Node ${{ matrix.node }} / pnpm test:node" in known.ids({})
    seen = known.ids({"shed.yml": {"Node 26", "Node 22", "Node ${{ matrix.node }}"}})
    assert "shed.yml / Node 26 / pnpm test:node" in seen
    assert "shed.yml / Node 22 / pnpm test:node" in seen
    assert "shed.yml / Node ${{ matrix.node }} / pnpm test:node" not in seen, (
        "a skipped job's unexpanded name is not a leg"
    )


# ── Counting ────────────────────────────────────────────────────────────────


def _shed_jobs(workflow: str, conclusion: str | None, created: datetime, *_args: object) -> list:
    if workflow != "shed":
        return []
    return [
        job("desktop (windows)", [("Run pnpm test:desktop", conclusion)], created),
        job("desktop (linux)", [], created, conclusion="skipped"),
        job("Node 26", [("Run pnpm test:node", "success")], created),
        job("Queue paths / Decide", [("Run node decide.mjs", "success")], created),
    ]


def test_a_matrix_leg_is_its_own_check_and_a_leg_never_run_is_not_observed(bench: Bench) -> None:
    bench.github.make_jobs = _shed_jobs
    for _ in range(3):
        bench.github.add(workflow="shed")
    bench.github.add(workflow="shed", conclusion="failure")
    ok(collect_cmd(since_days=7))
    data = ok(report_cmd(days=7, by="check", where="pull_request", workflow="shed.yml"))
    rows = by_check(data)
    windows = rows["shed.yml / desktop (windows) / pnpm test:desktop"]
    assert (windows["runs"], windows["passed"], windows["failed"]) == (4, 3, 1)
    assert windows["rates"] == "too-few" and windows["known"] is True
    assert windows["local"] == "absent" and windows["quiet"] is False
    assert rows["shed.yml / Node 26 / pnpm test:node"]["known"] is True
    assert rows["shed.yml / Queue paths / Decide / node decide.mjs"]["runs"] == 4  # noqa: PLR2004
    missing = unseen(data)
    linux = missing["shed.yml / desktop (linux) / pnpm test:desktop"]
    assert "its job was skipped in the 4 runs" in linux
    assert "shed.yml / desktop (windows) / pnpm test:desktop" not in missing
    assert "shed.yml / Node ${{ matrix.node }} / pnpm test:node" not in missing
    assert not any(check.startswith("beds.yml") for check in missing), "the workflow filter"
    assert not any(
        "Set up job" in row["check"] or "Complete job" in row["check"] for row in data["rows"]
    )


def _beds_jobs(  # noqa: PLR0913 - the fake's signature
    workflow: str, conclusion: str | None, created: datetime, _minutes: float, attempt: int,
    gate: str | None = None,
) -> list:  # fmt: skip
    if workflow != "beds":
        return []
    lint = "failure" if conclusion == "failure" else "success"
    test = "skipped" if lint == "failure" else "success"
    return [
        job(
            "test",
            [
                ("Run actions/checkout@v9", "success"),
                ("Run pnpm lint:beds", lint),
                ("Run pnpm test:beds", test),
            ],
            created,
        ),  # fmt: skip
        job("gate", [("Quality gate", "success"), ("Upload coverage", "skipped")], created),
    ]


def test_a_step_that_did_not_run_is_not_a_run_of_that_check(bench: Bench) -> None:
    bench.github.make_jobs = _beds_jobs
    bench.github.add(conclusion="success")
    bench.github.add(conclusion="success")
    failed = bench.github.add(conclusion="failure")
    ok(collect_cmd(since_days=7))
    rows = by_check(ok(report_cmd(days=7, by="check", where="pull_request")))
    test = rows["beds.yml / test / pnpm test:beds"]
    assert (test["runs"], test["passed"], test["failed"], test["not-run"]) == (2, 2, 0, 1)
    assert test["quiet"] is True, "it ran and never failed"
    lint = rows["beds.yml / test / pnpm lint:beds"]
    assert (lint["runs"], lint["failed"], lint["quiet"]) == (3, 1, False)
    upload = rows["beds.yml / gate / Upload coverage"]
    assert (upload["runs"], upload["not-run"], upload["quiet"]) == (0, 3, False)
    # a passed attempt keeps its conclusions where a step was skipped
    lines, _ = record.parse_lines(record_bytes(bench))
    steps = [line for line in lines if line["kind"] == "steps"]
    assert all("conclusions" in line for line in steps)
    assert all(line["v"] == record.RULES for line in lines)
    assert failed in {line["run"] for line in steps}


def test_a_check_passed_on_a_later_attempt_is_counted_with_what_came_before(
    bench: Bench,
) -> None:
    bench.github.make_jobs = _beds_jobs
    bench.github.add(conclusion="success", earlier=("failure",))
    ok(collect_cmd(since_days=7))
    rows = by_check(ok(report_cmd(days=7, by="check")))
    lint = rows["beds.yml / test / pnpm lint:beds"]
    assert lint["passed_on_later_attempt"] == 1 and lint["passed_after"]["failed"] == 1
    assert lint["failed"] == 0, "the run is counted once, as its latest attempt"
    named = ok(report_cmd(days=7, by="check", check="beds.yml / test / pnpm lint:beds"))
    assert [(e["attempt"], e["latest"]) for e in named["examples"]] == [(1, False)], (
        "the attempt it failed in is named, though the run passed on the next"
    )
    assert rows["beds.yml / test / actions/checkout@v9"]["passed_on_later_attempt"] == 0


def test_a_check_with_too_few_runs_gets_its_counts_and_no_rate(bench: Bench) -> None:
    bench.github.make_jobs = _beds_jobs
    for _ in range(19):
        bench.github.add(conclusion="success", created=day(2))
    ok(collect_cmd(since_days=7))
    row = by_check(ok(report_cmd(days=7, by="check")))["beds.yml / test / pnpm test:beds"]
    assert row["runs"] == 19 and row["rates"] == "too-few"  # noqa: PLR2004
    assert "failed_per_100_completed" not in row
    bench.github.add(conclusion="success", created=day(2))
    ok(collect_cmd(since_days=7, rebuild=True))
    row = by_check(ok(report_cmd(days=7, by="check")))["beds.yml / test / pnpm test:beds"]
    assert row["runs"] == 20 and row["rates"] == "given"  # noqa: PLR2004
    assert row["failed_per_100_completed"] == 0.0


# ── Group steps ─────────────────────────────────────────────────────────────


def _gate_jobs(logs: dict[str, str | None]):  # noqa: ANN202 - a fake's jobs
    """Beds' gate job, its group step ending as the run did, with the log `logs` gives."""

    def make(workflow: str, conclusion: str | None, created: datetime, *_args: object) -> list:
        if workflow != "beds":
            return []
        end = "failure" if conclusion == "failure" else "success"
        log = logs.get(end)
        return [job("gate", [("Quality gate", end), ("Upload coverage", "skipped")], created,
                    log=log)]  # fmt: skip

    return make


def test_a_group_step_is_split_into_its_commands_by_the_runners_summary(bench: Bench) -> None:
    bench.github.make_jobs = _gate_jobs({
        "failure": lefthook_log(("boundaries", "passed", 1.25), ("lint", "passed", 2.0),
                                ("test", "failed", 30.5)),
        "success": lefthook_log(("boundaries", "passed", 1.75), ("lint", "passed", 3.0),
                                ("test", "passed", 29.5)),
    })  # fmt: skip
    failed = bench.github.add(conclusion="failure", created=day(2))
    bench.github.add(conclusion="success", created=day(3))
    collected = ok(collect_cmd(since_days=7))
    assert len(bench.github.asked("logs")) == 2, "one log read for each job"  # noqa: PLR2004
    assert collected["sources"][0]["status"] == "read"
    data = ok(report_cmd(days=7, by="check"))
    rows = by_check(data)
    assert "beds.yml / gate / Quality gate" not in rows, "the group's commands are its checks"
    test = rows["beds.yml / gate / Quality gate / test"]
    assert (test["passed"], test["failed"], test["minutes"], test["timed"]) == (1, 1, 1.0, 2)
    assert test["command"] == "test" and test["result_unknown"] == 0
    lint = rows["beds.yml / gate / Quality gate / lint"]
    assert (lint["passed"], lint["failed"], lint["quiet"]) == (2, 0, True)
    assert data["coverage"]["commands_share"] == 1.0
    assert data["coverage"]["summaries_unreadable"] == {}
    named = ok(report_cmd(days=7, by="check", check="beds.yml / gate / Quality gate / test"))
    assert [example["run"] for example in named["examples"]] == [failed]
    assert named["examples"][0]["latest"] is True
    assert [row["check"] for row in named["rows"]] == ["beds.yml / gate / Quality gate / test"]


def test_a_passed_group_steps_log_is_read_last_as_the_limit_permits(bench: Bench) -> None:
    bench.github.make_jobs = _gate_jobs({
        "failure": lefthook_log(("lint", "passed", 2.0), ("test", "failed", 30.5)),
        "success": lefthook_log(("lint", "passed", 3.0), ("test", "passed", 29.5)),
    })  # fmt: skip
    bench.github.add(conclusion="success", created=day(1))  # newer, but it passed
    bench.github.add(conclusion="failure", created=day(2))
    # the allowance, seven day lists, two jobs and the failed job's log
    first = ok(collect_cmd(since_days=7, requests=11))
    source = first["sources"][0]
    assert source["status"] == "partly" and source["why"].startswith("requests")
    assert source["reached"]["failed_summaries_left"] == 0
    assert source["reached"]["passed_summaries_left"] == 1
    assert bench.github.asked("logs") and len(bench.github.asked("logs")) == 1
    data = ok(report_cmd(days=7, by="check"))
    lint = by_check(data)["beds.yml / gate / Quality gate / lint"]
    assert (lint["passed"], lint["timed"]) == (2, 1), "a passed step's commands passed"
    assert data["coverage"]["commands_share"] == 0.5  # noqa: PLR2004
    ok(collect_cmd(since_days=7))
    assert len(bench.github.asked("logs")) == 2  # noqa: PLR2004
    again = ok(collect_cmd(since_days=7))
    assert again["sources"][0]["added"] == 0 and len(bench.github.asked("logs")) == 2  # noqa: PLR2004


def test_a_summary_that_cannot_be_read_is_said_and_never_guessed(bench: Bench) -> None:
    bench.github.make_jobs = _gate_jobs({"failure": f"{STAMP} Error: {CANARY}\n"})
    bench.github.add(conclusion="failure", created=day(2))
    bench.github.make_jobs = _gate_jobs({})  # no log: GitHub no longer has it
    bench.github.add(conclusion="failure", created=day(3))
    ok(collect_cmd(since_days=7))
    data = ok(report_cmd(days=7, by="check"))
    test = by_check(data)["beds.yml / gate / Quality gate / test"]
    assert (test["runs"], test["failed"], test["result_unknown"], test["quiet"]) == (0, 0, 2, False)
    assert data["coverage"]["summaries_unreadable"] == {"log-gone": 1, "no-summary": 1}
    assert data["coverage"]["commands_share"] == 0.0
    lines, _ = record.parse_lines(record_bytes(bench))
    statuses = sorted(entry[2] for line in lines if line["kind"] == "group"
                      for entry in line["steps"])  # fmt: skip
    assert statuses == ["log-gone", "no-summary"]


def test_no_line_of_a_planted_log_reaches_the_record_or_the_shared_copy(bench: Bench) -> None:
    planted = lefthook_log(
        ("lint", "passed", 2.0),
        ("test", "failed", 30.5),
        (f"{CANARY}-command", "failed", 1.0),
        (CANARY, "passed", 1.0),
    )
    bench.github.make_jobs = _gate_jobs({"failure": planted})
    bench.on("bench", shared=True)
    bench.github.add(conclusion="failure", created=day(2))
    ok(collect_cmd(since_days=7))
    assert bench.github.asked("logs"), "the planted log was read"
    lines, _ = record.parse_lines(record_bytes(bench))
    (group,) = [line for line in lines if line["kind"] == "group"]
    assert group["steps"] == [["gate", "Quality gate", "read", 2,
                               [["lint", "passed", 2.0], ["test", "failed", 30.5]]]]  # fmt: skip
    for path in [bench.folder() / record.RECORD_FILE, *bench.shared.rglob("*")]:
        if path.is_file():
            text = path.read_bytes()
            assert CANARY.encode() not in text, path
            assert b"secret.ts" not in text and b"exit code" not in text, path


def test_summaries_are_matched_to_the_group_steps_that_ran_one_for_one() -> None:
    one = lefthook_log(("lint", "passed", 1.0))
    reads = summary.read_steps(one + one, [("lint",)])
    assert [r.status for r in reads] == ["mismatch"]
    reads = summary.read_steps(one + one, [("lint",), ("lint", "test")])
    assert [r.status for r in reads] == ["read", "read"]
    assert summary.read_steps("no summary\n", [("lint",)])[0].status == "no-summary"
    coloured = f"{STAMP} \x1b[1msummary: (done in 1.00 seconds)\x1b[0m\n{STAMP} 🥊 lint\n"
    assert summary.summaries(coloured) == [[("lint", "failed", None)]]


# ── Inputs ──────────────────────────────────────────────────────────────────


def test_a_check_that_is_not_known_is_refused_with_the_closest_and_the_number_known(
    bench: Bench,
) -> None:
    error = refused(report_cmd(by="check", check="beds.yml / test / pnpm tset:beds"),
                    "INVALID_INPUT")  # fmt: skip
    assert "beds.yml / test / pnpm test:beds" in error.suggestion
    assert "checks are known" in error.suggestion
    # a known check before anything is collected: not refused as unknown
    refused(report_cmd(by="check", check="beds.yml / test / pnpm test:beds"), "NOT_COLLECTED")


@pytest.mark.parametrize(
    ("inputs", "named"),
    [
        ({"by": "workflow", "check": "x"}, "filter by where, workflow"),
        ({"by": "workflow", "finding_class": "parity"}, "where"),
        ({"by": "check", "area": "packages/beds"}, "where, workflow, check"),
        ({"by": "check", "due": True}, "goes with by decision"),
        ({"by": "check", "pull_request": 7}, "goes with by class"),
    ],
)
def test_a_filter_that_does_not_go_with_by_is_refused_with_those_that_do(
    bench: Bench, inputs: dict, named: str
) -> None:
    error = refused(report_cmd(**inputs), "INVALID_INPUT")
    assert named in error.suggestion


def test_a_known_check_never_observed_is_listed_with_why_never_as_zeros(bench: Bench) -> None:
    bench.github.make_jobs = _beds_jobs
    bench.github.add(workflow="beds")
    ok(collect_cmd(since_days=7))
    data = ok(
        report_cmd(days=7, by="check", check="shed.yml / desktop (linux) / pnpm test:desktop")
    )
    assert data["rows"] == []
    (entry,) = data["not_observed"]
    assert "no run of shed.yml" in entry["why"]
    assert data["coverage"]["known"]["checks"] > 0


# ── The verdict ─────────────────────────────────────────────────────────────


def test_a_named_verdict_keeps_its_row_and_is_left_out_of_the_totals(bench: Bench) -> None:
    for head in (1, 2):
        beds = "failure" if head == 1 else "success"
        bench.github.add(workflow="beds", event="merge_group", conclusion=beds, head=head)
        bench.github.add(workflow="verdict", event="merge_group", conclusion="failure", head=head)
    ok(collect_cmd(since_days=7))
    counted = ok(report_cmd(days=7, where="merge_group"))["totals"]
    assert (counted["runs"], counted["failed"], counted["groups_failed"]) == (4, 3, 2)
    assert "verdicts_left_out" not in counted
    (bench.checkout / "botcore.toml").write_text(
        '[gate_outcome]\nverdict_workflows = ["Verdict"]\n', encoding="utf-8"
    )
    data = ok(report_cmd(days=7, where="merge_group"))
    totals = data["totals"]
    assert (totals["runs"], totals["failed"], totals["groups"], totals["groups_failed"]) == (
        2,
        1,
        2,
        1,
    )
    assert totals["verdicts_left_out"] == ["verdict.yml"]
    verdict = next(row for row in data["rows"] if row["file"] == "verdict.yml")
    assert verdict["verdict"] is True and verdict["failed"] == 2  # noqa: PLR2004
    assert "verdict" not in next(row for row in data["rows"] if row["file"] == "beds.yml")
    by_check_totals = ok(report_cmd(days=7, by="check", where="merge_group"))["totals"]
    assert by_check_totals["runs"] == 2  # noqa: PLR2004


def test_a_verdict_setting_this_botcore_cannot_read_is_warned_of(bench: Bench) -> None:
    bench.github.add()
    ok(collect_cmd(since_days=7))
    (bench.checkout / "botcore.toml").write_text(
        '[gate_outcome]\nverdict_workflows = "ci-ok.yml"\n', encoding="utf-8"
    )
    warnings = ok(report_cmd(days=7))["warnings"]
    assert any("[gate_outcome] is not valid" in warning for warning in warnings)
    (bench.checkout / "botcore.toml").write_text(
        '[gate_outcome]\nverdict_workflows = ["nowhere.yml"]\n', encoding="utf-8"
    )
    warnings = ok(report_cmd(days=7))["warnings"]
    assert any("nowhere.yml named in botcore.toml is not in the record" in w for w in warnings)


def test_the_command_line_takes_the_check_and_the_plans_filters(bench: Bench) -> None:
    from click.testing import CliRunner

    from botcore.cli import cli

    runner = CliRunner()
    helped = runner.invoke(cli, ["gate-outcome-report", "--help"])
    for word in ("--check", "--area", "--finding-class", "--decision", "--pull-request", "--due"):
        assert word in helped.output
    refusal = runner.invoke(cli, ["gate-outcome-report", "--json", "--by", "check",
                                  "--area", "packages/beds"])  # fmt: skip
    assert json.loads(refusal.output)["error"]["code"] == "INVALID_INPUT"
    assert NOW  # the shared clock of the bench


def test_from_a_folder_with_its_own_project_the_repositorys_checks_and_setting_are_read(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    for head in (1, 2):
        bench.github.add(workflow="verdict", event="merge_group", conclusion="failure", head=head)
    bench.github.add(workflow="beds", event="merge_group", conclusion="success", head=1)
    ok(collect_cmd(since_days=7))
    (bench.checkout / "botcore.toml").write_text(
        '[gate_outcome]\nverdict_workflows = ["verdict.yml"]\n', encoding="utf-8"
    )
    inner = bench.checkout / "endpoints" / "tool"
    inner.mkdir(parents=True)
    (inner / "pyproject.toml").write_text('[project]\nname = "tool"\n', encoding="utf-8")
    monkeypatch.chdir(inner)
    assert checks.read_known(inner).ids({}) == checks.read_known(bench.checkout).ids({})
    totals = ok(report_cmd(days=7, where="merge_group"))["totals"]
    assert totals["verdicts_left_out"] == ["verdict.yml"] and totals["groups_failed"] == 0


def test_step_names_that_carry_matrix_values_are_named_for_each_leg(bench: Bench) -> None:
    msrv = (
        "name: Rust\non: [pull_request]\njobs:\n  msrv:\n    name: MSRV ${{ matrix.rust }}\n"
        "    strategy:\n      matrix:\n        include:\n          - rust: '1.85'\n"
        "          - rust: '1.88'\n    runs-on: ubuntu-latest\n    steps:\n"
        "      - name: Check MSRV (${{ matrix.rust }})\n        run: cargo check\n"
    )
    bench.tip({".github/workflows/rust.yml": msrv})
    known = checks.read_known(bench.checkout)
    ids = known.ids({})
    assert "rust.yml / MSRV 1.85 / Check MSRV (1.85)" in ids
    assert "rust.yml / MSRV 1.88 / Check MSRV (1.88)" in ids
    assert not any("${{" in identifier for identifier in ids if identifier.startswith("rust.yml"))
    job = known.job("rust.yml", "MSRV 1.88")
    assert job is not None and job.step("Check MSRV (1.88)") is not None


def test_a_skipped_job_whose_matrix_an_expression_decides_is_not_a_leg(bench: Bench) -> None:
    umbel = (
        "name: Umbel\non: [pull_request]\njobs:\n  check:\n    name: Umbel (fmt)\n"
        "    strategy:\n      matrix:\n        os: ${{ fromJSON('[\"ubuntu-latest\"]') }}\n"
        "    runs-on: ${{ matrix.os }}\n    steps:\n      - run: cargo fmt --check\n"
    )
    bench.tip({".github/workflows/umbel.yml": umbel})
    known = checks.read_known(bench.checkout)
    seen = {"umbel.yml": {"Umbel (fmt)", "Umbel (fmt) (ubuntu-latest)"}}
    ids = [i for i in known.ids(seen) if i.startswith("umbel.yml")]
    assert ids == ["umbel.yml / Umbel (fmt) (ubuntu-latest) / cargo fmt --check"]
    assert [i for i in known.ids({}) if i.startswith("umbel.yml")] == [
        "umbel.yml / Umbel (fmt) / cargo fmt --check"
    ], "until a leg is seen, the job is listed once under its name"


def test_an_earlier_attempt_that_ran_nothing_is_no_failure_to_follow(bench: Bench) -> None:
    bench.github.make_jobs = _beds_jobs
    bench.github.add(conclusion="success", earlier=("action_required",))
    ok(collect_cmd(since_days=7))
    rows = by_check(ok(report_cmd(days=7, by="check")))
    lint = rows["beds.yml / test / pnpm lint:beds"]
    assert lint["passed_on_later_attempt"] == 0 and lint["passed_after"]["unknown"] == 0


def test_a_rebuild_keeps_a_summary_read_before_when_the_log_has_expired(bench: Bench) -> None:
    bench.github.make_jobs = _gate_jobs({"failure": lefthook_log(("test", "failed", 30.5))})
    bench.github.add(conclusion="failure", created=day(2))
    ok(collect_cmd(since_days=7))
    bench.github.logs.clear()  # GitHub has expired the log
    rebuilt = ok(collect_cmd(since_days=7, rebuild=True))
    assert rebuilt["sources"][0]["status"] == "read"
    assert len(bench.github.asked("logs")) == 2, "asked once again, not on every collection"  # noqa: PLR2004
    again = ok(collect_cmd(since_days=7))
    assert len(bench.github.asked("logs")) == 2 and again["sources"][0]["status"] == "read"  # noqa: PLR2004
    test = by_check(ok(report_cmd(days=7, by="check")))["beds.yml / gate / Quality gate / test"]
    assert (test["failed"], test["result_unknown"]) == (1, 0)


def test_a_summary_start_with_no_command_line_is_no_summary() -> None:
    log = f"{STAMP} summary: (done in 1.00 seconds)\n{STAMP} ⚡ lint (1.00 seconds)\n"
    assert summary.summaries(log) == []
    assert summary.read_steps(log, [("lint",)])[0].status == "no-summary"


def test_a_verdict_is_said_to_be_left_out_only_where_it_was_in_scope(bench: Bench) -> None:
    bench.github.add(workflow="verdict", event="merge_group", conclusion="failure", head=1)
    bench.github.add(workflow="beds", event="merge_group", conclusion="success", head=1)
    ok(collect_cmd(since_days=7))
    (bench.checkout / "botcore.toml").write_text(
        '[gate_outcome]\nverdict_workflows = ["verdict.yml"]\n', encoding="utf-8"
    )
    assert ok(report_cmd(days=7))["totals"]["verdicts_left_out"] == ["verdict.yml"]
    assert "verdicts_left_out" not in ok(report_cmd(days=7, workflow="beds.yml"))["totals"]


def test_a_leg_an_expression_decides_never_claims_another_jobs_own_name(bench: Bench) -> None:
    cpp = (
        "name: C++\non: [pull_request]\njobs:\n  build:\n    name: C++ (${{ matrix.name }})\n"
        "    strategy:\n      matrix:\n        include: ${{ fromJSON(vars.LEGS) }}\n"
        "    runs-on: ubuntu-latest\n    steps:\n      - name: Build\n        run: cmake --build\n"
        "  format:\n    name: C++ (clang-format)\n    runs-on: ubuntu-latest\n    steps:\n"
        "      - name: Check formatting\n        run: clang-format --dry-run\n"
    )
    bench.tip({".github/workflows/cpp.yml": cpp})
    known = checks.read_known(bench.checkout)
    ids = known.ids({"cpp.yml": {"C++ (gcc)", "C++ (clang-format)"}})
    assert "cpp.yml / C++ (gcc) / Build" in ids
    assert "cpp.yml / C++ (clang-format) / Check formatting" in ids
    assert "cpp.yml / C++ (clang-format) / Build" not in ids
    job = known.job("cpp.yml", "C++ (clang-format)")
    assert job is not None and job.template == "C++ (clang-format)"


def test_a_log_github_will_not_give_is_said_unreadable_and_the_collection_goes_on(
    bench: Bench,
) -> None:
    bench.github.make_jobs = _gate_jobs({"failure": lefthook_log(("test", "failed", 1.0))})
    bench.github.add(conclusion="failure", created=day(2))
    bench.github.fail["repos/bench-org/beds/actions/jobs/"] = github.Answer(
        403, None, "Forbidden (HTTP 403)"
    )
    collected = ok(collect_cmd(since_days=7))
    assert collected["sources"][0]["status"] == "read"
    data = ok(report_cmd(days=7, by="check"))
    assert data["coverage"]["summaries_unreadable"] == {"unreadable": 1}
    assert by_check(data)["beds.yml / gate / Quality gate / test"]["result_unknown"] == 1


def test_a_group_command_whose_name_a_line_cannot_hold_is_dropped_not_fatal() -> None:
    log = lefthook_log(("lint", "passed", 1.0), ("tests/unit", "failed", 2.0))
    (read,) = summary.read_steps(log, [("lint", "tests/unit")])
    assert (read.status, read.commands, read.dropped) == ("read", [["lint", "passed", 1.0]], 1)


def test_by_check_with_ci_absent_gives_no_rows_and_says_why(bench: Bench) -> None:
    bench.github.add(created=day(0, hour=0, minute=1) if NOW.hour else NOW)
    ok(collect_cmd(since_days=1))  # today only
    data = ok(report_cmd(days=1, ending_days_ago=4, by="check"))
    assert data["rows"] == [] and data["totals"] is None
    assert data["coverage"]["sources"]["ci"] == "absent"
    assert data["not_observed"] and all("ci is absent" in e["why"] for e in data["not_observed"])
    assert any(w.startswith("ci is absent") for w in data["warnings"])
    assert "not_observed" not in ok(report_cmd(days=1, ending_days_ago=4))


def test_a_botcore_toml_that_does_not_parse_is_warned_of(bench: Bench) -> None:
    bench.github.add()
    ok(collect_cmd(since_days=7))
    (bench.checkout / "botcore.toml").write_text("[gate_outcome\n", encoding="utf-8")
    warnings = ok(report_cmd(days=7))["warnings"]
    assert any("botcore.toml does not parse" in warning for warning in warnings)


def test_an_allowance_answer_that_cannot_be_used_is_not_put_on_a_log(bench: Bench) -> None:
    bench.github.make_jobs = _gate_jobs({"failure": lefthook_log(("test", "failed", 1.0))})
    bench.github.add(conclusion="failure", created=day(2))
    calls = 0
    answer = bench.github.call

    def allowance_fails_later(endpoint: str) -> github.Answer:
        nonlocal calls
        calls += 1
        if endpoint == "rate_limit" and calls > 1:
            return github.Answer(200, {"resources": {}})
        return answer(endpoint)

    bench.monkeypatch.setattr(github, "call", allowance_fails_later)
    bench.monkeypatch.setattr(github, "CHECK_EVERY", 9)  # the check falls on the log read
    ok(collect_cmd(since_days=7))
    lines, _ = record.parse_lines(record_bytes(bench))
    assert not [line for line in lines if line["kind"] == "group"], "no log was asked for"


def test_a_step_whose_name_the_file_cannot_evaluate_says_so(bench: Bench) -> None:
    named = (
        "name: Named\non: [pull_request]\njobs:\n  run:\n    runs-on: ubuntu-latest\n"
        "    steps:\n      - name: Deploy ${{ inputs.target }}\n        run: ./deploy\n"
    )
    bench.tip({".github/workflows/named.yml": named})
    bench.github.add()
    ok(collect_cmd(since_days=7))
    data = ok(report_cmd(days=7, by="check", workflow="named.yml"))
    (entry,) = data["not_observed"]
    assert "cannot evaluate" in entry["why"]
