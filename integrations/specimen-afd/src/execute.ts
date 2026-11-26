/** Schema-validated command execution and output-budget enforcement for Specimen AFD commands. */
import {
	type Actor,
	AFD_OUTPUT_BUDGET_META_KEY,
	type CommandResult,
	failure,
	type OutputBudget,
	type Warning,
} from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server';
import type { z } from 'zod';
import {
	HUMAN_CONFIRMED,
	normalizeOptionalId,
	SERVER_CHANGE_AUTHOR,
	type SpecimenCommandContext,
} from './relay.js';

/** Execution provenance passed into `executeSpecimenCommand`. */
export interface ExecuteSpecimenCommandOptions {
	/** Invoking AFD actor (defaults to `{ kind: 'script' }` when omitted, e.g. CLI). */
	actor?: Actor;
	/**
	 * Set to `true` only by an MCP host or interactive CLI/review-page after a person confirmed.
	 * Never derived from `actor.kind`.
	 */
	humanConfirmed?: boolean;
	/** Optional host-verified identifier for the confirming person. */
	confirmedBy?: string;
	/** Channel through which the person confirmed (`'mcp-relay' | 'cli' | 'review-page'`). */
	channel?: 'review-page' | 'cli' | 'mcp-relay';
	/** Server-derived change author for in-process `AUTHOR_CANNOT_DECIDE` enforcement. */
	changeAuthor?: string;
	/** Optional caller output budget ask (`{ maxBytes }` or byte count) forwarded from `_meta["dev.afd/outputBudget"]`. */
	outputBudget?: unknown;
}

const utf8Encoder = new TextEncoder();

function parseOutputBudgetAsk(raw: unknown): number | undefined {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
	const keys = Object.keys(raw);
	if (keys.length !== 1 || keys[0] !== 'maxBytes') return undefined;
	const maxBytes = (raw as { maxBytes?: unknown }).maxBytes;
	if (typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
		return undefined;
	}
	return maxBytes;
}

function effectiveOutputBudget(budget: OutputBudget, askBytes: number | undefined): number {
	if (askBytes === undefined) return budget.defaultBytes;
	return Math.min(askBytes, budget.maxBytes);
}

function measureBudgetBytes(res: CommandResult<unknown>): number | undefined {
	try {
		const withoutMetadata: Record<string, unknown> = Object.create(null);
		const record = res as unknown as Record<string, unknown>;
		for (const key of Object.keys(record)) {
			if (key !== 'metadata') withoutMetadata[key] = record[key];
		}
		const json = JSON.stringify(withoutMetadata);
		return json === undefined ? undefined : utf8Encoder.encode(json).length;
	} catch {
		return undefined;
	}
}

export async function executeValidatedCommand<TInput extends z.ZodType, TOutput>(
	command: ZodCommandDefinition<TInput, TOutput>,
	input: unknown,
	options?: ExecuteSpecimenCommandOptions
): Promise<CommandResult<TOutput>> {
	const parsed = command.inputSchema.safeParse(input);
	if (!parsed.success)
		return failure({
			code: 'VALIDATION_ERROR',
			message: parsed.error.message,
			suggestion: `Provide input matching the ${command.name} schema.`,
		});
	let askBytes: number | undefined;
	if (options?.outputBudget !== undefined && options.outputBudget !== null) {
		const rawAsk =
			typeof options.outputBudget === 'number'
				? { maxBytes: options.outputBudget }
				: options.outputBudget;
		askBytes = parseOutputBudgetAsk(rawAsk);
		if (askBytes === undefined) {
			return failure({
				code: 'VALIDATION_ERROR',
				message: `Invalid output budget in _meta["${AFD_OUTPUT_BUDGET_META_KEY}"]`,
				suggestion: `Pass _meta["${AFD_OUTPUT_BUDGET_META_KEY}"] = { "maxBytes": N } with a positive integer.`,
			});
		}
	}
	const limitBytes = command.outputBudget
		? effectiveOutputBudget(command.outputBudget, askBytes)
		: undefined;
	const confirmedBy = normalizeOptionalId(options?.confirmedBy);
	const changeAuthor = normalizeOptionalId(options?.changeAuthor);
	const requiresConfirmation =
		Boolean(command.confirmPrompt) || command.confirmationMode === 'host-verified';
	const context: SpecimenCommandContext = {
		actor: options?.actor ?? { kind: 'script' },
		...(limitBytes !== undefined ? { outputBudget: limitBytes } : {}),
		...(options?.humanConfirmed === true && requiresConfirmation
			? {
					[HUMAN_CONFIRMED]: {
						...(confirmedBy ? { confirmedBy } : {}),
						...(options.channel ? { channel: options.channel } : {}),
					},
				}
			: {}),
		...(changeAuthor ? { [SERVER_CHANGE_AUTHOR]: changeAuthor } : {}),
	};
	const outcome = await command.handler(parsed.data, context);
	if (!command.outputBudget || limitBytes === undefined || outcome.success !== true) {
		return outcome;
	}
	const usedBytes = measureBudgetBytes(outcome);
	if (usedBytes === undefined) return outcome;
	if (usedBytes > limitBytes && command.mutation !== true) {
		const { maxBytes } = command.outputBudget;
		const suggestion =
			limitBytes < maxBytes
				? `Narrow the request or ask for up to ${maxBytes} bytes with _meta["${AFD_OUTPUT_BUDGET_META_KEY}"] = { "maxBytes": ${maxBytes} }.`
				: `Narrow the request; ${maxBytes} bytes is this command's largest output budget.`;
		return failure({
			code: 'OUTPUT_BUDGET_EXCEEDED',
			message: `The result is ${usedBytes} bytes, over this call's output budget of ${limitBytes} bytes`,
			suggestion,
			retryable: false,
			details: { limitBytes, actualBytes: usedBytes, maxBytes },
		});
	}
	const report = { limitBytes, usedBytes };
	if (usedBytes > limitBytes) {
		const warning: Warning = {
			code: 'OUTPUT_BUDGET_EXCEEDED',
			message: `The result is ${usedBytes} bytes, over this call's output budget of ${limitBytes} bytes; the change was made`,
			severity: 'caution',
			details: { limitBytes, actualBytes: usedBytes },
		};
		return {
			...outcome,
			warnings: [...(outcome.warnings ?? []), warning],
			metadata: {
				...outcome.metadata,
				[AFD_OUTPUT_BUDGET_META_KEY]: report,
			},
		};
	}
	return {
		...outcome,
		metadata: {
			...outcome.metadata,
			[AFD_OUTPUT_BUDGET_META_KEY]: report,
		},
	};
}
