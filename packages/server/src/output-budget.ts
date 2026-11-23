/**
 * @fileoverview Server-side per-command output budgets (`spec/output-budgets.md`, B2 to B8):
 * per-call ask binding, validation, effective budget calculation, canonical-JSON measurement,
 * and the post-handler check (replacement for reads, caution warning for mutations, report in
 * `metadata["dev.afd/outputBudget"]`).
 *
 * Browser-safe: imports no Node.js built-ins, no MCP SDK and no Zod.
 */

import type { CommandContext, CommandResult, OutputBudget, Warning } from '@lushly-dev/afd-core';
import { AFD_OUTPUT_BUDGET_META_KEY, failure, MAX_OUTPUT_BUDGET_BYTES } from '@lushly-dev/afd-core';

/**
 * Private context carrier for an output budget ask arriving from `_meta["dev.afd/outputBudget"]`,
 * a meta-tool's `meta` argument, an in-process call option (`DirectExecuteOptions.outputBudget`),
 * or `replayJournal()`. Registered with `Symbol.for` so separately loaded copies of `afd-server`
 * agree on replay, matching `JOURNAL_REPLAY`.
 */
export const OUTPUT_BUDGET_ASK: unique symbol = Symbol.for(
	'@lushly-dev/afd-server/output-budget-ask'
);

/**
 * Module-internal context marker set by buffered `executeStream()` so B5 is skipped on streamed
 * commands (`spec/output-budgets.md`, B7: "A streamed command's chunks are not checked in this
 * version; B5 applies to a command executed without streaming").
 */
export const SKIP_OUTPUT_BUDGET: unique symbol = Symbol('afd.skipOutputBudget');

/**
 * Module-internal immutable carrier of the effective output budget captured by the execution
 * engine before middleware runs, so the journal records the exact limit B5 enforced even if
 * middleware mutates `context.outputBudget` (B8).
 */
export const EFFECTIVE_OUTPUT_BUDGET: unique symbol = Symbol('afd.effectiveOutputBudget');

const utf8 = new TextEncoder();

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/** Bind a raw output budget ask onto a copy of `context`. */
export function bindOutputBudgetAsk(context: CommandContext, ask: unknown): CommandContext {
	return { ...context, [OUTPUT_BUDGET_ASK]: ask };
}

/**
 * Bind `_meta["dev.afd/outputBudget"]` onto `context` unless trusted host code (`createContext`)
 * already set `outputBudget`.
 */
export function withMetaOutputBudget(
	context: CommandContext,
	meta: unknown,
	trusted: Record<string, unknown> = {}
): CommandContext {
	if (Object.hasOwn(trusted, 'outputBudget') && trusted.outputBudget !== undefined) {
		return context;
	}
	if (!isPlainObject(meta) || !Object.hasOwn(meta, AFD_OUTPUT_BUDGET_META_KEY)) {
		return context;
	}
	const ask = meta[AFD_OUTPUT_BUDGET_META_KEY];
	return ask === undefined ? context : bindOutputBudgetAsk(context, ask);
}

/**
 * Parse an ask in its `_meta` form: `{ "maxBytes": n }` where `n` is a safe integer in
 * `1..=9007199254740991` and no other member is present. Returns `undefined` for anything else.
 */
export function parseOutputBudgetAsk(value: unknown): number | undefined {
	if (!isPlainObject(value)) return undefined;
	const keys = Object.keys(value);
	if (keys.length !== 1 || keys[0] !== 'maxBytes') return undefined;
	const maxBytes = value.maxBytes;
	if (
		typeof maxBytes !== 'number' ||
		!Number.isSafeInteger(maxBytes) ||
		maxBytes < 1 ||
		maxBytes > MAX_OUTPUT_BUDGET_BYTES
	) {
		return undefined;
	}
	return maxBytes;
}

/** Effective budget for a command with `declaration` and optional validated `ask` (B3). */
export function effectiveOutputBudget(declaration: OutputBudget, ask: number | undefined): number {
	return ask === undefined ? declaration.defaultBytes : Math.min(ask, declaration.maxBytes);
}

/** The `VALIDATION_ERROR` returned for an invalid ask (B2). */
function invalidAskFailure(): CommandResult {
	return failure({
		code: 'VALIDATION_ERROR',
		message: 'The output budget ask is not valid',
		suggestion: `Send _meta["${AFD_OUTPUT_BUDGET_META_KEY}"] = { "maxBytes": <positive integer> }, or leave it out`,
		retryable: false,
		details: { field: 'outputBudget', meta: AFD_OUTPUT_BUDGET_META_KEY },
	});
}

/**
 * Validate the call's output budget ask and set `context.outputBudget` to the effective budget
 * in place (B2, B3, B4).
 *
 * A value set directly on `context.outputBudget` by trusted code (`createContext` or in-process
 * caller) wins over `_meta["dev.afd/outputBudget"]`. An ask on an unbudgeted command is still
 * validated and then ignored (`context.outputBudget` is cleared).
 */
export function applyOutputBudget(
	command: { outputBudget?: OutputBudget },
	context: CommandContext
): CommandResult | undefined {
	const carrier = context as Record<symbol, unknown>;
	let rawAsk: unknown;
	if (Object.hasOwn(context, 'outputBudget') && context.outputBudget !== undefined) {
		const trusted: unknown = context.outputBudget;
		rawAsk = typeof trusted === 'number' ? { maxBytes: trusted } : trusted;
	} else {
		rawAsk = carrier[OUTPUT_BUDGET_ASK];
	}
	delete context.outputBudget;
	delete carrier[OUTPUT_BUDGET_ASK];

	let askBytes: number | undefined;
	if (rawAsk !== undefined && rawAsk !== null) {
		askBytes = parseOutputBudgetAsk(rawAsk);
		if (askBytes === undefined) return invalidAskFailure();
	}

	if (command.outputBudget) {
		context.outputBudget = effectiveOutputBudget(command.outputBudget, askBytes);
	}
	return undefined;
}

/**
 * Measure the UTF-8 byte length of the canonical JSON of `result` with its top-level `metadata`
 * member removed (B5, step 2).
 *
 * JavaScript's `JSON.stringify` emits compact JSON with the spec's exact string escaping and
 * number spelling, and object key order never changes UTF-8 byte length. Returns `undefined` if
 * `result` cannot be serialized as JSON (e.g. a circular reference or `bigint`).
 */
export function measureOutputBudgetBytes(result: CommandResult): number | undefined {
	try {
		// Null prototype so an own top-level "__proto__" key is preserved as data rather than
		// mutating the object's prototype and disappearing from JSON.stringify.
		const withoutMetadata: Record<string, unknown> = Object.create(null);
		const record = result as unknown as Record<string, unknown>;
		for (const key of Object.keys(record)) {
			if (key !== 'metadata') withoutMetadata[key] = record[key];
		}
		const json = JSON.stringify(withoutMetadata);
		if (json === undefined) return undefined;
		return utf8.encode(json).length;
	} catch {
		return undefined;
	}
}

/**
 * Post-handler output budget check (B5, B6).
 *
 * - Failures and unbudgeted calls pass unchanged with no report.
 * - Within budget: keeps the result and attaches `metadata["dev.afd/outputBudget"]`.
 * - Over budget, read (`mutation` unset or `false`): replaces with `OUTPUT_BUDGET_EXCEEDED`
 *   failure and no report.
 * - Over budget, mutation (`mutation: true`): keeps the result, appends a `caution`
 *   `OUTPUT_BUDGET_EXCEEDED` warning (not counted in `usedBytes`), and attaches the report.
 */
export function checkOutputBudgetResult(
	command: { outputBudget?: OutputBudget; mutation?: boolean },
	limitBytes: number,
	result: CommandResult
): CommandResult {
	const declaration = command.outputBudget;
	if (!declaration || result.success !== true) return result;

	const usedBytes = measureOutputBudgetBytes(result);
	if (usedBytes === undefined) return result;

	if (usedBytes > limitBytes && command.mutation !== true) {
		const { maxBytes } = declaration;
		const suggestion =
			limitBytes < maxBytes
				? `Narrow the request (fewer results, a smaller window or a filter), or ask for up to ${maxBytes} bytes with _meta["${AFD_OUTPUT_BUDGET_META_KEY}"] = { "maxBytes": ${maxBytes} }.`
				: `Narrow the request (fewer results, a smaller window or a filter); ${maxBytes} bytes is this command's largest output budget.`;
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
			...result,
			warnings: [...(result.warnings ?? []), warning],
			metadata: {
				...result.metadata,
				[AFD_OUTPUT_BUDGET_META_KEY]: report,
			},
		};
	}

	return {
		...result,
		metadata: {
			...result.metadata,
			[AFD_OUTPUT_BUDGET_META_KEY]: report,
		},
	};
}
