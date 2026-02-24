"""Tests for the scenario command entry points."""

import os
import tempfile

import pytest
import yaml

from afd.testing.scenarios.commands import (
    scenario_coverage_command,
    scenario_create_command,
    scenario_list_command,
    scenario_suggest_command,
)


@pytest.fixture
def scenario_dir():
    """Create a temp directory with test scenario files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create a basic scenario
        scenario1 = {
            'name': 'Create Todo',
            'description': 'Test creating a todo',
            'job': 'manage-todos',
            'tags': ['crud', 'smoke'],
            'steps': [
                {
                    'command': 'todo-create',
                    'input': {'title': 'Test'},
                    'expect': {'success': True},
                },
            ],
        }
        with open(os.path.join(tmpdir, 'create-todo.scenario.yaml'), 'w') as f:
            yaml.dump(scenario1, f)

        # Create a second scenario
        scenario2 = {
            'name': 'List Todos',
            'description': 'Test listing todos',
            'job': 'view-todos',
            'tags': ['query'],
            'steps': [
                {
                    'command': 'todo-list',
                    'input': {},
                    'expect': {'success': True},
                },
            ],
        }
        with open(os.path.join(tmpdir, 'list-todos.scenario.yaml'), 'w') as f:
            yaml.dump(scenario2, f)

        yield tmpdir


class TestScenarioListCommand:
    @pytest.mark.asyncio
    async def test_list_all(self, scenario_dir):
        result = await scenario_list_command({'directory': scenario_dir})
        assert result['success'] is True
        assert result['data']['total'] == 2

    @pytest.mark.asyncio
    async def test_list_with_tag_filter(self, scenario_dir):
        result = await scenario_list_command({
            'directory': scenario_dir,
            'tags': ['crud'],
        })
        assert result['success'] is True
        assert result['data']['total'] == 1
        assert result['data']['scenarios'][0]['name'] == 'Create Todo'

    @pytest.mark.asyncio
    async def test_list_with_job_filter(self, scenario_dir):
        result = await scenario_list_command({
            'directory': scenario_dir,
            'job': 'view',
        })
        assert result['success'] is True
        assert result['data']['total'] == 1

    @pytest.mark.asyncio
    async def test_list_nonexistent_directory(self):
        result = await scenario_list_command({'directory': '/nonexistent/dir'})
        assert result['success'] is False
        assert result['error']['code'] == 'DIRECTORY_NOT_FOUND'


class TestScenarioCoverageCommand:
    @pytest.mark.asyncio
    async def test_coverage(self, scenario_dir):
        result = await scenario_coverage_command({
            'directory': scenario_dir,
            'known_commands': ['todo-create', 'todo-list', 'todo-delete', 'todo-update'],
        })
        assert result['success'] is True
        data = result['data']
        assert data['summary']['commands_tested'] == 2
        assert data['summary']['commands_known'] == 4
        assert 'todo-delete' in data['summary']['commands_untested']

    @pytest.mark.asyncio
    async def test_coverage_nonexistent_directory(self):
        result = await scenario_coverage_command({
            'directory': '/nonexistent',
            'known_commands': ['cmd-a'],
        })
        assert result['success'] is False


class TestScenarioCreateCommand:
    @pytest.mark.asyncio
    async def test_create_basic(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            result = await scenario_create_command({
                'name': 'test-scenario',
                'job': 'test-job',
                'directory': tmpdir,
            })
            assert result['success'] is True
            assert os.path.exists(result['data']['file'])

    @pytest.mark.asyncio
    async def test_create_with_tags(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            result = await scenario_create_command({
                'name': 'tagged-scenario',
                'job': 'test-job',
                'tags': ['smoke', 'crud'],
                'directory': tmpdir,
            })
            assert result['success'] is True
            filepath = result['data']['file']
            with open(filepath) as f:
                content = f.read()
            assert 'smoke' in content

    @pytest.mark.asyncio
    async def test_create_missing_name(self):
        result = await scenario_create_command({'job': 'test-job'})
        assert result['success'] is False
        assert result['error']['code'] == 'VALIDATION_ERROR'

    @pytest.mark.asyncio
    async def test_create_missing_job(self):
        result = await scenario_create_command({'name': 'test'})
        assert result['success'] is False
        assert result['error']['code'] == 'VALIDATION_ERROR'


class TestScenarioSuggestCommand:
    @pytest.mark.asyncio
    async def test_suggest_uncovered(self, scenario_dir):
        result = await scenario_suggest_command({
            'context': 'uncovered',
            'known_commands': ['todo-create', 'todo-list', 'todo-delete'],
            'directory': scenario_dir,
        })
        assert result['success'] is True
        suggestions = result['data']['suggestions']
        # todo-delete is not covered
        assert any(s.get('command') == 'todo-delete' for s in suggestions)

    @pytest.mark.asyncio
    async def test_suggest_for_command(self):
        result = await scenario_suggest_command({
            'context': 'command',
            'command': 'user-create',
        })
        assert result['success'] is True
        assert len(result['data']['suggestions']) >= 1

    @pytest.mark.asyncio
    async def test_suggest_natural(self):
        result = await scenario_suggest_command({
            'context': 'natural',
            'query': 'test the authentication flow',
        })
        assert result['success'] is True
        assert len(result['data']['suggestions']) >= 1

    @pytest.mark.asyncio
    async def test_suggest_changed_files(self):
        result = await scenario_suggest_command({
            'context': 'changed-files',
            'files': ['src/todo/create.ts', 'src/todo/delete.ts'],
        })
        assert result['success'] is True
        assert len(result['data']['suggestions']) == 2

    @pytest.mark.asyncio
    async def test_suggest_failed(self):
        result = await scenario_suggest_command({'context': 'failed'})
        assert result['success'] is True
        assert len(result['data']['suggestions']) >= 1
