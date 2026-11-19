/**
 * Phase 4's prompts and confirmations (its section 7, P4-E8's units): R7's human gestures signed out, R8's paths of
 * `palette-run` and the close prompt, R9's pending path (at once, the re-call, `confirmation-get`, the re-check on
 * confirm, withdrawal, expiry on a moved clock, `confirm: true`), R15's replacement of the input prompt, R16's window
 * (the input digest, an active app's port held, a person's gesture exempt), F4's four keys, F5's stored outcome and one
 * run, F9's order, the limit of 5, a change of person, F6's cancels of a confirmation in the slot, and replay.
 */
import type { CommandResult } from '@lushly-dev/afd-core';
import {
	type AppCallContextV1,
	defineApp,
	type ManifestV2,
	type NotificationV1,
	type OverlayRefV1,
	type OverlayV1,
	success,
} from '@lushly-dev/loam-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { createOverlayStore } from '../overlays.js';
import { personKey } from '../scope/access.js';
import { createScopedWorkspace, type ScopedWorkspace, scopedPackages } from '../scope/fixtures.js';
import { createFixturePorts, replayKernel } from '../testing.js';
import type { LoamKernelV5 } from '../types.js';
import {
	CONFIRMATION_TTL_MS,
	createConfirmations,
	DECLINE_WINDOW_MS,
	PENDING_LIMIT,
	promptSchemaOf,
} from './confirmations.js';
import { DOCUMENT_KIT } from './document-kit.js';

const kernels: LoamKernelV5[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const EMPTY = { type: 'object', properties: {}, additionalProperties: false };

/** An app whose two mutations declare a `confirm_prompt`: one with no input, one with a number. */
const KEEPER_MANIFEST = {
	manifest_version: 2,
	protocol: 1,
	plugin: {
		id: 'keeper',
		title: 'Keeper',
		version: '1.0.0',
		description: 'Keeps a count and a value, each changed only once the person confirms.',
		kind: 'native',
		domains: ['keeper'],
	},
	native: { entry: 'dist/native.js' },
	app: { scope_levels: ['workspace', 'project'] },
	grants: [{ name: 'store', reason: 'Keeps the count.' }],
	commands: [
		{
			name: 'keeper-bump',
			title: 'Add one',
			description: 'Add one to the count.',
			effects: ['store-write'],
			destructive: true,
			confirm_prompt: 'Add one to the count?',
			input_schema: EMPTY,
		},
		{
			name: 'keeper-set',
			title: 'Set the value',
			description: 'Set the value.',
			effects: ['store-write'],
			confirm_prompt: 'Set the value to the one given?',
			input_schema: {
				type: 'object',
				properties: { value: { type: 'integer', title: 'Value', minimum: 0 } },
				required: ['value'],
				additionalProperties: false,
			},
		},
		{
			name: 'keeper-get',
			title: 'Read the count',
			description: 'Read the count and the value.',
			effects: ['inspect'],
			input_schema: EMPTY,
		},
	],
	ui: { surfaces: { main: { element: 'keeper-main' } } },
} as unknown as ManifestV2;

const KEEPER = defineApp({
	sdk: 1,
	handlers: {
		'keeper-bump': (async (_input: unknown, context: AppCallContextV1) => {
			const held = (await context.store?.get<number>('count')) ?? 0;
			await context.store?.put('count', held + 1);
			return success({ count: held + 1 });
		}) as never,
		'keeper-set': (async (input: { value: number }, context: AppCallContextV1) => {
			await context.store?.put('value', input.value);
			return success({ value: input.value });
		}) as never,
		'keeper-get': (async (_input: unknown, context: AppCallContextV1) =>
			success({
				count: (await context.store?.get<number>('count')) ?? 0,
				value: (await context.store?.get<number>('value')) ?? null,
			})) as never,
	},
});

const deployment = () => ({
	deployment_version: 2 as const,
	generation: 'confirm',
	workspace: { id: 'personal', name: 'Personal' },
	sandbox_origin: null,
	apps: ['tasks', 'dual', 'solo', 'keeper'].map((id) => ({
		instance: id,
		app: id,
		package: `fixtures/${id}/`,
	})),
});
const ports = () =>
	createFixturePorts({
		...scopedPackages(),
		'fixtures/keeper/': { manifest: KEEPER_MANIFEST, definition: KEEPER },
	});

/** The scoped workspace with keeper, on a clock the test moves. */
async function boot(): Promise<ScopedWorkspace & { advance(ms: number): void }> {
	let now = 1_800_000_000_000;
	const workspace = await createScopedWorkspace({
		deployment: deployment(),
		ports: ports(),
		clock: () => now,
	});
	kernels.push(workspace.kernel);
	return Object.assign(workspace, {
		advance(ms: number) {
			now += ms;
		},
	});
}

type Listed = { notifications: NotificationV1[] };
const confirmations = async (kernel: LoamKernelV5) =>
	(
		(await kernel.call<Listed>('notification-list', { kind: 'confirmation', body: true }))
			.data as Listed
	).notifications;
const overlays = async (kernel: LoamKernelV5) =>
	(await kernel.call<{ overlays: OverlayV1[] }>('overlay-list')).data?.overlays ?? [];
const idOf = (result: CommandResult) =>
	(result.error?.details as { notification: string } | undefined)?.notification as string;
const count = async (kernel: LoamKernelV5) =>
	((await kernel.call<{ count: number }>('keeper-get')).data as { count: number }).count;

/** The slot's prompt once the waiting call has opened it. */
async function slotPrompt(kernel: LoamKernelV5): Promise<OverlayV1> {
	for (let tries = 0; tries < 200; tries++) {
		const held = (await overlays(kernel)).find(
			(overlay) => overlay.kind === 'prompt' && overlay.for?.kind === 'confirmation'
		);
		if (held) return held;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error('No confirmation opened in the slot');
}

describe('the pending path (R9)', () => {
	it('returns CONFIRMATION_PENDING at once with its details, and the same on a re-call', async () => {
		const { kernel } = await boot();
		const asked = await kernel.agent.call('keeper-bump');
		expect(asked.error).toMatchObject({
			code: 'CONFIRMATION_PENDING',
			retryable: true,
			suggestion: expect.stringContaining('confirmation-get'),
			details: { notification: expect.stringMatching(/^ntf_/), expiresAt: expect.any(Number) },
		});
		const again = await kernel.agent.call('keeper-bump');
		expect(again.error?.details).toEqual(asked.error?.details);
		const listed = await confirmations(kernel);
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({
			kind: 'confirmation',
			source: 'agent:shell-agent',
			title: 'Add one',
			tone: 'danger',
			confirmation: {
				command: 'keeper-bump',
				caller: 'agent:shell-agent',
				state: 'pending',
				prompt: 'Add one to the count?',
				header: 'Requested by shell-agent for you',
				input: {},
			},
		});
		// The kernel's own fields are never listed.
		expect(Object.keys(listed[0] as object)).not.toContain('ckey');
		expect(Object.keys(listed[0] as object)).not.toContain('cactor');
		expect(await count(kernel)).toBe(0);
		const read = await kernel.agent.call('confirmation-get', { notification: idOf(asked) });
		expect(read.data).toMatchObject({ state: 'pending' });
	});

	it('F5: once confirmed, the shell runs it once, and a re-call returns the stored outcome', async () => {
		const { kernel } = await boot();
		const asked = await kernel.agent.call('keeper-bump');
		const answered = await kernel.call('notification-act', {
			notification: idOf(asked),
			answer: 'confirm',
		});
		expect(answered.data).toEqual({ state: 'confirmed' });
		expect(await count(kernel)).toBe(1);
		const read = await kernel.agent.call<{ result: CommandResult }>('confirmation-get', {
			notification: idOf(asked),
		});
		expect(read.data).toMatchObject({
			state: 'confirmed',
			reason: 'person',
			result: { success: true, data: { count: 1 } },
		});
		const again = await kernel.agent.call('keeper-bump');
		expect(again).toMatchObject({ success: true, data: { count: 1 } });
		expect(await count(kernel)).toBe(1);
		// Answering again runs nothing more.
		expect(
			(await kernel.call('notification-act', { notification: idOf(asked), answer: 'confirm' })).data
		).toEqual({ state: 'confirmed' });
		expect(await count(kernel)).toBe(1);
		// Read: marked read by the person's answer.
		expect((await confirmations(kernel))[0]?.readAt).toEqual(expect.any(Number));
	});

	it('runs once for two confirms at once, and never after a withdrawal that won the race', async () => {
		const { kernel } = await boot();
		const asked = await kernel.agent.call('keeper-bump');
		const both = await Promise.all([
			kernel.call('notification-act', { notification: idOf(asked), answer: 'confirm' }),
			kernel.call('notification-act', { notification: idOf(asked), answer: 'confirm' }),
		]);
		expect(both.map((each) => (each.data as { state: string }).state).sort()).toEqual([
			'confirmed',
			'pending',
		]);
		expect(await count(kernel)).toBe(1);
		const second = await kernel.agent.call('keeper-set', { value: 4 });
		const [acted, withdrawn] = await Promise.all([
			kernel.call('notification-act', { notification: idOf(second), answer: 'confirm' }),
			kernel.agent.call('confirmation-withdraw', { notification: idOf(second) }),
		]);
		const value = (
			(await kernel.call<{ value: number | null }>('keeper-get')).data as {
				value: number | null;
			}
		).value;
		if (withdrawn.success) {
			expect((acted.data as { state: string }).state).toBe('withdrawn');
			expect(value).toBeNull();
		} else {
			expect((acted.data as { state: string }).state).toBe('confirmed');
			expect(value).toBe(4);
		}
	});

	it('declines, refuses the same call without asking, counts it, and runs nothing', async () => {
		const { kernel, advance } = await boot();
		const asked = await kernel.agent.call('keeper-bump');
		expect(
			(await kernel.call('notification-act', { notification: idOf(asked), answer: 'decline' })).data
		).toEqual({ state: 'declined' });
		const again = await kernel.agent.call('keeper-bump');
		expect(again.error).toMatchObject({
			code: 'CONFIRMATION_DECLINED',
			suggestion: expect.stringContaining('Ask'),
		});
		expect(await confirmations(kernel)).toHaveLength(1);
		expect((await confirmations(kernel))[0]?.confirmation?.declinedAgain).toBe(1);
		expect(
			(await kernel.agent.call('confirmation-get', { notification: idOf(asked) })).data
		).toMatchObject({ state: 'declined', reason: 'person' });
		// After its 10 minutes and the window, a re-call raises a new one.
		advance(CONFIRMATION_TTL_MS + DECLINE_WINDOW_MS);
		const later = await kernel.agent.call('keeper-bump');
		expect(later.error?.code).toBe('CONFIRMATION_PENDING');
		expect(idOf(later)).not.toBe(idOf(asked));
		expect(await count(kernel)).toBe(0);
	});

	it('R16: the window keys on the input digest, so a different input still asks', async () => {
		const { kernel } = await boot();
		const asked = await kernel.agent.call('keeper-set', { value: 1 });
		await kernel.call('notification-act', { notification: idOf(asked), answer: 'decline' });
		expect((await kernel.agent.call('keeper-set', { value: 1 })).error?.code).toBe(
			'CONFIRMATION_DECLINED'
		);
		expect((await kernel.agent.call('keeper-set', { value: 2 })).error?.code).toBe(
			'CONFIRMATION_PENDING'
		);
	});

	it('withdraws: withdrawn, with no window, and only the raising caller', async () => {
		const { kernel } = await boot();
		const asked = await kernel.agent.call('keeper-bump');
		// No one but the caller that raised it reads or withdraws it.
		expect(
			(await kernel.call('confirmation-withdraw', { notification: idOf(asked) })).error?.code
		).toBe('NOTIFICATION_NOT_FOUND');
		expect(
			(await kernel.appPort('keeper').call('confirmation-get', { notification: idOf(asked) })).error
				?.code
		).toBe('NOTIFICATION_NOT_FOUND');
		expect(
			(await kernel.agent.call('confirmation-withdraw', { notification: idOf(asked) })).data
		).toEqual({ state: 'withdrawn' });
		expect(
			(await kernel.agent.call('confirmation-withdraw', { notification: idOf(asked) })).error?.code
		).toBe('VALIDATION_ERROR');
		// No window: the same call raises a new one at once.
		const again = await kernel.agent.call('keeper-bump');
		expect(again.error?.code).toBe('CONFIRMATION_PENDING');
		expect(idOf(again)).not.toBe(idOf(asked));
		// A withdrawn one is answered as it is: nothing runs.
		expect(
			(await kernel.call('notification-act', { notification: idOf(asked), answer: 'confirm' })).data
		).toEqual({ state: 'withdrawn' });
		expect(await count(kernel)).toBe(0);
	});

	it('expires after 10 minutes on the clock: CONFIRMATION_EXPIRED in its result, then a new one', async () => {
		const { kernel, advance } = await boot();
		const asked = await kernel.agent.call('keeper-bump');
		advance(CONFIRMATION_TTL_MS);
		expect(
			(await kernel.agent.call('confirmation-get', { notification: idOf(asked) })).data
		).toMatchObject({
			state: 'expired',
			result: { success: false, error: { code: 'CONFIRMATION_EXPIRED' } },
		});
		expect((await confirmations(kernel))[0]?.confirmation?.state).toBe('expired');
		expect(
			(await kernel.call('notification-act', { notification: idOf(asked), answer: 'confirm' })).data
		).toEqual({ state: 'expired' });
		const again = await kernel.agent.call('keeper-bump');
		expect(again.error?.code).toBe('CONFIRMATION_PENDING');
		expect(idOf(again)).not.toBe(idOf(asked));
		expect(await count(kernel)).toBe(0);
	});

	it(`holds at most ${PENDING_LIMIT} per caller: a sixth is RATE_LIMITED with its details`, async () => {
		const { kernel, advance } = await boot();
		for (let value = 0; value < PENDING_LIMIT; value++) {
			expect((await kernel.agent.call('keeper-set', { value })).error?.code).toBe(
				'CONFIRMATION_PENDING'
			);
			advance(1_000);
		}
		const refused = await kernel.agent.call('keeper-set', { value: 9 });
		expect(refused.error).toMatchObject({
			code: 'RATE_LIMITED',
			retryable: true,
			details: { limit: PENDING_LIMIT, retryAfterMs: CONFIRMATION_TTL_MS - 5_000 },
		});
		// Per caller: an app's own is not held by the agent's.
		await kernel.call('app-open', { instance: 'dual' });
		expect((await kernel.appPort('keeper').call('keeper-set', { value: 9 })).error?.code).toBe(
			'CONFIRMATION_PENDING'
		);
	});

	it('F4: an app and an agent, and the agent in two projects, raise four separate confirmations', async () => {
		const { kernel, scopes } = await boot();
		await kernel.call('app-open', { instance: 'dual' });
		const ids = [
			idOf(await kernel.appPort('keeper').call('keeper-bump')),
			idOf(await kernel.agent.call('keeper-bump')),
			idOf(await kernel.agent.call('keeper-bump', {}, { scope: scopes.atlas })),
			idOf(await kernel.agent.call('keeper-bump', {}, { scope: scopes.beacon })),
		];
		expect(new Set(ids).size).toBe(4);
		expect(ids.every((id) => /^ntf_/.test(id))).toBe(true);
		const listed = await confirmations(kernel);
		expect(listed.find((each) => each.id === ids[0])?.confirmation).toMatchObject({
			caller: 'keeper',
			header: 'Keeper asks to run Add one',
		});
		const atlas = (
			await kernel.call<Listed>(
				'notification-list',
				{ kind: 'confirmation' },
				{ scope: scopes.atlas }
			)
		).data?.notifications.find((each) => each.id === ids[2]);
		expect(atlas?.confirmation?.header).toBe('Requested by shell-agent for you, in Atlas');
	});

	it('F9: invalid input and a project the caller may not enter raise none; access lost on confirm ends it declined', async () => {
		const { kernel, scopes } = await boot();
		expect((await kernel.agent.call('keeper-set', { value: 'x' })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
		const citadel = await kernel.agent.call('keeper-bump', {}, { scope: scopes.citadel });
		expect(citadel.error?.code).toBe('PROJECT_NOT_FOUND');
		expect(await confirmations(kernel)).toHaveLength(0);
		// `confirm: true` never confirms: refused by the strict schema, naming confirmation-get.
		const forged = await kernel.agent.call('keeper-bump', { confirm: true });
		expect(forged.error?.code).toBe('VALIDATION_ERROR');
		expect(forged.error?.suggestion).toContain('confirmation-get');
		expect(await confirmations(kernel)).toHaveLength(0);
		// Raised in Atlas, then the app is disabled before the person confirms: declined for access, nothing runs.
		const asked = await kernel.agent.call('keeper-bump', {}, { scope: scopes.atlas });
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		expect(
			(await kernel.call('workspace-app-set', { instance: 'keeper', enabled: false })).success
		).toBe(true);
		const answered = await kernel.call(
			'notification-act',
			{ notification: idOf(asked), answer: 'confirm' },
			{ scope: scopes.atlas }
		);
		expect(answered.data).toEqual({ state: 'declined', reason: 'access' });
		expect(
			(
				await kernel.agent.call(
					'confirmation-get',
					{ notification: idOf(asked) },
					{ scope: scopes.atlas }
				)
			).data
		).toMatchObject({ state: 'declined', reason: 'access' });
		await kernel.call('workspace-app-set', { instance: 'keeper', enabled: null });
		expect(await count(kernel)).toBe(0);
	});

	it('a change of person withdraws the leaving person’s pending confirmations', async () => {
		const { kernel } = await boot();
		const asked = await kernel.agent.call('keeper-bump');
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'ana@example.com',
			password: 'x',
		});
		await kernel.call('auth-sign-out');
		const read = await kernel.agent.call('confirmation-get', { notification: idOf(asked) });
		expect(read.data).toMatchObject({ state: 'withdrawn' });
	});

	it('the unload seam withdraws an app’s pending confirmations, and never opens the window (R14)', async () => {
		const store = new (await import('@lushly-dev/local-db')).MemoryAdapter();
		const made = createConfirmations({
			store,
			workspace: () => 'personal',
			provider: false,
			overlays: createOverlayStore(),
			openerOf: () => ({ kind: 'agent', owner: { kind: 'agent', id: 'agent:a' }, bucket: 'x' }),
			isActive: async () => false,
			askedFor: () => ({ prompt: 'Sure?', instance: 'keeper', title: 'Bump', danger: false }),
			paletteCommand: () => undefined,
			inputFault: () => undefined,
			allows: () => true,
			served: () => undefined,
			appTitle: (instance) => instance,
			projectName: () => undefined,
			personLabel: () => null,
			runNow: async () => success({}),
			runBoot: async () => success({}),
			replaying: () => false,
			noteInbox: () => {},
			digest: async (value) => JSON.stringify(value),
			kit: { ...DOCUMENT_KIT, personKey } as never,
		});
		const context = {
			actor: { kind: 'agent', id: 'a', onBehalfOf: 'local' },
			interface: 'agent',
		} as never;
		const raised = await made.gate('keeper-bump', {}, context, async () => success({}));
		expect(raised.error?.code).toBe('CONFIRMATION_PENDING');
		expect(await made.withdraw(context, (row) => row.confirmation.command === 'keeper-bump')).toBe(
			1
		);
		const again = await made.gate('keeper-bump', {}, context, async () => success({}));
		expect(again.error?.code).toBe('CONFIRMATION_PENDING');
		expect(idOf(again)).not.toBe(idOf(raised));
	});
});

describe('the slot (a person’s gesture, the active app’s port)', () => {
	it("R7: a person's call waits in the slot, signed out, and runs on their confirm", async () => {
		const { kernel } = await boot();
		const waiting = kernel.call('keeper-bump');
		const prompt = await slotPrompt(kernel);
		expect(prompt).toMatchObject({
			owner: 'shell',
			input: { title: 'Run Add one?', body: 'Add one to the count?', danger: true },
			for: { command: 'keeper-bump', kind: 'confirmation', input: {} },
		});
		expect(prompt.from).toBeUndefined();
		// The slot is held: nothing else opens, and nothing runs.
		expect((await kernel.call('keeper-set', { value: 1 })).error?.code).toBe('OVERLAY_MODAL_BUSY');
		// F6: the agent's cancel is refused; only the person answers.
		expect(
			(
				await kernel.agent.call('overlay-dismiss', {
					overlayId: prompt.overlayId,
					result: 'cancel',
				})
			).error?.code
		).toBe('HUMAN_REQUIRED');
		expect(
			(
				await kernel.agent.call('overlay-dismiss', {
					overlayId: prompt.overlayId,
					result: 'confirm',
				})
			).error?.code
		).toBe('HUMAN_REQUIRED');
		expect(
			(await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' }))
				.success
		).toBe(true);
		expect(await waiting).toMatchObject({ success: true, data: { count: 1 } });
		expect(await confirmations(kernel)).toHaveLength(0);
	});

	it("a person's decline is CONFIRMATION_DECLINED, and their gesture is exempt from the window", async () => {
		const { kernel } = await boot();
		const waiting = kernel.call('keeper-bump');
		const prompt = await slotPrompt(kernel);
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'cancel' });
		expect((await waiting).error?.code).toBe('CONFIRMATION_DECLINED');
		const again = kernel.call('keeper-bump');
		const next = await slotPrompt(kernel);
		await kernel.call('overlay-dismiss', { overlayId: next.overlayId, result: 'confirm' });
		expect((await again).success).toBe(true);
	});

	it("the active app's port asks with the shell's header; its decline holds the port, a person's gesture not", async () => {
		const { kernel } = await boot();
		await kernel.call('app-open', { instance: 'keeper' });
		const keeper = kernel.appPort('keeper');
		const waiting = keeper.call('keeper-set', { value: 3 });
		const prompt = await slotPrompt(kernel);
		expect(prompt).toMatchObject({
			owner: 'shell',
			input: { title: 'Keeper asks to run Set the value' },
			for: { command: 'keeper-set', caller: 'keeper', input: { value: 3 } },
		});
		// F6: an unrelated port's cancel is refused.
		expect(
			(
				await kernel
					.appPort('dual')
					.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'cancel' })
			).error?.code
		).toBe('HUMAN_REQUIRED');
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'cancel' });
		expect((await waiting).error?.code).toBe('CONFIRMATION_DECLINED');
		// R16: held by the window without asking; a different input asks.
		expect((await keeper.call('keeper-set', { value: 3 })).error?.code).toBe(
			'CONFIRMATION_DECLINED'
		);
		expect((await overlays(kernel)).some((each) => each.kind === 'prompt')).toBe(false);
		const other = keeper.call('keeper-set', { value: 4 });
		await kernel.call('overlay-dismiss', {
			overlayId: (await slotPrompt(kernel)).overlayId,
			result: 'cancel',
		});
		expect((await other).error?.code).toBe('CONFIRMATION_DECLINED');
		// The person's own gesture on the same input is exempt.
		const mine = kernel.call('keeper-set', { value: 3 });
		await kernel.call('overlay-dismiss', {
			overlayId: (await slotPrompt(kernel)).overlayId,
			result: 'confirm',
		});
		expect((await mine).data).toEqual({ value: 3 });
	});

	it("F6: the raising app's cancel of its own confirmation ends it withdrawn, with no window", async () => {
		const { kernel } = await boot();
		await kernel.call('app-open', { instance: 'keeper' });
		const keeper = kernel.appPort('keeper');
		const waiting = keeper.call('keeper-bump');
		const prompt = await slotPrompt(kernel);
		expect(
			(await keeper.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' }))
				.error?.code
		).toBe('HUMAN_REQUIRED');
		const withdrawn = await keeper.call<{ reason: string }>('overlay-dismiss', {
			overlayId: prompt.overlayId,
			result: 'cancel',
		});
		expect(withdrawn.data?.reason).toBe('withdrawn');
		expect((await waiting).error).toMatchObject({
			code: 'CONFIRMATION_DECLINED',
			details: { reason: 'withdrawn' },
		});
		// No window: asked again.
		const again = keeper.call('keeper-bump');
		await kernel.call('overlay-dismiss', {
			overlayId: (await slotPrompt(kernel)).overlayId,
			result: 'confirm',
		});
		expect((await again).data).toEqual({ count: 1 });
	});

	it('a change of person ends a waiting slot call, running nothing', async () => {
		const { kernel } = await boot();
		const waiting = kernel.call('keeper-bump');
		await slotPrompt(kernel);
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'ana@example.com',
			password: 'x',
		});
		expect((await waiting).error?.code).toBe('SESSION_CHANGED');
		expect(await count(kernel)).toBe(0);
	});
});

describe("palette-run, the palette's input prompt (7.1)", () => {
	it('R8: human only: HUMAN_REQUIRED from the agent interface, CALL_NOT_GRANTED from a port', async () => {
		const { kernel } = await boot();
		expect((await kernel.agent.call('palette-run', { command: 'keeper-set' })).error?.code).toBe(
			'HUMAN_REQUIRED'
		);
		await kernel.call('app-open', { instance: 'keeper' });
		expect(
			(await kernel.appPort('keeper').call('palette-run', { command: 'keeper-set' })).error?.code
		).toBe('CALL_NOT_GRANTED');
	});

	it('opens a prompt of the input’s fields, refuses a stale one, keeps it open on bad input, and runs it', async () => {
		const { kernel } = await boot();
		const opened = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'dual-put',
		});
		expect(opened.data?.prompt).toMatchObject({ kind: 'prompt', owner: 'shell' });
		const prompt = opened.data?.prompt.overlayId as string;
		const shown = (await overlays(kernel)).find((each) => each.overlayId === prompt);
		expect(shown?.for).toEqual({ command: 'dual-put', kind: 'input' });
		expect((shown?.input as { schema?: unknown } | undefined)?.schema).toMatchObject({
			type: 'object',
			required: ['key', 'value'],
		});
		// The slot is held while it is open.
		expect((await kernel.call('palette-open')).error?.code).toBe('OVERLAY_MODAL_BUSY');
		// A prompt opened for another command, or none, is OVERLAY_NOT_FOUND, and nothing runs.
		expect(
			(await kernel.call('palette-run', { command: 'dual-get', prompt, input: { key: 'a' } })).error
				?.code
		).toBe('OVERLAY_NOT_FOUND');
		expect(
			(await kernel.call('palette-run', { command: 'dual-put', prompt: 'ovl-999', input: {} }))
				.error?.code
		).toBe('OVERLAY_NOT_FOUND');
		// A confirm by overlay-dismiss runs nothing: the prompt is filled by palette-run alone.
		expect(
			(await kernel.call('overlay-dismiss', { overlayId: prompt, result: 'confirm', value: {} }))
				.error?.code
		).toBe('VALIDATION_ERROR');
		const bad = await kernel.call('palette-run', {
			command: 'dual-put',
			prompt,
			input: { key: 'a' },
		});
		expect(bad.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { overlay: prompt } });
		expect((await overlays(kernel)).some((each) => each.overlayId === prompt)).toBe(true);
		const ran = await kernel.call('palette-run', {
			command: 'dual-put',
			prompt,
			input: { key: 'a', value: 'b' },
		});
		expect(ran.success).toBe(true);
		expect((await overlays(kernel)).some((each) => each.overlayId === prompt)).toBe(false);
		expect((await kernel.call('dual-get', { key: 'a' })).success).toBe(true);
		// The prompt is gone: filling it again is OVERLAY_NOT_FOUND.
		expect(
			(
				await kernel.call('palette-run', {
					command: 'dual-put',
					prompt,
					input: { key: 'a', value: 'c' },
				})
			).error?.code
		).toBe('OVERLAY_NOT_FOUND');
	});

	it('R15: a confirm_prompt command’s confirmation replaces the input prompt in the slot, showing the input', async () => {
		const { kernel } = await boot();
		const opened = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'keeper-set',
		});
		const prompt = opened.data?.prompt.overlayId as string;
		const running = kernel.call('palette-run', {
			command: 'keeper-set',
			prompt,
			input: { value: 7 },
		});
		const confirmation = await slotPrompt(kernel);
		expect(confirmation.for).toEqual({
			command: 'keeper-set',
			kind: 'confirmation',
			input: { value: 7 },
		});
		expect((await overlays(kernel)).some((each) => each.overlayId === prompt)).toBe(false);
		await kernel.call('overlay-dismiss', { overlayId: confirmation.overlayId, result: 'confirm' });
		expect((await running).data).toEqual({ value: 7 });
	});

	it('derives plain fields only, and none for a command that takes none', () => {
		expect(promptSchemaOf(EMPTY)).toEqual({ type: 'object', properties: {} });
		expect(
			promptSchemaOf({
				type: 'object',
				properties: { n: { type: 'integer', minimum: 1, pattern: 'x', title: 'N' } },
				required: ['n', 'gone'],
			})
		).toEqual({
			type: 'object',
			properties: { n: { type: 'integer', minimum: 1, title: 'N' } },
			required: ['n'],
		});
		expect(
			promptSchemaOf({ type: 'object', properties: { a: { type: 'array' } } })
		).toBeUndefined();
		expect(promptSchemaOf({ type: 'string' })).toBeUndefined();
	});

	it("closes the replaced input prompt with reason 'replaced' (6.2)", async () => {
		const store = createOverlayStore();
		const made = createConfirmations({
			overlays: store,
			runBoot: async () => success({}),
			kit: { ...DOCUMENT_KIT, personKey } as never,
		} as never);
		const input = store.open(
			{ kind: 'shell', id: 'shell' },
			'prompt',
			{ title: 'Set' },
			{
				for: { command: 'keeper-set', kind: 'input' },
			}
		);
		const opened = (await made.settle.handler(
			{
				close: input.overlayId,
				reason: 'replaced',
				open: {
					id: 'cnf_1',
					key: 'k',
					command: 'keeper-set',
					header: 'Run Set?',
					prompt: 'Sure?',
					danger: false,
					input: { value: 1 },
				},
			},
			{} as never
		)) as CommandResult<{ overlay: OverlayRefV1 }>;
		expect(store.movesOf(input.overlayId)).toEqual(['replaced']);
		expect(store.forOf(opened.data?.overlay.overlayId as string)).toEqual({
			command: 'keeper-set',
			kind: 'confirmation',
			input: { value: 1 },
		});
	});
});

describe('replay (P4-E15)', () => {
	it('replays a pending confirm, a slot confirm and palette-run the same, running each once', async () => {
		const { kernel, journal } = await boot();
		const asked = await kernel.agent.call('keeper-bump');
		await kernel.call('notification-act', { notification: idOf(asked), answer: 'confirm' });
		const waiting = kernel.call('keeper-bump');
		await kernel.call('overlay-dismiss', {
			overlayId: (await slotPrompt(kernel)).overlayId,
			result: 'confirm',
		});
		await waiting;
		const opened = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'keeper-set',
		});
		const running = kernel.call('palette-run', {
			command: 'keeper-set',
			prompt: opened.data?.prompt.overlayId,
			input: { value: 5 },
		});
		await kernel.call('overlay-dismiss', {
			overlayId: (await slotPrompt(kernel)).overlayId,
			result: 'confirm',
		});
		await running;
		const filled = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'dual-put',
		});
		await kernel.call('palette-run', {
			command: 'dual-put',
			prompt: filled.data?.prompt.overlayId,
			input: { key: 'k', value: 'v' },
		});
		const declined = await kernel.agent.call('keeper-set', { value: 8 });
		await kernel.call('notification-act', { notification: idOf(declined), answer: 'decline' });
		await kernel.agent.call('keeper-set', { value: 8 });
		const live = (await kernel.call('keeper-get')).data;
		expect(live).toEqual({ count: 2, value: 5 });
		const { report, kernel: replayed } = await replayKernel(await journal.read(), {
			keep: true,
			deployment: deployment(),
			ports: ports(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		if (!replayed) throw new Error('replayKernel kept no kernel');
		try {
			expect((await replayed.call('keeper-get')).data).toEqual(live);
			expect(await confirmations(replayed)).toEqual(await confirmations(kernel));
		} finally {
			await replayed.dispose();
		}
	});
});

describe('the run a person confirmed', () => {
	it("is the shell's alone: a call carrying a confirmation's id from anyone else runs nothing", async () => {
		const { kernel } = await boot();
		const asked = await kernel.agent.call('keeper-bump');
		// No caller can set the kernel's field; the gate refuses a run it did not approve, even from the kernel.
		const made = createConfirmations({
			store: new (await import('@lushly-dev/local-db')).MemoryAdapter(),
			workspace: () => 'personal',
			provider: false,
			replaying: () => false,
			noteInbox: () => {},
			kit: { ...DOCUMENT_KIT, personKey } as never,
		} as never);
		const refused = await made.gate(
			'keeper-bump',
			{},
			{ confirmation: idOf(asked), actor: { kind: 'human', id: 'local' } } as never,
			async () => success({ ran: true })
		);
		expect(refused.error?.code).toBe('HUMAN_REQUIRED');
		expect(await count(kernel)).toBe(0);
	});
});
