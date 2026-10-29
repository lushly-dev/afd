"""CDP core utilities — shared across all CDP modules."""

from __future__ import annotations

import json
import os
import socket
import subprocess
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypeVar

from afd import CommandResult, error, success
from pydantic import BaseModel, Field

from botcore.utils.runner import retry_async
from botcore.utils.workspace import find_workspace

T = TypeVar("T")

SESSION_DIRNAME = ".botcore"
SESSION_FILENAME = "cdp-session.json"
PROFILE_DIRNAME = "chrome-profile"
SCREENSHOTS_DIRNAME = "screenshots"
TRACES_DIRNAME = "traces"
DEFAULT_TIMEOUT_MS = 30_000

DEEP_QUERY_SINGLE_JS = """
(selector) => {
    function querySelectorDeep(root, sel) {
        let result = root.querySelector(sel);
        if (result) return result;
        const elements = root.querySelectorAll('*');
        for (const el of elements) {
            if (el.shadowRoot) {
                result = querySelectorDeep(el.shadowRoot, sel);
                if (result) return result;
            }
        }
        return null;
    }
    return querySelectorDeep(document, selector);
}
"""


class ConsoleEntry(BaseModel):
    """Captured console log entry."""

    timestamp: str
    level: str
    text: str
    url: str | None = None


class CdpSession(BaseModel):
    """CDP session metadata stored on disk."""

    cdp_endpoint: str
    profile_dir: str
    launched_at: str
    pid: int | None = None
    console_log: list[ConsoleEntry] = Field(default_factory=list)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _session_root() -> Path:
    return find_workspace() or Path.cwd()


def _session_dir(root: Path) -> Path:
    return root / SESSION_DIRNAME


def _session_file(root: Path) -> Path:
    return _session_dir(root) / SESSION_FILENAME


def _ensure_session_dir(root: Path) -> Path:
    session_dir = _session_dir(root)
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def _default_profile_dir(root: Path) -> Path:
    root_drive = root.drive.rstrip("\\").lower()
    localapp_drive = os.getenv("LOCALAPPDATA", "").split(":")[0].lower()
    if root_drive and localapp_drive and root_drive != localapp_drive:
        profile_root = Path(os.getenv("LOCALAPPDATA", "")) / "botcore"
        profile_root.mkdir(parents=True, exist_ok=True)
        return profile_root / PROFILE_DIRNAME
    return _ensure_session_dir(root) / PROFILE_DIRNAME


def _default_screenshots_dir(root: Path) -> Path:
    return _ensure_session_dir(root) / SCREENSHOTS_DIRNAME


def _default_traces_dir(root: Path) -> Path:
    return _ensure_session_dir(root) / TRACES_DIRNAME


def _load_session(root: Path) -> CdpSession | None:
    session_path = _session_file(root)
    if not session_path.exists():
        return None
    try:
        data = json.loads(session_path.read_text(encoding="utf-8"))
        return CdpSession(**data)
    except Exception:
        return None


def _save_session(root: Path, session: CdpSession) -> None:
    session_path = _session_file(root)
    _ensure_session_dir(root)
    session_path.write_text(session.model_dump_json(indent=2), encoding="utf-8")


def _clear_session(root: Path) -> None:
    session_path = _session_file(root)
    if session_path.exists():
        session_path.unlink()


def _get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def _probe_cdp(
    endpoint: str,
    timeout_s: float = 5.0,
    attempts: int = 20,
    delay_s: float = 0.5,
) -> None:
    """Probe CDP endpoint until it responds."""
    import httpx

    url = f"{endpoint.rstrip('/')}/json/version"

    async def _check() -> None:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.get(url)
            response.raise_for_status()

    await retry_async(_check, attempts=attempts, delay_s=delay_s)


def _spawn_chrome(args: list[str]) -> subprocess.Popen[bytes]:
    popen_kwargs: dict[str, Any] = {
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if os.name == "nt":
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        popen_kwargs["start_new_session"] = True
    return subprocess.Popen(args, **popen_kwargs)


async def _get_chromium_executable() -> str:
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        return playwright.chromium.executable_path


async def _connect_over_cdp_with_retry(
    playwright: Any,
    endpoint: str,
    attempts: int = 10,
    delay_s: float = 0.3,
) -> Any:
    return await retry_async(
        lambda: playwright.chromium.connect_over_cdp(endpoint),
        attempts=attempts,
        delay_s=delay_s,
    )


async def _with_session_page(
    action: Callable[[Any], Awaitable[T]],
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
) -> CommandResult[T]:
    """Connect to active CDP session and run action on current page."""
    from playwright.async_api import async_playwright

    root = _session_root()
    session = _load_session(root)
    if not session:
        return error(
            "CDP_SESSION_NOT_FOUND",
            "No active CDP session found.",
            suggestion="Run `botcore cdp launch` or `botcore cdp attach` first.",
        )

    console_entries: list[ConsoleEntry] = []

    def handle_console(msg: Any) -> None:
        console_entries.append(
            ConsoleEntry(
                timestamp=_now_iso(),
                level=msg.type,
                text=msg.text,
                url=msg.location.get("url") if msg.location else None,
            )
        )

    try:
        async with async_playwright() as playwright:
            browser = await _connect_over_cdp_with_retry(playwright, session.cdp_endpoint)
            context = browser.contexts[0] if browser.contexts else await browser.new_context()
            page = context.pages[0] if context.pages else await context.new_page()
            page.on("console", handle_console)
            result = await action(page)
            if console_entries:
                session.console_log.extend(console_entries)
                _save_session(root, session)
            return success(data=result)
    except Exception as exc:
        import httpx

        if isinstance(exc, httpx.HTTPError):
            return error(
                "CDP_CONNECT_FAILED",
                f"Failed to reach CDP endpoint: {exc}",
                suggestion="Ensure Chrome is running or run `botcore cdp launch`.",
            )
        exc_str = str(exc)
        if "Timeout" in exc_str and "Locator" in exc_str:
            suggestion = "Element not found. Use `botcore cdp query` to verify selector."
        elif "Timeout" in exc_str:
            suggestion = "Operation timed out. Check if page is responsive."
        elif "Target closed" in exc_str or "Connection" in exc_str:
            suggestion = "Browser disconnected. Run `botcore cdp launch` to start a new session."
        else:
            suggestion = "Check selector and page state. Use `botcore cdp screenshot` to debug."
        return error(
            "CDP_COMMAND_FAILED",
            f"{type(exc).__name__}: {exc}",
            suggestion=suggestion,
        )
