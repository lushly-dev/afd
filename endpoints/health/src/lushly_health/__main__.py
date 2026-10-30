"""Standard-library command line: ``python -m lushly_health``.

Exit codes: 0 audit completed, 1 a ``--fail-on`` status was found in a required
check or ``--require-pass`` was given and the verdict is not ``passed``, 2 invalid
selection or configuration.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import report_schema
from .config import load_policy, load_targets
from .core import STATUSES, ArtifactScope, Policy, Target, audit, capabilities, write_report


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m lushly_health", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("capabilities", help="Print declared checks and effects")
    commands.add_parser("schema", help="Print the report JSON Schema")
    run = commands.add_parser("audit", help="Audit explicit targets; read-only")
    run.add_argument(
        "--target",
        nargs=3,
        action="append",
        metavar=("ID", "PATH", "LANGUAGE"),
        help="An explicit target (repeatable)",
    )
    run.add_argument("--targets", type=Path, help="A caller-owned targets file (TOML or JSON)")
    run.add_argument("--policy", type=Path, help="A caller-owned policy file (TOML or JSON)")
    run.add_argument("--check", action="append", help="Select a check id (repeatable)")
    run.add_argument("--disable", action="append", help="Disable a selected check id")
    run.add_argument(
        "--output-dir", type=Path, help="Write the report here (must be outside every target)"
    )
    run.add_argument("--report-name", default="health-report.json")
    run.add_argument(
        "--fail-on",
        default="",
        help=f"Comma-separated statuses that fail required checks ({', '.join(STATUSES)})",
    )
    run.add_argument(
        "--require-pass",
        action="store_true",
        help="Exit 1 unless the report verdict is passed (checks disabled by policy excluded)",
    )
    return parser


def _selection(options) -> tuple[tuple[Target, ...], Policy]:
    if bool(options.targets) == bool(options.target):
        raise ValueError("Pass either --targets FILE or one or more --target ID PATH LANGUAGE")
    if bool(options.policy) == bool(options.check):
        raise ValueError("Pass either --policy FILE or one or more --check ID")
    targets = (
        load_targets(options.targets)
        if options.targets
        else tuple(Target(i, Path(p), lang) for i, p, lang in options.target)
    )
    if options.policy:
        if options.disable:
            raise ValueError("Declare disabled checks in the policy file")
        policy = load_policy(options.policy)
    else:
        policy = Policy(tuple(options.check), frozenset(options.disable or []))
    return targets, policy


def main(argv: list[str] | None = None) -> int:
    options = _parser().parse_args(argv)
    if options.command == "capabilities":
        print(json.dumps(capabilities(), indent=2))
        return 0
    if options.command == "schema":
        print(json.dumps(report_schema(), indent=2))
        return 0
    try:
        fail_on = {item for item in options.fail_on.split(",") if item}
        if fail_on - set(STATUSES):
            raise ValueError("Unknown --fail-on status")
        targets, policy = _selection(options)
        report = audit(targets, policy)
        output = (
            write_report(report, ArtifactScope(options.output_dir), options.report_name)
            if options.output_dir
            else report
        )
    except (OSError, ValueError) as exc:
        print(f"health: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(output, indent=2))
    failing = [
        item
        for item in report["outcomes"]
        if item["severity"] == "required" and item["status"] in fail_on
    ]
    blocked = options.require_pass and report["verdict"]["status"] != "passed"
    return 1 if failing or blocked else 0


if __name__ == "__main__":
    raise SystemExit(main())
