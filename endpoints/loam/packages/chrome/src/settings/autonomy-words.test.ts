/** The autonomy section's words (phase 4 specification, 4.5): the notice, a row and a step of the chain. */

import { describe, expect, it } from 'vitest';
import { ADVISORY, chainWords, rowWords } from './autonomy-words.js';

const titleOf = (instance: string) => ({ counter: 'Counter' })[instance] ?? instance;

describe('the autonomy section’s words', () => {
	it('says the advisory notice exactly (4.5, E13)', () => {
		expect(ADVISORY).toBe('Agents can read this. Loam enforces it from phase 5.');
	});

	it('names what a row covers by the app’s title', () => {
		expect(rowWords({}, titleOf)).toBe('Every app and command');
		expect(rowWords({ instance: 'counter' }, titleOf)).toBe('Counter, every command');
		expect(rowWords({ instance: 'counter', command: 'counter-reset' }, titleOf)).toBe(
			'Counter: counter-reset'
		);
		expect(rowWords({ instance: 'shell', command: 'project-create' }, titleOf)).toBe(
			'The shell: project-create'
		);
	});

	it('explains each step of the chain: the deciding row, a bound, the cap', () => {
		expect(chainWords({ id: 'default', mode: 'act', as: 'mode' }, titleOf, undefined)).toBe(
			'Act, from the default (act on reads, ask before changes and before any mounted tool)'
		);
		expect(
			chainWords({ id: 'project/prj_atlas/*/*', mode: 'act', as: 'mode' }, titleOf, 'Atlas')
		).toBe("Act, from the project Atlas's rule for every app and command");
		expect(
			chainWords(
				{ id: 'workspace/-/counter/counter-reset', mode: 'suggest', as: 'ceiling' },
				titleOf,
				'Atlas'
			)
		).toBe("Bounded to Suggest only by the workspace's rule for Counter: counter-reset");
		expect(chainWords({ id: 'cap', mode: 'ask', as: 'cap' }, titleOf, undefined)).toBe(
			'Your own cap: Ask first'
		);
	});
});
