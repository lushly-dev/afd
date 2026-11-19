/**
 * @fileoverview The inbox (phase 4 specification, section 10; D120), in the `late-settings` chunk beside the settings
 * (its section 1): the `notification` table, `notification-push`, `-list`, `-read`, `-archive` and `-act`, and the
 * inbox's half of `toast-show`, by which a sticky toast, and one `loam.notifications.toastSticky` selects, also lands
 * as a notice (6.1). Confirmations, `kind: 'confirmation'`, are step 6's: the record's shape and the protections of a
 * pending one (R10) are here, raising and answering one are not.
 *
 * Everything of `late` and first paint reaches this module through its deps, so it imports types alone (13).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type {
	NotificationActionV1,
	NotificationV1,
	OverlayRefV1,
	ToastInputV1,
	ToastLinkV1,
} from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { KernelFieldContext } from '../context-fields.js';
import type { LoamKernelErrorCode } from '../errors.js';
import type { OverlayStore } from '../overlays.js';
import type { AccessActorV1 } from '../scope/access.js';
import type { ScopeV1 } from '../scope/records.js';
import type { PushRate } from './push-rate.js';
import type { NotificationPrefsV1, SettingsKit } from './settings.js';

/** The workspace store's table of notices (10.1), one row per notice, listed by `person`. */
export const NOTIFICATION_TABLE = 'notification';

/** Notices kept per person (10.1): unread ones are never dropped, so a push past this many unread is refused. */
export const NOTIFICATION_QUOTA = 500;

/** `notification-list`'s page (10.2): 1 to 100, 20 by default. */
export const NOTIFICATION_PAGE = 20;
export const NOTIFICATION_PAGE_MAX = 100;

/** `notification-list`'s output budget in UTF-8 bytes (10.2): a page past it ends early, with a cursor. */
export const NOTIFICATION_LIST_BUDGET = 32_768;

/** An action's input, as JSON, at most this many bytes: a notice is a pointer, never a payload. */
export const NOTIFICATION_ACTION_INPUT_BYTES = 2_048;

const ID = /^ntf_[a-z0-9]{16}$/;
const CURSOR = /^(\d{1,16})\.(ntf_[a-z0-9]{16})$/;
const TONES = ['info', 'success', 'warning', 'danger'] as const;

/**
 * Who pushed a notice (10.1's table), derived from the call's path, never given: a port's instance; the agent
 * interface's `agent:<id>`, in the agents' push-rate bucket that its toasts share (6.1, the step 3 review's R-b); the
 * shell, for a person's own gesture; or no one, for any other path, which pushes nothing.
 */
export type NoticeSource =
	| { kind: 'app'; instance: string; bucket: string }
	| { kind: 'agent'; id: string; bucket: string }
	| { kind: 'shell'; bucket: string }
	| { kind: 'none' };

/**
 * What an action is to the pushing app (10.1): one of its own palette commands; a human or owner command
 * (`OVERLAY_ITEM_RESERVED`); another app's or no palette command (`NOTIFICATION_ACTION_FOREIGN`); or with input its
 * command refuses.
 */
export type ActionVerdict =
	| { kind: 'own' }
	| { kind: 'reserved'; why: string }
	| { kind: 'foreign'; why: string }
	| { kind: 'invalid'; why: string };

export interface NotificationDeps {
	store: DataAdapter;
	/** The workspace's id, which every row carries. */
	workspace(): string;
	/** Whether the deployment's identity is `provider`: then a call with no person has no inbox. */
	provider: boolean;
	/** `decideAccess` on a scope (10.1's "reads are filtered"): whether the call's actor may enter it now. */
	allows(actor: AccessActorV1, scope: ScopeV1): boolean;
	/** The path a call came by: `late/`'s `openerOf` over step 1's `isHumanGesture`. */
	sourceOf(context: CommandContext): NoticeSource;
	/** Step 1's `isHumanGesture`: only a person's own gesture read-marks or archives a pending confirmation (R10). */
	humanGesture(context: CommandContext): boolean;
	/** An action's verdict for the pushing app, or for the shell's own palette commands (10.1). */
	actionCheck(
		owner: { kind: 'app'; instance: string } | { kind: 'shell' },
		action: { command: string; input?: unknown }
	): ActionVerdict;
	/** The push rate the agents' toasts count against (6.1, 10.2), and its limits a minute. */
	pushRate: PushRate;
	limits: { agent: number; app: number };
	/** The call's person's `loam.notifications` (3.7). */
	prefs(context: CommandContext): Promise<NotificationPrefsV1>;
	/** Step 3's `landsInInbox` (6.1). */
	landsInInbox(
		input: Pick<ToastInputV1, 'sticky' | 'tone'>,
		toastSticky: NotificationPrefsV1['toastSticky']
	): boolean;
	overlays: Pick<OverlayStore, 'land' | 'openClosed'>;
	/** The kernel's `run`: a call with `parent` is nested, journaled under it and never queued (phase 2's 11.1). */
	run(
		name: string,
		input: unknown,
		fields: { parent: string; scope: ScopeV1; actor?: unknown }
	): Promise<CommandResult>;
	kit: SettingsKit;
}

export interface Notifications {
	commands: ZodCommandDefinition[];
	/**
	 * `toast-show` with the inbox's half (6.1, 3.7): a sticky toast, and one the person's `toastSticky` selects, also
	 * lands as a notice, its id on the toast; an app's sticky toast counts against its push rate and the quota, and is
	 * refused past them; a muted app's toast is never shown, recorded closed at once.
	 */
	toastShow(toastShow: ZodCommandDefinition): ZodCommandDefinition;
	/**
	 * The seam for the shell's own notices to a person (10.2): an orphan autonomy row to the owners who may enter its
	 * project (step 8's `AutonomyDeps.orphaned`), an experiment's change and a deferred unload (step 9), and a limit's
	 * refusal to owners (step 10). Written inside the call that decides it, so a replay writes it again; source `shell`,
	 * outside any push rate; nothing when the person is at the quota. Nothing calls it before those steps.
	 */
	shellNotice(
		context: CommandContext,
		person: string,
		fields: Pick<NotificationV1, 'title' | 'tone'> & Partial<Pick<NotificationV1, 'body' | 'link'>>
	): Promise<NotificationV1 | undefined>;
}

/** `ntf_` and 16 of `[a-z0-9]` from the call's random, so a replay reproduces it (10.1). */
const newId = (context: CommandContext): string => {
	const draw = () => (context.random?.next() ?? Math.random()).toString(36).slice(2);
	return `ntf_${`${draw()}${draw()}0000000000000000`.slice(0, 16)}`;
};

/** Newest first, ties by id (10.2). */
const newestFirst = (a: NotificationV1, b: NotificationV1): number =>
	b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const bytesOf = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/** A pending confirmation (R10): step 6 raises them; a step 5 store may already hold one from a later build. */
const pendingConfirmation = (notice: NotificationV1): boolean =>
	notice.kind === 'confirmation' &&
	(notice.confirmation as { state?: unknown } | undefined)?.state === 'pending';

/** Unread, and so never dropped (10.1): no `readAt`, and not archived. */
const unread = (notice: NotificationV1): boolean =>
	notice.readAt === undefined && notice.archivedAt === undefined;

const textJson = (maxLength: number): JsonSchema => ({ type: 'string', minLength: 1, maxLength });
const scopeJson: JsonSchema = {
	type: 'object',
	properties: { workspace: textJson(128), project: textJson(128) },
	required: ['workspace'],
	additionalProperties: false,
};
/** A toast's link (6.4), which a notice carries too (10.1): a document's, or an app's with no `route`. */
const linkJson = {
	anyOf: [
		{
			type: 'object',
			properties: {
				kind: { type: 'string', enum: ['document'] },
				document: textJson(128),
				scope: scopeJson,
			},
			required: ['kind', 'document', 'scope'],
			additionalProperties: false,
		},
		{
			type: 'object',
			properties: {
				kind: { type: 'string', enum: ['app'] },
				instance: textJson(64),
				scope: scopeJson,
			},
			required: ['kind', 'instance', 'scope'],
			additionalProperties: false,
		},
	],
} as unknown as JsonSchema;
/** `{ notification }` or `{ all: true; source? }` (10.2); `all` is checked true in the handler. */
const ONE_OR_ALL_JSON = {
	type: 'object',
	anyOf: [
		{
			type: 'object',
			properties: { notification: textJson(64) },
			required: ['notification'],
			additionalProperties: false,
		},
		{
			type: 'object',
			properties: { all: { type: 'boolean' }, source: textJson(160) },
			required: ['all'],
			additionalProperties: false,
		},
	],
} as unknown as JsonSchema;

export function createNotifications(deps: NotificationDeps): Notifications {
	const { store, kit } = deps;
	const { z } = kit;

	const fail = (
		code: LoamKernelErrorCode,
		message: string,
		suggestion: string,
		extra: { details?: Record<string, unknown>; retryable?: boolean } = {}
	) => kit.kernelFailure(code, message, suggestion, extra);

	/** The call's person: the actor's, else `local` outside `provider` mode, where every call is the one person's. */
	const personOf = (context: CommandContext): string | undefined =>
		kit.personKey(context.actor as AccessActorV1) ?? (deps.provider ? undefined : 'local');

	const noPerson = () =>
		fail(
			'HUMAN_REQUIRED',
			'No one is signed in, so there is no inbox here',
			'Sign in, then try again'
		);

	/** Every notice of the person's, oldest dropped first by the quota; never another person's (10.1). */
	async function noticesOf(person: string): Promise<NotificationV1[]> {
		const listed = await store.list<NotificationV1>(NOTIFICATION_TABLE, { person } as never);
		return listed.data.filter(
			(row) => row.person === person && row.workspace === deps.workspace() && ID.test(row.id)
		);
	}

	/** What the call's actor may read (10.1): the person's own, in a scope the actor may enter now. */
	async function readable(context: CommandContext, person: string): Promise<NotificationV1[]> {
		const actor = context.actor as AccessActorV1;
		return (await noticesOf(person)).filter((row) => deps.allows(actor, row.scope));
	}

	const notFound = (id: string) =>
		fail(
			'NOTIFICATION_NOT_FOUND',
			`You have no notice '${id}'`,
			'List your notices with notification-list'
		);

	/** The call's scope, as a notice keeps it: the workspace, and the project when there is one. */
	const scopeOf = (context: CommandContext): ScopeV1 => {
		const scope = (context as KernelFieldContext).scope;
		return scope?.project === undefined
			? { workspace: scope?.workspace ?? deps.workspace() }
			: { workspace: scope.workspace, project: scope.project };
	};

	/** `RATE_LIMITED` for a push past its source's rate (10.2): always with its details, and the rate is fixed. */
	const rateRefusal = (limit: number, retryAfterMs: number, what: string) =>
		fail(
			'RATE_LIMITED',
			`${what} at most ${limit} notices a minute`,
			'Wait for retryAfterMs, then push again; the rate is fixed',
			{ retryable: true, details: { limit, retryAfterMs } }
		);

	const quotaRefusal = () =>
		fail(
			'QUOTA_EXCEEDED',
			`The person has ${NOTIFICATION_QUOTA} unread notices, which are never dropped`,
			'Ask the person to read or archive notifications, then push again',
			{ details: { kind: 'notifications', limit: NOTIFICATION_QUOTA } }
		);

	/**
	 * Room for one more notice (10.1): refused while the person holds 500 unread notices, which are never dropped;
	 * otherwise the oldest read or archived notices go until there is room. Confirmations count for neither (R10).
	 */
	async function makeRoom(person: string): Promise<CommandResult<never> | undefined> {
		const notices = (await noticesOf(person)).filter((row) => row.kind === 'notice');
		if (notices.filter(unread).length >= NOTIFICATION_QUOTA) return quotaRefusal();
		const spare = notices.filter((row) => !unread(row)).sort((a, b) => -newestFirst(a, b));
		for (let over = notices.length - NOTIFICATION_QUOTA + 1; over > 0 && spare.length > 0; over--) {
			await store.remove(NOTIFICATION_TABLE, (spare.shift() as NotificationV1).id);
		}
		return undefined;
	}

	/** A notice's row, stamped and written (10.1). */
	async function write(
		context: CommandContext,
		person: string,
		source: string,
		fields: Pick<NotificationV1, 'title' | 'tone'> &
			Partial<Pick<NotificationV1, 'body' | 'link' | 'action'>>
	): Promise<NotificationV1> {
		const record: NotificationV1 = {
			id: newId(context),
			workspace: deps.workspace(),
			person,
			source,
			kind: 'notice',
			title: fields.title,
			...(fields.body !== undefined ? { body: fields.body } : {}),
			tone: fields.tone,
			...(fields.link !== undefined ? { link: structuredClone(fields.link) } : {}),
			...(fields.action !== undefined ? { action: structuredClone(fields.action) } : {}),
			scope: scopeOf(context),
			createdAt: kit.callNow(context),
		};
		await store.create(NOTIFICATION_TABLE, record as never);
		return record;
	}

	/** An action's refusal for its pusher (10.1), or undefined for one of its own palette commands. */
	function actionRefusal(
		owner: { kind: 'app'; instance: string } | { kind: 'shell' },
		action: NotificationActionV1
	): CommandResult<never> | undefined {
		if (
			action.input !== undefined &&
			(typeof action.input !== 'object' || action.input === null || Array.isArray(action.input))
		) {
			return fail(
				'VALIDATION_ERROR',
				"The action's input must be an object",
				"Give the action the input its command's schema asks for, as an object"
			);
		}
		if (bytesOf(action.input ?? {}) > NOTIFICATION_ACTION_INPUT_BYTES) {
			return fail(
				'VALIDATION_ERROR',
				`The action's input is over ${NOTIFICATION_ACTION_INPUT_BYTES} bytes`,
				'Give the action a small input that names what it acts on, such as an id',
				{ details: { limit: NOTIFICATION_ACTION_INPUT_BYTES } }
			);
		}
		const verdict = deps.actionCheck(owner, action);
		if (verdict.kind === 'own') return undefined;
		const details = { command: action.command };
		if (verdict.kind === 'reserved')
			return fail('OVERLAY_ITEM_RESERVED', verdict.why, 'Let the person run it from the palette', {
				details,
			});
		if (verdict.kind === 'foreign')
			return fail(
				'NOTIFICATION_ACTION_FOREIGN',
				verdict.why,
				"Use one of this app's own palette commands as the action",
				{ details }
			);
		return fail(
			'VALIDATION_ERROR',
			`The action's input does not match '${action.command}': ${verdict.why}`,
			"Give the action the input its command's schema asks for",
			{ details }
		);
	}

	// ─── notification-push ──────────────────────────────────────────────────────────

	const linkInput = z.union([
		z.strictObject({
			kind: z.enum(['document']),
			document: z.string().check(z.minLength(1), z.maxLength(128)),
			scope: z.strictObject({
				workspace: z.string().check(z.minLength(1), z.maxLength(128)),
				project: z.optional(z.string().check(z.minLength(1), z.maxLength(128))),
			}),
		}),
		z.strictObject({
			kind: z.enum(['app']),
			instance: z.string().check(z.minLength(1), z.maxLength(64)),
			scope: z.strictObject({
				workspace: z.string().check(z.minLength(1), z.maxLength(128)),
				project: z.optional(z.string().check(z.minLength(1), z.maxLength(128))),
			}),
		}),
	]);
	const pushInput = z.strictObject({
		title: z.string().check(z.minLength(1), z.maxLength(120)),
		body: z.optional(z.string().check(z.minLength(1), z.maxLength(1000))),
		tone: z.optional(z.enum([...TONES])),
		link: z.optional(linkInput),
		action: z.optional(
			z.strictObject({
				command: z.string().check(z.minLength(1), z.maxLength(128)),
				label: z.string().check(z.minLength(1), z.maxLength(40)),
				input: z.optional(z.unknown()),
			})
		),
	});

	const push = kit.define<typeof pushInput, { notification: NotificationV1 }>({
		name: 'notification-push',
		title: 'Leave a notice',
		description:
			"Leave the person a notice in their inbox: a title, and optionally a body, a link, and for an app one of its own palette commands as an action. Who left it is derived, never given. 10 a minute for an app, 5 for an agent's toasts and notices together",
		category: 'notification',
		mutation: true,
		executionTime: 'instant',
		input: pushInput,
		jsonSchema: {
			type: 'object',
			properties: {
				title: textJson(120),
				body: textJson(1000),
				tone: { type: 'string', enum: [...TONES] },
				link: linkJson,
				action: {
					type: 'object',
					properties: {
						command: textJson(128),
						label: textJson(40),
						// An object, checked in the handler: the kit's Zod has no record (10.1).
						input: {} as JsonSchema,
					},
					required: ['command', 'label'],
					additionalProperties: false,
				},
			},
			required: ['title'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const source = deps.sourceOf(context);
			if (source.kind === 'none') {
				return fail(
					'HUMAN_REQUIRED',
					'Only a person, an app or the agent interface leaves a notice',
					'Leave it from the shell, an app, or the agent interface'
				);
			}
			const person = personOf(context);
			if (person === undefined) return noPerson();
			const action = input.action as NotificationActionV1 | undefined;
			// An agent's notice carries no action (10.1): what it would run is a confirmation, raised by calling it.
			if (source.kind === 'agent' && action !== undefined) {
				return fail(
					'NOTIFICATION_ACTION_UNAVAILABLE',
					"An agent's notice carries no action",
					'Push it with a link instead, or call the command itself for a confirmation'
				);
			}
			if (source.kind !== 'agent' && action !== undefined) {
				const refused = actionRefusal(
					source.kind === 'app' ? { kind: 'app', instance: source.instance } : { kind: 'shell' },
					action
				);
				if (refused) return refused;
			}
			const limit = source.kind === 'agent' ? deps.limits.agent : deps.limits.app;
			const at = kit.callNow(context);
			const wait = deps.pushRate.retryAfter(source.bucket, limit, at);
			if (wait !== undefined)
				return rateRefusal(limit, wait, source.kind === 'agent' ? 'An agent leaves' : 'It leaves');
			const room = await makeRoom(person);
			if (room) return room;
			const notification = await write(context, person, sourceName(source), {
				title: input.title,
				tone: input.tone ?? 'info',
				...(input.body !== undefined ? { body: input.body } : {}),
				...(input.link !== undefined ? { link: input.link as ToastLinkV1 } : {}),
				...(action !== undefined ? { action } : {}),
			});
			deps.pushRate.record(source.bucket, at);
			return kit.success({ notification: structuredClone(notification) });
		},
	});

	// ─── notification-list ──────────────────────────────────────────────────────────

	const listInput = z.strictObject({
		cursor: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
		unread: z.optional(z.boolean()),
		source: z.optional(z.string().check(z.minLength(1), z.maxLength(160))),
		kind: z.optional(z.enum(['notice', 'confirmation'])),
		limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(NOTIFICATION_PAGE_MAX))),
		body: z.optional(z.boolean()),
	});

	/** A row as the list gives it (10.2): `body` and a confirmation's `input` only when asked. */
	const shown = (row: NotificationV1, body: boolean): NotificationV1 => {
		const copy = structuredClone(row);
		if (body) return copy;
		delete copy.body;
		if (copy.confirmation) delete (copy.confirmation as { input?: unknown }).input;
		return copy;
	};

	const list = kit.define<
		typeof listInput,
		{ notifications: NotificationV1[]; cursor: string | null; unread: number }
	>({
		name: 'notification-list',
		title: 'List your notices',
		description:
			'List your inbox, newest first: notices, and confirmations waiting for you. unread is how many you have not read. body adds each body',
		category: 'notification',
		mutation: false,
		executionTime: 'instant',
		input: listInput,
		jsonSchema: {
			type: 'object',
			properties: {
				cursor: textJson(64),
				unread: { type: 'boolean' },
				source: textJson(160),
				kind: { type: 'string', enum: ['notice', 'confirmation'] },
				limit: { type: 'integer', minimum: 1, maximum: NOTIFICATION_PAGE_MAX },
				body: { type: 'boolean' },
			},
			additionalProperties: false,
		},
		async handler(input, context) {
			const person = personOf(context);
			if (person === undefined) return noPerson();
			let after: { createdAt: number; id: string } | undefined;
			if (input.cursor !== undefined) {
				const match = CURSOR.exec(input.cursor);
				if (!match) {
					return fail(
						'VALIDATION_ERROR',
						'The cursor is not one notification-list gave',
						'Pass the cursor from the previous page, or leave it out to start again'
					);
				}
				after = { createdAt: Number(match[1]), id: match[2] as string };
			}
			const all = (await readable(context, person)).filter((row) => row.archivedAt === undefined);
			const matching = all
				.filter(
					(row) =>
						(input.unread === undefined || unread(row) === input.unread) &&
						(input.source === undefined || row.source === input.source) &&
						(input.kind === undefined || row.kind === input.kind) &&
						(after === undefined ||
							newestFirst(row, { createdAt: after.createdAt, id: after.id } as NotificationV1) > 0)
				)
				.sort(newestFirst);
			const limit = input.limit ?? NOTIFICATION_PAGE;
			const unreadCount = all.filter(unread).length;
			const page: NotificationV1[] = [];
			// The budget (10.2): a page ends early rather than past it, with the cursor to the rest.
			let bytes = bytesOf({ notifications: [], cursor: 'x'.repeat(40), unread: unreadCount });
			for (const row of matching) {
				if (page.length >= limit) break;
				const item = shown(row, input.body === true);
				const size = bytesOf(item) + 1;
				if (page.length > 0 && bytes + size > NOTIFICATION_LIST_BUDGET) break;
				page.push(item);
				bytes += size;
			}
			const last = page.at(-1);
			const more = last !== undefined && matching.length > page.length;
			return kit.success({
				notifications: page,
				cursor: more ? `${last.createdAt}.${last.id}` : null,
				unread: unreadCount,
			});
		},
	});

	// ─── notification-read, notification-archive ───────────────────────────────────

	const oneOrAll = z.union([
		z.strictObject({ notification: z.string().check(z.minLength(1), z.maxLength(64)) }),
		z.strictObject({
			all: z.boolean(),
			source: z.optional(z.string().check(z.minLength(1), z.maxLength(160))),
		}),
	]);

	/**
	 * Mark one notice or all of them (10.2): `readAt` or `archivedAt`, once. A pending confirmation is skipped by `all`
	 * and refused alone, `HUMAN_REQUIRED`, unless the call is a person's own gesture (R10), so no agent hides one.
	 */
	function marking(
		name: 'notification-read' | 'notification-archive',
		field: 'readAt' | 'archivedAt',
		counted: 'read' | 'archived'
	) {
		return kit.define<typeof oneOrAll, Record<string, number>>({
			name,
			title: name === 'notification-read' ? 'Mark notices read' : 'Archive notices',
			description:
				name === 'notification-read'
					? 'Mark one notice read, or all of them, or all from one source; a confirmation waiting for the person only by the person'
					: 'Archive one notice, or all of them, or all from one source, out of the list; a confirmation waiting for the person only by the person',
			category: 'notification',
			mutation: true,
			executionTime: 'instant',
			input: oneOrAll,
			jsonSchema: ONE_OR_ALL_JSON,
			async handler(input, context) {
				const person = personOf(context);
				if (person === undefined) return noPerson();
				const human = deps.humanGesture(context);
				const rows = await readable(context, person);
				let chosen: NotificationV1[];
				if ('notification' in input) {
					const row = rows.find((each) => each.id === input.notification);
					if (!row) return notFound(input.notification);
					if (pendingConfirmation(row) && !human) {
						return fail(
							'HUMAN_REQUIRED',
							'A confirmation waiting for the person is read or archived only by the person',
							'Tell the person it is in their inbox'
						);
					}
					chosen = [row];
				} else {
					if (input.all !== true) {
						return fail(
							'VALIDATION_ERROR',
							'all must be true',
							'Pass { all: true }, or name one notice with { notification }'
						);
					}
					chosen = rows.filter(
						(row) =>
							(input.source === undefined || row.source === input.source) &&
							(human || !pendingConfirmation(row))
					);
				}
				const at = kit.callNow(context);
				let count = 0;
				for (const row of chosen) {
					if (row[field] !== undefined) continue;
					await store.update(NOTIFICATION_TABLE, row.id, { [field]: at } as never);
					count++;
				}
				return kit.success({ [counted]: count });
			},
		});
	}

	// ─── notification-act ───────────────────────────────────────────────────────────

	const actInput = z.strictObject({
		notification: z.string().check(z.minLength(1), z.maxLength(64)),
		answer: z.optional(z.enum(['confirm', 'decline'])),
	});

	const act = kit.define<typeof actInput, { state: 'done'; result?: unknown }>({
		name: 'notification-act',
		title: 'Act on a notice',
		description:
			"Run a notice's action as yourself, which marks it done and read. Only a person acts on a notice",
		category: 'notification',
		mutation: true,
		executionTime: 'instant',
		input: actInput,
		jsonSchema: {
			type: 'object',
			properties: {
				notification: textJson(64),
				answer: { type: 'string', enum: ['confirm', 'decline'] },
			},
			required: ['notification'],
			additionalProperties: false,
		},
		async handler(input, context) {
			// A human command (`HUMAN_COMMANDS`): the chain refuses an agent first; refused here too, failing closed.
			if (!deps.humanGesture(context)) {
				return fail(
					'HUMAN_REQUIRED',
					'Only a person acts on a notice, as themselves',
					'Ask the person to act on it from their inbox'
				);
			}
			const person = personOf(context);
			if (person === undefined) return noPerson();
			const row = (await readable(context, person)).find((each) => each.id === input.notification);
			if (!row || row.archivedAt !== undefined) return notFound(input.notification);
			if (row.kind === 'confirmation') {
				// Step 6 answers a confirmation; until then nothing runs.
				return fail(
					'NOTIFICATION_ACTION_UNAVAILABLE',
					'A confirmation is answered with confirm or decline, which this build does not serve yet',
					'Answer it once the shell serves confirmations'
				);
			}
			if (input.answer !== undefined) {
				return fail(
					'VALIDATION_ERROR',
					'answer is for a confirmation; a notice runs its action',
					'Leave answer out'
				);
			}
			if (row.state === 'done') return kit.success({ state: 'done' as const });
			const action = row.action;
			if (!action || row.source.startsWith('agent:')) {
				return fail(
					'NOTIFICATION_ACTION_UNAVAILABLE',
					'This notice has no action',
					'Follow its link, or archive it'
				);
			}
			// The action is checked again: the app may have changed, been disabled or gone since it pushed.
			const refused = actionRefusal(
				row.source === 'shell' ? { kind: 'shell' } : { kind: 'app', instance: row.source },
				action
			);
			if (refused) return refused;
			// As the person, at the notice's scope, nested under this call: the chain decides it as any call of theirs.
			const result = await deps.run(action.command, action.input ?? {}, {
				parent: context.traceId ?? '',
				scope: row.scope,
				...(context.actor ? { actor: context.actor } : {}),
			});
			if (!result.success) return result as CommandResult<never>;
			const at = kit.callNow(context);
			await store.update(NOTIFICATION_TABLE, row.id, {
				state: 'done',
				...(row.readAt === undefined ? { readAt: at } : {}),
			} as never);
			return kit.success({
				state: 'done' as const,
				...(result.data !== undefined ? { result: structuredClone(result.data) } : {}),
			});
		},
	});

	// ─── toast-show's inbox half ────────────────────────────────────────────────────

	function toastShow(original: ZodCommandDefinition): ZodCommandDefinition {
		return {
			...original,
			async handler(input: unknown, context: CommandContext) {
				const toast = input as ToastInputV1;
				const source = deps.sourceOf(context);
				const person = personOf(context);
				// No one's path, or no person: the original refuses or shows it, landing nothing.
				if (source.kind === 'none' || person === undefined)
					return original.handler(input, context) as Promise<CommandResult>;
				const prefs = await deps.prefs(context);
				let lands = deps.landsInInbox(toast, prefs.toastSticky);
				const at = kit.callNow(context);
				// An agent's toast counts against its rate in the original, once, whether or not it lands.
				const counts = lands && source.kind !== 'agent';
				if (counts) {
					const limit = deps.limits.app;
					const wait = deps.pushRate.retryAfter(source.bucket, limit, at);
					const full =
						(await noticesOf(person)).filter((row) => row.kind === 'notice' && unread(row))
							.length >= NOTIFICATION_QUOTA;
					// A sticky toast is a notice the app asked for: refused past its rate or the quota (10.2). One the
					// person's `toastSticky` selects is shown regardless, and lands only within them.
					if (toast.sticky === true) {
						if (wait !== undefined) return rateRefusal(limit, wait, 'It leaves');
						if (full) return quotaRefusal();
					} else if (wait !== undefined || full) lands = false;
				}
				let ref: OverlayRefV1;
				const muted = source.kind === 'app' && prefs.muted.includes(source.instance);
				if (source.kind === 'app' && muted) {
					// Never shown as a toast (3.7): recorded closed, so no toast on screen is pushed off for it.
					ref = deps.overlays.openClosed(
						{ kind: 'app', id: source.instance },
						toast,
						lands ? 'inbox' : 'user'
					);
				} else {
					const shownResult = (await original.handler(
						input,
						context
					)) as CommandResult<OverlayRefV1>;
					if (!shownResult.success || !shownResult.data) return shownResult;
					ref = shownResult.data;
				}
				if (!lands) return kit.success(ref);
				const room = await makeRoom(person);
				if (room) return kit.success(ref);
				const message = toast.message;
				const notice = await write(context, person, sourceName(source), {
					title: message.length > 120 ? `${message.slice(0, 119)}…` : message,
					...(message.length > 120 ? { body: message } : {}),
					tone: toast.tone ?? 'info',
					...(toast.link !== undefined ? { link: toast.link } : {}),
				});
				if (source.kind !== 'agent') deps.pushRate.record(source.bucket, at);
				if (!muted) deps.overlays.land(ref.overlayId, notice.id);
				return kit.success({ ...ref, notification: notice.id });
			},
		} as ZodCommandDefinition;
	}

	return {
		commands: [
			push,
			list,
			marking('notification-read', 'readAt', 'read'),
			marking('notification-archive', 'archivedAt', 'archived'),
			act,
		] as unknown as ZodCommandDefinition[],
		toastShow,
		async shellNotice(context, person, fields) {
			if (await makeRoom(person)) return undefined;
			return structuredClone(await write(context, person, 'shell', fields));
		},
	};
}

/** A source's name on the record (10.1): the instance, `agent:<id>`, or `shell`. */
function sourceName(source: Exclude<NoticeSource, { kind: 'none' }>): string {
	return source.kind === 'app' ? source.instance : source.kind === 'agent' ? source.id : 'shell';
}
