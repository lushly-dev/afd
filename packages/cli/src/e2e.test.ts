/**
 * End-to-end tests: spawn the built CLI against a real AFD MCP server.
 *
 * Nothing is mocked here. The client, both transports, process lifetime and
 * exit codes are all real, so these tests catch the bugs that the mocked unit
 * tests cannot (a CLI that never exits, a validator that runs mutations).
 *
 * Requires `pnpm build` first: the CLI runs from `dist/bin.js`.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpHandler, defineCommand, success } from '@lushly-dev/afd-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

/** A one-shot command that is still running after this long is treated as hung. */
const EXIT_DEADLINE_MS = 10_000;

const calls = {
	ping: [] as unknown[],
	reset: 0,
};

const commands = [
	defineCommand({
		name: 'health-ping',
		description: 'Report that the server is reachable',
		category: 'health',
		input: z.object({ echo: z.string().optional() }),
		examples: [{ title: 'Echo a value', input: { echo: 'hello' } }],
		expose: { mcp: true },
		async handler(input) {
			calls.ping.push(input);
			return success({ pong: true, echo: input.echo ?? null }, { reasoning: 'Server is up' });
		},
	}),
	defineCommand({
		name: 'health-score',
		description: 'Return a score with an out-of-range confidence value',
		category: 'health',
		input: z.object({}),
		expose: { mcp: true },
		async handler() {
			return success({ score: 42 }, { confidence: 1.5, reasoning: 'Overconfident on purpose' });
		},
	}),
	defineCommand({
		name: 'db-reset',
		description: 'Delete every record in the database',
		category: 'db',
		mutation: true,
		input: z.object({}),
		expose: { mcp: true },
		async handler() {
			calls.reset++;
			return success({ reset: true });
		},
	}),
];

interface CliRun {
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

let server: Server;
let dispose: () => void;
let baseUrl: string;
let configHome: string;

/** Run the built CLI with an isolated config directory. */
function runCli(args: string[], input = ''): Promise<CliRun> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [BIN, ...args], {
			env: {
				...process.env,
				// Conf resolves its directory from these (Linux, macOS, Windows),
				// so the user's real config is never read or written.
				HOME: configHome,
				USERPROFILE: configHome,
				XDG_CONFIG_HOME: configHome,
				APPDATA: configHome,
				FORCE_COLOR: '0',
				NO_COLOR: '1',
			},
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			stderr += chunk;
		});
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
		}, EXIT_DEADLINE_MS);
		child.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once('close', (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr, timedOut });
		});
		child.stdin.end(input);
	});
}

/** Assert that the CLI exited on its own with the expected code. */
function expectExit(run: CliRun, code: number): void {
	const transcript = `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`;
	expect(run.timedOut, `CLI still running after ${EXIT_DEADLINE_MS}ms\n${transcript}`).toBe(false);
	expect(run.code, transcript).toBe(code);
}

beforeAll(async () => {
	if (!existsSync(BIN)) {
		throw new Error(`${BIN} does not exist. Run "pnpm build" before the CLI e2e tests.`);
	}
	const handler = createMcpHandler({
		name: 'cli-e2e',
		version: '1.0.0',
		commands,
		host: '127.0.0.1',
		port: 0,
		toolStrategy: 'individual',
	});
	dispose = handler.dispose;
	server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	dispose();
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
	calls.ping = [];
	calls.reset = 0;
	configHome = await mkdtemp(join(tmpdir(), 'afd-cli-e2e-'));
});

afterEach(async () => {
	await rm(configHome, { recursive: true, force: true });
});

describe('afd CLI against a real server', { timeout: 60_000 }, () => {
	describe('process lifetime over SSE', () => {
		it('connect, call, status, tools, batch and stream all exit on their own', async () => {
			const connect = await runCli(['connect', `${baseUrl}/sse`]);
			expectExit(connect, 0);
			expect(connect.stdout).toContain('Connected');

			const call = await runCli(['call', 'health-ping', 'echo=sse']);
			expectExit(call, 0);
			expect(call.stdout).toContain('✓ Success');
			expect(calls.ping).toEqual([{ echo: 'sse' }]);

			const status = await runCli(['status']);
			expectExit(status, 0);
			expect(status.stdout).toContain('Connected');

			const tools = await runCli(['tools', '--category', 'health']);
			expectExit(tools, 0);
			expect(tools.stdout).toContain('health-ping');
			expect(tools.stdout).not.toContain('db-reset');

			const batch = await runCli(['batch', '[{"command":"health-ping"}]']);
			expectExit(batch, 0);
			expect(batch.stdout).toContain('Batch completed successfully');

			const stream = await runCli(['stream', 'health-ping']);
			expectExit(stream, 0);
			expect(stream.stdout).toContain('Stream complete');
		});

		it('call --connect with an SSE URL exits without saved config', async () => {
			const call = await runCli([
				'call',
				'health-ping',
				'--connect',
				`${baseUrl}/sse`,
				'--transport',
				'sse',
			]);
			expectExit(call, 0);
			expect(call.stdout).toContain('✓ Success');
		});

		it('the interactive shell finishes queued input before disconnecting', async () => {
			const shell = await runCli(['shell', '--url', `${baseUrl}/sse`], 'call health-ping\n');
			expectExit(shell, 0);
			expect(shell.stdout).toContain('✓ Success');
			expect(shell.stdout).toContain('Goodbye!');
			expect(calls.ping).toHaveLength(1);
		});
	});

	describe('process lifetime over HTTP', () => {
		it('connect and call exit on their own', async () => {
			expectExit(await runCli(['connect', `${baseUrl}/message`, '--transport', 'http']), 0);

			const call = await runCli(['call', 'health-ping']);
			expectExit(call, 0);
			expect(call.stdout).toContain('✓ Success');
		});

		it('call --connect defaults to HTTP and exits', async () => {
			const call = await runCli(['call', 'health-ping', '--connect', `${baseUrl}/message`]);
			expectExit(call, 0);
			expect(call.stdout).toContain('✓ Success');
		});
	});

	describe('validate', () => {
		beforeEach(async () => {
			expectExit(await runCli(['connect', `${baseUrl}/message`, '--transport', 'http']), 0);
		});

		it('checks the tool listing without executing anything by default', async () => {
			const run = await runCli(['validate']);
			expect(calls.reset, 'validate ran the mutation command').toBe(0);
			expect(calls.ping).toEqual([]);
			expectExit(run, 0);
			expect(run.stdout).toContain('db-reset');
			expect(run.stdout).toContain('--execute');
		});

		it('--execute runs read-only tools with example input and skips mutations', async () => {
			const run = await runCli(['validate', '--execute', '--verbose']);
			expect(calls.reset, 'validate --execute ran the mutation command').toBe(0);
			expect(calls.ping).toEqual([{ echo: 'hello' }]);
			// health-score returns confidence 1.5, which is a real validation failure.
			expectExit(run, 1);
			expect(run.stdout).toMatch(/db-reset.*skipped.*mutation/i);
			expect(run.stdout).toContain('confidence must be between 0 and 1');
		});

		it('--execute --category filters on _meta.category', async () => {
			const run = await runCli(['validate', '--execute', '--category', 'db']);
			expect(calls.reset, 'validate --execute ran the mutation command').toBe(0);
			expect(calls.ping).toEqual([]);
			expectExit(run, 0);
			expect(run.stdout).toMatch(/db-reset.*skipped/i);
			expect(run.stdout).not.toContain('health-ping');
		});
	});

	describe('out-of-range confidence', () => {
		it('call, batch and stream render confidence 1.5 without crashing', async () => {
			expectExit(await runCli(['connect', `${baseUrl}/message`, '--transport', 'http']), 0);

			const call = await runCli(['call', 'health-score']);
			expectExit(call, 0);
			expect(call.stdout).toContain('Confidence:');
			expect(call.stderr).not.toContain('RangeError');

			const batch = await runCli(['batch', '[{"command":"health-score"}]']);
			expectExit(batch, 0);
			expect(batch.stdout).toContain('Confidence:');

			const stream = await runCli(['stream', 'health-score']);
			expectExit(stream, 0);
			expect(stream.stdout).toContain('Confidence:');
		});
	});
});
