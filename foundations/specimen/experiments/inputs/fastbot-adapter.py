"""specimen-contract's output as what Fastbot's story contract command returns.

For FAST-AF to adopt at T08: Fastbot's `fastaf_validate_story_contract` can run `specimen contract
--output FILE` and return this, so that its hooks and callers keep the shape they already read.
check-contract.mjs holds it to the real command's output.
"""

import json
import sys


def to_fastbot(run: dict, path: str) -> dict:
    def item(finding: dict) -> dict:
        entry = {
            "code": finding["code"],
            "file": finding.get("file", ""),
            "message": finding["message"],
        }
        if "attribute" in finding:
            entry["attribute"] = finding["attribute"]
        return entry

    return {
        "path": path,
        "errors": [item(f) for f in run["findings"] if f["severity"] == "error"],
        "warnings": [item(f) for f in run["findings"] if f["severity"] == "warning"],
        "stats": {
            "componentCount": run["stats"]["components"],
            "storyCount": run["stats"]["storyFiles"],
        },
    }


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as file:
        print(json.dumps(to_fastbot(json.load(file), sys.argv[2])))
