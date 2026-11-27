/**
 * @fileoverview Confirmations (phase 4 spec 7.2, D122) in `late-settings`: enforces `confirm_prompt` in process,
 * opens slot prompts or inbox `CONFIRMATION_PENDING`, runs confirmed calls once with `origin`, and replays from records.
 * Imports types alone from first paint (13).
 */

import type { Actor, CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type {
	ConfirmationPreviewV1,
	ConfirmationRecordV1,
	ConfirmationStateV1,
	ConfirmationV1,
	NotificationV1,
	OverlayRefV1,
	PromptInputV1,
} from '@lushly-dev/loam-sdk';
import type { KernelFieldContext } from '../context-fields.js';
import type { LoamKernelErrorCode } from '../errors.js';
import type { Opener } from '../overlays/commands.js';
import type { AccessActorV1 } from '../scope/access.js';
import type { ScopeV1 } from '../scope/records.js';
import type { ContextField } from '../types.js';
import type { ConfirmationDeps } from './confirmation-deps.js';
import {
	type AskedFor,
	bucketOf,
	CONFIRMATION_TTL_MS,
	confirmationHeaderOf,
	DECLINE_WINDOW_MS,
	ENDED_KEPT,
	ENFORCED,
	type EnforcedV1,
	enforcedFields,
	ID,
	jsonOf,
	markStored,
	noteBus,
	outcomeOf,
	ownedBy,
	PENDING_LIMIT,
	PERSON_LIMIT,
	RAISED,
	REPLACES,
	RESHOW,
	refusalsOf,
	reshowRows,
	SLOT_KEPT,
	type StoredConfirmation,
	settleInputOf,
	stateNow,
	summaryOf,
	TABLE,
} from './confirmation-parts.js';
import { createPaletteRun } from './palette-run.js';

export type { ConfirmationDeps } from './confirmation-deps.js';
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

export interface Confirmations {
	/** The kernel chain's last middleware: 7.2's steps 4 to 6, and the run a confirmation approved. */
	gate: CommandMiddleware;
	/**
	 * `confirmation`, the id a call ran for (a slot's `cnf_`, a pending one's `ntf_`), and `origin`, the trace of the call
	 * that made a run: set by the kernel alone and journaled, so a replay finds both (7.2).
	 */
	contextFields: ContextField[];
	/** `palette-run`, `confirmation-get` and `confirmation-withdraw` (7.1, 10.2). */
	commands: ZodCommandDefinition[];
	/** `prompt-settle`, in `BOOT_ONLY`. */
	settle: ZodCommandDefinition;
	/**
	 * A replay's: a confirmed run it answered from its record, with its command and outcome, so the act's settle may
	 * confirm the row it leaves pending, once, and no other (step 6's fifth round, 3; #1656).
	 */
	recorded(confirmation: string, command: string, result: CommandResult): void;
	/** Forget replay credits on a session reload (#1656). */
	reset(): void;
	/** The person's chain every write to a confirmation row takes: a read or an archive of one too (fifth round, 5). */
	chain<T>(person: string, work: () => Promise<T>): Promise<T>;
	/** `notification-act { answer }` on a confirmation (10.2): only a person's gesture reaches it. */
	answer(
		row: NotificationV1,
		answer: 'confirm' | 'decline' | undefined,
		context: CommandContext
	): Promise<CommandResult>;
	/** Whether `person` has a pending confirmation `match` selects (step 9's R14 at boot). */
	pending(
		person: string,
		match: (row: StoredConfirmation) => boolean,
		now: number
	): Promise<boolean>;
	/** End as `withdrawn` every pending confirmation `match` selects (R14 or person change); never opens the decline window. */
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
		asked: AskedFor
	): Promise<CommandResult>;
}

/** A slot confirmation: in this page's memory, answered in the slot, never in the inbox. */
interface SlotRecord {
	overlayId: string;
	key: string;
	command: string;
	/** The overlay's answer once closed (kept here until read, never re-read from bounded overlay history). */
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

	const readOrder = (ctx: CommandContext) => {
		if (ctx.traceId !== undefined) deps.recordOrder?.(ctx.traceId, 'record:confirmation')?.read();
	};
	const wroteOrder = (ctx: CommandContext) => {
		if (ctx.traceId !== undefined) deps.recordOrder?.(ctx.traceId, 'record:confirmation')?.wrote();
	};

	/** A row put back whole, in one batch: a `PUT` merges, so a field the write drops (`claim`) would survive it. */
	async function putBack(row: StoredConfirmation, ctx?: CommandContext): Promise<void> {
		if (ctx) wroteOrder(ctx);
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

	const { pending, declined, asking, expired, slotBusy, closedPrompt, noPerson, reshown } =
		refusalsOf(fail);
	/** The confirmations a changed preview ended, and the new one that shows it (phase 5's 7.2), until the act reads it. */
	const reshownAs = new Map<string, string>();
	const headerOf = (opener: Opener, title: string, scope: ScopeV1, context: CommandContext) =>
		confirmationHeaderOf(
			opener,
			title,
			scope.project === undefined ? undefined : deps.projectName(scope.project),
			deps.personLabel(),
			deps.appTitle,
			context.actor
		);

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
	/** Keys held in the slot until settled (repeat calls get CONFIRMATION_PENDING, never a second prompt). */
	const reserved = new Map<string, { overlay?: string }>();
	/** Per person+bucket, slot decline ids currently being written (counted toward bound until visible). */
	const declining = new Map<string, Set<string>>();
	const decliningOf = (person: string, bucket: string): Set<string> => {
		const at = `${person} ${bucket}`;
		const held = declining.get(at) ?? new Set<string>();
		declining.set(at, held);
		return held;
	};
	/** Replay confirmed runs answered from their records, by confirmation id (#1656). */
	const recordedRuns = new Map<string, { command: string; outcome: unknown }>();
	/** Live confirmed runs approved by this page, keyed by id with the stored claim (R2). */
	const approved = new Map<string, { command: string; key: string; claim: string }>();
	/** Input prompts already consumed by a fill. */
	const consumed = new Set<string>();
	/** Replay runs by `origin` trace so the outer call answers from it without re-running. */
	const ran = new Map<string, CommandResult>();

	/** Prior state of a key on the person's chain (F5, R16): decline window or live row; undefined if a new prompt may open. */
	async function priorAnswer(
		rows: readonly StoredConfirmation[],
		key: string,
		name: string,
		now: number,
		ctx: CommandContext
	): Promise<CommandResult | undefined> {
		const same = rows
			.filter((row) => row.ckey === key)
			.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
		/** Refused without asking (R16): counted on the declined row, which the inbox lists "Declined automatically". */
		const refuseAgain = async (row: StoredConfirmation) => {
			await putBack(
				{
					...row,
					confirmation: {
						...row.confirmation,
						declinedAgain: (row.confirmation.declinedAgain ?? 0) + 1,
					},
				},
				ctx
			);
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
		// Marked as a stored outcome answered again (phase 5's 5.1): never read as the kernel's own answer.
		if (state === 'confirmed' && live.confirmation.result !== undefined)
			return markStored(structuredClone(live.confirmation.result) as CommandResult, live.id);
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
					...(asked.preview ? { preview: asked.preview } : {}),
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
			let changed: AskedFor['preview'];
			const run = async (): Promise<CommandResult> => {
				const late = stale(call.actor, name, caller, scope, input, asker);
				if (late) return late;
				ran = true;
				// A released command runs on its held instance once its preview matches (phase 5's 7.2).
				const released = deps.release
					? await deps.release(name, input, call, asked.preview, next, async () => {})
					: await next();
				if (!(RESHOW in released)) return released;
				changed = released[RESHOW];
				return reshown(changed);
			};
			const result = chain ? await chain.again(run) : await run();
			// Changed since the person looked: asked again in the slot, with what it shows now, and nothing ran. The prompt a
			// palette fill replaced is closed by now, so the new question replaces nothing (the trust review's B9).
			if (changed) {
				delete (call as Record<symbol, unknown>)[REPLACES];
				return ask(name, input, call, next, { ...asked, preview: changed });
			}
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
						...(call.interface === 'apps' ? { ciface: 'apps' as const } : {}),
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
			ciface?: 'palette' | 'apps';
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
				ciface: decline.ciface ?? 'palette',
				cbucket: `app:${decline.caller}`,
				cslot: true,
			};
			const ended = (await rowsOf(person)).filter(
				(each) => each.cslot === true && each.confirmation.expiresAt <= now
			);
			wroteOrder(context);
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
		asked: AskedFor,
		input: unknown,
		person: string
	): Promise<CommandResult> {
		const caller = bucketOf(opener) as string;
		const scope = scopeOf(call);
		// The person's inbox may change whatever this answers: the Inbox count reads again (10.3).
		deps.noteInbox(call);
		return serial(person, async () => {
			const now = kit.callNow(call);
			readOrder(call);
			const rows = await rowsOf(person);
			const prior = await priorAnswer(rows, key, name, now, call);
			if (prior) {
				// The row this key holds pending, and no stored outcome that merely names one (re-check 2, B1).
				const held = rows.find(
					(row) =>
						row.ckey === key &&
						row.cslot === undefined &&
						stateNow(row.confirmation, now) === 'pending'
				);
				const named = (prior.error?.details as { notification?: unknown } | undefined)
					?.notification;
				if (held && prior.error?.code === 'CONFIRMATION_PENDING' && named === held.id)
					(call as Record<symbol, unknown>)[RAISED] = held.id;
				return prior;
			}
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
					...enforcedFields(asked.enforced),
					...(asked.preview ? { preview: asked.preview } : {}),
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
				...(opener.kind === 'agent' && call.actor?.kind === 'agent'
					? { raiserAgent: call.actor.id }
					: {}),
				ciface:
					call.interface === 'agent' ? 'agent' : call.interface === 'apps' ? 'apps' : 'palette',
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
			wroteOrder(call);
			const { summary } = await store.batch([
				...ended.map((row) => ({
					method: 'DELETE' as const,
					path: `/${TABLE}/${encodeURIComponent(row.id)}`,
				})),
				{ method: 'PUT', path: `/${TABLE}/${encodeURIComponent(record.id)}`, body: record },
			]);
			if (summary.failed > 0)
				throw new Error(`The store could not write the confirmation '${record.id}'`);
			await observed(call, 'asked', record);
			// The id the copilot's port takes for this call alone (the re-checks' binding).
			(call as Record<symbol, unknown>)[RAISED] = record.id;
			return pending(record);
		});
	}

	/** Told on the call's path when a confirmation is raised or ends (phase 5's 6.3, 3.5), and noted for the bus (9.2). */
	async function observed(
		context: CommandContext,
		event: 'asked' | 'confirmed' | 'declined' | 'withdrawn',
		row: StoredConfirmation,
		replacedBy?: StoredConfirmation
	): Promise<void> {
		noteBus(context, event, row);
		await deps.observe?.(event, row, replacedBy);
	}

	// ─── The gate ──────────────────────────────────────────────────────────────────

	async function ask(
		name: string,
		input: unknown,
		context: CommandContext,
		next: () => Promise<CommandResult>,
		asked: AskedFor
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
		// A released mounted command's preview, read before anything is asked (phase 5's 7.2); a refusal asks nothing.
		const preview = asked.preview ?? (await deps.previewFor?.(name, input, call));
		if (preview && 'success' in preview) return preview;
		if (preview) asked = { ...asked, preview };
		const caller = bucketOf(opener) as string;
		// The copilot's key holds its session (phase 5's 6.2): two sessions never share a confirmation or a window.
		const key = await keyOf(person, caller, name, input, scopeOf(call), asked.enforced?.session);
		// A replay follows the route its entry recorded (fourth round, 5); an agent actor never takes the slot (#1656).
		const slot =
			call.actor?.kind !== 'agent' &&
			((deps.replaying() &&
				opener.kind !== 'agent' &&
				call.confirmation?.startsWith('cnf_') === true) ||
				opener.kind === 'shell' ||
				(opener.kind === 'app' && (await deps.isActive(opener.owner.id))));
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
						readOrder(call);
						const rows = await rowsOf(person);
						const answered = await priorAnswer(rows, key, name, now, call);
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
				? await keyOf(person, row.cbucket, name, input, scopeOf(call), row.confirmation.session)
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
		const caller = row.ciface === 'palette' || row.ciface === 'apps' ? row.source : undefined;
		const refused =
			(await deps.chainOf(call)?.check()) ??
			stale(row.cactor, name, caller, row.scope, input, row.person);
		if (refused) {
			// Decided by what changed since the act: a replay answers it from its record, running nothing.
			(call as KernelFieldContext).replay = 'recorded';
			return refused;
		}
		// The outcome, on the person's chain as every write to the row is (fifth round, 5), stored before a released
		// command's hold ends (phase 5's 7.2, step 6).
		const store_ = async (result: CommandResult) => {
			deps.noteInbox(call);
			const now = kit.callNow(call);
			await serial(row.person, async () => {
				const stored = (await store.get<StoredConfirmation>(TABLE, id)) ?? row;
				const { claim: _claim, ...kept } = stored;
				await putBack(
					{
						...kept,
						confirmation: {
							...kept.confirmation,
							state: 'confirmed',
							reason: 'person',
							answeredAt: now,
							result: outcomeOf(result),
						},
					},
					call
				);
			});
		};
		const released = deps.release
			? await deps.release(name, input, call, row.confirmation.preview as never, next, store_)
			: await next().then(async (result) => {
					await store_(result);
					return result;
				});
		if (!(RESHOW in released)) return released;
		// Changed since the person looked: this confirmation ends, withdrawn, and a new one shows what the preview shows
		// now, so a press on any surface still showing the old one runs nothing (the trust review's B1).
		deps.noteInbox(call);
		const now = kit.callNow(call);
		const fresh = newId(call, 'ntf');
		await serial(row.person, async () => {
			const stored = (await store.get<StoredConfirmation>(TABLE, id)) ?? row;
			const { withdrawnRow, freshRow } = reshowRows(stored, fresh, released[RESHOW], now);
			wroteOrder(call);
			const oldPath = `/${TABLE}/${encodeURIComponent(withdrawnRow.id)}`;
			const newPath = `/${TABLE}/${encodeURIComponent(freshRow.id)}`;
			const { summary } = await store.batch([
				{ method: 'DELETE', path: oldPath },
				{ method: 'PUT', path: oldPath, body: withdrawnRow },
				{ method: 'PUT', path: newPath, body: freshRow },
			]);
			if (summary.failed > 0)
				throw new Error(`The store could not write the confirmation '${freshRow.id}'`);
			await observed(call, 'withdrawn', stored, freshRow);
			await observed(call, 'asked', freshRow);
		});
		reshownAs.set(id, fresh);
		return reshown(released[RESHOW], fresh);
	}

	const gate: CommandMiddleware = async (name, input, context, next) => {
		const call = context as CommandContext & { confirmation?: string; origin?: string };
		// The bus's notes are this gate's alone to write (phase 5's 9.2): never a caller's.
		delete (call as { bus?: unknown }).bus;
		let result: CommandResult;
		if (call.confirmation?.startsWith('ntf_')) {
			result = await confirmedRun(
				name,
				input,
				call as typeof call & { confirmation: string },
				next
			);
		} else {
			// Phase 5's enforcement (its 6.1) asks whatever the command declares, and says why on the record (6.2).
			const enforced = (call as Record<symbol, unknown>)[ENFORCED] as EnforcedV1 | undefined;
			const declared =
				deps.askedFor(name) ?? (enforced?.ask ? deps.genericAsked?.(name, enforced) : undefined);
			const asked = declared && enforced ? { ...declared, enforced } : declared;
			if (asked) {
				result = await ask(name, input, context, next, asked);
			} else if (enforced?.ask) {
				result = fail(
					'HUMAN_REQUIRED',
					`'${name}' needs a person's confirmation, which the shell cannot ask for it`,
					'Ask the person to run it themselves'
				);
			} else if (call.confirmation !== undefined) {
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
					...(open.preview ? { preview: open.preview as ConfirmationPreviewV1 } : {}),
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
			// Pending to confirmed only for a run the replay answered from its record, of this row's command and outcome:
			// live, the run itself writes confirmed before the act settles (fifth round, 3; #1656).
			const ran = recordedRuns.get(ended.id);
			const bound =
				ended.state === 'declined' ||
				(ran !== undefined &&
					ran.command === row?.confirmation.command &&
					JSON.stringify(ran.outcome) === JSON.stringify(jsonOf(ended.result)));
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
			// Consume the replay credit once so it never settles again (#1656).
			recordedRuns.delete(ended.id);
			const now = kit.callNow(context);
			const { claim: _claim, ...kept } = row;
			await putBack(
				{
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
				},
				context
			);
			// Counted here, by the act's journaled end, so a replay that answers the run from its record counts it too (B14).
			if (from === 'pending' || ended.state === 'confirmed')
				await observed(context, ended.state, row);
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
		if (person !== undefined) readOrder(context);
		const row =
			person === undefined
				? undefined
				: (await rowsOf(person)).find(
						(each) =>
							each.id === notification &&
							// The copilot's own session's alone (phase 5's 6.2): the one ownership rule.
							ownedBy(each, caller, (context as { trace?: { session?: unknown } }).trace?.session)
					);
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
				await putBack(
					{
						...stored,
						confirmation: { ...stored.confirmation, state: 'withdrawn' },
						...(stored.readAt === undefined ? { readAt: kit.callNow(context) } : {}),
					},
					context
				);
				await observed(context, 'withdrawn', stored);
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
						await putBack({ ...row, readAt: now }, context);
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
					await putBack(marked({ state: 'declined', reason: 'person', answeredAt: now }), context);
					await observed(context, 'declined', row);
					return { done: kit.success({ state: 'declined' as const }) };
				}
				// The re-check (7.2): the same chain as steps 2 and 3, for the actor that asked, in the confirmation's scope.
				const caller = row.ciface === 'palette' || row.ciface === 'apps' ? row.source : undefined;
				if (
					refusedAccess(row.cactor, row.confirmation.command, caller, row.scope) ||
					(caller !== undefined && deps.inputOver(row.confirmation.input ?? {}))
				) {
					await putBack(marked({ state: 'declined', reason: 'access', answeredAt: now }), context);
					await observed(context, 'declined', row);
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
		const caller = row.ciface === 'palette' || row.ciface === 'apps' ? row.source : undefined;
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
					// The copilot's call runs with its trace (phase 5's 6.2), so its nested calls carry it.
					...(row.confirmation.trace !== undefined ? { trace: row.confirmation.trace } : {}),
				}
			);
			approved.delete(row.id);
			// Read on the person's chain: a run the shell recorded is confirmed; one the chain refused first ran nothing.
			const after = await serial(
				person,
				async () =>
					(await store.get<StoredConfirmation>(TABLE, row.id).catch(() => null))?.confirmation
			);
			const confirmed = after?.state === 'confirmed';
			// Shown again, changed since the person looked (phase 5's 7.2): a new confirmation, by the kernel's own record of
			// it, never by the run's result, waits for their answer to what it shows now.
			const fresh = reshownAs.get(row.id);
			reshownAs.delete(row.id);
			if (fresh !== undefined)
				return kit.success({ state: 'pending' as const, changed: true, notification: fresh });
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
			// What a call raised or answered of the inbox (phase 5's 9.2), set by the gate alone and journaled, so the bus
			// projects `confirmation-raised` and `confirmation-answered` from the journal, live and in a replay.
			{ name: 'bus', meta: 'dev.loam/bus', schema: z.unknown(), journal: true },
		] as ContextField[],
		settle: settle as unknown as ZodCommandDefinition,
		commands: [paletteRun, get, withdrawOne] as unknown as ZodCommandDefinition[],
		answer,
		ask,
		recorded(confirmation, command, result) {
			recordedRuns.set(confirmation, { command, outcome: outcomeOf(result) });
		},
		reset() {
			recordedRuns.clear();
		},
		chain: serial,
		async pending(person, match, now) {
			return (await rowsOf(person)).some(
				(row) =>
					stateNow(row.confirmation, now) === 'pending' && row.claim === undefined && match(row)
			);
		},
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
					await putBack(
						{
							...row,
							confirmation: { ...row.confirmation, state: 'withdrawn' },
							...(row.readAt === undefined ? { readAt: now } : {}),
						},
						context
					);
					await observed(context, 'withdrawn', row);
					count++;
				}
				return count;
			});
		},
	};
}
