/**
 * @fileoverview `palette-run` (phase 4 specification, 7.1): the palette's input prompt, opened for a command's plain fields
 * and filled once, its run a top-level call journaled with its `origin`; a `confirm_prompt` command's confirmation
 * replaces the prompt in the slot (R15). Apart from `confirmations.ts`, whose gate and replay it shares: the prompts a fill
 * has taken, and a replay's runs by the call that made them.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema } from '@lushly-dev/afd-server/define';
import type { PromptInputV1 } from '@lushly-dev/loam-sdk';
import type { ScopeV1 } from '../scope/records.js';
import { type Fail, promptSchemaOf, REPLACES } from './confirmation-parts.js';
import type { ConfirmationDeps } from './confirmations.js';

/** Phase 5's suggestion records (its 6.1), as "Run it" reads and runs them: a person's own, live, once. */
export interface SuggestionReader {
	suggestion(
		id: string,
		person: string,
		now: number
	): Promise<
		| {
				id: string;
				command: string;
				input: unknown;
				scope: ScopeV1;
				person: string;
				createdAt: number;
		  }
		| undefined
	>;
	ran(record: never, now: number, person: string): Promise<boolean>;
}

export interface PaletteRunShared {
	fail: Fail;
	scopeOf(context: CommandContext): ScopeV1;
	/** The input prompts a fill has taken, so a second fill of the same prompt finds none (blocker 7). */
	consumed: Set<string>;
	/** A replay's runs by the trace that made them (`origin`), so that call answers from it and runs nothing again. */
	ran: Map<string, CommandResult>;
}

export function createPaletteRun(deps: ConfirmationDeps, shared: PaletteRunShared) {
	const { kit, overlays } = deps;
	const { z } = kit;
	const { fail, scopeOf, consumed, ran } = shared;

	const runInput = z.strictObject({
		command: z.string().check(z.minLength(1), z.maxLength(128)),
		prompt: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
		input: z.optional(z.unknown()),
		suggestion: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
	});
	/** The input prompts opened for a suggestion (phase 5's 6.1), by overlay: their fill runs the record, once. */
	const suggested = new Map<string, Awaited<ReturnType<SuggestionReader['suggestion']>> & {}>();
	/** The prompts of suggestions spent or expired (the re-checks' B1, I2): no later fill of one runs anything. */
	const dead = new Set<string>();

	const notOpen = (prompt: string) =>
		fail(
			'OVERLAY_NOT_FOUND',
			`No input prompt '${prompt}' is open for this command`,
			'Open it again with palette-run { command }'
		);

	return kit.define<typeof runInput, unknown>({
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
				suggestion: { type: 'string', minLength: 1, maxLength: 64 },
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
				// A replayed fill of a suggestion's prompt spends it as the live one did (the review's B14).
				const spent = input.prompt === undefined ? undefined : suggested.get(input.prompt);
				if (spent && input.prompt !== undefined) {
					suggested.delete(input.prompt);
					dead.add(input.prompt);
					await deps.suggestions?.ran(spent as never, kit.callNow(context), spent.person);
				}
				const { 'dev.loam/seq': _seq, ...metadata } = (replayed.metadata ?? {}) as Record<
					string,
					unknown
				>;
				return { ...replayed, metadata } as CommandResult;
			}
			const listed = deps.paletteCommand(input.command);
			const definition = listed?.definition;
			if (input.suggestion !== undefined && input.prompt !== undefined) {
				return fail(
					'VALIDATION_ERROR',
					'suggestion opens a prompt; its fill names only the prompt',
					'Fill the prompt with palette-run { command, prompt }'
				);
			}
			// "Run it" (phase 5's 6.1): the prompt is filled from the kernel's suggestion record, never the runtime's events.
			let record: Awaited<ReturnType<SuggestionReader['suggestion']>>;
			if (input.suggestion !== undefined) {
				const person =
					kit.personKey(context.actor as never) ?? (deps.provider ? undefined : 'local');
				record =
					person === undefined
						? undefined
						: await deps.suggestions?.suggestion(input.suggestion, person, kit.callNow(context));
				if (
					!record ||
					record.command !== input.command ||
					!deps.allows(context.actor as never, record.scope)
				) {
					return fail(
						'NOTIFICATION_NOT_FOUND',
						`No live suggestion '${input.suggestion}' of yours for '${input.command}'`,
						'A suggestion runs once, within 10 minutes; ask the copilot again'
					);
				}
			}
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
				if (record) {
					// The input shown whole (the review's B11): with plain fields, they start from it and the person may change
					// them; with none, the prompt asks nothing and runs it as shown. One too long to show whole is not offered.
					const shownInput = JSON.stringify(record.input ?? {}, null, 2) ?? '{}';
					const body = schema
						? `The copilot suggested this, and ran nothing. It starts from:\n${shownInput}`
						: `The copilot suggested this, and ran nothing. It runs with:\n${shownInput}`;
					if (body.length > 1000) {
						return fail(
							'VALIDATION_ERROR',
							`The suggested input for '${input.command}' is too long to show whole, so it is not run from here`,
							'Run it from its app, where its input can be read in full'
						);
					}
					const prompt = overlays.open(
						{ kind: 'shell', id: 'shell' },
						'prompt',
						{
							title: `Run ${(definition.title ?? definition.name).slice(0, 70)}?`,
							body,
							// No fields at all for a fixed input, so the person's Run submits nothing but the prompt (B10).
							...(schema
								? { schema, value: structuredClone(record.input ?? {}) }
								: { schema: { type: 'object', properties: {} } }),
							confirmLabel: 'Run',
						} as PromptInputV1,
						{ for: { command: definition.name, kind: 'input', scope: record.scope } }
					);
					suggested.set(prompt.overlayId, {
						...record,
						...(schema ? {} : { fixed: true }),
					} as never);
					// One slot holds one prompt: an earlier suggestion's prompt the person closed is forgotten.
					for (const held of [...suggested.keys()]) if (!overlays.get(held)) suggested.delete(held);
					return kit.success({ prompt });
				}
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
					// The scope it opened in, which its fill runs in whatever is active then (blocker 10).
					{ for: { command: definition.name, kind: 'input', scope: scopeOf(context) } }
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
				consumed.has(input.prompt) ||
				dead.has(input.prompt) ||
				!definition
			) {
				return notOpen(input.prompt);
			}
			// A suggestion's prompt with no fields runs the record's input as shown, and nothing else (phase 5's 6.1).
			const from = suggested.get(input.prompt) as
				| (NonNullable<typeof record> & { fixed?: true })
				| undefined;
			if (from?.fixed && input.input !== undefined && JSON.stringify(input.input) !== '{}') {
				return fail(
					'VALIDATION_ERROR',
					'This prompt runs the suggestion as shown',
					'Confirm it without input, or ask the copilot for another'
				);
			}
			const runs = from?.fixed ? from.input : input.input;
			// The command's own schema; on a failure the prompt stays open and shows why (7.1).
			const fault = deps.inputFault(definition, runs ?? {});
			if (fault !== undefined) {
				return fail(
					'VALIDATION_ERROR',
					`The input does not fit '${input.command}': ${fault}`,
					'Correct the input in the prompt, then run it again',
					{ details: { overlay: input.prompt } }
				);
			}
			// Taken at once, with no await since the check (blocker 7): a second fill finds no prompt open. Released when the
			// fill ends, so a prompt a refusal left open can be filled again.
			const promptId = input.prompt;
			consumed.add(promptId);
			// A target the journal does not record leaves no entry to replay: this call's own outcome is replayed instead,
			// answered from its record (blocker 11).
			if (
				!deps.journaled(input.command, {
					interface: 'palette',
					actor: context.actor,
					caller: (context as { caller?: unknown }).caller,
				})
			)
				(context as { replay?: string }).replay = 'recorded';
			const fields: Record<string | symbol, unknown> = {
				origin: traceId,
				...(context.actor !== undefined ? { actor: context.actor } : {}),
				// The scope the prompt opened in, whatever is active now (blocker 10).
				scope: asked.scope ?? scopeOf(context),
			};
			let result: CommandResult;
			try {
				// Run once (6.1): marked before it runs, so a second fill of another prompt for it runs nothing.
				if (from) {
					suggested.delete(promptId);
					// Dead from here, spent or not: a refused fill leaves the prompt open, and its next fill runs nothing.
					dead.add(promptId);
					const filler = kit.personKey(context.actor as never) ?? (deps.provider ? '' : 'local');
					if (!(await deps.suggestions?.ran(from as never, kit.callNow(context), filler))) {
						return fail(
							'NOTIFICATION_NOT_FOUND',
							'This suggestion has already run, or is no longer offered',
							'Ask the copilot again'
						);
					}
				}
				if (deps.askedFor(input.command)) {
					// Its confirmation replaces the input prompt in the slot, showing the input (R15); this call waits on it.
					fields[REPLACES] = promptId;
					deps.releaseQueue(context);
				} else {
					// The prompt is answered, journaled before the run, so a replay closes it before the run as this did.
					const closed = await deps.runBoot('prompt-settle', { close: promptId, reason: 'user' });
					if (!closed.success) return closed;
				}
				result = await deps.runNow('palette', input.command, runs ?? {}, fields);
			} finally {
				consumed.delete(promptId);
			}
			// The run's own journal sequence is its entry's, never this call's: a replay answers without it.
			const { 'dev.loam/seq': _seq, ...metadata } = (result.metadata ?? {}) as Record<
				string,
				unknown
			>;
			return { ...result, metadata } as CommandResult;
		},
	});
}
