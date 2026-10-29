"""In-memory session registry for active LLM sessions."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from copilot import CopilotSession


@dataclass
class SessionEntry:
    """Metadata and handle for one active LLM session."""

    session: CopilotSession
    model: str
    tools: list[str]
    agent_name: str = ""
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    config: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        """Return a JSON-serialisable summary."""
        summary: dict[str, Any] = {
            "session_id": self.session.session_id,
            "model": self.model,
            "tools": self.tools,
            "created_at": self.created_at.isoformat(),
        }
        if self.agent_name:
            summary["agent_name"] = self.agent_name
        return summary


class SessionRegistry:
    """Thread-safe (single-event-loop) in-memory registry of active sessions."""

    def __init__(self) -> None:
        self._sessions: dict[str, SessionEntry] = {}

    def register(
        self,
        session_id: str,
        session: CopilotSession,
        *,
        model: str = "",
        tools: list[str] | None = None,
        config: dict[str, Any] | None = None,
        agent_name: str = "",
    ) -> None:
        """Register a new session.

        Args:
            session_id: Unique identifier for the session.
            session: The underlying CopilotSession.
            model: Model used for the session.
            tools: List of bridged tool names.
            config: Raw session config dict for reference.
            agent_name: Agent name for audit logging.
        """
        self._sessions[session_id] = SessionEntry(
            session=session,
            model=model,
            tools=tools or [],
            agent_name=agent_name,
            config=config or {},
        )

    def get(self, session_id: str) -> SessionEntry | None:
        """Return the entry for *session_id*, or ``None``."""
        return self._sessions.get(session_id)

    def remove(self, session_id: str) -> SessionEntry | None:
        """Remove and return the entry for *session_id*, or ``None``."""
        return self._sessions.pop(session_id, None)

    def list_all(self) -> list[dict[str, Any]]:
        """Return summary dicts for all registered sessions."""
        return [entry.summary() for entry in self._sessions.values()]


# Module-level singleton
_registry = SessionRegistry()


def get_session_registry() -> SessionRegistry:
    """Return the module-level session registry singleton."""
    return _registry
