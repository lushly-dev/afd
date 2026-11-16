// biome-ignore-all lint/performance/useDomNodeTextContent: innerText() here is Playwright's locator method, which reads the rendered text the tests assert

/**
 * @fileoverview The copilot page in Chromium, served by the real server (`/chat`, `/mcp`, the
 * page, its Content-Security-Policy) in this process, with a scripted model in place of Gemini.
 * The copilot adds a todo the list then shows, narrows the view on screen (job 6), waits for the
 * person to approve or deny a clear, and in look-only mode is refused a change (job 10).
 * Build the page and the backend first: `pnpm build`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setStore, TodoStore } from '@afd/example-todo-ts/store';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createChatBackend } from '../../backend/src/chat.js';
import { type ChatServer, createChatServer } from '../../backend/src/chat-http.js';
import { Copilot, type ModelCall, type ModelMessage } from '../../backend/src/copilot.js';
import { loadChatServerConfig } from '../../backend/src/http-security.js';
import { createTodoServices, type TodoServices } from '../../backend/src/services.js';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

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

/** What the scripted model does for a message: its tool calls, then its answer. */
const SCRIPT: { match: RegExp; calls: ModelCall[]; answer: (result: unknown) => string }[] = [
	{
		match: /tomatoes/,
		calls: [{ name: 'todo-create', args: { title: 'Water the tomatoes', priority: 'high' } }],
		answer: () => 'Added it.',
	},
	{
		match: /urgent/,
		calls: [
			{
				name: 'view-state-set',
				args: { id: 'todo-filter', state: { status: 'pending', priority: 'high' } },
			},
		],
		answer: () => 'The list shows your urgent open todos.',
	},
	{
		match: /clear/i,
		calls: [{ name: 'todo-clear', args: {} }],
		answer: (result) =>
			(result as { success?: boolean } | undefined)?.success ? 'Cleared.' : 'Not cleared.',
	},
	{
		match: /sneak/,
		calls: [{ name: 'todo-create', args: { title: 'Sneaked in' } }],
		answer: () => 'I am only looking.',
	},
];

/** A model that follows {@link SCRIPT}: the calls in its first round, then the answer. */
const model = {
	async respond({ messages }: { messages: readonly ModelMessage[] }) {
		const first = messages[0];
		const step = SCRIPT.find(({ match }) => first?.role === 'user' && match.test(first.text));
		if (!step) return { text: 'I did not follow that.', calls: [] };
		const last = messages.at(-1);
		if (last?.role !== 'tool') return { calls: step.calls };
		return { text: step.answer(last.results[0]?.result), calls: [] };
	},
};

let browser: Browser;
let chat: ChatServer;
let services: TodoServices;
let pageUrl: string;
let store: TodoStore;

beforeAll(async () => {
	if (!existsSync(`${DIST}index.html`)) throw new Error('Build the page first: pnpm build');
	const port = await freePort();
	const env = { CHAT_PORT: String(port) };
	const config = loadChatServerConfig(env);
	services = createTodoServices(env, config);
	chat = createChatServer(config, {
		chat: createChatBackend(new Copilot({ registry: services.registry, model }), () => {}),
		mcp: services.mcp,
		frontendDir: DIST,
		onError: () => {},
	});
	await new Promise<void>((ready) => chat.server.listen(port, '127.0.0.1', ready));
	pageUrl = `http://127.0.0.1:${port}/`;
	browser = await chromium.launch();
});

afterAll(async () => {
	await browser?.close();
	services?.mcp.dispose();
	chat?.server.closeAllConnections();
	await new Promise((done) => chat?.server.close(() => done(undefined)));
});

beforeEach(() => {
	store = new TodoStore();
	setStore(store);
});

async function openPage(): Promise<Page> {
	const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
	const page = await context.newPage();
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(pageUrl);
	await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
	expect(errors).toEqual([]);
	return page;
}

async function ask(page: Page, message: string): Promise<void> {
	const field = page.locator('violet-text-field.copilot-input input');
	await field.fill(message);
	await field.press('Enter');
}

/** The copilot's last answer, once its turn has ended. */
async function lastAnswer(page: Page): Promise<string> {
	const last = page.locator('.copilot-entry violet-message').last();
	await expect.poll(() => last.getAttribute('streaming')).toBeNull();
	return last.locator('violet-message-text').innerText();
}

describe('the copilot page', () => {
	it('adds a todo the list then shows, as the copilot', async () => {
		const page = await openPage();
		await ask(page, 'Remind me to water the tomatoes');

		await page.locator('li.todo', { hasText: 'Water the tomatoes' }).waitFor();
		expect(await lastAnswer(page)).toBe('Added it.');
		const card = page.locator('violet-tool-call-card.copilot-call');
		expect(await card.getAttribute('tool-name')).toBe('todo-create');
		expect(await card.getAttribute('state')).toBe('output-available');
		await expect.poll(() => page.locator('.history-list').innerText()).toContain('agent');
		await page.context().close();
	});

	it('narrows the list on screen when asked to show something (job 6)', async () => {
		store.create({ title: 'Urgent and open', priority: 'high' });
		store.create({ title: 'Can wait', priority: 'low' });
		const page = await openPage();
		await ask(page, 'Show only my urgent open todos');

		expect(await lastAnswer(page)).toBe('The list shows your urgent open todos.');
		await expect
			.poll(() =>
				page
					.locator('violet-segmented-control.filter-status')
					.evaluate((element) => (element as HTMLInputElement).value)
			)
			.toBe('pending');
		await expect.poll(() => page.locator('li.todo', { hasText: 'Can wait' }).count()).toBe(0);
		expect(await page.locator('li.todo', { hasText: 'Urgent and open' }).count()).toBe(1);
		await page.context().close();
	});

	it('clears completed todos only once the person approves, in the panel', async () => {
		const done = store.create({ title: 'Picked the beans' });
		store.toggle(done.id);
		const page = await openPage();
		await ask(page, 'Clear the done ones');

		const card = page.locator('violet-approval-card.copilot-approval');
		await expect.poll(() => card.innerText()).toContain('Remove the completed todos for good');
		expect(store.count()).toBe(1);
		await card.getByRole('button', { name: /approve/i }).click();

		expect(await lastAnswer(page)).toBe('Cleared.');
		expect(await card.getAttribute('state')).toBe('approved');
		expect(store.count()).toBe(0);
		await expect
			.poll(() => page.locator('li.todo', { hasText: 'Picked the beans' }).count())
			.toBe(0);
		await page.context().close();
	});

	it('keeps everything when the person denies the clear', async () => {
		const done = store.create({ title: 'Dug the potatoes' });
		store.toggle(done.id);
		const page = await openPage();
		await ask(page, 'Clear the done ones');

		const card = page.locator('violet-approval-card.copilot-approval');
		await card.getByRole('button', { name: /deny/i }).click();

		expect(await lastAnswer(page)).toBe('Not cleared.');
		expect(await card.getAttribute('state')).toBe('denied');
		expect(store.count()).toBe(1);
		await page.context().close();
	});

	it('is refused a change in look-only mode (job 10)', async () => {
		const page = await openPage();
		await page
			.locator('violet-segmented-control.copilot-mode violet-segment[value="look"]')
			.click();
		await ask(page, 'sneak a todo in');

		expect(await lastAnswer(page)).toBe('I am only looking.');
		const card = page.locator('violet-tool-call-card.copilot-call');
		expect(await card.getAttribute('state')).toBe('output-error');
		expect(await card.innerText()).toContain('COMMAND_NOT_ALLOWED');
		expect(store.count()).toBe(0);
		await page.context().close();
	});

	it('has no serious or critical accessibility violations after a turn', async () => {
		const page = await openPage();
		await ask(page, 'Remind me to water the tomatoes');
		await lastAnswer(page);
		// The page's CSP forbids inline script, so axe goes in through evaluate, not a script tag
		await page.evaluate(
			readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
		);
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
