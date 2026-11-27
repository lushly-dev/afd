/**
 * P5-B3's Chromium half for `shell-open`'s mounted-ui slot (phase 5 specification, 9.3, T32): a mounted AFD server,
 * through the test relay, lists two `ui://` views and serves a third it does not list; its entry carries the deployer's
 * `views = true`. A person's `shell-open` renders the listed view in main, in `loam-view-frame`'s two frames on the
 * sandbox origin, and this suite holds, from inside those frames, what T32 asks: the outer frame has no `allow` (no
 * `tools`), the inner one is opaque, under the view CSP with `form-action 'none'`, with no permission; its broker answers
 * no `tools/call` and reads only the listed views; and the slot is the page's alone, so a reload shows none and fetches
 * nothing. Desktop's half is not here.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { success } from '@lushly-dev/afd-core';
import { createMcpHandler, defineCommand, MCP_APP_MIME_TYPE } from '@lushly-dev/afd-server';
import { type Browser, chromium, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { packUmbel, untilInstance } from '../../mounted/support';
import {
	type DeploymentSite,
	kernelCall,
	openShell,
	type ShellPage,
	serveDeployment,
	settle,
	surfacesIdle,
} from '../harness';

/** The view: it initializes, then waits for the test to speak for it through `window.rpc`. */
const VIEW = `<!doctype html>
<html lang="en">
	<head><meta charset="utf-8" /><title>Probe view</title></head>
	<body>
		<main><h1>Mounted probe</h1>
		<form action="https://example.com/collect" method="post"><input name="q" value="1" /></form></main>
		<script>
			const waiting = new Map();
			let next = 1;
			window.rpc = (method, params) => new Promise((resolve) => {
				const id = next++;
				waiting.set(id, resolve);
				parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
			});
			addEventListener('message', (event) => {
				const message = event.data;
				if (event.source !== parent || !waiting.has(message?.id)) return;
				waiting.get(message.id)(message);
				waiting.delete(message.id);
			});
			window.rpc('ui/initialize', {
				protocolVersion: '2026-01-26', appInfo: { name: 'probe', version: '0.1.0' }, appCapabilities: {},
			}).then(() => {
				parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
				window.ready = true;
			});
		</script>
	</body>
</html>`;
const OTHER = '<!doctype html><p>Another listed view</p>';
const SECRET = '<!doctype html><p>Served, never listed</p>';

/** A mounted AFD server with one command and `ui://` views, recording each read it is asked for. */
interface ViewServer {
	url: string;
	reads: string[];
	close(): Promise<void>;
}

async function startViewServer(prefix: string): Promise<ViewServer> {
	const reads: string[] = [];
	const served: Record<string, string> = {
		[`ui://${prefix}/thread`]: VIEW,
		[`ui://${prefix}/other`]: OTHER,
		[`ui://${prefix}/secret`]: SECRET,
	};
	const handler = createMcpHandler({
		name: 'loam-view-fixture',
		version: '0.0.0',
		commands: [
			defineCommand({
				name: `${prefix}-ping`,
				description: 'Answers pong, so a refused view call that reached it would show',
				mutation: false,
				expose: { mcp: true, palette: true, agent: true },
				input: z.object({}),
				handler: async () => success({ pong: true }),
			}),
		] as never,
		host: '127.0.0.1',
		toolStrategy: 'hybrid',
		firstClassTools: [`${prefix}-ping`],
		bootstrap: true,
		resources: {
			list: () =>
				['thread', 'other'].map((name) => ({
					uri: `ui://${prefix}/${name}`,
					name,
					mimeType: MCP_APP_MIME_TYPE,
				})),
			read(uri) {
				reads.push(uri);
				const content = served[uri];
				return content === undefined ? undefined : { content, mimeType: MCP_APP_MIME_TYPE };
			},
		},
	});
	const server: Server = createServer((incoming, outgoing) => handler(incoming, outgoing));
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/mcp`,
		reads,
		close: () =>
			new Promise((done) => {
				handler.dispose();
				server.closeAllConnections();
				server.close(() => done());
			}),
	};
}

let browser: Browser;
let directory: string;
let fixture: ViewServer;
/** A second mounted instance's server, whose views the first's slot must not read. */
let another: ViewServer;
let site: DeploymentSite;

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'loam-mounted-view-'));
	fixture = await startViewServer('probe');
	another = await startViewServer('other');
	const umbelPackage = await packUmbel();
	const entry = (instance: string, url: string) => [
		`[apps.${instance}]`,
		'app = "umbel"',
		`package = ${JSON.stringify(umbelPackage)}`,
		'transport = "http"',
		`prefix = ${JSON.stringify(instance)}`,
		`url = ${JSON.stringify(url)}`,
		'audience = "person"',
		// The deployer's opt-in (D169).
		'views = true',
		'',
	];
	site = await serveDeployment({
		sandbox: true,
		mounts: true,
		config: [
			'deployment_version = 4',
			'',
			...entry('probe', fixture.url),
			...entry('other', another.url),
		].join('\n'),
	});
	browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
	await browser?.close();
	await site?.close();
	await fixture?.close();
	await another?.close();
	await rm(directory, { recursive: true, force: true });
});

interface Answer {
	success: boolean;
	data?: Record<string, unknown>;
	error?: { code?: string; message?: string; suggestion?: string };
}

const target = (uri: string) => ({
	target: { kind: 'mounted-ui', instance: 'probe', uri, scope: { workspace: 'personal' } },
});

/** The slot's frame in main: its element, the proxy's frame, and the view's inside it. */
async function slotFrames(page: Page): Promise<{ outer: Frame; inner: Frame }> {
	const element = await page
		.locator('loam-main loam-view-frame[data-mounted-ui] iframe')
		.elementHandle();
	const outer = await element?.contentFrame();
	if (!outer) throw new Error('No outer frame');
	await expect.poll(() => outer.childFrames().length).toBe(1);
	const inner = outer.childFrames()[0] as Frame;
	await expect
		.poll(() => inner.evaluate(() => (window as { ready?: boolean }).ready === true))
		.toBe(true);
	return { outer, inner };
}

/** A request the view makes, and the shell's answer. */
const ask = (inner: Frame, method: string, params: unknown) =>
	inner.evaluate(
		({ method, params }) =>
			(
				window as unknown as {
					rpc(
						method: string,
						params: unknown
					): Promise<{ result?: unknown; error?: { data?: { code?: string } } }>;
				}
			).rpc(method, params),
		{ method, params }
	);

async function openView(): Promise<ShellPage> {
	const opened = await openShell(browser, site.origin);
	await untilInstance(opened.page, 'probe', 'ready');
	const answer = (await kernelCall(
		opened.page,
		'shell-open',
		target('ui://probe/thread')
	)) as Answer;
	expect(answer.success, JSON.stringify(answer.error)).toBe(true);
	expect(answer.data).toMatchObject({ changed: true });
	// The answer names the view; its HTML went to the slot alone.
	expect(JSON.stringify(answer)).not.toContain('Mounted probe');
	await surfacesIdle(opened.page);
	return opened;
}

describe('P5-B3: the mounted-ui slot in Chromium (T32)', () => {
	it('renders the listed view in two frames on the sandbox origin: no tools, opaque, no form, no permission', async () => {
		const opened = await openView();
		const { page } = opened;
		const { outer, inner } = await slotFrames(page);
		const frame = page.locator('loam-main loam-view-frame[data-mounted-ui] iframe');
		// The outer frame: the proxy on the sandbox origin, and no `allow`, so no `tools` and no permission delegated.
		expect(await frame.getAttribute('allow')).toBeNull();
		expect(await frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms');
		expect(new URL(outer.url()).origin).toBe(site.sandbox?.origin);
		expect(new URL(outer.url()).pathname).toBe('/sandbox/proxy.html');
		// The inner frame: `srcdoc`, no `allow-same-origin`, no `allow`.
		const innerAttributes = await outer.evaluate(() => {
			const element = document.querySelector('iframe') as HTMLIFrameElement;
			return {
				sandbox: element.getAttribute('sandbox'),
				allow: element.getAttribute('allow'),
				srcdoc: element.hasAttribute('srcdoc'),
			};
		});
		expect(innerAttributes).toEqual({
			sandbox: 'allow-scripts allow-forms',
			allow: null,
			srcdoc: true,
		});
		const inside = await inner.evaluate(() => {
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
			return {
				origin: origin,
				text: document.querySelector('h1')?.textContent,
				csp: document
					.querySelector('meta[http-equiv="Content-Security-Policy"]')
					?.getAttribute('content'),
				policy: policy !== undefined,
				allowed: features.filter((name) => policy?.allowsFeature(name)),
			};
		});
		expect(inside.origin).toBe('null');
		expect(inside.text).toBe('Mounted probe');
		expect(inside.csp).toContain("form-action 'none'");
		expect(inside.csp).toContain("default-src 'none'");
		expect(inside.csp).toContain("connect-src 'none'");
		expect(inside.policy).toBe(true);
		expect(inside.allowed).toEqual([]);
		expect(opened.errors).toEqual([]);
		// It cannot navigate the shell's page, nor read it.
		const before = page.url();
		const topRead = await inner.evaluate((shell) => {
			// Whether the engine throws here or refuses quietly, the page staying where it was is the guarantee (below).
			try {
				(top as Window).location.href = `${shell}/?hijacked`;
			} catch {}
			try {
				return (top as Window).document.title;
			} catch (cause) {
				return (cause as Error).name;
			}
		}, site.origin);
		expect(topRead).toBe('SecurityError');
		await page.waitForTimeout(300);
		expect(page.url()).toBe(before);
		// An engine may report the refused navigation on the console: that, and only that.
		opened.errors = opened.errors.filter(
			(error) => !error.startsWith('Unsafe attempt to initiate navigation')
		);
		expect(opened.errors).toEqual([]);
		// A form posts nowhere: `form-action 'none'` (asserted in the policy above) refuses it in the view's frame, and the
		// proxy's `frame-src` behind it. Which of the two reports first, and whether the view's report survives its frame
		// leaving, varies with load; that a policy refused it and nothing left for its action does not.
		const left: string[] = [];
		opened.context.on('request', (request) => {
			if (new URL(request.url()).hostname === 'example.com') left.push(request.url());
		});
		await inner.evaluate(() => (document.querySelector('form') as HTMLFormElement).submit());
		await expect
			.poll(
				() =>
					opened.violationFrames.filter(({ violation }) =>
						/^CSP violation: (form-action https:\/\/example\.com\/collect|frame-src https:\/\/example\.com)/.test(
							violation
						)
					).length,
				{ timeout: 10_000 }
			)
			.toBeGreaterThan(0);
		await page.waitForTimeout(500);
		expect(left).toEqual([]);
		await opened.context.close();
	});

	it('answers no tools/call, and reads only the views its instance lists', async () => {
		const opened = await openView();
		const { page } = opened;
		const { inner } = await slotFrames(page);
		/** The tool calls the relay carried to the server, discovery's included. */
		const toolCalls = () =>
			(site.relay?.log ?? []).filter(({ rpc }) => rpc?.method === 'tools/call').length;
		const before = toolCalls();
		// Zero tools: its own instance's, another's, the shell's, by any name.
		for (const name of ['probe-ping', 'afd-call', 'app-list', 'shell-open', 'toast-show']) {
			const refused = await ask(inner, 'tools/call', { name, arguments: {} });
			expect(refused.result, name).toBeUndefined();
			expect(refused.error?.data?.code, name).toBe('VIEW_CALL_REFUSED');
		}
		expect(toolCalls()).toBe(before);
		// A listed view reads; one the server would serve but does not list, another scheme, or none, is refused.
		const listed = (await ask(inner, 'resources/read', { uri: 'ui://probe/other' })) as {
			result?: { contents: Array<{ uri: string; text: string }> };
		};
		expect(listed.result?.contents).toEqual([
			{ uri: 'ui://probe/other', mimeType: 'text/html;profile=mcp-app', text: OTHER },
		]);
		await untilInstance(page, 'other', 'ready');
		for (const uri of [
			'ui://other/thread',
			'ui://probe/secret',
			'https://example.com/x',
			`${site.origin}/deployment.json`,
			7,
		]) {
			const refused = await ask(inner, 'resources/read', { uri });
			expect(refused.result, String(uri)).toBeUndefined();
			expect(refused.error?.data?.code, String(uri)).toBe('VIEW_CALL_REFUSED');
		}
		expect(fixture.reads).not.toContain('ui://probe/secret');
		expect(another.reads).toEqual([]);
		// What a mounted view logs stays out of the page's console, as nothing it sent above reached it.
		await inner.evaluate(() =>
			parent.postMessage(
				{
					jsonrpc: '2.0',
					method: 'notifications/message',
					params: { level: 'error', data: 'mounted-view-log-marker' },
				},
				'*'
			)
		);
		expect(await ask(inner, 'ping', {})).toMatchObject({ result: {} });
		await page.waitForTimeout(200);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('holds the slot transiently: another open replaces it, and a reload shows none and fetches nothing', async () => {
		const opened = await openView();
		const { page } = opened;
		await slotFrames(page);
		const slot = page.locator('loam-main loam-view-frame[data-mounted-ui]');
		// Main moved: the slot's frame goes.
		await kernelCall(page, 'section-open', { section: 'inbox' });
		await surfacesIdle(page);
		await expect.poll(() => slot.count()).toBe(0);
		// A change of person drops it, with no app open.
		expect(
			((await kernelCall(page, 'shell-open', target('ui://probe/thread'))) as Answer).success
		).toBe(true);
		await expect.poll(() => slot.count()).toBe(1);
		await kernelCall(page, 'auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'x',
		});
		await surfacesIdle(page);
		await expect.poll(() => slot.count()).toBe(0);
		await kernelCall(page, 'auth-sign-out');
		await surfacesIdle(page);
		// Open again, then reload: the slot was the page's alone.
		expect(
			((await kernelCall(page, 'shell-open', target('ui://probe/thread'))) as Answer).success
		).toBe(true);
		await expect.poll(() => slot.count()).toBe(1);
		const reads = fixture.reads.length;
		const relayed = site.relay?.log.length ?? 0;
		await page.reload();
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await untilInstance(page, 'probe', 'ready');
		await settle(page);
		await surfacesIdle(page);
		await page.waitForTimeout(500);
		expect(await slot.count()).toBe(0);
		expect(
			await page.evaluate(
				() =>
					document
						.querySelector('loam-shell')
						?.shadowRoot?.querySelector('loam-main')
						?.hasAttribute('data-mounted-ui') ?? false
			)
		).toBe(false);
		expect(fixture.reads.length).toBe(reads);
		// The relay carried no read of a resource since the reload, only the instance's own discovery.
		const since = (site.relay?.log ?? []).slice(relayed);
		expect(since.filter(({ rpc }) => rpc?.method === 'resources/read')).toEqual([]);
		await opened.context.close();
	});
});
