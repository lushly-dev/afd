/**
 * P6-E5's last clause (phase 6 specification, 8.1; step 6's deviation 2): `refreshSession()` is called by both the
 * relay's and the transport's `401`, through what `main.ts` hands each, the one provider's refresh.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionRefresh } from './session-refresh.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

const unauthorized = (marked: boolean) =>
	new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'x', suggestion: 'y' }), {
		status: 401,
		headers: {
			'content-type': 'application/json',
			...(marked ? { 'loam-relay-refusal': '1' } : {}),
		},
	});

describe('P6-E5: one session refresh for the relay and the trust-record transport (8.1)', () => {
	it("P6-E5: `refreshSession()` is called by both the relay's and the transport's 401, the one provider's", async () => {
		const session = createSessionRefresh('https://shell.test/loam/');
		const provider = { refreshSession: vi.fn() };
		session.use(provider);
		const urls: string[] = [];
		vi.stubGlobal('fetch', async (url: unknown) => {
			urls.push(String(url));
			return unauthorized(String(url).includes('/mounts/'));
		});
		// The relay's own 401, through the mount chunk stage B's reader loads.
		const { createMountTransport } = await session.mountChunk();
		await expect(
			createMountTransport('https://shell.test/loam/mounts/work/mcp').connect()
		).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		expect(provider.refreshSession).toHaveBeenCalledTimes(1);
		// The transport's 401, through the port the kernel is given in a hosted deployment.
		const ports = session.identityPorts({ kept: true }, true);
		expect(ports.kept).toBe(true);
		if (!ports.serverCall) throw new Error('A hosted deployment has the transport port');
		const answer = await ports.serverCall({
			command: 'project-create',
			input: { name: 'Delta' },
			scope: { workspace: 'personal' },
		});
		expect(answer.result.error?.code).toBe('UNAUTHORIZED');
		expect(provider.refreshSession).toHaveBeenCalledTimes(2);
		expect(urls.at(-1)).toBe('https://shell.test/loam/api/kernel/call');
	});

	it('P6-E5: binds the refresh late: a transport made before the probe runs the provider given after it, and none before', async () => {
		// Late binding, which the wiring supports: a transport made before `use` runs whichever provider `use` gave last.
		const session = createSessionRefresh('https://shell.test/');
		vi.stubGlobal('fetch', async () => unauthorized(true));
		const { createMountTransport } = await session.mountChunk();
		const transport = createMountTransport('https://shell.test/mounts/work/mcp');
		const earlier = { refreshSession: vi.fn() };
		// With no provider yet (a `local` deployment has none), the relay's 401 refreshes nothing, and is still its code.
		await expect(transport.connect()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		session.use(earlier);
		await expect(transport.connect()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		expect(earlier.refreshSession).toHaveBeenCalledTimes(1);
		// The provider given last is the one both paths run.
		const later = { refreshSession: vi.fn() };
		session.use(later);
		await expect(transport.connect()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
		expect(earlier.refreshSession).toHaveBeenCalledTimes(1);
		expect(later.refreshSession).toHaveBeenCalledTimes(1);
	});

	it('P6-E5: gives the transport port only in a hosted deployment, the identity ports otherwise unchanged', () => {
		const session = createSessionRefresh('https://shell.test/');
		const ports = { kept: true };
		expect(session.identityPorts(ports, false)).toBe(ports);
		expect(session.identityPorts(ports, false).serverCall).toBeUndefined();
		expect(session.identityPorts(ports, true).serverCall).toEqual(expect.any(Function));
	});
});
