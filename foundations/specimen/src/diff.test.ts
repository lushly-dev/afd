import { describe, expect, it } from 'vitest';
import { diffObservations } from './diff.js';
import { normalizeDom } from './normalize.js';
import { CAPTURE_VERSION, type ElementObservation, type Observation } from './types.js';

function element(): ElementObservation {
	return {
		ref: 'root/button:1',
		tag: 'button',
		attributes: {},
		box: { x: 0, y: 0, width: 50, height: 35 },
		scroll: { width: 50, height: 35, clientWidth: 50, clientHeight: 35 },
		styles: { padding: '8px', color: 'rgb(0, 0, 0)' },
		state: { focused: false, value: '' },
	};
}

function capture(): Observation {
	const completion = {
		status: 'complete' as const,
		scope: 'declared structured scope',
		reasons: [],
	};
	return {
		manifest: {
			captureVersion: CAPTURE_VERSION,
			normalizationVersion: '0.1',
			specimenId: 'baseline',
			checkpoint: 'mount',
			source: { revision: 'a', digest: 'a', dirty: false },
			dependencies: 'lock-a',
			browser: { name: 'chromium', version: '151' },
			context: {
				viewport: { width: 1200, height: 900 },
				theme: 'light',
				locale: 'en-US',
				reducedMotion: 'no-preference',
				motion: 'settled',
			},
		},
		channels: {
			dom: { raw: '<button>Save</button>', normalized: '<button>Save</button>' },
			a11y: { snapshot: '- button "Save"', axe: 'not-run' },
			elements: [element()],
			console: { errors: [], warnings: [] },
			visual: { path: null },
		},
		completeness: {
			dom: { ...completion },
			a11y: { status: 'partial', scope: 'ARIA snapshot; axe not run', reasons: ['AXE_NOT_RUN'] },
			layout: { ...completion },
			styles: { ...completion },
			tokens: { status: 'unsupported', scope: 'tokens', reasons: ['Detector not implemented'] },
			events: { status: 'unsupported', scope: 'events', reasons: ['Capture not implemented'] },
			visual: { status: 'not-requested', scope: 'pixels', reasons: [] },
		},
	};
}

function first(observation: Observation): ElementObservation {
	const item = observation.channels.elements[0];
	if (!item) throw new Error('Test fixture missing element');
	return item;
}

describe('diffObservations', () => {
	it('detects an adopted-style layout change with equal DOM and ARIA', () => {
		const left = capture();
		const right = capture();
		first(right).box.width = 114;
		first(right).box.height = 99;
		first(right).styles.padding = '40px';
		const result = diffObservations(left, right);
		expect(result.status).toBe('changed');
		expect(result.differences).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					channel: 'layout',
					target: 'root/button:1',
					property: 'box.width',
					left: 50,
					right: 114,
				}),
				expect.objectContaining({
					channel: 'styles',
					property: 'padding',
					left: '8px',
					right: '40px',
				}),
			])
		);
		expect(
			result.differences.some((item) => item.channel === 'dom' || item.channel === 'a11y')
		).toBe(false);
	});

	it('reports no change in the declared scope without claiming visual equivalence or completed axe', () => {
		const result = diffObservations(capture(), capture());
		expect(result.status).toBe('no-change-observed');
		expect(result.limitations.join(' ')).toContain('AXE_NOT_RUN');
		expect(result.limitations.join(' ')).toContain('does not establish visual equivalence');
	});

	it('retains live-control state and ARIA evidence with property-level locations', () => {
		const left = capture();
		const right = capture();
		first(right).state.value = 'new value';
		first(right).state.focused = true;
		right.channels.a11y.snapshot = '- button "Cancel"';
		expect(diffObservations(left, right).differences).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					channel: 'state',
					target: 'root/button:1',
					property: 'value',
					left: '',
					right: 'new value',
				}),
				expect.objectContaining({ channel: 'a11y', right: '- button "Cancel"' }),
			])
		);
	});

	it('reports structural/attribute changes and missing or added elements', () => {
		const left = capture();
		const right = capture();
		right.channels.dom.raw = '<input disabled>';
		first(right).tag = 'input';
		first(right).attributes.disabled = '';
		right.channels.elements.push({ ...element(), ref: 'root/span:1', tag: 'span' });
		const result = diffObservations(left, right);
		expect(result.differences).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					channel: 'dom',
					property: 'tag',
					left: 'button',
					right: 'input',
				}),
				expect.objectContaining({
					channel: 'dom',
					property: 'attributes.disabled',
					left: { missing: true },
					right: '',
				}),
				expect.objectContaining({
					channel: 'dom',
					property: 'element',
					target: 'root/span:1',
					left: null,
				}),
			])
		);
		expect(diffObservations(right, left).differences).toContainEqual(
			expect.objectContaining({ target: 'root/span:1', property: 'element', right: null })
		);
	});

	it('does not trust a stale normalized DOM field', () => {
		const left = capture();
		const right = capture();
		right.channels.dom.raw = '<button>Changed</button>';
		expect(diffObservations(left, right).differences).toContainEqual(
			expect.objectContaining({ channel: 'dom', right: '<button>Changed</button>' })
		);
	});

	it('allows source, dependency and specimen identity changes but records dependency attribution limits', () => {
		const left = capture();
		const right = capture();
		right.manifest.specimenId = 'faulty';
		right.manifest.source.revision = 'b';
		right.manifest.dependencies = 'lock-b';
		const result = diffObservations(left, right);
		expect(result.status).toBe('no-change-observed');
		expect(result.limitations.join(' ')).toContain('cannot be attributed to source changes alone');
	});

	it.each(['captureVersion', 'normalizationVersion'] as const)(
		'rejects unsupported %s even when both captures use it',
		(key) => {
			const left = capture();
			const right = capture();
			left.manifest[key] = '99';
			right.manifest[key] = '99';
			expect(() => diffObservations(left, right)).toThrow(/Unsupported .* version/);
		}
	);

	it('rejects browser, checkpoint and undeclared context differences', () => {
		const left = capture();
		for (const change of [
			(observation: Observation) => {
				observation.manifest.browser.version = '152';
			},
			(observation: Observation) => {
				observation.manifest.checkpoint = 'after-click';
			},
			(observation: Observation) => {
				observation.manifest.context.viewport.width = 375;
			},
			(observation: Observation) => {
				observation.manifest.context.theme = 'dark';
			},
		]) {
			const right = capture();
			change(right);
			expect(() => diffObservations(left, right)).toThrow('Incompatible captures');
		}
	});

	it('allows only explicitly declared context comparison axes', () => {
		const left = capture();
		const right = capture();
		right.manifest.context.viewport.width = 375;
		expect(diffObservations(left, right, { allowContextDifferences: ['viewport'] }).status).toBe(
			'no-change-observed'
		);
		right.manifest.context.theme = 'dark';
		expect(() => diffObservations(left, right, { allowContextDifferences: ['viewport'] })).toThrow(
			'context.theme'
		);
	});

	it('compares object-valued context axes independent of insertion order', () => {
		const left = capture();
		const right = capture();
		right.manifest.context.viewport = { height: 900, width: 1200 };
		expect(diffObservations(left, right).status).toBe('no-change-observed');
	});

	it.each(['dom', 'a11y', 'layout', 'styles'] as const)(
		'never treats incomplete %s evidence as unchanged',
		(channel) => {
			const left = capture();
			const right = capture();
			right.completeness[channel] = {
				status: 'partial',
				scope: 'limited',
				reasons: ['inaccessible root'],
			};
			first(right).box.width = 51;
			const result = diffObservations(left, right);
			expect(result.status).toBe('insufficient-evidence');
			expect(result.differences).toContainEqual(
				expect.objectContaining({ channel: 'layout', property: 'box.width' })
			);
		}
	);

	it('requires explicit known AXE_NOT_RUN partial reason to accept ARIA-only scope', () => {
		const left = capture();
		const right = capture();
		right.completeness.a11y.reasons.push('closed root');
		expect(diffObservations(left, right).status).toBe('insufficient-evidence');
	});

	it('returns insufficient visual evidence when screenshots are absent', () => {
		expect(diffObservations(capture(), capture(), { requireVisual: true }).status).toBe(
			'insufficient-evidence'
		);
	});

	it('never infers pixel equivalence from two screenshot paths', () => {
		const left = capture();
		const right = capture();
		for (const item of [left, right]) {
			item.channels.visual.path = '/tmp/screenshot.png';
			item.completeness.visual = { status: 'complete', scope: 'screenshot captured', reasons: [] };
		}
		const result = diffObservations(left, right, { requireVisual: true });
		expect(result.status).toBe('insufficient-evidence');
		expect(result.limitations.join(' ')).toContain('PIXEL_COMPARISON_UNAVAILABLE');
	});

	it('normalizes generated id churn in markup and identifier-valued element evidence', () => {
		const left = capture();
		const right = capture();
		for (const [observation, id] of [
			[left, 1],
			[right, 99],
		] as const) {
			observation.channels.dom.raw = `<button id="specimen-generated-${id}" aria-controls="specimen-generated-${id}">Save</button>`;
			observation.channels.dom.normalized = normalizeDom(observation.channels.dom.raw);
			first(observation).attributes = {
				id: `specimen-generated-${id}`,
				'aria-controls': `specimen-generated-${id}`,
			};
			first(observation).state.activeDescendant = `specimen-generated-${id}`;
		}
		expect(diffObservations(left, right).status).toBe('no-change-observed');
	});

	it('preserves missing generated-id relationships, whitespace and literal control values', () => {
		const left = capture();
		const right = capture();
		left.channels.dom.raw =
			'<pre> a  b </pre><input id="specimen-generated-2" aria-controls="specimen-generated-1">';
		right.channels.dom.raw =
			'<pre> a b </pre><input id="specimen-generated-1" aria-controls="specimen-generated-1">';
		first(right).state.value = 'specimen-generated-1';
		expect(diffObservations(left, right).differences).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ channel: 'dom' }),
				expect.objectContaining({ channel: 'state', property: 'value' }),
			])
		);
	});

	it('rejects duplicate structural references rather than silently overwriting evidence', () => {
		const left = capture();
		left.channels.elements.push(element());
		expect(() => diffObservations(left, capture())).toThrow('duplicate element reference');
	});

	it('distinguishes missing live state from an observed null value', () => {
		const left = capture();
		const right = capture();
		first(right).state.selection = null;
		expect(diffObservations(left, right).differences).toContainEqual({
			channel: 'state',
			target: 'root/button:1',
			property: 'selection',
			left: { missing: true },
			right: null,
		});
	});

	it('does not mutate either input', () => {
		const left = capture();
		const right = capture();
		const saved = structuredClone([left, right]);
		diffObservations(left, right);
		expect([left, right]).toEqual(saved);
	});
});
