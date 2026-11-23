import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpecimenBench, type SpecimenBench } from './bench.js';
import type { SpecimenHostError } from './host.js';
import { pointCheckResultSchema, pointResultSchema } from './schema.js';

const EXAMPLE_BUTTON_SOURCE = `if (!customElements.get('example-button')) {
	class ExampleButton extends HTMLElement {
		constructor() {
			super();
			this.attachShadow({ mode: 'open' });
		}
		connectedCallback() {
			const label = this.getAttribute('label') || '';
			this.shadowRoot.innerHTML =
				'<button type="button">' +
				'<svg aria-hidden="true" width="16" height="16"><path d="M2 2h12v12H2z"></path></svg>' +
				'<span>' + label + '</span>' +
				'</button>';
		}
	}
	customElements.define('example-button', ExampleButton);
}
export const EXAMPLE_BUTTON_TAG = 'example-button';
`;

const TOOLBAR_COMPONENT_SOURCE = `import '../example-button.js';

if (!customElements.get('example-toolbar')) {
	class ExampleToolbar extends HTMLElement {
		constructor() {
			super();
			const shadow = this.attachShadow({ mode: 'open' });
			shadow.innerHTML =
				'<input type="search" aria-label="Search" placeholder="Search" />' +
				'<example-button label="Share"></example-button>' +
				'<example-button label="Export"></example-button>';
		}
		connectedCallback() {
			this.setAttribute('role', 'toolbar');
		}
	}
	customElements.define('example-toolbar', ExampleToolbar);
}
`;

const TOOLBAR_SPECIMENS_SOURCE = `import './toolbar.js';

export const Toolbar = {
	render() {
		return document.createElement('example-toolbar');
	},
};
`;

const INBOX_SPECIMENS_SOURCE = `if (!customElements.get('example-inbox')) {
	class ExampleInbox extends HTMLElement {
		constructor() {
			super();
			const shadow = this.attachShadow({ mode: 'open' });
			const ul = document.createElement('ul');
			ul.setAttribute('role', 'list');
			ul.setAttribute('aria-label', 'Messages');
			for (let i = 1; i <= 40; i++) {
				const li = document.createElement('li');
				li.setAttribute('role', 'listitem');
				if (i === 12) {
					li.setAttribute('aria-label', 'Invoice 1042 is overdue');
					li.textContent = 'Invoice 1042 is overdue — ' + 'details '.repeat(40);
				} else {
					li.textContent = 'Message ' + i;
				}
				ul.append(li);
			}
			shadow.append(ul);
		}
	}
	customElements.define('example-inbox', ExampleInbox);
}

export const Inbox = {
	render() {
		return document.createElement('example-inbox');
	},
};
`;

const CUSTOM_ELEMENTS_MANIFEST = {
	schemaVersion: '1.0.0',
	modules: [
		{
			path: 'src/example-button.js',
			declarations: [{ tagName: 'example-button', customElement: true }],
		},
		{
			path: 'src/toolbar/toolbar.js',
			declarations: [{ tagName: 'example-toolbar', customElement: true }],
		},
	],
};

async function expectSpecimenError(promise: Promise<unknown>): Promise<SpecimenHostError> {
	const error = await promise.then(
		() => {
			throw new Error('Expected operation to fail');
		},
		(value: unknown) => value
	);
	expect(error).toBeInstanceOf(Error);
	return error as SpecimenHostError;
}

describe.each(['in-process', 'process'] as const)(
	'Pointing Slice 1 commands through SpecimenBench (%s)',
	(runtimeIsolation) => {
		let root: string;
		let bench: SpecimenBench;

		beforeAll(async () => {
			root = await realpath(await mkdtemp(join(tmpdir(), `specimen-point-${runtimeIsolation}-`)));
			await mkdir(join(root, 'src', 'toolbar'), { recursive: true });
			await mkdir(join(root, 'src', 'inbox'), { recursive: true });
			await writeFile(join(root, 'src', 'example-button.js'), EXAMPLE_BUTTON_SOURCE);
			await writeFile(join(root, 'src', 'toolbar', 'toolbar.js'), TOOLBAR_COMPONENT_SOURCE);
			await writeFile(
				join(root, 'src', 'toolbar', 'toolbar.specimens.js'),
				TOOLBAR_SPECIMENS_SOURCE
			);
			await writeFile(join(root, 'src', 'inbox', 'inbox.specimens.js'), INBOX_SPECIMENS_SOURCE);
			await writeFile(
				join(root, 'custom-elements.json'),
				JSON.stringify(CUSTOM_ELEMENTS_MANIFEST, null, 2)
			);
			await writeFile(
				join(root, 'specimen.config.json'),
				JSON.stringify(
					{
						manifest: './custom-elements.json',
						specimens: [
							{
								id: 'example-toolbar',
								title: 'Toolbar',
								module: './src/toolbar/toolbar.specimens.js',
								exportName: 'Toolbar',
								component: 'example-toolbar',
							},
							{
								id: 'example-inbox',
								title: 'Inbox',
								module: './src/inbox/inbox.specimens.js',
								exportName: 'Inbox',
							},
						],
					},
					null,
					2
				)
			);
			bench = await createSpecimenBench({ root, runtimeIsolation });
		}, 120_000);

		afterAll(async () => {
			await bench?.close();
			if (root) await rm(root, { recursive: true, force: true, maxRetries: 10 });
		});

		it('Scenario 01: resolves pointer URI and named target to the same climbed element with source and CEM component', async () => {
			const fromPointer = await bench.point({
				pointer:
					'specimen:example-toolbar?theme=dark&viewport=1280x800#ref=root/example-toolbar:1/shadow/example-button:1&text=Share&pin=0.42,0.58',
			});
			expect(pointResultSchema.safeParse(fromPointer).success).toBe(true);
			const pt = fromPointer.point;
			expect(pt.id).toMatch(/^pt-[0-9a-z]{12}$/);
			expect(pt.specimen).toBe('example-toolbar');
			expect(pt.context).toEqual({ theme: 'dark', viewport: '1280x800' });
			expect(pt.element.tag).toBe('example-button');
			expect(pt.element.ref).toBe('root/example-toolbar:1/shadow/example-button:1');
			expect(pt.element.text).toBe('Share');
			expect(pt.accessible.role).toBe('button');
			expect(pt.accessible.name).toBe('Share');
			expect(pt.accessible.from).toContain('shadow/button:1');
			expect(pt.identity.strongest).toBe('role-name');
			expect(pt.component?.tag).toBe('example-button');
			expect(pt.component?.module).toContain('example-button');
			expect(pt.source.specimen.module).toContain('toolbar.specimens');
			expect(pt.source.specimen.exportName).toBe('Toolbar');
			expect(pt.source.digests['src/example-button.js']).toBeDefined();
			expect(pt.pin).toEqual({ x: 0.42, y: 0.58 });
			expect(pt.check).toEqual({
				command: 'specimen-point-check',
				when: 'before editing source for this point',
			});

			// Stored under .specimen/points/<id>.json
			const storedRaw = JSON.parse(
				await readFile(join(root, '.specimen', 'points', `${pt.id}.json`), 'utf8')
			);
			expect(storedRaw).toEqual(pt);

			// Named { role, name } target resolves to the exact same element
			const fromNamed = await bench.point({
				id: 'example-toolbar',
				context: { theme: 'dark', viewport: '1280x800' },
				target: { role: 'button', name: 'Share' },
			});
			expect(fromNamed.point.element.ref).toBe('root/example-toolbar:1/shadow/example-button:1');
			expect(fromNamed.point.element.tag).toBe('example-button');
			expect(fromNamed.point.pin).toEqual({ x: 0.5, y: 0.5 });

			// Selector target piercing shadow DOM resolves cleanly too
			const fromSelector = await bench.point({
				id: 'example-toolbar',
				context: { theme: 'dark', viewport: '1280x800' },
				target: { selector: 'example-button[label="Export"] button' },
			});
			expect(fromSelector.point.element.ref).toBe('root/example-toolbar:1/shadow/example-button:2');
			expect(fromSelector.point.accessible.name).toBe('Export');

			// Missing target returns TARGET_NOT_FOUND suggesting review page
			const notFound = await expectSpecimenError(
				bench.point({
					id: 'example-toolbar',
					context: { theme: 'dark', viewport: '1280x800' },
					target: { role: 'button', name: 'Print' },
				})
			);
			expect(notFound.code).toBe('TARGET_NOT_FOUND');
			expect(notFound.suggestion).toContain('review page');
		});

		it('Scenario 02: respects depth=deepest, moves across levels, refuses invalid levels and ambiguous targets', async () => {
			const deepest = await bench.point({
				pointer:
					'specimen:example-toolbar?theme=dark&viewport=1280x800#ref=root/example-toolbar:1/shadow/example-button:1/shadow/button:1/svg:1&depth=deepest',
			});
			expect(deepest.point.element.tag).toBe('svg');
			expect(deepest.point.ancestors[0]).toEqual({ tag: 'button', role: 'button', name: 'Share' });
			expect(deepest.point.ancestors[1]?.tag).toBe('example-button');
			expect(deepest.point.ancestors[2]?.tag).toBe('example-toolbar');
			expect(deepest.point.ancestors[2]?.role).toBe('toolbar');

			const movedComponent = await bench.pointMove({
				id: deepest.point.id,
				to: 'component',
			});
			expect(movedComponent.point.id).toMatch(/^pt-[0-9a-z]{12}$/);
			expect(movedComponent.point.id).not.toBe(deepest.point.id);
			expect(movedComponent.point.element.tag).toBe('example-button');
			expect(movedComponent.point.accessible.name).toBe('Share');

			const movedNext = await bench.pointMove({
				id: movedComponent.point.id,
				to: 'next',
			});
			expect(movedNext.point.element.tag).toBe('example-button');
			expect(movedNext.point.accessible.name).toBe('Export');

			const toolbar = await bench.point({
				id: 'example-toolbar',
				context: { theme: 'dark', viewport: '1280x800' },
				target: { role: 'toolbar' },
			});
			expect(toolbar.point.element.tag).toBe('example-toolbar');

			const noParent = await expectSpecimenError(
				bench.pointMove({ id: toolbar.point.id, to: 'parent' })
			);
			expect(noParent.code).toBe('NO_SUCH_LEVEL');
			expect(noParent.suggestion).toContain('child');

			const ambiguous = await expectSpecimenError(
				bench.point({
					id: 'example-toolbar',
					context: { theme: 'dark', viewport: '1280x800' },
					target: { role: 'button' },
				})
			);
			expect(ambiguous.code).toBe('TARGET_AMBIGUOUS');
			expect(ambiguous.suggestion).toContain('name');
		});

		it('Scenario 03: caps text at 200 chars, caps siblings at 8 with omitted count, and includes no page-wide data', async () => {
			const res = await bench.point({
				id: 'example-inbox',
				context: { theme: 'light', viewport: '1280x800' },
				target: { role: 'listitem', name: 'Invoice 1042 is overdue' },
			});
			const pt = res.point;
			expect(Array.from(pt.element.text).length).toBeLessThanOrEqual(200);
			expect(pt.element.text).toContain('Invoice 1042 is overdue');
			expect(pt.accessible.role).toBe('listitem');
			expect(pt.neighbourhood.pageData).toBe(true);
			expect(pt.neighbourhood.parent?.role).toBe('list');
			expect(pt.neighbourhood.siblings).toHaveLength(8);
			expect(pt.neighbourhood.omitted.siblings).toBe(31);
			expect('dom' in pt).toBe(false);
			expect('a11y' in pt).toBe(false);
			expect('findings' in pt).toBe(false);
		});

		it('Scenario 04: detects stale source files, refuses specimen-point-move with POINT_STALE, and recovers on fresh point', async () => {
			const initial = await bench.point({
				id: 'example-toolbar',
				context: { theme: 'dark', viewport: '1280x800' },
				target: { role: 'button', name: 'Share' },
			});
			const current = await bench.pointCheck({ id: initial.point.id });
			expect(pointCheckResultSchema.safeParse(current).success).toBe(true);
			expect(current).toEqual({ status: 'current', changed: [] });

			// Modify the component source on disk
			await writeFile(
				join(root, 'src', 'example-button.js'),
				`${EXAMPLE_BUTTON_SOURCE}\n// edited for staleness test\n`
			);
			try {
				const stale = await bench.pointCheck({ id: initial.point.id });
				expect(stale.status).toBe('stale');
				expect(stale.changed).toContain('src/example-button.js');

				const refusedMove = await expectSpecimenError(
					bench.pointMove({ id: initial.point.id, to: 'next' })
				);
				expect(refusedMove.code).toBe('POINT_STALE');
				expect(refusedMove.suggestion).toContain('specimen-point');

				// Even an edit that breaks bundling preserves the stale file report and POINT_STALE refusal
				await writeFile(
					join(root, 'src', 'example-button.js'),
					`import './missing-module.js';\n${EXAMPLE_BUTTON_SOURCE}`
				);
				const brokenCheck = await bench.pointCheck({ id: initial.point.id });
				expect(brokenCheck.status).toBe('stale');
				expect(brokenCheck.changed).toContain('src/example-button.js');
				const brokenMove = await expectSpecimenError(
					bench.pointMove({ id: initial.point.id, to: 'next' })
				);
				expect(brokenMove.code).toBe('POINT_STALE');

				await writeFile(
					join(root, 'src', 'example-button.js'),
					`${EXAMPLE_BUTTON_SOURCE}\n// valid v2\n`
				);
				const fresh = await bench.point({
					id: 'example-toolbar',
					context: { theme: 'dark', viewport: '1280x800' },
					target: { role: 'button', name: 'Share' },
				});
				expect(fresh.point.id).toMatch(/^pt-[0-9a-z]{12}$/);
				expect(fresh.point.check.command).toBe('specimen-point-check');
				expect(fresh.point.check.when).toContain('before editing');

				const recheck = await bench.pointCheck({ id: fresh.point.id });
				expect(recheck).toEqual({ status: 'current', changed: [] });
			} finally {
				await writeFile(join(root, 'src', 'example-button.js'), EXAMPLE_BUTTON_SOURCE);
			}
		});

		it('stays current across a fresh bench instance, catches CEM/CSS @import/static edits, and climbs slotted selectors', async () => {
			// Cross-bench workflow (one-shot CLI point -> fresh point-check -> fresh point-move)
			const initial = await bench.point({
				id: 'example-toolbar',
				context: { theme: 'dark', viewport: '1280x800' },
				target: { role: 'button', name: 'Share' },
			});
			const freshBench = await createSpecimenBench({ root, runtimeIsolation });
			try {
				expect(await freshBench.pointCheck({ id: initial.point.id })).toEqual({
					status: 'current',
					changed: [],
				});
				const moved = await freshBench.pointMove({ id: initial.point.id, to: 'next' });
				expect(moved.point.accessible.name).toBe('Export');
			} finally {
				await freshBench.close();
			}

			// Warm bench detects custom-elements.json edits as stale instead of certifying obsolete metadata
			const origManifest = await readFile(join(root, 'custom-elements.json'), 'utf8');
			try {
				await writeFile(join(root, 'custom-elements.json'), `${origManifest}\n`);
				const manifestStale = await bench.pointCheck({ id: initial.point.id });
				expect(manifestStale.status).toBe('stale');
				expect(manifestStale.changed).toContain('custom-elements.json');
			} finally {
				await writeFile(join(root, 'custom-elements.json'), origManifest);
			}

			// Slotted selector agreement + display:none exclusion + CSS @import & staticDir staleness
			const extraRoot = await realpath(
				await mkdtemp(join(tmpdir(), `specimen-point-extra-${runtimeIsolation}-`))
			);
			let extraBench: SpecimenBench | undefined;
			try {
				await mkdir(join(extraRoot, 'src', 'styles'), { recursive: true });
				await mkdir(join(extraRoot, 'public'), { recursive: true });
				await writeFile(join(extraRoot, 'src', 'styles', 'tokens.css'), ':root { --x: 1px; }\n');
				await writeFile(
					join(extraRoot, 'src', 'styles', 'entry.css'),
					'@import "./tokens.css";\n.hidden-text { display: none; }\n'
				);
				await writeFile(join(extraRoot, 'public', 'data.json'), '{"ok":true}\n');
				await writeFile(
					join(extraRoot, 'src', 'split.specimens.js'),
					`import './styles/entry.css';
if (!customElements.get('x-split')) {
	class XSplit extends HTMLElement {
		constructor() {
			super();
			this.attachShadow({ mode: 'open' }).innerHTML =
				'<button type="button"><slot></slot></button><button type="button">Secondary</button>';
		}
	}
	customElements.define('x-split', XSplit);
}
export const Split = {
	async render() {
		await fetch('/static/data.json');
		const host = document.createElement('x-split');
		const label = document.createElement('span');
		label.className = 'label';
		label.innerHTML = 'Primary<span class="hidden-text"> Secret</span>';
		host.append(label);
		return host;
	},
};
`
				);
				await writeFile(
					join(extraRoot, 'specimen.config.json'),
					JSON.stringify({
						staticDirs: [{ from: './public', to: '/static' }],
						specimens: [
							{
								id: 'split',
								title: 'Test/Split',
								module: './src/split.specimens.js',
								exportName: 'Split',
							},
						],
					})
				);
				extraBench = await createSpecimenBench({ root: extraRoot, runtimeIsolation });
				const slotted = await extraBench.point({
					id: 'split',
					target: { selector: 'span.label' },
				});
				// Climbing from slotted span crosses assignedSlot to the shadow button (matching Pick mode)
				expect(slotted.point.element.tag).toBe('button');
				expect(slotted.point.element.ref).toBe('root/x-split:1/shadow/button:1');
				expect(slotted.point.accessible.role).toBe('button');
				expect(slotted.point.element.text).toBe('Primary');
				// Both @imported CSS and served staticDir files enter source.digests
				expect(slotted.point.source.digests['src/styles/tokens.css']).toBeDefined();
				expect(slotted.point.source.digests['public/data.json']).toBeDefined();

				await writeFile(join(extraRoot, 'src', 'styles', 'tokens.css'), ':root { --x: 2px; }\n');
				const cssStale = await extraBench.pointCheck({ id: slotted.point.id });
				expect(cssStale.status).toBe('stale');
				expect(cssStale.changed).toContain('src/styles/tokens.css');
			} finally {
				await extraBench?.close();
				await rm(extraRoot, { recursive: true, force: true });
			}
		});

		it('surfaces SPECIMEN_NOT_FOUND with nearest ids, POINTER_INVALID, and POINT_NOT_FOUND', async () => {
			const missingSpecimen = await expectSpecimenError(
				bench.point({
					id: 'example-toolbr',
					target: { role: 'button', name: 'Share' },
				})
			);
			expect(missingSpecimen.code).toBe('SPECIMEN_NOT_FOUND');
			expect(missingSpecimen.suggestion).toContain('example-toolbar');

			const badPointer = await expectSpecimenError(bench.point({ pointer: 'http://invalid' }));
			expect(badPointer.code).toBe('POINTER_INVALID');
			expect(badPointer.suggestion).toContain('review page');

			const missingPoint = await expectSpecimenError(bench.pointCheck({ id: 'pt-000000000000' }));
			expect(missingPoint.code).toBe('POINT_NOT_FOUND');
			expect(missingPoint.suggestion).toContain('specimen-point');
		});
	}
);
