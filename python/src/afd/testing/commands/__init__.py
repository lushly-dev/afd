"""
Scenario AFD commands for JTBD testing.

Exposes scenario operations as AFD commands that can be surfaced as MCP tools.
"""

from afd.testing.commands.coverage import scenario_coverage_cmd
from afd.testing.commands.create import scenario_create
from afd.testing.commands.evaluate import scenario_evaluate
from afd.testing.commands.list import scenario_list
from afd.testing.commands.suggest import scenario_suggest

__all__ = [
	"scenario_coverage_cmd",
	"scenario_create",
	"scenario_evaluate",
	"scenario_list",
	"scenario_suggest",
]
