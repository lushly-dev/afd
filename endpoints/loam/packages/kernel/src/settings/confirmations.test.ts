/**
 * Phase 4's prompts and confirmations (its section 7, P4-E8's units): R7's human gestures signed out, R8's paths of
 * `palette-run` and the close prompt, R9's pending path (at once, the re-call, `confirmation-get`, the re-check on
 * confirm, withdrawal, expiry on a moved clock, `confirm: true`), R15's replacement of the input prompt, R16's window
 * (the input digest, an active app's port held, a person's gesture exempt), F4's four keys, F5's stored outcome and one
 * run, F9's order, the limit of 5, a change of person, F6's cancels of a confirmation in the slot, and replay.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { CommandResult } from '@lushly-dev/afd-core';
import { type JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import { defineCommand } from '@lushly-dev/afd-server/define';
import { type BootProjectionV2, readBoot } from '@lushly-dev/loam-manifest';
import {
	type AppCallContextV1,
	defineApp,
	failure,
	type ManifestV3,
	type NotificationV1,
	type OverlayRefV1,
	type OverlayV1,
	success,
} from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createKernel, createKernelParts, redactJournalRecord, redactSafely } from '../kernel.js';
import { DOCUMENT_KIT } from '../late/command-kit.js';
import {
	createJournalProvenance,
	redactWrapped,
	type WrapperProvenance,
} from '../late/journal-wrappers.js';
import { createOverlayStore } from '../overlays/store.js';
import { personKey } from '../scope/access.js';
import { createScopedWorkspace, type ScopedWorkspace, scopedPackages } from '../scope/fixtures.js';
import { createFixedEnvironment, createFixturePorts, replayKernel } from '../testing.js';
import { PROBE_DOCUMENTS_DEFINITION, PROBE_DOCUMENTS_MANIFEST } from '../testing-documents.js';
import type { LoamKernel } from '../types.js';
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

const kernels: LoamKernel[] = [];
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
			name: 'keeper-refuse',
			title: 'Refuse it',
			description: 'Answer with a refusal of its own.',
			effects: ['store-write'],
			input_schema: EMPTY,
		},
		{
			name: 'keeper-undo',
			title: 'Do and say how to undo',
			description: 'Answer with an undo and a warning.',
			effects: ['store-write'],
			input_schema: EMPTY,
		},
		{
			name: 'keeper-big',
			title: 'Make a big one',
			description: 'Answer with more than the journal keeps of one entry.',
			effects: ['store-write'],
			confirm_prompt: 'Make a big one?',
			input_schema: EMPTY,
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
} as unknown as ManifestV3;

/** While set, `keeper-bump` refuses, and says so in `bumpRefused`: a confirmed run that fails (#1672). */
let bumpRefuses = false;
let bumpRefused = false;

const KEEPER = defineApp({
	sdk: 1,
	handlers: {
		'keeper-bump': (async (_input: unknown, context: AppCallContextV1) => {
			if (bumpRefuses) {
				bumpRefused = true;
				return failure({
					code: 'KEEPER_REFUSED',
					message: 'Keeper refuses',
					suggestion: 'Ask again',
				});
			}
			const held = (await context.store?.get<number>('count')) ?? 0;
			await context.store?.put('count', held + 1);
			return success({ count: held + 1 });
		}) as never,
		'keeper-set': (async (input: { value: number }, context: AppCallContextV1) => {
			await context.store?.put('value', input.value);
			return success({ value: input.value });
		}) as never,
		'keeper-note': (async (input: { text: string }) => success({ text: input.text })) as never,
		'keeper-refuse': (async () =>
			failure({
				code: 'KEEPER_REFUSED',
				message: 'Keeper refuses',
				suggestion: 'Ask again',
			})) as never,
		// A result with more than its data: an undo and a warning, which a replay compares (eighth round, D3).
		'keeper-undo': (async () =>
			success(
				{ done: true },
				{
					undoCommand: 'keeper-set',
					undoArgs: { value: 0 },
					warnings: [{ code: 'KEEPER_NOTE', message: 'Undone by keeper-set' }],
				}
			)) as never,
		// More than `journalEntryBytes`' default: its own entry is cut by the journal's final bound.
		'keeper-big': (async () => success({ big: 'b'.repeat(1_100_000) })) as never,
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
const confirmations = async (kernel: LoamKernel) =>
	(
		(await kernel.call<Listed>('notification-list', { kind: 'confirmation', body: true }))
			.data as Listed
	).notifications;
const overlays = async (kernel: LoamKernel) =>
	(await kernel.call<{ overlays: OverlayV1[] }>('overlay-list')).data?.overlays ?? [];
const idOf = (result: CommandResult) =>
	(result.error?.details as { notification: string } | undefined)?.notification as string;
const count = async (kernel: LoamKernel) =>
	((await kernel.call<{ count: number }>('keeper-get')).data as { count: number }).count;

/** The slot's prompt once the waiting call has opened it. */
async function slotPrompt(kernel: LoamKernel): Promise<OverlayV1> {
	for (let tries = 0; tries < 200; tries++) {
		const held = (await overlays(kernel)).find(
			(overlay) => overlay.kind === 'prompt' && overlay.for?.kind === 'confirmation'
		);
		if (held) return held;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error('No confirmation opened in the slot');
}

/**
 * P4-E17's "these succeed" (section 13, D125): on a hosted `provider` projection, the inbox and confirmations are the
 * person's own records, so `notification-*` and the confirmation commands answer as in a local one, signed in.
 */
describe('P4-E17: a hosted provider deployment keeps the inbox and confirmations (section 13)', () => {
	it('pushes, lists, reads, archives and acts on notices, and raises, reads, confirms and withdraws confirmations', async () => {
		const workspace = await createScopedWorkspace({
			deployment: {
				...deployment(),
				deployment_version: 4,
				generation: 'hosted',
				host: { kind: 'hosted', kernel: 'api/kernel' },
			} as never,
			ports: ports(),
			identity: { mode: 'provider', organization: 'acme', path: 'api/auth', methods: ['password'] },
			empty: true,
			membership: {
				mode: 'provider',
				members: new Map([['mock-user-olu@example.com', 'owner']]),
				digest: 'd1',
			},
		});
		kernels.push(workspace.kernel);
		const { kernel, journal } = workspace;
		expect(
			(
				await kernel.call('auth-sign-in', {
					method: 'credentials',
					email: 'olu@example.com',
					password: 'x',
				})
			).success
		).toBe(true);
		// The fixture is hosted: a shared write is section 13's refusal here.
		expect(
			(
				await kernel.call('setting-set', {
					section: 'loam.documents',
					key: 'trashDays',
					value: 3,
					level: 'workspace',
				})
			).error?.code
		).toBe('SHARED_RECORD_UNAVAILABLE');
		const start = (await journal.read()).length;
		// The inbox: an agent's notice, listed, read and archived by the person.
		const pushed = await kernel.agent.call<{ notification: NotificationV1 }>('notification-push', {
			title: 'Done',
		});
		expect(pushed.success, JSON.stringify(pushed.error)).toBe(true);
		const notice = pushed.data?.notification.id as string;
		const listed = await kernel.call<Listed>('notification-list', {});
		expect(listed.data?.notifications.map(({ id }) => id)).toContain(notice);
		expect((await kernel.call('notification-read', { notification: notice })).success).toBe(true);
		expect((await kernel.call('notification-archive', { notification: notice })).success).toBe(
			true
		);
		// Confirmations: an agent's pending one, read, confirmed in the inbox and run once; another withdrawn.
		const asked = await kernel.agent.call('keeper-bump');
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		expect(
			(await kernel.agent.call('confirmation-get', { notification: idOf(asked) })).data
		).toMatchObject({ state: 'pending' });
		expect(
			(await kernel.call('notification-act', { notification: idOf(asked), answer: 'confirm' })).data
		).toEqual({ state: 'confirmed' });
		expect(await count(kernel)).toBe(1);
		const other = await kernel.agent.call('keeper-set', { value: 2 });
		expect(other.error?.code).toBe('CONFIRMATION_PENDING');
		expect(
			(await kernel.agent.call('confirmation-withdraw', { notification: idOf(other) })).data
		).toEqual({ state: 'withdrawn' });
		// None of them is section 13's refusal.
		const refused = (await journal.read())
			.slice(start)
			.filter(
				(entry) =>
					(entry.result as { error?: { code?: string } }).error?.code ===
					'SHARED_RECORD_UNAVAILABLE'
			);
		expect(refused).toEqual([]);
	});
});

describe('P4-E8: the pending path (R9)', () => {
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
			personNow: () => 'local',
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

describe('P4-E8: the slot (a person’s gesture, the active app’s port)', () => {
	it("P4-E8: P4-E7: R7: a person's call waits in the slot, signed out, and runs on their confirm", async () => {
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

	it("P4-E8: P4-E7: the active app's port asks with the shell's header; its decline holds the port, a person's gesture not", async () => {
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

	it("P4-E8: P4-E7: F6: the raising app's cancel of its own confirmation ends it withdrawn, with no window", async () => {
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

describe("P4-E8: palette-run, the palette's input prompt (7.1)", () => {
	it('P4-E8: P4-E7: R8: human only: HUMAN_REQUIRED from the agent interface, CALL_NOT_GRANTED from a port', async () => {
		const { kernel } = await boot();
		expect((await kernel.agent.call('palette-run', { command: 'keeper-set' })).error?.code).toBe(
			'HUMAN_REQUIRED'
		);
		await kernel.call('app-open', { instance: 'keeper' });
		expect(
			(await kernel.appPort('keeper').call('palette-run', { command: 'keeper-set' })).error?.code
		).toBe('CALL_NOT_GRANTED');
		// 6.1's row for an inactive app's port: refused the same, and nothing opens.
		expect(
			(await kernel.appPort('dual').call('palette-run', { command: 'keeper-set' })).error?.code
		).toBe('CALL_NOT_GRANTED');
		expect((await overlays(kernel)).filter((each) => each.kind === 'prompt')).toEqual([]);
	});

	it('P4-E8: P4-E7: opens a prompt of the input’s fields, refuses a stale one, keeps it open on bad input, and runs it', async () => {
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
			scope: { workspace: 'personal' },
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

describe('P4-E15: replay', () => {
	it('replays a pending confirm, a slot confirm, palette-run and a withdrawal the same, running each once', async () => {
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
		// A confirmation read and withdrawn by the agent that raised it (7.2).
		const withdrawn = await kernel.agent.call('keeper-set', { value: 9 });
		await kernel.agent.call('confirmation-get', { notification: idOf(withdrawn) });
		expect(
			(await kernel.agent.call('confirmation-withdraw', { notification: idOf(withdrawn) })).data
		).toEqual({ state: 'withdrawn' });
		const live = (await kernel.call('keeper-get')).data;
		expect(live).toEqual({ count: 2, value: 5 });
		expect((await journal.read()).map(({ command }) => command)).toContain('confirmation-withdraw');
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
			personNow: () => 'local',
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
			personNow: () => 'local',
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
			personNow: () => 'local',
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
			personNow: () => 'local',
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
} as unknown as ManifestV3;
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
const textOf = async (kernel: LoamKernel, document: string) =>
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
			personNow: () => 'local',
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
		overlayStore.close(question?.overlayId as string, 'confirm', 'user', undefined, true);
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
			personNow: () => 'local',
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
		// One still open but another command's is not replaced, and is not said to be closed: the slot is busy.
		const other = inputPrompt();
		const busy = await made.gate(
			'keeper-bump',
			{},
			{ interface: 'palette', [REPLACES]: other } as never,
			async () => success({})
		);
		expect(busy.error?.code).toBe('OVERLAY_MODAL_BUSY');
		overlayStore.close(other, 'cancel', 'user');
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
		overlayStore.close(question?.overlayId as string, 'confirm', 'user', undefined, true);
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
		} as unknown as ManifestV3;
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
	const setLimit = (kernel: LoamKernel, key: string, value: number) =>
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
		// The burst of 200 less the waiting call's own: 199 run, and the other 21 are refused.
		expect(calls.filter((each) => each.error?.code === 'RATE_LIMITED')).toHaveLength(21);
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

describe('the fourth round', () => {
	const sign = { method: 'credentials', email: 'ana@example.com', password: 'hunter9' };

	it("1: a notice's action read through palette-run is redacted in the forwarding entry, by the target's rule", async () => {
		const { kernel, journal } = await boot();
		const pushed = await kernel.call('notification-push', {
			title: 'Sign in again',
			action: { command: 'auth-sign-in', label: 'Sign in', input: sign },
		});
		expect(pushed.success).toBe(true);
		const opened = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'notification-list',
		});
		const listed = await kernel.call<Listed>('palette-run', {
			command: 'notification-list',
			prompt: opened.data?.prompt.overlayId,
			input: { body: true },
		});
		// Settled with a populated inbox: the live answer carries the action whole.
		expect(JSON.stringify(listed.data)).toContain('hunter9');
		const text = JSON.stringify(await journal.read());
		expect(text).not.toContain('hunter9');
		expect(text).toContain('ana@example.com');
	});

	it("2: a notice whose action is itself a notice's push is journaled, redacted, and never lost", async () => {
		const { kernel, journal } = await boot();
		const pushed = await kernel.call('notification-push', {
			title: 'Remind me',
			action: {
				command: 'notification-push',
				label: 'Remind',
				input: {
					title: 'Sign in again',
					action: { command: 'auth-sign-in', label: 'Sign in', input: sign },
				},
			},
		});
		expect(pushed.success).toBe(true);
		const entries = await journal.read();
		const entry = entries.find((each) => each.command === 'notification-push');
		expect(entry).toBeDefined();
		expect(JSON.stringify(entries)).not.toContain('hunter9');
		expect(JSON.stringify(entry)).toContain('ana@example.com');
	});

	it("3: the active app's call in the slot is measured again against an inputBytes lowered while it waited", async () => {
		const { kernel } = await boot();
		await kernel.call('app-open', { instance: 'keeper' });
		const waiting = kernel.appPort('keeper').call('keeper-note', { text: 'z'.repeat(40_000) });
		const prompt = await slotPrompt(kernel);
		expect(
			(
				await kernel.call('setting-set', {
					section: 'loam.limits',
					key: 'inputBytes',
					value: 16_384,
					level: 'workspace',
				})
			).success
		).toBe(true);
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' });
		expect((await waiting).error).toMatchObject({
			code: 'CONFIRMATION_DECLINED',
			details: { reason: 'access' },
		});
	});

	it('3: access revoked while a confirmed call waits for its chain runs nothing', async () => {
		const overlayStore = createOverlayStore();
		let served = true;
		let ran = false;
		let open: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const made = createConfirmations({
			store: new MemoryAdapter(),
			workspace: () => 'personal',
			provider: false,
			overlays: overlayStore,
			openerOf: () => ({ kind: 'shell', owner: { kind: 'shell', id: 'shell' } }),
			isActive: async () => false,
			askedFor: () => ({ prompt: 'Sure?', instance: 'keeper', title: 'Set', danger: false }),
			allows: () => true,
			served: () => (served ? undefined : 'gone'),
			archived: () => false,
			inputOver: () => false,
			personNow: () => 'local',
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
			// The document's chain, held by another change until `open`.
			chainOf: () => ({
				release: () => {},
				again: async (run: () => Promise<CommandResult>) => {
					await gate;
					return run();
				},
			}),
			noteInbox: () => {},
			digest: async (value: unknown) => JSON.stringify(value),
			kit: { ...DOCUMENT_KIT, personKey },
		} as never);
		const waiting = made.gate(
			'keeper-set',
			{ value: 1 },
			{ interface: 'palette' } as never,
			async () => {
				ran = true;
				return success({});
			}
		);
		for (let tries = 0; tries < 100 && !overlayStore.modalOpen(); tries++)
			await new Promise((resolve) => setTimeout(resolve, 0));
		overlayStore.close(
			overlayStore.modalOpen()?.overlayId as string,
			'confirm',
			'user',
			undefined,
			true
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		// Revoked while it waits for the chain, after its answer.
		served = false;
		open();
		expect((await waiting).error).toMatchObject({
			code: 'CONFIRMATION_DECLINED',
			details: { reason: 'access' },
		});
		expect(ran).toBe(false);
	});

	it('3: a confirmed instance query, which no chain holds, checks its document again before it runs', async () => {
		const confirmedExport = {
			...CONFIRMED_PROBE,
			commands: (CONFIRMED_PROBE.commands as Array<{ name: string }>).map((each) =>
				each.name === 'probe-export' ? { ...each, confirm_prompt: 'Export it?' } : each
			),
		} as unknown as ManifestV3;
		const { kernel } = await createScopedWorkspace({
			deployment: probeDeployment(),
			ports: createFixturePorts({
				...scopedPackages(),
				'fixtures/keeper/': { manifest: KEEPER_MANIFEST, definition: KEEPER },
				'fixtures/probe/': { manifest: confirmedExport, definition: PROBE_DOCUMENTS_DEFINITION },
			}),
		});
		kernels.push(kernel);
		const made = await kernel.call<{ id: string }>('document-create', { type: 'probe' });
		const document = (made.data as { id: string }).id;
		const waiting = kernel.call('probe-export', { document });
		const prompt = await slotPrompt(kernel);
		// Moved out of the call's scope while it waits: a query may read a trashed document, but not one elsewhere.
		expect((await kernel.call('document-move', { document, project: 'atlas' })).success).toBe(true);
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' });
		const ended = await waiting;
		expect(ended.success).toBe(false);
		expect(ended.error?.code).toBe('SCOPE_MISMATCH');
	});

	it("4: during stage B, a notice's action that asks in the slot releases the act's queue, and is answered", async () => {
		const store = new MemoryAdapter();
		const first = await createScopedWorkspace({ store, deployment: deployment(), ports: ports() });
		// Keeper's own notice, whose action is its own command.
		const pushed = await first.kernel
			.appPort('keeper')
			.call<{ notification: NotificationV1 }>('notification-push', {
				title: 'Count it',
				action: { command: 'keeper-bump', label: 'Add one' },
			});
		expect(pushed.success).toBe(true);
		const notification = (pushed.data as { notification: NotificationV1 }).notification.id;
		await first.kernel.dispose();
		const ports_ = ports();
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: readBoot(deployment()) as BootProjectionV2,
			appsLoader: async () => ({ deployment: deployment(), ports: ports_ }),
		});
		kernels.push(kernel);
		// Queued behind stage B; its action asks in the slot while the act holds the queue.
		const acting = kernel.call('notification-act', { notification });
		await kernel.appsReady;
		const prompt = await slotPrompt(kernel);
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' });
		expect((await acting).success).toBe(true);
		expect(await count(kernel)).toBe(1);
	});

	it('5: a slot call whose app stopped being active while it waited replays through the slot it took', async () => {
		const journal = new MemoryJournalSink();
		const { kernel } = await createScopedWorkspace({
			journal,
			deployment: probeDeployment(),
			ports: probePorts(),
		});
		kernels.push(kernel);
		const made = await kernel.call<{ id: string }>('document-create', { type: 'probe' });
		const document = (made.data as { id: string }).id;
		await kernel.call('document-open', { document });
		// Probe owns the active tab: its port asks in the slot.
		const waiting = kernel.appPort('probe').call('probe-content-set', { document, text: 'set' });
		const prompt = await slotPrompt(kernel);
		// The owner changes while it waits: the tab closes, so probe is no longer active.
		expect((await kernel.call('editor-close', { tab: 't1' })).success).toBe(true);
		await kernel.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' });
		expect((await waiting).success).toBe(true);
		const { report, kernel: replayed } = await replayKernel(await journal.read(), {
			keep: true,
			deployment: probeDeployment(),
			ports: probePorts(),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		if (!replayed) throw new Error('replayKernel kept no kernel');
		try {
			expect(await confirmations(replayed)).toEqual([]);
			expect(
				(
					(await replayed.call<{ content: { text: string } }>('probe-content-get', { document }))
						.data as { content: { text: string } }
				).content.text
			).toBe('set');
		} finally {
			await replayed.dispose();
		}
	});

	it('6: a replay refuses a journal with an entry missing from its middle', async () => {
		const { kernel, journal } = await boot();
		await kernel.call('keeper-get');
		const entries = await journal.read();
		const missing = entries.filter((entry) => entry.seq !== 3);
		const refused = await replayKernel(missing, { deployment: deployment(), ports: ports() }).catch(
			(error: unknown) => error as { code?: string; details?: unknown }
		);
		expect((refused as { code?: string }).code).toBe('REPLAY_JOURNAL_GAP');
		expect((refused as { details?: unknown }).details).toEqual({ after: 2, next: 4 });
	});

	it("6: an act's settle needs the row, an allowed change, and merges onto the row as it stands", async () => {
		const store = new MemoryAdapter();
		const made = createConfirmations({
			store,
			workspace: () => 'personal',
			provider: false,
			overlays: createOverlayStore(),
			replaying: () => false,
			noteInbox: () => {},
			digest: async (value: unknown) => JSON.stringify(value),
			kit: { ...DOCUMENT_KIT, personKey },
		} as never);
		const settle = (input: unknown) =>
			(made.settle.handler as (input: unknown, context: unknown) => Promise<CommandResult>)(
				input,
				{}
			);
		const row = {
			id: 'ntf_aaaaaaaaaaaaaaaa',
			workspace: 'personal',
			person: 'local',
			source: 'keeper',
			kind: 'confirmation',
			title: 'Bump',
			tone: 'warning',
			confirmation: {
				command: 'keeper-bump',
				caller: 'keeper',
				input: {},
				group: 'kept',
				header: 'Keeper asks',
				prompt: 'Sure?',
				title: 'Bump',
				expiresAt: Date.now() + 600_000,
				state: 'pending',
			},
			scope: { workspace: 'personal' },
			createdAt: 1,
			readAt: 5,
			ckey: 'k',
			ciface: 'palette',
			cbucket: 'app:keeper',
			claim: 'mine',
		};
		const ended = {
			id: row.id,
			person: 'local',
			command: 'keeper-bump',
			state: 'confirmed',
			result: { success: true, data: { count: 1 } },
		};
		// No such row: refused, and nothing is written.
		expect((await settle({ settle: { ...ended, id: 'ntf_bbbbbbbbbbbbbbbb' } })).success).toBe(
			false
		);
		expect((await store.list('notification')).data).toHaveLength(0);
		await store.batch([{ method: 'PUT', path: `/notification/${row.id}`, body: row }]);
		// Another command's name: refused.
		expect((await settle({ settle: { ...ended, command: 'keeper-set' } })).success).toBe(false);
		// Pending to confirmed only for a run the replay recorded with this outcome (fifth round, 3; #1656).
		expect((await settle({ settle: ended })).success).toBe(false);
		made.recorded(row.id, ended.command, ended.result as CommandResult);
		expect((await settle({ settle: ended })).success).toBe(true);
		const kept = (await store.get('notification', row.id)) as typeof row & {
			confirmation: { state: string; reason?: string; result?: unknown };
		};
		// Only what the act changes: the state, its reason and result; the claim goes; the rest stands.
		expect(kept.confirmation).toMatchObject({
			state: 'confirmed',
			reason: 'person',
			group: 'kept',
			result: { success: true, data: { count: 1 } },
		});
		expect(kept.readAt).toBe(5);
		expect('claim' in kept).toBe(false);
		// From an ended state, no other: a confirmed row is never declined after.
		expect((await settle({ settle: { ...ended, state: 'declined' } })).success).toBe(false);
	});

	it('7: a decline still being written holds its key, and counts toward the per-app bound', async () => {
		const store = new MemoryAdapter();
		const overlayStore = createOverlayStore();
		let open: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const now = Date.now();
		// One short of the bound: keeper's live declines.
		await store.batch(
			Array.from({ length: SLOT_KEPT - 1 }, (_, index) => {
				const id = `ntf_held${String(index).padStart(12, '0')}`;
				return {
					method: 'PUT' as const,
					path: `/notification/${id}`,
					body: {
						id,
						workspace: 'personal',
						person: 'local',
						source: 'keeper',
						kind: 'confirmation',
						title: 'Set',
						tone: 'warning',
						confirmation: {
							command: 'keeper-set',
							caller: 'keeper',
							input: { index },
							header: 'Keeper asks',
							prompt: 'Sure?',
							title: 'Set',
							expiresAt: now + DECLINE_WINDOW_MS,
							state: 'declined',
							reason: 'person',
							answeredAt: now,
						},
						scope: { workspace: 'personal' },
						createdAt: now,
						readAt: now,
						ckey: `held-${index}`,
						ciface: 'palette',
						cbucket: 'app:keeper',
						cslot: true,
					},
				};
			})
		);
		const made = createConfirmations({
			store,
			workspace: () => 'personal',
			provider: false,
			overlays: overlayStore,
			openerOf: () => ({ kind: 'app', owner: { kind: 'app', id: 'keeper' } }),
			isActive: async () => true,
			askedFor: () => ({ prompt: 'Sure?', instance: 'keeper', title: 'Set', danger: false }),
			allows: () => true,
			served: () => undefined,
			archived: () => false,
			inputOver: () => false,
			appTitle: (instance: string) => instance,
			projectName: () => undefined,
			personLabel: () => null,
			// The decline's write held until `open`.
			runBoot: async (_name: string, input: unknown) => {
				if ((input as { decline?: unknown }).decline) await gate;
				return (
					made.settle.handler as (input: unknown, context: unknown) => Promise<CommandResult>
				)(input, {});
			},
			replaying: () => false,
			releaseQueue: () => {},
			chainOf: () => undefined,
			noteInbox: () => {},
			digest: async (value: unknown) => JSON.stringify(value),
			kit: { ...DOCUMENT_KIT, personKey },
		} as never);
		const port = { interface: 'palette', caller: 'keeper' } as never;
		const run = async () => success({});
		const asked = made.gate('keeper-set', { value: 1 }, port, run);
		for (let tries = 0; tries < 100 && !overlayStore.modalOpen(); tries++)
			await new Promise((resolve) => setTimeout(resolve, 0));
		overlayStore.close(
			overlayStore.modalOpen()?.overlayId as string,
			'cancel',
			'user',
			undefined,
			true
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		/** A call's answer, or `asking` when it opened a question instead. */
		const settledOrAsking = (call: Promise<CommandResult>) =>
			Promise.race([
				call.then((result) => result.error?.code ?? 'ok'),
				new Promise<string>((resolve) => setTimeout(() => resolve('asking'), 50)),
			]);
		// The same key while its decline is written: the question it was is still the key's.
		expect(await settledOrAsking(made.gate('keeper-set', { value: 1 }, port, run))).toBe(
			'CONFIRMATION_PENDING'
		);
		// Another key: the outstanding decline counts, so the bound is met.
		expect(await settledOrAsking(made.gate('keeper-set', { value: 2 }, port, run))).toBe(
			'RATE_LIMITED'
		);
		open();
		expect((await asked).error?.code).toBe('CONFIRMATION_DECLINED');
	});
});

describe('the fifth round', () => {
	const sign = { method: 'credentials', email: 'ana@example.com', password: 'hunter11' };

	it("1: an act's result, its action's, is redacted by the action's rule, directly and forwarded by palette-run", async () => {
		const { kernel, journal } = await boot();
		expect(
			(
				await kernel.call('notification-push', {
					title: 'Sign in again',
					action: { command: 'auth-sign-in', label: 'Sign in', input: sign },
				})
			).success
		).toBe(true);
		const listing = await kernel.call<{ notification: NotificationV1 }>('notification-push', {
			title: 'Look',
			action: { command: 'notification-list', label: 'Look', input: { body: true } },
		});
		expect(listing.success).toBe(true);
		const id = (listing.data as { notification: NotificationV1 }).notification.id;
		const direct = await kernel.call('notification-act', { notification: id });
		expect(JSON.stringify(direct.data)).toContain('hunter11');
		const second = await kernel.call<{ notification: NotificationV1 }>('notification-push', {
			title: 'Look again',
			action: { command: 'notification-list', label: 'Look', input: { body: true } },
		});
		const opened = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'notification-act',
		});
		const forwarded = await kernel.call('palette-run', {
			command: 'notification-act',
			prompt: opened.data?.prompt.overlayId,
			input: { notification: (second.data as { notification: NotificationV1 }).notification.id },
		});
		expect(JSON.stringify(forwarded.data)).toContain('hunter11');
		const text = JSON.stringify(await journal.read());
		expect(text).not.toContain('hunter11');
		expect(text).toContain('ana@example.com');
	});

	/** Confirmations over fake deps, with the person signed in now and the document chain the test holds. */
	function unit(overrides: Record<string, unknown> = {}) {
		const overlayStore = createOverlayStore();
		const store = new MemoryAdapter();
		const made: ReturnType<typeof createConfirmations> = createConfirmations({
			store,
			workspace: () => 'personal',
			provider: false,
			overlays: overlayStore,
			openerOf: () => ({ kind: 'shell', owner: { kind: 'shell', id: 'shell' } }),
			isActive: async () => false,
			askedFor: () => ({ prompt: 'Sure?', instance: 'keeper', title: 'Set', danger: false }),
			allows: () => true,
			served: () => undefined,
			archived: () => false,
			inputOver: () => false,
			personNow: () => 'local',
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
			noteInbox: () => {},
			digest: async (value: unknown) => JSON.stringify(value),
			kit: { ...DOCUMENT_KIT, personKey },
			...overrides,
		} as never);
		return { made, store, overlayStore };
	}
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

	it('2: a change of person after Confirm, while the run waits for its chain, runs nothing', async () => {
		let person = 'local';
		let open: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		let ran = false;
		const { made, overlayStore } = unit({
			personNow: () => person,
			chainOf: () => ({
				release: () => {},
				check: async () => undefined,
				again: async (run: () => Promise<CommandResult>) => {
					await gate;
					return run();
				},
			}),
		});
		const waiting = made.gate(
			'keeper-set',
			{ value: 1 },
			{ interface: 'palette' } as never,
			async () => {
				ran = true;
				return success({});
			}
		);
		for (let tries = 0; tries < 100 && !overlayStore.modalOpen(); tries++) await tick();
		overlayStore.close(
			overlayStore.modalOpen()?.overlayId as string,
			'confirm',
			'user',
			undefined,
			true
		);
		await tick();
		person = 'someone-else';
		open();
		expect((await waiting).success).toBe(false);
		expect(ran).toBe(false);
	});

	it("2: the inbox's run checks its resources after its row lookup and digest, right before the handler", async () => {
		const order: string[] = [];
		const agent = { kind: 'agent', id: 'shell-agent', onBehalfOf: 'local' };
		const { made, store } = unit({
			openerOf: (context: { interface?: string }) =>
				context.interface === 'agent'
					? {
							kind: 'agent',
							owner: { kind: 'agent', id: 'agent:shell-agent' },
							bucket: 'agents:local',
						}
					: { kind: 'shell', owner: { kind: 'shell', id: 'shell' } },
			digest: async (value: unknown) => {
				order.push('digest');
				return JSON.stringify(value);
			},
			chainOf: () => ({
				release: () => {},
				check: async () => {
					order.push('check');
					return undefined;
				},
				again: async (run: () => Promise<CommandResult>) => run(),
			}),
			runNow: async (
				_iface: string,
				name: string,
				input: unknown,
				fields: Record<string, unknown>
			) =>
				made.gate(
					name,
					input,
					{ ...fields, actor: agent, interface: 'agent' } as never,
					async () => {
						order.push('next');
						return success({});
					}
				),
		});
		const raised = await made.gate(
			'keeper-bump',
			{},
			{ actor: agent, interface: 'agent' } as never,
			async () => success({})
		);
		const row = (await store.get('notification', idOf(raised))) as never;
		order.length = 0;
		await made.answer(row, 'confirm', {
			actor: { kind: 'human', id: 'local' },
			interface: 'palette',
			traceId: 't1',
		} as never);
		expect(order.slice(-3)).toEqual(['digest', 'check', 'next']);
	});

	/** A stored confirmation row for the units: keeper's, pending unless `state` says otherwise. */
	const rowOf = (id: string, state = 'pending', extra: Record<string, unknown> = {}) => ({
		id,
		workspace: 'personal',
		person: 'local',
		source: 'keeper',
		kind: 'confirmation',
		title: 'Bump',
		tone: 'warning',
		confirmation: {
			command: 'keeper-bump',
			caller: 'keeper',
			input: {},
			header: 'Keeper asks',
			prompt: 'Sure?',
			title: 'Bump',
			expiresAt: Date.now() + 600_000,
			state,
		},
		scope: { workspace: 'personal' },
		createdAt: 1,
		ckey: JSON.stringify({
			workspace: 'personal',
			person: 'local',
			caller: 'app:keeper',
			command: 'keeper-bump',
			input: '{}',
			scope: { workspace: 'personal' },
		}),
		ciface: 'palette',
		cbucket: 'app:keeper',
		...extra,
	});
	const put = (store: MemoryAdapter, row: { id: string }) =>
		store.batch([{ method: 'PUT', path: `/notification/${row.id}`, body: row }]);
	const settleOf = (made: ReturnType<typeof createConfirmations>) => (input: unknown) =>
		(made.settle.handler as (input: unknown, context: unknown) => Promise<CommandResult>)(
			input,
			{}
		);

	it('3: a pending row is confirmed by a settle only for a run the replay recorded, and a replayed run needs a pending row', async () => {
		const { made, store } = unit({ replaying: () => true });
		await put(store, rowOf('ntf_aaaaaaaaaaaaaaaa'));
		const settle = settleOf(made);
		const ended = {
			id: 'ntf_aaaaaaaaaaaaaaaa',
			person: 'local',
			command: 'keeper-bump',
			state: 'confirmed',
			result: { success: true, data: { count: 9 } },
		};
		// No run behind it: refused, the row still pending.
		expect((await settle({ settle: ended })).success).toBe(false);
		expect(
			(
				(await store.get('notification', 'ntf_aaaaaaaaaaaaaaaa')) as {
					confirmation: { state: string };
				}
			).confirmation.state
		).toBe('pending');
		// Another command's credit for this confirmation is refused (#1656).
		made.recorded('ntf_aaaaaaaaaaaaaaaa', 'keeper-set', {
			success: true,
			data: { count: 9 },
		} as CommandResult);
		expect((await settle({ settle: ended })).success).toBe(false);
		// The replay recorded this row's run with this outcome: accepted once, then consumed (#1656).
		made.recorded('ntf_aaaaaaaaaaaaaaaa', 'keeper-bump', {
			success: true,
			data: { count: 9 },
		} as CommandResult);
		expect((await settle({ settle: ended })).success).toBe(true);
		// Consumed: resetting the row to pending without a fresh credit refuses a second settle.
		await put(store, rowOf('ntf_aaaaaaaaaaaaaaaa'));
		expect((await settle({ settle: ended })).success).toBe(false);
		// A replayed run against a declined row runs nothing.
		await put(store, rowOf('ntf_bbbbbbbbbbbbbbbb', 'declined'));
		let ran = false;
		const refused = await made.gate(
			'keeper-bump',
			{},
			{ confirmation: 'ntf_bbbbbbbbbbbbbbbb', interface: 'palette', caller: 'keeper' } as never,
			async () => {
				ran = true;
				return success({});
			}
		);
		expect(refused.error?.code).toBe('HUMAN_REQUIRED');
		expect(ran).toBe(false);
	});

	it("4: a slot's replay needs the person's recorded answer, of its own command and key, and never waits", async () => {
		const { made, overlayStore } = unit({ replaying: () => true });
		const settle = settleOf(made);
		const open = (id: string, command: string) =>
			settle({
				open: {
					id,
					key: JSON.stringify({
						workspace: 'personal',
						person: 'local',
						caller: 'person',
						command,
						input: '{}',
						scope: { workspace: 'personal' },
					}),
					command,
					header: 'Run it?',
					prompt: 'Sure?',
					danger: false,
					input: {},
				},
			});
		const opened = await open('cnf_one', 'keeper-bump');
		const overlay = (opened.data as { overlay: OverlayRefV1 }).overlay.overlayId;
		// Boot's own close never answers a confirmation, with confirm least of all.
		expect((await settle({ close: overlay })).success).toBe(false);
		expect(overlayStore.get(overlay)).toBeDefined();
		let ran = false;
		const next = async () => {
			ran = true;
			return success({});
		};
		// No recorded answer: refused at once, never waiting on the overlay.
		const unanswered = await Promise.race([
			made.gate(
				'keeper-bump',
				{},
				{ confirmation: 'cnf_one', interface: 'palette' } as never,
				next
			),
			new Promise<CommandResult>((resolve) =>
				setTimeout(() => resolve({ success: false, error: { code: 'WAITED' } } as never), 200)
			),
		]);
		expect(unanswered.error?.code).toBe('REPLAY_NOT_RECORDED');
		overlayStore.close(overlay, 'cancel', 'user', undefined, true);
		// Another command's call with this confirmation's id: refused.
		const other = await open('cnf_two', 'keeper-bump');
		overlayStore.close(
			(other.data as { overlay: OverlayRefV1 }).overlay.overlayId,
			'confirm',
			'user',
			undefined,
			true
		);
		expect(
			(
				await made.gate(
					'keeper-set',
					{},
					{ confirmation: 'cnf_two', interface: 'palette' } as never,
					next
				)
			).error?.code
		).toBe('OVERLAY_NOT_FOUND');
		// Closed with confirm by no person's gesture: no run.
		const third = await open('cnf_three', 'keeper-bump');
		overlayStore.close(
			(third.data as { overlay: OverlayRefV1 }).overlay.overlayId,
			'confirm',
			'user',
			undefined,
			false
		);
		expect(
			(
				await made.gate(
					'keeper-bump',
					{},
					{ confirmation: 'cnf_three', interface: 'palette' } as never,
					next
				)
			).success
		).toBe(false);
		expect(ran).toBe(false);
	});

	it("5: a person's archive of a confirmation while its act settles is kept", async () => {
		/** A store that holds the settle's write until `open`, as a slow store would. */
		let open: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		let held = false;
		const store = new MemoryAdapter();
		const batch = store.batch.bind(store);
		store.batch = (async (
			operations: Array<{
				method: string;
				body?: { readAt?: number; confirmation?: { state?: string } };
			}>
		) => {
			const settling = operations.some(
				(each) =>
					each.method === 'PUT' &&
					each.body?.confirmation?.state === 'confirmed' &&
					each.body.readAt !== undefined
			);
			if (settling && !held) {
				held = true;
				await gate;
			}
			return batch(operations as never);
		}) as never;
		const workspace = await createScopedWorkspace({
			store,
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(workspace.kernel);
		const { kernel } = workspace;
		const asked = await kernel.agent.call('keeper-bump');
		const acting = kernel.call('notification-act', {
			notification: idOf(asked),
			answer: 'confirm',
		});
		for (let tries = 0; tries < 200 && !held; tries++) await tick();
		expect(held).toBe(true);
		const archiving = kernel.call('notification-archive', { notification: idOf(asked) });
		await tick();
		open();
		expect((await acting).success).toBe(true);
		expect((await archiving).success).toBe(true);
		const row = (await store.get('notification', idOf(asked))) as {
			archivedAt?: number;
			confirmation: { state: string };
		};
		expect(row.confirmation.state).toBe('confirmed');
		expect(row.archivedAt).toBeDefined();
	});

	it('6: a decline counts once while it is written: at 19 distinct, the 20th question still asks', async () => {
		let open: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const { made, store, overlayStore } = unit({
			openerOf: () => ({ kind: 'app', owner: { kind: 'app', id: 'keeper' } }),
			isActive: async () => true,
			// The decline's row is written, then its journaling held until `open`.
			runBoot: async (_name: string, input: unknown) => {
				const done = await (
					made.settle.handler as (input: unknown, context: unknown) => Promise<CommandResult>
				)(input, {});
				if ((input as { decline?: unknown }).decline) await gate;
				return done;
			},
		});
		const now = Date.now();
		for (let index = 0; index < SLOT_KEPT - 2; index++)
			await put(store, {
				...rowOf(`ntf_held${String(index).padStart(12, '0')}`, 'declined', {
					cslot: true,
					readAt: now,
					ckey: `held-${index}`,
				}),
				confirmation: {
					...rowOf('x').confirmation,
					state: 'declined',
					reason: 'person',
					answeredAt: now,
					expiresAt: now + DECLINE_WINDOW_MS,
				},
			} as never);
		const port = { interface: 'palette', caller: 'keeper' } as never;
		const run = async () => success({});
		// The 19th: declined, its row written, its journaling still held.
		const asked = made.gate('keeper-set', { value: 1 }, port, run);
		for (let tries = 0; tries < 100 && !overlayStore.modalOpen(); tries++) await tick();
		overlayStore.close(
			overlayStore.modalOpen()?.overlayId as string,
			'cancel',
			'user',
			undefined,
			true
		);
		for (let tries = 0; tries < 100; tries++) {
			const rows = (await store.list<{ cslot?: true }>('notification')).data.filter(
				(row) => row.cslot
			);
			if (rows.length === SLOT_KEPT - 1) break;
			await tick();
		}
		// 19 distinct declines: the 20th asks.
		const twentieth = made.gate('keeper-set', { value: 2 }, port, run);
		for (let tries = 0; tries < 100 && !overlayStore.modalOpen(); tries++) await tick();
		expect(overlayStore.modalOpen()).toBeDefined();
		overlayStore.close(
			overlayStore.modalOpen()?.overlayId as string,
			'cancel',
			'user',
			undefined,
			true
		);
		open();
		expect((await asked).error?.code).toBe('CONFIRMATION_DECLINED');
		expect((await twentieth).error?.code).toBe('CONFIRMATION_DECLINED');
		// 20 distinct: the 21st is refused.
		expect((await made.gate('keeper-set', { value: 3 }, port, run)).error?.code).toBe(
			'RATE_LIMITED'
		);
	});

	it('improvement: an entry whose redaction throws is kept unreplayable with safe fields alone; depth 8 is the bound', async () => {
		const record = {
			timestamp: '2027-01-01T00:00:00.000Z',
			traceId: 't-1',
			command: 'notification-push',
			input: { title: 'x', action: { command: 'auth-sign-in', label: 'Go', input: sign } },
			contextDigest: { hash: 'h' },
			durationMs: 1,
			result: {
				success: false,
				error: { code: 'X', message: 'm', suggestion: 's', details: { secret: 'hunter11' } },
				metadata: { secret: 'hunter11' },
			},
		};
		const kept = redactSafely(
			record as never,
			() => {
				throw new Error('boom');
			},
			() => true
		) as unknown as Record<string, unknown>;
		expect(kept.unreplayable).toBe(true);
		expect(JSON.stringify(kept)).not.toContain('hunter11');
		// A fixed diagnostic of the kernel's own (sixth round, B6).
		expect(kept.result).toMatchObject({
			success: false,
			error: { code: 'JOURNAL_REDACTION_FAILED' },
		});
		// Nine notices deep: the innermost input is past the bound, dropped.
		let action: Record<string, unknown> = {
			command: 'auth-sign-in',
			label: 'Go',
			input: { ...sign },
		};
		for (let depth = 0; depth < 9; depth++)
			action = { command: 'notification-push', label: 'Go', input: { title: 'x', action } };
		const deep = redactWrapped(
			{ ...record, input: { title: 'x', action }, result: { success: true } } as never,
			(each) => redactJournalRecord(each),
			() => true
		);
		expect(JSON.stringify(deep)).not.toContain('hunter11');
	});

	it('sixth B1: a sign-in of another person while the run waits, their membership still read, runs nothing (production wiring)', async () => {
		const BEA = 'mock-user-bea@example.com';
		const OLU = 'mock-user-olu@example.com';
		let holdList = false;
		let held = false;
		let open: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const store = new MemoryAdapter();
		const list = store.list.bind(store);
		const update = store.update.bind(store);
		// The act's claim, then the run's row lookup held: the run waits there, past its gates, before its last check.
		store.update = (async (table: string, id: string, patch: { claim?: string }) => {
			if (table === 'notification' && patch?.claim !== undefined) holdList = true;
			return update(table, id, patch as never);
		}) as never;
		store.list = (async (table: string, filter: unknown) => {
			if (table === 'notification' && holdList) {
				holdList = false;
				held = true;
				await gate;
			}
			return list(table, filter as never);
		}) as never;
		const auth = new MockAuthAdapter();
		const workspace = await createScopedWorkspace({
			store,
			auth,
			empty: true,
			deployment: deployment(),
			identity: { mode: 'provider', organization: 'acme', path: 'api/auth', methods: ['password'] },
			membership: {
				mode: 'provider',
				members: new Map([
					[OLU, 'owner'],
					[BEA, 'member'],
				]),
				digest: 'd1',
			},
			ports: {
				...ports(),
				// Olu's membership answers; Bea's read is never answered while this test runs.
				readMembership: () =>
					auth.getSession().user?.id === OLU
						? Promise.resolve({ role: 'owner' as const, digest: 'd1' })
						: new Promise(() => {}),
			} as never,
		});
		kernels.push(workspace.kernel);
		const { kernel } = workspace;
		expect(
			(
				await kernel.call('auth-sign-in', {
					method: 'credentials',
					email: 'olu@example.com',
					password: 'x',
				})
			).success
		).toBe(true);
		const asked = await kernel.agent.call('keeper-bump');
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		const acting = kernel.call('notification-act', {
			notification: idOf(asked),
			answer: 'confirm',
		});
		for (let tries = 0; tries < 200 && !held; tries++) await tick();
		expect(held).toBe(true);
		// The adapter reports Bea now; the shell's settle waits on her membership read.
		auth._setUser({ id: BEA, email: 'bea@example.com', name: 'bea' });
		for (let tries = 0; tries < 20; tries++) await tick();
		open();
		const ended = await acting;
		expect(ended.data).toMatchObject({ state: 'declined' });
		const row = (await store.get('notification', idOf(asked))) as {
			confirmation: { state: string; result?: { error?: { code: string } } };
		};
		expect(row.confirmation.state).toBe('declined');
	});

	it("sixth B4: a slot's replayed answer keeps the person's gesture past 64 other closes", async () => {
		const { made, overlayStore } = unit({ replaying: () => true });
		const settle = settleOf(made);
		const opened = await settle({
			open: {
				id: 'cnf_slow',
				key: JSON.stringify({
					workspace: 'personal',
					person: 'local',
					caller: 'person',
					command: 'keeper-bump',
					input: '{}',
					scope: { workspace: 'personal' },
				}),
				command: 'keeper-bump',
				header: 'Run it?',
				prompt: 'Sure?',
				danger: false,
				input: {},
			},
		});
		overlayStore.close(
			(opened.data as { overlay: OverlayRefV1 }).overlay.overlayId,
			'confirm',
			'user',
			undefined,
			true
		);
		// 65 other closes before the slow call reads its answer.
		for (let index = 0; index < 65; index++) {
			const toast = overlayStore.open({ kind: 'shell', id: 'shell' }, 'toast', {
				message: `t${index}`,
			} as never);
			overlayStore.close(toast.overlayId, 'dismissed', 'user');
		}
		let ran = false;
		const done = await made.gate(
			'keeper-bump',
			{},
			{ confirmation: 'cnf_slow', interface: 'palette' } as never,
			async () => {
				ran = true;
				return success({ ran: true });
			}
		);
		expect(done.success).toBe(true);
		expect(ran).toBe(true);
	});

	it("sixth: the slot's command check and key check each refuse on their own, and an agent's cnf_ takes the inbox", async () => {
		const keyFor = (command: string, input: unknown) =>
			JSON.stringify({
				workspace: 'personal',
				person: 'local',
				caller: 'person',
				command,
				input: JSON.stringify(input),
				scope: { workspace: 'personal' },
			});
		const { made, overlayStore } = unit({ replaying: () => true });
		const settle = settleOf(made);
		let ran = false;
		const next = async () => {
			ran = true;
			return success({});
		};
		const answered = async (id: string, command: string, key: string) => {
			const opened = await settle({
				open: { id, key, command, header: 'Run it?', prompt: 'Sure?', danger: false, input: {} },
			});
			overlayStore.close(
				(opened.data as { overlay: OverlayRefV1 }).overlay.overlayId,
				'confirm',
				'user',
				undefined,
				true
			);
		};
		// The key is keeper-set's with its input, the command another's: the command check alone refuses it.
		await answered('cnf_cmd', 'keeper-bump', keyFor('keeper-set', { value: 1 }));
		expect(
			(
				await made.gate(
					'keeper-set',
					{ value: 1 },
					{ confirmation: 'cnf_cmd', interface: 'palette' } as never,
					next
				)
			).error?.code
		).toBe('OVERLAY_NOT_FOUND');
		// The same command with another input: the key check alone refuses it.
		await answered('cnf_key', 'keeper-set', keyFor('keeper-set', { value: 1 }));
		expect(
			(
				await made.gate(
					'keeper-set',
					{ value: 2 },
					{ confirmation: 'cnf_key', interface: 'palette' } as never,
					next
				)
			).error?.code
		).toBe('OVERLAY_NOT_FOUND');
		expect(ran).toBe(false);
		// An agent's call carrying a slot's id takes the inbox's route, as live it would.
		const agent = unit({
			replaying: () => true,
			openerOf: () => ({
				kind: 'agent',
				owner: { kind: 'agent', id: 'agent:a' },
				bucket: 'agents:local',
			}),
		});
		expect(
			(
				await agent.made.gate(
					'keeper-bump',
					{},
					{
						confirmation: 'cnf_x',
						interface: 'agent',
						actor: { kind: 'agent', id: 'a', onBehalfOf: 'local' },
					} as never,
					next
				)
			).error?.code
		).toBe('CONFIRMATION_PENDING');
	});

	it('sixth B6: a failed redaction keeps a fixed kernel diagnostic; the depth bound drops exactly the ninth input', () => {
		const record = {
			timestamp: '2027-01-01T00:00:00.000Z',
			command: 'keeper-note',
			input: { text: 'hunter12' },
			contextDigest: { hash: 'h' },
			durationMs: 1,
			result: { success: false, error: { code: 'hunter12', message: 'hunter12 was refused' } },
		};
		const kept = redactSafely(
			record as never,
			() => {
				throw new Error('boom');
			},
			() => true
		) as unknown as { result: { error: { code: string; message: string } } };
		expect(JSON.stringify(kept)).not.toContain('hunter12');
		expect(kept.result.error.code).toBe('JOURNAL_REDACTION_FAILED');
		// Eight wrappers deep, the innermost input is kept, redacted; nine deep, it is dropped.
		const chain = (depth: number) => {
			let action: Record<string, unknown> = {
				command: 'notification-push',
				label: 'Go',
				input: { title: 'innermost' },
			};
			for (let index = 1; index < depth; index++)
				action = { command: 'notification-push', label: 'Go', input: { title: 'x', action } };
			return redactWrapped(
				{
					...record,
					command: 'notification-push',
					input: { title: 'x', action },
					result: { success: true },
				} as never,
				(each) => each,
				() => true
			).input as Record<string, unknown>;
		};
		const innermost = (input: Record<string, unknown>) => {
			let at = input;
			for (;;) {
				const action = at.action as Record<string, unknown> | undefined;
				if (!action || !('input' in action)) return action;
				at = action.input as Record<string, unknown>;
			}
		};
		expect(innermost(chain(8))).toBeUndefined();
		expect(JSON.stringify(chain(8))).toContain('innermost');
		expect(innermost(chain(9))).toMatchObject({ command: 'notification-push' });
		expect(innermost(chain(9))).not.toHaveProperty('input');
		expect(JSON.stringify(chain(9))).not.toContain('innermost');
	});

	it("sixth B7: a journal recorded in step 5's shape, an act's result with no command, replays the same", async () => {
		const { kernel, journal } = await boot();
		const pushed = await kernel
			.appPort('keeper')
			.call<{ notification: NotificationV1 }>('notification-push', {
				title: 'Count',
				action: { command: 'keeper-get', label: 'Count' },
			});
		expect(pushed.success).toBe(true);
		const acted = await kernel.call('notification-act', {
			notification: (pushed.data as { notification: NotificationV1 }).notification.id,
		});
		expect(acted.success).toBe(true);
		expect(acted.data).not.toHaveProperty('command');
		const entries = (await journal.read()).map((entry) => {
			if (entry.command !== 'notification-act') return entry;
			const { command: _command, ...data } = (entry.result.data ?? {}) as Record<string, unknown>;
			return { ...entry, result: { ...entry.result, data } };
		});
		const { report } = await replayKernel(entries, { deployment: deployment(), ports: ports() });
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('sixth B8: two marks of one notice at once count once', async () => {
		const { kernel, store, advance } = await boot();
		const pushed = await kernel
			.appPort('keeper')
			.call<{ notification: NotificationV1 }>('notification-push', { title: 'Twice' });
		const notification = (pushed.data as { notification: NotificationV1 }).notification.id;
		const first = kernel.call<{ read: number }>('notification-read', { notification });
		advance(1_000);
		const second = kernel.call<{ read: number }>('notification-read', { notification });
		const counts = (await Promise.all([first, second])).map((each) => each.data?.read ?? 0);
		expect(counts.reduce((sum, each) => sum + each, 0)).toBe(1);
		const row = (await store.get('notification', notification)) as { readAt?: number };
		expect(row.readAt).toBeDefined();
	});

	it("seventh (2): a confirmed run cut by the journal's final bound: the act's settle carries the run's own entry", async () => {
		const { kernel, journal } = await boot();
		const asked = await kernel.agent.call('keeper-big');
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		const acted = await kernel.call('notification-act', {
			notification: idOf(asked),
			answer: 'confirm',
		});
		expect(acted.data).toMatchObject({ state: 'confirmed' });
		const entries = (await journal.read()) as Array<JournalEntry & { unreplayable?: true }>;
		const run = entries.find(
			(entry) => entry.command === 'keeper-big' && entry.context?.confirmation === idOf(asked)
		);
		const settle = entries.find(
			(entry) =>
				entry.command === 'prompt-settle' &&
				(entry.input as { settle?: { id?: string } }).settle?.id === idOf(asked)
		);
		expect(run?.unreplayable).toBe(true);
		expect(settle?.unreplayable).toBeUndefined();
		expect(
			(settle?.input as { settle?: { result?: unknown } } | undefined)?.settle?.result
		).toEqual({
			success: run?.result.success,
			...(run?.result.data !== undefined ? { data: run?.result.data } : {}),
			...(run?.result.error !== undefined ? { error: run?.result.error } : {}),
		});
	});

	it("seventh (5): a palette fill whose run the journal's final bound cut journals what the run's own entry kept", async () => {
		const { kernel, journal } = await boot();
		const opened = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'keeper-big',
		});
		const filling = kernel.call('palette-run', {
			command: 'keeper-big',
			prompt: opened.data?.prompt.overlayId,
			input: {},
		});
		await kernel.call('overlay-dismiss', {
			overlayId: (await slotPrompt(kernel)).overlayId,
			result: 'confirm',
		});
		expect((await filling).success).toBe(true);
		const entries = (await journal.read()) as Array<JournalEntry & { unreplayable?: true }>;
		const run = entries.find((entry) => entry.command === 'keeper-big');
		const wrapper = entries.filter((entry) => entry.command === 'palette-run').at(-1);
		expect(run?.unreplayable).toBe(true);
		expect(wrapper?.unreplayable).toBeUndefined();
		expect(wrapper?.result.success).toBe(true);
		expect(wrapper?.result.data).toEqual(run?.result.data);
	});

	it("seventh C4: the first decline's cleanup never drops a second one's count", async () => {
		const gates: Array<() => void> = [];
		const held = (index: number) =>
			new Promise<void>((resolve) => {
				gates[index] = resolve;
			});
		const first = held(0);
		const second = held(1);
		let declines = 0;
		const { made, store, overlayStore } = unit({
			openerOf: () => ({ kind: 'app', owner: { kind: 'app', id: 'keeper' } }),
			isActive: async () => true,
			runBoot: async (_name: string, input: unknown) => {
				const settle = made.settle.handler as (
					input: unknown,
					context: unknown
				) => Promise<CommandResult>;
				if (!(input as { decline?: unknown }).decline) return settle(input, {});
				declines++;
				// The first: its row written, its journaling held. The second: held before its row is written.
				if (declines === 1) {
					const done = await settle(input, {});
					await first;
					return done;
				}
				await second;
				return settle(input, {});
			},
		});
		const now = Date.now();
		for (let index = 0; index < SLOT_KEPT - 2; index++)
			await put(store, {
				...rowOf(`ntf_held${String(index).padStart(12, '0')}`, 'declined', {
					cslot: true,
					readAt: now,
					ckey: `held-${index}`,
				}),
				confirmation: {
					...rowOf('x').confirmation,
					state: 'declined',
					reason: 'person',
					answeredAt: now,
					expiresAt: now + DECLINE_WINDOW_MS,
				},
			} as never);
		const port = { interface: 'palette', caller: 'keeper' } as never;
		const run = async () => success({});
		const decline = async (value: number) => {
			const asked = made.gate('keeper-set', { value }, port, run);
			for (let tries = 0; tries < 100 && !overlayStore.modalOpen(); tries++) await tick();
			overlayStore.close(
				overlayStore.modalOpen()?.overlayId as string,
				'cancel',
				'user',
				undefined,
				true
			);
			return asked;
		};
		const one = decline(1);
		for (let tries = 0; tries < 100 && declines < 1; tries++) await tick();
		const two = decline(2);
		for (let tries = 0; tries < 100 && declines < 2; tries++) await tick();
		// The first's journaling ends while the second is outstanding.
		gates[0]?.();
		await tick();
		await tick();
		// 19 rows and one outstanding: the bound is met, refused at once rather than asked.
		const third = await Promise.race([
			made.gate('keeper-set', { value: 3 }, port, run).then((result) => result.error?.code),
			new Promise<string>((resolve) => setTimeout(() => resolve('asking'), 200)),
		]);
		expect(third).toBe('RATE_LIMITED');
		gates[1]?.();
		expect((await one).error?.code).toBe('CONFIRMATION_DECLINED');
		expect((await two).error?.code).toBe('CONFIRMATION_DECLINED');
	});

	it('seventh (Opus 3): prompt-settle refuses a mixed input before it writes anything', async () => {
		const { made, store } = unit();
		const settle = settleOf(made);
		const refused = await settle({
			decline: {
				id: 'ntf_mixedmixedmixed',
				person: 'local',
				key: 'k',
				command: 'keeper-set',
				caller: 'keeper',
				header: 'Keeper asks',
				title: 'Set',
				prompt: 'Sure?',
				danger: false,
				scope: { workspace: 'personal' },
				input: {},
			},
			open: {
				id: 'cnf_mixed',
				key: 'k',
				command: 'keeper-set',
				header: 'Run it?',
				prompt: 'Sure?',
				danger: false,
				input: {},
			},
		});
		expect(refused.error?.code).toBe('VALIDATION_ERROR');
		expect((await store.list('notification')).data).toHaveLength(0);
	});

	it('eighth D3: a palette fill and an act of a command with an undo and warnings replay the same, whole', async () => {
		const { kernel, journal } = await boot();
		const opened = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'keeper-undo',
		});
		const filled = await kernel.call('palette-run', {
			command: 'keeper-undo',
			prompt: opened.data?.prompt.overlayId,
			input: {},
		});
		expect(filled).toMatchObject({ success: true, undoCommand: 'keeper-set' });
		const pushed = await kernel
			.appPort('keeper')
			.call<{ notification: NotificationV1 }>('notification-push', {
				title: 'Undo it',
				action: { command: 'keeper-undo', label: 'Do it' },
			});
		const acted = await kernel.call('notification-act', {
			notification: (pushed.data as { notification: NotificationV1 }).notification.id,
		});
		expect(acted.success).toBe(true);
		const entries = await journal.read();
		const wrapper = entries.filter((entry) => entry.command === 'palette-run').at(-1);
		expect(wrapper?.result).toMatchObject({
			undoCommand: 'keeper-set',
			undoArgs: { value: 0 },
			warnings: [{ code: 'KEEPER_NOTE' }],
		});
		const { report } = await replayKernel(entries, { deployment: deployment(), ports: ports() });
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});

	it('eighth D2: a child whose entry the sink rejected leaves its wrapper nothing of its outcome', async () => {
		class Refusing extends MemoryJournalSink {
			override async append(record: Parameters<MemoryJournalSink['append']>[0]) {
				if (record.command === 'keeper-note') throw new Error('The sink refused it');
				return super.append(record);
			}
		}
		const journal = new Refusing();
		const workspace = await createScopedWorkspace({
			journal,
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(workspace.kernel);
		const { kernel } = workspace;
		const opened = await kernel.call<{ prompt: OverlayRefV1 }>('palette-run', {
			command: 'keeper-note',
		});
		const filling = kernel.call('palette-run', {
			command: 'keeper-note',
			prompt: opened.data?.prompt.overlayId,
			input: { text: 'secretish' },
		});
		await kernel.call('overlay-dismiss', {
			overlayId: (await slotPrompt(kernel)).overlayId,
			result: 'confirm',
		});
		expect((await filling).data).toEqual({ text: 'secretish' });
		const entries = await journal.read();
		expect(entries.some((entry) => entry.command === 'keeper-note')).toBe(false);
		const wrapper = entries.filter((entry) => entry.command === 'palette-run').at(-1);
		expect(wrapper?.result.data).toBeUndefined();
		expect(JSON.stringify(wrapper?.result)).not.toContain('secretish');
	});

	it('eighth D4 and Opus I2: an untracked wrapper keeps the least of its outcome, lossy; a settle failure stays the act’s own', () => {
		const record = (command: string, result: unknown) =>
			({
				timestamp: '2027-01-01T00:00:00.000Z',
				traceId: 't-1',
				command,
				input: { command: 'keeper-note', prompt: 'p', input: { text: 'x' } },
				contextDigest: { hash: 'h' },
				durationMs: 0,
				result,
			}) as never;
		const untracked = {
			...createJournalProvenance(),
			tracked: () => false,
			journals: () => true,
		} as WrapperProvenance;
		const big = { success: true, data: { text: 'kept?' }, metadata: { server: 'kept?' } };
		for (const [command, result] of [
			['palette-run', big],
			['notification-act', { success: true, data: { state: 'done', result: { text: 'kept?' } } }],
			['notification-act', { success: true, data: { state: 'confirmed' } }],
			['notification-act', { success: false, error: { code: 'X', message: 'kept?', details: {} } }],
		] as const) {
			const done = redactWrapped(
				record(command, result),
				(each) => each,
				() => true,
				0,
				untracked
			) as unknown as {
				result: Record<string, unknown>;
				unreplayable?: boolean;
				lossy?: boolean;
			};
			expect(JSON.stringify(done.result), command).not.toContain('kept?');
			// Exactly the least: success, and a failure's code alone (ninth round).
			expect(done.result, command).toEqual(
				result.success ? { success: true } : { success: false, error: { code: 'X', message: '' } }
			);
			expect(done.unreplayable, command).toBe(true);
			expect(done.lossy, command).toBe(true);
		}
		// Tracked, no action started under it: the act's own failure, a settle's write among them, stays its own.
		const tracked = {
			...createJournalProvenance(),
			tracked: () => true,
			journals: () => true,
		} as WrapperProvenance;
		const own = {
			success: false,
			error: { code: 'STORE_FAILED', message: 'The store refused the settle' },
		};
		expect(
			redactWrapped(
				record('notification-act', own),
				(each) => each,
				() => true,
				0,
				tracked
			).result
		).toEqual(own);
	});

	it('ninth: an act whose claim release throws after its action failed keeps its own outcome, and a replay stops there', async () => {
		const store = new MemoryAdapter();
		const update = store.update.bind(store);
		const batch = store.batch.bind(store);
		let claimed = false;
		store.update = (async (table: string, id: string, patch: { claim?: string }) => {
			if (table === 'notification' && patch?.claim !== undefined) claimed = true;
			return update(table, id, patch as never);
		}) as never;
		// The release of the claim, after the action failed: the store refuses it.
		store.batch = (async (operations: Array<{ method: string; path: string }>) => {
			if (
				claimed &&
				operations.some(
					(each) => each.method === 'DELETE' && each.path.startsWith('/notification/')
				)
			) {
				claimed = false;
				throw new Error('The store refused the release');
			}
			return batch(operations as never);
		}) as never;
		const journal = new MemoryJournalSink();
		const workspace = await createScopedWorkspace({
			store,
			journal,
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(workspace.kernel);
		const { kernel } = workspace;
		const pushed = await kernel
			.appPort('keeper')
			.call<{ notification: NotificationV1 }>('notification-push', {
				title: 'Refuse',
				action: { command: 'keeper-refuse', label: 'Refuse' },
			});
		const acted = await kernel.call('notification-act', {
			notification: (pushed.data as { notification: NotificationV1 }).notification.id,
		});
		expect(acted.success).toBe(false);
		expect(acted.error?.code).not.toBe('KEEPER_REFUSED');
		const entries = await journal.read();
		const act = entries.find((entry) => entry.command === 'notification-act') as
			| (JournalEntry & { unreplayable?: true; lossy?: true })
			| undefined;
		// Its own outcome, the one the person saw, never the action's.
		expect(act?.result.error?.code).toBe(acted.error?.code);
		expect(act?.unreplayable).toBe(true);
		// Lossy, so a replay stops at it rather than compare it (#1672).
		expect(act?.lossy).toBe(true);
		const replayed = await replayKernel(entries, { deployment: deployment(), ports: ports() }).then(
			() => 'same',
			(error: { code?: string }) => error.code
		);
		expect(replayed).toBe('REPLAY_ENTRY_TRUNCATED');
	});

	it('seventh I2, through the kernel: a failed settle write after a failed confirmed run keeps its own error (#1672)', async () => {
		const store = new MemoryAdapter();
		const batch = store.batch.bind(store);
		/** The confirmation's writes since the run refused: the run's own record of it, then the settle's. */
		const writes: string[] = [];
		// The settle's write of the confirmation, after the run refused and recorded so: the store refuses it.
		store.batch = (async (operations: Array<{ method: string; path: string }>) => {
			const path = operations.find(
				(each) => each.method === 'DELETE' && each.path.startsWith('/notification/')
			)?.path;
			if (bumpRefused && path !== undefined) {
				writes.push(path);
				if (writes.length === 2) {
					bumpRefused = false;
					throw new Error('The store refused the settle');
				}
			}
			return batch(operations as never);
		}) as never;
		const journal = new MemoryJournalSink();
		const workspace = await createScopedWorkspace({
			store,
			journal,
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(workspace.kernel);
		const { kernel } = workspace;
		const asked = await kernel.agent.call('keeper-bump');
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		bumpRefuses = true;
		try {
			const acted = await kernel.call('notification-act', {
				notification: idOf(asked),
				answer: 'confirm',
			});
			expect(acted.success).toBe(false);
			// The settle's own failure, not the run's.
			expect(acted.error?.code).not.toBe('KEEPER_REFUSED');
			// The run recorded its refusal, and the settle was the write refused.
			expect(writes).toHaveLength(2);
			const entries = await journal.read();
			const run = entries.find((entry) => entry.command === 'keeper-bump' && entry.context?.origin);
			expect(run?.result.error?.code).toBe('KEEPER_REFUSED');
			const act = entries.find((entry) => entry.command === 'notification-act');
			// The act's entry keeps the error the person saw, its own, never the run's.
			expect(act?.result.error?.code).toBe(acted.error?.code);
			expect(act?.result.error?.code).not.toBe('KEEPER_REFUSED');
			// The settle's own entry holds the store's throw (`COMMAND_EXECUTION_ERROR`), which a replay with a healthy
			// store does not repeat: #2300 marks it lossy + unreplayable so replay stops there with REPLAY_ENTRY_TRUNCATED.
			const settle = entries.find(
				(entry) => entry.command === 'prompt-settle' && !entry.result.success
			) as (JournalEntry & { unreplayable?: true; lossy?: true }) | undefined;
			expect(settle?.result.error?.code).toBe(acted.error?.code);
			expect(settle?.lossy).toBe(true);
			expect(settle?.unreplayable).toBe(true);
			const replayed = await replayKernel(entries, {
				deployment: deployment(),
				ports: ports(),
			}).then(
				() => 'same',
				(error: { code?: string; message?: string; details?: { seq?: number } }) =>
					`${error.code} ${error.details?.seq} ${error.message}`
			);
			expect(replayed).toContain(`REPLAY_ENTRY_TRUNCATED ${(settle as JournalEntry).seq}`);
			expect(replayed).toContain('COMMAND_EXECUTION_ERROR');
		} finally {
			bumpRefuses = false;
			bumpRefused = false;
		}
	});

	it('(#2300) a deterministic handler refusal (VALIDATION_ERROR) stays replayable, not lossy', async () => {
		const journal = new MemoryJournalSink();
		const workspace = await createScopedWorkspace({
			journal,
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(workspace.kernel);
		const bad = await workspace.kernel.call('notification-act', {
			notification: 'ntf_0000000000000000',
			answer: 'confirm',
		});
		expect(bad.success).toBe(false);
		expect(bad.error?.code).toBe('NOTIFICATION_NOT_FOUND');
		const entries = (await journal.read()) as Array<
			JournalEntry & { unreplayable?: true; lossy?: true }
		>;
		const act = entries.find((entry) => entry.command === 'notification-act');
		expect(act?.lossy).toBeUndefined();
		expect(act?.unreplayable).toBeUndefined();
		const replay = await replayKernel(entries, {
			deployment: deployment(),
			ports: ports(),
		});
		expect(replay.report.diverged).toBe(false);
	});

	it('(#2300) an explicitly returned COMMAND_EXECUTION_ERROR failure stays replayable, not lossy', async () => {
		const journal = new MemoryJournalSink();
		const explicitCommand = defineCommand({
			name: 'explicit-exec-error',
			description: 'Returns COMMAND_EXECUTION_ERROR without throwing',
			input: z.strictObject({}),
			mutation: true,
			handler: async () =>
				failure({
					code: 'COMMAND_EXECUTION_ERROR',
					message: 'Deterministic returned failure',
					suggestion: 'Retry later',
				}),
		});
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			deployment: deployment(),
			ports: ports(),
			commands: [explicitCommand],
		});
		kernels.push(kernel);
		const returned = await kernel.call('explicit-exec-error', {});
		expect(returned.success).toBe(false);
		expect(returned.error?.code).toBe('COMMAND_EXECUTION_ERROR');
		const entries = (await journal.read()) as Array<
			JournalEntry & { unreplayable?: true; lossy?: true }
		>;
		const entry = entries.find((item) => item.command === 'explicit-exec-error');
		expect(entry?.lossy).toBeUndefined();
		expect(entry?.unreplayable).toBeUndefined();
		const replay = await replayKernel(entries, {
			deployment: deployment(),
			ports: ports(),
			commands: [explicitCommand],
		});
		expect(replay.report.diverged).toBe(false);
	});

	it('(#2253) replays an act whose nested action was refused while session was loading, and diverges on tamper', async () => {
		const store = new MemoryAdapter();
		const update = store.update.bind(store);
		const auth = new MockAuthAdapter();
		const getSession = auth.getSession.bind(auth);
		let loadingNow = false;
		auth.getSession = () =>
			loadingNow ? { status: 'loading', session: null, user: null } : getSession();
		const identity = {
			mode: 'provider' as const,
			organization: 'acme',
			path: 'api/auth',
			methods: ['password' as const],
		};
		const ada = 'mock-user-ada@example.com';
		const membership = {
			mode: 'provider' as const,
			members: new Map([[ada, 'owner' as const]]),
			digest: 'd1',
		};
		let loadOnClaim = false;
		store.update = (async (table: string, id: string, patch: { claim?: string }) => {
			const res = await update(table, id, patch as never);
			if (loadOnClaim && table === 'notification' && patch?.claim !== undefined) {
				loadOnClaim = false;
				loadingNow = true;
			}
			return res;
		}) as never;
		const journal = new MemoryJournalSink();
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal,
			auth,
			environment: createFixedEnvironment(),
			host: 'test',
			identity,
			membership,
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(kernel);
		const signedIn = await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'ada@example.com',
			password: 'pw',
		});
		expect(signedIn.success, JSON.stringify(signedIn.error)).toBe(true);
		const pushed = await kernel
			.appPort('keeper')
			.call<{ notification: NotificationV1 }>('notification-push', {
				title: 'Note',
				action: { command: 'keeper-note', input: { text: 'hello' }, label: 'Note' },
			});
		expect(pushed.success, JSON.stringify(pushed.error)).toBe(true);
		loadOnClaim = true;
		const acted = await kernel.call('notification-act', {
			notification: (pushed.data as { notification: NotificationV1 }).notification.id,
		});
		loadingNow = false;
		expect(acted.success).toBe(false);
		expect(acted.error?.code).toBe('UNAUTHORIZED');
		expect(acted.error?.retryable).toBe(true);
		const entries = (await journal.read()) as Array<
			JournalEntry & { unreplayable?: true; lossy?: true }
		>;
		const act = entries.find((entry) => entry.command === 'notification-act');
		expect(act?.lossy).toBeUndefined();
		expect(act?.unreplayable).toBeUndefined();
		const replay = await replayKernel(entries, {
			identity,
			membership,
			deployment: deployment(),
			ports: ports(),
		});
		expect(replay.report.diverged).toBe(false);
		const tampered = entries.map((entry) =>
			entry.command === 'notification-act'
				? {
						...entry,
						result: {
							...entry.result,
							error: {
								...entry.result.error,
								code: entry.result.error?.code ?? 'UNAUTHORIZED',
								message: 'tampered loading message',
							},
						},
					}
				: entry
		);
		const diverged = await replayKernel(tampered, {
			identity,
			membership,
			deployment: deployment(),
			ports: ports(),
		}).then(
			() => 'same',
			(error: { code?: string }) => error.code
		);
		expect(diverged).toBe('REPLAY_DIVERGED');
	});

	it('(#2253) replays an act whose nested action the session auth gate refused to same, and diverges on mismatch', async () => {
		const store = new MemoryAdapter();
		const update = store.update.bind(store);
		const auth = new MockAuthAdapter();
		const identity = {
			mode: 'provider' as const,
			organization: 'acme',
			path: 'api/auth',
			methods: ['password' as const],
		};
		const ada = 'mock-user-ada@example.com';
		const membership = {
			mode: 'provider' as const,
			members: new Map([[ada, 'owner' as const]]),
			digest: 'd1',
		};
		let signOutOnClaim = false;
		store.update = (async (table: string, id: string, patch: { claim?: string }) => {
			const res = await update(table, id, patch as never);
			// Another tab signs out while `notification-act` claims the notice, before its nested action runs.
			if (signOutOnClaim && table === 'notification' && patch?.claim !== undefined) {
				signOutOnClaim = false;
				await auth.signOut();
			}
			return res;
		}) as never;
		const journal = new MemoryJournalSink();
		const kernel = await createKernel({
			store,
			storeKind: 'memory',
			journal,
			auth,
			environment: createFixedEnvironment(),
			host: 'test',
			identity,
			membership,
			deployment: deployment(),
			ports: ports(),
		});
		kernels.push(kernel);
		const signedIn = await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'ada@example.com',
			password: 'pw',
		});
		expect(signedIn.success, JSON.stringify(signedIn.error)).toBe(true);
		const pushed = await kernel
			.appPort('keeper')
			.call<{ notification: NotificationV1 }>('notification-push', {
				title: 'Note',
				action: { command: 'keeper-note', input: { text: 'hello' }, label: 'Note' },
			});
		expect(pushed.success, JSON.stringify(pushed.error)).toBe(true);
		signOutOnClaim = true;
		const acted = await kernel.call('notification-act', {
			notification: (pushed.data as { notification: NotificationV1 }).notification.id,
		});
		expect(acted.success).toBe(false);
		expect(acted.error?.code).toBe('UNAUTHORIZED');
		const entries = (await journal.read()) as Array<
			JournalEntry & { unreplayable?: true; lossy?: true }
		>;
		// The auth gate refused the nested action before the journal ran, so it left no entry of its own.
		expect(entries.some((entry) => entry.command === 'keeper-note')).toBe(false);
		const act = entries.find((entry) => entry.command === 'notification-act');
		expect(act?.result.error?.code).toBe('UNAUTHORIZED');
		expect(act?.lossy).toBeUndefined();
		expect(act?.unreplayable).toBeUndefined();
		const replay = await replayKernel(entries, {
			identity,
			membership,
			deployment: deployment(),
			ports: ports(),
		});
		expect(replay.report.diverged).toBe(false);
		// A mismatch on the act's recorded refusal diverges rather than stopping with REPLAY_ENTRY_TRUNCATED.
		const tampered = entries.map((entry) =>
			entry.command === 'notification-act'
				? {
						...entry,
						result: {
							...entry.result,
							error: { ...entry.result.error, code: 'FORBIDDEN', message: 'altered' },
						},
					}
				: entry
		);
		const diverged = await replayKernel(tampered, {
			identity,
			membership,
			deployment: deployment(),
			ports: ports(),
		}).then(
			() => 'same',
			(error: { code?: string }) => error.code
		);
		expect(diverged).toBe('REPLAY_DIVERGED');
	});

	it('(#2253) hosted principalGate refusal of a nested action keeps notification-act whole (not lossy)', async () => {
		const store = new MemoryAdapter();
		const update = store.update.bind(store);
		const identity = {
			mode: 'provider' as const,
			organization: 'acme',
			path: 'api/auth',
			methods: ['password' as const],
		};
		const journal = new MemoryJournalSink();
		let retireOnClaim: (() => void) | undefined;
		store.update = (async (table: string, id: string, patch: { claim?: string }) => {
			const res = await update(table, id, patch as never);
			if (retireOnClaim && table === 'notification' && patch?.claim !== undefined) {
				const retire = retireOnClaim;
				retireOnClaim = undefined;
				retire();
			}
			return res;
		}) as never;
		const dep = deployment();
		const parts = await createKernelParts({
			store,
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			gate: 'principal',
			identity,
			deployment: dep,
			ports: ports(),
		});
		kernels.push(parts.kernel);
		const principal = parts.admitPrincipal?.({
			actor: { kind: 'human', id: 'usr_ada' },
			person: 'usr_ada',
			role: 'owner',
		});
		if (!principal || !parts.callAs || !parts.retirePrincipal) {
			throw new Error('principal-gated kernel missing server calls');
		}
		const pushed = await parts.callAs(
			principal,
			'notification-push',
			{
				title: 'Project',
				action: { command: 'project-create', input: { name: 'Alpha' }, label: 'Create' },
			},
			{ workspace: dep.workspace.id }
		);
		expect(pushed.success, JSON.stringify(pushed.error)).toBe(true);
		const retire = parts.retirePrincipal;
		retireOnClaim = () => retire(principal);
		const acted = await parts.callAs(
			principal,
			'notification-act',
			{ notification: (pushed.data as { notification: NotificationV1 }).notification.id },
			{ workspace: dep.workspace.id }
		);
		expect(acted.success).toBe(false);
		expect(acted.error?.code).toBe('UNAUTHORIZED');
		const entries = (await journal.read()) as Array<
			JournalEntry & { unreplayable?: true; lossy?: true }
		>;
		expect(entries.some((entry) => entry.command === 'project-create')).toBe(false);
		const act = entries.find((entry) => entry.command === 'notification-act');
		expect(act?.result.error?.code).toBe('UNAUTHORIZED');
		expect(act?.lossy).toBeUndefined();
		expect(act?.unreplayable).toBeUndefined();
		const hostedMembership = {
			mode: 'provider' as const,
			members: new Map([['usr_ada', 'owner' as const]]),
			digest: '',
		};
		const replay = await replayKernel(entries, {
			gate: 'principal',
			identity,
			membership: hostedMembership,
			deployment: dep,
			ports: ports(),
		});
		expect(replay.report.diverged).toBe(false);
		const tampered = entries.map((entry) =>
			entry.command === 'notification-act'
				? {
						...entry,
						result: {
							...entry.result,
							error: { ...entry.result.error, code: 'FORBIDDEN', message: 'tampered hosted' },
						},
					}
				: entry
		);
		const diverged = await replayKernel(tampered, {
			gate: 'principal',
			identity,
			membership: hostedMembership,
			deployment: dep,
			ports: ports(),
		}).then(
			() => 'same',
			(error: { code?: string }) => error.code
		);
		expect(diverged).toBe('REPLAY_DIVERGED');
	});

	it('ninth (Opus I3): a fill whose journaled target started but left no entry keeps the least, lossy', () => {
		const record = {
			timestamp: '2027-01-01T00:00:00.000Z',
			traceId: 't-1',
			command: 'palette-run',
			input: { command: 'keeper-note', prompt: 'p', input: { text: 'x' } },
			contextDigest: { hash: 'h' },
			durationMs: 0,
			result: { success: true, data: { text: 'kept?' }, metadata: { server: 'kept?' } },
		} as never;
		const started = {
			...createJournalProvenance(),
			tracked: () => true,
			startedOrigin: () => true,
			origin: () => undefined,
			journals: () => true,
		} as WrapperProvenance;
		const done = redactWrapped(
			record,
			(each) => each,
			() => true,
			0,
			started
		) as unknown as {
			result: unknown;
			unreplayable?: boolean;
			lossy?: boolean;
		};
		expect(done.result).toEqual({ success: true });
		expect(done.unreplayable).toBe(true);
		expect(done.lossy).toBe(true);
	});
});

describe("P4-E7: the active tab owner's port, on 6.1's table", () => {
	it("opens a toast, a dialog, a modal and a prompt as the app's while it owns the active tab, never palette-run, and only a toast once it does not", async () => {
		const { kernel } = await createScopedWorkspace({
			deployment: probeDeployment(),
			ports: probePorts(),
		});
		kernels.push(kernel);
		const made = await kernel.call<{ id: string }>('document-create', { type: 'probe' });
		await kernel.call('document-open', { document: (made.data as { id: string }).id });
		// No app is opened: probe is the active tab's owner alone.
		const port = kernel.appPort('probe');
		// 6.1's last column: `palette-run` is human-only on this path too.
		expect((await port.call('palette-run', { command: 'probe-content-set' })).error?.code).toBe(
			'CALL_NOT_GRANTED'
		);
		const opened = [];
		for (const [name, input] of [
			['toast-show', { message: 'Saved' }],
			['dialog-open', { title: 'Note', body: 'Kept.' }],
			['modal-open', { title: 'Sure?', body: 'Really.' }],
		] as const) {
			const result = await port.call<OverlayRefV1>(name, input);
			expect(result.data?.owner, name).toBe('probe');
			opened.push(result.data as OverlayRefV1);
		}
		// The slot holds the modal, so a prompt waits for it: closed, the prompt is probe's too.
		const modal = opened.at(-1) as OverlayRefV1;
		await port.call('overlay-dismiss', { overlayId: modal.overlayId, result: 'cancel' });
		const prompt = await port.call<OverlayRefV1>('prompt-open', { title: 'Name?' });
		expect(prompt.data?.owner).toBe('probe');
		// Once the tab closes, probe is an inactive app's port: its toast is still its own, the rest refused.
		await kernel.call('overlay-dismiss', {
			overlayId: (prompt.data as OverlayRefV1).overlayId,
			result: 'cancel',
		});
		expect((await kernel.call('editor-close', { tab: 't1' })).success).toBe(true);
		expect((await port.call<OverlayRefV1>('toast-show', { message: 'Later' })).data?.owner).toBe(
			'probe'
		);
		for (const [name, input] of [
			['dialog-open', { title: 'Note', body: 'Kept.' }],
			['modal-open', { title: 'Sure?', body: 'Really.' }],
			['prompt-open', { title: 'Name?' }],
		] as const)
			expect((await port.call(name, input)).error?.code, name).toBe('OVERLAY_OWNER_INACTIVE');
	});
});

describe('#1656: replay refuses crafted confirmation credit and inconsistent opener', () => {
	it('refuses a recorded confirmation credit whose command or origin does not match its act', async () => {
		const { kernel, journal } = await createScopedWorkspace({
			deployment: probeDeployment(),
			ports: probePorts(),
		});
		kernels.push(kernel);
		const made = await kernel.call<{ id: string }>('document-create', { type: 'probe' });
		const document = (made.data as { id: string }).id;
		const asked = await kernel.agent.call('probe-content-set', { document, text: 'from agent' });
		expect(asked.error?.code).toBe('CONFIRMATION_PENDING');
		const notification = (asked.error?.details as { notification?: string } | undefined)
			?.notification as string;
		const acted = await kernel.call('notification-act', { notification, answer: 'confirm' });
		expect(acted.success).toBe(true);

		const recorded = await journal.read();
		const runIndex = recorded.findIndex(
			(entry) =>
				entry.command === 'probe-content-set' && entry.context?.confirmation === notification
		);
		expect(runIndex).toBeGreaterThanOrEqual(0);
		const withRecordedRun = recorded.map((entry, index) =>
			index === runIndex ? { ...entry, context: { ...entry.context, replay: 'recorded' } } : entry
		);

		// Control: a recorded confirmed run with the right command and confirming act replays cleanly.
		await expect(
			replayKernel(withRecordedRun, { deployment: probeDeployment(), ports: probePorts() })
		).resolves.toMatchObject({ report: { diverged: false } });

		// Crafted 1: the credited entry names another command than the confirmation row's.
		const wrongCommand = withRecordedRun.map((entry, index) =>
			index === runIndex ? { ...entry, command: 'probe-content-get' } : entry
		);
		await expect(
			replayKernel(wrongCommand, { deployment: probeDeployment(), ports: probePorts() })
		).rejects.toMatchObject({
			code: 'REPLAY_DIVERGED',
			details: { firstDifference: { command: 'prompt-settle' } },
		});

		// Crafted 2: the credited entry has no confirming notification-act origin.
		const missingOrigin = withRecordedRun.map((entry, index) => {
			if (index !== runIndex) return entry;
			const { origin: _dropped, ...rest } = entry.context ?? {};
			return { ...entry, context: rest };
		});
		await expect(
			replayKernel(missingOrigin, { deployment: probeDeployment(), ports: probePorts() })
		).rejects.toMatchObject({
			code: 'REPLAY_DIVERGED',
			details: { firstDifference: { command: 'prompt-settle' } },
		});

		// Crafted 3: the credited entry points at an unrelated origin instead of the confirming act.
		const wrongOrigin = withRecordedRun.map((entry, index) =>
			index === runIndex
				? { ...entry, context: { ...entry.context, origin: 'loam-other-999' } }
				: entry
		);
		await expect(
			replayKernel(wrongOrigin, { deployment: probeDeployment(), ports: probePorts() })
		).rejects.toMatchObject({
			code: 'REPLAY_DIVERGED',
			details: { firstDifference: { command: 'prompt-settle' } },
		});

		// Crafted 4: the confirming notification-act origin arrived on a non-palette (mcp) interface.
		const actIndex = withRecordedRun.findIndex(
			(entry) => entry.traceId === withRecordedRun[runIndex]?.context?.origin
		);
		expect(actIndex).toBeGreaterThan(runIndex);
		const mcpOrigin = withRecordedRun.map((entry, index) =>
			index === actIndex
				? { ...entry, contextDigest: { ...entry.contextDigest, interface: 'mcp' } }
				: entry
		);
		await expect(
			replayKernel(mcpOrigin, { deployment: probeDeployment(), ports: probePorts() })
		).rejects.toMatchObject({
			code: 'REPLAY_DIVERGED',
			details: { firstDifference: { command: 'prompt-settle' } },
		});

		// Crafted 5: the confirming notification-act origin had answer 'decline'.
		const declinedOrigin = withRecordedRun.map((entry, index) =>
			index === actIndex ? { ...entry, input: { notification, answer: 'decline' } } : entry
		);
		await expect(
			replayKernel(declinedOrigin, { deployment: probeDeployment(), ports: probePorts() })
		).rejects.toMatchObject({
			code: 'REPLAY_DIVERGED',
			details: { firstDifference: { command: 'prompt-settle' } },
		});

		// Crafted 6: the notification-act origin returned success: true with a non-confirmed state.
		const nonConfirmedOrigin = withRecordedRun.map((entry, index) =>
			index === actIndex
				? { ...entry, result: { success: true, data: { state: 'declined', reason: 'access' } } }
				: entry
		);
		await expect(
			replayKernel(nonConfirmedOrigin, { deployment: probeDeployment(), ports: probePorts() })
		).rejects.toMatchObject({
			code: 'REPLAY_DIVERGED',
			details: { firstDifference: { command: 'prompt-settle' } },
		});

		// Crafted 7: the notification-act origin failed (success: false).
		const failedOrigin = withRecordedRun.map((entry, index) =>
			index === actIndex
				? {
						...entry,
						result: {
							success: false,
							error: { code: 'HUMAN_REQUIRED', message: 'not confirmed', suggestion: 'ask' },
						},
					}
				: entry
		);
		await expect(
			replayKernel(failedOrigin, { deployment: probeDeployment(), ports: probePorts() })
		).rejects.toMatchObject({
			code: 'REPLAY_DIVERGED',
			details: { firstDifference: { command: 'prompt-settle' } },
		});
	});

	it('refuses a crafted journal entry that pairs an app caller with an agent interface or actor on the slot route', async () => {
		const { kernel, journal } = await createScopedWorkspace({
			deployment: probeDeployment(),
			ports: probePorts(),
		});
		kernels.push(kernel);
		const made = await kernel.call<{ id: string }>('document-create', { type: 'probe' });
		const document = (made.data as { id: string }).id;
		await kernel.call('app-open', { instance: 'probe' });

		// Active app port asks in the slot; the person confirms it in the shell.
		const waiting = kernel.appPort('probe').call('probe-content-set', {
			document,
			text: 'from active app',
		});
		let promptId: string | undefined;
		for (let attempt = 0; attempt < 20 && !promptId; attempt++) {
			const listed = await kernel.call<{ overlays: Array<{ overlayId: string; kind: string }> }>(
				'overlay-list'
			);
			promptId = listed.data?.overlays.find((overlay) => overlay.kind === 'prompt')?.overlayId;
			if (!promptId) await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(promptId).toBeDefined();
		await kernel.call('overlay-dismiss', {
			overlayId: promptId,
			result: 'confirm',
			reason: 'user',
		});
		expect((await waiting).success).toBe(true);

		const recorded = await journal.read();
		const callIndex = recorded.findIndex(
			(entry) =>
				entry.command === 'probe-content-set' &&
				entry.context?.caller === 'probe' &&
				typeof entry.context?.confirmation === 'string' &&
				entry.context.confirmation.startsWith('cnf_')
		);
		expect(callIndex).toBeGreaterThanOrEqual(0);

		// Control: the recorded active-app slot confirmation replays cleanly.
		await expect(
			replayKernel(recorded, { deployment: probeDeployment(), ports: probePorts() })
		).resolves.toMatchObject({ report: { diverged: false } });

		// Crafted 1: caller paired with the agent interface.
		const agentInterface = recorded.map((entry, index) =>
			index === callIndex
				? { ...entry, contextDigest: { ...entry.contextDigest, interface: 'agent' } }
				: entry
		);
		await expect(
			replayKernel(agentInterface, { deployment: probeDeployment(), ports: probePorts() })
		).rejects.toMatchObject({
			code: 'REPLAY_DIVERGED',
			details: { firstDifference: { command: 'probe-content-set' } },
		});

		// Crafted 2: caller paired with an agent actor on the palette interface.
		const agentActor = recorded.map((entry, index) =>
			index === callIndex
				? { ...entry, actor: { kind: 'agent' as const, id: 'shell-agent' } }
				: entry
		);
		await expect(
			replayKernel(agentActor, { deployment: probeDeployment(), ports: probePorts() })
		).rejects.toMatchObject({
			code: 'REPLAY_DIVERGED',
			details: { firstDifference: { command: 'probe-content-set' } },
		});
	});
});
