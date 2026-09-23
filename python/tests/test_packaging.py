"""Import-time packaging checks for optional extras.

The base install only depends on pydantic, so ``import afd`` must not pull in
the ``client``/``server``/``testing`` extras. Each check runs in a subprocess
where the optional packages are made unimportable.
"""

import os
import subprocess
import sys
import textwrap
from pathlib import Path

import afd

SRC_DIR = Path(__file__).resolve().parents[1] / "src"

EXTRA_ONLY_MODULES = (
    "httpx",
    "httpx_sse",
    "mcp",
    "websockets",
    "pytest",
    "_pytest",
    "yaml",
    "click",
    "rich",
)
TESTING_EXTRA_MODULES = ("pytest", "_pytest", "yaml")


def _run_without(blocked: tuple[str, ...], code: str) -> subprocess.CompletedProcess[str]:
    prelude = (
        "import sys\n"
        f"for _name in {blocked!r}:\n"
        "    sys.modules[_name] = None\n"
    )
    env = {**os.environ, "PYTHONPATH": str(SRC_DIR)}
    return subprocess.run(
        [sys.executable, "-c", prelude + textwrap.dedent(code)],
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
    )


class TestBaseInstallImports:
    def test_import_afd_without_optional_extras(self):
        proc = _run_without(
            EXTRA_ONLY_MODULES,
            """
            import afd
            import afd.core
            from afd import CommandResult, failure, success

            assert success({"ok": True}).success is True
            assert isinstance(afd.error("NOT_FOUND", "Missing"), CommandResult)
            assert callable(failure)
            print("ok")
            """,
        )
        assert proc.returncode == 0, proc.stderr
        assert proc.stdout.strip() == "ok"

    def test_client_exports_explain_missing_extra(self):
        proc = _run_without(
            EXTRA_ONLY_MODULES,
            """
            import afd

            try:
                afd.McpClient
            except ModuleNotFoundError as exc:
                print(exc)
            else:
                raise SystemExit("McpClient imported without the client extra")
            """,
        )
        assert proc.returncode == 0, proc.stderr
        assert "afd[client]" in proc.stdout

    def test_cli_help_without_testing_extra(self):
        proc = _run_without(
            TESTING_EXTRA_MODULES,
            """
            import sys

            sys.argv = ["afd", "--help"]
            from afd.cli import main

            main()
            """,
        )
        assert proc.returncode == 0, proc.stderr
        assert "Usage:" in proc.stdout


class TestLazyClientExports:
    def test_every_public_name_resolves_with_extras_installed(self):
        for name in afd.__all__:
            assert getattr(afd, name) is not None, name

    def test_client_exports_are_the_client_module_objects(self):
        import afd.client

        assert afd.McpClient is afd.client.McpClient
        assert afd.McpClientConfig is afd.client.McpClientConfig
        assert afd.ClientStatus is afd.client.ClientStatus
        assert afd.create_client is afd.client.create_client

    def test_client_exports_listed_in_dir(self):
        assert {"McpClient", "McpClientConfig", "ClientStatus", "create_client"} <= set(dir(afd))
