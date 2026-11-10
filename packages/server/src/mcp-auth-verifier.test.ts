/**
 * @fileoverview AFD's token verifiers (`spec/authorization.md`, M3): one test per rule, with keys
 * made in the test by the test authorization server, which also serves the JWKS and the
 * introspection endpoint the verifiers' host callbacks fetch over loopback HTTP.
 */

import { inspect } from 'node:util';
import { fixedClock } from '@lushly-dev/afd-core';
import { exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	FIXTURE_ALGORITHMS,
	startTestAuthorizationServer,
	type TestAuthorizationServer,
} from '../test-support/authorization-server.js';
import {
	createIntrospectionVerifier,
	isCompactJws,
	JwtVerifier,
	jwksKeySource,
	type KeySource,
	type TokenVerification,
	type TokenVerifier,
} from './mcp-auth-jwt.js';
import {
	createTokenRules,
	type SigningAlgorithm,
	type TokenRulesOptions,
} from './mcp-auth-rules.js';

let as: TestAuthorizationServer;
beforeAll(async () => {
	as = await startTestAuthorizationServer();
});
afterAll(() => as.close());

const RESOURCE = 'https://mcp.test.example/mcp';
const ALL: SigningAlgorithm[] = ['RS256', 'PS256', 'ES256', 'ES384', 'EdDSA'];

/** The fixture's JWKS, fetched over HTTP by the host's loader. */
const fetchJwks = () => fetch(as.jwksUrl).then((response) => response.json());

function verifier(
	options: {
		rules?: Partial<TokenRulesOptions>;
		algorithms?: SigningAlgorithm[];
		keys?: KeySource;
		introspection?: TokenVerifier;
		now?: number;
	} = {}
) {
	return new JwtVerifier({
		rules: { resource: RESOURCE, ...options.rules },
		issuers: [
			{
				issuer: as.issuer,
				alias: 'test-as',
				algorithms: options.algorithms ?? ALL,
				keys: options.keys ?? jwksKeySource(as.jwks()),
			},
		],
		...(options.introspection ? { introspection: options.introspection } : {}),
		...(options.now !== undefined ? { clock: fixedClock(options.now * 1000) } : {}),
	});
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** A hand-built JWS, for headers no signing library would write. Refused before rule 4. */
const raw = (header: unknown, payload: unknown = as.claims(), signature = 'c2ln') =>
	`${b64(header)}.${b64(payload)}.${signature}`;

function refusal(result: TokenVerification) {
	return result.ok ? 'accepted' : result.rule;
}

describe('P3-E9: M3 rule 1: route by shape', () => {
	it('verifies RS256, PS256, ES256, ES384 and EdDSA tokens through WebCrypto', async () => {
		const v = verifier({ keys: jwksKeySource(fetchJwks) });
		for (const alg of FIXTURE_ALGORITHMS) {
			const result = await v.verify(await as.issue({ alg }));
			expect(result, alg).toMatchObject({
				ok: true,
				credentials: { issuer: as.issuer, subject: 'user-1', clientId: 'agent-1' },
			});
		}
	});

	it('refuses a JWS whose iss names no configured issuer, with unknown-issuer', async () => {
		const token = await as.issue({ claims: { iss: 'https://elsewhere.example' } });
		expect(await verifier().verify(token)).toEqual({ ok: false, rule: 'unknown-issuer' });
	});

	it('refuses a payload with a repeated claim, never reading its last value', async () => {
		const header = { alg: 'RS256', typ: 'at+jwt', kid: as.keys.RS256.kid };
		const payload = Buffer.from(
			`{"iss":"https://elsewhere.example","iss":"${as.issuer}"}`
		).toString('base64url');
		expect(refusal(await verifier().verify(`${b64(header)}.${payload}.c2ln`))).toBe(
			'unknown-issuer'
		);
		expect(refusal(await verifier().verify(`${b64(header)}.${b64([as.claims()])}.c2ln`))).toBe(
			'unknown-issuer'
		);
	});

	it('sends an opaque token only to the introspection issuer, and refuses it without one', async () => {
		const opaque = as.issueOpaque();
		expect(isCompactJws(opaque)).toBe(false);
		expect(await verifier().verify(opaque)).toEqual({ ok: false, rule: 'unknown-issuer' });
		let asked = 0;
		const introspection: TokenVerifier = {
			verify: async () => {
				asked += 1;
				return { ok: false, rule: 'inactive' };
			},
		};
		await verifier({ introspection }).verify(await as.issue());
		expect(asked).toBe(0);
		await verifier({ introspection }).verify(opaque);
		expect(asked).toBe(1);
	});

	it('tells a compact JWS by its shape', () => {
		expect(isCompactJws('a.b.c')).toBe(true);
		expect(isCompactJws('a.b.')).toBe(true);
		for (const bad of ['a.b', 'a.b.c.d', '.b.c', 'a..c', 'a+.b.c', 'a.b.c=', 'abc']) {
			expect(isCompactJws(bad), bad).toBe(false);
		}
	});
});

describe('P3-E9: M3 rule 2: the header', () => {
	const kid = () => as.keys.RS256.kid;

	it('typ: at+jwt or application/at+jwt only', async () => {
		const token = await as.issue({ header: { typ: 'JWT' } });
		expect(await verifier().verify(token)).toEqual({ ok: false, rule: 'typ', issuer: 'test-as' });
		expect(refusal(await verifier().verify(raw({ alg: 'RS256', kid: kid() })))).toBe('typ');
	});

	it('typ: a header with a repeated member is refused', async () => {
		const header = Buffer.from(
			`{"alg":"RS256","typ":"at+jwt","kid":"${kid()}","kid":"other"}`
		).toString('base64url');
		expect(refusal(await verifier().verify(`${header}.${b64(as.claims())}.c2ln`))).toBe('typ');
	});

	it('alg: none and HS256 are refused whatever the list says, and so is an unlisted one', async () => {
		for (const alg of ['none', 'HS256']) {
			expect(refusal(await verifier().verify(raw({ alg, typ: 'at+jwt', kid: kid() }), {}))).toBe(
				'alg'
			);
		}
		const es = await as.issue({ alg: 'ES256' });
		expect(refusal(await verifier({ algorithms: ['RS256'] }).verify(es))).toBe('alg');
		expect(
			() =>
				new JwtVerifier({
					rules: { resource: RESOURCE },
					issuers: [
						{
							issuer: as.issuer,
							algorithms: ['HS256' as SigningAlgorithm],
							keys: jwksKeySource(as.jwks()),
						},
					],
				})
		).toThrow(/cannot verify "HS256"/);
	});

	it('kid: a non-empty string', async () => {
		expect(refusal(await verifier().verify(raw({ alg: 'RS256', typ: 'at+jwt', kid: '' })))).toBe(
			'kid'
		);
		expect(refusal(await verifier().verify(raw({ alg: 'RS256', typ: 'at+jwt' })))).toBe('kid');
	});

	it('crit: no extension is understood', async () => {
		const header = { alg: 'RS256', typ: 'at+jwt', kid: kid(), crit: ['b64'], b64: false };
		expect(refusal(await verifier().verify(raw(header)))).toBe('crit');
	});

	it('key-reference: jku, x5u, x5c and jwk are refused', async () => {
		for (const member of ['jku', 'x5u', 'x5c', 'jwk']) {
			const token = await as.issue({ header: { [member]: member === 'x5c' ? ['MIIB'] : 'x' } });
			expect(refusal(await verifier().verify(token)), member).toBe('key-reference');
		}
	});
});

describe('P3-E9: M3 rule 3: the key', () => {
	it('key: no key with that kid', async () => {
		const token = await as.issue({ header: { kid: 'missing' } });
		expect(await verifier().verify(token)).toEqual({ ok: false, rule: 'key', issuer: 'test-as' });
	});

	it('key: a key of another family, another alg, use enc or key_ops without verify', async () => {
		const rs = as.keys.RS256.publicJwk;
		const es = as.keys.ES256.publicJwk;
		const cases = [
			{ ...es, kid: rs.kid },
			{ ...rs, alg: 'PS256' },
			{ ...rs, use: 'enc' },
			{ ...rs, use: undefined, key_ops: ['sign'] },
		];
		const token = await as.issue();
		for (const key of cases) {
			const keys = jwksKeySource({ keys: [JSON.parse(JSON.stringify(key))] });
			expect(refusal(await verifier({ keys }).verify(token))).toBe('key');
		}
	});

	it('key: material the verifier cannot use (a short coordinate, an RSA key under 2048 bits)', async () => {
		const es = as.keys.ES256.publicJwk;
		const short = { ...es, x: Buffer.alloc(31).toString('base64url') };
		const esToken = await as.issue({ alg: 'ES256' });
		expect(
			refusal(await verifier({ keys: jwksKeySource({ keys: [short] }) }).verify(esToken))
		).toBe('key');
		// jose will not make or sign with such a key, so WebCrypto does both.
		const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
		const weak = await crypto.subtle.generateKey(
			{ ...algorithm, modulusLength: 1024, publicExponent: new Uint8Array([1, 0, 1]) },
			true,
			['sign', 'verify']
		);
		const { kty, n, e } = await crypto.subtle.exportKey('jwk', weak.publicKey);
		const signingInput = `${b64({ alg: 'RS256', typ: 'at+jwt', kid: 'weak' })}.${b64(as.claims())}`;
		const signature = await crypto.subtle.sign(
			algorithm,
			weak.privateKey,
			new TextEncoder().encode(signingInput)
		);
		const token = `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
		const keys = jwksKeySource({ keys: [{ kty, n, e, kid: 'weak' }] });
		expect(refusal(await verifier({ keys }).verify(token))).toBe('key');
	});

	it('key: private members of a published key never make a signing key', async () => {
		const pair = await generateKeyPair('ES256', { extractable: true });
		const leaked = { ...(await exportJWK(pair.privateKey)), kid: 'leaked', alg: 'ES256' };
		const token = await as.issue({
			alg: 'ES256',
			header: { kid: 'leaked' },
			signWith: pair.privateKey,
		});
		// Verified with the public members alone.
		expect(refusal(await verifier({ keys: jwksKeySource({ keys: [leaked] }) }).verify(token))).toBe(
			'accepted'
		);
	});

	it('unavailable: a key source that cannot answer fails closed', async () => {
		const token = await as.issue();
		const down: KeySource = { key: async () => ({ error: 'unavailable' }) };
		const throws: KeySource = {
			key: async () => {
				throw new Error('network');
			},
		};
		expect(refusal(await verifier({ keys: down }).verify(token))).toBe('unavailable');
		expect(refusal(await verifier({ keys: throws }).verify(token))).toBe('unavailable');
		as.publish(null);
		try {
			const keys = jwksKeySource(fetchJwks);
			expect(refusal(await verifier({ keys }).verify(token))).toBe('unavailable');
		} finally {
			as.publish(Object.values(as.keys).map((key) => key.publicJwk));
		}
	});
});

describe('P3-E9: M3 rule 4: the signature', () => {
	it('signature: a token signed by another key under the same kid', async () => {
		const forger = await generateKeyPair('RS256', { extractable: true });
		const token = await as.issue({ signWith: forger.privateKey });
		expect(await verifier().verify(token)).toEqual({
			ok: false,
			rule: 'signature',
			issuer: 'test-as',
		});
	});

	it('signature: a changed payload, or a signature that is not base64url', async () => {
		const [header, , signature] = (await as.issue()).split('.');
		const changed = `${header}.${b64({ ...as.claims(), sub: 'admin' })}.${signature}`;
		expect(refusal(await verifier().verify(changed))).toBe('signature');
		const [h, p] = (await as.issue()).split('.');
		expect(refusal(await verifier().verify(`${h}.${p}.a`))).toBe('signature');
		expect(refusal(await verifier().verify(`${h}.${p}.`))).toBe('signature');
	});
});

describe('P3-E9: M3 rules 5 to 10: the claims after the signature', () => {
	it('issuer: introspection answering for another issuer', async () => {
		const introspection = createIntrospectionVerifier({
			issuer: as.issuer,
			rules: { resource: RESOURCE },
			introspect: async () => ({ active: true, ...as.claims(), iss: 'https://other.example' }),
		});
		expect(refusal(await introspection.verify('opaque', {}))).toBe('issuer');
	});

	it('audience: never optional; another, several, or none', async () => {
		for (const aud of [
			'https://other.example/mcp',
			[RESOURCE, 'https://other.example/mcp'],
			undefined,
		]) {
			const token = await as.issue({ claims: { aud } });
			expect(refusal(await verifier().verify(token)), JSON.stringify(aud)).toBe('audience');
		}
		expect(() => new JwtVerifier({ rules: {} as TokenRulesOptions, issuers: [] })).toThrow(
			/resource/
		);
	});

	it('claims: exp, iat, jti, sub and client_id are required', async () => {
		for (const missing of ['exp', 'iat', 'jti', 'sub', 'client_id']) {
			const token = await as.issue({ claims: { [missing]: undefined } });
			expect(refusal(await verifier().verify(token)), missing).toBe('claims');
		}
	});

	it('expired, not-yet-valid and lifetime, against the configured skew', async () => {
		const now = 2_000_000_000;
		const at = (claims: Record<string, unknown>) =>
			as.issue({ claims: { ...as.claims(now), ...claims } });
		const v = verifier({ now, rules: { clockSkewS: 30 } });
		expect(refusal(await v.verify(await at({ iat: now - 600, exp: now - 30 })))).toBe('expired');
		expect(refusal(await v.verify(await at({ iat: now - 600, exp: now - 29 })))).toBe('accepted');
		expect(refusal(await v.verify(await at({ iat: now + 31, exp: now + 600 })))).toBe(
			'not-yet-valid'
		);
		expect(refusal(await v.verify(await at({ nbf: now + 31 })))).toBe('not-yet-valid');
		expect(refusal(await v.verify(await at({ iat: now, exp: now + 3601 })))).toBe('lifetime');
		expect(() => createTokenRules({ resource: RESOURCE, clockSkewS: 301 })).toThrow(/clockSkewS/);
	});

	it('scope-malformed and scopes-too-many', async () => {
		expect(refusal(await verifier().verify(await as.issue({ claims: { scope: 'a  b' } })))).toBe(
			'scope-malformed'
		);
		const many = await as.issue({ claims: { scope: 'a b c' } });
		expect(refusal(await verifier({ rules: { scopeLimit: 2 } }).verify(many))).toBe(
			'scopes-too-many'
		);
	});

	it('dpop-unsupported and binding', async () => {
		const dpop = await as.issue({ claims: { cnf: { jkt: 'x' } } });
		expect(refusal(await verifier().verify(dpop))).toBe('dpop-unsupported');
		const bound = await as.issue({ claims: { cnf: { 'x5t#S256': 'thumb' } } });
		expect(refusal(await verifier().verify(bound, {}))).toBe('binding');
		expect(refusal(await verifier().verify(bound, { certificate: 'other' }))).toBe('binding');
		const ok = await verifier().verify(bound, { certificate: 'thumb' });
		expect(ok.ok && ok.credentials.cnf).toEqual({ 'x5t#S256': 'thumb' });
		const unbound = await as.issue();
		expect(refusal(await verifier({ rules: { requireBoundTokens: true } }).verify(unbound))).toBe(
			'binding'
		);
	});
});

describe('P3-E9: M3 introspection (RFC 7662), the alternative for opaque tokens', () => {
	/** The host's RFC 7662 call, POSTing the token to the fixture's endpoint. */
	const introspect = (token: string) =>
		fetch(as.introspectionUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ token }),
		}).then((response) => response.json());

	function introspecting(cacheSize?: number) {
		const introspection = createIntrospectionVerifier({
			issuer: as.issuer,
			alias: 'test-as',
			rules: { resource: RESOURCE },
			introspect,
			...(cacheSize !== undefined ? { cacheSize } : {}),
		});
		return verifier({ introspection });
	}

	it('an active token becomes credentials, as a JWT would', async () => {
		const result = await introspecting().verify(as.issueOpaque({ scope: 'todo:read todo:write' }));
		expect(result).toMatchObject({
			ok: true,
			credentials: { subject: 'user-1', clientId: 'agent-1', scopes: ['todo:read', 'todo:write'] },
		});
	});

	it('inactive: active is not true', async () => {
		const token = as.issueOpaque();
		as.revoke(token);
		expect(await introspecting(0).verify(token)).toEqual({
			ok: false,
			rule: 'inactive',
			issuer: 'test-as',
		});
	});

	it('claims: exp, iat, iss, aud, sub and client_id are required, optional in RFC 7662', async () => {
		for (const missing of ['exp', 'iat', 'iss', 'aud', 'sub', 'client_id', 'jti']) {
			const token = as.issueOpaque({ [missing]: undefined });
			expect(refusal(await introspecting(0).verify(token)), missing).toBe('claims');
		}
	});

	it('unavailable: an endpoint that cannot answer fails closed', async () => {
		const down = createIntrospectionVerifier({
			issuer: as.issuer,
			rules: { resource: RESOURCE },
			introspect: async () => {
				throw new Error('connection refused');
			},
		});
		expect(refusal(await down.verify('opaque', {}))).toBe('unavailable');
	});

	it('caches an active answer by the token digest for at most 60 seconds, re-checking it', async () => {
		const clock = fixedClock(Date.now());
		const v = createIntrospectionVerifier({
			issuer: as.issuer,
			rules: { resource: RESOURCE },
			introspect,
			clock,
		});
		const token = as.issueOpaque();
		const before = as.requests.introspect;
		await v.verify(token, {});
		await v.verify(token, {});
		expect(as.requests.introspect - before).toBe(1);
		clock.advance(60_000);
		await v.verify(token, {});
		expect(as.requests.introspect - before).toBe(2);
	});
});

describe('P3-E9: jwksKeySource: the host loads the JWKS; AFD opens no socket', () => {
	it('loads once, then again for an unknown kid at most once per interval', async () => {
		const clock = fixedClock(Date.now());
		const keys = jwksKeySource(fetchJwks, { clock, minRefetchIntervalMs: 30_000 });
		const before = as.requests.jwks;
		expect(await keys.key(as.issuer, as.keys.RS256.kid)).toHaveProperty('key');
		expect(await keys.key(as.issuer, 'made-up-1')).toEqual({ error: 'unknown' });
		expect(await keys.key(as.issuer, 'made-up-2')).toEqual({ error: 'unknown' });
		expect(as.requests.jwks - before).toBe(1);
		clock.advance(30_000);
		expect(await keys.key(as.issuer, 'made-up-3')).toEqual({ error: 'unknown' });
		expect(as.requests.jwks - before).toBe(2);
	});

	it('keeps the last good keys when a later load fails', async () => {
		const clock = fixedClock(Date.now());
		const keys = jwksKeySource(fetchJwks, { clock, maxAgeMs: 1000, minRefetchIntervalMs: 0 });
		expect(await keys.key(as.issuer, as.keys.ES256.kid)).toHaveProperty('key');
		as.publish(null);
		try {
			clock.advance(5000);
			expect(await keys.key(as.issuer, as.keys.ES256.kid)).toHaveProperty('key');
			expect(await keys.key(as.issuer, 'rotated-in')).toEqual({ error: 'unavailable' });
		} finally {
			as.publish(Object.values(as.keys).map((key) => key.publicJwk));
		}
	});

	it('answers unavailable once its last good keys are older than maxStaleMs and loads still fail', async () => {
		const clock = fixedClock(Date.now());
		const keys = jwksKeySource(fetchJwks, {
			clock,
			maxAgeMs: 1000,
			maxStaleMs: 10_000,
			minRefetchIntervalMs: 0,
		});
		expect(await keys.key(as.issuer, as.keys.RS256.kid)).toHaveProperty('key');
		as.publish(null);
		try {
			clock.advance(9_999);
			expect(await keys.key(as.issuer, as.keys.RS256.kid)).toHaveProperty('key');
			clock.advance(1);
			expect(await keys.key(as.issuer, as.keys.RS256.kid)).toEqual({ error: 'unavailable' });
		} finally {
			as.publish(Object.values(as.keys).map((key) => key.publicJwk));
		}
		// A load that succeeds again restores it.
		expect(await keys.key(as.issuer, as.keys.RS256.kid)).toHaveProperty('key');
		expect(() => jwksKeySource(fetchJwks, { maxAgeMs: 10, maxStaleMs: 5 })).toThrow(/maxStaleMs/);
	});

	it('refuses a fixed document that is not a key set', () => {
		expect(() => jwksKeySource({})).toThrow(/"keys" array/);
		expect(() => jwksKeySource({ keys: [{ kty: 'RSA' }] })).toThrow(/non-empty kid/);
		expect(() => jwksKeySource({ keys: [{ kid: 'a' }, { kid: 'a' }] })).toThrow(/more than once/);
	});
});

describe('P3-E9: M3, the configuration a verifier refuses', () => {
	it('refuses an introspection verifier with another audience or binding requirement', () => {
		const introspect = async () => ({});
		const make = (rules: TokenRulesOptions) =>
			verifier({
				introspection: createIntrospectionVerifier({ issuer: as.issuer, rules, introspect }),
			});
		expect(() => make({ resource: 'https://elsewhere.example/mcp' })).toThrow(/introspection/);
		expect(() => make({ resource: RESOURCE, requireBoundTokens: true })).toThrow(/introspection/);
		expect(make({ resource: RESOURCE }).issuers).toEqual([as.issuer, as.issuer]);
	});

	it('refuses two issuers that share one key source', () => {
		const keys = jwksKeySource(as.jwks());
		expect(
			() =>
				new JwtVerifier({
					rules: { resource: RESOURCE },
					issuers: [
						{ issuer: as.issuer, algorithms: ['RS256'], keys },
						{ issuer: 'https://other.example', algorithms: ['RS256'], keys },
					],
				})
		).toThrow(/shares its key source/);
	});
});

describe('P3-E9: M4: credentials', () => {
	it('hold no token, and their debug form redacts all but issuer and expiresAt', async () => {
		const token = await as.issue({ claims: { auth_time: 1, acr: 'phr' } });
		const result = await verifier().verify(token);
		if (!result.ok) throw new Error(result.rule);
		expect(JSON.stringify(result.credentials)).not.toContain(token);
		const shown = inspect(result.credentials);
		expect(shown).toContain(as.issuer);
		expect(shown).toContain(String(result.credentials.expiresAt));
		expect(shown).not.toContain('user-1');
		expect(shown).not.toContain('agent-1');
		expect(shown).not.toContain('phr');
		expect(Object.keys(result.credentials).sort()).toEqual(
			[
				'acr',
				'authTime',
				'clientId',
				'expiresAt',
				'issuedAt',
				'issuer',
				'resource',
				'scopes',
				'subject',
			].sort()
		);
	});
});
