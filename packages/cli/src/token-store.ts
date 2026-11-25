/**
 * @fileoverview Separate owner-only OAuth token store (`spec/authorization.md`, M9.4).
 *
 * Tokens are persisted in `tokens.json` beside the CLI config directory — never inside
 * `config.json`. Entries are keyed by canonical resource URI so a token obtained for one
 * server is never sent to another.
 *
 * Security hardening:
 * - POSIX: enforces a private (`0o700`) owner-owned directory on reads and writes, opens
 *   existing files with `O_NOFOLLOW` and checks ownership, regular-file type, and mode
 *   (`mode & 0o077 === 0`) on the opened descriptor before reading.
 * - Windows: applies a restricted DACL (current user SID, SYSTEM, Administrators) to an empty
 *   temporary file *before* writing token bytes, and verifies the effective SDDL DACL before
 *   reading `tokens.json` or `--client-secret-file`.
 * - Concurrency: serializes store mutations and cross-process token refreshes with an exclusive
 *   lockfile beside `tokens.json`, and supports conditional delete on matching refresh token.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	chmodSync,
	closeSync,
	constants,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getConfigPath } from './config.js';
import {
	canonicalResourceUri,
	isValidBearerToken,
	sameResource,
	type TokenAuthMethod,
} from './oauth-protocol.js';

export const TOKEN_STORE_VERSION = 1;
export const TOKEN_FILE_MODE = 0o600;
export const TOKEN_DIR_MODE = 0o700;

const SYSTEM_SID = 'S-1-5-18';
const ADMINISTRATORS_SID = 'S-1-5-32-544';
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 25;

let cachedWindowsUserSid: string | null = null;

export interface StoredOAuthToken {
	resource: string;
	issuer: string;
	tokenEndpoint: string;
	clientId: string;
	clientAuthMethod: TokenAuthMethod;
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
	scope?: string;
	updatedAt: string;
}

/** Public summary of a stored OAuth token: never contains accessToken or refreshToken. */
export interface StoredOAuthTokenSummary {
	resource: string;
	issuer: string;
	clientId: string;
	clientAuthMethod: TokenAuthMethod;
	scope?: string;
	expiresAt?: number;
	hasRefreshToken: boolean;
	updatedAt: string;
}

export interface TokenStoreFile {
	version: 1;
	entries: Record<string, StoredOAuthToken>;
}

/** Raised when the token store or a secret file fails a permission or integrity check. */
export class TokenStoreError extends Error {
	constructor(
		message: string,
		readonly suggestion: string
	) {
		super(message);
		this.name = 'TokenStoreError';
	}
}

/** Path to the CLI's separate OAuth token store (`tokens.json` beside `config.json`). */
export function getTokenStorePath(configPath?: string): string {
	let resolved = configPath;
	if (!resolved) {
		try {
			resolved = typeof getConfigPath === 'function' ? getConfigPath() : undefined;
		} catch {
			resolved = undefined;
		}
	}
	if (!resolved) {
		throw new TokenStoreError(
			'Could not determine the OAuth token store path.',
			'Verify CLI configuration is initialized.'
		);
	}
	return join(dirname(resolved), 'tokens.json');
}

/**
 * Return the default token store path, or `undefined` when `getConfigPath` is not available
 * (for example in unit tests that mock `config.js` without `getConfigPath`).
 */
export function tryDefaultTokenStorePath(): string | undefined {
	try {
		if (typeof getConfigPath !== 'function') return undefined;
		const configPath = getConfigPath();
		return typeof configPath === 'string' && configPath.length > 0
			? join(dirname(configPath), 'tokens.json')
			: undefined;
	} catch {
		return undefined;
	}
}

function system32Tool(exe: string): string {
	const root = process.env.SystemRoot;
	return root ? join(root, 'System32', exe) : exe;
}

function currentWindowsUserSid(): string {
	if (cachedWindowsUserSid) return cachedWindowsUserSid;
	const stdout = execFileSync(system32Tool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 10_000,
		windowsHide: true,
	});
	const match = /"(S-1-[0-9-]+)"/.exec(stdout.trim());
	if (!match?.[1]) {
		throw new TokenStoreError(
			'Could not determine the current Windows account SID to restrict token file permissions.',
			'Check that whoami.exe runs in this environment.'
		);
	}
	cachedWindowsUserSid = match[1];
	return cachedWindowsUserSid;
}

/** Restrict a Windows file's ACL to the current user, SYSTEM and Administrators only. */
export function restrictWindowsAcl(path: string): void {
	const sid = currentWindowsUserSid();
	try {
		execFileSync(
			system32Tool('icacls.exe'),
			[
				path,
				'/inheritance:r',
				'/grant:r',
				`*${sid}:(F)`,
				`*${SYSTEM_SID}:(F)`,
				`*${ADMINISTRATORS_SID}:(F)`,
			],
			{
				stdio: ['ignore', 'ignore', 'pipe'],
				timeout: 15_000,
				windowsHide: true,
			}
		);
	} catch {
		throw new TokenStoreError(
			`Could not restrict Windows permissions on ${path}.`,
			`Run icacls "${path}" /inheritance:r /grant:r "*${sid}:(F)" "*${SYSTEM_SID}:(F)" "*${ADMINISTRATORS_SID}:(F)".`
		);
	}
}

/**
 * Inspect a Windows file's SDDL DACL via `icacls.exe /save` and verify that only the current user
 * SID, `SYSTEM`, `Administrators`, or `OWNER RIGHTS` hold allow ACEs (`spec/authorization.md`, M9.4).
 */
export function assertWindowsPrivateAcl(path: string, label = 'Token store'): void {
	const sid = currentWindowsUserSid();
	const aclDump = join(tmpdir(), `.afd-acl-${randomBytes(8).toString('hex')}.tmp`);
	let sddl = '';
	try {
		execFileSync(system32Tool('icacls.exe'), [path, '/save', aclDump], {
			stdio: ['ignore', 'ignore', 'pipe'],
			timeout: 15_000,
			windowsHide: true,
		});
		const raw = readFileSync(aclDump, 'utf16le').replace(/^\uFEFF/, '');
		const lines = raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		sddl = lines[1] ?? '';
	} catch {
		throw new TokenStoreError(
			`${label} at ${path} could not be inspected for Windows ACL permissions.`,
			`Restrict permissions with: icacls "${path}" /inheritance:r /grant:r "*${sid}:(F)" "*${SYSTEM_SID}:(F)" "*${ADMINISTRATORS_SID}:(F)".`
		);
	} finally {
		try {
			unlinkSync(aclDump);
		} catch {
			// Ignore cleanup error if dump was never created.
		}
	}

	const allowedTrustees = new Set(['SY', 'BA', 'OW', SYSTEM_SID, ADMINISTRATORS_SID, sid]);

	// Parse ACE tuples `(ace_type;ace_flags;rights;object_guid;inherit_guid;account_sid)` inside `D:...`.
	const daclIndex = sddl.indexOf('D:');
	if (daclIndex < 0) {
		throw new TokenStoreError(
			`${label} at ${path} has no Windows DACL.`,
			`Restrict permissions with: icacls "${path}" /inheritance:r /grant:r "*${sid}:(F)" "*${SYSTEM_SID}:(F)" "*${ADMINISTRATORS_SID}:(F)".`
		);
	}
	const aceRegex = /\(([^)]+)\)/g;
	let sawAllowAce = false;
	const saclIndex = sddl.indexOf('S:', daclIndex + 2);
	const daclBody = saclIndex >= 0 ? sddl.slice(daclIndex, saclIndex) : sddl.slice(daclIndex);
	for (let match = aceRegex.exec(daclBody); match !== null; match = aceRegex.exec(daclBody)) {
		const parts = (match[1] ?? '').split(';');
		if (parts.length < 6) continue;
		const aceType = parts[0];
		const trustee = parts[5] ?? '';
		// Only allow ACEs (`A`, `OA`, `XA`, `ZA`) grant access; deny ACEs (`D`) restrict access.
		if (aceType === 'A' || aceType === 'OA' || aceType === 'XA' || aceType === 'ZA') {
			sawAllowAce = true;
			if (!allowedTrustees.has(trustee)) {
				throw new TokenStoreError(
					`${label} at ${path} has overly broad Windows permissions (accessible to ${trustee}).`,
					`Run: icacls "${path}" /inheritance:r /grant:r "*${sid}:(F)" "*${SYSTEM_SID}:(F)" "*${ADMINISTRATORS_SID}:(F)".`
				);
			}
		}
	}
	if (!sawAllowAce) {
		throw new TokenStoreError(
			`${label} at ${path} has an empty or unreadable Windows DACL.`,
			`Run: icacls "${path}" /inheritance:r /grant:r "*${sid}:(F)" "*${SYSTEM_SID}:(F)" "*${ADMINISTRATORS_SID}:(F)".`
		);
	}
}

/** Verify that a directory is a real directory (never a symlink) and owner-only on POSIX. */
function assertPrivateDirectory(dir: string, label: string): void {
	let stats: ReturnType<typeof lstatSync>;
	try {
		stats = lstatSync(dir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw new TokenStoreError(
			`${label} directory ${dir} could not be inspected.`,
			`Check permissions on ${dir}.`
		);
	}
	if (stats.isSymbolicLink() || !stats.isDirectory()) {
		throw new TokenStoreError(
			`${label} directory ${dir} must be a real directory, not a symlink.`,
			`Fix ${dir} and try again.`
		);
	}
	if (process.platform !== 'win32') {
		if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
			throw new TokenStoreError(
				`${label} directory ${dir} is not owned by the current user.`,
				`Ensure ${dir} is owned by you with mode 700.`
			);
		}
		if ((stats.mode & 0o077) !== 0) {
			throw new TokenStoreError(
				`${label} directory ${dir} has overly broad permissions (accessible to group/others).`,
				`Run "chmod 700 ${dir}" and try again.`
			);
		}
	}
}

/**
 * Verify that an existing file is a regular file (never a symlink) and restricted to its owner:
 * - POSIX: owned by current UID and `mode & 0o077 === 0`
 * - Windows: SDDL DACL permits only current user SID, SYSTEM, and Administrators
 */
export function assertPrivateRegularFile(path: string, label = 'Token store'): void {
	let stats: ReturnType<typeof lstatSync>;
	try {
		stats = lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw new TokenStoreError(
			`${label} at ${path} could not be inspected.`,
			`Check permissions on ${path}.`
		);
	}
	if (stats.isSymbolicLink() || !stats.isFile()) {
		throw new TokenStoreError(
			`${label} at ${path} must be a regular file, not a symlink or directory.`,
			`Remove ${path} and re-run the command.`
		);
	}
	if (process.platform === 'win32') {
		assertWindowsPrivateAcl(path, label);
	} else {
		if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
			throw new TokenStoreError(
				`${label} at ${path} is not owned by the current user.`,
				`Ensure ${path} is owned by you with mode 600.`
			);
		}
		if ((stats.mode & 0o077) !== 0) {
			throw new TokenStoreError(
				`${label} at ${path} has overly broad permissions (readable or writable by group/others).`,
				`Run "chmod 600 ${path}" and try again.`
			);
		}
	}
}

/**
 * Open an existing credential file without following symlinks (`O_NOFOLLOW` where available),
 * verify type, ownership, and permissions directly on the open descriptor (POSIX) and ACL
 * (Windows), and return its UTF-8 content. Returns `undefined` when `missingOk` and `ENOENT`.
 */
function readPrivateRegularFile(
	filePath: string,
	label: string,
	missingOk: boolean
): string | undefined {
	// Fast pre-check for symlink (especially on Windows where O_NOFOLLOW is not defined).
	try {
		const pre = lstatSync(filePath);
		if (pre.isSymbolicLink() || !pre.isFile()) {
			throw new TokenStoreError(
				`${label} at ${filePath} must be a regular file, not a symlink or directory.`,
				`Remove ${filePath} or point to a regular owner-only file.`
			);
		}
	} catch (error) {
		if (error instanceof TokenStoreError) throw error;
		if ((error as NodeJS.ErrnoException).code === 'ENOENT' && missingOk) return undefined;
		throw new TokenStoreError(
			`${label} at ${filePath} cannot be read.`,
			`Check permissions on ${filePath}.`
		);
	}

	if (process.platform === 'win32') {
		assertWindowsPrivateAcl(filePath, label);
	}

	const openFlags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
	let fd: number;
	try {
		fd = openSync(filePath, openFlags);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' && missingOk) return undefined;
		if (code === 'ELOOP') {
			throw new TokenStoreError(
				`${label} at ${filePath} must be a regular file, not a symlink.`,
				`Remove the symlink at ${filePath} and re-run.`
			);
		}
		throw new TokenStoreError(
			`${label} at ${filePath} cannot be read.`,
			`Check permissions on ${filePath}.`
		);
	}

	try {
		const stats = fstatSync(fd);
		if (!stats.isFile()) {
			throw new TokenStoreError(
				`${label} at ${filePath} must be a regular file, not a symlink or directory.`,
				`Remove ${filePath} and re-run.`
			);
		}
		if (process.platform !== 'win32') {
			if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
				throw new TokenStoreError(
					`${label} at ${filePath} is not owned by the current user.`,
					`Ensure ${filePath} is owned by you with mode 600.`
				);
			}
			if ((stats.mode & 0o077) !== 0) {
				throw new TokenStoreError(
					`${label} at ${filePath} has overly broad permissions (readable or writable by group/others).`,
					`Run "chmod 600 ${filePath}" and try again.`
				);
			}
		}
		return readFileSync(fd, 'utf8');
	} catch (error) {
		if (error instanceof TokenStoreError) throw error;
		throw new TokenStoreError(
			`${label} at ${filePath} cannot be read.`,
			`Check permissions on ${filePath}.`
		);
	} finally {
		try {
			closeSync(fd);
		} catch {
			// Ignore close error.
		}
	}
}

function isValidStoredEntry(value: unknown): value is StoredOAuthToken {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const entry = value as Record<string, unknown>;
	if (
		typeof entry.resource !== 'string' ||
		typeof entry.issuer !== 'string' ||
		typeof entry.tokenEndpoint !== 'string' ||
		typeof entry.clientId !== 'string' ||
		!isValidBearerToken(entry.accessToken) ||
		typeof entry.updatedAt !== 'string'
	) {
		return false;
	}
	if (
		entry.clientAuthMethod !== 'none' &&
		entry.clientAuthMethod !== 'client_secret_basic' &&
		entry.clientAuthMethod !== 'client_secret_post'
	) {
		return false;
	}
	if (
		entry.refreshToken !== undefined &&
		(typeof entry.refreshToken !== 'string' || entry.refreshToken.length === 0)
	) {
		return false;
	}
	if (
		entry.expiresAt !== undefined &&
		(typeof entry.expiresAt !== 'number' || !Number.isFinite(entry.expiresAt))
	) {
		return false;
	}
	if (entry.scope !== undefined && typeof entry.scope !== 'string') return false;
	return true;
}

function lockPathFor(storePath: string): string {
	return `${storePath}.lock`;
}

function tryAcquireLockOnce(lockPath: string): boolean {
	try {
		const fd = openSync(
			lockPath,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
			TOKEN_FILE_MODE
		);
		try {
			writeSync(fd, `${process.pid}:${Date.now()}\n`);
		} finally {
			closeSync(fd);
		}
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
			throw new TokenStoreError(
				`Could not acquire lock for OAuth token store at ${lockPath}.`,
				`Check directory permissions for ${dirname(lockPath)}.`
			);
		}
		// Reclaim a stale lock left behind by a crashed process.
		try {
			const stat = lstatSync(lockPath);
			if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
				unlinkSync(lockPath);
			}
		} catch {
			// Lock disappeared or cannot be inspected; retry will resolve.
		}
		return false;
	}
}

function releaseLock(lockPath: string): void {
	try {
		unlinkSync(lockPath);
	} catch {
		// Ignore if already removed.
	}
}

function sleepSync(ms: number): void {
	const arr = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(arr, 0, 0, ms);
}

/** Run `fn` while holding an exclusive cross-process lock beside `storePath` (synchronous). */
export function withTokenStoreLock<T>(storePath: string, fn: () => T): T {
	const dir = dirname(storePath);
	mkdirSync(dir, { recursive: true, mode: TOKEN_DIR_MODE });
	assertPrivateDirectory(dir, 'OAuth token store');

	const lockPath = lockPathFor(storePath);
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	while (!tryAcquireLockOnce(lockPath)) {
		if (Date.now() >= deadline) {
			throw new TokenStoreError(
				`Timed out waiting for OAuth token store lock at ${lockPath}.`,
				`If no other afd process is running, remove ${lockPath} and retry.`
			);
		}
		sleepSync(LOCK_RETRY_MS);
	}
	try {
		return fn();
	} finally {
		releaseLock(lockPath);
	}
}

/** Run async `fn` while holding an exclusive cross-process lock beside `storePath`. */
export async function withTokenStoreLockAsync<T>(
	storePath: string,
	fn: () => Promise<T>
): Promise<T> {
	const dir = dirname(storePath);
	mkdirSync(dir, { recursive: true, mode: TOKEN_DIR_MODE });
	assertPrivateDirectory(dir, 'OAuth token store');

	const lockPath = lockPathFor(storePath);
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	while (!tryAcquireLockOnce(lockPath)) {
		if (Date.now() >= deadline) {
			throw new TokenStoreError(
				`Timed out waiting for OAuth token store lock at ${lockPath}.`,
				`If no other afd process is running, remove ${lockPath} and retry.`
			);
		}
		await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
	}
	try {
		return await fn();
	} finally {
		releaseLock(lockPath);
	}
}

/** Read the token store, returning an empty store when `tokens.json` does not yet exist. */
export function readTokenStore(storePath = getTokenStorePath()): TokenStoreFile {
	assertPrivateDirectory(dirname(storePath), 'OAuth token store');
	const rawText = readPrivateRegularFile(storePath, 'OAuth token store', true);
	if (rawText === undefined) {
		return { version: TOKEN_STORE_VERSION, entries: Object.create(null) };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		throw new TokenStoreError(
			`OAuth token store at ${storePath} is not valid JSON.`,
			`Remove ${storePath} and run "afd auth login" again.`
		);
	}
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		Array.isArray(parsed) ||
		(parsed as Record<string, unknown>).version !== TOKEN_STORE_VERSION
	) {
		throw new TokenStoreError(
			`OAuth token store at ${storePath} has an unsupported format or version.`,
			`Remove ${storePath} and run "afd auth login" again.`
		);
	}

	const rawEntries = (parsed as Record<string, unknown>).entries;
	const entries: Record<string, StoredOAuthToken> = Object.create(null);
	if (typeof rawEntries === 'object' && rawEntries !== null && !Array.isArray(rawEntries)) {
		for (const [key, value] of Object.entries(rawEntries)) {
			if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
			if (isValidStoredEntry(value) && sameResource(key, value.resource)) {
				entries[key] = value;
			}
		}
	}
	return { version: TOKEN_STORE_VERSION, entries };
}

/** Atomically write `store` to `storePath` with owner-only permissions established before writing bytes. */
export function writeTokenStore(store: TokenStoreFile, storePath = getTokenStorePath()): void {
	const dir = dirname(storePath);
	mkdirSync(dir, { recursive: true, mode: TOKEN_DIR_MODE });
	assertPrivateDirectory(dir, 'OAuth token store');
	assertPrivateRegularFile(storePath, 'OAuth token store');

	const tempPath = join(dir, `.tokens.${randomBytes(8).toString('hex')}.tmp`);
	let fd: number | undefined;
	try {
		// Create empty exclusive file first, establish owner-only permissions/ACL *before* writing bytes.
		fd = openSync(
			tempPath,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
			TOKEN_FILE_MODE
		);
		if (process.platform === 'win32') {
			closeSync(fd);
			fd = undefined;
			restrictWindowsAcl(tempPath);
			fd = openSync(tempPath, constants.O_WRONLY);
		} else {
			chmodSync(tempPath, TOKEN_FILE_MODE);
		}
		const payload = `${JSON.stringify({ version: TOKEN_STORE_VERSION, entries: store.entries }, null, 2)}\n`;
		writeSync(fd, payload, 0, 'utf8');
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;

		renameSync(tempPath, storePath);
	} catch (error) {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				// Ignore secondary close error.
			}
		}
		try {
			unlinkSync(tempPath);
		} catch {
			// Ignore if temp file was never created or already renamed.
		}
		if (error instanceof TokenStoreError) throw error;
		throw new TokenStoreError(
			`Could not write OAuth token store at ${storePath}.`,
			`Check directory permissions for ${dir}.`
		);
	}
}

/** Look up the stored OAuth token for `serverUrl` (keyed by canonical resource URI). */
export function getStoredToken(
	serverUrl: string,
	storePath = getTokenStorePath()
): StoredOAuthToken | undefined {
	let key: string;
	try {
		key = canonicalResourceUri(serverUrl);
	} catch {
		return undefined;
	}
	const store = readTokenStore(storePath);
	return store.entries[key];
}

/** Persist an OAuth token entry under its canonical resource URI (serialized across processes). */
export function saveStoredToken(entry: StoredOAuthToken, storePath = getTokenStorePath()): void {
	const key = canonicalResourceUri(entry.resource);
	withTokenStoreLock(storePath, () => {
		const store = readTokenStore(storePath);
		store.entries[key] = { ...entry, resource: key };
		writeTokenStore(store, storePath);
	});
}

/** Persist an OAuth token entry when the caller already holds the store lock. */
export function saveStoredTokenUnlocked(
	entry: StoredOAuthToken,
	storePath = getTokenStorePath()
): void {
	const key = canonicalResourceUri(entry.resource);
	const store = readTokenStore(storePath);
	store.entries[key] = { ...entry, resource: key };
	writeTokenStore(store, storePath);
}

/** Remove the stored OAuth token for `serverUrl`. Returns true if an entry existed. */
export function deleteStoredToken(serverUrl: string, storePath = getTokenStorePath()): boolean {
	const key = canonicalResourceUri(serverUrl);
	return withTokenStoreLock(storePath, () => {
		const store = readTokenStore(storePath);
		if (!(key in store.entries)) return false;
		delete store.entries[key];
		writeTokenStore(store, storePath);
		return true;
	});
}

/**
 * Remove the stored OAuth token for `serverUrl` ONLY if its stored `refreshToken` still equals
 * `expectedRefreshToken` (caller already holds the store lock). Prevents a stale refresh failure
 * from clobbering a token rotated by another process.
 */
export function deleteStoredTokenIfRefreshMatchesUnlocked(
	serverUrl: string,
	expectedRefreshToken: string,
	storePath = getTokenStorePath()
): boolean {
	const key = canonicalResourceUri(serverUrl);
	const store = readTokenStore(storePath);
	const current = store.entries[key];
	if (!current || current.refreshToken !== expectedRefreshToken) return false;
	delete store.entries[key];
	writeTokenStore(store, storePath);
	return true;
}

/** Remove every stored OAuth token. Returns the number of removed entries. */
export function clearStoredTokens(storePath = getTokenStorePath()): number {
	return withTokenStoreLock(storePath, () => {
		const store = readTokenStore(storePath);
		const count = Object.keys(store.entries).length;
		if (count === 0) return 0;
		writeTokenStore({ version: TOKEN_STORE_VERSION, entries: Object.create(null) }, storePath);
		return count;
	});
}

/** Return secret-free summaries of all stored tokens. */
export function listStoredTokens(storePath = getTokenStorePath()): StoredOAuthTokenSummary[] {
	const store = readTokenStore(storePath);
	return Object.values(store.entries)
		.map((entry) => ({
			resource: entry.resource,
			issuer: entry.issuer,
			clientId: entry.clientId,
			clientAuthMethod: entry.clientAuthMethod,
			...(entry.scope !== undefined ? { scope: entry.scope } : {}),
			...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
			hasRefreshToken: Boolean(entry.refreshToken),
			updatedAt: entry.updatedAt,
		}))
		.sort((a, b) => a.resource.localeCompare(b.resource));
}

/**
 * Read a client secret from an owner-only regular file (`--client-secret-file`).
 * Strips at most one trailing line break; never echoes the secret in any error.
 */
export function readSecretFile(filePath: string): string {
	const raw = readPrivateRegularFile(filePath, 'Client secret file', false);
	const value = (raw ?? '').replace(/\r?\n$/, '');
	if (!value) {
		throw new TokenStoreError(
			`Client secret file at ${filePath} is empty.`,
			'Write the OAuth client secret to the file or use AFD_OAUTH_CLIENT_SECRET.'
		);
	}
	return value;
}
