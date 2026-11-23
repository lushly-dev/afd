#!/usr/bin/env python3
"""Score the discovery probe (the Ideas plan's phase 0, step 0.10, in part).

    python3 score.py RESULTS_DIR --out discovery.counts.json

RESULTS_DIR holds `<condition>.<model>.jsonl`, one answer per request. A request counts as
routed right when the first tool, or the command run through a meta-tool, is the one expected.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent


def chosen(row: dict) -> str:
    tool = str(row.get("tool") or "none")
    command = row.get("command")
    if tool.startswith("afd-") and command:
        return str(command)
    return tool


def score(directory: Path) -> dict:
    requests = {
        r["n"]: r for r in (json.loads(x) for x in (HERE / "requests.jsonl").read_text().splitlines() if x.strip())
    }
    expected = json.loads((HERE / "expected.json").read_text())
    out: dict = {"tool": "discovery/score.py", "requests": len(requests), "runs": {}}
    for file in sorted(directory.glob("*.jsonl")):
        condition, model = file.stem.rsplit(".", 1)
        rows = [json.loads(x) for x in file.read_text().splitlines() if x.strip()]
        right: Counter[str] = Counter()
        total: Counter[str] = Counter()
        landed: dict[str, Counter[str]] = defaultdict(Counter)
        for row in rows:
            kind = requests[row["n"]]["kind"]
            pick = chosen(row)
            total[kind] += 1
            landed[kind][pick] += 1
            if pick in expected[kind]:
                right[kind] += 1
        out["runs"][f"{condition}/{model}"] = {
            "answered": len(rows),
            "right": sum(right.values()),
            "by_kind": {k: f"{right[k]}/{total[k]}" for k in sorted(total)},
            "save_landed_in": dict(landed["save"].most_common()),
            "memory_landed_in": dict(landed["memory"].most_common()),
            "ask_and_draft_landed_in": dict((landed["ask"] + landed["draft"]).most_common()),
        }
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("results", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    text = json.dumps(score(args.results), indent=2) + "\n"
    if args.out:
        args.out.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
