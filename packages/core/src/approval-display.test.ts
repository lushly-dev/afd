/**
 * The approval display rules beyond the shared vectors (`spec/vectors/approver-client.json`):
 * values JSON text cannot carry to every language.
 */
import { describe, expect, it } from 'vitest';
import { approvalDisplay, hidesCharacters, isHiddenCodePoint } from './approval-display.js';

describe('approvalDisplay', () => {
	it('refuses what plain JSON cannot hold', () => {
		for (const input of [
			{ n: 10n },
			{ n: Number.NaN },
			{ n: Number.POSITIVE_INFINITY },
			{ m: new Map() },
			{ r: /x/ },
		]) {
			expect(approvalDisplay(input)).toEqual({ ok: false, refusal: 'not-json' });
		}
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(approvalDisplay(cyclic)).toEqual({ ok: false, refusal: 'not-json' });
	});

	it('shows an absent input as {} and returns plain JSON in canonical order', () => {
		expect(approvalDisplay(undefined)).toEqual({ ok: true, value: {} });
		const when = new Date('2026-11-17T00:00:00.000Z');
		expect(approvalDisplay({ b: 1, a: when, c: undefined })).toEqual({
			ok: true,
			value: { a: '2026-11-17T00:00:00.000Z', b: 1 },
		});
	});

	it('hides an unpaired surrogate, which only some languages can hold', () => {
		expect(isHiddenCodePoint(0xd800)).toBe(true);
		expect(isHiddenCodePoint(0xdfff)).toBe(true);
		expect(hidesCharacters('a\uD800b')).toBe(true);
		expect(hidesCharacters('a\uDC00')).toBe(true);
		expect(hidesCharacters('🍅')).toBe(false);
		expect(approvalDisplay({ text: 'x\uD83D' })).toEqual({
			ok: false,
			refusal: 'hidden-characters',
		});
	});
});
