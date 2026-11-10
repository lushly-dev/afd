/**
 * Deployment and projection version 3 (phase 3 specification, 2.1 and 2.2; D85, D95): `[identity]`, its
 * defaults and refusals, and what stage A and stage B read of it. A version 2 file stays version 2 and
 * `local`, so phase 2's fixtures keep their meaning (2.1's table, E12).
 */

import { describe, expect, it } from 'vitest';
import { readSchema, schemaAjv } from '../scripts/compile.mjs';
import { readBoot } from './read-boot.js';
import { readDeployment } from './read-deployment.js';
import { readProjection } from './read-projection.js';

const file = (identity?: Record<string, unknown>, apps: Record<string, unknown> = {}) => ({
	deployment_version: 3,
	workspace: { id: 'acme', name: 'Acme' },
	apps,
	...(identity !== undefined ? { identity } : {}),
});
const codesOf = (json: unknown) => {
	const read = readDeployment(json);
	return read.ok ? [] : read.refusals.map((refusal) => [refusal.code, refusal.key]);
};
const provider = { mode: 'provider', organization: 'acme' };

describe('readDeployment, version 3', () => {
	it('reads `[identity]` with its defaults: path `api/auth`, methods passkey alone', () => {
		const read = readDeployment(file({ ...provider, provider: 'better-auth' }));
		expect(read.ok && read.identity).toEqual({
			mode: 'provider',
			organization: 'acme',
			path: 'api/auth',
			methods: ['passkey'],
		});
		const all = readDeployment(
			file({ ...provider, path: 'auth/v1', methods: ['passkey', 'password', 'oidc:okta'] })
		);
		expect(all.ok && all.identity).toEqual({
			mode: 'provider',
			organization: 'acme',
			path: 'auth/v1',
			methods: ['passkey', 'password', 'oidc:okta'],
		});
	});

	it('reads no `[identity]`, `mode = "local"` and every earlier version as local', () => {
		for (const json of [
			file(),
			file({ mode: 'local' }),
			{ ...file(), deployment_version: 2 },
			{ deployment_version: 1, apps: {} },
		]) {
			const read = readDeployment(json);
			expect(read.ok && read.identity).toEqual({ mode: 'local' });
		}
	});

	it('needs version 3 for `[identity]`: a version 2 file holding one is refused', () => {
		expect(codesOf({ ...file(provider), deployment_version: 2 })).toEqual([
			['DEPLOYMENT_INVALID', 'identity'],
		]);
	});

	it.each([
		['a provider with no organization', { mode: 'provider' }, 'identity.organization'],
		[
			'an organization off the slug pattern',
			{ ...provider, organization: 'Acme' },
			'identity.organization',
		],
		['a path with a leading slash', { ...provider, path: '/api/auth' }, 'identity.path'],
		['a path with a `..` segment', { ...provider, path: 'api/../auth' }, 'identity.path'],
		['a path with a `.` segment', { ...provider, path: './auth' }, 'identity.path'],
		['a path a deployment file uses', { ...provider, path: 'apps/auth' }, 'identity.path'],
		['a path under the workspace route', { ...provider, path: 'acme/auth' }, 'identity.path'],
		['no methods', { ...provider, methods: [] }, 'identity.methods'],
		['an unknown method', { ...provider, methods: ['magic-link'] }, 'identity.methods'],
		['a method twice', { ...provider, methods: ['passkey', 'passkey'] }, 'identity.methods'],
		['another provider', { ...provider, provider: 'keycloak' }, 'identity.provider'],
		['an unknown key', { ...provider, secret: 'x' }, 'identity.secret'],
	])('refuses %s as DEPLOYMENT_IDENTITY_INVALID', (_name, identity, key) => {
		expect(codesOf(file(identity))).toEqual([['DEPLOYMENT_IDENTITY_INVALID', key]]);
	});

	it('refuses a mounted `stdio` instance in a `provider` workspace (D95), naming it', () => {
		const stdio = {
			work: {
				app: 'umbel',
				package: './apps/umbel',
				audience: 'person',
				transport: 'stdio',
				command: ['umbel'],
			},
		};
		const refusals = readDeployment(file(provider, stdio));
		expect(refusals.ok).toBe(false);
		if (refusals.ok) return;
		expect(refusals.refusals.map((refusal) => [refusal.code, refusal.key])).toEqual([
			['DEPLOYMENT_STDIO_TEAM', 'apps.work.transport'],
		]);
		expect(refusals.refusals[0]?.message).toContain('`work`');
		expect(refusals.refusals[0]?.suggestion).toContain('HTTP');
		// A `local` deployment may still run one (D56, narrowed by D95 only for `provider`).
		expect(readDeployment(file({ mode: 'local' }, stdio)).ok).toBe(true);
	});
});

const EMPTY = {
	deployment_version: 3,
	generation: 'empty',
	workspace: { id: 'acme', name: 'Acme' },
	sandbox_origin: null,
	apps: [],
};
const PROVIDER = { mode: 'provider', organization: 'acme', path: 'api/auth', methods: ['passkey'] };

describe('readProjection, version 3', () => {
	it('reads versions 2 and 3, with or without an identity', () => {
		for (const json of [
			{ ...EMPTY, deployment_version: 2 },
			EMPTY,
			{ ...EMPTY, identity: { mode: 'local' } },
			{ ...EMPTY, identity: PROVIDER },
		]) {
			expect(readProjection(json).ok).toBe(true);
		}
	});

	it.each([
		[
			'a version 2 projection with an identity',
			{ ...EMPTY, deployment_version: 2, identity: PROVIDER },
		],
		['a provider identity with no methods', { ...EMPTY, identity: { ...PROVIDER, methods: [] } }],
		[
			'a provider identity with no organization',
			{ ...EMPTY, identity: { mode: 'provider', path: 'api/auth', methods: ['passkey'] } },
		],
		['a local identity with a path', { ...EMPTY, identity: { mode: 'local', path: 'api/auth' } }],
		['an organization id', { ...EMPTY, identity: { ...PROVIDER, organizationId: 'org_1' } }],
		['a secret', { ...EMPTY, identity: { ...PROVIDER, secret: 'x' } }],
		['a leading slash', { ...EMPTY, identity: { ...PROVIDER, path: '/api/auth' } }],
	])('refuses %s', (_name, json) => {
		expect(readProjection(json).ok).toBe(false);
	});
});

describe('projection.v3.json and readProjection agree', () => {
	it('on every identity case: the schema is the contract, the reader its hand-written check', () => {
		const validate = schemaAjv().getSchema(readSchema('projection', 3).$id);
		const cases: unknown[] = [
			undefined,
			{ mode: 'local' },
			PROVIDER,
			{ ...PROVIDER, methods: ['passkey', 'password', 'oidc:okta'] },
			{ ...PROVIDER, path: 'auth/v1' },
			{ mode: 'local', path: 'api/auth' },
			{ mode: 'local', organization: 'acme' },
			{ mode: 'provider' },
			{ ...PROVIDER, organization: 'Acme' },
			{ ...PROVIDER, path: '/api/auth' },
			{ ...PROVIDER, path: 'api/../auth' },
			{ ...PROVIDER, path: './auth' },
			{ ...PROVIDER, methods: [] },
			{ ...PROVIDER, methods: ['passkey', 'passkey'] },
			{ ...PROVIDER, methods: ['magic'] },
			{ ...PROVIDER, methods: 'passkey' },
			{ ...PROVIDER, secret: 'x' },
			{ mode: 'team' },
			'provider',
			null,
		];
		for (const identity of cases) {
			const json = identity === undefined ? EMPTY : { ...EMPTY, identity };
			expect(readProjection(json).ok, JSON.stringify(identity)).toBe(validate?.(json) === true);
		}
		expect(validate?.({ ...EMPTY, deployment_version: 2, identity: PROVIDER })).toBe(false);
		expect(readProjection({ ...EMPTY, deployment_version: 2, identity: PROVIDER }).ok).toBe(false);
	});
});

describe('readBoot, version 3', () => {
	it('reads the identity stage A decides with; version 2 and none are local', () => {
		expect(readBoot({ ...EMPTY, identity: PROVIDER })?.identity).toEqual(PROVIDER);
		expect(readBoot(EMPTY)?.identity).toEqual({ mode: 'local' });
		expect(readBoot({ ...EMPTY, deployment_version: 2 })?.identity).toEqual({ mode: 'local' });
		// Version 2 cannot carry one: a provider identity there is not read.
		expect(readBoot({ ...EMPTY, deployment_version: 2, identity: PROVIDER })?.identity).toEqual({
			mode: 'local',
		});
	});

	it('boots anything but an exact `local` as `provider`, which stage B then refuses: never `local` by mistake', () => {
		for (const identity of [
			{ mode: 'provider' },
			{ ...PROVIDER, organization: 'Acme' },
			{ ...PROVIDER, path: '/api/auth' },
			{ ...PROVIDER, methods: [] },
			{ mode: 'local', path: 'api/auth' },
			{ mode: 'local', organization: 'acme' },
			{ mode: 'team' },
			'local',
			null,
		]) {
			expect(readBoot({ ...EMPTY, identity })?.identity?.mode, JSON.stringify(identity)).toBe(
				'provider'
			);
			expect(readProjection({ ...EMPTY, identity }).ok, JSON.stringify(identity)).toBe(false);
		}
		expect(readBoot({ ...EMPTY, deployment_version: 4 })).toBeUndefined();
	});
});
