/**
 * P5-B3's desktop half for `shell-open`'s mounted-ui slot (phase 5 specification, 9.3, T32; #2894): the Chromium half's
 * mounted AFD server (`web/test/mounted/view-server.ts`), reached by the Rust host through the test relay so each
 * request it carried is logged, lists two `ui://` views and serves a third it does not list; its entry carries the
 * deployer's `views = true` (D169). A person's `shell-open` renders the listed view in main, in `loam-view-frame`'s two
 * frames on `loam-sandbox`: the outer one with no `allow`, the inner one an opaque `srcdoc` under the view CSP with
 * `form-action 'none'` and no permission. Its broker answers no `tools/call` (`VIEW_CALL_REFUSED`), and the slot is the
 * page's alone, so a reload shows none and fetches nothing. Nothing of the view reaches the app's stderr.
 *
 * Like the rest of this suite, it runs a deployment `loam deployment write --host desktop` wrote (`cli` mode), not a
 * managed one: the managed materializer's `views` and `frame-src` are covered by `materialize_tests.rs` alone.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMountRelay, type MountRelay } from '../../web/test/mounted/mount-relay';
import {
	OTHER,
	startViewServer,
	VIEW_HEADING,
	type ViewServer,
} from '../../web/test/mounted/view-server';
import { leaveFrames } from './frames';
import {
	type CommandResultLike,
	type Desktop,
	desktopDeployment,
	LOAM,
	ORIGINS,
	openDesktop,
	type PageJobState,
	packApp,
	pollPageJob,
	untilInstance,
} from './harness';

/** `loam-view-frame`'s outer frame sandbox (`chrome/src/view/channel.ts`'s `PROXY_SANDBOX`). */
const PROXY_SANDBOX = 'allow-scripts allow-same-origin allow-forms';
const LOG_MARKER = 'mounted-view-log-marker';

let desktop: Desktop;
let fixture: ViewServer;
let relay: MountRelay;
let front: Server;
/** What reached the form's address, which `form-action 'none'` must keep empty. */
const collected: string[] = [];

/** The relay at `/mounts/probe/mcp`, and the form's address beside it at `/collect`. */
async function startFront(): Promise<string> {
	front = createServer((request, response) => {
		if (relay?.handle(request, response)) return;
		collected.push(request.url ?? '');
		response.writeHead(204).end();
	});
	await new Promise<void>((done) => front.listen(0, '127.0.0.1', done));
	return `http://127.0.0.1:${(front.address() as AddressInfo).port}`;
}

beforeAll(async () => {
	const origin = await startFront();
	fixture = await startViewServer('probe', { formAction: `${origin}/collect` });
	relay = createMountRelay([{ instance: 'probe', url: fixture.url }]);
	const umbel = await packApp(join(LOAM, 'packages/web/test/mounted/apps/umbel'));
	desktop = await openDesktop({
		deployment: desktopDeployment([
			'[apps.probe]',
			'app = "umbel"',
			`package = ${JSON.stringify(umbel)}`,
			'prefix = "probe"',
			'transport = "http"',
			`url = ${JSON.stringify(`${origin}/mounts/probe/mcp`)}`,
			'audience = "person"',
			// The deployer's opt-in (D169).
			'views = true',
		]),
	});
	await untilInstance(desktop, 'probe', 'ready');
}, 240_000);

afterAll(async () => {
	await desktop?.close();
	relay?.abort();
	await new Promise<void>((done) => {
		if (!front) return done();
		front.closeAllConnections();
		front.close(() => done());
	});
	await fixture?.close();
});

/**
 * Script text that finds the slot's `loam-view-frame` in main and its outer `<iframe>`. Text, since WebDriver sends a
 * function's source alone, without what it closes over.
 */
const SLOT_SCRIPT = `
	const main = document.querySelector('loam-shell')?.shadowRoot?.querySelector('loam-main') ?? null;
	const slot = main?.querySelector('loam-view-frame[data-mounted-ui]') ?? null;
	const outer = slot?.shadowRoot?.querySelector('iframe') ?? slot?.querySelector('iframe') ?? null;`;

const slotCount = (): Promise<number> =>
	desktop.browser.execute(
		`${SLOT_SCRIPT} return main?.querySelectorAll('loam-view-frame[data-mounted-ui]').length ?? 0;`
	) as Promise<number>;

const target = (uri: string) => ({
	target: { kind: 'mounted-ui', instance: 'probe', uri, scope: { workspace: 'personal' } },
});

/**
 * Opens the listed view in a fresh slot, and holds that its HTML went to the slot alone. An earlier test's slot goes
 * first: main moving drops it, and opening the view it shows changes nothing.
 */
async function openView(): Promise<void> {
	await leaveFrames(desktop);
	if ((await slotCount()) > 0) {
		expect((await desktop.call('section-open', { section: 'inbox' })).success).toBe(true);
		await desktop.browser.waitUntil(async () => (await slotCount()) === 0, { timeout: 20_000 });
	}
	const answer = await desktop.call('shell-open', target('ui://probe/thread'));
	expect(answer.success, JSON.stringify(answer.error)).toBe(true);
	expect(answer.data).toMatchObject({ changed: true });
	expect(JSON.stringify(answer)).not.toContain(VIEW_HEADING);
	await desktop.browser.waitUntil(
		async () => (await desktop.browser.execute(`${SLOT_SCRIPT} return outer !== null;`)) === true,
		{ timeout: 20_000 }
	);
}

/** Into the slot's outer frame, then, with `inner`, into the view's, waiting for it to initialize. */
async function enterSlot(inner: boolean): Promise<void> {
	const { browser } = desktop;
	await browser.switchFrame((await browser.execute(`${SLOT_SCRIPT} return outer;`)) as never);
	if (!inner) return;
	await browser.waitUntil(() => browser.execute(() => document.querySelector('iframe') !== null), {
		timeout: 10_000,
	});
	await browser.switchFrame(await browser.$('iframe'));
	await browser.waitUntil(
		() => browser.execute(() => (window as unknown as { ready?: boolean }).ready === true),
		{ timeout: 20_000 }
	);
}

interface RpcAnswer {
	result?: unknown;
	error?: { data?: { code?: string } };
}

/**
 * A request the view makes through its `window.rpc`, and the shell's answer: started by a synchronous execute in the
 * view's frame and polled there, since WebKitWebDriver can hang on `execute/async` (#2656).
 */
async function ask(method: string, params: unknown): Promise<RpcAnswer> {
	const { browser } = desktop;
	const text = await pollPageJob(
		browser,
		() =>
			browser.execute(
				(method: string, params: unknown): number => {
					const holder = window as unknown as {
						__loamJobs?: Map<number, PageJobState>;
						__loamJobSeq?: number;
						rpc(method: string, params: unknown): Promise<unknown>;
					};
					holder.__loamJobs ??= new Map();
					const id = (holder.__loamJobSeq ?? 0) + 1;
					holder.__loamJobSeq = id;
					const entry: PageJobState = { status: 'pending' };
					holder.__loamJobs.set(id, entry);
					void holder.rpc(method, params).then(
						(answer) => {
							entry.status = 'done';
							entry.value = JSON.stringify(answer);
						},
						(cause: unknown) => {
							entry.status = 'failed';
							entry.failureMessage = String(cause);
						}
					);
					return id;
				},
				method,
				params
			),
		{ label: `view ${method}`, timeoutMs: 20_000 }
	);
	return JSON.parse(text) as RpcAnswer;
}

/** The `tools/call` requests the relay carried to the server, discovery's included. */
const toolCalls = () => relay.log.filter(({ rpc }) => rpc?.method === 'tools/call').length;

describe('P5-B3: the mounted-ui slot on the desktop (T32)', () => {
	it('P5-B3: renders the listed view in two frames on loam-sandbox: no allow, opaque srcdoc, no form, no permission', async () => {
		await openView();
		const { browser } = desktop;
		// The outer frame: the proxy on the sandbox origin, with no `allow`, so no `tools` and no permission delegated.
		const outer = (await browser.execute(
			`${SLOT_SCRIPT} return outer && { src: outer.getAttribute('src'), allow: outer.getAttribute('allow'), sandbox: outer.getAttribute('sandbox') };`
		)) as { src: string; allow: string | null; sandbox: string | null };
		expect(outer.allow).toBeNull();
		expect(outer.sandbox).toBe(PROXY_SANDBOX);
		const src = new URL(outer.src);
		expect(src.origin === 'null' ? `${src.protocol}//${src.host}` : src.origin).toBe(
			ORIGINS.sandbox
		);
		expect(src.pathname).toBe('/sandbox/proxy.html');
		const page = await browser.getUrl();

		await enterSlot(false);
		expect(await browser.execute(() => self.origin)).toBe(ORIGINS.sandbox);
		// The inner frame: `srcdoc`, no `allow-same-origin`, no `allow`.
		expect(
			await browser.execute(() => {
				const element = document.querySelector('iframe') as HTMLIFrameElement;
				return {
					sandbox: element.getAttribute('sandbox'),
					allow: element.getAttribute('allow'),
					srcdoc: element.hasAttribute('srcdoc'),
				};
			})
		).toEqual({ sandbox: 'allow-scripts allow-forms', allow: null, srcdoc: true });
		await leaveFrames(desktop);

		await enterSlot(true);
		const inside = await browser.execute(() => {
			const policy =
				(
					document as unknown as {
						permissionsPolicy?: { allowsFeature(name: string): boolean };
						featurePolicy?: { allowsFeature(name: string): boolean };
					}
				).permissionsPolicy ??
				(document as unknown as { featurePolicy?: { allowsFeature(name: string): boolean } })
					.featurePolicy;
			const features = [
				'camera',
				'microphone',
				'geolocation',
				'clipboard-read',
				'clipboard-write',
				'display-capture',
				'payment',
				'usb',
				'fullscreen',
			];
			let top: string;
			try {
				top = String((window.top as Window).document.title);
			} catch (cause) {
				top = (cause as Error).name;
			}
			return {
				origin: self.origin,
				text: document.querySelector('h1')?.textContent ?? null,
				csp:
					document
						.querySelector('meta[http-equiv="Content-Security-Policy"]')
						?.getAttribute('content') ?? '',
				// WebKitGTK has no permissions policy API; where an engine has one, it allows nothing.
				allowed: policy ? features.filter((name) => policy.allowsFeature(name)) : [],
				top,
			};
		});
		expect(inside.origin).toBe('null');
		expect(inside.text).toBe(VIEW_HEADING);
		expect(inside.csp).toContain("form-action 'none'");
		expect(inside.csp).toContain("default-src 'none'");
		expect(inside.csp).toContain("connect-src 'none'");
		expect(inside.allowed).toEqual([]);
		// It cannot read the shell's page.
		expect(inside.top).toBe('SecurityError');
		// Its form posts nowhere: `form-action 'none'` (above) refuses it, and nothing reaches the form's address.
		await browser.execute(() => {
			try {
				(window.top as Window).location.href = 'about:blank#hijacked';
			} catch {}
			(document.querySelector('form') as HTMLFormElement).submit();
		});
		await new Promise((resolve) => setTimeout(resolve, 1_500));
		await leaveFrames(desktop);
		expect(collected).toEqual([]);
		// Nor did it navigate the shell's page.
		expect(await browser.getUrl()).toBe(page);
	});

	it('P5-B3: answers no tools/call, reads only the views its instance lists, and logs nothing the view sends', async () => {
		await openView();
		await enterSlot(true);
		const before = toolCalls();
		// Zero tools: its own instance's, the shell's, by any name.
		for (const name of ['probe-ping', 'afd-call', 'app-list', 'shell-open', 'toast-show']) {
			const refused = await ask('tools/call', { name, arguments: {} });
			expect(refused.result, name).toBeUndefined();
			expect(refused.error?.data?.code, name).toBe('VIEW_CALL_REFUSED');
		}
		expect(toolCalls()).toBe(before);
		// A listed view reads; one the server would serve but does not list, another scheme, or none, is refused.
		const listed = (await ask('resources/read', { uri: 'ui://probe/other' })) as {
			result?: { contents: Array<{ uri: string; text: string }> };
		};
		expect(listed.result?.contents).toEqual([
			{ uri: 'ui://probe/other', mimeType: 'text/html;profile=mcp-app', text: OTHER },
		]);
		for (const uri of ['ui://probe/secret', 'https://example.com/x', `${ORIGINS.shell}/x`, 7]) {
			const refused = await ask('resources/read', { uri });
			expect(refused.result, String(uri)).toBeUndefined();
			expect(refused.error?.data?.code, String(uri)).toBe('VIEW_CALL_REFUSED');
		}
		expect(fixture.reads).not.toContain('ui://probe/secret');
		// What a mounted view logs stays out of the app's stderr, as nothing of its HTML does.
		await desktop.browser.execute((marker: string) => {
			parent.postMessage(
				{
					jsonrpc: '2.0',
					method: 'notifications/message',
					params: { level: 'error', data: marker },
				},
				'*'
			);
		}, LOG_MARKER);
		expect(await ask('ping', {})).toMatchObject({ result: {} });
		await leaveFrames(desktop);
		await new Promise((resolve) => setTimeout(resolve, 300));
		const logged = desktop.stderr.lines.join('\n');
		expect(logged.includes(LOG_MARKER)).toBe(false);
		expect(logged.includes(VIEW_HEADING)).toBe(false);
	});

	it('P5-B3: holds the slot transiently: a reload shows none and fetches nothing', async () => {
		await openView();
		expect(await slotCount()).toBe(1);
		const reads = fixture.reads.length;
		const relayed = relay.log.length;
		await desktop.browser.refresh();
		await desktop.ready();
		await untilInstance(desktop, 'probe', 'ready');
		await new Promise((resolve) => setTimeout(resolve, 1_000));
		expect(await slotCount()).toBe(0);
		expect(
			await desktop.browser.execute(
				`${SLOT_SCRIPT} return main?.hasAttribute('data-mounted-ui') ?? false;`
			)
		).toBe(false);
		expect(fixture.reads.length).toBe(reads);
		// The relay carried no read of a resource since the reload, only the instance's own discovery.
		const since = relay.log.slice(relayed);
		expect(since.filter(({ rpc }) => rpc?.method === 'resources/read')).toEqual([]);
		// And the slot answers as it did before, so a still count is not a broken path.
		const again: CommandResultLike = await desktop.call('shell-open', target('ui://probe/thread'));
		expect(again.success, JSON.stringify(again.error)).toBe(true);
		await desktop.browser.waitUntil(async () => (await slotCount()) === 1, { timeout: 20_000 });
	});
});
