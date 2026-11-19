/**
 * Loam's component ids (2.1) with their light values, written on the `loam` node: a value for
 * every id of `violet-elements`' token interface (`tokens/interface.json`, which that package
 * owns and `theme:check` compares the tree with), and Loam's own shared ids beside them, which
 * the export carries too. The first 108 ids and their order are those of `violet-elements`'
 * registry, `registryVersion` 0.1.0.
 *
 * The values are AFD's theme, Refined (D159): the design system of the AFD site, settled on the
 * site's review pages and approved by the owner on 2026-11-17. Ink on paper, mint for what is
 * chosen, blue for focus; fields go toward the base (white here) with an inner cut, a soft mint
 * behind a tick or a switch key, greyed tints behind messages; Inter for the interface, Space
 * Grotesk for headings, IBM Plex Mono for code; rounded buttons and fields. The palette the
 * components were first drawn in is Lushly's, and Lushly carries it as its own theme.
 */
import { ref, type TreeToken } from './types.js';

const c = (name: string) => ref(`ref.color.${name}`);
const space = (step: number) => ref(`ref.space.${step}`);

export const COMPONENT_TOKENS: readonly TreeToken[] = [
	// Surfaces: paper, with white for what floats and is raised.
	{ id: 'color.surface.page', value: c('paper') },
	{ id: 'color.surface.card', value: c('paper.bright') },
	{ id: 'color.surface.subtle', value: c('paper.200') },
	{ id: 'color.surface.selected', value: c('mint.wash') },
	{ id: 'color.surface.floating', value: c('white') },
	// Text: ink.
	{ id: 'color.text.primary', value: c('ink') },
	{ id: 'color.text.secondary', value: c('ink.soft') },
	{ id: 'color.text.muted', value: c('stone.600') },
	// Borders and focus: a quiet hairline, a control's edge that meets 3:1, the site's blue.
	{ id: 'color.border.subtle', value: 'rgba(24, 27, 26, 0.10)' },
	{ id: 'color.border.strong', value: c('sage.500') },
	{ id: 'color.focus.ring', value: c('blue.ink') },
	// Selected controls: a soft mint, marked in mint ink.
	{ id: 'color.control.selected.background', value: c('mint.soft') },
	{ id: 'color.control.selected.foreground', value: c('mint.ink') },
	{ id: 'color.control.selected.border', value: 'rgba(44, 94, 75, 0.5)' },
	// Actions: the main action is ink; the second is a wash of ink with no outline.
	{ id: 'color.action.primary.background', value: c('ink') },
	{ id: 'color.action.primary.text', value: c('paper') },
	{ id: 'color.action.primary.hover', value: c('green.700') },
	{ id: 'color.action.primary.pressed', value: c('green.800') },
	{ id: 'color.action.secondary.background', value: 'rgba(24, 27, 26, 0.07)' },
	{ id: 'color.action.secondary.text', value: c('ink') },
	{ id: 'color.action.secondary.border', value: 'transparent' },
	{ id: 'color.action.secondary.hover', value: 'rgba(24, 27, 26, 0.11)' },
	{ id: 'color.action.secondary.pressed', value: 'rgba(24, 27, 26, 0.15)' },
	{ id: 'color.action.danger.background', value: c('red.ink') },
	{ id: 'color.action.danger.text', value: c('white') },
	{ id: 'color.action.danger.hover', value: c('red.800') },
	{ id: 'color.action.danger.pressed', value: c('red.900') },
	// States: greyed tints with no outline; high contrast draws the borders.
	{ id: 'color.state.success.background', value: c('mint.wash') },
	{ id: 'color.state.success.text', value: c('mint.ink') },
	{ id: 'color.state.success.border', value: 'transparent' },
	{ id: 'color.state.warning.background', value: c('amber.wash') },
	{ id: 'color.state.warning.text', value: c('amber.800') },
	{ id: 'color.state.warning.border', value: 'transparent' },
	{ id: 'color.state.danger.background', value: c('red.wash') },
	{ id: 'color.state.danger.text', value: c('red.ink') },
	{ id: 'color.state.danger.border', value: 'transparent' },
	// Fields go toward the base, white here, so a field reads as a place to type; a read-only one
	// is a wash of ink.
	{ id: 'color.field.background', value: c('white') },
	{ id: 'color.field.background.readonly', value: 'rgba(24, 27, 26, 0.05)' },
	{ id: 'color.field.text', value: ref('color.text.primary') },
	{ id: 'color.field.placeholder', value: ref('color.text.muted') },
	// The resting border is the field's top inner line (stone-500, 3:1 on the white field); hover is
	// ink-soft, focus the focus ring and invalid the danger text.
	{ id: 'color.field.border', value: c('stone.500') },
	{ id: 'color.field.border.hover', value: c('ink.soft') },
	{ id: 'color.field.border.focus', value: ref('color.focus.ring') },
	{ id: 'color.field.border.invalid', value: ref('color.state.danger.text') },
	// Type scale.
	{ id: 'size.font.xs', value: '11px' },
	{ id: 'size.font.sm', value: '12px' },
	{ id: 'size.font.md', value: '14px' },
	{ id: 'size.font.lg', value: '18px' },
	{ id: 'size.font.xl', value: '24px' },
	{ id: 'size.line.xs', value: '14px' },
	{ id: 'size.line.sm', value: '16px' },
	{ id: 'size.line.md', value: '20px' },
	{ id: 'size.line.lg', value: '24px' },
	{ id: 'size.line.xl', value: '32px' },
	{ id: 'weight.regular', value: '400' },
	{ id: 'weight.light', value: '100' },
	{ id: 'weight.medium', value: '500' },
	{ id: 'weight.semibold', value: '600' },
	// Refined's three working sizes: 12px captions at the regular weight, 13px labels, 14px body.
	{ id: 'type.caption.xs.size', value: ref('size.font.sm') },
	{ id: 'type.caption.xs.line', value: ref('size.line.sm') },
	{ id: 'type.caption.xs.weight', value: ref('weight.regular') },
	{ id: 'type.label.sm.size', value: '13px' },
	{ id: 'type.label.sm.line', value: ref('size.line.sm') },
	{ id: 'type.label.sm.weight', value: ref('weight.medium') },
	{ id: 'type.body.md.size', value: ref('size.font.md') },
	{ id: 'type.body.md.line', value: ref('size.line.md') },
	{ id: 'type.body.md.weight', value: ref('weight.regular') },
	{ id: 'type.title.sm.size', value: ref('size.font.lg') },
	{ id: 'type.title.sm.line', value: ref('size.line.lg') },
	{ id: 'type.title.sm.weight', value: ref('weight.semibold') },
	{ id: 'type.title.md.size', value: ref('size.font.xl') },
	{ id: 'type.title.md.line', value: ref('size.line.xl') },
	{ id: 'type.title.md.weight', value: ref('weight.semibold') },
	// Targets and spacing.
	{ id: 'size.target.compact', value: '24px' },
	{ id: 'size.target.natural', value: '32px' },
	{ id: 'size.target.comfortable', value: '44px' },
	{ id: 'size.space.xs', value: space(2) },
	{ id: 'size.space.sm', value: space(4) },
	{ id: 'size.space.md', value: space(8) },
	{ id: 'size.space.lg', value: space(12) },
	{ id: 'size.space.xl', value: space(24) },
	{ id: 'space.inline.sm', value: space(4) },
	{ id: 'space.inline.md', value: space(8) },
	{ id: 'space.inline.lg', value: space(12) },
	{ id: 'space.stack.xs', value: space(4) },
	{ id: 'space.stack.sm', value: space(8) },
	{ id: 'space.stack.md', value: space(12) },
	{ id: 'space.layout.sm', value: space(12) },
	{ id: 'space.layout.md', value: space(24) },
	// Radii: rounding on buttons and fields (md), more on what floats (lg).
	{ id: 'radius.sm', value: '4px' },
	{ id: 'radius.md', value: '8px' },
	{ id: 'radius.lg', value: '12px' },
	{ id: 'radius.round', value: '9999px' },
	// Elevation: a hairline ring and a soft shadow, deeper for what floats.
	{
		id: 'shadow.control',
		value: '0 0 0 1px rgba(24, 27, 26, 0.05), 0 1px 2px rgba(24, 27, 26, 0.10)',
	},
	{
		id: 'shadow.card',
		value:
			'0 0 0 1px rgba(24, 27, 26, 0.06), 0 1px 2px rgba(24, 27, 26, 0.06), 0 4px 10px -2px rgba(24, 27, 26, 0.06)',
	},
	{
		id: 'shadow.floating',
		value:
			'0 0 0 1px rgba(24, 27, 26, 0.08), 0 4px 12px -2px rgba(24, 27, 26, 0.12), 0 18px 40px -8px rgba(24, 27, 26, 0.20)',
	},
	// Layers.
	{ id: 'z-index.base', value: '0' },
	{ id: 'z-index.raised', value: '1' },
	{ id: 'z-index.sticky', value: '10' },
	{ id: 'z-index.overlay', value: '100' },
	{ id: 'z-index.popover', value: '200' },
	{ id: 'z-index.modal', value: '300' },
	{ id: 'z-index.toast', value: '400' },
	// Motion.
	{ id: 'duration.fast', value: '120ms' },
	{ id: 'duration.base', value: '180ms' },
	{ id: 'duration.slow', value: '280ms' },
	{ id: 'easing.standard', value: 'cubic-bezier(0.2, 0, 0, 1)' },
	{ id: 'easing.emphasized', value: 'cubic-bezier(0.16, 1, 0.3, 1)' },
	// Type families: Inter for the interface, IBM Plex Mono for code and a command's name. Loam ships
	// the three faces (`fonts/`, `loam-fonts.css`); elsewhere the stacks fall back to the system's.
	{ id: 'font.family.body', value: '"Inter", system-ui, sans-serif' },
	{ id: 'font.family.mono', value: '"IBM Plex Mono", ui-monospace, Consolas, monospace' },
	// Ids the components read before the interface listed them (#659): an alert's icon, a raised
	// key on a track, a pressed surface and the focus ring's width.
	{ id: 'color.state.danger.foreground', value: c('red.ink') },
	{ id: 'color.state.success.foreground', value: c('mint.ink') },
	{ id: 'color.surface.highlight', value: c('white') },
	{ id: 'color.surface.pressed', value: c('stone.200') },
	{ id: 'size.focus-ring.width', value: '2px' },
	// Ids the Refined design added to the interface (contractVersion 2): headings (the dialog's
	// title, the text component's heading variants) in Space Grotesk, and a field's well, the soft
	// inner shadow under its top rule, which dark deepens and high contrast removes (themes.ts).
	{ id: 'font.family.heading', value: '"Space Grotesk", "Segoe UI", system-ui, sans-serif' },
	{ id: 'shadow.well', value: 'inset 0 2px 3px -1px rgba(0, 0, 0, 0.1)' },
];
