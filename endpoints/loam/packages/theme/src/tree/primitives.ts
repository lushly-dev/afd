/**
 * Primitives: the solid colors and the spacing scale every theme draws from. They are reference
 * tokens under `ref.*`, written on the `loam` node so every theme can reference them; semantic
 * tokens reference them, and no export and no component reads them.
 */
import type { TreeToken } from './types.js';

const COLORS: Record<string, string> = {
	white: '#FFFFFF',
	black: '#000000',
	// Warm light neutrals (light surfaces and secondary actions).
	'oat.50': '#FFFEFA',
	'oat.100': '#FAF9F5',
	'oat.200': '#F0EFE6',
	'oat.300': '#E7E4D8',
	'oat.400': '#DDD9CB',
	// Light text.
	'ink.900': '#18181b',
	'ink.700': '#414651',
	'ink.500': '#666c7a',
	// Dark surfaces and secondary actions.
	'night.950': '#161713',
	'night.900': '#1D1F1B',
	'night.850': '#20231D',
	'night.800': '#272A24',
	'night.750': '#2B2D27',
	'night.700': '#34372F',
	'night.650': '#3D4038',
	// Dark text.
	'parchment.100': '#F5EFE3',
	'parchment.300': '#D3CCBF',
	'parchment.500': '#A39B8D',
	// Selection.
	'sage.50': '#D9EFE0',
	'sage.100': '#DDEADF',
	'sage.800': '#244635',
	'pine.900': '#22352C',
	// Primary action.
	'tomato.600': '#C84F3B',
	'tomato.650': '#BD4A37',
	'tomato.700': '#B54633',
	// Danger.
	'red.50': '#FBE2E2',
	'red.200': '#F5C7C2',
	'red.550': '#CF4030',
	'red.600': '#C4301F',
	'red.700': '#B42318',
	'red.750': '#A32015',
	'red.800': '#911D12',
	'red.850': '#A30000',
	'red.900': '#8A0000',
	'red.950': '#700000',
	// Success.
	'green.50': '#E3F1E7',
	'green.200': '#B7E4C2',
	'green.800': '#166534',
	'green.900': '#0B5A1E',
	// Warning.
	'amber.50': '#FDEBCC',
	'amber.200': '#F3D6A3',
	'amber.800': '#92400E',
	'amber.900': '#6B3200',
	// High-contrast neutrals.
	'grey.50': '#F2F2F2',
	'grey.100': '#E6E6E6',
	'grey.150': '#E0E0E0',
	'grey.200': '#CCCCCC',
	'grey.650': '#595959',
	'grey.700': '#4D4D4D',
	'grey.750': '#3D3D3D',
	'grey.800': '#333333',
	'grey.900': '#1F1F1F',
};

/** The spacing scale in CSS pixels; comfortable and compact density pick different steps. */
const SPACE = [2, 4, 6, 8, 12, 16, 24] as const;

export const PRIMITIVES: readonly TreeToken[] = [
	...Object.entries(COLORS).map(([name, value]) => ({ id: `ref.color.${name}`, value })),
	...SPACE.map((step) => ({ id: `ref.space.${step}`, value: `${step}px` })),
];
