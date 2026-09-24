/**
 * @fileoverview Tool argument parsing shared by `call`, `stream` and `shell`.
 *
 * Arguments are either one JSON object (`{"title": "Buy  milk"}`) or
 * whitespace-separated `key=value` pairs. A value is parsed as JSON when it can
 * be (`count=2`, `done=true`, `tags=["a", "b"]`, `title="Buy milk"`) and kept as
 * a string otherwise (`title=milk`, `note='two words'`).
 */

function isSpace(char: string): boolean {
	return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

/** Index of the quote that closes the one at `start`; `"` honours backslash escapes. */
function closingQuote(input: string, start: number): number {
	const quote = input.charAt(start);
	for (let i = start + 1; i < input.length; i++) {
		const char = input.charAt(i);
		if (quote === '"' && char === '\\') {
			i++;
		} else if (char === quote) {
			return i;
		}
	}
	throw new Error(`Unterminated ${quote} quote in: ${input.slice(start)}`);
}

/** Index of the bracket that closes the JSON array/object opened at `start`. */
function closingBracket(input: string, start: number): number {
	let depth = 0;
	for (let i = start; i < input.length; i++) {
		const char = input.charAt(i);
		if (char === '"') {
			i = closingQuote(input, i);
		} else if (char === '{' || char === '[') {
			depth++;
		} else if (char === '}' || char === ']') {
			depth--;
			if (depth === 0) return i;
		}
	}
	throw new Error(`Unbalanced brackets in: ${input.slice(start)}`);
}

/**
 * Split `key=value` pairs on whitespace. A value that starts with a quote runs
 * to the closing quote, and one that starts with `{` or `[` runs to the
 * matching bracket, so either may contain spaces. Quotes and brackets elsewhere
 * (`note=don't`) are ordinary characters.
 */
export function splitPairs(input: string): string[] {
	const tokens: string[] = [];
	let i = 0;
	while (i < input.length) {
		if (isSpace(input.charAt(i))) {
			i++;
			continue;
		}
		let token = '';
		let atValueStart = true;
		let sawEquals = false;
		while (i < input.length && !isSpace(input.charAt(i))) {
			const char = input.charAt(i);
			let end = -1;
			if (atValueStart && (char === '"' || char === "'")) {
				end = closingQuote(input, i);
			} else if (atValueStart && sawEquals && (char === '{' || char === '[')) {
				end = closingBracket(input, i);
			}
			if (end !== -1) {
				token += input.slice(i, end + 1);
				i = end + 1;
				atValueStart = false;
				continue;
			}
			token += char;
			i++;
			atValueStart = char === '=' && !sawEquals;
			if (char === '=') sawEquals = true;
		}
		tokens.push(token);
	}
	return tokens;
}

function parseValue(value: string): unknown {
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1);
	}
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

/** Parse whitespace-separated `key=value` pairs. Throws on a token without a key. */
export function parseKeyValuePairs(input: string): Record<string, unknown> {
	const entries = splitPairs(input).map((token): [string, unknown] => {
		const equals = token.indexOf('=');
		if (equals <= 0) {
			throw new Error(`Expected key=value, got "${token}"`);
		}
		return [token.slice(0, equals), parseValue(token.slice(equals + 1))];
	});
	// fromEntries defines own properties, so a `__proto__` key stays an argument.
	return Object.fromEntries(entries);
}

/**
 * Parse tool arguments: a JSON object when the text starts with `{`, otherwise
 * `key=value` pairs. Empty input gives `{}`. Throws an `Error` describing the
 * problem when the arguments are malformed.
 */
export function parseToolArgs(raw: string | undefined): Record<string, unknown> {
	const text = raw?.trim() ?? '';
	if (!text) return {};
	if (text.startsWith('{')) {
		// Text that starts with `{` either parses to an object or throws.
		return JSON.parse(text) as Record<string, unknown>;
	}
	return parseKeyValuePairs(text);
}

/** The message printed when {@link parseToolArgs} rejects the arguments. */
export function describeArgsError(error: unknown): string {
	const reason = error instanceof Error ? error.message : String(error);
	return `Invalid arguments (${reason}). Use a JSON object or key=value pairs.`;
}
