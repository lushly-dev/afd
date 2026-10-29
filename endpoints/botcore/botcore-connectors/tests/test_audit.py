"""Tests for audit logging — spec 04."""

from __future__ import annotations

import json
import logging

import pytest
from pydantic import ValidationError

from botcore_connectors.audit import AuditLogEntry, AuditLogger, sanitize_args

# ---------------------------------------------------------------------------
# sanitize_args
# ---------------------------------------------------------------------------


class TestSanitizeArgs:
    def test_clean_args(self) -> None:
        result = sanitize_args({"repo": "octocat/hello", "page": 1})
        parsed = json.loads(result)
        assert parsed["repo"] == "octocat/hello"
        assert parsed["page"] == 1

    def test_token_redacted(self) -> None:
        result = sanitize_args({"token": "ghp_secret123"})
        assert "ghp_secret123" not in result
        assert "***REDACTED***" in result

    def test_password_redacted(self) -> None:
        result = sanitize_args({"password": "hunter2"})
        assert "hunter2" not in result
        assert "***REDACTED***" in result

    def test_authorization_redacted(self) -> None:
        result = sanitize_args({"Authorization": "Bearer xyz"})
        assert "Bearer xyz" not in result
        assert "***REDACTED***" in result

    def test_api_key_redacted(self) -> None:
        result = sanitize_args({"api_key": "sk-12345"})
        assert "sk-12345" not in result
        assert "***REDACTED***" in result

    def test_long_value_truncated(self) -> None:
        long_value = "x" * 200
        result = sanitize_args({"description": long_value})
        assert long_value not in result
        assert "..." in result

    def test_overall_truncation(self) -> None:
        # Build args that produce a very long summary
        args = {f"field_{i}": "v" * 80 for i in range(20)}
        result = sanitize_args(args, max_length=100)
        assert len(result) <= 104  # 100 + "..."

    def test_empty_dict(self) -> None:
        result = sanitize_args({})
        assert result == "{}"

    def test_secret_key_redacted(self) -> None:
        result = sanitize_args({"secret": "my-secret-value"})
        assert "my-secret-value" not in result
        assert "***REDACTED***" in result

    def test_case_insensitive_keys(self) -> None:
        result = sanitize_args({"TOKEN": "ghp_abc", "Password": "hunter2"})
        assert "ghp_abc" not in result
        assert "hunter2" not in result

    def test_nested_dict_redacts_sensitive_keys(self) -> None:
        """Recursive sanitization — nested tokens must be redacted."""
        result = sanitize_args({"headers": {"Authorization": "Bearer xxx"}})
        assert "Bearer xxx" not in result
        assert "***REDACTED***" in result

    def test_deeply_nested_redaction(self) -> None:
        args = {"config": {"inner": {"token": "secret123"}}}
        result = sanitize_args(args)
        assert "secret123" not in result
        assert "***REDACTED***" in result

    def test_nested_non_sensitive_preserved(self) -> None:
        result = sanitize_args({"config": {"repo": "a/b"}})
        parsed = json.loads(result)
        assert parsed["config"]["repo"] == "a/b"

    def test_nested_list_redacts_sensitive_keys(self) -> None:
        result = sanitize_args(
            {"items": [{"token": "abc123"}, {"Authorization": "Bearer xyz"}]}
        )
        assert "abc123" not in result
        assert "Bearer xyz" not in result
        assert "***REDACTED***" in result


# ---------------------------------------------------------------------------
# AuditLogEntry — model constraints
# ---------------------------------------------------------------------------


class TestAuditLogEntry:
    def test_fields_present(self) -> None:
        entry = AuditLogEntry(
            timestamp="2026-01-01T00:00:00Z",
            agent_id="agent-1",
            connector="github",
            command="list_issues",
            args_summary="{}",
            result_status="success",
            latency_ms=42.0,
            trace_id="abc123",
        )
        assert entry.connector == "github"
        assert entry.latency_ms == 42.0

    def test_extra_forbid(self) -> None:
        with pytest.raises(ValidationError):
            AuditLogEntry(
                timestamp="2026-01-01T00:00:00Z",
                agent_id="agent-1",
                connector="github",
                command="list_issues",
                args_summary="{}",
                result_status="success",
                latency_ms=42.0,
                trace_id="abc123",
                bonus="nope",
            )

    def test_serialization(self) -> None:
        entry = AuditLogEntry(
            timestamp="2026-01-01T00:00:00Z",
            agent_id="agent-1",
            connector="github",
            command="list_issues",
            args_summary='{"repo": "a/b"}',
            result_status="success",
            latency_ms=10.5,
            trace_id="t1",
        )
        data = json.loads(entry.model_dump_json())
        assert data["connector"] == "github"
        assert data["latency_ms"] == 10.5


# ---------------------------------------------------------------------------
# AuditLogger
# ---------------------------------------------------------------------------


class TestAuditLogger:
    def _log_entry(self, **overrides):
        defaults = {
            "agent_id": "agent-1",
            "connector": "github",
            "command": "list_issues",
            "args": {"repo": "a/b"},
            "result_status": "success",
            "latency_ms": 15.0,
            "trace_id": "trace-1",
        }
        defaults.update(overrides)
        return AuditLogger().log(**defaults)

    def test_returns_entry(self) -> None:
        entry = self._log_entry()
        assert isinstance(entry, AuditLogEntry)

    def test_emits_to_logger(self, caplog) -> None:
        with caplog.at_level(logging.INFO, logger="botcore.connectors.audit"):
            self._log_entry()
        assert len(caplog.records) == 1
        assert "github" in caplog.records[0].message

    def test_correct_fields(self) -> None:
        entry = self._log_entry(connector="azure", command="upload_blob")
        assert entry.connector == "azure"
        assert entry.command == "upload_blob"
        assert entry.agent_id == "agent-1"
        assert entry.trace_id == "trace-1"

    def test_args_sanitized(self) -> None:
        entry = self._log_entry(args={"token": "ghp_secret"})
        assert "ghp_secret" not in entry.args_summary
        assert "***REDACTED***" in entry.args_summary

    def test_no_credentials_in_output(self, caplog) -> None:
        with caplog.at_level(logging.INFO, logger="botcore.connectors.audit"):
            self._log_entry(args={"password": "s3cret", "repo": "a/b"})
        log_text = caplog.records[0].message
        assert "s3cret" not in log_text
        assert "***REDACTED***" in log_text

    def test_logging_failure_does_not_raise(self, monkeypatch) -> None:
        audit_logger = AuditLogger()

        def _boom(_msg):
            raise OSError("disk full")

        monkeypatch.setattr(
            "botcore_connectors.audit.logger.info", _boom
        )
        # Should not raise
        entry = audit_logger.log(
            agent_id="a",
            connector="c",
            command="cmd",
            args={},
            result_status="ok",
            latency_ms=1.0,
            trace_id="t",
        )
        assert isinstance(entry, AuditLogEntry)
