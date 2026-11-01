/**
 * Loam's Violet tree (2.2), built in a Violet memory database through `@lushly-dev/violet-core`'s
 * public API. Node only, at build time.
 *
 *   loam (product)                  every contract id with its light value, and the primitives
 *   ├── loam/light (theme)          nothing more: every theme is a named node
 *   │   └── loam/light/compact      compact density (custom)
 *   ├── loam/dark (theme)           color and shadow overrides
 *   │   └── loam/dark/compact
 *   └── loam/high-contrast (theme)  7:1 text, 3:1 non-text, 3px focus, borders for shadows
 *       └── loam/high-contrast/compact
 */
import {
	createMemoryDatabase,
	type Database,
	NodeSchema,
	type NodeType,
	type OperationRecord,
	type ResolvedToken,
	resolveTokens,
} from '@lushly-dev/violet-core';
import { COMPONENT_TOKENS } from './components.js';
import { COMPACT_OVERRIDES } from './density.js';
import { PRIMITIVES } from './primitives.js';
import { SHELL_TOKENS } from './shell.js';
import { DARK_OVERRIDES, HIGH_CONTRAST_OVERRIDES } from './themes.js';
import { type ContractType, isPrimitive, type TreeToken } from './types.js';

export { COMPONENT_TOKENS } from './components.js';
export { COMPACT_OVERRIDES, TARGET_IDS } from './density.js';
export { PRIMITIVES } from './primitives.js';
export { LAYOUT_DEFAULT_TOKENS, SHELL_TOKENS } from './shell.js';
export { DARK_OVERRIDES, HIGH_CONTRAST_OVERRIDES } from './themes.js';
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

/** Fixed, so two builds of the same tree are byte-identical. */
const STAMP = '2026-11-01T00:00:00.000Z';

const THEME_OVERRIDES: Record<ThemeName, readonly TreeToken[]> = {
	light: [],
	dark: DARK_OVERRIDES,
	'high-contrast': HIGH_CONTRAST_OVERRIDES,
};

export interface LoamTree {
	db: Database;
	/** Every token of a node with inheritance and references applied. */
	resolve(nodeId: string): Promise<ResolvedToken[]>;
}

export async function buildLoamTree(): Promise<LoamTree> {
	const db = createMemoryDatabase();
	let sequence = 0;

	const node = (id: string, parentId: string | null, type: NodeType) =>
		db.createNode(
			NodeSchema.parse({ id, name: id, parentId, type, createdAt: STAMP, updatedAt: STAMP })
		);
	const write = async (nodeId: string, type: 'add' | 'override', tokens: readonly TreeToken[]) => {
		for (const token of tokens) {
			sequence++;
			const record: OperationRecord = {
				id: `op-${sequence}`,
				nodeId,
				sequence,
				type,
				tokenId: token.id,
				value: JSON.stringify(token.value),
				metadata: type === 'add' ? JSON.stringify(metadataFor(token.id)) : null,
				fromNode: null,
				asTokenId: null,
				toAncestor: null,
				reason: null,
				author: '@lushly-dev/loam-theme',
				createdAt: STAMP,
			};
			await db.addOperation(record);
		}
	};

	await node(ROOT_NODE, null, 'product');
	await write(ROOT_NODE, 'add', [...PRIMITIVES, ...COMPONENT_TOKENS, ...SHELL_TOKENS]);
	for (const theme of THEMES) {
		await node(themeNode(theme), ROOT_NODE, 'theme');
		await write(themeNode(theme), 'override', THEME_OVERRIDES[theme]);
		await node(compactNode(theme), themeNode(theme), 'custom');
		await write(compactNode(theme), 'override', COMPACT_OVERRIDES);
	}

	return {
		db,
		resolve: async (nodeId) => (await resolveTokens(db, nodeId)).tokens,
	};
}

/** Violet metadata for an id: its contract type, Violet category and tier. */
function metadataFor(id: string): { type: string; category: string; tier: string } {
	if (isPrimitive(id)) {
		const color = id.startsWith('ref.color.');
		return {
			type: color ? 'color' : 'dimension',
			category: color ? 'color' : 'spacing',
			tier: 'global',
		};
	}
	return { type: contractTypeOf(id), category: categoryOf(id), tier: 'semantic' };
}

function categoryOf(id: string): string {
	const family = id.split('.')[0] ?? '';
	if (family === 'color' || id.startsWith('shell.color.')) return 'color';
	if (family === 'shadow' || family === 'radius' || family === 'z-index') return family;
	if (family === 'duration' || family === 'easing') return 'motion';
	if (family === 'weight' || family === 'type' || /^size\.(font|line)\./.test(id))
		return 'typography';
	return 'spacing';
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
	if (id.startsWith('weight.') || (id.startsWith('type.') && id.endsWith('.weight')))
		return 'fontWeight';
	if (id.startsWith('z-index.')) return 'number';
	return 'dimension';
}
