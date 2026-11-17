import { describe, expect, it } from 'vitest';
import {
	SPECIMEN_CHECK_PROPERTY,
	SPECIMEN_COMPONENTS,
	SPECIMEN_ROLES,
	conventionToken,
	specimenComponentHasRole,
	specimenRoleDeclaration,
} from './specimens.js';

/** Values no role accepts: each would break out of the declaration or load something */
const HOSTILE = [
	'url(javascript:alert(1))',
	'red;background:url(x)',
	'16px;}body{display:none',
	'var(--x)',
	'calc(1px + 1px)',
	'16px !important',
	'</style><script>alert(1)</script>',
	'',
	null,
	undefined,
	{},
];

describe('specimen components (#498)', () => {
	it('lists the text block, link, checkbox and focus ring with known roles', () => {
		expect(Object.keys(SPECIMEN_COMPONENTS)).toEqual([
			'button',
			'input',
			'card',
			'text',
			'link',
			'checkbox',
			'focus',
		]);
		for (const [name, component] of Object.entries(SPECIMEN_COMPONENTS)) {
			for (const role of component.roles)
				expect(SPECIMEN_ROLES, `${name}.${role}`).toHaveProperty([role]);
			expect(component.roles, name).toContain(component.required);
		}
		expect(SPECIMEN_COMPONENTS.focus.required).toBe('ring');
		expect(SPECIMEN_COMPONENTS.link.required).toBe('foreground');
	});

	it('names convention tokens <component>.<role> for the new components', () => {
		expect(conventionToken('focus', 'ring.width')).toBe('focus.ring.width');
		expect(conventionToken('link', 'underline.offset')).toBe('link.underline.offset');
		expect(conventionToken('checkbox', 'check')).toBe('checkbox.check');
		expect(conventionToken('text', 'line.height')).toBe('text.line.height');
	});

	it('knows which roles each component takes', () => {
		expect(specimenComponentHasRole('focus', 'ring.offset')).toBe(true);
		expect(specimenComponentHasRole('link', 'underline')).toBe(true);
		expect(specimenComponentHasRole('button', 'shadow')).toBe(true);
		expect(specimenComponentHasRole('button', 'ring')).toBe(false);
		expect(specimenComponentHasRole('link', 'check')).toBe(false);
		expect(specimenComponentHasRole('toggle', 'background')).toBe(false);
		expect(specimenComponentHasRole('constructor', 'background')).toBe(false);
		expect(specimenComponentHasRole('button', 'constructor')).toBe(false);
	});
});

describe('specimen role declarations', () => {
	it('accepts valid values for the new roles', () => {
		expect(specimenRoleDeclaration('font.family', 'Segoe UI, sans-serif')).toBe(
			'font-family:Segoe UI, sans-serif;',
		);
		expect(specimenRoleDeclaration('line.height', '1.5')).toBe('line-height:1.5;');
		expect(specimenRoleDeclaration('line.height', 1.4)).toBe('line-height:1.4;');
		expect(specimenRoleDeclaration('line.height', '24px')).toBe('line-height:24px;');
		expect(specimenRoleDeclaration('underline', 'underline dotted')).toBe(
			'text-decoration:underline dotted;',
		);
		expect(specimenRoleDeclaration('underline', 'none')).toBe('text-decoration:none;');
		expect(specimenRoleDeclaration('underline.offset', '0.15em')).toBe(
			'text-underline-offset:0.15em;',
		);
		expect(specimenRoleDeclaration('size', '16px')).toBe('inline-size:16px;block-size:16px;');
		expect(specimenRoleDeclaration('check', '#FFFFFF')).toBe(`${SPECIMEN_CHECK_PROPERTY}:#FFFFFF;`);
		expect(specimenRoleDeclaration('ring', '#0F6CBD')).toBe('outline:2px solid #0F6CBD;');
		expect(specimenRoleDeclaration('ring.width', '3px')).toBe('outline-width:3px;');
		expect(specimenRoleDeclaration('ring.width', 0)).toBe('outline-width:0;');
		expect(specimenRoleDeclaration('ring.offset', '2px')).toBe('outline-offset:2px;');
		expect(specimenRoleDeclaration('ring.offset', '-1px')).toBe('outline-offset:-1px;');
	});

	it('rejects values of the wrong kind for the new roles', () => {
		expect(specimenRoleDeclaration('font.family', 'inherit')).toBeNull();
		expect(specimenRoleDeclaration('line.height', '11')).toBeNull();
		expect(specimenRoleDeclaration('line.height', '-1')).toBeNull();
		expect(specimenRoleDeclaration('line.height', '-4px')).toBeNull();
		expect(specimenRoleDeclaration('line.height', 'normal')).toBeNull();
		expect(specimenRoleDeclaration('underline', '#0F6CBD')).toBeNull();
		expect(specimenRoleDeclaration('underline', 'underline blink')).toBeNull();
		expect(specimenRoleDeclaration('underline.offset', 'auto')).toBeNull();
		expect(specimenRoleDeclaration('size', '-16px')).toBeNull();
		expect(specimenRoleDeclaration('size', '16')).toBeNull();
		expect(specimenRoleDeclaration('check', '16px')).toBeNull();
		expect(specimenRoleDeclaration('ring', '2px solid #000')).toBeNull();
		expect(specimenRoleDeclaration('ring.width', '-2px')).toBeNull();
		expect(specimenRoleDeclaration('ring.width', 'thick')).toBeNull();
		expect(specimenRoleDeclaration('ring.offset', '#000')).toBeNull();
	});

	it('draws nothing from a hostile value in any role', () => {
		for (const role of Object.keys(SPECIMEN_ROLES)) {
			for (const value of HOSTILE) {
				expect(specimenRoleDeclaration(role, value), `${role}: ${String(value)}`).toBeNull();
			}
		}
	});

	it('draws nothing for an unknown role', () => {
		expect(specimenRoleDeclaration('glow', '#000')).toBeNull();
		expect(specimenRoleDeclaration('constructor', '#000')).toBeNull();
	});
});
