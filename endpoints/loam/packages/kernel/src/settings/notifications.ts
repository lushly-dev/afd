/**
 * @fileoverview The inbox (phase 4 specification, section 10; D120), in the `late-settings` chunk beside the settings
 * (its section 1): the `notification` table, `notification-push`, `-list`, `-read`, `-archive` and `-act`, and the
 * inbox's half of `toast-show`, by which a sticky toast, and one `loam.notifications.toastSticky` selects, also lands
 * as a notice (6.1). Confirmations, `kind: 'confirmation'`, are raised by step 6's `confirmations.ts`, in the same
 * table: the protections of a pending one (R10) are here, and `notification-act` answers one through `answer`.
 *
 * Everything of `late` and first paint reaches this module through its deps, so it imports types alone (13).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type {
	ConfirmationRecordV1,
	NotificationActionV1,
	NotificationV1,
	OverlayFromV1,
	OverlayRefV1,
	ResourceLinkV1,
	ToastInputV1,
} from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { KernelFieldContext } from '../context-fields.js';
import type { LoamKernelErrorCode } from '../errors.js';
import type { StoreOrderV1 } from '../journal-order.js';
import type { PushRate } from '../overlays/push-rate.js';
import type { OverlayStore } from '../overlays/store.js';
import type { AccessActorV1 } from '../scope/access.js';
import type { DocumentKit } from '../scope/command-kit.js';
import type { ScopeV1 } from '../scope/records.js';
import { KERNEL_ONLY_FIELDS, ownedBy, stateNow, summaryOf } from './confirmations.js';
import type { NotificationPrefsV1, SettingsKit } from './settings.js';

/** The workspace store's table of notices (10.1), one row per notice, listed by `person`. */
export const NOTIFICATION_TABLE = 'notification';

/**
 * Notices kept per person (10.1): unread ones are never dropped, so a push past this many unread notices from apps and
 * agents is refused. The shell's own notices, as confirmations, count for neither side and are never refused (R1).
 */
export const NOTIFICATION_QUOTA = 500;
export const NOTIFICATION_SOURCE_QUOTA = 100;

/** `notification-list`'s page (10.2): 1 to 100, 20 by default. */
export const NOTIFICATION_PAGE = 20;
export const NOTIFICATION_PAGE_MAX = 100;

/** `notification-list`'s output budget in UTF-8 bytes (10.2): a page past it ends early, with a cursor. */
export const NOTIFICATION_LIST_BUDGET = 32_768;

/** An action's input, as JSON, at most this many bytes: a notice is a pointer, never a payload. */
export const NOTIFICATION_ACTION_INPUT_BYTES = 2_048;

/** A link's document `anchor`, as JSON, at most this many bytes, and an app `route` at most this many characters. */
export const NOTIFICATION_ANCHOR_BYTES = 1_024;
export const NOTIFICATION_ROUTE_MAX = 1_024;

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
	overlays: Pick<OverlayStore, 'land' | 'hideNext'>;
	/** Whose a notice is, as the shell shows it (6.6): step 3's owner line for an app or an agent, none for the shell. */
	fromOf(source: string): OverlayFromV1 | undefined;
	/**
	 * The queue ticket a queued act holds, as fields its action carries, so an action that waits on the person (a
	 * confirmation in the slot) releases the act's queue, and the answer reaches it (step 6's fourth round, 4).
	 */
	queueOf?(context: CommandContext): Record<symbol, unknown>;
	/**
	 * The confirmations' per-person chain, which every write to a confirmation row takes, so a read or an archive and an
	 * act's settle never write over each other (step 6's fifth round, 5).
	 */
	confirmationChain?<T>(person: string, work: () => Promise<T>): Promise<T>;
	/** The command an act runs, kept by the kernel for its journal alone, never in the result (step 6's sixth round, B7). */
	noteAction?(trace: string, command: string): void;
	/** The act returns its action's failure as its own: the journal's provenance, never in the result (ninth round). */
	noteReturned?(trace: string): void;
	/** The kernel's `run`: a call with `parent` is nested, journaled under it and never queued (phase 2's 11.1). */
	run(
		name: string,
		input: unknown,
		fields: { parent: string; scope: ScopeV1; actor?: unknown } & Record<symbol, unknown>
	): Promise<CommandResult>;
	kit: SettingsKit & Pick<DocumentKit, 'projectNotFound'>;
	/** Who a caller is to its confirmations (7.2, R1): the raising app's instance or the agent interface's bucket. */
	bucketOf?(context: CommandContext): string | undefined;
	/** Step 6's answer to a confirmation (7.2), a person's `notification-act { answer }`. Absent: none is answered. */
	answer?(
		row: NotificationV1,
		answer: 'confirm' | 'decline' | undefined,
		context: CommandContext
	): Promise<CommandResult>;
	/** The journal's read/write order tracker for the notification table (#2105, #2117). */
	recordOrder?(traceId: string, resource: string): StoreOrderV1;
}

export interface Notifications {
	commands: ZodCommandDefinition[];
	/**
	 * `toast-show` with the inbox's half (6.1, 3.7): a sticky toast, and one the person's `toastSticky` selects, also
	 * lands as a notice, its id on the toast; an explicitly sticky toast is admitted as a push is (its scope, its rate and
	 * the quota) and refused past them; a muted app's toast runs its course unseen, as the app sees any toast (R2).
	 */
	toastShow(toastShow: ZodCommandDefinition): ZodCommandDefinition;
	/**
	 * The seam for the shell's own notices to a person (10.2): an orphan autonomy row to the owners who may enter its
	 * project (step 8's `AutonomyDeps.orphaned`), an experiment's change and a deferred unload (step 9), and a limit's
	 * refusal to owners (step 10). Written inside the call that decides it, so a replay writes it again; source `shell`,
	 * outside any push rate and the quota, never refused (R1). Nothing calls it before those steps.
	 */
	shellNotice(
		context: CommandContext,
		person: string,
		fields: Pick<NotificationV1, 'title' | 'tone'> & Partial<Pick<NotificationV1, 'body' | 'link'>>
	): Promise<NotificationV1>;
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

/** A confirmation waiting for the person now (R10): protected while pending, and no longer once expired. */
const pendingConfirmation = (notice: NotificationV1, now: number): boolean =>
	notice.kind === 'confirmation' &&
	notice.confirmation !== undefined &&
	stateNow(notice.confirmation, now) === 'pending';

/** Unread, and so never dropped (10.1): no `readAt`, and not archived. */
const unread = (notice: NotificationV1): boolean =>
	notice.readAt === undefined && notice.archivedAt === undefined;

/** A notice the quota counts (10.1, R1): an app's or an agent's, never the shell's own or a confirmation. */
const counted = (notice: NotificationV1): boolean =>
	notice.kind === 'notice' && notice.source !== 'shell';

/** A notice's row as the store keeps it: the act's claim (`claim`) is the kernel's, never shown. */
type StoredNotice = NotificationV1 & { claim?: string };

const textJson = (maxLength: number): JsonSchema => ({ type: 'string', minLength: 1, maxLength });
const scopeJson: JsonSchema = {
	type: 'object',
	properties: { workspace: textJson(128), project: textJson(128) },
	required: ['workspace'],
	additionalProperties: false,
};
/** 10.1's `ResourceLinkV1`: a document's with an optional `anchor`, or an app's with an optional `route`. */
const linkJson = {
	anyOf: [
		{
			type: 'object',
			properties: {
				kind: { type: 'string', enum: ['document'] },
				document: textJson(128),
				scope: scopeJson,
				anchor: {},
			},
			required: ['kind', 'document', 'scope'],
			additionalProperties: false,
		},
		{
			type: 'object',
			properties: {
				kind: { type: 'string', enum: ['app'] },
				instance: textJson(64),
				route: textJson(NOTIFICATION_ROUTE_MAX),
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
	async function noticesOf(person: string): Promise<StoredNotice[]> {
		const listed = await store.list<StoredNotice>(NOTIFICATION_TABLE, { person } as never);
		return listed.data.filter(
			(row) => row.person === person && row.workspace === deps.workspace() && ID.test(row.id)
		);
	}

	const readOrder = (context: CommandContext) => {
		if (context.traceId === undefined) return;
		deps.recordOrder?.(context.traceId, 'record:notification')?.read();
		deps.recordOrder?.(context.traceId, 'record:confirmation')?.read();
	};
	const wroteOrder = (context: CommandContext, confirmation = false) => {
		if (context.traceId === undefined) return;
		deps.recordOrder?.(context.traceId, 'record:notification')?.wrote();
		if (confirmation) deps.recordOrder?.(context.traceId, 'record:confirmation')?.wrote();
	};

	/** What the call's actor may read (10.1): the person's own, in a scope the actor may enter now. */
	async function readable(context: CommandContext, person: string): Promise<NotificationV1[]> {
		readOrder(context);
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

	const quotaRefusal = (limit: number) =>
		fail(
			'QUOTA_EXCEEDED',
			limit === NOTIFICATION_QUOTA
				? `This inbox already has ${limit} unread notices`
				: `This source already has ${limit} unread notices in the inbox`,
			'Ask the person to read or archive notifications, then push again',
			{ details: { kind: 'notifications', limit } }
		);

	/**
	 * Each person's admission, one at a time (the reviews' race): a count, an eviction and an insert never interleave
	 * with another's, so concurrent pushes and landed toasts cannot pass the quota together.
	 */
	const chains = new Map<string, Promise<unknown>>();
	function admit<T>(person: string, work: () => Promise<T>): Promise<T> {
		const run = (chains.get(person) ?? Promise.resolve()).then(work, work);
		const tail = run.then(
			() => undefined,
			() => undefined
		);
		chains.set(person, tail);
		void tail.then(() => {
			if (chains.get(person) === tail) chains.delete(person);
		});
		return run;
	}

	const quotaSource = (source: string): string => (source.startsWith('agent:') ? 'agent:' : source);

	/** The unread quota that prevents another notice from this source. */
	function quota(notices: NotificationV1[], source: string): number | undefined {
		if (source === 'shell') return undefined;
		const held = notices.filter((row) => counted(row) && unread(row));
		if (held.length >= NOTIFICATION_QUOTA) return NOTIFICATION_QUOTA;
		const bucket = quotaSource(source);
		if (
			held.filter((row) => quotaSource(row.source) === bucket).length >= NOTIFICATION_SOURCE_QUOTA
		)
			return NOTIFICATION_SOURCE_QUOTA;
		return undefined;
	}

	/** Admit the notice and evict old read or archived notices in the same store batch. */
	async function insert(
		context: CommandContext,
		person: string,
		source: string,
		fields: Pick<NotificationV1, 'title' | 'tone'> &
			Partial<Pick<NotificationV1, 'body' | 'link' | 'action'>>
	): Promise<NotificationV1 | number> {
		const notices = (await noticesOf(person)).filter((row) => row.kind === 'notice');
		const limit = quota(notices, source);
		if (limit !== undefined) return limit;
		const spare = notices.filter((row) => !unread(row)).sort((a, b) => -newestFirst(a, b));
		const bucket = quotaSource(source);
		const sameSource = (row: NotificationV1): boolean => quotaSource(row.source) === bucket;
		const sourceExcess =
			source === 'shell'
				? 0
				: Math.max(0, notices.filter(sameSource).length - NOTIFICATION_SOURCE_QUOTA + 1);
		const ownEvicted = new Set(spare.filter(sameSource).slice(0, sourceExcess));
		const sharedExcess = Math.max(0, notices.length - ownEvicted.size - NOTIFICATION_QUOTA + 1);
		const evicted = [
			...ownEvicted,
			...spare.filter((row) => !ownEvicted.has(row)).slice(0, sharedExcess),
		];
		const record = stamp(context, person, source, fields);
		wroteOrder(context);
		const { summary } = await store.batch([
			...evicted.map((row) => ({
				method: 'DELETE' as const,
				path: `/${NOTIFICATION_TABLE}/${encodeURIComponent(row.id)}`,
			})),
			{
				method: 'PUT',
				path: `/${NOTIFICATION_TABLE}/${encodeURIComponent(record.id)}`,
				body: record,
			},
		]);
		if (summary.failed > 0) throw new Error(`The store could not write the notice '${record.id}'`);
		return record;
	}

	/** A notice's row, stamped (10.1). */
	function stamp(
		context: CommandContext,
		person: string,
		source: string,
		fields: Pick<NotificationV1, 'title' | 'tone'> &
			Partial<Pick<NotificationV1, 'body' | 'link' | 'action'>>
	): NotificationV1 {
		return {
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
	}

	/**
	 * A link's refusal (10.1), or undefined: within this workspace, an app route with no empty, `.` or `..` segment, a
	 * document anchor of at most 1 KiB. Navigation only; the shell forms the address and drops one it cannot (9.1).
	 */
	function linkRefusal(link: ResourceLinkV1): CommandResult<never> | undefined {
		const why =
			link.scope.workspace !== deps.workspace()
				? 'A link leads within this workspace'
				: link.kind === 'app' &&
						link.route !== undefined &&
						link.route.split('/').some((part) => part === '' || part === '.' || part === '..')
					? "A link's route has no empty, '.' or '..' segment"
					: link.kind === 'document' &&
							link.anchor !== undefined &&
							bytesOf(link.anchor) > NOTIFICATION_ANCHOR_BYTES
						? `A link's anchor is at most ${NOTIFICATION_ANCHOR_BYTES} bytes`
						: undefined;
		return why === undefined
			? undefined
			: fail(
					'VALIDATION_ERROR',
					why,
					'Link to a resource in this workspace, by its id and its scope'
				);
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
			anchor: z.optional(z.unknown()),
		}),
		z.strictObject({
			kind: z.enum(['app']),
			instance: z.string().check(z.minLength(1), z.maxLength(64)),
			route: z.optional(z.string().check(z.minLength(1), z.maxLength(NOTIFICATION_ROUTE_MAX))),
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
			const link = input.link as ResourceLinkV1 | undefined;
			const badLink = link && linkRefusal(link);
			if (badLink) return badLink;
			// Counted the moment it is admitted, with no await between the check and the count (the reviews' race); a
			// push the quota then refuses stays counted.
			const limit = source.kind === 'agent' ? deps.limits.agent : deps.limits.app;
			const at = kit.callNow(context);
			const wait = deps.pushRate.retryAfter(source.bucket, limit, at);
			if (wait !== undefined)
				return rateRefusal(limit, wait, source.kind === 'agent' ? 'An agent leaves' : 'It leaves');
			deps.pushRate.record(source.bucket, at);
			const notification = await admit(person, () =>
				insert(context, person, sourceName(source), {
					title: input.title,
					tone: input.tone ?? 'info',
					...(input.body !== undefined ? { body: input.body } : {}),
					...(link !== undefined ? { link } : {}),
					...(action !== undefined ? { action } : {}),
				})
			);
			if (typeof notification === 'number') return quotaRefusal(notification);
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
		notification: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
	});

	/**
	 * A row as the list gives it (10.2): whose it is (6.6); `body` and a confirmation's `input` only when asked; never
	 * the act's claim.
	 */
	const shown = (
		row: StoredNotice,
		body: boolean,
		now: number,
		reader: { bucket?: string; one: boolean; human: boolean; session?: unknown }
	): NotificationV1 => {
		const copy = structuredClone(row);
		const raisedBy = (row as { cbucket?: string }).cbucket;
		for (const field of KERNEL_ONLY_FIELDS)
			delete (copy as unknown as Record<string, unknown>)[field];
		if (copy.confirmation) {
			const record = copy.confirmation as ConfirmationRecordV1;
			// A pending confirmation past its 10 minutes is listed `expired` (7.2): no write records it.
			record.state = stateNow(record, now);
			// Its outcome is the raiser's, as `confirmation-get` gives it (R1); its input is the person's or the raiser's
			// alone, never another agent's or the copilot's (#1868). A list bounds its input; a read by id shows it whole
			// to the person or raiser.
			const isOwner = ownedBy(
				{ cbucket: raisedBy, cslot: (row as { cslot?: unknown }).cslot, confirmation: record },
				reader.bucket,
				reader.session
			);
			if (!isOwner) delete record.result;
			if (!reader.human && !isOwner) delete record.input;
			// A preview is the person's alone (phase 5's 7.2): an agent reads which read it is, never its data or digest.
			if (!reader.human && record.preview)
				record.preview = { command: record.preview.command } as typeof record.preview;
			if (!reader.one && record.input !== undefined) record.input = summaryOf(record.input);
			// And its stored outcome, as its input (step 6's second round, 8): a large result never breaks a page.
			if (!reader.one && record.result !== undefined) record.result = summaryOf(record.result);
		}
		const from = deps.fromOf(copy.source);
		if (from) copy.from = from;
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
			'List your inbox, newest first: notices, and confirmations waiting for you. unread is how many you have not read. body adds each body; notification names one notice',
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
				notification: textJson(64),
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
						(input.notification === undefined || row.id === input.notification) &&
						(after === undefined ||
							newestFirst(row, { createdAt: after.createdAt, id: after.id } as NotificationV1) > 0)
				)
				.sort(newestFirst);
			const limit = input.limit ?? NOTIFICATION_PAGE;
			const unreadCount = all.filter(unread).length;
			const reader = {
				one: input.notification !== undefined,
				human: deps.humanGesture(context),
				session: (context as { trace?: { session?: unknown } }).trace?.session,
				...((b) => (b === undefined ? {} : { bucket: b }))(deps.bucketOf?.(context)),
			};
			const page: NotificationV1[] = [];
			// The budget (10.2): a page ends early rather than past it, with the cursor to the rest.
			let bytes = bytesOf({ notifications: [], cursor: 'x'.repeat(40), unread: unreadCount });
			for (const row of matching) {
				if (page.length >= limit) break;
				const item = shown(row, input.body === true, kit.callNow(context), reader);
				const size = bytesOf(item) + 1;
				// A read of one notice by id shows it whole (blocker 9): a confirmation's input is bounded by the call's own.
				if (bytes + size > NOTIFICATION_LIST_BUDGET && !reader.one) {
					// A page cut by the byte budget may depend on bytes the journal later redacts (wrapped action or
					// confirmation inputs), so replay answers from the recorded redacted page (#2105).
					(context as KernelFieldContext).replay = 'recorded';
					if (page.length > 0) break;
					// One row past the budget alone: a bounded refusal, never a page past it.
					return fail(
						'OUTPUT_BUDGET_EXCEEDED',
						`The notice '${row.id}' does not fit the list's ${NOTIFICATION_LIST_BUDGET} bytes`,
						'List without body, then read the notice by its id'
					);
				}
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
					if (pendingConfirmation(row, kit.callNow(context)) && !human) {
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
							(human || !pendingConfirmation(row, kit.callNow(context)))
					);
				}
				const at = kit.callNow(context);
				let count = 0;
				// Decided and written in the person's chain, on the row as it stands there, so two marks never both count, and
				// the second never replaces the first's time (step 6's sixth round, B8).
				const chained = <T>(work: () => Promise<T>) =>
					deps.confirmationChain ? deps.confirmationChain(person, work) : work();
				for (const row of chosen) {
					const marked = await chained(async () => {
						const now = await store.get<NotificationV1>(NOTIFICATION_TABLE, row.id);
						if (!now || now[field] !== undefined) return false;
						wroteOrder(context, now.kind === 'confirmation');
						await store.update(NOTIFICATION_TABLE, row.id, { [field]: at } as never);
						return true;
					});
					if (marked) count++;
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

	/** The notices whose action runs in this page now, by id (the reviews' acting twice). */
	const acting = new Set<string>();
	const stillActing = () =>
		fail(
			'NOTIFICATION_ACTION_UNAVAILABLE',
			"This notice's action is running, or ran with no outcome recorded, so it does not run again",
			'Look in its app for what it did, then archive the notice'
		);
	/**
	 * The row as stored now: the claim's read-back. `null` when it is gone (evicted or deleted); `'failed'` when the store
	 * could not be read, which is not the same (the verification of `2995bb7e`).
	 */
	const reread = async (id: string): Promise<StoredNotice | null | 'failed'> => {
		try {
			return (await store.get<StoredNotice>(NOTIFICATION_TABLE, id)) ?? null;
		} catch {
			return 'failed';
		}
	};
	/** A row put back whole, in one batch, so a field a merge keeps (`state`, `claim`) goes: a `PUT` merges. */
	const putBack = async (row: StoredNotice) => {
		const path = `/${NOTIFICATION_TABLE}/${encodeURIComponent(row.id)}`;
		const { summary } = await store.batch([
			{ method: 'DELETE', path },
			{ method: 'PUT', path, body: row },
		]);
		if (summary.failed > 0) throw new Error(`The store could not write the notice '${row.id}'`);
	};

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
				// A person's confirm or decline (7.2): the shell re-checks access and runs the call itself, once.
				if (!deps.answer) {
					return fail(
						'NOTIFICATION_ACTION_UNAVAILABLE',
						'This build does not answer confirmations',
						'Answer it where the shell serves confirmations'
					);
				}
				return deps.answer(row, input.answer, context) as Promise<CommandResult<never>>;
			}
			if (input.answer !== undefined) {
				return fail(
					'VALIDATION_ERROR',
					'answer is for a confirmation; a notice runs its action',
					'Leave answer out'
				);
			}
			if (row.state === 'done') return kit.success({ state: 'done' as const });
			if (row.state === 'acting' || acting.has(row.id)) return stillActing();
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
			// Claimed before it runs (the reviews' acting twice): in this page by id, and in the store, read back, so
			// another tab sharing the store that claimed it since does not run it too. The store has no compare-and-set,
			// so two tabs that write and read back in lockstep can still both run it: the window is the claim's two store
			// calls. A claim whose completion is never written stays `acting`, and never runs again.
			acting.add(row.id);
			try {
				const claim = `${context.traceId ?? ''}:${newId(context)}`;
				wroteOrder(context);
				await store.update(NOTIFICATION_TABLE, row.id, { state: 'acting', claim } as never);
				const claimed = await reread(row.id);
				// Unread, gone or claimed by another: nothing runs. A claim this call wrote but could not read back stays,
				// and the notice never runs.
				if (claimed === null || claimed === 'failed' || claimed.claim !== claim)
					return stillActing();
				// As the person, at the notice's scope, nested under this call: the chain decides it as any call of theirs.
				if (context.traceId !== undefined) deps.noteAction?.(context.traceId, action.command);
				const result = await deps.run(action.command, action.input ?? {}, {
					...deps.queueOf?.(context),
					parent: context.traceId ?? '',
					scope: row.scope,
					...(context.actor ? { actor: context.actor } : {}),
				});
				// Put back from the row as stored now, not the claim's snapshot, so a read or an archive made meanwhile (in
				// another tab) stands; only the claim's fields change. A row gone meanwhile (evicted by the quota, or deleted)
				// stays gone: nothing writes it again past the quota. A read that fails falls back to the claimed row, as
				// before: the claim is released or completed, at the cost of a read or an archive made meanwhile.
				const now = await reread(row.id);
				const base = now === 'failed' ? claimed : now;
				const { state: _state, claim: _claim, ...kept } = base ?? claimed;
				if (!result.success) {
					// Nothing ran: the claim goes, so the person may try again.
					if (base) await putBack(kept);
					// Noted only once the release is written, as it returns the action's failure (step 6's ninth round).
					if (context.traceId !== undefined) deps.noteReturned?.(context.traceId);
					return result as CommandResult<never>;
				}
				const at = kit.callNow(context);
				try {
					if (base)
						await putBack({
							...kept,
							state: 'done',
							...(kept.readAt === undefined ? { readAt: at } : {}),
						});
				} catch {
					// The action ran; the notice stays `acting`, which never runs it again.
				}
				// Step 5's shape: the action's command is the journal's private provenance, never here (sixth round, B7).
				return kit.success({
					state: 'done' as const,
					...(result.data !== undefined ? { result: structuredClone(result.data) } : {}),
				});
			} finally {
				acting.delete(row.id);
			}
		},
	});

	// ─── toast-show's inbox half ────────────────────────────────────────────────────

	function toastShow(original: ZodCommandDefinition): ZodCommandDefinition {
		/**
		 * Show it, hidden for a muted app: the store opens it hidden, so it counts against the hidden toasts' cap alone.
		 * The original reaches `open` with no await before it on an app's path, so the flag is the one it takes.
		 */
		const show = async (input: unknown, context: CommandContext, hidden = false) => {
			deps.overlays.hideNext(hidden);
			try {
				return (await original.handler(input, context)) as CommandResult<OverlayRefV1>;
			} finally {
				deps.overlays.hideNext(false);
			}
		};
		/** A landed toast's notice: its message as the title, cut to 120, with the whole message as the body. */
		const fieldsOf = (toast: ToastInputV1) => ({
			title: toast.message.length > 120 ? `${toast.message.slice(0, 119)}…` : toast.message,
			...(toast.message.length > 120 ? { body: toast.message } : {}),
			tone: toast.tone ?? ('info' as const),
			...(toast.link !== undefined ? { link: toast.link } : {}),
		});
		return {
			...original,
			async handler(input: unknown, context: CommandContext) {
				const toast = input as ToastInputV1;
				const source = deps.sourceOf(context);
				const person = personOf(context);
				// No one's path, or no person: the original refuses or shows it, landing nothing.
				if (source.kind === 'none' || person === undefined) return show(input, context);
				const sticky = toast.sticky === true;
				const actor = context.actor as AccessActorV1;
				const at = kit.callNow(context);
				if (sticky) {
					// An explicitly sticky toast is a notice its owner asked for, admitted as a push is (the reviews' bypass):
					// its scope, then its rate, counted at once (an agent's in the original, as a toast), then the quota.
					if (!deps.allows(actor, scopeOf(context))) return kit.projectNotFound();
					if (source.kind !== 'agent') {
						const wait = deps.pushRate.retryAfter(source.bucket, deps.limits.app, at);
						if (wait !== undefined) return rateRefusal(deps.limits.app, wait, 'It leaves');
						deps.pushRate.record(source.bucket, at);
					}
				}
				// The shell's own toast shows whatever the person's record does: one that cannot be read gives the defaults,
				// as the shell is never muted and its toast then lands only as `danger` would (R9's "keys not ready").
				const prefs = await deps.prefs(context).catch((cause: unknown) => {
					if (source.kind !== 'shell') throw cause;
					return { toastSticky: 'danger' as const, muted: [] as readonly string[] };
				});
				const muted = source.kind === 'app' && prefs.muted.includes(source.instance);
				if (sticky) {
					return admit(person, async () => {
						const limit = quota(await noticesOf(person), sourceName(source));
						if (limit !== undefined) return quotaRefusal(limit);
						const shown = await show(input, context, muted);
						if (!shown.success || !shown.data) return shown;
						const ref = shown.data;
						const notice = await insert(context, person, sourceName(source), fieldsOf(toast));
						if (typeof notice === 'number') return kit.success(ref);
						deps.overlays.land(ref.overlayId, notice.id);
						return kit.success({ ...ref, notification: notice.id });
					});
				}
				// A muted app's toast runs its course unseen: the app sees what it would of any toast (3.7, R2).
				const shown = await show(input, context, muted);
				if (!shown.success || !shown.data) return shown;
				const ref = shown.data;
				// One the person's `toastSticky` selects lands within its owner's scope, rate and the quota, or not at all;
				// the result never says which, so no app reads the person's setting from it (R2).
				if (!deps.landsInInbox(toast, prefs.toastSticky) || !deps.allows(actor, scopeOf(context)))
					return kit.success(ref);
				if (source.kind !== 'agent') {
					if (deps.pushRate.retryAfter(source.bucket, deps.limits.app, at) !== undefined)
						return kit.success(ref);
					deps.pushRate.record(source.bucket, at);
				}
				await admit(person, async () => {
					const notice = await insert(context, person, sourceName(source), fieldsOf(toast));
					if (typeof notice !== 'number') deps.overlays.land(ref.overlayId, notice.id);
				});
				return kit.success(ref);
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
			const notice = await admit(person, () => insert(context, person, 'shell', fields));
			return structuredClone(notice as NotificationV1);
		},
	};
}

/** A source's name on the record (10.1): the instance, `agent:<id>`, or `shell`. */
function sourceName(source: Exclude<NoticeSource, { kind: 'none' }>): string {
	return source.kind === 'app' ? source.instance : source.kind === 'agent' ? source.id : 'shell';
}

/** What an orphaned autonomy row is to its notice (4.2): its id, and the project it is set for, if any. */
export interface OrphanRowV1 {
	id: string;
	level: 'workspace' | 'project';
	project?: string;
}

/**
 * Who hears of orphaned autonomy rows (4.2, 10.2): each owner, with the rows they may see, a project's only when they may
 * enter its project, a workspace row always; a project row naming no project, no one (fail closed). An owner with none
 * hears nothing.
 */
export function orphanRecipients<Row extends OrphanRowV1>(
	rows: readonly Row[],
	owners: readonly string[],
	mayEnter: (person: string, project: string) => boolean
): Map<string, Row[]> {
	const heard = new Map<string, Row[]>();
	for (const owner of owners) {
		const theirs = rows.filter(
			(row) =>
				row.level === 'workspace' || (row.project !== undefined && mayEnter(owner, row.project))
		);
		if (theirs.length > 0) heard.set(owner, theirs);
	}
	return heard;
}

/** Most rows an orphan notice names by id; the rest are counted. */
const ORPHANS_NAMED = 10;

/** The shell's notice of orphaned autonomy rows (4.2): one per owner per settle, naming the rows. */
export function orphanNotice(rows: readonly OrphanRowV1[]): {
	title: string;
	body: string;
	tone: 'warning';
} {
	const count = rows.length;
	const named = rows.slice(0, ORPHANS_NAMED).map((row) => row.id);
	const more = count > ORPHANS_NAMED ? `, and ${count - ORPHANS_NAMED} more` : '';
	return {
		title:
			count === 1
				? 'An autonomy rule no longer matches an app or command'
				: `${count} autonomy rules no longer match an app or command`,
		body: `Each still bounds what agents may do, and decides nothing on its own. Review or remove ${
			count === 1 ? 'it' : 'them'
		} in Settings, under Autonomy: ${named.join(', ')}${more}.`.slice(0, 1000),
		tone: 'warning',
	};
}
