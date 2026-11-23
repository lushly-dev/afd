"""Test-change reports and Phase 5's "never improves by checking less" hold.

The repository adapter's ``test_changes`` command (AFD: ``report-test-changes.mjs --json``)
lists every test file deleted, skipped, rewritten or loosened against the base branch.
``lane-enqueue`` runs it in the cell's worktree as fast feedback, and the lane runs it again
from its clean ``review`` slot at the base (never the branch's checkout, matching
``review_evidence`` in lushly-dev/afd#1308, so neither a tampered script nor branch
``.gitattributes`` can silence the diff) on the folded commit before validation.

The structured report is attached to the cell and its attempt records (``enqueued``, ``held``,
``validated``, ``ejected``, ``merged``). On an ``area:factory`` (or improvement-experiment)
branch, any finding or edit to ``gate_paths`` holds the branch with ``holdReason: "gate-change"``
for a person to review and release via ``measure-approve`` (lushly-dev/afd#1387 step 5,
software-factory job 21). ``check_less_reasons`` also accepts ``checks_run_delta`` so Phase 5
can hold check-count drops once validations report ``checksRun``. Adding tests produces no
findings and holds nothing.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import TYPE_CHECKING

from botcore_factory.world import Issue, WorldError

if TYPE_CHECKING:
    from botcore_factory.runtime import Factory

#: Seconds; the report reads git diffs locally.
TEST_CHANGES_TIMEOUT = 120
#: Bound how many findings sit on one JSONL record line (``findingCount`` keeps the true total).
MAX_FINDINGS = 200
#: Quoted diff lines kept per finding, matching ``report-test-changes.mjs``'s ``MAX_QUOTED``.
MAX_LINES = 5
#: Characters kept per quoted line, matching ``report-test-changes.mjs``'s display cap.
MAX_LINE_CHARS = 120
#: Bound hold reasons kept in event ``lines`` / state payloads (matching ``FAILURES_SHOWN``).
MAX_HOLD_LINES = 50
#: Bound ``holdDetail`` summary length so large diffs do not bloat ``state.json`` or ``lane-wait``.
MAX_HOLD_DETAIL_CHARS = 500
#: Label marking a branch that modifies the factory itself (Phase 5 improvement work).
AREA_FACTORY = "area:factory"
#: Hold reason for branches that stop checking something (job 21, Phase 5 guardrail).
GATE_CHANGE_HOLD = "gate-change"
#: Hold reasons that wait on a person and are never auto-queued when queue space opens.
OWNER_HOLD_REASONS = frozenset({GATE_CHANGE_HOLD, "measure-change"})
#: Plain-English labels for each ``report-test-changes.mjs`` finding kind.
FINDING_LABELS: dict[str, str] = {
    "deleted-file": "deletes test file",
    "fewer-tests": "fewer tests",
    "fewer-assertions": "fewer assertions",
    "skip-added": "adds test skip",
    "assertions-rewritten": "rewrites assertions",
    "matchers-loosened": "loosens matchers",
    "snapshot-changed": "removes snapshot lines",
    "config-changed": "changes test config",
}


def _non_negative_int(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise WorldError(f"test_changes report field {name} must be a non-negative integer")
    return value


def _non_empty_str(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise WorldError(f"test_changes report field {name} must be a non-empty string")
    return value


def _parse_totals(raw: object) -> dict[str, dict]:
    if not isinstance(raw, dict):
        raise WorldError("test_changes report field totals must be an object")
    totals: dict[str, dict] = {}
    for language, entry in raw.items():
        if not isinstance(language, str) or not isinstance(entry, dict):
            raise WorldError("test_changes totals entries must map language names to objects")
        files = _non_negative_int(entry.get("files"), f"totals.{language}.files")
        parsed_entry: dict[str, object] = {"files": files}
        for side in ("before", "after"):
            counts = entry.get(side)
            if not isinstance(counts, dict):
                raise WorldError(f"test_changes totals.{language}.{side} must be an object")
            parsed_entry[side] = {
                key: _non_negative_int(counts.get(key, 0), f"totals.{language}.{side}.{key}")
                for key in ("tests", "assertions", "skips")
            }
        totals[language] = parsed_entry
    return totals


def _parse_finding(raw: object, index: int) -> dict:
    if not isinstance(raw, dict):
        raise WorldError(f"test_changes finding[{index}] must be an object")
    finding: dict[str, object] = {
        "file": _non_empty_str(raw.get("file"), f"findings[{index}].file"),
        "kind": _non_empty_str(raw.get("kind"), f"findings[{index}].kind"),
        "detail": _non_empty_str(raw.get("detail"), f"findings[{index}].detail"),
    }
    raw_lines = raw.get("lines")
    if raw_lines is not None:
        if not isinstance(raw_lines, list):
            raise WorldError(f"test_changes findings[{index}].lines must be a list")
        lines = []
        for line_index, item in enumerate(raw_lines[:MAX_LINES]):
            if not isinstance(item, dict):
                raise WorldError(
                    f"test_changes findings[{index}].lines[{line_index}] must be an object"
                )
            number = _non_negative_int(
                item.get("line"), f"findings[{index}].lines[{line_index}].line"
            )
            text = item.get("text")
            if not isinstance(text, str):
                raise WorldError(
                    f"test_changes findings[{index}].lines[{line_index}].text must be a string"
                )
            lines.append({"line": number, "text": text[:MAX_LINE_CHARS]})
        if lines:
            finding["lines"] = lines
    return finding


def parse_report(raw: str) -> dict:
    """Parse and validate ``report-test-changes.mjs --json`` output.

    Malformed or missing fields raise ``WorldError`` rather than returning empty findings, so a
    broken script can never look like a clean branch.
    """
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise WorldError(f"test_changes did not print valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise WorldError("test_changes report must be a JSON object")
    base = _non_empty_str(data.get("base"), "base")
    merge_base = _non_empty_str(data.get("mergeBase"), "mergeBase")
    head = _non_empty_str(data.get("head"), "head")
    test_files = _non_negative_int(data.get("testFiles"), "testFiles")
    totals = _parse_totals(data.get("totals"))
    raw_findings = data.get("findings")
    if not isinstance(raw_findings, list):
        raise WorldError("test_changes report field findings must be a list")
    # Validate every finding even when capping what is stored, so corruption past the cap fails.
    validated = [_parse_finding(item, idx) for idx, item in enumerate(raw_findings)]
    report: dict[str, object] = {
        "base": base,
        "mergeBase": merge_base,
        "head": head,
        "testFiles": test_files,
        "totals": totals,
        "findingCount": len(validated),
        "findings": validated[:MAX_FINDINGS],
    }
    if len(validated) > MAX_FINDINGS:
        report["truncated"] = True
    return report


def run_report(factory: Factory, *, cwd: str, worktree: str, base: str, head: str) -> dict | None:
    """Run the adapter's ``test_changes`` command and return its validated report.

    Returns ``None`` when the adapter configures no ``test_changes`` command. Any non-zero exit
    or malformed output raises ``WorldError``.
    """
    command = factory.config.test_changes
    if not command:
        return None
    argv = [
        part.replace("{base}", base).replace("{head}", head).replace("{worktree}", worktree)
        for part in command
    ]
    done = factory.world.processes.run(
        argv, cwd=cwd, timeout=TEST_CHANGES_TIMEOUT, label="test-changes"
    )
    if done.returncode != 0:
        output = (done.stderr + "\n" + done.stdout).strip()
        first = next((line.strip() for line in output.splitlines() if line.strip()), "no output")
        raise WorldError(f"test_changes exited {done.returncode}: {first[:300]}")
    report = parse_report(done.stdout)
    if report["base"] != base or report["head"] != head:
        raise WorldError(
            f"test_changes compared {report['base']}..{report['head']}, expected {base}..{head}"
        )
    return report


def summarize_hold(reasons: Sequence[str]) -> tuple[str, list[str]]:
    """Return a bounded ``(detail, lines)`` pair for a ``gate-change`` hold."""
    shown = list(reasons[:MAX_HOLD_LINES])
    more = len(reasons) - len(shown)
    if more > 0:
        shown.append(f"… and {more} more")
    joined = "; ".join(reasons)
    if len(joined) > MAX_HOLD_DETAIL_CHARS:
        joined = joined[: MAX_HOLD_DETAIL_CHARS - 1].rstrip() + "…"
    return joined, shown


def check_less_reasons(
    report: dict | None,
    *,
    gate_paths: Sequence[str] = (),
    checks_run_delta: int | None = None,
) -> list[str]:
    """Plain-English reasons a branch checks less than its base (Phase 5 guardrail).

    Returns an empty list when the branch neither edits ``gate_paths``, runs fewer checks than
    main, nor produces any test-change report finding. Adding tests produces no findings and
    returns an empty list.
    """
    reasons: list[str] = []
    seen_gates = sorted({path for path in gate_paths if path})
    for path in seen_gates:
        reasons.append(f"edits gate path {path}")
    if checks_run_delta is not None and checks_run_delta < 0:
        fewer = -checks_run_delta
        noun = "check" if fewer == 1 else "checks"
        reasons.append(f"runs {fewer} fewer {noun} than main")
    if report is not None:
        findings = report.get("findings") or []
        for finding in findings:
            label = FINDING_LABELS.get(finding.get("kind", ""), finding.get("kind", "test change"))
            reasons.append(f"{label} in {finding['file']}: {finding['detail']}")
        total = int(report.get("findingCount", len(findings)))
        extra = total - len(findings)
        if extra > 0:
            noun = "finding" if extra == 1 else "findings"
            if findings:
                reasons.append(f"and {extra} more test-change {noun}")
            else:
                reasons.append(f"{extra} test-change {noun}")
    return reasons


def is_factory_branch(issues: Sequence[Issue], cell: dict | None = None) -> bool:
    """Whether a branch changes the factory itself (``area:factory`` or an improvement cell)."""
    if (cell or {}).get("improvement"):
        return True
    return any(AREA_FACTORY in issue.labels for issue in issues)


def is_gate_change_approved(cell: dict | None, head: str) -> bool:
    """Whether a person already approved this exact head's gate/test change."""
    approved = (cell or {}).get("gateChangeApproved")
    return isinstance(approved, dict) and bool(head) and approved.get("head") == head
