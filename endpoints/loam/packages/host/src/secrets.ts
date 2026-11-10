/**
 * @fileoverview The server's secrets (phase 6 specification, section 13, and 3.2's two secret rows):
 * resolved at start, held in memory, never written, logged or answered. A secret file, the TLS key and
 * the data directory must be private to their owner.
 */

import { readFileSync, statSync } from 'node:fs';
import type { ServerConfigV1 } from '@lushly-dev/loam-manifest/server';
import type { HostFinding } from './errors.js';

/** At least 32 bytes (3.2). */
export const AUTH_SECRET_MIN_BYTES = 32;

/** What the server resolved. Never serialized: no `toJSON` reaches a value. */
export interface ResolvedSecrets {
	readonly auth?: string;
	readonly smtpUrl?: string;
	readonly oidc: Readonly<Record<string, string>>;
}

/**
 * Whether only the owner can reach `path`: no group or other bit on POSIX. Windows needs an ACL read this
 * step does not build, so it fails closed there (a stated deviation, recorded in STATUS.md).
 */
export function privateModeFinding(
	path: string,
	key: string,
	kind: 'file' | 'directory'
): HostFinding | undefined {
	const fix = kind === 'directory' ? 'chmod 700' : 'chmod 600';
	if (process.platform === 'win32') {
		return {
			code: 'HOST_SECRET_PERMISSIONS',
			key,
			message: `\`${key}\`'s access cannot be checked on Windows yet, so it is refused.`,
			suggestion: 'Run the hosted server on Linux or macOS, or in its container image.',
		};
	}
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
	refusals: HostFinding[]
): string | undefined {
	if (file !== undefined) {
		const permissions = privateModeFinding(file, key, 'file');
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
 * Resolves every secret 3.2 names, and checks the TLS key's and the data directory's modes. The file's
 * own rules (one source each) have passed `readServerConfig`.
 */
export function resolveSecrets(
	server: ServerConfigV1,
	environment: NodeJS.ProcessEnv = process.env
): { secrets?: ResolvedSecrets; refusals: HostFinding[] } {
	const refusals: HostFinding[] = [];
	const auth = server.auth
		? resolveOne(
				{ key: 'auth', file: server.auth.secret_file, env: server.auth.secret_env },
				environment,
				refusals
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
					refusals
				)
			: undefined;
	const oidc: Record<string, string> = {};
	for (const [id, table] of Object.entries(server.oidc ?? {})) {
		const value = resolveOne(
			{ key: `oidc.${id}`, file: table.client_secret_file, env: table.client_secret_env },
			environment,
			refusals
		);
		if (value !== undefined) oidc[id] = value;
	}
	if (server.tls) {
		const permissions = privateModeFinding(server.tls.key_file, 'tls.key_file', 'file');
		if (permissions) refusals.push(permissions);
		for (const [key, path] of [
			['tls.cert_file', server.tls.cert_file],
			['tls.key_file', server.tls.key_file],
		] as const) {
			if (fileSecret(path) === undefined) {
				refusals.push({
					code: 'HOST_CONFIG_INVALID',
					key,
					message: `\`${key}\` cannot be read.`,
					suggestion: 'Check the path, and that the server runs as the owner of the file.',
				});
			}
		}
	}
	const directory = privateModeFinding(server.data, 'data', 'directory');
	if (directory) refusals.push(directory);
	if (refusals.length > 0) return { refusals };
	return {
		secrets: Object.freeze({
			...(auth !== undefined ? { auth } : {}),
			...(smtpUrl !== undefined ? { smtpUrl } : {}),
			oidc: Object.freeze(oidc),
		}),
		refusals,
	};
}
