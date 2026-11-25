import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	exportTreeCommand,
	importTreeCommand,
	tokenOverrideCommand,
	tokensCatalogCommand,
} from '@lushly-dev/violet-afd/commands';
import { createMemoryDatabase } from '@lushly-dev/violet-core';
import { describe, expect, it } from 'vitest';
import { checkTheme, compareContract, compareLayoutDefaults, compareNodeIds } from './check.js';
import { contrastRatio, parseColor } from './contrast.js';
import { buildOutputs, cssProperty, type ResolvedTree, renderContract } from './outputs.js';
import { CONTRAST_FLOORS, CONTRAST_PAIRS } from './pairs.js';
import {
	buildLoamTree,
	compactNode,
	contractTypeOf,
	isPrimitive,
	NODE_IDS,
	ROOT_NODE,
	readLoamTreeFiles,
	TARGET_IDS,
	THEMES,
	type ThemeName,
	TREE_DIR,
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
		const entries = Object.values<{ kind: string }>(committed.tokens);
		const componentCount = entries.filter((entry) => entry.kind === 'component').length;
		const shellCount = entries.filter((entry) => entry.kind === 'shell').length;
		expect(componentCount).toBe(104);
		expect(shellCount).toBe(19);
		expect(contractIds).toHaveLength(componentCount + shellCount);
		for (const id of contractIds) expect(id.startsWith('ref.')).toBe(false);
	});

	it('keeps the component ids and their property scheme', () => {
		expect(committed.tokens['color.surface.page'].property).toBe('--violet-color-surface-page');
		expect(committed.tokens['z-index.toast']).toEqual({
			property: '--violet-z-index-toast',
			type: 'number',
			kind: 'component',
		});
		expect(committed.tokens['shell.size.sidebar.default']).toEqual({
			property: '--violet-shell-size-sidebar-default',
			type: 'dimension',
			kind: 'shell',
		});
		for (const [id, entry] of Object.entries<{ property: string }>(committed.tokens))
			expect(entry.property).toBe(cssProperty(id));
	});

	it("gives light and dark AFD's Refined values (D159)", () => {
		const light = themeNode('light');
		expect(value(light, 'color.surface.page')).toBe('#f4f0ea');
		expect(value(light, 'color.action.primary.background')).toBe('#181b1a');
		expect(value(light, 'color.field.border.focus')).toBe('#28769e');
		expect(value(light, 'color.control.selected.background')).toBe('#c0daeb');
		expect(value(light, 'type.heading.page.weight')).toBe('600');
		expect(value(light, 'type.label.size')).toBe('13px');
		expect(value(light, 'radius.control')).toBe('8px');
		expect(value(light, 'space.layout.page')).toBe('24px');
		expect(value(light, 'space.inline.hairline')).toBe('2px');
		expect(value(light, 'color.text.muted')).toBe('#5e6460');
		expect(value(light, 'color.border.strong')).toBe('#6b7d6e');
		expect(value(light, 'font.family.body')).toBe('"Inter", system-ui, sans-serif');
		expect(value(themeNode('dark'), 'color.surface.page')).toBe('#141515');
		expect(value(themeNode('dark'), 'color.action.primary.background')).toBe('#f4f0ea');
		// Neutral-400 meets 3:1 with margin on every dark surface.
		expect(value(themeNode('dark'), 'color.border.strong')).toBe('#999e9b');
	});

	it('gives the field borders the values the design document decided', () => {
		const expected: Record<ThemeName, [string, string, string]> = {
			light: ['#869089', '#48534b', '#c42a1a'],
			dark: ['#767b78', '#999e9b', '#ff897a'],
			'high-contrast': ['#595959', '#000000', '#A30000'],
		};
		for (const theme of THEMES)
			for (const node of [themeNode(theme), compactNode(theme)])
				expect(
					['', '.hover', '.invalid'].map((suffix) => value(node, `color.field.border${suffix}`))
				).toEqual(expected[theme]);
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
		// The field's well has its border and rule already, so its shadow draws nothing.
		expect(value(themeNode('high-contrast'), 'shadow.well')).toBe('inset 0 0 0 0 #000000');
	});

	it('gives the ids of interface version 2 their values: Space Grotesk and the well', () => {
		for (const theme of THEMES)
			expect(value(themeNode(theme), 'font.family.heading')).toBe(
				'"Space Grotesk", "Segoe UI", system-ui, sans-serif'
			);
		expect(value(themeNode('light'), 'shadow.well')).toBe(
			'inset 0 2px 3px -1px rgba(0, 0, 0, 0.1)'
		);
		expect(value(themeNode('dark'), 'shadow.well')).toBe(
			'inset 0 2px 3px -1px rgba(0, 0, 0, 0.28)'
		);
	});

	it('gives the accent tokens a distinct blue hue in every theme (#1577)', () => {
		expect(value(themeNode('light'), 'color.accent.background')).toBe('#dfecf4');
		expect(value(themeNode('light'), 'color.accent.text')).toBe('#1b5f80');
		expect(value(themeNode('dark'), 'color.accent.background')).toBe('#162832');
		expect(value(themeNode('dark'), 'color.accent.text')).toBe('#a1d4f3');
		expect(value(themeNode('high-contrast'), 'color.accent.background')).toBe('#ffffff');
		expect(value(themeNode('high-contrast'), 'color.accent.text')).toBe('#004A80');
		for (const theme of THEMES) {
			const node = themeNode(theme);
			expect(value(node, 'color.accent.text')).not.toBe(value(node, 'color.state.success.text'));
		}
	});

	it('changes only density in compact, and never takes a target below 24px', () => {
		const densityIds =
			/^(space\.(inline|stack)|size\.target|shell\.size\.(titlebar|statusbar|rail|tabbar))(\.|$)/;
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
			const failures = pairs.flatMap((pair) =>
				(pair.backdrops ?? ['color.surface.page']).flatMap((backdrop) => {
					const ratio = contrastRatio(
						value(nodeId, pair.foreground),
						value(nodeId, pair.background),
						value(nodeId, backdrop)
					);
					const floor = CONTRAST_FLOORS[theme][pair.kind];
					return ratio >= floor
						? []
						: [
								`${pair.foreground} on ${pair.background} over ${backdrop}: ${ratio.toFixed(2)} < ${floor}`,
							];
				})
			);
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
		expect(light).not.toContain('--violet-ref-');
		expect(light).not.toContain('--ref-');
		const dark = rule('[data-loam-theme="dark"]');
		expect(dark).toContain('\t--violet-color-surface-page: #141515;');
		expect(dark).not.toContain('--violet-space-inline-group');
		expect(dark).not.toContain('--violet-color-action-danger-background');
		const contrast = rule('[data-loam-theme="high-contrast"]');
		expect(contrast).toContain('\t--violet-shell-size-focus: 3px;');
		// field.* references follow their targets, so their resolved values differ too.
		expect(contrast).toContain('\t--violet-color-field-text: #000000;');
		for (const theme of THEMES) {
			const compact = rule(`[data-loam-theme="${theme}"][data-loam-density="compact"]`);
			expect(compact).toContain('\t--violet-size-target-natural: 28px;');
			expect(compact).not.toContain('--violet-color-');
			expect(compact).not.toContain('--color-');
		}
		expect(css.match(/\{$/gm)).toHaveLength(6);
	});

	it('writes every node as Token[] with resolved values', () => {
		const json = JSON.parse(outputs.files['loam-theme.json']);
		expect(json.contractVersion).toBe(3);
		expect(Object.keys(json.nodes)).toEqual(NODE_IDS);
		const dark = json.nodes['loam/dark'] as { id: string; value: string }[];
		expect(dark).toContainEqual({ id: 'color.action.secondary.text', value: '#f4f0ea' });
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
		expect(report.notes.filter((note) => !/^(?:warning|info): /.test(note))).toEqual([
			expect.stringMatching(/^Skipped the component export/),
		]);
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
		expect(report.notes.filter((note) => !/^(?:warning|info): /.test(note))).toEqual([
			expect.stringMatching(/^Skipped the component export/),
		]);
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
		retyped.tokens['radius.inset'] = {
			property: '--violet-radius-inset',
			type: 'number',
			kind: 'component',
		};
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

	it('passes ramp and positional-name constraints across all 7 nodes, catches violations end-to-end, and keeps warnings advisory', async () => {
		const layoutDefaults = {
			sidebar: { default: 260, min: 200, max: 480 },
			inspector: { default: 300, min: 240, max: 520 },
			panel: { default: 240, min: 120 },
			mainMin: 360,
		};
		expect(resolved.constraintIssues.filter((issue) => issue.severity === 'error')).toEqual([]);

		// 1. Plant an unreasoned off-ramp literal ONLY in a child node (`loam/dark`) and a positional
		// token name on the root, then run buildOutputs -> checkTheme end-to-end.
		const sourceFiles = await readLoamTreeFiles();
		const mutated = sourceFiles.map((file) => {
			if (file.name === 'loam.tokens.json') {
				const parsed = JSON.parse(file.content);
				parsed.space.stack.xs = {
					$type: 'dimension',
					$value: '{ref.space.4}',
					$extensions: { 'dev.lushly.violet': { category: 'spacing' } },
				};
				return { ...file, content: `${JSON.stringify(parsed, null, 2)}\n` };
			}
			if (file.name === 'loam_dark.tokens.json') {
				const parsed = JSON.parse(file.content);
				parsed.space = {
					...(parsed.space ?? {}),
					inline: {
						...(parsed.space?.inline ?? {}),
						tight: {
							$type: 'dimension',
							$value: '5px',
							$extensions: { 'dev.lushly.violet': { category: 'spacing' } },
						},
					},
				};
				return { ...file, content: `${JSON.stringify(parsed, null, 2)}\n` };
			}
			return file;
		});
		const mutatedOutputs = await buildOutputs(mutated);
		const failedCheck = await checkTheme(contractUrl, {
			outputs: mutatedOutputs,
			layoutDefaults,
		});
		expect(
			failedCheck.errors.some((line) =>
				line.startsWith('space.inline.tight in loam/dark [spacing-ramp/ramp:unreasoned]:')
			)
		).toBe(true);
		expect(
			failedCheck.errors.some((line) =>
				line.startsWith('space.stack.xs in loam [no-positional-names]:')
			)
		).toBe(true);

		// 2. Plant two reasoned off-ramp overrides in `loam/dark`: produces advisory `ramp:repeat`
		// warnings routed to `notes`, with zero constraint errors.
		const warned = sourceFiles.map((file) => {
			if (file.name !== 'loam_dark.tokens.json') return file;
			const parsed = JSON.parse(file.content);
			parsed.space = {
				...(parsed.space ?? {}),
				inline: {
					...(parsed.space?.inline ?? {}),
					tight: {
						$type: 'dimension',
						$value: '5px',
						$extensions: {
							'dev.lushly.violet': {
								category: 'spacing',
								reason: 'Optical alignment in dark theme toolbar',
							},
						},
					},
					group: {
						$type: 'dimension',
						$value: '5px',
						$extensions: {
							'dev.lushly.violet': {
								category: 'spacing',
								reason: 'Optical alignment in dark theme group',
							},
						},
					},
				},
			};
			return { ...file, content: `${JSON.stringify(parsed, null, 2)}\n` };
		});
		const warnedOutputs = await buildOutputs(warned);
		const warnedCheck = await checkTheme(contractUrl, {
			outputs: warnedOutputs,
			layoutDefaults,
		});
		expect(warnedCheck.errors).toEqual([]);
		expect(
			warnedCheck.notes.some((line) =>
				line.startsWith('warning: space.inline.tight in loam/dark [spacing-ramp/ramp:repeat]:')
			)
		).toBe(true);
		expect(
			warnedCheck.notes.some((line) =>
				line.startsWith('warning: space.inline.group in loam/dark [spacing-ramp/ramp:repeat]:')
			)
		).toBe(true);
	});
});

describe('DTCG tree files (#1974)', () => {
	const INSTANCE_COMMAND_INPUT_LIMIT = 256 * 1024;

	it('carries $type and preserves all original Violet token categories so export.tree drops nothing', async () => {
		const tree = await buildLoamTree();
		const rootTokens = await tree.resolve(ROOT_NODE);
		expect(rootTokens.length).toBeGreaterThan(0);
		for (const token of rootTokens) {
			const expectedType = isPrimitive(token.id)
				? token.id.startsWith('ref.color.')
					? 'color'
					: 'dimension'
				: contractTypeOf(token.id);
			expect(token.metadata.type, `${token.id} $type`).toBe(expectedType);
		}
		const catalog = await tokensCatalogCommand.handler({}, { db: tree.db, actor: 'test' });
		expect(catalog.success).toBe(true);
		expect(catalog.data?.summary.categories).toEqual({
			color: 114,
			motion: 5,
			typography: 34,
			radius: 8,
			spacing: 42,
			shadow: 4,
			'z-index': 7,
		});
		const spacing = await tokensCatalogCommand.handler(
			{ category: 'spacing' },
			{ db: tree.db, actor: 'test' }
		);
		expect(spacing.data?.tokens.map((token) => token.id)).toContain('space.inline.group');
		const radius = await tokensCatalogCommand.handler(
			{ category: 'radius' },
			{ db: tree.db, actor: 'test' }
		);
		expect(radius.data?.tokens.map((token) => token.id)).toContain('radius.control');
		const zIndex = await tokensCatalogCommand.handler(
			{ category: 'z-index' },
			{ db: tree.db, actor: 'test' }
		);
		expect(zIndex.data?.tokens.map((token) => token.id)).toContain('z-index.modal');

		const exported = await exportTreeCommand.handler({}, { db: tree.db, actor: 'test' });
		expect(exported.success).toBe(true);
		expect(exported.data?.dropped).toEqual([]);
	});

	it('reads tree files from a directory URL without a trailing slash', async () => {
		const withoutSlash = pathToFileURL(fileURLToPath(TREE_DIR).replace(/[\\/]+$/, ''));
		expect(await readLoamTreeFiles(withoutSlash)).toEqual(await readLoamTreeFiles());
	});

	it('round-trips byte-identically through import.tree and export.tree without edits', async () => {
		const sourceFiles = await readLoamTreeFiles();
		expect(sourceFiles).toHaveLength(NODE_IDS.length);

		const db = createMemoryDatabase();
		const context = { db, actor: 'test' };
		const imported = await importTreeCommand.handler({ files: sourceFiles }, context);
		expect(imported.success).toBe(true);

		const exported = await exportTreeCommand.handler({}, context);
		expect(exported.success).toBe(true);
		expect(exported.data?.dropped).toEqual([]);
		expect(exported.data?.files.map(({ name, content }) => ({ name, content }))).toEqual(
			sourceFiles
		);
	});

	it('produces a one-line diff after one token.override and export.tree', async () => {
		const sourceFiles = await readLoamTreeFiles();
		const db = createMemoryDatabase();
		const context = { db, actor: 'test' };

		const imported = await importTreeCommand.handler({ files: sourceFiles }, context);
		expect(imported.success).toBe(true);

		const overridden = await tokenOverrideCommand.handler(
			{
				nodeId: themeNode('dark'),
				tokenId: 'color.surface.page',
				value: '#101212',
				reason: 'Verify one-line diff on round-trip',
			},
			context
		);
		expect(overridden.success).toBe(true);

		const exported = await exportTreeCommand.handler({}, context);
		expect(exported.success).toBe(true);
		expect(exported.data?.dropped).toEqual([]);

		const exportedByName = new Map(
			(exported.data?.files ?? []).map((file) => [file.name, file.content])
		);
		const changedFiles: string[] = [];
		for (const file of sourceFiles) {
			const after = exportedByName.get(file.name);
			expect(after).toBeDefined();
			if (after !== file.content) changedFiles.push(file.name);
		}
		expect(changedFiles).toEqual(['loam_dark.tokens.json']);

		const beforeLines = (
			sourceFiles.find((file) => file.name === 'loam_dark.tokens.json')?.content ?? ''
		).split('\n');
		const afterLines = (exportedByName.get('loam_dark.tokens.json') ?? '').split('\n');
		expect(afterLines).toHaveLength(beforeLines.length);
		const diffs = beforeLines
			.map((line, index) => ({ line: index + 1, before: line, after: afterLines[index] }))
			.filter((entry) => entry.before !== entry.after);
		expect(diffs).toHaveLength(1);
		expect(diffs[0]?.before).toContain('"$value": "{ref.color.charcoal.950}"');
		expect(diffs[0]?.after).toContain('"$value": "#101212"');
	});

	it('fits comfortably within the 256 KiB bound on an instance command input', async () => {
		const sourceFiles = await readLoamTreeFiles();
		const rawBytes = sourceFiles.reduce(
			(total, file) => total + Buffer.byteLength(file.content, 'utf8'),
			0
		);
		const payloadBytes = Buffer.byteLength(
			JSON.stringify({ content: { files: sourceFiles } }),
			'utf8'
		);
		expect(rawBytes).toBeGreaterThan(0);
		expect(payloadBytes).toBeLessThan(INSTANCE_COMMAND_INPUT_LIMIT);
	});

	it('refuses an empty file list and invalid DTCG input clearly', async () => {
		await expect(buildLoamTree([])).rejects.toThrow(/No \.tokens\.json files found/);
		await expect(
			buildLoamTree([{ name: 'broken.tokens.json', content: '{not json' }])
		).rejects.toThrow(/Failed to import Loam's token tree: VALIDATION_ERROR/);
	});
});
