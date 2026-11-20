/**
 * Phase 4's step 7, R9 and the third round's Opus 4: stage B failing after the late load, with the person's overrides
 * unreadable, applies the reserved chords with no overrides (D66), as the late load's own failure does
 * (`keybindings-late-failure.test.ts`).
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKernel } from './kernel.js';
import { createFixedEnvironment } from './testing.js';

/** Run as stage B fails, before the failure: the positive control that the override was read (the fifth round's 2). */
const failing = vi.hoisted(() => ({ before: undefined as (() => void) | undefined }));

vi.mock('./late/session-settle.js', async (importOriginal) => {
	const real = (await importOriginal()) as Record<string, unknown> & {
		createSessionSettle: (...args: unknown[]) => Record<string, unknown>;
	};
	return {
		...real,
		createSessionSettle: (...args: unknown[]) => ({
			...real.createSessionSettle(...args),
			begin: async () => {
				failing.before?.();
				throw new Error('Stage B failed');
			},
		}),
	};
});

/** A store whose reads of the person's settings record fail. */
class FailingStore extends MemoryAdapter {
	override async get<T>(table: string, id: string): Promise<T | null> {
		if (table === 'settings' && id.startsWith('loam.settings')) throw new Error('the store failed');
		return super.get<T>(table, id);
	}
}

describe('the keybindings with stage B failed (R9)', () => {
	beforeEach(() => vi.stubGlobal('reportError', vi.fn()));
	afterEach(() => vi.unstubAllGlobals());

	it('dispatches the reserved chords with no overrides', async () => {
		const kernel = await createKernel({
			store: new FailingStore(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: { generation: 'empty', workspace: { id: 'personal', name: 'Personal' }, apps: [] },
		});
		// Stage B, as the web host starts it after first paint.
		await kernel.startApps().catch(() => undefined);
		await expect
			.poll(() => kernel.lateFailure?.code, { timeout: 5_000 })
			.toBe('LATE_COMMANDS_UNAVAILABLE');
		expect(kernel.listKeybindings().map(({ chord }) => chord)).toContain('Mod+K');
		await kernel.dispose();
	});

	it("applies the defaults, never the person's readable override (the fourth round's 2)", async () => {
		const store = new MemoryAdapter();
		await store.create('settings', {
			id: 'loam.settings',
			category: 'settings',
			value: {
				'personal/loam.keybindings': {
					overrides: {
						value: [{ command: 'palette-open', keys: 'Mod+Shift+K' }],
						updatedAt: 1,
						updatedBy: 'local',
					},
				},
			},
		});
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: { generation: 'empty', workspace: { id: 'personal', name: 'Personal' }, apps: [] },
		});
		// The positive control: the person's override was read and in force just before stage B failed.
		let before: string[] = [];
		failing.before = () => {
			before = kernel.listKeybindings().map(({ chord }) => chord);
		};
		await kernel.startApps().catch(() => undefined);
		failing.before = undefined;
		expect(before).toContain('Mod+Shift+K');
		await expect
			.poll(() => kernel.lateFailure?.code, { timeout: 5_000 })
			.toBe('LATE_COMMANDS_UNAVAILABLE');
		const chords = kernel.listKeybindings().map(({ chord }) => chord);
		expect(chords).toContain('Mod+K');
		expect(chords).not.toContain('Mod+Shift+K');
		// `keybinding-list` and the palette's hint follow the same defaults (the fifth round's 2).
		const listed = await kernel.call<{
			bindings: Array<{ keys: string; command: string; source: string; active: boolean }>;
			refused?: number;
		}>('keybinding-list', { command: 'palette-open', all: true });
		expect(listed.error).toBeUndefined();
		expect(
			listed.data?.bindings.filter(({ active }) => active).map(({ keys, source }) => [keys, source])
		).toEqual([['Mod+K', 'shell']]);
		expect(listed.data?.bindings.some(({ keys }) => keys === 'Mod+Shift+K')).toBe(false);
		expect(listed.data?.refused).toBeUndefined();
		expect(kernel.listCommands().find(({ name }) => name === 'palette-open')?.keybinding).toBe(
			'Mod+K'
		);
		await kernel.dispose();
	});
});
