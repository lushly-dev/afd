/**
 * The panel's card words (phase 5 specification, 6.2, 3.4): why the copilot asked, in words, the input one line per
 * field, how a confirmation ended, and the taint mark. The cards themselves, their presses and axe are P5-A8's
 * Chromium tests (`web/test/browser/copilot-cards.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { askedWords, endedWords, inputWords, taintWords } from './cards.js';

describe('the panel’s card words (6.2)', () => {
	it('says why it asked: the chain of rows, a destructive command, and taint’s sources', () => {
		expect(
			askedWords({
				asked: {
					mode: 'ask',
					reason: 'policy',
					sources: [],
					chain: [
						{ id: 'workspace/-/*/*', mode: 'act', as: 'mode' },
						{ id: 'destructive', mode: 'ask', as: 'ceiling' },
					],
				},
			})
		).toEqual([
			"Act, from the workspace's rule for every app and command",
			'Asked because it cannot be undone',
		]);
		expect(
			askedWords({
				asked: {
					mode: 'ask',
					reason: 'taint',
					sources: ['mail'],
					chain: [
						{ id: 'default', mode: 'act', as: 'mode' },
						{ id: 'taint', mode: 'ask', as: 'ceiling' },
					],
				},
			})
		).toEqual([
			// Taint's bound is its own line, never a row's words (5.3).
			expect.stringContaining('the default'),
			'Asked because the conversation includes content from mail',
		]);
		expect(askedWords({})).toEqual([]);
	});

	it('shows the input one line per field, and the end and the taint mark in words', () => {
		expect(inputWords({ name: 'Garden', size: 2 })).toBe('name: "Garden"\nsize: 2');
		expect(inputWords({})).toBe('No input');
		expect(inputWords({ truncated: true, bytes: 4096 })).toBe('truncated: true\nbytes: 4096');
		expect(endedWords('expired')).toBe('Expired: no one answered within 10 minutes');
		expect(endedWords('pending')).toBe('Waiting for you');
		expect(taintWords([])).toBe('');
		expect(taintWords(['mail', 'counter'])).toBe('This answer may repeat text from mail, counter');
	});
});
