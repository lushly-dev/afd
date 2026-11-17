"""An MCP SDK server whose tools answer ``input_required`` (MCP 2026-07-28).

``wipe-run`` asks for a confirmation through a form elicitation; ``state-run`` asks
with ``requestState`` only. Mirrors the server in packages/client/src/elicitation.test.ts.

Usage: elicitation_server.py <port> [ignored...]
"""

import json
import sys

import uvicorn
from mcp.server.lowlevel import Server
from mcp.types import (
    CallToolResult,
    ElicitRequest,
    ElicitRequestFormParams,
    ElicitResult,
    InputRequiredResult,
    ListToolsResult,
    TextContent,
    Tool,
)

SCHEMA = {
    "type": "object",
    "properties": {"confirm": {"type": "boolean"}},
    "required": ["confirm"],
}


async def list_tools(ctx, params):
    return ListToolsResult(
        tools=[
            Tool(name="wipe-run", description="Wipe", input_schema={"type": "object"}),
            Tool(name="state-run", description="Needs state", input_schema={"type": "object"}),
        ]
    )


async def call_tool(ctx, params):
    if params.name == "state-run":
        return InputRequiredResult(request_state="opaque")
    answer = (params.input_responses or {}).get("confirm")
    if isinstance(answer, ElicitResult) and answer.action != "accept":
        body = {
            "success": False,
            "error": {
                "code": "CONFIRMATION_DECLINED",
                "message": f"The user answered {answer.action}",
                "suggestion": "Ask the user before calling wipe-run again",
            },
        }
        return CallToolResult(content=[TextContent(text=json.dumps(body))], is_error=True)
    if not (isinstance(answer, ElicitResult) and (answer.content or {}).get("confirm") is True):
        return InputRequiredResult(
            input_requests={
                "confirm": ElicitRequest(
                    params=ElicitRequestFormParams(
                        message="Wipe everything?", requested_schema=SCHEMA
                    )
                )
            }
        )
    body = {"success": True, "data": {"wiped": True}}
    return CallToolResult(content=[TextContent(text=json.dumps(body))], is_error=False)


server = Server("confirming", version="1.0.0", on_list_tools=list_tools, on_call_tool=call_tool)

if __name__ == "__main__":
    uvicorn.run(
        server.streamable_http_app(), host="127.0.0.1", port=int(sys.argv[1]), log_level="warning"
    )
