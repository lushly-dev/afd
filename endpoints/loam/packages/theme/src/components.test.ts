import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { checkTheme, compareComponentExport, sourceFiles } from './check.js';
import {
	compareInterface,
	findFallbacks,
	fixFallbacks,
	lightValuesByProperty,
	normalizeLiteral,
	scanFallbacks,
} from './components.js';
import { buildOutputs } from './outputs.js';
import { THEMES, themeNode } from './tree/index.js';

const outputs = await buildOutputs();
const contractUrl = new URL('../contract/tokens.json', import.meta.url);
const lightValues = lightValuesByProperty(outputs.componentExport, outputs.contract);
const componentIds = Object.entries(outputs.contract.tokens)
	.filter(([, entry]) => entry.kind === 'component')
	.map(([id]) => id)
	.sort();

/** A token interface listing `ids` as the contract has them. */
const interfaceOf = (ids: string[]) => ({
	contractVersion: 1,
	tokens: Object.fromEntries(
		ids.map((id) => {
			const { property, type } = outputs.contract.tokens[id] as { property: string; type: string };
			return [id, { property, type }];
		})
	),
});

/** The sizes of section 5.2, as the kernel's `LAYOUT_DEFAULTS_V0` gives them. */
const layoutDefaults = {
	sidebar: { default: 260, min: 200, max: 480 },
	inspector: { default: 300, min: 240, max: 520 },
	panel: { default: 240, min: 120 },
	mainMin: 360,
};

describe('the component token export (2.4)', () => {
	it('holds every component id, and no shell id, per theme at comfortable density', () => {
		const { componentExport } = outputs;
		expect(componentExport.contractVersion).toBe(1);
		expect(componentExport.source).toBe('loam');
		expect(Object.keys(componentExport.presets)).toEqual([...THEMES]);
		for (const theme of THEMES) {
			const tokens = componentExport.presets[theme];
			expect(tokens.map((token) => token.id)).toEqual(componentIds);
			const node = outputs.resolved.nodes.get(themeNode(theme));
			for (const { id, value } of tokens) expect(value).toBe(node?.get(id));
		}
		expect(JSON.parse(outputs.componentExportJson)).toEqual(componentExport);
	});

	it('maps each custom property to its light value', () => {
		expect(lightValues.size).toBe(componentIds.length);
		expect(lightValues.get('--violet-color-text-muted')).toBe('#5e6460');
		expect(lightValues.has('--violet-shell-size-titlebar')).toBe(false);
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
			'a { color: var(--violet-color-text-primary, #18181B);',
			'  box-shadow: var(--violet-shadow-card, 0 1px 2px rgba(1, 2, 3, 0.1),',
			'    0 5px 10px rgba(1, 2, 3, 0.2));',
			'  border: var(--violet-color-border-subtle, var(--violet-color-border-strong, #fff));',
			'  padding: var(--violet-space-inline-sm, ${gap});',
			'  margin: var(--violet-space-inline-md); }',
		].join('\n');
		expect(
			findFallbacks(text).map(({ property, literal, line }) => [property, literal, line])
		).toEqual([
			['--violet-color-text-primary', '#18181B', 1],
			[
				'--violet-shadow-card',
				'0 1px 2px rgba(1, 2, 3, 0.1),\n    0 5px 10px rgba(1, 2, 3, 0.2)',
				2,
			],
			['--violet-color-border-strong', '#fff', 4],
		]);
		expect(findFallbacks('var(--violet-color-text-primary, #fff')).toEqual([]);
	});

	it('reports and rewrites only component fallbacks that differ from light', () => {
		const text = [
			'color: var(--violet-color-text-primary, #18181B);',
			'color: var(--violet-color-text-muted, #6b7280);',
			'radius: var(--violet-radius-md,  8px );',
			'local: var(--_private, 9px);',
			'shell: var(--violet-shell-size-titlebar, 99px);',
		].join('\n');
		const mismatches = scanFallbacks([{ path: 'a.ts', text }], lightValues);
		expect(
			mismatches.map(({ path, line, property, expected }) => [path, line, property, expected])
		).toEqual([
			['a.ts', 1, '--violet-color-text-primary', '#181b1a'],
			['a.ts', 2, '--violet-color-text-muted', '#5e6460'],
		]);
		const fixed = fixFallbacks(text, lightValues);
		expect(fixed).toBe(text.replace('#18181B', '#181b1a').replace('#6b7280', '#5e6460'));
		expect(scanFallbacks([{ path: 'a.ts', text: fixed }], lightValues)).toEqual([]);
	});

	it('reports and repairs drifted private-alias, hook, and sibling-style fallbacks', () => {
		const defaults = [
			'export const violetSurfaceTokenDefaults: ElementStyles = css`',
			'  :host {',
			'    --_text-primary: var(--violet-color-text-primary, #181b1a);',
			'    --_surface-subtle: var(--violet-color-surface-subtle, #e9e5de);',
			'  }',
			'`;',
		].join('\n');
		const styles = [
			'export const cardStyles = css`',
			'  :host { --_style-muted: var(--violet-color-text-muted, #5e6460); }',
			'`;',
		].join('\n');
		const component = [
			'import { cardStyles } from "./card.styles";',
			'const styles = css`',
			'  ${violetSurfaceTokenDefaults}',
			'  ${cardStyles}',
			'  :host { --_local-ink: var(--_text-primary); }',
			'  .a { color: var(--_text-primary, #1c1a0d); }',
			'  .b { background: var(--_surface-subtle, rgba(28, 26, 13, 0.04)); }',
			'  .c { color: var(--_local-ink, #1c1a0d); }',
			'  .d { color: var(--_style-muted, #6b7280); }',
			'  .e { color: var(--_text-link, #c42a1a); border-radius: var(--_radius-round, 6px); }',
			'  .ok { color: var(--_text-primary, #181b1a); }',
			'`;',
		].join('\n');
		const files = [
			{ path: 'theme/violet-token-defaults.ts', text: defaults },
			{ path: 'card/card.styles.ts', text: styles },
			{ path: 'card/card.ts', text: component },
		];
		const mismatches = scanFallbacks(files, lightValues);
		expect(
			mismatches.map(({ path, line, property, literal, expected }) => [
				path,
				line,
				property,
				literal,
				expected,
			])
		).toEqual([
			['card/card.ts', 6, '--_text-primary', '#1c1a0d', '#181b1a'],
			['card/card.ts', 7, '--_surface-subtle', 'rgba(28, 26, 13, 0.04)', '#e9e5de'],
			['card/card.ts', 8, '--_local-ink', '#1c1a0d', '#181b1a'],
			['card/card.ts', 9, '--_style-muted', '#6b7280', '#5e6460'],
			['card/card.ts', 10, '--_text-link', '#c42a1a', '#1b5f80'],
			['card/card.ts', 10, '--_radius-round', '6px', '9999px'],
		]);
		const fixed = fixFallbacks(component, lightValues, mismatches);
		expect(
			scanFallbacks(
				[
					{ path: 'theme/violet-token-defaults.ts', text: defaults },
					{ path: 'card/card.styles.ts', text: styles },
					{ path: 'card/card.ts', text: fixed },
				],
				lightValues
			)
		).toEqual([]);
	});

	it('handles multi-binding aliases without false positives and marks mismatches ambiguous', () => {
		const grid = [
			'const styles = css`',
			'  :host { --_row-size: var(--violet-size-target-natural); }',
			'  :host([density="compact"]) { --_row-size: var(--violet-size-target-compact); }',
			'  :host([density="comfortable"]) { --_row-size: var(--violet-size-target-comfortable); }',
			'  .default { block-size: var(--_row-size, 32px); }',
			'  .compact { block-size: var(--_row-size, 24px); }',
			'  .wrong { block-size: var(--_row-size, 18px); }',
			'`;',
		].join('\n');
		const mismatches = scanFallbacks([{ path: 'grid/grid.ts', text: grid }], lightValues);
		expect(mismatches).toHaveLength(1);
		expect(mismatches[0]).toMatchObject({
			path: 'grid/grid.ts',
			line: 7,
			property: '--_row-size',
			literal: '18px',
			expected: '32px | 24px | 44px',
			ambiguous: true,
		});
		// Ambiguous mismatches are left untouched by automated repair.
		expect(fixFallbacks(grid, lightValues, mismatches)).toBe(grid);
	});
});

describe("violet-elements' token interface", () => {
	it('fails on an id the tree lacks, a shell id, or a different property or type', () => {
		const wanted = interfaceOf(['color.text.muted']);
		expect(compareInterface(wanted, outputs.contract)).toEqual([]);
		const errors = compareInterface(
			{
				contractVersion: 2,
				tokens: {
					...wanted.tokens,
					'color.brand.glow': { property: '--color-brand-glow', type: 'color' },
					'shell.size.sidebar.default': {
						property: '--violet-shell-size-sidebar-default',
						type: 'dimension',
					},
					'radius.sm': { property: '--violet-radius-sm', type: 'number' },
				},
			},
			outputs.contract
		);
		expect(errors).toHaveLength(3);
		expect(errors[0]).toMatch(/contractVersion 2\) lists 'color\.brand\.glow'/);
		expect(errors[1]).toMatch(/'shell\.size\.sidebar\.default', which Loam's tree does not supply/);
		expect(errors[2]).toBe(
			"interface.json lists 'radius.sm' as --violet-radius-sm (number), Loam's contract as --violet-radius-sm (dimension)"
		);
		expect(compareInterface({ tokens: {} }, outputs.contract)).toHaveLength(1);
	});
});

describe('theme:check with the component paths', () => {
	const roots: string[] = [];
	afterAll(async () => {
		await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
	});
	const fixture = async (
		source: string,
		exportJson = outputs.componentExportJson,
		interfaceJson = JSON.stringify(interfaceOf(['color.text.muted', 'font.family.body']))
	) => {
		const root = await mkdtemp(join(tmpdir(), 'loam-theme-components-'));
		roots.push(root);
		await mkdir(join(root, 'src', 'button'), { recursive: true });
		await writeFile(join(root, 'export.json'), exportJson);
		await writeFile(join(root, 'interface.json'), interfaceJson);
		await writeFile(join(root, 'src', 'button', 'button.ts'), source);
		await writeFile(
			join(root, 'src', 'button', 'button.spec.ts'),
			'var(--violet-color-text-muted, #000000)'
		);
		await writeFile(join(root, 'src', 'notes.md'), 'var(--violet-color-text-muted, #000000)');
		return {
			interfacePath: pathToFileURL(join(root, 'interface.json')),
			exportPath: pathToFileURL(join(root, 'export.json')),
			sourceDirectory: pathToFileURL(`${join(root, 'src')}/`),
		};
	};

	it('passes when the export matches and every fallback is the light value', async () => {
		const components = await fixture('var(--violet-color-text-muted, #5e6460)');
		expect((await sourceFiles(components.sourceDirectory)).map((file) => file.path)).toEqual([
			'button/button.ts',
		]);
		const report = await checkTheme(contractUrl, { outputs, components, layoutDefaults });
		expect(report.errors).toEqual([]);
		expect(report.notes).toEqual([]);
	});

	it('fails on a drifted fallback and on a stale export', async () => {
		const components = await fixture('var(--violet-color-text-muted, #6b7280)', '{}\n');
		const { errors } = await checkTheme(contractUrl, { outputs, components, layoutDefaults });
		expect(errors.some((error) => /contractVersion undefined/.test(error))).toBe(true);
		expect(errors).toContain(
			'violet-elements/src/button/button.ts:1: var(--violet-color-text-muted, #6b7280) differs from the light value #5e6460'
		);
		expect(errors.at(-1)).toMatch(/^1 fallbacks differ from the light theme/);
	});

	it('fails when the tree does not supply an interface id', async () => {
		const components = await fixture(
			'var(--violet-color-text-muted, #5e6460)',
			outputs.componentExportJson,
			JSON.stringify({
				contractVersion: 1,
				tokens: { 'color.brand.glow': { property: '--color-brand-glow', type: 'color' } },
			})
		);
		const { errors } = await checkTheme(contractUrl, { outputs, components, layoutDefaults });
		expect(errors).toEqual([expect.stringMatching(/lists 'color\.brand\.glow'/)]);
	});

	it('reports a source directory it cannot read', async () => {
		const components = await fixture('');
		const missing = {
			...components,
			sourceDirectory: new URL('missing/', components.sourceDirectory),
		};
		const { errors } = await checkTheme(contractUrl, {
			outputs,
			components: missing,
			layoutDefaults,
		});
		expect(errors).toEqual([expect.stringMatching(/^violet-elements\/src cannot be read/)]);
	});
});
