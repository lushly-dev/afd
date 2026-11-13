/** What the hosted suites share: raw requests to a `DevHost` and its bin. */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import { request } from 'node:https';
import { fileURLToPath } from 'node:url';
import type { DevHost } from '@lushly-dev/loam-host/testing';

export interface Answer {
	status: number;
	headers: IncomingHttpHeaders;
	body: string;
}

/**
 * One request to the profile, its path sent exactly as given and unnormalized, trusting only the profile's
 * certificate, with the `Host` the test names: the origin's by default.
 */
export function hosted(
	host: DevHost,
	path: string,
	options: { host?: string; method?: string; accept?: string; origin?: string } = {}
): Promise<Answer> {
	const origin = new URL(options.origin ?? host.origin);
	return new Promise((done, fail) => {
		const outgoing = request(
			{
				host: '127.0.0.1',
				port: Number(origin.port),
				servername: 'localhost',
				path,
				method: options.method ?? 'GET',
				ca: readFileSync(host.certificate),
				setHost: false,
				headers: {
					host: options.host ?? origin.host,
					...(options.accept ? { accept: options.accept } : {}),
				},
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

const BIN = fileURLToPath(new URL('../../../host/bin/loam-host.mjs', import.meta.url));

/** The `loam-host` bin, as a person runs it: its JSON, and its exit code. */
export function loamHost(
	args: string[]
): Promise<{ code: number; output: Record<string, unknown> }> {
	return new Promise((done) => {
		execFile(process.execPath, [BIN, ...args], { timeout: 60_000 }, (error, stdout) => {
			done({
				code: error ? ((error as { code?: number }).code ?? 1) : 0,
				output: JSON.parse(stdout) as Record<string, unknown>,
			});
		});
	});
}

/** The `<meta>` policy `deployment write` wrote into the served page. */
export function writtenPolicy(host: DevHost): string {
	const page = readFileSync(`${host.data}/public/site/index.html`, 'utf8');
	return /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(page)?.[1] ?? '';
}
