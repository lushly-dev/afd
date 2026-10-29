"""Audit logging infrastructure for connector commands."""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger("botcore.connectors.audit")

_SENSITIVE_KEYS = frozenset({"token", "password", "secret", "authorization", "api_key"})
_REDACTED = "***REDACTED***"
_MAX_VALUE_LENGTH = 100
_MAX_SUMMARY_LENGTH = 512


def _sanitize_value(key: str, value: Any) -> Any:
    """Recursively sanitize a single value, redacting sensitive keys."""
    if key.lower() in _SENSITIVE_KEYS:
        return _REDACTED
    if isinstance(value, dict):
        return {k: _sanitize_value(k, v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_sanitize_value("", item) for item in value]
    if isinstance(value, str) and len(value) > _MAX_VALUE_LENGTH:
        return value[:_MAX_VALUE_LENGTH] + "..."
    return value


def sanitize_args(args: dict[str, Any], *, max_length: int = _MAX_SUMMARY_LENGTH) -> str:
    """Produce a JSON-safe summary of *args* with secrets redacted.

    Sanitization is recursive — sensitive keys inside nested dicts are also
    redacted.
    """
    sanitized = {k: _sanitize_value(k, v) for k, v in args.items()}
    summary = json.dumps(sanitized, default=str, ensure_ascii=False)
    if len(summary) > max_length:
        summary = summary[:max_length] + "..."
    return summary


class AuditLogEntry(BaseModel, extra="forbid"):
    """Single audit log record for a connector command invocation."""

    timestamp: str
    agent_id: str
    connector: str
    command: str
    args_summary: str
    result_status: str
    latency_ms: float
    trace_id: str


class AuditLogger:
    """Emits structured audit log entries for connector commands."""

    def log(
        self,
        *,
        agent_id: str,
        connector: str,
        command: str,
        args: dict[str, Any],
        result_status: str,
        latency_ms: float,
        trace_id: str,
    ) -> AuditLogEntry:
        """Create and emit an audit log entry. Returns the entry for inspection."""
        entry = AuditLogEntry(
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            agent_id=agent_id,
            connector=connector,
            command=command,
            args_summary=sanitize_args(args),
            result_status=result_status,
            latency_ms=latency_ms,
            trace_id=trace_id,
        )
        try:
            logger.info(entry.model_dump_json())
        except Exception:  # noqa: BLE001
            pass  # audit failures never crash the command pipeline
        return entry
