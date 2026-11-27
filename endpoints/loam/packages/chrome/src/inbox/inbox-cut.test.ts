import type { ConfirmationRecordV1 } from '@lushly-dev/loam-sdk';
import { describe, expect, it } from 'vitest';
import { cutWords } from './inbox-cut.js';

const record = (parts: Partial<ConfirmationRecordV1>) => parts as ConfirmationRecordV1;
const cutPreview = {
	command: 'mail-replyset-preview',
	digest: 'd',
	truncated: true,
	bytes: 65_536,
} as const;

describe('what a list cut of a confirmation (blocker 9, #2801)', () => {
	it('names the input, the preview or both, and nothing once read whole', () => {
		expect(cutWords(undefined, false)).toBe('');
		expect(cutWords(record({ input: { text: 'short' } }), false)).toBe('');
		expect(cutWords(record({ input: { truncated: true, bytes: 5000 } }), false)).toBe('input');
		expect(cutWords(record({ preview: cutPreview }), false)).toBe('preview');
		expect(
			cutWords(record({ input: { truncated: true, bytes: 5000 }, preview: cutPreview }), false)
		).toBe('input and preview');
		expect(cutWords(record({ preview: cutPreview }), true)).toBe('');
		// A preview listed whole, with its data, is not cut.
		expect(
			cutWords(record({ preview: { command: 'c', digest: 'd', data: { a: 1 } } }), false)
		).toBe('');
	});
});
