"""FAST-AF's own story contract rule, run on a snapshot, as JSON: the rule T07 replaces."""

import asyncio
import json
import sys
from pathlib import Path

snapshot = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(snapshot / "plugins" / "fastbot-fast-af" / "src"))

from fastbot_fast_af.commands import fastaf_validate_story_contract  # noqa: E402

result = asyncio.run(fastaf_validate_story_contract())
payload = result.data if result.success else (result.error.details or {})
print(json.dumps({"success": result.success, **payload}))
