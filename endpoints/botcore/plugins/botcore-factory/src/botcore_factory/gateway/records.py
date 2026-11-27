"""The gateway's records: the audit (G1), review records (G2) and events (G3).

The audit answers "who did this" from AFD's journal (and any seeded rows), and lists writes to
watched targets (claimed issues, the bot's pull requests) that GitHub reports and the journal
does not hold. Events are derived from the same GitHub reads, and each consumer is given an
event once.
"""

from __future__ import annotations

import asyncio
import dataclasses
from collections.abc import Callable
from datetime import datetime
from typing import Any

from afd import Actor, CommandResult, JournalRecord, error, success
from afd.core.journal import JournalEntry

from botcore_factory.gateway.claims import Claim, iso, parse_time, read_claim
from botcore_factory.gateway.service import REVIEW, Gateway, refuse
from botcore_factory.gateway.state import read_journal

#: The commands that write, which the audit lists.
WRITE_COMMANDS = {
    "issue-claim",
    "issue-release",
    "issue-label",
    "issue-comment",
    "issue-create",
    "branch-push",
    "pr-open",
    "verification-record",
    "pr-merge",
    "pr-revert",
    "variable-set",
    "review-record",
}
EVENT_KINDS = (
    "pr-merged",
    "checks-passed",
    "checks-failed",
    "checks-stalled",
    "owner-commented",
    "outside-write",
)
_PULL_COMMANDS = {"pr-open", "pr-merge"}


def _targets(entry: JournalEntry, heads: dict[str, int]) -> list[str]:
    """What a journaled write touched, from its input and result."""
    data = entry.input if isinstance(entry.input, dict) else {}
    result = _result(entry).get("data")
    result = result if isinstance(result, dict) else {}
    command = entry.command
    if command in _PULL_COMMANDS:
        number = data.get("number") or result.get("number")
        return [f"pr#{number}"] if number else []
    if command == "pr-revert":
        return [f"pr#{n}" for n in data.get("numbers", [])]
    if command in {"verification-record", "review-record"}:
        head = data.get("head")
        return [f"pr#{heads[head]}"] if head in heads else [f"head:{head}"]
    if command == "branch-push":
        return [data.get("ref", "")]
    if "numbers" in data:
        return [f"issue#{n}" for n in data["numbers"]]
    if "number" in data:
        return [f"issue#{data['number']}"]
    return []


def _number(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


#: The input fields the audit reads (`_targets`, `journal_rows`), each with the check its value
#: must pass to be kept.
def _text(value: Any) -> bool:
    return isinstance(value, str)


def _numbers(value: Any) -> bool:
    return isinstance(value, list) and all(_number(n) for n in value)


_AUDIT_INPUT: dict[str, Callable[[Any], bool]] = {
    "repo": _text,
    "number": _number,
    "numbers": _numbers,
    "head": _text,
    "ref": _text,
    "cancel": lambda value: isinstance(value, bool),
}


def audit_record(record: JournalRecord) -> JournalRecord:
    """The journal's redaction: keep only what the audit reads.

    The gateway journals refused writes too, such as an `issue-create` refused with
    `SECRET_IN_BODY`, so an input is never kept whole: only the audit's fields of the right type
    (`repo`, `number`, `numbers`, `head`, `ref`, `cancel`), and of the result only `success`, an
    error's `code`, a pull request `number` and whether a cancel `dequeued` it (#2809). The
    actor, timestamp and trace ID stay; the tape goes.
    """
    data = record.input if isinstance(record.input, dict) else {}
    kept_input = {
        key: data[key] for key, check in _AUDIT_INPUT.items() if key in data and check(data[key])
    }
    result = record.result if isinstance(record.result, dict) else {}
    kept_result: dict[str, Any] = {"success": result.get("success") is True}
    outcome = result.get("data")
    if isinstance(outcome, dict):
        kept = {
            **({"number": outcome["number"]} if _number(outcome.get("number")) else {}),
            **(
                {"dequeued": outcome["dequeued"]}
                if isinstance(outcome.get("dequeued"), bool)
                else {}
            ),
        }
        if kept:
            kept_result["data"] = kept
    failure = result.get("error")
    if isinstance(failure, dict) and isinstance(failure.get("code"), str):
        kept_result["error"] = {"code": failure["code"]}
    return dataclasses.replace(record, input=kept_input, result=kept_result, tape=None)


def _result(entry: JournalEntry) -> dict[str, Any]:
    result: Any = entry.result
    if hasattr(result, "model_dump"):
        result = result.model_dump(mode="json", exclude_none=True)
    return result if isinstance(result, dict) else {}


def _actor(actor: Actor | None) -> dict[str, Any]:
    if actor is None:
        return {}
    row: dict[str, Any] = {"kind": actor.kind, "id": actor.id}
    if actor.on_behalf_of:
        row["onBehalfOf"] = actor.on_behalf_of
        row["onBehalfOfAsserted"] = True  # The caller's word; the token names only id and kind.
    return {key: value for key, value in row.items() if value is not None}


def journal_rows(
    gateway: Gateway, repo: str, *, since: datetime | None = None
) -> list[dict[str, Any]]:
    heads = {pull["head"]: pull["number"] for pull in gateway.scans.cached_pulls(repo)}
    rows = [{**row, "targets": [row["target"]]} for row in gateway.state.get("auditSeed", [])]
    for entry in read_journal(gateway.state.journal_dir, since=since):
        if entry.command not in WRITE_COMMANDS:
            continue
        if isinstance(entry.input, dict) and entry.input.get("repo") not in (None, repo):
            continue
        targets = _targets(entry, heads)
        rows.append(
            {
                "timestamp": entry.timestamp,
                "command": entry.command,
                "actor": _actor(entry.actor),
                "target": targets[0] if targets else None,
                "targets": targets,
                "success": bool(_result(entry).get("success")),
            }
        )
    rows.sort(key=lambda row: row["timestamp"])
    for seq, row in enumerate(rows, start=1):
        row["seq"] = seq
    return rows


def watched(gateway: Gateway, repo: str) -> set[str]:
    targets = set()
    for issue in gateway.scans.cached_issues(repo):
        record = read_claim(
            issue["number"], issue.get("comments", []), gateway.config, gateway.now()
        )
        if isinstance(record, Claim):
            targets.add(f"issue#{issue['number']}")
    for pull in gateway.scans.cached_pulls(repo):
        if pull.get("author") == gateway.config.bot:
            targets.add(f"pr#{pull['number']}")
    return targets


def outside_writes(gateway: Gateway, repo: str, since: str | None) -> list[dict[str, Any]]:
    """Writes GitHub reports on watched targets that did not come through the gateway."""
    targets, bot, start = watched(gateway, repo), gateway.config.bot, parse_time(since)
    found = []
    for event in gateway.github.issue_events(repo):
        if event["target"] in targets and event.get("by") != bot:
            found.append({key: event.get(key) for key in ("at", "kind", "target", "by", "label")})
    for comment in gateway.github.comment_feed(repo):
        if comment["target"] in targets and comment.get("by") != bot:
            found.append(
                {
                    "at": comment["at"],
                    "kind": "commented",
                    "target": comment["target"],
                    "by": comment.get("by"),
                }
            )
    open_bot_pulls = [
        pull
        for pull in gateway.scans.cached_pulls(repo)
        if pull.get("author") == bot and pull.get("state") == "open"
    ]
    if open_bot_pulls:
        # Unscoped by `since`: a branch-push older than `since` still marks an open bot PR as
        # gateway-owned. Bounded by journal.keepDays and skipped whenever no bot PR is open.
        pushed = {
            row["target"]: row
            for row in journal_rows(gateway, repo)
            if row["command"] == "branch-push" and row["success"]
        }
        for pull in open_bot_pulls:
            ref = f"refs/heads/{pull.get('branch')}"
            if ref not in pushed:
                continue
            head = gateway.github.ref(repo, ref)
            if head != pull["head"]:
                # The scan may be from before the gateway's own push or a merge the queue made:
                # confirm with a fresh read that the pull request is still open at another head.
                current = gateway.github.pull(repo, pull["number"])
                if current and gateway.pull_state(current) == "open" and head != current["head"]:
                    found.append({"at": None, "kind": "pushed", "target": f"pr#{pull['number']}"})
    found = [
        {key: value for key, value in row.items() if value is not None}
        for row in found
        if start is None
        or row.get("at") is None
        or (parsed := parse_time(row["at"])) is None
        or parsed >= start
    ]
    return sorted(found, key=lambda row: row.get("at") or "")


def gateway_audit(
    gateway: Gateway, repo: str, filters: dict[str, Any], limit: int, cursor: str | None
) -> CommandResult[Any]:
    gateway.repo(repo)
    try:
        start = parse_time(filters.get("since"))
    except ValueError:
        raise refuse(
            "VALIDATION_ERROR",
            f"since {filters['since']!r} is not an ISO 8601 time",
            "Pass a time such as 2030-02-03T09:00:00Z",
        ) from None
    wanted = {f"issue#{filters['issue']}"} if filters.get("issue") is not None else set()
    wanted |= {f"pr#{filters['pr']}"} if filters.get("pr") is not None else set()
    rows = []
    for row in journal_rows(gateway, repo, since=start):
        if wanted and not wanted & set(row["targets"]):
            continue
        if start and (ts := parse_time(row["timestamp"])) is not None and ts < start:
            continue
        if filters.get("actor") and row["actor"].get("id") != filters["actor"]:
            continue
        rows.append({key: value for key, value in row.items() if key != "targets"})
    offset = gateway.offset(cursor)
    data: dict[str, Any] = {
        "entries": rows[offset : offset + limit],
        "outside": [
            row
            for row in outside_writes(gateway, repo, filters.get("since"))
            if not wanted or row["target"] in wanted
        ],
    }
    if offset + limit < len(rows):
        data["nextCursor"] = str(offset + limit)
    return success(
        data,
        reasoning=f"{len(data['entries'])} of {len(rows)} gateway writes, "
        f"{len(data['outside'])} outside the gateway",
    )


# ── review records (G2) ────────────────────────────────────────────────────


def review_record(
    gateway: Gateway, repo: str, branch: str, head: str, lanes: list[dict[str, Any]]
) -> CommandResult[Any]:
    gateway.repo(repo)
    gateway.text(
        **{f"lanes[{i}]": " ".join(str(v) for v in lane.values()) for i, lane in enumerate(lanes)}
    )
    verdict = "pass" if lanes and all(lane["verdict"] == "pass" for lane in lanes) else "fail"
    record = {
        "head": head,
        "branch": branch,
        "verdict": verdict,
        "lanes": lanes,
        "recordedAt": iso(gateway.now()),
    }
    reviews = dict(gateway.state.get("reviews", {}))
    reviews[head] = record
    gateway.spend("review-record")
    gateway.state.put("reviews", reviews)
    return success(
        {"record": {key: record[key] for key in ("head", "verdict", "lanes")}},
        reasoning=f"Recorded a {verdict} review of {head[:12]}; {REVIEW} is published when "
        "the head is pushed",
    )


def review_get(gateway: Gateway, repo: str, head: str) -> CommandResult[Any]:
    gateway.repo(repo)
    record = gateway.state.get("reviews", {}).get(head)
    if record is None:
        raise refuse(
            "NOT_FOUND",
            f"No review is recorded for {head}",
            "Record the review with review-record for this exact head; a head that moved "
            "after review has none",
        )
    return success(
        {key: record[key] for key in ("head", "verdict", "lanes", "recordedAt")},
        reasoning=f"{head[:12]} was reviewed: {record['verdict']}",
    )


# ── events (G3) ────────────────────────────────────────────────────────────


def events(gateway: Gateway, repo: str, kinds: set[str] | None = None) -> list[dict[str, Any]]:
    found = []
    for pull in gateway.scans.cached_pulls(repo):
        number, state = pull["number"], gateway.pull_state(pull)
        if state == "merged":
            found.append(
                {
                    "id": f"pr-merged:{number}",
                    "kind": "pr-merged",
                    "target": f"pr#{number}",
                    "at": pull.get("mergedAt"),
                }
            )
        elif state == "open":
            check = gateway.required_check(repo, pull)
            if check["state"] in {"passed", "failed", "stalled"}:
                kind = f"checks-{check['state']}"
                found.append(
                    {
                        "id": f"{kind}:{number}:{pull['head']}",
                        "kind": kind,
                        "target": f"pr#{number}",
                        "at": iso(gateway.now()),
                        "detail": check,
                    }
                )
    for comment in gateway.github.comment_feed(repo):
        if comment.get("by") == gateway.config.owner:
            found.append(
                {
                    "id": f"owner-commented:{comment.get('id') or comment['at']}",
                    "kind": "owner-commented",
                    "target": comment["target"],
                    "at": comment["at"],
                    "sharedAccount": True,
                }
            )
    if kinds is None or "outside-write" in kinds:
        for row in outside_writes(gateway, repo, None):
            found.append(
                {
                    "id": f"outside-write:{row.get('at')}:{row['target']}:{row['kind']}",
                    "kind": "outside-write",
                    "target": row["target"],
                    "at": row.get("at"),
                    "detail": row,
                }
            )
    return sorted(found, key=lambda event: event.get("at") or "")


async def gateway_wait(
    gateway: Gateway, repo: str, consumer: str, kinds: list[str] | None, timeout_ms: int
) -> CommandResult[Any]:
    gateway.repo(repo)
    unknown = sorted(set(kinds or ()) - set(EVENT_KINDS))
    if unknown:
        return error(
            "VALIDATION_ERROR",
            f"Unknown event kinds: {', '.join(unknown)}",
            suggestion=f"Use kinds from: {', '.join(EVENT_KINDS)}",
        )
    timeout_ms = min(timeout_ms, gateway.config.wait_max_ms)
    delivered = dict(gateway.state.get("delivered", {}))
    seen = set(delivered.get(consumer, []))
    wanted = set(kinds) if kinds else None

    def fresh() -> list[dict[str, Any]]:
        return [
            event
            for event in events(gateway, repo, wanted)
            if event["id"] not in seen and (not wanted or event["kind"] in wanted)
        ]

    found = await asyncio.to_thread(fresh)  # GitHub reads block; keep the event loop free.
    if not found:
        await asyncio.sleep(timeout_ms / 1000)
        gateway.scans.refresh(repo)  # A wait reads GitHub again, past the shared scans.
        found = await asyncio.to_thread(fresh)
    if not found:
        return success({"events": [], "timedOut": True}, reasoning="Nothing new before the timeout")
    with gateway.state.lock:
        delivered = dict(gateway.state.get("delivered", {}))
        delivered[consumer] = sorted(set(delivered.get(consumer, [])) | {e["id"] for e in found})
        gateway.state.put("delivered", delivered)
    rows = [
        {key: value for key, value in event.items() if key != "id"} | {"id": event["id"]}
        for event in found
    ]
    return success({"events": rows}, reasoning=f"{len(rows)} new events for {consumer}")
