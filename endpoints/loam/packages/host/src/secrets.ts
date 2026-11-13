/**
 * @fileoverview The server's secrets (phase 6 specification, section 13, and 3.2's two secret rows):
 * resolved at start, held in memory, never written, logged or answered. A secret file, the TLS key and
 * the data directory must be private to their owner: no group or other mode bit on POSIX, and on Windows
 * an ACL granting read to no one but the owner, SYSTEM and Administrators (`acl.ts`).
 */

import { readFileSync, statSync } from 'node:fs';
import type { ServerConfigV1 } from '@lushly-dev/loam-manifest/server';
import { type AccessRequest, aclFindings } from './acl.js';
import type { HostFinding } from './errors.js';

/** At least 32 bytes (3.2). */
export const AUTH_SECRET_MIN_BYTES = 32;

/** What the server resolved, read once at the check and held in memory only. */
export interface ResolvedSecrets {
	readonly auth?: string;
	readonly smtpUrl?: string;
	readonly oidc: Readonly<Record<string, string>>;
	/** `[tls]`'s certificate and key, read by the check, so nothing is read again once the lock is held. */
	readonly tls?: { readonly cert: Buffer; readonly key: Buffer };
}

/** Serializes as the keys it holds, never their values, so a log or a result can never carry one. */
function redacted(secrets: Omit<ResolvedSecrets, 'toJSON'>): ResolvedSecrets {
	const names = Object.keys(secrets).filter((key) => key !== 'oidc');
	const oidc = Object.keys(secrets.oidc).map((id) => `oidc.${id}`);
	return Object.freeze(
		Object.defineProperty({ ...secrets }, 'toJSON', {
			value: () => ({ redacted: [...names, ...oidc] }),
			enumerable: false,
		})
	);
}

/** Whether only the owner can reach `path` on POSIX: no group or other mode bit. */
export function privateModeFinding(
	path: string,
	key: string,
	kind: 'file' | 'directory'
): HostFinding | undefined {
	const fix = kind === 'directory' ? 'chmod 700' : 'chmod 600';
	let mode: number;
	try {
		mode = statSync(path).mode;
	} catch {
		return undefined;
	}
	if ((mode & 0o077) === 0) return undefined;
	return {
		code: 'HOST_SECRET_PERMISSIONS',
		key,
		message: `\`${path}\` can be read by its group or by others.`,
		suggestion: `Run \`${fix} ${path}\`.`,
	};
}

/**
 * One finding or none per request: the mode bits on POSIX, and on Windows every request's ACL in one
 * PowerShell call, failing closed when it cannot be read.
 */
export function accessFindings(requests: readonly AccessRequest[]): Array<HostFinding | undefined> {
	if (process.platform === 'win32') return aclFindings(requests);
	return requests.map(({ path, key, kind }) => privateModeFinding(path, key, kind));
}

function unavailable(key: string, message: string): HostFinding {
	return {
		code: 'HOST_SECRET_UNAVAILABLE',
		key,
		message,
		suggestion: 'Name a readable file of mode 0600, or a set environment variable.',
	};
}

/** One trailing line break is the file's, not the secret's. */
function fileSecret(path: string): string | undefined {
	try {
		return readFileSync(path, 'utf8').replace(/\r?\n$/, '');
	} catch {
		return undefined;
	}
}

interface Source {
	key: string;
	file?: string;
	env?: string;
}

function resolveOne(
	{ key, file, env }: Source,
	environment: NodeJS.ProcessEnv,
	refusals: HostFinding[],
	access: ReadonlyMap<string, HostFinding | undefined>
): string | undefined {
	if (file !== undefined) {
		const permissions = access.get(key);
		if (permissions) {
			refusals.push(permissions);
			return undefined;
		}
		const value = fileSecret(file);
		if (value === undefined) refusals.push(unavailable(key, `\`${key}\`'s file cannot be read.`));
		else if (value === '') refusals.push(unavailable(key, `\`${key}\`'s file is empty.`));
		return value || undefined;
	}
	if (env !== undefined) {
		const value = environment[env];
		if (!value) refusals.push(unavailable(key, `\`${key}\`'s variable \`${env}\` is not set.`));
		return value || undefined;
	}
	return undefined;
}

/**
 * Resolves every secret 3.2 names, and checks who can reach each secret file, the TLS key and the data directory. The file's
 * own rules (one source each) have passed `readServerConfig`.
 */
export function resolveSecrets(
	server: ServerConfigV1,
	environment: NodeJS.ProcessEnv = process.env
): { secrets?: ResolvedSecrets; refusals: HostFinding[] } {
	const refusals: HostFinding[] = [];
	// Every path's access is read first, so Windows reads them all in one call.
	const requests: AccessRequest[] = [];
	if (server.auth?.secret_file !== undefined)
		requests.push({ path: server.auth.secret_file, key: 'auth', kind: 'file' });
	if (server.mail?.transport === 'smtp' && server.mail.smtp_url_file !== undefined)
		requests.push({ path: server.mail.smtp_url_file, key: 'mail', kind: 'file' });
	for (const [id, table] of Object.entries(server.oidc ?? {}))
		if (table.client_secret_file !== undefined)
			requests.push({ path: table.client_secret_file, key: `oidc.${id}`, kind: 'file' });
	if (server.tls) requests.push({ path: server.tls.key_file, key: 'tls.key_file', kind: 'file' });
	requests.push({ path: server.data, key: 'data', kind: 'directory' });
	const found = accessFindings(requests);
	const access = new Map(requests.map(({ key }, index) => [key, found[index]]));
	const auth = server.auth
		? resolveOne(
				{ key: 'auth', file: server.auth.secret_file, env: server.auth.secret_env },
				environment,
				refusals,
				access
			)
		: undefined;
	if (auth !== undefined && Buffer.byteLength(auth, 'utf8') < AUTH_SECRET_MIN_BYTES) {
		refusals.push(unavailable('auth', `The auth secret is under ${AUTH_SECRET_MIN_BYTES} bytes.`));
	}
	const smtpUrl =
		server.mail?.transport === 'smtp'
			? resolveOne(
					{ key: 'mail', file: server.mail.smtp_url_file, env: server.mail.smtp_url_env },
					environment,
					refusals,
					access
				)
			: undefined;
	const oidc: Record<string, string> = {};
	for (const [id, table] of Object.entries(server.oidc ?? {})) {
		const value = resolveOne(
			{ key: `oidc.${id}`, file: table.client_secret_file, env: table.client_secret_env },
			environment,
			refusals,
			access
		);
		if (value !== undefined) oidc[id] = value;
	}
	let tls: ResolvedSecrets['tls'];
	if (server.tls) {
		const permissions = access.get('tls.key_file');
		if (permissions) refusals.push(permissions);
		const read = (key: string, path: string): Buffer | undefined => {
			try {
				return readFileSync(path);
			} catch {
				refusals.push({
					code: 'HOST_CONFIG_INVALID',
					key,
					message: `\`${key}\` cannot be read.`,
					suggestion: 'Check the path, and that the server runs as the owner of the file.',
				});
				return undefined;
			}
		};
		const cert = read('tls.cert_file', server.tls.cert_file);
		const key = read('tls.key_file', server.tls.key_file);
		if (cert && key && !permissions) tls = { cert, key };
	}
	const directory = access.get('data');
	if (directory) refusals.push(directory);
	if (refusals.length > 0) return { refusals };
	return {
		secrets: redacted({
			...(auth !== undefined ? { auth } : {}),
			...(smtpUrl !== undefined ? { smtpUrl } : {}),
			oidc: Object.freeze(oidc),
			...(tls ? { tls } : {}),
		}),
		refusals,
	};
}
