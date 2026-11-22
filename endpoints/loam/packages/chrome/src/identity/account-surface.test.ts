/**
 * P3-E14's unit in the chrome (phase 3 specification, 5.5): what an app's account section shows, read in the page. The
 * manifest's `accountSurfaceOf` decides the same table at install time, in `profile-cases.json`'s `ui-account-*` cases.
 */

import { describe, expect, it } from 'vitest';
import { appTabs, surfaceOf } from './account-surface.js';

type Port = Parameters<typeof surfaceOf>[0];
const port = (kind: string, surfaces: Record<string, unknown>): Port =>
	({ manifest: { plugin: { kind }, ui: { surfaces } } }) as unknown as Port;

describe('P3-E14: an app’s account section, its surface', () => {
	it("shows a native app's main, inspector or custom sidebar element", () => {
		const native = port('native', {
			main: { element: 'x-main' },
			inspector: { element: 'x-inspector' },
			sidebar: { shape: 'custom', element: 'x-side' },
		});
		expect(surfaceOf(native, 'main')).toEqual({ element: 'x-main' });
		expect(surfaceOf(native, 'inspector')).toEqual({ element: 'x-inspector' });
		expect(surfaceOf(native, 'sidebar')).toEqual({ element: 'x-side' });
	});

	it("shows a view app's main resource, with its command", () => {
		const view = port('view', { main: { resource: 'ui://x/main', command: 'x-list' } });
		expect(surfaceOf(view, 'main')).toEqual({ resource: 'ui://x/main', command: 'x-list' });
		expect(surfaceOf(port('view', { main: { resource: 'ui://x/main' } }), 'main')).toEqual({
			resource: 'ui://x/main',
		});
	});

	it('shows nothing else: a list sidebar, a view inspector, an undeclared surface, any mounted app', () => {
		const native = port('native', { sidebar: { shape: 'list', element: 'x-side' } });
		expect(surfaceOf(native, 'sidebar')).toBeUndefined();
		expect(surfaceOf(native, 'main')).toBeUndefined();
		expect(surfaceOf(native, 'panel')).toBeUndefined();
		expect(surfaceOf(native, 'rail')).toBeUndefined();
		expect(surfaceOf(port('view', { inspector: { element: 'x' } }), 'inspector')).toBeUndefined();
		expect(surfaceOf(port('mounted', { main: { element: 'x' } }), 'main')).toBeUndefined();
	});
});

type Kernel = Parameters<typeof appTabs>[0];
/** A kernel with `app-list`'s apps, each app's manifest and its gates, read as `app-get` answers them. */
function kernelOf(
	apps: Array<{
		instance: string;
		title: string;
		kind?: string;
		state?: string;
		account?: unknown[];
		gates?: Record<string, { open: boolean }>;
		/** `app-get` fails for it. */
		unread?: boolean;
	}>
): Kernel {
	return {
		call: async (name: string, input?: { instance?: string }) =>
			name === 'app-get' && apps.find((app) => app.instance === input?.instance)?.unread
				? { success: false, error: { code: 'X', message: 'x', suggestion: 'x' } }
				: name === 'app-list'
					? {
							success: true,
							data: {
								apps: apps.map(({ instance, title, kind, state }) => ({
									instance,
									app: instance,
									title,
									kind: kind ?? 'native',
									state: state ?? 'ready',
								})),
							},
						}
					: {
							success: true,
							data: { gates: apps.find((app) => app.instance === input?.instance)?.gates ?? {} },
						},
		appPort: (instance: string) => ({
			manifest: { ui: { account: apps.find((app) => app.instance === instance)?.account ?? [] } },
		}),
	} as unknown as Kernel;
}

describe('P3-E14: an app’s account section, its tabs', () => {
	const section = (id: string, surface = 'main') => ({ id, title: 'Greetings', surface });

	it('names each by its app, never as the shell, and a twin by its instance', async () => {
		const tabs = await appTabs(
			kernelOf([
				{ instance: 'hello', title: 'Hello', account: [section('greetings')] },
				{ instance: 'hello-2', title: 'Hello', account: [section('greetings')] },
				{ instance: 'sneaky', title: 'Loam', account: [section('passkeys')] },
			])
		);
		expect(tabs.map(({ key, app }) => [key, app])).toEqual([
			['hello/greetings', 'Hello (hello)'],
			['hello-2/greetings', 'Hello (hello-2)'],
			['sneaky/passkeys', 'sneaky'],
		]);
	});

	it('lists no tab for an app that is not ready or is mounted, nor one whose surface’s gate is closed', async () => {
		const tabs = await appTabs(
			kernelOf([
				{ instance: 'a', title: 'A', state: 'failed', account: [section('x')] },
				{ instance: 'b', title: 'B', state: 'gated', account: [section('x')] },
				{ instance: 'c', title: 'C', kind: 'mounted', account: [section('x')] },
				{
					instance: 'd',
					title: 'D',
					account: [section('open'), section('shut', 'inspector')],
					gates: { inspector: { open: false } },
				},
				{ instance: 'e', title: 'E', account: [section('x')], unread: true },
			])
		);
		// `e`'s gates could not be read: its tabs fail closed.
		expect(tabs.map(({ key }) => key)).toEqual(['d/open']);
	});
});
