// The token tree the Violet page starts with. Every line below becomes a real
// Violet command (node.create, token.add, token.override, token.subtract,
// constraints.set), run on the in-memory store when the page loads.
//
// One rule fails on purpose: Ledger's amber is too light for white button
// text. It gives the rules something to say, and Alfred something to fix.

const meta = (category, tier = 'semantic') => ({ category, tier });

export const NODES = [
	{ name: 'base', type: 'root', label: 'Base' },
	{ name: 'atlas', type: 'product', parentId: 'base', label: 'Atlas' },
	{ name: 'atlas-dark', type: 'theme', parentId: 'atlas', label: 'Atlas dark' },
	{ name: 'atlas-touch', type: 'device', parentId: 'atlas', label: 'Atlas touch' },
	{ name: 'ledger', type: 'product', parentId: 'base', label: 'Ledger' },
];

/** Names for nodes that can be added later (by Alfred). */
export const LABELS = {
	...Object.fromEntries(NODES.map((node) => [node.name, node.label])),
	'ledger-dark': 'Ledger dark',
};

/** The tokens every node starts from, added at the root. */
export const BASE_TOKENS = [
	['color.brand', '#5B3FD6', meta('color', 'global')],
	['color.bg', '#FFFFFF', meta('color')],
	['color.surface', '#F4F2EE', meta('color')],
	['color.fg', '#1A1612', meta('color')],
	['color.muted', '#6B645A', meta('color')],
	['color.border', '#D8D2C8', meta('color')],
	['button.bg', '{color.brand}', meta('color', 'component')],
	['button.fg', '#FFFFFF', meta('color', 'component')],
	['button.hover', '#3F28A8', meta('color', 'component')],
	['shape.radius', '6px', meta('radius', 'global')],
	['space.pad', '16px', meta('spacing', 'global')],
	['control.height', '36px', meta('spacing', 'component')],
	['font.size', '15px', meta('typography', 'global')],
];

/** What each node below the root changes. Everything else it inherits. */
export const CHANGES = [
	['override', 'atlas', 'color.brand', '#0B6E4F'],
	['override', 'atlas', 'button.hover', '#084F39'],
	['override', 'atlas', 'shape.radius', '12px'],

	['override', 'atlas-dark', 'color.bg', '#101412'],
	['override', 'atlas-dark', 'color.surface', '#1B211E'],
	['override', 'atlas-dark', 'color.fg', '#EEF3EF'],
	['override', 'atlas-dark', 'color.muted', '#9BA8A0'],
	['override', 'atlas-dark', 'color.border', '#2F3A34'],
	['override', 'atlas-dark', 'color.brand', '#3DD6A0'],
	['override', 'atlas-dark', 'button.fg', '#06281C'],
	['override', 'atlas-dark', 'button.hover', '#6FE3BA'],

	['override', 'atlas-touch', 'space.pad', '20px'],
	['override', 'atlas-touch', 'control.height', '48px'],
	['override', 'atlas-touch', 'font.size', '17px'],
	['subtract', 'atlas-touch', 'button.hover'],

	['override', 'ledger', 'color.brand', '#F79009'],
	['override', 'ledger', 'button.hover', '#B54708'],
	['override', 'ledger', 'shape.radius', '0px'],
	['override', 'ledger', 'color.surface', '#FBF6EC'],
];

/** Rules set at the root, so every node below inherits them. */
export const RULES = [
	{
		id: 'button-contrast',
		name: 'Button text contrast',
		description: 'Button text reads against its background, 4.5 to 1 or better.',
		applyTo: 'button.fg',
		config: { type: 'contrast', against: 'button.bg', min: 4.5 },
	},
	{
		id: 'body-contrast',
		name: 'Body text contrast',
		description: 'Body text reads against the page, 4.5 to 1 or better.',
		applyTo: 'color.fg',
		config: { type: 'contrast', against: 'color.bg', min: 4.5 },
	},
	{
		id: 'spacing-grid',
		name: 'Spacing on the 4px grid',
		description: 'Padding is a multiple of 4px.',
		applyTo: 'space.*',
		config: { type: 'scale', base: 4 },
	},
];

/** One more rule, set on the touch node only. */
export const TOUCH_RULES = [
	{
		id: 'touch-target',
		name: 'Touch targets',
		description: 'Controls are at least 44px tall on touch.',
		applyTo: 'control.height',
		config: { type: 'range', min: 44 },
	},
];

/** The dark theme Alfred adds for Ledger. */
export const LEDGER_DARK = [
	['color.bg', '#14110C'],
	['color.surface', '#211C14'],
	['color.fg', '#F6EFE2'],
	['color.muted', '#B0A592'],
	['color.border', '#3A3122'],
	['button.fg', '#231400'],
];

/**
 * Build the tree. `run(name, input)` executes one Violet command and returns
 * its result; the seed stops at the first failure and returns it.
 */
export async function seedTree(run) {
	const steps = [
		...NODES.map(({ name, type, parentId }) => ['node.create', { name, type, parentId }]),
		...BASE_TOKENS.map(([tokenId, value, metadata]) => [
			'token.add',
			{ nodeId: 'base', tokenId, value, metadata },
		]),
		...CHANGES.map(([kind, nodeId, tokenId, value]) =>
			kind === 'subtract'
				? ['token.subtract', { nodeId, tokenId }]
				: ['token.override', { nodeId, tokenId, value }]
		),
		['constraints.set', { nodeId: 'base', constraints: RULES }],
		['constraints.set', { nodeId: 'atlas-touch', constraints: TOUCH_RULES }],
	];
	for (const [name, input] of steps) {
		const result = await run(name, input);
		if (!result.success) return result;
	}
	return { success: true };
}
