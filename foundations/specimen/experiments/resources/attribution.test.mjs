import { describe, expect, it } from 'vitest';
import { attributeJob } from './attribution.mjs';

const proc = (pid, ppid, name, cpuSeconds, footprintBytes = 0) => ({
	pid,
	ppid,
	startId: `s${pid}`,
	name,
	userNs: cpuSeconds * 1e9,
	systemNs: 0,
	footprintBytes,
});

describe('job attribution', () => {
	it('charges each process to its first phase and role, keeping the root apart', () => {
		const events = [
			{ type: 'start', rootPid: 1 },
			{ type: 'sample', timestampMs: 100, processes: [proc(1, 0, 'node', 0.2)] },
			{
				type: 'sample',
				timestampMs: 200,
				processes: [proc(1, 0, 'node', 0.5), proc(2, 1, 'chrome-headless-shell', 0.3)],
			},
			{
				type: 'sample',
				timestampMs: 400,
				processes: [
					proc(1, 0, 'node', 0.9),
					proc(2, 1, 'chrome-headless-shell', 0.6),
					proc(3, 2, 'chrome-headless-shell', 1.1),
					proc(4, 1, 'node', 0.7),
				],
			},
		];
		const phases = [
			{ id: 1, name: 'render', event: 'start', timestampMs: 150 },
			{ id: 1, name: 'render', event: 'end', timestampMs: 300 },
			{ id: 2, name: 'cold-process', event: 'start', timestampMs: 350 },
			{ id: 2, name: 'cold-process', event: 'end', timestampMs: 450 },
		];
		const result = attributeJob(events, phases);
		expect(result.byRole).toEqual({
			'chromium-child': 1.1,
			'job-root': 0.9,
			node: 0.7,
			'chromium-browser': 0.6,
		});
		expect(result.byPhase).toEqual({ 'cold-process': 1.8, 'job-root': 0.9, render: 0.6 });
		expect(result.byPhaseRole['cold-process']).toEqual({ 'chromium-child': 1.1, node: 0.7 });
		expect(result.attributedCpuSeconds).toBe(3.3);
	});
});

describe('profile categories', () => {
	it('names the package a file belongs to, not a peer in its store directory', async () => {
		const { categorize, packageOf } = await import('./profile-summary.mjs');
		const vite =
			'file:///x/node_modules/.pnpm/vite@8.3.0_esbuild@0.28.2/node_modules/vite/dist/node/chunks/a.js';
		expect(packageOf(vite)).toBe('vite');
		expect(categorize(vite, 'f')).toBe('vite');
		expect(categorize('file:///x/node_modules/@rolldown/binding/index.js', 'f')).toBe(
			'transform (rolldown/oxc/esbuild)'
		);
		expect(categorize('node:internal/modules/esm/loader', 'f')).toBe('module loading');
		expect(categorize('node:internal/fs/promises', 'f')).toBe('node:fs');
		expect(categorize('file:///afd/foundations/specimen/dist/browser/index.js', 'f')).toBe(
			'specimen'
		);
	});
});
