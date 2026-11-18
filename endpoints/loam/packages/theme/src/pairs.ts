/**
 * The color pairs the theme must keep legible (2.2), and their floors per theme. Text is 4.5:1
 * in light and dark and 7:1 in high contrast; non-text (boundaries a control needs to be seen,
 * and the focus ring) is 3:1 everywhere.
 *
 * Light and dark do not hold two groups to 3:1, so version 1 keeps today's values for them:
 * decorative borders (`color.border.subtle`, and the secondary-action, selected-control and state
 * borders beside text or a fill), and button fills, which their labels identify. High contrast
 * holds both to 3:1. The resting and invalid field borders are a field's only boundary, so every
 * theme holds them to 3:1 (the design document, 2026-11-01), on every surface a field sits on; a
 * read-only field draws its line in `color.border.strong`, held the same way.
 */
import type { ThemeName } from './tree/index.js';

export type PairKind = 'text' | 'non-text';

export interface ContrastPair {
	foreground: string;
	background: string;
	kind: PairKind;
	/** Only checked in these themes; every theme when absent. */
	themes?: readonly ThemeName[];
	/**
	 * The surfaces a translucent background is drawn over when measured; `color.surface.page` when
	 * absent. A field's fill is translucent in some themes, so its pairs are measured over each
	 * surface a field sits on.
	 */
	backdrops?: readonly string[];
}

export const CONTRAST_FLOORS: Record<ThemeName, Record<PairKind, number>> = {
	light: { text: 4.5, 'non-text': 3 },
	dark: { text: 4.5, 'non-text': 3 },
	'high-contrast': { text: 7, 'non-text': 3 },
};

const SURFACES = ['page', 'card', 'subtle', 'floating', 'selected'].map(
	(name) => `color.surface.${name}`
);
const [PAGE, CARD, SUBTLE, FLOATING] = SURFACES as [string, string, string, string, string];
const OPEN_SURFACES = [PAGE, CARD, SUBTLE, FLOATING];

const on = (
	foregrounds: readonly string[],
	backgrounds: readonly string[],
	kind: PairKind,
	themes?: readonly ThemeName[]
): ContrastPair[] =>
	foregrounds.flatMap((foreground) =>
		backgrounds.map((background) => ({ foreground, background, kind, ...(themes && { themes }) }))
	);

const action = (name: string) => [
	`color.action.${name}.background`,
	`color.action.${name}.hover`,
	`color.action.${name}.pressed`,
];

const STATES = ['success', 'warning', 'danger'] as const;
const FIELD_BACKGROUNDS = ['color.field.background', 'color.field.background.readonly'];
const HIGH_CONTRAST = ['high-contrast'] as const;

/** The surfaces a field sits on: its pairs are measured over each. */
export const FIELD_SURFACES: readonly string[] = [
	'color.surface.page',
	'color.surface.card',
	'color.surface.subtle',
	'color.surface.floating',
];
const overSurfaces = (pairs: ContrastPair[]): ContrastPair[] =>
	pairs.map((pair) => ({ ...pair, backdrops: FIELD_SURFACES }));

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
	// An app's entry and a selected row: the ring inside a selected or a hovered item (phase 1, step 4).
	...on(
		['color.focus.ring'],
		[
			'color.control.selected.background',
			'color.action.secondary.hover',
			'color.action.secondary.pressed',
		],
		'non-text'
	),
	// Text on surfaces.
	...on(['color.text.primary', 'color.text.secondary', 'color.text.muted'], SURFACES, 'text'),
	// Action text on action backgrounds, in every state.
	...['primary', 'secondary', 'danger'].flatMap((name) =>
		on([`color.action.${name}.text`], action(name), 'text')
	),
	// State text on its own background and on the surfaces that hold messages.
	...STATES.flatMap((state) =>
		on([`color.state.${state}.text`], [`color.state.${state}.background`, PAGE, CARD], 'text')
	),
	...on(['color.control.selected.foreground'], ['color.control.selected.background'], 'text'),
	// The editor area's selected tab: its block-end bar on the page, beside a tab strip on the subtle
	// surface (documents specification, 5.8; step 10).
	...on(['color.control.selected.foreground'], [PAGE, SUBTLE], 'non-text'),
	// The chrome's quiet buttons: text on their hover and pressed colors (design.md, states), and
	// the palette's failure message on the floating surface (step 7).
	...on(
		['color.text.primary', 'color.text.secondary'],
		['color.action.secondary.hover', 'color.action.secondary.pressed'],
		'text'
	),
	...on(['color.state.danger.text'], [FLOATING], 'text'),
	// The danger foreground is error text in many components (a time picker's or a tree's error, a
	// field's message), so it is held as text wherever a field sits.
	...on(['color.state.danger.foreground'], FIELD_SURFACES, 'text'),
	// A message's icon, on its own background and on the page (D154).
	...(['success', 'danger'] as const).flatMap((state) =>
		on([`color.state.${state}.foreground`], [`color.state.${state}.background`, PAGE], 'non-text')
	),
	...overSurfaces(
		on(['color.field.text', 'color.field.placeholder'], ['color.field.background'], 'text')
	),
	// On the read-only fill over the subtle surface the placeholder is 4.38 in light, so a read-only
	// field sets its placeholder in `color.text.secondary` (violet-text-field, violet-text-area; D154).
	...overSurfaces(
		on(['color.field.text', 'color.text.secondary'], ['color.field.background.readonly'], 'text')
	),
	// Boundaries a control needs to be seen.
	...on(['color.border.strong'], OPEN_SURFACES, 'non-text'),
	...overSurfaces(
		on(
			['color.field.border', 'color.field.border.hover', 'color.field.border.invalid'],
			['color.field.background'],
			'non-text'
		)
	),
	// A read-only field's fill is a wash of the text color, too light behind the resting border, so
	// its top line is `color.border.strong` (violet-text-field, violet-text-area; D154).
	...overSurfaces(
		on(
			['color.border.strong', 'color.field.border.hover', 'color.field.border.invalid'],
			['color.field.background.readonly'],
			'non-text'
		)
	),
	...on(
		['shell.color.handle.hover', 'shell.color.handle.active'],
		[PAGE, CARD, SUBTLE],
		'non-text'
	),
	// The focus ring on every surface.
	...on(['color.focus.ring'], SURFACES, 'non-text'),
	...overSurfaces(on(['color.field.border.focus'], FIELD_BACKGROUNDS, 'non-text')),
	// High contrast: every border, and the fills of buttons, which elsewhere their labels identify.
	...on(
		['color.action.primary.background', 'color.action.danger.background'],
		[PAGE],
		'non-text',
		HIGH_CONTRAST
	),
	...on(['color.border.subtle', 'shell.color.handle.rest'], SURFACES, 'non-text', HIGH_CONTRAST),
	...on(
		['color.action.secondary.border'],
		[PAGE, 'color.action.secondary.background'],
		'non-text',
		HIGH_CONTRAST
	),
	...on(
		['color.control.selected.border'],
		['color.control.selected.background'],
		'non-text',
		HIGH_CONTRAST
	),
	...STATES.flatMap((state) =>
		on(
			[`color.state.${state}.border`],
			[`color.state.${state}.background`, PAGE],
			'non-text',
			HIGH_CONTRAST
		)
	),
];
