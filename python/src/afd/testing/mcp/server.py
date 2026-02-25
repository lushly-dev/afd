"""
MCP Testing Server for AFD JTBD scenarios.

JSON-RPC 2.0 server that exposes scenario commands as MCP tools.

Port of packages/testing/src/mcp/server.ts
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any, Callable

from afd.testing.mcp.tools import create_tool_registry, generate_tools

# JSON-RPC 2.0 error codes
JSON_RPC_ERRORS = {
	"PARSE_ERROR": -32700,
	"INVALID_REQUEST": -32600,
	"METHOD_NOT_FOUND": -32601,
	"INVALID_PARAMS": -32602,
	"INTERNAL_ERROR": -32603,
}


class McpTestingServer:
	"""MCP server for testing tools.

	Example:
		server = McpTestingServer()
		response = await server.handle_request({
			"jsonrpc": "2.0",
			"id": 1,
			"method": "tools/list",
		})
	"""

	def __init__(
		self,
		name: str = "@lushly-dev/afd-testing",
		version: str = "0.1.0",
		command_handler: Callable[..., Any] | None = None,
		cwd: str | None = None,
		verbose: bool = False,
	) -> None:
		self.name = name
		self.version = version
		self._verbose = verbose
		self._tools = generate_tools()
		self._registry = create_tool_registry(command_handler)

	def _log(self, *args: Any) -> None:
		if self._verbose:
			print("[MCP Testing]", *args, file=sys.stderr)

	async def handle_request(self, request: dict[str, Any]) -> dict[str, Any]:
		"""Handle a JSON-RPC request."""
		req_id = request.get("id")
		method = request.get("method", "")
		params = request.get("params")

		try:
			if method == "initialize":
				result = self._handle_initialize()
			elif method == "ping":
				result = self._handle_ping()
			elif method == "tools/list":
				result = self._handle_tools_list()
			elif method == "tools/call":
				result = await self._handle_tools_call(params)
			else:
				raise _JsonRpcError(
					JSON_RPC_ERRORS["METHOD_NOT_FOUND"],
					f"Unknown method: {method}",
				)

			return {"jsonrpc": "2.0", "id": req_id, "result": result}

		except _JsonRpcError as e:
			return {
				"jsonrpc": "2.0",
				"id": req_id,
				"error": {"code": e.code, "message": e.message, "data": e.data},
			}
		except Exception as e:
			return {
				"jsonrpc": "2.0",
				"id": req_id,
				"error": {
					"code": JSON_RPC_ERRORS["INTERNAL_ERROR"],
					"message": str(e),
				},
			}

	def get_tools(self) -> list[dict[str, Any]]:
		"""Get all available tools."""
		return self._tools

	async def execute_tool(self, name: str, input: Any) -> dict[str, Any]:
		"""Execute a tool by name."""
		handler = self._registry.get(name)
		if not handler:
			return {
				"success": False,
				"error": {
					"code": "UNKNOWN_TOOL",
					"message": f"Tool '{name}' not found",
					"suggestion": f"Available tools: {', '.join(self._registry.keys())}",
				},
			}
		return await handler(input)

	def _handle_initialize(self) -> dict[str, Any]:
		self._log("initialize")
		return {
			"protocolVersion": "2024-11-05",
			"serverInfo": {"name": self.name, "version": self.version},
			"capabilities": {"tools": {"listChanged": False}},
		}

	def _handle_ping(self) -> dict[str, Any]:
		return {}

	def _handle_tools_list(self) -> dict[str, Any]:
		self._log("tools/list - returning", len(self._tools), "tools")
		return {
			"tools": [
				{
					"name": t["name"],
					"description": t["description"],
					"inputSchema": t["inputSchema"],
				}
				for t in self._tools
			]
		}

	async def _handle_tools_call(self, params: Any) -> dict[str, Any]:
		if not params or not isinstance(params, dict):
			raise _JsonRpcError(
				JSON_RPC_ERRORS["INVALID_PARAMS"],
				"Missing params for tools/call",
			)

		tool_name = params.get("name")
		tool_args = params.get("arguments", {})

		if not tool_name or not isinstance(tool_name, str):
			raise _JsonRpcError(
				JSON_RPC_ERRORS["INVALID_PARAMS"],
				"Missing or invalid tool name",
			)

		self._log("tools/call -", tool_name, tool_args)

		result = await self.execute_tool(tool_name, tool_args)

		return {
			"content": [{"type": "text", "text": json.dumps(result, default=str, indent=2)}],
			"isError": not result.get("success", False),
		}


class _JsonRpcError(Exception):
	def __init__(self, code: int, message: str, data: Any = None) -> None:
		super().__init__(message)
		self.code = code
		self.message = message
		self.data = data


def create_mcp_testing_server(
	name: str = "@lushly-dev/afd-testing",
	version: str = "0.1.0",
	command_handler: Callable[..., Any] | None = None,
	cwd: str | None = None,
	verbose: bool = False,
) -> McpTestingServer:
	"""Create an MCP server for testing tools."""
	return McpTestingServer(
		name=name,
		version=version,
		command_handler=command_handler,
		cwd=cwd,
		verbose=verbose,
	)


async def run_stdio_server(
	server: McpTestingServer | None = None,
	**kwargs: Any,
) -> None:
	"""Run the MCP server on stdio transport."""
	if server is None:
		server = create_mcp_testing_server(**kwargs)

	loop = asyncio.get_event_loop()
	reader = asyncio.StreamReader()
	protocol = asyncio.StreamReaderProtocol(reader)
	await loop.connect_read_pipe(lambda: protocol, sys.stdin)

	while True:
		line_bytes = await reader.readline()
		if not line_bytes:
			break
		line = line_bytes.decode("utf-8").strip()
		if not line:
			continue

		try:
			request = json.loads(line)
			response = await server.handle_request(request)
			print(json.dumps(response), flush=True)
		except json.JSONDecodeError:
			error_response = {
				"jsonrpc": "2.0",
				"error": {
					"code": JSON_RPC_ERRORS["PARSE_ERROR"],
					"message": "Invalid JSON",
				},
			}
			print(json.dumps(error_response), flush=True)
