"""Build/audit every admitted Botcore artifact and test an isolated wheel consumer.

No publishing or editable installs. The application's manifest has no platform
runtime dependencies. Optional plugin runtime scenarios are outside this gate.
"""

from __future__ import annotations

import argparse
import email
import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import zipfile
from pathlib import Path

from verify_provenance import verify_records

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = (
    ".",
    "botcore-connectors",
    "packages/botcore-llm",
    "packages/botcore-agents",
    "packages/botcore-memory",
    "plugins/botcore-teams",
)


def clean_environment() -> dict[str, str]:
    """Child builds/fixtures must never inherit hook Git routing or source imports."""
    return {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("GIT_")
        and key
        not in {
            "PYTHONPATH",
            "VIRTUAL_ENV",
            "UV_PROJECT_ENVIRONMENT",
        }
    }


def run(arguments: list[str], cwd: Path) -> str:
    result = subprocess.run(
        arguments,
        cwd=cwd,
        env=clean_environment(),
        text=True,
        capture_output=True,
    )
    if result.returncode:
        raise RuntimeError(f"{arguments[0]} failed:\n{result.stdout}\n{result.stderr}")
    return result.stdout


def audit(artifacts: Path) -> list[dict]:
    expected = {}
    for project in PROJECTS:
        data = tomllib.loads((ROOT / project / "pyproject.toml").read_text())["project"]
        expected[data["name"]] = data["version"]
    license_text = (ROOT / "LICENSE").read_bytes()
    rows = []
    for wheel in sorted(artifacts.glob("*.whl")):
        with zipfile.ZipFile(wheel) as archive:
            names = archive.namelist()
            metadata = email.message_from_bytes(
                archive.read(next(name for name in names if name.endswith("/METADATA")))
            )
            name = metadata["Name"]
            assert expected.pop(name) == metadata["Version"]
            notices = [path for path in names if path.endswith("/licenses/LICENSE")]
            assert len(notices) == 1 and archive.read(notices[0]) == license_text
            assert not any(
                any(
                    part in {".git", ".venv", "__pycache__", ".botcore"}
                    for part in Path(path).parts
                )
                for path in names
            )
            requires = metadata.get_all("Requires-Dist", [])
            assert not any(
                " @ file:" in dependency or "../../" in dependency for dependency in requires
            )
            if name == "botcore-agents":
                assert "connectors" in metadata.get_all("Provides-Extra", [])
                assert any(
                    dependency.startswith("botcore-connectors>=0.1.0") and "extra ==" in dependency
                    for dependency in requires
                )
            if name == "lushly-botcore":
                assert "afd>=0.9.0" in requires
                assert (
                    sum(
                        path.startswith("botcore/skills/") and path.endswith("/SKILL.md")
                        for path in names
                    )
                    == 55
                )
                verify_records(lambda path: archive.read("botcore/provenance/" + path))
                for path in (ROOT / "provenance").glob("*.json"):
                    assert archive.read("botcore/provenance/" + path.name) == path.read_bytes()

        rows.append(
            {
                "artifact": wheel.name,
                "sha256": hashlib.sha256(wheel.read_bytes()).hexdigest(),
                "name": name,
                "version": metadata["Version"],
            }
        )
    assert not expected, f"Missing wheels: {expected}"
    sdists = list(artifacts.glob("*.tar.gz"))
    assert len(sdists) == len(PROJECTS)
    for sdist in sdists:
        with tarfile.open(sdist) as archive:
            members = archive.getnames()
            assert any(name.endswith("/LICENSE") for name in members)
            assert not any(
                any(
                    part in {".git", ".venv", "__pycache__", ".botcore"}
                    for part in Path(name).parts
                )
                for name in members
            )
        rows.append(
            {"artifact": sdist.name, "sha256": hashlib.sha256(sdist.read_bytes()).hexdigest()}
        )
    return rows


CONSUMER = """
import asyncio, json
from pathlib import Path

import botcore
from botcore import ExecutionContext, build_host, create_host_mcp_server
from botcore.commands.skill._discovery import get_bundled_skills_dir

async def main():
    root = Path.cwd().resolve()
    assert "site-packages" in botcore.__file__
    assert not json.loads((root / "package.json").read_text()).get("dependencies")
    host = build_host("consumer", ExecutionContext(root))
    result = await host.direct_client().call("info_workspace")
    assert result.success and result.data["workspace_root"] == str(root)
    denied = await host.execute("spec_create", {"path": "rejected.md"})
    assert denied.error.code == "EFFECT_DENIED" and not (root / "rejected.md").exists()
    trusted = build_host("consumer", ExecutionContext(root, profile="trusted-local"))
    denied = await trusted.execute("changeset_create", {
        "change_type": "fixed", "description": "fixture"
    })
    assert denied.error.code == "RELEASE_PROTOCOL_REQUIRED"
    assert not (root / ".changeset").exists()
    server = create_host_mcp_server(host)
    assert {tool.name for tool in await server.list_tools()} == {
        "consumer-start", "consumer-docs", "consumer-call"
    }
    assert len(list(get_bundled_skills_dir().glob("*/SKILL.md"))) == 55
    print(json.dumps({"installed_wheel": True, "application_platform_dependencies": [],
                      "directclient": True, "managed_mcp": True, "effects_denied": True}))
asyncio.run(main())
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, help="Optional external validation artifact directory"
    )
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="botcore-wheel-smoke-") as temporary:
        work = Path(temporary).resolve()
        artifacts = options.output.resolve() if options.output else work / "dist"
        artifacts.mkdir(parents=True, exist_ok=True)
        verify_records(lambda path: (ROOT / "provenance" / path).read_bytes(), current=ROOT)
        for project in PROJECTS:
            run(
                ["uv", "build", str(ROOT / project), "--no-sources", "--out-dir", str(artifacts)],
                work,
            )
        rows = audit(artifacts)
        afd_artifacts = work / "afd-dist"
        run(
            [
                "uv",
                "build",
                str(ROOT.parents[1] / "python"),
                "--no-sources",
                "--out-dir",
                str(afd_artifacts),
            ],
            work,
        )
        consumer = work / "ordinary-app"
        consumer.mkdir()
        (consumer / "package.json").write_text('{"name":"ordinary-app","private":true}')
        (consumer / "check.py").write_text(CONSUMER)
        environment = work / "consumer-env"
        run(["uv", "venv", "--python", sys.executable, str(environment)], work)
        python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        wheel = next(artifacts.glob("lushly_botcore-*.whl"))
        afd_wheel = next(afd_artifacts.glob("afd-*.whl"))
        run(
            [
                "uv",
                "pip",
                "install",
                "--python",
                str(python),
                str(wheel),
                str(afd_wheel),
                "mcp==2.3.0",
            ],
            consumer,
        )
        consumer_result = json.loads(run([str(python), "check.py"], consumer))
        print(json.dumps({"artifacts": rows, "consumer": consumer_result}, indent=2))


if __name__ == "__main__":
    main()
