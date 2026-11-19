/**
 * Phase 4's prompts and confirmations (its section 7, P4-E8's units): R7's human gestures signed out, R8's paths of
 * `palette-run` and the close prompt, R9's pending path (at once, the re-call, `confirmation-get`, the re-check on
 * confirm, withdrawal, expiry on a moved clock, `confirm: true`), R15's replacement of the input prompt, R16's window
 * (the input digest, an active app's port held, a person's gesture exempt), F4's four keys, F5's stored outcome and one
 * run, F9's order, the limit of 5, a change of person, F6's cancels of a confirmation in the slot, and replay.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { CommandResult } from '@lushly-dev/afd-core';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { type BootProjectionV2, readBoot } from '@lushly-dev/loam-manifest';
import {
	type AppCallContextV1,
	defineApp,
	type ManifestV2,
	type NotificationV1,
	type OverlayRefV1,
	type OverlayV1,
	success,
} from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernel, redactJournalRecord, redactWrapped } from '../kernel.js';
import { createOverlayStore } from '../overlays.js';
import { personKey } from '../scope/access.js';
import { createScopedWorkspace, type ScopedWorkspace, scopedPackages } from '../scope/fixtures.js';
import { createFixedEnvironment, createFixturePorts, replayKernel } from '../testing.js';
import { PROBE_DOCUMENTS_DEFINITION, PROBE_DOCUMENTS_MANIFEST } from '../testing-documents.js';
import type { LoamKernelV5 } from '../types.js';
import {
	bucketOf,
	CONFIRMATION_TTL_MS,
	createConfirmations,
	DECLINE_WINDOW_MS,
	ownedBy,
	PENDING_LIMIT,
	PERSON_LIMIT,
	promptSchemaOf,
	REPLACES,
	SLOT_KEPT,
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
			name: 'keeper-note',
			title: 'Keep a note',
			description: 'Keep a long note.',
			effects: ['store-write'],
			confirm_prompt: 'Keep this note?',
			input_schema: {
				type: 'object',
				properties: { text: { type: 'string', maxLength: 100000 } },
				required: ['text'],
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
		'keeper-note': (async (input: { text: string }) => success({ text: input.text })) as never,
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
		// A withdrawal that lost the race answers where it stands (improvement 15), never a refusal.
		if ((withdrawn.data as { state: string }).state === 'withdrawn') {
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
		// Withdrawn again: it answers where it stands.
		expect(
			(await kernel.agent.call('confirmation-withdraw', { notification: idOf(asked) })).data
		).toEqual({ state: 'withdrawn' });
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
			journaled: () => true,
			allows: () => true,
			served: () => undefined,
			appTitle: (instance) => instance,
			projectName: () => undefined,
			personLabel: () => null,
			runNow: async () => success({}),
			runBoot: async () => success({}),
			replaying: () => false,
			noteInbox: () => {},
			releaseQueue: () => {},
			chainOf: () => undefined,
			inputOver: () => false,
			archived: () => false,
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
		// The scope it opened in, which its fill runs in (blocker 10).
		expect(shown?.for).toEqual({
			command: 'dual-put',
			kind: 'input',
			scope: { workspace: 'personal' },
		});
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
			releaseQueue: () => {},
			chainOf: () => undefined,
			inputOver: () => false,
			archived: () => false,
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

describe('after the trust review', () => {
	it("R1: one person's agents share a bucket, whatever name each gives", async () => {
		const { kernel } = await boot();
		const asked = await kernel.agent.call('keeper-bump', {}, { agent: 'ada' });
		const again = await kernel.agent.call('keeper-bump', {}, { agent: 'bea' });
		// The same key: a renamed agent is the same caller, so it raises none and the window would hold it too.
		expect(idOf(again)).toBe(idOf(asked));
		expect(
			(await kernel.agent.call('confirmation-get', { notification: idOf(asked) }, { agent: 'bea' }))
				.data
		).toMatchObject({ state: 'pending' });
		// The limit counts the bucket, not the name.
		for (let value = 0; value < PENDING_LIMIT - 1; value++)
			await kernel.agent.call('keeper-set', { value }, { agent: `agent-${value}` });
		const refused = await kernel.agent.call('keeper-set', { value: 9 }, { agent: 'cy' });
		expect(refused.error).toMatchObject({
			code: 'RATE_LIMITED',
			details: { limit: PENDING_LIMIT },
		});
		// The outcome is the raiser's: the person's list carries none, the agent's does.
		await kernel.call('notification-act', { notification: idOf(asked), answer: 'confirm' });
		const own = (await confirmations(kernel)).find((each) => each.id === idOf(asked));
		expect(own?.confirmation?.result).toBeUndefined();
		const agents = (
			(await kernel.agent.call<Listed>('notification-list', { kind: 'confirmation', body: true }))
				.data as Listed
		).notifications.find((each) => each.id === idOf(asked));
		expect(agents?.confirmation?.result).toMatchObject({ success: true, data: { count: 1 } });
	});

	it("second round's 5: an app named person or agents is never the shell's or an agent's bucket", () => {
		const person = bucketOf({ kind: 'shell', owner: { kind: 'shell', id: 'shell' } });
		const named = bucketOf({ kind: 'app', owner: { kind: 'app', id: 'person' } });
		const agents = bucketOf({
			kind: 'agent',
			owner: { kind: 'agent', id: 'agent:a' },
			bucket: 'agents:local',
		});
		expect(named).toBe('app:person');
		expect(
			new Set([
				person,
				named,
				agents,
				bucketOf({ kind: 'app', owner: { kind: 'app', id: 'agents' } }),
			]).size
		).toBe(4);
		// One rule for get, withdraw and a list's result: the raiser's bucket alone, never a person's own gesture.
		expect(ownedBy({ cbucket: 'app:person' }, named)).toBe(true);
		expect(ownedBy({ cbucket: 'person' }, person)).toBe(false);
		expect(ownedBy({ cbucket: 'app:person' }, person)).toBe(false);
		expect(ownedBy({ cbucket: 'app:keeper', cslot: true }, 'app:keeper')).toBe(false);
	});

	it('R3: every confirmation within its life counts, and a withdrawn one is marked read', async () => {
		const { kernel } = await boot();
		for (let value = 0; value < PENDING_LIMIT; value++) {
			const asked = await kernel.agent.call('keeper-set', { value });
			await kernel.agent.call('confirmation-withdraw', { notification: idOf(asked) });
		}
		expect((await kernel.agent.call('keeper-set', { value: 9 })).error?.code).toBe('RATE_LIMITED');
		expect((await confirmations(kernel)).every((each) => each.readAt !== undefined)).toBe(true);
	});

	it(`R3: a person holds at most ${PERSON_LIMIT} live confirmations from every caller together`, async () => {
		let caller = 0;
		const made = createConfirmations({
			store: new MemoryAdapter(),
			workspace: () => 'personal',
			provider: false,
			overlays: createOverlayStore(),
			openerOf: () => ({ kind: 'app', owner: { kind: 'app', id: `app${caller}` } }),
			isActive: async () => false,
			askedFor: () => ({ prompt: 'Sure?', instance: 'keeper', title: 'Bump', danger: false }),
			paletteCommand: () => undefined,
			inputFault: () => undefined,
			journaled: () => true,
			allows: () => true,
			served: () => undefined,
			appTitle: (instance) => instance,
			projectName: () => undefined,
			personLabel: () => null,
			runNow: async () => success({}),
			runBoot: async () => success({}),
			replaying: () => false,
			noteInbox: () => {},
			releaseQueue: () => {},
			chainOf: () => undefined,
			inputOver: () => false,
			archived: () => false,
			digest: async (value) => JSON.stringify(value),
			kit: { ...DOCUMENT_KIT, personKey } as never,
		});
		const context = { actor: { kind: 'human', id: 'local' }, interface: 'palette' } as never;
		for (caller = 0; caller < PERSON_LIMIT; caller++) {
			const raised = await made.gate('keeper-bump', {}, context, async () => success({}));
			expect(raised.error?.code).toBe('CONFIRMATION_PENDING');
		}
		const refused = await made.gate('keeper-bump', {}, context, async () => success({}));
		expect(refused.error).toMatchObject({ code: 'RATE_LIMITED', details: { limit: PERSON_LIMIT } });
	});

	it("R4: palette-run's entry is redacted as its target's would be, and a oneOf input is never a form", async () => {
		const { kernel, journal } = await boot();
		expect((await kernel.call('palette-run', { command: 'auth-sign-in' })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
		await kernel.call('palette-run', {
			command: 'auth-sign-in',
			prompt: 'ovl-1',
			input: { method: 'credentials', email: 'ana@example.com', password: 'hunter2' },
		});
		// A wrapper inside a wrapper, refused: each level is redacted by its own target's rule (second round, 1).
		await kernel.call('palette-run', {
			command: 'palette-run',
			prompt: 'ovl-1',
			input: {
				command: 'auth-sign-in',
				prompt: 'ovl-2',
				input: { method: 'credentials', email: 'ana@example.com', password: 'hunter2' },
			},
		});
		const text = JSON.stringify(await journal.read());
		expect(text).not.toContain('hunter2');
		// And a confirmation's input the slot journals is redacted as its command's own entry would be.
		const sign = { method: 'credentials', email: 'a@b.c', password: 'hunter3' };
		const redacted = redactWrapped(
			{
				command: 'prompt-settle',
				input: { open: { id: 'cnf_1', command: 'auth-sign-in', input: sign } },
			} as never,
			(record) => redactJournalRecord(record)
		);
		expect(JSON.stringify(redacted)).not.toContain('hunter3');
		// An input no command names is dropped, never kept.
		expect(
			redactWrapped(
				{ command: 'palette-run', input: { input: { password: 'x' } } } as never,
				(r) => r
			).input
		).toEqual({});
		expect(promptSchemaOf({ type: 'object', oneOf: [{ properties: {} }] })).toBeUndefined();
	});

	it('blocker 5: the slot re-checks access before the run; an app disabled while it waits runs nothing', async () => {
		const { kernel } = await boot();
		const waiting = kernel.call('keeper-bump');
		const prompt = await slotPrompt(kernel);
		await kernel.call('workspace-app-set', { instance: 'keeper', enabled: false });
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' });
		expect((await waiting).error).toMatchObject({
			code: 'CONFIRMATION_DECLINED',
			details: { reason: 'access' },
		});
		await kernel.call('workspace-app-set', { instance: 'keeper', enabled: null });
		expect(await count(kernel)).toBe(0);
	});

	it("second round's 4: a project archived while the slot waits takes no run, and replays the same (third round, C)", async () => {
		const { kernel, scopes, journal } = await boot();
		const waiting = kernel.call('keeper-bump', {}, { scope: scopes.atlas });
		const prompt = await slotPrompt(kernel);
		expect((await kernel.call('project-archive', { project: 'atlas' })).success).toBe(true);
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' });
		expect((await waiting).error).toMatchObject({
			code: 'CONFIRMATION_DECLINED',
			details: { reason: 'access' },
		});
		expect(await count(kernel)).toBe(0);
		const { report } = await replayKernel(await journal.read(), {
			deployment: deployment(),
			ports: ports(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('blocker 6: an app raised inactive, then active, finds its row in each state, and a slot decline survives a reload', async () => {
		const workspace = await boot();
		const { kernel } = workspace;
		const keeper = kernel.appPort('keeper');
		await kernel.call('app-open', { instance: 'dual' });
		const asked = await keeper.call('keeper-set', { value: 1 });
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		await kernel.call('app-open', { instance: 'keeper' });
		// Pending: the same row, no prompt.
		expect(idOf(await keeper.call('keeper-set', { value: 1 }))).toBe(idOf(asked));
		expect((await overlays(kernel)).some((each) => each.kind === 'prompt')).toBe(false);
		// Confirmed: its stored outcome.
		await kernel.call('notification-act', { notification: idOf(asked), answer: 'confirm' });
		expect(await keeper.call('keeper-set', { value: 1 })).toMatchObject({
			success: true,
			data: { value: 1 },
		});
		// Declined: refused without asking.
		await kernel.call('app-open', { instance: 'dual' });
		const second = await keeper.call('keeper-set', { value: 2 });
		await kernel.call('notification-act', { notification: idOf(second), answer: 'decline' });
		await kernel.call('app-open', { instance: 'keeper' });
		expect((await keeper.call('keeper-set', { value: 2 })).error?.code).toBe(
			'CONFIRMATION_DECLINED'
		);
		// A decline in the slot is kept in the store: after a reload the port is still held, without asking.
		const waiting = keeper.call('keeper-set', { value: 3 });
		await kernel.call('overlay-dismiss', {
			overlayId: (await slotPrompt(kernel)).overlayId,
			result: 'cancel',
		});
		expect((await waiting).error?.code).toBe('CONFIRMATION_DECLINED');
		await workspace.resetSession();
		await kernel.call('app-open', { instance: 'keeper' });
		expect((await kernel.appPort('keeper').call('keeper-set', { value: 3 })).error?.code).toBe(
			'CONFIRMATION_DECLINED'
		);
		expect((await overlays(kernel)).some((each) => each.kind === 'prompt')).toBe(false);
	});

	it('blocker 7: two fills of one prompt at once run it once; the other finds it gone', async () => {
		const { kernel } = await boot();
		const opened = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'dual-put',
		});
		const prompt = opened.data?.prompt.overlayId;
		const both = await Promise.all([
			kernel.call('palette-run', { command: 'dual-put', prompt, input: { key: 'a', value: '1' } }),
			kernel.call('palette-run', { command: 'dual-put', prompt, input: { key: 'a', value: '2' } }),
		]);
		expect(both.map((each) => each.success).sort()).toEqual([false, true]);
		expect(both.find((each) => !each.success)?.error?.code).toBe('OVERLAY_NOT_FOUND');
		// And the slot is reserved in one step: a settle that would open over a held prompt opens nothing.
		const store = createOverlayStore();
		const made = createConfirmations({
			overlays: store,
			kit: { ...DOCUMENT_KIT, personKey },
		} as never);
		store.open({ kind: 'shell', id: 'shell' }, 'prompt', { title: 'Held' });
		const refused = (await made.settle.handler(
			{
				open: {
					id: 'cnf_1',
					key: 'k',
					command: 'keeper-bump',
					header: 'Run?',
					prompt: 'Sure?',
					danger: false,
					input: {},
				},
			},
			{} as never
		)) as CommandResult;
		expect(refused.error?.code).toBe('OVERLAY_MODAL_BUSY');
	});

	it('blocker 8: a first call during stage B that asks in the slot is answered, not held behind itself', async () => {
		const ports_ = ports();
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: readBoot(deployment()) as BootProjectionV2,
			appsLoader: async () => ({ deployment: deployment(), ports: ports_ }),
		});
		kernels.push(kernel);
		// The first call starts stage B and waits in the queue for it, then holds the queue while it asks.
		const waiting = kernel.call('keeper-bump');
		// The chrome reads the slot once `prompt-settle`'s event says it opened, after stage B: as here.
		await kernel.appsReady;
		const prompt = await slotPrompt(kernel);
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' });
		expect(await waiting).toMatchObject({ success: true, data: { count: 1 } });
	});

	it('blocker 9: a list bounds a large input; a read by id shows it whole', async () => {
		const { kernel } = await boot();
		const text = 'x'.repeat(40_000);
		const asked = await kernel.agent.call('keeper-note', { text });
		const listed = await confirmations(kernel);
		expect(listed[0]?.confirmation?.input).toEqual({ truncated: true, bytes: 40_011 });
		const one = (
			(await kernel.call<Listed>('notification-list', { notification: idOf(asked), body: true }))
				.data as Listed
		).notifications[0];
		expect(one?.confirmation?.input).toEqual({ text });
	});

	it("blocker 10: a fill runs in its prompt's scope, and the palette follows an app's availability", async () => {
		const { kernel, scopes } = await boot();
		await kernel.call('scope-set', { project: 'atlas' });
		const opened = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'dual-put',
		});
		await kernel.call('scope-set', { project: 'beacon' });
		// The fill names Beacon outright as its call's scope: the prompt's own, Atlas, still decides (second round, 12).
		const ran = await kernel.call(
			'palette-run',
			{
				command: 'dual-put',
				prompt: opened.data?.prompt.overlayId,
				input: { key: 'where', value: 'atlas' },
			},
			{ scope: scopes.beacon }
		);
		expect(ran.success).toBe(true);
		expect(
			(
				await kernel.call<{ value?: unknown }>(
					'dual-get',
					{ key: 'where' },
					{ scope: scopes.beacon }
				)
			).data?.value
		).not.toBe('atlas');
		expect(
			(await kernel.call('dual-get', { key: 'where' }, { scope: scopes.atlas })).data
		).toMatchObject({ value: 'atlas' });
		const names = async () =>
			(
				(
					await kernel.call<{ items: Array<{ name: string }> }>('palette-search', {
						query: 'keeper',
					})
				).data?.items ?? []
			).map((item) => item.name);
		expect(await names()).toContain('keeper-get');
		await kernel.call('workspace-app-set', { instance: 'keeper', enabled: false });
		expect(await names()).not.toContain('keeper-get');
		await kernel.call('workspace-app-set', { instance: 'keeper', enabled: null });
		expect(await names()).toContain('keeper-get');
	});

	it('blocker 11: a fill whose target the journal leaves out replays from its own record', async () => {
		const { kernel, journal } = await boot();
		const opened = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'notification-list',
		});
		const listed = await kernel.call('palette-run', {
			command: 'notification-list',
			prompt: opened.data?.prompt.overlayId,
			input: { limit: 5 },
		});
		expect(listed.success).toBe(true);
		const { report } = await replayKernel(await journal.read(), {
			deployment: deployment(),
			ports: ports(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it("second round's 7: a fill of a query the replay answers from its record replays from that record", async () => {
		const { kernel, journal } = await boot();
		const opened = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'app-list',
		});
		const listed = await kernel.call('palette-run', {
			command: 'app-list',
			prompt: opened.data?.prompt.overlayId,
			input: {},
		});
		expect(listed.success).toBe(true);
		const { report } = await replayKernel(await journal.read(), {
			deployment: deployment(),
			ports: ports(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it("second round's 8: a large stored result never breaks the raiser's list; a read by id shows it whole", async () => {
		const { kernel } = await boot();
		const text = 'y'.repeat(40_000);
		const asked = await kernel.agent.call('keeper-note', { text });
		await kernel.call('notification-act', { notification: idOf(asked), answer: 'confirm' });
		const page = await kernel.agent.call<Listed>('notification-list', { kind: 'confirmation' });
		expect(page.success).toBe(true);
		expect((page.data as Listed).notifications[0]?.confirmation?.result).toMatchObject({
			truncated: true,
		});
		const one = (
			(await kernel.agent.call<Listed>('notification-list', { notification: idOf(asked) }))
				.data as Listed
		).notifications[0];
		expect(one?.confirmation?.result).toMatchObject({ success: true, data: { text } });
	});

	it("second round's 9, third round's E: at capacity a new question is refused, a live window is never evicted, and ended ones go", async () => {
		const { kernel, store, advance } = await boot();
		await kernel.call('app-open', { instance: 'keeper' });
		const keeper = kernel.appPort('keeper');
		const slotted = async () =>
			(await store.list<{ cslot?: true; kind: string }>('notification')).data.filter(
				(row) => row.cslot === true
			).length;
		// Another app's live declines, as many as the bound: they never count against keeper's (Opus 4).
		for (let index = 0; index < SLOT_KEPT; index++) {
			const now = 1_800_000_000_000;
			const id = `ntf_other${String(index).padStart(11, '0')}`;
			await store.batch([
				{
					method: 'PUT',
					path: `/notification/${id}`,
					body: {
						id,
						workspace: 'personal',
						person: 'local',
						source: 'other',
						kind: 'confirmation',
						title: 'Other',
						tone: 'warning',
						confirmation: {
							command: 'other-run',
							caller: 'other',
							input: { index },
							header: 'Other asks',
							prompt: 'Run?',
							title: 'Other',
							expiresAt: now + DECLINE_WINDOW_MS,
							state: 'declined',
							reason: 'person',
							answeredAt: now,
						},
						scope: { workspace: 'personal' },
						createdAt: now,
						readAt: now,
						ckey: `other-${index}`,
						ciface: 'palette',
						cbucket: 'app:other',
						cslot: true,
					} as never,
				},
			]);
		}
		for (let value = 0; value < SLOT_KEPT; value++) {
			const waiting = keeper.call('keeper-set', { value });
			await kernel.call('overlay-dismiss', {
				overlayId: (await slotPrompt(kernel)).overlayId,
				result: 'cancel',
			});
			expect((await waiting).error?.code).toBe('CONFIRMATION_DECLINED');
		}
		expect(await slotted()).toBe(2 * SLOT_KEPT);
		// At capacity: a new question is refused before it asks, until the earliest window ends.
		advance(1_000);
		const refused = await keeper.call('keeper-set', { value: 99 });
		expect(refused.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
		const after = (refused.error?.details as { retryAfterMs?: number } | undefined)?.retryAfterMs;
		expect(after).toBeGreaterThan(0);
		expect(after).toBeLessThanOrEqual(DECLINE_WINDOW_MS);
		expect((await overlays(kernel)).some((each) => each.for?.kind === 'confirmation')).toBe(false);
		// The oldest key's window still holds: refused without asking, never asked again.
		const oldest = await keeper.call('keeper-set', { value: 0 });
		expect(oldest.error?.code).toBe('CONFIRMATION_DECLINED');
		expect(oldest.error?.details).toBeUndefined();
		// Once every window ends, the next decline's write removes the ended ones.
		advance(DECLINE_WINDOW_MS + 1);
		const waiting = keeper.call('keeper-set', { value: 99 });
		await kernel.call('overlay-dismiss', {
			overlayId: (await slotPrompt(kernel)).overlayId,
			result: 'cancel',
		});
		await waiting;
		expect(await slotted()).toBe(1);
	});

	it("second round's 6 and 11: a close with no person's gesture is withdrawn, opens no window, and a switch cannot close it", async () => {
		const { kernel } = await boot();
		await kernel.call('app-open', { instance: 'keeper' });
		const keeper = kernel.appPort('keeper');
		const waiting = keeper.call('keeper-set', { value: 5 });
		const prompt = await slotPrompt(kernel);
		// A switch is held while the shell's question is open: no `app-switch` closes it (step 4).
		expect((await kernel.call('app-open', { instance: 'dual' })).success).toBe(false);
		expect((await overlays(kernel)).some((each) => each.overlayId === prompt.overlayId)).toBe(true);
		// Only the shell says `withdrawn`, and only on its own question.
		expect(
			(
				await kernel.agent.call('overlay-dismiss', {
					overlayId: prompt.overlayId,
					result: 'cancel',
					reason: 'withdrawn',
				})
			).error?.code
		).toBe('HUMAN_REQUIRED');
		await kernel.call('overlay-dismiss', {
			overlayId: prompt.overlayId,
			result: 'cancel',
			reason: 'withdrawn',
		});
		const ended = await waiting;
		expect(ended.error).toMatchObject({
			code: 'CONFIRMATION_DECLINED',
			details: { reason: 'withdrawn' },
		});
		expect(ended.error?.message).not.toContain('The person declined');
		// No window: asked again at once.
		const again = keeper.call('keeper-set', { value: 5 });
		await kernel.call('overlay-dismiss', {
			overlayId: (await slotPrompt(kernel)).overlayId,
			result: 'confirm',
		});
		expect((await again).data).toEqual({ value: 5 });
	});

	it("second round's 13: a run whose stored claim is not this page's runs nothing", async () => {
		const store = new MemoryAdapter();
		let ran = false;
		const agent = { kind: 'agent', id: 'shell-agent', onBehalfOf: 'local' };
		const made = createConfirmations({
			store,
			workspace: () => 'personal',
			provider: false,
			overlays: createOverlayStore(),
			openerOf: (context: { interface?: string }) =>
				context.interface === 'agent'
					? {
							kind: 'agent',
							owner: { kind: 'agent', id: 'agent:shell-agent' },
							bucket: 'agents:local',
						}
					: { kind: 'shell', owner: { kind: 'shell', id: 'shell' } },
			isActive: async () => false,
			askedFor: () => ({ prompt: 'Sure?', instance: 'keeper', title: 'Bump', danger: false }),
			paletteCommand: () => undefined,
			inputFault: () => undefined,
			journaled: () => true,
			allows: () => true,
			served: () => undefined,
			archived: () => false,
			appTitle: (instance: string) => instance,
			projectName: () => undefined,
			personLabel: () => null,
			// Another writer claims the row between this page's claim and its run: the gate must refuse.
			runNow: async (
				_iface: string,
				name: string,
				input: unknown,
				fields: Record<string, unknown>
			) => {
				const id = fields.confirmation as string;
				await store.update('notification', id, { claim: 'another-page' } as never);
				return made.gate(
					name,
					input,
					{ ...fields, actor: agent, interface: 'agent' } as never,
					async () => {
						ran = true;
						return success({});
					}
				);
			},
			runBoot: async () => success({}),
			replaying: () => false,
			releaseQueue: () => {},
			chainOf: () => undefined,
			inputOver: () => false,
			noteInbox: () => {},
			digest: async (value: unknown) => JSON.stringify(value),
			kit: { ...DOCUMENT_KIT, personKey },
		} as never);
		const raised = await made.gate(
			'keeper-bump',
			{},
			{ actor: agent, interface: 'agent' } as never,
			async () => success({})
		);
		const id = idOf(raised);
		const row = (await store.get('notification', id)) as never;
		const answered = await made.answer(row, 'confirm', {
			actor: { kind: 'human', id: 'local' },
			interface: 'palette',
			traceId: 't1',
		} as never);
		expect(ran).toBe(false);
		expect((answered.data as { state: string }).state).toBe('declined');
	});

	it("improvement 13: no caller's options or fields run a confirmation's call; a row never approved runs nothing", async () => {
		const workspace = await boot();
		const { kernel } = workspace;
		const asked = await kernel.agent.call('keeper-bump');
		const forged = { confirmation: idOf(asked), origin: 'x' } as never;
		expect((await kernel.agent.call('keeper-bump', {}, forged)).error?.code).toBe(
			'CONFIRMATION_PENDING'
		);
		await kernel.call('app-open', { instance: 'dual' });
		expect((await kernel.appPort('keeper').call('keeper-bump', {}, forged)).error?.code).toBe(
			'CONFIRMATION_PENDING'
		);
		expect(await count(kernel)).toBe(0);
		// The row exists in the store, but this page never approved or claimed it: the gate runs nothing.
		let ran = false;
		const made = createConfirmations({
			store: workspace.store,
			workspace: () => 'personal',
			provider: false,
			replaying: () => false,
			noteInbox: () => {},
			releaseQueue: () => {},
			chainOf: () => undefined,
			inputOver: () => false,
			archived: () => false,
			digest: async (value: unknown) => JSON.stringify(value),
			kit: { ...DOCUMENT_KIT, personKey },
		} as never);
		const refused = await made.gate(
			'keeper-bump',
			{},
			{
				confirmation: idOf(asked),
				actor: { kind: 'agent', id: 'shell-agent', onBehalfOf: 'local' },
				interface: 'agent',
			} as never,
			async () => {
				ran = true;
				return success({});
			}
		);
		expect(refused.error?.code).toBe('HUMAN_REQUIRED');
		expect(ran).toBe(false);
	});

	it('improvement 15: a re-call on a row declined for access says so', async () => {
		const { kernel } = await boot();
		const asked = await kernel.agent.call('keeper-bump');
		await kernel.call('workspace-app-set', { instance: 'keeper', enabled: false });
		await kernel.call('notification-act', { notification: idOf(asked), answer: 'confirm' });
		await kernel.call('workspace-app-set', { instance: 'keeper', enabled: null });
		const again = await kernel.agent.call('keeper-bump');
		expect(again.error).toMatchObject({
			code: 'CONFIRMATION_DECLINED',
			details: { reason: 'access' },
		});
		expect(again.error?.message).toContain('access');
	});
});

/** `probe` with its content write asking for a confirmation: an instance mutation, chained to its document. */
const CONFIRMED_PROBE = {
	...PROBE_DOCUMENTS_MANIFEST,
	commands: (PROBE_DOCUMENTS_MANIFEST.commands as Array<{ name: string }>).map((each) =>
		each.name === 'probe-content-set' ? { ...each, confirm_prompt: 'Replace the text?' } : each
	),
} as unknown as ManifestV2;
const probeDeployment = () => {
	const held = deployment();
	return {
		...held,
		apps: [...held.apps, { instance: 'probe', app: 'probe', package: 'fixtures/probe/' }],
	};
};
const probePorts = () =>
	createFixturePorts({
		...scopedPackages(),
		'fixtures/keeper/': { manifest: KEEPER_MANIFEST, definition: KEEPER },
		'fixtures/probe/': { manifest: CONFIRMED_PROBE, definition: PROBE_DOCUMENTS_DEFINITION },
	});
const textOf = async (kernel: LoamKernelV5, document: string) =>
	(
		(await kernel.call<{ content: { text: string } | null }>('probe-content-get', { document }))
			.data as { content: { text: string } | null }
	).content?.text;

describe('the third round', () => {
	it('A: during stage B, a confirmed write to a document gives its chain up while it waits, and the next write goes on', async () => {
		const store = new MemoryAdapter();
		const first = await createScopedWorkspace({
			store,
			deployment: probeDeployment(),
			ports: probePorts(),
		});
		const made = await first.kernel.call<{ id: string }>('document-create', { type: 'probe' });
		const document = (made.data as { id: string }).id;
		await first.kernel.dispose();
		const ports_ = probePorts();
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: readBoot(probeDeployment()) as BootProjectionV2,
			appsLoader: async () => ({ deployment: probeDeployment(), ports: ports_ }),
		});
		kernels.push(kernel);
		// Both queue behind stage B. The first asks in the slot and releases the queue; the second, of the same document,
		// must not wait on the first's chain while the answer queues behind it.
		const waiting = kernel.call('probe-content-set', { document, text: 'confirmed' });
		const behind = kernel.call('probe-import', { document, content: { text: 'imported' } });
		await kernel.appsReady;
		const prompt = await slotPrompt(kernel);
		expect((await behind).success).toBe(true);
		expect(await textOf(kernel, document)).toBe('imported');
		// Answered through the shell's own path, queued like any call.
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' });
		expect((await waiting).success).toBe(true);
		expect(await textOf(kernel, document)).toBe('confirmed');
	});

	it('A: the confirmed write takes its chain back and checks again: a document trashed meanwhile takes no write', async () => {
		const { kernel } = await createScopedWorkspace({
			deployment: probeDeployment(),
			ports: probePorts(),
		});
		kernels.push(kernel);
		const made = await kernel.call<{ id: string }>('document-create', { type: 'probe' });
		const document = (made.data as { id: string }).id;
		await kernel.call('probe-import', { document, content: { text: 'kept' } });
		const waiting = kernel.call('probe-content-set', { document, text: 'confirmed' });
		const prompt = await slotPrompt(kernel);
		// A change to the record while the write waits goes on at once, as it would with no question open.
		expect((await kernel.call('document-trash', { document })).success).toBe(true);
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' });
		const ended = await waiting;
		expect(ended.success).toBe(false);
		expect(ended.error?.code).toMatch(/^DOCUMENT_/);
		expect((await kernel.call('document-restore', { document })).success).toBe(true);
		expect(await textOf(kernel, document)).toBe('kept');
	});

	it("B: every shape that carries another command's input is redacted by that command's rule; an unknown one's dropped", () => {
		const rule = (record: Parameters<typeof redactJournalRecord>[0]) => redactJournalRecord(record);
		const known = (command: string) => command !== 'gone-command';
		const sign = { method: 'credentials', email: 'a@b.c', password: 'hunter4' };
		const item = { command: 'auth-sign-in', label: 'Go', input: sign };
		const shapes = [
			{
				command: 'notification-push',
				input: { title: 'Hi', action: item },
				result: { success: true, data: { notification: { id: 'ntf_1', action: item } } },
			},
			{
				command: 'popover-open',
				input: { anchor: { surface: 'main', anchor: 'a' }, kind: 'menu', items: [item] },
				result: { success: false },
			},
			{
				command: 'overlay-list',
				input: {},
				result: {
					success: true,
					data: {
						overlays: [
							{
								overlayId: 'ovl-1',
								kind: 'prompt',
								for: { command: 'auth-sign-in', kind: 'confirmation', input: sign },
							},
							{ overlayId: 'ovl-2', kind: 'popover', input: { kind: 'menu', items: [item] } },
						],
					},
				},
			},
			{
				command: 'prompt-settle',
				input: { open: { id: 'cnf_1', command: 'auth-sign-in', input: sign } },
				result: { success: true },
			},
		];
		for (const shape of shapes) {
			const text = JSON.stringify(redactWrapped(shape as never, rule, known));
			expect(text, shape.command).not.toContain('hunter4');
			// Only what the rule removes goes.
			expect(text, shape.command).toContain('a@b.c');
		}
		const gone = { command: 'gone-command', label: 'Go', input: { secret: 'hunter4' } };
		for (const shape of [
			{
				command: 'palette-run',
				input: { command: 'gone-command', prompt: 'p', input: gone.input },
			},
			{ command: 'notification-push', input: { title: 'Hi', action: gone } },
			{ command: 'popover-open', input: { kind: 'menu', items: [gone] } },
		]) {
			const done = redactWrapped({ ...shape, result: { success: false } } as never, rule, known);
			expect(JSON.stringify(done), shape.command).not.toContain('hunter4');
			expect(JSON.stringify(done), shape.command).toContain('gone-command');
		}
	});

	it('B: an app’s refused notice and menu of a command no one registered journal no input, and the session replays the same', async () => {
		const { kernel, journal } = await boot();
		await kernel.call('app-open', { instance: 'keeper' });
		const keeper = kernel.appPort('keeper');
		const secret = { secret: 'hunter5' };
		const pushed = await keeper.call('notification-push', {
			title: 'Hi',
			action: { command: 'gone-command', label: 'Go', input: secret },
		});
		const menu = await keeper.call('popover-open', {
			anchor: { surface: 'main', anchor: 'here' },
			kind: 'menu',
			items: [{ command: 'gone-command', label: 'Go', input: secret }],
		});
		expect(pushed.success).toBe(false);
		expect(menu.success).toBe(false);
		// And a confirmation in the slot, which overlay-list's journaled result shows with its input.
		const waiting = keeper.call('keeper-set', { value: 7 });
		const prompt = await slotPrompt(kernel);
		expect(prompt.for?.input).toEqual({ value: 7 });
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' });
		expect((await waiting).success).toBe(true);
		const entries = await journal.read();
		expect(JSON.stringify(entries)).not.toContain('hunter5');
		expect(entries.some((entry) => entry.command === 'overlay-list')).toBe(true);
		const { report } = await replayKernel(entries, { deployment: deployment(), ports: ports() });
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it("C: an app's call the person declined after its app was disabled replays the same, its window with it", async () => {
		const { kernel, journal } = await boot();
		await kernel.call('app-open', { instance: 'keeper' });
		const keeper = kernel.appPort('keeper');
		const waiting = keeper.call('keeper-set', { value: 3 });
		const prompt = await slotPrompt(kernel);
		// A replay starts the waiting call after this, where the gates before the confirmation's would refuse it.
		expect(
			(await kernel.call('workspace-app-set', { instance: 'keeper', enabled: false })).success
		).toBe(true);
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'cancel' });
		expect((await waiting).error?.code).toBe('CONFIRMATION_DECLINED');
		await kernel.call('workspace-app-set', { instance: 'keeper', enabled: null });
		await kernel.call('app-open', { instance: 'keeper' });
		// The window the decline opened holds the same call, live and in the replay.
		const again = await keeper.call('keeper-set', { value: 3 });
		expect(again.error?.code).toBe('CONFIRMATION_DECLINED');
		const entries = await journal.read();
		const waited = entries.find(
			(entry) => entry.command === 'keeper-set' && entry.context?.confirmation !== undefined
		);
		expect(waited?.context?.replay).toBe('recorded');
		const { report, kernel: replayed } = await replayKernel(entries, {
			keep: true,
			deployment: deployment(),
			ports: ports(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		if (!replayed) throw new Error('replayKernel kept no kernel');
		try {
			expect(await confirmations(replayed)).toEqual(await confirmations(kernel));
		} finally {
			await replayed.dispose();
		}
	});

	it('D: a key the slot asks is held on every path until it settles: the port, no longer active, repeats it', async () => {
		const store = new MemoryAdapter();
		const overlayStore = createOverlayStore();
		let active = true;
		let ran = 0;
		const made = createConfirmations({
			store,
			workspace: () => 'personal',
			provider: false,
			overlays: overlayStore,
			openerOf: () => ({ kind: 'app', owner: { kind: 'app', id: 'keeper' } }),
			// The active editor tab's owner, which a change of tab moves while the shell's question stays open.
			isActive: async () => active,
			askedFor: () => ({ prompt: 'Sure?', instance: 'keeper', title: 'Bump', danger: false }),
			paletteCommand: () => undefined,
			inputFault: () => undefined,
			journaled: () => true,
			allows: () => true,
			served: () => undefined,
			archived: () => false,
			appTitle: (instance: string) => instance,
			projectName: () => undefined,
			personLabel: () => null,
			runNow: async () => success({}),
			runBoot: async (_name: string, input: unknown) =>
				(made.settle.handler as (input: unknown, context: unknown) => Promise<CommandResult>)(
					input,
					{}
				),
			replaying: () => false,
			releaseQueue: () => {},
			chainOf: () => undefined,
			inputOver: () => false,
			noteInbox: () => {},
			digest: async (value: unknown) => JSON.stringify(value),
			kit: { ...DOCUMENT_KIT, personKey },
		} as never);
		const port = () => ({ interface: 'palette', caller: 'keeper' }) as never;
		const run = async () => {
			ran++;
			return success({ ran });
		};
		const waiting = made.gate('keeper-bump', {}, port(), run);
		for (let tries = 0; tries < 100 && !overlayStore.modalOpen(); tries++)
			await new Promise((resolve) => setTimeout(resolve, 0));
		const question = overlayStore.modalOpen();
		expect(question).toBeDefined();
		// The owner moved: the same port's repeat would take the inbox's path, which must not raise a second question.
		active = false;
		const repeat = await made.gate('keeper-bump', {}, port(), run);
		expect(repeat.error).toMatchObject({
			code: 'CONFIRMATION_PENDING',
			details: { overlay: question?.overlayId },
		});
		expect((await store.list('notification')).data).toHaveLength(0);
		overlayStore.close(question?.overlayId as string, 'confirm', 'user');
		expect(await waiting).toMatchObject({ success: true, data: { ran: 1 } });
		// Settled: the key is free, and an inactive port's repeat now waits in the inbox, once.
		expect((await made.gate('keeper-bump', {}, port(), run)).error?.code).toBe(
			'CONFIRMATION_PENDING'
		);
		expect((await store.list('notification')).data).toHaveLength(1);
		expect(ran).toBe(1);
	});

	it("D: a fill's input prompt the person closed before its confirmation replaced it ends the fill, asking nothing", async () => {
		const overlayStore = createOverlayStore();
		let ran = false;
		const made = createConfirmations({
			store: new MemoryAdapter(),
			workspace: () => 'personal',
			provider: false,
			overlays: overlayStore,
			openerOf: () => ({ kind: 'shell', owner: { kind: 'shell', id: 'shell' } }),
			isActive: async () => false,
			askedFor: () => ({ prompt: 'Sure?', instance: 'keeper', title: 'Set', danger: false }),
			allows: () => true,
			served: () => undefined,
			archived: () => false,
			appTitle: (instance: string) => instance,
			projectName: () => undefined,
			personLabel: () => null,
			runBoot: async (_name: string, input: unknown) =>
				(made.settle.handler as (input: unknown, context: unknown) => Promise<CommandResult>)(
					input,
					{}
				),
			replaying: () => false,
			releaseQueue: () => {},
			chainOf: () => undefined,
			inputOver: () => false,
			noteInbox: () => {},
			digest: async (value: unknown) => JSON.stringify(value),
			kit: { ...DOCUMENT_KIT, personKey },
		} as never);
		const shell = { kind: 'shell', id: 'shell' } as const;
		const inputPrompt = () =>
			overlayStore.open(shell, 'prompt', { title: 'Set the value', confirmLabel: 'Run' } as never, {
				for: { command: 'keeper-set', kind: 'input' },
			}).overlayId;
		// The interval a fill releases its queue in, before its confirmation replaces the prompt: the person closes it.
		const closed = inputPrompt();
		overlayStore.close(closed, 'cancel', 'user');
		const fill = await made.gate(
			'keeper-set',
			{ value: 1 },
			{ interface: 'palette', [REPLACES]: closed } as never,
			async () => {
				ran = true;
				return success({});
			}
		);
		expect(fill.error?.code).toBe('OVERLAY_NOT_FOUND');
		expect(overlayStore.modalOpen()).toBeUndefined();
		// And `prompt-settle` itself, checked where it opens: a replaced prompt that is gone opens nothing.
		const settled = await (
			made.settle.handler as (input: unknown, context: unknown) => Promise<CommandResult>
		)(
			{
				close: closed,
				reason: 'replaced',
				open: {
					id: 'cnf_x',
					key: 'k',
					command: 'keeper-set',
					header: 'Run Set the value?',
					prompt: 'Sure?',
					danger: false,
					input: { value: 1 },
				},
			},
			{}
		);
		expect(settled.error?.code).toBe('OVERLAY_NOT_FOUND');
		expect(overlayStore.modalOpen()).toBeUndefined();
		expect(ran).toBe(false);
		// One still open is replaced, as before.
		const open = inputPrompt();
		const asking = made.gate(
			'keeper-set',
			{ value: 2 },
			{ interface: 'palette', [REPLACES]: open } as never,
			async () => {
				ran = true;
				return success({});
			}
		);
		for (let tries = 0; tries < 100 && overlayStore.modalOpen()?.overlayId === open; tries++)
			await new Promise((resolve) => setTimeout(resolve, 0));
		const question = overlayStore.modalOpen();
		expect(overlayStore.forOf(question?.overlayId as string)?.kind).toBe('confirmation');
		overlayStore.close(question?.overlayId as string, 'confirm', 'user');
		expect((await asking).success).toBe(true);
		expect(ran).toBe(true);
	});

	it("F: withdrawn is the renderer's word on the shell's own question alone: never on another overlay, with an answer, or through the palette", async () => {
		const { kernel } = await boot();
		// A shell overlay that asks nothing (no `for`): a person's own toast.
		const toast = await kernel.call<OverlayRefV1>('toast-show', { message: 'Saved' });
		expect(
			(
				await kernel.call('overlay-dismiss', {
					overlayId: toast.data?.overlayId,
					reason: 'withdrawn',
				})
			).error?.code
		).toBe('VALIDATION_ERROR');
		const waiting = kernel.call('keeper-bump');
		const prompt = await slotPrompt(kernel);
		// With an answer: withdrawn is never a confirm.
		expect(
			(
				await kernel.call('overlay-dismiss', {
					overlayId: prompt.overlayId,
					result: 'confirm',
					reason: 'withdrawn',
				})
			).error?.code
		).toBe('VALIDATION_ERROR');
		// The palette cannot fill overlay-dismiss at all (its `value` is no plain field), so no typed call says withdrawn;
		// a call palette-run made would carry its `origin`, which the guard refuses too.
		expect((await kernel.call('palette-run', { command: 'overlay-dismiss' })).error?.code).toBe(
			'OVERLAY_MODAL_BUSY'
		);
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'cancel' });
		expect((await waiting).error?.code).toBe('CONFIRMATION_DECLINED');
		expect((await kernel.call('palette-run', { command: 'overlay-dismiss' })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
	});

	it('G: an act whose confirmed run the replay answers from its record leaves the row as it was live', async () => {
		// An app whose module fails to import: its run's refusal is decided by the page, so a replay answers it from its
		// record, and the act that ran it too.
		const broken = {
			...KEEPER_MANIFEST,
			plugin: { ...KEEPER_MANIFEST.plugin, id: 'broken', title: 'Broken', domains: ['broken'] },
			commands: [
				{
					name: 'broken-run',
					title: 'Run it',
					description: 'Run it.',
					effects: ['store-write'],
					confirm_prompt: 'Run it?',
					input_schema: EMPTY,
				},
			],
			ui: { surfaces: { main: { element: 'broken-main' } } },
		} as unknown as ManifestV2;
		const brokenDeployment = () => {
			const held = deployment();
			return {
				...held,
				apps: [...held.apps, { instance: 'broken', app: 'broken', package: 'fixtures/broken/' }],
			};
		};
		const brokenPorts = () =>
			createFixturePorts({
				...scopedPackages(),
				'fixtures/keeper/': { manifest: KEEPER_MANIFEST, definition: KEEPER },
				'fixtures/broken/': { manifest: broken, importError: new Error('Boom') },
			});
		const journal = new MemoryJournalSink();
		const { kernel } = await createScopedWorkspace({
			journal,
			deployment: brokenDeployment(),
			ports: brokenPorts(),
		});
		kernels.push(kernel);
		const asked = await kernel.agent.call('broken-run');
		const notification = idOf(asked);
		const acted = await kernel.call('notification-act', { notification, answer: 'confirm' });
		expect(acted.success).toBe(true);
		const live = await kernel.agent.call('confirmation-get', { notification });
		expect(live.data).toMatchObject({
			state: 'confirmed',
			result: { error: { code: 'APP_ACTIVATION_FAILED' } },
		});
		const { report, kernel: replayed } = await replayKernel(await journal.read(), {
			keep: true,
			deployment: brokenDeployment(),
			ports: brokenPorts(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		if (!replayed) throw new Error('replayKernel kept no kernel');
		try {
			expect((await replayed.agent.call('confirmation-get', { notification })).data).toEqual(
				live.data
			);
		} finally {
			await replayed.dispose();
		}
	});

	it("H: a dirty mark a closed tab kept asks nothing: the person's close answers EDITOR_TAB_UNKNOWN, with no prompt", async () => {
		const { kernel } = await createScopedWorkspace({
			deployment: probeDeployment(),
			ports: probePorts(),
		});
		kernels.push(kernel);
		const made = await kernel.call<{ id: string }>('document-create', { type: 'probe' });
		const document = (made.data as { id: string }).id;
		expect((await kernel.call('document-open', { document })).success).toBe(true);
		expect((await kernel.call('editor-dirty-set', { tab: 't1', dirty: true })).success).toBe(true);
		// An agent's discard closes the tab, and keeps the mark until the chrome's save clears it (deviation 16).
		expect((await kernel.agent.call('editor-close', { tab: 't1', discard: true })).success).toBe(
			true
		);
		const closed = await kernel.call('editor-close', { tab: 't1' });
		expect(closed.error?.code).toBe('EDITOR_TAB_UNKNOWN');
		expect((await overlays(kernel)).some((each) => each.for?.kind === 'close')).toBe(false);
		// A tab that is shown names its document in the prompt.
		await kernel.call('document-open', { document });
		await kernel.call('editor-dirty-set', { tab: 't2', dirty: true });
		const asked = await kernel.call('editor-close', { tab: 't2' });
		expect(asked.error?.code).toBe('EDITOR_TAB_DIRTY');
		expect((await overlays(kernel)).find((each) => each.for?.kind === 'close')?.for).toMatchObject({
			tab: 't2',
			document,
			scope: { workspace: 'personal' },
		});
	});
});

describe("with step 10's limits", () => {
	const setLimit = (kernel: LoamKernelV5, key: string, value: number) =>
		kernel.call('setting-set', { section: 'loam.limits', key, value, level: 'workspace' });

	it("an app's confirmed run is measured again against inputBytes, lowered since it raised the call", async () => {
		const { kernel } = await boot();
		// Keeper inactive: its call waits in the inbox, its input measured by its port under the default.
		const text = 'z'.repeat(40_000);
		const asked = await kernel.appPort('keeper').call('keeper-note', { text });
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		expect((await setLimit(kernel, 'inputBytes', 16_384)).success).toBe(true);
		const acted = await kernel.call('notification-act', {
			notification: idOf(asked),
			answer: 'confirm',
		});
		expect(acted.data).toEqual({ state: 'declined', reason: 'access' });
		const read = await kernel.appPort('keeper').call('confirmation-get', {
			notification: idOf(asked),
		});
		expect(read.data).toMatchObject({ state: 'declined', reason: 'access' });
	});

	it("the queue a waiting call releases takes nothing off an app's call rate", async () => {
		const { kernel } = await boot();
		await kernel.call('app-open', { instance: 'keeper' });
		const keeper = kernel.appPort('keeper');
		expect((await setLimit(kernel, 'callsPerSecond', 5)).success).toBe(true);
		const waiting = keeper.call('keeper-bump');
		const prompt = await slotPrompt(kernel);
		// The clock stands still, so the burst is all the port has: the rest are refused at the port, queue or not.
		const calls = await Promise.all(Array.from({ length: 220 }, () => keeper.call('keeper-get')));
		expect(calls.filter((each) => each.error?.code === 'RATE_LIMITED').length).toBeGreaterThan(0);
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' });
		expect((await waiting).success).toBe(true);
	});

	it('the journal redacts a wrapped input before it bounds the entry', async () => {
		const { kernel, journal } = await boot();
		const blob = 'q'.repeat(1_200_000);
		await kernel.call('palette-run', {
			command: 'gone-command',
			prompt: 'ovl-1',
			input: { blob },
		});
		const entry = (await journal.read()).find((each) => each.command === 'palette-run');
		expect(entry).toBeDefined();
		// The unknown command's input dropped first: the entry is small, kept whole, and replayable.
		expect((entry as unknown as { unreplayable?: boolean }).unreplayable).toBeUndefined();
		expect(entry?.input).toEqual({ command: 'gone-command', prompt: 'ovl-1' });
	});

	it('confirmations and slot declines are one workspace’s: another in the same store reads, holds and answers none', async () => {
		const store = new MemoryAdapter();
		const first = await createScopedWorkspace({ store, deployment: deployment(), ports: ports() });
		await first.kernel.call('app-open', { instance: 'keeper' });
		const waiting = first.kernel.appPort('keeper').call('keeper-set', { value: 4 });
		await first.kernel.call('overlay-dismiss', {
			overlayId: (await slotPrompt(first.kernel)).overlayId,
			result: 'cancel',
		});
		expect((await waiting).error?.code).toBe('CONFIRMATION_DECLINED');
		const pending = await first.kernel.agent.call('keeper-bump');
		await first.kernel.dispose();
		const team = { ...deployment(), workspace: { id: 'team', name: 'Team' } };
		const second = await createScopedWorkspace({
			store,
			deployment: team,
			ports: ports(),
			empty: true,
		});
		kernels.push(second.kernel);
		const { kernel } = second;
		expect(await confirmations(kernel)).toEqual([]);
		expect(
			(await kernel.agent.call('confirmation-get', { notification: idOf(pending) })).error?.code
		).toBe('NOTIFICATION_NOT_FOUND');
		expect(
			(
				await kernel.call('notification-act', {
					notification: idOf(pending),
					answer: 'confirm',
				})
			).success
		).toBe(false);
		// The first workspace's decline window holds nothing here: the same call asks.
		await kernel.call('app-open', { instance: 'keeper' });
		const again = kernel.appPort('keeper').call('keeper-set', { value: 4 });
		await kernel.call('overlay-dismiss', {
			overlayId: (await slotPrompt(kernel)).overlayId,
			result: 'confirm',
		});
		expect((await again).data).toEqual({ value: 4 });
	});
});
