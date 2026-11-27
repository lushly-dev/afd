/**
 * `experimentHost`'s unload (phase 4 specification, 5.3, R14): closing the active app notes that main moved, unless the
 * call that unloads it already noted its own move (phase 5's 9.3).
 */

import { describe, expect, it, vi } from 'vitest';
import type { ScopeSeen } from '../scope/runtime.js';
import { type ExperimentHostDeps, experimentHost } from './experiment-host.js';

const hostOver = (seen: Map<string, ScopeSeen>) => {
	const close = vi.fn();
	const note = vi.fn((traceId: string | undefined, extra: ScopeSeen) => {
		const held = seen.get(traceId as string);
		if (held) Object.assign(held, extra);
	});
	const deps = {
		apps: () => ({ close }),
		overlays: { list: () => [] },
		state: { activeApp: () => 'probe' },
		closeTabs: async () => ({ dirty: false }),
		confirmations: { withdraw: async () => 0 },
		scope: { seen, note },
	} as unknown as ExperimentHostDeps;
	return { host: experimentHost(deps), close, note };
};

describe('experimentHost: an unload that closes the active app', () => {
	it('notes main moved, as a replace, on a call that noted no move', async () => {
		const seen = new Map<string, ScopeSeen>([['t-1', {}]]);
		const { host, close } = hostOver(seen);
		expect(await host.unload('probe', { traceId: 't-1' })).toBe(true);
		expect(close).toHaveBeenCalledOnce();
		expect(seen.get('t-1')?.mainChanged).toBe('replace');
	});

	it('keeps the push of a call that already moved main, as editor-close does when its settle unloads', async () => {
		const seen = new Map<string, ScopeSeen>([['t-2', { mainChanged: 'push' }]]);
		const { host, note } = hostOver(seen);
		await host.unload('probe', { traceId: 't-2' });
		expect(seen.get('t-2')?.mainChanged).toBe('push');
		expect(note).not.toHaveBeenCalled();
	});
});
