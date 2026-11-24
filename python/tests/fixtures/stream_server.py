"""An MCP server with AFD's ``POST /stream/<command>`` route beside ``/mcp``.

The Python server has no stream executor yet, so this fixture writes the chunks the
TypeScript server would (``event: chunk`` then ``data: <json>``, see
``packages/server/src/http-handler.ts``). Used by ``tests/test_cli_batch_stream.py``.

``export-run`` sends progress, data and a complete chunk; ``fail-run`` an error chunk;
``cut-run`` data and then ends; ``slow-run`` sends progress and then nothing; ``escape-run``
sends data carrying terminal escape sequences; ``session-run`` answers with the request's
``Mcp-Session-Id``.

Usage: stream_server.py <port> [ignored...]
"""

import asyncio
import json
import sys

import uvicorn
from mcp.server.lowlevel import Server
from mcp.types import ListToolsResult, Tool
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route


async def list_tools(ctx, params):
    return ListToolsResult(
        tools=[Tool(name="export-run", description="Export", input_schema={"type": "object"})]
    )


def _event(chunk):
    return f"event: chunk\ndata: {json.dumps(chunk)}\n\n"


async def _chunks(name, args, session_id=None):
    if name == "session-run":
        yield {
            "type": "complete",
            "totalChunks": 0,
            "totalDurationMs": 1,
            "data": {"session": session_id},
        }
    elif name == "export-run":
        yield {
            "type": "progress",
            "progress": 0.5,
            "message": "Halfway",
            "itemsProcessed": 1,
            "itemsTotal": 2,
        }
        yield {
            "type": "data",
            "data": {"row": 1, "format": args.get("format")},
            "index": 0,
            "isLast": False,
        }
        yield {"type": "data", "data": "done", "index": 1, "isLast": True}
        yield {
            "type": "complete",
            "totalChunks": 2,
            "totalDurationMs": 12,
            "confidence": 0.9,
            "data": {"rows": 2},
        }
    elif name == "fail-run":
        yield {"type": "data", "data": "partial", "index": 0, "isLast": False}
        yield {
            "type": "error",
            "error": {
                "code": "EXPORT_FAILED",
                "message": "Disk full",
                "suggestion": "Free space and retry",
            },
            "chunksBeforeError": 1,
            "recoverable": True,
            "resumeFrom": 1,
        }
    elif name == "cut-run":
        yield {"type": "data", "data": "partial", "index": 0, "isLast": False}
    elif name == "slow-run":
        yield {"type": "progress", "progress": 0.1}
        await asyncio.sleep(30)
    elif name == "escape-run":
        yield {
            "type": "data",
            "data": "safe\x1b]0;owned\x07\x1b[2Jtext",
            "index": 0,
            "isLast": True,
        }
        yield {
            "type": "complete",
            "totalChunks": 1,
            "totalDurationMs": 1,
            "reasoning": "\x1b[31mred\x1b[0m",
        }


async def stream(request: Request):
    name = request.path_params["name"]
    if name == "missing-run":
        error = {
            "code": "COMMAND_NOT_FOUND",
            "message": "Unknown command missing-run",
            "suggestion": "Run afd-discover",
        }
        return JSONResponse({"success": False, "error": error}, status_code=404)
    args = await request.json()

    async def body():
        async for chunk in _chunks(name, args, request.headers.get("mcp-session-id")):
            yield _event(chunk)

    return StreamingResponse(body(), media_type="text/event-stream")


server = Server("streaming", version="1.0.0", on_list_tools=list_tools)

if __name__ == "__main__":
    app = server.streamable_http_app()
    app.router.routes.append(Route("/stream/{name}", stream, methods=["POST"]))
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]), log_level="warning")
