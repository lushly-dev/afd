"""The Alfred MCP entry point serves a network transport only for inspection."""

import pytest

from alfred import mcp_server


@pytest.mark.parametrize('flags', [
    ['--raw-python', '--profile', 'trusted-local'],
    ['--profile', 'trusted-local'],
    ['--raw-python'],
])
def test_sse_refuses_trusted_local_and_raw_python(flags, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(mcp_server, 'create_server',
                        lambda *a, **k: pytest.fail('no server is built'))
    with pytest.raises(SystemExit) as exited:
        mcp_server.main(['--workspace', str(tmp_path), '--sse', *flags])
    assert exited.value.code == 2
    assert 'inspection profile' in capsys.readouterr().err


@pytest.mark.parametrize('flags, transport', [
    (['--sse'], 'sse'),
    (['--raw-python', '--profile', 'trusted-local'], 'stdio'),
])
def test_allowed_transports_run(flags, transport, tmp_path, monkeypatch):
    calls = []

    class Server:
        def run(self, transport):
            calls.append(transport)

    monkeypatch.setattr(mcp_server, 'create_server', lambda *a, **k: Server())
    mcp_server.main(['--workspace', str(tmp_path), *flags])
    assert calls == [transport]
