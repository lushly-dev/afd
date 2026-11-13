import { describe, expect, it } from 'vitest';
import { readBoot } from './read-boot.js';

const hello = {
	instance: 'hello',
	app: 'hello',
	package: 'apps/hello/',
	order: 10,
	boot: {
		title: 'Hello',
		kind: 'native',
		icon: 'system/document',
		order: 10,
		scope_levels: ['workspace', 'project'],
		rail: true,
		parts: ['sidebar', 'inspector'],
		layout: { sidebar: { open: true, width: 260 }, inspector: { open: false } },
		refusal: null,
	},
};

const projection = (apps: unknown[], extra: Record<string, unknown> = {}) => ({
	deployment_version: 2,
	generation: 'test',
	workspace: { id: 'acme', name: 'Acme' },
	sandbox_origin: null,
	apps,
	...extra,
});

describe('readBoot (phase 2 specification, 2.2)', () => {
	it('reads a boot record as the kernel takes it', () => {
		expect(readBoot(projection([hello]))).toEqual({
			generation: 'test',
			workspace: { id: 'acme', name: 'Acme' },
			apps: [
				{
					instance: 'hello',
					app: 'hello',
					title: 'Hello',
					kind: 'native',
					icon: 'system/document',
					order: 10,
					scopeLevels: ['workspace', 'project'],
					rail: true,
					parts: ['sidebar', 'inspector'],
					layout: { sidebar: { open: true, width: 260 }, inspector: { open: false } },
					refusal: null,
				},
			],
			identity: { mode: 'local' },
		});
	});

	it('reads the empty shell', () => {
		expect(readBoot(projection([], { generation: 'empty' }))?.apps).toEqual([]);
	});

	it.each([
		['nothing', undefined],
		['a version 1 projection', { deployment_version: 1, sandbox_origin: null, apps: [] }],
		['apps that are not a list', projection([], { apps: {} })],
		['no workspace', projection([], { workspace: undefined })],
		['a workspace id off its pattern', projection([], { workspace: { id: 'Acme', name: 'A' } })],
		['a reserved workspace id', projection([], { workspace: { id: 'assets', name: 'A' } })],
		['a workspace id that is markup', projection([], { workspace: { id: '<b>x</b>', name: 'A' } })],
	])('is undefined for %s', (_name, raw) => {
		expect(readBoot(raw)).toBeUndefined();
	});

	it.each([
		'apps',
		'assets',
		'mounts',
		'sandbox',
		'p',
		'~',
		'deployment.json',
		'index.html',
		'404.html',
	])('refuses the reserved workspace id %s', (id) => {
		expect(readBoot(projection([], { workspace: { id, name: 'X' } }))).toBeUndefined();
		expect(
			readBoot(
				projection([], { workspace: { id: `${id}x`.replace(/[^a-z0-9-]/g, 'x'), name: 'X' } })
			)
		).toBeDefined();
	});

	it('drops an entry whose instance or app would misname a record, and a repeated instance', () => {
		const read = readBoot(
			projection([
				{ ...hello, instance: '../x' },
				{ ...hello, instance: 'other', app: 'Hello' },
				{ ...hello, instance: '__proto__' },
				'hello',
				null,
				hello,
				{ ...hello, boot: { ...hello.boot, title: 'Second' } },
			])
		);
		expect(read?.apps.map((app) => [app.instance, app.title])).toEqual([['hello', 'Hello']]);
	});

	it('gives each display field out of shape its default, and keeps the entry', () => {
		const read = readBoot(
			projection([
				{
					instance: 'tally',
					app: 'tally',
					package: 'apps/tally/',
					boot: {
						title: '',
						kind: 'plugin',
						icon: 'javascript:alert(1)',
						order: 1.5,
						scope_levels: ['team'],
						rail: 'yes',
						parts: ['tray'],
						layout: 'wide',
						refusal: { code: 1 },
					},
				},
				{ instance: 'bare', app: 'bare', package: 'apps/bare/' },
			])
		);
		const defaults = {
			kind: 'native',
			icon: 'system/folder',
			order: 100,
			scopeLevels: ['workspace'],
			rail: true,
			parts: [],
			layout: {},
			refusal: null,
		};
		expect(read?.apps).toEqual([
			{ instance: 'tally', app: 'tally', title: 'tally', ...defaults },
			{ instance: 'bare', app: 'bare', title: 'bare', ...defaults },
		]);
	});

	it('keeps the first of each repeated level and part, as the schema no longer refuses repeats', () => {
		const read = readBoot(
			projection([
				{
					...hello,
					boot: {
						...hello.boot,
						scope_levels: ['project', 'project'],
						parts: ['panel', 'sidebar', 'panel'],
					},
				},
			])
		);
		expect(read?.apps[0]?.scopeLevels).toEqual(['project']);
		expect(read?.apps[0]?.parts).toEqual(['panel', 'sidebar']);
	});

	it('keeps markup in a title as text: it is for display, and never parsed', () => {
		const title = '<img src=x onerror=alert(1)>';
		const read = readBoot(projection([{ ...hello, boot: { ...hello.boot, title } }]));
		expect(read?.apps[0]?.title).toBe(title);
	});

	it('reads a refusal', () => {
		const refusal = { code: 'MANIFEST_INVALID', message: 'No.', suggestion: 'Fix it.' };
		const read = readBoot(projection([{ ...hello, boot: { ...hello.boot, refusal } }]));
		expect(read?.apps[0]?.refusal).toEqual(refusal);
	});

	it('names an unnamed workspace by its id', () => {
		expect(readBoot(projection([], { workspace: { id: 'acme' } }))?.workspace).toEqual({
			id: 'acme',
			name: 'acme',
		});
	});
});
