/**
 * End-to-end tests: spawn the built CLI against a real AFD MCP server.
 *
 * Nothing is mocked here. The client, both transports, process lifetime and
 * exit codes are all real, so these tests catch the bugs that the mocked unit
 * tests cannot (a CLI that never exits, a validator that runs mutations).
 *
 * The CLI runs from `dist/bin.js`. The Vitest global setup rebuilds it when it
 * is older than `src`, and `beforeAll` fails with a clear message if the CLI or
 * a workspace package it runs on is still stale.
 */

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpHandler, defineCommand, failure, success } from '@lushly-dev/afd-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CLI_PACKAGE_DIR, staleOutputs, WORKSPACE_DEPENDENCIES } from '../vitest.global-setup.js';

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

/** A one-shot command that is still running after this long is treated as hung. */
const EXIT_DEADLINE_MS = 10_000;

const calls = {
	ping: [] as unknown[],
	reset: 0,
};

const ESC = '\x1b';
const BEL = '\x07';
/** Window title (OSC 0), a hidden hyperlink (OSC 8), cursor up + erase line (CSI), 8-bit CSI. */
const hostile = (label: string) =>
	`${ESC}]0;pwned${BEL}${ESC}]8;;https://evil.example${ESC}\\${label}${ESC}]8;;${ESC}\\${ESC}[2A${ESC}[2K\x9b1m`;

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
		name: 'evil-echo',
		description: hostile('Echo text back'),
		category: 'evil',
		input: z.object({}),
		expose: { mcp: true },
		async handler() {
			return success(hostile('string-data'), {
				reasoning: hostile('reasoning'),
				warnings: [{ code: 'EVIL', message: hostile('warning') }],
			});
		},
	}),
	defineCommand({
		name: 'evil-fail',
		description: 'Fail with hostile error text',
		category: 'evil',
		input: z.object({}),
		expose: { mcp: true },
		async handler() {
			return failure({ code: 'EVIL', message: hostile('message'), suggestion: hostile('advice') });
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
/** When set, the server answers 401 to any request without this Authorization header. */
let requiredAuth: string | null = null;

/** Run the built CLI with an isolated config directory. */
function runCli(args: string[], input = '', env: Record<string, string> = {}): Promise<CliRun> {
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
				AFD_HEADERS: '',
				...env,
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

/**
 * Assert that server text reached the terminal without any control character
 * (JSON-rendered values may still show the escapes as inert `\u001b` text).
 */
function expectTerminalSafe(run: CliRun, ...labels: string[]): void {
	const output = run.stdout + run.stderr;
	for (const control of [ESC, BEL, '\x9b', '\x9c', '\x9d']) {
		expect(
			output,
			`control character ${JSON.stringify(control)} reached the terminal`
		).not.toContain(control);
	}
	for (const label of labels) expect(output).toContain(label);
}

/** The CLI's config file inside the isolated config directory. */
function configFile(): string {
	const found = readdirSync(configHome, { recursive: true, encoding: 'utf8' }).find((file) =>
		file.endsWith('config.json')
	);
	if (!found) throw new Error(`No config.json under ${configHome}`);
	return join(configHome, found);
}

async function savedConfig(): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(configFile(), 'utf8')) as Record<string, unknown>;
}

beforeAll(async () => {
	// The global setup rebuilds the CLI; the workspace packages it runs on are
	// only built by `pnpm build`.
	const stale = [CLI_PACKAGE_DIR, ...WORKSPACE_DEPENDENCIES].flatMap((dir) =>
		staleOutputs(dir).map((file) => relative(join(CLI_PACKAGE_DIR, '..'), join(dir, 'src', file)))
	);
	if (stale.length > 0) {
		throw new Error(
			`The CLI e2e tests run built code, but dist is missing or older than these sources:\n  ${stale
				.slice(0, 10)
				.join('\n  ')}\nRun "pnpm build", then run the tests again.`
		);
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
	server = createServer((req, res) => {
		if (requiredAuth !== null && req.headers.authorization !== requiredAuth) {
			res.writeHead(401).end();
			return;
		}
		void handler(req, res);
	});
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
	requiredAuth = null;
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
	describe('terminal escape injection', () => {
		beforeEach(async () => {
			expectExit(await runCli(['connect', `${baseUrl}/message`, '--transport', 'http']), 0);
		});

		it('call, tools, batch and validate strip escape sequences from server text', async () => {
			const call = await runCli(['call', 'evil-echo', '--verbose']);
			expectExit(call, 0);
			expectTerminalSafe(call, 'string-data', 'reasoning', 'warning');

			const failed = await runCli(['call', 'evil-fail']);
			expectExit(failed, 1);
			expectTerminalSafe(failed, '[EVIL] message', 'advice');

			const tools = await runCli(['tools', '--category', 'evil']);
			expectExit(tools, 0);
			expectTerminalSafe(tools, 'evil/', 'Echo text back');

			const batch = await runCli([
				'batch',
				'[{"command":"evil-echo"},{"command":"evil-fail"}]',
				'--verbose',
			]);
			expectExit(batch, 2);
			expectTerminalSafe(batch, 'string-data', '[EVIL] message', 'advice');

			const validate = await runCli(['validate', '--execute', '--verbose', '--category', 'evil']);
			expectTerminalSafe(validate, 'evil-echo', 'evil-fail');
		});

		it('stream and shell strip escape sequences from server text', async () => {
			const stream = await runCli(['stream', 'evil-echo']);
			expectExit(stream, 0);
			expectTerminalSafe(stream, 'string-data', 'reasoning');

			const streamError = await runCli(['stream', 'evil-fail']);
			expectExit(streamError, 1);
			expectTerminalSafe(streamError, 'message', 'advice');

			const shell = await runCli(['shell'], 'evil-echo\nevil-fail\ntools evil\n');
			expectExit(shell, 0);
			expectTerminalSafe(shell, 'string-data', '[EVIL] message', 'Echo text back');
		});

		it('JSON output keeps the data intact with the escapes encoded', async () => {
			const call = await runCli(['call', 'evil-echo', '--format', 'json']);
			expectExit(call, 0);
			expect(call.stdout).not.toContain(ESC);
			expect(JSON.parse(call.stdout).data).toBe(hostile('string-data'));
		});
	});

	describe('credentials', () => {
		it('sends --header and AFD_HEADERS on every request and never saves them', async () => {
			requiredAuth = 'Bearer e2e-secret';
			const header = 'Authorization: Bearer e2e-secret';

			const refused = await runCli(['connect', `${baseUrl}/sse`]);
			expectExit(refused, 1);

			const connect = await runCli(['connect', `${baseUrl}/sse`, '--header', header]);
			expectExit(connect, 0);
			expect(connect.stdout).toContain('Request headers are not saved');
			expect(await readFile(configFile(), 'utf8')).not.toContain('e2e-secret');

			// The saved connection alone is refused, with a hint on how to authenticate.
			const bare = await runCli(['call', 'health-ping']);
			expectExit(bare, 1);
			expect(bare.stderr).toContain(`Could not connect to ${baseUrl}/sse`);
			expect(bare.stdout).toContain('AFD_HEADERS');

			const fromEnv = await runCli(['call', 'health-ping', 'echo=env'], '', {
				AFD_HEADERS: header,
			});
			expectExit(fromEnv, 0);

			const overHttp = await runCli([
				'call',
				'health-ping',
				'echo=flag',
				'-H',
				header,
				'--connect',
				`${baseUrl}/message`,
			]);
			expectExit(overHttp, 0);

			const stream = await runCli(['stream', 'health-ping', '--header', header]);
			expectExit(stream, 0);
			expect(stream.stdout).toContain('Stream complete');

			const shell = await runCli(['shell', '-H', header], 'health-ping echo=shell\n');
			expectExit(shell, 0);

			expect(calls.ping).toEqual([{ echo: 'env' }, { echo: 'flag' }, {}, { echo: 'shell' }]);
		});

		it('rejects a malformed header before connecting', async () => {
			const run = await runCli(['call', 'health-ping', '--connect', baseUrl, '-H', 'nonsense']);
			expectExit(run, 1);
			expect(run.stderr).toContain('Use "Name: value"');

			const fromEnv = await runCli(['call', 'health-ping', '--connect', baseUrl], '', {
				AFD_HEADERS: 'nonsense',
			});
			expectExit(fromEnv, 1);
			expect(fromEnv.stderr).toContain('AFD_HEADERS: Invalid header');
			expect(calls.ping).toEqual([]);
		});

		it('redacts URL credentials in connect and status output', async () => {
			const url = `${baseUrl}/sse?token=e2e-token&page=1`;
			const connect = await runCli(['connect', url]);
			expectExit(connect, 0);
			expect(connect.stdout).toContain(`${baseUrl}/sse?token=***&page=1`);
			expect(connect.stdout).toContain('The URL contains credentials');

			const status = await runCli(['status']);
			expectExit(status, 0);
			expect(status.stdout).toContain('token=***');
			expect(connect.stdout + connect.stderr + status.stdout + status.stderr).not.toContain(
				'e2e-token'
			);
		});

		it.skipIf(process.platform === 'win32')('saves the config file with mode 0600', async () => {
			expectExit(await runCli(['connect', `${baseUrl}/message`, '--transport', 'http']), 0);
			expect((await stat(configFile())).mode & 0o777).toBe(0o600);
		});
	});

	describe('saved connection', () => {
		it('the shell saves the transport together with the URL', async () => {
			expectExit(await runCli(['connect', `${baseUrl}/message`, '--transport', 'http']), 0);
			expect(await savedConfig()).toMatchObject({
				serverUrl: `${baseUrl}/message`,
				transport: 'http',
			});

			expectExit(await runCli(['shell', '--url', `${baseUrl}/sse`], 'exit\n'), 0);
			expect(await savedConfig()).toMatchObject({ serverUrl: `${baseUrl}/sse`, transport: 'sse' });

			const call = await runCli(['call', 'health-ping']);
			expectExit(call, 0);
		});
	});

	describe('interactive shell input', () => {
		it('keeps whitespace in JSON arguments, resolves kebab-case names and stops at exit', async () => {
			const input = [
				'health-ping {"echo": "two  spaces\\tand a tab"}',
				'call health-ping echo="quoted value"',
				'exit',
				'health-ping {"echo": "after exit"}',
			].join('\n');
			const shell = await runCli(['shell', '--url', `${baseUrl}/message`], `${input}\n`);
			expectExit(shell, 0);
			expect(calls.ping).toEqual([{ echo: 'two  spaces\tand a tab' }, { echo: 'quoted value' }]);
			expect(shell.stdout).toContain('Goodbye!');
		});
	});

	describe('scenario run', () => {
		let scenarioDir: string;

		beforeEach(async () => {
			scenarioDir = await mkdtemp(join(tmpdir(), 'afd-cli-scenarios-'));
			// Both scenarios fail and both call health-ping, at different step
			// positions. The first passes one step, so its outcome is `partial`.
			await writeFile(
				join(scenarioDir, 'a.scenario.yaml'),
				[
					'name: First',
					'description: Fails at its second step',
					'job: first-job',
					'steps:',
					'  - command: health-score',
					'    expect:',
					'      success: true',
					'  - command: health-ping',
					'    expect:',
					'      success: false',
				].join('\n')
			);
			await writeFile(
				join(scenarioDir, 'b.scenario.yaml'),
				[
					'name: Second',
					'description: Fails at its only step',
					'job: second-job',
					'steps:',
					'  - command: health-ping',
					'    expect:',
					'      success: false',
				].join('\n')
			);
		});

		afterEach(async () => {
			await rm(scenarioDir, { recursive: true, force: true });
		});

		const runScenarios = (...flags: string[]) =>
			runCli([
				'scenario',
				'run',
				scenarioDir,
				'--server',
				`${baseUrl}/message`,
				'--transport',
				'http',
				'--no-color',
				...flags,
			]);

		it('stops after the first failing (here partial) scenario by default', async () => {
			const run = await runScenarios();
			expectExit(run, 1);
			expect(run.stdout).toContain('▸ first-job');
			expect(run.stdout).not.toContain('▸ second-job');
		});

		it('--no-stop-on-failure runs every scenario and numbers steps per scenario', async () => {
			const run = await runScenarios('--no-stop-on-failure');
			expectExit(run, 1);
			expect(run.stdout).toContain('▸ first-job');
			expect(run.stdout).toContain('▸ second-job');
			expect(run.stdout).toMatch(/\[1\/2\] health-score/);
			expect(run.stdout).toMatch(/\[2\/2\] health-ping/);
			expect(run.stdout).toMatch(/\[1\/1\] health-ping/);
			expect(run.stdout).not.toContain('[0/');
		});
	});
});
