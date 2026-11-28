/**
 * P5-B2's Chromium half (phase 5 specification, 9.2): the bus reaches an app's surfaces in a real page. Two fixture apps
 * hold the `events` grant, written here and served by this suite alone: `busfix`, native, whose main element listens
 * with `eventsChanged` and catches up with `context.events.list({ since })`, as 9.2's consumer does; and `busview`, a
 * view, whose frame hears `ui/notifications/host-context-changed` with `dev.loam/eventsChanged` and catches up with
 * `event-list` through `tools/call`. Each hears one hint after its own mutation, reads that event and no other from its
 * cursor, and hears nothing for hello's mutation, which it may not read, though the person's workspace stream shows it.
 * The kernel's units hold the filtering and coalescing; the chrome's units (`surface-calls.test.ts`) the delivery.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appPack } from '@lushly-dev/loam-cli';
import { type Browser, chromium, type Frame, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundlePage } from '../bundle';
import {
	type DeploymentSite,
	deploymentEntry,
	deploymentFile,
	kernelCall,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	surfacesIdle,
} from '../harness';

interface EventRow {
	kind: string;
	instance?: string;
	command?: string;
}
interface Hint {
	kinds: string[];
	instances?: string[];
	cursor: string;
}

/** `busfix`'s manifest: the `events` grant, one mutation, and a main element. */
const NATIVE_MANIFEST = `manifest_version = 2
protocol = 1
afd_contract = "1.0"

[plugin]
id = "busfix"
title = "Bus fixture"
version = "0.1.0"
description = "A native fixture that hears the bus through its main surface."
kind = "native"
domains = ["busfix"]
license = "MIT"

[native]
entry = "dist/native.js"

[app]
scope_levels = ["workspace"]

[[grants]]
name = "events"
reason = "Catches up on what changed in it."

[[grants]]
name = "store"
reason = "Declares its one mutation's effect."

[[commands]]
name = "busfix-bump"
title = "Bump"
description = "A mutation that writes nothing, so the bus projects one event for it."
effects = ["store-write"]
input_schema = { type = "object", properties = {}, additionalProperties = false }

[ui]
compositions = ["console"]

[ui.surfaces.rail]
label = "Bus fixture"
icon = "system/document"

[ui.surfaces.main]
element = "busfix-main"
`;

/**
 * `busfix`'s module, with no SDK: its element reads the head when it connects, and on each hint records it and catches
 * up from its cursor, keeping what it read.
 */
const NATIVE_MODULE = `export default {
	sdk: 1,
	handlers: { 'busfix-bump': async () => ({ success: true, data: { bumped: true } }) },
	activate(context) {
		if (context.registry.get('busfix-main')) return;
		context.registry.define('busfix-main', class extends HTMLElement {
			heard = [];
			caught = [];
			cursor = undefined;
			ready = false;
			async connectedCallback() {
				const status = document.createElement('p');
				status.textContent = 'Listening';
				this.append(status);
				const head = await this.context.events.list();
				this.cursor = head.cursor;
				this.ready = true;
			}
			eventsChanged(hint) {
				this.heard.push(hint);
				void this.context.events.list({ since: this.cursor }).then((page) => {
					this.caught.push(...page.events);
					this.cursor = page.cursor;
				});
			}
		});
	},
};
`;

const RESOURCE = 'ui://busview/main';

/** `busview`'s manifest, as a package carries it: the `events` grant and one mutation its handlers answer. */
const VIEW_MANIFEST = {
	manifest_version: 2,
	protocol: 1,
	afd_contract: '1.0',
	plugin: {
		id: 'busview',
		title: 'Bus view',
		version: '0.1.0',
		description: 'A view fixture that hears the bus through host-context-changed.',
		kind: 'view',
		domains: ['busview'],
		license: 'MIT',
	},
	view: { handlers: 'handlers.html' },
	app: { scope_levels: ['workspace'] },
	grants: [
		{ name: 'events', reason: 'Catches up on what changed in it.' },
		{ name: 'store', reason: "Declares its one mutation's effect." },
	],
	commands: [
		{
			name: 'busview-touch',
			title: 'Touch',
			description: 'A mutation that writes nothing, so the bus projects one event for it.',
			category: 'busview',
			effects: ['store-write'],
			input_schema: { type: 'object', properties: {}, additionalProperties: false },
		},
	],
	ui: {
		resources: [{ uri: RESOURCE, path: 'main.html' }],
		surfaces: { main: { resource: RESOURCE } },
	},
};

/** The view: it initializes, keeps every notification it hears, and lets the test speak for it through `window.rpc`. */
const VIEW = `<!doctype html>
<html lang="en">
	<head><meta charset="utf-8" /><title>Bus view</title></head>
	<body>
		<main><h1>Bus view</h1></main>
		<script>
			const waiting = new Map();
			let next = 1;
			window.notifications = [];
			window.rpc = (method, params) => new Promise((resolve) => {
				const id = next++;
				waiting.set(id, resolve);
				parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
			});
			addEventListener('message', (event) => {
				if (event.source !== parent) return;
				const message = event.data;
				if (message?.method && message.id === undefined) window.notifications.push(message);
				else if (message?.method) parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');
				else if (waiting.has(message?.id)) {
					waiting.get(message.id)(message);
					waiting.delete(message.id);
				}
			});
			window.rpc('ui/initialize', {
				protocolVersion: '2026-01-26', appInfo: { name: 'busview', version: '0.1.0' }, appCapabilities: {},
			}).then(() => {
				parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
				window.ready = true;
			});
		</script>
	</body>
</html>`;

const inlineScript = (source: string): string =>
	`<script>${source.replaceAll('</script', '<\\/script')}</script>`;

/**
 * Each wait spans the journal's write, the projection's batch, the push and, for a view, two frames' messages: an
 * explicit ceiling inside the 30 s `testTimeout`, since Vitest's 1 s default is too short under a hosted runner's load.
 */
const POLL = { timeout: 10_000 };

let browser: Browser;
let site: DeploymentSite;
let scratch: string;

beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), 'loam-bus-'));
	const native = join(scratch, 'busfix');
	await mkdir(join(native, 'dist'), { recursive: true });
	await writeFile(join(native, 'loam-app.toml'), NATIVE_MANIFEST);
	await writeFile(join(native, 'dist', 'native.js'), NATIVE_MODULE);
	const packed = await appPack({ dir: native, out: join(scratch, 'busfix-package') });
	if (!packed.out) throw new Error(JSON.stringify(packed.report.refusals));
	const view = join(scratch, 'busview');
	await mkdir(view, { recursive: true });
	await writeFile(join(view, 'app-manifest.json'), JSON.stringify(VIEW_MANIFEST));
	await writeFile(
		join(view, 'handlers.html'),
		`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Handlers</title></head><body>${inlineScript(await bundlePage('bus-handlers'))}</body></html>`
	);
	await writeFile(join(view, 'main.html'), VIEW);
	site = await serveDeployment({
		sandbox: true,
		config: deploymentFile(
			deploymentEntry('hello', await packApp('hello')),
			deploymentEntry('busfix', packed.out),
			deploymentEntry('busview', view)
		),
	});
	browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
	await browser?.close();
	await site?.close();
	if (scratch) await rm(scratch, { recursive: true, force: true });
});

interface Listed {
	success: boolean;
	data?: { events: EventRow[]; cursor: string };
	error?: { code?: string };
}

/**
 * Hello's mutation, which neither fixture may read, until the person's workspace stream shows it projected, so a hint
 * for it would have been pushed by now.
 */
async function helloGreets(page: Page): Promise<void> {
	const head = (await kernelCall(page, 'event-list', {})) as Listed;
	expect(head.success).toBe(true);
	const greeted = (await kernelCall(page, 'hello-greet', { name: 'Ada' })) as { success: boolean };
	expect(greeted.success).toBe(true);
	await expect
		.poll(async () => {
			const after = (await kernelCall(page, 'event-list', { since: head.data?.cursor })) as Listed;
			return after.data?.events.map(({ kind, instance }) => `${kind}:${instance}`);
		}, POLL)
		.toEqual(['app-mutated:hello']);
	await surfacesIdle(page);
}

/** What `busfix-main` has heard, read, and its cursor. */
const nativeState = (page: Page) =>
	page.locator('loam-main busfix-main').evaluate((element) => {
		const { heard, caught, cursor, ready } = element as unknown as {
			heard: Hint[];
			caught: EventRow[];
			cursor?: string;
			ready: boolean;
		};
		return { heard, caught, cursor, ready };
	});

/** The view's frame inside the proxy's, once it has initialized. */
async function viewFrame(page: Page): Promise<Frame> {
	const element = await page.locator('loam-main loam-view-frame iframe').elementHandle();
	const outer = await element?.contentFrame();
	if (!outer) throw new Error('No outer frame');
	await expect.poll(() => outer.childFrames().length, POLL).toBe(1);
	const inner = outer.childFrames()[0] as Frame;
	await expect
		.poll(() => inner.evaluate(() => (window as { ready?: boolean }).ready === true), POLL)
		.toBe(true);
	return inner;
}

/** The `dev.loam/eventsChanged` hints the view has heard, in order. */
const viewHints = (inner: Frame) =>
	inner.evaluate(() =>
		(
			window as unknown as {
				notifications: Array<{ method: string; params?: Record<string, unknown> }>;
			}
		).notifications
			.filter(
				({ method, params }) =>
					method === 'ui/notifications/host-context-changed' &&
					params?.['dev.loam/eventsChanged'] !== undefined
			)
			.map(({ params }) => params?.['dev.loam/eventsChanged'] as Hint)
	);

/** `event-list` from inside the view, as its own `tools/call`. */
const viewList = (inner: Frame, since?: string) =>
	inner.evaluate(
		async (since) => {
			const answer = (await (
				window as unknown as {
					rpc(
						method: string,
						params: unknown
					): Promise<{ result?: { structuredContent?: Listed } }>;
				}
			).rpc('tools/call', {
				name: 'event-list',
				arguments: since === undefined ? {} : { since },
			})) as { result?: { structuredContent?: Listed } };
			return answer.result?.structuredContent;
		},
		since as string | undefined
	);

describe('P5-B2: the bus wakes an app’s surfaces in Chromium (9.2)', () => {
	it('P5-B2: a native surface hears one hint for its own mutation, catches up from its cursor, and hears nothing it may not read', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'busfix');
		await expect.poll(async () => (await nativeState(page)).ready, POLL).toBe(true);
		const start = (await nativeState(page)).cursor;
		expect(start).toMatch(/^v1\.\d+$/);
		expect((await nativeState(page)).heard).toEqual([]);

		// Its own mutation: one hint, naming the kind and the instance, then one event read from the cursor.
		const bumped = (await kernelCall(page, 'busfix-bump', {})) as { success: boolean };
		expect(bumped.success).toBe(true);
		await expect.poll(async () => (await nativeState(page)).caught.length, POLL).toBe(1);
		await surfacesIdle(page);
		const woke = await nativeState(page);
		expect(woke.heard).toEqual([
			{ kinds: ['app-mutated'], instances: ['busfix'], cursor: expect.stringMatching(/^v1\./) },
		]);
		expect(woke.caught).toEqual([
			expect.objectContaining({ kind: 'app-mutated', instance: 'busfix', command: 'busfix-bump' }),
		]);
		expect(woke.cursor).toBe(woke.heard[0]?.cursor);
		expect(woke.cursor).not.toBe(start);

		// Hello's mutation is projected, and the surface reads nothing new from its cursor and hears nothing.
		await helloGreets(page);
		const after = await nativeState(page);
		const caughtUp = (await page.locator('loam-main busfix-main').evaluate((element, since) => {
			const { context } = element as unknown as {
				context: { events: { list(options: { since?: string }): Promise<unknown> } };
			};
			return context.events.list({ since });
		}, after.cursor)) as { events: EventRow[]; cursor: string };
		expect(caughtUp.events).toEqual([]);
		expect(caughtUp.cursor).toBe(after.cursor);
		expect((await nativeState(page)).heard).toHaveLength(1);

		// A barrier that needs no timing: its next mutation is the second hint it hears, naming itself alone, so no hint
		// for hello's came before it or was folded into it.
		await kernelCall(page, 'busfix-bump', {});
		await expect.poll(async () => (await nativeState(page)).caught.length, POLL).toBe(2);
		const again = await nativeState(page);
		expect(again.heard).toHaveLength(2);
		expect(again.heard[1]).toEqual({
			kinds: ['app-mutated'],
			instances: ['busfix'],
			cursor: again.cursor,
		});
		expect(again.caught.map(({ instance }) => instance)).toEqual(['busfix', 'busfix']);

		expect(opened.errors).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});

	it('P5-B2: a view hears dev.loam/eventsChanged for its own mutation, catches up through tools/call, and hears nothing it may not read', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await openApp(page, 'busview');
		const inner = await viewFrame(page);
		const head = await viewList(inner);
		expect(head?.success).toBe(true);
		const start = head?.data?.cursor as string;
		expect(start).toMatch(/^v1\.\d+$/);
		expect(await viewHints(inner)).toEqual([]);

		// Its own mutation, through its handlers: one hint, then one event from its cursor.
		const touched = (await kernelCall(page, 'busview-touch', {})) as { success: boolean };
		expect(touched.success).toBe(true);
		await expect.poll(async () => (await viewHints(inner)).length, POLL).toBe(1);
		await surfacesIdle(page);
		const hints = await viewHints(inner);
		expect(hints).toEqual([
			{ kinds: ['app-mutated'], instances: ['busview'], cursor: expect.stringMatching(/^v1\./) },
		]);
		const caught = await viewList(inner, start);
		expect(caught?.data?.events).toEqual([
			expect.objectContaining({
				kind: 'app-mutated',
				instance: 'busview',
				command: 'busview-touch',
			}),
		]);
		const cursor = caught?.data?.cursor as string;
		expect(cursor).toBe(hints[0]?.cursor);

		// Hello's mutation is projected, and the view reads nothing new from its cursor and hears nothing.
		await helloGreets(page);
		const none = await viewList(inner, cursor);
		expect(none?.data?.events).toEqual([]);
		expect(none?.data?.cursor).toBe(cursor);
		expect(await viewHints(inner)).toHaveLength(1);

		// The same barrier: its next mutation is the second hint it hears, naming itself alone.
		await kernelCall(page, 'busview-touch', {});
		await expect.poll(async () => (await viewHints(inner)).length, POLL).toBe(2);
		await surfacesIdle(page);
		const twice = await viewHints(inner);
		expect(twice).toHaveLength(2);
		expect(twice[1]).toEqual({
			kinds: ['app-mutated'],
			instances: ['busview'],
			cursor: expect.stringMatching(/^v1\./),
		});
		const last = await viewList(inner, cursor);
		expect(last?.data?.events.map(({ instance }) => instance)).toEqual(['busview']);
		expect(last?.data?.cursor).toBe(twice[1]?.cursor);

		expect(opened.errors).toEqual([]);
		expect(opened.violations).toEqual([]);
		await opened.context.close();
	});
});
