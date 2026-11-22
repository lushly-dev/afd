/**
 * P6-D7 (phase 6 specification, 10.8 and 19): `loam-desktop mcp`, the stdio bridge, and AFD's CLI against the running
 * app. The bridge round-trips `initialize`, `tools/list` and a `tools/call`, opening no window; after the app restarts
 * it reads `inbound.json` again and goes on; with the app closed it answers the request's `id` with
 * `DESKTOP_INBOUND_UNAVAILABLE` and exits non-zero; `--print-connection` prints the `127.0.0.1` URL and the header
 * line; and AFD's CLI `call`, with `AFD_HEADERS` from it, runs `project-list`.
 *
 * The same rules on every platform's `cargo test`, against the endpoint in process: `src-tauri/tests/bridge.rs`.
 * "Visible in a Windows terminal" needs a release build in a console, which only the Windows job's runner has: it is
 * step 12's (the bridge attaches to its parent's console there, `main.rs`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binary, type Desktop, openDesktop } from './harness';
import {
	AFD,
	bridge,
	exitCode,
	quit,
	readConnection,
	run,
	untilConnection,
	untilReady,
} from './inbound';

let desktop: Desktop;
beforeAll(async () => {
	desktop = await openDesktop();
	await untilReady(await untilConnection(desktop.data));
}, 180_000);
afterAll(async () => {
	await desktop?.close();
});

describe('P6-D7: the bridge and the CLI', () => {
	it('P6-D7: the bridge round-trips initialize, tools/list and a tools/call, opening no window', async () => {
		const windows = (await desktop.browser.getWindowHandles()).length;
		const mcp = bridge(desktop.data);
		const initialized = await mcp.request('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'p6-d7', version: '1' },
		});
		expect(initialized).toMatchObject({ id: 1, result: { protocolVersion: expect.any(String) } });
		mcp.notify('notifications/initialized');
		const listed = (await mcp.request('tools/list')) as {
			result: { tools: Array<{ name: string }> };
		};
		expect(listed.result.tools.map((entry) => entry.name)).toContain('project-list');
		const called = (await mcp.request('tools/call', { name: 'project-list', arguments: {} })) as {
			result: { isError: boolean };
		};
		expect(called.result.isError).toBe(false);
		expect(await exitCode(mcp.child)).toBe(0);
		expect((await desktop.browser.getWindowHandles()).length).toBe(windows);
	});

	it('P6-D7: --print-connection prints the 127.0.0.1 URL and the header, and AFD’s CLI runs project-list with it', async () => {
		const printed = await run(binary(), ['mcp', '--print-connection'], {
			LOAM_DESKTOP_DATA_DIR: desktop.data,
		});
		expect(printed.code).toBe(0);
		const [url, header] = printed.stdout.trimEnd().split('\n');
		expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
		expect(header).toMatch(/^Authorization: Bearer [A-Za-z0-9_-]{43}$/);
		const cli = await run(
			process.execPath,
			[AFD, 'call', 'project-list', '{}', '--connect', url as string, '--format', 'json'],
			{ AFD_HEADERS: header as string }
		);
		expect(cli.code, cli.stderr).toBe(0);
		expect(JSON.parse(cli.stdout)).toMatchObject({ success: true });
		// The token is printed to the one who asked, and nowhere else: not in the CLI's own error stream.
		expect(cli.stderr).not.toContain((header as string).slice('Authorization: Bearer '.length));
	});

	it('P6-D7: after the app restarts the bridge reads inbound.json again and goes on; with it closed, it answers and exits non-zero', async () => {
		const mcp = bridge(desktop.data);
		expect(await mcp.request('ping')).toMatchObject({ id: 1, result: {} });
		const data = desktop.data;
		const first = await untilConnection(data);
		const before = first.token;
		// Quit as the person would, so the next start is not refused by the single instance, then end the session.
		await quit(desktop, first.pid);
		await desktop.close();
		desktop = await openDesktop({ data });
		const after = await untilConnection(data);
		await untilReady(after);
		expect(after.token).not.toBe(before);
		expect(await mcp.request('ping')).toMatchObject({ id: 2, result: {} });
		// Closed, as the person quits it, so `inbound.json` goes with it.
		await quit(desktop, after.pid);
		expect(readConnection(data)).toBeUndefined();
		const answer = (await mcp.request('ping')) as {
			id: number;
			error: { data: { code: string; suggestion: string } };
		};
		expect(answer.id).toBe(3);
		expect(answer.error.data).toEqual(
			expect.objectContaining({
				code: 'DESKTOP_INBOUND_UNAVAILABLE',
				suggestion: 'Open Loam, then retry',
			})
		);
		expect(await exitCode(mcp.child)).not.toBe(0);
	}, 240_000);
});
