import type { McpClient } from '@lushly-dev/afd-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	requireClient: vi.fn(),
	getClient: vi.fn().mockReturnValue(null),
	setClient: vi.fn(),
}));

vi.mock('../connection.js', () => mocks);

import { createCli } from '../cli.js';

describe('afd call invocation', () => {
	afterEach(() => vi.restoreAllMocks());

	it('parses the runner contract and calls an explicit HTTP server', async () => {
		const call = vi.fn().mockResolvedValue({ success: true, data: { id: 'created' } });
		mocks.requireClient.mockResolvedValue({ call } as unknown as McpClient);
		vi.spyOn(console, 'log').mockImplementation(() => undefined);

		await createCli().parseAsync(
			[
				'call',
				'todo-create',
				'{"title":"From scenario"}',
				'--connect',
				'http://localhost:3100/mcp',
				'--transport',
				'http',
				'--header',
				'Authorization: Bearer abc',
				'--format',
				'json',
			],
			{ from: 'user' }
		);

		expect(mocks.requireClient).toHaveBeenCalledWith(
			expect.objectContaining({ header: ['Authorization: Bearer abc'] }),
			{ url: 'http://localhost:3100/mcp', transport: 'http', timeout: undefined }
		);
		expect(call).toHaveBeenCalledWith('todo-create', { title: 'From scenario' });
	});

	it('rejects malformed arguments before connecting', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
		mocks.requireClient.mockClear();

		await createCli().parseAsync(['call', 'todo-create', 'title'], { from: 'user' });

		expect(process.exit).toHaveBeenCalledWith(1);
		expect(mocks.requireClient).not.toHaveBeenCalled();
		expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain(
			'Expected key=value, got "title"'
		);
	});

	it('rejects an unknown transport and a malformed --header while parsing', async () => {
		const errors: string[] = [];
		const parse = (...args: string[]) => {
			const program = createCli();
			// Subcommands copy these settings when created, so set them on `call` itself.
			program.commands
				.find((command) => command.name() === 'call')
				?.exitOverride()
				.configureOutput({ writeErr: (text) => errors.push(text) });
			return program.parseAsync(['call', 'todo-create', ...args], { from: 'user' });
		};

		await expect(parse('--connect', 'http://x', '--transport', 'ws')).rejects.toThrow();
		await expect(parse('--header', 'no colon here')).rejects.toThrow();
		expect(errors.join('')).toContain('Allowed choices are sse, http');
		expect(errors.join('')).toContain('Use "Name: value"');
	});
});
