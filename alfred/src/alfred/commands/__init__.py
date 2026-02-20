"""Alfred commands — deterministic quality checks for the AFD repo."""

from alfred.commands.lint import alfred_lint
from alfred.commands.parity import alfred_parity
from alfred.commands.quality import alfred_quality

__all__ = [
    "alfred_lint",
    "alfred_parity",
    "alfred_quality",
]
