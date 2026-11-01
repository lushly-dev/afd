/**
 * The color pairs the theme must keep legible (2.2), and their floors per theme. Text is 4.5:1
 * in light and dark and 7:1 in high contrast; non-text (boundaries a control needs to be seen,
 * and the focus ring) is 3:1 everywhere.
 *
 * Light and dark do not hold three groups to 3:1, so version 1 keeps today's values for them:
 * decorative borders (`color.border.subtle`, and the secondary-action, selected-control and state
 * borders beside text or a fill), button fills, which their labels identify, and the resting
 * field border (`color.field.border`, 1.2:1 today; a follow-up in the specification). High
 * contrast holds all three to 3:1.
 */
import type { ThemeName } from './tree/index.js';

export type PairKind = 'text' | 'non-text';

export interface ContrastPair {
	foreground: string;
	background: string;
	kind: PairKind;
	/** Only checked in these themes; every theme when absent. */
	themes?: readonly ThemeName[];
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

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
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
	...on(['color.field.text', 'color.field.placeholder'], FIELD_BACKGROUNDS, 'text'),
	// Boundaries a control needs to be seen.
	...on(['color.border.strong'], OPEN_SURFACES, 'non-text'),
	...on(['color.field.border.hover'], FIELD_BACKGROUNDS, 'non-text'),
	...on(
		['shell.color.handle.hover', 'shell.color.handle.active'],
		[PAGE, CARD, SUBTLE],
		'non-text'
	),
	// The focus ring on every surface.
	...on(['color.focus.ring'], SURFACES, 'non-text'),
	...on(['color.field.border.focus'], FIELD_BACKGROUNDS, 'non-text'),
	// High contrast: every border, and the fills of buttons, which elsewhere their labels identify.
	...on(
		['color.action.primary.background', 'color.action.danger.background'],
		[PAGE],
		'non-text',
		HIGH_CONTRAST
	),
	...on(['color.border.subtle', 'shell.color.handle.rest'], SURFACES, 'non-text', HIGH_CONTRAST),
	...on(
		['color.field.border', 'color.field.border.invalid'],
		FIELD_BACKGROUNDS,
		'non-text',
		HIGH_CONTRAST
	),
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
