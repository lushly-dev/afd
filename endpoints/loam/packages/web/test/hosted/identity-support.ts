/**
 * What phase 3's hosted criterion shares (P3-H1 to P3-H5; its specification, sections 10 and 18): an MCP client of the
 * profile's own `<base>mcp`, a person's shell signed in, a raw call on 10.2 item 4's transport, and the server's store
 * read whole, so a test can say its records are unchanged or changed.
 */

import { readFileSync } from 'node:fs';
import { StreamableHttpTransport } from '@lushly-dev/afd-client/streamable-http';
import type { CommandResult } from '@lushly-dev/afd-core';
import { type DevHost, trustingFetch } from '@lushly-dev/loam-host/testing';
import type { Browser } from 'playwright';
import { expect } from 'vitest';
import { kernelCall, openShell, type ShellPage } from '../browser/harness';
import { type Answer, hosted } from './support';

export const PASSWORD = 'correct horse battery staple';
export const WORKSPACE = 'acme';

/** The profile's MCP route, the one resource its tokens name. */
export const resourceOf = (host: DevHost) => `${host.root}mcp`;
/** The path `<base>`, from the root. */
export const baseOf = (host: DevHost) => host.root.slice(host.origin.length);

/** An MCP client over the profile's TLS, trusting only its certificate. */
export async function mcpClient(host: DevHost, bearer: string) {
	const transport = new StreamableHttpTransport(resourceOf(host), {
		clientName: 'p3-hosted',
		clientVersion: '0',
		headers: { authorization: `Bearer ${bearer}` },
		fetch: trustingFetch(readFileSync(host.certificate)),
	});
	await transport.connect();
	let id = 0;
	const request = async (method: string, params: unknown) =>
		(await transport.send({ jsonrpc: '2.0', id: ++id, method, params } as never)) as {
			result?: Record<string, unknown>;
			error?: { code: number; message: string };
		};
	return {
		transport,
		async names(): Promise<string[]> {
			const listed = await request('tools/list', {});
			const tools = listed.result?.tools;
			// A failed read is an error, never an empty list an exclusion would pass on.
			if (!Array.isArray(tools))
				throw new Error(`tools/list: ${JSON.stringify(listed.error ?? listed)}`);
			return (tools as { name: string }[]).map((tool) => tool.name).sort();
		},
		/** A tool call, at `project` in the workspace when one is named, else at workspace level. */
		async call<T = unknown>(
			name: string,
			args: unknown = {},
			project?: string
		): Promise<CommandResult<T>> {
			const answer = await request('tools/call', {
				name,
				arguments: args,
				...(project ? { _meta: { 'dev.loam/scope': { workspace: WORKSPACE, project } } } : {}),
			});
			if (answer.error) throw new Error(`${name}: ${answer.error.message}`);
			const result = answer.result as {
				structuredContent?: CommandResult<T>;
				content?: { text: string }[];
			};
			return (
				result.structuredContent ??
				(JSON.parse(result.content?.[0]?.text ?? '{}') as CommandResult<T>)
			);
		},
	};
}

/** A raw `tools/list` at `<base>mcp` with `bearer`: the token layer's own answer, before any command runs. */
export const listWith = (host: DevHost, bearer: string): Promise<Answer> =>
	hosted(host, `${baseOf(host)}mcp`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'mcp-protocol-version': '2025-11-25',
			authorization: `Bearer ${bearer}`,
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
	});

/** A shell signed in as `email` with a password, in a context of its own. */
export async function signedInShell(
	browser: Browser,
	host: DevHost,
	email: string,
	opened: ShellPage[]
): Promise<ShellPage> {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const page = await openShell(browser, host.root, {}, context);
	opened.push(page);
	const answer = (await kernelCall(page.page, 'auth-sign-in', {
		method: 'credentials',
		email,
		password: PASSWORD,
	})) as { success: boolean; error?: unknown };
	expect(answer.success, JSON.stringify(answer.error)).toBe(true);
	await page.page.waitForFunction(
		() => (document.querySelector('loam-shell') as unknown as { account: string }).account !== ''
	);
	return page;
}

export const cookieOf = async (host: DevHost, page: ShellPage) =>
	(await page.context.cookies(host.origin)).map(({ name, value }) => `${name}=${value}`).join('; ');

/** The provider's user id for `email`, from its own database. */
export const personId = (host: DevHost, email: string): string =>
	(host.db().auth.prepare('SELECT id FROM user WHERE email = ?').get(email) as { id: string }).id;

/**
 * One call on 10.2 item 4's transport (`POST <base>api/kernel/call`), raw, as the shell's own request is: the session
 * cookie, the deployment's `Origin` and JSON, unless `headers` says otherwise. Its status and body.
 */
export async function transportCall(
	host: DevHost,
	cookie: string,
	person: string,
	command: string,
	input: unknown,
	headers: Record<string, string> = {}
): Promise<{ status: number; body: { result?: CommandResult; code?: string } }> {
	const answer = await hosted(host, `${baseOf(host)}api/kernel/call`, {
		method: 'POST',
		headers: {
			origin: host.origin,
			'content-type': 'application/json',
			cookie,
			'loam-person': person,
			...headers,
		},
		body: JSON.stringify({ command, input, scope: { workspace: WORKSPACE } }),
	});
	return { status: answer.status, body: JSON.parse(answer.body || '{}') };
}

/** The server's whole store, row by row: what "the server's records" are, read back (P3-H5). */
export const serverStore = (host: DevHost) =>
	host.db().loam.prepare('SELECT tbl, id, value FROM records ORDER BY tbl, id').all() as Array<{
		tbl: string;
		id: string;
		value: string;
	}>;

/** The rows of one table of the server's store, parsed. */
export const serverRows = <T>(host: DevHost, table: string): T[] =>
	(
		host.db().loam.prepare('SELECT value FROM records WHERE tbl = ?').all(table) as Array<{
			value: string;
		}>
	).map((row) => JSON.parse(row.value) as T);

/** The claims of a compact JWS, unverified: only to read what the provider wrote. */
export const claimsOf = (token: string) =>
	JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
		string,
		unknown
	>;
