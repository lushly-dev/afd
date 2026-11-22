/**
 * P6-D6 (phase 6 specification, 10.8 and 19): the desktop's inbound MCP endpoint against the running app. `tools/list`
 * is `DESKTOP_MCP_COMMANDS` the kernel registers and AFD's meta-tools; `document-open` and the human and owner commands
 * are not listed and their calls are refused; `project-create` is journaled under `loam-inbound` and seen by the shell,
 * and with `access` is `HUMAN_REQUIRED`; a call the person must confirm answers `CONFIRMATION_PENDING`, runs only once
 * confirmed, and `confirmation-get` reads it; every HTTP check answers before anything is forwarded; `503` through a
 * reload; `inbound_reply` with an id never issued does nothing; the token is in no DOM, store, journal or log;
 * `inbound.json` is owner-only and gone after exit, and then nothing listens. The switch is `inbound-switch.test.ts`'s.
 *
 * The rules a running app cannot drive on demand are the Rust units' (`src/inbound.rs`, `src/connection.rs`), titled
 * `p6_d6_`: a reply over 4 MiB and none within 60 s answer `504`, and a request waiting through a reload answers `503`,
 * each with a fake webview; `inbound_reply` from the proxy frame or a view is refused by `from_shell` in
 * `tests/origin.rs`, beside P6-D4's frame barriers, which hold for every command.
 */
import { existsSync, readdirSync } from 'node:fs';
import { DESKTOP_MCP_COMMANDS } from '@lushly-dev/loam-kernel/inbound';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Desktop, openDesktop, pageText, storedText } from './harness';
import {
	type Connection,
	call,
	connectionFile,
	modeOf,
	quit,
	readConnection,
	rpc,
	send,
	tool,
	untilConnection,
	untilReady,
} from './inbound';

const META_TOOLS = ['afd-call', 'afd-batch', 'afd-pipe', 'afd-discover', 'afd-detail'];

let desktop: Desktop;
let connection: Connection;
beforeAll(async () => {
	desktop = await openDesktop();
	connection = await untilConnection(desktop.data);
	await untilReady(connection);
}, 180_000);
afterAll(async () => {
	await desktop?.close();
});

describe('P6-D6: inbound MCP', () => {
	it('P6-D6: inbound.json is owner-only, names 127.0.0.1 and this run, and leaves no temporary file', () => {
		expect(connection.url).toBe(`http://127.0.0.1:${connection.port}/mcp`);
		expect(connection.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(connection.pid).toBeGreaterThan(0);
		const mode = modeOf(desktop.data);
		if (mode !== undefined) expect(mode).toBe(0o600);
		expect(readdirSync(desktop.data).filter((name) => name.startsWith('inbound.json'))).toEqual([
			'inbound.json',
		]);
	});

	it('P6-D6: tools/list is DESKTOP_MCP_COMMANDS and the meta-tools; document-open and the human commands are refused', async () => {
		const listed = await call(connection, rpc('tools/list'));
		expect(listed.status).toBe(200);
		const names = (JSON.parse(listed.body).result.tools as Array<{ name: string }>).map(
			(entry) => entry.name
		);
		const served = new Set<string>([...DESKTOP_MCP_COMMANDS, ...META_TOOLS]);
		expect(names.filter((name) => !served.has(name))).toEqual([]);
		for (const name of [
			'project-create',
			'project-list',
			'document-list',
			'confirmation-get',
			...META_TOOLS,
		])
			expect(names, name).toContain(name);
		for (const [name, args] of [
			['document-open', { document: 'x' }],
			['member-invite', { email: 'someone@example.com' }],
			['notification-act', { notification: 'x', answer: 'confirm' }],
			['autonomy-set', { level: 'workspace', mode: 'act' }],
			['afd-call', { command: 'document-open', input: { document: 'x' } }],
		] as const) {
			expect(names).not.toContain(name === 'afd-call' ? 'document-open' : name);
			const refused = await tool(connection, name, args);
			expect(refused.isError, name).toBe(true);
		}
	});

	it('P6-D6: a call the person must confirm answers CONFIRMATION_PENDING, which confirmation-get reads, and runs once confirmed', async () => {
		// The workspace's default asks an agent first (phase 5's 6.1).
		const asked = await tool(connection, 'project-create', { name: 'Asked first' });
		expect(asked.result.error?.code).toBe('CONFIRMATION_PENDING');
		const { notification } = (asked.result.error?.details ?? {}) as { notification: string };
		expect((await desktop.call('project-get', { project: 'asked-first' })).success).toBe(false);
		const read = await tool(connection, 'confirmation-get', { notification });
		expect(read.result).toMatchObject({ success: true, data: { state: 'pending' } });
		const confirmed = await desktop.call('notification-act', { notification, answer: 'confirm' });
		expect(confirmed.success).toBe(true);
		expect((await desktop.call('project-get', { project: 'asked-first' })).success).toBe(true);
	});

	it('P6-D6: project-create runs as loam-inbound, journaled and seen by the shell; with access it is HUMAN_REQUIRED', async () => {
		expect((await desktop.call('autonomy-set', { level: 'workspace', mode: 'act' })).success).toBe(
			true
		);
		const created = await tool(connection, 'project-create', { name: 'Inbound' });
		expect(created.result.success).toBe(true);
		expect((await desktop.call('project-get', { project: 'inbound' })).success).toBe(true);
		const stored = JSON.parse(await storedText(desktop.browser)) as Array<{
			name?: string;
			rows?: Array<{ command?: string; actor?: { kind?: string; id?: string }; input?: unknown }>;
		}>;
		const entries = stored.flatMap((each) => each.rows ?? []);
		expect(
			entries.some(
				(entry) =>
					entry.command === 'project-create' &&
					entry.actor?.kind === 'agent' &&
					entry.actor?.id === 'loam-inbound' &&
					JSON.stringify(entry.input).includes('Inbound')
			)
		).toBe(true);
		const restricted = await tool(connection, 'project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: ['mock-user-someone@example.com'] },
		});
		expect(restricted.result.error?.code).toBe('HUMAN_REQUIRED');
	});

	it('P6-D6: every check answers before anything is forwarded', async () => {
		// Agents act, so a body that got through would make the project.
		expect((await desktop.call('autonomy-set', { level: 'workspace', mode: 'act' })).success).toBe(
			true
		);
		const create = (name: string, params: Record<string, unknown> = {}) =>
			JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'project-create', arguments: { name }, ...params },
			});
		const bearer = `Bearer ${connection.token}`;
		const statuses: Record<string, number> = {
			'no token': (await send(connection, { body: create('Refused one') })).status,
			'a wrong token': (
				await send(connection, {
					headers: { Authorization: 'Bearer nope' },
					body: create('Refused two'),
				})
			).status,
			'another Host': (
				await send(connection, {
					headers: { Authorization: bearer, Host: 'example.com' },
					body: create('Refused three'),
				})
			).status,
			'an Origin': (
				await send(connection, {
					headers: { Authorization: bearer, Origin: 'https://example.com' },
					body: create('Refused four'),
				})
			).status,
			'the null Origin': (
				await send(connection, {
					headers: { Authorization: bearer, Origin: 'null' },
					body: create('Refused five'),
				})
			).status,
			GET: (await send(connection, { method: 'GET', headers: { Authorization: bearer } })).status,
			DELETE: (await send(connection, { method: 'DELETE', headers: { Authorization: bearer } }))
				.status,
			'a batch': (await call(connection, `[${create('Refused six')}]`)).status,
			'over 1 MiB': (
				await call(connection, create('Refused seven', { pad: 'x'.repeat(1024 * 1024) }))
			).status,
		};
		expect(statuses).toEqual({
			'no token': 401,
			'a wrong token': 401,
			'another Host': 421,
			'an Origin': 403,
			'the null Origin': 403,
			GET: 405,
			DELETE: 405,
			'a batch': 400,
			'over 1 MiB': 413,
		});
		const listed = await desktop.call('project-list');
		expect(JSON.stringify(listed.data)).not.toMatch(/Refused/);
		// `localhost:<port>` is the endpoint's own name too; a notification is accepted with no body.
		expect(
			(await call(connection, rpc('ping'), { Host: `localhost:${connection.port}` })).status
		).toBe(200);
		const accepted = await call(
			connection,
			JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
		);
		expect([accepted.status, accepted.body]).toEqual([202, '']);
	});

	it('P6-D6: inbound_reply with an id never issued, or already answered, does nothing', async () => {
		const answered = await desktop.browser.execute(async () => {
			const internals = (
				window as unknown as {
					__TAURI_INTERNALS__: { invoke(command: string, args: unknown): Promise<unknown> };
				}
			).__TAURI_INTERNALS__;
			const out: string[] = [];
			for (const args of [
				{ id: 987_654, message: { jsonrpc: '2.0', id: 1, result: 'forged' } },
				{ id: 1, message: { jsonrpc: '2.0', id: 1, result: 'late' } },
			]) {
				try {
					out.push(JSON.stringify(await internals.invoke('inbound_reply', args)));
				} catch (error) {
					out.push(String(error));
				}
			}
			return out;
		});
		// Nothing reached a waiting request, and the command says so (`src-tauri/tests/inbound_reply.rs` pins it).
		expect(answered).toEqual(['false', 'false']);
		const pinged = await call(connection, rpc('ping'));
		expect(pinged.status).toBe(200);
		expect(JSON.parse(pinged.body).result).toEqual({});
	});

	it('P6-D6: a request during a reload is 503, and the endpoint answers again once the new page is ready', async () => {
		// The poller runs before the reload is asked for, so the window from the load's start to the new page's `ready`
		// (its boot and stage B) is polled from its first moment. The Rust units prove the same with a held request.
		const statuses: number[] = [];
		let reloaded = false;
		const polling = (async () => {
			const until = Date.now() + 30_000;
			while (Date.now() < until) {
				const answer = await call(connection, rpc('ping'));
				statuses.push(answer.status);
				if (answer.status === 503) return;
				if (!reloaded) await new Promise((resolve) => setTimeout(resolve, 1));
			}
		})();
		await desktop.browser.execute(() => {
			setTimeout(() => location.reload(), 50);
		});
		reloaded = true;
		await polling;
		await desktop.ready();
		await untilReady(connection);
		process.stderr.write(`P6-D6 reload on ${process.platform}: ${statuses.join(',')}\n`);
		// Every answer was the old page's `200` or the reload's `503`: none hung, none `504`.
		expect(statuses.every((status) => status === 200 || status === 503)).toBe(true);
		expect(statuses.at(-1)).toBe(503);
		// The token survived the reload: it is the run's.
		expect(readConnection(desktop.data)?.token).toBe(connection.token);
	});

	it('P6-D6: the token is in no DOM, store, journal entry or log', async () => {
		expect(await pageText(desktop.browser)).not.toContain(connection.token);
		expect(await storedText(desktop.browser)).not.toContain(connection.token);
		expect(desktop.stderr.lines.join('\n')).not.toContain(connection.token);
	});

	it('P6-D6: once the app exits nothing listens and inbound.json is gone', async () => {
		await quit(desktop, connection.pid);
		expect(existsSync(connectionFile(desktop.data))).toBe(false);
		expect((await call(connection, rpc('ping'))).status).toBe(0);
	});
});
