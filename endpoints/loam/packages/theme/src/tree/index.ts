/**
 * Loam's Violet tree (2.2), loaded from DTCG token files in `tree/` into a Violet memory database
 * via `@lushly-dev/violet-afd`'s `import.tree` command. Node only, at build time.
 *
 *   loam (product)                  every contract id with its light value, and the primitives
 *   ├── loam/light (theme)          nothing more: every theme is a named node
 *   │   └── loam/light/compact      compact density (custom)
 *   ├── loam/dark (theme)           color and shadow overrides
 *   │   └── loam/dark/compact
 *   └── loam/high-contrast (theme)  7:1 text, 3:1 non-text, 3px focus, borders for shadows
 *       └── loam/high-contrast/compact
 */
import { readdir, readFile } from 'node:fs/promises';
import { type CommandContext, importTreeCommand } from '@lushly-dev/violet-afd/commands';
import {
	type Constraint,
	createMemoryDatabase,
	type Database,
	type ResolvedToken,
	resolveTokens,
} from '@lushly-dev/violet-core';
import type { ContractType } from './types.js';

export * from './types.js';

export const THEMES = ['light', 'dark', 'high-contrast'] as const;
export type ThemeName = (typeof THEMES)[number];

export const ROOT_NODE = 'loam';
export const themeNode = (theme: ThemeName): string => `${ROOT_NODE}/${theme}`;
export const compactNode = (theme: ThemeName): string => `${themeNode(theme)}/compact`;

/** Every node, parents before children. */
export const NODE_IDS: readonly string[] = [
	ROOT_NODE,
	...THEMES.map(themeNode),
	...THEMES.map(compactNode),
];

/**
 * Where each number of the kernel's `LAYOUT_DEFAULTS_V0` (5.2) lives in the tree, keyed by its
 * path in that constant. `theme:check` fails when a resolved value and the kernel disagree.
 */
export const LAYOUT_DEFAULT_TOKENS = {
	'sidebar.default': 'shell.size.sidebar.default',
	'sidebar.min': 'shell.size.sidebar.min',
	'sidebar.max': 'shell.size.sidebar.max',
	'inspector.default': 'shell.size.inspector.default',
	'inspector.min': 'shell.size.inspector.min',
	'inspector.max': 'shell.size.inspector.max',
	'panel.default': 'shell.size.panel.default',
	'panel.min': 'shell.size.panel.min',
	mainMin: 'shell.size.main.min',
} as const;

/** The ids compact must keep at or above 24px: targets and the shell's bars. */
export const TARGET_IDS: readonly string[] = [
	'size.target.compact',
	'size.target.natural',
	'size.target.comfortable',
	'shell.size.titlebar',
	'shell.size.statusbar',
	'shell.size.rail',
	'shell.size.tabbar',
];

/** Directory holding Loam's committed DTCG token files (one per node). */
export const TREE_DIR = new URL('../../tree/', import.meta.url);

/** One DTCG token file as `import.tree` and `export.tree` exchange it. */
export interface TreeFile {
	name: string;
	content: string;
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Read every `*.tokens.json` file from `directory` (defaults to `TREE_DIR`) in code-point order. */
export async function readLoamTreeFiles(directory: URL = TREE_DIR): Promise<TreeFile[]> {
	const dir = directory.href.endsWith('/') ? directory : new URL(`${directory.href}/`);
	const names = (await readdir(dir))
		.filter((name) => name.endsWith('.tokens.json'))
		.sort(byCodePoint);
	return Promise.all(
		names.map(async (name) => ({
			name,
			content: await readFile(new URL(name, dir), 'utf8'),
		}))
	);
}

/** Fixed clock and deterministic PRNG, so two builds of the same tree produce identical records. */
const STAMP_MS = Date.parse('2026-11-01T00:00:00.000Z');

function deterministicRandom(): () => number {
	let state = 0x6d2b79f5;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

export interface LoamTree {
	db: Database;
	/** Every token of a node with inheritance and references applied. */
	resolve(nodeId: string): Promise<ResolvedToken[]>;
}

/** Positional size segments (`xs`, `sm`, `md`, `lg`, `xl`) banned from Loam token ids (#1111). */
export const NO_POSITIONAL_NAMES_PATTERN =
	'^(?!(?:xs|sm|md|lg|xl)(?:\\.|$))(?!.*\\.(?:xs|sm|md|lg|xl)(?:\\.|$)).+$';

/**
 * Loam's Stage 1/Stage 2 Scales constraints (#1111, #2197), attached to the `loam` root node so
 * every theme and density node inherits them and `theme:check` validates them via `validateConstraints`.
 */
export const LOAM_CONSTRAINTS: readonly Constraint[] = [
	{
		id: 'spacing-ramp',
		name: 'Spacing tokens reference ref.space.*',
		applyTo: 'space.*',
		severity: 'error',
		enabled: true,
		config: {
			type: 'ramp',
			ramp: 'ref.space.*',
			requireOffRampReason: true,
			repeatThreshold: 2,
		},
	},
	{
		id: 'type-size-ramp',
		name: 'Type sizes reference ref.type.*.size and pair with matching .line',
		applyTo: 'type.*.size',
		severity: 'error',
		enabled: true,
		config: {
			type: 'ramp',
			ramp: 'ref.type.*.size',
			requireOffRampReason: true,
			repeatThreshold: 2,
			pairWith: {
				fromSuffix: '.size',
				toSuffix: '.line',
				rampTarget: 'ref.type.*.line',
			},
		},
	},
	{
		id: 'type-line-ramp',
		name: 'Type line heights reference ref.type.*.line',
		applyTo: 'type.*.line',
		severity: 'error',
		enabled: true,
		config: {
			type: 'ramp',
			ramp: 'ref.type.*.line',
			requireOffRampReason: true,
			repeatThreshold: 2,
		},
	},
	{
		id: 'radius-ramp',
		name: 'Radius tokens reference ref.radius.*',
		applyTo: 'radius.*',
		severity: 'error',
		enabled: true,
		config: {
			type: 'ramp',
			ramp: 'ref.radius.*',
			requireOffRampReason: true,
			repeatThreshold: 2,
		},
	},
	{
		id: 'target-ramp',
		name: 'Target sizes reference ref.target.*',
		applyTo: 'size.target.*',
		severity: 'error',
		enabled: true,
		config: {
			type: 'ramp',
			ramp: 'ref.target.*',
			requireOffRampReason: true,
			repeatThreshold: 2,
		},
	},
	{
		id: 'shell-titlebar-ramp',
		name: 'Shell titlebar height references ref.target.*',
		applyTo: 'shell.size.titlebar',
		severity: 'error',
		enabled: true,
		config: {
			type: 'ramp',
			ramp: 'ref.target.*',
			requireOffRampReason: true,
			repeatThreshold: 2,
		},
	},
	{
		id: 'shell-statusbar-ramp',
		name: 'Shell statusbar height references ref.target.*',
		applyTo: 'shell.size.statusbar',
		severity: 'error',
		enabled: true,
		config: {
			type: 'ramp',
			ramp: 'ref.target.*',
			requireOffRampReason: true,
			repeatThreshold: 2,
		},
	},
	{
		id: 'shell-rail-ramp',
		name: 'Shell rail width references ref.target.*',
		applyTo: 'shell.size.rail',
		severity: 'error',
		enabled: true,
		config: {
			type: 'ramp',
			ramp: 'ref.target.*',
			requireOffRampReason: true,
			repeatThreshold: 2,
		},
	},
	{
		id: 'shell-tabbar-ramp',
		name: 'Shell tabbar height references ref.target.*',
		applyTo: 'shell.size.tabbar',
		severity: 'error',
		enabled: true,
		config: {
			type: 'ramp',
			ramp: 'ref.target.*',
			requireOffRampReason: true,
			repeatThreshold: 2,
		},
	},
	{
		id: 'no-positional-names',
		name: 'Token ids must use purpose names, never xs/sm/md/lg/xl segments',
		applyTo: '*',
		severity: 'error',
		enabled: true,
		config: {
			type: 'pattern',
			target: 'id',
			pattern: NO_POSITIONAL_NAMES_PATTERN,
		},
	},
];

/** Attach Loam's ramp and positional-name constraints to the `loam` root node. */
export async function attachLoamConstraints(db: Database): Promise<void> {
	if (await db.getNode(ROOT_NODE)) {
		await db.setConstraints(
			ROOT_NODE,
			LOAM_CONSTRAINTS.map((constraint) => structuredClone(constraint))
		);
	}
}

/**
 * Load Loam's DTCG token files into a fresh Violet memory database via `import.tree`, and attach
 * Loam's Scales constraints to the root node. Pass `files` to load an alternate set of files
 * (for tests or previews).
 */
export async function buildLoamTree(files?: readonly TreeFile[]): Promise<LoamTree> {
	const treeFiles = files ? [...files] : await readLoamTreeFiles();
	if (treeFiles.length === 0) {
		throw new Error("No .tokens.json files found in Loam's token tree");
	}
	const db = createMemoryDatabase();
	const context: CommandContext = {
		db,
		actor: '@lushly-dev/loam-theme',
		now: () => STAMP_MS,
		random: deterministicRandom(),
	};
	const imported = await importTreeCommand.handler({ files: treeFiles }, context);
	if (!imported.success) {
		const detail = imported.error
			? `${imported.error.code}: ${imported.error.message}`
			: 'unknown error';
		throw new Error(`Failed to import Loam's token tree: ${detail}`);
	}
	await attachLoamConstraints(db);
	return {
		db,
		resolve: async (nodeId) => (await resolveTokens(db, nodeId)).tokens,
	};
}

/**
 * The contract type of an id, by family. `type.*` ids alias a size or a weight, so they take that
 * value's type; no version 1 id is a composite `typography` value.
 */
export function contractTypeOf(id: string): ContractType {
	if (id.startsWith('color.') || id.startsWith('shell.color.')) return 'color';
	if (id.startsWith('shadow.')) return 'shadow';
	if (id.startsWith('duration.')) return 'duration';
	if (id.startsWith('easing.')) return 'cubicBezier';
	if (id.startsWith('font.family.')) return 'fontFamily';
	if (id.startsWith('weight.') || (id.startsWith('type.') && id.endsWith('.weight')))
		return 'fontWeight';
	if (id.startsWith('z-index.')) return 'number';
	return 'dimension';
}
