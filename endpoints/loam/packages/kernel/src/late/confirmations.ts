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
	PromptInputV1,
} from '@lushly-dev/loam-sdk';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { KernelFieldContext } from '../context-fields.js';
import type { LoamKernelErrorCode } from '../errors.js';
import type { OverlayStore } from '../overlays.js';
import type { AccessActorV1 } from '../scope/access.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ContextFieldV2 } from '../types.js';
import {
	type AskedFor,
	bucketOf,
	CONFIRMATION_TTL_MS,
	DECLINE_WINDOW_MS,
	ENDED_KEPT,
	ID,
	jsonOf,
	outcomeOf,
	ownedBy,
	PENDING_LIMIT,
	PERSON_LIMIT,
	REPLACES,
	refusalsOf,
	SLOT_KEPT,
	type StoredConfirmation,
	settleInputOf,
	stateNow,
	summaryOf,
	TABLE,
} from './confirmation-parts.js';
import type { Opener } from './overlay-commands.js';
import { createPaletteRun } from './palette-run.js';
import type { SettingsKit } from './settings.js';

export {
	type AskedFor,
	bucketOf,
	CONFIRMATION_TTL_MS,
	DECLINE_WINDOW_MS,
	ENDED_KEPT,
	KERNEL_ONLY_FIELDS,
	LISTED_INPUT_BYTES,
	ownedBy,
	PENDING_LIMIT,
	PERSON_LIMIT,
	promptSchemaOf,
	REPLACES,
	SLOT_KEPT,
	type StoredConfirmation,
	stateNow,
	summaryOf,
} from './confirmation-parts.js';

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
	/** Whether the journal records a call of `command`: one it does not leaves no entry for a replay to run (11). */
	journaled(command: string): boolean;
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
	/**
	 * Whether an input is over `loam.limits.inputBytes` now, or has no JSON form (phase 4's section 11): an app's raised
	 * call, measured by its port then, is measured again before its confirmed run, as the limit may have fallen since.
	 */
	inputOver(input: unknown): boolean;
	/**
	 * The person signed in now, as `personKey` keys them (`local` outside `provider` mode, signed out): a confirmed run
	 * runs only for the person it was asked of (step 6's fifth round, 2).
	 */
	personNow(): string | undefined;
	/** Whether `command` is a mutation under an archived project in `scope` (line 6; step 6's second round, 4). */
	archived(command: string, scope: ScopeV1): boolean;
	/** Release the queue a queued call holds, as it starts waiting on a person (7.2; step 6's second round, 3). */
	releaseQueue(context: CommandContext): void;
	/**
	 * The document chain a chained call holds (the scope middleware's): given up while it waits on a person, and taken
	 * back, its resource checks repeated, before it runs (step 6's third round, A). Undefined for a call it chains to none.
	 */
	chainOf(context: CommandContext):
		| {
				release(): void;
				again(run: () => Promise<CommandResult>): Promise<CommandResult>;
				/** Lines 5 and 6 again, in place: the inbox's run, which holds its chain already (fifth round, 2). */
				check(): Promise<CommandResult | undefined>;
		  }
		| undefined;
	/** Mark the call's kernel event: its inbox changed, though the call may have failed (`CONFIRMATION_PENDING`). */
	noteInbox(context: CommandContext): void;
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
	/**
	 * A replay's: a confirmed run it answered from its record, with that outcome, so the act's settle may confirm the
	 * row it leaves pending, and no other (step 6's fifth round, 3).
	 */
	recorded(confirmation: string, result: CommandResult): void;
	/** The person's chain every write to a confirmation row takes: a read or an archive of one too (fifth round, 5). */
	chain<T>(person: string, work: () => Promise<T>): Promise<T>;
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
	/**
	 * The overlay's answer once it closed: its result, its reason, and whether it was the person's own gesture, kept here
	 * until the run reads it, never read again from the overlays' bounded history (step 6's sixth round, B4).
	 */
	answer?: { result: string; reason: string; byPerson: boolean };
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
				typeof row.ckey === 'string' &&
				typeof row.cbucket === 'string'
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

	const { pending, declined, asking, expired, slotBusy, closedPrompt, noPerson } = refusalsOf(fail);

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

	/** Slot confirmations, by id: opened by `prompt-settle`, answered in the slot. */
	const slots = new Map<string, SlotRecord>();
	/**
	 * The keys a question in the slot holds, from the moment the call asks until it settles, with its overlay once open
	 * (step 6's third round, D): a repeat of the same key from any path, the inbox's among them after its app stopped
	 * being active, gets `CONFIRMATION_PENDING` with the question already asked, never a second one.
	 */
	const reserved = new Map<string, { overlay?: string }>();
	/**
	 * By person and app's bucket, the ids of its slot declines being written now, which its bound counts until each row
	 * is visible, so none counts twice (step 6's fourth round, 7; fifth round, 6).
	 */
	const declining = new Map<string, Set<string>>();
	const decliningOf = (person: string, bucket: string): Set<string> => {
		const at = `${person} ${bucket}`;
		const held = declining.get(at) ?? new Set<string>();
		declining.set(at, held);
		return held;
	};
	/** The replay's confirmed runs it answered from their records, by confirmation (fifth round, 3). */
	const recordedRuns = new Map<string, unknown>();
	/**
	 * The confirmations a person confirmed whose run this page is making now, by id (live only), with the claim this page
	 * wrote: the run is allowed only while the stored row still holds that claim (R2).
	 */
	const approved = new Map<string, { command: string; key: string; claim: string }>();
	/** The input prompts a fill has taken, so a second fill of the same prompt finds none (blocker 7). */
	const consumed = new Set<string>();
	/** A replay's runs by the trace that made them (`origin`), so that call answers from it and runs nothing again. */
	const ran = new Map<string, CommandResult>();

	/**
	 * What the rows already say of a key (F5, R16), on the person's chain, for the inbox's path and the active app's slot
	 * alike (blocker 6): a decline within its window, or the key's live row (pending, declined, or confirmed with its
	 * stored outcome). Undefined when a new confirmation may be raised.
	 */
	async function priorAnswer(
		rows: readonly StoredConfirmation[],
		key: string,
		name: string,
		now: number
	): Promise<CommandResult | undefined> {
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
			return declined(
				name,
				row.confirmation.reason === 'access' ? { reason: 'access' } : undefined
			);
		};
		// The decline window (F9's step 4), on the same key, from any declined row of it, a slot's among them.
		const windowed = same.find(
			(row) =>
				row.confirmation.state === 'declined' &&
				row.confirmation.reason === 'person' &&
				(row.confirmation.answeredAt ?? 0) + DECLINE_WINDOW_MS > now
		);
		if (windowed) return refuseAgain(windowed);
		// A re-call on the same key before its `expiresAt` raises none (F5): its stored state answers.
		const live = same.find(
			(row) =>
				now < row.confirmation.expiresAt &&
				row.confirmation.state !== 'withdrawn' &&
				row.cslot === undefined
		);
		if (!live) return undefined;
		const state = stateNow(live.confirmation, now);
		if (state === 'pending') return pending(live);
		if (state === 'declined') return refuseAgain(live);
		if (state === 'confirmed' && live.confirmation.result !== undefined)
			return structuredClone(live.confirmation.result) as CommandResult;
		return undefined;
	}

	/** The re-check before a confirmed run (7.2, blocker 5): access, then the app's enablement, load and the caller's own. */
	const refusedAccess = (
		actor: unknown,
		command: string,
		caller: string | undefined,
		scope: ScopeV1
	): boolean =>
		!deps.allows(actor as AccessActorV1, scope) ||
		deps.served(command, caller, scope) !== undefined ||
		// Line 6 again: a project archived while it waited takes no mutation (step 6's second round, 4).
		deps.archived(command, scope);

	/**
	 * The one re-check run immediately before a confirmed call's handler, on every path (step 6's fourth round, 3): access,
	 * the app's enablement and load, the archive, and for an app's call its input against `inputBytes` now. The resource
	 * checks run beside it, in the scope middleware's `again`.
	 */
	const stale = (
		actor: unknown,
		command: string,
		caller: string | undefined,
		scope: ScopeV1,
		input: unknown,
		person: string | undefined
	): CommandResult | undefined => {
		// The person signed in now, the one it was asked of (fifth round, 2): a sign-in or sign-out after Confirm runs nothing.
		if (deps.personNow() !== person) {
			return fail(
				'SESSION_CHANGED',
				'The person changed before this confirmed call could run, so it did not run',
				'Ask again only if the new person should answer it'
			);
		}
		if (
			refusedAccess(actor, command, caller, scope) ||
			(caller !== undefined && deps.inputOver(input ?? {}))
		)
			return declined(command, { reason: 'access' });
		return undefined;
	};

	// ─── The slot (a person's gesture, the active app's port) ──────────────────────

	async function inSlot(
		name: string,
		call: CommandContext & KernelFieldContext & { confirmation?: string },
		next: () => Promise<CommandResult>,
		key: string,
		opener: Opener,
		asked: AskedFor,
		input: unknown,
		hold: { overlay?: string }
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
			// A fill's input prompt the person closed before its confirmation could replace it ends the fill (third round, D).
			// One still open that cannot be replaced (another modal over it, or another command's): the slot is busy (fourth
			// round, Opus 3).
			if (replaces !== undefined && !replaceable)
				return overlays.get(replaces) ? slotBusy() : closedPrompt(replaces);
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
					scope,
					input: jsonOf(input),
				},
			});
			if (!opened.success) return opened;
			hold.overlay = (opened.data as { overlay?: OverlayRefV1 } | undefined)?.overlay?.overlayId;
		}
		// From here it waits on the person: the calls behind it go on (step 6's second round, 3), and so do the changes to
		// its document behind it, which it waits for again before it runs (third round, A).
		deps.releaseQueue(call);
		const chain = deps.chainOf(call);
		chain?.release();
		const record = slots.get(id);
		// The confirmation the entry names must be this call's: its command and its key (fourth round, 5).
		if (!record || record.command !== name || record.key !== key) {
			return fail(
				'OVERLAY_NOT_FOUND',
				'The confirmation this call asked for is not open',
				'Call again to be asked again'
			);
		}
		// A replay never waits on the page: the person's answer is in the entries before this one, or the journal lacks it
		// (fifth round, 4).
		if (deps.replaying() && record.answer === undefined) {
			return fail(
				'REPLAY_NOT_RECORDED',
				"The journal records no answer to this call's confirmation before it, so the replay does not run it",
				'Replay the whole journal the session recorded'
			);
		}
		const answer =
			record.answer ??
			(await (async () => {
				const closing = overlays.whenClosed(record.overlayId);
				const closed = await closing?.settled;
				return closed && closing
					? { result: closed.result, reason: closed.reason, byPerson: await closing.byPerson }
					: undefined;
			})());
		slots.delete(id);
		const scope = scopeOf(call);
		/**
		 * A call that waited and ended without running its handler answers from its record in a replay (step 6's third
		 * round, C): it is journaled after the answer, so a replay would start it in what the calls made while it waited
		 * left (an archived project), and the gates before this one would answer differently.
		 */
		const unrun = (result: CommandResult): CommandResult => {
			call.replay = 'recorded';
			return result;
		};
		// A confirm is the person's own gesture, live and in a replay, or nothing runs (fifth round, 4).
		if (answer?.result === 'confirm' && answer.byPerson !== true)
			return unrun(declined(name, { reason: 'withdrawn', closed: 'confirm' }));
		if (answer?.result === 'confirm') {
			// Settled as confirmed: a repeat of the key is a new call from here (third round, D). A decline keeps the key until
			// its row is written (fourth round, 7), where `ask` lets it go.
			if (reserved.get(key) === hold) reserved.delete(key);
			// Re-checked immediately before the run, inside the chain it retakes (blocker 5; fourth round, 3): access, the
			// app, the archive and the input may all have changed while the slot, or the chain, waited.
			const caller = opener.kind === 'app' ? opener.owner.id : undefined;
			const asker = personOf(call);
			// Once on the answer, so a refusal says access as the inbox's does, and again once the chain is retaken.
			const early = stale(call.actor, name, caller, scope, input, asker);
			if (early) return unrun(early);
			let ran = false;
			const run = async (): Promise<CommandResult> => {
				const late = stale(call.actor, name, caller, scope, input, asker);
				if (late) return late;
				ran = true;
				return next();
			};
			const result = chain ? await chain.again(run) : await run();
			return ran ? result : unrun(result);
		}
		if (answer?.reason === 'person') {
			return unrun(
				fail(
					'SESSION_CHANGED',
					'The person changed while this waited for a confirmation, so it did not run',
					'Ask again only if the new person should answer it'
				)
			);
		}
		// The raising app's own cancel is `withdrawn` (6.5, F6), which never opens the window.
		if (answer?.reason === 'withdrawn') return unrun(declined(name, { reason: 'withdrawn' }));
		// Only a person's own decline opens the window: a prompt closed for any other reason, the shell's switch or a close
		// with no gesture of theirs among them, ends `withdrawn`, never their decline (second round, 6 and 11).
		if (answer?.reason !== 'user' || answer.byPerson !== true)
			return unrun(declined(name, { reason: 'withdrawn', closed: answer?.reason ?? 'closed' }));
		// A person's gesture is exempt from the window (N8); the active app's port is held by it, kept in the store (blocker
		// 6), so a reload and the inbox's path see it. Written by `prompt-settle`, journaled as its own entry, so a replay
		// that answers this call from its record writes it all the same (third round, C).
		const person = personOf(call);
		if (opener.kind === 'app' && person !== undefined) {
			// Counted toward the app's bound while it is written, by its id until its row is visible (fourth round, 7;
			// fifth round, 6).
			const bucket = bucketOf(opener) as string;
			const declineId = newId(call, 'ntf');
			const outstanding = decliningOf(person, bucket);
			outstanding.add(declineId);
			const written = await deps
				.runBoot('prompt-settle', {
					decline: {
						id: declineId,
						person,
						key,
						command: name,
						caller: opener.owner.id,
						header: headerOf(opener, asked.title, scope, call).slice(0, 200),
						title: asked.title.slice(0, 120),
						prompt: asked.prompt,
						danger: asked.danger,
						scope,
						input: summaryOf(jsonOf(input)),
					},
				})
				.finally(() => {
					outstanding.delete(declineId);
					// Only this call's own set: another decline may have put a new one under the key since (seventh round, C4).
					const at = `${person} ${bucket}`;
					if (outstanding.size === 0 && declining.get(at) === outstanding) declining.delete(at);
				});
			deps.noteInbox(call);
			if (!written.success) return unrun(written);
		}
		return unrun(declined(name));
	}

	/**
	 * A slot decline's row (blocker 6), written by `prompt-settle`: a window that ended goes, and a live one never does
	 * (third round, E: a new request at capacity is refused before it asks instead).
	 */
	async function writeDecline(
		decline: {
			id: string;
			person: string;
			key: string;
			command: string;
			caller: string;
			header: string;
			title: string;
			prompt: string;
			danger: boolean;
			scope: ScopeV1;
			input: unknown;
		},
		context: CommandContext
	): Promise<void> {
		const { person } = decline;
		await serial(person, async () => {
			const now = kit.callNow(context);
			const row: StoredConfirmation = {
				id: decline.id,
				workspace: deps.workspace(),
				person,
				source: decline.caller,
				kind: 'confirmation',
				title: decline.title,
				tone: decline.danger ? 'danger' : 'warning',
				confirmation: {
					command: decline.command,
					caller: decline.caller,
					input: decline.input,
					header: decline.header,
					prompt: decline.prompt,
					title: decline.title,
					...(decline.danger ? { danger: true } : {}),
					expiresAt: now + DECLINE_WINDOW_MS,
					state: 'declined',
					reason: 'person',
					answeredAt: now,
				},
				scope: decline.scope,
				createdAt: now,
				// Not news: the person answered it in the slot.
				readAt: now,
				ckey: decline.key,
				ciface: 'palette',
				cbucket: `app:${decline.caller}`,
				cslot: true,
			};
			const ended = (await rowsOf(person)).filter(
				(each) => each.cslot === true && each.confirmation.expiresAt <= now
			);
			const { summary } = await store.batch([
				...ended.map((each) => ({
					method: 'DELETE' as const,
					path: `/${TABLE}/${encodeURIComponent(each.id)}`,
				})),
				{ method: 'PUT', path: `/${TABLE}/${encodeURIComponent(row.id)}`, body: row },
			]);
			if (summary.failed > 0)
				throw new Error(`The store could not write the confirmation '${row.id}'`);
			// Visible now: counted by its row from here, never twice (fifth round, 6).
			const at = `${person} ${row.cbucket}`;
			declining.get(at)?.delete(row.id);
			if (declining.get(at)?.size === 0) declining.delete(at);
		});
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
		const caller = bucketOf(opener) as string;
		const scope = scopeOf(call);
		// The person's inbox may change whatever this answers: the Inbox count reads again (10.3).
		deps.noteInbox(call);
		return serial(person, async () => {
			const now = kit.callNow(call);
			const rows = await rowsOf(person);
			const prior = await priorAnswer(rows, key, name, now);
			if (prior) return prior;
			// R3: every confirmation a caller raised within its 10-minute life counts, answered or not, so asking and
			// withdrawing at once fills nothing; and the person holds at most PERSON_LIMIT from every caller together.
			const living = rows.filter(
				(row) => row.cslot === undefined && now < row.createdAt + CONFIRMATION_TTL_MS
			);
			const limited = (held: readonly StoredConfirmation[], limit: number, who: string) => {
				const soonest = Math.min(...held.map((row) => row.createdAt + CONFIRMATION_TTL_MS));
				return fail(
					'RATE_LIMITED',
					`At most ${limit} confirmations ${who} within 10 minutes`,
					'Wait for one to be answered or expire, then call again',
					{
						retryable: true,
						details: { limit, retryAfterMs: Math.max(1, soonest - now) },
					}
				);
			};
			const theirs = living.filter((row) => row.cbucket === caller);
			if (theirs.length >= PENDING_LIMIT) return limited(theirs, PENDING_LIMIT, 'from one caller');
			if (living.length >= PERSON_LIMIT) return limited(living, PERSON_LIMIT, 'for one person');
			const record: StoredConfirmation = {
				id: newId(call, 'ntf'),
				workspace: deps.workspace(),
				person,
				source: opener.owner.id,
				kind: 'confirmation',
				title: asked.title.slice(0, 120),
				tone: asked.danger ? 'danger' : 'warning',
				confirmation: {
					command: name,
					caller: opener.owner.id,
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
				cbucket: caller,
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
		const caller = bucketOf(opener) as string;
		const key = await keyOf(person, caller, name, input, scopeOf(call), asked.group);
		// A replay follows the route its entry recorded (fourth round, 5): a slot confirmation's id says it asked in the
		// slot, whatever is active when the replay reaches it.
		const slot =
			(deps.replaying() &&
				opener.kind !== 'agent' &&
				call.confirmation?.startsWith('cnf_') === true) ||
			opener.kind === 'shell' ||
			(opener.kind === 'app' && (await deps.isActive(opener.owner.id)));
		// Not in a replay, whose waiting call's entry already asked. A refusal decided by what this page holds in memory is
		// answered from its record in a replay.
		const replayed = call.confirmation !== undefined && deps.replaying();
		// Checked, and for the slot reserved below, with no await between (third round, D).
		const holding = reserved.get(key);
		if (holding && !replayed) {
			call.replay = 'recorded';
			deps.noteInbox(call);
			return asking(name, holding.overlay);
		}
		if (slot) {
			const hold: { overlay?: string } = {};
			reserved.set(key, hold);
			try {
				// The window and the key's live row (F9's step 4, F5) hold an active app's port too, whatever path raised the row
				// (blocker 6); only a person's gesture is exempt (N8). Not in a replay, whose entry already asked.
				if (opener.kind === 'app' && !replayed) {
					const prior = await serial(person, async () => {
						const now = kit.callNow(call);
						const rows = await rowsOf(person);
						const answered = await priorAnswer(rows, key, name, now);
						if (answered) return answered;
						// At most SLOT_KEPT live declines per person and app (third round, E): a live window is never evicted, so a
						// new question at capacity is refused until the earliest window ends, and one app's never touch another's.
						const windows = rows.filter(
							(row) =>
								row.cslot === true && row.cbucket === caller && row.confirmation.expiresAt > now
						);
						const outstanding = declining.get(`${person} ${caller}`)?.size ?? 0;
						if (windows.length + outstanding < SLOT_KEPT) return undefined;
						// One being written ends its window last of all: a full window from now.
						const soonest = Math.min(
							...windows.map((row) => row.confirmation.expiresAt),
							...(outstanding > 0 ? [now + DECLINE_WINDOW_MS] : [])
						);
						return fail(
							'RATE_LIMITED',
							`At most ${SLOT_KEPT} declined questions from one app stay refused at once`,
							'Wait for the earliest decline window to end, then ask again; do not repeat a declined call',
							{
								retryable: true,
								details: { limit: SLOT_KEPT, retryAfterMs: Math.max(1, soonest - now) },
							}
						);
					});
					if (prior) {
						deps.noteInbox(call);
						return prior;
					}
				}
				return await inSlot(name, call, next, key, opener, asked, input, hold);
			} finally {
				if (reserved.get(key) === hold) reserved.delete(key);
			}
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
				? await keyOf(person, row.cbucket, name, input, scopeOf(call), row.confirmation.group)
				: undefined;
		// A replay's run needs a pending row too (fifth round, 3): a declined or withdrawn one never runs.
		const allowed = deps.replaying()
			? row !== undefined && key === row.ckey && row.confirmation.state === 'pending'
			: live !== undefined &&
				live.command === name &&
				live.key === key &&
				row?.confirmation.state === 'pending' &&
				row.claim === live.claim;
		if (!row || !allowed) {
			return fail(
				'HUMAN_REQUIRED',
				'Only the shell runs a call a person confirmed, once',
				'Call the command itself to ask the person'
			);
		}
		// The same re-checks, together, immediately before the handler, after this run's own awaits (fourth round, 3;
		// fifth round, 2): the resources (lines 5 and 6) in place, then access, the app, the input and the person.
		const caller = row.ciface === 'palette' ? row.source : undefined;
		const refused =
			(await deps.chainOf(call)?.check()) ??
			stale(row.cactor, name, caller, row.scope, input, row.person);
		if (refused) {
			// Decided by what changed since the act: a replay answers it from its record, running nothing.
			(call as KernelFieldContext).replay = 'recorded';
			return refused;
		}
		const result = await next();
		deps.noteInbox(call);
		const now = kit.callNow(call);
		// On the person's chain, as every write to the row is (fifth round, 5).
		await serial(row.person, async () => {
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

	const settleInput = settleInputOf(z);
	const settle = kit.define<typeof settleInput, { overlay?: OverlayRefV1 }>({
		name: 'prompt-settle',
		description:
			"The shell's own prompts in the slot: close the palette's input prompt, open a confirmation, keep a decline (7.1, 7.2). Boot's alone",
		category: 'prompt',
		mutation: true,
		executionTime: 'instant',
		input: settleInput,
		jsonSchema: { type: 'object', additionalProperties: true } as JsonSchema,
		async handler(input, context) {
			const { open } = input;
			// The whole input checked before anything is written (sixth round): a decline and a settle each stand alone.
			if (
				(input.decline && (input.settle || input.open || input.close !== undefined)) ||
				(input.settle && (input.open || input.close !== undefined))
			) {
				return fail(
					'VALIDATION_ERROR',
					'decline and settle are each a whole prompt-settle of its own',
					'None: only the kernel settles one'
				);
			}
			if (
				input.close !== undefined &&
				overlays.get(input.close) &&
				overlays.forOf(input.close)?.kind !== 'input'
			) {
				return fail(
					'VALIDATION_ERROR',
					'close names the palette input prompt a fill answered or replaced',
					'None: only the kernel closes one'
				);
			}
			if (input.decline) await writeDecline(input.decline as never, context);
			if (input.settle) {
				const settled = await settleRow(input.settle, context);
				if (settled) return settled as CommandResult<never>;
			}
			// Checked and reserved in one step, with no await between (blocker 7): the slot is free once the prompt this
			// replaces closes, or nothing opens.
			const held = overlays.modalOpen();
			// The prompt a confirmation replaces must still be open (third round, D): one the person closed meanwhile ends it.
			if (
				open &&
				input.reason === 'replaced' &&
				input.close !== undefined &&
				held?.overlayId !== input.close
			)
				return overlays.get(input.close) ? slotBusy() : closedPrompt(input.close);
			if (open && held && held.overlayId !== input.close) {
				return fail(
					'OVERLAY_MODAL_BUSY',
					'A modal or a prompt is already open, so the shell cannot ask to confirm this',
					'Answer or close it, then call again',
					{ retryable: true }
				);
			}
			// Boot closes the palette's input prompt alone: a confirmation is answered by the person (fifth round, 4).
			if (
				input.close !== undefined &&
				overlays.get(input.close) &&
				overlays.forOf(input.close)?.kind !== 'input'
			) {
				return fail(
					'VALIDATION_ERROR',
					'close names the palette input prompt a fill answered or replaced',
					'None: only the kernel closes one'
				);
			}
			if (input.close !== undefined && overlays.get(input.close)) {
				overlays.close(
					input.close,
					input.reason === 'replaced' ? 'cancel' : 'confirm',
					input.reason ?? 'user'
				);
			}
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
					...(open.scope !== undefined ? { scope: open.scope } : {}),
					input: open.input,
				},
			});
			const record: SlotRecord = {
				overlayId: overlay.overlayId,
				key: open.key,
				command: open.command,
			};
			slots.set(open.id, record);
			const closing = overlays.whenClosed(overlay.overlayId);
			void closing?.settled.then(async (closed) => {
				record.answer = {
					result: closed.result,
					reason: closed.reason,
					byPerson: await closing.byPerson,
				};
			});
			return kit.success({ overlay });
		},
	});

	/**
	 * The act's end (10.2; step 6's third round, G, and fourth round, 6): bound to the row it names, of this workspace and
	 * of the command it ran, and to an allowed change, pending to confirmed or declined, or confirmed again as the run left
	 * it; only what the act changes is merged onto the row as it stands, in the person's chain, the claim dropped.
	 */
	async function settleRow(
		ended: {
			id: string;
			person: string;
			command: string;
			state: 'confirmed' | 'declined';
			result?: unknown;
		},
		context: CommandContext
	): Promise<CommandResult | undefined> {
		return serial(ended.person, async () => {
			const row = (await rowsOf(ended.person)).find((each) => each.id === ended.id);
			const from = row?.confirmation.state;
			// Pending to confirmed only for a run the replay answered from its record, with this outcome: live, the run itself
			// writes confirmed before the act settles (fifth round, 3).
			const ran = recordedRuns.get(ended.id);
			const bound =
				ended.state === 'declined' ||
				(ran !== undefined && JSON.stringify(ran) === JSON.stringify(jsonOf(ended.result)));
			const allowed =
				row !== undefined &&
				row.confirmation.command === ended.command &&
				((from === 'pending' && bound) || (from === 'confirmed' && ended.state === 'confirmed'));
			if (!row || !allowed) {
				return fail(
					'VALIDATION_ERROR',
					'settle names a confirmation of this workspace that the act may end so',
					'None: only the kernel settles one'
				);
			}
			const now = kit.callNow(context);
			const { claim: _claim, ...kept } = row;
			await putBack({
				...kept,
				confirmation: {
					...kept.confirmation,
					state: ended.state,
					reason: ended.state === 'confirmed' ? 'person' : 'access',
					answeredAt: kept.confirmation.answeredAt ?? now,
					...(kept.confirmation.result !== undefined && ended.state === 'confirmed'
						? {}
						: ended.result !== undefined
							? { result: jsonOf(ended.result) as CommandResult }
							: {}),
				},
				...(kept.readAt === undefined ? { readAt: now } : {}),
			});
			return undefined;
		});
	}

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
		// By bucket (R1): the raising app's instance, or any agent of the same person on the agent interface, which share
		// one, or the copilot for its own.
		const caller = bucketOf(opener);
		const row =
			person === undefined
				? undefined
				: (await rowsOf(person)).find((each) => each.id === notification && ownedBy(each, caller));
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

	const withdrawOne = kit.define<typeof oneInput, { state: ConfirmationStateV1; running?: true }>({
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
			deps.noteInbox(context);
			return serial(person, async () => {
				const stored = (await rowsOf(person)).find((each) => each.id === row.id) ?? row;
				const state = stateNow(stored.confirmation, kit.callNow(context));
				// One that ended, or is running, answers where it stands (improvement 15): nothing changes.
				if (state !== 'pending' || stored.claim !== undefined) {
					return kit.success({
						state,
						...(stored.claim !== undefined ? { running: true } : {}),
					});
				}
				// Withdrawn before the person acted on it is not news (R3): marked read.
				await putBack({
					...stored,
					confirmation: { ...stored.confirmation, state: 'withdrawn' },
					...(stored.readAt === undefined ? { readAt: kit.callNow(context) } : {}),
				});
				return kit.success({ state: 'withdrawn' as const });
			});
		},
	});

	// ─── palette-run (7.1), in its own module ──────────────────────────────────────

	const paletteRun = createPaletteRun(deps, { fail, scopeOf, consumed, ran });

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
		deps.noteInbox(context);
		// A replay's run for this act ran at its own entry; this act answers from the row it wrote (improvement 15).
		if (context.traceId !== undefined) ran.delete(context.traceId);
		/**
		 * Read, decided and claimed on the person's chain (the reviews' race): a withdrawal, an expiry's re-call or another
		 * answer never lands between the read and the claim. The run itself is outside it.
		 */
		const decided = await serial(
			person,
			async (): Promise<{ done: CommandResult } | { claimed: StoredConfirmation }> => {
				const row = (await rowsOf(person)).find((each) => each.id === notice.id);
				if (!row) {
					return {
						done: fail(
							'NOTIFICATION_NOT_FOUND',
							`You have no confirmation '${notice.id}'`,
							'List your notices with notification-list'
						),
					};
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
					if (state !== 'pending' && row.readAt === undefined)
						await putBack({ ...row, readAt: now });
					// As the answer that ended it said (a person's confirm or decline says no reason), so a replay answers the
					// same.
					return {
						done: kit.success({
							state: row.claim !== undefined || acting.has(row.id) ? 'pending' : state,
							...(row.confirmation.reason === 'access' ? { reason: 'access' as const } : {}),
						}),
					};
				}
				if (given === 'decline') {
					await putBack(marked({ state: 'declined', reason: 'person', answeredAt: now }));
					return { done: kit.success({ state: 'declined' as const }) };
				}
				// The re-check (7.2): the same chain as steps 2 and 3, for the actor that asked, in the confirmation's scope.
				const caller = row.ciface === 'palette' ? row.source : undefined;
				if (
					refusedAccess(row.cactor, row.confirmation.command, caller, row.scope) ||
					(caller !== undefined && deps.inputOver(row.confirmation.input ?? {}))
				) {
					await putBack(marked({ state: 'declined', reason: 'access', answeredAt: now }));
					return { done: kit.success({ state: 'declined' as const, reason: 'access' as const }) };
				}
				// Claimed before it runs, as a notice's action (step 5): in this page, and in the store, read back.
				const claim = `${context.traceId ?? ''}:${newId(context, 'cnf')}`;
				await store.update(TABLE, row.id, { claim } as never);
				const claimed = await store.get<StoredConfirmation>(TABLE, row.id).catch(() => null);
				if (claimed?.claim !== claim) return { done: kit.success({ state: 'pending' as const }) };
				acting.add(row.id);
				return { claimed: { ...claimed, claim } };
			}
		);
		if ('done' in decided) return decided.done;
		const row = decided.claimed;
		const caller = row.ciface === 'palette' ? row.source : undefined;
		try {
			approved.set(row.id, {
				command: row.confirmation.command,
				key: row.ckey,
				claim: row.claim as string,
			});
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
			// Read on the person's chain: a run the shell recorded is confirmed; one the chain refused first ran nothing.
			const confirmed = await serial(
				person,
				async () =>
					(await store.get<StoredConfirmation>(TABLE, row.id).catch(() => null))?.confirmation
						.state === 'confirmed'
			);
			// The act's end, written by `prompt-settle`, journaled as its own entry (step 6's third round, G): a replay that
			// answers this act and its run from their records, a run the page decided among them, writes it all the same.
			const written = await deps.runBoot('prompt-settle', {
				settle: {
					id: row.id,
					person,
					command: row.confirmation.command,
					state: confirmed ? 'confirmed' : 'declined',
					result: outcomeOf(result),
				},
			});
			if (!written.success) return written;
			return confirmed
				? kit.success({ state: 'confirmed' as const })
				: kit.success({ state: 'declined' as const, reason: 'access' as const });
		} finally {
			approved.delete(row.id);
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
		recorded(confirmation, result) {
			recordedRuns.set(confirmation, outcomeOf(result));
		},
		chain: serial,
		async withdraw(context, match, person) {
			const whose = person ?? personOf(context);
			if (whose === undefined) return 0;
			deps.noteInbox(context);
			return serial(whose, async () => {
				const now = kit.callNow(context);
				let count = 0;
				for (const row of await rowsOf(whose)) {
					if (stateNow(row.confirmation, now) !== 'pending' || row.claim !== undefined) continue;
					if (!match(row)) continue;
					await putBack({
						...row,
						confirmation: { ...row.confirmation, state: 'withdrawn' },
						...(row.readAt === undefined ? { readAt: now } : {}),
					});
					count++;
				}
				return count;
			});
		},
	};
}
