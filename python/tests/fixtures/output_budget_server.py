"""AFD server fixture with budgeted and unbudgeted commands for live transport tests.

Run as a script, it serves over a real transport (argv: port, strategy, transport, and
``stateless`` or ``stateful``), matching ``context_fields_server.py`` and
``protocol_server.py``.

Registers:
- Every command in ``spec/vectors/output-budgets.json``'s ``batch`` section (``doc-search``,
  ``doc-open``, ``doc-tag``) plus ``doc-mutate``.
- One probe command per ``asks`` case (``ask-case-0`` .. ``ask-case-N``) declaring that
  case's budget and returning ``{"effective": context.output_budget}``.
- One check command per ``checks`` case (``check-case-0`` .. ``check-case-N``) declaring
  that case's budget and ``mutation`` flag and returning that case's ``result``.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from afd import CommandResult, ExposeOptions, OutputBudget, success
from afd.core.commands import CommandContext
from afd.server import MCPServer, create_server

SPEC_CASES_PATH = Path(__file__).resolve().parents[3] / "spec" / "vectors" / "output-budgets.json"
MCP = ExposeOptions(mcp=True)


def load_spec_cases() -> dict[str, Any]:
    return json.loads(SPEC_CASES_PATH.read_text(encoding="utf-8"))


def build_batch_server(strategy: str = "individual") -> MCPServer:
    """Server implementing the ``batch``, ``asks`` and ``checks`` vectors of ``spec/vectors/output-budgets.json``."""
    spec_cases = load_spec_cases()
    case = spec_cases["batch"]
    table: dict[str, CommandResult[Any]] = {
        item["id"]: CommandResult.model_validate(item["result"]) for item in case["items"]
    }

    server = create_server(
        "output-budget-fixture",
        tool_strategy=strategy,  # type: ignore[arg-type]
        bootstrap=True,
        **({"first_class_tools": ["doc-search"]} if strategy == "hybrid" else {}),
    )

    for name, spec_cmd in case["commands"].items():
        decl = spec_cmd["declaration"]
        budget = OutputBudget.from_value(decl) if decl is not None else None

        def _make_handler(cmd_name: str):
            async def _handler(input: Any, context: CommandContext) -> CommandResult[Any]:
                item_id = input.get("id") if isinstance(input, dict) else None
                if item_id in table:
                    return table[item_id].model_copy(deep=True)
                return success({"command": cmd_name, "effective": context.output_budget})

            return _handler

        server.command(
            name=name,
            description=f"Test command {name}",
            category="doc",
            mutation=bool(spec_cmd["mutation"]),
            output_budget=budget,
            expose=MCP,
        )(_make_handler(name))

    @server.command(
        name="doc-mutate",
        description="Budgeted mutation command",
        category="doc",
        mutation=True,
        output_budget=OutputBudget(default_bytes=64, max_bytes=128),
        expose=MCP,
    )
    async def doc_mutate(input: Any, context: CommandContext) -> CommandResult[Any]:
        size = input.get("size", 5) if isinstance(input, dict) else 5
        return success({"text": "x" * int(size)})

    for index, ask_case in enumerate(spec_cases["asks"]):
        decl = ask_case["declaration"]
        budget = OutputBudget.from_value(decl) if decl is not None else None

        async def _ask_probe(input: Any, context: CommandContext) -> CommandResult[Any]:
            return success({"effective": context.output_budget})

        server.command(
            name=f"ask-v{index}",
            description=f"Ask vector case {index}",
            category="ask",
            # Mutation so even 1-byte asks return the probed effective budget in data.
            mutation=True,
            output_budget=budget,
            expose=MCP,
        )(_ask_probe)

    for index, check_case in enumerate(spec_cases["checks"]):
        decl = check_case["declaration"]
        budget = OutputBudget.from_value(decl) if decl is not None else None
        template = CommandResult.model_validate(check_case["result"])

        def _make_check_handler(fixed: CommandResult[Any]):
            async def _check_handler(input: Any, context: CommandContext) -> CommandResult[Any]:
                return fixed.model_copy(deep=True)

            return _check_handler

        server.command(
            name=f"check-v{index}",
            description=f"Check vector case {index}",
            category="check",
            mutation=bool(check_case["mutation"]),
            output_budget=budget,
            expose=MCP,
        )(_make_check_handler(template))

    return server


async def main() -> None:
    server = build_batch_server(sys.argv[2])
    if sys.argv[3] == "stdio":
        await server.run_async("stdio")
        return
    port = int(sys.argv[1])
    if sys.argv[3] == "sse":
        await server.run_async("sse", port=port)
    else:
        stateless = len(sys.argv) > 4 and sys.argv[4] == "stateless"
        await server.run_async("streamable-http", port=port, stateless_http=stateless)


if __name__ == "__main__":
    asyncio.run(main())
