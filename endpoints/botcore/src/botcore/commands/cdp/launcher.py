"""CDP launcher — browser launch, attach, and close commands."""

from __future__ import annotations

import os
import signal
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.cdp.core import (
    CdpSession,
    _clear_session,
    _connect_over_cdp_with_retry,
    _default_profile_dir,
    _get_chromium_executable,
    _get_free_port,
    _load_session,
    _now_iso,
    _probe_cdp,
    _save_session,
    _session_root,
    _spawn_chrome,
)


async def cdp_launch(
    url: str | None = None,
    headless: bool = False,
    port: int | None = None,
    profile_dir: str | None = None,
    force: bool = False,
) -> CommandResult[dict]:
    """Launch Chromium with CDP enabled."""
    root = _session_root()
    if _load_session(root) and not force:
        return error(
            "CDP_SESSION_EXISTS",
            "A CDP session already exists for this workspace.",
            suggestion="Run `botcore cdp close` or re-run with --force.",
        )

    port = port or _get_free_port()
    endpoint = f"http://127.0.0.1:{port}"
    profile_dir_path = Path(profile_dir) if profile_dir else _default_profile_dir(root)

    try:
        chrome_path = await _get_chromium_executable()
    except Exception as exc:
        return error(
            "CHROME_NOT_AVAILABLE",
            f"Failed to locate Playwright Chromium: {exc}",
            suggestion="Run `playwright install` to download browsers.",
        )

    if not Path(chrome_path).exists():
        return error(
            "CHROME_NOT_AVAILABLE",
            "Playwright Chromium executable not found.",
            suggestion="Run `playwright install` to download browsers.",
        )

    args = [
        chrome_path,
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        f"--user-data-dir={profile_dir_path}",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    if headless:
        args.append("--headless=new")
    if url:
        args.append(url)

    process = _spawn_chrome(args)
    try:
        await _probe_cdp(endpoint)
    except Exception as exc:
        try:
            if process.pid:
                os.kill(process.pid, signal.SIGTERM)
        except Exception:
            pass
        return error(
            "CDP_LAUNCH_FAILED",
            f"Chrome started but CDP endpoint not ready: {exc}",
            suggestion="Retry with --profile-dir under LOCALAPPDATA or check if Chrome is blocked.",
            details={"profile_dir": str(profile_dir_path), "cdp_endpoint": endpoint},
        )

    session = CdpSession(
        cdp_endpoint=endpoint,
        profile_dir=str(profile_dir_path),
        launched_at=_now_iso(),
        pid=process.pid,
    )
    _save_session(root, session)

    return success(
        data={
            "cdp_endpoint": endpoint,
            "profile_dir": str(profile_dir_path),
            "pid": process.pid,
            "headless": headless,
        },
        reasoning="Launched Chrome with CDP enabled.",
    )


async def cdp_attach(
    endpoint: str | None = None,
    port: int | None = None,
    profile_dir: str | None = None,
    force: bool = False,
) -> CommandResult[dict]:
    """Attach to an existing CDP endpoint."""
    root = _session_root()
    if _load_session(root) and not force:
        return error(
            "CDP_SESSION_EXISTS",
            "A CDP session already exists for this workspace.",
            suggestion="Run `botcore cdp close` or re-run with --force.",
        )

    if not endpoint and port:
        endpoint = f"http://127.0.0.1:{port}"
    if not endpoint:
        return error(
            "CDP_ENDPOINT_REQUIRED",
            "Provide --endpoint or --port to attach.",
            suggestion="Example: botcore cdp attach --port 9222",
        )

    try:
        await _probe_cdp(endpoint)
    except Exception as exc:
        return error(
            "CDP_CONNECT_FAILED",
            f"Failed to reach CDP endpoint: {exc}",
            suggestion="Verify Chrome is running with remote debugging enabled.",
        )

    profile_path = Path(profile_dir) if profile_dir else _default_profile_dir(root)
    session = CdpSession(
        cdp_endpoint=endpoint,
        profile_dir=str(profile_path),
        launched_at=_now_iso(),
        pid=None,
    )
    _save_session(root, session)

    return success(
        data={"cdp_endpoint": endpoint, "profile_dir": str(profile_path)},
        reasoning="Attached to existing Chrome CDP endpoint.",
    )


async def cdp_close() -> CommandResult[dict]:
    """Close the active CDP session."""
    from playwright.async_api import async_playwright

    root = _session_root()
    session = _load_session(root)
    if not session:
        return error(
            "CDP_SESSION_NOT_FOUND",
            "No active CDP session found.",
            suggestion="Run `botcore cdp launch` or `botcore cdp attach` first.",
        )

    if session.pid:
        try:
            os.kill(session.pid, signal.SIGTERM)
        except Exception as exc:
            return error(
                "CDP_CLOSE_FAILED",
                f"Failed to close Chrome session: {exc}",
                suggestion="Manually close Chrome or remove session file.",
            )
        _clear_session(root)
        return success(
            data={"closed": True, "pid": session.pid},
            reasoning="Closed Chrome session started by botcore.",
        )

    try:
        async with async_playwright() as playwright:
            browser = await _connect_over_cdp_with_retry(playwright, session.cdp_endpoint)
            await browser.close()
    except Exception as exc:
        return error(
            "CDP_CLOSE_FAILED",
            f"Failed to close Chrome session: {exc}",
            suggestion="Manually close Chrome or remove session file.",
        )
    _clear_session(root)
    return success(data={"closed": True}, reasoning="Closed Chrome CDP session.")
