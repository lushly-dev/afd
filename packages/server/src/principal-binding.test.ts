/**
 * The principal binding (`spec/authorization.md`, M8) against the `principalBindings` cases of
 * `spec/authorization.json`.
 */
import { readFileSync } from 'node:fs';
import type { Actor } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import {
	credentialsBinding,
	type PrincipalCredentials,
	principalBinding,
} from './principal-binding.js';

interface Case {
	description: string;
	actor: Actor | null;
	credentials: (PrincipalCredentials & Record<string, unknown>) | null;
	binding: string;
	credentialsBinding: string;
}

const cases = (
	JSON.parse(
		readFileSync(new URL('../../../spec/authorization.json', import.meta.url), 'utf8')
	) as { principalBindings: Case[] }
).principalBindings;

describe('principal binding', () => {
	it('loads the cases', () => {
		expect(cases.length).toBeGreaterThanOrEqual(7);
	});

	for (const testCase of cases) {
		it(testCase.description, () => {
			expect(principalBinding(testCase.actor, testCase.credentials)).toBe(testCase.binding);
			expect(credentialsBinding(testCase.credentials)).toBe(testCase.credentialsBinding);
		});
	}

	it('treats a missing actor or credentials as null', () => {
		expect(principalBinding(undefined, undefined)).toBe('{"actor":null,"credentials":null}');
		expect(credentialsBinding(undefined)).toBe('null');
	});

	it('refuses credentials it could not bind, rather than bind less', () => {
		const actor: Actor = { kind: 'agent', id: 'a' };
		for (const credentials of [
			{ issuer: 'https://auth.example.com', subject: 'user-1' },
			{ issuer: 'https://auth.example.com', subject: '', clientId: 'c' },
			{ issuer: 'https://auth.example.com', subject: 1, clientId: 'c' },
			'user-1',
		]) {
			expect(() => principalBinding(actor, credentials as unknown as PrincipalCredentials)).toThrow(
				TypeError
			);
			expect(() => credentialsBinding(credentials as unknown as PrincipalCredentials)).toThrow(
				TypeError
			);
		}
		expect(() => principalBinding('agent' as unknown as Actor)).toThrow(TypeError);
	});
});
