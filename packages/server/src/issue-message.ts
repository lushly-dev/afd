/**
 * @fileoverview An issue's message when no Zod locale is loaded.
 *
 * Zod Mini registers no locale, so with no classic schema built on the page every issue says only
 * `Invalid input`, and classic registers English when it builds its first type, so one schema's text
 * would change when classic loads. This says what English says for the issues a command's input
 * usually raises, from the issue, with no locale in the bundle. A format keeps its own name, `Invalid
 * email` for `Invalid email address`, and a rarer code stays bare: all of English is 2,323 bytes here,
 * more than `/direct`'s budget has left. It needs the issue's `input`, so parse with
 * `{ reportInput: true }` where a message matters. `issue-message.test.ts` holds both tables.
 */

import { config, util } from 'zod/v4/core';

/** Zod's text for an issue no locale named. */
const BARE = 'Invalid input';

const UNITS: Record<string, string> = {
	string: 'characters',
	array: 'items',
	set: 'items',
	map: 'entries',
};

/** The fields of the issue codes read below, which `$ZodIssue`'s union keeps apart. */
interface AnyIssue {
	code?: string;
	message: string;
	input?: unknown;
	expected?: string;
	values: util.Primitive[];
	keys: string[];
	origin?: string;
	inclusive?: boolean;
	exact?: boolean;
	maximum?: unknown;
	minimum?: unknown;
	format?: string;
	pattern?: string;
	options?: unknown[];
}

/**
 * An issue's message. Only the bare text with no locale loaded is rebuilt: a schema's own message, a
 * custom error map and a locale someone chose all stay as they are, so a host on classic sees no change.
 */
export function issueMessage(issue: { code?: string; message: string }): string {
	if (issue.message !== BARE || config().localeError) return issue.message;
	const i = issue as AnyIssue;
	switch (i.code) {
		case 'invalid_type':
			return `${BARE}: expected ${i.expected}, received ${util.parsedType(i.input)}`;
		case 'invalid_value':
			return i.values.length === 1
				? `${BARE}: expected ${util.stringifyPrimitive(i.values[0])}`
				: `Invalid option: expected one of ${util.joinValues(i.values)}`;
		case 'too_big':
		case 'too_small': {
			const big = i.code === 'too_big';
			const unit = UNITS[i.origin as string];
			return `Too ${big ? 'big' : 'small'}: expected ${i.origin} to ${unit ? 'have' : 'be'} ${
				i.exact ? 'exactly ' : `${big ? '<' : '>'}${i.inclusive ? '=' : ''}`
			}${big ? i.maximum : i.minimum}${unit ? ` ${unit}` : ''}`;
		}
		case 'invalid_format':
			return i.format === 'regex'
				? `Invalid string: must match pattern ${i.pattern}`
				: `Invalid ${i.format}`;
		case 'unrecognized_keys':
			return `Unrecognized key${i.keys.length > 1 ? 's' : ''}: ${util.joinValues(i.keys, ', ')}`;
		case 'invalid_union':
			if (i.options?.length) {
				return `Invalid discriminator value. Expected ${i.options.map((o) => `'${o}'`).join(' | ')}`;
			}
	}
	return BARE;
}
