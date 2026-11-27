/**
 * @fileoverview Confirmations' constants, the row the store keeps, and the pure rules the gate and the inbox share
 * (phase 4 specification, 7.1, 7.2, 10.2): buckets and ownership, a row's state now, a list's bound, and the palette's
 * prompt of a command's input. Apart from `confirmations.ts` so that file keeps to the size gate; it imports types alone.
 */

import type { Actor, CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type {
	ConfirmationAskedV1,
	ConfirmationRecordV1,
	ConfirmationStateV1,
	NotificationV1,
	PromptFieldV1,
	PromptSchemaV1,
} from '@lushly-dev/loam-sdk';
import type { LoamKernelErrorCode } from '../errors.js';
import type { Opener } from '../overlays/commands.js';
import type { ScopeV1 } from '../scope/records.js';
import type { SettingsKit } from './settings.js';

/** The workspace store's table the inbox keeps its rows in (10.1): a pending confirmation is one of them. */
export const TABLE = 'notification';

/** A pending confirmation expires after 10 minutes (7.2). */
export const CONFIRMATION_TTL_MS = 600_000;
/** After a decline, a call on the same key is refused without asking for 60 seconds (R16). */
export const DECLINE_WINDOW_MS = 60_000;
/** At most 5 pending per caller (7.2). */
export const PENDING_LIMIT = 5;
/** Ended confirmations kept per person past their key's life, the newest; older ones go when a new one is raised. */
export const ENDED_KEPT = 50;
/**
 * At most this many confirmations a person holds within their 10-minute life, from every caller together (the trust
 * review's R3): no set of callers fills the person's inbox, which confirmations do not count against.
 */
export const PERSON_LIMIT = 50;
/** At most this many live slot declines a person holds from one app (step 6's second round, 9; third round, E). */
export const SLOT_KEPT = 20;

export const ID = /^ntf_[a-z0-9]{16}$/;

/** A confirmation's row as the store keeps it: the record, and what the kernel alone reads, never listed. */
export type StoredConfirmation = NotificationV1 & {
	kind: 'confirmation';
	confirmation: ConfirmationRecordV1;
	/** The key (F4): the caller, the command, the input's digest and the scope, of one person in one workspace. */
	ckey: string;
	/** The actor that asked, and the interface it asked through: the shell's run is the same call (7.2). */
	cactor?: Actor;
	ciface: 'palette' | 'agent' | 'apps';
	/**
	 * Who raised it, as the kernel tells callers apart (the trust review's R1): an app's instance, or the agent
	 * interface's bucket, one per person (the copilot apart), since an agent's name is the caller's own choice. The key,
	 * the limits and who reads or withdraws it go by it; `source` and `confirmation.caller` only say who asked.
	 */
	cbucket: string;
	/** A decline in the slot, kept so the window holds across a reload and the inbox's path (blocker 6). */
	cslot?: true;
	/** The agent that raised it, by id (phase 5's 9.2 and 9.3): whom `event-list` and `shell-open` let read it. */
	raiserAgent?: string;
	/** The act's claim, as a notice's (step 5): a confirm runs once. */
	claim?: string;
};

/** The fields a row carries that no list shows (10.2). */
export const KERNEL_ONLY_FIELDS = [
	'ckey',
	'cactor',
	'ciface',
	'cbucket',
	'cslot',
	'claim',
	'raiserAgent',
] as const;

/**
 * Who a caller is to its confirmations (R1), each in a namespace of its own (step 6's second round, 5), so an instance
 * named `person` or `agents` is never the shell's or an agent's: `app:<instance>`, the agent interface's `agents:<person>`
 * or `copilot:<person>`, or `person` for a person's own gesture.
 */
export const bucketOf = (opener: Opener): string | undefined =>
	opener.kind === 'app'
		? `app:${opener.owner.id}`
		: opener.kind === 'agent'
			? opener.bucket
			: opener.kind === 'shell'
				? 'person'
				: undefined;

/**
 * The one ownership rule (R1; second round, 5): whether `bucket` raised `row`, so it may `confirmation-get` it,
 * `confirmation-withdraw` it, and see its stored result in a list. A person's own gesture owns none.
 */
export const ownedBy = (
	row: { cbucket?: unknown; cslot?: unknown; confirmation?: { session?: unknown } },
	bucket: string | undefined,
	session?: unknown
): boolean =>
	bucket !== undefined &&
	bucket !== 'person' &&
	row.cslot === undefined &&
	row.cbucket === bucket &&
	// The copilot's own session's alone (phase 5's 6.2, T19): every session of a person shares its bucket.
	(row.confirmation?.session === undefined || row.confirmation.session === session);

/** The state a row stands in now: a pending one past its `expiresAt` has expired (7.2), which no write records. */
export function stateNow(record: ConfirmationRecordV1, now: number): ConfirmationStateV1 {
	return record.state === 'pending' && now >= record.expiresAt ? 'expired' : record.state;
}

/** What a command's `confirm_prompt` asks, as the gate needs it. */
export interface AskedFor {
	/** The app's text, shown beneath the shell's header. */
	prompt: string;
	/** The instance whose command it is. */
	instance: string;
	/** The command's title, which Confirm and Decline name (15). */
	title: string;
	danger: boolean;
	/** Phase 5's enforcement of an agent's call (its 6.1), from the gate before this one. */
	enforced?: EnforcedV1;
	/** Phase 5's 7.2: a released mounted command's preview, which the person sees and the confirm re-checks. */
	preview?: AskedPreviewV1;
}

export { RESHOW, type ReshowV1 } from './reshow.js';

/**
 * A preview as the shell shows it (phase 5 specification, 7.2): the read, its canonical digest, its data for the person
 * alone with its instance's labels, and `changed` when it differed from what the person saw before.
 */
export interface AskedPreviewV1 {
	command: string;
	digest: string;
	data: unknown;
	labels: 'whole' | 'per-part';
	changed?: true;
}

/**
 * Where phase 5's enforcement (its 6.1) leaves its decision on the call's context, for the confirmations' gate after it.
 * `Symbol.for`, so the copilot's chunk names the same key without importing this one; no input or `_meta` can carry a
 * symbol.
 */
export const ENFORCED = Symbol.for('dev.loam/enforced');

/**
 * Where the confirmations' gate leaves the id of the confirmation it raised, or found pending on the key, for an agent's
 * call: the one id the copilot's port takes (the re-check's binding), never a result's own `details`.
 */
export const RAISED = Symbol.for('dev.loam/raised');

/** A stored outcome answered again (phase 5's 5.1): taint reads it as what its run was, never the kernel's own answer. */
export const STORED = Symbol.for('dev.loam/stored');

/** `result`, marked {@link STORED} with the confirmation whose stored outcome it is. */
export const markStored = <T extends object>(result: T, confirmation: string): T =>
	Object.assign(result, { [STORED]: confirmation }) as T;

/** What enforcement adds to a confirmation's record (phase 5's 6.2): why, and the copilot's session, group and trace. */
export const enforcedFields = (enforced: EnforcedV1 | undefined) =>
	enforced === undefined
		? {}
		: {
				asked: structuredClone(enforced.asked),
				...(enforced.group !== undefined ? { group: enforced.group } : {}),
				...(enforced.session !== undefined ? { session: enforced.session } : {}),
				...(enforced.trace !== undefined ? { trace: { ...enforced.trace } } : {}),
			};

/** What enforcement decided (phase 5's 6.1, 6.2): whether to ask whatever the command declares, and why. */
export interface EnforcedV1 {
	/** `ask`: raise a confirmation even for a command with no `confirm_prompt`. */
	ask: boolean;
	asked: ConfirmationAskedV1;
	/** The copilot's session, which the key holds (6.2), and its turn's group and trace. */
	session?: string;
	group?: string;
	trace?: { session: string; turn: number; call: string };
}

/** The kernel's own field on a call `palette-run` makes: the input prompt its confirmation replaces (R15). */
export const REPLACES = Symbol('replaces');

/** `value` as JSON: a value with no JSON form is stored as `null`. */
export const jsonOf = (value: unknown): unknown => {
	const text = JSON.stringify(value);
	return text === undefined ? null : JSON.parse(text);
};

/** A list's bound on a confirmation's input (blocker 9): past it, a list shows its size, and a read by id the whole. */
export const LISTED_INPUT_BYTES = 2_048;

/** A confirmation's input as a list shows it: whole when small, else `{ truncated: true, bytes }`. */
export const summaryOf = (input: unknown): unknown => {
	const bytes = jsonBytes(input);
	return bytes <= LISTED_INPUT_BYTES ? input : { truncated: true, bytes };
};

/** `value`'s JSON in UTF-8 bytes, as a list measures what it bounds. */
const jsonBytes = (value: unknown): number =>
	new TextEncoder().encode(JSON.stringify(value) ?? 'null').length;

/**
 * A list's bound on a confirmation's preview data (#2801): past it, a list shows its size, and a read by id the whole. A
 * preview may be up to 64 KiB (`PREVIEW_MAX_BYTES`), twice a list page's budget, so a list never carries one whole.
 */
export const LISTED_PREVIEW_BYTES = 8_192;

/**
 * A confirmation's preview as a list shows it (#2801): without `body`, never its data, as its input; with `body`, its
 * data when small, else `truncated` and its size, which a read by id shows whole.
 */
export const listedPreviewOf = <T extends { data?: unknown }>(preview: T, body: boolean): T => {
	const { data, ...rest } = preview;
	if (data === undefined) return preview;
	if (!body) return rest as T;
	const bytes = jsonBytes(data);
	return bytes <= LISTED_PREVIEW_BYTES
		? preview
		: ({ ...rest, truncated: true, bytes } as unknown as T);
};

/** A run's outcome as a confirmation keeps it: its success, data and error, never its timing (a replay's differs). */
export const outcomeOf = (result: CommandResult): unknown =>
	jsonOf({
		success: result.success,
		...(result.data !== undefined ? { data: result.data } : {}),
		...(result.error !== undefined ? { error: result.error } : {}),
	});

/** What makes a schema more than plain fields: the palette's prompt cannot ask for it. */
const COMPOSED = ['oneOf', 'anyOf', 'allOf', 'not', 'if', '$ref', 'patternProperties'] as const;

/** The keywords a plain field may carry (6.4): no `pattern`, since an app gives the shell no regular expression. */
const FIELD_KEYS = [
	'title',
	'description',
	'enum',
	'minLength',
	'maxLength',
	'minimum',
	'maximum',
] as const;

/**
 * A prompt's fields for a command's input (7.1, 6.4): an object of at most 12 plain fields, `string`, `number`,
 * `integer` or `boolean`, each with its title, description, choices and bounds; none at all for a command that takes
 * none. Undefined for any other input, which the palette cannot ask for. A field's `pattern` and `format` are left to
 * the command's own schema, which checks the input when it runs.
 */
export function promptSchemaOf(json: unknown): PromptSchemaV1 | undefined {
	const schema = json as { type?: unknown; properties?: unknown; required?: unknown } | undefined;
	if (schema?.type !== 'object') return undefined;
	// A choice of shapes, a reference or a condition is no form of plain fields (blocker 4: a top-level `oneOf`).
	if (COMPOSED.some((word) => word in (schema as object))) return undefined;
	const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
	if (typeof properties !== 'object' || Array.isArray(properties)) return undefined;
	const keys = Object.keys(properties);
	if (keys.length > 12 || !keys.every((key) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)))
		return undefined;
	const fields: Record<string, PromptFieldV1> = {};
	for (const key of keys) {
		const property = properties[key] ?? {};
		if (COMPOSED.some((word) => word in property)) return undefined;
		const type = property.type;
		if (type !== 'string' && type !== 'number' && type !== 'integer' && type !== 'boolean')
			return undefined;
		const field: Record<string, unknown> = { type };
		for (const name of FIELD_KEYS) {
			const value = property[name];
			if (value === undefined) continue;
			if ((name === 'title' || name === 'description') && typeof value === 'string')
				field[name] = value.slice(0, name === 'title' ? 80 : 200);
			else if (name === 'enum' && Array.isArray(value) && value.length <= 50) field[name] = value;
			else if (typeof value === 'number') field[name] = value;
		}
		fields[key] = field as unknown as PromptFieldV1;
	}
	const required = Array.isArray(schema.required)
		? schema.required.filter((key): key is string => typeof key === 'string' && keys.includes(key))
		: [];
	return {
		type: 'object',
		properties: fields,
		...(required.length > 0 ? { required } : {}),
	} as PromptSchemaV1;
}

/** A kernel refusal, as `createConfirmations`' kit makes one. */
export type Fail = (
	code: LoamKernelErrorCode,
	message: string,
	suggestion: string,
	extra?: { details?: Record<string, unknown>; retryable?: boolean }
) => CommandResult<never>;

/** The refusals of 7.2 and 16, each in words with its suggestion. */
export function refusalsOf(fail: Fail) {
	const pending = (row: StoredConfirmation) =>
		fail(
			'CONFIRMATION_PENDING',
			`'${row.confirmation.command}' waits for the person to confirm it`,
			'Tell the person it is in their inbox; read it with confirmation-get',
			{
				retryable: true,
				details: { notification: row.id, expiresAt: row.confirmation.expiresAt },
			}
		);
	const declined = (command: string, details?: Record<string, unknown>) =>
		fail(
			'CONFIRMATION_DECLINED',
			details?.reason === 'access'
				? `'${command}' was not run: access to it changed before it could`
				: details?.reason === 'withdrawn'
					? `'${command}' was not run: its question closed without the person's answer`
					: `The person declined '${command}'`,
			details?.reason === 'access'
				? 'Check that the app is enabled here and that you may enter this scope, then ask again'
				: 'Ask the person before trying again; do not repeat the call',
			details ? { details } : {}
		);
	const asking = (command: string, overlay: string | undefined) =>
		fail(
			'CONFIRMATION_PENDING',
			`'${command}' waits for the person to answer it in the shell`,
			'Wait for their answer; do not repeat the call',
			{ retryable: true, details: overlay !== undefined ? { overlay } : {} }
		);
	const expired = (command: string) =>
		fail(
			'CONFIRMATION_EXPIRED',
			`No one confirmed '${command}' within 10 minutes`,
			'Ask the person, then call again to raise a new one'
		);
	const slotBusy = () =>
		fail(
			'OVERLAY_MODAL_BUSY',
			'A modal or a prompt is already open, so the shell cannot ask to confirm this',
			'Answer or close it, then call again',
			{ retryable: true }
		);
	const closedPrompt = (prompt: string) =>
		fail(
			'OVERLAY_NOT_FOUND',
			`The input prompt '${prompt}' closed before it was answered, so nothing ran`,
			'Open it again with palette-run { command }'
		);
	const noPerson = () =>
		fail(
			'HUMAN_REQUIRED',
			'No one is signed in, so no one can confirm this',
			'Sign in, then try again'
		);
	/** The kernel's answer for a confirmed run whose preview changed since the person looked (phase 5's 7.2). */
	const reshown = (preview: { command: string }, notification?: string) =>
		fail(
			'MOUNT_PREVIEW_CHANGED',
			'Changed since you looked, so nothing ran',
			'Look at it again, then confirm or decline',
			{
				details: {
					preview: preview.command,
					...(notification !== undefined ? { notification } : {}),
				},
			}
		);
	return { pending, declined, asking, expired, slotBusy, closedPrompt, noPerson, reshown };
}

/** Build the withdrawn original and fresh replacement rows for a changed-preview reshow (phase 5's 7.2). */
export function reshowRows(
	stored: StoredConfirmation,
	freshId: string,
	preview: unknown,
	now: number
): { withdrawnRow: StoredConfirmation; freshRow: StoredConfirmation } {
	const { claim: _claim, ...kept } = stored;
	const withdrawnRow: StoredConfirmation = {
		...kept,
		confirmation: { ...kept.confirmation, state: 'withdrawn' },
		...(kept.readAt === undefined ? { readAt: now } : {}),
	};
	const { readAt: _readAt, ...unread } = kept;
	const freshRow: StoredConfirmation = {
		...unread,
		id: freshId,
		createdAt: now,
		confirmation: {
			...kept.confirmation,
			preview: preview as never,
			expiresAt: now + CONFIRMATION_TTL_MS,
		},
	};
	return { withdrawnRow, freshRow };
}

/** The header the shell draws (7.2): who asked, for whom, and where; never the app's own words. */
export function confirmationHeaderOf(
	opener: Opener,
	title: string,
	project: string | undefined,
	personLabel: string | null,
	appTitle: (instance: string) => string,
	actor?: { label?: string; id?: string }
): string {
	if (opener.kind === 'agent') {
		const where = project === undefined ? '' : `, in ${project}`;
		// The copilot's name is the kernel's alone (phase 5's 3.2), so its header is too (6.2).
		if (opener.bucket.startsWith('copilot:')) return `Copilot, for ${personLabel ?? 'you'}${where}`;
		const agent = actor?.label ?? actor?.id ?? 'An agent';
		return `Requested by ${agent} for ${personLabel ?? 'you'}${where}`;
	}
	const where = project === undefined ? '' : ` in ${project}`;
	if (opener.kind === 'app') return `${appTitle(opener.owner.id)} asks to run ${title}${where}`;
	return `Run ${title}${where}?`;
}

/**
 * `prompt-settle`'s input (7.1, 7.2): close the palette's input prompt, open a confirmation in the slot, keep a slot
 * decline, or end an act on its row.
 */
export function settleInputOf(z: SettingsKit['z']) {
	return z.strictObject({
		close: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
		reason: z.optional(z.enum(['user', 'replaced'])),
		settle: z.optional(
			z.strictObject({
				id: z.string().check(z.minLength(1), z.maxLength(64)),
				person: z.string().check(z.minLength(1), z.maxLength(256)),
				command: z.string().check(z.minLength(1), z.maxLength(128)),
				state: z.enum(['confirmed', 'declined']),
				result: z.optional(z.unknown()),
			})
		),
		decline: z.optional(
			z.strictObject({
				id: z.string().check(z.minLength(1), z.maxLength(64)),
				person: z.string().check(z.minLength(1), z.maxLength(256)),
				key: z.string().check(z.minLength(1), z.maxLength(128)),
				command: z.string().check(z.minLength(1), z.maxLength(128)),
				caller: z.string().check(z.minLength(1), z.maxLength(160)),
				header: z.string().check(z.minLength(1), z.maxLength(200)),
				title: z.string().check(z.minLength(1), z.maxLength(120)),
				prompt: z.string().check(z.minLength(1), z.maxLength(200)),
				danger: z.boolean(),
				scope: z.strictObject({
					workspace: z.string().check(z.minLength(1), z.maxLength(128)),
					project: z.optional(z.string().check(z.minLength(1), z.maxLength(128))),
				}),
				input: z.unknown(),
				// The interface the declined call came through (phase 5's 9.1): an app's call to another app's command is `apps`.
				ciface: z.optional(z.enum(['palette', 'apps'])),
			})
		),
		open: z.optional(
			z.strictObject({
				id: z.string().check(z.minLength(1), z.maxLength(64)),
				key: z.string().check(z.minLength(1), z.maxLength(128)),
				command: z.string().check(z.minLength(1), z.maxLength(128)),
				caller: z.optional(z.string().check(z.minLength(1), z.maxLength(160))),
				header: z.string().check(z.minLength(1), z.maxLength(200)),
				prompt: z.string().check(z.minLength(1), z.maxLength(200)),
				danger: z.boolean(),
				scope: z.optional(
					z.strictObject({
						workspace: z.string().check(z.minLength(1), z.maxLength(128)),
						project: z.optional(z.string().check(z.minLength(1), z.maxLength(128))),
					})
				),
				input: z.unknown(),
				// A released mounted command's preview (phase 5's 7.2), the kernel's own read.
				preview: z.optional(z.unknown()),
			})
		),
	});
}

/**
 * The bus's note of a confirmation on the call's `bus` field (phase 5 specification, 9.2), which the journal keeps: a
 * new row raised, each one answered, by id, person, scope, command and who raised it, never its input. Not a slot's.
 */
export function noteBus(
	context: CommandContext,
	event: 'asked' | 'confirmed' | 'declined' | 'withdrawn',
	row: StoredConfirmation
): void {
	if (row.cslot !== undefined) return;
	const held = context as { bus?: BusNotesV1 };
	held.bus ??= {};
	const bus = held.bus;
	const note: BusConfirmationV1 = {
		notification: row.id,
		person: row.person,
		scope: row.scope,
		command: row.confirmation.command,
		...(row.cbucket.startsWith('app:') ? { raiser: row.cbucket.slice(4) } : {}),
		...(row.raiserAgent !== undefined ? { agent: row.raiserAgent } : {}),
		...(typeof row.confirmation.session === 'string' ? { session: row.confirmation.session } : {}),
	};
	if (event === 'asked') bus.raised = note;
	else {
		bus.answered ??= [];
		bus.answered.push(note);
	}
}

/** A confirmation the confirmations' gate named in the call's `bus` field (9.2): raised new, or answered. */
export interface BusConfirmationV1 {
	notification: string;
	person: string;
	scope: ScopeV1;
	/** The command it asks for, whose owner is the instance it targets. */
	command: string;
	/** The instance that raised it, when an app did. */
	raiser?: string;
	/** The agent that raised it, by id, when an agent did (`raiserAgent`). */
	agent?: string;
	/** The copilot session, when the copilot raised it. */
	session?: string;
}

/** The `bus` context field (journaled): what a call raised or answered of the inbox's confirmations. */
export interface BusNotesV1 {
	raised?: BusConfirmationV1;
	answered?: BusConfirmationV1[];
}
