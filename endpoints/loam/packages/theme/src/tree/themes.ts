/**
 * The theme overrides (2.2). Dark is Refined's dark (D154): the AFD site's ink field and its deep
 * greens, paper text, mint for what is chosen and for focus, opaque deep tints behind messages,
 * fields that go toward black, and washes of paper for the second action. High contrast is Loam's:
 * neutral surfaces, 7:1 text, 3:1 non-text and focus ring, a 3px focus width and shadows replaced
 * by borders (a spread shadow draws a border without changing layout; the field's well, which
 * already has a border, takes none); its field borders keep the values they had before the design
 * document raised light and dark.
 */
import { ref, type TreeToken } from './types.js';

const c = (name: string) => ref(`ref.color.${name}`);

export const DARK_OVERRIDES: readonly TreeToken[] = [
	{ id: 'color.surface.page', value: c('ink') },
	{ id: 'color.surface.card', value: c('ink.raised') },
	{ id: 'color.surface.subtle', value: c('green.700') },
	{ id: 'color.surface.selected', value: c('green.900') },
	{ id: 'color.surface.floating', value: c('green.800') },
	{ id: 'color.surface.highlight', value: c('stone.700') },
	{ id: 'color.surface.pressed', value: 'rgba(244, 240, 234, 0.14)' },
	{ id: 'color.text.primary', value: c('paper') },
	{ id: 'color.text.secondary', value: c('green.200') },
	{ id: 'color.text.muted', value: c('stone.400') },
	{ id: 'color.border.subtle', value: 'rgba(244, 240, 234, 0.10)' },
	// Stone-450, lighter than the sage-500 Refined drew with (2.70 on the subtle surface), so a control's
	// edge, a resize handle and a read-only field's line meet 3:1 with margin on every surface (the line
	// on the read-only fill over subtle is 3.54).
	{ id: 'color.border.strong', value: c('stone.450') },
	{ id: 'color.focus.ring', value: c('mint') },
	{ id: 'color.control.selected.background', value: c('green.900') },
	{ id: 'color.control.selected.foreground', value: c('mint') },
	{ id: 'color.control.selected.border', value: 'rgba(163, 235, 205, 0.45)' },
	// The main action turns over: paper, with ink text.
	{ id: 'color.action.primary.background', value: c('paper') },
	{ id: 'color.action.primary.text', value: c('ink') },
	{ id: 'color.action.primary.hover', value: c('stone.200') },
	{ id: 'color.action.primary.pressed', value: c('stone.300') },
	{ id: 'color.action.secondary.background', value: 'rgba(244, 240, 234, 0.09)' },
	{ id: 'color.action.secondary.text', value: ref('color.text.primary') },
	{ id: 'color.action.secondary.hover', value: 'rgba(244, 240, 234, 0.13)' },
	{ id: 'color.action.secondary.pressed', value: 'rgba(244, 240, 234, 0.17)' },
	{ id: 'color.state.success.background', value: c('green.900') },
	{ id: 'color.state.success.text', value: c('mint') },
	// Mint, as the success text: light's mint ink does not show on the dark surfaces (D154).
	{ id: 'color.state.success.foreground', value: c('mint') },
	{ id: 'color.state.warning.background', value: c('amber.950') },
	{ id: 'color.state.warning.text', value: c('amber.200') },
	{ id: 'color.state.danger.background', value: c('red.950') },
	{ id: 'color.state.danger.text', value: c('red.200') },
	{ id: 'color.state.danger.foreground', value: c('red.300') },
	{ id: 'color.field.background', value: 'rgba(0, 0, 0, 0.26)' },
	{ id: 'color.field.background.readonly', value: 'rgba(244, 240, 234, 0.06)' },
	{ id: 'color.field.border', value: c('sage.500') },
	{ id: 'color.field.border.hover', value: c('stone.400') },
	{ id: 'color.field.border.invalid', value: c('red.300') },
	{
		id: 'shadow.control',
		value: '0 0 0 1px rgba(244, 240, 234, 0.07), 0 1px 2px rgba(0, 0, 0, 0.40)',
	},
	{
		id: 'shadow.card',
		value:
			'0 0 0 1px rgba(244, 240, 234, 0.07), 0 1px 2px rgba(0, 0, 0, 0.32), 0 6px 14px -2px rgba(0, 0, 0, 0.30)',
	},
	{
		id: 'shadow.floating',
		value:
			'0 0 0 1px rgba(244, 240, 234, 0.13), 0 6px 16px -2px rgba(0, 0, 0, 0.45), 0 22px 48px -8px rgba(0, 0, 0, 0.60)',
	},
	// The field's well: light's geometry, deepened as the other dark shadows are, since a tenth of
	// black does not show on the dark page.
	{ id: 'shadow.well', value: 'inset 0 2px 3px -1px rgba(0, 0, 0, 0.28)' },
];

export const HIGH_CONTRAST_OVERRIDES: readonly TreeToken[] = [
	{ id: 'color.surface.page', value: c('white') },
	{ id: 'color.surface.card', value: c('white') },
	{ id: 'color.surface.subtle', value: c('grey.50') },
	{ id: 'color.surface.selected', value: c('grey.150') },
	{ id: 'color.surface.floating', value: c('white') },
	{ id: 'color.text.primary', value: c('black') },
	{ id: 'color.text.secondary', value: c('grey.900') },
	{ id: 'color.text.muted', value: c('grey.750') },
	{ id: 'color.border.subtle', value: c('grey.650') },
	{ id: 'color.border.strong', value: c('black') },
	{ id: 'color.focus.ring', value: c('black') },
	{ id: 'color.control.selected.background', value: c('grey.150') },
	{ id: 'color.control.selected.foreground', value: c('black') },
	{ id: 'color.control.selected.border', value: c('black') },
	{ id: 'color.action.primary.background', value: c('black') },
	{ id: 'color.action.primary.text', value: c('white') },
	{ id: 'color.action.primary.hover', value: c('grey.800') },
	{ id: 'color.action.primary.pressed', value: c('grey.700') },
	{ id: 'color.action.secondary.background', value: c('white') },
	{ id: 'color.action.secondary.text', value: c('black') },
	{ id: 'color.action.secondary.border', value: c('black') },
	{ id: 'color.action.secondary.hover', value: c('grey.100') },
	{ id: 'color.action.secondary.pressed', value: c('grey.200') },
	{ id: 'color.action.danger.background', value: c('contrast.red') },
	{ id: 'color.action.danger.text', value: c('white') },
	{ id: 'color.action.danger.hover', value: c('contrast.red.hover') },
	{ id: 'color.action.danger.pressed', value: c('contrast.red.pressed') },
	{ id: 'color.state.success.background', value: c('white') },
	{ id: 'color.state.success.text', value: c('contrast.green') },
	{ id: 'color.state.success.border', value: c('contrast.green') },
	{ id: 'color.state.warning.background', value: c('white') },
	{ id: 'color.state.warning.text', value: c('contrast.amber') },
	{ id: 'color.state.warning.border', value: c('contrast.amber') },
	{ id: 'color.state.danger.background', value: c('white') },
	{ id: 'color.state.danger.text', value: c('contrast.red') },
	{ id: 'color.state.danger.border', value: c('contrast.red') },
	// The three ids of #659 carried Lushly's light values into high contrast; they take its own
	// neutral grey and 7:1 red and green (D154).
	{ id: 'color.state.danger.foreground', value: c('contrast.red') },
	{ id: 'color.state.success.foreground', value: c('contrast.green') },
	{ id: 'color.surface.pressed', value: c('grey.100') },
	{ id: 'color.field.background.readonly', value: ref('color.surface.subtle') },
	{ id: 'color.field.border', value: ref('color.border.subtle') },
	{ id: 'color.field.border.hover', value: ref('color.border.strong') },
	{ id: 'shadow.control', value: '0 0 0 1px #000000' },
	{ id: 'shadow.card', value: '0 0 0 1px #000000' },
	{ id: 'shadow.floating', value: '0 0 0 2px #000000' },
	// A field's edge is already a border and a rule in the field border colours, so its well takes
	// no shadow: a zero spread draws nothing, and a list of shadows cannot hold `none`.
	{ id: 'shadow.well', value: 'inset 0 0 0 0 #000000' },
	{ id: 'shell.size.focus', value: '3px' },
];
