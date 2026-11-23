import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { climbSelection, observationClimbTree } from './climb.js';
import { defaultContext } from './config.js';
import {
	buildPoint,
	CROCKFORD_BASE32,
	computeSourceDigests,
	diffRecordedDigests,
	evaluatePointStaleness,
	formatPointContext,
	generatePointId,
	MAX_POINT_CHILDREN,
	MAX_POINT_SIBLINGS,
	MAX_POINT_TEXT_LENGTH,
	nearestSpecimenIds,
	normalizePointContextInput,
	POINT_ID_PATTERN,
	readPointFile,
	resolvePointMove,
	specimenNotFoundError,
	writePointFile,
} from './point.js';
import { PointerError } from './pointer.js';
import { pointSchema } from './schema.js';
import type { ElementObservation, Observation, SpecimenEntry } from './types.js';

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function el(
	ref: string,
	tag: string,
	options: {
		attributes?: Record<string, string>;
		accessibility?: { role: string; name: string };
	} = {}
): ElementObservation {
	return {
		ref,
		tag,
		attributes: options.attributes ?? {},
		box: { x: 10, y: 20, width: 100, height: 32 },
		scroll: { width: 100, height: 32, clientWidth: 100, clientHeight: 32 },
		styles: { color: 'rgb(0, 0, 0)' },
		state: { focused: false },
		...(options.accessibility ? { accessibility: options.accessibility } : {}),
	};
}

function makeObservation(elements: ElementObservation[], digest = 'agg-digest-1'): Observation {
	const channel = { status: 'complete' as const, scope: 'test', reasons: [] };
	return {
		manifest: {
			captureVersion: '0.10',
			normalizationVersion: '0.2',
			specimenId: 'example-toolbar',
			capturedUtc: '2026-11-23T00:00:00.000Z',
			bench: { name: '@lushly-dev/specimen', version: '2.2.0', plugins: [] },
			driver: { name: 'host', emulates: [] },
			checkpoint: {
				name: 'mount',
				actionMode: 'none',
				ready: { steps: ['upgrade', 'fonts', 'frame'], outcome: 'ready', deadlineMs: 10_000 },
				baseline: { clock: 'real', random: { source: 'seeded', seed: 1 }, storage: 'empty' },
			},
			source: { revision: 'a1b2c3d', digest, dirty: false },
			dependencies: 'lock',
			browser: { name: 'chromium', version: '1', platform: 'linux-x64', build: null },
			context: {
				...defaultContext,
				theme: 'dark',
				viewport: { width: 1280, height: 800 },
				pixelRatio: 1,
				observed: {
					width: 1280,
					height: 800,
					media: false,
					colorScheme: 'dark',
					contrast: 'no-preference',
					reducedMotion: 'no-preference',
					language: 'en-US',
					devicePixelRatio: 1,
				},
				resources: { fonts: [], remote: [] },
			},
		},
		channels: {
			dom: {
				raw: '<example-toolbar></example-toolbar>',
				normalized: '<example-toolbar></example-toolbar>',
			},
			a11y: { snapshot: '- toolbar', axe: 'not-run' },
			events: { declared: [], history: [] },
			evidence: {
				expectations: [],
				claims: [],
				commands: [],
				formData: [],
				validity: [],
				attributesSet: [],
			},
			elements,
			console: { errors: [], warnings: [] },
			visual: { path: null },
		},
		completeness: {
			dom: channel,
			a11y: channel,
			layout: channel,
			styles: channel,
			tokens: { ...channel, status: 'unsupported' },
			events: { ...channel, status: 'not-requested' },
			visual: { ...channel, status: 'not-requested' },
		},
	};
}

describe('point helpers and pure contracts (§4.0–§4.4)', () => {
	it('generates random lowercase Crockford base-32 point ids without ambiguous characters', () => {
		for (let i = 0; i < 32; i++) {
			const id = generatePointId();
			expect(id).toMatch(POINT_ID_PATTERN);
			expect(id).not.toMatch(/[ilou]/);
		}
		const deterministic = generatePointId(new Uint8Array(12).fill(31));
		expect(deterministic).toBe(`pt-${CROCKFORD_BASE32[31]?.repeat(12)}`);
	});

	it('suggests nearest specimen ids on SPECIMEN_NOT_FOUND without naming unfiltered specimen-list', () => {
		const known = [
			'example-toolbar',
			'example-inbox',
			'example-button',
			'auth-login',
			'card-basic',
		];
		expect(nearestSpecimenIds('example-toolbr', known, 3)[0]).toBe('example-toolbar');
		const err = specimenNotFoundError('example-toolbr', known);
		expect(err.code).toBe('SPECIMEN_NOT_FOUND');
		expect(err.suggestion).toContain('example-toolbar');
		expect(err.suggestion).not.toContain('specimen-list');
		expect(err.details).toMatchObject({ id: 'example-toolbr' });

		const empty = specimenNotFoundError('missing', []);
		expect(empty.code).toBe('SPECIMEN_NOT_FOUND');
		expect(empty.suggestion).toContain('specimen.config.json');
	});

	it('converts string and structured context inputs and formats flat Point.context maps', () => {
		expect(
			normalizePointContextInput({ theme: 'dark', viewport: '1280x800', container: '375' })
		).toEqual({
			theme: 'dark',
			viewport: { width: 1280, height: 800 },
			container: { width: 375 },
		});
		expect(
			normalizePointContextInput({ viewport: { width: 640, height: 480 }, container: '320x500' })
		).toEqual({
			viewport: { width: 640, height: 480 },
			container: { width: 320, height: 500 },
		});
		expect(() => normalizePointContextInput({ unknown: '1' } as never, 'pointer')).toThrow(
			PointerError
		);
		expect(() => normalizePointContextInput({ viewport: 'bad' }, 'pointer')).toThrow(PointerError);
		expect(() => normalizePointContextInput({ theme: 'sepia' as 'light' }, 'pointer')).toThrow(
			PointerError
		);

		expect(
			formatPointContext({
				...defaultContext,
				theme: 'dark',
				viewport: { width: 1280, height: 800 },
			})
		).toEqual({ theme: 'dark', viewport: '1280x800' });
	});

	it('builds bounded points with nearest-first ancestors, capped neighbourhood, 200-char text cap and zero page-wide data', () => {
		const elements: ElementObservation[] = [
			el('root', 'main'),
			el('root/example-inbox:1', 'example-inbox'),
			el('root/example-inbox:1/shadow/ul:1', 'ul', {
				accessibility: { role: 'list', name: 'Messages' },
			}),
		];
		for (let i = 1; i <= 40; i++) {
			elements.push(
				el(`root/example-inbox:1/shadow/ul:1/li:${i}`, 'li', {
					accessibility: {
						role: 'listitem',
						name: i === 12 ? 'Invoice 1042 is overdue' : `Message ${i}`,
					},
				})
			);
		}
		for (let c = 1; c <= 15; c++) {
			elements.push(el(`root/example-inbox:1/shadow/ul:1/li:12/span:${c}`, 'span'));
		}

		const tree = observationClimbTree(elements);
		const hit = tree.get('root/example-inbox:1/shadow/ul:1/li:12');
		if (!hit) throw new Error('Expected twelfth list item in test tree');
		const climbed = climbSelection(hit);
		const entry: SpecimenEntry = {
			id: 'example-inbox',
			title: 'Inbox',
			module: './src/inbox/inbox.specimens.ts',
			exportName: 'Inbox',
		};
		const longText = `${'x'.repeat(250)}🎯`;
		const point = buildPoint({
			id: 'pt-5r8k2w9m4c1x',
			entry,
			config: {
				root: '/repo',
				file: '/repo/specimen.config.json',
				schemas: {
					'example-inbox': {
						tag: 'example-inbox',
						module: 'src/inbox/inbox.ts',
						sources: ['manifest'],
						properties: [],
						attributes: [],
						slots: [],
						events: [],
						cssProperties: [],
						commands: [],
						unknown: [],
					},
				},
				manifestDirectory: '/repo',
			},
			observation: makeObservation(elements),
			selected: climbed.selected,
			accessible: { role: 'listitem', name: 'Invoice 1042 is overdue', from: hit.value },
			elementTexts: { 'root/example-inbox:1/shadow/ul:1/li:12': longText },
			context: { theme: 'light', viewport: '1280x800' },
			sourceDigests: { 'src/inbox/inbox.ts': 'abcd1234abcd1234' },
		});

		expect(pointSchema.safeParse(point).success).toBe(true);
		expect(Array.from(point.element.text)).toHaveLength(MAX_POINT_TEXT_LENGTH);
		expect(point.ancestors).toEqual([
			{ tag: 'ul', role: 'list', name: 'Messages' },
			{ tag: 'example-inbox' },
		]);
		expect(point.neighbourhood.pageData).toBe(true);
		expect(point.neighbourhood.parent).toEqual({ tag: 'ul', role: 'list', name: 'Messages' });
		expect(point.neighbourhood.siblings).toHaveLength(MAX_POINT_SIBLINGS);
		expect(point.neighbourhood.omitted.siblings).toBe(31);
		expect(point.neighbourhood.children).toHaveLength(MAX_POINT_CHILDREN);
		expect(point.neighbourhood.omitted.children).toBe(3);
		expect(point.identity.strongest).toBe('role-name');
		expect(point.check).toEqual({
			command: 'specimen-point-check',
			when: 'before editing source for this point',
		});
		expect('dom' in point).toBe(false);
		expect('a11y' in point).toBe(false);
		expect('findings' in point).toBe(false);
	});

	it('resolves all five move directions and refuses missing levels with NO_SUCH_LEVEL listing available moves', () => {
		const elements: ElementObservation[] = [
			el('root', 'main'),
			el('root/example-toolbar:1', 'example-toolbar', {
				accessibility: { role: 'toolbar', name: '' },
			}),
			el('root/example-toolbar:1/shadow/input:1', 'input', {
				accessibility: { role: 'searchbox', name: 'Search' },
			}),
			el('root/example-toolbar:1/shadow/example-button:1', 'example-button'),
			el('root/example-toolbar:1/shadow/example-button:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Share' },
			}),
			el('root/example-toolbar:1/shadow/example-button:1/shadow/button:1/svg:1', 'svg'),
			el('root/example-toolbar:1/shadow/example-button:2', 'example-button'),
			el('root/example-toolbar:1/shadow/example-button:2/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Export' },
			}),
		];

		// From svg -> component reaches example-button:1 with Share accessible info
		const toComponent = resolvePointMove(
			elements,
			'root/example-toolbar:1/shadow/example-button:1/shadow/button:1/svg:1',
			'component'
		);
		expect(toComponent.target.value.ref).toBe('root/example-toolbar:1/shadow/example-button:1');
		expect(toComponent.accessible?.name).toBe('Share');

		// Next sibling reaches example-button:2 (Export)
		const toNext = resolvePointMove(elements, toComponent.target.value.ref, 'next');
		expect(toNext.target.value.ref).toBe('root/example-toolbar:1/shadow/example-button:2');
		expect(toNext.accessible?.name).toBe('Export');

		// Previous from example-button:1 reaches searchbox input
		const toPrev = resolvePointMove(elements, toComponent.target.value.ref, 'previous');
		expect(toPrev.target.value.ref).toBe('root/example-toolbar:1/shadow/input:1');

		// Child with index selects Export button from toolbar
		const toChild = resolvePointMove(elements, 'root/example-toolbar:1', 'child', 2);
		expect(toChild.target.value.ref).toBe('root/example-toolbar:1/shadow/example-button:2');

		// Parent from specimen root fails with NO_SUCH_LEVEL naming child
		let caught: unknown;
		try {
			resolvePointMove(elements, 'root/example-toolbar:1', 'parent');
		} catch (error) {
			caught = error;
		}
		expect((caught as { code?: string }).code).toBe('NO_SUCH_LEVEL');
		expect((caught as { suggestion?: string }).suggestion).toContain('child');

		// Out-of-range child index fails with NO_SUCH_LEVEL naming valid range
		caught = undefined;
		try {
			resolvePointMove(elements, 'root/example-toolbar:1', 'child', 9);
		} catch (error) {
			caught = error;
		}
		expect((caught as { code?: string }).code).toBe('NO_SUCH_LEVEL');
		expect((caught as { suggestion?: string }).suggestion).toContain('0..2');
	});

	it('hashes source files, detects file and identity staleness, and persists points safely under .specimen/points', async () => {
		const root = await tempDir('specimen-point-unit-');
		await mkdir(join(root, 'src'), { recursive: true });
		const filePath = join(root, 'src', 'example-button.ts');
		await writeFile(filePath, 'export const label = "v1";\n');

		const digests = await computeSourceDigests(root, [
			filePath,
			join(root, 'node_modules/pkg/a.js'),
		]);
		expect(Object.keys(digests)).toEqual(['src/example-button.ts']);
		expect(await diffRecordedDigests(root, digests)).toEqual([]);

		// Edit file -> digest diff reports exact repo-relative path
		await writeFile(filePath, 'export const label = "v2";\n');
		expect(await diffRecordedDigests(root, digests)).toEqual(['src/example-button.ts']);

		const elements = [
			el('root', 'main'),
			el('root/example-button:1', 'example-button'),
			el('root/example-button:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Share' },
			}),
		];
		const tree = observationClimbTree(elements);
		const buttonNode = tree.get('root/example-button:1/shadow/button:1');
		if (!buttonNode) throw new Error('Expected inner button in test tree');
		const climbed = climbSelection(buttonNode);
		if (!climbed.accessible) throw new Error('Expected climbed accessible node');
		const obs = makeObservation(elements, 'agg-1');
		const point = buildPoint({
			id: generatePointId(),
			entry: {
				id: 'example-toolbar',
				title: 'Toolbar',
				module: './src/toolbar.ts',
				exportName: 'Toolbar',
			},
			config: {
				root,
				file: join(root, 'specimen.config.json'),
				schemas: {},
				manifestDirectory: null,
			},
			observation: obs,
			selected: climbed.selected,
			accessible: { role: 'button', name: 'Share', from: climbed.accessible.from.value },
			context: { theme: 'dark', viewport: '1280x800' },
			sourceDigests: digests,
		});

		await writePointFile(root, point);
		const loaded = await readPointFile(root, point.id);
		expect(loaded).toEqual(point);
		const rawOnDisk = JSON.parse(
			await readFile(join(root, '.specimen', 'points', `${point.id}.json`), 'utf8')
		);
		expect(rawOnDisk.id).toBe(point.id);

		// Missing or traversal point ids return POINT_NOT_FOUND
		for (const badId of ['pt-000000000000', '../escape', 'not-a-point']) {
			await expect(readPointFile(root, badId)).rejects.toMatchObject({
				code: 'POINT_NOT_FOUND',
				suggestion: expect.stringContaining('specimen-point'),
			});
		}

		// Current vs stale evaluation
		expect(evaluatePointStaleness(point, [], obs)).toEqual({ status: 'current', changed: [] });
		expect(evaluatePointStaleness(point, ['src/example-button.ts'], obs)).toEqual({
			status: 'stale',
			changed: ['src/example-button.ts'],
		});
		const renamedElements = [
			el('root', 'main'),
			el('root/example-button:1', 'example-button'),
			el('root/example-button:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Send' },
			}),
		];
		expect(evaluatePointStaleness(point, [], makeObservation(renamedElements, 'agg-1'))).toEqual({
			status: 'stale',
			changed: ['identity.role-name'],
		});

		// Truncated/corrupted point JSON returns POINT_NOT_FOUND instead of throwing TypeError
		const corruptId = 'pt-123456789012';
		await writeFile(
			join(root, '.specimen', 'points', `${corruptId}.json`),
			JSON.stringify({ id: corruptId, specimen: 'example-toolbar' })
		);
		await expect(readPointFile(root, corruptId)).rejects.toMatchObject({
			code: 'POINT_NOT_FOUND',
			suggestion: expect.stringContaining('specimen-point'),
		});
	});

	it('keeps an intermediate shadow host current right after specimen-point-move', () => {
		const elements = [
			el('root', 'main'),
			el('root/outer-wrap:1', 'outer-wrap'),
			el('root/outer-wrap:1/shadow/inner-btn:1', 'inner-btn'),
			el('root/outer-wrap:1/shadow/inner-btn:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Save' },
			}),
		];
		const obs = makeObservation(elements);
		const moved = resolvePointMove(elements, 'root/outer-wrap:1', 'child', 0);
		expect(moved.target.value.ref).toBe('root/outer-wrap:1/shadow/inner-btn:1');
		const movedPoint = buildPoint({
			id: generatePointId(),
			entry: {
				id: 'nested-btn',
				title: 'Nested',
				module: './entry.js',
				exportName: 'Nested',
			},
			config: {
				root: '/project',
				file: '/project/stories/specimen.config.json',
				schemas: {},
				manifestDirectory: null,
			},
			observation: obs,
			selected: moved.target,
			...(moved.accessible ? { accessible: moved.accessible } : {}),
			context: { theme: 'light', viewport: '1280x720' },
			sourceDigests: {},
		});
		// Nested config resolves entry.module relative to config.file's directory
		expect(movedPoint.source.specimen.module).toBe('stories/entry.js');
		// Checking the identical observation right after move must stay current
		expect(evaluatePointStaleness(movedPoint, [], obs)).toEqual({ status: 'current', changed: [] });
	});

	it('keeps slotted light-DOM siblings and moves intact while climbing through assignedSlot', () => {
		const elements = [
			el('root', 'main'),
			el('root/violet-toolbar:1', 'violet-toolbar', {
				accessibility: { role: 'toolbar', name: '' },
			}),
			el('root/violet-toolbar:1/shadow/slot:1', 'slot'),
			el('root/violet-toolbar:1/violet-button:1', 'violet-button'),
			el('root/violet-toolbar:1/violet-button:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Share' },
			}),
			el('root/violet-toolbar:1/violet-button:2', 'violet-button'),
			el('root/violet-toolbar:1/violet-button:2/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Export' },
			}),
		];
		const slottedParents = {
			'root/violet-toolbar:1/violet-button:1': 'root/violet-toolbar:1/shadow/slot:1',
			'root/violet-toolbar:1/violet-button:2': 'root/violet-toolbar:1/shadow/slot:1',
		};
		const tree = observationClimbTree(elements, slottedParents);
		const shareBtn = tree.get('root/violet-toolbar:1/violet-button:1/shadow/button:1');
		if (!shareBtn) throw new Error('Expected Share button');
		const climbed = climbSelection(shareBtn);
		expect(climbed.selected.value.ref).toBe('root/violet-toolbar:1/violet-button:1');

		const obs = makeObservation(elements);
		const pt = buildPoint({
			id: generatePointId(),
			entry: { id: 'tb', title: 'TB', module: './tb.ts', exportName: 'TB' },
			config: {
				root: '/proj',
				file: '/proj/specimen.config.json',
				schemas: {},
				manifestDirectory: null,
			},
			observation: obs,
			selected: climbed.selected,
			...(climbed.accessible
				? {
						accessible: {
							...(climbed.accessible.role ? { role: climbed.accessible.role } : {}),
							...(climbed.accessible.name ? { name: climbed.accessible.name } : {}),
							from: climbed.accessible.from.value,
						},
					}
				: {}),
			slottedParents,
			context: { theme: 'dark' },
			sourceDigests: {},
		});
		expect(pt.neighbourhood.parent?.tag).toBe('violet-toolbar');
		expect(pt.neighbourhood.siblings.map((s) => s.name)).toEqual(['Export']);
		expect(
			resolvePointMove(elements, pt.element.ref, 'next', 0, slottedParents).target.value.ref
		).toBe('root/violet-toolbar:1/violet-button:2');
		expect(
			resolvePointMove(elements, pt.element.ref, 'parent', 0, slottedParents).target.value.ref
		).toBe('root/violet-toolbar:1');
	});

	it('keeps a climbed custom-element host with its own role current when wrapping one shadow control', () => {
		const elements = [
			el('root', 'main'),
			el('root/my-toolbar:1', 'my-toolbar', {
				accessibility: { role: 'toolbar', name: '' },
			}),
			el('root/my-toolbar:1/shadow/button:1', 'button', {
				accessibility: { role: 'button', name: 'Save' },
			}),
		];
		const tree = observationClimbTree(elements);
		const inner = tree.get('root/my-toolbar:1/shadow/button:1');
		if (!inner) throw new Error('Expected inner button');
		const climbed = climbSelection(inner);
		expect(climbed.selected.value.ref).toBe('root/my-toolbar:1');
		const obs = makeObservation(elements);
		const pt = buildPoint({
			id: generatePointId(),
			entry: { id: 'tb', title: 'TB', module: './tb.ts', exportName: 'TB' },
			config: {
				root: '/proj',
				file: '/proj/specimen.config.json',
				schemas: {},
				manifestDirectory: null,
			},
			observation: obs,
			selected: climbed.selected,
			...(climbed.accessible
				? {
						accessible: {
							...(climbed.accessible.role ? { role: climbed.accessible.role } : {}),
							...(climbed.accessible.name ? { name: climbed.accessible.name } : {}),
							from: climbed.accessible.from.value,
						},
					}
				: {}),
			context: { theme: 'light' },
			sourceDigests: {},
		});
		expect(evaluatePointStaleness(pt, [], obs)).toEqual({ status: 'current', changed: [] });
	});

	it('enforces canonical filesystem containment for points storage and source digests', async () => {
		const root = await mkdtemp(join(tmpdir(), 'specimen-point-contain-'));
		const outside = await mkdtemp(join(tmpdir(), 'specimen-point-outside-'));
		try {
			await writeFile(join(outside, 'secret.txt'), 'outside-secret\n');
			const linkedDir = join(root, 'linked-outside');
			await symlink(outside, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');

			// computeSourceDigests skips files resolving outside root via symlink/junction
			const digests = await computeSourceDigests(root, [join(linkedDir, 'secret.txt')]);
			expect(digests).toEqual({});

			// diffRecordedDigests marks an escaping path stale without hashing outside root
			expect(await diffRecordedDigests(root, { 'linked-outside/secret.txt': 'abcd' })).toEqual([
				'linked-outside/secret.txt',
			]);

			// Escaping .specimen/points directory junction/symlink is refused on both write and read
			await mkdir(join(root, '.specimen'), { recursive: true });
			await symlink(
				outside,
				join(root, '.specimen', 'points'),
				process.platform === 'win32' ? 'junction' : 'dir'
			);
			const ptId = generatePointId();
			const dummyPoint = buildPoint({
				id: ptId,
				entry: { id: 'a', title: 'A', module: './a.ts', exportName: 'A' },
				config: {
					root,
					file: join(root, 'specimen.config.json'),
					schemas: {},
					manifestDirectory: null,
				},
				observation: makeObservation([el('root', 'main'), el('root/div:1', 'div')]),
				selected: observationClimbTree([el('root', 'main'), el('root/div:1', 'div')]).get(
					'root/div:1'
				) as never,
				context: { theme: 'light' },
				sourceDigests: {},
			});
			await expect(writePointFile(root, dummyPoint)).rejects.toThrow(/real directory|escapes/i);
			await expect(readPointFile(root, ptId)).rejects.toMatchObject({ code: 'POINT_NOT_FOUND' });
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});
});
