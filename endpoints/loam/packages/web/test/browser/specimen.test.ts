/**
 * E2 and E4's captures (phase 0 specification, section 11), through Specimen's bench over the
 * chrome's fixtures in `@lushly-dev/loam-chrome`'s `specimens/`: the live and replayed 50-call
 * sessions are equal under `diffObservations`, and every part and the whole shell is captured,
 * with an ARIA snapshot, in light, dark and high contrast (D53).
 */
import { fileURLToPath } from 'node:url';
import { createSpecimenBench, diffObservations, type SpecimenBench } from '@lushly-dev/specimen';
import type { Observation, SpecimenContext } from '@lushly-dev/specimen/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SPECIMENS = fileURLToPath(new URL('../../../chrome/specimens/', import.meta.url));

let bench: SpecimenBench;
beforeAll(async () => {
	bench = await createSpecimenBench({ root: SPECIMENS });
});
afterAll(async () => {
	await bench?.close();
});

const CONTEXT: Partial<SpecimenContext> = {
	viewport: { width: 1280, height: 800 },
	reducedMotion: 'reduce',
	motion: 'settled',
};

function expectClean(observation: Observation) {
	expect(observation.channels.console.errors).toEqual([]);
	expect(observation.channels.a11y.snapshot.trim()).not.toBe('');
	expect(
		observation.completeness.dom.reasons
			.concat(observation.completeness.a11y.reasons)
			.filter((reason) => reason.includes('Context mismatch'))
	).toEqual([]);
}

describe('E2: a replayed journal reproduces the layout', () => {
	it('renders the live session and the replayed fixture identically', async () => {
		const live = await bench.render({ id: 'session-live', context: CONTEXT });
		const replay = await bench.render({ id: 'session-replay', context: CONTEXT });
		expectClean(live);
		expectClean(replay);
		const diff = diffObservations(live, replay);
		expect(diff.differences).toEqual([]);
		expect(diff.status).toBe('no-change-observed');
		// The session ends with the inspector open at 520 and the sidebar at 300.
		expect(live.channels.a11y.snapshot).toContain('complementary "Inspector"');
	}, 120_000);
});

/** Each fixture, and a landmark or role its snapshot must show. */
const CAPTURES: [string, string][] = [
	['shell', 'banner "Loam"'],
	['shell-compact-density', 'contentinfo "Status"'],
	['shell-palette', 'dialog "Command palette"'],
	['titlebar', 'banner "Loam"'],
	['titlebar-signed-in', 'button "Sign out"'],
	['rail', 'navigation "Apps"'],
	['tabbar', 'navigation "Apps"'],
	['sidebar', 'complementary "Sidebar"'],
	['inspector', 'complementary "Inspector"'],
	['inspector-overlay', 'complementary "Inspector"'],
	['main', 'heading "No apps yet"'],
	['main-not-found', 'link "Go to the start page"'],
	['panel', 'region "Panel"'],
	['statusbar', 'contentinfo "Status"'],
	['resize-handle', 'separator "Resize sidebar"'],
	['empty-state', 'Output and logs will appear here.'],
	['status-item', 'Journal'],
	['notice', 'heading "Loam is open in another tab"'],
];

describe('E4: Specimen captures of each part and the whole shell', () => {
	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		it(`captures every fixture in ${theme}, each with an ARIA snapshot`, async () => {
			for (const [id, expected] of CAPTURES) {
				const observation = await bench.render({ id, context: { ...CONTEXT, theme } });
				expectClean(observation);
				expect(observation.manifest.context.theme).toBe(theme);
				expect(observation.channels.a11y.snapshot, id).toContain(expected);
			}
		}, 300_000);

	it('captures the compact class at 390 × 844', async () => {
		const observation = await bench.render({
			id: 'shell',
			context: { ...CONTEXT, viewport: { width: 390, height: 844 } },
		});
		expectClean(observation);
		expect(observation.channels.a11y.snapshot).not.toContain('contentinfo');
		expect(observation.channels.a11y.snapshot).toContain('navigation "Apps"');
	}, 60_000);
});
