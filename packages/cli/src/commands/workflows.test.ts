import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpClient } from '@lushly-dev/afd-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const spinner = {
		text: '',
		start: vi.fn(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		warn: vi.fn(),
	};
	spinner.start.mockReturnValue(spinner);
	return {
		ensureConnected: vi.fn(),
		getClient: vi.fn().mockReturnValue(null),
		setClient: vi.fn(),
		createClient: vi.fn(),
		spinner,
		glob: vi.fn(),
		parseScenarioFile: vi.fn(),
		calculateSummary: vi.fn(),
		validateCommandSurface: vi.fn(),
		validateResult: vi.fn(),
		config: {} as Record<string, unknown>,
		setConfig: vi.fn(),
		deleteConfig: vi.fn(),
		reporter: {
			reportScenarioStart: vi.fn(),
			reportStepProgress: vi.fn(),
			reportTestReport: vi.fn(),
			reportAll: vi.fn(),
		},
		scenarioResult: {
			outcome: 'pass',
			steps: [],
			durationMs: 1,
		},
	};
});

vi.mock('../connection.js', () => ({
	ensureConnected: mocks.ensureConnected,
	getClient: mocks.getClient,
	setClient: mocks.setClient,
}));
vi.mock('../config.js', () => ({
	getConfig: () => mocks.config,
	setConfig: mocks.setConfig,
	deleteConfig: mocks.deleteConfig,
}));
vi.mock('@lushly-dev/afd-client', () => ({ createClient: mocks.createClient }));
vi.mock('ora', () => ({ default: () => mocks.spinner }));
vi.mock('glob', () => ({ glob: mocks.glob }));
vi.mock('@lushly-dev/afd-testing', () => ({
	parseScenarioFile: mocks.parseScenarioFile,
	calculateSummary: mocks.calculateSummary,
	validateCommandSurface: mocks.validateCommandSurface,
	validateResult: mocks.validateResult,
	TerminalReporter: class {
		reportScenarioStart = mocks.reporter.reportScenarioStart;
		reportStepProgress = mocks.reporter.reportStepProgress;
		reportTestReport = mocks.reporter.reportTestReport;
		reportAll = mocks.reporter.reportAll;
	},
	InProcessExecutor: class {
		constructor(
			private readonly options: {
				handler: (command: string, input: Record<string, unknown>) => Promise<unknown>;
				onScenarioStart: (scenario: { job: string; description: string }) => void;
				onStepComplete: (step: { command: string }, result: unknown) => void;
			}
		) {}
		async execute(scenario: {
			job: string;
			description: string;
			steps: Array<{ command: string }>;
		}) {
			this.options.onScenarioStart(scenario);
			const step = scenario.steps[0];
			if (step) {
				const result = await this.options.handler(step.command, {});
				this.options.onStepComplete(step, result);
			}
			return { ...mocks.scenarioResult };
		}
	},
}));

import { createCli } from '../cli.js';

function client(overrides: Record<string, unknown> = {}): McpClient {
	return {
		connect: vi.fn().mockResolvedValue({
			serverInfo: { name: 'test-server', version: '1.0.0' },
		}),
		disconnect: vi.fn().mockResolvedValue(undefined),
		isConnected: vi.fn().mockReturnValue(true),
		getStatus: vi.fn().mockReturnValue({
			state: 'connected',
			url: 'http://test/mcp',
			serverInfo: { name: 'test-server', version: '1.0.0' },
		}),
		getTools: vi.fn().mockReturnValue([]),
		refreshTools: vi.fn().mockResolvedValue([]),
		call: vi.fn().mockResolvedValue({ success: true, data: { ok: true } }),
		batch: vi.fn(),
		stream: vi.fn(),
		...overrides,
	} as unknown as McpClient;
}

async function run(...args: string[]): Promise<void> {
	await createCli().exitOverride().parseAsync(args, { from: 'user' });
}

describe('CLI command workflows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.spinner.start.mockReturnValue(mocks.spinner);
		mocks.getClient.mockReturnValue(null);
		mocks.scenarioResult.outcome = 'pass';
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
	});

	afterEach(() => vi.restoreAllMocks());

	it('executes and renders a verbose partial batch with normalized inputs', async () => {
		const batch = vi.fn().mockResolvedValue({
			success: true,
			results: [
				{
					id: 'cmd-0',
					index: 0,
					command: 'todo.create',
					result: { success: true, data: { title: 'x'.repeat(120) } },
					durationMs: 3,
				},
				{
					id: 'second',
					index: 1,
					command: 'todo.fail',
					result: {
						success: false,
						error: { code: 'FAIL', message: 'failed', suggestion: 'retry' },
					},
					durationMs: 4,
				},
			],
			summary: { total: 3, successCount: 1, failureCount: 1, skippedCount: 1 },
			timing: { totalMs: 7, averageMs: 3.5, startedAt: '', completedAt: '' },
			confidence: 0.6,
			reasoning: 'partial',
			warnings: [{ commandId: 'cmd-0', code: 'WARN', message: 'warning' }],
		});
		mocks.ensureConnected.mockResolvedValue(client({ batch }));

		await run(
			'batch',
			'[{"name":"todo.create","args":{"title":"A"}},{"id":"second","command":"todo.fail"}]',
			'--parallel',
			'2',
			'--stop-on-error',
			'--verbose'
		);

		expect(batch).toHaveBeenCalledWith(
			[
				{ id: 'cmd-0', command: 'todo.create', input: { title: 'A' } },
				{ id: 'second', command: 'todo.fail', input: {} },
			],
			{ stopOnError: true, timeout: 30000, parallelism: 2 }
		);
		expect(process.exit).toHaveBeenCalledWith(2);
	});

	it('renders failed and JSON batch envelopes', async () => {
		const batch = vi
			.fn()
			.mockResolvedValueOnce({
				success: false,
				results: [],
				summary: { total: 0, successCount: 0, failureCount: 0, skippedCount: 0 },
				timing: { totalMs: 0, averageMs: 0, startedAt: '', completedAt: '' },
				confidence: 0.2,
				reasoning: 'failed',
				error: { code: 'BATCH_ERROR', message: 'bad', suggestion: 'fix it' },
			})
			.mockResolvedValueOnce({
				success: true,
				results: [],
				summary: { total: 0, successCount: 0, failureCount: 0, skippedCount: 0 },
				timing: { totalMs: 0, averageMs: 0, startedAt: '', completedAt: '' },
				confidence: 1,
				reasoning: 'done',
			});
		mocks.ensureConnected.mockResolvedValue(client({ batch }));

		await run('batch', '[]');
		await run('batch', '[]', '--format', 'json');

		expect(process.exit).toHaveBeenCalledWith(1);
		expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"success": true'));
	});

	it('calls commands with key-value arguments and reports failures', async () => {
		const call = vi
			.fn()
			.mockResolvedValueOnce({ success: true, data: { ok: true } })
			.mockResolvedValueOnce({
				success: false,
				error: { code: 'NOPE', message: 'no', retryable: true, details: { why: 'test' } },
			});
		mocks.ensureConnected.mockResolvedValue(client({ call }));

		await run('call', 'todo.create', 'count=2 label=hello', '--verbose');
		await run('call', 'todo.fail', '{}', '--verbose');

		expect(call).toHaveBeenNthCalledWith(1, 'todo.create', { count: 2, label: 'hello' });
		expect(process.exit).toHaveBeenCalledWith(1);
	});

	it('refreshes, filters by _meta.category or kebab prefix, and prints tools', async () => {
		const refreshTools = vi.fn().mockResolvedValue([
			{
				name: 'todo-create',
				description: 'Create',
				inputSchema: { type: 'object' },
				_meta: { category: 'todo' },
			},
			{ name: 'todo-legacy', description: 'Legacy', inputSchema: { type: 'object' } },
			{
				name: 'todo-export',
				description: 'Export',
				inputSchema: { type: 'object' },
				_meta: { category: 'reports' },
			},
			{ name: 'user-get', description: 'Get', inputSchema: { type: 'object' } },
		]);
		mocks.ensureConnected.mockResolvedValue(
			client({ getTools: vi.fn().mockReturnValue([]), refreshTools })
		);

		await run('tools', '--category', 'todo', '--refresh', '--format', 'json');

		expect(refreshTools).toHaveBeenCalled();
		const printed = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])) as Array<{
			name: string;
		}>;
		expect(printed.map((tool) => tool.name)).toEqual(['todo-create', 'todo-legacy']);
	});

	it('renders every text stream chunk and forwards parsed options', async () => {
		const stream = vi.fn().mockImplementation(async function* () {
			yield { type: 'progress', progress: 0.5, message: 'half', itemsProcessed: 1, itemsTotal: 2 };
			yield { type: 'data', data: 'piece', index: 0, isLast: false };
			yield { type: 'data', data: { id: 1 }, index: 1, isLast: true };
			yield {
				type: 'complete',
				totalChunks: 2,
				totalDurationMs: 5,
				confidence: 0.4,
				reasoning: 'complete',
				data: { count: 2 },
			};
		});
		mocks.ensureConnected.mockResolvedValue(client({ stream }));

		await run('stream', 'export.run', 'limit=2 format=csv', '--timeout', '50');

		expect(stream).toHaveBeenCalledWith(
			'export.run',
			{ limit: 2, format: 'csv' },
			expect.objectContaining({ timeout: 50, signal: expect.any(AbortSignal) })
		);
		expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('50%'));
	});

	it('renders recoverable stream errors and JSON chunks', async () => {
		const stream = vi
			.fn()
			.mockImplementationOnce(async function* () {
				yield {
					type: 'error',
					error: { code: 'BROKEN', message: 'broken', suggestion: 'resume' },
					chunksBeforeError: 2,
					recoverable: true,
					resumeFrom: 2,
				};
			})
			.mockImplementationOnce(async function* () {
				yield { type: 'data', data: 1, index: 0 };
			});
		mocks.ensureConnected.mockResolvedValue(client({ stream }));

		await run('stream', 'export.run', '{}', '--no-progress');
		await run('stream', 'export.run', '{}', '--format', 'json');

		expect(process.exit).toHaveBeenCalledWith(1);
		expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"type":"data"'));
	});

	it('connects, reports status, and disconnects through command workflows', async () => {
		const connected = client();
		mocks.createClient.mockReturnValue(connected);
		mocks.getClient.mockReturnValueOnce(null).mockReturnValue(connected);
		mocks.ensureConnected.mockResolvedValue(connected);

		await run(
			'connect',
			'http://test/mcp',
			'--transport',
			'http',
			'--timeout',
			'25',
			'--no-reconnect'
		);
		await run('status');
		await run('disconnect');

		expect(mocks.createClient).toHaveBeenCalledWith({
			url: 'http://test/mcp',
			transport: 'http',
			timeout: 25,
			autoReconnect: false,
		});
		expect(connected.disconnect).toHaveBeenCalled();
		expect(mocks.setClient).toHaveBeenCalledWith(null);
	});

	it('runs surface and per-command validation workflows', async () => {
		const tools = [
			{
				name: 'todo-create',
				description: 'Create a todo item',
				inputSchema: { type: 'object' },
				_meta: {
					category: 'todo',
					contexts: ['editing'],
					examples: [{ title: 'Basic', input: { title: 'Buy milk' } }],
				},
			},
			{
				name: 'todo-clear',
				description: 'Delete every todo item',
				inputSchema: { type: 'object' },
				_meta: { category: 'todo', mutation: true },
			},
			{
				name: 'user-get',
				description: 'Get a user by id',
				inputSchema: { type: 'object' },
				_meta: { category: 'user' },
			},
		];
		const connected = client({ refreshTools: vi.fn().mockResolvedValue(tools) });
		mocks.ensureConnected.mockResolvedValue(connected);
		mocks.validateCommandSurface.mockReturnValue({
			valid: true,
			findings: [
				{
					severity: 'warning',
					rule: 'description',
					message: 'short',
					commands: ['todo.create'],
					suggestion: 'expand',
					evidence: { length: 6 },
				},
			],
			summary: {
				commandCount: 1,
				rulesEvaluated: ['description'],
				durationMs: 1,
				errorCount: 0,
				warningCount: 1,
				infoCount: 0,
				suppressedCount: 0,
			},
		});
		mocks.validateResult.mockReturnValue({ valid: true, errors: [], warnings: [] });

		await run('validate', '--surface', '--verbose', '--skip-category', 'internal');
		expect(mocks.validateCommandSurface).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({ configuredContexts: ['editing'] })
		);

		// Without --execute, nothing is called.
		await run('validate', '--category', 'todo');
		expect(connected.call).not.toHaveBeenCalled();
		expect(mocks.validateResult).not.toHaveBeenCalled();
		expect(process.exit).not.toHaveBeenCalled();

		// With --execute, read-only tools get their example input; mutations are skipped.
		await run('validate', '--category', 'todo', '--execute');
		expect(connected.call).toHaveBeenCalledTimes(1);
		expect(connected.call).toHaveBeenCalledWith('todo-create', { title: 'Buy milk' });
		expect(console.log).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringContaining('todo-clear')
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringContaining('skipped (mutation: true)')
		);
		expect(process.exit).not.toHaveBeenCalled();
	});

	it('never calls tools without --execute and fails on listing errors', async () => {
		const connected = client({
			refreshTools: vi.fn().mockResolvedValue([
				{
					name: 'db-reset',
					description: 'Delete every record',
					inputSchema: { type: 'object' },
					_meta: { mutation: true },
				},
				{ name: 'no-description', inputSchema: { type: 'object' } },
				{ name: 'bad-schema', description: 'Has a broken schema', inputSchema: { type: 'string' } },
			]),
		});
		mocks.ensureConnected.mockResolvedValue(connected);

		await run('validate', '--verbose');

		expect(connected.call).not.toHaveBeenCalled();
		const output = vi.mocked(console.log).mock.calls.flat().join('\n');
		expect(output).toContain('description: Tool must have a description');
		expect(output).toContain('inputSchema: inputSchema must be a JSON Schema');
		expect(output).toContain('no tools were executed');
		expect(process.exit).toHaveBeenCalledWith(1);
	});

	it('skips destructive tools under --execute and reports the skip even with warnings', async () => {
		const connected = client({
			refreshTools: vi.fn().mockResolvedValue([
				{
					name: 'file-purge',
					description: 'Purge',
					inputSchema: { type: 'object' },
					_meta: { destructive: true },
				},
			]),
		});
		mocks.ensureConnected.mockResolvedValue(connected);

		await run('validate', '--execute');

		expect(connected.call).not.toHaveBeenCalled();
		expect(console.log).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringContaining('skipped (destructive: true)')
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining('not executed (mutation or destructive)')
		);
	});

	it('validates, runs, and initializes scenario files', async () => {
		const scenario = {
			name: 'workflow',
			job: 'do-work',
			description: 'A workflow',
			steps: [{ command: 'todo.create' }],
		};
		mocks.glob.mockResolvedValue(['/tmp/workflow.scenario.yaml']);
		mocks.parseScenarioFile.mockResolvedValue({ success: true, scenario });
		mocks.calculateSummary.mockReturnValue({
			totalScenarios: 1,
			passedScenarios: 1,
			failedScenarios: 0,
			errorScenarios: 0,
		});
		const scenarioClient = client();
		mocks.createClient.mockReturnValue(scenarioClient);

		await run('scenario', 'validate', 'scenarios');
		await run('scenario', 'run', 'scenarios', '--server', 'http://test/mcp', '--json');

		expect(mocks.reporter.reportTestReport).toHaveBeenCalled();
		expect(scenarioClient.call).toHaveBeenCalledWith('todo.create', {});
		expect(scenarioClient.disconnect).toHaveBeenCalled();
	});

	it('creates a usable sample scenario file', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'afd-cli-scenario-'));
		const output = join(directory, 'nested', 'sample.scenario.yaml');
		try {
			await run('scenario', 'init', '--output', output);
			const contents = await readFile(output, 'utf8');
			expect(contents).toContain('job: create-and-complete-todo');
			expect(contents).toContain('${{ steps[0].data.id }}');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('reports every surface validation severity and suppressed findings', async () => {
		const connected = client({
			refreshTools: vi
				.fn()
				.mockResolvedValue([
					{ name: 'alpha.run', inputSchema: { type: 'object' }, _meta: { contexts: [] } },
				]),
		});
		mocks.ensureConnected.mockResolvedValue(connected);
		mocks.validateCommandSurface.mockReturnValue({
			valid: false,
			findings: [
				{
					severity: 'error',
					rule: 'duplicate',
					message: 'duplicate commands',
					commands: ['alpha.run'],
					suggestion: 'rename',
					evidence: { similarity: 1 },
				},
				{
					severity: 'info',
					rule: 'hint',
					message: 'consider metadata',
					commands: ['alpha.run'],
					suggestion: 'add metadata',
				},
				{
					severity: 'warning',
					rule: 'ignored',
					message: 'hidden',
					commands: [],
					suggestion: 'none',
					suppressed: true,
				},
			],
			summary: {
				commandCount: 1,
				rulesEvaluated: ['duplicate', 'hint'],
				durationMs: 2,
				errorCount: 1,
				warningCount: 0,
				infoCount: 1,
				suppressedCount: 1,
			},
		});

		await run(
			'validate',
			'--surface',
			'--strict',
			'--verbose',
			'--similarity-threshold',
			'0.8',
			'--suppress',
			'duplicate:alpha.run',
			'--suppress',
			'hint'
		);

		expect(process.exit).toHaveBeenCalledWith(1);
		expect(mocks.validateCommandSurface).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				strict: true,
				similarityThreshold: 0.8,
				suppressions: ['duplicate:alpha.run', 'hint'],
			})
		);
	});

	it('classifies per-command failures, warnings, successes, and thrown calls', async () => {
		const tools = ['bad-result', 'warn-result', 'good-result', 'throw-result'].map((name) => ({
			name,
			description: `Return a ${name} envelope`,
			inputSchema: { type: 'object' },
		}));
		const connected = client({
			refreshTools: vi.fn().mockResolvedValue(tools),
			call: vi
				.fn()
				.mockResolvedValueOnce({ success: true, data: 'bad' })
				.mockResolvedValueOnce({ success: true, data: 'warn' })
				.mockResolvedValueOnce({ success: true, data: 'good' })
				.mockRejectedValueOnce('network down'),
		});
		mocks.ensureConnected.mockResolvedValue(connected);
		mocks.validateResult
			.mockReturnValueOnce({
				valid: false,
				errors: [{ path: 'data.id', message: 'required' }],
				warnings: [],
			})
			.mockReturnValueOnce({
				valid: true,
				errors: [],
				warnings: [{ path: 'reasoning', message: 'recommended' }],
			})
			.mockReturnValueOnce({ valid: true, errors: [], warnings: [] });

		await run('validate', '--execute', '--verbose');

		expect(connected.call).toHaveBeenCalledTimes(4);
		expect(process.exit).toHaveBeenCalledWith(1);
		expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Validation Results:'));
		expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Error: network down'));
	});

	it('treats warnings as failures in strict per-command validation', async () => {
		mocks.ensureConnected.mockResolvedValue(
			client({
				refreshTools: vi.fn().mockResolvedValue([
					{
						name: 'warn-result',
						description: 'Return a warning envelope',
						inputSchema: { type: 'object' },
					},
				]),
			})
		);
		mocks.validateResult.mockReturnValue({
			valid: true,
			errors: [],
			warnings: [{ path: 'reasoning', message: 'recommended' }],
		});

		await run('validate', '--execute', '--strict', '--verbose');

		expect(process.exit).toHaveBeenCalledWith(1);
	});

	it('validates invalid wildcard scenarios and stops a human run on failure', async () => {
		const scenario = {
			name: 'workflow',
			job: 'do-work',
			description: 'A workflow',
			steps: [{ command: 'todo.fail' }],
		};
		mocks.glob.mockResolvedValue(['/tmp/one.scenario.yaml', '/tmp/two.scenario.yaml']);
		mocks.parseScenarioFile
			.mockResolvedValueOnce({ success: false, error: 'missing job' })
			.mockResolvedValueOnce({ success: true, scenario })
			.mockResolvedValueOnce({ success: false, error: 'missing job' })
			.mockResolvedValueOnce({ success: true, scenario });
		mocks.scenarioResult.outcome = 'fail';
		mocks.calculateSummary.mockReturnValue({
			totalScenarios: 1,
			passedScenarios: 0,
			failedScenarios: 1,
			errorScenarios: 0,
		});
		const scenarioClient = client({ call: vi.fn().mockRejectedValue(new Error('rejected')) });
		mocks.createClient.mockReturnValue(scenarioClient);

		await run('scenario', 'validate', '*.scenario.yaml');
		await run('scenario', 'run', '*.scenario.yaml', '--server', 'http://test/mcp', '--verbose');

		expect(mocks.reporter.reportScenarioStart).toHaveBeenCalled();
		expect(mocks.reporter.reportStepProgress).toHaveBeenCalled();
		expect(mocks.reporter.reportAll).toHaveBeenCalled();
		expect(process.exit).toHaveBeenCalledWith(1);
	});

	it('reads batch commands from a file', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'afd-cli-batch-'));
		const path = join(directory, 'batch.json');
		await writeFile(path, JSON.stringify([{ command: 'todo.create', input: { title: 'file' } }]));
		const batch = vi.fn().mockResolvedValue({
			success: true,
			results: [
				{
					id: 'cmd-0',
					index: 0,
					command: 'todo.create',
					result: { success: true, data: 'created' },
					durationMs: 1,
				},
			],
			summary: { total: 1, successCount: 1, failureCount: 0, skippedCount: 0 },
			timing: { totalMs: 1, averageMs: 1, startedAt: '', completedAt: '' },
			confidence: 1,
			reasoning: 'done',
		});
		mocks.ensureConnected.mockResolvedValue(client({ batch }));
		try {
			await run('batch', path);
			expect(batch).toHaveBeenCalledWith(
				[{ id: 'cmd-0', command: 'todo.create', input: { title: 'file' } }],
				expect.any(Object)
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
