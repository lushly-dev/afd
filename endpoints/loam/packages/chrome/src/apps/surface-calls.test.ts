import { createScopedWorkspace } from '@lushly-dev/loam-kernel/testing';
import { describe, expect, it, vi } from 'vitest';
import { deliverSettings, settingsHeard, surfaceCalls } from './surface-calls.js';

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

describe("phase 4's 3.8: an app's surfaces hear its own sections change", () => {
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
