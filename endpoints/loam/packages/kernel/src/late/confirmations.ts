/**
 * @fileoverview Confirmations (phase 4 specification, 7.2; D122), in the `late-settings` chunk beside the inbox (its
 * section 1): the kernel enforces a command's `confirm_prompt` in process, after validation, line 0, access and the
 * decline window (F9), as the last middleware of the kernel's chain. A person's own gesture, and the active app's port,
 * ask in the overlay slot and wait; an agent, the copilot among them, and an app that is not active get
 * `CONFIRMATION_PENDING` at once, and the confirmation waits in the inbox for a person's gesture. The shell runs a
 * confirmed call itself, once, journaled with the confirmation's id. `confirmation-get` and `confirmation-withdraw` are
 * the raising caller's; `palette-run` (7.1) is the person's, and its confirmation replaces its input prompt (R15).
 *
 * **Replay.** A call that waits is journaled after the answer that ended its wait, so the slot's prompt is opened by
 * the internal `prompt-settle`, journaled before the answer; a run the shell makes for a confirmation or for
 * `palette-run` is a top-level call of its own, journaled before the call that made it, with `origin`, and a replay of
 * that call answers from it rather than run it again.
 *
 * Everything of `late` and first paint reaches this module through its deps, so it imports types alone (13).
 */

import type { Actor, CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type {
	ConfirmationRecordV1,
	ConfirmationStateV1,
	ConfirmationV1,
	NotificationV1,
	OverlayRefV1,
	PromptFieldV1,
	PromptInputV1,
	PromptSchemaV1,
} from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { KernelFieldContext } from '../context-fields.js';
import type { LoamKernelErrorCode } from '../errors.js';
import type { OverlayStore } from '../overlays.js';
import type { AccessActorV1 } from '../scope/access.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ContextFieldV2 } from '../types.js';
import type { Opener } from './overlay-commands.js';
import type { SettingsKit } from './settings.js';

/** The workspace store's table the inbox keeps its rows in (10.1): a pending confirmation is one of them. */
const TABLE = 'notification';

/** A pending confirmation expires after 10 minutes (7.2). */
export const CONFIRMATION_TTL_MS = 600_000;
/** After a decline, a call on the same key is refused without asking for 60 seconds (R16). */
export const DECLINE_WINDOW_MS = 60_000;
/** At most 5 pending per caller (7.2). */
export const PENDING_LIMIT = 5;
/** Ended confirmations kept per person past their key's life, the newest; older ones go when a new one is raised. */
export const ENDED_KEPT = 50;

const ID = /^ntf_[a-z0-9]{16}$/;

/** A confirmation's row as the store keeps it: the record, and what the kernel alone reads, never listed. */
export type StoredConfirmation = NotificationV1 & {
	kind: 'confirmation';
	confirmation: ConfirmationRecordV1;
	/** The key (F4): the caller, the command, the input's digest and the scope, of one person in one workspace. */
	ckey: string;
	/** The actor that asked, and the interface it asked through: the shell's run is the same call (7.2). */
	cactor?: Actor;
	ciface: 'palette' | 'agent';
	/** The act's claim, as a notice's (step 5): a confirm runs once. */
	claim?: string;
};

/** The fields a row carries that no list shows (10.2). */
export const KERNEL_ONLY_FIELDS = ['ckey', 'cactor', 'ciface', 'claim'] as const;

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

export interface ConfirmationDeps {
	store: DataAdapter;
	workspace(): string;
	/** Whether the deployment's identity is `provider`: then a call with no person has no inbox. */
	provider: boolean;
	overlays: OverlayStore;
	/** Step 3's path of a call (6.1): the shell's for a person's gesture, an app's port, the agent interface, or none. */
	openerOf(context: CommandContext): Opener;
	/** Whether an app is active, or owns the active tab (6.1). */
	isActive(instance: string): Promise<boolean>;
	/** A command's `confirm_prompt`, or undefined for one that declares none. */
	askedFor(command: string): AskedFor | undefined;
	/**
	 * A command the palette lists now (7.1): its definition, whose schema checks the input, and its input's JSON Schema,
	 * whose plain fields the prompt asks for; undefined for one it does not list here.
	 */
	paletteCommand(command: string): { definition: ZodCommandDefinition; json: unknown } | undefined;
	/** Why `input` does not fit the command's own schema, or undefined when it does. */
	inputFault(command: ZodCommandDefinition, input: unknown): string | undefined;
	/** `decideAccess` on a scope: whether the actor may enter it now, line 0 included. */
	allows(actor: AccessActorV1, scope: ScopeV1): boolean;
	/**
	 * The re-check on confirm (7.2) past access: why the command's app, or the calling app, can no longer run it here, or
	 * undefined when both still can: enabled for the project, loaded, and the caller's grants.
	 */
	served(command: string, caller: string | undefined, scope: ScopeV1): string | undefined;
	/** An app's owner line title (6.6), never one that says "Loam". */
	appTitle(instance: string): string;
	/** A project's name, for the header. */
	projectName(project: string): string | undefined;
	/** The signed-in person's name, never an email; null for none. */
	personLabel(): string | null;
	/** The kernel's `execute`, past the queue: a top-level call journaled as its own (7.2's run, 7.1's). */
	runNow(
		iface: 'palette' | 'agent',
		name: string,
		input: unknown,
		fields: Record<string | symbol, unknown>
	): Promise<CommandResult>;
	/** Boot's own: `prompt-settle`, journaled before the answer it waits for. */
	runBoot(name: string, input: unknown): Promise<CommandResult>;
	replaying(): boolean;
	/** SHA-256 of canonical JSON, as the copilot's input digest (phase 5's 3.4). */
	digest(value: unknown): Promise<string>;
	kit: SettingsKit;
}

export interface Confirmations {
	/** The kernel chain's last middleware: 7.2's steps 4 to 6, and the run a confirmation approved. */
	gate: CommandMiddleware;
	/**
	 * `confirmation`, the id a call ran for (a slot's `cnf_`, a pending one's `ntf_`), and `origin`, the trace of the call
	 * that made a run: set by the kernel alone and journaled, so a replay finds both (7.2).
	 */
	contextFields: ContextFieldV2[];
	/** `palette-run`, `confirmation-get` and `confirmation-withdraw` (7.1, 10.2). */
	commands: ZodCommandDefinition[];
	/** `prompt-settle`, in `BOOT_ONLY`. */
	settle: ZodCommandDefinition;
	/** `notification-act { answer }` on a confirmation (10.2): only a person's gesture reaches it. */
	answer(
		row: NotificationV1,
		answer: 'confirm' | 'decline' | undefined,
		context: CommandContext
	): Promise<CommandResult>;
	/**
	 * End as `withdrawn` every pending confirmation `match` selects, of the person the call is for or of `person`: an
	 * unload of an app (R14, step 9's seam) or a change of person. Never opens the decline window.
	 */
	withdraw(
		context: CommandContext,
		match: (row: StoredConfirmation) => boolean,
		person?: string
	): Promise<number>;
	/**
	 * Raise a confirmation for any call, whether or not its command declares a `confirm_prompt`: phase 5's `ask` (its
	 * 6.1), with its `group`. The call's own path decides where it waits, as for a declared one.
	 */
	ask(
		name: string,
		input: unknown,
		context: CommandContext,
		next: () => Promise<CommandResult>,
		asked: AskedFor & { group?: string }
	): Promise<CommandResult>;
}

/** A slot confirmation: in this page's memory, answered in the slot, never in the inbox. */
interface SlotRecord {
	overlayId: string;
	key: string;
	command: string;
	/** The overlay's answer once it closed: its result and reason. */
	answer?: { result: string; reason: string };
}

/** `value` as JSON: a value with no JSON form is stored as `null`. */
const jsonOf = (value: unknown): unknown => {
	const text = JSON.stringify(value);
	return text === undefined ? null : JSON.parse(text);
};

/** A run's outcome as a confirmation keeps it: its success, data and error, never its timing (a replay's differs). */
const outcomeOf = (result: CommandResult): unknown =>
	jsonOf({
		success: result.success,
		...(result.data !== undefined ? { data: result.data } : {}),
		...(result.error !== undefined ? { error: result.error } : {}),
	});

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
	const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
	if (typeof properties !== 'object' || Array.isArray(properties)) return undefined;
	const keys = Object.keys(properties);
	if (keys.length > 12 || !keys.every((key) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)))
		return undefined;
	const fields: Record<string, PromptFieldV1> = {};
	for (const key of keys) {
		const property = properties[key] ?? {};
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

export function createConfirmations(deps: ConfirmationDeps): Confirmations {
	const { store, kit, overlays } = deps;
	const { z } = kit;

	const fail = (
		code: LoamKernelErrorCode,
		message: string,
		suggestion: string,
		extra: { details?: Record<string, unknown>; retryable?: boolean } = {}
	) => kit.kernelFailure(code, message, suggestion, extra);

	/** The call's person: the actor's, else `local` outside `provider` mode (as the inbox's). */
	const personOf = (context: CommandContext): string | undefined =>
		kit.personKey(context.actor as AccessActorV1) ?? (deps.provider ? undefined : 'local');

	const scopeOf = (context: CommandContext): ScopeV1 => {
		const scope = (context as KernelFieldContext).scope;
		return scope?.project === undefined
			? { workspace: scope?.workspace ?? deps.workspace() }
			: { workspace: scope.workspace, project: scope.project };
	};

	/** The person's confirmations in this workspace, from the inbox's table (10.1). */
	async function rowsOf(person: string): Promise<StoredConfirmation[]> {
		const listed = await store.list<StoredConfirmation>(TABLE, { person } as never);
		return listed.data.filter(
			(row) =>
				row.person === person &&
				row.workspace === deps.workspace() &&
				row.kind === 'confirmation' &&
				ID.test(row.id) &&
				typeof row.ckey === 'string'
		);
	}

	/** A row put back whole, in one batch: a `PUT` merges, so a field the write drops (`claim`) would survive it. */
	async function putBack(row: StoredConfirmation): Promise<void> {
		const path = `/${TABLE}/${encodeURIComponent(row.id)}`;
		const { summary } = await store.batch([
			{ method: 'DELETE', path },
			{ method: 'PUT', path, body: row },
		]);
		if (summary.failed > 0)
			throw new Error(`The store could not write the confirmation '${row.id}'`);
	}

	/** Each person's raising, one at a time (step 5's lesson): the limit's count and the insert never interleave. */
	const chains = new Map<string, Promise<unknown>>();
	function serial<T>(person: string, work: () => Promise<T>): Promise<T> {
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

	const newId = (context: CommandContext, prefix: 'ntf' | 'cnf'): string => {
		const draw = () => (context.random?.next() ?? Math.random()).toString(36).slice(2);
		return `${prefix}_${`${draw()}${draw()}0000000000000000`.slice(0, 16)}`;
	};

	// ─── The refusals of 7.2 and 16 ────────────────────────────────────────────────

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
			`The person declined '${command}'`,
			'Ask the person before trying again; do not repeat the call',
			details ? { details } : {}
		);
	const expired = (command: string) =>
		fail(
			'CONFIRMATION_EXPIRED',
			`No one confirmed '${command}' within 10 minutes`,
			'Ask the person, then call again to raise a new one'
		);
	const noPerson = () =>
		fail(
			'HUMAN_REQUIRED',
			'No one is signed in, so no one can confirm this',
			'Sign in, then try again'
		);

	/** The header the shell draws (7.2): who asked, for whom, and where; never the app's own words. */
	function headerOf(
		opener: Opener,
		title: string,
		scope: ScopeV1,
		context: CommandContext
	): string {
		const project = scope.project === undefined ? undefined : deps.projectName(scope.project);
		if (opener.kind === 'agent') {
			const agent = context.actor?.label ?? context.actor?.id ?? 'An agent';
			const where = project === undefined ? '' : `, in ${project}`;
			return `Requested by ${agent} for ${deps.personLabel() ?? 'you'}${where}`;
		}
		const where = project === undefined ? '' : ` in ${project}`;
		if (opener.kind === 'app')
			return `${deps.appTitle(opener.owner.id)} asks to run ${title}${where}`;
		return `Run ${title}${where}?`;
	}

	/** The key of 7.2 (F4): one person's, in one workspace, by caller, command, input digest and scope. */
	async function keyOf(
		person: string,
		caller: string,
		command: string,
		input: unknown,
		scope: ScopeV1,
		extra?: string
	): Promise<string> {
		return deps.digest({
			workspace: deps.workspace(),
			person,
			caller,
			command,
			input: await deps.digest(jsonOf(input)),
			scope,
			...(extra !== undefined ? { extra } : {}),
		});
	}

	/** Slot declines' windows, by key (R16): a slot confirmation is never in the store, so its window is memory. */
	const windows = new Map<string, number>();
	/** Slot confirmations, by id: opened by `prompt-settle`, answered in the slot. */
	const slots = new Map<string, SlotRecord>();
	/** The confirmations a person confirmed whose run the shell is making now, by id (live only). */
	const approved = new Map<string, { command: string; key: string }>();
	/** A replay's runs by the trace that made them (`origin`), so that call answers from it and runs nothing again. */
	const ran = new Map<string, CommandResult>();

	// ─── The slot (a person's gesture, the active app's port) ──────────────────────

	async function inSlot(
		name: string,
		call: CommandContext & KernelFieldContext & { confirmation?: string },
		next: () => Promise<CommandResult>,
		key: string,
		opener: Opener,
		asked: AskedFor,
		input: unknown
	): Promise<CommandResult> {
		let id = call.confirmation;
		if (id === undefined || !deps.replaying()) {
			const replaces = (call as Record<symbol, unknown>)[REPLACES] as string | undefined;
			const held = overlays.modalOpen();
			const replaceable =
				held !== undefined &&
				held.overlayId === replaces &&
				overlays.ownerOf(replaces)?.kind === 'shell' &&
				overlays.forOf(replaces)?.kind === 'input' &&
				overlays.forOf(replaces)?.command === name;
			if (held && !replaceable) {
				return fail(
					'OVERLAY_MODAL_BUSY',
					'A modal or a prompt is already open, so the shell cannot ask to confirm this',
					'Answer or close it, then call again',
					{ retryable: true }
				);
			}
			id = newId(call, 'cnf');
			// Journaled with the call, so its replay finds the slot confirmation the settle below opened.
			call.confirmation = id;
			const scope = scopeOf(call);
			const opened = await deps.runBoot('prompt-settle', {
				...(replaceable ? { close: replaces, reason: 'replaced' } : {}),
				open: {
					id,
					key,
					command: name,
					...(opener.kind === 'app' ? { caller: opener.owner.id } : {}),
					header: headerOf(opener, asked.title, scope, call).slice(0, 200),
					prompt: asked.prompt,
					danger: asked.danger,
					input: jsonOf(input),
				},
			});
			if (!opened.success) return opened;
		}
		const record = slots.get(id);
		if (!record) {
			return fail(
				'OVERLAY_NOT_FOUND',
				'The confirmation this call asked for is not open',
				'Call again to be asked again'
			);
		}
		const answer =
			record.answer ??
			(await (async () => {
				const closed = await overlays.whenClosed(record.overlayId)?.settled;
				return closed ? { result: closed.result, reason: closed.reason } : undefined;
			})());
		slots.delete(id);
		if (answer?.result === 'confirm') return next();
		if (answer?.reason === 'person') {
			return fail(
				'SESSION_CHANGED',
				'The person changed while this waited for a confirmation, so it did not run',
				'Ask again only if the new person should answer it'
			);
		}
		// The raising app's own cancel is `withdrawn` (6.5, F6), which never opens the window.
		if (answer?.reason === 'withdrawn') return declined(name, { reason: 'withdrawn' });
		// A person's gesture is exempt from the window (N8); the active app's port is held by it.
		if (opener.kind === 'app') windows.set(key, kit.callNow(call) + DECLINE_WINDOW_MS);
		return declined(name);
	}

	// ─── The inbox (an agent, an app that is not active) ───────────────────────────

	async function inInbox(
		name: string,
		call: CommandContext & KernelFieldContext,
		key: string,
		opener: Exclude<Opener, { kind: 'shell' } | { kind: 'none' }>,
		asked: AskedFor & { group?: string },
		input: unknown,
		person: string
	): Promise<CommandResult> {
		const caller = opener.owner.id;
		const scope = scopeOf(call);
		return serial(person, async () => {
			const now = kit.callNow(call);
			const rows = await rowsOf(person);
			const same = rows
				.filter((row) => row.ckey === key)
				.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
			/** Refused without asking (R16): counted on the declined row, which the inbox lists "Declined automatically". */
			const refuseAgain = async (row: StoredConfirmation) => {
				await putBack({
					...row,
					confirmation: {
						...row.confirmation,
						declinedAgain: (row.confirmation.declinedAgain ?? 0) + 1,
					},
				});
				return declined(name);
			};
			// The decline window (F9's step 4), on the same key, from any declined row of it.
			const windowed = same.find(
				(row) =>
					row.confirmation.state === 'declined' &&
					(row.confirmation.answeredAt ?? 0) + DECLINE_WINDOW_MS > now
			);
			if (windowed || (windows.get(key) ?? 0) > now) {
				return windowed ? refuseAgain(windowed) : declined(name);
			}
			// A re-call on the same key before its `expiresAt` raises none (F5): its stored state answers.
			const live = same.find(
				(row) => now < row.confirmation.expiresAt && row.confirmation.state !== 'withdrawn'
			);
			if (live) {
				const state = stateNow(live.confirmation, now);
				if (state === 'pending') return pending(live);
				if (state === 'declined') return refuseAgain(live);
				if (state === 'confirmed' && live.confirmation.result !== undefined)
					return structuredClone(live.confirmation.result) as CommandResult;
			}
			// At most 5 pending per caller (7.2), counted at once with the insert, on the person's chain.
			const theirs = rows.filter(
				(row) => row.source === caller && stateNow(row.confirmation, now) === 'pending'
			);
			if (theirs.length >= PENDING_LIMIT) {
				const soonest = Math.min(...theirs.map((row) => row.confirmation.expiresAt));
				return fail(
					'RATE_LIMITED',
					`At most ${PENDING_LIMIT} confirmations wait for the person from one caller`,
					'Wait for one to be answered or expire, then call again',
					{
						retryable: true,
						details: { limit: PENDING_LIMIT, retryAfterMs: Math.max(1, soonest - now) },
					}
				);
			}
			const record: StoredConfirmation = {
				id: newId(call, 'ntf'),
				workspace: deps.workspace(),
				person,
				source: caller,
				kind: 'confirmation',
				title: asked.title.slice(0, 120),
				tone: asked.danger ? 'danger' : 'warning',
				confirmation: {
					command: name,
					caller,
					input: jsonOf(input),
					...(asked.group !== undefined ? { group: asked.group } : {}),
					header: headerOf(opener, asked.title, scope, call).slice(0, 200),
					prompt: asked.prompt,
					title: asked.title,
					...(asked.danger ? { danger: true } : {}),
					expiresAt: now + CONFIRMATION_TTL_MS,
					state: 'pending',
				},
				scope,
				createdAt: now,
				ckey: key,
				...(call.actor !== undefined ? { cactor: jsonOf(call.actor) as Actor } : {}),
				ciface: call.interface === 'agent' ? 'agent' : 'palette',
			};
			// Ended ones past their key's life go, oldest first, keeping the newest few (no person's inbox grows forever).
			const ended = rows
				.filter(
					(row) =>
						stateNow(row.confirmation, now) !== 'pending' &&
						row.confirmation.expiresAt + DECLINE_WINDOW_MS < now
				)
				.sort((a, b) => b.createdAt - a.createdAt)
				.slice(ENDED_KEPT);
			const { summary } = await store.batch([
				...ended.map((row) => ({
					method: 'DELETE' as const,
					path: `/${TABLE}/${encodeURIComponent(row.id)}`,
				})),
				{ method: 'PUT', path: `/${TABLE}/${encodeURIComponent(record.id)}`, body: record },
			]);
			if (summary.failed > 0)
				throw new Error(`The store could not write the confirmation '${record.id}'`);
			return pending(record);
		});
	}

	// ─── The gate ──────────────────────────────────────────────────────────────────

	async function ask(
		name: string,
		input: unknown,
		context: CommandContext,
		next: () => Promise<CommandResult>,
		asked: AskedFor & { group?: string }
	): Promise<CommandResult> {
		const call = context as CommandContext & KernelFieldContext & { confirmation?: string };
		const opener = deps.openerOf(call);
		if (opener.kind === 'none') {
			return fail(
				'HUMAN_REQUIRED',
				`'${name}' needs a person's confirmation, which this path cannot ask for`,
				'Run it from the shell, an app or the agent interface'
			);
		}
		const person = personOf(call);
		if (person === undefined) return noPerson();
		const caller = opener.kind === 'shell' ? 'person' : opener.owner.id;
		const key = await keyOf(person, caller, name, input, scopeOf(call), asked.group);
		const slot =
			opener.kind === 'shell' || (opener.kind === 'app' && (await deps.isActive(opener.owner.id)));
		if (slot) {
			// The window (F9's step 4) holds an active app's port too; only a person's gesture is exempt (N8).
			if (opener.kind === 'app' && (windows.get(key) ?? 0) > kit.callNow(call))
				return declined(name);
			return inSlot(name, call, next, key, opener, asked, input);
		}
		return inInbox(
			name,
			call,
			key,
			opener as Exclude<Opener, { kind: 'shell' } | { kind: 'none' }>,
			asked,
			input,
			person
		);
	}

	/**
	 * The run a person's confirm approved (7.2): live, only the one the act holds now, once; in a replay, the row its
	 * entry names, whose outcome it records again. The outcome is stored on the confirmation either way.
	 */
	async function confirmedRun(
		name: string,
		input: unknown,
		call: CommandContext & { confirmation: string },
		next: () => Promise<CommandResult>
	): Promise<CommandResult> {
		const id = call.confirmation;
		const person = personOf(call);
		const row =
			person === undefined
				? undefined
				: (await rowsOf(person)).find(
						(each) => each.id === id && each.confirmation.command === name
					);
		const live = approved.get(id);
		approved.delete(id);
		const key =
			row && person !== undefined
				? await keyOf(person, row.source, name, input, scopeOf(call), row.confirmation.group)
				: undefined;
		const allowed = deps.replaying()
			? row !== undefined && key === row.ckey
			: live !== undefined && live.command === name && live.key === key;
		if (!row || !allowed) {
			return fail(
				'HUMAN_REQUIRED',
				'Only the shell runs a call a person confirmed, once',
				'Call the command itself to ask the person'
			);
		}
		const result = await next();
		const now = kit.callNow(call);
		const stored = (await store.get<StoredConfirmation>(TABLE, id)) ?? row;
		const { claim: _claim, ...kept } = stored;
		await putBack({
			...kept,
			confirmation: {
				...kept.confirmation,
				state: 'confirmed',
				reason: 'person',
				answeredAt: now,
				result: outcomeOf(result),
			},
		});
		return result;
	}

	const gate: CommandMiddleware = async (name, input, context, next) => {
		const call = context as CommandContext & { confirmation?: string; origin?: string };
		let result: CommandResult;
		if (call.confirmation?.startsWith('ntf_')) {
			result = await confirmedRun(
				name,
				input,
				call as typeof call & { confirmation: string },
				next
			);
		} else {
			const asked = deps.askedFor(name);
			if (asked) result = await ask(name, input, context, next, asked);
			else if (call.confirmation !== undefined) {
				result = fail(
					'HUMAN_REQUIRED',
					`'${name}' asks for no confirmation`,
					'Call it without one'
				);
			} else result = await next();
		}
		// A replay's run for a call that made it (7.1, 7.2): that call answers from it, running nothing again.
		if (call.origin !== undefined && deps.replaying()) ran.set(call.origin, result);
		return result;
	};

	// ─── prompt-settle (BOOT_ONLY) ─────────────────────────────────────────────────

	const settleInput = z.strictObject({
		close: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
		reason: z.optional(z.enum(['user', 'replaced'])),
		open: z.optional(
			z.strictObject({
				id: z.string().check(z.minLength(1), z.maxLength(64)),
				key: z.string().check(z.minLength(1), z.maxLength(128)),
				command: z.string().check(z.minLength(1), z.maxLength(128)),
				caller: z.optional(z.string().check(z.minLength(1), z.maxLength(160))),
				header: z.string().check(z.minLength(1), z.maxLength(200)),
				prompt: z.string().check(z.minLength(1), z.maxLength(200)),
				danger: z.boolean(),
				input: z.unknown(),
			})
		),
	});
	const settle = kit.define<typeof settleInput, { overlay?: OverlayRefV1 }>({
		name: 'prompt-settle',
		description:
			"The shell's own prompts in the slot: close the palette's input prompt, open a confirmation (7.1, 7.2). Boot's alone",
		category: 'prompt',
		mutation: true,
		executionTime: 'instant',
		input: settleInput,
		jsonSchema: { type: 'object', additionalProperties: true } as JsonSchema,
		async handler(input) {
			if (input.close !== undefined && overlays.get(input.close)) {
				overlays.close(
					input.close,
					input.reason === 'replaced' ? 'cancel' : 'confirm',
					input.reason ?? 'user'
				);
			}
			const { open } = input;
			if (!open) return kit.success({});
			const prompt: PromptInputV1 = {
				title: open.header,
				body: open.prompt,
				confirmLabel: 'Confirm',
				cancelLabel: 'Decline',
				...(open.danger ? { danger: true } : {}),
			};
			const overlay = overlays.open({ kind: 'shell', id: 'shell' }, 'prompt', prompt, {
				for: {
					command: open.command,
					...(open.caller !== undefined ? { caller: open.caller } : {}),
					kind: 'confirmation',
					input: open.input,
				},
			});
			const record: SlotRecord = {
				overlayId: overlay.overlayId,
				key: open.key,
				command: open.command,
			};
			slots.set(open.id, record);
			void overlays.whenClosed(overlay.overlayId)?.settled.then((closed) => {
				record.answer = { result: closed.result, reason: closed.reason };
			});
			return kit.success({ overlay });
		},
	});

	// ─── confirmation-get, confirmation-withdraw ───────────────────────────────────

	const oneInput = z.strictObject({
		notification: z.string().check(z.minLength(1), z.maxLength(64)),
	});
	const oneJson: JsonSchema = {
		type: 'object',
		properties: { notification: { type: 'string', minLength: 1, maxLength: 64 } },
		required: ['notification'],
		additionalProperties: false,
	};

	/** The caller's own confirmation (7.2): only the caller that raised it reads or withdraws it, its person's. */
	async function own(
		notification: string,
		context: CommandContext
	): Promise<StoredConfirmation | CommandResult<never>> {
		const opener = deps.openerOf(context);
		const person = personOf(context);
		const caller = opener.kind === 'app' || opener.kind === 'agent' ? opener.owner.id : undefined;
		const row =
			person === undefined || caller === undefined
				? undefined
				: (await rowsOf(person)).find((each) => each.id === notification && each.source === caller);
		if (!row || !deps.allows(context.actor as AccessActorV1, row.scope)) {
			return fail(
				'NOTIFICATION_NOT_FOUND',
				`You raised no confirmation '${notification}'`,
				'Read only the confirmations this caller raised, by the id CONFIRMATION_PENDING gave'
			);
		}
		return row;
	}

	const get = kit.define<typeof oneInput, ConfirmationV1>({
		name: 'confirmation-get',
		title: 'Read a confirmation',
		description:
			'Read the state and outcome of a confirmation this caller raised: pending, confirmed with the result of the call the shell ran, declined, expired or withdrawn',
		category: 'confirmation',
		mutation: false,
		executionTime: 'instant',
		input: oneInput,
		jsonSchema: oneJson,
		async handler(input, context) {
			const row = await own(input.notification, context);
			if (!('confirmation' in row)) return row;
			const record = row.confirmation;
			const state = stateNow(record, kit.callNow(context));
			return kit.success({
				state,
				...(record.reason !== undefined ? { reason: record.reason } : {}),
				...(state === 'confirmed' && record.result !== undefined
					? { result: structuredClone(record.result) as CommandResult }
					: state === 'expired'
						? { result: expired(record.command) as CommandResult }
						: {}),
				expiresAt: record.expiresAt,
			});
		},
	});

	const withdrawOne = kit.define<typeof oneInput, { state: 'withdrawn' }>({
		name: 'confirmation-withdraw',
		title: 'Withdraw a confirmation',
		description:
			'Withdraw a confirmation this caller raised that still waits for the person; it never holds the next call back',
		category: 'confirmation',
		mutation: true,
		executionTime: 'instant',
		input: oneInput,
		jsonSchema: oneJson,
		async handler(input, context) {
			const row = await own(input.notification, context);
			if (!('confirmation' in row)) return row;
			const person = row.person;
			return serial(person, async () => {
				const stored = (await rowsOf(person)).find((each) => each.id === row.id) ?? row;
				const state = stateNow(stored.confirmation, kit.callNow(context));
				if (state !== 'pending' || stored.claim !== undefined) {
					return fail(
						'VALIDATION_ERROR',
						`It is no longer waiting: it is ${stored.claim !== undefined ? 'running' : state}`,
						'Read its outcome with confirmation-get'
					);
				}
				await putBack({
					...stored,
					confirmation: { ...stored.confirmation, state: 'withdrawn' },
				});
				return kit.success({ state: 'withdrawn' as const });
			});
		},
	});

	// ─── palette-run (7.1) ─────────────────────────────────────────────────────────

	const runInput = z.strictObject({
		command: z.string().check(z.minLength(1), z.maxLength(128)),
		prompt: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
		input: z.optional(z.unknown()),
	});

	const notOpen = (prompt: string) =>
		fail(
			'OVERLAY_NOT_FOUND',
			`No input prompt '${prompt}' is open for this command`,
			'Open it again with palette-run { command }'
		);

	const paletteRun = kit.define<typeof runInput, unknown>({
		name: 'palette-run',
		title: 'Run a command from the palette',
		description:
			"Open a prompt for a command's input, then run it with the input the prompt collected; a person's alone",
		category: 'palette',
		mutation: true,
		executionTime: 'instant',
		input: runInput,
		jsonSchema: {
			type: 'object',
			properties: {
				command: { type: 'string', minLength: 1, maxLength: 128 },
				prompt: { type: 'string', minLength: 1, maxLength: 64 },
				input: {},
			},
			required: ['command'],
			additionalProperties: false,
		} as unknown as JsonSchema,
		async handler(input, context) {
			const opener = deps.openerOf(context);
			// Human only (R8): the chain refuses the agent interface first (`HUMAN_COMMANDS`) and no port may call it;
			// refused here too, failing closed.
			if (opener.kind !== 'shell') {
				return fail(
					'HUMAN_REQUIRED',
					'Only a person runs a command from the palette',
					'Call the command itself, or ask the person to run it from the palette'
				);
			}
			const traceId = context.traceId ?? '';
			// A replay of a run this call made: its own entry ran before this one, and this call answers from it.
			const replayed = deps.replaying() ? ran.get(traceId) : undefined;
			if (replayed) {
				ran.delete(traceId);
				const { 'dev.loam/seq': _seq, ...metadata } = (replayed.metadata ?? {}) as Record<
					string,
					unknown
				>;
				return { ...replayed, metadata } as CommandResult;
			}
			const listed = deps.paletteCommand(input.command);
			const definition = listed?.definition;
			if (input.prompt === undefined) {
				if (input.input !== undefined) {
					return fail(
						'VALIDATION_ERROR',
						'input fills an open prompt, which prompt names',
						'Open the prompt with palette-run { command } first'
					);
				}
				if (!definition) {
					return fail(
						'COMMAND_NOT_FOUND',
						`'${input.command}' is not a command the palette runs here`,
						'Search the palette with palette-search'
					);
				}
				if (overlays.modalOpen()) {
					return fail(
						'OVERLAY_MODAL_BUSY',
						'A modal or a prompt is already open',
						'Answer or close it, then try again',
						{ retryable: true }
					);
				}
				const schema = promptSchemaOf(listed?.json);
				if (schema === undefined) {
					return fail(
						'VALIDATION_ERROR',
						`'${input.command}' takes input the palette cannot ask for: only plain text, number and switch fields`,
						'Run it from its app, or call it with its input'
					);
				}
				const prompt = overlays.open(
					{ kind: 'shell', id: 'shell' },
					'prompt',
					{
						title: (definition.title ?? definition.name).slice(0, 80),
						body: definition.description.slice(0, 1000),
						...(schema ? { schema } : {}),
						confirmLabel: 'Run',
					} as PromptInputV1,
					{ for: { command: definition.name, kind: 'input' } }
				);
				return kit.success({ prompt });
			}
			const held = overlays.get(input.prompt);
			const asked = overlays.forOf(input.prompt);
			if (
				held?.kind !== 'prompt' ||
				overlays.ownerOf(input.prompt)?.kind !== 'shell' ||
				asked?.kind !== 'input' ||
				asked.command !== input.command ||
				!definition
			) {
				return notOpen(input.prompt);
			}
			// The command's own schema; on a failure the prompt stays open and shows why (7.1).
			const fault = deps.inputFault(definition, input.input ?? {});
			if (fault !== undefined) {
				return fail(
					'VALIDATION_ERROR',
					`The input does not fit '${input.command}': ${fault}`,
					'Correct the input in the prompt, then run it again',
					{ details: { overlay: input.prompt } }
				);
			}
			const fields: Record<string | symbol, unknown> = {
				origin: traceId,
				...(context.actor !== undefined ? { actor: context.actor } : {}),
				scope: scopeOf(context),
			};
			if (deps.askedFor(input.command)) {
				// Its confirmation replaces the input prompt in the slot, showing the input (R15).
				fields[REPLACES] = input.prompt;
			} else {
				// The prompt is answered, journaled before the run, so a replay closes it before the run as this did.
				const closed = await deps.runBoot('prompt-settle', { close: input.prompt, reason: 'user' });
				if (!closed.success) return closed;
			}
			const result = await deps.runNow('palette', input.command, input.input ?? {}, fields);
			// The run's own journal sequence is its entry's, never this call's: a replay answers without it.
			const { 'dev.loam/seq': _seq, ...metadata } = (result.metadata ?? {}) as Record<
				string,
				unknown
			>;
			return { ...result, metadata } as CommandResult;
		},
	});

	// ─── notification-act on a confirmation (10.2) ─────────────────────────────────

	const acting = new Set<string>();

	async function answer(
		notice: NotificationV1,
		given: 'confirm' | 'decline' | undefined,
		context: CommandContext
	): Promise<CommandResult> {
		if (given === undefined) {
			return fail(
				'VALIDATION_ERROR',
				'A confirmation is answered with confirm or decline',
				"Pass answer: 'confirm' or 'decline'"
			);
		}
		const person = notice.person;
		const now = kit.callNow(context);
		const row = (await rowsOf(person)).find((each) => each.id === notice.id);
		if (!row) {
			return fail(
				'NOTIFICATION_NOT_FOUND',
				`You have no confirmation '${notice.id}'`,
				'List your notices with notification-list'
			);
		}
		const marked = (extra: Partial<ConfirmationRecordV1>): StoredConfirmation => {
			const { claim: _claim, ...kept } = row;
			return {
				...kept,
				confirmation: { ...kept.confirmation, ...extra },
				...(kept.readAt === undefined ? { readAt: now } : {}),
			};
		};
		const state = stateNow(row.confirmation, now);
		if (state !== 'pending' || row.claim !== undefined || acting.has(row.id)) {
			// Ended, or running: nothing more runs. A person's answer to one that ended marks it read.
			if (state !== 'pending' && row.readAt === undefined) {
				await putBack({ ...row, readAt: now });
			}
			// As the answer that ended it said (a person's confirm or decline says no reason), so a replay answers the same.
			return kit.success({
				state: row.claim !== undefined || acting.has(row.id) ? 'pending' : state,
				...(row.confirmation.reason === 'access' ? { reason: 'access' as const } : {}),
			});
		}
		if (given === 'decline') {
			await putBack(marked({ state: 'declined', reason: 'person', answeredAt: now }));
			return kit.success({ state: 'declined' as const });
		}
		// The re-check (7.2): the same chain as steps 2 and 3, for the actor that asked, in the confirmation's scope.
		const actor = row.cactor as AccessActorV1;
		const caller = row.ciface === 'palette' ? row.source : undefined;
		if (
			!deps.allows(actor, row.scope) ||
			deps.served(row.confirmation.command, caller, row.scope) !== undefined
		) {
			await putBack(marked({ state: 'declined', reason: 'access', answeredAt: now }));
			return kit.success({ state: 'declined' as const, reason: 'access' as const });
		}
		// Claimed before it runs, as a notice's action (step 5): in this page, and in the store, read back.
		acting.add(row.id);
		try {
			const claim = `${context.traceId ?? ''}:${newId(context, 'cnf')}`;
			await store.update(TABLE, row.id, { claim } as never);
			const claimed = await store.get<StoredConfirmation>(TABLE, row.id).catch(() => null);
			if (claimed?.claim !== claim) return kit.success({ state: 'pending' as const });
			approved.set(row.id, { command: row.confirmation.command, key: row.ckey });
			const result = await deps.runNow(
				row.ciface,
				row.confirmation.command,
				row.confirmation.input ?? {},
				{
					...(row.cactor !== undefined ? { actor: row.cactor } : {}),
					...(caller !== undefined ? { caller } : {}),
					scope: row.scope,
					confirmation: row.id,
					origin: context.traceId ?? '',
				}
			);
			approved.delete(row.id);
			const after = await store.get<StoredConfirmation>(TABLE, row.id).catch(() => null);
			if (after?.confirmation.state === 'confirmed') {
				const { claim: _gone, ...kept } = after;
				await putBack({ ...kept, ...(kept.readAt === undefined ? { readAt: now } : {}) });
				return kit.success({ state: 'confirmed' as const });
			}
			// The chain refused the run before the shell could record it (the person changed, or access went): nothing ran.
			await putBack(
				marked({ state: 'declined', reason: 'access', answeredAt: now, result: outcomeOf(result) })
			);
			return kit.success({ state: 'declined' as const, reason: 'access' as const });
		} finally {
			acting.delete(row.id);
		}
	}

	const id = () => z.string().check(z.minLength(1), z.maxLength(128));
	return {
		gate,
		contextFields: [
			{ name: 'confirmation', meta: 'dev.loam/confirmation', schema: id(), journal: true },
			{ name: 'origin', meta: 'dev.loam/origin', schema: id(), journal: true },
		] as ContextFieldV2[],
		settle: settle as unknown as ZodCommandDefinition,
		commands: [paletteRun, get, withdrawOne] as unknown as ZodCommandDefinition[],
		answer,
		ask,
		async withdraw(context, match, person) {
			const whose = person ?? personOf(context);
			if (whose === undefined) return 0;
			return serial(whose, async () => {
				const now = kit.callNow(context);
				let count = 0;
				for (const row of await rowsOf(whose)) {
					if (stateNow(row.confirmation, now) !== 'pending' || row.claim !== undefined) continue;
					if (!match(row)) continue;
					await putBack({ ...row, confirmation: { ...row.confirmation, state: 'withdrawn' } });
					count++;
				}
				return count;
			});
		},
	};
}
