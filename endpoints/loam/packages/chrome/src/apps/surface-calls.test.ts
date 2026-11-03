import { createScopedWorkspace } from '@lushly-dev/loam-kernel/testing';
import { describe, expect, it, vi } from 'vitest';
import { surfaceCalls } from './surface-calls.js';

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
