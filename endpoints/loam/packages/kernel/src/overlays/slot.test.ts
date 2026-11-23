/**
 * Phase 4's overlays II (its 6.1 to 6.6, P4-E7's parts step 4 builds): dialogs, modals and prompts on every path of
 * 6.1's table, the slot, a dialog's limit and its parking, an app's element, the global strip, 6.5's answer rule with
 * F6's cancels, a change of person, and replay.
 */
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { OverlayRefV1, OverlayResultV1, OverlayV1 } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernel } from '../kernel.js';
import { isHumanGesture } from '../settings/setting-rules.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	PROBE_MANIFEST,
	probeDefinition,
	probeDeployment,
	probeViewManifest,
	replayKernel,
} from '../testing.js';
import type { LoamKernel } from '../types.js';
import { answerRule, createOverlayCommands, type Opener } from './commands.js';
import { promptValueFault } from './slot.js';
import { appOwner, createOverlayStore, SHELL } from './store.js';

const kernels: LoamKernel[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const sumsManifest = {
	...PROBE_MANIFEST,
	plugin: { ...PROBE_MANIFEST.plugin, id: 'sums', title: 'Sums', domains: ['sums'] },
	commands: [],
	grants: [],
	config: undefined,
	ui: { surfaces: { main: { element: 'sums-main' } } },
} as unknown as typeof PROBE_MANIFEST;

const entry = (instance: string) => ({ instance, app: instance, package: `apps/${instance}/` });

/** A kernel with probe and sums native and probev a view, on a clock the test moves. */
async function boot() {
	let now = 1_800_000_000_000;
	const journal = new MemoryJournalSink();
	const auth = new MockAuthAdapter({ clock: { now: () => now } });
	const kernel = await createKernel({
		store: new MemoryAdapter(),
		storeKind: 'memory',
		journal,
		auth,
		environment: createFixedEnvironment(),
		host: 'test',
		clock: () => now,
		deployment: probeDeployment(
			[entry('probe'), entry('sums'), entry('probev')],
			'https://sandbox.loam.test'
		),
		ports: createFixturePorts({
			'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
			'apps/sums/': { manifest: sumsManifest, definition: { sdk: 1, handlers: {} } as never },
			'apps/probev/': {
				manifest: probeViewManifest(),
				definition: probeDefinition('probev'),
				files: { 'handlers.html': '<!doctype html><title>H</title>' },
			},
		}),
		overlayAnchors: { resolve: () => true },
	});
	kernels.push(kernel);
	await kernel.appsReady;
	return {
		kernel,
		journal,
		auth,
		probe: kernel.appPort('probe'),
		sums: kernel.appPort('sums'),
		probev: kernel.appPort('probev'),
		advance: (ms: number) => {
			now += ms;
		},
	};
}

const list = async (kernel: LoamKernel) =>
	(await kernel.call<{ overlays: OverlayV1[] }>('overlay-list')).data?.overlays ?? [];
const code = (result: { error?: { code: string } }) => result.error?.code;

const INPUTS = {
	'dialog-open': { title: 'Note', body: 'Kept.' },
	'modal-open': { title: 'Sure?', body: 'Really.' },
	'prompt-open': { title: 'Name?' },
} as const;
type Opening = keyof typeof INPUTS;
const KINDS = Object.keys(INPUTS) as Opening[];

describe("P4-E7: 6.1's table for dialogs, modals and prompts", () => {
	it('opens each as the shell for a person, as the app for the active one, and nothing for anyone else', async () => {
		const { kernel, probe, sums } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		for (const name of KINDS) {
			// A person's gesture: the shell's, with no owner line (6.6).
			const shells = await kernel.call<OverlayRefV1>(name, INPUTS[name]);
			expect(shells.data, name).toMatchObject({ owner: 'shell', kind: name.split('-')[0] });
			// The active app's port: the app's, with its owner line.
			const theirs = await probe.call<OverlayRefV1>(name, INPUTS[name]);
			const busy = name !== 'dialog-open';
			if (busy) expect(code(theirs), name).toBe('OVERLAY_MODAL_BUSY');
			else expect(theirs.data?.owner, name).toBe('probe');
			// An inactive app's port.
			expect(code(await sums.call(name, INPUTS[name])), name).toBe('OVERLAY_OWNER_INACTIVE');
			// The agent interface opens nothing; the copilot is an agent on the same path (openerOf, step 3's tests).
			expect(code(await kernel.agent.call(name, INPUTS[name])), name).toBe('HUMAN_REQUIRED');
			expect(
				code(await kernel.agent.call(name, INPUTS[name], { agent: 'helper' } as never)),
				name
			).toBe('HUMAN_REQUIRED');
			for (const overlay of await list(kernel)) {
				if (overlay.kind !== 'toast')
					await kernel.call('overlay-dismiss', { overlayId: overlay.overlayId });
			}
		}
		// The app's own modal and prompt, once the slot is free, carry its owner line.
		for (const name of ['modal-open', 'prompt-open'] as const) {
			const opened = await probe.call<OverlayRefV1>(name, INPUTS[name]);
			const [held] = (await list(kernel)).filter(({ kind }) => kind !== 'dialog');
			expect(held?.from, name).toEqual({ kind: 'app', title: expect.any(String) });
			await kernel.call('overlay-dismiss', { overlayId: opened.data?.overlayId });
		}
		expect(await list(kernel)).toEqual([]);
	});

	it('keeps the slot to one modal or prompt, shell-wide, and the palette out while it is held', async () => {
		const { kernel, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const prompt = await probe.call<OverlayRefV1>('prompt-open', INPUTS['prompt-open']);
		for (const name of ['modal-open', 'prompt-open'] as const) {
			const refused = await kernel.call(name, INPUTS[name]);
			expect(code(refused), name).toBe('OVERLAY_MODAL_BUSY');
			expect(refused.error?.retryable).toBe(true);
		}
		expect(code(await kernel.call('palette-open', {}))).toBe('OVERLAY_MODAL_BUSY');
		// A dialog is not in the slot.
		expect((await kernel.call('dialog-open', INPUTS['dialog-open'])).success).toBe(true);
		await kernel.call('overlay-dismiss', { overlayId: prompt.data?.overlayId });
		expect((await kernel.call('palette-open', {})).success).toBe(true);
	});

	it('holds a switch while the shell holds the slot with a prompt', async () => {
		const { kernel } = await boot();
		await kernel.call('prompt-open', INPUTS['prompt-open']);
		expect(code(await kernel.call('app-open', { instance: 'probe' }))).toBe('OVERLAY_MODAL_BUSY');
	});
});

describe('P4-E7: dialogs (6.1, 6.2)', () => {
	it('gives OVERLAY_LIMIT on a fourth, parked ones counted, per owner', async () => {
		const { kernel, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		for (let index = 0; index < 3; index++) {
			expect((await probe.call('dialog-open', INPUTS['dialog-open'])).success).toBe(true);
		}
		const fourth = await probe.call('dialog-open', INPUTS['dialog-open']);
		expect(code(fourth)).toBe('OVERLAY_LIMIT');
		expect(fourth.error?.suggestion).toBe('Close one first');
		// The shell's own count apart.
		expect((await kernel.call('dialog-open', INPUTS['dialog-open'])).success).toBe(true);
		await kernel.call('app-open', { instance: 'sums' });
		expect((await list(kernel)).filter((each) => each.state === 'parked')).toHaveLength(3);
		await kernel.call('app-open', { instance: 'probe' });
		expect(code(await probe.call('dialog-open', INPUTS['dialog-open']))).toBe('OVERLAY_LIMIT');
	});

	it('parks a dialog on a switch and restores it on return; cancelOnLeave cancels it instead', async () => {
		const { kernel, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const kept = await probe.call<OverlayRefV1>('dialog-open', INPUTS['dialog-open']);
		const leaving = await probe.call<OverlayRefV1>('dialog-open', {
			...INPUTS['dialog-open'],
			cancelOnLeave: true,
		});
		const left = probe.waitOverlay(leaving.data?.overlayId as string);
		const shells = await kernel.call<OverlayRefV1>('dialog-open', INPUTS['dialog-open']);
		await kernel.call('app-open', { instance: 'sums' });
		expect(await left).toMatchObject({ result: 'cancel', reason: 'app-switch' });
		const parked = await list(kernel);
		expect(parked.find((each) => each.overlayId === kept.data?.overlayId)?.state).toBe('parked');
		// The shell's own dialog stays open across a switch.
		expect(parked.find((each) => each.overlayId === shells.data?.overlayId)?.state).toBeUndefined();
		await kernel.call('app-close');
		await kernel.call('app-open', { instance: 'probe' });
		const restored = (await list(kernel)).find((each) => each.overlayId === kept.data?.overlayId);
		expect(restored).toBeDefined();
		expect(restored?.state).toBeUndefined();
		const closed = probe.waitOverlay(kept.data?.overlayId as string);
		await kernel.call('overlay-dismiss', { overlayId: kept.data?.overlayId, result: 'confirm' });
		expect(await closed).toMatchObject({ result: 'confirm', reason: 'user' });
	});

	it('answers with an action, and refuses an answer it does not offer', async () => {
		const { kernel, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const actions = [
			{ id: 'keep', label: 'Keep', default: true },
			{ id: 'drop', label: 'Drop', tone: 'danger' },
		];
		const opened = await probe.call<OverlayRefV1>('dialog-open', { title: 'Draft', actions });
		const id = opened.data?.overlayId;
		for (const result of ['confirm', 'other']) {
			const refused = await kernel.call('overlay-dismiss', { overlayId: id, result });
			expect(code(refused), result).toBe('VALIDATION_ERROR');
		}
		const answered = await kernel.call<OverlayResultV1>('overlay-dismiss', {
			overlayId: id,
			result: 'drop',
		});
		expect(answered.data).toMatchObject({ result: 'drop', reason: 'user' });
	});

	it('refuses a repeated action id, two defaults, dismissed, and a fourth action', async () => {
		const { kernel } = await boot();
		const bad = [
			[
				{ id: 'a', label: 'A' },
				{ id: 'a', label: 'B' },
			],
			[
				{ id: 'a', label: 'A', default: true },
				{ id: 'b', label: 'B', default: true },
			],
			[{ id: 'dismissed', label: 'A' }],
			['a', 'b', 'c', 'd'].map((id) => ({ id, label: id })),
			[{ id: 'Bad Id', label: 'A' }],
		];
		for (const actions of bad) {
			const refused = await kernel.call('dialog-open', { title: 'T', actions });
			expect(code(refused), JSON.stringify(actions)).toBe('VALIDATION_ERROR');
		}
	});
});

describe('the review of step 4 (R1, 13, 15, D83)', () => {
	it("keeps another app's overlays its own: a foreign port's cancel and dismiss are OVERLAY_NOT_OWNER (R1)", async () => {
		const { kernel, probe, sums } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const dialog = await probe.call<OverlayRefV1>('dialog-open', INPUTS['dialog-open']);
		const toast = await probe.call<OverlayRefV1>('toast-show', { message: 'Hi' });
		for (const [overlay, result] of [
			[dialog, 'cancel'],
			[dialog, undefined],
			[toast, 'dismissed'],
			[toast, undefined],
		] as const) {
			const refused = await sums.call('overlay-dismiss', {
				overlayId: overlay.data?.overlayId,
				result,
			});
			expect(code(refused), String(result)).toBe('OVERLAY_NOT_OWNER');
		}
		// `dismissed`, said outright, is accepted where leaving the result out gives it, and nowhere else.
		const said = await kernel.call<OverlayResultV1>('overlay-dismiss', {
			overlayId: toast.data?.overlayId,
			result: 'dismissed',
		});
		expect(said.data).toMatchObject({ result: 'dismissed' });
		expect(
			code(
				await kernel.call('overlay-dismiss', {
					overlayId: dialog.data?.overlayId,
					result: 'dismissed',
				})
			)
		).toBe('VALIDATION_ERROR');
	});

	it('refuses crossed bounds, choices of another type, and a cancel action that is danger or the default', async () => {
		const { kernel } = await boot();
		for (const schema of [
			{ type: 'string', minLength: 5, maxLength: 2 },
			{ type: 'number', minimum: 9, maximum: 1 },
			{ type: 'string', enum: ['a', 1] },
			{ type: 'integer', enum: [1.5] },
			{ type: 'boolean', enum: ['yes'] },
			{ type: 'object', properties: { n: { type: 'number', enum: ['x'] } } },
		]) {
			const refused = await kernel.call('prompt-open', { title: 'T', schema });
			expect(code(refused), JSON.stringify(schema)).toBe('VALIDATION_ERROR');
		}
		for (const cancel of [
			{ id: 'cancel', label: 'Stop', tone: 'danger' },
			{ id: 'cancel', label: 'Stop', default: true },
		]) {
			const refused = await kernel.call('dialog-open', {
				title: 'T',
				actions: [cancel, { id: 'go', label: 'Go' }],
			});
			expect(code(refused), JSON.stringify(cancel)).toBe('VALIDATION_ERROR');
		}
	});

	it("P4-E7: records each move's reason: a parked dialog's 'park', its return's 'restore', then the person's 'user' (6.2)", () => {
		const overlays = createOverlayStore();
		const kept = overlays.open(appOwner('probe'), 'dialog', { title: 'Kept' });
		overlays.closeForSwitch('probe');
		expect(overlays.list().find((each) => each.overlayId === kept.overlayId)?.state).toBe('parked');
		overlays.restore('probe');
		expect(
			overlays.list().find((each) => each.overlayId === kept.overlayId)?.state
		).toBeUndefined();
		overlays.close(kept.overlayId, 'confirm', 'user');
		expect(overlays.movesOf(kept.overlayId)).toEqual(['park', 'restore', 'user']);
	});

	it('records the scope an app question was opened in, and closes it, parked or not, in another (D83)', () => {
		const overlays = createOverlayStore();
		const atlas = { workspace: 'w', project: 'atlas' };
		const shown = overlays.open(appOwner('probe'), 'dialog', { title: 'Here' }, { scope: atlas });
		const kept = overlays.open(
			appOwner('probe'),
			'dialog',
			{ title: 'Wide' },
			{ scope: { workspace: 'w' } }
		);
		const shells = overlays.open(SHELL, 'dialog', { title: 'Shell' }, { scope: atlas });
		expect(overlays.get(shown.overlayId)?.scope).toEqual(atlas);
		expect(overlays.get(shells.overlayId)?.scope).toBeUndefined();
		overlays.closeForSwitch('probe');
		expect(overlays.closeOutOfScope(atlas)).toBe(0);
		expect(overlays.closeOutOfScope({ workspace: 'w', project: 'beacon' })).toBe(1);
		expect(overlays.list().map((each) => each.overlayId)).toEqual([
			kept.overlayId,
			shells.overlayId,
		]);
		expect(overlays.movesOf(shown.overlayId)).toEqual(['park', 'app-switch']);
		const before = overlays.people();
		overlays.closeAll('person');
		overlays.reset();
		expect(overlays.people()).toBe(before + 2);
	});
});

describe('P4-E7: an element (6.4)', () => {
	it("shows a native app's, gives a view OVERLAY_ELEMENT_VIEW, and the shell none", async () => {
		const { kernel, probe, probev } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const native = await probe.call<OverlayRefV1>('dialog-open', {
			title: 'Pick',
			element: 'probe-picker',
		});
		expect(native.success).toBe(true);
		expect((await list(kernel))[0]?.input).toMatchObject({ element: 'probe-picker' });
		await kernel.call('app-open', { instance: 'probev' });
		for (const name of ['dialog-open', 'modal-open'] as const) {
			const refused = await probev.call(name, { ...INPUTS[name], element: 'probe-picker' });
			expect(code(refused), name).toBe('OVERLAY_ELEMENT_VIEW');
			expect(refused.error?.suggestion).toBe('Use text, actions or a prompt');
		}
		expect(code(await kernel.call('dialog-open', { title: 'T', element: 'probe-picker' }))).toBe(
			'VALIDATION_ERROR'
		);
		expect(code(await probe.call('dialog-open', { title: 'T', element: 'Nope' }))).toBe(
			'VALIDATION_ERROR'
		);
	});
});

describe('prompts (6.4)', () => {
	it('takes one line of text by default, and checks the value on confirm, staying open when it fails', async () => {
		const { kernel } = await boot();
		const opened = await kernel.call<OverlayRefV1>('prompt-open', { title: 'Name?', value: 'Ada' });
		const id = opened.data?.overlayId;
		const refused = await kernel.call('overlay-dismiss', {
			overlayId: id,
			result: 'confirm',
			value: 'two\nlines',
		});
		expect(code(refused)).toBe('VALIDATION_ERROR');
		expect((await list(kernel)).map((each) => each.overlayId)).toEqual([id]);
		// The answer is what was submitted, never the starting value (the review's 8): none, or null, fails.
		for (const value of [undefined, null]) {
			const empty = await kernel.call('overlay-dismiss', {
				overlayId: id,
				result: 'confirm',
				value,
			});
			expect(code(empty), String(value)).toBe('VALIDATION_ERROR');
		}
		const answered = await kernel.call<OverlayResultV1>('overlay-dismiss', {
			overlayId: id,
			result: 'confirm',
			value: '',
		});
		expect(answered.data).toMatchObject({ result: 'confirm', value: '' });
	});

	it("checks an object schema's fields, and refuses a for, a pattern or a value with a cancel", async () => {
		const { kernel } = await boot();
		const schema = {
			type: 'object',
			properties: {
				name: { type: 'string', minLength: 1, maxLength: 20 },
				count: { type: 'integer', minimum: 1, maximum: 9 },
				size: { type: 'string', enum: ['s', 'm'] },
				on: { type: 'boolean' },
			},
			required: ['name'],
		};
		for (const input of [
			{ title: 'T', for: { command: 'x' } },
			{ title: 'T', schema: { type: 'string', pattern: '^a' } },
			{ title: 'T', schema: { type: 'object', properties: {} } },
			{ title: 'T', schema: { ...schema, required: ['missing'] } },
			{ title: 'T', schema, value: { name: 'x', extra: 1 } },
		]) {
			expect(code(await kernel.call('prompt-open', input)), JSON.stringify(input)).toBe(
				'VALIDATION_ERROR'
			);
		}
		const opened = await kernel.call<OverlayRefV1>('prompt-open', { title: 'T', schema });
		const id = opened.data?.overlayId;
		for (const value of [
			{},
			{ name: 'x', count: 1.5 },
			{ name: 'x', count: 10 },
			{ name: 'x', size: 'l' },
			{ name: 'x', on: 'yes' },
			{ name: '' },
		]) {
			const refused = await kernel.call('overlay-dismiss', {
				overlayId: id,
				result: 'confirm',
				value,
			});
			expect(code(refused), JSON.stringify(value)).toBe('VALIDATION_ERROR');
		}
		expect(
			code(await kernel.call('overlay-dismiss', { overlayId: id, result: 'cancel', value: {} }))
		).toBe('VALIDATION_ERROR');
		const value = { name: 'Ada', count: 3, size: 'm', on: true };
		const answered = await kernel.call<OverlayResultV1>('overlay-dismiss', {
			overlayId: id,
			result: 'confirm',
			value,
		});
		expect(answered.data?.value).toEqual(value);
	});

	it('reads a value of each field kind', () => {
		expect(promptValueFault({ type: 'number' }, 2.5)).toBeUndefined();
		expect(promptValueFault({ type: 'number' }, Number.NaN)).toBeDefined();
		expect(promptValueFault({ type: 'string', minLength: 2 }, 'a')).toBeDefined();
		expect(promptValueFault({ type: 'number', minimum: 3 }, 2)).toBeDefined();
		expect(promptValueFault(undefined, 'x'.repeat(1001))).toBeDefined();
		expect(promptValueFault(undefined, 'x'.repeat(20_000))).toMatch(/JSON/);
		expect(
			promptValueFault({ type: 'object', properties: { a: { type: 'boolean' } } }, [])
		).toBeDefined();
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(promptValueFault(undefined, cyclic)).toBe('The value must be plain data');
	});
});

describe("P4-E7: 6.5's answer rule, and F6's cancels", () => {
	it("gives the agent's confirm HUMAN_REQUIRED on every kind, and lets it cancel only an app's", async () => {
		const { kernel, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const theirs = await probe.call<OverlayRefV1>('dialog-open', INPUTS['dialog-open']);
		const shells = await kernel.call<OverlayRefV1>('dialog-open', INPUTS['dialog-open']);
		const prompt = await kernel.call<OverlayRefV1>('prompt-open', INPUTS['prompt-open']);
		for (const overlay of [theirs, shells, prompt]) {
			const id = overlay.data?.overlayId;
			expect(
				code(await kernel.agent.call('overlay-dismiss', { overlayId: id, result: 'confirm' }))
			).toBe('HUMAN_REQUIRED');
		}
		// F6: the agent's cancel of a shell prompt, or any shell overlay, is HUMAN_REQUIRED too.
		for (const overlay of [shells, prompt]) {
			const refused = await kernel.agent.call('overlay-dismiss', {
				overlayId: overlay.data?.overlayId,
				result: 'cancel',
			});
			expect(code(refused)).toBe('HUMAN_REQUIRED');
			expect(refused.error?.details).toMatchObject({ route: 'shell' });
		}
		const cancelled = await kernel.agent.call<OverlayResultV1>('overlay-dismiss', {
			overlayId: theirs.data?.overlayId,
			result: 'cancel',
		});
		expect(cancelled.data).toMatchObject({ result: 'cancel', reason: 'user' });
	});

	it("gives an unrelated port's cancel of a shell prompt HUMAN_REQUIRED, and another app's NOT_OWNER", async () => {
		const { kernel, probe, sums } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const prompt = await kernel.call<OverlayRefV1>('prompt-open', INPUTS['prompt-open']);
		const refused = await probe.call('overlay-dismiss', {
			overlayId: prompt.data?.overlayId,
			result: 'cancel',
		});
		expect(code(refused)).toBe('HUMAN_REQUIRED');
		await kernel.call('overlay-dismiss', { overlayId: prompt.data?.overlayId });
		const theirs = await probe.call<OverlayRefV1>('dialog-open', INPUTS['dialog-open']);
		expect(code(await sums.call('overlay-dismiss', { overlayId: theirs.data?.overlayId }))).toBe(
			'OVERLAY_NOT_OWNER'
		);
		// The owning app answers its own.
		const own = await probe.call<OverlayResultV1>('overlay-dismiss', {
			overlayId: theirs.data?.overlayId,
			result: 'confirm',
		});
		expect(own.data).toMatchObject({ result: 'confirm' });
	});

	it("lets a kernel prompt's raising caller cancel it as withdrawn, and nothing more", async () => {
		// The kernel's own prompts carry `for` (6.1), set by the kernel alone; step 6 raises them. Here the store does.
		const overlays = createOverlayStore();
		const commands = createOverlayCommands({
			overlays,
			activeApp: () => 'probe',
			humanGesture: isHumanGesture,
		});
		const dismiss = commands.find((command) => command.name === 'overlay-dismiss');
		const run = (input: unknown, context: Record<string, unknown>) =>
			(
				dismiss as unknown as {
					handler(
						input: unknown,
						context: unknown
					): Promise<{ success: boolean; data?: unknown; error?: { code: string } }>;
				}
			).handler(input, context);
		const raise = () =>
			overlays.open(
				SHELL,
				'prompt',
				{ title: 'Run Reset?' },
				{ for: { command: 'probe-reset', caller: 'probe' } }
			).overlayId;
		expect(overlays.list()).toEqual([]);
		const first = raise();
		expect(overlays.get(first)?.for).toEqual({ command: 'probe-reset', caller: 'probe' });
		// The raiser's confirm, an unrelated app's cancel, and the agent's cancel: HUMAN_REQUIRED.
		for (const [input, context] of [
			[
				{ overlayId: first, result: 'confirm' },
				{ interface: 'palette', caller: 'probe' },
			],
			[
				{ overlayId: first, result: 'cancel' },
				{ interface: 'palette', caller: 'sums' },
			],
			[
				{ overlayId: first, result: 'cancel' },
				{ interface: 'agent', actor: { kind: 'agent', id: 'a' } },
			],
		] as const) {
			expect((await run(input, context)).error?.code).toBe('HUMAN_REQUIRED');
		}
		const withdrawn = await run(
			{ overlayId: first, result: 'cancel' },
			{ interface: 'palette', caller: 'probe' }
		);
		expect(withdrawn.data).toMatchObject({ result: 'cancel', reason: 'withdrawn' });
		expect(overlays.movesOf(first)).toEqual(['withdrawn']);
		// A person's cancel is the person's, never withdrawn.
		const second = raise();
		const declined = await run({ overlayId: second }, { interface: 'palette' });
		expect(declined.data).toMatchObject({ result: 'cancel', reason: 'user' });
		// An app's own prompt never carries `for`, whatever the store is asked.
		const own = overlays.open(
			appOwner('probe'),
			'prompt',
			{ title: 'T' },
			{ for: { command: 'x', caller: 'probe' } }
		);
		expect(overlays.get(own.overlayId)?.for).toBeUndefined();
	});

	it('decides by the path, never by an id', () => {
		const agent: Opener = {
			kind: 'agent',
			owner: { kind: 'agent', id: 'agent:a' },
			bucket: 'agents:p',
		};
		const app: Opener = { kind: 'app', owner: appOwner('probe') };
		const person: Opener = { kind: 'shell', owner: SHELL };
		expect(answerRule(person, undefined, SHELL, undefined, true)).toBeUndefined();
		expect(answerRule(app, 'probe', SHELL, 'probe', false)).toBe('withdrawn');
		expect(answerRule(app, 'probe', SHELL, 'probe', true)).toBe('HUMAN_REQUIRED');
		expect(answerRule(app, 'probe', SHELL, undefined, false)).toBe('HUMAN_REQUIRED');
		expect(answerRule(app, 'probe', appOwner('probe'), undefined, true)).toBeUndefined();
		expect(answerRule(app, 'probe', appOwner('sums'), undefined, false)).toBe('OVERLAY_NOT_OWNER');
		expect(answerRule(app, 'probe', { kind: 'agent', id: 'agent:probe' }, undefined, false)).toBe(
			'OVERLAY_NOT_OWNER'
		);
		expect(answerRule(agent, undefined, appOwner('probe'), undefined, false)).toBeUndefined();
		expect(answerRule(agent, undefined, appOwner('probe'), undefined, true)).toBe('HUMAN_REQUIRED');
		expect(answerRule({ kind: 'none' }, undefined, appOwner('probe'), undefined, true)).toBe(
			'HUMAN_REQUIRED'
		);
		expect(answerRule({ kind: 'none' }, undefined, appOwner('probe'), undefined, false)).toBe(
			'HUMAN_REQUIRED'
		);
		expect(answerRule({ kind: 'none' }, undefined, SHELL, undefined, false)).toBe('HUMAN_REQUIRED');
	});

	it('isolates overlay-list and overlay-dismiss for agents and unauthenticated callers (#1867)', async () => {
		const overlays = createOverlayStore();
		const allowedScope = { workspace: 'w', project: 'atlas' };
		const forbiddenScope = { workspace: 'w', project: 'secret' };
		const commands = createOverlayCommands({
			overlays,
			activeApp: () => 'probe',
			humanGesture: isHumanGesture,
			anchorFound: () => true,
			allows: (_actor, scope) => scope.project !== 'secret',
		});
		const byName = (name: string) =>
			commands.find((command) => command.name === name) as unknown as {
				handler(
					input: unknown,
					context: unknown
				): Promise<{
					success: boolean;
					data?: Record<string, unknown>;
					error?: { code: string };
				}>;
			};
		const toastShow = byName('toast-show');
		const popoverOpen = byName('popover-open');
		const overlayList = byName('overlay-list');
		const overlayDismiss = byName('overlay-dismiss');

		// Open real app toast and popover through the commands in a forbidden project scope,
		// plus an in-scope app dialog, a confirmation prompt, and the agent's own toast.
		const secretToast = (
			await toastShow.handler(
				{ message: 'Secret project note' },
				{ interface: 'palette', caller: 'probe', scope: forbiddenScope }
			)
		).data as unknown as OverlayRefV1;
		const secretPopover = (
			await popoverOpen.handler(
				{ anchor: { surface: 'main', anchor: 'more' }, kind: 'info', body: 'Secret popover' },
				{ interface: 'palette', caller: 'probe', scope: forbiddenScope }
			)
		).data as unknown as OverlayRefV1;
		const allowedDialog = overlays.open(
			appOwner('probe'),
			'dialog',
			{ title: 'In-scope app dialog' },
			{ scope: allowedScope }
		);
		const confirmPrompt = overlays.open(
			SHELL,
			'prompt',
			{ title: 'Run Delete in Secret?' },
			{
				for: {
					command: 'doc-delete',
					caller: 'probe',
					kind: 'confirmation',
					scope: forbiddenScope,
					input: { token: 'top-secret' },
				},
			}
		);
		const agentCtx = {
			interface: 'agent',
			actor: { kind: 'agent', id: 'copilot' },
			scope: allowedScope,
		};
		const otherAgentCtx = {
			interface: 'agent',
			actor: { kind: 'agent', id: 'helper' },
			scope: allowedScope,
		};
		const ownToast = (await toastShow.handler({ message: 'My toast' }, agentCtx))
			.data as unknown as OverlayRefV1;
		overlays.land(ownToast.overlayId, 'ntf_1111111111111111');
		const otherAgentToast = (
			await toastShow.handler({ message: 'Other agent toast' }, otherAgentCtx)
		).data as unknown as OverlayRefV1;
		const noneCtx = { interface: 'mcp' };
		const humanCtx = { interface: 'palette' };

		// Unauthenticated / no-path caller sees no overlays and cannot dismiss.
		expect((await overlayList.handler({}, noneCtx)).data?.overlays).toEqual([]);
		expect(
			(
				await overlayDismiss.handler(
					{ overlayId: allowedDialog.overlayId, result: 'cancel' },
					noneCtx
				)
			).error?.code
		).toBe('HUMAN_REQUIRED');

		// Agent sees only its own in-scope overlays — never other apps' overlays (even in-scope),
		// other agents' overlays, or shell confirmation prompts.
		const agentSeen = ((await overlayList.handler({}, agentCtx)).data?.overlays ??
			[]) as OverlayV1[];
		expect(agentSeen.map((item) => item.overlayId)).toEqual([ownToast.overlayId]);
		expect(agentSeen[0]).not.toHaveProperty('hidden');
		expect(agentSeen[0]).not.toHaveProperty('notification');
		expect(agentSeen.map((item) => item.overlayId)).not.toContain(otherAgentToast.overlayId);
		expect(agentSeen.map((item) => item.overlayId)).not.toContain(allowedDialog.overlayId);
		expect(agentSeen.map((item) => item.overlayId)).not.toContain(confirmPrompt.overlayId);

		// Agent cannot dismiss out-of-scope app toasts or popovers opened through toast-show/popover-open.
		for (const id of [secretToast.overlayId, secretPopover.overlayId]) {
			expect(
				(await overlayDismiss.handler({ overlayId: id, result: 'dismissed' }, agentCtx)).error
					?.code,
				id
			).toBe('OVERLAY_NOT_FOUND');
		}
		// Phase 4 6.5: an agent may still cancel an in-scope app dialog by id, never answer it.
		expect(
			(
				await overlayDismiss.handler(
					{ overlayId: allowedDialog.overlayId, result: 'confirm' },
					agentCtx
				)
			).error?.code
		).toBe('HUMAN_REQUIRED');
		expect(
			(
				await overlayDismiss.handler(
					{ overlayId: allowedDialog.overlayId, result: 'cancel' },
					agentCtx
				)
			).success
		).toBe(true);

		// Human/shell still sees all overlays including confirmation for.input and out-of-scope records.
		const humanSeen = ((await overlayList.handler({}, humanCtx)).data?.overlays ??
			[]) as OverlayV1[];
		expect(
			humanSeen.find((item) => item.overlayId === confirmPrompt.overlayId)?.for?.input
		).toEqual({ token: 'top-secret' });
		expect(humanSeen.map((item) => item.overlayId)).toContain(secretToast.overlayId);
		expect(humanSeen.map((item) => item.overlayId)).toContain(secretPopover.overlayId);

		// Fail-closed when `allows` is omitted on a scoped overlay.
		const noAllows = createOverlayCommands({
			overlays,
			activeApp: () => 'probe',
			humanGesture: isHumanGesture,
		});
		const dismissNoAllows = noAllows.find(
			(command) => command.name === 'overlay-dismiss'
		) as unknown as {
			handler(input: unknown, context: unknown): Promise<{ error?: { code: string } }>;
		};
		expect(
			(
				await dismissNoAllows.handler(
					{ overlayId: secretToast.overlayId, result: 'dismissed' },
					agentCtx
				)
			).error?.code
		).toBe('OVERLAY_NOT_FOUND');
	});

	it('isolates overlay-list through the real kernel for agents and apps (#1867)', async () => {
		const { kernel, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const appToast = await probe.call<OverlayRefV1>('toast-show', { message: 'App private note' });
		const appDialog = await probe.call<OverlayRefV1>('dialog-open', { title: 'App question' });
		const agentToast = await kernel.agent.call<OverlayRefV1>('toast-show', {
			message: 'Agent own toast',
		});
		expect(appToast.success && appDialog.success && agentToast.success).toBe(true);

		// Agent sees only its own toast via overlay-list, never the app's toast or dialog.
		const agentListed =
			(await kernel.agent.call<{ overlays: OverlayV1[] }>('overlay-list')).data?.overlays ?? [];
		expect(agentListed.map((item) => item.overlayId)).toEqual([agentToast.data?.overlayId]);

		// Human/shell sees all three.
		const shellListed = await list(kernel);
		expect(shellListed.map((item) => item.overlayId)).toEqual([
			appToast.data?.overlayId,
			appDialog.data?.overlayId,
			agentToast.data?.overlayId,
		]);
	});
});

describe('P4-E7: the global strip (6.1)', () => {
	it('keeps one per id across a switch, refuses a dismissal, and is the shell’s alone', async () => {
		const { kernel, probe } = await boot();
		const first = await kernel.call<{ overlay: OverlayRefV1 }>('overlay-global-set', {
			id: 'offline',
			message: 'Offline',
		});
		expect(first.data?.overlay).toMatchObject({ owner: 'shell', kind: 'global' });
		await kernel.call('overlay-global-set', {
			id: 'offline',
			message: 'Still offline',
			tone: 'warning',
		});
		const strips = (await list(kernel)).filter((each) => each.kind === 'global');
		expect(strips.map((each) => each.input)).toEqual([
			{ id: 'offline', message: 'Still offline', tone: 'warning' },
		]);
		await kernel.call('app-open', { instance: 'probe' });
		await kernel.call('app-open', { instance: 'sums' });
		expect((await list(kernel)).filter((each) => each.kind === 'global')).toHaveLength(1);
		const id = strips[0]?.overlayId;
		expect(code(await kernel.call('overlay-dismiss', { overlayId: id }))).toBe('VALIDATION_ERROR');
		expect(code(await kernel.agent.call('overlay-global-set', { id: 'x', message: 'Hi' }))).toBe(
			'HUMAN_REQUIRED'
		);
		expect(code(await probe.call('overlay-global-set', { id: 'x', message: 'Hi' }))).toBe(
			'CALL_NOT_GRANTED'
		);
		// Its condition ends: withdrawn.
		const ended = await kernel.call<{ overlay: null }>('overlay-global-set', { id: 'offline' });
		expect(ended.data).toEqual({ overlay: null });
		expect(await list(kernel)).toEqual([]);
		const names = (
			await kernel.call<{ commands: Array<{ name: string }> }>('palette-search', {
				query: 'global',
			})
		).data;
		expect(JSON.stringify(names)).not.toContain('overlay-global-set');
	});
});

describe('P4-E7: a change of person and replay (6.2)', () => {
	it('closes every kind, parked dialogs and the strip included, with person', async () => {
		const { kernel, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const dialog = await probe.call<OverlayRefV1>('dialog-open', INPUTS['dialog-open']);
		const closed = probe.waitOverlay(dialog.data?.overlayId as string);
		await kernel.call('app-open', { instance: 'sums' });
		await kernel.call('prompt-open', INPUTS['prompt-open']);
		await kernel.call('overlay-global-set', { id: 'note', message: 'Hi' });
		await kernel.call('dialog-open', INPUTS['dialog-open']);
		expect(await list(kernel)).toHaveLength(4);
		const signedIn = await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'ada@example.com',
			password: 'secret-password',
		});
		expect(signedIn.success).toBe(true);
		expect(await list(kernel)).toEqual([]);
		expect(await closed).toMatchObject({ result: 'cancel', reason: 'person' });
	});

	it('P4-E15: P4-E7: replays every move of a dialog, a prompt, the slot, a modal with actions and the strip', async () => {
		const { kernel, journal, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const dialog = await probe.call<OverlayRefV1>('dialog-open', {
			title: 'Kept',
			actions: [{ id: 'keep', label: 'Keep' }],
		});
		await kernel.call('app-open', { instance: 'sums' });
		// The state between switches is journaled, so a replay compares each park and restore (the review's 16).
		const parked = await kernel.call<{ overlays: OverlayV1[] }>('overlay-list');
		expect(parked.data?.overlays.map((each) => each.state)).toEqual(['parked']);
		await kernel.call('app-open', { instance: 'probe' });
		const restored = await kernel.call<{ overlays: OverlayV1[] }>('overlay-list');
		expect(restored.data?.overlays.map((each) => each.state)).toEqual([undefined]);
		const prompt = await kernel.call<OverlayRefV1>('prompt-open', { title: 'Name?' });
		await kernel.call('modal-open', INPUTS['modal-open']);
		await kernel.call('overlay-dismiss', {
			overlayId: prompt.data?.overlayId,
			result: 'confirm',
			value: 'Ada',
		});
		await kernel.call('overlay-dismiss', { overlayId: dialog.data?.overlayId, result: 'keep' });
		// A modal with actions, answered by one, and the global strip set and ended (6.1, 6.4).
		const modal = await probe.call<OverlayRefV1>('modal-open', {
			...INPUTS['modal-open'],
			actions: [
				{ id: 'later', label: 'Later' },
				{ id: 'now', label: 'Now', tone: 'primary' },
			],
		});
		expect(modal.success, JSON.stringify(modal.error)).toBe(true);
		await kernel.call('overlay-dismiss', { overlayId: modal.data?.overlayId, result: 'now' });
		for (const input of [{ id: 'offline', message: 'Offline' }, { id: 'offline' }])
			expect((await kernel.call('overlay-global-set', input)).success).toBe(true);
		await kernel.agent.call('dialog-open', INPUTS['dialog-open']);
		const commands = (await journal.read()).map(({ command }) => command);
		expect(commands.filter((name) => name === 'overlay-global-set')).toHaveLength(2);
		const { report } = await replayKernel(await journal.read(), {
			deployment: probeDeployment(
				[entry('probe'), entry('sums'), entry('probev')],
				'https://sandbox.loam.test'
			),
			ports: createFixturePorts({
				'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
				'apps/sums/': { manifest: sumsManifest, definition: { sdk: 1, handlers: {} } as never },
				'apps/probev/': {
					manifest: probeViewManifest(),
					definition: probeDefinition('probev'),
					files: { 'handlers.html': '<!doctype html><title>H</title>' },
				},
			}),
		});
		expect(report.diverged).toBe(false);
		expect(report.same).toBe(report.entries.length);
		const names = report.entries.map((each) => each.command);
		for (const name of [
			'dialog-open',
			'prompt-open',
			'modal-open',
			'overlay-dismiss',
			'overlay-list',
			'overlay-global-set',
		])
			expect(names, name).toContain(name);
	});
});
