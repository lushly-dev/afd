/**
 * @fileoverview Per-command output budgets (`spec/output-budgets.md`, B1 to B8): shared types,
 * constants and declaration validation.
 *
 * The key `dev.afd/outputBudget` carries three shapes in three places:
 * - declaration on a tool's `_meta`: `{ defaultBytes, maxBytes }` ({@link OutputBudget})
 * - ask on a call's `_meta`: `{ maxBytes }` ({@link OutputBudgetAsk})
 * - report in a result's `metadata`: `{ limitBytes, usedBytes }` ({@link OutputBudgetReport})
 */

/** The `_meta` / `metadata` key of an output budget (`spec/output-budgets.md`). */
export const AFD_OUTPUT_BUDGET_META_KEY = 'dev.afd/outputBudget';

/** The largest integer a JavaScript number holds exactly: the largest budget (2^53 − 1). */
export const MAX_OUTPUT_BUDGET_BYTES = 9_007_199_254_740_991;

/**
 * A command's declared output budget: the bytes a result may use by default and at most (B1).
 *
 * Both are integers from 1 to {@link MAX_OUTPUT_BUDGET_BYTES} with `defaultBytes <= maxBytes`,
 * and no other members are allowed.
 */
export interface OutputBudget {
	/** The effective budget of a call that asks for none. */
	defaultBytes: number;
	/** The most a call may ask for; a larger ask is clamped to it. */
	maxBytes: number;
}

/** A caller's per-call output budget ask, `{ maxBytes }` (B2). */
export interface OutputBudgetAsk {
	/** Requested maximum size in bytes (integer from 1 to {@link MAX_OUTPUT_BUDGET_BYTES}). */
	maxBytes: number;
}

/** The output budget report attached to `result.metadata["dev.afd/outputBudget"]` (B6). */
export interface OutputBudgetReport {
	/** The effective budget enforced for this call. */
	limitBytes: number;
	/** The measured UTF-8 canonical JSON byte length of the result without `metadata`. */
	usedBytes: number;
}

function isPositiveBudgetInteger(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 1 &&
		value <= MAX_OUTPUT_BUDGET_BYTES
	);
}

/**
 * Validate a command's `outputBudget` declaration (B1) and return a normalized copy.
 *
 * @throws Error naming the command (when provided) and the invalid field.
 */
export function validateOutputBudget(value: unknown, commandName?: string): OutputBudget {
	const prefix = commandName ? `command "${commandName}": ` : '';
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${prefix}outputBudget must be an object { defaultBytes, maxBytes }`);
	}
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) {
		throw new Error(`${prefix}outputBudget must be a plain object { defaultBytes, maxBytes }`);
	}
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (key !== 'defaultBytes' && key !== 'maxBytes') {
			throw new Error(
				`${prefix}outputBudget has an unknown member '${key}'; it takes only defaultBytes and maxBytes`
			);
		}
	}
	const defaultBytes = record.defaultBytes;
	if (!isPositiveBudgetInteger(defaultBytes)) {
		throw new Error(
			`${prefix}outputBudget.defaultBytes must be an integer from 1 to ${MAX_OUTPUT_BUDGET_BYTES}`
		);
	}
	const maxBytes = record.maxBytes;
	if (!isPositiveBudgetInteger(maxBytes)) {
		throw new Error(
			`${prefix}outputBudget.maxBytes must be an integer from 1 to ${MAX_OUTPUT_BUDGET_BYTES}`
		);
	}
	if (defaultBytes > maxBytes) {
		throw new Error(
			`${prefix}outputBudget.defaultBytes (${defaultBytes}) must not be above outputBudget.maxBytes (${maxBytes})`
		);
	}
	return Object.freeze({ defaultBytes, maxBytes });
}
