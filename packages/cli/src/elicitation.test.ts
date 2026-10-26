import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createTerminalElicitation, isYes } from './elicitation.js';

const CONFIRM = {
	type: 'object',
	properties: { confirm: { type: 'boolean' } },
	required: ['confirm'],
};

function terminal(answer: string) {
	const input = new PassThrough();
	const output = new PassThrough();
	let written = '';
	output.on('data', (chunk) => {
		written += String(chunk);
		if (written.includes('[y/N]')) input.end(`${answer}\n`);
	});
	return { handler: createTerminalElicitation({ input, output }), written: () => written };
}

describe('terminal elicitation', () => {
	it('accepts a yes with every boolean set', async () => {
		const { handler, written } = terminal('y');
		const answer = await handler({ message: 'Delete every todo?', requestedSchema: CONFIRM });
		expect(answer).toEqual({ action: 'accept', content: { confirm: true } });
		expect(written()).toContain('Delete every todo? [y/N]');
	});

	it.each(['', 'n', 'no', 'maybe'])('declines %j', async (reply) => {
		const { handler } = terminal(reply);
		expect(await handler({ message: 'Sure?', requestedSchema: CONFIRM })).toEqual({
			action: 'decline',
		});
	});

	it('cancels a form it cannot collect, and strips escape sequences from the message', async () => {
		const { handler, written } = terminal('y');
		const answer = await handler({
			message: 'Name?\u001b]0;pwned\u0007',
			requestedSchema: { type: 'object', properties: { name: { type: 'string' } } },
		});
		expect(answer).toEqual({ action: 'cancel' });
		expect(written()).not.toContain('\u001b');
	});

	it('reads y and yes in any case as yes', () => {
		expect(['y', 'Y', 'yes', ' YES '].every(isYes)).toBe(true);
		expect(['', 'n', 'yep', 'ok'].some(isYes)).toBe(false);
	});
});
