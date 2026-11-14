"""Claim comments: written, read back, superseded, released and expired."""

from __future__ import annotations

from datetime import UTC, datetime

from botcore_factory.claims import (
    Claim,
    claim_body,
    current_claim,
    format_time,
    parse_time,
    release_body,
)
from botcore_factory.world import Comment

CLAIM = Claim("fix/x", "workstation", "2030-01-04T00:00:00Z")


def comments(*bodies: str) -> list[Comment]:
    return [Comment(str(i), body) for i, body in enumerate(bodies)]


def test_a_claim_comment_reads_back_and_reads_well():
    body = claim_body(CLAIM)
    assert current_claim(comments("hello", body)) == CLAIM
    assert "branch `fix/x` on `workstation`" in body and "2030-01-04T00:00:00Z" in body


def test_the_latest_claim_wins_and_a_release_ends_it():
    later = Claim("fix/y", "laptop", "2030-01-05T00:00:00Z")
    assert current_claim(comments(claim_body(CLAIM), claim_body(later))) == later
    assert current_claim(comments(claim_body(CLAIM), release_body("fix/x", "dropped"))) is None
    # A release for another branch leaves the claim standing.
    assert current_claim(comments(claim_body(CLAIM), release_body("fix/z", "x"))) == CLAIM


def test_markers_this_plugin_did_not_write_are_not_claims():
    assert current_claim(comments("no marker")) is None
    assert current_claim(comments("<!-- botcore-factory:claim {not json} -->")) is None
    assert current_claim(comments('<!-- botcore-factory:claim {"branch": "b"} -->')) is None
    bad_lease = '<!-- botcore-factory:claim {"branch":"b","machine":"m","leaseUntil":"soon"} -->'
    assert current_claim(comments(bad_lease)) is None


def test_a_lease_expires_at_its_time():
    assert not CLAIM.expired(parse_time("2030-01-03T23:59:59Z"))
    assert CLAIM.expired(parse_time("2030-01-04T00:00:00Z"))


def test_times_are_utc_with_z():
    assert format_time(datetime(2030, 1, 4, tzinfo=UTC)) == "2030-01-04T00:00:00Z"
    assert parse_time("2030-01-04T00:00:00").tzinfo is not None
