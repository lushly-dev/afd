/**
 * Hosted API key seeds: the scopes the API enforces, token hashing, and the
 * check of `VIOLET_API_KEYS_JSON` that both `apikeys.check` and the API use.
 * The API seeds only the entries this check accepts (`packages/api/src/env.ts`)
 * and upserts them into Neon one at a time (`storage/neon.ts`).
 */

import { createHash, randomBytes } from 'node:crypto';

/** Resource scopes the hosted API checks on its routes. */
export const API_KEY_SCOPES = {
	nodesRead: 'nodes:read',
	nodesWrite: 'nodes:write',
	tokensRead: 'tokens:read',
	tokensWrite: 'tokens:write',
	exportRead: 'export:read',
	analyzeRead: 'analyze:read',
	/** Record rule check snapshots (#117) */
	analyzeWrite: 'analyze:write',
	auditRead: 'audit:read',
} as const;

/** Broad scopes the API also accepts: every read route, every write route, or everything. */
export const BROAD_API_KEY_SCOPES = ['read', 'write', '*'] as const;

export const KNOWN_API_KEY_SCOPES: readonly string[] = [
	...Object.values(API_KEY_SCOPES),
	...BROAD_API_KEY_SCOPES,
];

/** The literal key the API accepts in development; never a seed. */
export const DEV_API_KEY_TOKEN = 'violet-dev-key';

/** Tokens shorter than this are easy to guess; `apikeys.create` makes 64 hex characters. */
export const MIN_API_KEY_TOKEN_LENGTH = 32;

/** Key ids go into SQL and logs, so keep them to a safe, readable alphabet. */
export const API_KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Hex SHA-256 of a token: the `token_hash` the API looks keys up by. */
export function hashApiKeyToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** A new random token: 32 bytes as 64 hex characters. */
export function generateApiKeyToken(): string {
	return randomBytes(32).toString('hex');
}

export type SeedIssueSeverity = 'error' | 'warning';

export interface SeedIssue {
	severity: SeedIssueSeverity;
	code: string;
	message: string;
	/** Position of the entry (1-based), when the issue belongs to one. */
	entry?: number;
	/** The entry's key id, when it has one. Token values are never reported. */
	keyId?: string;
}

export interface SeedKeySummary {
	entry: number;
	id?: string;
	name?: string;
	scopes: string[];
	rateLimit?: number;
	revokedAt?: string;
}

export interface SeedCheck {
	keys: SeedKeySummary[];
	issues: SeedIssue[];
}

/** An entry without errors, with its token: what the API seeds. Never return it from a command. */
export interface AcceptedSeed {
	entry: number;
	token: string;
	data: Record<string, unknown>;
}

export interface SeedSelection extends SeedCheck {
	/** Entries without errors, in order. Empty when the value cannot be read at all. */
	accepted: AcceptedSeed[];
}

interface RawSeed {
	entry: number;
	token: unknown;
	data: unknown;
}

/**
 * Check a `VIOLET_API_KEYS_JSON` value without connecting to anything.
 *
 * Errors are problems that make the API skip an entry (or, for unreadable
 * JSON, every entry) and report it on `/api/v1/health`. Warnings are legal but
 * probably unintended. Issues name entries by position and key id, never by
 * token.
 */
export function checkApiKeySeeds(raw: string): SeedCheck {
	const { keys, issues } = selectApiKeySeeds(raw);
	return { keys, issues };
}

/**
 * Check a `VIOLET_API_KEYS_JSON` value and also return the entries without
 * errors, tokens included. The hosted API seeds exactly these, so one bad
 * entry cannot block the others.
 */
export function selectApiKeySeeds(raw: string): SeedSelection {
	const issues: SeedIssue[] = [];
	const keys: SeedKeySummary[] = [];
	const seeds = parseSeedList(raw, issues);
	if (!seeds) return { keys, issues, accepted: [] };

	const firstById = new Map<string, number>();
	const firstByToken = new Map<string, number>();

	for (const seed of seeds) {
		const summary = checkSeed(seed, issues);
		if (!summary) continue;

		const repeat = (seen: Map<string, number>, value: string, code: string, message: string) => {
			const first = seen.get(value);
			if (first === undefined) {
				seen.set(value, seed.entry);
				return;
			}
			issues.push({
				severity: 'error',
				code,
				message: message.replace('{first}', String(first)),
				entry: seed.entry,
				keyId: summary.id,
			});
		};
		if (typeof seed.token === 'string') {
			repeat(
				firstByToken,
				hashApiKeyToken(seed.token),
				'DUPLICATE_TOKEN',
				'Same token as entry {first}. Token hashes are unique, so the API skips this entry.',
			);
		}
		if (summary.id) {
			repeat(
				firstById,
				summary.id,
				'DUPLICATE_ID',
				`Key id '${summary.id}' is also entry {first}. The API skips this entry and keeps the first.`,
			);
		}
		keys.push(summary);
	}

	if (seeds.length === 0 && issues.length === 0) {
		issues.push({
			severity: 'warning',
			code: 'NO_KEYS',
			message: 'No keys. Without Neon the API has no key store and protected routes return 500.',
		});
	}

	const rejected = new Set(
		issues.filter((issue) => issue.severity === 'error').map((issue) => issue.entry),
	);
	const accepted = seeds
		.filter((seed) => !rejected.has(seed.entry))
		.map((seed) => ({
			entry: seed.entry,
			token: seed.token as string,
			data: seed.data as Record<string, unknown>,
		}));

	return { keys, issues, accepted };
}

/** The entries the API would read, in either accepted shape; null when it cannot read any. */
function parseSeedList(raw: string, issues: SeedIssue[]): RawSeed[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		issues.push({
			severity: 'error',
			code: 'INVALID_JSON',
			message: 'Not valid JSON. The API seeds no keys from it, and health reports misconfigured.',
		});
		return null;
	}

	if (Array.isArray(parsed)) {
		const seeds: RawSeed[] = [];
		parsed.forEach((value, index) => {
			const entry = index + 1;
			if (value && typeof value === 'object' && 'token' in value && 'data' in value) {
				seeds.push({ entry, token: value.token, data: value.data });
				return;
			}
			issues.push({
				severity: 'error',
				code: 'INVALID_ENTRY',
				message: 'Entry is not a { "token": ..., "data": { ... } } object; the API skips it.',
				entry,
			});
		});
		return seeds;
	}

	if (parsed && typeof parsed === 'object') {
		return Object.entries(parsed).map(([token, data], index) => ({
			entry: index + 1,
			token,
			data,
		}));
	}

	issues.push({
		severity: 'error',
		code: 'INVALID_SHAPE',
		message:
			'Expected an array of { token, data } entries or an object mapping token to data. The API seeds no keys from it.',
	});
	return null;
}

type AddIssue = (severity: SeedIssueSeverity, code: string, message: string) => void;

function checkSeed(seed: RawSeed, issues: SeedIssue[]): SeedKeySummary | null {
	const { entry } = seed;
	if (!seed.data || typeof seed.data !== 'object' || Array.isArray(seed.data)) {
		issues.push({
			severity: 'error',
			code: 'INVALID_ENTRY',
			message: '"data" is not an object; the API skips this entry.',
			entry,
		});
		return null;
	}

	const data = seed.data as Record<string, unknown>;
	const id = typeof data.id === 'string' && data.id.trim() ? data.id : undefined;
	const add: AddIssue = (severity, code, message) =>
		issues.push({ severity, code, message, entry, keyId: id });

	checkToken(seed.token, add);
	checkRequiredFields(data, id, add);
	const scopes = checkScopes(data.scopes, add);
	const rateLimit = checkRateLimit(data.rateLimit, add);

	let revokedAt: string | undefined;
	if (data.revokedAt !== undefined && data.revokedAt !== null) {
		revokedAt = String(data.revokedAt);
		add(
			'warning',
			'REVOKED_AT_IGNORED',
			'"data.revokedAt" only applies when the key is first inserted; seed upserts never change revoked_at. Revoke an existing key with SQL (see SETUP.md, Credential Recovery).',
		);
	}

	return {
		entry,
		id,
		name: typeof data.name === 'string' ? data.name : undefined,
		scopes,
		rateLimit,
		revokedAt,
	};
}

function checkToken(token: unknown, add: AddIssue): void {
	if (typeof token !== 'string' || token.length === 0) {
		add('error', 'MISSING_TOKEN', '"token" must be a non-empty string; the API skips this entry.');
	} else if (token === DEV_API_KEY_TOKEN) {
		add(
			'error',
			'DEV_KEY',
			'Uses the built-in development key, which anyone can read in the source; the API skips this entry. Generate a token with apikeys.create.',
		);
	} else if (token.length < MIN_API_KEY_TOKEN_LENGTH) {
		add(
			'warning',
			'SHORT_TOKEN',
			`Token is shorter than ${MIN_API_KEY_TOKEN_LENGTH} characters. Generate one with apikeys.create.`,
		);
	}
}

/** id, name and createdAt: the api_keys columns the upsert cannot fill in. */
function checkRequiredFields(
	data: Record<string, unknown>,
	id: string | undefined,
	add: AddIssue,
): void {
	if (!id) {
		add(
			'error',
			'MISSING_ID',
			'"data.id" is required (it is the api_keys key_id); the API skips this entry.',
		);
	} else if (!API_KEY_ID_PATTERN.test(id)) {
		add(
			'warning',
			'UNUSUAL_ID',
			'Key ids should be lowercase letters, digits, ".", "_" or "-" (at most 64), such as consumer-preview.',
		);
	}

	if (typeof data.name !== 'string' || data.name.trim() === '') {
		add(
			'error',
			'MISSING_NAME',
			'"data.name" is required by the api_keys table; the API skips this entry.',
		);
	}

	if (typeof data.createdAt !== 'string' || Number.isNaN(Date.parse(data.createdAt))) {
		add(
			'error',
			'INVALID_CREATED_AT',
			'"data.createdAt" must be an ISO date string (the api_keys table requires it); the API skips this entry.',
		);
	}
}

function checkScopes(value: unknown, add: AddIssue): string[] {
	if (!Array.isArray(value) || value.some((scope) => typeof scope !== 'string')) {
		add(
			'error',
			'INVALID_SCOPES',
			'"data.scopes" must be an array of scope strings; the API skips this entry.',
		);
		return [];
	}

	const scopes = [...new Set(value as string[])];
	const quote = (list: string[]) => list.map((scope) => `'${scope}'`).join(', ');
	const unknown = scopes.filter((scope) => !KNOWN_API_KEY_SCOPES.includes(scope));
	if (unknown.length > 0) {
		add(
			'error',
			'UNKNOWN_SCOPE',
			`Unknown scope(s) ${quote(unknown)}; the API skips this entry. Known: ${KNOWN_API_KEY_SCOPES.join(', ')}.`,
		);
	}
	if (scopes.length === 0) {
		add('warning', 'NO_SCOPES', 'No scopes: the key authenticates but every route returns 403.');
	}
	const broad = scopes.filter((scope) =>
		(BROAD_API_KEY_SCOPES as readonly string[]).includes(scope),
	);
	if (broad.length > 0) {
		add(
			'warning',
			'BROAD_SCOPE',
			`Broad scope(s) ${quote(broad)}. Prefer resource scopes such as tokens:read and export:read.`,
		);
	}
	return scopes;
}

function checkRateLimit(value: unknown, add: AddIssue): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
	add(
		'error',
		'INVALID_RATE_LIMIT',
		'"data.rateLimit" must be a positive whole number; the API skips this entry.',
	);
	return undefined;
}
