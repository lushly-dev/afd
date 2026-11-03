import { success } from '@lushly-dev/afd-core';
import type { LayoutStateV0 } from '@lushly-dev/loam-kernel';
import { type AppCallContextV1, defineApp, type ManifestV1 } from '@lushly-dev/loam-sdk';
import { describe, expect, it } from 'vitest';
import { createAppTestKernel } from './index.js';

const noInput = { type: 'object', properties: {}, additionalProperties: false };

/** Hello's shape from the specification's sketch; step 4 runs the real app's scenario. */
const manifest = {
	manifest_version: 1,
	protocol: 1,
	plugin: {
		id: 'greeter',
		title: 'Greeter',
		version: '0.1.0',
		description: 'Remembers the names it greets.',
		kind: 'native',
		domains: ['greeter'],
	},
	native: { entry: 'dist/native.js' },
	grants: [
		{ name: 'store', reason: 'Keeps the names greeted.' },
		{ name: 'clock', reason: 'Stamps each greeting.' },
	],
	commands: [
		{
			name: 'greeter-greet',
			title: 'Greet someone',
			description: 'Greet someone and remember the name.',
			effects: ['store-write'],
			input_schema: {
				type: 'object',
				properties: { name: { type: 'string' } },
				required: ['name'],
				additionalProperties: false,
			},
		},
		{
			name: 'greeter-list',
			title: 'List greetings',
			description: 'List the names greeted.',
			effects: ['inspect'],
			input_schema: noInput,
		},
	],
	ui: { surfaces: { sidebar: { shape: 'list', command: 'greeter-list' } } },
} as unknown as ManifestV1;

const definition = defineApp({
	sdk: 1,
	handlers: {
		'greeter-greet': (async (input: { name: string }, context: AppCallContextV1) => {
			await context.store?.put(input.name, { at: context.now?.() });
			return success({ greeting: `Hello, ${input.name}!` });
		}) as never,
		'greeter-list': (async (_input: unknown, context: AppCallContextV1) => {
			const names = (await context.store?.list()) ?? [];
			return success({ items: names.map(({ key }) => ({ id: key, title: key })) });
		}) as never,
	},
});

describe('createAppTestKernel', () => {
	it('runs a scenario through both interfaces and replays it with zero differences', async () => {
		const { kernel, journal, replay } = await createAppTestKernel({ manifest, definition });
		const greeted = await kernel.call<{ greeting: string }>('greeter-greet', { name: 'Ada' });
		expect(greeted.data?.greeting).toBe('Hello, Ada!');
		await kernel.agent.call('greeter-greet', { name: 'Lin' });
		const listed = await kernel.call<{ items: unknown[] }>('greeter-list');
		expect(listed.data?.items).toHaveLength(2);
		expect((await journal.read()).at(-1)?.context).toEqual({
			app: 'greeter',
			instance: 'greeter',
			scope: { workspace: 'personal' },
		});
		const { report } = await replay();
		expect(report.diverged).toBe(false);
		// Stage B's own `workspace-deployment-apply`, and the three calls.
		expect(report.same).toBe(4);
		await kernel.dispose();
	});

	it('P2-E4: runs in a project with `scope`, keeping its store apart from the workspace, and replays it', async () => {
		const { kernel, port, journal, replay } = await createAppTestKernel({
			manifest: { ...manifest, app: { scope_levels: ['workspace', 'project'] } } as ManifestV1,
			definition,
			scope: { project: 'atlas' },
		});
		await kernel.call('greeter-greet', { name: 'Ada' });
		const scoped = (await journal.read()).at(-1)?.context?.scope as { project?: string };
		expect(scoped.project).toMatch(/^prj_[0-9a-z]{10}$/);
		// The port follows the active scope, and a call at workspace level sees nothing of Atlas.
		expect((await port.call<{ items: unknown[] }>('greeter-list')).data?.items).toHaveLength(1);
		const workspace = await kernel.call<{ items: unknown[] }>(
			'greeter-list',
			{},
			{
				scope: 'workspace',
			}
		);
		expect(workspace.data?.items).toHaveLength(0);
		expect((await replay()).report.diverged).toBe(false);
		await kernel.dispose();
	});

	it('P2-E4: narrows a workspace-only app to the workspace, with a project active', async () => {
		const { kernel, journal } = await createAppTestKernel({
			manifest,
			definition,
			scope: { project: 'atlas' },
		});
		await kernel.call('greeter-greet', { name: 'Ada' });
		expect((await journal.read()).at(-1)?.context?.scope).toEqual({ workspace: 'personal' });
		await kernel.dispose();
	});

	it('drives the layout through the view-state commands', async () => {
		const { kernel } = await createAppTestKernel({ manifest, definition });
		await kernel.call('app-open', { instance: 'greeter' });
		await kernel.call('view-state-set', { id: 'loam.layout', state: { sidebar: { width: 222 } } });
		const layout = await kernel.call<LayoutStateV0>('layout-get');
		expect(layout.data?.sidebar.width).toBe(222);
		await kernel.dispose();
	});

	it('runs a view app with no iframe', async () => {
		const view = {
			...manifest,
			plugin: { ...manifest.plugin, kind: 'view' },
			native: undefined,
			view: { handlers: 'handlers.html' },
		} as unknown as ManifestV1;
		const { kernel, replay } = await createAppTestKernel({ manifest: view, definition });
		expect((await kernel.call('greeter-greet', { name: 'Ada' })).success).toBe(true);
		expect((await replay()).report.diverged).toBe(false);
		await kernel.dispose();
	});

	it('keeps only the grants it is given, so a test can run without one', async () => {
		const seen: { keys?: string[] } = {};
		const { kernel, port } = await createAppTestKernel({
			manifest,
			grants: ['store'],
			definition: defineApp({
				sdk: 1,
				handlers: {
					'greeter-greet': (async (_input: unknown, context: object) => {
						seen.keys = Object.keys(context);
						return success({});
					}) as never,
					'greeter-list': (async () => success({})) as never,
				},
			}),
		});
		await kernel.call('greeter-greet', { name: 'Ada' });
		expect(seen.keys).toContain('store');
		expect(seen.keys).not.toContain('now');
		expect(port.instance).toBe('greeter');
		await kernel.dispose();
	});

	it('imports a definition it is given as a function, with or without a default', async () => {
		const first = await createAppTestKernel({
			manifest,
			definition: async () => ({ default: definition }),
		});
		const second = await createAppTestKernel({ manifest, definition: async () => definition });
		await Promise.all([first.kernel.dispose(), second.kernel.dispose()]);
	});

	it('fails a definition whose import defines a global element', async () => {
		await expect(
			createAppTestKernel({
				manifest,
				definition: async () => {
					customElements.define('greeter-main', class extends HTMLElement {});
					return definition;
				},
			})
		).rejects.toMatchObject({
			code: 'APP_GLOBAL_ELEMENT',
			message: expect.stringContaining('greeter-main'),
		});
	});

	it('fails a definition already imported, since it watches from its own import', async () => {
		customElements.define('greeter-other', class extends HTMLElement {});
		await expect(createAppTestKernel({ manifest, definition })).rejects.toMatchObject({
			code: 'APP_GLOBAL_ELEMENT',
		});
		// Reported once: the next app is not blamed for it.
		const { kernel } = await createAppTestKernel({ manifest, definition });
		await kernel.dispose();
	});

	it('fails with the refusal of a manifest the kernel refuses', async () => {
		await expect(
			createAppTestKernel({
				manifest: { ...manifest, ui: { surfaces: { tray: {} } } } as never,
				definition,
			})
		).rejects.toMatchObject({ code: 'MANIFEST_UNKNOWN_SURFACE' });
	});

	it('refuses a mounted manifest, which has no handler', async () => {
		await expect(
			createAppTestKernel({
				manifest: { ...manifest, plugin: { ...manifest.plugin, kind: 'mounted' } } as never,
				definition,
			})
		).rejects.toMatchObject({ code: 'MOUNT_TRANSPORT_UNAVAILABLE' });
	});
});
