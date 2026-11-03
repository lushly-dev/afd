import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { JournalEntry } from '@lushly-dev/afd-core';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { ManifestV1 } from '@lushly-dev/loam-manifest';
import type { OverlayRefV1, OverlayV1 } from '@lushly-dev/loam-sdk';
import { defineApp } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernel, createKernelParts } from '../kernel.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	createSteppingClock,
	createTestKernel,
	type FixturePackage,
	PROBE_MANIFEST,
	probeDefinition,
	probeDeployment,
} from '../testing.js';
import type { AppDetailV1, AppSummaryV1, LoamKernelV2 } from '../types.js';
import { packageFile } from './port.js';

const kernels: LoamKernelV2[] = [];
const WORKSPACE = { workspace: 'personal' };
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const sumsManifest: ManifestV1 = {
	...PROBE_MANIFEST,
	plugin: { ...PROBE_MANIFEST.plugin, id: 'sums', title: 'Sums', domains: ['sums'] },
	commands: [
		{
			name: 'sums-add',
			description: 'Adds to the count.',
			effects: ['plugin-state'],
			input_schema: {
				type: 'object',
				properties: { by: { type: 'number' } },
				required: ['by'],
				additionalProperties: false,
			},
		},
	],
	grants: [],
	config: undefined,
	ui: { surfaces: { main: { element: 'sums-main' } } },
} as ManifestV1;

const sumsDefinition = defineApp({
	sdk: 1,
	handlers: { 'sums-add': (async () => ({ success: true, data: {} })) as never },
});

const entry = (instance: string) => ({ instance, app: instance, package: `apps/${instance}/` });

async function boot(
	probe: FixturePackage = { manifest: PROBE_MANIFEST, definition: probeDefinition() }
) {
	const ports = createFixturePorts({
		'apps/probe/': probe,
		'apps/sums/': { manifest: sumsManifest, definition: sumsDefinition },
	});
	const { kernel, journal } = await createTestKernel({
		deployment: probeDeployment([{ ...entry('probe'), config: { greeting: 'hi' } }, entry('sums')]),
		ports,
		clock: createSteppingClock(),
	});
	kernels.push(kernel);
	return { kernel, journal, ports, probe: kernel.appPort('probe'), sums: kernel.appPort('sums') };
}

const last = async (journal: MemoryJournalSink): Promise<JournalEntry> =>
	(await journal.read()).at(-1) as JournalEntry;

describe('a call the port refuses (5.3, D68)', () => {
	it('gives the same refusal for valid input, invalid input and a name that does not exist', async () => {
		const { journal, probe } = await boot();
		const valid = await probe.call('sums-add', { by: 1 });
		const invalid = await probe.call('sums-add', { nope: true });
		const missing = await probe.call('sums-nothing');
		for (const result of [valid, invalid, missing]) {
			expect(result.error?.code).toBe('CALL_NOT_GRANTED');
			expect(result.error?.suggestion).toContain('phase 5');
		}
		expect(valid.error?.message.replace('sums-add', 'x')).toBe(
			missing.error?.message.replace('sums-nothing', 'x')
		);
		// Stage B's own first, then the refusals.
		const entries = (await journal.read()).slice(1);
		expect(entries.map((recorded) => recorded.command)).toEqual([
			'app-call-refuse',
			'app-call-refuse',
			'app-call-refuse',
		]);
		// Journaled with the caller, the scope and the name, never the input.
		expect(entries[0]?.context).toEqual({ caller: 'probe', scope: WORKSPACE });
		expect(entries[0]?.input).toEqual({ command: 'sums-add' });
		expect(JSON.stringify(entries[1]?.input)).not.toContain('nope');
	});

	it('refuses a shell command outside the list', async () => {
		const { probe } = await boot();
		expect((await probe.call('layout-set', { sidebar: { open: false } })).error?.code).toBe(
			'CALL_NOT_GRANTED'
		);
		expect((await probe.call('app-open', { instance: 'sums' })).error?.code).toBe(
			'CALL_NOT_GRANTED'
		);
	});

	it('survives a name that is not a string', async () => {
		const { probe, journal } = await boot();
		const result = await probe.call(5 as unknown as string);
		expect(result.error?.code).toBe('CALL_NOT_GRANTED');
		expect((await last(journal)).input).toEqual({ command: '5' });
	});

	it('runs what is allowed, as the caller, with the owner in the journal', async () => {
		const { probe, journal } = await boot();
		expect((await probe.call('shell-info-get')).success).toBe(true);
		expect((await last(journal)).context).toEqual({ caller: 'probe', scope: WORKSPACE });
		expect((await probe.call('probe-list')).success).toBe(true);
		expect((await last(journal)).context).toEqual({
			app: 'probe',
			caller: 'probe',
			instance: 'probe',
			scope: WORKSPACE,
		});
	});

	it('sets no caller for a person or an agent', async () => {
		const { kernel, journal } = await boot();
		await kernel.call('probe-list');
		expect((await last(journal)).context).toEqual({
			app: 'probe',
			instance: 'probe',
			scope: WORKSPACE,
		});
		await kernel.agent.call('layout-get');
		expect((await last(journal)).context).toEqual({ scope: WORKSPACE });
	});

	it('adds the seq to a person or agent result, never to the journal or an app', async () => {
		const { kernel, journal, probe } = await boot();
		const result = await kernel.call('probe-list');
		const recorded = await last(journal);
		expect(result.metadata?.['dev.loam/seq']).toBe(recorded.seq);
		expect(recorded.result.metadata?.['dev.loam/seq']).toBeUndefined();
		// A seq counts every app's calls, which an app must not see.
		expect((await probe.call('probe-list')).metadata?.['dev.loam/seq']).toBeUndefined();
	});

	it('reports the caller and the owner to a listener', async () => {
		const { kernel, probe } = await boot();
		const events: unknown[] = [];
		kernel.subscribe((event) => events.push(event));
		await probe.call('probe-list');
		expect(events[0]).toMatchObject({ command: 'probe-list', caller: 'probe', instance: 'probe' });
	});
});

describe('scoping an app to itself', () => {
	it('refuses a selection of another instance the same way', async () => {
		const { probe, kernel } = await boot();
		expect((await probe.call('app-selection-set', { instance: 'sums', id: 'x' })).error?.code).toBe(
			'CALL_NOT_GRANTED'
		);
		expect((await probe.call('app-selection-get', { instance: 'sums' })).error?.code).toBe(
			'CALL_NOT_GRANTED'
		);
		expect((await probe.call('app-selection-get')).error?.code).toBe('CALL_NOT_GRANTED');
		const set = await probe.call('app-selection-set', { instance: 'probe', id: 'a' });
		expect(set.data).toEqual({ id: 'a', level: 'workspace' });
		expect(set.undoCommand).toBe('app-selection-set');
		expect(set.undoArgs).toEqual({ instance: 'probe', id: null, level: 'workspace' });
		expect((await kernel.call('app-selection-get', { instance: 'probe' })).data).toEqual({
			id: 'a',
			level: 'workspace',
		});
		expect((await kernel.call('app-selection-get', { instance: 'zzz' })).error?.code).toBe(
			'APP_NOT_FOUND'
		);
		expect(
			(await kernel.call('app-selection-set', { instance: 'zzz', id: null })).error?.code
		).toBe('APP_NOT_FOUND');
	});

	it('lists only the caller overlays, and refuses dismissing another', async () => {
		const { kernel, probe, sums } = await boot();
		await kernel.call('app-open', { instance: 'sums' });
		const mine = await probe.call<OverlayRefV1>('toast-show', { message: 'From probe' });
		const theirs = await sums.call<OverlayRefV1>('modal-open', { title: 'T', body: 'B' });
		await kernel.call('toast-show', { message: 'From the shell' });
		const seen = await probe.call<{ overlays: OverlayV1[] }>('overlay-list');
		expect(seen.data?.overlays.map((overlay) => overlay.overlayId)).toEqual([mine.data?.overlayId]);
		const all = await kernel.call<{ overlays: OverlayV1[] }>('overlay-list');
		expect(all.data?.overlays).toHaveLength(3);
		expect(
			(await probe.call('overlay-dismiss', { overlayId: theirs.data?.overlayId })).error?.code
		).toBe('OVERLAY_NOT_OWNER');
		expect(
			(await sums.call('overlay-dismiss', { overlayId: theirs.data?.overlayId })).success
		).toBe(true);
	});

	it('lets only the owning app set its status items', async () => {
		const { kernel, probe, sums } = await boot();
		const set = await probe.call('status-item-set', { id: 'count', value: '3' });
		expect(set.data).toEqual({ id: 'count', value: '3' });
		const { data } = await kernel.call<AppDetailV1>('app-get', { instance: 'probe' });
		expect(data?.statusItems).toEqual({ count: '3' });
		expect((await sums.call('status-item-set', { id: 'count', value: '1' })).error?.code).toBe(
			'STATUS_ITEM_UNKNOWN'
		);
		expect((await kernel.call('status-item-set', { id: 'count', value: '1' })).error?.code).toBe(
			'STATUS_ITEM_UNKNOWN'
		);
		expect((await probe.call('status-item-set', { id: 'other', value: '1' })).error?.code).toBe(
			'STATUS_ITEM_UNKNOWN'
		);
		expect(
			(await probe.call('status-item-set', { id: 'count', value: 'x'.repeat(41) })).success
		).toBe(false);
	});
});

describe('overlays on an app switch (section 8)', () => {
	it("closes the previous owner's overlays atomically and reports the modal to its waiter", async () => {
		const { kernel, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const toast = await probe.call<OverlayRefV1>('toast-show', { message: 'Hi' });
		await kernel.call('toast-show', { message: 'A shell toast' });
		const modal = await probe.call<OverlayRefV1>('modal-open', { title: 'T', body: 'B' });
		const waited = probe.waitOverlay(modal.data?.overlayId as string);
		const opened = await kernel.agent.call('app-open', { instance: 'sums' });
		expect(opened.data).toEqual({ active: 'sums', previous: 'probe' });
		const left = await kernel.call<{ overlays: OverlayV1[] }>('overlay-list');
		expect(left.data?.overlays.map((overlay) => overlay.owner)).toEqual(['shell']);
		await expect(waited).resolves.toEqual({
			overlayId: modal.data?.overlayId as string,
			result: 'cancel',
			reason: 'app-switch',
		});
		await expect(probe.waitOverlay(toast.data?.overlayId as string)).resolves.toMatchObject({
			result: 'dismissed',
			reason: 'app-switch',
		});
	});

	it('answers a wait only to the owner, and refuses an unknown overlay', async () => {
		const { kernel, probe, sums } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const modal = await probe.call<OverlayRefV1>('modal-open', { title: 'T', body: 'B' });
		await expect(sums.waitOverlay(modal.data?.overlayId as string)).rejects.toMatchObject({
			code: 'OVERLAY_NOT_OWNER',
		});
		await expect(probe.waitOverlay('ovl-99')).rejects.toMatchObject({
			code: 'OVERLAY_NOT_FOUND',
		});
	});

	it('refuses a modal from an app that is not active, journaled', async () => {
		const { kernel, probe, journal } = await boot();
		await kernel.call('app-open', { instance: 'sums' });
		const refused = await probe.call('modal-open', { title: 'T', body: 'B' });
		expect(refused.error?.code).toBe('OVERLAY_OWNER_INACTIVE');
		expect((await last(journal)).result.error?.code).toBe('OVERLAY_OWNER_INACTIVE');
		expect((await probe.call('toast-show', { message: 'A toast is allowed' })).success).toBe(true);
	});

	it('lets a shell modal refuse the switch, and leave nothing changed', async () => {
		const { kernel } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		await kernel.call('modal-open', { title: 'T', body: 'B' });
		expect((await kernel.call('app-open', { instance: 'sums' })).error?.code).toBe(
			'OVERLAY_MODAL_BUSY'
		);
		expect((await kernel.call('app-close')).error?.code).toBe('OVERLAY_MODAL_BUSY');
		const { data } = await kernel.call<{ active: string }>('app-list');
		expect(data?.active).toBe('probe');
	});

	it('clears the selection on leaving, and answers an undo either way', async () => {
		const { kernel, probe } = await boot();
		const first = await kernel.call('app-open', { instance: 'probe' });
		expect(first.undoCommand).toBe('app-close');
		await probe.call('app-selection-set', { instance: 'probe', id: 'a' });
		const again = await kernel.call('app-open', { instance: 'probe' });
		expect(again.data).toEqual({ active: 'probe', previous: 'probe' });
		expect((await kernel.call('app-selection-get', { instance: 'probe' })).data).toEqual({
			id: 'a',
			level: 'workspace',
		});
		const second = await kernel.call('app-open', { instance: 'sums' });
		expect(second.undoCommand).toBe('app-open');
		expect(second.undoArgs).toEqual({ instance: 'probe' });
		expect((await kernel.call('app-selection-get', { instance: 'probe' })).data).toEqual({
			id: null,
			level: 'workspace',
		});
		const closed = await kernel.call('app-close');
		expect(closed.data).toEqual({ active: null, previous: 'sums' });
		expect(closed.undoArgs).toEqual({ instance: 'sums' });
		const none = await kernel.call('app-close');
		expect(none.data).toEqual({ active: null, previous: null });
		expect(none.undoCommand).toBeUndefined();
	});
});

describe('the native module (5.5)', () => {
	it('imports nothing at boot, once on first use, and never runs activate for a command', async () => {
		let activated = false;
		const definition = probeDefinition();
		const { kernel, ports, probe } = await boot({
			manifest: PROBE_MANIFEST,
			definition: {
				...definition,
				activate() {
					activated = true;
				},
			},
		});
		expect(ports.imports).toEqual([]);
		await kernel.call('app-open', { instance: 'probe' });
		expect(ports.imports).toEqual([]);
		await kernel.call('probe-list');
		await kernel.agent.call('probe-list');
		await probe.load();
		expect(ports.imports).toEqual(['https://shell.loam.test/apps/probe/dist/native.js']);
		expect(activated).toBe(false);
	});

	it('leaves deactivate to the chrome, which ran activate', async () => {
		let deactivated = 0;
		const definition = { ...probeDefinition(), deactivate: () => void deactivated++ };
		const ports = createFixturePorts({ 'apps/probe/': { manifest: PROBE_MANIFEST, definition } });
		const { kernel } = await createTestKernel({ deployment: probeDeployment(), ports });
		await kernel.call('probe-list');
		await kernel.dispose();
		expect(deactivated).toBe(0);
	});

	it('fails an app whose handlers do not match, and then answers APP_NOT_READY', async () => {
		const { handlers } = probeDefinition();
		const { 'probe-list': _gone, ...rest } = handlers;
		const ports = createFixturePorts({
			'apps/probe/': {
				manifest: PROBE_MANIFEST,
				definition: {
					sdk: 1,
					handlers: { ...rest, 'probe-extra': (async () => ({ success: true })) as never },
				},
			},
		});
		const { kernel } = await createTestKernel({ deployment: probeDeployment(), ports });
		kernels.push(kernel);
		const first = await kernel.call('probe-hidden');
		expect(first.error?.code).toBe('COMMAND_NOT_EXPOSED');
		const called = await kernel.agent.call('probe-hidden');
		expect(called.error?.code).toBe('APP_HANDLER_MISSING');
		expect(called.error?.message).toContain('probe-list');
		expect(called.error?.message).toContain('probe-extra');
		expect(called.error?.suggestion).toBeTruthy();
		await expect(kernel.appPort('probe').load()).rejects.toMatchObject({
			code: 'APP_HANDLER_MISSING',
		});
		const { data } = await kernel.call<{ apps: AppSummaryV1[] }>('app-list');
		expect(data?.apps[0]?.state).toBe('failed');
		const next = await kernel.agent.call('probe-hidden');
		expect(next.error?.code).toBe('APP_NOT_READY');
		expect(next.error?.details?.cause).toBe('APP_HANDLER_MISSING');
		expect((await kernel.call('app-open', { instance: 'probe' })).success).toBe(true);
	});

	it('fails a module whose handlers are null', async () => {
		const ports = createFixturePorts({
			'apps/probe/': { manifest: PROBE_MANIFEST, definition: { sdk: 1, handlers: null } as never },
		});
		const { kernel } = await createTestKernel({ deployment: probeDeployment(), ports });
		kernels.push(kernel);
		expect((await kernel.call('probe-list')).error?.code).toBe('APP_HANDLER_MISSING');
		const { data } = await kernel.call<{ apps: AppSummaryV1[] }>('app-list');
		expect(data?.apps[0]?.state).toBe('failed');
	});

	it('fails an import that throws, and refuses a module with no sdk', async () => {
		const ports = createFixturePorts({
			'apps/probe/': { manifest: PROBE_MANIFEST, importError: new Error('Boom') },
		});
		const { kernel } = await createTestKernel({ deployment: probeDeployment(), ports });
		kernels.push(kernel);
		const called = await kernel.call('probe-list');
		expect(called.error?.code).toBe('APP_ACTIVATION_FAILED');
		expect(JSON.stringify(called.error)).not.toContain('Boom');

		const wrong = createFixturePorts({
			'apps/probe/': { manifest: PROBE_MANIFEST, definition: {} as never },
		});
		const other = await createTestKernel({ deployment: probeDeployment(), ports: wrong });
		kernels.push(other.kernel);
		expect((await other.kernel.call('probe-list')).error?.code).toBe('APP_HANDLER_MISSING');
	});

	it('refuses an entry that leaves the package', async () => {
		const ports = createFixturePorts({
			'apps/probe/': {
				manifest: { ...PROBE_MANIFEST, native: { entry: '../other/native.js' } },
				definition: probeDefinition(),
			},
		});
		const { kernel } = await createTestKernel({ deployment: probeDeployment(), ports });
		kernels.push(kernel);
		const called = await kernel.call('probe-list');
		expect(called.success).toBe(false);
		expect(ports.imports).toEqual([]);
	});

	it('answers a handler that throws or returns no result', async () => {
		const { handlers } = probeDefinition();
		const ports = createFixturePorts({
			'apps/probe/': {
				manifest: PROBE_MANIFEST,
				definition: {
					sdk: 1,
					handlers: {
						...handlers,
						'probe-list': (async () => {
							throw new Error('Oops');
						}) as never,
						'probe-count': (async () => 7) as never,
					},
				},
			},
		});
		const { kernel, journal } = await createTestKernel({ deployment: probeDeployment(), ports });
		kernels.push(kernel);
		const threw = await kernel.call('probe-list');
		expect(threw.error?.code).toBe('HANDLER_THREW');
		expect(JSON.stringify(threw.error)).not.toContain('Oops');
		// So the journal's `redact` has nothing of it to remove (9.5).
		expect(JSON.stringify(await journal.read())).not.toContain('Oops');
		expect((await kernel.call('probe-count')).error?.code).toBe('HANDLER_RESULT_INVALID');
	});

	it('records an activation the chrome reports as failed', async () => {
		const { kernel, probe } = await boot();
		probe.reportActivationFailed('activate threw');
		const { data } = await kernel.call<{ apps: AppSummaryV1[] }>('app-list');
		const held = data?.apps.find((app) => app.instance === 'probe');
		expect(held?.state).toBe('failed');
		expect(held?.error?.code).toBe('APP_ACTIVATION_FAILED');
		expect((await kernel.call('probe-list')).error?.code).toBe('APP_NOT_READY');
	});
});

describe('a handler context', () => {
	it('stores a record the kernel fills, with the command clock', async () => {
		const adapter = new MemoryAdapter();
		const ports = createFixturePorts({
			'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
		});
		const auth = new MockAuthAdapter();
		await auth.signIn?.({ method: 'credentials', email: 'person@example.com' } as never);
		const kernel = await createKernel({
			store: adapter,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth,
			environment: createFixedEnvironment(),
			host: 'test',
			clock: createSteppingClock(),
			random: () => 0.5,
			deployment: probeDeployment(),
			ports,
		});
		kernels.push(kernel);
		const noted = await kernel.call<{ key: string; nonce: number; greeting: string }>(
			'probe-note',
			{
				text: 'hello',
			}
		);
		expect(noted.data?.greeting).toBe('hi');
		expect(noted.data?.nonce).toBe(0.5);
		const record = await adapter.get<Record<string, unknown>>(
			'app-probe',
			noted.data?.key as string
		);
		expect(record).toMatchObject({
			key: noted.data?.key,
			value: { text: 'hello', nonce: 0.5 },
			app: 'probe',
			instance: 'probe',
			workspace: 'personal',
			scope: WORKSPACE,
			scopeKey: 'w',
		});
		expect(typeof record?.updatedAt).toBe('number');
		expect((record?.actor as { id?: string } | null)?.id).toBeTruthy();

		const store = kernel.appPort('probe').store;
		expect(await store?.get(noted.data?.key as string)).toEqual({ text: 'hello', nonce: 0.5 });
		expect(await store?.get('missing')).toBeUndefined();
		await store?.put('other', 1);
		expect((await store?.list())?.map((item) => item.key)).toEqual([noted.data?.key, 'other']);
		expect((await store?.list('note-'))?.map((item) => item.key)).toEqual([noted.data?.key]);
		await store?.delete('other');
		expect(await store?.get('other')).toBeUndefined();
		await expect(store?.get('')).rejects.toThrow(/nonempty/);
	});
});

describe('nested calls (5.3)', () => {
	it('runs a nested query with parent set, in the journal', async () => {
		const { kernel, journal } = await boot();
		const counted = await kernel.call<{ count: number }>('probe-count');
		expect(counted.data?.count).toBe(0);
		const entries = await journal.read();
		const nested = entries.find((recorded) => recorded.command === 'probe-list');
		const outer = entries.find((recorded) => recorded.command === 'probe-count');
		expect(nested?.context?.parent).toBe(outer?.traceId);
		expect(nested?.context?.caller).toBe('probe');
		expect(outer?.context?.parent).toBeUndefined();
	});

	it('refuses a nested mutation, journaled, naming D68', async () => {
		const { kernel, journal } = await boot();
		const result = await kernel.call<{ refused: string }>('probe-sneak');
		expect(result.data?.refused).toBe('NESTED_MUTATION_REFUSED');
		const entries = await journal.read();
		const refused = entries.find((recorded) => recorded.command === 'app-nested-refuse');
		expect(refused?.result.error?.message).toContain('D68');
		expect(refused?.result.error?.suggestion).toBeTruthy();
		expect(refused?.context?.parent).toBeDefined();
		expect(entries.map((recorded) => recorded.command)).not.toContain('probe-note');
	});

	it('refuses a foreign nested call as any other', async () => {
		const { kernel } = await boot();
		expect((await kernel.call<{ refused: string }>('probe-peek')).data?.refused).toBe(
			'CALL_NOT_GRANTED'
		);
	});

	it('hides a surface or resource it does not hold', async () => {
		const { probe } = await boot();
		await expect(probe.readResource('ui://probe/nothing')).rejects.toMatchObject({
			code: 'VIEW_RESOURCE_UNAVAILABLE',
		});
		await expect(kernels[0]?.appPort('sums').load()).resolves.toBe(sumsDefinition);
	});
});

describe('rebuilding the registries (9.1)', () => {
	it('keeps one journal sequence, and lets an in-flight call finish', async () => {
		const journal = new MemoryJournalSink();
		const parts = await createKernelParts({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
		});
		kernels.push(parts.kernel);
		const old = parts.registries.palette;
		await parts.kernel.call('layout-get');
		const running = parts.kernel.call('layout-get');
		parts.setAppCommands([]);
		expect(parts.registries.palette).not.toBe(old);
		await running;
		await parts.kernel.call('layout-get');
		expect((await journal.read()).map((recorded) => recorded.seq)).toEqual([1, 2, 3]);
	});
});

describe('disposal', () => {
	it('answers KERNEL_DISPOSED from a port as from the kernel', async () => {
		const { kernel, probe } = await boot();
		await kernel.dispose();
		expect((await probe.call('shell-info-get')).error?.code).toBe('KERNEL_DISPOSED');
	});
});

describe('packageFile', () => {
	it('keeps a path inside the package, and refuses what a server might decode out of it', () => {
		const root = 'https://shell.test/apps/x/';
		expect(packageFile(root, 'dist/main.html')).toBe(`${root}dist/main.html`);
		for (const path of [
			'../other/a',
			'/a',
			'..%2f..%2fdeployment.json',
			'%2e%2e/a',
			'..\\a',
			'a\\b',
		]) {
			expect(packageFile(root, path), path).toBeUndefined();
		}
	});
});
