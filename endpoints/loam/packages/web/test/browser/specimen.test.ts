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

/**
 * Specimen's ARIA snapshot is empty while a modal dialog is open (a follow-up in the
 * specification); the palette's capture is checked through its DOM, and axe covers it open.
 */
const MODAL = new Set(['shell-palette']);

function expectClean(observation: Observation, id = observation.manifest.specimenId) {
	expect(observation.channels.console.errors, id).toEqual([]);
	if (MODAL.has(id)) {
		expect(observation.channels.dom.normalized, id).toMatch(/<dialog[^>]* open/);
		return;
	}
	expect(observation.channels.a11y.snapshot.trim(), id).not.toBe('');
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
		// A replay does not journal the entries it replays, so the replayed kernel's journal holds
		// only what ran after it: the status bar's number is the one thing that differs (7.1).
		const journalNumber = (observation: Observation) =>
			Number(/Journal (\d+)/.exec(observation.channels.a11y.snapshot)?.[1]);
		expect(journalNumber(live)).toBe(50 + 2 + 3);
		expect(journalNumber(replay)).toBe(2 + 3);
		const diff = diffObservations(live, replay);
		const outsideJournal = diff.differences.filter((difference) => {
			if (difference.target?.includes('loam-status-item:2')) return false;
			if (difference.target?.includes('loam-statusbar:1/shadow/span:2')) return false;
			if (difference.channel === 'a11y' || difference.channel === 'dom') {
				const strip = (value: unknown) =>
					String(value)
						.replace(/Journal \d+/g, 'Journal N')
						.replace(/>\d+</g, '>N<')
						// FAST's template markers carry an id drawn per page.
						.replace(/fast-[a-z0-9]+/g, 'fast-X');
				const [left, right] = [strip(difference.left), strip(difference.right)];
				if (left === right) return false;
				let at = 0;
				while (left[at] === right[at]) at++;
				console.error(
					`${difference.channel} differs at ${at}:\n${left.slice(at - 200, at + 200)}\n---\n${right.slice(at - 200, at + 200)}`
				);
				return true;
			}
			return true;
		});
		expect(outsideJournal).toEqual([]);
		// The session ends with the inspector open at 520 and the sidebar at 300.
		expect(live.channels.a11y.snapshot).toContain('complementary "Inspector"');
	}, 120_000);
});

/** Each fixture, and a landmark or role its snapshot must show. */
const CAPTURES: [string, string][] = [
	['shell', 'banner "Loam"'],
	['shell-compact-density', 'contentinfo "Status"'],
	['shell-palette', 'Command palette'],
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
				const channel = MODAL.has(id)
					? observation.channels.dom.normalized
					: observation.channels.a11y.snapshot;
				expect(channel, id).toContain(expected);
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
