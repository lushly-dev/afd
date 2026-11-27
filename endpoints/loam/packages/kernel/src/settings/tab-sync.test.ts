/**
 * Cross-tab sync (#2108): when one tab writes `loam.limits`, `loam.keybindings.overrides`, or experiment enablements
 * to the shared store, another tab in the same workspace hears the hint on `BroadcastChannel` (or `localStorage`
 * fallback) and re-reads its own store without carrying values in the message.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1, ManifestV3 } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernelParts } from '../kernel.js';
import type { MembershipV1 } from '../scope/access.js';
import { createScopedWorkspace } from '../scope/fixtures.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	createSteppingClock,
	probeDeployment,
} from '../testing.js';
import { PROBE_DOCUMENTS_DEFINITION, PROBE_DOCUMENTS_MANIFEST } from '../testing-documents.js';
import type { KernelEvent, LoamKernel } from '../types.js';
import { NOTIFICATION_TABLE } from './notifications.js';
import {
	createTabSync,
	parseTabSyncMessage,
	TAB_SYNC_CHANNEL,
	TAB_SYNC_STORAGE_KEY,
	wireTabSync,
} from './tab-sync.js';

const kernels: LoamKernel[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

describe('tab-sync unit (#2108)', () => {
	it('parses valid messages and drops malformed payloads', () => {
		expect(parseTabSyncMessage({ kind: 'limits', workspace: 'personal' })).toEqual({
			kind: 'limits',
			workspace: 'personal',
		});
		expect(
			parseTabSyncMessage({ kind: 'keybindings', workspace: 'personal', person: 'bea' })
		).toEqual({
			kind: 'keybindings',
			workspace: 'personal',
			person: 'bea',
		});
		for (const bad of [
			null,
			undefined,
			'limits',
			[],
			{ kind: 'other', workspace: 'personal' },
			{ kind: 'limits', workspace: '' },
			{ kind: 'limits', workspace: 123 },
			{ kind: 'experiments', workspace: 'personal', person: 42 },
		]) {
			expect(parseTabSyncMessage(bad)).toBeUndefined();
		}
	});

	it('delivers hints across tabs via BroadcastChannel, filtering by workspace and provider person', async () => {
		const aGot: string[] = [];
		const bGot: string[] = [];
		const otherWorkspaceGot: string[] = [];
		const otherPersonGot: string[] = [];
		const channelName = `${TAB_SYNC_CHANNEL}-unit-${Math.random().toString(36).slice(2)}`;

		const tabA = createTabSync({
			workspace: 'w1',
			provider: true,
			person: () => 'bea',
			onMessage: (kind) => aGot.push(kind),
			channelName,
		});
		const tabB = createTabSync({
			workspace: 'w1',
			provider: true,
			person: () => 'bea',
			onMessage: (kind) => bGot.push(kind),
			channelName,
		});
		const tabOtherWs = createTabSync({
			workspace: 'w2',
			provider: true,
			person: () => 'bea',
			onMessage: (kind) => otherWorkspaceGot.push(kind),
			channelName,
		});
		const tabOlu = createTabSync({
			workspace: 'w1',
			provider: true,
			person: () => 'olu',
			onMessage: (kind) => otherPersonGot.push(kind),
			channelName,
		});

		try {
			tabA.notify('limits');
			tabA.notify('keybindings', 'bea');
			tabA.notify('experiments', 'bea');
			tabA.notify('experiments'); // workspace-wide reaches both Bea and Olu in w1

			await expect
				.poll(() => bGot)
				.toEqual(['limits', 'keybindings', 'experiments', 'experiments']);
			await expect.poll(() => otherPersonGot).toEqual(['limits', 'experiments']);
			expect(aGot).toEqual([]);
			expect(otherWorkspaceGot).toEqual([]);
		} finally {
			tabA.stop();
			tabB.stop();
			tabOtherWs.stop();
			tabOlu.stop();
		}
	});

	it('falls back to localStorage storage events when BroadcastChannel is unavailable and cleans up on stop', () => {
		const origBC = globalThis.BroadcastChannel;
		const origStorage = (globalThis as Record<string, unknown>).localStorage;
		const origWindow = (globalThis as Record<string, unknown>).window;

		const listeners = new Set<(event: { key?: string | null; newValue?: string | null }) => void>();
		const storeMap = new Map<string, string>();
		const fakeStorage = {
			setItem(key: string, value: string) {
				storeMap.set(key, value);
				for (const listener of [...listeners]) listener({ key, newValue: value });
			},
			removeItem(key: string) {
				storeMap.delete(key);
			},
		};
		const fakeWindow = {
			addEventListener(
				type: string,
				listener: (event: { key?: string | null; newValue?: string | null }) => void
			) {
				if (type === 'storage') listeners.add(listener);
			},
			removeEventListener(
				type: string,
				listener: (event: { key?: string | null; newValue?: string | null }) => void
			) {
				if (type === 'storage') listeners.delete(listener);
			},
		};

		try {
			(globalThis as Record<string, unknown>).BroadcastChannel = undefined;
			(globalThis as Record<string, unknown>).localStorage = fakeStorage;
			(globalThis as Record<string, unknown>).window = fakeWindow;

			const got: string[] = [];
			const receiver = createTabSync({
				workspace: 'personal',
				provider: false,
				person: () => 'local',
				onMessage: (kind) => got.push(kind),
			});
			const sender = createTabSync({
				workspace: 'personal',
				provider: false,
				person: () => 'local',
				onMessage: () => {},
			});
			expect(listeners.size).toBe(2);

			sender.notify('limits');
			// Malformed storage entry is ignored.
			for (const listener of listeners) listener({ key: TAB_SYNC_STORAGE_KEY, newValue: '{bad' });
			expect(got).toEqual(['limits']);

			receiver.stop();
			sender.stop();
			expect(listeners.size).toBe(0);
			sender.notify('keybindings');
			expect(got).toEqual(['limits']);
		} finally {
			(globalThis as Record<string, unknown>).BroadcastChannel = origBC;
			(globalThis as Record<string, unknown>).localStorage = origStorage;
			(globalThis as Record<string, unknown>).window = origWindow;
		}
	});

	it('receives localStorage fallback hints even when receiver opened BroadcastChannel (#2108)', () => {
		const origBC = globalThis.BroadcastChannel;
		const origStorage = (globalThis as Record<string, unknown>).localStorage;
		const origWindow = (globalThis as Record<string, unknown>).window;

		const listeners = new Set<(event: { key?: string | null; newValue?: string | null }) => void>();
		const fakeStorage = {
			setItem(key: string, value: string) {
				for (const listener of [...listeners]) listener({ key, newValue: value });
			},
			removeItem() {},
		};
		const fakeWindow = {
			addEventListener(
				type: string,
				listener: (event: { key?: string | null; newValue?: string | null }) => void
			) {
				if (type === 'storage') listeners.add(listener);
			},
			removeEventListener(
				type: string,
				listener: (event: { key?: string | null; newValue?: string | null }) => void
			) {
				if (type === 'storage') listeners.delete(listener);
			},
		};
		let throwOnPost = false;
		class FlakyBroadcastChannel {
			onmessage: ((event: MessageEvent) => void) | null = null;
			postMessage() {
				if (throwOnPost) throw new Error('postMessage unavailable');
			}
			close() {}
		}

		try {
			(globalThis as Record<string, unknown>).BroadcastChannel = FlakyBroadcastChannel;
			(globalThis as Record<string, unknown>).localStorage = fakeStorage;
			(globalThis as Record<string, unknown>).window = fakeWindow;

			const got: string[] = [];
			const receiver = createTabSync({
				workspace: 'personal',
				provider: false,
				person: () => 'local',
				onMessage: (kind) => got.push(kind),
			});
			const sender = createTabSync({
				workspace: 'personal',
				provider: false,
				person: () => 'local',
				onMessage: () => {},
			});
			throwOnPost = true;
			sender.notify('experiments');
			expect(got).toEqual(['experiments']);
			receiver.stop();
			sender.stop();
		} finally {
			(globalThis as Record<string, unknown>).BroadcastChannel = origBC;
			(globalThis as Record<string, unknown>).localStorage = origStorage;
			(globalThis as Record<string, unknown>).window = origWindow;
		}
	});

	it('suppresses incoming hints in wireTabSync until ready() returns true (#2108)', async () => {
		let isReady = false;
		let readCount = 0;
		const receiver = wireTabSync({
			workspace: 'personal',
			provider: false,
			person: () => 'local',
			ready: () => isReady,
			readLimits: async () => {
				readCount += 1;
				return true;
			},
			readOverrides: async () => false,
			refreshExperiments: async () => false,
		});
		const sender = createTabSync({
			workspace: 'personal',
			provider: false,
			person: () => 'local',
			onMessage: () => {},
		});
		try {
			sender.notify('limits');
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(readCount).toBe(0);
			isReady = true;
			sender.notify('limits');
			await expect.poll(() => readCount).toBe(1);
		} finally {
			receiver.stop();
			sender.stop();
		}
	});
});

describe('cross-tab kernel sync integration (#2108)', () => {
	function gatedManifest(): ManifestV3 {
		return {
			...PROBE_DOCUMENTS_MANIFEST,
			app: { ...PROBE_DOCUMENTS_MANIFEST.app, requires_experiment: 'probe.beta' },
			commands: (PROBE_DOCUMENTS_MANIFEST.commands as Array<{ name: string }>).map((each) =>
				each.name === 'probe-content-set' ? { ...each, confirm_prompt: 'Replace the text?' } : each
			),
			ui: {
				...PROBE_DOCUMENTS_MANIFEST.ui,
				experiments: [
					{
						id: 'beta',
						title: 'Probe beta',
						changes: 'Shows Probe.',
						ends: '2027-06-01',
						stage: 'visible',
					},
				],
			},
		} as unknown as ManifestV3;
	}

	async function bootTwoTabs(store: MemoryAdapter, manifest = gatedManifest()) {
		const make = async () => {
			const clock = createSteppingClock();
			const workspace = await createScopedWorkspace({
				store,
				clock,
				deployment: probeDeployment([{ instance: 'probe', app: 'probe', package: 'apps/probe/' }]),
				ports: createFixturePorts({
					'apps/probe/': { manifest, definition: PROBE_DOCUMENTS_DEFINITION },
				}),
			});
			kernels.push(workspace.kernel);
			return workspace;
		};
		const tabA = await make();
		const tabB = await make();
		return { tabA, tabB };
	}

	it('syncs loam.limits writes from tab A into tab B', async () => {
		const store = new MemoryAdapter();
		const makeParts = async () => {
			const parts = await createKernelParts({
				store,
				storeKind: 'memory',
				journal: new MemoryJournalSink(),
				auth: new MockAuthAdapter(),
				environment: createFixedEnvironment(),
				host: 'test',
				clock: createSteppingClock(),
			});
			kernels.push(parts.kernel);
			return parts;
		};
		const tabA = await makeParts();
		const tabB = await makeParts();
		const eventsB: KernelEvent[] = [];
		tabB.kernel.subscribe((event) => eventsB.push(event));

		const before = tabB.limits.values().callsPerSecond;
		const nextVal = before === 50 ? 80 : 50;
		const set = await tabA.kernel.call('setting-set', {
			section: 'loam.limits',
			key: 'callsPerSecond',
			value: nextVal,
			level: 'workspace',
		});
		expect(set.success, JSON.stringify(set.error)).toBe(true);

		await expect.poll(() => tabB.limits.values().callsPerSecond).toBe(nextVal);
		expect(eventsB.some((e) => e.settings?.includes('loam.limits'))).toBe(true);
	});

	it('syncs loam.keybindings.overrides writes from tab A into tab B', async () => {
		const store = new MemoryAdapter();
		const { tabA, tabB } = await bootTwoTabs(store);
		const eventsB: KernelEvent[] = [];
		tabB.kernel.subscribe((event) => eventsB.push(event));

		const set = await tabA.kernel.call('setting-set', {
			section: 'loam.keybindings',
			key: 'overrides',
			value: [{ command: 'app-list', keys: 'Mod+Shift+L' }],
			level: 'person',
		});
		expect(set.success, JSON.stringify(set.error)).toBe(true);

		await expect
			.poll(() =>
				tabB.kernel
					.listKeybindings()
					.some((row) => row.command === 'app-list' && row.chord === 'Mod+Shift+L')
			)
			.toBe(true);
		expect(eventsB.some((e) => e.settings?.includes('loam.keybindings'))).toBe(true);
	});

	it('syncs experiment enable/disable from tab A into tab B and respects R14 dirty tabs', async () => {
		const store = new MemoryAdapter();
		const { tabA, tabB } = await bootTwoTabs(store);
		const eventsB: KernelEvent[] = [];
		tabB.kernel.subscribe((event) => eventsB.push(event));

		const stateOf = async (kernel: LoamKernel) =>
			(
				(await kernel.call<{ apps: Array<{ instance: string; state: string }> }>('app-list')).data
					?.apps ?? []
			).find((app) => app.instance === 'probe')?.state;

		expect(await stateOf(tabB.kernel)).toBe('gated');

		// Tab A enables probe.beta -> Tab B ungates probe and emits experiments: true.
		const enabled = await tabA.kernel.call('experiment-enable', {
			experiment: 'probe.beta',
			audience: 'workspace',
		});
		expect(enabled.success, JSON.stringify(enabled.error)).toBe(true);

		await expect.poll(() => stateOf(tabB.kernel)).toBe('ready');
		expect(eventsB.some((e) => e.experiments === true)).toBe(true);

		// Open a dirty tab for probe in Tab B, then disable probe.beta in Tab A -> Tab B defers unload (R14).
		const created = await tabB.kernel.call<{ id: string }>('document-create', { type: 'probe' });
		const document = (created.data as { id: string }).id;
		expect((await tabB.kernel.call('document-open', { document })).success).toBe(true);
		expect((await tabB.kernel.call('editor-dirty-set', { tab: 't1', dirty: true })).success).toBe(
			true
		);

		const disabled = await tabA.kernel.call('experiment-disable', {
			experiment: 'probe.beta',
			audience: 'workspace',
		});
		expect(disabled.success, JSON.stringify(disabled.error)).toBe(true);

		// Give BroadcastChannel time to deliver, then verify Tab B stayed ready while dirty.
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(await stateOf(tabB.kernel)).toBe('ready');

		// Once Tab B saves/clears dirty, R14 completes the unload.
		expect((await tabB.kernel.call('editor-dirty-set', { tab: 't1', dirty: false })).success).toBe(
			true
		);
		expect(await stateOf(tabB.kernel)).toBe('gated');
	});

	it('emits experiments: true on workspace enablement even when person already opted in, and syncs setting-reset + dispose', async () => {
		const store = new MemoryAdapter();
		const { tabA, tabB } = await bootTwoTabs(store);

		// Person enables probe.beta personally in Tab B first.
		expect(
			(
				await tabB.kernel.call('experiment-enable', {
					experiment: 'probe.beta',
					audience: 'person',
				})
			).success
		).toBe(true);
		// Wait for any initial broadcast to settle, then record new events on Tab B.
		await new Promise((resolve) => setTimeout(resolve, 20));
		const eventsB: KernelEvent[] = [];
		tabB.kernel.subscribe((event) => eventsB.push(event));

		// Tab A enables probe.beta for the workspace: effective `on` stays true, but `workspace` flips false -> true!
		expect(
			(
				await tabA.kernel.call('experiment-enable', {
					experiment: 'probe.beta',
					audience: 'workspace',
				})
			).success
		).toBe(true);
		await expect.poll(() => eventsB.some((e) => e.experiments === true)).toBe(true);

		// Keybinding setting-set then setting-reset syncs into Tab B.
		expect(
			(
				await tabA.kernel.call('setting-set', {
					section: 'loam.keybindings',
					key: 'overrides',
					value: [{ command: 'app-list', keys: 'Mod+Shift+K' }],
					level: 'person',
				})
			).success
		).toBe(true);
		await expect
			.poll(() =>
				tabB.kernel
					.listKeybindings()
					.some((row) => row.command === 'app-list' && row.chord === 'Mod+Shift+K')
			)
			.toBe(true);
		expect(
			(
				await tabA.kernel.call('setting-reset', {
					section: 'loam.keybindings',
					key: 'overrides',
					level: 'person',
				})
			).success
		).toBe(true);
		await expect
			.poll(() =>
				tabB.kernel
					.listKeybindings()
					.some((row) => row.command === 'app-list' && row.chord === 'Mod+Shift+K')
			)
			.toBe(false);

		// After dispose(), Tab B no longer receives cross-tab events.
		await tabB.kernel.dispose();
		const countAfterDispose = eventsB.length;
		await tabA.kernel.call('experiment-disable', {
			experiment: 'probe.beta',
			audience: 'workspace',
		});
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(eventsB.length).toBe(countAfterDispose);
	});

	it('delivers R14 deferral notices and withdraws pending confirmations for another signed-in user in provider mode (#2108)', async () => {
		const store = new MemoryAdapter();
		const PROVIDER: IdentityV1 = {
			mode: 'provider',
			organization: 'acme',
			path: 'api/auth',
			methods: ['passkey', 'password'],
		};
		const OLU = 'mock-user-olu@example.com';
		const BEA = 'mock-user-bea@example.com';
		const membership = (): MembershipV1 => ({
			mode: 'provider',
			members: new Map([
				[OLU, 'owner'],
				[BEA, 'member'],
			]),
			digest: 'd1',
		});
		const manifest = gatedManifest();
		const makeTab = async (email: string) => {
			const ws = await createScopedWorkspace({
				store,
				clock: createSteppingClock(),
				identity: PROVIDER,
				membership: membership(),
				empty: true,
				deployment: {
					...probeDeployment([{ instance: 'probe', app: 'probe', package: 'apps/probe/' }]),
					workspace: { id: 'acme', name: 'Acme' },
				},
				ports: createFixturePorts({
					'apps/probe/': { manifest, definition: PROBE_DOCUMENTS_DEFINITION },
				}),
			});
			kernels.push(ws.kernel);
			await ws.kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });
			return ws;
		};

		const tabOlu = await makeTab('olu@example.com');
		const tabBea = await makeTab('bea@example.com');

		// Olu enables probe.beta for the workspace -> Bea's tab ungates probe.
		expect(
			(
				await tabOlu.kernel.call('experiment-enable', {
					experiment: 'probe.beta',
					audience: 'workspace',
				})
			).success
		).toBe(true);
		const stateOf = async (kernel: LoamKernel) =>
			(
				(await kernel.call<{ apps: Array<{ instance: string; state: string }> }>('app-list')).data
					?.apps ?? []
			).find((app) => app.instance === 'probe')?.state;
		await expect.poll(() => stateOf(tabBea.kernel)).toBe('ready');

		// Scenario 1: Bea has a pending confirmation on a clean tab; Olu disables workspace experiment -> Bea's confirmation is withdrawn!
		const doc1 = (await tabBea.kernel.call<{ id: string }>('document-create', { type: 'probe' }))
			.data?.id as string;
		const asked = await tabBea.kernel.agent.call('probe-content-set', {
			document: doc1,
			text: 'hello',
		});
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		const notification = (asked.error?.details as { notification?: string } | undefined)
			?.notification;

		expect(
			(
				await tabOlu.kernel.call('experiment-disable', {
					experiment: 'probe.beta',
					audience: 'workspace',
				})
			).success
		).toBe(true);
		await expect.poll(() => stateOf(tabBea.kernel)).toBe('gated');
		await expect
			.poll(
				async () =>
					(
						await tabBea.kernel.agent.call<{ state: string }>('confirmation-get', {
							notification,
						})
					).data?.state
			)
			.toBe('withdrawn');

		// Scenario 2: Olu re-enables, Bea opens a dirty tab, Olu disables -> Bea stays ready and receives the R14 deferral notice!
		expect(
			(
				await tabOlu.kernel.call('experiment-enable', {
					experiment: 'probe.beta',
					audience: 'workspace',
				})
			).success
		).toBe(true);
		await expect.poll(() => stateOf(tabBea.kernel)).toBe('ready');
		expect((await tabBea.kernel.call('document-open', { document: doc1 })).success).toBe(true);
		expect((await tabBea.kernel.call('editor-dirty-set', { tab: 't1', dirty: true })).success).toBe(
			true
		);

		expect(
			(
				await tabOlu.kernel.call('experiment-disable', {
					experiment: 'probe.beta',
					audience: 'workspace',
				})
			).success
		).toBe(true);
		await expect
			.poll(async () =>
				(
					await store.list<{ person: string; title: string; source: string }>(NOTIFICATION_TABLE)
				).data
					.filter((row) => row.person === BEA && row.source === 'shell')
					.map((row) => row.title)
			)
			.toContain('Probe stays open until your changes are saved');
		expect(await stateOf(tabBea.kernel)).toBe('ready');

		// Scenario 3: Stale in-flight cross-tab refresh across a provider person switch does not clobber the new person's gates.
		expect(
			(await tabBea.kernel.call('editor-dirty-set', { tab: 't1', dirty: false })).success
		).toBe(true);
		expect(
			(
				await tabBea.kernel.call('experiment-enable', {
					experiment: 'probe.beta',
					audience: 'person',
				})
			).success
		).toBe(true);
		expect(await stateOf(tabBea.kernel)).toBe('ready');

		let holdList = false;
		let listHeld!: () => void;
		const hitHold = new Promise<void>((resolve) => {
			listHeld = resolve;
		});
		let releaseList!: () => void;
		const canResume = new Promise<void>((resolve) => {
			releaseList = resolve;
		});
		const origList = store.list.bind(store);
		store.list = (async <T>(table: string, filter?: Parameters<MemoryAdapter['list']>[1]) => {
			if (holdList && table === 'experiment-enablement') {
				holdList = false;
				listHeld();
				await canResume;
			}
			return origList<T>(table, filter);
		}) as typeof store.list;

		holdList = true;
		const ping = createTabSync({
			workspace: 'acme',
			provider: true,
			person: () => BEA,
			onMessage: () => {},
		});
		ping.notify('experiments', BEA);
		await hitHold;
		ping.stop();

		const signingOut = tabBea.kernel.call('auth-sign-out');
		await new Promise((resolve) => setTimeout(resolve, 15));
		releaseList();
		await signingOut;
		await tabBea.kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'olu@example.com',
			password: 'x',
		});
		expect(await stateOf(tabBea.kernel)).toBe('gated');
		store.list = origList;
	});
});
