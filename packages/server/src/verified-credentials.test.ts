import { describe, expect, it } from 'vitest';
import * as credentialsEntry from './credentials.js';
import * as root from './index.js';
import { brandVerifiedCredentials, isVerifiedCredentials } from './verified-credentials.js';

const fields = () => ({ issuer: 'https://issuer.example', subject: 'u1', clientId: 'c1' });

describe('verified credentials brand', () => {
	it('recognises the branded object itself, and nothing built like it', () => {
		const branded = brandVerifiedCredentials(fields());
		expect(isVerifiedCredentials(branded)).toBe(true);
		expect(isVerifiedCredentials(fields())).toBe(false);
		expect(isVerifiedCredentials({ ...branded })).toBe(false);
		expect(isVerifiedCredentials(structuredClone(branded))).toBe(false);
		expect(isVerifiedCredentials(Object.create(branded))).toBe(false);
		expect(isVerifiedCredentials(new Proxy(branded, {}))).toBe(false);
		expect(isVerifiedCredentials(JSON.parse(JSON.stringify(branded)))).toBe(false);
	});

	it('answers false for anything that is not an object', () => {
		for (const value of [undefined, null, 0, '', 'credentials', true, Symbol('x')]) {
			expect(isVerifiedCredentials(value)).toBe(false);
		}
	});

	it('returns the same object it brands', () => {
		const credentials = fields();
		expect(brandVerifiedCredentials(credentials)).toBe(credentials);
	});

	it('exports the predicate from the root and /credentials, and the brand from neither', () => {
		expect(credentialsEntry.isVerifiedCredentials).toBe(isVerifiedCredentials);
		expect(root.isVerifiedCredentials).toBe(isVerifiedCredentials);
		expect(Object.keys(credentialsEntry)).toEqual(['isVerifiedCredentials']);
		expect('brandVerifiedCredentials' in root).toBe(false);
	});
});
