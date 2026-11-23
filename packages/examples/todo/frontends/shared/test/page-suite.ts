// biome-ignore-all lint/performance/useDomNodeTextContent: innerText() here is Playwright's locator method, which reads the rendered text the tests assert

/**
 * @fileoverview One browser suite for both to-do frontends: a built page in Chromium against a real
 * TypeScript backend. Add, complete, undo from the snackbar, a clear the person approves or denies
 * in the page, an agent narrowing the view (job 6) and no serious accessibility violations. Each
 * frontend's `test/page.test.ts` calls {@link describePage} with its own `dist`, so the two are
 * held to the same behaviour. Build the frontend and the backend first.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BACKEND = fileURLToPath(
	new URL('../../../backends/typescript/dist/server.js', import.meta.url)
);
const TYPES: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
};

function freePort(): Promise<number> {
	return new Promise((done, fail) => {
		const server = createNetServer();
		server.once('error', fail);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			server.close(() => done(typeof address === 'object' && address ? address.port : 0));
		});
	});
}

/** Run the suite against the built page in `dist`, a directory URL ending in `/`. */
export function describePage(name: string, distUrl: URL): void {
	const DIST = fileURLToPath(distUrl);
	let browser: Browser;
	let backend: ChildProcess;
	let site: Server;
	let pageUrl: string;

	beforeAll(async () => {
		if (!existsSync(join(DIST, 'index.html'))) throw new Error('Build the page first: pnpm build');
		site = createHttpServer((request, response) => {
			const pathname = new URL(request.url ?? '/', 'http://x').pathname;
			const path = normalize(
				join(DIST, pathname === '/' ? 'index.html' : decodeURIComponent(pathname))
			);
			if (!path.startsWith(resolve(DIST) + sep) || !existsSync(path) || !statSync(path).isFile()) {
				response.writeHead(404).end();
				return;
			}
			response.writeHead(200, {
				'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
			});
			response.end(readFileSync(path));
		});
		const sitePort = await freePort();
		await new Promise<void>((ready) => site.listen(sitePort, '127.0.0.1', ready));
		const backendPort = await freePort();
		backend = spawn(process.execPath, [BACKEND], {
			env: {
				...process.env,
				TRANSPORT: 'http',
				HOST: '127.0.0.1',
				PORT: String(backendPort),
				TODO_STORE_TYPE: 'memory',
				ALLOWED_ORIGINS: `http://127.0.0.1:${sitePort}`,
			},
			stdio: 'ignore',
		});
		const backendUrl = `http://127.0.0.1:${backendPort}`;
		for (let attempt = 0; ; attempt++) {
			try {
				if ((await fetch(`${backendUrl}/health`)).ok) break;
			} catch {}
			if (attempt > 80) throw new Error('The backend did not start');
			await new Promise((wait) => setTimeout(wait, 125));
		}
		pageUrl = `http://127.0.0.1:${sitePort}/?backend=${encodeURIComponent(backendUrl)}`;
		browser = await chromium.launch();
	});

	afterAll(async () => {
		await browser?.close();
		backend?.kill();
		await new Promise((done) => site?.close(() => done(undefined)));
	});

	async function openPage(colorScheme: 'light' | 'dark' = 'light'): Promise<Page> {
		const context = await browser.newContext({
			viewport: { width: 1280, height: 900 },
			colorScheme,
		});
		const page = await context.newPage();
		await page.goto(pageUrl);
		await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
		return page;
	}

	let counter = 0;
	const unique = (title: string) => `${title} ${Date.now()}-${++counter}`;

	async function add(page: Page, title: string): Promise<void> {
		await page.locator('violet-text-field.add-title input').fill(title);
		await page.locator('violet-button.add-submit').click();
		await page.locator('li.todo', { hasText: title }).waitFor();
	}

	describe(name, () => {
		it('adds a todo, completes it and undoes that from the snackbar', async () => {
			const page = await openPage();
			const title = unique('Water the seedlings');
			await add(page, title);
			const item = page.locator('li.todo', { hasText: title });
			await item.locator('violet-checkbox').click();
			await expect.poll(() => item.getAttribute('data-completed')).not.toBeNull();
			await page.locator('violet-snackbar.undo-offer violet-button', { hasText: 'Undo' }).click();
			await expect.poll(() => item.getAttribute('data-completed')).toBeNull();
			await expect.poll(() => page.locator('.trust-command').innerText()).toContain('todo-update');
			await page.context().close();
		});

		it('adds a todo with Enter in the title field', async () => {
			const page = await openPage();
			const title = unique('Typed and entered');
			const field = page.locator('violet-text-field.add-title input');
			await field.fill(title);
			await field.press('Enter');
			await page.locator('li.todo', { hasText: title }).waitFor();
			await page.context().close();
		});

		it('asks the person before clearing, in the page, and clears once approved', async () => {
			const page = await openPage();
			const title = unique('Lift the leeks');
			await add(page, title);
			await page.locator('li.todo', { hasText: title }).locator('violet-checkbox').click();
			await expect
				.poll(() => page.locator('li.todo', { hasText: title }).getAttribute('data-completed'))
				.not.toBeNull();
			await page.locator('violet-button.clear-completed').click();
			const dialog = page.locator('violet-dialog.approval');
			await expect.poll(() => dialog.getAttribute('open')).not.toBeNull();
			await expect.poll(() => dialog.innerText()).toContain('Remove the completed todos for good');
			await dialog.getByRole('button', { name: /approve/i }).click();
			await expect.poll(() => page.locator('li.todo', { hasText: title }).count()).toBe(0);
			await expect.poll(() => page.locator('.history-list').innerText()).toContain('todo-clear');
			await page.context().close();
		});

		it('keeps everything when the person denies the clear, and says why', async () => {
			const page = await openPage();
			const title = unique('Keep the beans');
			await add(page, title);
			await page.locator('li.todo', { hasText: title }).locator('violet-checkbox').click();
			await expect
				.poll(() => page.locator('li.todo', { hasText: title }).getAttribute('data-completed'))
				.not.toBeNull();
			await page.locator('violet-button.clear-completed').click();
			const dialog = page.locator('violet-dialog.approval');
			await expect.poll(() => dialog.getAttribute('open')).not.toBeNull();
			await dialog.getByRole('button', { name: /deny/i }).click();
			// The alert can appear before its title renders: wait for the text, as the other steps do
			await expect
				.poll(() => page.locator('violet-alert.page-error').innerText())
				.toContain('APPROVAL_REQUIRED');
			expect(await page.locator('li.todo', { hasText: title }).count()).toBe(1);
			await page.context().close();
		});

		it('keeps the approval open on Escape until the person answers', async () => {
			const page = await openPage();
			const title = unique('Ask first');
			await add(page, title);
			await page.locator('li.todo', { hasText: title }).locator('violet-checkbox').click();
			await expect
				.poll(() => page.locator('li.todo', { hasText: title }).getAttribute('data-completed'))
				.not.toBeNull();
			await page.locator('violet-button.clear-completed').click();
			const dialog = page.locator('violet-dialog.approval');
			await expect.poll(() => dialog.getAttribute('open')).not.toBeNull();
			await page.keyboard.press('Escape');
			await page.waitForTimeout(300);
			expect(await dialog.getAttribute('open')).not.toBeNull();
			await dialog.getByRole('button', { name: /deny/i }).click();
			await expect.poll(() => dialog.getAttribute('open')).toBeNull();
			await page.context().close();
		});

		it("filters by the person's choice, and shows the deleted list with Restore", async () => {
			const page = await openPage();
			const open = unique('Still open');
			const gone = unique('Deleted then restored');
			await add(page, open);
			await add(page, gone);
			await page
				.locator('violet-segmented-control.filter-status violet-segment[value="completed"]')
				.click();
			await expect.poll(() => page.locator('li.todo', { hasText: open }).count()).toBe(0);
			await page
				.locator('violet-segmented-control.filter-status violet-segment[value="all"]')
				.click();
			await page.locator('li.todo', { hasText: gone }).locator('violet-button.todo-delete').click();
			await expect.poll(() => page.locator('li.todo', { hasText: gone }).count()).toBe(0);
			// Focus goes to the title field, not the page body, once the row is gone
			await expect
				.poll(() =>
					page.evaluate(() => {
						let element: Element | null = document.activeElement;
						while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
						return (
							element?.closest?.('violet-text-field') !== null ||
							document.activeElement?.matches('violet-text-field.add-title')
						);
					})
				)
				.toBe(true);
			await page
				.locator('violet-segmented-control.filter-list violet-segment[value="deleted"]')
				.click();
			const deleted = page.locator('li.todo', { hasText: gone });
			await deleted.waitFor();
			await deleted.locator('violet-button.todo-restore').click();
			await expect.poll(() => page.locator('li.todo', { hasText: gone }).count()).toBe(0);
			await page
				.locator('violet-segmented-control.filter-list violet-segment[value="live"]')
				.click();
			await page.locator('li.todo', { hasText: gone }).waitFor();
			await page.context().close();
		});

		it('follows an agent that narrows the view (job 6)', async () => {
			const page = await openPage();
			await add(page, unique('Open one'));
			await page.evaluate(() =>
				(
					globalThis as unknown as {
						todoPage: {
							view: { commands: { execute(name: string, input: unknown): Promise<unknown> } };
						};
					}
				).todoPage.view.commands.execute('view-state-set', {
					id: 'todo-filter',
					state: { status: 'completed' },
				})
			);
			await expect
				.poll(() =>
					page
						.locator('violet-segmented-control.filter-status')
						.evaluate((element) => (element as HTMLInputElement).value)
				)
				.toBe('completed');
			// The list follows: no open todo is shown
			await expect.poll(() => page.locator('li.todo:not([data-completed])').count()).toBe(0);
			await page.context().close();
		});

		it('applies the AFD Refined theme in light, dark and forced-colors modes', async () => {
			const page = await openPage('light');
			const light = await page.evaluate(() => {
				const headingEl = document.querySelector('h1');
				const cardEl = document.querySelector('.insight > section');
				const codeEl = document.querySelector('code');
				if (!headingEl || !cardEl || !codeEl) throw new Error('Expected page elements');
				const body = getComputedStyle(document.body);
				const heading = getComputedStyle(headingEl);
				const card = getComputedStyle(cardEl);
				const code = getComputedStyle(codeEl);
				return {
					preset: document.documentElement.getAttribute('data-violet-theme'),
					pageBg: body.backgroundColor,
					bodyFont: body.fontFamily,
					headingFont: heading.fontFamily,
					monoFont: code.fontFamily,
					cardBg: card.backgroundColor,
					cardBorderWidth: card.borderTopWidth,
					cardShadow: card.boxShadow,
				};
			});
			expect(light.preset).toBe('light');
			expect(light.pageBg).toBe('rgb(244, 240, 234)');
			expect(light.cardBg).toBe('rgb(248, 249, 243)');
			expect(light.bodyFont).toContain('Inter');
			expect(light.bodyFont).not.toContain('Montserrat');
			expect(light.headingFont).toContain('Space Grotesk');
			expect(light.monoFont).toContain('IBM Plex Mono');
			expect(light.cardBorderWidth).toBe('0px');
			expect(light.cardShadow).not.toBe('none');

			await page.emulateMedia({ forcedColors: 'active' });
			const forced = await page.evaluate(() => {
				const cardEl = document.querySelector('.insight > section');
				if (!cardEl) throw new Error('Expected card element');
				const card = getComputedStyle(cardEl);
				return {
					cardBorderWidth: card.borderTopWidth,
					cardShadow: card.boxShadow,
				};
			});
			expect(forced.cardBorderWidth).toBe('1px');
			expect(forced.cardShadow).toBe('none');
			await page.context().close();

			const darkPage = await openPage('dark');
			const dark = await darkPage.evaluate(() => {
				const cardEl = document.querySelector('.insight > section');
				if (!cardEl) throw new Error('Expected card element');
				return {
					preset: document.documentElement.getAttribute('data-violet-theme'),
					pageBg: getComputedStyle(document.body).backgroundColor,
					cardBg: getComputedStyle(cardEl).backgroundColor,
				};
			});
			expect(dark.preset).toBe('dark');
			expect(dark.pageBg).toBe('rgb(20, 21, 21)');
			expect(dark.cardBg).toBe('rgb(27, 28, 28)');
			await darkPage.context().close();
		});

		it('has no serious or critical accessibility violations', async () => {
			const page = await openPage();
			await add(page, unique('Check me'));
			const axeSource = readFileSync(
				createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
				'utf8'
			);
			await page.addScriptTag({ content: axeSource });
			const violations = await page.evaluate(async () => {
				const result = await (
					globalThis as unknown as {
						axe: { run(): Promise<{ violations: { id: string; impact: string }[] }> };
					}
				).axe.run();
				return result.violations
					.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
					.map((violation) => `${violation.impact}: ${violation.id}`);
			});
			expect(violations).toEqual([]);
			await page.context().close();
		});
	});
}
