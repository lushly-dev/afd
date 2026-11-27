/**
 * Phase 4's step 7, R9 and the third round's Opus 4: stage B failing after the late load, with the person's overrides
 * unreadable, applies the reserved chords with no overrides (D66), as the late load's own failure does
 * (`keybindings-late-failure.test.ts`).
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { ManifestV3, ProjectionV3 } from '@lushly-dev/loam-manifest';
import { defineApp, success } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKernel } from './kernel.js';
import { createFixedEnvironment, createFixturePorts } from './testing.js';

/** Run as stage B fails, before the failure: the positive control that the override was read (the fifth round's 2). */
const failing = vi.hoisted(() => ({
	before: undefined as
		| ((deps: {
				keybindings?: { list(active: null): Array<{ chord: string }>; refused(): number };
		  }) => void)
		| undefined,
}));

vi.mock('./identity/session-settle.js', async (importOriginal) => {
	const real = (await importOriginal()) as Record<string, unknown> & {
		createSessionSettle: (...args: unknown[]) => Record<string, unknown>;
	};
	return {
		...real,
		createSessionSettle: (...args: unknown[]) => ({
			...real.createSessionSettle(...args),
			begin: async () => {
				failing.before?.(args[0] as never);
				throw new Error('Stage B failed');
			},
		}),
	};
});

const NO_INPUT = { type: 'object', properties: {}, additionalProperties: false };

/** An app with a binding that always holds and one under a `when` (the sixth round's 3). */
const KEYS = {
	manifest_version: 2,
	protocol: 1,
	plugin: {
		id: 'keys',
		title: 'Keys',
		version: '1.0.0',
		description: 'A keybindings fixture.',
		kind: 'native',
		domains: ['keys'],
	},
	native: { entry: 'dist/native.js' },
	app: { scope_levels: ['workspace', 'project'] },
	commands: [
		{
			name: 'keys-hello',
			title: 'Say hello',
			description: 'Say hello.',
			effects: ['inspect'],
			input_schema: NO_INPUT,
		},
		{
			name: 'keys-board',
			title: 'Show the board',
			description: 'Show the board.',
			effects: ['inspect'],
			input_schema: NO_INPUT,
		},
	],
	ui: {
		surfaces: {
			main: { element: 'keys-main' },
			keybindings: [
				{ chord: 'Mod+Shift+H', command: 'keys-hello' },
				{ chord: 'Mod+Shift+B', command: 'keys-board', when: 'project' },
			],
		},
	},
} as unknown as ManifestV3;
const KEYS_DEFINITION = defineApp({
	sdk: 1,
	handlers: {
		'keys-hello': (async () => success({ hello: true })) as never,
		'keys-board': (async () => success({ board: true })) as never,
	},
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
						// One a rule refuses beside it: `refused` would count it, were the failure's defaults not first.
						value: [
							{ command: 'palette-open', keys: 'Mod+Shift+K' },
							{ command: 'shell-focus-next', keys: 'Mod+J' },
						],
						updatedAt: 1,
						updatedBy: 'local',
					},
				},
			},
		});
		// The positive control: the person's override was read and in force just before stage B failed, which a
		// deployment's kernel reaches inside `createKernel`.
		let before: string[] = [];
		let refusedBefore: number | undefined;
		failing.before = (deps) => {
			before = deps.keybindings?.list(null).map(({ chord }) => chord) ?? [];
			refusedBefore = deps.keybindings?.refused();
		};
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			deployment: {
				deployment_version: 2,
				generation: 'keys',
				workspace: { id: 'personal', name: 'Personal' },
				sandbox_origin: null,
				apps: [{ instance: 'keys', app: 'keys', package: 'fixtures/keys/' }],
			} as ProjectionV3,
			ports: createFixturePorts({
				'fixtures/keys/': { manifest: KEYS, definition: KEYS_DEFINITION },
			}) as never,
		});
		await kernel.startApps().catch(() => undefined);
		failing.before = undefined;
		expect(before).toContain('Mod+Shift+K');
		// The F6 rebind was read and refused before the failure (the seventh round's 4).
		expect(refusedBefore).toBe(1);
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
		// What the palette host gives each row (`palette-host.ts`); the row's template shows no keys.
		const hint = (command: string) =>
			kernel.listCommands().find(({ name }) => name === command)?.keybinding;
		expect(hint('palette-open')).toBe('Mod+K');
		// An app's binding under a `when` neither dispatches nor shows; one with none does (the sixth round's 3).
		expect((await kernel.call('app-open', { instance: 'keys' })).error).toBeUndefined();
		const open = kernel.listKeybindings().map(({ chord }) => chord);
		expect(open).toContain('Mod+Shift+H');
		expect(open).not.toContain('Mod+Shift+B');
		expect(hint('keys-hello')).toBe('Mod+Shift+H');
		expect(hint('keys-board')).toBeUndefined();
		await kernel.dispose();
	});
});
