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
import { createKernel } from './kernel.js';
import { answerRule, createOverlayCommands, type Opener } from './late/overlay-commands.js';
import { promptValueFault } from './late/overlay-slot.js';
import { isHumanGesture } from './late/setting-rules.js';
import { appOwner, createOverlayStore, SHELL } from './overlays.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	PROBE_MANIFEST,
	probeDefinition,
	probeDeployment,
	probeViewManifest,
	replayKernel,
} from './testing.js';
import type { LoamKernelV5 } from './types.js';

const kernels: LoamKernelV5[] = [];
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

const list = async (kernel: LoamKernelV5) =>
	(await kernel.call<{ overlays: OverlayV1[] }>('overlay-list')).data?.overlays ?? [];
const code = (result: { error?: { code: string } }) => result.error?.code;

const INPUTS = {
	'dialog-open': { title: 'Note', body: 'Kept.' },
	'modal-open': { title: 'Sure?', body: 'Really.' },
	'prompt-open': { title: 'Name?' },
} as const;
type Opening = keyof typeof INPUTS;
const KINDS = Object.keys(INPUTS) as Opening[];

describe("6.1's table for dialogs, modals and prompts (P4-E7)", () => {
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

describe('dialogs (6.1, 6.2)', () => {
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

describe('an element (6.4)', () => {
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
		const answered = await kernel.call<OverlayResultV1>('overlay-dismiss', {
			overlayId: id,
			result: 'confirm',
		});
		expect(answered.data).toMatchObject({ result: 'confirm', value: 'Ada' });
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

describe("6.5's answer rule, and F6's cancels (P4-E7)", () => {
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
		expect(answerRule({ kind: 'none' }, undefined, SHELL, undefined, false)).toBe('HUMAN_REQUIRED');
	});
});

describe('the global strip (6.1)', () => {
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

describe('a change of person and replay (6.2)', () => {
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

	it('replays every move of a dialog, a prompt and the slot', async () => {
		const { kernel, journal, probe } = await boot();
		await kernel.call('app-open', { instance: 'probe' });
		const dialog = await probe.call<OverlayRefV1>('dialog-open', {
			title: 'Kept',
			actions: [{ id: 'keep', label: 'Keep' }],
		});
		await kernel.call('app-open', { instance: 'sums' });
		await kernel.call('app-open', { instance: 'probe' });
		const prompt = await kernel.call<OverlayRefV1>('prompt-open', { title: 'Name?' });
		await kernel.call('modal-open', INPUTS['modal-open']);
		await kernel.call('overlay-dismiss', {
			overlayId: prompt.data?.overlayId,
			result: 'confirm',
			value: 'Ada',
		});
		await kernel.call('overlay-dismiss', { overlayId: dialog.data?.overlayId, result: 'keep' });
		await kernel.agent.call('dialog-open', INPUTS['dialog-open']);
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
		for (const name of ['dialog-open', 'prompt-open', 'modal-open', 'overlay-dismiss'])
			expect(names, name).toContain(name);
	});
});
