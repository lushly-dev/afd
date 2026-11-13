/** Fixtures for the suites: temporary directories, a built shell, configurations and raw requests. */

import { statSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerConfigV1 } from '@lushly-dev/loam-manifest/server';
import { afterEach, expect } from 'vitest';

const made: string[] = [];

export async function temporaryDirectory(): Promise<string> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'loam-host-')));
	made.push(directory);
	return directory;
}

/**
 * Asserts a file's POSIX permission bits. Windows keeps none (`stat` reports 0666 whatever `chmod` set),
 * so there it asserts nothing; the secrets check covers who can read a file on Windows.
 */
export function expectMode(path: string, mode: number, label?: string): void {
	if (process.platform === 'win32') return;
	expect(statSync(path).mode & 0o777, label).toBe(mode);
}

afterEach(async () => {
	await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * The web host's page as written in its source: `vite build` keeps its policy `<meta>` as it is, and
 * reading the source needs no build. `scripts/affected/scope.mjs` declares it among this package's inputs.
 */
export const WEB_PAGE = fileURLToPath(new URL('../../web/index.html', import.meta.url));

export const SHELL_POLICY =
	"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'";

/** A small `dist` shaped like the web host's: a page with phase 0's policy, a hashed asset and the sandbox. */
export async function fixtureDist(root: string): Promise<string> {
	const dist = join(root, 'dist');
	await mkdir(join(dist, 'assets'), { recursive: true });
	await mkdir(join(dist, 'sandbox'), { recursive: true });
	await writeFile(
		join(dist, 'index.html'),
		[
			'<!doctype html>',
			'<html lang="en"><head>',
			`<meta http-equiv="Content-Security-Policy" content="${SHELL_POLICY}" />`,
			'<script type="module" src="./assets/index-a1b2c3.js"></script>',
			'</head><body></body></html>',
			'',
		].join('\n')
	);
	await writeFile(join(dist, 'assets', 'index-a1b2c3.js'), 'export {};\n');
	await writeFile(join(dist, 'deployment.json'), '{}\n');
	await writeFile(
		join(dist, 'sandbox', 'proxy.html'),
		`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self'" /></head><body></body></html>\n`
	);
	await writeFile(join(dist, 'sandbox', 'proxy.js'), '// proxy\n');
	return dist;
}

/** A deployment file at `root/loam.deployment.toml`. */
export async function deploymentFile(root: string, body = ''): Promise<string> {
	const path = join(root, 'loam.deployment.toml');
	await writeFile(
		path,
		`deployment_version = 2\n\n${body}${body.includes('[apps') ? '' : '\n[apps]\n'}`
	);
	return path;
}

/** A configuration on loopback HTTP, as a TLS proxy in front would see it. */
export function serverConfig(data: string, extra: Partial<ServerConfigV1> = {}): ServerConfigV1 {
	return {
		server_version: 1,
		origin: 'https://localhost:8443',
		listen: '127.0.0.1:0',
		data,
		...extra,
	};
}

export interface RawAnswer {
	status: number;
	headers: IncomingHttpHeaders;
	body: string;
}

/**
 * One request with its path sent exactly as given, unnormalized, and the `Host` header the test names,
 * which `fetch` would neither keep nor allow.
 */
export function raw(
	port: number,
	path: string,
	options: { host?: string; method?: string; accept?: string; tls?: boolean } = {}
): Promise<RawAnswer> {
	const send = options.tls ? httpsRequest : httpRequest;
	return new Promise((done, fail) => {
		const headers: Record<string, string> = {};
		if (options.host !== undefined) headers.host = options.host;
		if (options.accept !== undefined) headers.accept = options.accept;
		const outgoing = send(
			{
				host: '127.0.0.1',
				port,
				path,
				method: options.method ?? 'GET',
				headers,
				setHost: options.host === undefined,
				...(options.tls ? { rejectUnauthorized: false } : {}),
			},
			(incoming) => {
				const chunks: Buffer[] = [];
				incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
				incoming.on('end', () =>
					done({
						status: incoming.statusCode ?? 0,
						headers: incoming.headers,
						body: Buffer.concat(chunks).toString('utf8'),
					})
				);
			}
		);
		outgoing.on('error', fail);
		outgoing.end();
	});
}

/** The status of a request written byte for byte on a socket: for headers no client library will send. */
export function rawRequest(port: number, head: string): Promise<number> {
	return new Promise((done, fail) => {
		const socket = connect(port, '127.0.0.1', () => socket.write(`${head}\r\n\r\n`));
		let text = '';
		socket.on('data', (chunk: Buffer) => {
			text += chunk.toString('latin1');
			const status = /^HTTP\/1\.1 (\d{3})/.exec(text);
			if (status) {
				socket.destroy();
				done(Number(status[1]));
			}
		});
		socket.on('error', fail);
	});
}
