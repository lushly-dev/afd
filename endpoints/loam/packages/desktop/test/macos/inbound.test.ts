/**
 * P6-D6 and P6-D7 on macOS WKWebView, without WebDriver (phase 6 specification, 10.8): the unmodified `loam-desktop`
 * binary on a deployment `loam deployment write --host desktop` wrote, the real web build in its webview, and the
 * endpoint, the bridge and AFD's CLI driven from outside, as an agent on the machine drives them. The WebDriver suite
 * (`test/inbound.test.ts`, `test/bridge.test.ts`) adds what needs the page: the person's confirmation, the journal and
 * the DOM, a reload.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binary, desktopDeployment, pipeRedactedStderr, writeData } from '../harness';
import {
	AFD,
	bridge,
	type Connection,
	call,
	connectionFile,
	exitCode,
	modeOf,
	rpc,
	run,
	send,
	tool,
	untilConnection,
	untilReady,
} from '../inbound';

interface App {
	child: ChildProcess;
	data: string;
	stderr: string[];
}

function launch(data: string): App {
	const child = spawn(binary(), [], {
		env: { ...process.env, LOAM_DESKTOP_DATA_DIR: data },
		stdio: ['ignore', 'ignore', 'pipe'],
	});
	// Whole lines across chunks, the invoke key redacted, as the harness reads the app's stderr (#1448).
	const stderr = { lines: [] as string[], keyRefusals: 0 };
	pipeRedactedStderr(child.stderr, stderr);
	return { child, data, stderr: stderr.lines };
}

/** `SIGTERM`, which the host answers as "Quit", then the process's end. */
async function stop(app: App): Promise<number | null> {
	// Ended already, by a code or a signal: `exit` has fired, and will not again.
	if (app.child.exitCode !== null || app.child.signalCode !== null) return app.child.exitCode;
	const ended = new Promise<number | null>((resolve) => app.child.once('exit', resolve));
	app.child.kill('SIGTERM');
	const timer = setTimeout(() => app.child.kill('SIGKILL'), 20_000);
	const code = await ended;
	clearTimeout(timer);
	return code;
}

let app: App;
let connection: Connection;
beforeAll(async () => {
	app = launch(await writeData());
	connection = await untilConnection(app.data, 60_000);
	await untilReady(connection, 60_000);
}, 120_000);
afterAll(async () => {
	if (app) await stop(app);
});

describe('P6-D6 and P6-D7 on WKWebView', () => {
	it('P6-D6: inbound.json is owner-only and names this run', () => {
		expect(connection.url).toBe(`http://127.0.0.1:${connection.port}/mcp`);
		expect(connection.pid).toBe(app.child.pid);
		expect(modeOf(app.data)).toBe(0o600);
		expect(readdirSync(app.data).filter((name) => name.startsWith('inbound.json'))).toEqual([
			'inbound.json',
		]);
	});

	it('P6-D6: the kernel in the webview answers the served list, and a change waits for the person', async () => {
		const listed = await call(connection, rpc('tools/list'));
		const names = (JSON.parse(listed.body).result.tools as Array<{ name: string }>).map(
			(entry) => entry.name
		);
		expect(names).toEqual(expect.arrayContaining(['project-create', 'project-list', 'afd-call']));
		expect(names).not.toContain('document-open');
		const refused = await tool(connection, 'document-open', { document: 'x' });
		expect(refused.isError).toBe(true);
		const asked = await tool(connection, 'project-create', { name: 'Asked' });
		expect(asked.result.error?.code).toBe('CONFIRMATION_PENDING');
		const { notification } = (asked.result.error?.details ?? {}) as { notification: string };
		const read = await tool(connection, 'confirmation-get', { notification });
		expect(read.result).toMatchObject({ success: true, data: { state: 'pending' } });
	});

	it('P6-D6: the HTTP checks answer before anything is forwarded', async () => {
		const bearer = `Bearer ${connection.token}`;
		const ping = rpc('ping');
		expect((await send(connection, { body: ping })).status).toBe(401);
		expect(
			(
				await send(connection, {
					headers: { Authorization: bearer, Host: 'evil.test' },
					body: ping,
				})
			).status
		).toBe(421);
		expect(
			(await send(connection, { headers: { Authorization: bearer, Origin: 'null' }, body: ping }))
				.status
		).toBe(403);
		expect(
			(await send(connection, { method: 'GET', headers: { Authorization: bearer } })).status
		).toBe(405);
		expect((await call(connection, `[${ping}]`)).status).toBe(400);
		const accepted = await call(
			connection,
			JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
		);
		expect(accepted.status).toBe(202);
	});

	it('P6-D7: the bridge round-trips, --print-connection prints the URL and header, and AFD’s CLI runs project-list', async () => {
		const mcp = bridge(app.data);
		expect(await mcp.request('initialize', { protocolVersion: '2025-06-18' })).toMatchObject({
			id: 1,
			result: { protocolVersion: expect.any(String) },
		});
		const called = (await mcp.request('tools/call', { name: 'project-list', arguments: {} })) as {
			result: { isError: boolean };
		};
		expect(called.result.isError).toBe(false);
		expect(await exitCode(mcp.child)).toBe(0);
		const printed = await run(binary(), ['mcp', '--print-connection'], {
			LOAM_DESKTOP_DATA_DIR: app.data,
		});
		expect(printed.code).toBe(0);
		expect(printed.stdout).toBe(`${connection.url}\nAuthorization: Bearer ${connection.token}\n`);
		const cli = await run(
			process.execPath,
			[AFD, 'call', 'project-list', '{}', '--connect', connection.url, '--format', 'json'],
			{ AFD_HEADERS: `Authorization: Bearer ${connection.token}` }
		);
		expect(cli.code, cli.stderr).toBe(0);
		expect(JSON.parse(cli.stdout)).toMatchObject({ success: true });
	});

	it('P6-D6: the token is in no log, and once the app exits nothing listens and inbound.json is gone', async () => {
		expect(app.stderr.join('\n')).not.toContain(connection.token);
		expect(await stop(app)).toBe(0);
		expect(existsSync(connectionFile(app.data))).toBe(false);
		expect((await call(connection, rpc('ping'))).status).toBe(0);
		const mcp = bridge(app.data);
		const answer = (await mcp.request('ping')) as { error: { data: { code: string } } };
		expect(answer.error.data.code).toBe('DESKTOP_INBOUND_UNAVAILABLE');
		expect(await exitCode(mcp.child)).not.toBe(0);
	});

	it('P6-D6: [host] inbound = false binds nothing', async () => {
		const off = launch(
			await writeData(
				desktopDeployment().replace('kind = "desktop"', 'kind = "desktop"\ninbound = false')
			)
		);
		try {
			// The host decides at setup, before the window: past a moment of running, it has.
			await new Promise((resolve) => setTimeout(resolve, 5_000));
			expect(off.child.exitCode).toBeNull();
			expect(existsSync(connectionFile(off.data))).toBe(false);
		} finally {
			await stop(off);
		}
	});
});
