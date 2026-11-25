import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	clearStoredTokens,
	deleteStoredToken,
	getStoredToken,
	getTokenStorePath,
	listStoredTokens,
	readSecretFile,
	readTokenStore,
	restrictWindowsAcl,
	type StoredOAuthToken,
	saveStoredToken,
	TOKEN_FILE_MODE,
	TokenStoreError,
} from './token-store.js';

function makePrivateOnCurrentPlatform(filePath: string): void {
	if (process.platform === 'win32') {
		restrictWindowsAcl(filePath);
	}
}

function makeEntry(overrides: Partial<StoredOAuthToken> = {}): StoredOAuthToken {
	return {
		resource: 'https://loam.example.com/mcp',
		issuer: 'https://auth.example.com',
		tokenEndpoint: 'https://auth.example.com/oauth2/token',
		clientId: 'https://afd.dev/oauth/cli-client.json',
		clientAuthMethod: 'none',
		accessToken: 'eyJhbGciOiJFZERTQSJ9.access-token.sig',
		refreshToken: 'rt-secret-refresh-token',
		expiresAt: 1_900_000_000,
		scope: 'loam:read loam:write offline_access',
		updatedAt: '2026-11-24T00:00:00.000Z',
		...overrides,
	};
}

describe('OAuth token store', () => {
	let dir: string;
	let storePath: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'afd-cli-tokens-'));
		storePath = getTokenStorePath(join(dir, 'config.json'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('stores tokens in a separate tokens.json file outside config.json', async () => {
		const configPath = join(dir, 'config.json');
		await writeFile(configPath, JSON.stringify({ serverUrl: 'https://loam.example.com/mcp' }));

		expect(storePath).toBe(join(dir, 'tokens.json'));
		expect(storePath).not.toBe(configPath);

		const entry = makeEntry();
		saveStoredToken(entry, storePath);

		const configText = await readFile(configPath, 'utf8');
		expect(configText).not.toContain(entry.accessToken);
		expect(configText).not.toContain(entry.refreshToken);

		expect(getStoredToken('HTTPS://LOAM.EXAMPLE.COM/mcp?ignored=1#frag', storePath)).toEqual(entry);
	});

	it('isolates tokens by canonical resource URI, ignores mismatched keys, and never leaks tokens in summaries', async () => {
		const a = makeEntry({
			resource: 'https://a.example.com/mcp',
			accessToken: 'tok-a-secret',
			refreshToken: 'rt-a-secret',
		});
		const b = makeEntry({
			resource: 'https://b.example.com/mcp',
			accessToken: 'tok-b-secret',
			refreshToken: undefined,
		});
		saveStoredToken(a, storePath);
		saveStoredToken(b, storePath);

		expect(getStoredToken('https://a.example.com/mcp', storePath)?.accessToken).toBe(
			'tok-a-secret'
		);
		expect(getStoredToken('https://b.example.com/mcp', storePath)?.accessToken).toBe(
			'tok-b-secret'
		);
		expect(getStoredToken('https://c.example.com/mcp', storePath)).toBeUndefined();
		expect(getStoredToken('not a url', storePath)).toBeUndefined();

		const summaries = listStoredTokens(storePath);
		expect(summaries).toHaveLength(2);
		expect(summaries[0]).toMatchObject({
			resource: 'https://a.example.com/mcp',
			hasRefreshToken: true,
		});
		expect(summaries[1]).toMatchObject({
			resource: 'https://b.example.com/mcp',
			hasRefreshToken: false,
		});
		const serialized = JSON.stringify(summaries);
		expect(serialized).not.toContain('tok-a-secret');
		expect(serialized).not.toContain('rt-a-secret');
		expect(serialized).not.toContain('tok-b-secret');

		// Tampered entry whose key does not match entry.resource is ignored on read.
		const tampered = {
			version: 1,
			entries: {
				'https://victim.example.com/mcp': makeEntry({ resource: 'https://other.example.com/mcp' }),
			},
		};
		await writeFile(storePath, JSON.stringify(tampered), { mode: TOKEN_FILE_MODE });
		makePrivateOnCurrentPlatform(storePath);
		expect(getStoredToken('https://victim.example.com/mcp', storePath)).toBeUndefined();
	});

	it('deletes individual entries and clears all entries', () => {
		saveStoredToken(makeEntry({ resource: 'https://a.example.com/mcp' }), storePath);
		saveStoredToken(makeEntry({ resource: 'https://b.example.com/mcp' }), storePath);

		expect(deleteStoredToken('https://a.example.com/mcp', storePath)).toBe(true);
		expect(deleteStoredToken('https://a.example.com/mcp', storePath)).toBe(false);
		expect(listStoredTokens(storePath)).toHaveLength(1);

		expect(clearStoredTokens(storePath)).toBe(1);
		expect(clearStoredTokens(storePath)).toBe(0);
		expect(listStoredTokens(storePath)).toEqual([]);
	});

	it('refuses corrupted or unsupported-version token files', async () => {
		await writeFile(storePath, 'not-json', { mode: TOKEN_FILE_MODE });
		makePrivateOnCurrentPlatform(storePath);
		expect(() => readTokenStore(storePath)).toThrow(TokenStoreError);

		await writeFile(storePath, JSON.stringify({ version: 99, entries: {} }), {
			mode: TOKEN_FILE_MODE,
		});
		makePrivateOnCurrentPlatform(storePath);
		expect(() => readTokenStore(storePath)).toThrow(TokenStoreError);
	});

	it('reads client secret files and strips one trailing newline without echoing secret on error', async () => {
		const secretPath = join(dir, 'client.secret');
		await writeFile(secretPath, 'super-secret-value\r\n', { mode: 0o600 });
		makePrivateOnCurrentPlatform(secretPath);
		expect(readSecretFile(secretPath)).toBe('super-secret-value');

		const emptyPath = join(dir, 'empty.secret');
		await writeFile(emptyPath, '\n', { mode: 0o600 });
		makePrivateOnCurrentPlatform(emptyPath);
		expect(() => readSecretFile(emptyPath)).toThrow(TokenStoreError);
		expect(() => readSecretFile(join(dir, 'missing.secret'))).toThrow(TokenStoreError);
	});

	it.skipIf(process.platform === 'win32')(
		'enforces 0600 mode and 0700 directory on POSIX and refuses group/world-readable or symlinked files',
		async () => {
			saveStoredToken(makeEntry(), storePath);
			expect((await stat(storePath)).mode & 0o777).toBe(0o600);

			await chmod(storePath, 0o644);
			let fileErr: unknown;
			try {
				readTokenStore(storePath);
			} catch (err) {
				fileErr = err;
			}
			expect(fileErr).toBeInstanceOf(TokenStoreError);
			expect((fileErr as TokenStoreError).message).toMatch(/overly broad permissions/);
			expect((fileErr as TokenStoreError).suggestion).toMatch(/chmod 600/);
			await chmod(storePath, 0o600);

			// Group-readable parent directory is refused on read, and restrictConfigFile narrows it to 0700.
			await chmod(dir, 0o755);
			let dirErr: unknown;
			try {
				readTokenStore(storePath);
			} catch (err) {
				dirErr = err;
			}
			expect(dirErr).toBeInstanceOf(TokenStoreError);
			expect((dirErr as TokenStoreError).message).toMatch(/overly broad permissions/);
			expect((dirErr as TokenStoreError).suggestion).toMatch(/chmod 700/);
			const { restrictConfigFile } = await import('./config.js');
			restrictConfigFile(join(dir, 'config.json'));
			expect((await stat(dir)).mode & 0o777).toBe(0o700);
			expect(readTokenStore(storePath).entries['https://loam.example.com/mcp']).toBeDefined();

			const linkPath = join(dir, 'link-tokens.json');
			const targetPath = join(dir, 'real-tokens.json');
			await writeFile(targetPath, JSON.stringify({ version: 1, entries: {} }), { mode: 0o600 });
			await symlink(targetPath, linkPath);
			expect(() => readTokenStore(linkPath)).toThrow(/regular file/);

			const looseSecret = join(dir, 'loose.secret');
			await writeFile(looseSecret, 'secret', { mode: 0o644 });
			expect(() => readSecretFile(looseSecret)).toThrow(/overly broad permissions/);
		}
	);

	it.skipIf(process.platform !== 'win32')(
		'enforces restricted Windows ACLs and refuses broadly accessible token and secret files',
		async () => {
			saveStoredToken(makeEntry(), storePath);
			// Reading the file we just wrote succeeds under its restricted ACL.
			expect(readTokenStore(storePath).entries['https://loam.example.com/mcp']).toBeDefined();

			// Granting Everyone (S-1-1-0) read access must be refused on read.
			const icacls = process.env.SystemRoot
				? join(process.env.SystemRoot, 'System32', 'icacls.exe')
				: 'icacls.exe';
			execFileSync(icacls, [storePath, '/grant', '*S-1-1-0:(R)'], {
				stdio: 'ignore',
				windowsHide: true,
			});
			expect(() => readTokenStore(storePath)).toThrow(/overly broad Windows permissions/);

			const looseSecret = join(dir, 'loose.secret');
			await writeFile(looseSecret, 'secret');
			execFileSync(icacls, [looseSecret, '/grant', '*S-1-1-0:(R)'], {
				stdio: 'ignore',
				windowsHide: true,
			});
			expect(() => readSecretFile(looseSecret)).toThrow(/overly broad Windows permissions/);
		}
	);
});
