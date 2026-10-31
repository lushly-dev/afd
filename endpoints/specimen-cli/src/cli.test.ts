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
