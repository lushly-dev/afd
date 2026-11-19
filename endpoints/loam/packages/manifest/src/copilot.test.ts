/**
 * Phase 5's step 2 (phase 5 specification, 4.1 and 4.2): version 4's `[copilot]` and the projection's `copilot`. The
 * file's rules past its schema, `COPILOT_PROVIDER_HOST` on every host but the desktop, and the projection's reader,
 * which stage A and stage B share and which never admits more than `projection.v4.json` does.
 */

import { describe, expect, it } from 'vitest';
import { readSchema, schemaAjv } from '../scripts/compile.mjs';
import { copilotOf, readBoot } from './read-boot.js';
import { copilotEndpointAllowed, readDeployment } from './read-deployment.js';
import { readProjection } from './read-projection.js';

const CLAUDE = {
	id: 'claude',
	kind: 'anthropic',
	model: 'claude-sonnet-4-5',
	key: { keychain: 'loam-copilot', account: 'claude' },
};
const LOCAL = {
	id: 'local',
	kind: 'openai-compatible',
	model: 'llama3.1:8b',
	endpoint: 'http://127.0.0.1:11434/v1',
};
const TEST = { id: 'scripted', kind: 'test', model: 'script' };

const file = (copilot: unknown, kind = 'desktop') => ({
	deployment_version: 4,
	workspace: { id: 'personal' },
	host: { kind },
	apps: {},
	copilot,
});
const codes = (json: unknown) => {
	const read = readDeployment(json);
	return read.ok ? [] : read.refusals.map(({ code, key }) => `${code} ${key}`);
};

describe('`[copilot]` in version 4 (4.1)', () => {
	it('reads the specification’s example on the desktop', () => {
		expect(codes(file({ default: 'claude', providers: [CLAUDE, LOCAL] }))).toEqual([]);
		expect(codes(file({ providers: [{ ...CLAUDE, key: { file: 'keys/claude.key' } }] }))).toEqual(
			[]
		);
	});

	it('is version 4’s alone: an earlier file with `[copilot]` is refused by its schema', () => {
		const read = readDeployment({
			deployment_version: 3,
			apps: {},
			copilot: { providers: [TEST] },
		});
		expect(read.ok).toBe(false);
	});

	it('refuses each rule past the schema with `DEPLOYMENT_COPILOT_INVALID`, keyed by the provider', () => {
		expect(codes(file({ providers: [] }))).toEqual(['DEPLOYMENT_COPILOT_INVALID copilot']);
		expect(codes(file({ providers: [TEST, TEST] }))).toEqual([
			'DEPLOYMENT_COPILOT_INVALID copilot.providers[1].id',
		]);
		expect(codes(file({ default: 'other', providers: [TEST] }))).toEqual([
			'DEPLOYMENT_COPILOT_INVALID copilot.default',
		]);
		expect(codes(file({ providers: [{ ...LOCAL, endpoint: undefined }] }))).toEqual([
			'DEPLOYMENT_COPILOT_INVALID copilot.providers[0].endpoint',
		]);
		expect(codes(file({ providers: [{ ...CLAUDE, endpoint: 'https://example.com/v1' }] }))).toEqual(
			['DEPLOYMENT_COPILOT_INVALID copilot.providers[0].endpoint']
		);
		expect(codes(file({ providers: [{ ...CLAUDE, key: undefined }] }))).toEqual([
			'DEPLOYMENT_COPILOT_INVALID copilot.providers[0].key',
		]);
		expect(codes(file({ providers: [{ ...TEST, key: { file: 'k' } }] }))).toEqual([
			'DEPLOYMENT_COPILOT_INVALID copilot.providers[0].key',
		]);
		const many = Array.from({ length: 17 }, (_, index) => ({ ...TEST, id: `p${index}` }));
		expect(codes(file({ providers: many }))).toEqual([
			'DEPLOYMENT_COPILOT_INVALID copilot.providers',
		]);
	});

	it('refuses a key out of shape, an unknown kind or key, and a model id with spaces, by the schema', () => {
		for (const provider of [
			{ ...CLAUDE, key: { keychain: 'loam copilot', account: 'claude' } },
			{ ...CLAUDE, key: { keychain: 'loam-copilot' } },
			{ ...CLAUDE, key: { file: 'k', keychain: 'x', account: 'y' } },
			{ ...CLAUDE, key: 'sk-ant-the-key-itself' },
			{ ...CLAUDE, kind: 'gemini' },
			{ ...CLAUDE, model: 'a model' },
			{ ...CLAUDE, headers: { 'x-extra': '1' } },
			{ ...CLAUDE, id: 'Claude' },
		]) {
			const found = codes(file({ providers: [provider] }));
			expect(found.length, JSON.stringify(provider)).toBeGreaterThan(0);
			expect(found.every((code) => code.startsWith('DEPLOYMENT_COPILOT_INVALID copilot'))).toBe(
				true
			);
		}
	});

	it('allows an endpoint over https, or http to 127.0.0.1 or ::1 only', () => {
		for (const endpoint of [
			'https://models.example.com/v1',
			'http://127.0.0.1:11434/v1',
			'http://[::1]:8080/v1',
		])
			expect(copilotEndpointAllowed(endpoint), endpoint).toBe(true);
		for (const endpoint of [
			'http://localhost:11434/v1',
			'http://192.168.1.4/v1',
			'http://127.0.0.2/v1',
			'ftp://127.0.0.1/v1',
			'https://user:pass@example.com/v1',
			'https://example.com/v1?key=1',
			'https://example.com/v1#x',
			'not a url',
		])
			expect(copilotEndpointAllowed(endpoint), endpoint).toBe(false);
	});

	it('`COPILOT_PROVIDER_HOST`: a static or hosted deployment takes only `kind = "test"`', () => {
		for (const kind of ['static', 'hosted']) {
			expect(codes(file({ providers: [TEST] }, kind)), kind).toEqual([]);
			expect(codes(file({ providers: [TEST, CLAUDE, LOCAL] }, kind)), kind).toEqual([
				'COPILOT_PROVIDER_HOST copilot.providers[1].kind',
				'COPILOT_PROVIDER_HOST copilot.providers[2].kind',
			]);
		}
	});
});

const PROJECTION = {
	deployment_version: 4,
	generation: 'empty',
	workspace: { id: 'personal', name: 'Personal' },
	sandbox_origin: 'http://loam-sandbox.localhost',
	host: { kind: 'desktop' },
	apps: [],
};
const PROJECTED = {
	default: 'claude',
	providers: [
		{ id: 'claude', kind: 'anthropic', model: 'claude-sonnet-4-5' },
		{ id: 'local', kind: 'openai-compatible', model: 'llama3.1:8b' },
	],
};

describe('the projection’s `copilot` (4.1)', () => {
	it('carries ids, kinds and models, and both stages read it whole', () => {
		expect(copilotOf(PROJECTED)).toEqual(PROJECTED);
		expect(readProjection({ ...PROJECTION, copilot: PROJECTED }).ok).toBe(true);
		expect(readBoot({ ...PROJECTION, copilot: PROJECTED })?.copilot).toEqual({
			projection: PROJECTED,
			sandboxOrigin: 'http://loam-sandbox.localhost',
		});
	});

	it('has no place for a key or an endpoint: either refuses the whole table in both stages', () => {
		for (const extra of [{ key: 'sk-ant-x' }, { endpoint: 'http://127.0.0.1:1/v1' }]) {
			const copilot = {
				...PROJECTED,
				providers: [{ ...PROJECTED.providers[0], ...extra }],
			};
			expect(copilotOf(copilot)).toBeUndefined();
			expect(readProjection({ ...PROJECTION, copilot }).ok).toBe(false);
			expect(readBoot({ ...PROJECTION, copilot })?.copilot).toBeUndefined();
		}
	});

	it('is stricter than its schema, never looser: a default naming a provider, ids once, 1 to 16', () => {
		const validate = schemaAjv().getSchema(readSchema('projection', 4).$id);
		if (!validate) throw new Error('projection.v4.json is not compiled');
		const cases: unknown[] = [
			PROJECTED,
			{ ...PROJECTED, default: 'other' },
			{ ...PROJECTED, providers: [PROJECTED.providers[0], PROJECTED.providers[0]] },
			{ ...PROJECTED, providers: [] },
			{ providers: PROJECTED.providers },
			{ ...PROJECTED, extra: true },
			{ ...PROJECTED, providers: [{ ...PROJECTED.providers[0], kind: 'gemini' }] },
			{ ...PROJECTED, providers: [{ ...PROJECTED.providers[0], model: 'a b' }] },
			{
				default: 'p0',
				providers: Array.from({ length: 17 }, (_, i) => ({
					id: `p${i}`,
					kind: 'test',
					model: 'm',
				})),
			},
			'claude',
			null,
		];
		for (const copilot of cases) {
			for (const version of [2, 3, 4]) {
				const json = { ...PROJECTION, deployment_version: version, copilot };
				const read = readProjection(json).ok;
				// Both stages give the same answer, and whatever they admit, the schema admits.
				if (version === 4)
					expect(read, JSON.stringify(copilot)).toBe(copilotOf(copilot) !== undefined);
				if (read) expect(validate(json), JSON.stringify(json)).toBe(true);
				if (version !== 4) expect(read, `${version}`).toBe(false);
			}
		}
		expect(readProjection({ ...PROJECTION, copilot: { ...PROJECTED, default: 'other' } }).ok).toBe(
			false
		);
	});

	it('stage A starts no copilot without a sandbox origin to load its frame from', () => {
		const read = readBoot({ ...PROJECTION, sandbox_origin: null, copilot: PROJECTED });
		expect(read?.copilot).toBeUndefined();
		expect(readBoot({ ...PROJECTION, deployment_version: 3, copilot: PROJECTED })?.copilot).toBe(
			undefined
		);
	});
});
