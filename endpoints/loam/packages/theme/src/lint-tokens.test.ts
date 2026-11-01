import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
	CHROME_PACKAGE,
	contractProperties,
	extractTaggedTemplates,
	type LintOptions,
	lintSource,
} from '../scripts/lint-tokens.mjs';

const corpus = new URL('../fixtures/lint-tokens/', import.meta.url);
const contract = JSON.parse(
	readFileSync(new URL('../contract/tokens.json', import.meta.url), 'utf8')
);
const properties = contractProperties(contract);
const STATE_PROPERTIES = ['--_sidebar-width', '--_inspector-width', '--_panel-height'];
const shared: LintOptions = { properties, allowShell: false };
const chrome: LintOptions = { properties, allowShell: true, stateProperties: STATE_PROPERTIES };

const lint = (path: string, options: LintOptions) =>
	lintSource(readFileSync(new URL(path, corpus), 'utf8'), path, options);
const rules = (path: string, options: LintOptions) =>
	lint(path, options).map((violation) => `${violation.line}:${violation.rule}`);

describe('the token-only lint corpus', () => {
	const cases: [string, LintOptions, LintOptions, string[]][] = [
		// [rule, options for pass, options for fail, the failing case's line:rule]
		['raw-color', shared, shared, ['2:raw-color', '3:raw-color', '4:raw-color', '5:raw-color']],
		['system-color', shared, shared, ['2:raw-color', '7:raw-color']],
		[
			'raw-length',
			shared,
			shared,
			['2:raw-length', '3:raw-length', '3:raw-length', '4:raw-length', '5:raw-length'],
		],
		['unknown-property', shared, shared, ['2:unknown-property', '3:unknown-property']],
		['private-alias', chrome, chrome, ['2:private-alias', '3:private-alias', '4:private-alias']],
		['primitive', shared, shared, ['2:primitive', '3:primitive']],
		['shell-token', chrome, shared, ['2:shell-token', '3:shell-token', '4:private-alias']],
	];
	for (const [rule, passOptions, failOptions, expected] of cases) {
		it(`${rule}: passes the passing case`, () => {
			expect(lint(`${rule}/pass.css`, passOptions)).toEqual([]);
		});
		it(`${rule}: fails the failing case`, () => {
			expect(rules(`${rule}/fail.css`, failOptions)).toEqual(expected);
		});
	}

	it('reads css tagged templates in TypeScript, nested ones too', () => {
		expect(lint('tagged-template/pass.ts', shared)).toEqual([]);
		expect(rules('tagged-template/fail.ts', shared)).toEqual([
			'8:raw-length',
			'9:raw-color',
			'11:raw-length',
		]);
		const [sheet] = extractTaggedTemplates('const a = css`a { b: ${c}; }`;');
		expect(sheet).toEqual({ css: 'a { b:     ; }', offset: 14 });
	});

	it('reports where and why', () => {
		const [violation] = lint('raw-color/fail.css', shared);
		expect(violation).toEqual({
			rule: 'raw-color',
			message: '#18181b is a raw color; use a color token',
			line: 2,
			column: 9,
		});
	});

	it('explains an alias with no source and one from nowhere apart', () => {
		const messages = lint('private-alias/fail.css', chrome).map((violation) => violation.message);
		expect(messages).toEqual([
			'--_other is neither declared in this stylesheet nor a state property',
			'--_inset is neither declared in this stylesheet nor a state property',
			'--_loop is not declared from a contract id',
		]);
	});

	it('does not let a shell alias launder a shell token outside the chrome', () => {
		const css = ':host { --_h: var(--shell-size-titlebar); block-size: var(--_h); }';
		expect(lintSource(css, 'x.css', shared).map((violation) => violation.rule)).toEqual([
			'shell-token',
			'private-alias',
		]);
		expect(lintSource(css, 'x.css', { ...shared, allowShell: true })).toEqual([]);
		expect(CHROME_PACKAGE).toBe('@lushly-dev/loam-chrome');
	});
});

describe('loam-lint-tokens', () => {
	const script = fileURLToPath(new URL('../scripts/lint-tokens.mjs', import.meta.url));
	const directory = mkdtempSync(join(tmpdir(), 'loam-lint-tokens-'));
	afterAll(() => rmSync(directory, { recursive: true, force: true }));
	const run = (name: string) => {
		writeFileSync(join(directory, 'package.json'), JSON.stringify({ name }));
		try {
			return {
				code: 0,
				output: execFileSync(process.execPath, [script, '*.css', '*.ts'], {
					cwd: directory,
					encoding: 'utf8',
					stdio: 'pipe',
				}),
			};
		} catch (error) {
			const failure = error as { status: number; stderr: string };
			return { code: failure.status, output: failure.stderr };
		}
	};

	it('lints the globs it is given, as the package in the working directory', () => {
		writeFileSync(join(directory, 'a.css'), ':host { block-size: var(--shell-size-titlebar); }');
		expect(run(CHROME_PACKAGE).code).toBe(0);
		const shared = run('@lushly-dev/loam-kernel');
		expect(shared.code).toBe(1);
		expect(shared.output).toContain('a.css:1:25 shell-token');
	});
});
