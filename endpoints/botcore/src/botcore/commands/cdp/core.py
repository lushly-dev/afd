"""CDP core utilities — shared across all CDP modules."""

from __future__ import annotations

import hashlib
import json
import os
import socket
import subprocess
import threading
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypeVar

from afd import CommandResult, error, success
from pydantic import BaseModel, Field

from botcore.commands.disk.lock import waited_lock
from botcore.utils.runner import retry_async
from botcore.utils.workspace import find_workspace

T = TypeVar("T")

SESSION_DIRNAME = ".botcore"
SESSION_FILENAME = "cdp-session.json"
SESSION_LOCK_FILENAME = "cdp-session.lock"
PROFILE_DIRNAME = "chrome-profile"
SCREENSHOTS_DIRNAME = "screenshots"
TRACES_DIRNAME = "traces"
DEFAULT_TIMEOUT_MS = 30_000
_SESSION_THREAD_LOCK = threading.Lock()

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
    selected_page: int = 0
    selected_target_id: str | None = None
    viewport: dict[str, int] | None = None
    color_scheme: str | None = None
    user_agent: str | None = None
    offline: bool = False
    cpu_throttle: float | None = None


class SelectedPageClosedError(RuntimeError):
    """Raised when the previously selected CDP tab target is no longer open."""


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
        profile_root = Path(os.getenv("LOCALAPPDATA", "")) / "botcore" / "chrome-profiles"
        profile_root.mkdir(parents=True, exist_ok=True)
        # Scope each workspace/target to its own profile so separate targets never share
        # cookies, logins or Chrome's SingletonLock on Windows.
        scope_key = hashlib.sha256(str(root.resolve()).lower().encode("utf-8")).hexdigest()[:12]
        return profile_root / f"{PROFILE_DIRNAME}-{scope_key}"
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
    tmp = session_path.with_name(f"{SESSION_FILENAME}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(session.model_dump_json(indent=2), encoding="utf-8")
    os.replace(tmp, session_path)


def _update_session(root: Path, mutate: Callable[[CdpSession], None]) -> CdpSession | None:
    """Apply a field-level update to the session file under a lock with atomic replace."""
    lock_path = _ensure_session_dir(root) / SESSION_LOCK_FILENAME
    with _SESSION_THREAD_LOCK, waited_lock(lock_path, 5.0):
        session = _load_session(root)
        if session is None:
            return None
        mutate(session)
        _save_session(root, session)
        return session


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
        popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
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


def _all_pages(browser: Any) -> list[Any]:
    """Return every open page across all browser contexts."""
    return [page for context in browser.contexts for page in context.pages]


async def _page_target_id(page: Any) -> str | None:
    """Resolve a page's stable CDP targetId, or None if the backend does not expose one."""
    context = getattr(page, "context", None)
    new_cdp = getattr(context, "new_cdp_session", None)
    if not callable(new_cdp):
        return None
    try:
        cdp = await new_cdp(page)
        info = await cdp.send("Target.getTargetInfo")
    except Exception:
        return None
    target_id = (info or {}).get("targetInfo", {}).get("targetId")
    return str(target_id) if isinstance(target_id, str) and target_id else None


async def _select_session_page(browser: Any, session: CdpSession) -> Any:
    """Return the session's selected page by stable targetId (when recorded) or index."""
    pages = _all_pages(browser)
    if session.selected_target_id:
        for page in pages:
            if await _page_target_id(page) == session.selected_target_id:
                return page
        raise SelectedPageClosedError(
            f"Selected page (target {session.selected_target_id}) is no longer open."
        )
    if pages:
        index = session.selected_page if 0 <= session.selected_page < len(pages) else 0
        return pages[index]
    context = browser.contexts[0] if browser.contexts else await browser.new_context()
    return await context.new_page()


async def _apply_session_overrides(page: Any, session: CdpSession) -> None:
    """Re-apply persisted viewport and emulation overrides on a new CDP connection."""
    if session.viewport:
        await page.set_viewport_size(session.viewport)
    if session.color_scheme:
        await page.emulate_media(color_scheme=session.color_scheme)
    if session.offline:
        await page.context.set_offline(True)
    if session.user_agent or session.cpu_throttle is not None:
        cdp = await page.context.new_cdp_session(page)
        if session.user_agent:
            await cdp.send("Emulation.setUserAgentOverride", {"userAgent": session.user_agent})
        if session.cpu_throttle is not None:
            await cdp.send("Emulation.setCPUThrottlingRate", {"rate": session.cpu_throttle})


def _cdp_exception_result(exc: Exception) -> CommandResult[Any]:
    """Map CDP/Playwright exceptions to structured CommandResult failures."""
    if isinstance(exc, SelectedPageClosedError):
        return error(
            "CDP_SELECTED_PAGE_CLOSED",
            str(exc),
            suggestion=(
                "Run `botcore cdp list-pages` and `botcore cdp select-page <index>` "
                "to select an open tab."
            ),
        )
    try:
        import httpx

        is_http_error = isinstance(exc, httpx.HTTPError)
    except ImportError:
        is_http_error = False

    exc_str = str(exc)
    if is_http_error or "ECONNREFUSED" in exc_str or "connect_over_cdp" in exc_str:
        return error(
            "CDP_CONNECT_FAILED",
            f"Failed to reach CDP endpoint: {exc}",
            suggestion="Ensure Chrome is running or run `botcore cdp launch`.",
        )
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


async def _with_session_browser(
    action: Callable[[Any, CdpSession, Path], Awaitable[Any]],
) -> CommandResult[Any]:
    """Connect to active CDP session and run *action(browser, session, root)*."""
    from playwright.async_api import async_playwright

    root = _session_root()
    session = _load_session(root)
    if not session:
        return error(
            "CDP_SESSION_NOT_FOUND",
            "No active CDP session found.",
            suggestion="Run `botcore cdp launch` or `botcore cdp attach` first.",
        )

    try:
        async with async_playwright() as playwright:
            browser = await _connect_over_cdp_with_retry(playwright, session.cdp_endpoint)
            outcome = await action(browser, session, root)
            if isinstance(outcome, CommandResult):
                return outcome
            return success(data=outcome)
    except Exception as exc:
        return _cdp_exception_result(exc)


async def _with_session_page(
    action: Callable[[Any], Awaitable[T]],
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
    *,
    apply_overrides: bool = True,
) -> CommandResult[T]:
    """Connect to active CDP session and run action on the selected page."""
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
            page = await _select_session_page(browser, session)
            if apply_overrides:
                await _apply_session_overrides(page, session)
            page.on("console", handle_console)
            result = await action(page)
            if console_entries:
                _update_session(root, lambda current: current.console_log.extend(console_entries))
            if isinstance(result, CommandResult):
                return result
            return success(data=result)
    except Exception as exc:
        return _cdp_exception_result(exc)
