/**
 * @fileoverview Browser-safe result-state normalisation for AFD command results.
 *
 * Turns a `CommandResult<T>` (or pending `null`/`undefined`) into a discriminated
 * view-model state (`loading`, `ready`, `empty`, or `error`) without dropping any
 * `CommandResult` field (`confidence`, `reasoning`, `sources`, `plan`, `alternatives`,
 * `warnings`, `suggestions`, `metadata`, `undoCommand`, `undoArgs`, or `result`).
 *
 * Module-graph rule: type-only imports only so `@lushly-dev/afd-client/direct` stays
 * browser-safe and within its minified bundle budget.
 */

import type { CommandError, CommandResult } from '@lushly-dev/afd-core';
import type { UnknownToolFailureResult } from './unknown-tool.js';

/**
 * UX, metadata, and undo fields preserved from `CommandResult<T>` across every settled state.
 */
export type ResultEnvelopeFields<T = unknown> = Pick<
	CommandResult<T>,
	| 'confidence'
	| 'reasoning'
	| 'sources'
	| 'plan'
	| 'alternatives'
	| 'warnings'
	| 'suggestions'
	| 'metadata'
	| 'undoCommand'
	| 'undoArgs'
>;

/** Pending state before a command result settles. */
export interface LoadingResultState<T = unknown> {
	readonly status: 'loading';
	/** Previous settled state when refreshing in place, if supplied. */
	readonly previous?: SettledResultState<T>;
}

/** Settled success state with non-empty data. */
export interface ReadyResultState<T = unknown> extends ResultEnvelopeFields<T> {
	readonly status: 'ready';
	readonly data: T;
	readonly result: CommandResult<T>;
}

/** Settled success state whose data is empty (`null`, `undefined`, `[]`, or `isEmpty() === true`). */
export interface EmptyResultState<T = unknown> extends ResultEnvelopeFields<T> {
	readonly status: 'empty';
	readonly data: T | undefined;
	readonly result: CommandResult<T>;
}

/** Settled failure state with normalised error fields and all preserved result metadata. */
export interface ErrorResultState<T = unknown> extends ResultEnvelopeFields<T> {
	readonly status: 'error';
	/** Machine-readable error code (`'UNKNOWN_ERROR'` if absent on a malformed failure). */
	readonly code: string;
	/** Human-readable error message (`'Command failed'` if absent on a malformed failure). */
	readonly message: string;
	/** Actionable recovery suggestion from `error.suggestion`, when non-empty. */
	readonly suggestion?: string;
	/** Whether retrying the same request may succeed (`false` when unset). */
	readonly retryable: boolean;
	/** Structured technical details from `error.details`, when present. */
	readonly details?: Record<string, unknown>;
	/** Underlying enumerable cause from `error.cause`, when present. */
	readonly cause?: CommandError['cause'];
	/** Original `CommandError` from `result.error`, when present. */
	readonly error?: CommandError;
	/** Optional data payload carried on a failure (for example, `UnknownToolError`). */
	readonly data?: unknown;
	readonly result: CommandResult<T> | UnknownToolFailureResult;
}

/** Any settled state produced from a `CommandResult<T>`. */
export type SettledResultState<T = unknown> =
	| ReadyResultState<T>
	| EmptyResultState<T>
	| ErrorResultState<T>;

/** Discriminated UI state produced by {@link normalizeResultState} and {@link loadingResultState}. */
export type NormalizedResultState<T = unknown> = LoadingResultState<T> | SettledResultState<T>;

/** Status discriminant of {@link NormalizedResultState}. */
export type ResultStateStatus = NormalizedResultState['status'];

/** Options for {@link normalizeResultState}. */
export interface NormalizeResultOptions<T = unknown> {
	/**
	 * Custom predicate deciding whether a successful result represents an empty state.
	 * Defaults to `data === undefined || data === null || (Array.isArray(data) && data.length === 0)`.
	 * For enveloped lists (such as `{ items: T[], total: number }`), pass
	 * `{ isEmpty: (data) => !data || data.items.length === 0 }`.
	 *
	 * Because a custom predicate may classify `data: undefined` as `'ready'`, passing `isEmpty`
	 * widens the returned state's `T` to `T | undefined`.
	 */
	isEmpty?: (data: T | undefined, result: CommandResult<T>) => boolean;
	/** Previous settled state carried when `result` is `null` or `undefined`. */
	previous?: SettledResultState<T | undefined>;
}

const DEFAULT_ERROR_CODE = 'UNKNOWN_ERROR';
const DEFAULT_ERROR_MESSAGE = 'Command failed';

function defaultIsEmpty(data: unknown): boolean {
	return data === undefined || data === null || (Array.isArray(data) && data.length === 0);
}

function extractEnvelopeFields<T>(result: CommandResult<T>): ResultEnvelopeFields<T> {
	return {
		...(result.confidence !== undefined && { confidence: result.confidence }),
		...(result.reasoning !== undefined && { reasoning: result.reasoning }),
		...(result.sources !== undefined && { sources: result.sources }),
		...(result.plan !== undefined && { plan: result.plan }),
		...(result.alternatives !== undefined && { alternatives: result.alternatives }),
		...(result.warnings !== undefined && { warnings: result.warnings }),
		...(result.suggestions !== undefined && { suggestions: result.suggestions }),
		...(result.metadata !== undefined && { metadata: result.metadata }),
		...(result.undoCommand !== undefined && { undoCommand: result.undoCommand }),
		...(result.undoArgs !== undefined && { undoArgs: result.undoArgs }),
	};
}

/**
 * Create a `'loading'` result state, optionally preserving the previous settled state
 * for in-place refresh UIs.
 */
export function loadingResultState<T = unknown>(
	previous?: SettledResultState<T>
): LoadingResultState<T> {
	return previous !== undefined ? { status: 'loading', previous } : { status: 'loading' };
}

/**
 * Normalise a `CommandResult<T>` (including `DirectClient.call<T>()` results, or pending
 * `null`/`undefined`) into a discriminated `loading`, `ready`, `empty`, or `error` state
 * while preserving every `CommandResult` field.
 */
export function normalizeResultState<T>(
	result: CommandResult<T> | UnknownToolFailureResult,
	options?: { previous?: SettledResultState<T>; isEmpty?: undefined }
): SettledResultState<T>;
export function normalizeResultState<T>(
	result: CommandResult<T> | UnknownToolFailureResult,
	options: NormalizeResultOptions<T>
): SettledResultState<T | undefined>;
export function normalizeResultState<T>(
	result: CommandResult<T> | UnknownToolFailureResult | null | undefined,
	options?: { previous?: SettledResultState<T>; isEmpty?: undefined }
): NormalizedResultState<T>;
export function normalizeResultState<T>(
	result: CommandResult<T> | UnknownToolFailureResult | null | undefined,
	options: NormalizeResultOptions<T>
): NormalizedResultState<T | undefined>;
export function normalizeResultState<T>(
	result: CommandResult<T> | UnknownToolFailureResult | null | undefined,
	options?: NormalizeResultOptions<T>
): NormalizedResultState<T | undefined> {
	if (result === null || result === undefined) {
		return loadingResultState(options?.previous);
	}

	const envelope = extractEnvelopeFields(result as CommandResult<T>);

	if (result.success !== true) {
		const rawError = result.error;
		const errorObj = typeof rawError === 'object' && rawError !== null ? rawError : undefined;
		const code =
			typeof errorObj?.code === 'string' && errorObj.code.trim().length > 0
				? errorObj.code
				: DEFAULT_ERROR_CODE;
		const message =
			typeof errorObj?.message === 'string' && errorObj.message.trim().length > 0
				? errorObj.message
				: DEFAULT_ERROR_MESSAGE;
		const suggestion =
			typeof errorObj?.suggestion === 'string' && errorObj.suggestion.trim().length > 0
				? errorObj.suggestion
				: undefined;
		const hasEnumerableCause =
			errorObj !== undefined &&
			Object.prototype.propertyIsEnumerable.call(errorObj, 'cause') &&
			errorObj.cause !== undefined;

		return {
			status: 'error',
			code,
			message,
			...(suggestion !== undefined && { suggestion }),
			retryable: errorObj?.retryable === true,
			...(errorObj?.details !== undefined && { details: errorObj.details }),
			...(hasEnumerableCause && { cause: errorObj.cause }),
			...(errorObj !== undefined && { error: errorObj }),
			...(result.data !== undefined && { data: result.data }),
			...envelope,
			result,
		};
	}

	const successResult = result as CommandResult<T>;
	const isEmpty = options?.isEmpty
		? options.isEmpty(successResult.data, successResult)
		: defaultIsEmpty(successResult.data);

	if (isEmpty) {
		return {
			status: 'empty',
			data: successResult.data,
			...envelope,
			result: successResult,
		};
	}

	return {
		status: 'ready',
		data: successResult.data,
		...envelope,
		result: successResult,
	};
}
