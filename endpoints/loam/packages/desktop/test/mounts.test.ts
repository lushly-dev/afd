/**
 * P6-D2 (phase 6 specification, section 19, and 10.4 as amended 2026-11-16): mounts over the Rust host. A
 * `stdio` AFD server that also writes notifications, and phase 2's `http` fixture server, each mounted from
 * `mounts.json`. The webview names instances only. `hello-mcp` on its own serves no `afd-help`, which the
 * kernel's discovery needs, so the `stdio` rows run on this fixture (the step's deviation).
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOSTILE } from './fixtures/hostile';
import { type ScopeServer, startScopeServer } from './fixtures/scope-server';
import {
	type Desktop,
	desktopDeployment,
	LOAM,
	openDesktop,
	packApp,
	pageText,
	storedText,
	untilInstance,
} from './harness';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const NOTIFY_SERVER = fileURLToPath(new URL('./fixtures/notify-server.ts', import.meta.url));
const BEARER = 'loam-desktop-bearer-6f1d0c2a9b';

let desktop: Desktop;
let scope: ScopeServer;

/** The `[apps.*]` tables of this suite's deployment. */
async function apps(): Promise<string[]> {
	const directory = await mkdtemp(join(tmpdir(), 'loam-desktop-mounts-'));
	const tokenFile = join(directory, 'token');
	await writeFile(tokenFile, BEARER, { mode: 0o600 });
	const fixture = await packApp(fileURLToPath(new URL('./fixtures/apps/fixture', import.meta.url)));
	const umbel = await packApp(join(LOAM, 'packages/web/test/mounted/apps/umbel'));
	return [
		'[apps.fixture]',
		'app = "fixture"',
		`package = ${JSON.stringify(fixture)}`,
		'transport = "stdio"',
		`command = [${JSON.stringify(process.execPath)}, ${JSON.stringify(NOTIFY_SERVER)}]`,
		`cwd = ${JSON.stringify(PACKAGE)}`,
		'audience = "person"',
		'',
		'[apps.probe]',
		'app = "umbel"',
		`package = ${JSON.stringify(umbel)}`,
		'prefix = "probe"',
		'transport = "http"',
		`url = ${JSON.stringify(scope.url)}`,
		`bearer_file = ${JSON.stringify(tokenFile)}`,
		'audience = "person"',
	];
}

beforeAll(async () => {
	scope = await startScopeServer();
	desktop = await openDesktop({ deployment: desktopDeployment(await apps()) });
	await desktop.browser.execute(() => {
		const held = window as unknown as { loamMountEvents: unknown[] };
		held.loamMountEvents = [];
		window.addEventListener('loam:mount', (event) =>
			held.loamMountEvents.push((event as CustomEvent).detail)
		);
	});
	for (const instance of ['fixture', 'probe']) await untilInstance(desktop, instance, 'ready');
}, 240_000);

afterAll(async () => {
	await desktop?.close();
	await scope?.close();
});

describe('P6-D2: mounts over the Rust host', () => {
	it('P6-D2: a stdio AFD server, started from mounts.json, answers its command', async () => {
		const answer = await desktop.call('fixture-pid', {});
		expect(answer.success).toBe(true);
		expect(Number.isSafeInteger((answer.data as { pid: number }).pid)).toBe(true);
	});

	it('P6-D2: the http fixture receives the scope in _meta, with the bearer', async () => {
		const answer = await desktop.call('probe-scope-echo', {});
		expect(answer.success).toBe(true);
		expect(scope.seen.at(-1)).toMatchObject({
			tool: 'scope-echo',
			scope: { workspace: 'personal' },
		});
	});

	it('P6-D2: a notification arrives as the loam:mount event, intact, and executes nothing; one over 1 MiB and a server request are dropped', async () => {
		const answer = await desktop.call('fixture-notify', {});
		expect(answer.success).toBe(true);
		await desktop.browser.waitUntil(
			async () =>
				(await desktop.browser.execute(
					() => (window as unknown as { loamMountEvents: unknown[] }).loamMountEvents.length
				)) > 0,
			{ timeout: 5_000 }
		);
		// Anything the oversized one or the request would have sent has arrived by now.
		await new Promise((resolve) => setTimeout(resolve, 500));
		const events = (await desktop.browser.execute(
			() => (window as unknown as { loamMountEvents: unknown[] }).loamMountEvents
		)) as { handle: number; message: { method: string; params: Record<string, unknown> } }[];
		expect(events).toHaveLength(1);
		const [event] = events;
		expect(Number.isSafeInteger(event?.handle)).toBe(true);
		expect(event?.message).toEqual({
			jsonrpc: '2.0',
			method: 'notifications/message',
			params: { level: 'info', data: HOSTILE, [HOSTILE]: [HOSTILE] },
		});
		expect(
			await desktop.browser.execute(
				() => (window as unknown as { loamPwned?: unknown }).loamPwned ?? null
			)
		).toBeNull();
		expect(
			await desktop.browser.execute(() => document.querySelectorAll('body > script').length)
		).toBe(0);
	});

	it('P6-D2: the command line, the URL and the bearer never reach the DOM, the store or the journal', async () => {
		const secrets = [BEARER, scope.url, new URL(scope.url).host, NOTIFY_SERVER, PACKAGE];
		const seen = `${await pageText(desktop.browser)}\n${await storedText(desktop.browser)}`;
		for (const secret of secrets) expect(seen.includes(secret), secret).toBe(false);
		// The served projection, too.
		const projection = await desktop.browser.execute(async () =>
			(await fetch('/deployment.json')).text()
		);
		for (const secret of secrets) expect(projection.includes(secret), secret).toBe(false);
	});

	it('P6-D2: a killed child fails with MOUNT_UNREACHABLE, and the instance recovers', async () => {
		const first = await desktop.call('fixture-pid', {});
		const pid = (first.data as { pid: number }).pid;
		expect(Number.isSafeInteger(pid)).toBe(true);
		if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/F']);
		else process.kill(pid, 'SIGKILL');
		await new Promise((resolve) => setTimeout(resolve, 500));
		const failed = await desktop.call('fixture-pid', {});
		expect(failed.success).toBe(false);
		expect(failed.error?.code).toBe('MOUNT_UNREACHABLE');
		expect((await desktop.call('app-instance-refresh', { instance: 'fixture' })).success).toBe(
			true
		);
		await untilInstance(desktop, 'fixture', 'ready');
		const again = await desktop.call('fixture-pid', {});
		expect(again.success).toBe(true);
		expect((again.data as { pid: number }).pid).not.toBe(pid);
	});

	it('P6-D2: mount_open for an instance mounts.json does not list is refused', async () => {
		const refused = await desktop.browser.execute(async () => {
			const internals = (
				window as unknown as {
					__TAURI_INTERNALS__: { invoke(command: string, args: unknown): Promise<unknown> };
				}
			).__TAURI_INTERNALS__;
			try {
				await internals.invoke('mount_open', { instance: 'nowhere' });
				return 'opened';
			} catch (error) {
				return String(error);
			}
		});
		expect(refused).toBe('INSTANCE_UNKNOWN');
	});
});
