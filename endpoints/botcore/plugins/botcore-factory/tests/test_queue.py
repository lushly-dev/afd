"""lane-enqueue: its refusals, which write nothing, and queued, held and repaired branches."""

from __future__ import annotations

import json

import pytest
from test_commands import failing

REFUSALS = [
    ("running", {}, "wt/stray", "NOT_FOUND", "cell-register"),
    ("running", {}, "wt/none", "NOT_FOUND", "worktree"),
    (
        "running",
        {"thisMachine": "mini"},
        "wt/parser",
        "NOT_LANE_HOST",
        "workstation) and call lane-enqueue",
    ),
    (
        "running",
        {"laneHost": None},
        "wt/parser",
        "NOT_LANE_HOST",
        "foreman, who chooses the lane host with lane-host-set",
    ),
    ("running", {}, "wt/half-done", "DIRTY_WORKTREE", "commit"),
    ("running", {}, "wt/unreviewed", "REVIEW_MISSING", "prepare-pr"),
    ("ejected", {}, "wt/type-slip", "PREQUEUE_FAILED", "lane-enqueue"),
    ("ejected", {}, "wt/loosened", "GATE_EDIT_IN_REPAIR", "report that to your foreman"),
]


@pytest.mark.parametrize(
    "name,overrides,worktree,code,hint", REFUSALS, ids=[f"{r[3]}-{r[2]}" for r in REFUSALS]
)
async def test_a_refusal_names_the_way_forward_and_writes_nothing(
    make_run, name, overrides, worktree, code, hint
):
    run = make_run(name, **overrides)
    before = run.snapshot()
    records = run.store.read_records()
    result = await run.call("lane_enqueue", worktree=worktree)
    assert not result.success and result.error.code == code, result.error
    assert hint in result.error.suggestion
    assert run.snapshot() == before and run.store.read_records() == records


async def test_the_refusals_name_the_files_the_stage_and_the_gate_edit(make_run):
    running, ejected = make_run("running"), make_run("ejected")
    dirty = await running.call("lane_enqueue", worktree="wt/half-done")
    assert "src/parse.ts" in dirty.error.message and dirty.error.details["files"] == [
        "src/parse.ts"
    ]
    failed = await ejected.call("lane_enqueue", worktree="wt/type-slip")
    assert failed.error.details["stage"] == "typecheck"
    assert failed.error.details["passed"] == ["lint"]
    assert "Type 'string' is not assignable" in failed.error.details["lines"][0]
    gate = await ejected.call("lane_enqueue", worktree="wt/loosened")
    assert gate.error.details["paths"] == ["scripts/check-file-size.mjs"]


async def test_a_reviewed_branch_joins_the_queue_and_its_head_is_pushed(make_run):
    run = make_run("running")
    result = await run.call(
        "lane_enqueue", worktree="wt/parser", title="Accept empty input", body_file="pr-body.md"
    )
    assert result.success, result.error
    data = result.data
    assert (data["state"], data["position"], data["head"], data["attempt"]) == (
        "queued",
        3,
        "a1b2c3d",
        1,
    )
    assert [stage["name"] for stage in data["prequeue"]["stages"]] == ["lint", "typecheck"]
    state = run.state()
    assert state["queue"][-1]["branch"] == "fix/parser-empty-input"
    cell = next(c for c in state["cells"] if c["branch"] == "fix/parser-empty-input")
    assert (cell["state"], cell["head"], cell["title"]) == (
        "queued",
        "a1b2c3d",
        "Accept empty input",
    )
    refs = run.world_data()["originQueueRefs"]
    assert refs == [{"branch": "fix/parser-empty-input", "head": "a1b2c3d"}]


async def test_enqueue_records_what_measurement_needs(make_run):
    run = make_run("running")
    await run.call("lane_enqueue", worktree="wt/parser", title="t")
    [record] = run.store.read_records()
    assert record["kind"] == "enqueued" and record["schema"] == 5
    assert (record["plan"], record["route"], record["profile"]) == ("plan-a", "sol/high", "bounded")
    assert record["firstEnqueuedAt"] == record["at"] == "2030-01-01T00:00:00Z"
    assert record["runId"] == "run-2" and record["state"] == "queued"


async def test_a_full_queue_holds_the_branch_rather_than_refusing_it(make_run):
    run = make_run("running", dials={"lane.queueMax": 2})
    data = (await run.call("lane_enqueue", worktree="wt/parser")).data
    assert (data["state"], data["position"], data["holdReason"]) == ("held", 1, "queue-full")
    state = run.state()
    assert [h["branch"] for h in state["held"]] == ["fix/parser-empty-input"]
    assert len(state["queue"]) == 2
    [record] = run.store.read_records()
    assert record["state"] == "held" and record["holdReason"] == "queue-full"


async def test_a_repair_goes_to_the_front_and_answers_its_ejection(make_run):
    run = make_run("ejected")
    data = (await run.call("lane_enqueue", worktree="wt/parser")).data
    assert (data["state"], data["position"], data["answered"]) == ("queued", 1, ["ev-7"])
    state = run.state()
    assert [entry["branch"] for entry in state["queue"]] == [
        "fix/parser-empty-input",
        "feat/export-csv",
    ]
    assert state["events"][0]["open"] is False
    assert state["events"][0]["resolution"]["by"] == "lane-enqueue"


async def test_re_enqueueing_replaces_the_branch_s_entry_and_counts_the_attempt(make_run):
    run = make_run("running")
    await run.call("lane_enqueue", worktree="wt/parser", title="First", body_file="b.md")
    data = (await run.call("lane_enqueue", worktree="wt/parser")).data
    assert data["attempt"] == 2 and data["position"] == 3
    state = run.state()
    assert [e["branch"] for e in state["queue"]].count("fix/parser-empty-input") == 1
    assert state["queue"][-1]["title"] == "First"  # The previous attempt's title and body.
    first, second = run.store.read_records()
    assert second["firstEnqueuedAt"] == first["at"]


async def test_gate_allow_lets_the_diagnosed_gate_repair_in(make_run):
    run = make_run("ejected")
    session = await run.take_lane()
    allowed = await run.call(
        "gate_allow",
        branch="fix/loosened-check",
        reason="Diagnosed",
        session=session,
        head="d4e5f6a",
    )
    assert allowed.data == {"allowed": True, "branch": "fix/loosened-check", "head": "d4e5f6a"}
    assert (await run.call("lane_enqueue", worktree="wt/loosened")).data["state"] == "queued"
    missing = await run.call(
        "gate_allow", branch="nope", reason="x", session=session, head="d4e5f6a"
    )
    assert missing.error.code == "NOT_FOUND"


async def test_the_gate_refusal_sends_the_cell_to_its_foreman_not_to_gate_allow(make_run):
    """A cell following its refusal's suggestion must not find the foreman's command in it."""
    run = make_run("ejected")
    refused = await run.call("lane_enqueue", worktree="wt/loosened")
    assert refused.error.code == "GATE_EDIT_IN_REPAIR"
    assert "gate-allow" not in refused.error.suggestion
    assert "gate_allow" not in refused.error.suggestion
    assert refused.error.details["head"] == "d4e5f6a"  # What the foreman's gate-allow names.


async def test_gate_allow_covers_the_head_it_names_and_no_later_one(make_run):
    run = make_run("ejected")
    session = await run.take_lane()
    await run.call(
        "gate_allow",
        branch="fix/loosened-check",
        reason="Diagnosed",
        session=session,
        head="0ld0ld0",
    )
    refused = await run.call("lane_enqueue", worktree="wt/loosened")
    assert refused.error.code == "GATE_EDIT_IN_REPAIR", refused.error


async def test_a_repair_whose_gate_edits_cannot_be_read_waits(make_run):
    """The base the gate check compares against is the lane's own fetch; failing it refuses."""
    run = make_run("ejected")
    data = run.world_data()
    data.setdefault("outcomes", {})["fetch"] = "fail: Could not resolve host: github.com"
    run.world_path.write_text(json.dumps(data))
    before = run.snapshot()
    result = await run.call("lane_enqueue", worktree="wt/loosened")
    assert result.error.code == "GATE_CHECK_FAILED", result.error
    assert "Could not resolve host" in result.error.message
    assert run.snapshot() == before


async def test_no_label_lets_a_repair_edit_its_gate(make_run):
    """A label a cell's own sign-in can add is no exemption: only the live foreman's gate-allow."""
    run = make_run("ejected")
    data = run.world_data()
    next(i for i in data["issues"] if i["number"] == 103)["labels"].append("area:ci")
    run.world_path.write_text(json.dumps(data))
    refused = await run.call("lane_enqueue", worktree="wt/loosened")
    assert refused.error.code == "GATE_EDIT_IN_REPAIR", refused.error


async def test_a_stage_that_cannot_run_did_not_pass(make_run):
    run = make_run("running")
    data = run.world_data()
    del data["worktrees"]["wt/parser"]["prequeue"]["typecheck"]
    run.world_path.write_text(json.dumps(data))
    result = await run.call("lane_enqueue", worktree="wt/parser")
    assert result.error.code == "PREQUEUE_FAILED" and result.error.details["stage"] == "typecheck"
    assert "install" not in result.error.details


async def test_a_failed_stage_names_the_install_a_new_worktree_needs(make_run):
    run = make_run("ejected")
    plain = await run.call("lane_enqueue", worktree="wt/type-slip")
    assert "install" not in plain.error.details
    assert plain.error.suggestion.startswith("Fix what typecheck reports")
    config = run.target / "botcore.toml"
    config.write_text(
        config.read_text().replace(
            "[plugins.factory]\n",
            '[plugins.factory]\ninstall = ["pnpm", "install", "--frozen-lockfile"]\n',
        )
    )
    result = await run.call("lane_enqueue", run.host(target=run.target), worktree="wt/type-slip")
    assert result.error.code == "PREQUEUE_FAILED"
    assert result.error.details["install"] == ["pnpm", "install", "--frozen-lockfile"]
    assert "run `pnpm install --frozen-lockfile` in it" in result.error.suggestion
    assert "with nothing to commit" in result.error.suggestion
    assert "Otherwise fix what typecheck reports" in result.error.suggestion


async def test_without_review_evidence_in_the_adapter_nothing_can_be_queued(make_run, tmp_path):
    run = make_run("running")
    bare = tmp_path / "no-review"
    (bare / ".github").mkdir(parents=True)
    (bare / ".github/labels.json").write_bytes((run.target / ".github/labels.json").read_bytes())
    (bare / "botcore.toml").write_text('[plugins.factory]\nlabels = ".github/labels.json"\n')
    result = await run.call("lane_enqueue", run.host(target=bare), worktree="wt/parser")
    assert result.error.code == "NOT_CONFIGURED" and "review_evidence" in result.error.suggestion


async def test_a_failed_push_queues_nothing(make_run):
    run = make_run("running")
    before = run.snapshot()

    class NoPush:
        def __getattr__(self, name):
            return getattr(run.world.git, name)

        def push_queue_ref(self, *args):
            from botcore_factory.world import WorldError

            raise WorldError("remote rejected")

    result = await run.call("lane_enqueue", run.host(git=NoPush()), worktree="wt/parser")
    assert result.error.code == "WRITE_FAILED"
    assert run.snapshot()[1:] == before[1:]


async def test_a_failed_issue_read_queues_nothing(make_run):
    run = make_run("running")
    result = await run.call(
        "lane_enqueue", run.host(**failing(run, "get_issue")), worktree="wt/parser"
    )
    assert result.error.code == "READ_FAILED"
    assert run.state()["queue"] == make_run("running").state()["queue"]


# S11 and the ignore_branches nit: refused before anything runs.


@pytest.mark.parametrize(
    "body_file", ["../../etc/passwd", "/etc/passwd", "C:\\secrets.txt", "docs\\..\\..\\x", ""]
)
async def test_a_pr_body_outside_the_worktree_is_refused(make_run, body_file):
    run = make_run("running")
    before = run.snapshot()
    result = await run.call("lane_enqueue", worktree="wt/parser", body_file=body_file)
    assert result.error.code == "BODY_FILE_OUTSIDE" and "relative" in result.error.suggestion
    assert run.snapshot() == before


async def test_a_branch_the_adapter_ignores_is_never_queued(make_run, tmp_path, example_repo):
    run = make_run("running")
    target = tmp_path / "ignoring"
    (target / ".github").mkdir(parents=True)
    labels = (example_repo / ".github" / "labels.json").read_bytes()
    (target / ".github" / "labels.json").write_bytes(labels)
    adapter = (example_repo / "botcore.toml").read_text(encoding="utf-8")
    (target / "botcore.toml").write_text(adapter + 'ignore_branches = ["fix/parser-*"]\n')
    before = run.snapshot()
    result = await run.call("lane_enqueue", run.host(target=target), worktree="wt/parser")
    assert result.error.code == "IGNORED_BRANCH" and "by hand" in result.error.suggestion
    assert run.snapshot() == before


# S4: the stages run outside the state lock, and what joins the queue is the head they checked.


async def test_the_prequeue_stages_run_without_the_state_lock(make_run):
    run = make_run("running")
    held = []

    class Watching:
        def __getattr__(self, name):
            return getattr(run.world.processes, name)

        def run(self, args, cwd, timeout=None, *, label=None):
            held.append((label, run.store.lock_path.exists()))
            return run.world.processes.run(args, cwd, timeout, label=label)

    result = await run.call("lane_enqueue", run.host(processes=Watching()), worktree="wt/parser")
    assert result.success, result.error
    assert ("prequeue:lint", False) in held and ("prequeue:typecheck", False) in held


async def test_a_head_that_moved_while_the_checks_ran_is_refused(make_run):
    run = make_run("running")
    before = run.snapshot()
    reads = []

    class Moving:
        def __getattr__(self, name):
            return getattr(run.world.git, name)

        def head(self, path):
            reads.append(path)
            return "a1b2c3d" if len(reads) == 1 else "f00dfee"

    result = await run.call("lane_enqueue", run.host(git=Moving()), worktree="wt/parser")
    assert result.error.code == "HEAD_MOVED" and "a1b2c3d" in result.error.message
    assert run.snapshot()[1:] == before[1:]
    assert "originQueueRefs" not in run.world_data()


# B2: a repair goes to the front, but never ahead of a branch already merging.


async def test_a_repair_is_queued_behind_a_branch_already_merging(make_run):
    run = make_run("ejected")
    with run.store.update("merging") as state:
        state["queue"][0].update(state="merging", pr=600, validatedHead="b2c3d4e+main-0")
    data = (await run.call("lane_enqueue", worktree="wt/parser")).data
    assert (data["state"], data["position"]) == ("queued", 2)
    assert [(e["branch"], e.get("state", "queued")) for e in run.state()["queue"]] == [
        ("feat/export-csv", "merging"),
        ("fix/parser-empty-input", "queued"),
    ]
