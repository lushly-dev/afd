"""The Alfred MCP entry point serves over stdio only."""

import pytest

from alfred import mcp_server


@pytest.mark.parametrize(
    "flags",
    [
        [],
        ["--raw-python", "--profile", "trusted-local"],
        ["--profile", "trusted-local"],
        ["--raw-python"],
    ],
)
def test_sse_is_refused_for_every_profile(flags, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(
        mcp_server, "create_server", lambda *a, **k: pytest.fail("no server is built")
    )
    with pytest.raises(SystemExit) as exited:
        mcp_server.main(["--workspace", str(tmp_path), "--sse", *flags])
    assert exited.value.code == 2
    assert "stdio only" in capsys.readouterr().err


@pytest.mark.parametrize("flags", [[], ["--raw-python", "--profile", "trusted-local"]])
def test_stdio_runs(flags, tmp_path, monkeypatch):
    calls = []

    class Server:
        def run(self, transport):
            calls.append(transport)

    monkeypatch.setattr(mcp_server, "create_server", lambda *a, **k: Server())
    mcp_server.main(["--workspace", str(tmp_path), *flags])
    assert calls == ["stdio"]
