/**
 * @fileoverview Confirmations' constants, the row the store keeps, and the pure rules the gate and the inbox share
 * (phase 4 specification, 7.1, 7.2, 10.2): buckets and ownership, a row's state now, a list's bound, and the palette's
 * prompt of a command's input. Apart from `confirmations.ts` so that file keeps to the size gate; it imports types alone.
 */

import type { Actor, CommandResult } from '@lushly-dev/afd-core';
import type {
	ConfirmationRecordV1,
	ConfirmationStateV1,
	NotificationV1,
	PromptFieldV1,
	PromptSchemaV1,
} from '@lushly-dev/loam-sdk';
import type { Opener } from './overlay-commands.js';

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
	ciface: 'palette' | 'agent';
	/**
	 * Who raised it, as the kernel tells callers apart (the trust review's R1): an app's instance, or the agent
	 * interface's bucket, one per person (the copilot apart), since an agent's name is the caller's own choice. The key,
	 * the limits and who reads or withdraws it go by it; `source` and `confirmation.caller` only say who asked.
	 */
	cbucket: string;
	/** A decline in the slot, kept so the window holds across a reload and the inbox's path (blocker 6). */
	cslot?: true;
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
	row: { cbucket?: unknown; cslot?: unknown },
	bucket: string | undefined
): boolean =>
	bucket !== undefined && bucket !== 'person' && row.cslot === undefined && row.cbucket === bucket;

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
	const bytes = new TextEncoder().encode(JSON.stringify(input) ?? 'null').length;
	return bytes <= LISTED_INPUT_BYTES ? input : { truncated: true, bytes };
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
