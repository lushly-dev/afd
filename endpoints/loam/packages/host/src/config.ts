/**
 * @fileoverview Reading `loam.server.toml` from disk (phase 6 specification, 3.2). The file's own rules
 * are `readServerConfig`'s, in `@lushly-dev/loam-manifest/server`; this adds the TOML and the paths.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseManifestToml } from '@lushly-dev/loam-cli/check';
import { readServerConfig, type ServerConfigV1 } from '@lushly-dev/loam-manifest/server';
import type { HostFinding } from './errors.js';

export type LoadedServerConfig =
	| { ok: true; server: ServerConfigV1; warnings: HostFinding[] }
	| { ok: false; refusals: HostFinding[]; warnings: HostFinding[] };

/**
 * Every path the file names, made absolute against the file's own directory, as the deployment file's
 * `package` is read against its own. A configuration built in memory keeps its paths, read against the
 * working directory.
 */
export function withAbsolutePaths(server: ServerConfigV1, base: string): ServerConfigV1 {
	const at = (path: string): string => resolve(base, path);
	return {
		...server,
		data: at(server.data),
		...(server.tls
			? { tls: { cert_file: at(server.tls.cert_file), key_file: at(server.tls.key_file) } }
			: {}),
		...(server.auth
			? {
					auth: {
						...server.auth,
						...(server.auth.secret_file ? { secret_file: at(server.auth.secret_file) } : {}),
					},
				}
			: {}),
		...(server.mail
			? {
					mail: {
						...server.mail,
						...(server.mail.smtp_url_file ? { smtp_url_file: at(server.mail.smtp_url_file) } : {}),
					},
				}
			: {}),
		...(server.oidc
			? {
					oidc: Object.fromEntries(
						Object.entries(server.oidc).map(([id, table]) => [
							id,
							{
								...table,
								...(table.client_secret_file
									? { client_secret_file: at(table.client_secret_file) }
									: {}),
							},
						])
					),
				}
			: {}),
	};
}

/** Reads and checks `loam.server.toml`; never quotes the file, which may name secrets' places. */
export async function loadServerConfig(file: string): Promise<LoadedServerConfig> {
	const unreadable = (message: string, suggestion: string): LoadedServerConfig => ({
		ok: false,
		refusals: [{ code: 'HOST_CONFIG_INVALID', key: file, message, suggestion }],
		warnings: [],
	});
	let text: string;
	try {
		text = await readFile(file, 'utf8');
	} catch {
		return unreadable(
			'The server configuration cannot be read.',
			'Check the path given to `--server`.'
		);
	}
	let parsed: unknown;
	try {
		parsed = parseManifestToml(text);
	} catch (cause) {
		const { line, column } = cause as { line?: number; column?: number };
		return unreadable(
			`The server configuration is not valid TOML, at line ${line}, column ${column}.`,
			'Fix the TOML at that line.'
		);
	}
	const read = readServerConfig(parsed);
	if (!read.ok) return read;
	return {
		ok: true,
		server: withAbsolutePaths(read.server, dirname(resolve(file))),
		warnings: read.warnings,
	};
}
