import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { type PackHost, runPack } from './pack-run.js';
import type { ElementObservation, Observation, PackIndex } from './types.js';

/**
 * How a pack run treats its passes and chooses its cases, against a host that renders nothing: each
 * case shows the elements written here, so a test decides what each pass sees.
 */
const root = fileURLToPath(new URL('../fixtures/pack-library/', import.meta.url));
const config = await loadConfig({ root });

const element = (ref: string, tag: string, attributes: Record<string, string> = {}) =>
	({ ref, tag, attributes, state: {} }) as unknown as ElementObservation;

/** What each case renders. */
const shown: Record<string, ElementObservation[]> = {
	'example-select--default': [
		element('root/example-select:1', 'example-select', { label: 'Size' }),
		element('root/example-select:1/example-option:1', 'example-option', { value: 's' }),
	],
};
const observation = (id: string, checkpoint: string): Observation =>
	({
		manifest: { checkpoint: { name: checkpoint } },
		channels: {
			dom: { raw: '', normalized: '' },
			a11y: { snapshot: '', axe: 'not-run' },
			events: { declared: [], history: [] },
			evidence: {
				expectations: [],
				claims: [],
				commands: [],
				formData: [],
				validity: [],
				attributesSet: [],
			},
			elements: shown[id] ?? [element('root/example-field:1', 'example-field', { label: 'A' })],
		},
	}) as unknown as Observation;

function host(render: (id: string, call: number) => Observation | null): PackHost & {
	rendered: string[];
} {
	const calls = new Map<string, number>();
	const rendered: string[] = [];
	return {
		config,
		rendered,
		prepare: async () => {},
		bundle: () => 'sha256:bundle',
		inspect: async () => null,
		runStory: async () => {
			throw new Error('No stories here.');
		},
		render: async (id) => {
			rendered.push(id);
			const call = (calls.get(id) ?? 0) + 1;
			calls.set(id, call);
			return render(id, call);
		},
		capture: async (id) => observation(id, 'after-run'),
	};
}

describe('a pack run’s passes', () => {
	it('takes a case that passes on its retry, and drops the attempt that failed', async () => {
		const run = await runPack(
			host((id, call) => {
				if (id === 'checks--field-change' && call === 1) throw new Error('Not this time.');
				return observation(id, 'after-run');
			}),
			{ workers: 1 }
		);
		expect(run.cases.retried).toEqual(['checks--field-change']);
		expect(run.cases.failed).toEqual([]);
		expect(run.cases.unstable).toEqual([]);
		expect(run.cases.passed).toBe(run.cases.total);
	});

	it('counts a case seen in one pass only as unstable', async () => {
		const run = await runPack(
			host((id, call) =>
				id === 'checks--select-disabled' && call === 2 ? null : observation(id, 'after-run')
			),
			{ workers: 1 }
		);
		expect(run.cases.unstable).toEqual(['checks--select-disabled']);
	});
});

describe('a one-component build', () => {
	const index = (overrides: Partial<PackIndex> = {}): PackIndex => ({
		bundle: 'sha256:bundle',
		config: config.digest,
		cases: { 'example-option': ['example-select--default'] },
		...overrides,
	});

	it('runs only the cases the index lists, and writes only its record', async () => {
		const fake = host((id) => observation(id, 'after-run'));
		const run = await runPack(fake, { component: 'example-option', index: index(), workers: 1 });
		expect(new Set(fake.rendered)).toEqual(new Set(['example-select--default']));
		expect(Object.keys(run.files)).toEqual(['data/example/components/example-option.json']);
		expect(run.selection).toMatchObject({ component: 'example-option', complete: true });
		expect(run.index).toBeUndefined();
	});

	it.each([
		['no index', undefined, /No full build has written an index/],
		['an index of other sources', index({ bundle: 'sha256:other' }), /The sources changed/],
		['an index of another configuration', index({ config: 'other' }), /The sources changed/],
		['an index without the tag', index({ cases: {} }), /does not list example-option/],
	])('runs every case with %s, and says why', async (_, given, reason) => {
		const fake = host((id) => observation(id, 'after-run'));
		const run = await runPack(fake, {
			component: 'example-option',
			workers: 1,
			...(given ? { index: given } : {}),
		});
		expect(new Set(fake.rendered).size).toBe(config.entries.length);
		expect(run.selection.reason).toMatch(reason);
	});

	it('refuses a tag that is not the library’s', async () => {
		await expect(
			runPack(
				host(() => null),
				{ component: 'other-thing' }
			)
		).rejects.toThrow(/other-thing is not one of the library's components/);
	});

	it('writes, from a full build, which cases render each tag', async () => {
		const run = await runPack(
			host((id) => (id === 'checks--select-open' ? null : observation(id, 'after-run'))),
			{ workers: 1 }
		);
		expect(run.index?.bundle).toBe('sha256:bundle');
		expect(run.index?.cases['example-option']).toEqual(['example-select--default']);
		expect(run.index?.cases['example-dropdown']).toEqual([]);
	});
});
