/**
 * Primitives: the solid colors and the spacing scale every theme draws from. They are reference
 * tokens under `ref.*`, written on the `loam` node so every theme can reference them; semantic
 * tokens reference them, and no export and no component reads them.
 *
 * The colors are AFD's (D159): the design system of the AFD site, `site/css/tokens-m2.css`, under
 * the site's names (`--afd-ink-soft` is `ink.soft`), with the tints and shades the Refined theme
 * added where the site has none, each marked. The high-contrast colors are Loam's own.
 */
import type { TreeToken } from './types.js';

const COLORS: Record<string, string> = {
	white: '#ffffff',
	black: '#000000',
	// Ink and paper: text, the main action and the light surfaces.
	ink: '#181b1a',
	'ink.raised': '#222824',
	'ink.soft': '#48534b',
	paper: '#f4f0ea',
	'paper.bright': '#f8f9f3',
	// Added by Refined: a shade of paper for bands, tinted rows and tracks.
	'paper.200': '#e9e5de',
	// Stone: lines, muted text and the field's edge.
	'stone.200': '#d8dcd6',
	'stone.300': '#bec6bd',
	'stone.400': '#adb6ab',
	'stone.500': '#869089',
	// Added: between stone-400 and stone-500, dark's strong border (D159).
	'stone.450': '#939c95',
	'stone.600': '#5e6460',
	'stone.700': '#4d5b50',
	'sage.500': '#6b7d6e',
	// The dark surfaces.
	'green.200': '#bdcfc1',
	'green.700': '#2e3a33',
	'green.800': '#252e29',
	'green.900': '#20352c',
	// Selection and success. `mint.soft` and `mint.wash` are Refined's: mint with its saturation
	// taken down, behind a tick or a switch key, and a greyed tint for a selected row or a success
	// message on paper.
	mint: '#a3ebcd',
	'mint.ink': '#2c5e4b',
	'mint.soft': '#badecf',
	'mint.wash': '#dfeae3',
	// Danger. `red.800` and `red.900` (a destructive button under the pointer and pressed),
	// `red.950` (an error surface on dark) and `red.wash` (an error on paper) are added.
	'red.ink': '#c42a1a',
	'red.200': '#ffab99',
	'red.300': '#ff897a',
	'red.800': '#ad2416',
	'red.900': '#96200f',
	'red.950': '#3d211d',
	'red.wash': '#f7e4df',
	// Warning: the site has none, so all four are added.
	'amber.200': '#f3d6a3',
	'amber.800': '#92400e',
	'amber.950': '#3a2b18',
	'amber.wash': '#f3e8d2',
	// Focus.
	'blue.ink': '#146ba0',
	// High contrast: neutrals, and danger, success and warning at 7:1 on white.
	'grey.50': '#F2F2F2',
	'grey.100': '#E6E6E6',
	'grey.150': '#E0E0E0',
	'grey.200': '#CCCCCC',
	'grey.650': '#595959',
	'grey.700': '#4D4D4D',
	'grey.750': '#3D3D3D',
	'grey.800': '#333333',
	'grey.900': '#1F1F1F',
	'contrast.red': '#A30000',
	'contrast.red.hover': '#8A0000',
	'contrast.red.pressed': '#700000',
	'contrast.green': '#0B5A1E',
	'contrast.amber': '#6B3200',
};

/** The spacing scale in CSS pixels; comfortable and compact density pick different steps. */
const SPACE = [2, 4, 6, 8, 12, 16, 24] as const;

export const PRIMITIVES: readonly TreeToken[] = [
	...Object.entries(COLORS).map(([name, value]) => ({ id: `ref.color.${name}`, value })),
	...SPACE.map((step) => ({ id: `ref.space.${step}`, value: `${step}px` })),
];
