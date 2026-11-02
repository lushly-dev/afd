import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appPack } from '@lushly-dev/loam-cli';
import { writeDeployment } from '@lushly-dev/loam-cli/deployment';
import type { ProjectionV1 } from '@lushly-dev/loam-manifest';
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';

export const DIST = resolve(fileURLToPath(new URL('../../dist', import.meta.url)));

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
};

/** One request the harness's server answered: the server's log, which E1 and E5 read. */
export interface LoggedRequest {
	path: string;
	bytes: number;
	status: number;
}

/** Serves a directory over loopback HTTP, so the page's CSP applies as deployed. */
async function serveDirectory(
	root: string
): Promise<{ origin: string; log: LoggedRequest[]; close: () => Promise<void> }> {
	const log: LoggedRequest[] = [];
	const server: Server = createServer(async (request, response) => {
		const path = new URL(request.url ?? '/', 'http://localhost').pathname;
		const file = normalize(join(root, path === '/' ? 'index.html' : path));
		if (file !== root && !file.startsWith(root + sep)) {
			response.writeHead(403).end();
			return;
		}
		try {
			const body = await readFile(file);
			log.push({ path, bytes: body.length, status: 200 });
			response.writeHead(200, {
				'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
			});
			response.end(body);
		} catch {
			log.push({ path, bytes: 0, status: 404 });
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('No loopback address');
	return {
		origin: `http://127.0.0.1:${address.port}`,
		log,
		close: () =>
			new Promise((done) => {
				server.close(() => done());
				server.closeAllConnections();
			}),
	};
}

/** Serves the `vite build` output. */
export const serveDist = () => serveDirectory(DIST);

export const APPS = resolve(fileURLToPath(new URL('../../../../apps', import.meta.url)));

const packed = new Map<string, Promise<string>>();

/** `loam app pack` on an app's built source, once a run, in a temporary directory. */
export function packApp(app: 'hello' | 'tally'): Promise<string> {
	const held = packed.get(app);
	if (held) return held;
	const pack = (async () => {
		const out = join(await mkdtemp(join(tmpdir(), `loam-pack-${app}-`)), 'package');
		const result = await appPack({
			dir: join(APPS, app),
			...(app === 'hello' ? { manifest: 'manifests/native.toml' } : {}),
			out,
		});
		if (!result.out) throw new Error(JSON.stringify(result.report.refusals));
		return out;
	})();
	packed.set(app, pack);
	return pack;
}

export interface DeploymentSite {
	origin: string;
	log: LoggedRequest[];
	/** The directory `writeDeployment` wrote. */
	out: string;
	projection: ProjectionV1;
	close: () => Promise<void>;
}

/**
 * `writeDeployment` into a temporary directory, then served, as a deployer does (phase 1 specification,
 * section 14). `config` is the file's text: a relative `package` is relative to that directory, so a
 * test names an absolute one. Step 5 adds the sandbox origin, and step 7 the relay.
 */
export async function serveDeployment(options: { config: string }): Promise<DeploymentSite> {
	const directory = await mkdtemp(join(tmpdir(), 'loam-deployment-'));
	const config = join(directory, 'loam.deployment.toml');
	await writeFile(config, options.config);
	const out = join(directory, 'site');
	const written = await writeDeployment({ config, dist: DIST, out });
	if (!written.ok) throw new Error(JSON.stringify(written.refusals));
	const site = await serveDirectory(out);
	return {
		...site,
		out,
		projection: written.projection,
		async close() {
			await site.close();
			await rm(directory, { recursive: true, force: true });
		},
	};
}

/** One entry of a deployment file for a package at an absolute path. */
export function deploymentEntry(
	instance: string,
	directory: string,
	extra: Record<string, string | number> = {}
): string {
	return [
		`[apps.${instance}]`,
		`app = ${JSON.stringify(instance)}`,
		`package = ${JSON.stringify(directory)}`,
		...Object.entries(extra).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
	].join('\n');
}

export const deploymentFile = (...entries: string[]): string =>
	['deployment_version = 1', '', ...entries.map((entry) => `${entry}\n`)].join('\n');

// ─── Pages ─────────────────────────────────────────────────────────────────────

export interface ShellPage {
	context: BrowserContext;
	page: Page;
	/** CSP violations reported by the page, `directive blockedURI`. */
	violations: string[];
	/** Page errors and console errors. */
	errors: string[];
}

export const CSP_PROBE = () => {
	document.addEventListener('securitypolicyviolation', (event) =>
		console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`)
	);
};

/** Open a page in a fresh context that records CSP violations and errors. */
export async function openPage(
	browser: Browser,
	url: string,
	options: BrowserContextOptions = {},
	context?: BrowserContext
): Promise<ShellPage> {
	const owned =
		context ?? (await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options }));
	const page = await owned.newPage();
	const watched: ShellPage = { context: owned, page, violations: [], errors: [] };
	page.on('pageerror', (error) => watched.errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		if (message.text().startsWith('CSP violation')) watched.violations.push(message.text());
		else watched.errors.push(message.text());
	});
	await page.addInitScript(CSP_PROBE);
	await page.goto(url);
	await page.waitForFunction(() => document.documentElement.dataset.loamHost !== undefined);
	return watched;
}

/** Open the built shell and wait until it has read the kernel's state and loaded the palette. */
export async function openShell(
	browser: Browser,
	origin: string,
	options: BrowserContextOptions = {},
	context?: BrowserContext
): Promise<ShellPage> {
	const opened = await openPage(browser, origin, options, context);
	await opened.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
	await opened.page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			ready: Promise<void>;
			preparePalette(): Promise<unknown>;
		};
		await shell.ready;
		await shell.preparePalette();
	});
	await settle(opened.page);
	return opened;
}

export interface EntrySummary {
	seq: number;
	command: string;
	input: unknown;
	success: boolean;
	actor?: { kind: string; id?: string; label?: string };
	interface?: string;
}

/** The journal's entries, read through the shell's journal reader. */
export function journal(page: Page): Promise<EntrySummary[]> {
	return page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			journal: { read(): Promise<Record<string, unknown>[]> };
		};
		const entries = await shell.journal.read();
		return entries.map((entry) => ({
			seq: entry.seq as number,
			command: entry.command as string,
			input: entry.input,
			success: (entry.result as { success: boolean }).success,
			...(entry.actor ? { actor: entry.actor as EntrySummary['actor'] } : {}),
			interface: (entry.contextDigest as { interface?: string } | undefined)?.interface,
		}));
	});
}

/** Wait until the journal stops growing and two frames have passed. */
export async function settle(page: Page): Promise<void> {
	let last = -1;
	for (let attempt = 0; attempt < 40; attempt++) {
		const length = await page.evaluate(async () => {
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const shell = document.querySelector('loam-shell') as unknown as {
				journal: { read(): Promise<unknown[]> };
			};
			return (await shell.journal.read()).length;
		});
		if (length === last) return;
		last = length;
		await page.waitForTimeout(40);
	}
	throw new Error('The journal kept growing');
}

/** Call a command through `kernel.agent`, as the copilot will. */
export function agentCall(page: Page, name: string, input: unknown = {}) {
	return page.evaluate(
		async ({ name, input }) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { agent: { call(name: string, input: unknown): Promise<unknown> } };
			};
			return shell.kernel.agent.call(name, input);
		},
		{ name, input }
	);
}

export interface Layout {
	sidebar: { open: boolean; width: number };
	inspector: { open: boolean; width: number };
	panel: { open: boolean; height: number; maximized: boolean };
	compact: { drawer: 'sidebar' | 'inspector' | null; sheet: boolean };
}

/** `layout-get` through `kernel.agent` (journaled, so read it after counting entries). */
export async function layoutOf(page: Page): Promise<Layout> {
	const result = (await agentCall(page, 'layout-get')) as { data: Layout };
	return result.data;
}

export interface PartBox {
	present: boolean;
	mode: string | null;
	width: number;
	height: number;
	modal: boolean;
}

export type PartName =
	| 'titlebar'
	| 'rail'
	| 'tabbar'
	| 'sidebar'
	| 'main'
	| 'inspector'
	| 'panel'
	| 'statusbar';
export type Parts = Record<PartName, PartBox> & { layoutClass: string };

/** Each part's presence, mode, size, and whether it renders as an open modal dialog. */
export function parts(page: Page): Promise<Parts> {
	return page.evaluate(() => {
		const shell = document.querySelector('loam-shell') as HTMLElement;
		const root = shell.shadowRoot as ShadowRoot;
		const out: Record<string, unknown> = { layoutClass: shell.dataset.layoutClass };
		for (const tag of [
			'titlebar',
			'rail',
			'tabbar',
			'sidebar',
			'main',
			'inspector',
			'panel',
			'statusbar',
		]) {
			const element = root.querySelector(`loam-${tag}`) as HTMLElement | null;
			const dialog = element?.shadowRoot?.querySelector(
				'dialog.drawer'
			) as HTMLDialogElement | null;
			const box = (dialog?.open ? dialog : element)?.getBoundingClientRect();
			const present =
				!!element &&
				!element.hidden &&
				(dialog?.open === true || getComputedStyle(element).display !== 'none');
			out[tag] = {
				present,
				mode: element?.getAttribute('mode') ?? null,
				width: present ? Math.round(box?.width ?? 0) : 0,
				height: present ? Math.round(box?.height ?? 0) : 0,
				modal: dialog?.open === true && dialog.matches(':modal'),
			};
		}
		return out as Parts;
	});
}

const axeSource = readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

export interface AxeViolation {
	id: string;
	impact: string | null;
	help: string;
	nodes: { target: unknown[] }[];
}

/** Axe with the Health dashboard's tags (E4), over the whole document. */
export async function axe(page: Page): Promise<AxeViolation[]> {
	await page.evaluate(await axeSource);
	return page.evaluate(async () => {
		const runner = (
			window as unknown as {
				axe: {
					run: (context: Document, options: object) => Promise<{ violations: AxeViolation[] }>;
				};
			}
		).axe;
		const result = await runner.run(document, {
			runOnly: {
				type: 'tag',
				values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
			},
		});
		return result.violations.map(({ id, impact, help, nodes }) => ({
			id,
			impact,
			help,
			nodes: nodes.map((node) => ({ target: node.target })),
		}));
	});
}

/** The deepest focused element, through shadow roots: its tag, its host's tag and its role. */
export function focused(page: Page) {
	return page.evaluate(() => {
		let element: Element | null = document.activeElement;
		const hosts: string[] = [];
		while (element?.shadowRoot?.activeElement) {
			hosts.push(element.tagName.toLowerCase());
			element = element.shadowRoot.activeElement;
		}
		return {
			tag: element?.tagName.toLowerCase() ?? '',
			hosts,
			part: (element as HTMLElement | null)?.dataset?.part ?? null,
			role: element?.getAttribute('role') ?? null,
			label: element?.getAttribute('aria-label') ?? element?.textContent?.trim() ?? '',
		};
	});
}

/** A kernel call as the person's interface makes it. */
export function kernelCall(page: Page, name: string, input: unknown = {}) {
	return page.evaluate(
		async ({ name, input }) => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: { call(name: string, input: unknown): Promise<unknown> };
			};
			return shell.kernel.call(name, input);
		},
		{ name, input }
	);
}

/** What the page's app surfaces have rendered of the kernel's events so far. */
export async function surfacesIdle(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			apps: { idle: Promise<void> } | null;
		};
		await shell.apps?.idle;
	});
	await settle(page);
}

/** An app's surfaces are in: its main's mount holds its element, or main explains it. */
export async function openApp(page: Page, instance: string): Promise<void> {
	await page.locator(`loam-rail loam-app-entry[instance="${instance}"] button`).click();
	await page.waitForFunction((instance) => {
		const main = document
			.querySelector('loam-shell')
			?.shadowRoot?.querySelector('loam-main') as HTMLElement | null;
		return main?.dataset.app === instance && !main.hasAttribute('aria-busy');
	}, instance);
	await surfacesIdle(page);
}

/**
 * Each resource the page requested before its first paint, by path, from its own timings. It reads
 * `first-contentful-paint`, the frame with the parts in it: `first-paint` is the theme's background on
 * an empty body, a moment that depends on the machine and says nothing of what loaded.
 */
export function requestedBeforeFirstPaint(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const paint = performance.getEntriesByName('first-contentful-paint')[0];
		if (!paint) throw new Error('The page reported no first paint');
		const entries = performance.getEntriesByType('resource');
		return [
			new URL(location.href).pathname,
			...entries
				.filter((entry) => entry.startTime < paint.startTime)
				.map((entry) => new URL(entry.name).pathname),
		];
	});
}
