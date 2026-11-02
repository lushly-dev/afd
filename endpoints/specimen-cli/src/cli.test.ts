import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpecimenCommandBench } from '@lushly-dev/specimen-afd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});
async function directory() {
	const path = await mkdtemp(join(tmpdir(), 'specimen-cli-'));
	directories.push(path);
	return path;
}
function harness() {
	const output: string[] = [];
	const errors: string[] = [];
	const bench: SpecimenCommandBench & { close(): Promise<void> } = {
		list: vi.fn(() => [
			{ id: 'button', title: 'Button', module: './button.ts', exportName: 'Primary' },
		]),
		validate: vi.fn(() => ({ valid: true, scope: 'static' as const, checked: 1, issues: [] })),
		migrate: vi.fn(async (request) => ({
			mode: (request?.apply ? 'apply' : 'preview') as 'apply' | 'preview',
			files: [],
			problems: [],
			summary: { files: 0, present: 0, proposed: 0, manual: 0, applied: 0 },
		})),
		inspect: vi.fn(async (request) => ({
			id: request.id,
			component: 'plain-button',
			schema: null,
			args: { label: 'Save' },
			context: {
				viewport: { width: 1280, height: 720 },
				theme: 'light' as const,
				locale: 'en-US',
				reducedMotion: 'no-preference' as const,
				motion: 'natural' as const,
			},
			limitations: ['No schema source describes plain-button.'],
			plugins: [],
		})),
		profile: vi.fn(async () => ({
			reports: [],
			counts: {
				total: 0,
				passed: 0,
				warnings: 0,
				failed: 0,
				notComparable: 0,
				noBaseline: 0,
				errored: 0,
			},
			orphanedBaselines: [],
			elapsedMs: 1,
		})),
		recordBaseline: vi.fn(async () => ({
			reports: [],
			counts: {
				total: 0,
				passed: 0,
				warnings: 0,
				failed: 0,
				notComparable: 0,
				noBaseline: 0,
				errored: 0,
			},
			orphanedBaselines: [],
			elapsedMs: 1,
		})),
		matrix: vi.fn(async (request) => ({
			id: request.id,
			checkpoint: 'after-run',
			axes: Object.keys(request.axes),
			cells: [],
			counts: { total: 0, captured: 0, unavailable: 0, changed: 0, unchanged: 0, insufficient: 0 },
			elapsedMs: 1,
		})),
		a11y: vi.fn(async () => ({
			reports: [],
			counts: { total: 0, passed: 0, warning: 0, failed: 0, notRun: 0 },
			workers: 2,
			elapsedMs: 1,
		})),
		runSuite: vi.fn(async () => ({
			outcome: 'passed' as const,
			counts: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, excluded: 0 },
			retry: { ran: false, reason: 'no story failed' },
			stories: [],
			workers: 2,
			elapsedMs: 1,
			sourcesChanged: false,
		})),
		run: vi.fn(async (request) => ({
			id: request.id,
			outcome: {
				status: 'skipped' as const,
				play: 'none' as const,
				failures: [],
				a11y: {
					status: 'not-run' as const,
					policy: 'error' as const,
					violations: [],
					incomplete: 0,
					incompleteChecks: [],
					exceptions: [],
				},
			},
			observation: null,
		})),
		render: vi.fn(async () => {
			throw new Error('No render configured');
		}),
		build: vi.fn(async (outDir) => ({
			directory: outDir,
			shellBytes: 1000,
			budget: 50000,
			files: ['index.html'],
		})),
		close: vi.fn(async () => {}),
	};
	const createBench = vi.fn(async () => bench);
	return {
		output,
		errors,
		bench,
		createBench,
		io: {
			stdout: (text: string) => output.push(text),
			stderr: (text: string) => errors.push(text),
			createBench,
		},
	};
}

describe('specimen CLI', () => {
	it('dispatches migrate as a preview unless --apply is given', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'migrate'], h.io)).toBe(0);
		expect(h.bench.migrate).toHaveBeenLastCalledWith({});
		expect(
			await runCli(
				['--root', root, 'migrate', '--files', './a.stories.ts,./b.stories.ts', '--apply'],
				h.io
			)
		).toBe(0);
		expect(h.bench.migrate).toHaveBeenLastCalledWith({
			files: ['./a.stories.ts', './b.stories.ts'],
			apply: true,
		});
		expect(await runCli(['--root', root, 'migrate', 'extra'], h.io)).toBe(1);
	});
	it('dispatches inspect with context options only', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'inspect', 'button', '--viewport', '375x812'], h.io)).toBe(
			0
		);
		expect(h.bench.inspect).toHaveBeenCalledWith({
			id: 'button',
			context: { viewport: { width: 375, height: 812 } },
		});
		expect(await runCli(['--root', root, 'inspect', 'button', '--screenshot', 'x.png'], h.io)).toBe(
			1
		);
	});
	it('dispatches run with context options and no checkpoint', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'run', 'button', '--theme', 'dark'], h.io)).toBe(0);
		expect(h.bench.run).toHaveBeenCalledWith({ id: 'button', context: { theme: 'dark' } });
		expect(JSON.parse(h.output[0] ?? '')).toMatchObject({
			success: true,
			data: { id: 'button', outcome: { status: 'skipped' }, observation: null },
		});
		expect(await runCli(['--root', root, 'run', 'button', '--checkpoint', 'mount'], h.io)).toBe(1);
	});
	it('runs a suite without an id, and exits nonzero when its stories failed', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(
				[
					'--root',
					root,
					'run',
					'--tag',
					'smoke,keyboard',
					'--match',
					'Button',
					'--workers',
					'4',
					'--retry',
					'--flake-cap',
					'1',
					'--capture',
					'none',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.runSuite).toHaveBeenCalledWith({
			context: {},
			filter: { tags: ['smoke', 'keyboard'], match: 'Button' },
			workers: 4,
			retry: true,
			flakeCap: 1,
			capture: 'none',
		});
		h.bench.runSuite = vi.fn(async () => ({
			outcome: 'failed-after-retry' as const,
			counts: { total: 1, passed: 0, failed: 1, flaky: 0, skipped: 0, excluded: 0 },
			retry: { ran: true },
			stories: [],
			workers: 2,
			elapsedMs: 1,
			sourcesChanged: false,
		}));
		expect(await runCli(['--root', root, 'run'], h.io)).toBe(1);
		// Suite options need the suite: with a story id they are a mistake, not ignored.
		expect(await runCli(['--root', root, 'run', 'button', '--workers', '2'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'run', '--workers', 'many'], h.io)).toBe(1);
	});
	it('dispatches a11y by id or filter, and exits nonzero when a check failed', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'a11y', 'button', '--checkpoint', 'mount'], h.io)).toBe(0);
		expect(h.bench.a11y).toHaveBeenCalledWith({ id: 'button', context: {}, checkpoint: 'mount' });
		expect(await runCli(['--root', root, 'a11y', '--tag', 'smoke', '--workers', '3'], h.io)).toBe(
			0
		);
		expect(h.bench.a11y).toHaveBeenLastCalledWith({
			context: {},
			filter: { tags: ['smoke'] },
			workers: 3,
		});
		h.bench.a11y = vi.fn(async () => ({
			reports: [],
			counts: { total: 1, passed: 0, warning: 0, failed: 1, notRun: 0 },
			workers: 2,
			elapsedMs: 1,
		}));
		expect(await runCli(['--root', root, 'a11y'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'a11y', 'button', '--workers', '2'], h.io)).toBe(1);
	});
	it('dispatches profile and baseline, and exits nonzero on a failed budget or a broken run', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'profile', 'button', '--runs', '5'], h.io)).toBe(0);
		expect(h.bench.profile).toHaveBeenCalledWith({ id: 'button', context: {}, runs: 5 });
		expect(await runCli(['--root', root, 'profile'], h.io)).toBe(0);
		expect(h.bench.profile).toHaveBeenLastCalledWith({ context: {} });
		expect(
			await runCli(['--root', root, 'baseline', 'button', '--note', 'After cutover'], h.io)
		).toBe(0);
		expect(h.bench.recordBaseline).toHaveBeenCalledWith({
			id: 'button',
			context: {},
			notes: ['After cutover'],
		});
		const counts = { total: 1, passed: 0, warnings: 0, notComparable: 0, noBaseline: 0 };
		const result = (failed: number, errored: number) => ({
			reports: [],
			counts: { ...counts, failed, errored },
			orphanedBaselines: [],
			elapsedMs: 1,
		});
		h.bench.profile = vi.fn(async () => result(1, 0));
		expect(await runCli(['--root', root, 'profile', 'button'], h.io)).toBe(1);
		h.bench.profile = vi.fn(async () => result(0, 1));
		expect(await runCli(['--root', root, 'profile', 'button'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'profile', 'button', '--runs', 'many'], h.io)).toBe(1);
	});
	it('dispatches matrix with its axes as lists', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(
				[
					'--root',
					root,
					'matrix',
					'button',
					'--theme',
					'light,dark',
					'--viewport',
					'375x812,1280x720',
					'--locale',
					'en-US,de',
					'--workers',
					'3',
				],
				h.io
			)
		).toBe(0);
		expect(h.bench.matrix).toHaveBeenCalledWith({
			id: 'button',
			axes: {
				theme: ['light', 'dark'],
				viewport: [
					{ width: 375, height: 812 },
					{ width: 1280, height: 720 },
				],
				locale: ['en-US', 'de'],
			},
			workers: 3,
		});
		expect(await runCli(['--root', root, 'matrix', 'button'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'matrix', '--theme', 'dark'], h.io)).toBe(1);
	});
	it('dispatches validate with an optional story or file', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'validate', '--id', 'button'], h.io)).toBe(0);
		expect(h.bench.validate).toHaveBeenCalledWith({ id: 'button' });
		expect(JSON.parse(h.output[0] ?? '')).toMatchObject({
			success: true,
			data: { valid: true, scope: 'static' },
		});
		expect(await runCli(['--root', root, 'validate', '--file', 'src/a.stories.ts'], h.io)).toBe(0);
		expect(h.bench.validate).toHaveBeenLastCalledWith({ file: 'src/a.stories.ts' });
		expect(await runCli(['--root', root, 'validate', 'extra'], h.io)).toBe(1);
		expect(await runCli(['--root', root, 'list', '--id', 'button'], h.io)).toBe(1);
	});

	it('dispatches list and emits one JSON result', async () => {
		const h = harness();
		const root = await directory();
		expect(await runCli(['--root', root, 'list'], h.io)).toBe(0);
		expect(h.createBench).toHaveBeenCalledWith({ root, configFile: undefined });
		expect(h.bench.close).toHaveBeenCalledTimes(1);
		expect(h.output).toHaveLength(1);
		expect(JSON.parse(h.output[0] ?? '')).toMatchObject({
			success: true,
			data: { specimens: [{ id: 'button' }] },
		});
	});
	it('rejects malformed options and positional counts without starting a browser', async () => {
		const cases = [
			[],
			['wat'],
			['list', 'extra'],
			['render'],
			['render', 'button', '--root'],
			['list', '--wat'],
			['list', '--root', 'one', '--root', 'two'],
			['list', '--viewport', '375x812'],
			['diff', 'one.json'],
		];
		for (const args of cases) {
			const h = harness();
			expect(await runCli(args, h.io)).toBe(1);
			expect(h.createBench).not.toHaveBeenCalled();
			expect(JSON.parse(h.output[0] ?? '').error.code).toBe('SPECIMEN_CLI_ERROR');
			expect(h.errors.length).toBeGreaterThan(0);
		}
	});
	it('keeps invalid viewport and theme values out of render execution', async () => {
		for (const args of [
			['render', 'button', '--viewport', 'phone'],
			['render', 'button', '--viewport', '0x812'],
			['render', 'button', '--theme', 'drak'],
			['render', 'button', '--reduced-motion', 'less'],
			['render', 'button', '--motion', 'frozen'],
			['render', 'button', '--locale', 'not a locale'],
		]) {
			const h = harness();
			expect(await runCli(args, h.io)).toBe(1);
			expect(h.bench.render).not.toHaveBeenCalled();
			expect(h.bench.close).toHaveBeenCalledTimes(1);
		}
	});
	it('sends render options through the schema and closes on handler failure', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(
				[
					'render',
					'button',
					'--root',
					root,
					'--viewport',
					'375x812',
					'--container',
					'300x500',
					'--theme',
					'dark',
					'--locale',
					'fr-FR',
					'--reduced-motion',
					'reduce',
					'--motion',
					'settled',
					'--checkpoint',
					'focused',
					'--screenshot',
					'shot.png',
				],
				h.io
			)
		).toBe(1);
		expect(h.bench.render).toHaveBeenCalledWith({
			id: 'button',
			context: {
				viewport: { width: 375, height: 812 },
				container: { width: 300, height: 500 },
				theme: 'dark',
				locale: 'fr-FR',
				reducedMotion: 'reduce',
				motion: 'settled',
			},
			checkpoint: 'focused',
			screenshot: join(root, 'shot.png'),
		});
		expect(h.bench.close).toHaveBeenCalledTimes(1);
		expect(JSON.parse(h.output[0] ?? '').error.code).toBe('SPECIMEN_RENDER_FAILED');
	});
	it('writes full result JSON atomically and resolves build paths against root', async () => {
		const h = harness();
		const root = await directory();
		expect(
			await runCli(['build', 'site', '--root', root, '--output', 'reports/build.json'], h.io)
		).toBe(0);
		expect(h.bench.build).toHaveBeenCalledWith(join(root, 'site'));
		expect(JSON.parse(await readFile(join(root, 'reports/build.json'), 'utf8'))).toMatchObject({
			success: true,
			data: { directory: join(root, 'site') },
		});
	});
	it('rejects malformed JSON captures without initializing a bench', async () => {
		const h = harness();
		const root = await directory();
		await writeFile(join(root, 'a.json'), '{}');
		await writeFile(join(root, 'b.json'), '{}');
		expect(
			await runCli(['diff', 'a.json', 'b.json', '--root', root, '--require-visual'], h.io)
		).toBe(1);
		expect(h.createBench).not.toHaveBeenCalled();
		expect(JSON.parse(h.output[0] ?? '').error.code).toBe('VALIDATION_ERROR');
		await writeFile(join(root, 'a.json'), '{bad json');
		expect(await runCli(['diff', 'a.json', 'b.json', '--root', root], h.io)).toBe(1);
		expect(JSON.parse(h.output[1] ?? '').error.code).toBe('SPECIMEN_CLI_ERROR');
	});
	it('reports setup and disposal failures as nonzero results', async () => {
		const h = harness();
		h.createBench.mockRejectedValueOnce(new Error('Invalid config'));
		expect(await runCli(['list'], h.io)).toBe(1);
		h.bench.close = vi.fn(async () => {
			throw new Error('Cleanup failed');
		});
		expect(await runCli(['list'], h.io)).toBe(1);
		expect(JSON.parse(h.output[1] ?? '')).toMatchObject({ success: false });
	});
	it('defaults to one stdout JSON value and stderr diagnostics without injected IO', async () => {
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
		const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		try {
			expect(await runCli(['wat'])).toBe(1);
			expect(stdout).toHaveBeenCalledTimes(1);
			expect(JSON.parse(String(stdout.mock.calls[0]?.[0])).error.code).toBe('SPECIMEN_CLI_ERROR');
			expect(String(stderr.mock.calls[0]?.[0])).toContain('Unknown command');
		} finally {
			stdout.mockRestore();
			stderr.mockRestore();
		}
	});
});
