import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTheme, compareContract, compareLayoutDefaults, compareNodeIds } from './check.js';
import { contrastRatio, parseColor } from './contrast.js';
import { buildOutputs, cssProperty, type ResolvedTree, renderContract } from './outputs.js';
import { CONTRAST_FLOORS, CONTRAST_PAIRS } from './pairs.js';
import {
	COMPONENT_TOKENS,
	compactNode,
	NODE_IDS,
	ROOT_NODE,
	SHELL_TOKENS,
	TARGET_IDS,
	THEMES,
	themeNode,
} from './tree/index.js';

const outputs = await buildOutputs();
const { resolved } = outputs;
const contractUrl = new URL('../contract/tokens.json', import.meta.url);
const committed = JSON.parse(readFileSync(contractUrl, 'utf8'));
const tokens = (nodeId: string) => {
	const node = resolved.nodes.get(nodeId);
	if (!node) throw new Error(`no node ${nodeId}`);
	return node;
};
const value = (nodeId: string, id: string) => {
	const found = tokens(nodeId).get(id);
	if (found === undefined) throw new Error(`no ${id} in ${nodeId}`);
	return found;
};
const px = (text: string) => {
	const match = /^(\d+(?:\.\d+)?)px$/.exec(text);
	if (!match) throw new Error(`not a px length: ${text}`);
	return Number(match[1]);
};

describe("Loam's Violet tree", () => {
	it('has the seven nodes of 2.2 and no broken reference', () => {
		expect(NODE_IDS).toEqual([
			'loam',
			'loam/light',
			'loam/dark',
			'loam/high-contrast',
			'loam/light/compact',
			'loam/dark/compact',
			'loam/high-contrast/compact',
		]);
		expect(resolved.brokenReferences).toEqual([]);
	});

	it('resolves, less ref.*, to exactly the contract in every node', () => {
		const contractIds = Object.keys(committed.tokens).sort();
		for (const nodeId of NODE_IDS) expect([...tokens(nodeId).keys()].sort()).toEqual(contractIds);
		expect(Object.keys(committed.tokens)).toHaveLength(108 + SHELL_TOKENS.length);
		expect(COMPONENT_TOKENS).toHaveLength(108);
		for (const id of contractIds) expect(id.startsWith('ref.')).toBe(false);
	});

	it('keeps the component ids and their property scheme', () => {
		expect(committed.tokens['color.surface.page'].property).toBe('--color-surface-page');
		expect(committed.tokens['z-index.toast']).toEqual({
			property: '--z-index-toast',
			type: 'number',
			kind: 'component',
		});
		expect(committed.tokens['shell.size.sidebar.default']).toEqual({
			property: '--shell-size-sidebar-default',
			type: 'dimension',
			kind: 'shell',
		});
		for (const [id, entry] of Object.entries<{ property: string }>(committed.tokens))
			expect(entry.property).toBe(cssProperty(id));
	});

	it('starts light from the registry, with two values raised to meet the floors', () => {
		const light = themeNode('light');
		expect(value(light, 'color.surface.page')).toBe('#FFFEFA');
		expect(value(light, 'color.action.primary.background')).toBe('#C84F3B');
		expect(value(light, 'color.field.border.focus')).toBe('rgba(24, 24, 27, 0.5)');
		expect(value(light, 'type.title.md.weight')).toBe('600');
		expect(value(light, 'space.layout.md')).toBe('24px');
		expect(value(light, 'color.text.muted')).toBe('#616775');
		expect(value(light, 'color.border.strong')).toBe('rgba(28, 26, 13, 0.48)');
		expect(value(themeNode('dark'), 'color.surface.page')).toBe('#161713');
		expect(value(themeNode('dark'), 'color.border.strong')).toBe('rgba(255, 248, 235, 0.37)');
	});

	it('gives the shell its sizes, 3px focus in high contrast only', () => {
		expect(value(themeNode('light'), 'shell.size.titlebar')).toBe('40px');
		expect(value(themeNode('light'), 'shell.size.focus')).toBe('2px');
		expect(value(themeNode('dark'), 'shell.size.focus')).toBe('2px');
		expect(value(themeNode('high-contrast'), 'shell.size.focus')).toBe('3px');
		expect(value(compactNode('high-contrast'), 'shell.size.focus')).toBe('3px');
		expect(value(themeNode('light'), 'shell.color.handle.active')).toBe(
			value(themeNode('light'), 'color.focus.ring')
		);
	});

	it('replaces shadows with borders in high contrast', () => {
		for (const id of ['shadow.control', 'shadow.card', 'shadow.floating'])
			expect(value(themeNode('high-contrast'), id)).toMatch(/^0 0 0 [12]px #000000$/);
	});

	it('changes only density in compact, and never takes a target below 24px', () => {
		const densityIds =
			/^(size\.space|space\.(inline|stack)|size\.target|shell\.size\.(titlebar|statusbar|rail|tabbar))(\.|$)/;
		for (const theme of THEMES) {
			const base = tokens(themeNode(theme));
			const compact = tokens(compactNode(theme));
			const changed = [...compact].filter(([id, text]) => base.get(id) !== text).map(([id]) => id);
			expect(changed.length).toBeGreaterThan(0);
			for (const id of changed) expect(id).toMatch(densityIds);
			for (const id of TARGET_IDS)
				expect(px(value(compactNode(theme), id))).toBeGreaterThanOrEqual(24);
			expect(px(value(compactNode(theme), 'shell.size.titlebar'))).toBeLessThan(
				px(value(themeNode(theme), 'shell.size.titlebar'))
			);
		}
	});
});

describe('contrast', () => {
	it('reads the color forms the tree uses', () => {
		expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
		expect(parseColor('#18181B')).toEqual([24, 24, 27, 1]);
		expect(parseColor('rgba(28, 26, 13, 0.10)')).toEqual([28, 26, 13, 0.1]);
		expect(contrastRatio('#000000', '#FFFFFF', '#FFFFFF')).toBeCloseTo(21, 5);
		expect(contrastRatio('#FFFFFF', '#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
		expect(() => parseColor('oklch(0.5 0.1 20)')).toThrow(/Not a color/);
	});

	for (const theme of THEMES) {
		const nodeId = themeNode(theme);
		const pairs = CONTRAST_PAIRS.filter((pair) => !pair.themes || pair.themes.includes(theme));
		it(`meets the floors in ${theme} (${pairs.length} pairs)`, () => {
			const backdrop = value(nodeId, 'color.surface.page');
			const failures = pairs.flatMap((pair) => {
				const ratio = contrastRatio(
					value(nodeId, pair.foreground),
					value(nodeId, pair.background),
					backdrop
				);
				const floor = CONTRAST_FLOORS[theme][pair.kind];
				return ratio >= floor
					? []
					: [`${pair.foreground} on ${pair.background}: ${ratio.toFixed(2)} < ${floor}`];
			});
			expect(failures).toEqual([]);
		});
	}

	it('names every pair the design names', () => {
		const named = (foreground: string, background: string) =>
			CONTRAST_PAIRS.some(
				(pair) => pair.foreground === foreground && pair.background === background
			);
		expect(named('color.text.primary', 'color.surface.page')).toBe(true);
		expect(named('color.action.primary.text', 'color.action.primary.background')).toBe(true);
		expect(named('color.border.strong', 'color.surface.card')).toBe(true);
		expect(named('color.focus.ring', 'color.surface.subtle')).toBe(true);
	});
});

describe('exports', () => {
	const css = outputs.files['loam-theme.css'];
	const rule = (selector: string) => {
		const start = css.indexOf(`${selector} {`);
		expect(start).toBeGreaterThanOrEqual(0);
		return css.slice(start, css.indexOf('}', start));
	};

	it('writes the light block with every token and override diffs for the rest', () => {
		const light = rule(':root,\n[data-loam-theme="light"]');
		expect(light.match(/^\t--/gm)).toHaveLength(tokens(ROOT_NODE).size);
		expect(light).not.toContain('--ref-');
		const dark = rule('[data-loam-theme="dark"]');
		expect(dark).toContain('\t--color-surface-page: #161713;');
		expect(dark).not.toContain('--size-space-md');
		expect(dark).not.toContain('--color-action-primary-background');
		const contrast = rule('[data-loam-theme="high-contrast"]');
		expect(contrast).toContain('\t--shell-size-focus: 3px;');
		// field.* references follow their targets, so their resolved values differ too.
		expect(contrast).toContain('\t--color-field-text: #000000;');
		for (const theme of THEMES) {
			const compact = rule(`[data-loam-theme="${theme}"][data-loam-density="compact"]`);
			expect(compact).toContain('\t--size-target-natural: 28px;');
			expect(compact).not.toContain('--color-');
		}
		expect(css.match(/\{$/gm)).toHaveLength(6);
	});

	it('writes every node as Token[] with resolved values', () => {
		const json = JSON.parse(outputs.files['loam-theme.json']);
		expect(json.contractVersion).toBe(1);
		expect(Object.keys(json.nodes)).toEqual(NODE_IDS);
		const dark = json.nodes['loam/dark'] as { id: string; value: string }[];
		expect(dark).toContainEqual({ id: 'color.action.secondary.text', value: '#F5EFE3' });
		expect(dark.some((token) => token.id.startsWith('ref.'))).toBe(false);
		expect(outputs.files['contract.json']).toBe(readFileSync(contractUrl, 'utf8'));
	});

	it('is deterministic', async () => {
		expect((await buildOutputs()).files).toEqual(outputs.files);
	});
});

describe('theme:check', () => {
	it('passes on the committed contract with the sizes of 5.2', async () => {
		const layoutDefaults = {
			sidebar: { default: 260, min: 200, max: 480 },
			inspector: { default: 300, min: 240, max: 520 },
			panel: { default: 240, min: 120 },
			mainMin: 360,
		};
		const report = await checkTheme(contractUrl, { outputs, layoutDefaults });
		expect(report.errors).toEqual([]);
		expect(report.notes).toEqual([expect.stringMatching(/^Skipped the component export/)]);
	});

	it('fails without the kernel constant', async () => {
		const report = await checkTheme(contractUrl, { outputs });
		expect(report.errors).toEqual([expect.stringMatching(/^LAYOUT_DEFAULTS_V0 is missing/)]);
	});

	it('fails when the kernel it is given disagrees with the tree', async () => {
		const layoutDefaults = {
			sidebar: { default: 260, min: 200, max: 480 },
			inspector: { default: 300, min: 240, max: 520 },
			panel: { default: 240, min: 120 },
			mainMin: 400,
		};
		const report = await checkTheme(contractUrl, { outputs, layoutDefaults });
		expect(report.notes).toEqual([expect.stringMatching(/^Skipped the component export/)]);
		expect(report.errors).toHaveLength(NODE_IDS.length);
	});

	it('fails when the contract and the tree disagree', () => {
		const built = renderContract(resolved);
		const missing = structuredClone(built);
		delete missing.tokens['color.surface.page'];
		expect(compareContract(missing, built)).toEqual([
			expect.stringMatching(/^'color\.surface\.page' is in the tree but not in the contract/),
		]);
		const extra = structuredClone(built);
		extra.tokens['color.surface.gone'] = {
			property: '--color-surface-gone',
			type: 'color',
			kind: 'component',
		};
		expect(compareContract(extra, built)).toEqual([
			expect.stringMatching(/^'color\.surface\.gone' is in the contract but not in the tree/),
		]);
		const retyped = structuredClone(built);
		retyped.tokens['radius.sm'] = { property: '--radius-sm', type: 'number', kind: 'component' };
		expect(compareContract(retyped, built)).toHaveLength(1);
		expect(compareContract([], built)).toHaveLength(1);
	});

	it('fails when a node has an id the contract lacks, as a misspelt override would', () => {
		const built = renderContract(resolved);
		expect(compareNodeIds(resolved, built)).toEqual([]);
		const dark = new Map(tokens(themeNode('dark')));
		dark.set('color.surface.pagee', '#161713');
		const misspelt: ResolvedTree = {
			...resolved,
			nodes: new Map([...resolved.nodes, [themeNode('dark'), dark]]),
		};
		expect(compareNodeIds(misspelt, built)).toEqual([
			"'color.surface.pagee' is in loam/dark but not in the contract; is an override misspelt?",
		]);
	});

	it('compares the shell sizes with LAYOUT_DEFAULTS_V0 of 5.2', () => {
		const spec = {
			sidebar: { default: 260, min: 200, max: 480 },
			inspector: { default: 300, min: 240, max: 520 },
			panel: { default: 240, min: 120 },
			mainMin: 360,
		};
		expect(compareLayoutDefaults(resolved, spec)).toEqual([]);
		const drifted = { ...spec, sidebar: { ...spec.sidebar, max: 500 } };
		const errors = compareLayoutDefaults(resolved, drifted);
		expect(errors).toHaveLength(NODE_IDS.length);
		expect(errors[0]).toMatch(
			/shell\.size\.sidebar\.max is 480px in loam, but .*sidebar\.max is 500/
		);
		expect(compareLayoutDefaults(resolved, {})).toHaveLength(9);
	});

	it('reports a broken reference', async () => {
		const broken: ResolvedTree = {
			...resolved,
			brokenReferences: [{ nodeId: 'loam', tokenId: 'color.x', message: 'not found' }],
		};
		const report = await checkTheme(contractUrl, { outputs: { ...outputs, resolved: broken } });
		expect(report.errors[0]).toBe('color.x in loam: not found');
	});
});
