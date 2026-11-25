/**
 * @fileoverview The `control-*` commands: `@lushly-dev/afd-view-state/controls/commands`.
 *
 * `control-list`, `control-set`, `control-restore` and `control-choices` read and fill the
 * controls an application binds in a {@link ControlRegistry} (the specification's sections 4
 * to 8). Defined with `defineCommandWithSchema` from `@lushly-dev/afd-server/define` on Zod
 * Mini, so this module loads neither the MCP SDK nor any Node.js builtin and runs in the
 * browser next to the form it fills.
 */

import {
	type CommandContext,
	type CommandResult,
	defineCommandWithSchema,
	type ExposeOptions,
	failure,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import type {
	ZodArray,
	ZodBoolean,
	ZodDefault,
	ZodInt,
	ZodNumber,
	ZodObject,
	ZodOptional,
	ZodString,
	ZodUnion,
} from 'zod';
import {
	type BoundControl,
	ControlReadError,
	type ControlRegistry,
	type ControlSnapshot,
	type ControlStore,
	controlStore,
	thrownMessage,
} from './registry.js';
import {
	CHOICES_INPUT_JSON,
	CHOICES_OUTPUT_JSON,
	choicesInput,
	choicesOutput,
	LIST_INPUT_JSON,
	LIST_OUTPUT_JSON,
	listInput,
	listOutput,
	RESTORE_INPUT_JSON,
	RESTORE_OUTPUT_JSON,
	restoreInput,
	restoreOutput,
	SET_INPUT_JSON,
	SET_OUTPUT_JSON,
	setInput,
	setOutput,
} from './schemas.js';
import type { Control, ControlChoice, ControlState, ControlValue } from './types.js';
import {
	type ControlRecovery,
	checkValue,
	copyValue,
	hasChoices,
	holdsValue,
	isEmpty,
	normalizeState,
	sameValue,
	toControl,
	whatItTakes,
} from './values.js';

// ─── Results ─────────────────────────────────────────────────────────────────

/** Data returned by `control-list`. */
export interface ControlListResult {
	screen?: string;
	command?: string;
	controls: Control[];
	/** The controls the call selects, after `group`. */
	total: number;
	/** The selected controls after the last one returned. */
	more: number;
}

/** A control `control-set` wrote. */
export interface ControlChange {
	id: string;
	/** What it holds after the call. */
	value: ControlValue;
	/** What it held before the call. */
	previous: ControlValue;
	/** Its new rev. */
	rev: string;
	/** The error it now shows, when it shows one. */
	error?: string;
}

/** Data returned by `control-set`. */
export interface ControlSetResult {
	changed: ControlChange[];
	/** Ids of the controls that already held the value sent. */
	unchanged: string[];
	/** The controls the call moved without writing them, as `control-list` gives them. */
	affected: Control[];
	/** Ids of the required controls that are still empty. */
	missing: string[];
}

/** A control `control-restore` put back. */
export interface ControlRestored {
	id: string;
	value: ControlValue;
	rev: string;
}

/** Why `control-restore` left a control as it was. */
export type ControlSkipReason =
	| 'not-on-screen'
	| 'secret'
	| 'changed'
	| 'not-editable'
	| 'not-shown';

/** A control `control-restore` left as it was. */
export interface ControlSkip {
	id: string;
	reason: ControlSkipReason;
}

/** Data returned by `control-restore`. */
export interface ControlRestoreResult {
	restored: ControlRestored[];
	skipped: ControlSkip[];
	affected: Control[];
	missing: string[];
}

/** Data returned by `control-choices`. */
export interface ControlChoicesResult {
	id: string;
	choices: ControlChoice[];
	total: number;
	more: number;
}

// ─── Command types ───────────────────────────────────────────────────────────

// Typed as the classic schemas a registry's `ZodCommandDefinition[]` reads, as `ZodCommandDefinition`
// with no type argument does: at run time they are Zod Mini's, so `safeParse` works and `.extend` does not.
type ValueInput = ZodUnion<[ZodString, ZodNumber, ZodBoolean, ZodArray<ZodString>]>;
type ListInput = ZodObject<{
	group: ZodOptional<ZodString>;
	limit: ZodDefault<ZodInt>;
	offset: ZodDefault<ZodInt>;
}>;
type SetInput = ZodObject<{
	values: ZodArray<ZodObject<{ id: ZodString; value: ValueInput; rev: ZodString }>>;
}>;
type RestoreInput = ZodObject<{
	controls: ZodArray<ZodObject<{ id: ZodString; rev: ZodString }>>;
}>;
type ChoicesInput = ZodObject<{
	id: ZodString;
	search: ZodOptional<ZodString>;
	limit: ZodDefault<ZodInt>;
	offset: ZodDefault<ZodInt>;
}>;

/** The `control-list` command. */
export type ControlListCommand = ZodCommandDefinition<ListInput, ControlListResult>;
/** The `control-set` command. */
export type ControlSetCommand = ZodCommandDefinition<SetInput, ControlSetResult>;
/** The `control-restore` command. */
export type ControlRestoreCommand = ZodCommandDefinition<RestoreInput, ControlRestoreResult>;
/** The `control-choices` command. */
export type ControlChoicesCommand = ZodCommandDefinition<ChoicesInput, ControlChoicesResult>;

/**
 * The commands returned by {@link createControlCommands}, in a fixed order, so callers can
 * destructure them with their exact types. It is still an array, so it can be passed or spread
 * wherever a `ZodCommandDefinition[]` is expected.
 */
export type ControlCommands = [
	controlList: ControlListCommand,
	controlSet: ControlSetCommand,
	controlRestore: ControlRestoreCommand,
	controlChoices: ControlChoicesCommand,
];

/** Options for {@link createControlCommands}. */
export interface ControlCommandsOptions {
	/** Merged over each command's default exposure. */
	expose?: ExposeOptions;
}

// ─── Exposure and descriptions (section 8) ───────────────────────────────────

const AGENT_ONLY: ExposeOptions = { agent: true, palette: false, mcp: false, cli: false };
const AGENT_AND_PALETTE: ExposeOptions = { agent: true, palette: true, mcp: false, cli: false };

const DESCRIPTIONS = {
	list: "List the controls on the screen the person is looking at: each one's id, label, kind, value, limits and choices, and the rev to send back when changing it. Read this before control-set.",
	set: "Set the values of controls on the person's screen, all or none. Send each control's id (not its label), a value of its kind (a choice by its value or its label), and the rev control-list or an earlier result gave for it; never invent a rev. If a control changed since you read it, read it again and keep what the person entered unless they ask otherwise. A secret is the person's to type. This fills a draft and does not submit it: run the form's command only when the person asks, with what the screen then shows. An error's details list every refused value.",
	restore:
		"Put back what controls held before a control-set changed them, skipping any the person has changed since. Send the id and rev of each control as control-set's result gave them.",
	choices:
		'Search or page through the choices of one control that offers more than control-list carries.',
} as const;

// ─── Refusals ────────────────────────────────────────────────────────────────

const READ_THE_SCREEN: ControlRecovery = { kind: 'call', command: 'control-list' };
const FIX_VALUES: ControlRecovery = { kind: 'fix-input', needs: ['values'] };

/** One entry of `control-set` refused: the words of section 5.1. */
interface Refusal {
	id: string;
	code: string;
	reason: string;
	suggestion: string;
	recovery: ControlRecovery;
}

/** Check 7's refusal: the control is not as the caller read it. */
function changedSinceRead(id: string): Refusal {
	return {
		id,
		code: 'CONFLICT',
		reason: 'has changed since it was read',
		suggestion:
			'Use control-list to read it again, and keep what the person entered unless they ask otherwise',
		recovery: READ_THE_SCREEN,
	};
}

function notOnScreen(id: string): Refusal {
	return {
		id,
		code: 'NOT_FOUND',
		reason: 'is not on this screen',
		suggestion: 'Use control-list to read the controls on this screen',
		recovery: READ_THE_SCREEN,
	};
}

/**
 * The call's error: the first refused entry's, counting them all and listing them in `details`.
 * A refusal after a write names the controls that could not be put back, as 5.3 step 4 does.
 */
function refuse(
	refusals: Refusal[],
	sent: number,
	notPutBack: string[] = []
): CommandResult<never> {
	const [first] = refusals as [Refusal, ...Refusal[]];
	return failure({
		code: first.code,
		message: `${refusals.length} of ${sent} values refused: ${first.id}: ${first.reason}${putBackClause(notPutBack)}`,
		suggestion: first.suggestion,
		recovery: first.recovery,
		details: { refused: refusals.map(({ id, code, reason }) => ({ id, code, reason })) },
	});
}

/** A `read` threw: section 3. */
function readFailure(error: ControlReadError, notPutBack: string[] = []): CommandResult<never> {
	return failure({
		code: 'INTERNAL_ERROR',
		message: `${error.message}${putBackClause(notPutBack)}`,
		suggestion: 'Tell the person this screen could not be read',
		retryable: false,
		recovery: { kind: 'stop' },
	});
}

/** A `write` threw: section 5.3, step 4. */
function writeFailure(id: string, thrown: unknown, notPutBack: string[]): CommandResult<never> {
	return failure({
		code: 'INTERNAL_ERROR',
		message: `${id} could not be written: ${thrownMessage(thrown)}${putBackClause(notPutBack)}`,
		suggestion:
			notPutBack.length === 0
				? 'Nothing was changed. Use control-list to read the screen'
				: 'Use control-list to read the screen',
		retryable: false,
		recovery: READ_THE_SCREEN,
	});
}

function putBackClause(ids: string[]): string {
	return ids.length === 0 ? '' : `; ${ids.join(', ')} could not be put back`;
}

// ─── Writing ─────────────────────────────────────────────────────────────────

/** A control a call wrote, what it held before the call, and what it held once written. */
interface Written {
	control: BoundControl;
	previous: ControlValue;
	wrote?: ControlValue;
}

/** Write every control back to what it held before the call, in reverse order; the ids that failed. */
function writeBack(written: Written[]): string[] {
	const failed: string[] = [];
	for (const { control, previous } of [...written].reverse()) {
		try {
			control.handler.write(copyValue(previous));
		} catch {
			failed.push(control.id);
		}
	}
	return failed.reverse();
}

/**
 * Undo a call that wrote: write its controls back, then give the registry back what it held
 * before the call, so that a call that changed nothing in the end changes no `rev` and loses
 * nothing remembered. A control that could not be put back differs from that record, and the
 * next observation gives it a new `rev`.
 *
 * @returns The ids that could not be put back.
 */
function undo(store: ControlStore, held: ControlSnapshot, written: Written[]): string[] {
	const failed = writeBack(written);
	store.reinstate(held);
	return failed;
}

/** Whether a control whose `write` threw holds something other than what it held before. */
function movedByFailedWrite(control: BoundControl, previous: ControlValue): boolean {
	try {
		return !sameValue(normalizeState(control.handler.read()).value, previous);
	} catch {
		return true;
	}
}

/** A `read` threw: the failure, after the call is undone when it had written. */
function readFailureOf(thrown: unknown, notPutBack: string[] = []): CommandResult<never> {
	if (!(thrown instanceof ControlReadError)) throw thrown;
	return readFailure(thrown, notPutBack);
}

/**
 * What every mutation answers besides its own lists: `affected` and `missing` (5.3, steps 7
 * and 8). A control is told from another by what it is, not by its id, so one registered again
 * under a written id during the call is `affected`.
 */
function aftermath(
	store: ControlStore,
	before: Map<string, string | undefined>,
	written: Set<BoundControl>
): { affected: Control[]; missing: string[] } {
	const affected: Control[] = [];
	const missing: string[] = [];
	for (const control of store.all()) {
		const state = control.copy as ControlState;
		if (state.secret) continue;
		const rev = control.rev as string;
		if (!written.has(control) && before.get(control.id) !== rev) {
			affected.push(toControl(control.id, rev, state));
		}
		if (state.required && isEmpty(state)) missing.push(control.id);
	}
	return { affected, missing };
}

/** A control the call wrote that is still the one registered under its id, and not a secret. */
function reportable(store: ControlStore, control: BoundControl): boolean {
	return store.get(control.id) === control && !(control.copy as ControlState).secret;
}

const utf8 = new TextEncoder();

/** The UTF-8 bytes of a result as JSON, without `metadata`, as the host measures it. */
function measuredBytes(result: CommandResult<unknown>): number {
	const { metadata: _metadata, ...measured } = result;
	return utf8.encode(JSON.stringify(measured)).length;
}

// ─── The checks of control-set (section 5.1) ─────────────────────────────────

interface EntryCheck {
	/** Check 3: an earlier entry of the call has the id. */
	duplicate?: boolean;
	/** Check 7: the rev sent, compared with the control's own. */
	rev?: string;
}

/** Checks 1, 2, 4, 5, 6 and 8 (and 3 and 7 when asked), stopping at the first that fails. */
function checkEntry(
	id: string,
	control: BoundControl | undefined,
	value: ControlValue,
	checks: EntryCheck
): Refusal | { value: ControlValue } {
	if (control === undefined) return notOnScreen(id);
	const state = control.copy as ControlState;
	const { label } = state;
	if (state.secret) {
		return {
			id,
			code: 'FORBIDDEN',
			reason: `${label} is a secret`,
			suggestion: 'Ask the person to enter it themselves',
			recovery: { kind: 'external' },
		};
	}
	if (checks.duplicate) {
		return {
			id,
			code: 'VALIDATION_ERROR',
			reason: 'is sent more than once',
			suggestion: 'Send each control once',
			recovery: FIX_VALUES,
		};
	}
	if (state.disabled) {
		return {
			id,
			code: 'CONFLICT',
			reason: `${label} is disabled`,
			suggestion: `${label} is disabled, so the person cannot change it either`,
			recovery: { kind: 'stop' },
		};
	}
	if (state.readOnly) {
		return {
			id,
			code: 'CONFLICT',
			reason: `${label} is read-only`,
			suggestion: `${label} is read-only, so the person cannot change it either`,
			recovery: { kind: 'stop' },
		};
	}
	if (state.hidden) {
		return {
			id,
			code: 'CONFLICT',
			reason: `${label} is not shown`,
			suggestion: `${label} is not shown to the person. Ask them to open that part of the screen`,
			recovery: { kind: 'external' },
		};
	}
	if (checks.rev !== undefined && checks.rev !== control.rev) return changedSinceRead(id);
	const checked = checkValue(id, state, value);
	if (!checked.ok) {
		return {
			id,
			code: 'VALIDATION_ERROR',
			reason: checked.reason,
			suggestion: checked.suggestion,
			recovery: checked.recovery,
		};
	}
	return { value: checked.value };
}

function isRefusal(checked: Refusal | { value: ControlValue }): checked is Refusal {
	return 'code' in checked;
}

// ─── The factory ─────────────────────────────────────────────────────────────

/**
 * Creates the four `control-*` commands for a registry, in a fixed order:
 *
 * - `control-list` — list the controls on the screen, each with its `rev`
 * - `control-set` — set several controls at once, all or none
 * - `control-restore` — put back what a `control-set` replaced
 * - `control-choices` — search the choices of a control that has many
 *
 * By default they go to the in-app agent only, and `control-restore` to the command palette
 * as well; `expose` is merged over that.
 *
 * @example
 * ```ts
 * import { ControlRegistry } from '@lushly-dev/afd-view-state/controls';
 * import { createControlCommands } from '@lushly-dev/afd-view-state/controls/commands';
 *
 * const registry = new ControlRegistry();
 * const [controlList, controlSet, controlRestore, controlChoices] = createControlCommands(registry);
 * ```
 */
export function createControlCommands(
	registry: ControlRegistry,
	options: ControlCommandsOptions = {}
): ControlCommands {
	const store = controlStore(registry);
	const expose = (defaults: ExposeOptions): ExposeOptions => ({ ...defaults, ...options.expose });

	const controlList = defineCommandWithSchema<typeof listInput, ControlListResult>({
		name: 'control-list',
		description: DESCRIPTIONS.list,
		category: 'control',
		mutation: false,
		executionTime: 'instant',
		expose: expose(AGENT_ONLY),
		errors: ['NOT_FOUND', 'INTERNAL_ERROR'],
		outputBudget: { defaultBytes: 16384, maxBytes: 65536 },
		input: listInput,
		jsonSchema: LIST_INPUT_JSON,
		output: listOutput,
		outputJsonSchema: LIST_OUTPUT_JSON,
		examples: [
			{ title: 'Read the screen', input: {} },
			{ title: 'Read one part of the screen', input: { group: 'Payment' } },
			{ title: 'Read the next page', input: { offset: 50 } },
		],

		async handler(input, context) {
			try {
				store.observeAll(true);
			} catch (thrown) {
				return readFailureOf(thrown);
			}
			const { name: screen, command } = store.screen;
			const head = {
				...(screen !== undefined ? { screen } : {}),
				...(command !== undefined ? { command } : {}),
			};
			const all = store.all();
			if (all.length === 0) {
				return success(
					{ ...head, controls: [], total: 0, more: 0 },
					{ reasoning: 'The application has bound no controls on this screen.', confidence: 1 }
				);
			}
			const { group } = input;
			const selected =
				group === undefined ? all : all.filter((control) => control.copy?.group === group);
			if (group !== undefined && selected.length === 0) {
				return failure({
					code: 'NOT_FOUND',
					message: `No group "${group}" on this screen`,
					suggestion: 'Use control-list with no group to see every control and its group',
					recovery: READ_THE_SCREEN,
				});
			}

			const total = selected.length;
			const window = selected.slice(input.offset, input.offset + input.limit);
			const build = (controls: Control[]) =>
				success<ControlListResult>(
					{
						...head,
						controls,
						total,
						more: Math.max(0, total - input.offset - controls.length),
					},
					{
						reasoning: `Listed ${controls.length} of the ${total} controls${
							group === undefined ? ' on this screen' : ` in ${group}`
						}`,
						confidence: 1,
					}
				);
			const page: Control[] = [];
			let result = build(page);
			for (const control of window) {
				const next = [
					...page,
					toControl(control.id, control.rev as string, control.copy as ControlState),
				];
				const candidate = build(next);
				const budget = context.outputBudget;
				if (page.length > 0 && budget !== undefined && measuredBytes(candidate) > budget) break;
				page.push(next[next.length - 1] as Control);
				result = candidate;
			}
			return result;
		},
	});

	const controlSet = defineCommandWithSchema<typeof setInput, ControlSetResult>({
		name: 'control-set',
		description: DESCRIPTIONS.set,
		category: 'control',
		mutation: true,
		approval: 'not-required',
		undoable: true,
		requires: ['control-list'],
		executionTime: 'instant',
		expose: expose(AGENT_ONLY),
		errors: ['NOT_FOUND', 'FORBIDDEN', 'CONFLICT', 'VALIDATION_ERROR', 'INTERNAL_ERROR'],
		input: setInput,
		jsonSchema: SET_INPUT_JSON,
		output: setOutput,
		outputJsonSchema: SET_OUTPUT_JSON,
		examples: [
			{
				title: 'Fill two controls',
				input: {
					values: [
						{ id: 'attendee-name', value: 'Ada Okafor', rev: '<the rev control-list gave>' },
						{ id: 'session', value: 'Afternoon', rev: '<the rev control-list gave>' },
					],
				},
			},
		],

		async handler(input, context: CommandContext) {
			if (context.actor?.kind === 'human') {
				return failure({
					code: 'FORBIDDEN',
					message: "control-set is an agent's command",
					suggestion:
						"Create the client with actor { kind: 'agent' }; a person changes the controls themselves",
					recovery: { kind: 'external' },
				});
			}
			const sent = input.values.length;
			try {
				store.observeAll(true);
			} catch (thrown) {
				return readFailureOf(thrown);
			}
			const before = store.revs();
			const held = store.snapshot();

			// Section 5.1: every entry is checked before any is written.
			const refusals: Refusal[] = [];
			const planned: Array<{
				id: string;
				rev: string;
				raw: ControlValue;
				value: ControlValue;
				control: BoundControl;
				previous: ControlValue;
			}> = [];
			const seen = new Set<string>();
			for (const entry of input.values) {
				const control = store.get(entry.id);
				const checked = checkEntry(entry.id, control, entry.value, {
					duplicate: seen.has(entry.id),
					rev: entry.rev,
				});
				seen.add(entry.id);
				if (isRefusal(checked)) {
					refusals.push(checked);
				} else {
					const bound = control as BoundControl;
					planned.push({
						id: entry.id,
						rev: entry.rev,
						raw: entry.value,
						value: checked.value,
						control: bound,
						previous: copyValue((bound.copy as ControlState).value),
					});
				}
			}
			if (refusals.length > 0) return refuse(refusals, sent);

			// Section 5.3: written in the order sent; an entry an earlier one moved is checked again.
			const written: Written[] = [];
			const unchanged: string[] = [];
			for (const entry of planned) {
				let { value, control, previous } = entry;
				if (written.length > 0) {
					const now = store.get(entry.id);
					try {
						if (now !== undefined) store.observe(now);
					} catch (thrown) {
						return readFailureOf(thrown, undo(store, held, written));
					}
					if (now === undefined || now !== control || now.rev !== before.get(entry.id)) {
						// Moved by an earlier write, bound again by one, or gone: what the caller sent is
						// checked again, as it was sent, against the control now under its id.
						const checked = checkEntry(entry.id, now, entry.raw, {});
						const stateRefused = isRefusal(checked) && checked.code !== 'VALIDATION_ERROR';
						if (stateRefused) return refuse([checked], sent, undo(store, held, written));
						// Check 7, in its place before the value: if the control now holds another value
						// than the caller read, or is another control, a write would replace what the
						// caller never saw, which may be what the person typed. A control that already
						// holds what was sent is left as it is.
						const state = (now as BoundControl).copy as ControlState;
						const unseen = now !== control || !holdsValue(state, previous);
						const holds = !isRefusal(checked) && holdsValue(state, checked.value);
						if (unseen && !holds) {
							return refuse([changedSinceRead(entry.id)], sent, undo(store, held, written));
						}
						if (isRefusal(checked)) return refuse([checked], sent, undo(store, held, written));
						value = checked.value;
						if (now !== undefined && now !== control) {
							control = now;
							previous = copyValue(state.value);
						}
					}
				}
				if (holdsValue(control.copy as ControlState, value)) {
					unchanged.push(entry.id);
					continue;
				}
				try {
					control.handler.write(copyValue(value));
				} catch (thrown) {
					// The write that threw is put back too, when it left the control changed.
					const toUndo = movedByFailedWrite(control, previous)
						? [...written, { control, previous }]
						: written;
					return writeFailure(entry.id, thrown, undo(store, held, toUndo));
				}
				written.push({ control, previous });
				try {
					// What the control holds once written, which a restore asks it still holds.
					const wrote = copyValue(store.observe(control).value);
					(written[written.length - 1] as Written).wrote = wrote;
				} catch (thrown) {
					return readFailureOf(thrown, undo(store, held, written));
				}
			}

			try {
				store.observeAll();
			} catch (thrown) {
				return readFailureOf(thrown, undo(store, held, written));
			}
			const changed: ControlChange[] = [];
			for (const { control, previous, wrote } of written) {
				// One that left the screen, or became a secret, during the call is listed nowhere.
				control.remembered = undefined;
				if (!reportable(store, control)) continue;
				const state = control.copy as ControlState;
				const rev = control.rev as string;
				control.remembered = {
					value: copyValue(previous),
					written: copyValue(wrote as ControlValue),
					left: copyValue(state.value),
					rev,
				};
				changed.push({
					id: control.id,
					value: copyValue(state.value),
					previous: copyValue(previous),
					rev,
					...(state.error !== undefined ? { error: state.error } : {}),
				});
			}
			store.settle();
			const data: ControlSetResult = {
				changed,
				unchanged,
				...aftermath(store, before, new Set(written.map(({ control }) => control))),
			};
			const reasoning =
				changed.length === 0
					? 'Every control sent already held its value'
					: `Set ${changed.length} of ${sent} controls${
							unchanged.length > 0 ? `; ${unchanged.length} already held the value sent` : ''
						}`;
			if (changed.length === 0) return success(data, { reasoning, confidence: 1 });
			return success(data, {
				reasoning,
				confidence: 1,
				undoCommand: 'control-restore',
				// Backwards, so that an undo takes the writes back in the reverse of their order.
				undoArgs: { controls: [...changed].reverse().map(({ id, rev }) => ({ id, rev })) },
			});
		},
	});

	const controlRestore = defineCommandWithSchema<typeof restoreInput, ControlRestoreResult>({
		name: 'control-restore',
		description: DESCRIPTIONS.restore,
		category: 'control',
		mutation: true,
		approval: 'not-required',
		executionTime: 'instant',
		expose: expose(AGENT_AND_PALETTE),
		errors: ['INTERNAL_ERROR'],
		input: restoreInput,
		jsonSchema: RESTORE_INPUT_JSON,
		output: restoreOutput,
		outputJsonSchema: RESTORE_OUTPUT_JSON,
		examples: [
			{
				title: "Take back a fill, with control-set's undoArgs",
				input: { controls: [{ id: 'attendee-name', rev: '<the rev control-set gave>' }] },
			},
		],

		async handler(input) {
			try {
				store.observeAll(true);
			} catch (thrown) {
				return readFailureOf(thrown);
			}
			const before = store.revs();
			const held = store.snapshot();

			// Section 6: each entry is checked at its turn, against the screen as it then is.
			const skipped: ControlSkip[] = [];
			const written: Written[] = [];
			const seen = new Set<string>();
			for (const entry of input.controls) {
				const control = store.get(entry.id);
				try {
					if (control !== undefined && written.length > 0) store.observe(control);
				} catch (thrown) {
					return readFailureOf(thrown, undo(store, held, written));
				}
				const reason = skipReason(control, entry.rev, seen.has(entry.id));
				seen.add(entry.id);
				if (reason !== undefined) {
					skipped.push({ id: entry.id, reason });
					continue;
				}
				const bound = control as BoundControl;
				const previous = copyValue((bound.copy as ControlState).value);
				const { value } = bound.remembered as { value: ControlValue };
				try {
					bound.handler.write(copyValue(value));
				} catch (thrown) {
					const toUndo = movedByFailedWrite(bound, previous)
						? [...written, { control: bound, previous }]
						: written;
					return writeFailure(bound.id, thrown, undo(store, held, toUndo));
				}
				written.push({ control: bound, previous });
			}

			try {
				store.observeAll();
			} catch (thrown) {
				return readFailureOf(thrown, undo(store, held, written));
			}
			store.settle();
			const restored: ControlRestored[] = [];
			for (const { control } of written) {
				control.remembered = undefined;
				// One that left the screen, or became a secret, during the call is listed nowhere.
				if (!reportable(store, control)) continue;
				restored.push({
					id: control.id,
					value: copyValue((control.copy as ControlState).value),
					rev: control.rev as string,
				});
			}
			return success(
				{
					restored,
					skipped,
					...aftermath(store, before, new Set(written.map(({ control }) => control))),
				},
				{
					reasoning:
						restored.length === 0
							? 'Nothing was put back'
							: `Put back ${restored.length} of ${input.controls.length} controls`,
					confidence: 1,
				}
			);
		},
	});

	const controlChoices = defineCommandWithSchema<typeof choicesInput, ControlChoicesResult>({
		name: 'control-choices',
		description: DESCRIPTIONS.choices,
		category: 'control',
		mutation: false,
		requires: ['control-list'],
		executionTime: 'instant',
		expose: expose(AGENT_ONLY),
		errors: ['NOT_FOUND', 'VALIDATION_ERROR', 'INTERNAL_ERROR'],
		input: choicesInput,
		jsonSchema: CHOICES_INPUT_JSON,
		output: choicesOutput,
		outputJsonSchema: CHOICES_OUTPUT_JSON,
		examples: [
			{ title: 'Search the choices', input: { id: 'country', search: 'nor' } },
			{ title: 'Read the next page of choices', input: { id: 'country', offset: 20 } },
		],

		async handler(input, context) {
			const control = store.get(input.id);
			if (control === undefined) {
				const refusal = notOnScreen(input.id);
				return failure({
					code: refusal.code,
					message: `${input.id} ${refusal.reason}`,
					suggestion: refusal.suggestion,
					recovery: refusal.recovery,
				});
			}
			let state: ControlState;
			try {
				state = store.observe(control, true);
			} catch (thrown) {
				return readFailureOf(thrown);
			}
			if (!hasChoices(state.kind)) {
				const settable = context.actor?.kind !== 'human' && !state.secret;
				return failure({
					code: 'VALIDATION_ERROR',
					message: `${input.id} has no choices: it takes ${whatItTakes(state.kind)}`,
					suggestion: settable
						? 'Use control-set to give it a value'
						: 'It has no choices to search',
					recovery: settable
						? { kind: 'call', command: 'control-set', needs: ['values'] }
						: { kind: 'stop' },
				});
			}
			const { search } = input;
			const all = state.choices ?? [];
			const folded = search?.toLowerCase();
			const matching =
				folded === undefined
					? all
					: all.filter((choice) => choice.label.toLowerCase().includes(folded));
			const choices = matching
				.slice(input.offset, input.offset + input.limit)
				.map((choice) => ({ ...choice }));
			const total = matching.length;
			return success(
				{
					id: input.id,
					choices,
					total,
					more: Math.max(0, total - input.offset - choices.length),
				},
				{
					reasoning: `${total} of the ${all.length} choices of ${input.id}${
						search === undefined ? '' : ` match "${search}"`
					}`,
					confidence: 1,
				}
			);
		},
	});

	return [controlList, controlSet, controlRestore, controlChoices] as unknown as ControlCommands;
}

/** The first reason of section 6 that holds for an entry of `control-restore`, in their order. */
function skipReason(
	control: BoundControl | undefined,
	rev: string,
	duplicate: boolean
): ControlSkipReason | undefined {
	if (control === undefined) return 'not-on-screen';
	const state = control.copy as ControlState;
	if (state.secret) return 'secret';
	const { remembered } = control;
	if (remembered === undefined || remembered.rev !== rev || duplicate) return 'changed';
	// Put back only what still holds what that write gave it: anything else is not the fill's.
	if (!holdsValue(state, remembered.written)) return 'changed';
	if (state.disabled || state.readOnly) return 'not-editable';
	if (state.hidden) return 'not-shown';
	return undefined;
}
