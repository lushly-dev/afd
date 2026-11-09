/**
 * E3 and E9's mounted part (phase 1 specification, section 14): hello mounted, and a real Umbel in the
 * console, through a test-only relay. Proved: the stock `umbel`, its bearer layer, the browser's MCP client
 * under the CSP, discovery, the console and the journal. Not proved: a hosted server, multi-member use,
 * stdio or the desktop (7.1, D64).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JournalEntry } from '@lushly-dev/afd-core';
import {
	createFixedEnvironment,
	createFixturePorts,
	replayKernel,
} from '@lushly-dev/loam-kernel/testing';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	type DeploymentSite,
	deploymentFile,
	journal,
	kernelCall,
	measureFirstPaint,
	openApp,
	openShell,
	packApp,
	serveDeployment,
	settle,
	surfacesIdle,
} from '../browser/harness';
import { instanceEntry, packUmbel, runFromConsole, untilInstance } from './support';
import { createUmbelWorkspace, startUmbel, type UmbelInstance } from './umbel-fixture';

let browser: Browser;
let directory: string;
let umbel: UmbelInstance;
let site: DeploymentSite;
let umbelPackage: string;

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'loam-mounted-'));
	const workspace = join(directory, 'work');
	await createUmbelWorkspace(workspace);
	umbel = await startUmbel(workspace);
	umbelPackage = await packUmbel();
	const hello = await packApp('hello', 'mounted');
	site = await serveDeployment({
		mounts: true,
		config: deploymentFile(
			instanceEntry('hello', 'hello', hello, umbel, { audience: 'person' }),
			instanceEntry('work', 'umbel', umbelPackage, umbel, { prefix: 'work', audience: 'team' })
		),
	});
	browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
	await browser?.close();
	await site?.close();
	await umbel?.stop();
	await rm(directory, { recursive: true, force: true });
});

const commandRow = (page: Page, name: string) =>
	page.locator(`loam-console violet-option[value="${name}"]`);

describe('P2-E13: E3: hello mounted, and a real Umbel in the console, through a test-only relay', () => {
	it('answers hello-greet from the console form', async () => {
		const { page, errors, violations, context } = await openShell(browser, site.origin);
		expect(await page.evaluate(() => document.documentElement.dataset.loamHost)).toBe('web');
		// Nothing of the mounted path before first paint (9.2): discovery runs after it.
		expect(
			(await measureFirstPaint(page)).filter((path) => /\/assets\/mount-|\/mounts\//.test(path))
		).toEqual([]);
		await untilInstance(page, 'hello', 'ready');
		await openApp(page, 'hello');
		await commandRow(page, 'hello-greet').click();
		await page
			.locator('loam-console violet-text-field')
			.filter({ hasText: 'name' })
			.locator('input')
			.fill('Ada');
		const { result, labels } = await runFromConsole(page);
		expect(result).toContain('Hello, Ada!');
		expect(labels).toContain('Untrusted: from hello');
		expect(labels).toContain('Recorded, not replayable');
		expect(errors).toEqual([]);
		// The mount chunk loaded, and Zod's probe never fired under `script-src 'self'` (#664).
		expect(violations).toEqual([]);
		expect(site.log.some(({ path }) => /\/assets\/mount-/.test(path))).toBe(true);
		expect(
			await page.evaluate(
				() =>
					(globalThis as { __zod_globalConfig?: { jitless?: boolean } }).__zod_globalConfig?.jitless
			)
		).toBe(true);
		await context.close();
	});

	it('lists a real Umbel, renders its result as data and journals it as recorded', async () => {
		const { page, errors, violations, context } = await openShell(browser, site.origin);
		await untilInstance(page, 'work', 'ready');
		await openApp(page, 'work');
		const names = await page
			.locator('loam-console violet-option')
			.evaluateAll((rows) => rows.map((row) => (row as HTMLElement & { value: string }).value));
		expect(names).toContain('work-hello-greet');
		expect(names).toContain('work-workspace-show');
		expect(names.filter((name) => name.includes('afd-'))).toEqual([]);
		expect(names).not.toContain('work-event-ack');
		await commandRow(page, 'work-hello-greet').click();
		await page.locator('loam-console form').waitFor();
		expect(await page.locator('loam-console form violet-text-field').count()).toBe(2);
		await page
			.locator('loam-console violet-text-field')
			.filter({ hasText: 'name' })
			.locator('input')
			.fill('Ada');
		const { result, labels } = await runFromConsole(page);
		expect(result).toContain('Hello, Ada!');
		expect(labels).toContain('Untrusted: from work');
		expect(labels).toContain('Recorded, not replayable');
		await settle(page);
		const entries = await journal(page);
		const call = entries.find(({ command }) => command === 'work-hello-greet');
		expect(call?.input).toEqual({ name: 'Ada' });
		expect(call?.context).toMatchObject({ app: 'umbel', instance: 'work', replay: 'recorded' });
		expect(errors).toEqual([]);
		expect(violations).toEqual([]);
		await context.close();
	});

	it('hides and refuses a reported mutation until the entry names it', async () => {
		const { page, context } = await openShell(browser, site.origin);
		await untilInstance(page, 'work', 'ready');
		const refused = (await kernelCall(page, 'work-event-ack', { cursor: 'x' })) as {
			error?: { code?: string };
		};
		expect(refused.error?.code).toBe('COMMAND_NOT_EXPOSED');
		const agent = (await agentCall(page, 'work-event-ack', { cursor: 'x' })) as {
			error?: { code?: string };
		};
		expect(agent.error?.code).toBe('COMMAND_NOT_EXPOSED');
		await context.close();
		const named = await serveDeployment({
			mounts: true,
			config: deploymentFile(
				`${instanceEntry('work', 'umbel', umbelPackage, umbel, { prefix: 'work', audience: 'team' })}\n[apps.work.commands."work-event-ack"]\nexpose = { palette = true }\n`
			),
		});
		const open = await openShell(browser, named.origin);
		await untilInstance(open.page, 'work', 'ready');
		await openApp(open.page, 'work');
		await commandRow(open.page, 'work-event-ack').waitFor();
		const called = (await kernelCall(open.page, 'work-event-ack', { cursor: 'nope' })) as {
			error?: { code?: string };
			metadata?: Record<string, unknown>;
		};
		// It reached Umbel, whose own refusal comes back labeled.
		expect(called.metadata?.['dev.loam/trust']).toBe('untrusted');
		expect(called.error?.code).not.toBe('COMMAND_NOT_EXPOSED');
		await open.context.close();
		await named.close();
	});
});

describe("E9's mounted part: replay with Umbel stopped", () => {
	it('replays boot discovery and mounted calls with zero differences', async () => {
		const opened = await openShell(browser, site.origin);
		const { page } = opened;
		await untilInstance(page, 'work', 'ready');
		await kernelCall(page, 'app-open', { instance: 'work' });
		await surfacesIdle(page);
		await kernelCall(page, 'work-hello-greet', { name: 'Ada' });
		await agentCall(page, 'work-workspace-show');
		await kernelCall(page, 'app-instance-refresh', { instance: 'work' });
		await kernelCall(page, 'app-instance-list');
		await kernelCall(page, 'app-open', { instance: 'hello' });
		await surfacesIdle(page);
		await kernelCall(page, 'hello-greet', { name: 'Bot' });
		await kernelCall(page, 'layout-get');
		await settle(page);
		const entries = (await page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				journal: { read(): Promise<unknown[]> };
			};
			return shell.journal.read();
		})) as JournalEntry[];
		await opened.context.close();

		await umbel.stop();
		const manifestOf = async (instance: string) =>
			JSON.parse(
				await readFile(join(site.out, 'apps', instance, 'app-manifest.json'), 'utf8')
			) as unknown;
		const { report } = await replayKernel(entries, {
			environment: createFixedEnvironment(),
			deployment: site.projection,
			ports: createFixturePorts({
				'apps/hello/': { manifest: await manifestOf('hello') },
				'apps/work/': { manifest: await manifestOf('work') },
			}),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		expect(report.entries.length).toBe(entries.length);
		const recordedCalls = entries
			.filter(({ context }) => context?.replay === 'recorded')
			.map(({ seq }) => seq);
		expect(recordedCalls.length).toBeGreaterThanOrEqual(5);
		for (const seq of recordedCalls) expect(report.recorded).toContain(seq);
	}, 60_000);
});
