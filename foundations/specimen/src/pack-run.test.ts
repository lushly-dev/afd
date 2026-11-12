import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './index.js';
import { readPackFiles } from './pack.js';
import { exampleMarkup } from './pack-run.js';
import { packCheckRunSchema, packRunSchema } from './schema.js';

/**
 * `specimen pack` on the example library: built from its cases, its committed form is the format's
 * fixture pack, byte for byte, on any system the suite runs on.
 */
const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const decoder = new TextDecoder();
/** A test that builds the pack more than once: each build runs every case twice. */
const SEVERAL_BUILDS = 120_000;

/** The example library and its committed pack, copied so a test may change them. */
async function copy(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'specimen-pack-'));
	await cp(join(fixtures, 'pack-library'), join(root, 'pack-library'), {
		recursive: true,
		// A full build's index is a cache: a copy starts without one.
		filter: (source) => !source.includes('node_modules'),
	});
	await cp(join(fixtures, 'pack/committed'), join(root, 'pack/committed'), { recursive: true });
	return root;
}

describe('specimen pack', () => {
	let bench: SpecimenBench;
	beforeAll(async () => {
		bench = await createSpecimenBench({ root: join(fixtures, 'pack-library') });
	});
	afterAll(async () => {
		await bench?.close();
	});

	it('builds the format’s fixture pack from the example library, byte for byte', async () => {
		const run = await bench.packCheck({ workers: 1 });
		expect(packCheckRunSchema.parse(run)).toEqual(run);
		expect(run.problems).toEqual([]);
		expect({ changed: run.changed, added: run.added, removed: run.removed }).toEqual({
			changed: [],
			added: [],
			removed: [],
		});
		expect(run.valid).toBe(true);
		expect(run.cases).toMatchObject({ total: 9, passed: 9, failed: [], unstable: [] });
		expect(run.examples).toEqual({ kept: 3, leftOut: [] });
		expect(run.guides).toMatchObject({ verified: 2, invalidClaims: [] });
		expect(run.components).toEqual([
			{
				tag: 'example-dropdown',
				gaps: [
					{ kind: 'summary' },
					{ kind: 'usage' },
					{ kind: 'a11y-statement' },
					{ kind: 'role' },
					{ kind: 'example' },
					{ kind: 'unobserved', section: 'attributes', name: 'value' },
				],
			},
			{ tag: 'example-field', gaps: [] },
			{ tag: 'example-option', gaps: [{ kind: 'a11y-statement' }, { kind: 'example' }] },
			{
				tag: 'example-select',
				gaps: [{ kind: 'unobserved', section: 'attributes', name: 'required' }],
			},
		]);
	});

	it(
		'names the record a changed fixture differs in, and passes after a version bump',
		async () => {
			const root = await copy();
			const changed = await createSpecimenBench({ root: join(root, 'pack-library') });
			try {
				const record = join(root, 'pack/committed/data/example/components/example-select.json');
				await writeFile(record, (await readFile(record, 'utf8')).replace('"preview"', '"stable"'));
				const run = await changed.packCheck({ workers: 1 });
				expect(run.valid).toBe(false);
				expect(run.changed).toEqual(['data/example/components/example-select.json']);
				// Writing it puts back what the run showed, and nothing else.
				const written = packRunSchema.parse(await changed.pack({ workers: 1 }));
				expect(written.written).toEqual(['data/example/components/example-select.json']);
				expect(await readFile(record, 'utf8')).toBe(
					await readFile(
						join(fixtures, 'pack/committed/data/example/components/example-select.json'),
						'utf8'
					)
				);
			} finally {
				await changed.close();
			}
			// A record holds no version, so a new version of the library changes no record.
			const manifest = join(root, 'pack-library/library.json');
			await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('1.0.0', '2.0.0'));
			const bumped = await createSpecimenBench({ root: join(root, 'pack-library') });
			try {
				expect((await bumped.packCheck({ workers: 1 })).valid).toBe(true);
			} finally {
				await bumped.close();
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);

	it(
		'rebuilds one component from the cases a full build indexed, equal to its record from that build',
		async () => {
			const root = await copy();
			const one = await createSpecimenBench({ root: join(root, 'pack-library') });
			try {
				const before = await one.packCheck({ workers: 1, component: 'example-option' });
				expect(before.selection.reason).toMatch(/No full build has written an index/);
				expect((await one.packCheck({ workers: 1 })).valid).toBe(true);
				// No story names the option: only the select's cases render it.
				const run = await one.packCheck({ workers: 1, component: 'example-option' });
				expect(run.selection).toEqual({
					component: 'example-option',
					complete: true,
					reason:
						"The last full build's index lists 3 cases that render it, and the sources have not changed since.",
				});
				expect(run.cases.total).toBe(3);
				expect(run.valid).toBe(true);
				expect(run.components.map((item) => item.tag)).toEqual(['example-option']);
			} finally {
				await one.close();
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);

	it(
		'takes nothing from a case that differs between passes, fails, or whose example does not mount again',
		async () => {
			const root = await copy();
			const variants = await createSpecimenBench({
				root: join(root, 'pack-library'),
				configFile: 'specimen.variants.json',
			});
			const before = await readPackFiles(join(root, 'pack/committed'));
			try {
				const run = await variants.packCheck({ workers: 1 });
				expect(run.cases.unstable).toEqual(['variants--unstable']);
				expect(run.cases.failed.map((item) => item.id)).toEqual(['variants--broken']);
				expect(run.cases.retried).toEqual(['variants--broken']);
				expect(run.examples.leftOut).toEqual([
					{
						tag: 'example-field',
						from: 'example-field--property-named',
						reason: 'Mounted again from its markup, it shows something else.',
					},
				]);
				expect(run.valid).toBe(false);
				// A run with a failed case writes nothing unless the case is named.
				await expect(variants.pack({ workers: 1 })).rejects.toThrow(
					/No pack was written\. 1 case failed: variants--broken/
				);
				expect(await readPackFiles(join(root, 'pack/committed'))).toEqual(before);
				const allowed = await variants.pack({ workers: 1, allowFailed: ['variants--broken'] });
				expect(allowed.cases.failed.map((item) => item.id)).toEqual(['variants--broken']);
				// The unstable case's value never reaches the record: it showed one in each pass.
				const field = decoder.decode(
					(await readPackFiles(join(root, 'pack/committed'))).get(
						'data/example/components/example-field.json'
					)
				);
				expect(field).not.toContain('Token');
			} finally {
				await variants.close();
				await rm(root, { recursive: true, force: true });
			}
		},
		SEVERAL_BUILDS
	);
});

describe('an example’s markup', () => {
	it('leaves out shadow content and writes an empty attribute as its name', () => {
		expect(
			exampleMarkup(
				'<example-field label="Email" invalid=""><template shadowrootmode="open"><span part="value"></span><slot name="hint"></slot></template>\n\t<span slot="hint">Why.</span>\n</example-field>'
			)
		).toBe(
			'<example-field invalid label="Email">\n\t<span slot="hint">Why.</span>\n</example-field>'
		);
	});

	it('writes each element’s attributes in name order, however the page set them', () => {
		const one =
			'<x-item heading-level="3" expanded=""><span slot="heading" class="a b">A</span></x-item>';
		const two =
			'<x-item expanded="" heading-level="3"><span class="a b" slot="heading">A</span></x-item>';
		expect(exampleMarkup(one)).toBe(
			'<x-item expanded heading-level="3"><span class="a b" slot="heading">A</span></x-item>'
		);
		expect(exampleMarkup(two)).toBe(exampleMarkup(one));
	});
});
