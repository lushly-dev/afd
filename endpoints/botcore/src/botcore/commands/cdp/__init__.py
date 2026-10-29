"""Botcore CDP commands — Chrome debug utilities.

Modules:
- core.py: Shared utilities, session management, constants
- launcher.py: Browser launch, attach, close
- navigation.py: Navigate, wait
- interaction.py: Click, hover, scroll, drag, type, press
- inspection.py: Inspect, query, snapshot
- forms.py: Fill, upload, dialogs, page management
- diagnostics.py: Screenshot, console, network, eval, emulate
"""

from botcore.commands.cdp.core import (
    DEEP_QUERY_SINGLE_JS,
    DEFAULT_TIMEOUT_MS,
    CdpSession,
    ConsoleEntry,
)
from botcore.commands.cdp.diagnostics import (
    cdp_console,
    cdp_emulate,
    cdp_eval,
    cdp_get_console_message,
    cdp_get_network,
    cdp_list_network,
    cdp_screenshot,
    cdp_trace_capture,
    cdp_trace_query,
    cdp_trace_summary,
)
from botcore.commands.cdp.forms import (
    cdp_close_page,
    cdp_fill,
    cdp_fill_form,
    cdp_handle_dialog,
    cdp_list_pages,
    cdp_new_page,
    cdp_resize,
    cdp_select_page,
    cdp_upload,
)
from botcore.commands.cdp.inspection import (
    cdp_inspect,
    cdp_query,
    cdp_snapshot,
)
from botcore.commands.cdp.interaction import (
    cdp_click,
    cdp_drag,
    cdp_hover,
    cdp_press,
    cdp_scroll,
    cdp_type,
)
from botcore.commands.cdp.launcher import (
    cdp_attach,
    cdp_close,
    cdp_launch,
)
from botcore.commands.cdp.navigation import (
    cdp_navigate,
    cdp_wait,
)

__all__ = [
    # Core
    "CdpSession",
    "ConsoleEntry",
    "DEFAULT_TIMEOUT_MS",
    "DEEP_QUERY_SINGLE_JS",
    # Launcher
    "cdp_launch",
    "cdp_attach",
    "cdp_close",
    # Navigation
    "cdp_navigate",
    "cdp_wait",
    # Interaction
    "cdp_click",
    "cdp_hover",
    "cdp_scroll",
    "cdp_drag",
    "cdp_type",
    "cdp_press",
    # Inspection
    "cdp_inspect",
    "cdp_query",
    "cdp_snapshot",
    # Forms
    "cdp_fill",
    "cdp_fill_form",
    "cdp_upload",
    "cdp_handle_dialog",
    "cdp_list_pages",
    "cdp_select_page",
    "cdp_new_page",
    "cdp_close_page",
    "cdp_resize",
    # Diagnostics
    "cdp_screenshot",
    "cdp_trace_capture",
    "cdp_trace_query",
    "cdp_trace_summary",
    "cdp_console",
    "cdp_get_console_message",
    "cdp_eval",
    "cdp_list_network",
    "cdp_get_network",
    "cdp_emulate",
]
