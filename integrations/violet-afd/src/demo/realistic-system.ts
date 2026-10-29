import type { NodeStatus, NodeType } from '@lushly-dev/violet-core/types';
import type {
	TokenCategory,
	TokenMetadata,
	TokenTier,
	TokenValue,
} from '@lushly-dev/violet-core/types';
/**
 * Realistic demo design system
 *
 * Builds a design system shaped like a real multi-product one through the
 * command layer (so every write is validated exactly like user input):
 *
 * - a root with ~1,150 tokens across every category and tier
 * - 5 products, each with platforms, devices, themes, locales
 * - two mixin roots (high contrast, reduced motion) included with the
 *   `override` policy, sibling copies, resets, subtractions
 * - owners, deprecated and experimental nodes, deprecated tokens
 * - constraints that some nodes violate, and a few redundant overrides
 * - a sunset date and replacement on the deprecated branch, and five rule
 *   check snapshots taken as the history unfolds (one issue is fixed along
 *   the way); each costs a full rule check, so there are only a few
 *
 * Used for user sessions, the UI, and performance work. Deterministic for a
 * given seed. Its audit events are dated across the 12 weeks before the seed
 * runs (the catalog first, the deliberate problems last), so trends have
 * history to show.
 */
import { recordCheckSnapshot } from '../commands/analyze/snapshot.js';
import { setCommand as constraintsSetCommand } from '../commands/constraints/set.js';
import { nodeCreateCommand } from '../commands/node/create.js';
import type { CommandContext, Database } from '../commands/registry.js';
import { tokenAddCommand } from '../commands/token/add.js';
import { tokenCopyCommand } from '../commands/token/copy.js';
import { tokenOverrideCommand } from '../commands/token/override.js';
import { tokenResetCommand } from '../commands/token/reset.js';
import { tokenSubtractCommand } from '../commands/token/subtract.js';
import type { CommandResult } from '../types/command-result.js';

export interface RealisticSystemOptions {
	/** Seed for the deterministic choices (which components each product customizes) */
	seed?: number;
	/** Date the audit events over the 12 weeks before `now` (default), or stamp them as they run */
	history?: boolean;
	/** The time the dated history ends at; defaults to when the seed runs */
	now?: number;
	/** Record rule check snapshots along the history (default), for analyze.trends */
	checks?: boolean;
}

export interface RealisticSystemSummary {
	nodes: number;
	tokens: number;
	operations: number;
	constraints: number;
	/** Rule check snapshots recorded */
	snapshots: number;
}

interface TokenSpec {
	id: string;
	value: TokenValue;
	category: TokenCategory;
	tier: TokenTier;
	status?: TokenMetadata['status'];
	deprecatedBy?: string;
	description?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic helpers
// ─────────────────────────────────────────────────────────────────────────────

/** mulberry32: small, fast, deterministic PRNG */
function createRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(random: () => number, items: readonly T[], count: number): T[] {
	const pool = [...items];
	const picked: T[] = [];
	while (picked.length < count && pool.length > 0) {
		picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
	}
	return picked;
}

/** HSL (degrees, 0–100, 0–100) to #RRGGBB */
export function hsl(hue: number, saturation: number, lightness: number): string {
	const s = saturation / 100;
	const l = lightness / 100;
	const a = s * Math.min(l, 1 - l);
	const channel = (n: number) => {
		const k = (n + hue / 30) % 12;
		const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
		return Math.round(value * 255)
			.toString(16)
			.padStart(2, '0');
	};
	return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Token catalog (root)
// ─────────────────────────────────────────────────────────────────────────────

const HUES: Array<[string, number, number]> = [
	['red', 4, 72],
	['orange', 24, 85],
	['yellow', 48, 90],
	['lime', 84, 60],
	['green', 130, 55],
	['teal', 172, 60],
	['cyan', 190, 70],
	['blue', 210, 80],
	['indigo', 235, 60],
	['purple', 270, 55],
	['pink', 330, 65],
	['gray', 220, 8],
];
const STEPS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];

function paletteValue(hue: string, step: number): string {
	const [, angle, saturation] = HUES.find(([name]) => name === hue) ?? HUES[0];
	const lightness = Math.round(98 - (step / 100) * 90);
	return hsl(angle, saturation, lightness);
}

/** Interactive and overlay components; each gets the same family of tokens */
export const COMPONENTS = [
	'button',
	'icon-button',
	'link',
	'input',
	'textarea',
	'select',
	'checkbox',
	'radio',
	'switch',
	'slider',
	'chip',
	'badge',
	'avatar',
	'card',
	'list',
	'table',
	'tabs',
	'nav',
	'breadcrumb',
	'pagination',
	'menu',
	'popover',
	'tooltip',
	'dialog',
	'drawer',
	'toast',
	'banner',
	'progress',
	'spinner',
	'skeleton',
] as const;

const OVERLAYS = new Set(['menu', 'popover', 'tooltip', 'dialog', 'drawer', 'toast']);
const TOUCH_TARGETS = [
	'button',
	'icon-button',
	'input',
	'select',
	'checkbox',
	'radio',
	'switch',
	'chip',
	'tabs',
];

function componentTokens(component: string, index: number): TokenSpec[] {
	const brand = index % 3 === 0 ? 'blue' : index % 3 === 1 ? 'gray' : 'indigo';
	const filled = ['button', 'chip', 'badge', 'tabs', 'switch', 'progress'].includes(component);
	const c = (id: string) => `${component}.${id}`;
	const color = (id: string, value: string): TokenSpec => ({
		id: c(id),
		value,
		category: 'color',
		tier: 'component',
	});
	const tokens: TokenSpec[] = [
		color('background', filled ? paletteValue(brand, 60) : paletteValue('gray', 5)),
		color('background.hover', filled ? paletteValue(brand, 70) : paletteValue('gray', 10)),
		color('background.pressed', filled ? paletteValue(brand, 80) : paletteValue('gray', 20)),
		color('foreground', filled ? '#FFFFFF' : paletteValue('gray', 90)),
		color('border', paletteValue('gray', 30)),
		color('border.focus', paletteValue('blue', 60)),
		color('border.hover', paletteValue('gray', 40)),
		color('background.disabled', paletteValue('gray', 10)),
		color('background.selected', filled ? paletteValue(brand, 70) : paletteValue('blue', 5)),
		color('foreground.hover', filled ? '#FFFFFF' : paletteValue('gray', 95)),
		color('foreground.disabled', paletteValue('gray', 40)),
		color('icon.color', filled ? '#FFFFFF' : paletteValue('gray', 70)),
		{
			id: c('padding.x'),
			value: `${8 + (index % 3) * 4}px`,
			category: 'spacing',
			tier: 'component',
		},
		{
			id: c('padding.y'),
			value: `${4 + (index % 2) * 4}px`,
			category: 'spacing',
			tier: 'component',
		},
		{ id: c('gap'), value: '8px', category: 'spacing', tier: 'component' },
		{
			id: c('min.height'),
			value: `${32 + (index % 2) * 4}px`,
			category: 'spacing',
			tier: 'component',
		},
		{ id: c('icon.size'), value: '16px', category: 'spacing', tier: 'component' },
		{ id: c('outline.width'), value: '2px', category: 'spacing', tier: 'component' },
		{ id: c('outline.offset'), value: '2px', category: 'spacing', tier: 'component' },
		{ id: c('radius'), value: `${[4, 6, 8][index % 3]}px`, category: 'radius', tier: 'component' },
		{ id: c('font.size'), value: '14px', category: 'typography', tier: 'component' },
		{ id: c('font.weight'), value: filled ? 600 : 400, category: 'typography', tier: 'component' },
		{ id: c('line.height'), value: 1.43, category: 'typography', tier: 'component' },
		{
			id: c('shadow'),
			value: OVERLAYS.has(component) ? '0 8px 24px rgba(0, 0, 0, 0.14)' : 'none',
			category: 'shadow',
			tier: 'component',
		},
		{ id: c('transition.duration'), value: '200ms', category: 'motion', tier: 'component' },
		{
			id: c('transition.easing'),
			value: 'cubic-bezier(0.33, 0, 0.67, 1)',
			category: 'motion',
			tier: 'component',
		},
		{ id: c('opacity.disabled'), value: 0.4, category: 'opacity', tier: 'component' },
	];
	if (OVERLAYS.has(component)) {
		tokens.push({ id: c('z'), value: 1300 + index, category: 'z-index', tier: 'component' });
	}
	return tokens;
}

export function buildTokenCatalog(): TokenSpec[] {
	const tokens: TokenSpec[] = [];

	// Primitive palette (global tier)
	for (const [hue] of HUES) {
		for (const step of STEPS) {
			tokens.push({
				id: `color.palette.${hue}.${step}`,
				value: paletteValue(hue, step),
				category: 'color',
				tier: 'global',
			});
		}
	}

	// Semantic colours
	const semantic: Record<string, string> = {
		'color.brand.primary': paletteValue('blue', 60),
		'color.brand.secondary': paletteValue('indigo', 60),
		'color.brand.tertiary': paletteValue('teal', 60),
		'color.accent.primary': paletteValue('blue', 60),
		'color.accent.hover': paletteValue('blue', 70),
		'color.accent.pressed': paletteValue('blue', 80),
		'color.surface.base': '#FFFFFF',
		'color.surface.raised': paletteValue('gray', 5),
		'color.surface.sunken': paletteValue('gray', 10),
		'color.surface.overlay': '#FFFFFF',
		'color.surface.inverse': paletteValue('gray', 90),
		'color.text.primary': paletteValue('gray', 95),
		'color.text.secondary': paletteValue('gray', 70),
		'color.text.muted': paletteValue('gray', 60),
		'color.text.inverse': '#FFFFFF',
		'color.text.link': paletteValue('blue', 70),
		'color.text.disabled': paletteValue('gray', 40),
		'color.border.subtle': paletteValue('gray', 20),
		'color.border.default': paletteValue('gray', 30),
		'color.border.strong': paletteValue('gray', 50),
		'color.border.focus': paletteValue('blue', 60),
		'color.interactive.default': paletteValue('blue', 60),
		'color.interactive.hover': paletteValue('blue', 70),
		'color.interactive.pressed': paletteValue('blue', 80),
		'color.interactive.disabled': paletteValue('gray', 30),
	};
	for (const [status, hue] of [
		['success', 'green'],
		['warning', 'yellow'],
		['danger', 'red'],
		['info', 'cyan'],
	] as const) {
		semantic[`color.status.${status}.foreground`] = paletteValue(hue, 80);
		semantic[`color.status.${status}.background`] = paletteValue(hue, 5);
		semantic[`color.status.${status}.border`] = paletteValue(hue, 40);
	}
	for (const [id, value] of Object.entries(semantic)) {
		tokens.push({ id, value, category: 'color', tier: 'semantic' });
	}

	// Spacing scale and semantic spacing
	for (let step = 0; step <= 20; step++) {
		tokens.push({
			id: `spacing.${step}`,
			value: `${step * 4}px`,
			category: 'spacing',
			tier: 'global',
		});
	}
	const sizes = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
	const insets = [4, 8, 12, 16, 24];
	for (const kind of ['inset', 'stack', 'inline']) {
		sizes.forEach((size, i) => {
			tokens.push({
				id: `spacing.${kind}.${size}`,
				value: `${insets[i]}px`,
				category: 'spacing',
				tier: 'semantic',
			});
		});
	}

	// Typography
	const families: Record<string, string> = {
		sans: 'Segoe UI, system-ui, sans-serif',
		serif: 'Georgia, serif',
		mono: 'Cascadia Code, Consolas, monospace',
		display: 'Segoe UI Variable Display, Segoe UI, sans-serif',
	};
	for (const [name, value] of Object.entries(families)) {
		tokens.push({ id: `typography.family.${name}`, value, category: 'typography', tier: 'global' });
	}
	const typeSizes: Array<[string, number]> = [
		['xs', 12],
		['sm', 14],
		['md', 16],
		['lg', 18],
		['xl', 20],
		['2xl', 24],
		['3xl', 30],
		['4xl', 36],
		['5xl', 48],
		['6xl', 60],
	];
	for (const [name, px] of typeSizes) {
		tokens.push({
			id: `typography.size.${name}`,
			value: `${px}px`,
			category: 'typography',
			tier: 'global',
		});
	}
	for (const [name, weight] of [
		['light', 300],
		['regular', 400],
		['medium', 500],
		['semibold', 600],
		['bold', 700],
	] as const) {
		tokens.push({
			id: `typography.weight.${name}`,
			value: weight,
			category: 'typography',
			tier: 'global',
		});
	}
	for (const [name, height] of [
		['none', 1],
		['tight', 1.1],
		['snug', 1.25],
		['normal', 1.5],
		['relaxed', 1.625],
		['loose', 2],
	] as const) {
		tokens.push({
			id: `typography.line-height.${name}`,
			value: height,
			category: 'typography',
			tier: 'global',
		});
	}
	for (const [name, spacing] of [
		['tight', '-0.02em'],
		['normal', '0em'],
		['wide', '0.02em'],
		['wider', '0.05em'],
	] as const) {
		tokens.push({
			id: `typography.tracking.${name}`,
			value: spacing,
			category: 'typography',
			tier: 'global',
		});
	}
	const styles: Array<[string, number[]]> = [
		['display', [60, 48, 36]],
		['headline', [32, 28, 24]],
		['title', [22, 18, 16]],
		['body', [18, 16, 14]],
		['label', [16, 14, 12]],
		['caption', [13, 12, 11]],
	];
	for (const [style, scale] of styles) {
		(['lg', 'md', 'sm'] as const).forEach((size, i) => {
			const prefix = `typography.${style}.${size}`;
			const strong = style === 'display' || style === 'headline' || style === 'title';
			tokens.push(
				{ id: `${prefix}.size`, value: `${scale[i]}px`, category: 'typography', tier: 'semantic' },
				{
					id: `${prefix}.weight`,
					value: strong ? 600 : 400,
					category: 'typography',
					tier: 'semantic',
				},
				{
					id: `${prefix}.line-height`,
					value: strong ? 1.25 : 1.5,
					category: 'typography',
					tier: 'semantic',
				},
			);
		});
	}

	// Radius, shadow, motion, opacity, z-index
	for (const [name, px] of [
		['none', 0],
		['xs', 2],
		['sm', 4],
		['md', 6],
		['lg', 8],
		['xl', 12],
		['2xl', 16],
		['full', 9999],
	] as const) {
		tokens.push({ id: `radius.${name}`, value: `${px}px`, category: 'radius', tier: 'global' });
	}
	const shadows: Record<string, string> = {
		none: 'none',
		xs: '0 1px 1px rgba(0, 0, 0, 0.06)',
		sm: '0 1px 2px rgba(0, 0, 0, 0.12)',
		md: '0 4px 8px rgba(0, 0, 0, 0.12)',
		lg: '0 8px 16px rgba(0, 0, 0, 0.14)',
		xl: '0 16px 32px rgba(0, 0, 0, 0.18)',
	};
	for (const [name, value] of Object.entries(shadows)) {
		tokens.push({
			id: `shadow.${name}`,
			value,
			category: 'shadow',
			tier: 'global',
			...(name === 'xs' ? { status: 'deprecated' as const, deprecatedBy: 'shadow.sm' } : {}),
		});
	}
	for (const [name, ms] of [
		['instant', 0],
		['fast', 100],
		['normal', 200],
		['slow', 300],
		['slower', 500],
		['slowest', 800],
	] as const) {
		tokens.push({
			id: `motion.duration.${name}`,
			value: `${ms}ms`,
			category: 'motion',
			tier: 'global',
		});
	}
	for (const [name, value] of [
		['standard', 'cubic-bezier(0.33, 0, 0.67, 1)'],
		['decelerate', 'cubic-bezier(0, 0, 0, 1)'],
		['accelerate', 'cubic-bezier(1, 0, 1, 1)'],
		['emphasized', 'cubic-bezier(0.2, 0, 0, 1)'],
		['linear', 'linear'],
	] as const) {
		tokens.push({
			id: `motion.easing.${name}`,
			value,
			category: 'motion',
			tier: 'global',
			...(name === 'emphasized' ? { status: 'beta' as const } : {}),
		});
	}
	for (const [name, value] of [
		['0', 0],
		['10', 0.1],
		['25', 0.25],
		['50', 0.5],
		['75', 0.75],
		['100', 1],
	] as const) {
		tokens.push({ id: `opacity.${name}`, value, category: 'opacity', tier: 'global' });
	}
	for (const [name, value] of [
		['base', 0],
		['dropdown', 1000],
		['sticky', 1100],
		['overlay', 1200],
		['modal', 1300],
		['popover', 1400],
		['toast', 1500],
		['tooltip', 1600],
	] as const) {
		tokens.push({ id: `z-index.${name}`, value, category: 'z-index', tier: 'global' });
	}

	// Component tokens
	COMPONENTS.forEach((component, index) => {
		tokens.push(...componentTokens(component, index));
	});

	// A deprecated semantic token pointing at its replacement
	const tertiary = tokens.find((token) => token.id === 'color.brand.tertiary');
	if (tertiary) {
		tertiary.status = 'deprecated';
		tertiary.deprecatedBy = 'color.brand.secondary';
		tertiary.description = 'Use color.brand.secondary';
	}

	return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchy
// ─────────────────────────────────────────────────────────────────────────────

interface NodeSpec {
	id: string;
	parentId: string | null;
	type: NodeType;
	owner: string;
	status?: NodeStatus;
	/** Days from the end of the history to the node's sunset date */
	sunsetInDays?: number;
	replacedBy?: string;
	includes?: string[];
	tags?: string[];
}

const PRODUCTS: Array<{ id: string; hue: number; tag: string }> = [
	{ id: 'xbox', hue: 120, tag: 'gaming' },
	{ id: 'vscode', hue: 205, tag: 'developer' },
	{ id: 'azure', hue: 212, tag: 'cloud' },
	{ id: 'office', hue: 14, tag: 'productivity' },
	{ id: 'teams', hue: 248, tag: 'communication' },
];

function owner(id: string): string {
	return `${id}-design@contoso.example`;
}

export const REALISTIC_NODES: NodeSpec[] = [
	{ id: 'global', parentId: null, type: 'root', owner: owner('design-system') },
	{ id: 'a11y-high-contrast', parentId: null, type: 'shared', owner: owner('accessibility') },
	{ id: 'motion-reduced', parentId: null, type: 'shared', owner: owner('accessibility') },
	...PRODUCTS.map(
		(product): NodeSpec => ({
			id: product.id,
			parentId: 'global',
			type: 'product',
			owner: owner(product.id),
			tags: [product.tag],
		}),
	),
	{ id: 'xbox-console', parentId: 'xbox', type: 'device', owner: owner('xbox') },
	{ id: 'xbox-tv', parentId: 'xbox', type: 'device', owner: owner('xbox') },
	{ id: 'xbox-ios', parentId: 'xbox', type: 'platform', owner: owner('xbox') },
	{ id: 'xbox-ios-dark', parentId: 'xbox-ios', type: 'theme', owner: owner('xbox') },
	{ id: 'xbox-android', parentId: 'xbox', type: 'platform', owner: owner('xbox') },
	{ id: 'xbox-dark', parentId: 'xbox', type: 'theme', owner: owner('xbox') },
	{ id: 'vscode-web', parentId: 'vscode', type: 'platform', owner: owner('vscode') },
	{ id: 'vscode-desktop', parentId: 'vscode', type: 'platform', owner: owner('vscode') },
	{ id: 'vscode-dark', parentId: 'vscode', type: 'theme', owner: owner('vscode') },
	{
		id: 'vscode-high-contrast',
		parentId: 'vscode',
		type: 'theme',
		owner: owner('vscode'),
		includes: ['a11y-high-contrast'],
	},
	{ id: 'azure-portal', parentId: 'azure', type: 'platform', owner: owner('azure') },
	{ id: 'azure-portal-de-DE', parentId: 'azure-portal', type: 'locale', owner: owner('azure') },
	{ id: 'azure-portal-ja-JP', parentId: 'azure-portal', type: 'locale', owner: owner('azure') },
	{ id: 'azure-mobile', parentId: 'azure', type: 'platform', owner: owner('azure') },
	{ id: 'azure-dark', parentId: 'azure', type: 'theme', owner: owner('azure') },
	{
		id: 'azure-classic',
		parentId: 'azure',
		type: 'custom',
		owner: owner('azure'),
		status: 'deprecated',
		sunsetInDays: 45,
		replacedBy: 'azure-portal',
	},
	{
		// A sunset date with no replacement: analyze.health flags it
		id: 'azure-classic-dark',
		parentId: 'azure-classic',
		type: 'theme',
		owner: owner('azure'),
		status: 'deprecated',
		sunsetInDays: 45,
	},
	{ id: 'office-web', parentId: 'office', type: 'platform', owner: owner('office') },
	{ id: 'office-web-ar-SA', parentId: 'office-web', type: 'locale', owner: owner('office') },
	{ id: 'office-windows', parentId: 'office', type: 'platform', owner: owner('office') },
	{ id: 'office-mac', parentId: 'office', type: 'platform', owner: owner('office') },
	{ id: 'office-ios', parentId: 'office', type: 'platform', owner: owner('office') },
	{ id: 'office-android', parentId: 'office', type: 'platform', owner: owner('office') },
	{ id: 'office-dark', parentId: 'office', type: 'theme', owner: owner('office') },
	{ id: 'teams-desktop', parentId: 'teams', type: 'platform', owner: owner('teams') },
	{ id: 'teams-web', parentId: 'teams', type: 'platform', owner: owner('teams') },
	{
		id: 'teams-mobile',
		parentId: 'teams',
		type: 'platform',
		owner: owner('teams'),
		includes: ['motion-reduced'],
	},
	{ id: 'teams-dark', parentId: 'teams', type: 'theme', owner: owner('teams') },
	{
		id: 'teams-experiment-compact',
		parentId: 'teams',
		type: 'experiment',
		owner: owner('teams'),
		status: 'experimental',
	},
];

const MOBILE = [
	'xbox-ios',
	'xbox-android',
	'azure-mobile',
	'office-ios',
	'office-android',
	'teams-mobile',
];
const DARK = [
	'xbox-dark',
	'vscode-dark',
	'azure-dark',
	'office-dark',
	'teams-dark',
	'azure-classic-dark',
];

// ─────────────────────────────────────────────────────────────────────────────
// Seeding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Commands between yields to the event loop. A memory or SQLite database
 * resolves every command in a microtask, so without this the whole seed (about
 * 2,700 commands) holds the event loop and starves timers and I/O in the host.
 * A vitest worker then misses its RPC replies and fails with
 * `Timeout calling "onTaskUpdate"` once a test file runs past 60s.
 */
const COMMANDS_PER_YIELD = 50;

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A database whose audit events are stamped by `clock` instead of the time they
 * are written. Everything else goes straight to `db`.
 */
function datedDatabase(db: Database, clock: () => string): Database {
	return new Proxy(db, {
		get(target, key) {
			if (key === 'addAuditEvent') {
				return (event: Parameters<Database['addAuditEvent']>[0]) =>
					target.addAuditEvent({ ...event, timestamp: clock() });
			}
			const value = Reflect.get(target, key, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

/**
 * Seed the realistic demo system into an empty database through the command
 * layer. Throws if a command fails, so a broken seed is never half-silent.
 */
export async function seedRealisticSystem(
	target: CommandContext,
	options: RealisticSystemOptions = {},
): Promise<RealisticSystemSummary> {
	const random = createRandom(options.seed ?? 20261016);

	// Each phase starts on its own day; events within it are a second apart
	const end = options.now ?? Date.now();
	let time = end;
	const at = (daysAgo: number) => {
		time = Math.max(time, end - daysAgo * DAY_MS);
	};
	const clock = () => {
		time += 1000;
		return new Date(Math.min(time, end)).toISOString();
	};
	const context: CommandContext =
		options.history === false ? target : { ...target, db: datedDatabase(target.db, clock) };
	time = end - 84 * DAY_MS;
	let operations = 0;
	let commands = 0;

	// Rule check snapshots, stamped with the history's clock
	let snapshots = 0;
	const check = async () => {
		if (options.checks === false) return;
		await run('snapshot', recordCheckSnapshot(context, undefined, clock()), false);
		snapshots += 1;
	};

	const run = async <T>(
		label: string,
		call: Promise<CommandResult<T>>,
		countsAsOperation = true,
	): Promise<T> => {
		const result = await call;
		commands += 1;
		if (commands % COMMANDS_PER_YIELD === 0) await yieldToEventLoop();
		if (!result.success) {
			throw new Error(`Seeding failed at ${label}: ${result.error?.message ?? 'unknown error'}`);
		}
		if (countsAsOperation) operations += 1;
		return result.data as T;
	};

	const override = (nodeId: string, tokenId: string, value: TokenValue, reason?: string) =>
		run(
			`override ${nodeId} ${tokenId}`,
			tokenOverrideCommand.handler({ nodeId, tokenId, value, reason }, context),
		);
	const subtract = (nodeId: string, tokenId: string, reason?: string) =>
		run(
			`subtract ${nodeId} ${tokenId}`,
			tokenSubtractCommand.handler({ nodeId, tokenId, reason }, context),
		);
	const add = (nodeId: string, spec: TokenSpec) =>
		run(
			`add ${nodeId} ${spec.id}`,
			tokenAddCommand.handler(
				{
					nodeId,
					tokenId: spec.id,
					value: spec.value,
					metadata: {
						category: spec.category,
						tier: spec.tier,
						status: spec.status ?? 'stable',
						platforms: [],
						tags: [],
						...(spec.deprecatedBy ? { deprecatedBy: spec.deprecatedBy } : {}),
						...(spec.description ? { description: spec.description } : {}),
					},
				},
				context,
			),
		);

	// Nodes: mixin roots before the nodes that include them
	const nodes = [...REALISTIC_NODES];
	for (const node of nodes) {
		await run(
			`create ${node.id}`,
			nodeCreateCommand.handler(
				{
					id: node.id,
					name: node.id,
					parentId: node.parentId,
					type: node.type,
					owner: node.owner,
					status: node.status ?? 'active',
					...(node.sunsetInDays === undefined
						? {}
						: { sunsetAt: new Date(end + node.sunsetInDays * DAY_MS).toISOString().slice(0, 10) }),
					...(node.replacedBy ? { replacedBy: node.replacedBy } : {}),
					includes: node.includes ?? [],
					includePolicy: node.includes ? 'override' : 'merge',
					tags: node.tags ?? [],
				},
				context,
			),
			false,
		);
	}

	// Root catalog, and the rules every node is checked against from the start
	const catalog = buildTokenCatalog();
	for (const spec of catalog) {
		await add('global', spec);
	}
	const constraints = [
		{
			id: 'text-contrast',
			name: 'Body text contrast',
			config: { type: 'contrast' as const, against: 'color.surface.base', min: 4.5 },
			severity: 'error' as const,
			applyTo: 'color.text.primary',
			enabled: true,
		},
		{
			id: 'button-contrast',
			name: 'Button label contrast',
			config: { type: 'contrast' as const, against: 'button.background', min: 4.5 },
			severity: 'error' as const,
			applyTo: 'button.foreground',
			enabled: true,
		},
		{
			id: 'spacing-scale',
			name: 'Spacing on the 4px scale',
			config: { type: 'scale' as const, base: 4, tolerance: 0 },
			severity: 'warning' as const,
			applyTo: 'spacing.*',
			enabled: true,
		},
	];
	await run(
		'constraints global',
		constraintsSetCommand.handler({ nodeId: 'global', constraints }, context),
		false,
	);

	// Mixins
	at(80);
	const highContrast: TokenSpec[] = [
		{ id: 'color.text.primary', value: '#000000', category: 'color', tier: 'semantic' },
		{ id: 'color.text.secondary', value: '#000000', category: 'color', tier: 'semantic' },
		{ id: 'color.border.default', value: '#000000', category: 'color', tier: 'semantic' },
		{ id: 'color.border.focus', value: '#0000EE', category: 'color', tier: 'semantic' },
		{ id: 'a11y.focus.ring.width', value: '3px', category: 'spacing', tier: 'semantic' },
		{ id: 'a11y.focus.ring.offset', value: '2px', category: 'spacing', tier: 'semantic' },
	];
	for (const spec of highContrast) await add('a11y-high-contrast', spec);
	for (const name of ['fast', 'normal', 'slow', 'slower', 'slowest']) {
		await add('motion-reduced', {
			id: `motion.duration.${name}`,
			value: '0ms',
			category: 'motion',
			tier: 'global',
		});
	}

	// Products: brand colours, type, radius, and a few customized components
	for (const [index, product] of PRODUCTS.entries()) {
		at(70 - index * 3);
		const brand = (lightness: number) => hsl(product.hue, 70, lightness);
		for (const [id, lightness] of [
			['color.brand.primary', 40],
			['color.brand.secondary', 32],
			['color.accent.primary', 40],
			['color.accent.hover', 34],
			['color.accent.pressed', 28],
			['color.text.link', 34],
			['color.border.focus', 40],
			['color.interactive.default', 40],
			['color.interactive.hover', 34],
			['color.interactive.pressed', 28],
		] as const) {
			await override(product.id, id, brand(lightness), `${product.id} brand`);
		}
		for (const component of pick(random, COMPONENTS, 8)) {
			await override(product.id, `${component}.background`, brand(42));
			await override(product.id, `${component}.border.focus`, brand(40));
			await override(product.id, `${component}.radius`, product.id === 'xbox' ? '12px' : '4px');
		}
	}
	at(55);
	await override('xbox', 'typography.family.sans', 'Segoe UI Variable, system-ui, sans-serif');
	await override('xbox', 'radius.md', '10px');
	await override('xbox', 'radius.lg', '14px');
	await override('office', 'typography.family.sans', 'Aptos, Segoe UI, sans-serif');
	await override('office', 'radius.md', '4px');
	await override('azure', 'typography.size.md', '14px');
	await override('teams', 'typography.size.md', '15px');
	// Redundant: the same value the root already provides
	at(52);
	await override(
		'teams',
		'typography.family.sans',
		'Segoe UI, system-ui, sans-serif',
		'Pin family',
	);
	await override('office-web', 'radius.md', '4px', 'Match office');
	await subtract('vscode', 'typography.family.display', 'VS Code has no display type');

	// Dark themes: surfaces, text, borders, and component colours
	for (const [index, nodeId] of DARK.entries()) {
		at(46 - index * 2);
		const product = PRODUCTS.find((entry) => nodeId.startsWith(entry.id)) ?? PRODUCTS[0];
		const tint = (lightness: number) => hsl(product.hue, 8, lightness);
		for (const [id, value] of [
			['color.surface.base', tint(10)],
			['color.surface.raised', tint(14)],
			['color.surface.sunken', tint(7)],
			['color.surface.overlay', tint(16)],
			['color.surface.inverse', tint(92)],
			['color.text.primary', tint(95)],
			['color.text.secondary', tint(75)],
			['color.text.muted', tint(62)],
			['color.text.inverse', tint(10)],
			['color.border.subtle', tint(20)],
			['color.border.default', tint(28)],
			['color.border.strong', tint(45)],
		] as const) {
			await override(nodeId, id, value);
		}
		for (const component of COMPONENTS) {
			await override(nodeId, `${component}.border`, tint(30));
		}
		for (const component of pick(random, COMPONENTS, 12)) {
			await override(nodeId, `${component}.background`, tint(18));
			await override(nodeId, `${component}.foreground`, tint(92));
		}
	}

	// Mobile platforms: touch targets, larger body type, no hover or tooltips
	for (const [index, nodeId] of MOBILE.entries()) {
		at(32 - index);
		await add(nodeId, {
			id: 'touch.target.min',
			value: '44px',
			category: 'spacing',
			tier: 'semantic',
		});
		for (const component of TOUCH_TARGETS) {
			await override(nodeId, `${component}.min.height`, '44px', 'Touch target');
		}
		await override(nodeId, 'typography.body.md.size', '17px');
		// Tooltips are removed wholesale below, so leave them out of the hover pick
		const hoverable = COMPONENTS.filter((component) => component !== 'tooltip');
		for (const component of pick(random, hoverable, 6)) {
			await subtract(nodeId, `${component}.background.hover`, 'No hover on touch');
		}
		for (const spec of componentTokens('tooltip', COMPONENTS.indexOf('tooltip'))) {
			await subtract(nodeId, spec.id, 'No tooltips on touch');
		}
	}

	// Devices, desktop, web
	at(24);
	await check();
	for (const nodeId of ['xbox-console', 'xbox-tv']) {
		await add(nodeId, {
			id: 'controller.focus.scale',
			value: 1.05,
			category: 'custom',
			tier: 'semantic',
		});
		await override(nodeId, 'typography.body.md.size', nodeId === 'xbox-tv' ? '24px' : '20px');
		await override(nodeId, 'button.min.height', '48px');
		for (const component of TOUCH_TARGETS) {
			await subtract(nodeId, `${component}.background.hover`, 'Controller focus replaces hover');
		}
	}
	await add('xbox-tv', {
		id: 'layout.safe-area',
		value: '5%',
		category: 'spacing',
		tier: 'semantic',
	});
	await override('office-mac', 'typography.family.sans', '-apple-system, SF Pro Text, sans-serif');
	await override(
		'office-windows',
		'typography.family.sans',
		'Aptos, Segoe UI Variable, sans-serif',
	);
	for (const nodeId of ['vscode-web', 'teams-web', 'office-web', 'azure-portal']) {
		await add(nodeId, {
			id: 'scrollbar.width',
			value: '10px',
			category: 'spacing',
			tier: 'semantic',
		});
	}
	await override('vscode-desktop', 'typography.family.mono', 'Cascadia Mono, Consolas, monospace');
	await override('xbox-ios-dark', 'color.surface.base', '#000000', 'True black on OLED');

	// Locales
	await add('azure-portal-de-DE', {
		id: 'typography.hyphens',
		value: 'auto',
		category: 'typography',
		tier: 'semantic',
	});
	await override('azure-portal-de-DE', 'button.padding.x', '16px', 'Longer labels');
	await override(
		'azure-portal-ja-JP',
		'typography.family.sans',
		'Yu Gothic UI, Meiryo, sans-serif',
	);
	await override('azure-portal-ja-JP', 'typography.body.md.line-height', 1.75);
	await add('office-web-ar-SA', {
		id: 'layout.direction',
		value: 'rtl',
		category: 'custom',
		tier: 'semantic',
	});
	await override(
		'office-web-ar-SA',
		'typography.family.sans',
		'Segoe UI Arabic, Tahoma, sans-serif',
	);

	// A lighter text trial on Android fails contrast; it is reset a week later
	at(20);
	await override('office-android', 'color.text.primary', '#A19F9D', 'Lighter text trial');
	await check();

	// Experiment and deprecated branch
	at(17);
	for (const [id, value] of [
		['spacing.inset.sm', '4px'],
		['spacing.inset.md', '8px'],
		['spacing.inset.lg', '12px'],
		['button.min.height', '28px'],
		['list.padding.y', '2px'],
	] as const) {
		await override('teams-experiment-compact', id, value, 'Compact density experiment');
	}
	await run(
		'reset teams-experiment-compact typography.size.md',
		tokenResetCommand.handler(
			{ nodeId: 'teams-experiment-compact', tokenId: 'typography.size.md', toAncestor: 'global' },
			context,
		),
	);
	await override('azure-classic', 'color.brand.primary', '#0072C6', 'Classic portal blue');
	await override('azure-classic', 'radius.md', '0px');

	// Cross-branch copies and a reset back to the root
	at(12);
	await run(
		'reset office-android color.text.primary',
		tokenResetCommand.handler({ nodeId: 'office-android', tokenId: 'color.text.primary' }, context),
	);
	for (const [nodeId, tokenId, fromNode] of [
		['vscode-dark', 'color.text.primary', 'xbox-dark'],
		['teams-dark', 'color.surface.base', 'office-dark'],
		['office-ios', 'button.min.height', 'xbox-ios'],
	] as const) {
		await run(
			`copy ${nodeId} ${tokenId}`,
			tokenCopyCommand.handler({ nodeId, tokenId, fromNode }, context),
		);
	}
	await run(
		'reset azure-dark color.brand.primary',
		tokenResetCommand.handler(
			{ nodeId: 'azure-dark', tokenId: 'color.brand.primary', toAncestor: 'global' },
			context,
		),
	);

	// Deliberate problems for health and constraint views
	at(10);
	await check();
	at(8);
	await override('azure-mobile', 'color.text.primary', '#9E9E9E', 'Softer text (fails contrast)');
	at(5);
	await override('office-ios', 'spacing.inset.md', '18px', 'Off the 4px scale');
	await check();
	at(2);
	// Pale brand button under a white label: fails whatever the seed picked
	await override('xbox-dark', 'button.background', hsl(120, 60, 80), 'Light brand button');
	await override('xbox-dark', 'button.foreground', '#FFFFFF', 'White label (fails contrast)');

	// The last check closes the history
	at(0);
	await check();

	return {
		nodes: nodes.length,
		tokens: catalog.length,
		operations,
		constraints: constraints.length,
		snapshots,
	};
}
