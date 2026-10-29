import type { Observation } from '@lushly-dev/specimen/types';
import { describe, expect, it, vi } from 'vitest';
import {
	createSpecimenCommands,
	executeSpecimenCommand,
	observationSchema,
	type SpecimenCommandBench,
} from './commands.js';

function observation(): Observation {
	const channel = { status: 'complete' as const, scope: 'declared targets', reasons: [] };
	return {
		manifest: {
			captureVersion: '0.1',
			normalizationVersion: '0.1',
			specimenId: 'button',
			checkpoint: 'mount',
			source: { revision: null, digest: 'source', dirty: null },
			dependencies: 'lock',
			browser: { name: 'chromium', version: '1' },
			context: {
				viewport: { width: 800, height: 600 },
				theme: 'light',
				locale: 'en-US',
				reducedMotion: 'no-preference',
				motion: 'natural',
			},
		},
		channels: {
			dom: { raw: '<button>Save</button>', normalized: '<button>Save</button>' },
			a11y: { snapshot: '- button "Save"', axe: 'not-run' },
			elements: [],
			console: { errors: [], warnings: [] },
			visual: { path: null },
		},
		completeness: {
			dom: channel,
			a11y: channel,
			layout: channel,
			styles: channel,
			tokens: { ...channel, status: 'unsupported' },
			events: { ...channel, status: 'unsupported' },
			visual: { ...channel, status: 'not-requested' },
		},
	};
}
function bench(): SpecimenCommandBench {
	return {
		list: vi.fn(() => [
			{ id: 'button', title: 'Button', module: './button.ts', exportName: 'Primary' },
		]),
		render: vi.fn(async () => observation()),
		build: vi.fn(async (outDir) => ({
			directory: outDir,
			shellBytes: 1000,
			budget: 50000,
			files: ['index.html'],
		})),
	};
}

describe('specimen commands', () => {
	it('exposes schema-backed CLI/MCP commands and returns the registered metadata', async () => {
		const instance = bench();
		const commands = createSpecimenCommands(instance);
		expect(commands.map((command) => command.name)).toEqual([
			'specimen-list',
			'specimen-render',
			'specimen-diff',
			'specimen-build',
		]);
		for (const command of commands) {
			expect(command.expose).toEqual({ mcp: true, cli: true });
			expect(command.outputSchema).toBeDefined();
		}
		const result = await executeSpecimenCommand(instance, 'specimen-list', {});
		expect(result.success).toBe(true);
		expect(result.data).toEqual({ specimens: instance.list() });
	});
	it('validates input before a render and rejects unknown fields', async () => {
		const instance = bench();
		for (const input of [
			{ id: '' },
			{ id: 'button', context: { viewport: { width: 0, height: 10 } } },
			{ id: 'button', extra: true },
			{ id: 'button', context: { theme: 'drak' } },
			{ id: 'button', timeoutMs: 90_000 },
			{ id: 'button', context: { viewport: { width: 9000, height: 10 } } },
		]) {
			const result = await executeSpecimenCommand(instance, 'specimen-render', input);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
			expect(result.error?.suggestion).toBeTruthy();
		}
		expect(instance.render).not.toHaveBeenCalled();
	});
	it('preserves the full capture contract and sends validated render options', async () => {
		const instance = bench();
		const input = {
			id: 'button',
			checkpoint: 'focused',
			context: { theme: 'dark' },
			screenshot: '/tmp/button.png',
		};
		const result = await executeSpecimenCommand(instance, 'specimen-render', input);
		expect(result.success).toBe(true);
		expect(instance.render).toHaveBeenCalledWith(input);
		expect(observationSchema.safeParse(result.data).success).toBe(true);
	});
	it('returns actionable bench failures and preserves structured failure codes', async () => {
		const instance = bench();
		instance.render = async () => {
			throw Object.assign(new Error('No such checkpoint'), { code: 'CHECKPOINT_NOT_FOUND' });
		};
		const result = await executeSpecimenCommand(instance, 'specimen-render', { id: 'button' });
		expect(result.error).toMatchObject({
			code: 'CHECKPOINT_NOT_FOUND',
			message: 'No such checkpoint',
		});
		expect(result.error?.suggestion).toContain('checkpoint');
		instance.build = async () => {
			throw new Error('Budget exceeded');
		};
		expect(
			(await executeSpecimenCommand(instance, 'specimen-build', { outDir: 'output' })).error?.code
		).toBe('SPECIMEN_BUILD_FAILED');
	});
	it('does not turn malformed observation data into a successful diff', async () => {
		const instance = bench();
		for (const input of [
			{ left: {}, right: {} },
			{ left: observation(), right: { ...observation(), channels: {} } },
			{ left: observation(), right: observation(), allowContextDifferences: ['typo'] },
		]) {
			const result = await executeSpecimenCommand(instance, 'specimen-diff', input);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		}
	});
	it('compares captures and reports incompatible comparisons as failures', async () => {
		const instance = bench();
		const left = observation();
		const right = observation();
		right.channels.a11y.snapshot = '- button "Delete"';
		const result = await executeSpecimenCommand(instance, 'specimen-diff', { left, right });
		expect(result.success).toBe(true);
		expect(result.data).toMatchObject({ status: 'changed' });
		right.manifest.checkpoint = 'different';
		const mismatch = await executeSpecimenCommand(instance, 'specimen-diff', { left, right });
		expect(mismatch.error?.code).toBe('SPECIMEN_DIFF_FAILED');
	});
	it('validates build results and fails unknown commands', async () => {
		const instance = bench();
		const result = await executeSpecimenCommand(instance, 'specimen-build', {
			outDir: '/tmp/site',
		});
		expect(result.data).toMatchObject({ directory: '/tmp/site', shellBytes: 1000 });
		instance.list = () => [{ id: 3 }] as unknown as ReturnType<SpecimenCommandBench['list']>;
		expect((await executeSpecimenCommand(instance, 'specimen-list', {})).error?.code).toBe(
			'SPECIMEN_OUTPUT_INVALID'
		);
		expect((await executeSpecimenCommand(instance, 'specimen-nope', {})).error?.code).toBe(
			'COMMAND_NOT_FOUND'
		);
	});
});
