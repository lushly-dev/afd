"""The detached lane process ``lane-start`` starts: ``python -m botcore_factory.lane_main``.

It builds the ``factory`` host for the target checkout (its adapter, the real world) and runs
``lane_run`` until the lane is asked to stop. Its output goes to ``lane.log`` in the lane's
state directory.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from botcore.context import ExecutionContext

from botcore_factory.hosts import build_factory_host


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m botcore_factory.lane_main")
    parser.add_argument("--target", required=True, help="The repository checkout")
    options = parser.parse_args(argv)
    host = build_factory_host(
        "factory", ExecutionContext(Path(options.target).resolve(), profile="trusted-local")
    )
    result = asyncio.run(host.execute("lane_run", {}))
    sys.stdout.write(json.dumps(result.model_dump(mode="json", exclude_none=True)) + "\n")
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
