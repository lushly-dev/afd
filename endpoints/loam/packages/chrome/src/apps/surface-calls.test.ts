import { createScopedWorkspace } from '@lushly-dev/loam-kernel/testing';
import { describe, expect, it, vi } from 'vitest';
import {
	bindSurfaces,
	deliverEvents,
	deliverSettings,
	settingsHeard,
	surfaceCalls,
} from './surface-calls.js';

describe("P2-E7: a mount's context calls through its surface's port (3.6)", () => {
	it('sends navigate and overlays through the call it is given', async () => {
		const call = vi.fn(async () => ({ success: true as const, data: {} }));
		const calls = surfaceCalls({ instance: 'dual', waitOverlay: vi.fn() } as never, call as never);
		await calls.navigate?.('items/1');
		await calls.overlays.toast({ message: 'Hi' });
		await calls.client.call('dual-where');
		expect(call.mock.calls).toEqual([
			['app-route-set', { instance: 'dual', path: 'items/1' }],
			['toast-show', { message: 'Hi' }],
			['dual-where'],
		]);
	});

	it("refuses an embed's navigate and toast, as its client's mutations", async () => {
		const workspace = await createScopedWorkspace();
		try {
			const port = workspace.kernel.appPort('dual');
			await workspace.kernel.call('app-open', { instance: 'dual' });
			const embed = port.surface({ scope: { workspace: 'personal' }, readOnly: true });
			const calls = surfaceCalls(port, embed.call);
			await expect(calls.navigate?.('items/1')).rejects.toMatchObject({ code: 'EMBED_READ_ONLY' });
			expect((await calls.overlays.toast({ message: 'Hi' })).error?.code).toBe('EMBED_READ_ONLY');
			// The same port's own surface is not read-only.
			const own = surfaceCalls(port, port.surface({ scope: { workspace: 'personal' } }).call);
			await expect(own.navigate?.('items/1')).resolves.toBeUndefined();
		} finally {
			await workspace.kernel.dispose();
		}
	});
});

describe("P4-E1: phase 4's 3.8: an app's surfaces hear its own sections change", () => {
	const manifest = (grants: string[]) =>
		({
			plugin: { id: 'greet' },
			grants: grants.map((name) => ({ name, reason: 'r' })),
			ui: { settings: [{ id: 'general' }, { id: 'project' }] },
		}) as never;

	it('hears only its own sections, by full id, and only with the settings grant', () => {
		const changed = ['loam.appearance', 'greet.general', 'other.prefs', 'greetx.general'];
		expect(settingsHeard(manifest(['settings']), changed)).toEqual(['greet.general']);
		expect(settingsHeard(manifest(['store']), changed)).toEqual([]);
		expect(settingsHeard(undefined, changed)).toEqual([]);
	});

	it('tells each native mount and view frame, a surface that throws stopping none, and copies the list', () => {
		const native = { settingsChanged: vi.fn() };
		const view = { settingsChanged: vi.fn() };
		const thrower = {
			settingsChanged: vi.fn(() => {
				throw new Error('app code');
			}),
		};
		const reported = vi.fn();
		vi.stubGlobal('reportError', reported);
		const sections = ['greet.general'];
		const told = deliverSettings([thrower, native, { other: true }, view], sections);
		vi.unstubAllGlobals();
		expect(told).toBe(2);
		expect(native.settingsChanged).toHaveBeenCalledWith(['greet.general']);
		expect(view.settingsChanged).toHaveBeenCalledWith(['greet.general']);
		expect(reported).toHaveBeenCalledTimes(1);
		const handed = native.settingsChanged.mock.calls[0]?.[0] as unknown as string[];
		handed.push('mutated');
		expect(sections).toEqual(['greet.general']);
		expect(deliverSettings([native], [])).toBe(0);
	});
});

describe("P5-B2: an app's events through its surfaces (phase 5 specification, 9.2)", () => {
	it('P5-B2: gives context.events only with the events grant, over the surface’s own call', async () => {
		const call = vi.fn(async () => ({
			success: true as const,
			data: { events: [], cursor: 'v1.0', hasMore: false },
		}));
		const manifest = (grants: string[]) =>
			({ plugin: { id: 'watch' }, grants: grants.map((name) => ({ name, reason: 'r' })) }) as never;
		const none = surfaceCalls(
			{ instance: 'watch', manifest: manifest([]) } as never,
			call as never
		);
		expect(none.events).toBeUndefined();
		const granted = surfaceCalls(
			{ instance: 'watch', manifest: manifest(['events']) } as never,
			call as never
		);
		await expect(granted.events?.list({ since: 'v1.0' })).resolves.toEqual({
			events: [],
			cursor: 'v1.0',
			hasMore: false,
		});
		expect(call.mock.calls).toEqual([['event-list', { since: 'v1.0' }]]);
		const refused = vi.fn(async () => ({
			success: false as const,
			error: { code: 'EVENT_CURSOR_EXPIRED', message: 'm', suggestion: 's' },
		}));
		const expired = surfaceCalls(
			{ instance: 'watch', manifest: manifest(['events']) } as never,
			refused as never
		);
		await expect(expired.events?.list({ since: 'v1.1' })).rejects.toMatchObject({
			code: 'EVENT_CURSOR_EXPIRED',
		});
	});

	it('P5-B2: listens for the bus in the scope the surfaces are bound to, a workspace-only app’s the workspace', () => {
		const levels = (scope_levels: string[]) => {
			const stop = vi.fn();
			const onBusEvent = vi.fn(() => stop);
			return { port: { manifest: { app: { scope_levels } }, onBusEvent }, onBusEvent, stop };
		};
		const wake = vi.fn();
		const inProject = levels(['workspace', 'project']);
		const bound = bindSurfaces(inProject.port as never, { workspace: 'w', project: 'p' }, wake);
		expect(bound.scope).toEqual({ workspace: 'w', project: 'p' });
		expect(inProject.onBusEvent).toHaveBeenCalledExactlyOnceWith(wake, {
			workspace: 'w',
			project: 'p',
		});
		bound.stop();
		expect(inProject.stop).toHaveBeenCalledOnce();
		// A workspace-only app's surfaces, and their bus, are the workspace's: it learns no project (4.3).
		const workspaceOnly = levels(['workspace']);
		expect(
			bindSurfaces(workspaceOnly.port as never, { workspace: 'w', project: 'p' }, wake).scope
		).toEqual({
			workspace: 'w',
		});
		expect(workspaceOnly.onBusEvent).toHaveBeenCalledExactlyOnceWith(wake, { workspace: 'w' });
	});

	it('P5-B2: wakes each surface that listens with its own copy of the hint, one that throws stopping none', () => {
		const heard: unknown[] = [];
		const hint = { kinds: ['mount-mutated' as const], instances: ['mail'], cursor: 'v1.3' };
		const thrower = {
			eventsChanged() {
				throw new Error('boom');
			},
		};
		const native = { eventsChanged: (given: unknown) => heard.push(given) };
		const reportError = vi.fn();
		vi.stubGlobal('reportError', reportError);
		try {
			expect(deliverEvents([thrower, native, { other: true }], hint)).toBe(1);
		} finally {
			vi.unstubAllGlobals();
		}
		expect(heard).toEqual([hint]);
		expect(heard[0]).not.toBe(hint);
		expect(reportError).toHaveBeenCalledOnce();
	});
});
