import { describe, expect, it } from 'vitest';
import { resultHtml, resultLabels } from './result.js';

/** The tags and attributes that may reach the shadow root; anything else is markup from a result. */
function markupOf(html: string): string[] {
	return [...html.matchAll(/<\/?([a-z][^\s>/]*)([^>]*)>/gi)].map(([, tag, attributes]) =>
		`${tag}${attributes}`.trim()
	);
}

const ALLOWED =
	/^(pre|br|span( class="afd-status-(success|failure|warning|info|muted|neutral)( afd-bold)?")?)$/;

const XSS = `<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>"'&`;

/** A hostile value in every place a result reaches the adapter. */
const HOSTILE = [
	['data', { success: true, data: XSS }],
	['a key of data', { success: true, data: { [XSS]: XSS } }],
	[
		'package results',
		{
			success: true,
			data: {
				total: XSS,
				passed: XSS,
				failed: XSS,
				packages: [{ name: XSS, passed: false, stdout: XSS, stderr: XSS }],
			},
		},
	],
	[
		'an error',
		{
			success: false,
			error: { code: XSS, message: XSS, suggestion: XSS, details: { [XSS]: XSS } },
		},
	],
	['confidence and reasoning', { success: true, data: 1, confidence: XSS, reasoning: XSS }],
	[
		'a real confidence with hostile reasoning',
		{ success: true, data: 1, confidence: 0.5, reasoning: XSS },
	],
	['warnings', { success: true, data: 1, warnings: [{ code: XSS, message: XSS }] }],
	['warnings that are a string', { success: true, data: 1, warnings: XSS }],
] as const;

describe('resultHtml: results are untrusted', () => {
	it.each(HOSTILE)('writes nothing but its own markup for %s', (_name, result) => {
		const html = resultHtml(result);
		for (const markup of markupOf(html)) expect(markup).toMatch(ALLOWED);
		expect(html).not.toContain('<img');
		expect(html).not.toContain('<script');
		expect(html).not.toMatch(/style=/);
	});

	it('throws on a shape it cannot read, which the element catches', () => {
		expect(() => resultHtml({ success: true, data: 1, warnings: [null] })).toThrow();
	});

	it('marks the error with the classes the stylesheet maps', () => {
		const html = resultHtml({
			success: false,
			error: { code: 'E', message: 'm', suggestion: 's' },
		});
		expect(html).toContain('class="afd-status-failure afd-bold"');
		expect(html).toContain('[E] m');
		expect(html).toContain('Suggestion: s');
	});
});

describe('resultLabels', () => {
	it("labels a mounted result, and shows the server's own trust as it came", () => {
		expect(
			resultLabels({
				'dev.loam/trust': 'untrusted',
				'dev.loam/instance': 'work',
				'dev.loam/replay': 'recorded',
				'dev.loam/seq': 12,
				'dev.umbel/trust': 'content',
			})
		).toEqual([
			'Untrusted: from work',
			'Recorded, not replayable',
			'Journal entry 12',
			'dev.umbel/trust: content',
		]);
	});

	it('has only the journal entry for an ordinary call, and nothing with no metadata', () => {
		expect(resultLabels({ 'dev.loam/seq': 3 })).toEqual(['Journal entry 3']);
		expect(resultLabels(undefined)).toEqual([]);
		expect(resultLabels('hostile')).toEqual([]);
	});

	it('shows a hostile value as text to set, not to parse', () => {
		expect(
			resultLabels({
				'dev.loam/trust': 'untrusted',
				'dev.loam/instance': { evil: '<img>' },
				'dev.umbel/trust': ['<img>'],
			})
		).toEqual(['Untrusted: from {"evil":"<img>"}', 'dev.umbel/trust: ["<img>"]']);
	});
});
