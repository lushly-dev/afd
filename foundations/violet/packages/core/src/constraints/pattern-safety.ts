/**
 * Safe compilation of user supplied constraint regexes.
 *
 * Constraint patterns come from API/CLI users and are executed against every
 * matching token value, so a catastrophic pattern such as `^(a+)+$` can pin the
 * process for seconds. This module rejects such patterns up front and is also
 * used by the validator for constraints stored before the check existed.
 *
 * The nested quantifier check is a heuristic, not a proof: it rejects groups that
 * contain an unbounded quantifier (`*`, `+`, `{n,}`) and are themselves repeated by
 * an unbounded quantifier (for example `(a+)+`, `(\d*)*`, `(\w+\s?)*`). That is
 * the dominant source of exponential backtracking; it deliberately errs on the side
 * of rejecting a few safe patterns such as `(\d+\.)*\d+`.
 */

/** Longest pattern accepted for a pattern constraint */
export const MAX_PATTERN_LENGTH = 500;

export type PatternCheck = { ok: true; regex: RegExp } | { ok: false; reason: string };

/** Length of an `{n}`, `{n,}` or `{n,m}` quantifier starting at `index`, with its kind. */
function readBraceQuantifier(
	pattern: string,
	index: number,
): { length: number; unbounded: boolean } | null {
	const match = /^\{\d+(,(\d*))?\}/.exec(pattern.slice(index));
	if (!match) {
		return null;
	}
	return { length: match[0].length, unbounded: match[1] !== undefined && match[2] === '' };
}

/** True when the pattern has a repeated group that itself contains an unbounded repeat. */
export function hasNestedQuantifier(pattern: string): boolean {
	// One frame per open group; `hasRepeat` = an unbounded quantifier occurs inside it
	const stack: Array<{ hasRepeat: boolean }> = [];

	const unboundedAt = (index: number): boolean => {
		const char = pattern[index];
		if (char === '*' || char === '+') {
			return true;
		}
		if (char === '{') {
			return readBraceQuantifier(pattern, index)?.unbounded ?? false;
		}
		return false;
	};

	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];

		if (char === '\\') {
			i++; // escaped character, never structural
			continue;
		}

		if (char === '[') {
			// Skip a character class (quantifier characters are literal inside it)
			i++;
			while (i < pattern.length && pattern[i] !== ']') {
				if (pattern[i] === '\\') {
					i++;
				}
				i++;
			}
			continue;
		}

		if (char === '(') {
			stack.push({ hasRepeat: false });
			continue;
		}

		if (char === ')') {
			const frame = stack.pop();
			if (!frame) {
				continue;
			}
			const repeated = unboundedAt(i + 1);
			if (frame.hasRepeat && repeated) {
				return true;
			}
			const parent = stack[stack.length - 1];
			if (parent && (frame.hasRepeat || repeated)) {
				parent.hasRepeat = true;
			}
			continue;
		}

		if (unboundedAt(i)) {
			const frame = stack[stack.length - 1];
			if (frame) {
				frame.hasRepeat = true;
			}
		}
	}

	return false;
}

/**
 * Validate and compile a user supplied pattern.
 * Never throws: failures are reported as `{ ok: false, reason }`.
 */
export function checkPattern(pattern: string, flags?: string): PatternCheck {
	if (pattern.length > MAX_PATTERN_LENGTH) {
		return {
			ok: false,
			reason: `Pattern is longer than ${MAX_PATTERN_LENGTH} characters`,
		};
	}

	let regex: RegExp;
	try {
		regex = new RegExp(pattern, flags);
	} catch (error) {
		return {
			ok: false,
			reason: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	if (hasNestedQuantifier(pattern)) {
		return {
			ok: false,
			reason:
				'Pattern contains a nested quantifier (for example "(a+)+") that can cause catastrophic backtracking',
		};
	}

	return { ok: true, regex };
}
