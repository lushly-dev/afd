"""Tests for the CLI wrapper module."""

import asyncio
import json

import pytest

from afd.testing.cli_wrapper import (
    CliConfig,
    CliWrapper,
    ExecuteError,
    ExecuteOptions,
    ExecuteSuccess,
    create_cli_wrapper,
)


class TestCliConfig:
    def test_defaults(self):
        config = CliConfig()
        assert config.cli_path == 'afd'
        assert config.timeout == 30.0
        assert config.verbose is False
        assert config.env == {}
        assert config.server_url is None

    def test_custom_values(self):
        config = CliConfig(
            cli_path='/usr/bin/afd',
            timeout=10.0,
            server_url='http://localhost:3000/mcp',
            verbose=True,
        )
        assert config.cli_path == '/usr/bin/afd'
        assert config.timeout == 10.0
        assert config.server_url == 'http://localhost:3000/mcp'


class TestCliWrapper:
    def test_create_with_defaults(self):
        cli = CliWrapper()
        assert cli._config.cli_path == 'afd'

    def test_create_with_config(self):
        config = CliConfig(cli_path='my-afd', timeout=5.0)
        cli = CliWrapper(config)
        assert cli._config.cli_path == 'my-afd'
        assert cli._config.timeout == 5.0

    def test_configure(self):
        cli = CliWrapper()
        cli.configure(cli_path='new-path', timeout=15.0)
        assert cli._config.cli_path == 'new-path'
        assert cli._config.timeout == 15.0

    def test_build_args_basic(self):
        cli = CliWrapper()
        args = cli._build_args('todo-create', None)
        assert args == ['call', 'todo-create', '--json']

    def test_build_args_with_input(self):
        cli = CliWrapper()
        args = cli._build_args('todo-create', {'title': 'Test'})
        assert args[0] == 'call'
        assert args[1] == 'todo-create'
        assert '--json' in args
        assert '--input' in args
        input_idx = args.index('--input')
        parsed = json.loads(args[input_idx + 1])
        assert parsed == {'title': 'Test'}

    def test_build_args_with_server_url(self):
        cli = CliWrapper(CliConfig(server_url='http://localhost:3000/mcp'))
        args = cli._build_args('todo-list', None)
        assert '--connect' in args
        connect_idx = args.index('--connect')
        assert args[connect_idx + 1] == 'http://localhost:3000/mcp'

    def test_parse_output_json_success(self):
        cli = CliWrapper()
        result = cli._parse_output(
            '{"success": true, "data": {"id": 1}}', '', 0
        )
        assert result['success'] is True
        assert result['result']['data']['id'] == 1

    def test_parse_output_json_with_prefix(self):
        cli = CliWrapper()
        result = cli._parse_output(
            'some log output\n{"success": true, "data": "ok"}', '', 0
        )
        assert result['success'] is True
        assert result['result']['data'] == 'ok'

    def test_parse_output_no_json_exit_zero(self):
        cli = CliWrapper()
        result = cli._parse_output('plain text output', '', 0)
        assert result['success'] is True
        assert result['result']['success'] is True
        assert result['result']['data'] == 'plain text output'

    def test_parse_output_no_json_exit_nonzero(self):
        cli = CliWrapper()
        result = cli._parse_output('', 'some error', 1)
        assert result['success'] is False
        assert result['error'].type == 'parse_error'

    def test_parse_output_invalid_json(self):
        cli = CliWrapper()
        result = cli._parse_output('{invalid json}', '', 0)
        assert result['success'] is False
        assert result['error'].type == 'parse_error'

    def test_parse_output_raw_json_object(self):
        cli = CliWrapper()
        result = cli._parse_output('{"key": "value"}', '', 0)
        assert result['success'] is True
        assert result['result']['success'] is True
        assert result['result']['data'] == {'key': 'value'}

    @pytest.mark.asyncio
    async def test_execute_command_not_found(self):
        cli = CliWrapper(CliConfig(cli_path='nonexistent-binary-xyz'))
        result = await cli.execute('test-command')
        assert isinstance(result, ExecuteError)
        assert result.success is False
        assert result.duration_ms >= 0

    @pytest.mark.asyncio
    async def test_execute_echo_command(self):
        """Test execution with echo to verify subprocess works."""
        cli = CliWrapper(CliConfig(cli_path='echo'))
        result = await cli.execute('hello')
        # echo will just print text, which should be parsed as plain output
        assert result.duration_ms >= 0


class TestCreateCliWrapper:
    def test_factory_no_args(self):
        cli = create_cli_wrapper()
        assert isinstance(cli, CliWrapper)

    def test_factory_with_config(self):
        config = CliConfig(cli_path='my-cli', timeout=5.0)
        cli = create_cli_wrapper(config)
        assert cli._config.cli_path == 'my-cli'

    def test_factory_with_kwargs(self):
        cli = create_cli_wrapper(cli_path='custom', timeout=10.0)
        assert cli._config.cli_path == 'custom'
        assert cli._config.timeout == 10.0
