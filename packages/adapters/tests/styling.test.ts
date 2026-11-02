import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATUS_COLORS, StatusType, type StatusTypeValue } from '../src/css-variables.js';
import type { RenderOptions } from '../src/types.js';
import { styledSpan } from '../src/utils.js';
import { WebAdapter } from '../src/web-adapter.js';

const HOSTILE = '<span style="color: red" onclick="x()">" style="color: red</span>';

const PACKAGES = {
	packages: [
		{ name: HOSTILE, passed: true },
		{ name: 'cli', passed: false, stdout: HOSTILE, stderr: HOSTILE },
	],
	total: 2,
	passed: 1,
	failed: 1,
	success: false,
};

/**
 * One call per path through each renderer that writes a span. A new renderer belongs here.
 */
const RENDERS: Array<[string, (options?: RenderOptions) => string]> = [
	['renderPackageResults', (o) => WebAdapter.renderPackageResults(PACKAGES, o)],
	['renderError', (o) => WebAdapter.renderError(HOSTILE, o)],
	['renderSuccess', (o) => WebAdapter.renderSuccess(HOSTILE, o)],
	['renderWarning', (o) => WebAdapter.renderWarning(HOSTILE, o)],
	['renderResult, error', (o) => WebAdapter.renderResult({ success: false, error: HOSTILE }, o)],
	[
		'renderResult, package results',
		(o) => WebAdapter.renderResult({ success: true, data: PACKAGES }, o),
	],
	[
		'renderCommandError',
		(o) =>
			WebAdapter.renderCommandError(
				{ code: 'E', message: HOSTILE, suggestion: HOSTILE, details: { value: HOSTILE } },
				o
			),
	],
	['renderConfidence, high', (o) => WebAdapter.renderConfidence(0.9, HOSTILE, o)],
	['renderConfidence, medium', (o) => WebAdapter.renderConfidence(0.6, undefined, o)],
	['renderConfidence, low', (o) => WebAdapter.renderConfidence(0.1, undefined, o)],
	[
		'renderWarnings',
		(o) => WebAdapter.renderWarnings([{ code: 'W', message: HOSTILE }, { message: HOSTILE }], o),
	],
	[
		'renderPipelineSteps',
		(o) =>
			WebAdapter.renderPipelineSteps(
				[
					{ index: 0, command: HOSTILE, alias: HOSTILE, status: 'success', executionTimeMs: 1 },
					{ index: 1, command: 'b', status: 'failure', error: { message: HOSTILE } },
					{ index: 2, command: 'c', status: 'failure', error: {} },
					{ index: 3, command: 'd', status: 'skipped' },
				],
				o
			),
	],
	[
		'renderCommandResult, failure',
		(o) =>
			WebAdapter.renderCommandResult(
				{
					success: false,
					error: { code: 'E', message: HOSTILE, suggestion: HOSTILE },
					confidence: 0.2,
					reasoning: HOSTILE,
					warnings: [{ message: HOSTILE }],
				},
				o
			),
	],
	[
		'renderCommandResult, data',
		(o) =>
			WebAdapter.renderCommandResult(
				{ success: true, data: { value: HOSTILE }, confidence: 0.9, reasoning: HOSTILE },
				o
			),
	],
	[
		'renderCommandResult, package results',
		(o) =>
			WebAdapter.renderCommandResult(
				{ success: true, data: PACKAGES, warnings: [{ message: HOSTILE }] },
				o
			),
	],
];

/**
 * The tags in rendered output. Every `<` in a value is escaped, so a tag here is real markup.
 */
function tags(html: string): string[] {
	return html.match(/<[^>]*>/g) ?? [];
}

/**
 * The output `styling: 'classes'` should give for this `inline` output.
 */
function asClasses(html: string): string {
	return html.replace(/ style="color: ([^;]*);( font-weight: bold;)?"/g, (_, color, bold) => {
		const status = Object.values(StatusType).find((type) => STATUS_COLORS[type] === color);
		return ` class="afd-status-${status}${bold ? ' afd-bold' : ''}"`;
	});
}

function classNames(html: string): string[] {
	return tags(html).flatMap((tag) => tag.match(/ class="([^"]*)"/)?.[1]?.split(' ') ?? []);
}

describe('styling', () => {
	describe('styledSpan', () => {
		it.each(Object.values(StatusType))('writes the %s class and no style', (status) => {
			expect(styledSpan('text', status, false, 'classes')).toBe(
				`<span class="afd-status-${status}">text</span>`
			);
		});

		it('adds afd-bold for a bold span', () => {
			expect(styledSpan('text', StatusType.SUCCESS, true, 'classes')).toBe(
				'<span class="afd-status-success afd-bold">text</span>'
			);
		});

		it('escapes the text', () => {
			expect(styledSpan('<b>', StatusType.INFO, false, 'classes')).toBe(
				'<span class="afd-status-info">&lt;b&gt;</span>'
			);
		});

		it.each(['unknown', '__proto__', 'toString', '"><img src=x onerror="x()'])(
			'renders the unknown status %s as neutral, so it never reaches the attribute',
			(status) => {
				expect(styledSpan('text', status as StatusTypeValue, false, 'classes')).toBe(
					'<span class="afd-status-neutral">text</span>'
				);
			}
		);

		it('keeps the inline output by default', () => {
			expect(styledSpan('text', StatusType.SUCCESS, true)).toBe(
				'<span style="color: var(--afd-success, #22c55e); font-weight: bold;">text</span>'
			);
			expect(styledSpan('text', StatusType.SUCCESS, true, 'inline')).toBe(
				styledSpan('text', StatusType.SUCCESS, true)
			);
		});
	});

	describe.each(RENDERS)('%s', (_name, render) => {
		it('has no style attribute under classes', () => {
			const html = render({ styling: 'classes' });

			expect(classNames(html).length).toBeGreaterThan(0);
			for (const tag of tags(html)) {
				expect(tag).not.toMatch(/\sstyle\s*=/i);
			}
		});

		it('has only attributes the adapter writes under classes', () => {
			for (const tag of tags(render({ styling: 'classes' }))) {
				expect(tag).toMatch(/^<(\/?pre|\/span|br|span class="afd-status-[a-z]+( afd-bold)?")>$/);
			}
		});

		// The snapshot was captured from the renderers as they were before `styling` existed.
		it('leaves the default output unchanged', () => {
			const html = render();

			expect(html).toMatchSnapshot();
			expect(render({ styling: 'inline' })).toBe(html);
		});

		it('differs from the inline output only in how each span is styled', () => {
			expect(render({ styling: 'classes' })).toBe(asClasses(render()));
		});
	});

	it('covers every renderer', () => {
		const covered = RENDERS.map(([name]) => name.split(',')[0]);

		expect(new Set(covered)).toEqual(new Set(Object.keys(WebAdapter)));
	});

	it('keeps the other options beside styling', () => {
		const html = WebAdapter.renderCommandResult(
			{ success: true, data: PACKAGES },
			{ styling: 'classes', showFailureOutput: false }
		);

		expect(html).toContain('afd-status-failure');
		expect(html).not.toContain('afd-status-muted');
	});

	describe('css/afd-theme.css', () => {
		const css = readFileSync(new URL('../css/afd-theme.css', import.meta.url), 'utf8');
		const rule = (selector: string) =>
			new RegExp(`(?:^|\\n)\\${selector} \\{\\n\\t([^}]*);\\n\\}`).exec(css)?.[1];

		it.each(Object.values(StatusType))('gives %s the colour of the inline output', (status) => {
			expect(rule(`.afd-status-${status}`)).toBe(`color: ${STATUS_COLORS[status]}`);
		});

		it('defines afd-bold as the inline output does', () => {
			expect(rule('.afd-bold')).toBe('font-weight: bold');
		});

		it.each(RENDERS)('defines every class %s writes', (_name, render) => {
			for (const name of classNames(render({ styling: 'classes' }))) {
				expect(rule(`.${name}`)).toBeDefined();
			}
		});
	});
});
