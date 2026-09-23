import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { CliWrapper } from './cli-wrapper.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-afd-cli.mjs');

describe('CliWrapper CLI contract', () => {
	beforeAll(() => chmodSync(fixturePath, 0o755));

	const wrapper = new CliWrapper({
		cliPath: fixturePath,
		serverUrl: 'http://test.example/mcp',
	});

	it('passes input as positional JSON and requests JSON output', async () => {
		const result = await wrapper.execute('todo-create', { title: 'From scenario' });
		expect(result).toMatchObject({
			success: true,
			result: { success: true, data: { title: 'From scenario' } },
		});
	});

	it('returns structured command failures', async () => {
		const result = await wrapper.execute('fail-command', { id: 'missing' });
		expect(result).toMatchObject({
			success: true,
			result: {
				success: false,
				error: { code: 'EXPECTED_FAILURE', suggestion: 'Retry' },
			},
		});
	});

	it('reports malformed JSON output', async () => {
		const result = await wrapper.execute('malformed', {});
		expect(result).toMatchObject({ success: false, error: { type: 'parse_error' } });
	});
});
