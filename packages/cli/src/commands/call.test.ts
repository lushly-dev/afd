import { fileURLToPath, pathToFileURL } from 'node:url';
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
		expect(errors.join('')).toContain('Allowed choices are streamable-http, sse, http');
		expect(errors.join('')).toContain('Use "Name: value"');
	});
});

const MODULE = fileURLToPath(new URL('../../test-fixtures/approval-todo.mjs', import.meta.url));

/** The fixture as `afd call --module` imports it, so both see the same `deleted` list. */
const fixture = () => import(pathToFileURL(MODULE).href) as Promise<{ deleted: number[] }>;

describe('afd call approvals (#417)', () => {
	afterEach(() => vi.restoreAllMocks());

	/** Run `afd call` and wait for its exit code; stdout lines are returned as text. */
	async function run(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
		const stdout: string[] = [];
		const stderr: string[] = [];
		vi.spyOn(console, 'log').mockImplementation((...parts) => void stdout.push(parts.join(' ')));
		vi.spyOn(console, 'error').mockImplementation((...parts) => void stderr.push(parts.join(' ')));
		vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
			stderr.push(String(chunk));
			return true;
		});
		let exitCode: number | undefined;
		vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
			exitCode ??= code ?? 0;
		}) as never);
		// No terminal to ask on, whatever the runner inherited.
		const tty = [process.stdin.isTTY, process.stderr.isTTY] as const;
		process.stdin.isTTY = false;
		process.stderr.isTTY = false;
		try {
			await createCli().parseAsync(['call', ...args], { from: 'user' });
			await vi.waitFor(() => expect(exitCode).toBeDefined());
		} finally {
			[process.stdin.isTTY, process.stderr.isTTY] = tty;
		}
		return { code: exitCode as number, stdout: stdout.join('\n'), stderr: stderr.join('') };
	}

	it('without a terminal or --approve, prints APPROVAL_REQUIRED unchanged and exits 1', async () => {
		const { deleted } = await fixture();
		deleted.length = 0;

		const { code, stdout } = await run(
			'todo-delete',
			'{"id":42}',
			'--module',
			MODULE,
			'--format',
			'json'
		);

		expect(code).toBe(1);
		const result = JSON.parse(stdout);
		expect(result.success).toBe(false);
		expect(result.error.code).toBe('APPROVAL_REQUIRED');
		expect(result.error.details).toMatchObject({ summary: 'Delete the todo (permanent)' });
		expect(result.error.details.approvalToken).toMatch(/^afdap1\./);
		expect(deleted).toEqual([]);
	});

	it('--approve retries with the issued token and runs the command', async () => {
		const { deleted } = await fixture();
		deleted.length = 0;

		const { code, stdout, stderr } = await run(
			'todo-delete',
			'{"id":42}',
			'--module',
			MODULE,
			'--approve',
			'--format',
			'json'
		);

		expect(code).toBe(0);
		expect(JSON.parse(stdout)).toMatchObject({ success: true, data: { deleted: 42 } });
		expect(deleted).toEqual([42]);
		// JSON output keeps stderr quiet when nobody is asked.
		expect(stderr).not.toContain('needs approval');
	});

	it('shows the summary and expiry on stderr in text format', async () => {
		const { stderr } = await run('todo-delete', '{"id":1}', '--module', MODULE, '--approve');
		expect(stderr).toContain('todo-delete needs approval before it runs.');
		expect(stderr).toContain('Action: Delete the todo (permanent)');
		expect(stderr).toMatch(/Approval expires: \d{4}-\d{2}-\d{2}T/);
	});

	it('rejects --approve without --module before connecting', async () => {
		mocks.requireClient.mockClear();
		const { code, stderr } = await run('todo-delete', '{"id":42}', '--approve');
		expect(code).toBe(1);
		expect(stderr).toContain('--approve needs --module');
		expect(mocks.requireClient).not.toHaveBeenCalled();
	});

	it('rejects --module together with --connect', async () => {
		const { code, stderr } = await run(
			'todo-delete',
			'{"id":42}',
			'--module',
			MODULE,
			'--connect',
			'http://localhost:3100/mcp'
		);
		expect(code).toBe(1);
		expect(stderr).toContain('--module and --connect cannot be used together');
	});

	it('over MCP, returns APPROVAL_REQUIRED unchanged and never sends a token', async () => {
		const held = {
			success: false,
			error: {
				code: 'APPROVAL_REQUIRED',
				message: 'todo-delete needs approval before it runs',
				details: { approvalToken: 'afdap1.x.y', expiresAt: '2026-10-26T12:05:00.000Z' },
			},
		};
		const call = vi.fn().mockResolvedValue(held);
		mocks.requireClient.mockResolvedValue({ call } as unknown as McpClient);

		const { code, stdout, stderr } = await run('todo-delete', '{"id":42}', '--format', 'json');

		expect(code).toBe(1);
		expect(JSON.parse(stdout)).toEqual(held);
		expect(call).toHaveBeenCalledOnce();
		expect(call).toHaveBeenCalledWith('todo-delete', { id: 42 });
		expect(stderr).not.toContain('cannot approve');
	});

	it('over MCP in text format, explains why it cannot approve', async () => {
		const call = vi.fn().mockResolvedValue({
			success: false,
			error: { code: 'APPROVAL_REQUIRED', message: 'held', details: {} },
		});
		mocks.requireClient.mockResolvedValue({ call } as unknown as McpClient);

		const { code, stderr } = await run('todo-delete', '{"id":42}');

		expect(code).toBe(1);
		expect(stderr).toContain('The CLI cannot approve a call over MCP');
	});
});
