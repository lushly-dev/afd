import { describe, expect, it } from 'vitest';
import * as credentialsEntry from './credentials.js';
import * as define from './define.js';
import * as direct from './direct.js';
import * as root from './index.js';
import {
	brandVerifiedCredentials,
	isVerifiedCredentials,
	unbrandVerifiedCredentials,
} from './verified-credentials.js';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const fields = () => ({
	issuer: 'https://issuer.example',
	subject: 'u1',
	clientId: 'c1',
	scopes: ['read', 'write'],
	cnf: { 'x5t#S256': 'thumbprint' },
	expiresAt: NOW / 1000 + 600,
	issuedAt: NOW / 1000,
});

describe('verified credentials brand', () => {
	it('recognises the branded object itself, and nothing built like it', () => {
		const branded = brandVerifiedCredentials(fields());
		expect(isVerifiedCredentials(branded, NOW)).toBe(true);
		expect(isVerifiedCredentials(fields(), NOW)).toBe(false);
		expect(isVerifiedCredentials({ ...branded }, NOW)).toBe(false);
		expect(isVerifiedCredentials(structuredClone(branded), NOW)).toBe(false);
		expect(isVerifiedCredentials(Object.create(branded), NOW)).toBe(false);
		expect(isVerifiedCredentials(new Proxy(branded, {}), NOW)).toBe(false);
		expect(isVerifiedCredentials(JSON.parse(JSON.stringify(branded)), NOW)).toBe(false);
	});

	it('answers false for anything that is not an object', () => {
		for (const value of [undefined, null, 0, '', 'credentials', true, Symbol('x')]) {
			expect(isVerifiedCredentials(value)).toBe(false);
		}
	});

	it('returns the same object, frozen with its scopes and cnf', () => {
		const credentials = fields();
		const branded = brandVerifiedCredentials(credentials);
		expect(branded).toBe(credentials);
		expect(Object.isFrozen(branded)).toBe(true);
		expect(Object.isFrozen(branded.scopes)).toBe(true);
		expect(Object.isFrozen(branded.cnf)).toBe(true);
	});

	it('cannot be changed once branded', () => {
		const branded = brandVerifiedCredentials(fields()) as ReturnType<typeof fields>;
		// ES modules are strict, so writing to a frozen object throws.
		expect(() => {
			branded.subject = 'someone-else';
		}).toThrow(TypeError);
		expect(() => {
			branded.expiresAt = Number.MAX_SAFE_INTEGER;
		}).toThrow(TypeError);
		expect(() => branded.scopes.push('admin')).toThrow(TypeError);
		expect(() => {
			branded.cnf['x5t#S256'] = 'other';
		}).toThrow(TypeError);
		expect(branded.subject).toBe('u1');
		expect(branded.scopes).toEqual(['read', 'write']);
		expect(isVerifiedCredentials(branded, NOW)).toBe(true);
	});

	it('is not verified once expiresAt has passed, or without a numeric expiresAt', () => {
		const branded = brandVerifiedCredentials(fields());
		const expiry = (NOW / 1000 + 600) * 1000;
		expect(isVerifiedCredentials(branded, expiry - 1)).toBe(true);
		expect(isVerifiedCredentials(branded, expiry)).toBe(false);
		expect(isVerifiedCredentials(branded, expiry + 1)).toBe(false);
		// The default reads the system clock: a token that expired in 2001 is not verified.
		expect(isVerifiedCredentials(brandVerifiedCredentials({ ...fields(), expiresAt: 1e9 }))).toBe(
			false
		);
		for (const expiresAt of [undefined, '2000000000', Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(isVerifiedCredentials(brandVerifiedCredentials({ ...fields(), expiresAt }), NOW)).toBe(
				false
			);
		}
	});

	it('is not verified once unbranded', () => {
		const branded = brandVerifiedCredentials(fields());
		unbrandVerifiedCredentials(branded);
		expect(isVerifiedCredentials(branded, NOW)).toBe(false);
		unbrandVerifiedCredentials(branded);
		expect(isVerifiedCredentials(branded, NOW)).toBe(false);
	});

	it('exports the predicate from the root and /credentials, and neither brand function', () => {
		expect(credentialsEntry.isVerifiedCredentials).toBe(isVerifiedCredentials);
		expect(root.isVerifiedCredentials).toBe(isVerifiedCredentials);
		expect(Object.keys(credentialsEntry)).toEqual(['isVerifiedCredentials']);
		for (const entry of [root, define, direct, credentialsEntry]) {
			expect('brandVerifiedCredentials' in entry).toBe(false);
			expect('unbrandVerifiedCredentials' in entry).toBe(false);
		}
	});
});
