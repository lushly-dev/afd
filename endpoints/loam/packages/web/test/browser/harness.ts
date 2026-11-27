import { execFile } from 'node:child_process';
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import {
	createServer,
	request as forward,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { appPack } from '@lushly-dev/loam-cli';
import { writeDeployment } from '@lushly-dev/loam-cli/deployment';
import { copilotFramePolicy, isCopilotFramePath } from '@lushly-dev/loam-cli/frame-policy';
import {
	startTestAuthHost,
	type TestAuthHost,
	type TestAuthHostOptions,
} from '@lushly-dev/loam-identity/testing';
import type { ProjectionV4 } from '@lushly-dev/loam-manifest';
import {
	type Browser,
	type BrowserContext,
	type BrowserContextOptions,
	chromium,
	type Frame,
	firefox,
	type LaunchOptions,
	type Page,
	webkit,
} from 'playwright';
import { createMountRelay, type MountRelay } from '../mounted/mount-relay';

/** The engines a suite can launch (#706): Chromium for every suite, Firefox and WebKit for those `vitest.engines.config.ts` names. */
export type Engine = 'chromium' | 'firefox' | 'webkit';

/** The engine this run launches: `LOAM_ENGINE`, or Chromium when it is unset. Anything else fails the run at once. */
export const ENGINE: Engine = (() => {
	const named = process.env.LOAM_ENGINE ?? 'chromium';
	if (named === 'chromium' || named === 'firefox' || named === 'webkit') return named;
	throw new Error(`LOAM_ENGINE is "${named}"; it must be chromium, firefox or webkit`);
})();

/**
 * Firefox with scoped custom element registries on, as Firefox 159 ships them (phase 1's W3, D174): Playwright's
 * Firefox is 157, which has them behind this preference. E1's floor case turns it off, to stand for a Firefox below
 * the support floor.
 */
export const FIREFOX_SCOPED_REGISTRIES = 'dom.scoped-custom-element-registries.enabled';
const FIREFOX_PREFS = { [FIREFOX_SCOPED_REGISTRIES]: true };

/** Launch {@link ENGINE}. A suite that runs in more than one engine launches through this, never `chromium` itself. */
export function launchEngine(options: LaunchOptions = {}): Promise<Browser> {
	if (ENGINE === 'firefox')
		return firefox.launch({
			...options,
			firefoxUserPrefs: { ...FIREFOX_PREFS, ...options.firefoxUserPrefs },
		});
	return { chromium, webkit }[ENGINE].launch(options);
}

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
		/** Each answer's extra headers, by its request's path. */
		headers?: (path: string) => Record<string, string>;
		relay?: () => MountRelay | undefined;
		base?: string;
		fallback?: boolean;
		/** Serve over HTTPS on `https://localhost:<port>` with this certificate (phase 3 specification, 2.4). */
		tls?: { cert: Buffer; key: Buffer };
		/** Answer a request itself, as the auth proxy does; true when it did. */
		handle?: (request: IncomingMessage, response: ServerResponse) => boolean;
	} = {}
): Promise<{ origin: string; log: LoggedRequest[]; close: () => Promise<void> } & HeldRequests> {
	const log: LoggedRequest[] = [];
	let holding: RegExp | undefined;
	const waiting: Array<() => void> = [];
	const held: string[] = [];
	const listener = async (request: IncomingMessage, response: ServerResponse) => {
		if (options.relay?.()?.handle(request, response)) return;
		if (options.handle?.(request, response)) return;
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
				...options.headers?.(path),
			});
			response.end(body);
		} catch {
			log.push({ path, bytes: 0, status: 404 });
			response.writeHead(404).end();
		}
	};
	const server: Server = options.tls
		? (createSecureServer(options.tls, listener) as unknown as Server)
		: createServer(listener);
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('No loopback address');
	const release = () => {
		holding = undefined;
		for (const resume of waiting.splice(0)) resume();
	};
	return {
		origin: options.tls ? `https://localhost:${address.port}` : `http://127.0.0.1:${address.port}`,
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
	projection: ProjectionV4;
	/** With `sandbox: true`, the second origin that serves `sandbox/`, and its log. */
	sandbox?: { origin: string; log: LoggedRequest[] };
	/** With `mounts: true`, the test-only relay at `mounts/<instance>/mcp`, and its log. */
	relay?: MountRelay;
	/**
	 * With `authHost`, the test-only auth host behind `<base_path>api/auth/`, which proves no hosted lane (phase 3
	 * specification, 2.4), and the site's certificate's public key hash, for `launchForDevHost`.
	 */
	authHost?: TestAuthHost;
	spki?: string;
	close: () => Promise<void>;
}

/** A certificate for `localhost`, made per run as 5.1's development profile makes its own (phase 3 specification, 2.4). */
async function localhostCertificate(
	directory: string
): Promise<{ cert: Buffer; key: Buffer; spki: string }> {
	const cert = join(directory, 'cert.pem');
	const key = join(directory, 'key.pem');
	await promisify(execFile)('openssl', [
		'req',
		'-x509',
		'-newkey',
		'ec',
		'-pkeyopt',
		'ec_paramgen_curve:P-256',
		'-nodes',
		'-keyout',
		key,
		'-out',
		cert,
		'-days',
		'2',
		'-subj',
		'/CN=localhost',
		'-addext',
		'subjectAltName=DNS:localhost',
	]);
	const pem = await readFile(cert);
	const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
	return {
		cert: pem,
		key: await readFile(key),
		spki: createHash('sha256').update(der).digest('base64'),
	};
}

/** Forward `<path>/…` to the auth host, as the hosted lane's route will: the request as the browser sent it. */
function authProxy(prefix: string, host: () => TestAuthHost | undefined) {
	return (request: IncomingMessage, response: ServerResponse): boolean => {
		const target = host();
		const path = request.url ?? '/';
		if (!target || !path.startsWith(prefix)) return false;
		const upstream = new URL(target.listening);
		const outgoing = forward(
			{
				host: upstream.hostname,
				port: upstream.port,
				method: request.method,
				// The host answers at the same path, its `baseURL` being the site's origin and this prefix.
				path,
				headers: request.headers,
			},
			(answer) => {
				response.writeHead(answer.statusCode ?? 502, answer.headers);
				answer.pipe(response);
			}
		);
		outgoing.on('error', () => response.writeHead(502).end());
		request.pipe(outgoing);
		return true;
	};
}

/**
 * `writeDeployment` into a temporary directory, then served, as a deployer does (phase 1 specification,
 * section 14). `config` is the file's text: a relative `package` is relative to that directory, so a
 * test names an absolute one. `sandbox: true` serves `sandbox/` on a second loopback origin, with
 * `frame-ancestors` naming the shell's, as a deployer does (6.1), and `sandbox/copilot/` with the copilot frame's
 * path-scoped policy (phase 5 specification, 3.2). `mounts: true` serves the test-only
 * relay at `mounts/<instance>/mcp` (7.1), with `writeDeployment`'s `mounts`, held in memory.
 */
export async function serveDeployment(options: {
	config: string;
	sandbox?: true;
	mounts?: true;
	/** Serve this in place of the projection `writeDeployment` wrote: a hostile or lying one (E1). */
	rewrite?: (projection: ProjectionV4) => unknown;
	/** `site.base_path`, written into the file and served as the site's prefix (6.2). Default `/`. */
	basePath?: string;
	/**
	 * A `provider` deployment's test-only auth host (phase 3 specification, 2.4): the site is served over HTTPS on
	 * `https://localhost:<port>` with a certificate made for this run, and `<base_path>api/auth/*` is proxied to a
	 * real Better Auth server with these people, so the page, the probe and the provider share an origin and cookies
	 * carry `Secure`. `config` names `[identity]` itself. Open pages with `launchForDevHost({ spki })`.
	 */
	authHost?: Omit<TestAuthHostOptions, 'origin' | 'path'>;
}): Promise<DeploymentSite> {
	const directory = await mkdtemp(join(tmpdir(), 'loam-deployment-'));
	const tls = options.authHost ? await localhostCertificate(directory) : undefined;
	let authHost: TestAuthHost | undefined;
	const config = join(directory, 'loam.deployment.toml');
	const out = join(directory, 'site');
	let shellOrigin = '';
	let sandboxOrigin = '';
	// A port is known before the file is written, and the shell's only after it is served. The copilot's path
	// carries its frame's own policy (phase 5 specification, 3.2), as every host serves it.
	const sandbox = options.sandbox
		? await serveDirectory(out, {
				only: '/sandbox/',
				headers: (path) => ({
					'content-security-policy': isCopilotFramePath(path)
						? copilotFramePolicy(sandboxOrigin, shellOrigin)
						: `frame-ancestors ${shellOrigin}`,
				}),
			})
		: undefined;
	sandboxOrigin = sandbox?.origin ?? '';
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
		// The four account pages' response policy, as the hosted lane serves them (phase 3 specification, 9.4; phase 6's
		// 3.5): never framed, and a form posts only to the deployment's own origin.
		...(tls
			? {
					headers: (path: string): Record<string, string> =>
						/\/~\/(oauth\/(login|consent)|join|recover)\/?$/.test(path.split('?')[0] ?? '')
							? { 'content-security-policy': "frame-ancestors 'none'; form-action 'self'" }
							: {},
				}
			: {}),
		...(options.basePath ? { base: options.basePath } : {}),
		...(tls ? { tls: { cert: tls.cert, key: tls.key } } : {}),
		...(tls ? { handle: authProxy(`${options.basePath ?? '/'}api/auth/`, () => authHost) } : {}),
	});
	shellOrigin = site.origin;
	relay?.setOrigin(site.origin);
	if (options.authHost) {
		try {
			authHost = await startTestAuthHost({
				...options.authHost,
				origin: site.origin,
				path: `${options.basePath ?? '/'}api/auth`,
			});
		} catch (cause) {
			await site.close();
			throw cause;
		}
	}
	return {
		...site,
		root: `${site.origin}${options.basePath ?? '/'}`,
		out,
		projection: written.projection,
		...(sandbox ? { sandbox: { origin: sandbox.origin, log: sandbox.log } } : {}),
		...(relay ? { relay } : {}),
		...(authHost ? { authHost, spki: tls?.spki as string } : {}),
		async close() {
			relay?.abort();
			await authHost?.close();
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

/**
 * A version 4 deployment file for the hosted server (phase 6 specification, 3.3), as `startDevHost` serves it: `[host]
 * kind = "hosted"`, then `head`'s tables (`[workspace]`, `[identity]`), then the entries, or an empty `[apps]`.
 */
export const hostedDeploymentFile = (head: string[], ...entries: string[]): string =>
	[
		'deployment_version = 4',
		'',
		'[host]',
		'kind = "hosted"',
		'',
		...head,
		...(entries.length === 0 ? ['[apps]', ''] : entries.map((entry) => `${entry}\n`)),
	].join('\n');

/** A `provider` deployment for the hosted server: workspace `acme`, bound to the organization `acme` (3.3, 3.7). */
export const hostedProviderDeployment = (
	methods: readonly string[] = ['passkey', 'password'],
	...entries: string[]
): string =>
	hostedDeploymentFile(
		[
			'[workspace]',
			'id = "acme"',
			'name = "Acme"',
			'',
			'[identity]',
			'mode = "provider"',
			'organization = "acme"',
			`methods = ${JSON.stringify(methods)}`,
			'',
		],
		...entries
	);

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
	/**
	 * The page's `Content-Security-Policy` response header, which the hosted server sends beside the `<meta>`
	 * (phase 6 specification, 3.5), or `null` from a static host. Both are enforced, so a violation of
	 * either reaches `violations`.
	 */
	responsePolicy: string | null;
}

export const CSP_PROBE = () => {
	document.addEventListener('securitypolicyviolation', (event) =>
		console.error(
			`CSP violation: ${event.violatedDirective} ${event.blockedURI} @ ${location.href}`
		)
	);
};

/** Open a fresh BrowserContext with non-Chromium timeouts matching `vitest.engines.config.ts` (#2760). */
export async function newEngineContext(
	browser: Browser,
	options: BrowserContextOptions = {}
): Promise<BrowserContext> {
	const context = await browser.newContext(options);
	if (ENGINE !== 'chromium') {
		context.setDefaultTimeout(60_000);
		context.setDefaultNavigationTimeout(60_000);
	}
	return context;
}

/** Open a page in a fresh context that records CSP violations and errors. */
export async function openPage(
	browser: Browser,
	url: string,
	options: BrowserContextOptions = {},
	context?: BrowserContext
): Promise<ShellPage> {
	const owned =
		context ??
		(await newEngineContext(browser, { viewport: { width: 1280, height: 800 }, ...options }));
	const page = await owned.newPage();
	// Match `vitest.engines.config.ts` (60 s) even when a caller passes an externally created context (#2760).
	if (ENGINE !== 'chromium') {
		page.setDefaultTimeout(60_000);
		page.setDefaultNavigationTimeout(60_000);
	}
	const watched: ShellPage = {
		context: owned,
		page,
		violations: [],
		violationFrames: [],
		errors: [],
		responsePolicy: null,
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
	const response = await page.goto(url);
	watched.responsePolicy = response?.headers()['content-security-policy'] ?? null;
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
	options: BrowserContextOptions & { agents?: 'act' | 'ask' } = {},
	context?: BrowserContext
): Promise<ShellPage> {
	const { agents = 'act', ...contextOptions } = options;
	const opened = await openPage(browser, origin, contextOptions, context);
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
	// Phase 5's step 3 enforces autonomy on every agent's call (its 6.1), and these suites drive the shell through the
	// agent interface: the person lets agents act, their own workspace row, as the kernel's and the app kit's tests do.
	// `agents: 'ask'` keeps the default. A deployment that keeps no autonomy rows (a hosted `provider` one) refuses it.
	if (agents === 'act')
		await kernelCall(opened.page, 'autonomy-set', { level: 'workspace', mode: 'act' });
	await settle(opened.page);
	return opened;
}

/** The journal's writer lock, `<JOURNAL_NAME>:writer` (`src/host.ts`, phase 0 specification, 6.6). */
const WRITER_LOCK_NAME = 'loam-journal:writer';
/** How long {@link closeAndRelease} waits for the release: well inside a test's 30 s. */
const RELEASE_BOUND_MS = 10_000;

/**
 * Close a shell's page and wait until the browser has let go of the journal's writer lock it held, so the
 * next page opened in its context (the same profile) takes the lock rather than showing "Loam is open in
 * another tab". The browser releases a closed page's Web Locks a little after `close` resolves, and on a
 * loaded machine later than the host's second of patience (#1315). `url` is the deployment's root: the
 * probe reads the locks from its `deployment.json`, at the same origin. Call it only when the closed page
 * was the context's one writer, and with `deployment.json` neither routed nor held: otherwise the lock is
 * never seen free, and it throws once its bound has passed.
 */
export async function closeAndRelease(opened: ShellPage, url: string): Promise<void> {
	await opened.page.close();
	const probe = await opened.context.newPage();
	try {
		await probe.goto(new URL('deployment.json', url).href);
		const deadline = Date.now() + RELEASE_BOUND_MS;
		// A loop, not `waitForFunction`, which takes the promise an async predicate returns as truthy.
		for (;;) {
			const locks = await probe.evaluate(() => navigator.locks.query());
			if (!locks.held?.some((lock) => lock.name === WRITER_LOCK_NAME)) return;
			if (Date.now() >= deadline) {
				throw new Error(
					`${WRITER_LOCK_NAME} at ${new URL(url).origin} was still held ${RELEASE_BOUND_MS} ms after its page closed: ${JSON.stringify(locks)}`
				);
			}
			await probe.waitForTimeout(50);
		}
	} finally {
		await probe.close();
	}
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

/**
 * Set the theme as the person and wait until the document shows it, so an axe scan never runs on the theme before:
 * `appearance-set` must succeed, and `data-loam-theme` must read `theme` (forced colours aside, which no test sets).
 */
export async function setTheme(
	page: Page,
	theme: 'light' | 'dark' | 'high-contrast'
): Promise<void> {
	const result = (await kernelCall(page, 'appearance-set', { theme })) as { success: boolean };
	if (!result.success) throw new Error(`appearance-set ${theme} failed: ${JSON.stringify(result)}`);
	await page.waitForFunction(
		(theme) => document.documentElement.dataset.loamTheme === theme,
		theme
	);
	await settle(page);
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
 * Use `waitForFonts` to collect timing entries for in-flight font loads. The cutoff is still stage B.
 */
export async function measureFirstPaint(
	page: Page,
	{ waitForFonts = false }: { waitForFonts?: boolean } = {}
): Promise<string[]> {
	await page.waitForFunction(() => performance.getEntriesByName('loam-stage-b').length > 0);
	return page.evaluate(async (waitForFonts) => {
		if (waitForFonts) await document.fonts.ready;
		const mark = performance.getEntriesByName('loam-stage-b')[0] as PerformanceEntry;
		const entries = performance.getEntriesByType('resource');
		return [
			new URL(location.href).pathname,
			...entries
				.filter((entry) => entry.startTime < mark.startTime)
				.map((entry) => new URL(entry.name).pathname),
		];
	}, waitForFonts);
}

// ─── The hosted development profile ───────────────────────────────────────────

/**
 * Chromium for `DevHost`s (phase 6 specification, 5.2): it trusts those profiles' certificates alone, by their
 * public key's hash, so any other certificate is still refused and cookies are `Secure` as in production.
 * Pages open with `openShell(browser, devHost.root, options, context)`.
 */
export function launchForDevHost(...hosts: Array<{ spki: string }>): Promise<Browser> {
	const list = hosts.map(({ spki }) => spki).join(',');
	return chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${list}`] });
}

// ─── Passkeys (phase 3 specification, 2.4) ─────────────────────────────────────

/**
 * A virtual authenticator on `page`, through Chromium's DevTools `WebAuthn` domain: no real authenticator or platform
 * prompt is involved, which every result recorded with it says. `userVerified: false` makes it answer without user
 * verification, which the provider must refuse.
 */
export async function addVirtualAuthenticator(
	page: Page,
	options: { userVerified: boolean }
): Promise<{
	remove(): Promise<void>;
	credentials(): Promise<unknown[]>;
	add(credential: unknown): Promise<void>;
}> {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: options.userVerified,
			automaticPresenceSimulation: true,
		},
	});
	return {
		async remove() {
			await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
		},
		async credentials() {
			return (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
		},
		/** A credential another authenticator holds, with its private key, as `credentials()` gave it. */
		async add(credential) {
			await cdp.send('WebAuthn.addCredential', {
				authenticatorId,
				credential: credential as never,
			});
		},
	};
}

/** A `provider` deployment file's `[identity]`, at version 3. */
export const providerDeployment = (
	methods: readonly string[] = ['passkey', 'password'],
	...entries: string[]
): string =>
	[
		'deployment_version = 3',
		'',
		'[identity]',
		'mode = "provider"',
		'organization = "acme"',
		`methods = ${JSON.stringify(methods)}`,
		'',
		// Version 3 requires the table, so a deployment with no app names it empty.
		...(entries.length === 0 ? ['[apps]', ''] : entries.map((entry) => `${entry}\n`)),
	].join('\n');

/** What one of the page's IndexedDB databases holds: whether it exists, its object stores, and their rows. */
export interface HeldDatabase {
	exists: boolean;
	stores: string[];
	rows: number;
	text: string;
}

/**
 * P3-E15: everything a shell page's origin holds that a secret could leak into: every row of every IndexedDB
 * database it has (`indexedDB.databases()`, as `@lushly-dev/loam-host/testing`'s `scanSecrets` reads a page, so a
 * database added later is read too, and a missing one is never made by opening it), and every `localStorage` value.
 * `journal` and `store` are `loam-journal`'s and `loam-store`'s, so a test can check each was there to search;
 * `text` is all of it.
 */
export function heldByPage(
	page: Page
): Promise<{ journal: HeldDatabase; store: HeldDatabase; local: string; text: string }> {
	return page.evaluate(async () => {
		const names = (await indexedDB.databases())
			.map((entry) => entry.name)
			.filter((name): name is string => !!name);
		const read = (name: string) =>
			new Promise<HeldDatabase>((resolve, reject) => {
				if (!names.includes(name)) {
					resolve({ exists: false, stores: [], rows: 0, text: '' });
					return;
				}
				const request = indexedDB.open(name);
				request.onerror = () => reject(request.error);
				request.onsuccess = async () => {
					const db = request.result;
					const stores = [...db.objectStoreNames];
					const all: unknown[][] = [];
					for (const store of stores) {
						all.push(
							await new Promise<unknown[]>((done) => {
								const got = db.transaction(store).objectStore(store).getAll();
								got.onsuccess = () => done(got.result);
							})
						);
					}
					db.close();
					resolve({
						exists: true,
						stores,
						rows: all.reduce((sum, rows) => sum + rows.length, 0),
						text: JSON.stringify(all),
					});
				};
			});
		const all = await Promise.all(names.map(read));
		const none = { exists: false, stores: [], rows: 0, text: '' };
		const journal = all[names.indexOf('loam-journal')] ?? none;
		const store = all[names.indexOf('loam-store')] ?? none;
		const local = JSON.stringify({ ...localStorage });
		return { journal, store, local, text: [...all.map((entry) => entry.text), local].join('\n') };
	});
}

const CEREMONY_KEYS = ['clientDataJSON', 'authenticatorData', 'signature', 'attestationObject'];

/** P3-E15: what a page sent its provider that is a secret, as `recordSecretsSent` collects it. */
export interface SecretsSent {
	/** Every value of a ceremony's response and every OAuth `code` or `token` the page sent, 16 characters or more. */
	values: string[];
	/** WebAuthn registrations sent: a response with `attestationObject` and `clientDataJSON`. */
	registrations: number;
	/** WebAuthn authentications sent: a response with `signature`, `authenticatorData` and `clientDataJSON`. */
	authentications: number;
	/** OAuth `code` or `token` query values sent, as a sign-on's callback carries one. */
	codes: number;
}

/**
 * P3-E15: records the secrets a page sends under `api/auth/` as each request leaves: a WebAuthn ceremony's response
 * bytes, from any JSON body, and any `code` or `token` in a request's query (a sign-on's callback), so a test can
 * look for them where they must not be. It counts each kind of ceremony, so a test can require the one it ran.
 */
export function recordSecretsSent(page: Page): SecretsSent {
	const sent: SecretsSent = { values: [], registrations: 0, authentications: 0, codes: 0 };
	const walk = (value: unknown): void => {
		if (!value || typeof value !== 'object') return;
		const record = value as Record<string, unknown>;
		const has = (key: string) =>
			typeof record[key] === 'string' && (record[key] as string).length >= 16;
		if (has('attestationObject') && has('clientDataJSON')) sent.registrations += 1;
		if (has('signature') && has('authenticatorData') && has('clientDataJSON'))
			sent.authentications += 1;
		for (const [key, entry] of Object.entries(record)) {
			if (CEREMONY_KEYS.includes(key) && typeof entry === 'string' && entry.length >= 16)
				sent.values.push(entry);
			else walk(entry);
		}
	};
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (!url.pathname.includes('/api/auth/')) return;
		for (const name of ['code', 'token']) {
			const value = url.searchParams.get(name);
			if (value && value.length >= 16) {
				sent.values.push(value);
				sent.codes += 1;
			}
		}
		try {
			walk(JSON.parse(request.postData() ?? 'null'));
		} catch {
			// Not JSON: no ceremony.
		}
	});
	return sent;
}

/** P3-E15: a mailed join or recovery link's single-use token, its `token` parameter. */
export function linkToken(link: string): string {
	const token = new URL(link).searchParams.get('token');
	if (!token || token.length < 16) throw new Error(`No token in ${link}`);
	return token;
}

/**
 * P3-E15: the secrets a profile holds now, with a test-only auth host: the context's cookie values and every
 * session's token and IP address in the host's database. Taken before a step that deletes them (a sign-out, a
 * revocation, a recovery), it is passed to `secretsHeld` as `earlier`.
 */
export async function secretsNow(
	shell: ShellPage,
	authHost: TestAuthHost
): Promise<{ cookies: string[]; tokens: string[]; addresses: string[] }> {
	const cookies = (await shell.context.cookies())
		.map((cookie) => cookie.value)
		.filter((value) => value.length > 8);
	const rows = authHost.db().prepare('SELECT token, ipAddress FROM session').all() as {
		token: string;
		ipAddress: string | null;
	}[];
	return {
		cookies,
		tokens: rows.map((row) => row.token),
		addresses: rows.map((row) => row.ipAddress).filter((value): value is string => !!value),
	};
}

/**
 * P3-E15: which secrets a shell page's origin holds (`heldByPage`), by kind, never by value: its context's cookie
 * values and every session's token and IP address in the host's database now (`secretsNow`) and in each snapshot
 * of `earlier`, the link tokens and sent secrets given, the password given, and anything shaped like an IP address.
 * `held` is what was read, so the test can check each source was there to search.
 */
export async function secretsHeld(
	shell: ShellPage,
	options: {
		authHost: TestAuthHost;
		password?: string;
		linkTokens?: readonly string[];
		sent?: SecretsSent;
		/** Other secrets to look for, such as a virtual authenticator's private key. */
		also?: readonly string[];
		earlier?: ReadonlyArray<{ cookies: string[]; tokens: string[]; addresses: string[] }>;
	}
): Promise<{ held: Awaited<ReturnType<typeof heldByPage>>; found: string[] }> {
	const held = await heldByPage(shell.page);
	const secrets: Array<[string, string]> = [];
	for (const snapshot of [await secretsNow(shell, options.authHost), ...(options.earlier ?? [])]) {
		for (const value of snapshot.cookies) secrets.push(['a cookie value', value]);
		for (const value of snapshot.tokens) secrets.push(['a session token', value]);
		// A short address (`::1`) is left to the pattern below, which finds every loopback form.
		for (const value of snapshot.addresses)
			if (value.length >= 8) secrets.push(["a session's IP address", value]);
	}
	for (const value of options.linkTokens ?? []) secrets.push(["a link's token", value]);
	for (const value of options.sent?.values ?? []) secrets.push(['a secret the page sent', value]);
	for (const value of options.also ?? []) secrets.push(['a secret the test named', value]);
	if (options.password) secrets.push(['the password', options.password]);
	for (const [kind, value] of secrets)
		if (value.length < 8) throw new Error(`${kind} is too short to scan for.`);
	// A test's servers listen on loopback, so `127.0.0.1` is also the host of URLs a page may hold, such as a
	// sign-on's redirect in a journaled result: the host of a URL is not a person's address, so it is masked first.
	const text = held.text.replace(/\/\/(?:127\.0\.0\.1|\[::1\]|localhost)(?::\d+)?/g, '//loopback');
	const found = secrets.filter(([, value]) => text.includes(value)).map(([kind]) => kind);
	if (/ipAddress|127\.0\.0\.1|::1|::ffff:/.test(text)) found.push('an IP address');
	return { held, found: [...new Set(found)] };
}

/**
 * P3-E15: the sources `secretsHeld` had nothing to search in, so a test can require an empty list: a journal with no
 * entry, or no store database with its object store, would make "no secret found" true of nothing. A profile that
 * never signed in may hold no store row; a test of a signed-in one also requires `held.store.rows`.
 */
export function unsearched(held: Awaited<ReturnType<typeof heldByPage>>): string[] {
	const missing: string[] = [];
	if (held.journal.rows === 0) missing.push('no journal entry');
	if (held.store.stores.length === 0) missing.push('no store');
	return missing;
}

/**
 * P3-E3: connects a client the test-only auth host pre-registered for the person signed in to `context`, as an MCP
 * client does: the authorization request with PKCE S256 and the resource, Connect on the consent page (unless the
 * person consented before), and the code exchanged for tokens from a page of the shell's own origin. With
 * `offline_access` the provider issues a refresh token, so a test can read its row in the host's database.
 */
export async function connectClient(
	context: BrowserContext,
	site: DeploymentSite,
	client: { id: string; redirect: string },
	scope = 'loam:read loam:write offline_access'
): Promise<{ access?: string; refresh?: string }> {
	const verifier = randomBytes(32).toString('base64url');
	const query = new URLSearchParams({
		response_type: 'code',
		client_id: client.id,
		redirect_uri: client.redirect,
		scope,
		state: 'connect',
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		code_challenge_method: 'S256',
		resource: `${site.root}mcp`,
	});
	const page = await context.newPage();
	try {
		const back = page.waitForRequest((request) => request.url().startsWith(client.redirect));
		await page.goto(`${site.root}api/auth/oauth2/authorize?${query}`).catch(() => undefined);
		const connect = page.locator('loam-oauth-page button', { hasText: 'Connect' });
		// The loser of the race rejects once the page closes: caught, so it is never an unhandled rejection.
		const shown = connect.waitFor().then(() => 'consent' as const);
		shown.catch(() => undefined);
		const first = await Promise.race([back.then(() => 'back' as const), shown]);
		if (first === 'consent') await connect.click();
		const code = new URL((await back).url()).searchParams.get('code');
		if (!code) throw new Error('No code returned to the client');
		// The client's redirect is never served, so its failed navigation keeps this page: exchange from another.
		const exchange = await context.newPage();
		await exchange.goto(`${site.root}deployment.json`);
		return await exchange
			.evaluate(
				async ({ code, verifier, client, resource }) => {
					const response = await fetch(new URL('api/auth/oauth2/token', document.baseURI), {
						method: 'POST',
						headers: { 'content-type': 'application/x-www-form-urlencoded' },
						body: new URLSearchParams({
							grant_type: 'authorization_code',
							code,
							redirect_uri: client.redirect,
							client_id: client.id,
							code_verifier: verifier,
							resource,
						}),
					});
					const tokens = (await response.json()) as {
						access_token?: string;
						refresh_token?: string;
					};
					return { access: tokens.access_token, refresh: tokens.refresh_token };
				},
				{ code, verifier, client, resource: `${site.root}mcp` }
			)
			.finally(() => exchange.close());
	} finally {
		await page.close();
	}
}
