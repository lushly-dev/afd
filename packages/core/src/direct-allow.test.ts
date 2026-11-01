import { describe, expect, it } from 'vitest';
import { commandNotAllowed, directAllows } from './direct-allow.js';

describe('internal DirectClient allow seam', () => {
	it('permits a name only on an explicit true, and denies when the predicate throws', () => {
		expect(directAllows((name) => name === 'note-list', 'note-list')).toBe(true);
		expect(directAllows((name) => name === 'note-list', 'note-delete')).toBe(false);
		expect(directAllows((() => 'yes') as unknown as (name: string) => boolean, 'note-list')).toBe(
			false
		);
		expect(
			directAllows(() => {
				throw new Error('policy unavailable');
			}, 'note-list')
		).toBe(false);
	});

	it('builds the refusal DirectClient and createDirectRegistry both give, with a bounded name', () => {
		expect(commandNotAllowed('note-delete')).toEqual({
			code: 'COMMAND_NOT_ALLOWED',
			message: "Command 'note-delete' is not allowed for this client",
			suggestion: 'Call one of the commands returned by listCommandNames()',
			retryable: false,
		});
		expect(commandNotAllowed('x'.repeat(500)).message.length).toBeLessThan(200);
	});
});
