/**
 * Specimen roles (#37, #118, #498): how a role's value becomes CSS. Every
 * declaration comes from an allow-list validator, so a value that does not
 * parse draws nothing.
 *
 * Which components are drawn, which roles each takes and the token each role
 * draws from by default belong to the components' token interface, so they
 * live in `@lushly-dev/violet-afd` (`SPECIMEN_INTERFACE_MAP`, #1786), which maps
 * each role to an id in `@lushly-dev/violet-elements`' `tokens/interface.json`.
 * The component model below is the one this package invented before that,
 * with `<component>.<role>` token ids no interface uses; it is deprecated and
 * kept for one preview release.
 */
import {
	safeCssColor,
	safeCssLength,
	safeCssNumber,
	safeFontFamily,
	safeShadow,
	safeTextDecoration,
} from './safe-css.js';

/** `property:value;` when the value is safe */
function declaration(property: string, value: string | null): string | null {
	return value === null ? null : `${property}:${value};`;
}

/** A safe length that is not negative, for sizes and widths */
function nonNegativeLength(value: unknown): string | null {
	const length = safeCssLength(value);
	return length === null || length.startsWith('-') ? null : length;
}

/** A line height: a unitless multiplier up to 10, or a non-negative length */
function lineHeight(value: unknown): string | null {
	return safeCssNumber(value, { min: 0, max: 10 }) ?? nonNegativeLength(value);
}

/**
 * The custom property that carries a checkbox's check mark colour. The mark is
 * drawn inside the box, so no standard property on the box sets its colour.
 */
export const SPECIMEN_CHECK_PROPERTY = '--violet-specimen-check';

/**
 * Each role, in drawing order, with the declaration its validated value makes.
 * A declaration can contain double quotes (a quoted `font.family` name), so a
 * renderer that writes it into an HTML attribute must escape it.
 */
export const SPECIMEN_ROLES: Record<string, (value: unknown) => string | null> = {
	background: (v) => declaration('background', safeCssColor(v)),
	foreground: (v) => declaration('color', safeCssColor(v)),
	border: (v) => {
		const color = safeCssColor(v);
		return color ? `border:1px solid ${color};` : null;
	},
	radius: (v) => declaration('border-radius', safeCssLength(v)),
	'padding.x': (v) => declaration('padding-inline', safeCssLength(v)),
	'padding.y': (v) => declaration('padding-block', safeCssLength(v)),
	'min.height': (v) => declaration('min-block-size', safeCssLength(v)),
	'font.size': (v) => declaration('font-size', safeCssLength(v)),
	'font.weight': (v) => declaration('font-weight', safeCssNumber(v, { min: 1, max: 1000 })),
	shadow: (v) => declaration('box-shadow', safeShadow(v)),
	'font.family': (v) => declaration('font-family', safeFontFamily(v)),
	'line.height': (v) => declaration('line-height', lineHeight(v)),
	underline: (v) => declaration('text-decoration', safeTextDecoration(v)),
	'underline.offset': (v) => declaration('text-underline-offset', safeCssLength(v)),
	size: (v) => {
		const length = nonNegativeLength(v);
		return length === null ? null : `inline-size:${length};block-size:${length};`;
	},
	check: (v) => declaration(SPECIMEN_CHECK_PROPERTY, safeCssColor(v)),
	ring: (v) => {
		const color = safeCssColor(v);
		return color ? `outline:2px solid ${color};` : null;
	},
	'ring.width': (v) => declaration('outline-width', nonNegativeLength(v)),
	'ring.offset': (v) => declaration('outline-offset', safeCssLength(v)),
};

/** Every role, in drawing order; each component specimen takes a subset */
export const SPECIMEN_ROLE_NAMES = Object.keys(SPECIMEN_ROLES);

/** The roles of the button, input and card specimens */
const BOX_ROLES = [
	'background',
	'foreground',
	'border',
	'radius',
	'padding.x',
	'padding.y',
	'min.height',
	'font.size',
	'font.weight',
	'shadow',
];

/**
 * A component specimen: the sample's text, its roles and the role it cannot be drawn without.
 * @deprecated Use `InterfaceSpecimen` from `@lushly-dev/violet-afd`, whose roles name the
 * interface token each one draws from (#1786).
 */
export interface SpecimenComponent {
	label: string;
	/** The roles this component takes, in drawing order; each is a key of `SPECIMEN_ROLES` */
	roles: string[];
	/** The role whose value must be valid for the specimen to be drawn */
	required: string;
}

/**
 * The components drawn before #1786.
 * @deprecated Use `SPECIMEN_INTERFACE_MAP` from `@lushly-dev/violet-afd`, which takes the
 * same components and roles from the components' token interface; this copy is no longer
 * read by `specimen.get` or `specimen.set`.
 */
export const SPECIMEN_COMPONENTS: Record<string, SpecimenComponent> = {
	button: { label: 'Button', roles: BOX_ROLES, required: 'background' },
	input: { label: 'Input text', roles: BOX_ROLES, required: 'background' },
	card: { label: 'Card', roles: BOX_ROLES, required: 'background' },
	text: {
		label: 'Text block',
		roles: [
			'background',
			'foreground',
			'padding.x',
			'padding.y',
			'font.size',
			'font.weight',
			'font.family',
			'line.height',
		],
		required: 'foreground',
	},
	link: {
		label: 'Link',
		roles: ['foreground', 'font.size', 'font.weight', 'underline', 'underline.offset'],
		required: 'foreground',
	},
	checkbox: {
		label: 'Checkbox',
		roles: ['background', 'border', 'radius', 'size', 'check'],
		required: 'background',
	},
	focus: {
		label: 'Focus ring',
		roles: ['background', 'radius', 'ring', 'ring.width', 'ring.offset'],
		required: 'ring',
	},
};

/**
 * The role the button, input and card need for their specimens to be drawn.
 * @deprecated Other components need other roles; read
 * `SPECIMEN_INTERFACE_MAP[component].required` from `@lushly-dev/violet-afd` (#1786).
 */
export const SPECIMEN_REQUIRED_ROLE = 'background';

/**
 * The token the old naming convention gave a role: `<component>.<role>`.
 * @deprecated No interface id has this shape, so `specimen.get` no longer falls back to it;
 * read the interface id with `specimenInterfaceToken` from `@lushly-dev/violet-afd` (#1786).
 */
export function conventionToken(component: string, role: string): string {
	return `${component}.${role}`;
}

/**
 * Whether a component specimen takes a role.
 * @deprecated Use `specimenTakesRole` from `@lushly-dev/violet-afd` (#1786).
 */
export function specimenComponentHasRole(component: string, role: string): boolean {
	return (
		Object.hasOwn(SPECIMEN_COMPONENTS, component) &&
		SPECIMEN_COMPONENTS[component].roles.includes(role)
	);
}

/** A role's validated declaration, or null when the role is unknown or the value fails */
export function specimenRoleDeclaration(role: string, value: unknown): string | null {
	return Object.hasOwn(SPECIMEN_ROLES, role) ? SPECIMEN_ROLES[role](value) : null;
}
