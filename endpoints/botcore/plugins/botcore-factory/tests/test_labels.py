"""The label rules, with the cases of scripts/issue-labels.test.mjs, so both agree.

Each table below carries the JavaScript test's cases one for one; a rule or message changed in
one implementation fails here until the other matches.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess

import pytest
from conftest import REPO_ROOT

from botcore_factory.labels import (
    RULE_LABELS,
    Candidate,
    DefinitionsError,
    dispatch_order,
    is_untriaged,
    issue_violations,
    label_differences,
    load_definitions,
    parse_definitions,
)

DEFINITIONS = load_definitions(REPO_ROOT / ".github/labels.json")


def violations(labels, assigned=False):
    return issue_violations(labels, assigned, DEFINITIONS)


def test_the_file_defines_every_rule_label_none_legacy():
    by_name = {entry["name"]: entry for entry in DEFINITIONS}
    for name in RULE_LABELS:
        assert name in by_name, name
        assert "legacy" not in by_name[name], name
    executions = [
        e for e in DEFINITIONS if e["name"].startswith("execution:") and not e.get("legacy")
    ]
    assert len(executions) == 5


ONE = {"name": "a", "color": "ffffff", "description": "x"}


@pytest.mark.parametrize(
    "entries,message",
    [
        ([ONE, ONE], "defined twice"),
        ([{**ONE, "color": "red"}], "color"),
        ([{"name": "a", "color": "ffffff"}], "description"),
        (ONE, "list"),
    ],
)
def test_parse_rejects_duplicates_and_malformed_entries(entries, message):
    with pytest.raises(DefinitionsError, match=message):
        parse_definitions(json.dumps(entries))


def test_load_reports_a_missing_or_unparsable_file(tmp_path):
    with pytest.raises(DefinitionsError, match="Cannot read"):
        load_definitions(tmp_path / "labels.json")
    (tmp_path / "labels.json").write_text("{", encoding="utf-8")
    with pytest.raises(DefinitionsError, match="not JSON"):
        load_definitions(tmp_path / "labels.json")


@pytest.mark.parametrize(
    "labels,assigned",
    [
        (["status:planned", "execution:bounded", "needs:approach", "risk:high", "type:bug"], False),
        (["status:deferred", "needs:decision"], True),
        (["status:in-progress", "execution:deep"], False),
    ],
)
def test_accepts_well_labelled_issues(labels, assigned):
    assert violations(labels, assigned) == []


FLAGGED = [
    (["status:planned", "status:deferred", "execution:bounded"], r"2 status labels"),
    (["status:in-progress", "status:triage"], r"status:triage left beside"),
    (["status:triage", "priority:medium"], r"legacy label priority:medium"),
    (["status:triage", "status:needs-info"], r"legacy label status:needs-info"),
    (["status:triage", "made-up"], r"made-up is not defined"),
    (["status:triage", "priority:0", "priority:1"], r"both priority:0 and priority:1"),
    (["status:triage", "priority:0"], r"priority:0 unassigned"),
    (["status:triage", "risk:high", "risk:medium"], r"both risk:high and risk:medium"),
    (["status:planned"], r"status:planned without an execution profile"),
    (
        ["status:planned", "execution:bounded", "execution:deep"],
        r"several execution profiles \(execution:bounded, execution:deep\): keep one execution "
        r"profile",
    ),
    (["status:deferred", "blocked", "execution:deep"], r"status:deferred keeps execution:deep"),
    (["status:planned", "execution:expert-escalation"], r"expert-escalation unassigned"),
    (["status:deferred", "needs:decision"], r"needs:decision unassigned"),
    (["status:deferred", "needs:operator"], r"needs:operator unassigned"),
    (["status:planned", "execution:bounded", "blocked"], r"status:planned with blocked"),
]


@pytest.mark.parametrize("labels,message", FLAGGED, ids=[",".join(c[0]) for c in FLAGGED])
def test_flags(labels, message):
    assert re.search(message, "\n".join(violations(labels)))


def test_an_assignee_satisfies_the_rules_that_need_the_owner():
    assert violations(["status:triage", "priority:0"], True) == []
    assert violations(["status:planned", "execution:expert-escalation"], True) == []
    assert violations(["status:planned", "execution:bounded", "needs:operator"], True) == [
        "status:planned with needs:operator"
    ]


def test_messages_are_the_javascript_checker_s_word_for_word():
    assert violations(["status:planned", "status:deferred", "execution:bounded"]) == [
        "2 status labels (status:planned, status:deferred): keep exactly one",
        "status:deferred keeps execution:bounded",
    ]
    assert violations(["status:in-progress", "status:triage"]) == [
        "status:triage left beside the status:in-progress claim: remove status:triage"
    ]
    assert violations(["status:triage", "made-up", "priority:medium"]) == [
        "made-up is not defined in .github/labels.json",
        "legacy label priority:medium: re-evaluate and replace it",
    ]


@pytest.mark.parametrize(
    "labels,expected",
    [
        ([], True),
        (["status:triage", "type:bug"], True),
        (["status:accepted"], True),
        (["status:in-progress", "status:triage"], False),
        (["status:planned"], False),
    ],
)
def test_untriaged_is_no_status_or_only_triage_never_a_claim(labels, expected):
    assert is_untriaged(labels) is expected


def flat(number, labels, assigned=False, created_at="2030-01-01T09:00:00Z"):
    return Candidate(number, tuple(labels), assigned, created_at)


def test_dispatch_orders_priority_0_then_1_then_the_rest_oldest_first():
    planned = ["status:planned", "execution:bounded"]
    ready, _ = dispatch_order(
        [
            flat(1, planned, created_at="2030-01-03T00:00:00Z"),
            flat(2, planned, created_at="2030-01-01T00:00:00Z"),
            flat(3, [*planned, "priority:1"], created_at="2030-01-05T00:00:00Z"),
            flat(4, [*planned, "priority:1"], created_at="2030-01-04T00:00:00Z"),
            flat(5, planned, created_at="2030-01-01T00:00:00Z"),
        ],
        DEFINITIONS,
    )
    assert [issue.number for issue in ready] == [4, 3, 2, 5, 1]


def test_dispatch_holds_back_the_owner_s_lane_claims_open_prs_and_rule_breakers():
    ready, held = dispatch_order(
        [
            flat(10, ["status:planned", "execution:bounded"]),
            flat(11, ["status:planned", "execution:expert-escalation"], assigned=True),
            flat(12, ["status:planned", "execution:deep"], assigned=True),
            flat(13, ["status:planned", "execution:bounded"]),
            flat(14, ["status:planned"]),
            flat(15, ["status:deferred", "needs:decision"], assigned=True),
            flat(16, ["status:triage"]),
        ],
        DEFINITIONS,
        {13},
    )
    assert [issue.number for issue in ready] == [10]
    assert [(h["number"], "; ".join(h["reasons"])) for h in held] == [
        (11, "execution:expert-escalation: the owner's lane"),
        (12, "assigned: the owner's lane"),
        (13, "an open PR would close it"),
        (14, "breaks a rule: status:planned without an execution profile"),
    ]


def test_dispatch_also_holds_issues_a_claim_comment_holds():
    ready, held = dispatch_order(
        [flat(20, ["status:planned", "execution:bounded"])], DEFINITIONS, claimed={20}
    )
    assert ready == [] and held == [{"number": 20, "reasons": ["claimed"]}]


AGREEMENT = [
    *[(labels, False) for labels, _ in FLAGGED],
    *[(labels, True) for labels, _ in FLAGGED],
    (["status:planned", "execution:bounded", "needs:approach", "risk:high", "type:bug"], False),
    (["status:in-progress", "execution:deep", "status:triage", "made-up"], False),
    ([], False),
]

JS_CHECK = """
import { pathToFileURL } from 'node:url';
const lib = await import(pathToFileURL(process.argv[2]).href);
const definitions = lib.loadDefinitions();
const cases = JSON.parse(process.argv[1]);
const out = cases.map(([labels, assigned]) => ({
  violations: lib.issueViolations({ labels, assigned }, definitions),
  untriaged: lib.isUntriaged(labels),
}));
const issues = cases.map(([labels, assigned], i) => ({
  number: i + 1, labels, assigned, createdAt: `2030-01-${String(1 + (i % 9)).padStart(2, '0')}`,
}));
const order = lib.dispatchOrder(issues, definitions, new Set([2]));
console.log(JSON.stringify({ out, order: { ready: order.dispatchable.map((i) => i.number),
  held: order.held } }));
"""


def test_python_and_javascript_agree_on_every_case():
    """Run scripts/issue-labels.mjs itself on every case and compare its answers."""
    node = shutil.which("node")
    assert node, "Node is required to compare the rules with scripts/issue-labels.mjs"
    script = REPO_ROOT / "scripts/issue-labels.mjs"
    done = subprocess.run(  # noqa: S603 - an argument list, no shell
        # The cases come first: the checker runs its CLI when argv[1] names it.
        [node, "--input-type=module", "-e", JS_CHECK, json.dumps(AGREEMENT), str(script)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
        timeout=60,
    )
    js = json.loads(done.stdout)
    python = [
        {"violations": violations(labels, assigned), "untriaged": is_untriaged(labels)}
        for labels, assigned in AGREEMENT
    ]
    assert python == js["out"]
    candidates = [
        Candidate(i + 1, tuple(labels), assigned, f"2030-01-{1 + (i % 9):02d}")
        for i, (labels, assigned) in enumerate(AGREEMENT)
    ]
    ready, held = dispatch_order(candidates, DEFINITIONS, {2})
    assert {"ready": [c.number for c in ready], "held": held} == js["order"]


LIVE = [
    {"name": e["name"], "color": e["color"].lower(), "description": e["description"]}
    for e in DEFINITIONS
    if e["name"] != "needs:repro"
]


def test_labels_match_an_identical_repository():
    everything = [{k: e[k] for k in ("name", "color", "description")} for e in DEFINITIONS]
    assert label_differences(DEFINITIONS, everything) == {"missing": [], "extra": [], "changed": []}


def test_labels_report_missing_extra_and_changed():
    changed = [
        {**label, "description": "Stuck"} if label["name"] == "blocked" else label for label in LIVE
    ]
    found = label_differences(DEFINITIONS, [*changed, {"name": "stray", "color": "000000"}])
    assert [entry["name"] for entry in found["missing"]] == ["needs:repro"]
    assert found["extra"] == ["stray"]
    assert 'blocked: description differs from GitHub ("Stuck")' in found["changed"]


def test_labels_compare_colors_without_regard_to_case():
    entry = DEFINITIONS[0]
    assert label_differences([entry], [{**entry, "color": entry["color"].upper()}])["changed"] == []
