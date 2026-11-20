"""Stamp adaptations.json's sha256 into the packaged provenance envelope.

The repository's provenance.json holds the digests of the frozen manifests only: adaptations.json
changes with every edit, and its digest line made any two branches that recorded different files
conflict (lushly-dev/afd#1610). The wheel and sdist carry the envelope with that digest, computed
from the adaptations.json they ship. An sdist's envelope is already stamped, and building a wheel
from it stamps it again from the same bytes. `scripts/verify_provenance.py --artifacts` checks a
built artifact. Editable installs ship no records, so they are not stamped.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

RECORDS = "src/botcore/provenance"


def stamp(envelope: bytes, adaptations: bytes) -> bytes:
    """The envelope with adaptations.json's digest, in the records' serialization."""
    value = json.loads(envelope)
    value["records"]["adaptations"]["sha256"] = hashlib.sha256(adaptations).hexdigest()
    return (json.dumps(value, indent=2) + "\n").encode()


class ProvenanceStampHook(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict) -> None:
        if self.target_name not in {"wheel", "sdist"} or version == "editable":
            return
        records = Path(self.root) / RECORDS
        envelope = (records / "provenance.json").read_bytes()
        manifest = json.loads(envelope)["records"]["adaptations"]["manifest"]
        stamped = stamp(envelope, (records / manifest).read_bytes())
        self._stamped = Path(tempfile.mkdtemp(prefix="botcore-provenance-"))
        target = self._stamped / "provenance.json"
        target.write_bytes(stamped)
        # A file outside the root replaces the project file at the same distribution path.
        build_data["force_include"][str(target)] = f"{RECORDS}/provenance.json"

    def finalize(self, version: str, build_data: dict, artifact_path: str) -> None:
        stamped = getattr(self, "_stamped", None)
        if stamped is not None:
            shutil.rmtree(stamped, ignore_errors=True)
