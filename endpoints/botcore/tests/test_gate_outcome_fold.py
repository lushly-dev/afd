"""The fold: days older than 180 days put in a few lines, and the reports' figures unchanged.

Every answer is invented, as in test_gate_outcome.py, whose fake GitHub and bench these tests
use, with the workflows and hook group of test_gate_outcome_checks.py at the default branch's
tip.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from botcore.commands.gate_outcome import fold, record, report
from botcore.commands.gate_outcome import gate_outcome_collect as collect_cmd
from botcore.commands.gate_outcome import gate_outcome_report as report_cmd
from tests.test_gate_outcome import CANARY, Bench, day, ok
from tests.test_gate_outcome_checks import FILES, job, lefthook_log

OLD = (200, 201, 203)  # days ago: folded
RECENT = 10  # days ago: not folded
LOGS = {
    "failure": lefthook_log(("boundaries", "passed", 1.25), ("lint", "passed", 2.0),
                            ("test", "failed", 30.5)),
    "success": lefthook_log(("boundaries", "passed", 1.75), ("lint", "passed", 3.0),
                            ("test", "passed", 29.5)),
}  # fmt: skip


def jobs(workflow: str, conclusion: str | None, created: datetime, *_args: object) -> list:
    """Beds' two jobs: a test job whose lint fails with the run, and a gate job whose hook group
    step ends as the run did, with Lefthook's summary in its log."""
    if workflow != "beds":
        return [job("verdict", [("Run node verdict.mjs", "failure" if conclusion == "failure"
                                  else "success")], created)]  # fmt: skip
    end = "failure" if conclusion == "failure" else "success"
    test = "skipped" if end == "failure" else "success"
    return [
        job("test", [("Run actions/checkout@v9", "success"), ("Run pnpm lint:beds", end),
                     ("Run pnpm test:beds", test)], created),
        job("gate", [("Quality gate", end), ("Upload coverage", "skipped")], created,
            log=LOGS[end]),
    ]  # fmt: skip


def plant(bench: Bench, days_ago: int, head: int) -> None:
    """One day's runs: every way a run ends, a pass after a failure, the queue, the verdict,
    an event the report does not give rows for, and a run still going."""
    gh = bench.github
    gh.add(conclusion="success", created=day(days_ago, 1))
    gh.add(conclusion="success", created=day(days_ago, 2), minutes=30)
    gh.add(conclusion="failure", created=day(days_ago, 3))
    gh.add(conclusion="success", created=day(days_ago, 4), earlier=("failure",))
    gh.add(conclusion="cancelled", created=day(days_ago, 5))
    gh.add(conclusion="action_required", created=day(days_ago, 6))
    gh.add(event="merge_group", conclusion="success", created=day(days_ago, 7), head=head)
    gh.add(event="merge_group", conclusion="failure", created=day(days_ago, 8), head=head + 1)
    gh.add(workflow="verdict", event="merge_group", conclusion="failure",
           created=day(days_ago, 8, 5), head=head + 1)  # fmt: skip
    gh.add(workflow="pages", event="dynamic", created=day(days_ago, 9))
    gh.add(status="in_progress", conclusion=None, created=day(days_ago, 10))


@pytest.fixture
def bench(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Bench:
    bench = Bench(tmp_path, monkeypatch)
    bench.tip({**FILES, "botcore.toml": '[gate_outcome]\nverdict_workflows = ["verdict.yml"]\n'})
    bench.github.make_jobs = jobs
    for n, days_ago in enumerate((*OLD, RECENT)):
        plant(bench, days_ago, head=100 + 10 * n)
    return bench


ASKED = [
    {"by": "workflow"},
    {"by": "workflow", "where": "merge_group"},
    {"by": "workflow", "workflow": "Beds"},
    {"by": "check"},
    {"by": "check", "where": "pull_request", "sort": "failed"},
    {"by": "check", "check": "beds.yml / gate / Quality gate / test"},
    {"by": "check", "check": "beds.yml / test / pnpm lint:beds", "where": "pull_request"},
    {"by": "check", "workflow": "verdict.yml"},
]
WINDOWS = [(10, 195), (3, 200), (220, 0)]  # (days, ending_days_ago): folded, both


def reports() -> list[dict]:
    """Every report the fold must leave as it was, without what says which days are folded,
    and what says when each machine last collected or listed, which a later collection moves."""
    found = []
    for days, ago in WINDOWS:
        for asked in ASKED:
            data = ok(report_cmd(days=days, ending_days_ago=ago, **asked))
            data["coverage"].pop("folded")
            data["coverage"].pop("collected")
            data["coverage"].pop("listed_until")
            data.pop("machines")
            data["warnings"] = [w for w in data["warnings"] if "last collected" not in w]
            found.append(data)
    return found


def collect_unfolded(bench: Bench, monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """Collect a year, unfolded, and give the reports as they stand."""
    monkeypatch.setattr(fold, "FOLD_AFTER_DAYS", 400)
    data = ok(collect_cmd(since_days=365, requests=5000))
    assert "folded" not in data and data["sources"][0]["status"] == "read"
    before = reports()
    monkeypatch.setattr(fold, "FOLD_AFTER_DAYS", 180)
    return before


def kinds(bench: Bench, machine: str = "bench") -> dict[str, int]:
    lines, unreadable = record.parse_lines(
        (bench.folder(machine) / record.RECORD_FILE).read_bytes()
    )
    assert unreadable == 0
    counted: dict[str, int] = {}
    for line in lines:
        counted[line["kind"]] = counted.get(line["kind"], 0) + 1
    return counted


def old_runs(bench: Bench, machine: str = "bench") -> list[dict]:
    lines, _ = record.parse_lines((bench.folder(machine) / record.RECORD_FILE).read_bytes())
    first_kept = fold.cutoff(record.now())
    return [
        line for line in lines
        if line["kind"] == "run" and record.day_of(line["created"]) < first_kept
    ]  # fmt: skip


def test_a_fold_at_180_days_leaves_every_reports_figures_as_they_were(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = collect_unfolded(bench, monkeypatch)
    assert old_runs(bench), "the old days are on record as runs before the fold"
    size = (bench.folder() / record.RECORD_FILE).stat().st_size
    data = ok(collect_cmd(since_days=1))
    days = sorted(day(n).date().isoformat() for n in OLD)
    assert data["folded"]["folded"] == [{"first": days[0], "last": days[0]},
                                         {"first": days[1], "last": days[2]}]  # fmt: skip
    assert data["folded"]["bytes_before"] == size
    assert not old_runs(bench)
    counted = kinds(bench)
    assert counted["folded-workflow"] and counted["folded-check"] and counted["shape"]
    assert reports() == before
    folded = ok(report_cmd(days=10, ending_days_ago=195))["coverage"]["folded"]
    assert folded == data["folded"]["folded"]
    recent = ok(report_cmd(days=7, ending_days_ago=7))["coverage"]["folded"]
    assert recent == []
    # nothing more to fold, and the record is not written again
    written = (bench.folder() / record.RECORD_FILE).read_bytes()
    assert "folded" not in ok(collect_cmd(since_days=1))
    assert (bench.folder() / record.RECORD_FILE).read_bytes().startswith(written)


def test_the_fold_keeps_what_it_cannot_read_and_what_it_does_not_fold(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    collect_unfolded(bench, monkeypatch)
    path = bench.folder() / record.RECORD_FILE
    strange = [
        b'{"kind": "finding", "id": "finding:1", "v": 9, "at": "2026-01-01T00:00:00Z"}\n',
        b'{"id": "run:1\n',
        b"not json at all\n",
    ]
    with path.open("ab") as handle:
        handle.write(b"".join(strange))
    lines_before, _ = record.parse_lines(path.read_bytes())
    shapes = sorted(line["id"] for line in lines_before if line["kind"] == "shape")
    first_kept = fold.cutoff(record.now())
    recent_runs = {
        line["run"] for line in lines_before
        if line["kind"] == "run" and record.day_of(line["created"]) >= first_kept
    }  # fmt: skip
    recent = {
        line["id"] for line in lines_before
        if line["kind"] in ("run", "steps", "group") and line["run"] in recent_runs
    }  # fmt: skip
    assert recent and len(recent_runs) < len({
        line["run"] for line in lines_before if line["kind"] == "run"
    })  # fmt: skip
    ok(collect_cmd(since_days=1))
    data = path.read_bytes()
    for text in strange:
        assert data.count(text) == 1, text
    lines_after, unreadable = record.parse_lines(data)
    assert unreadable == 3  # noqa: PLR2004 - kept as they were
    assert sorted(line["id"] for line in lines_after if line["kind"] == "shape") == shapes
    kept = {line["id"] for line in lines_after}
    assert recent <= kept
    assert not {line["run"] for line in lines_after if "run" in line} - recent_runs


class PowerCut(BaseException):
    """The machine stops: nothing after it runs."""


def test_a_fold_cut_short_between_writing_and_replacing_leaves_a_readable_record(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = collect_unfolded(bench, monkeypatch)
    path = bench.folder() / record.RECORD_FILE
    whole = path.read_bytes()
    cut = [True]

    def power_cut(source: Path, target: Path) -> None:
        if cut[0]:  # the process ends here, the new file written and not moved
            raise PowerCut
        os.replace(source, target)

    monkeypatch.setattr(fold, "replace", power_cut)
    with pytest.raises(PowerCut):
        ok(collect_cmd(since_days=1))
    assert path.read_bytes() == whole, "the record is the old one, whole"
    left = list(path.parent.glob(f"{record.RECORD_FILE}.*.tmp"))
    assert len(left) == 1
    assert record.parse_lines(path.read_bytes())[1] == 0
    assert reports() == before
    cut[0] = False
    assert ok(collect_cmd(since_days=1))["folded"]["folded"]
    assert not list(path.parent.glob(f"{record.RECORD_FILE}.*.tmp")), "what it left is gone"
    assert reports() == before


def test_a_fold_that_cannot_write_leaves_the_record_and_the_collection_stands(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = collect_unfolded(bench, monkeypatch)
    whole = (bench.folder() / record.RECORD_FILE).read_bytes()

    def full(_source: Path, _target: Path) -> None:
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(fold, "replace", full)
    data = ok(collect_cmd(since_days=1))
    assert data["folded"]["error"].startswith("the folded record could not be written")
    assert (bench.folder() / record.RECORD_FILE).read_bytes() == whole
    assert not list(bench.folder().glob("*.tmp"))
    assert reports() == before


def test_a_rebuild_after_a_fold_keeps_the_folded_days(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = collect_unfolded(bench, monkeypatch)
    ok(collect_cmd(since_days=1))
    # GitHub no longer has the old days' runs
    for run_id, run in list(bench.github.runs.items()):
        if record.day_of(run["created_at"]) < fold.cutoff(record.now()):
            del bench.github.runs[run_id]
    calls = len(bench.github.calls)
    data = ok(collect_cmd(since_days=365, rebuild=True, requests=5000))
    assert data["sources"][0]["status"] == "read"
    listed = [c for c in bench.github.calls[calls:] if "/actions/runs?" in c]
    for days_ago in OLD:
        assert not [c for c in listed if day(days_ago).strftime("%Y-%m-%d") in c], (
            "a folded day is not asked for again"
        )
    assert reports() == before
    assert kinds(bench)["folded-workflow"]


def test_the_record_holds_no_output_titles_branches_or_contents_after_a_fold(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    bench.on("bench", shared=True)
    collect_unfolded(bench, monkeypatch)
    assert ok(collect_cmd(since_days=1))["folded"]["folded"]
    copy = bench.shared / "bench" / record.SHARED_FOLDER / "bench-org" / "beds"
    assert b"folded-check" in (copy / record.RECORD_FILE).read_bytes(), "the copy is folded"
    for path in [*bench.folder().rglob("*"), *bench.shared.rglob("*")]:
        if path.is_file():
            data = path.read_bytes()
            assert CANARY.encode() not in data, path
            assert b"example.com" not in data, path
            assert b"\r\n" not in data, path


def test_another_machines_fold_is_read_once_and_taken_into_this_record(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    # the second machine collects the year first, unfolded, and shares it
    bench.on("potting-shed", shared=True)
    collect_unfolded(bench, monkeypatch)
    # this machine collects too, then folds and shares
    bench.on("bench", shared=True)
    monkeypatch.setattr(fold, "FOLD_AFTER_DAYS", 400)
    ok(collect_cmd(since_days=365, requests=5000))
    monkeypatch.setattr(fold, "FOLD_AFTER_DAYS", 180)
    before = reports()
    assert ok(collect_cmd(since_days=1))["folded"]["folded"]
    # the other machine's copy still holds the old days' runs: they are not counted twice
    assert old_runs(bench, "potting-shed")
    assert reports() == before
    bench.on("potting-shed", shared=True)
    assert reports() == before
    data = ok(collect_cmd(since_days=1))
    assert data["folded"]["folded"] == [], "it folded nothing itself"
    assert data["folded"]["lines_after"] < data["folded"]["lines_before"]
    assert not old_runs(bench, "potting-shed")
    assert kinds(bench, "potting-shed")["folded-check"], "the day is kept here too"
    assert reports() == before


def test_a_folded_line_with_a_field_of_the_wrong_type_is_not_read() -> None:
    line = {
        "id": fold.workflow_id("2026-01-02", ".github/workflows/beds.yml", "push"),
        "kind": "folded-workflow", "v": record.RULES, "at": "2026-07-01T00:00:00.000Z",
        "day": "2026-01-02", "workflow": ".github/workflows/beds.yml", "event": "push",
        "name": "Beds", "named_at": "2026-01-02T01:00:00Z",
        "counts": {"passed": 1, "failed": 0, "cancelled": 0, "action_required": 0,
                   "skipped": 0, "other": 0},
        "later": {"failed": 0, "cancelled": 0, "unknown": 0}, "wall": 60.0,
        "heads": [], "failed_heads": [], "going": [], "left_out": 0, "ran": 1,
        "with_steps": 1, "unreadable_steps": 0,
        "checks": {"ran": 1, "read": 1, "jobs_seen": ["test"], "jobs_skipped": [],
                   "summaries": {"read": 1}},
    }  # fmt: skip
    assert record.checked(line) is not None
    assert record.checked({**line, "note": CANARY}) == record.checked(line), "dropped"
    for broken in (
        {"day": "2026-13-02"},
        {"heads": [CANARY]},
        {"counts": {**line["counts"], "passed": -1}},
        {"checks": {**line["checks"], "summaries": {CANARY: 1}}},
        {"id": fold.workflow_id("2026-01-03", ".github/workflows/beds.yml", "push")},
    ):
        assert record.checked({**line, **broken}) is None, broken
    assert json.dumps(record.checked(line))
    later = datetime.fromisoformat("2026-07-01T00:00:00+00:00") + timedelta(days=1)
    assert fold.cutoff(later) == "2026-01-03", "2026-01-02 ended 180 days before: it folds"


# ── What holds a day back ───────────────────────────────────────────────────


def test_a_day_not_wholly_collected_is_held_back_until_it_is(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = collect_unfolded(bench, monkeypatch)
    folder = bench.folder()
    unread, unlisted = day(OLD[0]).date().isoformat(), day(OLD[1]).date().isoformat()
    # one attempt of the first day has no steps on record, as a collection cut short leaves it
    lines = (folder / record.RECORD_FILE).read_bytes().split(b"\n")
    runs = {
        line["run"]: line for line, _ in (record.parse_lines(text) for text in lines) if line
        for line in line if line["kind"] == "run"
    }  # fmt: skip
    dropped = next(
        run for run, line in runs.items()
        if record.day_of(line["created"]) == unread and line["conclusion"] == "failure"
    )  # fmt: skip
    kept = [text for text in lines if f'"id":"steps:{dropped}:'.encode() not in text]
    assert len(kept) == len(lines) - 1
    (folder / record.RECORD_FILE).write_bytes(b"\n".join(kept))
    # and the second day was not listed whole
    state = record.load_state(folder)
    state["lists"] = {
        key: entry for key, entry in state["lists"].items() if not key.startswith(unlisted)
    }
    record.save_state(folder, state)
    data = ok(collect_cmd(since_days=1))["folded"]
    held = {entry["why"]: entry["days"] for entry in data["not_folded"]}
    assert all("gate-outcome-collect" in entry["suggestion"] for entry in data["not_folded"])
    assert held == {
        "it is not wholly collected: an attempt's steps are not read yet": [
            {"first": unread, "last": unread}],
        "it is not wholly collected: not every moment of it was listed": [
            {"first": unlisted, "last": unlisted}],
    }  # fmt: skip
    folded_now = {day(OLD[2]).date().isoformat()}
    assert {r["first"] for r in data["folded"]} == folded_now
    # the next collection over the year reads what is missing, and the days fold then
    data = ok(collect_cmd(since_days=365, requests=5000))["folded"]
    assert data["folded"] == report.day_ranges({unread, unlisted})
    assert "not_folded" not in data
    assert reports() == before


def test_nothing_is_folded_while_another_machines_copy_is_not_read(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    bench.on("potting-shed", shared=True)
    collect_unfolded(bench, monkeypatch)
    copy = bench.shared / "potting-shed" / record.SHARED_FOLDER / "bench-org" / "beds"
    with (copy / record.RECORD_FILE).open("ab") as handle:
        handle.write(b'{"kind":"run"}\n')  # a sync part way through
    bench.on("bench", shared=True)
    monkeypatch.setattr(fold, "FOLD_AFTER_DAYS", 400)
    ok(collect_cmd(since_days=365, requests=5000))
    monkeypatch.setattr(fold, "FOLD_AFTER_DAYS", 180)
    data = ok(collect_cmd(since_days=1))["folded"]
    assert data["folded"] == []
    (entry,) = data["not_folded"]
    assert "the shared copy of potting-shed is not whole" in entry["why"]
    assert old_runs(bench), "this machine's runs of those days are kept"


def test_a_day_a_line_of_which_cannot_be_made_is_not_folded(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = collect_unfolded(bench, monkeypatch)
    monkeypatch.setattr(fold, "_CHECK_MAX", 10)  # every check is now longer than a line allows
    data = ok(collect_cmd(since_days=1))["folded"]
    assert data["folded"] == []
    (entry,) = data["not_folded"]
    assert entry["why"] == "a line of it could not be made as the record reads it"
    assert old_runs(bench) and reports() == before


def test_a_workflow_seen_only_on_folded_days_is_still_known(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    for days_ago in OLD:
        bench.github.add(workflow="shed", created=day(days_ago, 11))
    before = collect_unfolded(bench, monkeypatch)
    asked = {"days": 10, "ending_days_ago": 195, "workflow": "Shed"}
    shed = ok(report_cmd(**asked))
    ok(collect_cmd(since_days=1))
    assert reports() == before
    after = ok(report_cmd(**asked))
    assert after["rows"] == shed["rows"] and after["rows"][0]["runs"] == 3  # noqa: PLR2004
    assert ok(report_cmd(**asked, by="check"))["rows"]


def test_a_machine_with_no_record_of_its_own_yet_folds_into_a_new_one(
    bench: Bench, monkeypatch: pytest.MonkeyPatch
) -> None:
    bench.on("potting-shed", shared=True)
    before = collect_unfolded(bench, monkeypatch)
    bench.on("bench", shared=True)  # the span up to now was listed within the hour: no listing
    assert not bench.folder().exists()
    data = ok(collect_cmd(since_days=1))
    assert data["folded"]["folded"] and "error" not in data["folded"]
    assert kinds(bench)["folded-workflow"]
    assert reports() == before
