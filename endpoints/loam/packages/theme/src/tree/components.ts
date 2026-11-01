/**
 * The 108 component ids of the token contract (2.1) with their light values, written on the
 * `loam` node. The ids and order are those of `violet-elements`' registry, `registryVersion`
 * 0.1.0. The values are that registry's light values (2.2), except `color.text.muted` and
 * `color.border.strong`, raised to meet the contrast floors (see the specification's version 1
 * values), and the field borders the design document changed: resting and invalid to 3:1, hover
 * one step stronger than rest.
 */
import { ref, type TreeToken } from './types.js';

const c = (name: string) => ref(`ref.color.${name}`);
const space = (step: number) => ref(`ref.space.${step}`);

export const COMPONENT_TOKENS: readonly TreeToken[] = [
	// Surfaces.
	{ id: 'color.surface.page', value: c('oat.50') },
	{ id: 'color.surface.card', value: c('oat.100') },
	{ id: 'color.surface.subtle', value: c('oat.200') },
	{ id: 'color.surface.selected', value: c('sage.100') },
	{ id: 'color.surface.floating', value: c('oat.200') },
	// Text.
	{ id: 'color.text.primary', value: c('ink.900') },
	{ id: 'color.text.secondary', value: c('ink.700') },
	{ id: 'color.text.muted', value: c('ink.500') },
	// Borders and focus.
	{ id: 'color.border.subtle', value: 'rgba(28, 26, 13, 0.10)' },
	{ id: 'color.border.strong', value: 'rgba(28, 26, 13, 0.48)' },
	{ id: 'color.focus.ring', value: 'rgba(24, 24, 27, 0.5)' },
	// Selected controls.
	{ id: 'color.control.selected.background', value: ref('color.surface.selected') },
	{ id: 'color.control.selected.foreground', value: c('sage.800') },
	{ id: 'color.control.selected.border', value: 'rgba(36, 70, 53, 0.22)' },
	// Actions.
	{ id: 'color.action.primary.background', value: c('tomato.600') },
	{ id: 'color.action.primary.text', value: c('white') },
	{ id: 'color.action.primary.hover', value: c('tomato.650') },
	{ id: 'color.action.primary.pressed', value: c('tomato.700') },
	{ id: 'color.action.secondary.background', value: c('oat.200') },
	{ id: 'color.action.secondary.text', value: c('ink.900') },
	{ id: 'color.action.secondary.border', value: 'rgba(28, 26, 13, 0.18)' },
	{ id: 'color.action.secondary.hover', value: c('oat.300') },
	{ id: 'color.action.secondary.pressed', value: c('oat.400') },
	{ id: 'color.action.danger.background', value: c('red.700') },
	{ id: 'color.action.danger.text', value: c('white') },
	{ id: 'color.action.danger.hover', value: c('red.750') },
	{ id: 'color.action.danger.pressed', value: c('red.800') },
	// States.
	{ id: 'color.state.success.background', value: c('green.50') },
	{ id: 'color.state.success.text', value: c('green.800') },
	{ id: 'color.state.success.border', value: 'rgba(22, 101, 52, 0.28)' },
	{ id: 'color.state.warning.background', value: c('amber.50') },
	{ id: 'color.state.warning.text', value: c('amber.800') },
	{ id: 'color.state.warning.border', value: 'rgba(245, 158, 11, 0.34)' },
	{ id: 'color.state.danger.background', value: c('red.50') },
	{ id: 'color.state.danger.text', value: c('red.700') },
	{ id: 'color.state.danger.border', value: 'rgba(220, 38, 38, 0.34)' },
	// Fields.
	{ id: 'color.field.background', value: ref('color.surface.page') },
	{ id: 'color.field.background.readonly', value: ref('color.surface.subtle') },
	{ id: 'color.field.text', value: ref('color.text.primary') },
	{ id: 'color.field.placeholder', value: ref('color.text.muted') },
	// The resting and invalid borders are the field's only boundary, so they meet 3:1 (design.md,
	// 2026-11-01); hover stays one step stronger than rest.
	{ id: 'color.field.border', value: ref('color.border.strong') },
	{ id: 'color.field.border.hover', value: 'rgba(28, 26, 13, 0.64)' },
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
	{ id: 'type.caption.xs.size', value: ref('size.font.xs') },
	{ id: 'type.caption.xs.line', value: ref('size.line.xs') },
	{ id: 'type.caption.xs.weight', value: ref('weight.medium') },
	{ id: 'type.label.sm.size', value: ref('size.font.sm') },
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
	// Radii.
	{ id: 'radius.sm', value: '2px' },
	{ id: 'radius.md', value: '4px' },
	{ id: 'radius.lg', value: '6px' },
	{ id: 'radius.round', value: '9999px' },
	// Elevation.
	{
		id: 'shadow.control',
		value: '0 1px 1px rgba(28, 26, 13, 0.09), 0 2px 5px rgba(28, 26, 13, 0.04)',
	},
	{
		id: 'shadow.card',
		value: '0 1px 2px rgba(28, 26, 13, 0.15), 0 5px 10px rgba(28, 26, 13, 0.06)',
	},
	{
		id: 'shadow.floating',
		value: '0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08)',
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
];
