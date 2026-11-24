import { readFileSync } from 'node:fs';
import { SPECIMEN_ROLES } from '@lushly-dev/violet-core/css';
import { describe, expect, it } from 'vitest';
import {
	SPECIMEN_INTERFACE,
	SPECIMEN_INTERFACE_MAP,
	specimenInterfaceToken,
	specimenRolesOf,
	specimenTakesRole,
} from './model.js';

interface InterfaceFile {
	contractVersion: number;
	package: string;
	tokens: Record<string, { property: string; type: string }>;
}

/**
 * The components' interface, read by path like `analyze/interface.test.ts` does, so the
 * command layer takes no dependency on a UI package; `scripts/affected/scope.mjs` runs this
 * package's tests when the file changes
 */
const contract: InterfaceFile = JSON.parse(
	readFileSync(
		new URL(
			'../../../../../foundations/fast-af/packages/violet-elements/tokens/interface.json',
			import.meta.url,
		),
		'utf8',
	),
);

/** The interface types a role's validator draws */
const ROLE_TYPES: Record<string, string[]> = {
	background: ['color'],
	foreground: ['color'],
	border: ['color'],
	check: ['color'],
	ring: ['color'],
	radius: ['dimension'],
	'padding.x': ['dimension'],
	'padding.y': ['dimension'],
	'min.height': ['dimension'],
	'font.size': ['dimension'],
	size: ['dimension'],
	'ring.width': ['dimension'],
	'ring.offset': ['dimension'],
	'underline.offset': ['dimension'],
	'line.height': ['dimension', 'number'],
	'font.weight': ['fontWeight'],
	'font.family': ['fontFamily'],
	shadow: ['shadow'],
	underline: [],
};

const mapped = Object.entries(SPECIMEN_INTERFACE_MAP).flatMap(([component, specimen]) =>
	Object.entries(specimen.roles)
		.filter((entry): entry is [string, string] => entry[1] !== null)
		.map(([role, tokenId]) => ({ component, role, tokenId })),
);

describe('the specimen role map against the components interface (#1786)', () => {
	it('is checked against the interface contract version in use', () => {
		expect(contract.package).toBe(SPECIMEN_INTERFACE.package);
		expect(
			contract.contractVersion,
			`${SPECIMEN_INTERFACE.package} moved to contractVersion ${contract.contractVersion}: check every id in SPECIMEN_INTERFACE_MAP against the interface, then record the new version in SPECIMEN_INTERFACE`,
		).toBe(SPECIMEN_INTERFACE.contractVersion);
	});

	it('maps every role only to ids the interface lists', () => {
		const missing = mapped
			.filter(({ tokenId }) => !Object.hasOwn(contract.tokens, tokenId))
			.map(({ component, role, tokenId }) => `${component}.${role} → ${tokenId}`);
		expect(missing, 'mapped ids that left the interface').toEqual([]);
	});

	it('maps every role to an id of a type its validator draws', () => {
		const mistyped = mapped
			.filter(({ role, tokenId }) => {
				if (!Object.hasOwn(contract.tokens, tokenId)) return false; // the test above reports it
				const type = contract.tokens[tokenId].type;
				return typeof type !== 'string' || !ROLE_TYPES[role]?.includes(type);
			})
			.map(
				({ component, role, tokenId }) =>
					`${component}.${role} → ${tokenId} (${contract.tokens[tokenId].type})`,
			);
		expect(mistyped).toEqual([]);
	});

	it('takes only roles violet-core validates, and draws every specimen from the interface alone', () => {
		for (const [component, specimen] of Object.entries(SPECIMEN_INTERFACE_MAP)) {
			for (const role of Object.keys(specimen.roles)) {
				expect(SPECIMEN_ROLES, `${component}.${role}`).toHaveProperty([role]);
				expect(ROLE_TYPES, `${component}.${role}`).toHaveProperty([role]);
			}
			expect(
				specimen.roles[specimen.required],
				`${component}'s required role ${specimen.required}`,
			).toEqual(expect.any(String));
		}
		expect(Object.keys(ROLE_TYPES).sort()).toEqual(Object.keys(SPECIMEN_ROLES).sort());
	});

	it('keeps the components and roles stored maps are keyed on', () => {
		expect(Object.keys(SPECIMEN_INTERFACE_MAP)).toEqual([
			'button',
			'input',
			'card',
			'text',
			'link',
			'checkbox',
			'focus',
		]);
		expect(specimenRolesOf('link')).toEqual([
			'foreground',
			'font.size',
			'font.weight',
			'underline',
			'underline.offset',
		]);
		expect(specimenRolesOf('toggle')).toEqual([]);
	});

	it('answers role lookups without reading inherited keys', () => {
		expect(specimenTakesRole('focus', 'ring.offset')).toBe(true);
		expect(specimenTakesRole('button', 'ring')).toBe(false);
		expect(specimenTakesRole('constructor', 'background')).toBe(false);
		expect(specimenTakesRole('button', 'constructor')).toBe(false);
		expect(specimenInterfaceToken('button', 'background')).toBe('color.action.primary.background');
		expect(specimenInterfaceToken('focus', 'ring.offset')).toBeNull();
		expect(specimenInterfaceToken('toggle', 'background')).toBeNull();
	});
});
