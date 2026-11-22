/**
 * What P6-H6's suites share (`relay.test.ts`, `relay-limits.test.ts`): a fixture's deployment table, a person's raw
 * request to the relay as the shell's transport sends it, and the JSON-RPC messages a test writes.
 */

import { readFileSync } from 'node:fs';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type DevHost, trustingFetch } from '@lushly-dev/loam-host/testing';
import type { BrowserContext } from 'playwright';
import { packUmbel } from '../mounted/support';
import type { Logged } from './relay-fixtures';
import { type Answer, hosted } from './support';

export const WORKSPACE = 'acme';

/** A deployment table for an instance at `url`, mounted as `umbel`, with its bearer in a file only the owner reads. */
export async function fixtureEntry(
	directory: string,
	instance: string,
	url: string,
	token: string,
	extra: string[] = []
): Promise<string> {
	const file = join(directory, `${instance}.token`);
	await writeFile(file, token, { mode: 0o600 });
	await chmod(file, 0o600);
	return [
		`[apps.${instance}]`,
		'app = "umbel"',
		`package = ${JSON.stringify(await packUmbel())}`,
		'transport = "http"',
		`prefix = ${JSON.stringify(instance)}`,
		`url = ${JSON.stringify(url)}`,
		`bearer_file = ${JSON.stringify(file)}`,
		...extra,
	].join('\n');
}

export interface Result<T = unknown> {
	success: boolean;
	data?: T;
	error?: { code: string; message?: string; suggestion?: string; retryable?: boolean };
	metadata?: Record<string, unknown>;
}

export const cookieOf = async (host: DevHost, context: BrowserContext) =>
	(await context.cookies(host.origin)).map(({ name, value }) => `${name}=${value}`).join('; ');

/** A person's raw request to the relay, as the shell's transport sends it: same origin, JSON, the session cookie. */
export async function relayAs(
	host: DevHost,
	context: BrowserContext | undefined,
	instance: string,
	body: unknown,
	options: { method?: string; headers?: Record<string, string> } = {}
): Promise<Answer> {
	return hosted(host, `${host.root.slice(host.origin.length)}mounts/${instance}/mcp`, {
		method: options.method ?? 'POST',
		...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
		headers: {
			origin: host.origin,
			...(body !== undefined ? { 'content-type': 'application/json' } : {}),
			...(context ? { cookie: await cookieOf(host, context) } : {}),
			...options.headers,
		},
	});
}

/** A streamed answer read to its end or its cut: `cut` when the connection ended before the body did. */
export interface Streamed {
	status: number;
	headers: Headers;
	body: string;
	cut: boolean;
}

/**
 * The same request, abortable and read as it streams, for an answer the relay may cut after its status, or a request
 * the page abandons: `signal` aborts it as a closed tab would.
 */
export async function streamAs(
	host: DevHost,
	context: BrowserContext,
	instance: string,
	body: unknown,
	options: { headers?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<Streamed> {
	const response = await trustingFetch(readFileSync(host.certificate))(
		`${host.root}mounts/${instance}/mcp`,
		{
			method: 'POST',
			body: JSON.stringify(body),
			headers: {
				origin: host.origin,
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				cookie: await cookieOf(host, context),
				...options.headers,
			},
			...(options.signal ? { signal: options.signal } : {}),
		}
	);
	const decoder = new TextDecoder();
	let text = '';
	let cut = false;
	const reader = response.body?.getReader();
	try {
		for (;;) {
			const chunk = await reader?.read();
			if (!chunk || chunk.done) break;
			text += decoder.decode(chunk.value, { stream: true });
		}
	} catch {
		cut = true;
	}
	return { status: response.status, headers: response.headers, body: text, cut };
}

export const rpc = (method: string, params?: unknown, id: number | string | null = 1) => ({
	jsonrpc: '2.0',
	...(id === null ? {} : { id }),
	method,
	...(params !== undefined ? { params } : {}),
});
export const toolCall = (
	name: string,
	args: unknown = {},
	meta?: unknown,
	id: number | string = 1
) => rpc('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) }, id);
export const scoped = (project: string) => ({
	'dev.loam/scope': { workspace: WORKSPACE, project },
});
export const modern = {
	'io.modelcontextprotocol/protocolVersion': '2026-07-28',
	'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
};
/** A legacy `initialize`, as the SDK sends one after `server/discover` is refused. */
export const legacyInitialize = (id: number | string = 1) =>
	rpc(
		'initialize',
		{ protocolVersion: '2025-11-25', clientInfo: { name: 'test', version: '1' }, capabilities: {} },
		id
	);
export const codeOf = (answer: Answer) => ({
	status: answer.status,
	code: (JSON.parse(answer.body || '{}') as { code?: string }).code,
	marked: answer.headers['loam-relay-refusal'],
});
export const posts = (log: Logged[]) => log.filter((request) => request.method === 'POST');
export const bodyOf = (request: Logged | undefined) => JSON.parse(request?.body ?? '{}');
