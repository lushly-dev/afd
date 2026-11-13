/** `bandFor` over every row of the phase 2 specification's 7.1 (E3's units). */

import { describe, expect, it } from 'vitest';
import { bandFor, dimmedTip, railOrder } from './bands.js';

const row = (
	scopeLevels: Array<'workspace' | 'project'>,
	extra: { available?: boolean; rail?: boolean; state?: 'ready' | 'disabled' } = {}
) => ({
	scopeLevels,
	available: extra.available ?? true,
	rail: extra.rail ?? true,
	state: extra.state ?? ('ready' as const),
});

describe('P2-E3: bandFor (7.1)', () => {
	it('puts a workspace-only app in the bottom band, with or without a project', () => {
		expect(bandFor(row(['workspace']), undefined)).toEqual({ band: 'bottom', dimmed: false });
		expect(bandFor(row(['workspace']), 'prj_atlas')).toEqual({ band: 'bottom', dimmed: false });
	});

	it('dims a project-only app in the top band with no project, and opens it in one', () => {
		expect(bandFor(row(['project'], { available: false }), undefined)).toEqual({
			band: 'top',
			dimmed: true,
		});
		expect(bandFor(row(['project']), 'prj_atlas')).toEqual({ band: 'top', dimmed: false });
	});

	it('moves a dual-scope app from the bottom band to the top when a project is active (D29)', () => {
		// D29, open with the owner: with no project, the bottom band (7.1). `bandFor`'s one row.
		expect(bandFor(row(['workspace', 'project']), undefined)).toEqual({
			band: 'bottom',
			dimmed: false,
		});
		expect(bandFor(row(['workspace', 'project']), 'prj_atlas')).toEqual({
			band: 'top',
			dimmed: false,
		});
	});

	it('dims a mounted instance with projects in a project it does not list', () => {
		expect(bandFor(row(['project'], { available: false }), 'prj_beacon')).toEqual({
			band: 'top',
			dimmed: true,
		});
	});

	it('gives no entry to a rail-less or a disabled app', () => {
		expect(bandFor(row(['workspace'], { rail: false }), undefined)).toBeNull();
		expect(bandFor(row(['project'], { state: 'disabled' }), 'prj_atlas')).toBeNull();
	});

	it('sorts by order, then instance, and says why an entry is dimmed', () => {
		const rows = [
			{ order: 20, instance: 'b' },
			{ order: 10, instance: 'z' },
			{ order: 20, instance: 'a' },
		];
		expect([...rows].sort(railOrder).map((entry) => entry.instance)).toEqual(['z', 'a', 'b']);
		expect(dimmedTip('Tracker', undefined)).toBe('Choose a project to open Tracker');
		expect(dimmedTip('Tracker', 'Beacon')).toBe('Tracker is not available in Beacon');
	});

	it("P3-E2: puts the persona's emphasized apps first, in the order it names them, hiding none (6.2)", () => {
		const rows = [
			{ order: 10, instance: 'a' },
			{ order: 20, instance: 'b' },
			{ order: 30, instance: 'c' },
			{ order: 40, instance: 'd' },
		];
		const sorted = (emphasis: string[]) =>
			[...rows].sort((x, y) => railOrder(x, y, emphasis)).map((entry) => entry.instance);
		expect(sorted([])).toEqual(['a', 'b', 'c', 'd']);
		expect(sorted(['d', 'b'])).toEqual(['d', 'b', 'a', 'c']);
		// An emphasized instance the band does not hold changes nothing of the rest.
		expect(sorted(['gone', 'c'])).toEqual(['c', 'a', 'b', 'd']);
	});
});
