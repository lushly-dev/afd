/**
 * P5-A1's Chromium place (phase 5 specification, 18): the slice's scenario files, run by the kernel's own runner
 * (`kernel/scenarios/runner.ts`, its directives read as in the units) against the built shell, served as a deployer
 * serves it, with `sandbox/` on its second origin. Each file runs in a fresh browser context, so on a fresh store, with
 * a fresh `mailfix` behind the test relay. And P5-A8's panel over that kernel's own records.
 *
 * **`p5-base`, by the shell's own commands.** The deployment holds the seed's apps (`hello`, `tally`, `checklist`),
 * `mailfix` over `http` through the relay at `mounts/mailfix/mcp` with the entry `mailfixEntry` lists, `mailfixapp`
 * with its `calls` grant, and `[copilot]` naming the test provider; `p5-no-provider` is the same with no `[copilot]`.
 * Once the page is up the person runs the seed's calls and sets its autonomy rows (`kernel/scenarios/host-seed.ts`), as
 * the kernel's seed does. The seed's fixed projects and documents, which the kernel writes to its store before it
 * starts, are not made: no slice file reads them. The agents' workspace row keeps its default, so 6.1's defaults hold.
 *
 * **The model.** The page's transport answers `kind = "test"` with the test provider, which the production shell gives
 * no scripts. Here the `copilot` chunk's `createHostTransport` alone is replaced, in the served site, by one whose test
 * provider plays the kernel's scenario scripts (`pages/scenario-model.ts`); the rest of the chunk, the frame on the
 * sandbox origin, its ports' halves and the runtime are the built shell's. What is replaced is the model, which sits
 * where a provider's endpoint would (the test provider's header).
 *
 * **Two files run on the desktop alone.** `approve-mail-send` and `person-sends-mail` need a mounted approval, which
 * milestone A gives the desktop alone (7.2): the web lane never reports `approvals: true`, so `mailfix`'s held send
 * cannot be released here. The first test shows that this lane opens it so; the desktop suite runs all nine.
 */

import { mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandResult } from '@lushly-dev/afd-core';
import { appPack } from '@lushly-dev/loam-cli';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	mailfixappEntryToml,
	mailfixEntryToml,
	P5_AUTONOMY,
	P5_HOST_CALLS,
	writeMailfixPackages,
} from '../../../kernel/scenarios/host-seed';
import { createMailfixHandler } from '../../../kernel/scenarios/mailfix';
import {
	namesTagged,
	readScenario,
	runScenario,
	type ScenarioHost,
	type ScenarioScope,
	seedOf,
} from '../../../kernel/scenarios/runner';
import { bundlePage } from './bundle';
import {
	axe,
	type DeploymentSite,
	deploymentEntry,
	kernelCall,
	openShell,
	packApp,
	type ShellPage,
	serveDeployment,
	setTheme,
	surfacesIdle,
} from './harness';

const PHASE_5 = fileURLToPath(
	new URL('../../../../docs/phases/5-copilot/scenarios/', import.meta.url)
);
const SLICE = namesTagged(PHASE_5, 'slice');
/** The slice's files whose jobs need a mounted approval, which milestone A gives the desktop alone (7.2). */
const DESKTOP_ONLY = ['approve-mail-send', 'person-sends-mail'];
const CHROMIUM = SLICE.filter((name) => !DESKTOP_ONLY.includes(name));

/** `mailfix` on loopback, given a fresh handler, so a fresh state, for each file. */
interface MailfixHttp {
	url: string;
	fresh(): void;
	close(): Promise<void>;
}

async function startMailfix(): Promise<MailfixHttp> {
	let handler = createMailfixHandler();
	const server: Server = createServer((request: IncomingMessage, response: ServerResponse) =>
		handler(request, response)
	);
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/mcp`,
		fresh() {
			handler.dispose();
			handler = createMailfixHandler();
		},
		close: () =>
			new Promise((done) => {
				handler.dispose();
				server.closeAllConnections();
				server.close(() => done());
			}),
	};
}

/**
 * The served site's `copilot` chunk, with its `createHostTransport` answered by the scenarios' model (the file's
 * header): the built chunk moves beside it, and every other export is the built chunk's own.
 */
async function scriptTheModel(site: DeploymentSite, model: string): Promise<void> {
	const assets = join(site.out, 'assets');
	const chunks: string[] = [];
	for (const name of await readdir(assets)) {
		if (!/^copilot-[\w-]+\.js$/.test(name)) continue;
		if (/\bcreateWebCopilot\b/.test(await readFile(join(assets, name), 'utf8'))) chunks.push(name);
	}
	if (chunks.length !== 1)
		throw new Error(`One copilot chunk expected, found ${chunks.join(', ')}`);
	const chunk = chunks[0] as string;
	const built = chunk.replace(/\.js$/, '.built.js');
	await rename(join(assets, chunk), join(assets, built));
	await writeFile(
		join(assets, chunk),
		[
			model,
			`export * from './${built}';`,
			'const model = loamTestPage.createScenarioProvider();',
			'export function createHostTransport() {',
			'\treturn {',
			'\t\tasync send(provider, body, signal) {',
			"\t\t\tif (provider.kind !== 'test')",
			"\t\t\t\tthrow Object.assign(new Error('No model transport for this kind here'), { code: 'COPILOT_PROVIDER_UNKNOWN' });",
			'\t\t\treturn model.send(body, signal);',
			'\t\t},',
			'\t};',
			'}',
			'',
		].join('\n')
	);
}

let browser: Browser;
let mailfix: MailfixHttp;
let packages: string;
/** By seed: `p5-base`'s deployment and `p5-no-provider`'s. */
const sites: Record<string, DeploymentSite> = {};

const COPILOT = [
	'[copilot]',
	'default = "test"',
	'',
	'[[copilot.providers]]',
	'id = "test"',
	'kind = "test"',
	'model = "scripted"',
];

beforeAll(async () => {
	mailfix = await startMailfix();
	packages = await mkdtemp(join(tmpdir(), 'loam-scenario-apps-'));
	const written = await writeMailfixPackages(packages, 'http');
	const pack = async (directory: string) => {
		const out = `${directory}-package`;
		const result = await appPack({ dir: directory, out });
		if (!result.out) throw new Error(JSON.stringify(result.report.refusals));
		return out;
	};
	const apps = [
		deploymentEntry('hello', await packApp('hello')),
		'',
		deploymentEntry('tally', await packApp('tally')),
		'',
		deploymentEntry('checklist', await packApp('checklist')),
		'',
		...mailfixEntryToml(await pack(written.mailfix), [
			'transport = "http"',
			`url = ${JSON.stringify(mailfix.url)}`,
		]),
		...mailfixappEntryToml(await pack(written.mailfixapp)),
	];
	const model = await bundlePage('scenario-model');
	for (const [seed, copilot] of [
		['p5-base', COPILOT],
		['p5-no-provider', []],
	] as const) {
		const site = await serveDeployment({
			config: ['deployment_version = 4', '', ...apps, ...copilot].join('\n'),
			sandbox: true,
			mounts: true,
		});
		if (copilot.length > 0) await scriptTheModel(site, model);
		sites[seed] = site;
	}
	browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
	await browser?.close();
	for (const site of Object.values(sites)) await site.close();
	await mailfix?.close();
	if (packages) await rm(packages, { recursive: true, force: true });
});

interface PageCall {
	kind: 'person' | 'agent' | 'port';
	command: string;
	input: unknown;
	scope?: ScenarioScope;
	instance?: string;
}

/** A call in the page, as plain data. A call that throws answers as a failure coded `THROWN:<code>`, which no scenario expects, so a throw fails its step here as in the kernel's units. */
function inPage(page: Page, call: PageCall): Promise<CommandResult<unknown>> {
	return page.evaluate(async ({ kind, command, input, scope, instance }) => {
		type Port = { call(name: string, input: unknown): Promise<unknown> };
		const shell = document.querySelector('loam-shell') as unknown as {
			kernel: {
				call(name: string, input: unknown, options?: object): Promise<unknown>;
				agent: { call(name: string, input: unknown, options?: object): Promise<unknown> };
				appPort(instance: string): Port & { surface(binding: object): Port };
			};
		};
		const { kernel } = shell;
		const options = scope ? { scope } : {};
		try {
			if (kind === 'agent') return await kernel.agent.call(command, input, options);
			if (kind === 'port') {
				const port = kernel.appPort(instance as string);
				return await (scope ? port.surface({ scope }) : port).call(command, input);
			}
			return await kernel.call(command, input, options);
		} catch (error) {
			const { code, message } = error as { code?: unknown; message?: unknown };
			return {
				success: false,
				error: { code: `THROWN:${String(code ?? '')}`, message: String(message ?? error) },
			};
		}
	}, call) as Promise<CommandResult<unknown>>;
}

const hostOf = (page: Page): ScenarioHost => ({
	inactiveApp: 'checklist',
	call: (command, input, scope) => inPage(page, { kind: 'person', command, input, scope }),
	agent: (command, input, scope) => inPage(page, { kind: 'agent', command, input, scope }),
	port: (instance, command, input, scope) =>
		inPage(page, { kind: 'port', command, input, scope, instance }),
});

interface InstanceRow {
	instance: string;
	state: string;
	warnings?: { code: string }[];
}

/** `app-instance-list`'s row for `mailfix`, once its discovery has settled. */
async function mailfixRow(page: Page): Promise<InstanceRow> {
	const deadline = Date.now() + 20_000;
	for (;;) {
		const listed = (await kernelCall(page, 'app-instance-list')) as {
			data?: { instances: InstanceRow[] };
		};
		const row = listed.data?.instances.find((each) => each.instance === 'mailfix');
		if (row?.state === 'ready') return row;
		if (Date.now() > deadline) throw new Error(`mailfix stayed ${JSON.stringify(row)}`);
		await page.waitForTimeout(100);
	}
}

/**
 * A fresh page on `seed`'s deployment, on a fresh store and a fresh `mailfix`, with the seed's calls and rows made as
 * the person: `p5-base` by the shell's own commands (the file's header).
 */
async function seeded(seed: string): Promise<ShellPage> {
	const site = sites[seed];
	if (!site) throw new Error(`No deployment for the seed '${seed}'`);
	mailfix.fresh();
	const opened = await openShell(browser, site.origin, { agents: 'ask' });
	const { page } = opened;
	await mailfixRow(page);
	for (const { command, input } of P5_HOST_CALLS) {
		const done = await inPage(page, { kind: 'person', command, input });
		if (!done.success) throw new Error(`${seed}: ${command}: ${JSON.stringify(done.error)}`);
	}
	for (const [instance, command, mode] of P5_AUTONOMY) {
		const set = await inPage(page, {
			kind: 'person',
			command: 'autonomy-set',
			input: { level: 'workspace', instance, command, mode },
		});
		if (!set.success) throw new Error(`${seed}: ${JSON.stringify(set.error)}`);
	}
	return opened;
}

describe("P5-A1: the slice's scenarios in Chromium, against the built shell", () => {
	it('P5-A1: runs every slice file but the two a mounted approval needs, which the web lane opens without (7.2)', async () => {
		expect(SLICE).toHaveLength(9);
		expect(DESKTOP_ONLY.every((name) => SLICE.includes(name))).toBe(true);
		expect(CHROMIUM).toHaveLength(7);
		const opened = await seeded('p5-base');
		try {
			const row = await mailfixRow(opened.page);
			// The web lane opens no instance with approvals: the held send can be asked here, never released.
			expect(row.warnings?.map((warning) => warning.code)).toContain(
				'INSTANCE_APPROVALS_UNAVAILABLE'
			);
		} finally {
			await opened.context.close();
		}
	});

	for (const name of CHROMIUM) {
		it(`P5-A1: passes ${name}`, async () => {
			const scenario = readScenario(PHASE_5, `${name}.scenario.yaml`);
			const opened = await seeded(seedOf(scenario, 'p5-base'));
			try {
				const { passed, detail } = await runScenario(scenario, hostOf(opened.page));
				expect(passed, detail).toBe(true);
				expect(opened.violations).toEqual([]);
			} finally {
				await opened.context.close();
			}
		}, 60_000);
	}
});

/** The copilot's panel in the shell's panel part, once it has loaded. */
async function openPanel(page: Page): Promise<void> {
	await inPage(page, { kind: 'person', command: 'layout-set', input: { panel: { open: true } } });
	await page.locator('loam-copilot-panel violet-chat-composer textarea').waitFor();
	await surfacesIdle(page);
}

/** The person types a message into the panel's composer and sends it. */
async function ask(page: Page, text: string): Promise<void> {
	const composer = page.locator('loam-copilot-panel violet-chat-composer textarea');
	await composer.fill(text);
	await composer.press('Enter');
}

const cards = (page: Page) => page.locator('loam-copilot-panel .cards');

/** The state of a confirmation, by its notification's id. */
async function confirmationState(page: Page, id: string): Promise<string | undefined> {
	const read = (await kernelCall(page, 'notification-list', { kind: 'confirmation' })) as {
		data?: { notifications: Array<{ id: string; confirmation?: { state: string } }> };
	};
	return read.data?.notifications.find((each) => each.id === id)?.confirmation?.state;
}

describe("P5-A8: the panel over the slice's kernel, in Chromium", () => {
	it("P5-A8: draws the kernel's cards for a tainted turn, marks its reply, and answers a person's press alone", async () => {
		const opened = await seeded('p5-base');
		try {
			const { page } = opened;
			await openPanel(page);
			// The person asks, by typing: `obey-thr-2` reads a stranger's message, then asks once and suggests once.
			await ask(page, 'script:obey-thr-2');
			const region = cards(page);
			await region.locator('violet-approval-card').waitFor({ timeout: 20_000 });
			await region.locator('.suggestion').waitFor();
			// The cards are the kernel's records: one confirmation for project-create, asked for taint, naming its source.
			const listed = (await kernelCall(page, 'notification-list', { kind: 'confirmation' })) as {
				data: {
					notifications: Array<{ id: string; confirmation: { command: string; state: string } }>;
				};
			};
			expect(listed.data.notifications.map((each) => each.confirmation)).toMatchObject([
				{ command: 'project-create', state: 'pending' },
			]);
			const id = listed.data.notifications[0]?.id as string;
			expect(
				(await region.locator('violet-approval-card .card-why').allTextContents()).join(' ')
			).toContain('mailfix');
			expect(await region.locator('.suggestion .card-title').textContent()).toBe(
				'Suggested: tally-reset'
			);
			// The tainted session's reply is marked.
			expect(await region.locator('.taint').textContent()).toBe(
				'This answer may repeat text from mailfix'
			);
			// A script's click answers nothing.
			await page.evaluate(() => {
				const buttons = document
					.querySelector('loam-shell')
					?.shadowRoot?.querySelector('loam-copilot-panel')
					?.shadowRoot?.querySelectorAll('.cards violet-button');
				for (const button of buttons ?? []) (button as HTMLElement).click();
			});
			await page.waitForTimeout(300);
			expect(await confirmationState(page, id)).toBe('pending');
			// The person's own press declines it, on the kernel's record.
			await region.getByText('Decline').first().click();
			const deadline = Date.now() + 10_000;
			while ((await confirmationState(page, id)) !== 'declined' && Date.now() < deadline)
				await page.waitForTimeout(100);
			expect(await confirmationState(page, id)).toBe('declined');
			expect(opened.errors).toEqual([]);
		} finally {
			await opened.context.close();
		}
	}, 60_000);

	it('P5-A8: passes axe with those cards and the mark drawn, in light, dark and high contrast', async () => {
		for (const theme of ['light', 'dark', 'high-contrast'] as const) {
			const opened = await seeded('p5-base');
			try {
				const { page } = opened;
				await setTheme(page, theme);
				await openPanel(page);
				await ask(page, 'script:obey-thr-2');
				await cards(page).locator('.taint').waitFor({ timeout: 20_000 });
				await surfacesIdle(page);
				expect(await axe(page), theme).toEqual([]);
			} finally {
				await opened.context.close();
			}
		}
	}, 120_000);
});
