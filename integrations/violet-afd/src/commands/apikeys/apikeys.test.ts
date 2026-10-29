import { createMemoryDatabase } from '@lushly-dev/violet-core';
import { describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import {
	API_KEY_SCOPES,
	apiKeysCheckCommand,
	apiKeysCreateCommand,
	checkApiKeySeeds,
	hashApiKeyToken,
	selectApiKeySeeds,
} from './index.js';

const context: CommandContext = { db: createMemoryDatabase(), actor: 'test', traceId: 'test' };

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

function seed(token: string, data: Record<string, unknown>) {
	return {
		token,
		data: {
			id: 'consumer-preview',
			name: 'Consumer (preview)',
			createdAt: '2026-10-26T00:00:00.000Z',
			scopes: ['tokens:read'],
			...data,
		},
	};
}

function codes(raw: unknown): string[] {
	const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
	return checkApiKeySeeds(text).issues.map((issue) => issue.code);
}

describe('apikeys.create', () => {
	it('generates a 64-hex token, its SHA-256 hash, and a seed the check accepts', async () => {
		const result = await apiKeysCreateCommand.handler(
			{
				id: 'lushly-preview',
				name: 'Lushly (preview)',
				scopes: ['tokens:read', 'export:read', 'tokens:read'],
				rateLimit: 100,
			},
			context,
		);

		expect(result.success).toBe(true);
		const data = result.data;
		expect(data?.token).toMatch(/^[0-9a-f]{64}$/);
		expect(data?.tokenHash).toBe(hashApiKeyToken(data?.token ?? ''));
		expect(data?.seed.token).toBe(data?.token);
		expect(data?.seed.data).toMatchObject({
			id: 'lushly-preview',
			name: 'Lushly (preview)',
			scopes: ['tokens:read', 'export:read'],
			rateLimit: 100,
		});
		expect(Number.isNaN(Date.parse(data?.seed.data.createdAt ?? ''))).toBe(false);
		expect(result.warnings).toBeUndefined();

		const check = checkApiKeySeeds(JSON.stringify([data?.seed]));
		expect(check.issues).toEqual([]);
	});

	it('generates a different token each time', async () => {
		const input = { id: 'k', name: 'K', scopes: ['tokens:read'] };
		const first = await apiKeysCreateCommand.handler(input, context);
		const second = await apiKeysCreateCommand.handler(input, context);
		expect(first.data?.token).not.toBe(second.data?.token);
	});

	it('writes insert SQL with the hash (never the token) and revoke SQL', async () => {
		const result = await apiKeysCreateCommand.handler(
			{ id: 'ops-key', name: "O'Brien's tool", scopes: ['nodes:read'], token: TOKEN_A },
			context,
		);

		const sql = result.data?.sql;
		expect(sql?.insert).toBe(
			`INSERT INTO api_keys (key_id, token_hash, name, scopes, rate_limit) VALUES ('ops-key', '${hashApiKeyToken(TOKEN_A)}', 'O''Brien''s tool', '["nodes:read"]'::jsonb, NULL);`,
		);
		expect(sql?.insert).not.toContain(TOKEN_A);
		expect(sql?.revoke).toBe(
			"UPDATE api_keys SET revoked_at = NOW(), updated_at = NOW() WHERE key_id = 'ops-key';",
		);
	});

	it('rejects unknown scopes and names the known ones', async () => {
		const result = await apiKeysCreateCommand.handler(
			{ id: 'k', name: 'K', scopes: ['token:read'] },
			context,
		);
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toContain('token:read');
		expect(result.error?.suggestion).toContain(API_KEY_SCOPES.tokensRead);
	});

	it('refuses short tokens, so the built-in dev key can never be a hosted key', () => {
		const input = { id: 'k', name: 'K', scopes: ['read'], token: 'violet-dev-key' };
		expect(apiKeysCreateCommand.inputSchema.safeParse(input).success).toBe(false);
	});

	it('warns about broad scopes', async () => {
		const result = await apiKeysCreateCommand.handler(
			{ id: 'k', name: 'K', scopes: ['*'] },
			context,
		);
		expect(result.success).toBe(true);
		expect(result.warnings?.[0]?.code).toBe('BROAD_SCOPE');
	});
});

describe('apikeys.check', () => {
	it('accepts the array and the object form', () => {
		expect(codes([seed(TOKEN_A, {})])).toEqual([]);
		expect(codes({ [TOKEN_A]: seed(TOKEN_A, {}).data })).toEqual([]);
	});

	it('reports invalid JSON and shapes as errors', () => {
		expect(codes('[{"token": "x",}]')).toEqual(['INVALID_JSON']);
		expect(codes('"just a string"')).toEqual(['INVALID_SHAPE']);
		expect(codes([{ id: 'no-token-wrapper' }])).toEqual(['INVALID_ENTRY']);
		expect(codes([{ token: TOKEN_A, data: 'nope' }])).toEqual(['INVALID_ENTRY']);
		expect(codes([])).toEqual(['NO_KEYS']);
	});

	it('reports fields the api_keys upsert needs', () => {
		expect(codes([seed(TOKEN_A, { id: undefined })])).toEqual(['MISSING_ID']);
		expect(codes([seed(TOKEN_A, { name: '' })])).toEqual(['MISSING_NAME']);
		expect(codes([seed(TOKEN_A, { createdAt: undefined })])).toEqual(['INVALID_CREATED_AT']);
		expect(codes([seed(TOKEN_A, { createdAt: 'yesterday' })])).toEqual(['INVALID_CREATED_AT']);
		expect(codes([seed(TOKEN_A, { scopes: 'read' })])).toEqual(['INVALID_SCOPES']);
		expect(codes([seed(TOKEN_A, { rateLimit: 2.5 })])).toEqual(['INVALID_RATE_LIMIT']);
		expect(codes([seed(TOKEN_A, { rateLimit: 0 })])).toEqual(['INVALID_RATE_LIMIT']);
	});

	it('reports token problems', () => {
		expect(codes([{ token: '', data: seed(TOKEN_A, {}).data }])).toEqual(['MISSING_TOKEN']);
		expect(codes([seed('violet-dev-key', {})])).toEqual(['DEV_KEY']);
		expect(codes([seed('short', {})])).toEqual(['SHORT_TOKEN']);
	});

	it('reports unknown, empty and broad scopes', () => {
		expect(codes([seed(TOKEN_A, { scopes: ['token:read'] })])).toEqual(['UNKNOWN_SCOPE']);
		expect(codes([seed(TOKEN_A, { scopes: [] })])).toEqual(['NO_SCOPES']);
		expect(codes([seed(TOKEN_A, { scopes: ['read', 'tokens:read'] })])).toEqual(['BROAD_SCOPE']);
	});

	it('reports duplicate ids and tokens across entries', () => {
		expect(codes([seed(TOKEN_A, {}), seed(TOKEN_B, {})])).toEqual(['DUPLICATE_ID']);
		expect(codes([seed(TOKEN_A, {}), seed(TOKEN_A, { id: 'other' })])).toEqual(['DUPLICATE_TOKEN']);
	});

	it('warns that revokedAt does not revoke an existing key', () => {
		expect(codes([seed(TOKEN_A, { revokedAt: '2026-10-26T00:00:00.000Z' })])).toEqual([
			'REVOKED_AT_IGNORED',
		]);
	});

	it('names entries by position and id but never returns a token', async () => {
		const raw = JSON.stringify([
			seed(TOKEN_A, { scopes: ['token:read'] }),
			seed(TOKEN_A, { id: 'second' }),
		]);
		const result = await apiKeysCheckCommand.handler({ seeds: raw }, context);

		expect(result.success).toBe(true);
		expect(result.data?.valid).toBe(false);
		expect(result.data?.summary).toEqual({ keys: 2, errors: 2, warnings: 0 });
		expect(result.data?.issues.map((i) => [i.entry, i.keyId, i.code])).toEqual([
			[1, 'consumer-preview', 'UNKNOWN_SCOPE'],
			[2, 'second', 'DUPLICATE_TOKEN'],
		]);
		expect(JSON.stringify(result)).not.toContain(TOKEN_A);
	});

	it('is valid when there are only warnings', async () => {
		const result = await apiKeysCheckCommand.handler(
			{ seeds: JSON.stringify([seed(TOKEN_A, { scopes: ['*'] })]) },
			context,
		);
		expect(result.data?.valid).toBe(true);
		expect(result.data?.summary).toEqual({ keys: 1, errors: 0, warnings: 1 });
	});
});

describe('selectApiKeySeeds', () => {
	const TOKEN_C = 'c'.repeat(64);

	it('accepts only the entries without errors, keeping their positions', () => {
		const selection = selectApiKeySeeds(
			JSON.stringify([
				seed(TOKEN_A, { id: 'first' }),
				seed(TOKEN_B, { id: undefined }),
				seed(TOKEN_A, { id: 'copy' }),
				seed(TOKEN_C, { id: 'broad', scopes: ['*'] }),
			]),
		);

		expect(selection.accepted.map((s) => [s.entry, s.data.id])).toEqual([
			[1, 'first'],
			[4, 'broad'],
		]);
		expect(selection.accepted[0].token).toBe(TOKEN_A);
		expect(selection.issues.map((i) => [i.entry, i.code])).toEqual([
			[2, 'MISSING_ID'],
			[3, 'DUPLICATE_TOKEN'],
			[4, 'BROAD_SCOPE'],
		]);
	});

	it('accepts nothing from a value it cannot read, without throwing', () => {
		expect(selectApiKeySeeds('[{"token": "x",}]').accepted).toEqual([]);
		expect(selectApiKeySeeds('42').accepted).toEqual([]);
	});

	it('matches checkApiKeySeeds without the tokens', () => {
		const raw = JSON.stringify([seed(TOKEN_A, {}), seed(TOKEN_B, { scopes: ['nope'] })]);
		const { accepted, ...check } = selectApiKeySeeds(raw);
		expect(check).toEqual(checkApiKeySeeds(raw));
		expect(accepted.map((s) => s.entry)).toEqual([1]);
	});
});
