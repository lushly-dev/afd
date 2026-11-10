import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appPack } from '@lushly-dev/loam-cli';
import { writeDeployment } from '@lushly-dev/loam-cli/deployment';
import type { ProjectionV3 } from '@lushly-dev/loam-manifest';
import type { Browser, BrowserContext, BrowserContextOptions, Frame, Page } from 'playwright';
import { createMountRelay, type MountRelay } from '../mounted/mount-relay';

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

/**
 * Requests a test holds unanswered, until it releases them: what stage B reads, to show the first frame
 * paints without it (phase 2 specification, E1).
 */
export interface HeldRequests {
	/** Hold every later request whose path matches. */
	hold(pattern: RegExp): void;
	/** Answer every held request, and hold no more. */
	release(): void;
	/** The paths held so far. */
	readonly held: string[];
}

/**
 * Serves a directory over loopback HTTP, so the page's CSP applies as deployed. With `base`, under that
 * path only, as a deployment's `base_path`; with `fallback`, a `GET` asking for `text/html` of a path with
 * no file answers `index.html` with `200`, as a deployer's host must for a deep link (phase 2
 * specification, 6.2), so a route segment with a dot still works.
 */
async function serveDirectory(
	root: string,
	options: {
		only?: string;
		headers?: () => Record<string, string>;
		relay?: () => MountRelay | undefined;
		base?: string;
		fallback?: boolean;
	} = {}
): Promise<{ origin: string; log: LoggedRequest[]; close: () => Promise<void> } & HeldRequests> {
	const log: LoggedRequest[] = [];
	let holding: RegExp | undefined;
	const waiting: Array<() => void> = [];
	const held: string[] = [];
	const server: Server = createServer(async (request, response) => {
		if (options.relay?.()?.handle(request, response)) return;
		const path = new URL(request.url ?? '/', 'http://localhost').pathname;
		if (holding?.test(path)) {
			held.push(path);
			await new Promise<void>((resume) => waiting.push(resume));
		}
		const base = options.base ?? '/';
		if (!path.startsWith(base)) {
			log.push({ path, bytes: 0, status: 404 });
			response.writeHead(404).end();
			return;
		}
		const inside = `/${path.slice(base.length)}`;
		const file = normalize(join(root, inside === '/' ? 'index.html' : inside));
		if (
			(file !== root && !file.startsWith(root + sep)) ||
			(options.only !== undefined && !path.startsWith(options.only))
		) {
			response.writeHead(403).end();
			return;
		}
		const page =
			options.fallback === true &&
			request.method === 'GET' &&
			(request.headers.accept ?? '').includes('text/html');
		try {
			let served = file;
			const body = await readFile(file).catch((error: unknown) => {
				if (!page) throw error;
				served = join(root, 'index.html');
				return readFile(served);
			});
			log.push({ path, bytes: body.length, status: 200 });
			response.writeHead(200, {
				'content-type': TYPES[extname(served)] ?? 'application/octet-stream',
				...options.headers?.(),
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
	const release = () => {
		holding = undefined;
		for (const resume of waiting.splice(0)) resume();
	};
	return {
		origin: `http://127.0.0.1:${address.port}`,
		log,
		held,
		hold(pattern) {
			holding = pattern;
		},
		release,
		close: () =>
			new Promise((done) => {
				release();
				server.close(() => done());
				server.closeAllConnections();
			}),
	};
}

/** Serves the `vite build` output. */
export const serveDist = () => serveDirectory(DIST);

export const APPS = resolve(fileURLToPath(new URL('../../../../apps', import.meta.url)));

/** The `loam` bin, as a person runs it: its JSON, and whether it exited 0. */
export function loam(
	args: string[],
	cwd: string
): Promise<{ ok: boolean; output: Record<string, unknown> }> {
	const bin = fileURLToPath(new URL('../../../cli/bin/loam.mjs', import.meta.url));
	return new Promise((done) => {
		execFile(process.execPath, [bin, ...args], { cwd }, (error, stdout) => {
			done({ ok: !error, output: JSON.parse(stdout) });
		});
	});
}

const packed = new Map<string, Promise<string>>();

/** `loam app pack` on an app's built source, once a run, in a temporary directory. */
export function packApp(
	app: 'hello' | 'tally' | 'tasks' | 'notes' | 'checklist',
	kind: 'native' | 'view' | 'mounted' = 'native'
): Promise<string> {
	const key = `${app}-${kind}`;
	const held = packed.get(key);
	if (held) return held;
	const pack = (async () => {
		const out = join(await mkdtemp(join(tmpdir(), `loam-pack-${key}-`)), 'package');
		const result = await appPack({
			dir: join(APPS, app),
			...(app === 'hello' ? { manifest: `manifests/${kind}.toml` } : {}),
			out,
		});
		if (!result.out) throw new Error(JSON.stringify(result.report.refusals));
		return out;
	})();
	packed.set(key, pack);
	return pack;
}

export interface DeploymentSite extends HeldRequests {
	origin: string;
	/** The shell's root: the origin and the base path, with its trailing slash. */
	root: string;
	log: LoggedRequest[];
	/** The directory `writeDeployment` wrote. */
	out: string;
	projection: ProjectionV3;
	/** With `sandbox: true`, the second origin that serves `sandbox/`, and its log. */
	sandbox?: { origin: string; log: LoggedRequest[] };
	/** With `mounts: true`, the test-only relay at `mounts/<instance>/mcp`, and its log. */
	relay?: MountRelay;
	close: () => Promise<void>;
}

/**
 * `writeDeployment` into a temporary directory, then served, as a deployer does (phase 1 specification,
 * section 14). `config` is the file's text: a relative `package` is relative to that directory, so a
 * test names an absolute one. `sandbox: true` serves `sandbox/` on a second loopback origin, with
 * `frame-ancestors` naming the shell's, as a deployer does (6.1). `mounts: true` serves the test-only
 * relay at `mounts/<instance>/mcp` (7.1), with `writeDeployment`'s `mounts`, held in memory.
 */
export async function serveDeployment(options: {
	config: string;
	sandbox?: true;
	mounts?: true;
	/** Serve this in place of the projection `writeDeployment` wrote: a hostile or lying one (E1). */
	rewrite?: (projection: ProjectionV3) => unknown;
	/** `site.base_path`, written into the file and served as the site's prefix (6.2). Default `/`. */
	basePath?: string;
}): Promise<DeploymentSite> {
	const directory = await mkdtemp(join(tmpdir(), 'loam-deployment-'));
	const config = join(directory, 'loam.deployment.toml');
	const out = join(directory, 'site');
	let shellOrigin = '';
	// A port is known before the file is written, and the shell's only after it is served.
	const sandbox = options.sandbox
		? await serveDirectory(out, {
				only: '/sandbox/',
				headers: () => ({ 'content-security-policy': `frame-ancestors ${shellOrigin}` }),
			})
		: undefined;
	await writeFile(
		config,
		[
			options.config,
			...(sandbox ? [`[sandbox]\norigin = ${JSON.stringify(sandbox.origin)}`] : []),
			...(options.basePath ? [`[site]\nbase_path = ${JSON.stringify(options.basePath)}`] : []),
		].join('\n\n')
	);
	const written = await writeDeployment({ config, dist: DIST, out });
	if (!written.ok) throw new Error(JSON.stringify(written.refusals));
	if (options.rewrite) {
		const served = options.rewrite(structuredClone(written.projection));
		await writeFile(join(out, 'deployment.json'), `${JSON.stringify(served, null, '\t')}\n`);
	}
	const relay = options.mounts ? createMountRelay(written.mounts) : undefined;
	const site = await serveDirectory(out, {
		relay: () => relay,
		fallback: true,
		...(options.basePath ? { base: options.basePath } : {}),
	});
	shellOrigin = site.origin;
	relay?.setOrigin(site.origin);
	return {
		...site,
		root: `${site.origin}${options.basePath ?? '/'}`,
		out,
		projection: written.projection,
		...(sandbox ? { sandbox: { origin: sandbox.origin, log: sandbox.log } } : {}),
		...(relay ? { relay } : {}),
		async close() {
			relay?.abort();
			await sandbox?.close();
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
	['deployment_version = 2', '', ...entries.map((entry) => `${entry}\n`)].join('\n');

// ─── Pages ─────────────────────────────────────────────────────────────────────

export interface ShellPage {
	context: BrowserContext;
	page: Page;
	/** CSP violations reported by the page, `directive blockedURI`. */
	violations: string[];
	/** The same violations, by the frame that reported each, for those a test provokes on purpose. */
	violationFrames: Array<{ frame: string; violation: string }>;
	/** Page errors and console errors. */
	errors: string[];
}

export const CSP_PROBE = () => {
	document.addEventListener('securitypolicyviolation', (event) =>
		console.error(
			`CSP violation: ${event.violatedDirective} ${event.blockedURI} @ ${location.href}`
		)
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
	const watched: ShellPage = {
		context: owned,
		page,
		violations: [],
		violationFrames: [],
		errors: [],
	};
	page.on('pageerror', (error) => watched.errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		if (message.text().startsWith('CSP violation')) {
			const [violation = '', frame = ''] = message.text().split(' @ ');
			watched.violations.push(violation);
			watched.violationFrames.push({ frame, violation });
		} else watched.errors.push(message.text());
	});
	await page.addInitScript(CSP_PROBE);
	await page.goto(url);
	await page.waitForFunction(() => document.documentElement.dataset.loamHost !== undefined);
	return watched;
}

/**
 * Open the built shell and wait until it has read the kernel's state and loaded the palette. The palette
 * loads only once stage B's mark is taken, as the shell's own idle load does: loaded at `ready`, which stage
 * A reaches first, its chunks and the kit's they import were requested inside first paint's window, which
 * E1 and E5 cut at that mark, and a chunk found only once another had parsed fell on either side of it.
 */
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
			booted: boolean;
			preparePalette(): Promise<unknown>;
		};
		await shell.ready;
		// A shell that booted takes the mark within two frames, or its hidden-tab timeout; one that failed
		// to start never does.
		if (shell.booted) {
			await new Promise<void>((resolve) => {
				const check = () =>
					performance.getEntriesByName('loam-stage-b').length > 0
						? resolve()
						: setTimeout(check, 5);
				check();
			});
		}
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
	/** The context fields a journal keeps, such as `caller`. */
	context?: Record<string, unknown>;
	error?: { code?: string; message?: string };
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
			...(entry.context ? { context: entry.context as Record<string, unknown> } : {}),
			...((entry.result as { error?: unknown }).error
				? { error: (entry.result as { error: { code?: string; message?: string } }).error }
				: {}),
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

/** Axe with the Health dashboard's tags (E4), over the whole document of a page or a frame. */
export async function axe(page: Page | Frame, except: string[] = []): Promise<AxeViolation[]> {
	await page.evaluate(await axeSource);
	return page.evaluate(async (except) => {
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
			rules: Object.fromEntries(except.map((id) => [id, { enabled: false }])),
		});
		return result.violations.map(({ id, impact, help, nodes }) => ({
			id,
			impact,
			help,
			nodes: nodes.map((node) => ({ target: node.target })),
		}));
	}, except);
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
 * Each resource the page requested before the shell's mark `loam-stage-b`, by path, from its own
 * timings: the first paint, which is the same for every deployment (phase 2 specification, E1). It
 * reads the mark the shell sets after its first frame, and not `first-contentful-paint`, which a machine
 * can report after the idle chunks have loaded (2.1).
 */
export async function measureFirstPaint(page: Page): Promise<string[]> {
	await page.waitForFunction(() => performance.getEntriesByName('loam-stage-b').length > 0);
	return page.evaluate(() => {
		const mark = performance.getEntriesByName('loam-stage-b')[0] as PerformanceEntry;
		const entries = performance.getEntriesByType('resource');
		return [
			new URL(location.href).pathname,
			...entries
				.filter((entry) => entry.startTime < mark.startTime)
				.map((entry) => new URL(entry.name).pathname),
		];
	});
}
