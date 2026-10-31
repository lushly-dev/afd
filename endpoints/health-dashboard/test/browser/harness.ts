/** Chromium harness: a loopback static server over this package and page helpers. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Page } from 'playwright';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DIST = join(ROOT, 'dist/index.html');
export const fixturePath = (path: string) => join(ROOT, 'fixtures', path);
export const ARTIFACTS = join(ROOT, 'test-results');

const TYPES: Record<string, string> = { '.html': 'text/html', '.json': 'application/json' };

export interface StaticServer {
	origin: string;
	close(): Promise<void>;
}

/** Serves only files under this package, on 127.0.0.1, for `?report=` tests. */
export async function serve(): Promise<StaticServer> {
	if (!existsSync(DIST)) throw new Error('Build the dashboard first: pnpm build');
	const server: Server = createServer((request, response) => {
		const path = normalize(
			join(ROOT, decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname))
		);
		if (!path.startsWith(resolve(ROOT) + sep) || !existsSync(path) || !statSync(path).isFile()) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
		response.end(readFileSync(path));
	});
	await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
	const { port } = server.address() as AddressInfo;
	return {
		origin: `http://127.0.0.1:${port}`,
		close: () => new Promise((done) => server.close(() => done())),
	};
}

export interface Watched {
	page: Page;
	cspViolations: string[];
	errors: string[];
	requests: string[];
}

/** A page that records CSP violations, page errors and every request it makes. */
export async function open(context: BrowserContext, url: string): Promise<Watched> {
	const page = await context.newPage();
	const watched: Watched = { page, cspViolations: [], errors: [], requests: [] };
	page.on('pageerror', (error) => watched.errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') watched.errors.push(message.text());
		if (message.text().startsWith('csp:')) watched.cspViolations.push(message.text());
	});
	page.on('request', (request) => watched.requests.push(request.url()));
	await page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (event) =>
			console.log(`csp: ${event.violatedDirective} ${event.blockedURI}`)
		);
	});
	await page.goto(url);
	await page.waitForSelector('html[data-ready="true"]');
	return watched;
}

export async function loadFiles(page: Page, paths: string[]): Promise<void> {
	await page.locator('violet-file-upload input[type="file"]').setInputFiles(paths);
	await page.waitForFunction(
		() => !document.querySelector('.status-line')?.textContent?.includes('Reading')
	);
	await page.waitForFunction(
		() => document.querySelector('.status-line')?.textContent?.trim() !== 'No reports loaded.'
	);
}

const axeSource = readFileSync(
	createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
	'utf8'
);

export interface AxeViolation {
	id: string;
	impact: string | null;
	help: string;
	nodes: { target: string[] }[];
}

/** Runs axe-core (WCAG 2.0-2.2 A/AA plus best practices) over the whole document. */
export async function axe(page: Page): Promise<AxeViolation[]> {
	await page.evaluate(axeSource);
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

export type { Browser };
