"""Claim comments: written, read back, superseded, released and expired."""

from __future__ import annotations

from datetime import UTC, datetime

from botcore_factory.claims import (
    Claim,
    claim_body,
    current_claim,
    format_time,
    live_claim_beside,
    parse_time,
    release_body,
)
from botcore_factory.world import Comment

CLAIM = Claim("fix/x", "workstation", "2030-01-04T00:00:00Z")


def read_claim(*bodies: str, at: str = "2030-01-03T00:00:00Z") -> Claim | None:
    return current_claim([Comment(str(i), body) for i, body in enumerate(bodies)], parse_time(at))


def test_a_claim_comment_reads_back_and_reads_well():
    body = claim_body(CLAIM)
    assert read_claim("hello", body) == CLAIM
    assert "branch `fix/x` on `workstation`" in body and "2030-01-04T00:00:00Z" in body


def test_earliest_live_claim_wins_and_the_latest_expired_claim_remains_reportable():
    later = Claim("fix/y", "laptop", "2030-01-05T00:00:00Z")
    history = (claim_body(CLAIM), claim_body(later))
    assert read_claim(*history) == CLAIM
    assert read_claim(*reversed(history)) == later
    assert read_claim(*history, at=CLAIM.lease_until) == later
    assert read_claim(*reversed(history), at=CLAIM.lease_until) == later
    assert read_claim(*history, at=later.lease_until) == later
    assert read_claim(claim_body(CLAIM), release_body("fix/x", "dropped")) is None
    # A release for another branch leaves the claim standing.
    assert read_claim(claim_body(CLAIM), release_body("fix/z", "x")) == CLAIM


def test_a_renewal_reports_the_new_lease_and_holds_its_place_while_the_first_lease_runs():
    rival = Claim("fix/y", "workstation", "2030-01-05T00:00:00Z")
    renewed = Claim(CLAIM.branch, "laptop", "2030-01-06T00:00:00Z")
    history = (claim_body(CLAIM), claim_body(rival), claim_body(renewed))
    assert read_claim(*history) == renewed
    assert read_claim(claim_body(CLAIM), claim_body(renewed)) == renewed
    # A renewal is a new claim: once the first lease lapses, the rival that claimed between
    # holds. scripts/issue-claim.mjs reads the same; keeping the place is not decided.
    assert read_claim(*history, at=CLAIM.lease_until) == rival
    assert read_claim(*history, at=rival.lease_until) == renewed


def test_the_live_claim_beside_a_branch_is_the_one_left_holding_when_it_lets_go():
    rival = Claim("fix/y", "workstation", "2030-01-05T00:00:00Z")
    both = [Comment(str(i), body) for i, body in enumerate((claim_body(CLAIM), claim_body(rival)))]
    now = parse_time("2030-01-03T00:00:00Z")
    assert live_claim_beside(both, CLAIM.branch, now) == rival
    assert live_claim_beside(both, rival.branch, now) == CLAIM
    assert live_claim_beside(both[:1], CLAIM.branch, now) is None
    # A lapsed claim holds nothing, so the label may go, unless its branch has an open pull
    # request: scripts/issue-claim.mjs reads that claim as live.
    lapsed = parse_time(rival.lease_until)
    assert live_claim_beside(both, CLAIM.branch, lapsed) is None
    assert live_claim_beside(both, CLAIM.branch, lapsed, frozenset({rival.branch})) == rival


def test_a_branch_that_released_and_claims_again_goes_behind_the_rival_that_stayed():
    rival = Claim("fix/y", "workstation", "2030-01-05T00:00:00Z")
    again = Claim(CLAIM.branch, "laptop", "2030-01-06T00:00:00Z")
    history = (claim_body(CLAIM), claim_body(rival), release_body(CLAIM.branch, "x"))
    assert read_claim(*history, claim_body(again)) == rival


def test_a_release_leaves_an_earlier_claim_standing():
    # A session lost the race to CLAIM and released its own claim: CLAIM still holds.
    rival = Claim("t3/a", "hero", "2030-01-05T00:00:00Z")
    assert read_claim(claim_body(CLAIM), claim_body(rival), release_body("t3/a", "lost")) == CLAIM
    # A release naming no branch ends every claim.
    assert (
        read_claim(claim_body(CLAIM), claim_body(rival), "<!-- botcore-factory:release {} -->")
        is None
    )


def test_markers_this_plugin_did_not_write_are_not_claims():
    assert read_claim("no marker") is None
    assert read_claim("<!-- botcore-factory:claim {not json} -->") is None
    assert read_claim('<!-- botcore-factory:claim {"branch": "b"} -->') is None
    bad_lease = '<!-- botcore-factory:claim {"branch":"b","machine":"m","leaseUntil":"soon"} -->'
    assert read_claim(bad_lease) is None


def test_a_lease_expires_at_its_time():
    assert not CLAIM.expired(parse_time("2030-01-03T23:59:59Z"))
    assert CLAIM.expired(parse_time("2030-01-04T00:00:00Z"))


def test_times_are_utc_with_z():
    assert format_time(datetime(2030, 1, 4, tzinfo=UTC)) == "2030-01-04T00:00:00Z"
    assert parse_time("2030-01-04T00:00:00").tzinfo is not None
