/**
 * @fileoverview Exit criterion 2: Specimen fixture matrix (20 specimens × 3 themes = 60 captures
 * plus 12 narrow captures at 800 px and 500 px = 72 total), scoped preview computed-style
 * isolation check, and axe accessibility verification across every fixture (spec §7.6, §9.2).
 */
import { fileURLToPath } from 'node:url';
import { createSpecimenBench, type SpecimenBench } from '@lushly-dev/specimen';
import type { Observation, SpecimenContext } from '@lushly-dev/specimen/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SPECIMENS = fileURLToPath(new URL('../specimens/', import.meta.url));
const THEMES = ['light', 'dark', 'high-contrast'] as const;

const CONTEXT: Partial<SpecimenContext> = {
	viewport: { width: 1280, height: 800 },
	reducedMotion: 'reduce',
	motion: 'settled',
};

function expectClean(observation: Observation, id = observation.manifest.specimenId): void {
	expect(observation.channels.console.errors, id).toEqual([]);
	expect(observation.channels.a11y.snapshot.trim(), id).not.toBe('');
	expect(
		observation.completeness.dom.reasons
			.concat(observation.completeness.a11y.reasons)
			.filter((reason) => reason.includes('Context mismatch')),
		id
	).toEqual([]);
}

const CAPTURES: Array<[string, string[]]> = [
	[
		'violet-tokens',
		[
			'navigation "Nodes — Example tree"',
			'tablist "Tree views"',
			'table "Resolved tokens"',
			'color.text.primary',
			'Set here',
		],
	],
	['violet-compare', ['table "Node comparison"', 'color.text.muted', 'Differs']],
	['violet-compare-trees', ['table "Tree comparison"', 'color.surface.page']],
	['violet-preview', ['region "Theme preview"', 'button "Primary action"']],
	[
		'violet-preview-scoped',
		['navigation "Nodes — Example tree"', 'region "Theme preview"', 'No token selected'],
	],
	[
		'violet-checks',
		[
			'Checks failing',
			'region "Contrast and rule violations"',
			'region "Unfilled interface entries"',
			'region "Invalid interface entries"',
			'region "Leaked interface entries"',
			'ref.palette.neutral.50',
		],
	],
	['violet-history', ['table "Change history"', 'Meet 7:1 high-contrast floor']],
	['violet-sidebar', ['navigation "Nodes — Example tree"', 'button "example', 'button "dark']],
	[
		'violet-inspector',
		[
			'heading "color.text.primary"',
			'region "Lineage"',
			'region "Pending changes"',
			'button "Apply"',
		],
	],
	['violet-inspector-empty', ['No token selected']],
].flatMap(
	([id, expected]): Array<[string, string[]]> => [
		[id as string, expected as string[]],
		[`${id as string}-compact`, expected as string[]],
	]
);

function readAttr(html: string, attr: string): string | null {
	const match = new RegExp(`${attr}="([^"]*)"`).exec(html);
	return match?.[1] ?? null;
}

describe('Violet in Loam Specimen matrix (spec §7.6, §9.2)', () => {
	let bench: SpecimenBench;
	beforeAll(async () => {
		bench = await createSpecimenBench({ root: SPECIMENS });
	}, 60_000);
	afterAll(async () => {
		await bench?.close();
	});

	for (const theme of THEMES) {
		it(`captures all 20 specimens cleanly in ${theme} and proves scoped preview isolation`, async () => {
			for (const [id, expected] of CAPTURES) {
				const observation = await bench.render({ id, context: { ...CONTEXT, theme } });
				expectClean(observation, `${id}/${theme}`);
				for (const needle of expected) {
					expect(observation.channels.a11y.snapshot, `${id}/${theme}`).toContain(needle);
				}

				if (id === 'violet-preview-scoped' || id === 'violet-preview-scoped-compact') {
					const raw = observation.channels.dom.raw;
					const expectedCardBg = readAttr(raw, 'data-expected-card-bg');
					const nodesColBg = readAttr(raw, 'data-nodes-col-bg');
					const inspectorBg = readAttr(raw, 'data-inspector-bg');
					const previewPageProp = readAttr(raw, 'data-preview-page-prop');
					const docRootOverride = readAttr(raw, 'data-doc-root-override');

					expect(expectedCardBg, `${id}/${theme} expectedCardBg`).toBeTruthy();
					expect(nodesColBg, `${id}/${theme} nodes column keeps Loam card bg`).toBe(expectedCardBg);
					expect(inspectorBg, `${id}/${theme} inspector keeps Loam card bg`).toBe(expectedCardBg);
					expect(previewPageProp, `${id}/${theme} preview root has dark page token`).toBe(
						'#121214'
					);
					expect(docRootOverride, `${id}/${theme} documentElement untouched`).toBe('');
				}
			}
		}, 300_000);
	}

	for (const theme of THEMES) {
		it(`captures and runs axe on violet-tokens and violet-inspector cleanly at 800 px and 500 px in ${theme}`, async () => {
			for (const width of [800, 500]) {
				const narrowContext = { ...CONTEXT, theme, viewport: { width, height: 800 } };
				for (const [id, needle] of [
					['violet-tokens', 'table "Resolved tokens"'],
					['violet-inspector', 'region "Pending changes"'],
				] as const) {
					const observation = await bench.render({ id, context: narrowContext });
					expectClean(observation, `${id}/${theme}/${width}px`);
					expect(observation.channels.a11y.snapshot, `${id}/${theme}/${width}px`).toContain(needle);

					const a11y = await bench.a11y({ id, context: narrowContext });
					const failing = a11y.reports
						.filter((report) => report.violations.length > 0 || report.failures.length > 0)
						.map((report) => ({
							id: report.id,
							failures: report.failures,
							violations: report.violations.map((v) => ({
								id: v.id,
								impact: v.impact,
								help: v.help,
							})),
						}));
					expect(failing, `narrow axe violations in ${id}/${theme}/${width}px`).toEqual([]);
				}
			}
		}, 240_000);
	}

	for (const theme of THEMES) {
		it(`passes axe accessibility checks on all 20 specimens in ${theme}`, async () => {
			const run = await bench.a11y({ context: { ...CONTEXT, theme } });
			expect(run.counts.total).toBe(20);
			const failing = run.reports
				.filter((report) => report.violations.length > 0 || report.failures.length > 0)
				.map((report) => ({
					id: report.id,
					failures: report.failures,
					violations: report.violations.map((v) => ({
						id: v.id,
						impact: v.impact,
						help: v.help,
					})),
				}));
			expect(failing, `axe violations in ${theme}`).toEqual([]);
		}, 300_000);
	}
});
