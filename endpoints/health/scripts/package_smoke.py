"""Build Health's wheel and sdist, audit their contents and test isolated consumers.

No publishing and no editable installs. Consumers run from temporary directories
outside the workspace:

1. headless: the wheel alone (no Botcore or AFD installed) audits a plain TypeScript
   and a plain Python fixture whose manifests have no platform dependency; both
   fixtures, including their Git metadata, stay byte-identical, and the report
   validates against the published schema;
2. botcore: the wheel with its ``botcore`` extra, using Botcore and AFD wheels built
   from this repository, admits the plugin explicitly through a Botcore host.

Pass ``--deny-file`` with caller-owned private terms to extend the artifact scan.
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
import zipfile
from pathlib import Path

import jsonschema
from privacy import load_deny_terms, scan_member

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = ROOT.parents[1]
MODULES = {"__init__.py", "__main__.py", "checks.py", "commands.py", "config.py", "core.py"}
WHEEL_PACKAGE = {f"lushly_health/{name}" for name in MODULES} | {
    "lushly_health/schemas/report-1.0.json",
    "lushly_health/schemas/report-1.1.json",
}
SDIST_ROOT_FILES = {
    "PKG-INFO",
    "README.md",
    "LICENSE",
    "MANIFEST.in",
    "pyproject.toml",
    "setup.cfg",
}
SDIST_DIRECTORIES = ("src/", "tests/", "provenance/", "scripts/")


def clean_environment() -> dict[str, str]:
    """Child builds/fixtures never inherit hook Git routing or source imports."""
    return {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("GIT_")
        and key not in {"PYTHONPATH", "VIRTUAL_ENV", "UV_PROJECT_ENVIRONMENT"}
    }


def run(arguments: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(
        arguments, cwd=cwd, env=clean_environment(), text=True, capture_output=True
    )
    if check and result.returncode:
        raise RuntimeError(f"{arguments[0]} failed:\n{result.stdout}\n{result.stderr}")
    return result


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit_artifacts(artifacts: Path, deny: list[str]) -> list[dict]:
    license_text = (ROOT / "LICENSE").read_bytes()
    findings, rows = [], []
    (wheel,) = artifacts.glob("lushly_health-*.whl")
    with zipfile.ZipFile(wheel) as archive:
        names = set(archive.namelist())
        info = {name for name in names if name.startswith("lushly_health-0.1.0.dist-info/")}
        assert names - info == WHEEL_PACKAGE, sorted(names - info ^ WHEEL_PACKAGE)
        metadata = email.message_from_bytes(archive.read("lushly_health-0.1.0.dist-info/METADATA"))
        assert (metadata["Name"], metadata["Version"]) == ("lushly-health", "0.1.0")
        assert metadata["License-Expression"] == "MIT"
        requires = metadata.get_all("Requires-Dist", [])
        assert all("extra ==" in requirement for requirement in requires), requires
        assert not any("file:" in requirement or "../" in requirement for requirement in requires)
        assert archive.read("lushly_health-0.1.0.dist-info/licenses/LICENSE") == license_text
        entry_points = archive.read("lushly_health-0.1.0.dist-info/entry_points.txt").decode()
        assert "[botcore.plugins]\nhealth = lushly_health:HealthPlugin" in entry_points
        for version in ("1.0", "1.1"):
            schema = (ROOT / f"src/lushly_health/schemas/report-{version}.json").read_bytes()
            assert archive.read(f"lushly_health/schemas/report-{version}.json") == schema
        for name in sorted(names):
            findings += scan_member(f"{wheel.name}!{name}", archive.read(name), deny)
    rows.append({"artifact": wheel.name, "sha256": digest(wheel), "members": len(names)})
    (sdist,) = artifacts.glob("lushly_health-*.tar.gz")
    with tarfile.open(sdist) as archive:
        members = [member for member in archive.getmembers() if member.isfile()]
        prefix = "lushly_health-0.1.0/"
        for member in members:
            assert member.name.startswith(prefix), member.name
            relative = member.name[len(prefix) :]
            assert (
                relative in SDIST_ROOT_FILES
                or relative.startswith(SDIST_DIRECTORIES)
                or relative.startswith("src/lushly_health.egg-info/")
            ), relative
            findings += scan_member(
                f"{sdist.name}!{relative}", archive.extractfile(member).read(), deny
            )
        assert any(member.name == prefix + "LICENSE" for member in members)
    rows.append({"artifact": sdist.name, "sha256": digest(sdist), "members": len(members)})
    assert not findings, "\n".join(findings)
    return rows


def write_fixtures(work: Path) -> dict[str, Path]:
    typescript = work / "fixtures" / "plain-typescript"
    python = work / "fixtures" / "plain-python"
    files = {
        typescript: {
            "package.json": json.dumps(
                {
                    "name": "plain-typescript",
                    "private": True,
                    "engines": {"node": ">=22"},
                    "devDependencies": {"typescript": "^5.6.0"},
                    "scripts": {"build": "tsc", "test": "node --test"},
                },
                indent=2,
            ),
            "tsconfig.json": '{"compilerOptions": {"strict": true}}\n',
            "src/index.ts": "export const greet = (name: string) => `hello ${name}`;\n",
            ".nvmrc": "24\n",
            ".gitattributes": "* text=auto eol=lf\n",
            ".github/workflows/ci.yml": (
                "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n"
                "      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n"
                "      - run: npm test && npm run build\n"
            ),
        },
        python: {
            "pyproject.toml": (
                '[project]\nname = "plain-python"\nversion = "0.0.1"\ndependencies = []\n'
                "\n[tool.ruff]\nline-length = 100\n"
            ),
            "src/plain_python/__init__.py": "VALUE = 1\n",
        },
    }
    for root, contents in files.items():
        for relative, text in contents.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        for command in (
            ["git", "init", "--quiet"],
            ["git", "add", "."],
            [
                "git",
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--quiet",
                "-m",
                "fixture",
            ],
        ):
            run(command, root)
        manifest = (root / ("package.json" if root == typescript else "pyproject.toml")).read_text()
        for platform in ("afd", "botcore", "health", "lushly"):
            assert platform not in manifest.lower(), f"{root.name} manifest names {platform}"
    return {"typescript": typescript, "python": python}


def snapshot(root: Path) -> dict[str, str]:
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file() and not path.is_symlink()
    }


HEADLESS = """
import json, sys
before = {name.split(".")[0] for name in sys.modules}  # interpreter and venv bootstrap
import lushly_health
from lushly_health import load_policy, load_targets, audit
assert "site-packages" in lushly_health.__file__
report = audit(load_targets(sys.argv[1]), load_policy(sys.argv[2]))
loaded = {name.split(".")[0] for name in sys.modules} - before
third_party = sorted(loaded - set(sys.stdlib_module_names) - {"lushly_health"})
print(json.dumps({"third_party_modules": third_party, "summary": report["summary"]}))
"""

BOTCORE = """
import asyncio, json, sys
from pathlib import Path
from botcore import ExecutionContext, build_host
from lushly_health.commands import host_policies

async def main():
    workspace = Path(sys.argv[1]).resolve()
    default = build_host("consumer", ExecutionContext(workspace))
    assert "health_audit" not in default.list_command_names()
    host = build_host("consumer", ExecutionContext(workspace), plugins=("health",),
                      policies=host_policies())
    selection = {"targets": [{"id": "plain-typescript", "path": "plain-typescript",
                              "language": "typescript"}],
                 "check_ids": ["node_version_alignment", "last_commit"]}
    denied = await host.execute("health_audit", selection)
    assert denied.error.code == "EFFECT_DENIED"
    selection["check_ids"] = ["node_version_alignment", "gitattributes_lf"]
    result = await host.direct_client().call("health_audit", selection)
    assert result.success, result.error
    print(json.dumps({"admitted": True, "subprocess_denied_in_inspection": True,
                      "summary": result.data["summary"]}))

asyncio.run(main())
"""


def consumer_python(work: Path, name: str, installs: list[str]) -> Path:
    environment = work / name
    run(["uv", "venv", "--python", sys.executable, str(environment)], work)
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    run(["uv", "pip", "install", "--python", str(python), *installs], work)
    return python


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deny-file", type=Path, help="Caller-owned private terms, one per line")
    parser.add_argument("--skip-botcore", action="store_true", help="Skip the Botcore consumer")
    options = parser.parse_args()
    deny = load_deny_terms(options.deny_file)
    schema = json.loads((ROOT / "src/lushly_health/schemas/report-1.1.json").read_text())
    with tempfile.TemporaryDirectory(prefix="health-wheel-smoke-") as temporary:
        work = Path(temporary).resolve()
        assert not work.is_relative_to(REPOSITORY)
        artifacts = work / "dist"
        run(["uv", "build", str(ROOT), "--no-sources", "--out-dir", str(artifacts)], work)
        rows = audit_artifacts(artifacts, deny)
        wheel = str(next(artifacts.glob("lushly_health-*.whl")))

        fixtures = write_fixtures(work)
        before = {name: snapshot(path) for name, path in fixtures.items()}
        config = work / "caller-config"
        config.mkdir()
        (config / "targets.toml").write_text(
            'schema_version = "1.0"\n'
            + "".join(
                f'[[targets]]\nid = "{path.name}"\npath = "../fixtures/{path.name}"\n'
                f'language = "{language}"\n'
                for language, path in fixtures.items()
            )
        )
        (config / "policy.toml").write_text(
            'schema_version = "1.0"\nchecks = ["node_version_alignment", "linter_strict", '
            '"ci_present", "gitattributes_lf", "dependabot_configured", "last_commit"]\n'
            '[severity]\ndependabot_configured = "advisory"\n'
        )
        python = consumer_python(work, "headless-env", [wheel])
        installed = run(
            [
                str(python),
                "-I",
                "-c",
                "import importlib.metadata as m, json; "
                "print(json.dumps(sorted(d.metadata['Name'] for d in m.distributions())))",
            ],
            work,
        ).stdout
        assert json.loads(installed) == ["lushly-health"], installed
        for module in ("botcore", "afd"):
            probe = run([str(python), "-I", "-c", f"import {module}"], work, check=False)
            assert probe.returncode, f"{module} must be absent from the headless consumer"
        outside = work / "elsewhere"
        outside.mkdir()
        cli = run(
            [
                str(python),
                "-I",
                "-m",
                "lushly_health",
                "audit",
                "--targets",
                str(config / "targets.toml"),
                "--policy",
                str(config / "policy.toml"),
                "--output-dir",
                str(work / "reports"),
                "--fail-on",
                "error",
            ],
            outside,
        )
        receipt = json.loads(cli.stdout)
        report = json.loads(Path(receipt["artifacts_written"][0]).read_text())
        jsonschema.Draft202012Validator(schema).validate(report)
        headless = json.loads(
            run(
                [
                    str(python),
                    "-I",
                    "-c",
                    HEADLESS,
                    str(config / "targets.toml"),
                    str(config / "policy.toml"),
                ],
                outside,
            ).stdout
        )
        assert headless["third_party_modules"] == [], headless
        printed_schema = json.loads(
            run([str(python), "-I", "-m", "lushly_health", "schema"], outside).stdout
        )
        assert printed_schema == schema
        after = {name: snapshot(path) for name, path in fixtures.items()}
        assert after == before, "Audit changed a fixture"
        assert all(".git/HEAD" in files for files in after.values())
        statuses = {(o["target"], o["check_id"]): o["status"] for o in report["outcomes"]}

        botcore_result = None
        if not options.skip_botcore:
            for project in (REPOSITORY / "python", REPOSITORY / "endpoints/botcore"):
                run(
                    [
                        "uv",
                        "build",
                        str(project),
                        "--wheel",
                        "--no-sources",
                        "--out-dir",
                        str(work / "platform"),
                    ],
                    work,
                )
            platform = [str(path) for path in sorted((work / "platform").glob("*.whl"))]
            python = consumer_python(work, "botcore-env", [f"{wheel}[botcore]", *platform])
            botcore_result = json.loads(
                run([str(python), "-I", "-c", BOTCORE, str(work / "fixtures")], outside).stdout
            )
            assert after == {name: snapshot(path) for name, path in fixtures.items()}

    print(
        json.dumps(
            {
                "artifacts": rows,
                "privacy_scan": {"findings": 0, "deny_terms": len(deny)},
                "headless": {
                    "installed_distributions": json.loads(installed),
                    "third_party_modules_loaded": headless["third_party_modules"],
                    "summary": report["summary"],
                    "statuses": {f"{t}/{c}": s for (t, c), s in sorted(statuses.items())},
                    "schema_valid": True,
                    "fixtures_byte_identical": True,
                },
                "botcore": botcore_result,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
