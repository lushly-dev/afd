/**
 * @fileoverview The shared MCP authorization cases (`spec/authorization.json`) that verification
 * covers (`spec/authorization.md`, M2, M3, M3.1, M3.2, M4, M5 and M7): `bearer`, `challenges`,
 * `metadataUrls`, `metadataDocuments`, `audience`, `scopeClaims`, `jwtHeaders`, `keys` and
 * `claims`. `principal-binding.test.ts` loads `principalBindings`; scopes (M6) load
 * `staticScopes` and `batches`.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractBearer } from './mcp-auth-bearer.js';
import { audienceAccepts, createProtectedResource } from './mcp-auth-resource.js';
import {
	checkClaims,
	checkJwsHeader,
	checkKeyFit,
	createTokenRules,
	parseScopeClaim,
	type TokenRulesOptions,
} from './mcp-auth-rules.js';

type Expected<T> = T | { refused: string };

interface Cases {
	resource: string;
	now: number;
	config: Record<string, unknown>;
	bearer: {
		description: string;
		authorization: string[];
		query?: string;
		formBody?: string;
		expected: Expected<{ token: string }>;
	}[];
	challenges: {
		description: string;
		resource: string;
		resourceMetadata: string;
		status: 401 | 403;
		tokenSent?: boolean;
		scopesSupported?: string[];
		missing?: string[];
		header: string;
		body: unknown;
	}[];
	metadataUrls: { resource: string; urls: string[] }[];
	metadataDocuments: {
		description: string;
		options: {
			resource: string;
			authorizationServers: string[];
			scopesSupported: string[];
			resourceName?: string;
			requireBoundTokens: boolean;
		};
		expected: unknown;
	}[];
	audience: { description: string; resource: string; aud?: unknown; accepted: boolean }[];
	scopeClaims: {
		description: string;
		scope?: unknown;
		limit: number;
		prefix: string | null;
		scopes?: string[];
		refused?: string;
	}[];
	jwtHeaders: {
		description: string;
		header: unknown;
		algorithms: string[];
		expected: Expected<'accepted'>;
	}[];
	keys: { description: string; header: unknown; key: unknown; expected: Expected<'accepted'> }[];
	claims: {
		description: string;
		claims: Record<string, unknown>;
		certificate: string | null;
		config?: Record<string, unknown>;
		expected: Expected<{ credentials: unknown }>;
	}[];
}

const cases = JSON.parse(
	readFileSync(new URL('../../../spec/authorization.json', import.meta.url), 'utf8')
) as Cases;

/** A rule outcome in the cases' shape: the value, or `{ refused }`. */
function outcome<T>(result: { ok: true; value: T } | { ok: false; rule: string }) {
	return result.ok ? result.value : { refused: result.rule };
}

describe('P3-E9: spec/authorization.json: bearer (M2)', () => {
	it.each(cases.bearer)('$description', ({ authorization, query, formBody, expected }) => {
		expect(extractBearer(authorization, query, formBody)).toEqual(expected);
	});
});

describe('P3-E9: spec/authorization.json: challenges (M5)', () => {
	it.each(cases.challenges)('$description', (entry) => {
		const metadata = createProtectedResource({
			resource: entry.resource,
			authorizationServers: ['https://auth.example.com'],
			scopesSupported: entry.scopesSupported ?? [],
		});
		expect(metadata.metadataUrls[0]).toBe(entry.resourceMetadata);
		if (entry.status === 401) {
			expect(metadata.unauthorizedChallenge(entry.tokenSent === true)).toBe(entry.header);
			expect(metadata.unauthorizedBody()).toEqual(entry.body);
		} else {
			expect(metadata.forbiddenChallenge(entry.missing ?? [])).toBe(entry.header);
			expect(metadata.forbiddenBody(entry.missing ?? [])).toEqual(entry.body);
		}
	});
});

describe('P3-E9: spec/authorization.json: metadataUrls (M7)', () => {
	it.each(cases.metadataUrls)('$resource', ({ resource, urls }) => {
		const metadata = createProtectedResource({
			resource,
			authorizationServers: ['https://auth.example.com'],
		});
		expect(metadata.metadataUrls).toEqual(urls);
		// The paths the handler serves are the URLs' paths.
		expect(metadata.metadataPaths).toEqual(urls.map((url) => new URL(url).pathname));
	});
});

describe('P3-E9: spec/authorization.json: metadataDocuments (M7)', () => {
	it.each(cases.metadataDocuments)('$description', ({ options, expected }) => {
		expect(createProtectedResource(options).document()).toEqual(expected);
	});
});

describe('P3-E9: spec/authorization.json: audience (M3.1)', () => {
	it.each(cases.audience)('$description', ({ resource, aud, accepted }) => {
		expect(audienceAccepts(aud, resource)).toBe(accepted);
	});
});

describe('P3-E9: spec/authorization.json: scopeClaims (M3.2)', () => {
	it.each(cases.scopeClaims)('$description', (entry) => {
		const parsed = parseScopeClaim(entry.scope, entry.prefix ?? undefined, entry.limit);
		expect(outcome(parsed)).toEqual(
			entry.refused === undefined ? entry.scopes : { refused: entry.refused }
		);
	});
});

describe('P3-E9: spec/authorization.json: jwtHeaders (M3 rule 2)', () => {
	it.each(cases.jwtHeaders)('$description', ({ header, algorithms, expected }) => {
		const result = checkJwsHeader(header, algorithms);
		expect(result.ok ? 'accepted' : { refused: result.rule }).toEqual(expected);
	});
});

describe('P3-E9: spec/authorization.json: keys (M3 rule 3)', () => {
	it.each(cases.keys)('$description', ({ header, key, expected }) => {
		const result = checkKeyFit(header, key ?? undefined);
		expect(result.ok ? 'accepted' : { refused: result.rule }).toEqual(expected);
	});
});

/** The top-level `config`, with a case's over it, as token rules. */
function rulesOf(config: Record<string, unknown>) {
	const { scopePrefix, ...rest } = config;
	return createTokenRules({
		...(rest as unknown as TokenRulesOptions),
		...(typeof scopePrefix === 'string' ? { scopePrefix } : {}),
	});
}

describe('P3-E9: spec/authorization.json: claims (M3 rules 5 to 10, M4)', () => {
	it.each(cases.claims)('$description', (entry) => {
		const config = { ...cases.config, ...entry.config };
		const result = checkClaims(
			entry.claims,
			config.issuer as string,
			rulesOf(config),
			cases.now,
			entry.certificate ?? undefined
		);
		if ('refused' in entry.expected) {
			expect(result).toEqual({ ok: false, rule: entry.expected.refused });
		} else {
			// Compared as JSON: the credentials' debug form is not part of them.
			expect(result.ok && JSON.parse(JSON.stringify(result.value))).toEqual(
				entry.expected.credentials
			);
		}
	});

	it('loads every case of the nine sections', () => {
		expect(cases.bearer.length).toBeGreaterThan(0);
		expect(
			[
				cases.bearer,
				cases.challenges,
				cases.metadataUrls,
				cases.metadataDocuments,
				cases.audience,
				cases.scopeClaims,
				cases.jwtHeaders,
				cases.keys,
				cases.claims,
			].map((section) => section.length)
		).toEqual([19, 5, 4, 3, 20, 22, 24, 17, 43]);
	});
});
