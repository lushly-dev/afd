import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import { readCaptureSetManifest, readSetCapture, SET_ID_PATTERN } from './sets.js';

const fixtures = resolve(import.meta.dirname, '../fixtures/themes');

describe('capture sets end to end', () => {
	let scratch: string;
	let bench: SpecimenBench;

	beforeAll(async () => {
		scratch = await mkdtemp(join(tmpdir(), 'specimen-sets-bench-'));
		await cp(fixtures, scratch, { recursive: true });
		bench = await createSpecimenBench({ root: scratch });
	}, 60_000);

	afterAll(async () => {
		await bench?.close();
		if (scratch) await rm(scratch, { recursive: true, force: true });
	});

	it('captures content-addressed sets with axe and screenshots, marks theme-limited entries unavailable, and diffs by { set, id }', async () => {
		const light = await bench.captureSet({
			ids: ['follows', 'light-declared'],
			context: { theme: 'light' },
			label: 'main',
		});
		expect(light.set).toMatch(SET_ID_PATTERN);
		expect(light.label).toBe('main');
		expect(light.counts.captured).toBe(2);
		expect(light.counts.unavailable).toBe(0);
		expect(light.counts.axe.passed + light.counts.axe.failed).toBe(2);

		// Identical recapture yields the same content-addressed set id.
		const lightAgain = await bench.captureSet({
			ids: ['follows', 'light-declared'],
			context: { theme: 'light' },
			label: 'main-copy',
		});
		expect(lightAgain.set).toBe(light.set);

		// Screenshot and observation exist in .specimen/sets/<setId>/.
		const manifest = await readCaptureSetManifest(scratch, 'main');
		expect(manifest.captures.follows?.screenshot).toMatch(
			/^screenshots\/follows--[0-9a-f]{12}\.png$/
		);
		const obs = await readSetCapture(scratch, { set: 'main', id: 'follows' });
		expect(obs.channels.a11y.axe).not.toBe('not-run');
		expect((await stat(obs.channels.visual.path as string)).size).toBeGreaterThan(0);

		// Dark capture skips light-declared as unavailable with reason naming light.
		const dark = await bench.captureSet({
			ids: ['follows', 'light-declared'],
			context: { theme: 'dark' },
			label: 'dark',
		});
		expect(dark.set).toMatch(SET_ID_PATTERN);
		expect(dark.set).not.toBe(light.set);
		expect(dark.counts.captured).toBe(1);
		expect(dark.counts.unavailable).toBe(1);
		expect(dark.unavailable[0]?.id).toBe('light-declared');
		expect(dark.unavailable[0]?.reason).toContain('light');

		// Theme-pinned story rendering dark when light is requested is recorded unavailable, not mixed into a light set.
		const pinnedLight = await bench.captureSet({
			ids: ['themes-stories--pinned'],
			context: { theme: 'light' },
		});
		expect(pinnedLight.counts.captured).toBe(0);
		expect(pinnedLight.counts.unavailable).toBe(1);
		expect(pinnedLight.unavailable[0]?.id).toBe('themes-stories--pinned');
		expect(pinnedLight.unavailable[0]?.reason).toContain('dark');
		expect(pinnedLight.unavailable[0]?.reason).toContain('light');

		// Retained story at after-run with axe: false records axe as not-run and zero axe counts.
		const noAxe = await bench.captureSet({
			ids: ['themes-stories--light-only'],
			context: { theme: 'light' },
			checkpoint: 'after-run',
			axe: false,
		});
		expect(noAxe.counts.captured).toBe(1);
		expect(noAxe.counts.axe).toEqual({ passed: 0, failed: 0, incomplete: 0 });
		const noAxeObs = await readSetCapture(scratch, {
			set: noAxe.set,
			id: 'themes-stories--light-only',
		});
		expect(noAxeObs.channels.a11y.axe).toBe('not-run');
		expect(noAxeObs.completeness.a11y.reasons).toContain('AXE_NOT_RUN');

		// Cross-theme diff is refused with CAPTURES_INCOMPARABLE unless allowed.
		await expect(
			bench.diff({
				left: { set: 'main', id: 'follows' },
				right: { set: 'dark', id: 'follows' },
			})
		).rejects.toMatchObject({
			code: 'CAPTURES_INCOMPARABLE',
			message: expect.stringContaining('context.theme'),
			suggestion: expect.stringContaining('allowContextDifferences'),
		});

		const allowed = await bench.diff({
			left: { set: 'main', id: 'follows' },
			right: { set: 'dark', id: 'follows' },
			allowContextDifferences: ['theme'],
		});
		expect(allowed.status).toBe('changed');
	}, 120_000);
});
