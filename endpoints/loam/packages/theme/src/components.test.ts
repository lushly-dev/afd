import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { checkTheme, compareComponentExport, sourceFiles } from './check.js';
import {
	findFallbacks,
	fixFallbacks,
	lightValuesByProperty,
	normalizeLiteral,
	scanFallbacks,
} from './components.js';
import { buildOutputs } from './outputs.js';
import { COMPONENT_TOKENS, THEMES, themeNode } from './tree/index.js';

const outputs = await buildOutputs();
const contractUrl = new URL('../contract/tokens.json', import.meta.url);
const lightValues = lightValuesByProperty(outputs.componentExport, outputs.contract);

describe('the component token export (2.4)', () => {
	it('holds every component id, and no shell id, per theme at comfortable density', () => {
		const { componentExport } = outputs;
		expect(componentExport.contractVersion).toBe(1);
		expect(componentExport.source).toBe('loam');
		expect(Object.keys(componentExport.presets)).toEqual([...THEMES]);
		const componentIds = COMPONENT_TOKENS.map((token) => token.id).sort();
		for (const theme of THEMES) {
			const tokens = componentExport.presets[theme];
			expect(tokens.map((token) => token.id)).toEqual(componentIds);
			const node = outputs.resolved.nodes.get(themeNode(theme));
			for (const { id, value } of tokens) expect(value).toBe(node?.get(id));
		}
		expect(JSON.parse(outputs.componentExportJson)).toEqual(componentExport);
	});

	it('maps each custom property to its light value', () => {
		expect(lightValues.size).toBe(COMPONENT_TOKENS.length);
		expect(lightValues.get('--color-text-muted')).toBe('#616775');
		expect(lightValues.has('--shell-size-titlebar')).toBe(false);
	});

	it('compares the committed export byte for byte, naming what differs', () => {
		expect(compareComponentExport(outputs.componentExportJson, outputs)).toEqual([]);
		const changed = structuredClone(outputs.componentExport);
		const muted = changed.presets.dark.find((token) => token.id === 'color.text.muted');
		if (muted) muted.value = '#000000';
		const errors = compareComponentExport(JSON.stringify(changed), outputs);
		expect(errors[0]).toMatch(/color\.text\.muted "#000000" in dark/);
		expect(errors.at(-1)).toMatch(/theme:export-components/);
		expect(compareComponentExport(JSON.stringify(outputs.componentExport), outputs)[0]).toMatch(
			/not the generated formatting/
		);
		expect(compareComponentExport('{', outputs)[0]).toMatch(/is not JSON/);
		const extra = {
			...outputs.componentExport,
			presets: { ...outputs.componentExport.presets, sepia: [] },
		};
		expect(compareComponentExport(JSON.stringify(extra), outputs)).toContain(
			"violet-theme.export.json has a preset 'sepia' that the tree does not"
		);
		const broken = {
			...outputs.componentExport,
			presets: { ...outputs.componentExport.presets, dark: {} },
		};
		expect(compareComponentExport(JSON.stringify(broken), outputs)).toContain(
			'violet-theme.export.json has no dark preset list'
		);
	});
});

describe('the fallback scan (2.4)', () => {
	it('normalizes hex case and whitespace only', () => {
		expect(normalizeLiteral('  #FFFEFA ')).toBe('#fffefa');
		expect(normalizeLiteral('0 1px\n\t  2px rgba(0, 0, 0, 0.1)')).toBe(
			'0 1px 2px rgba(0, 0, 0, 0.1)'
		);
		expect(normalizeLiteral('rgba(0,0,0,0.1)')).not.toBe(normalizeLiteral('rgba(0, 0, 0, 0.1)'));
	});

	it('finds literal fallbacks, with nested parentheses, and skips non-literals', () => {
		const text = [
			'a { color: var(--color-text-primary, #18181B);',
			'  box-shadow: var(--shadow-card, 0 1px 2px rgba(1, 2, 3, 0.1),',
			'    0 5px 10px rgba(1, 2, 3, 0.2));',
			'  border: var(--color-border-subtle, var(--color-border-strong, #fff));',
			'  padding: var(--space-inline-sm, ${gap});',
			'  margin: var(--space-inline-md); }',
		].join('\n');
		expect(
			findFallbacks(text).map(({ property, literal, line }) => [property, literal, line])
		).toEqual([
			['--color-text-primary', '#18181B', 1],
			['--shadow-card', '0 1px 2px rgba(1, 2, 3, 0.1),\n    0 5px 10px rgba(1, 2, 3, 0.2)', 2],
			['--color-border-strong', '#fff', 4],
		]);
		expect(findFallbacks('var(--color-text-primary, #fff')).toEqual([]);
	});

	it('reports and rewrites only component fallbacks that differ from light', () => {
		const text = [
			'color: var(--color-text-primary, #18181B);',
			'color: var(--color-text-muted, #6b7280);',
			'radius: var(--radius-md,  8px );',
			'local: var(--_private, 9px);',
			'shell: var(--shell-size-titlebar, 99px);',
		].join('\n');
		const mismatches = scanFallbacks([{ path: 'a.ts', text }], lightValues);
		expect(
			mismatches.map(({ path, line, property, expected }) => [path, line, property, expected])
		).toEqual([
			['a.ts', 2, '--color-text-muted', '#616775'],
			['a.ts', 3, '--radius-md', '4px'],
		]);
		const fixed = fixFallbacks(text, lightValues);
		expect(fixed).toBe(
			text
				.replace('#6b7280', '#616775')
				.replace('var(--radius-md,  8px )', 'var(--radius-md,  4px )')
		);
		expect(scanFallbacks([{ path: 'a.ts', text: fixed }], lightValues)).toEqual([]);
	});
});

describe('theme:check with the component paths', () => {
	const roots: string[] = [];
	afterAll(async () => {
		await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
	});
	const fixture = async (source: string, exportJson = outputs.componentExportJson) => {
		const root = await mkdtemp(join(tmpdir(), 'loam-theme-components-'));
		roots.push(root);
		await mkdir(join(root, 'src', 'button'), { recursive: true });
		await writeFile(join(root, 'export.json'), exportJson);
		await writeFile(join(root, 'src', 'button', 'button.ts'), source);
		await writeFile(join(root, 'src', 'notes.md'), 'var(--color-text-muted, #000000)');
		return {
			exportPath: pathToFileURL(join(root, 'export.json')),
			sourceDirectory: pathToFileURL(`${join(root, 'src')}/`),
		};
	};

	it('passes when the export matches and every fallback is the light value', async () => {
		const components = await fixture('var(--color-text-muted, #616775)');
		expect((await sourceFiles(components.sourceDirectory)).map((file) => file.path)).toEqual([
			'button/button.ts',
		]);
		const layoutDefaults = {
			sidebar: { default: 260, min: 200, max: 480 },
			inspector: { default: 300, min: 240, max: 520 },
			panel: { default: 240, min: 120 },
			mainMin: 360,
		};
		const report = await checkTheme(contractUrl, { outputs, components, layoutDefaults });
		expect(report.errors).toEqual([]);
		expect(report.notes).toEqual([]);
	});

	it('fails on a drifted fallback and on a stale export', async () => {
		const components = await fixture('var(--color-text-muted, #6b7280)', '{}\n');
		const { errors } = await checkTheme(contractUrl, { outputs, components });
		expect(errors.some((error) => /contractVersion undefined/.test(error))).toBe(true);
		expect(errors).toContain(
			'violet-elements/src/button/button.ts:1: var(--color-text-muted, #6b7280) differs from the light value #616775'
		);
		expect(errors.at(-1)).toMatch(/^1 fallbacks differ from the light theme/);
	});

	it('reports a source directory it cannot read', async () => {
		const components = await fixture('');
		const missing = {
			...components,
			sourceDirectory: new URL('missing/', components.sourceDirectory),
		};
		const { errors } = await checkTheme(contractUrl, { outputs, components: missing });
		expect(errors).toEqual([expect.stringMatching(/^violet-elements\/src cannot be read/)]);
	});
});
