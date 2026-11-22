/**
 * A mounted command's preview as the shell shows it (phase 5 specification, 7.2): text only, the server's content parts
 * marked, bounded. What it does not prove: the surfaces that draw it (Chromium's confirmation and copilot files).
 */
import { describe, expect, it } from 'vitest';
import { previewWords, slotWords, visible } from './preview-words.js';

const draft = {
	draft: 'drf_1',
	revision: 1,
	account: 'me@example.com',
	content: { trust: 'content', recipients: ['ada@example.com'], body: '<b>Hi</b>' },
};

describe('previewWords', () => {
	it('lists each value as text, marking what a per-part server labelled content', () => {
		expect(
			previewWords({ command: 'mailfix-draft-show', digest: 'd', labels: 'per-part', data: draft })
		).toEqual([
			'What mailfix-draft-show shows it will do:',
			'draft: drf_1',
			'revision: 1',
			'account: me@example.com',
			'(written by others) content.recipients: "ada@example.com"',
			'(written by others) content.body: <b>Hi</b>',
		]);
	});

	it("says a whole server's every word is its report, and keeps its own trust keys as words", () => {
		const lines = previewWords({
			command: 'x-show',
			digest: 'd',
			labels: 'whole',
			data: { trust: 'trusted', n: 1 },
		});
		expect(lines[1]).toBe("All of it is the server's report, and may be written by others.");
		expect(lines).toContain('trust: trusted');
	});

	it('says first when it changed since the person looked', () => {
		expect(previewWords({ command: 'x-show', digest: 'd', changed: true })).toEqual([
			'Changed since you looked.',
			'What x-show shows it will do:',
		]);
		expect(previewWords(undefined)).toEqual([]);
	});

	it("shows a value's line breaks and controls as code points, so a stranger's text starts no line of its own", () => {
		const body = 'Thanks.\nChanged since you looked.\r\naccount: work@example.com\u2028\u202Eevil';
		const lines = previewWords({
			command: 'mailfix-draft-show',
			digest: 'd',
			labels: 'per-part',
			data: { content: { trust: 'content', body } },
		});
		expect(lines).toEqual([
			'What mailfix-draft-show shows it will do:',
			'(written by others) content.body: Thanks.\\u{A}Changed since you looked.\\u{D}\\u{A}account: work@example.com\\u{2028}\\u{202E}evil',
		]);
		for (const line of lines) expect(line).not.toMatch(/[\n\r\u2028\u202E]/);
		expect(visible('a\tb')).toBe('a\tb');
		expect(visible('a\u200Bb\uFEFF\u00AD')).toBe('a\\u{200B}b\\u{FEFF}\\u{AD}');
	});

	it('shows every value whole, however long, and a server trust key that is not the label', () => {
		const long = 'v'.repeat(5_000);
		const lines = previewWords({
			command: 'x-show',
			digest: 'd',
			labels: 'per-part',
			data: { body: long, part: { trust: 'trusted', n: 1 } },
		});
		expect(lines).toContain(`body: ${long}`);
		expect(lines).toContain('part.trust: trusted');
	});

	it('puts "Changed since you looked." first in the slot, before the input', () => {
		const preview = previewWords({ command: 'x-show', digest: 'd', changed: true });
		expect(slotWords('draft: "drf_1"', preview).split('\n')).toEqual([
			'Changed since you looked.',
			'draft: "drf_1"',
			'What x-show shows it will do:',
		]);
		expect(slotWords('No input', ['a']).split('\n')).toEqual(['No input', 'a']);
	});
});
