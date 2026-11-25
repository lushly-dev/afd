"""The hourly job's gate outcome step: the checkouts a machine names, the fetch into a ref of
its own, and a step that never stops the job's other steps or is stopped by them.

Every answer is invented, as in test_gate_outcome.py, whose fake GitHub and bench these tests
use. `origin` is a bare repository on disk whose path ends in the invented `owner/name`, so a
fetch reads it and GitHub's answers stay the fake's.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import threading
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from botcore.commands.disk import setup, steps
from botcore.commands.disk.lock import RunLock
from botcore.commands.disk.settings import MachineSettings, load_machine_settings
from botcore.commands.gate_outcome import checks, collect, hourly, record
from tests.test_gate_outcome import REPO, TODAY, Bench, day

GIT = ["-c", "user.name=Bench", "-c", "user.email=bench@example.invalid",
       "-c", "commit.gpgsign=false"]  # fmt: skip


def git(where: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(where), *GIT, *args], check=True, capture_output=True, text=True
    ).stdout.strip()


class Job:
    """The machine's settings, the job's state folder and a bench whose checkout has a real
    origin to fetch from."""

    def __init__(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        self.tmp, self.monkeypatch = tmp_path, monkeypatch
        self.bench = Bench(tmp_path, monkeypatch)
        monkeypatch.chdir(tmp_path)  # the step works on the checkouts named, not where it runs
        self.origin = tmp_path / "remote" / REPO.split("/")[0] / f"{REPO.split('/')[1]}.git"
        self.origin.parent.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(self.origin)],
                       check=True)  # fmt: skip
        checkout = self.bench.checkout
        git(checkout, "remote", "set-url", "origin", str(self.origin))
        git(checkout, "checkout", "-q", "-b", "main")
        (checkout / "README.md").write_text("beds\n", encoding="utf-8")
        git(checkout, "add", "-A")
        git(checkout, "commit", "-q", "-m", "first")
        git(checkout, "push", "-q", "origin", "main")
        git(checkout, "fetch", "-q", "origin")  # origin/main, as a clone has it
        self.state = tmp_path / "disk-state"
        monkeypatch.setenv("BOTCORE_DISK_STATE", str(self.state))
        monkeypatch.setenv("BOTCORE_DISK_T3_SETTINGS", "")
        self.settings = tmp_path / "disk.toml"
        self.write(checkouts=[str(checkout)], usage=False)
        monkeypatch.setenv("BOTCORE_DISK_SETTINGS", str(self.settings))

        async def reclaim(**_kwargs):
            now = setup.datetime.now(setup.UTC).isoformat(timespec="seconds")
            self.state.mkdir(parents=True, exist_ok=True)
            last = {"last_apply": {"at": now, "ok": True}}
            (self.state / "status.json").write_text(json.dumps(last))
            return SimpleNamespace(success=True, data={"still_low": []})

        import botcore.commands.disk.reclaim as reclaim_module

        monkeypatch.setattr(reclaim_module, "disk_reclaim", reclaim)
        monkeypatch.setattr(setup, "POLL_SECONDS", 0.01)
        monkeypatch.setattr(setup, "REACH", False)
        monkeypatch.setattr(setup, "consent_hint", lambda path: None)
        monkeypatch.setattr(setup, "_LIVE", None)

    def write(self, checkouts: list[str] | None = None, usage: bool = False) -> None:
        lines = ["caches = []", f"skill_usage_collect = {'true' if usage else 'false'}"]
        if checkouts is not None:
            lines.append(f"gate_outcome_checkouts = {json.dumps(checkouts)}")
        self.settings.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def run(self, own_process: bool = True) -> dict:
        result = asyncio.run(setup.disk_run(own_process=own_process))
        assert result.success, result.error
        return result.data

    def check(self) -> dict:
        return json.loads((self.state / "check.json").read_text())

    def status(self) -> dict:
        result = asyncio.run(setup.disk_status())
        assert result.success, result.error
        return result.data

    def land(self, message: str) -> str:
        """A commit lands on origin's default branch, from elsewhere."""
        other = self.tmp / f"elsewhere-{message}"
        subprocess.run(["git", "clone", "-q", str(self.origin), str(other)], check=True)
        (other / f"{message}.txt").write_text(message, encoding="utf-8")
        git(other, "add", "-A")
        git(other, "commit", "-q", "-m", message)
        git(other, "push", "-q", "origin", "HEAD:main")
        return git(other, "rev-parse", "HEAD")


@pytest.fixture
def job(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Job:
    return Job(tmp_path, monkeypatch)


def entry(data: dict) -> dict:
    (found,) = data["gate_outcome"]["checkouts"]
    return found


# ── The settings ────────────────────────────────────────────────────────────


def test_with_no_checkout_named_nothing_is_collected(
    job: Job, monkeypatch: pytest.MonkeyPatch
) -> None:
    def never(_checkouts: list[str]) -> dict:
        raise AssertionError("nothing is collected unless the machine names a checkout")

    monkeypatch.setattr(hourly, "collect_checkouts", never)
    job.write(checkouts=None)
    data = job.run()
    assert "gate_outcome" not in data and "gate_outcome" not in job.check()
    job.write(checkouts=[])
    assert "gate_outcome" not in job.run()
    status = job.status()
    assert status["gate_outcome"] is None
    assert not any("gate outcome" in w for w in status["warnings"] + status["problems"])
    assert not job.bench.github.calls


def test_the_setting_is_left_out_of_the_file_until_it_names_a_checkout() -> None:
    # A botcore from before the setting refuses a file that has it (every key is checked), so
    # setup writes it only when it names something
    assert "gate_outcome_checkouts" not in setup.settings_toml(MachineSettings())
    named = setup.settings_toml(MachineSettings(gate_outcome_checkouts=["~/afd"]))
    assert 'gate_outcome_checkouts = ["~/afd"]' in named


# ── One checkout ────────────────────────────────────────────────────────────


def test_a_named_checkout_is_fetched_and_collected_with_every_source(
    job: Job, monkeypatch: pytest.MonkeyPatch
) -> None:
    job.bench.github.add(conclusion="failure", created=day(1))
    job.bench.github.add(created=day(2))
    asked: list[list[str] | None] = []
    collect_at = collect.collect_at

    def spy(root: Path, sources: list[str] | None = None, **kwargs: object):
        asked.append(sources)
        return collect_at(root, sources, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(collect, "collect_at", spy)
    data = job.run()
    found = entry(data)
    assert data["gate_outcome"]["ok"] is True and asked == [list(collect.BUILT)]
    assert found["repository"] == REPO and found["checkout"] == str(job.bench.checkout)
    assert found["sources"][0]["status"] == "read" and found["sources"][0]["added"] > 0
    assert found["fetch"]["commit"] == git(job.origin, "rev-parse", "main")
    assert job.check()["gate_outcome"] == data["gate_outcome"]
    assert job.status()["gate_outcome"]["ok"] is True
    # the next hour goes on from the record: nothing is asked again but the newest span
    calls = len(job.bench.github.calls)
    again = entry(job.run())
    assert again["sources"][0]["added"] == 0
    asked_again = job.bench.github.calls[calls:]
    assert not [c for c in asked_again if "/jobs" in c or "/attempts/" in c], asked_again


def test_a_refusal_is_reported_and_the_next_checkout_and_the_job_go_on(job: Job) -> None:
    job.bench.github.add(created=day(1))
    elsewhere = job.tmp / "not-a-checkout"
    elsewhere.mkdir()
    job.write(checkouts=[str(elsewhere), str(job.tmp / "gone"), str(job.bench.checkout)])
    data = job.run()
    first, second, third = data["gate_outcome"]["checkouts"]
    assert first["error"]["code"] == "NO_WORKSPACE" and second["error"]["code"] == "NO_WORKSPACE"
    assert third["sources"][0]["status"] == "read", "a refusal never stops the next checkout"
    assert data["ran"] is True, "nor the disk work"
    kept = job.check()["gate_outcome"]
    assert kept["ok"] is False and str(elsewhere) in kept["error"]
    status = job.status()
    assert any("gate outcomes are not being collected" in w for w in status["warnings"])
    assert not any("gate outcome" in p for p in status["problems"]), "not for an hour"
    # failing for over a day is a problem
    check = job.check()
    check["gate_outcome"]["failing_since"] = (
        setup.datetime.now(setup.UTC) - timedelta(hours=30)
    ).isoformat()
    (job.state / "check.json").write_text(json.dumps(check))
    assert any("gate outcomes are not being collected" in p for p in job.status()["problems"])
    job.write(checkouts=[str(job.bench.checkout)])
    job.run()
    status = job.status()
    assert status["gate_outcome"]["ok"] is True
    assert not any("gate outcome" in w for w in status["warnings"] + status["problems"])


def test_a_collection_another_holds_is_refused_and_said(job: Job) -> None:
    state = job.bench.on("bench")
    state.mkdir(parents=True, exist_ok=True)
    with RunLock(state / record.LOCK_FILE):
        data = job.run()
    assert entry(data)["error"]["code"] == "CONFLICT"
    assert "CONFLICT" in job.check()["gate_outcome"]["error"]


# ── One step's trouble is its own ───────────────────────────────────────────


def test_each_collection_goes_on_when_the_other_fails(
    job: Job, monkeypatch: pytest.MonkeyPatch
) -> None:
    import botcore.commands.skill_usage as usage

    job.write(checkouts=[str(job.bench.checkout)], usage=True)
    order: list[str] = []

    async def usage_fails():
        order.append("usage")
        raise RuntimeError("the store fell over")

    async def usage_works():
        order.append("usage")
        return SimpleNamespace(success=True, data={"added": 2})

    def gate_fails(_checkouts: list[str]) -> dict:
        order.append("gate")
        raise RuntimeError("the record fell over")

    collect_checkouts = hourly.collect_checkouts

    def gate_works(checkouts: list[str]) -> dict:
        order.append("gate")
        return collect_checkouts(checkouts)

    monkeypatch.setattr(usage, "skill_usage_collect", usage_fails)
    monkeypatch.setattr(hourly, "collect_checkouts", gate_works)
    data = job.run()
    assert order == ["usage", "gate"], "the gate outcome step comes after skill usage's"
    assert data["skill_usage"]["ok"] is False and data["gate_outcome"]["ok"] is True
    assert data["ran"] is True
    order.clear()
    monkeypatch.setattr(usage, "skill_usage_collect", usage_works)
    monkeypatch.setattr(hourly, "collect_checkouts", gate_fails)
    data = job.run(own_process=False)
    assert order == ["usage", "gate"]
    assert data["skill_usage"]["ok"] is True and data["skill_usage"]["added"] == 2  # noqa: PLR2004
    assert data["gate_outcome"]["error"] == "RuntimeError: the record fell over"
    check = job.check()
    assert check["skill_usage"]["ok"] is True and check["gate_outcome"]["ok"] is False
    assert check["disk_work"]["ok"] is True


def test_a_step_that_stops_answering_or_runs_past_its_limit_is_left(
    job: Job, monkeypatch: pytest.MonkeyPatch
) -> None:
    release = threading.Event()

    def quiet(_checkouts: list[str]) -> dict:
        steps.doing("reading", "/Volumes/Shed/record")
        release.wait(30)  # a drive that is away
        steps.doing("writing", "/Volumes/Shed/record")  # (left: it stops here)
        return {"checkouts": [], "refused": []}

    monkeypatch.setattr(hourly, "collect_checkouts", quiet)
    monkeypatch.setattr(setup, "GATE_SECONDS", 0.2)
    data = job.run()
    release.set()
    assert data["gate_outcome"]["ok"] is False
    assert (
        "made no progress for 0.2 seconds: it was reading /Volumes/Shed/record"
        in (data["gate_outcome"]["error"])
    )
    assert data["ran"] is True

    monkeypatch.setattr(setup, "GATE_SECONDS", 300)
    monkeypatch.setattr(setup, "GATE_TOTAL_SECONDS", 0.3)
    stopped = threading.Event()

    def slow(_checkouts: list[str]) -> dict:
        try:
            while True:  # working, request after request
                steps.doing("asking GitHub", "repos/bench-org/beds/actions/runs")
                threading.Event().wait(0.02)
        finally:
            stopped.set()

    monkeypatch.setattr(hourly, "collect_checkouts", slow)
    data = job.run()
    assert "still collecting after" in data["gate_outcome"]["error"]
    assert job.check()["gate_outcome"] == data["gate_outcome"]
    assert stopped.wait(10), "a step that was left stops at its next word"


# ── The fetch ───────────────────────────────────────────────────────────────


def snapshot(checkout: Path) -> dict:
    """Everything a session works with in a checkout."""
    git_dir = Path(git(checkout, "rev-parse", "--absolute-git-dir"))
    return {
        "refs": git(
            checkout,
            "for-each-ref",
            "--format=%(refname) %(objectname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ),  # fmt: skip
        "symbolic": [
            subprocess.run(
                ["git", "-C", str(checkout), "symbolic-ref", "-q", ref],
                capture_output=True,
                text=True,
                check=False,
            ).stdout  # fmt: skip
            for ref in ("HEAD", "refs/remotes/origin/HEAD")
        ],
        "index": (git_dir / "index").read_bytes(),
        "status": git(checkout, "status", "--porcelain=v2", "--branch", "--untracked-files=all"),
        "fetch_head": (git_dir / "FETCH_HEAD").exists(),
        "tree": sorted(
            (str(p.relative_to(checkout)), p.read_bytes())
            for p in checkout.rglob("*")
            if p.is_file() and ".git" not in p.parts
        ),  # fmt: skip
    }


def test_the_fetch_moves_its_own_ref_and_nothing_else(job: Job) -> None:
    checkout = job.bench.checkout
    (checkout / "work.txt").write_text("a session's work, not committed\n", encoding="utf-8")
    (checkout / "README.md").write_text("beds, edited\n", encoding="utf-8")
    git(checkout, "add", "README.md")
    git(job.origin, "tag", "v1", "main")  # a tag on origin: not fetched
    landed = job.land("landed")
    # a clone whose last fetch left nothing behind: no FETCH_HEAD, no origin/HEAD
    Path(git(checkout, "rev-parse", "--absolute-git-dir"), "FETCH_HEAD").unlink()
    git(checkout, "remote", "set-head", "origin", "--delete")
    before = snapshot(checkout)
    assert not before["fetch_head"] and before["symbolic"][1] == ""
    fetched = hourly.fetch_default(checkout)
    assert fetched == {"ref": checks.OWN_REF, "commit": landed, "moved": True}
    assert snapshot(checkout) == before
    assert git(checkout, "rev-parse", checks.OWN_REF) == landed
    assert hourly.fetch_default(checkout)["moved"] is False
    assert snapshot(checkout) == before


def test_the_checks_known_are_read_from_the_own_ref_when_it_is_newer(job: Job) -> None:
    checkout = job.bench.checkout
    git(checkout, "remote", "set-head", "origin", "main")
    tracked = git(checkout, "rev-parse", "refs/remotes/origin/main")
    assert checks.default_ref(checkout) == ("refs/remotes/origin/HEAD", tracked)
    landed = job.land("newer")
    hourly.fetch_default(checkout)
    assert checks.default_ref(checkout) == (checks.OWN_REF, landed)
    # a session fetches later, past it: the checkout's own branch is the newer
    newest = job.land("newest")
    git(checkout, "fetch", "-q", "origin")
    assert checks.default_ref(checkout) == ("refs/remotes/origin/HEAD", newest)
    # the same commit: the checkout's name for it
    hourly.fetch_default(checkout)
    assert checks.default_ref(checkout) == ("refs/remotes/origin/HEAD", newest)
    # and the checks known are read from the ref default_ref gives
    landed = job.land("newest-again")
    hourly.fetch_default(checkout)
    known = checks.read_known(checkout)
    assert (known.ref, known.commit) == (checks.OWN_REF, landed)


def test_a_fetch_that_fails_is_reported_and_the_collection_reads_the_checkout(
    job: Job,
) -> None:
    job.bench.github.add(created=day(1))
    git(job.bench.checkout, "remote", "set-url", "origin", str(job.tmp / "away" / REPO))
    found = entry(job.run())
    assert found["fetch"]["ref"] == checks.OWN_REF and found["fetch"]["error"]
    assert found["sources"][0]["status"] == "read"
    assert job.check()["gate_outcome"]["ok"] is True, "a fetch that fails is not a refusal"


# ── The shared folder first ─────────────────────────────────────────────────


def test_a_second_machine_asks_github_for_nothing_the_first_has(job: Job) -> None:
    gh = job.bench.github
    gh.add(conclusion="failure", created=day(1), earlier=("failure",))
    gh.add(created=day(2), earlier=("cancelled",))
    gh.add(event="merge_group", created=day(3), head=5)
    job.bench.on("bench", shared=True)
    first = entry(job.run())
    assert first["sources"][0]["status"] == "read" and first["shared"]["written"] is True
    job.bench.on("potting-shed", shared=True)
    calls = len(gh.calls)
    second = entry(job.run())
    assert second["sources"][0]["status"] == "read" and second["sources"][0]["added"] == 0
    asked = gh.calls[calls:]
    assert not [c for c in asked if "/attempts/" in c or c.endswith("/logs")], asked
    lists = [c for c in asked if "/actions/runs?" in c]
    assert len(lists) <= 1 and all(TODAY.strftime("%Y-%m-%d") in c for c in lists), (
        "only the time since the first machine listed"
    )


def test_the_machine_settings_name_the_checkouts(tmp_path: Path, monkeypatch) -> None:  # noqa: ANN001
    settings = tmp_path / "disk.toml"
    settings.write_text('gate_outcome_checkouts = ["~/afd", "/srv/beds"]\n', encoding="utf-8")
    monkeypatch.setenv("BOTCORE_DISK_SETTINGS", str(settings))
    loaded, _path, found = load_machine_settings()
    assert found and loaded.gate_outcome_checkouts == ["~/afd", "/srv/beds"]


def test_the_docs_name_the_setting_the_step_and_the_fold() -> None:
    from botcore.docs import CORE_DOCS

    topic = CORE_DOCS["gate-outcome"]
    for field in ("gate_outcome_checkouts", checks.OWN_REF, "folded-workflow", "folded-check",
                  "`folded`", "180"):  # fmt: skip
        assert field in topic, field
    assert "gate_outcome_checkouts" in CORE_DOCS["disk"] and "`gate_outcome`" in CORE_DOCS["disk"]


def test_a_record_that_could_not_be_shared_is_said_and_the_job_goes_on(job: Job) -> None:
    job.bench.github.add(created=day(1))
    job.bench.on("bench")
    job.monkeypatch.setenv("BOTCORE_SKILL_USAGE_SHARED", str(job.tmp / "away"))
    data = job.run()
    found = entry(data)
    assert found["sources"][0]["status"] == "read" and found["shared"]["error"]
    assert data["gate_outcome"]["ok"] is False
    assert data["gate_outcome"]["error"].startswith("collected, but")
    assert data["ran"] is True


def test_a_refusal_keeps_its_suggestion(job: Job) -> None:
    elsewhere = job.tmp / "not-a-checkout"
    elsewhere.mkdir()
    job.write(checkouts=[str(elsewhere)])
    refused = entry(job.run())["error"]
    assert refused["code"] == "NO_WORKSPACE" and refused["suggestion"]


def test_in_a_process_that_lives_on_the_step_has_no_total_limit(
    job: Job, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(setup, "GATE_TOTAL_SECONDS", 0.2)

    def slow(_checkouts: list[str]) -> dict:
        until = threading.Event()
        for _ in range(30):  # 0.6 seconds of work, saying so as it goes
            steps.doing("asking GitHub", "repos/bench-org/beds/actions/runs")
            until.wait(0.02)
        return {"checkouts": [], "refused": []}

    monkeypatch.setattr(hourly, "collect_checkouts", slow)
    assert job.run(own_process=False)["gate_outcome"]["ok"] is True


def test_an_own_ref_that_does_not_hold_the_landing_branch_is_not_read(job: Job) -> None:
    checkout = job.bench.checkout
    tracked = git(checkout, "rev-parse", "refs/remotes/origin/main")
    # a ref of the job's own on history the landing branch does not share
    tree = git(checkout, "rev-parse", "HEAD^{tree}")
    other = git(checkout, "commit-tree", tree, "-m", "elsewhere")
    git(checkout, "update-ref", checks.OWN_REF, other)
    ref, commit = checks.default_ref(checkout)  # type: ignore[misc]
    assert ref != checks.OWN_REF and commit == tracked


def test_the_command_line_takes_a_limit_of_at_most_75() -> None:
    from click.testing import CliRunner

    from botcore.cli import cli

    refused = CliRunner().invoke(cli, ["gate-outcome-report", "--limit", "76"])
    assert refused.exit_code != 0 and "1<=x<=75" in refused.output


def test_hourly_main_source_never_fetches_into_remote_tracking_refs(
    job: Job, monkeypatch: pytest.MonkeyPatch
) -> None:
    from botcore.commands.gate_outcome import main as main_source

    called = []
    monkeypatch.setattr(main_source, "fetch", lambda *_a, **_k: called.append(True) or None)
    checkout = job.bench.checkout
    fetch_head = checkout / ".git" / "FETCH_HEAD"
    fetch_head.unlink(missing_ok=True)
    tracked_before = git(checkout, "rev-parse", "refs/remotes/origin/main")
    found = entry(job.run())
    sources = {source["source"]: source for source in found["sources"]}
    assert sources["main"]["status"] == "read"
    assert not called
    assert not fetch_head.exists()
    assert git(checkout, "rev-parse", "refs/remotes/origin/main") == tracked_before


def test_hourly_main_source_is_partly_when_the_job_fetch_fails(
    job: Job, monkeypatch: pytest.MonkeyPatch
) -> None:
    from botcore.commands.gate_outcome import main as main_source

    called = []
    monkeypatch.setattr(main_source, "fetch", lambda *_a, **_k: called.append(True) or None)
    git(
        job.bench.checkout,
        "remote",
        "set-url",
        "origin",
        str(job.tmp / "missing" / REPO.split("/")[0] / f"{REPO.split('/')[1]}.git"),
    )
    found = entry(job.run())
    sources = {source["source"]: source for source in found["sources"]}
    assert found["fetch"]["error"]
    assert sources["main"]["status"] == "partly"
    assert "could not be fetched" in sources["main"]["why"]
    assert not called


def test_manual_main_tip_still_fetches_origin_when_own_ref_is_ahead(job: Job) -> None:
    from botcore.commands.gate_outcome import main as main_source

    first_remote = job.land("ahead-one")
    fetched = hourly.fetch_default(job.bench.checkout)
    assert fetched["commit"] == first_remote
    assert checks.default_ref(job.bench.checkout) == (checks.OWN_REF, first_remote)
    second_remote = job.land("ahead-two")
    ref, commit, why = main_source.tip(job.bench.checkout, do_fetch=True)
    assert why is None
    assert commit == second_remote
    assert ref in ("refs/remotes/origin/HEAD", "refs/remotes/origin/main")
