"""Tests for authentication and authorization."""

from __future__ import annotations

from afd.testing import assert_error

from botcore_teams.auth import (
    create_unauthorized_error,
    extract_group_ids,
    extract_identity,
    validate_allowed_groups,
    validate_tenant,
)


class TestValidateTenant:
    def test_matching_tenant(self) -> None:
        assert validate_tenant("tenant-abc", "tenant-abc") is True

    def test_wrong_tenant(self) -> None:
        assert validate_tenant("wrong-tenant", "correct-tenant") is False

    def test_none_tenant(self) -> None:
        assert validate_tenant(None, "correct-tenant") is False

    def test_empty_restriction(self) -> None:
        """No restriction configured — allow all."""
        assert validate_tenant("any-tenant", "") is True

    def test_none_with_empty_restriction(self) -> None:
        assert validate_tenant(None, "") is True


class TestExtractIdentity:
    def test_standard_activity(self, sample_activity: dict) -> None:
        identity = extract_identity(sample_activity)
        assert identity.user_id == "user-aad-id-123"
        assert identity.user_name == "Test User"
        assert identity.tenant_id == "test-tenant-id"
        assert identity.roles == ("user",)

    def test_minimal_activity(self) -> None:
        identity = extract_identity({})
        assert identity.user_id == ""
        assert identity.user_name == ""
        assert identity.tenant_id == ""

    def test_fallback_to_id(self) -> None:
        """Falls back to 'id' when aadObjectId is missing."""
        activity = {
            "from": {"id": "fallback-id", "name": "User"},
            "channelData": {},
        }
        identity = extract_identity(activity)
        assert identity.user_id == "fallback-id"

    def test_roles_always_user_phase1(self) -> None:
        """Phase 1: roles are always ["user"] regardless of groups."""
        identity = extract_identity(
            {"from": {"aadObjectId": "u1", "name": "Admin"}, "channelData": {}},
            admin_groups=["Admins"],
            user_groups=["Users"],
        )
        assert identity.roles == ("user",)


class TestCreateUnauthorizedError:
    def test_returns_error_result(self) -> None:
        result = create_unauthorized_error()
        assert_error(result, "UNAUTHORIZED")
        assert result.error.retryable is False
        assert result.error.suggestion is not None


class TestAllowedGroups:
    def test_validate_allowed_groups_open_when_empty(self) -> None:
        assert validate_allowed_groups({"g1"}, []) is True

    def test_validate_allowed_groups_requires_intersection(self) -> None:
        assert validate_allowed_groups({"g1", "g2"}, ["g2", "g3"]) is True
        assert validate_allowed_groups({"g1"}, ["g2", "g3"]) is False

    def test_extract_group_ids(self) -> None:
        activity = {
            "channelData": {
                "groups": ["group-a", "group-b"],
            },
        }
        assert extract_group_ids(activity) == {"group-a", "group-b"}

    def test_extract_group_ids_handles_missing_shape(self) -> None:
        assert extract_group_ids({}) == set()
        assert extract_group_ids({"channelData": {"groups": "not-a-list"}}) == set()
