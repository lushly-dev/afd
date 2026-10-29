/**
 * Component specimens (#37, #118): the components the Specimens view draws,
 * the roles each one takes from a token, and how a role's value becomes CSS.
 * Every declaration comes from an allow-list validator, so a value that does
 * not parse draws nothing. `specimen.set` checks maps against these lists, and
 * `specimen.get` reports which roles pass.
 */
import { safeCssColor, safeCssLength, safeCssNumber, safeShadow } from './safe-css.js';

/** `property:value;` when the value is safe */
function declaration(property: string, value: string | null): string | null {
	return value === null ? null : `${property}:${value};`;
}

/** Each role, in drawing order, with the declaration its validated value makes */
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
};

/** Roles in drawing order */
export const SPECIMEN_ROLE_NAMES = Object.keys(SPECIMEN_ROLES);

/** The components drawn, with the sample's text */
export const SPECIMEN_COMPONENTS: Record<string, { label: string }> = {
	button: { label: 'Button' },
	input: { label: 'Input text' },
	card: { label: 'Card' },
};

/** The role a component must have for its specimen to be drawn */
export const SPECIMEN_REQUIRED_ROLE = 'background';

/** The token the naming convention gives a role: `<component>.<role>` */
export function conventionToken(component: string, role: string): string {
	return `${component}.${role}`;
}

/** A role's validated declaration, or null when the role is unknown or the value fails */
export function specimenRoleDeclaration(role: string, value: unknown): string | null {
	return Object.prototype.hasOwnProperty.call(SPECIMEN_ROLES, role)
		? SPECIMEN_ROLES[role](value)
		: null;
}
