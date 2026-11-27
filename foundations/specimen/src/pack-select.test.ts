import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { retryTransientInspect, runSchemas } from './coverage-run.js';
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
const observation = (
	id: string,
	checkpoint: string,
	overrides: { domRaw?: string; elements?: ElementObservation[] } = {}
): Observation =>
	({
		manifest: { checkpoint: { name: checkpoint } },
		channels: {
			dom: { raw: overrides.domRaw ?? '', normalized: overrides.domRaw ?? '' },
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
			elements: overrides.elements ??
				shown[id] ?? [element('root/example-field:1', 'example-field', { label: 'A' })],
		},
	}) as unknown as Observation;

function host(
	render: (id: string, call: number) => Observation | null,
	remount?: (id: string, call: number) => Observation | null
): PackHost & {
	rendered: string[];
	remounts: Map<string, number>;
} {
	const calls = new Map<string, number>();
	const remounts = new Map<string, number>();
	const rendered: string[] = [];
	return {
		config,
		rendered,
		remounts,
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
		capture: async (id) => {
			const call = (remounts.get(id) ?? 0) + 1;
			remounts.set(id, call);
			return remount ? remount(id, call) : observation(id, 'after-run');
		},
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

	it('reports pack phases and preserves records when remounts finish out of order', async () => {
		const render = (id: string) => {
			const tag = id.startsWith('example-select') ? 'example-select' : 'example-field';
			return observation(id, 'after-run', { domRaw: `<${tag}></${tag}>` });
		};
		const serial = await runPack(host(render), { workers: 1 });
		const parallel = host(render);
		const capture = parallel.capture;
		const firstId = 'example-field--default';
		const secondId = 'example-field--invalid';
		const release = Promise.withResolvers<void>();
		const completed: string[] = [];
		parallel.capture = async (id, options) => {
			if (id === firstId) await release.promise;
			const result = await capture(id, options);
			completed.push(id);
			if (id === secondId) release.resolve();
			return result;
		};

		const progress: string[] = [];
		const run = await runPack(parallel, { workers: 2 }, (message) => progress.push(message));
		expect(completed.indexOf(secondId)).toBeLessThan(completed.indexOf(firstId));
		expect(run.files).toEqual(serial.files);
		expect(run.examples).toEqual(serial.examples);
		expect(progress).toEqual([
			'Preparing captures',
			'Capture pass 1/2 (9 cases)',
			'Capture pass 1/2 - 9/9 cases completed',
			'Capture pass 2/2 (9 cases)',
			'Capture pass 2/2 - 9/9 cases completed',
			'Comparing capture passes and computing coverage',
			'Verifying examples by remounting',
			'Building pack records after checking 3 remount candidates',
		]);
	});

	it('retries a remount once after a transient error or mismatch, and omits a persistent mismatch', async () => {
		const domByCase: Record<string, string> = {
			'example-field--default': '<example-field label="A"></example-field>',
			'example-field--invalid': '<example-field invalid label="A"></example-field>',
			'example-select--default':
				'<example-select label="Size"><example-option value="s">S</example-option></example-select>',
		};
		const fake = host(
			(id) => observation(id, 'after-run', { domRaw: domByCase[id] ?? '' }),
			(id, call) => {
				if (id === 'example-field--default' && call === 1) throw new Error('Transient CDP hiccup');
				if (id === 'example-select--default' && call === 1)
					return observation(id, 'after-run', {
						elements: [element('root/example-select:1', 'example-select', { label: 'Stale' })],
					});
				return observation(id, 'after-run');
			}
		);
		const run = await runPack(fake, { workers: 1 });
		expect(fake.remounts.get('example-field--default')).toBe(2);
		expect(fake.remounts.get('example-select--default')).toBe(2);
		expect(run.examples.kept).toBe(3);
		expect(run.examples.leftOut).toEqual([]);

		// A persistent mismatch is still retried once and omitted with the mismatch reason.
		const persistent = host(
			(id) => observation(id, 'after-run', { domRaw: domByCase[id] ?? '' }),
			(id) =>
				id === 'example-field--default'
					? observation(id, 'after-run', {
							elements: [element('root/example-field:1', 'example-field', { label: 'Other' })],
						})
					: observation(id, 'after-run')
		);
		const omitted = await runPack(persistent, { workers: 1 });
		expect(persistent.remounts.get('example-field--default')).toBe(2);
		expect(omitted.examples.kept).toBe(2);
		expect(omitted.examples.leftOut).toEqual([
			{
				tag: 'example-field',
				from: 'example-field--default',
				reason: 'Mounted again from its markup, it shows something else.',
			},
		]);
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

describe('schema inspection during pack and coverage runs (#2767)', () => {
	it('bounds concurrent inspect calls to workers, forwards timeoutMs, and retries a transient failure once', async () => {
		const tags: [string, string | undefined][] = [
			['example-field', 'example-field--default'],
			['example-select', 'example-select--default'],
			['example-option', 'example-select--default'],
			['example-dropdown', 'example-dropdown--default'],
		];
		let active = 0;
		let peak = 0;
		const seenTimeouts: Array<number | undefined> = [];
		const attempts = new Map<string, number>();
		const schemas = await runSchemas(
			{
				config,
				inspect: async (id, timeoutMs) => {
					active++;
					peak = Math.max(peak, active);
					seenTimeouts.push(timeoutMs);
					try {
						await new Promise((resolve) => setTimeout(resolve, 10));
						const count = (attempts.get(id) ?? 0) + 1;
						attempts.set(id, count);
						if (id === 'example-field--default' && count === 1) {
							throw new Error('Specimen deadline exceeded after 15000ms while opening the page');
						}
						return null;
					} finally {
						active--;
					}
				},
			},
			tags,
			{ workers: 2, timeoutMs: 25_000 }
		);
		expect(peak).toBeLessThanOrEqual(2);
		expect(attempts.get('example-field--default')).toBe(2);
		expect(seenTimeouts.every((timeout) => timeout === 25_000)).toBe(true);
		expect(schemas.map((schema) => schema.tag)).toEqual(tags.map(([tag]) => tag));
	});

	it('does not retry a permanent plugin error and caps transient retries at one', async () => {
		let permanentAttempts = 0;
		await expect(
			runSchemas(
				{
					config,
					inspect: async () => {
						permanentAttempts++;
						throw new Error('Plugin schema loader crashed');
					},
				},
				[['example-field', 'example-field--default']],
				{ workers: 1 }
			)
		).rejects.toThrow('Plugin schema loader crashed');
		expect(permanentAttempts).toBe(1);

		let transientAttempts = 0;
		await expect(
			retryTransientInspect(async () => {
				transientAttempts++;
				throw new Error('net::ERR_NO_BUFFER_SPACE at http://127.0.0.1:9/specimen.html');
			})
		).rejects.toThrow('net::ERR_NO_BUFFER_SPACE');
		expect(transientAttempts).toBe(2);
	});
});
