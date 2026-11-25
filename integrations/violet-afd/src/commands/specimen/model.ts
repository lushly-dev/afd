/**
 * The component specimens the Specimens view draws, taken from the components'
 * token interface (#1786): `@lushly-dev/violet-elements`'s `tokens/interface.json`
 * lists every token id its components read, and each role here names the id
 * the matching component draws that role from. A tree that defines those ids
 * draws its specimens with no stored map; `specimen.set` stores a map for
 * trees named otherwise.
 *
 * The ids are kept here as data, so the command layer does not load a UI
 * package at run time. `model.test.ts` reads the interface file and fails when a
 * mapped id leaves it, changes to a type the role cannot draw, or when the
 * interface's contract version moves past the one recorded below.
 *
 * Each role's CSS validator stays in `@lushly-dev/violet-core/css`
 * (`specimenRoleDeclaration`).
 */

/** The interface the role map is taken from */
export const SPECIMEN_INTERFACE = {
	package: '@lushly-dev/violet-elements',
	path: 'tokens/interface.json',
	/** The interface's `contractVersion` the map was last checked against */
	contractVersion: 5,
} as const;

/** A component specimen and the interface token each of its roles draws from */
export interface InterfaceSpecimen {
	label: string;
	/** The violet-elements component the specimen samples; null when none draws it on its own */
	element: string | null;
	/**
	 * The roles this specimen takes, in drawing order, each with the interface token id
	 * the component reads for it. Null when no interface id carries the role (the
	 * component computes it, or the interface has no such token): the role is drawn only
	 * through a stored map. Every role is a key of violet-core's `SPECIMEN_ROLES`.
	 */
	roles: Record<string, string | null>;
	/** The role whose value must be valid for the specimen to be drawn */
	required: string;
}

/**
 * The components drawn. Each samples the component's default resting state: the
 * primary button, an empty text field, a card with medium padding, body text, a
 * link inline in body text (coloured like the source citation's link, the only
 * component that draws one), a checked checkbox and the focus ring the controls
 * share.
 */
export const SPECIMEN_INTERFACE_MAP: Record<string, InterfaceSpecimen> = {
	button: {
		label: 'Button',
		element: 'violet-button',
		roles: {
			background: 'color.action.primary.background',
			foreground: 'color.action.primary.text',
			border: null,
			radius: 'radius.control',
			'padding.x': 'space.inline.group',
			'padding.y': null,
			'min.height': 'size.target.natural',
			'font.size': 'type.body.size',
			'font.weight': null,
			shadow: 'shadow.control',
		},
		required: 'background',
	},
	input: {
		label: 'Input text',
		element: 'violet-text-field',
		roles: {
			background: 'color.field.background',
			foreground: 'color.field.text',
			border: 'color.border.subtle',
			radius: 'radius.control',
			'padding.x': 'space.inline.group',
			'padding.y': null,
			'min.height': 'size.target.natural',
			'font.size': 'type.body.size',
			'font.weight': null,
			shadow: 'shadow.well',
		},
		required: 'background',
	},
	card: {
		label: 'Card',
		element: 'violet-card',
		roles: {
			background: 'color.surface.card',
			foreground: 'color.text.primary',
			border: null,
			radius: 'radius.floating',
			'padding.x': 'space.layout.panel',
			'padding.y': 'space.layout.panel',
			'min.height': null,
			'font.size': null,
			'font.weight': null,
			shadow: 'shadow.card',
		},
		required: 'background',
	},
	text: {
		label: 'Text block',
		element: 'violet-text',
		roles: {
			background: null,
			foreground: 'color.text.primary',
			'padding.x': null,
			'padding.y': null,
			'font.size': 'type.body.size',
			'font.weight': 'type.body.weight',
			'font.family': 'font.family.body',
			'line.height': 'type.body.line',
		},
		required: 'foreground',
	},
	link: {
		label: 'Link',
		element: null,
		roles: {
			foreground: 'color.accent.text',
			'font.size': 'type.body.size',
			'font.weight': 'type.body.weight',
			underline: null,
			'underline.offset': null,
		},
		required: 'foreground',
	},
	checkbox: {
		label: 'Checkbox',
		element: 'violet-checkbox',
		roles: {
			background: 'color.control.selected.background',
			border: 'color.control.selected.border',
			radius: 'radius.inset',
			size: null,
			check: 'color.control.selected.foreground',
		},
		required: 'background',
	},
	focus: {
		label: 'Focus ring',
		element: null,
		roles: {
			background: null,
			radius: 'radius.control',
			ring: 'color.focus.ring',
			'ring.width': 'size.focus-ring.width',
			'ring.offset': null,
		},
		required: 'ring',
	},
};

/** Every component name, for error suggestions */
export const SPECIMEN_INTERFACE_COMPONENTS = Object.keys(SPECIMEN_INTERFACE_MAP);

/** The roles a component specimen takes, in drawing order; empty for an unknown component */
export function specimenRolesOf(component: string): string[] {
	return Object.hasOwn(SPECIMEN_INTERFACE_MAP, component)
		? Object.keys(SPECIMEN_INTERFACE_MAP[component].roles)
		: [];
}

/** Whether a component specimen takes a role */
export function specimenTakesRole(component: string, role: string): boolean {
	return (
		Object.hasOwn(SPECIMEN_INTERFACE_MAP, component) &&
		Object.hasOwn(SPECIMEN_INTERFACE_MAP[component].roles, role)
	);
}

/** The interface token id a component reads for a role, or null when none carries it */
export function specimenInterfaceToken(component: string, role: string): string | null {
	return specimenTakesRole(component, role) ? SPECIMEN_INTERFACE_MAP[component].roles[role] : null;
}
