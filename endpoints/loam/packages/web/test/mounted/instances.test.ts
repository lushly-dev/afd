/**
 * E4 (phase 1 specification, section 14): instances, D55, D56, D58, L6 and L7, against two real Umbel
 * workspaces, through a test-only relay. Nothing in the page holds an instance's location or credential, and
 * one instance's failure is reported, skipped, and recovers.
 */
import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agentCall,
	type DeploymentSite,
	DIST,
	deploymentFile,
	journal,
	kernelCall,
	loam,
	openApp,
	openShell,
	serveDeployment,
	settle,
	surfacesIdle,
} from '../browser/harness';
import { startHostileServer, XSS } from './hostile-server';
import { instanceEntry, packUmbel, runFromConsole, untilInstance } from './support';
import { createUmbelWorkspace, startUmbel, type UmbelInstance } from './umbel-fixture';

let browser: Browser;
let directory: string;
let work: UmbelInstance;
let home: UmbelInstance;
let umbelPackage: string;

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'loam-instances-'));
	await createUmbelWorkspace(join(directory, 'work'));
	await createUmbelWorkspace(join(directory, 'home'));
	work = await startUmbel(join(directory, 'work'));
	home = await startUmbel(join(directory, 'home'));
	umbelPackage = await packUmbel();
	browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
	await browser?.close();
	await work?.stop();
	await home?.stop();
	await rm(directory, { recursive: true, force: true });
});

const twoInstances = () =>
	deploymentFile(
		instanceEntry('work', 'umbel', umbelPackage, work, { prefix: 'work', audience: 'team' }),
		instanceEntry('home', 'umbel', umbelPackage, home, { prefix: 'home', audience: 'person' })
	);

async function withSite<T>(config: string, run: (site: DeploymentSite) => Promise<T>): Promise<T> {
	const site = await serveDeployment({ config, mounts: true });
	try {
		return await run(site);
	} finally {
		await site.close();
	}
}

/** Failed requests are the browser's own report of what these tests provoke. */
const notNetwork = (errors: string[]) =>
	errors.filter((error) => !error.startsWith('Failed to load resource'));

async function filesUnder(root: string): Promise<string[]> {
	const found: string[] = [];
	for (const name of await readdir(root)) {
		const path = join(root, name);
		if ((await lstat(path)).isDirectory()) found.push(...(await filesUnder(path)));
		else found.push(path);
	}
	return found;
}

const rowsOf = (page: Page) =>
	page
		.locator('loam-console violet-option')
		.evaluateAll((rows) => rows.map((row) => (row as HTMLElement & { value: string }).value));

describe('E4: instances, through a test-only relay', () => {
	it('loads two instances with names apart, and no location or credential reaches the page', async () => {
		await withSite(twoInstances(), async (site) => {
			const { page, errors, violations, context } = await openShell(browser, site.origin);
			await untilInstance(page, 'work', 'ready');
			await untilInstance(page, 'home', 'ready');
			await openApp(page, 'work');
			expect(await rowsOf(page)).toContain('work-hello-greet');
			expect(await rowsOf(page)).not.toContain('home-hello-greet');
			await openApp(page, 'home');
			expect(await rowsOf(page)).toContain('home-hello-greet');
			const answered = (await kernelCall(page, 'home-hello-greet', { name: 'Ada' })) as {
				metadata: Record<string, unknown>;
			};
			expect(answered.metadata['dev.loam/instance']).toBe('home');

			const secrets = [
				work.url,
				home.url,
				String(work.port),
				String(home.port),
				await work.token(),
				await home.token(),
				work.tokenFile,
				home.tokenFile,
			];
			// A bare port can match by chance inside a timestamp or an id, so a number must stand alone.
			const inText = (text: string) =>
				secrets.filter((secret) =>
					/\D/.test(secret)
						? text.includes(secret)
						: new RegExp(`(?<![0-9A-Za-z])${secret}(?![0-9A-Za-z])`).test(text)
				);
			for (const file of await filesUnder(site.out)) {
				// Numbers can match a port by chance in a bundle, so a served bundle is checked for the rest.
				const text = await readFile(file, 'utf8').catch(() => '');
				const looking = /\.js$/.test(file)
					? secrets.filter((secret) => /\D/.test(secret))
					: secrets;
				expect(
					looking.filter((secret) => text.includes(secret)),
					file
				).toEqual([]);
			}
			const projection = await readFile(join(site.out, 'deployment.json'), 'utf8');
			expect(inText(projection)).toEqual([]);
			expect(projection).not.toMatch(/"(url|bearer_file|bearer_env|command|cwd)"/);

			for (const name of ['app-list', 'app-instance-list']) {
				expect(inText(JSON.stringify(await kernelCall(page, name)))).toEqual([]);
			}
			for (const instance of ['work', 'home']) {
				for (const name of ['app-get', 'app-command-list']) {
					expect(inText(JSON.stringify(await kernelCall(page, name, { instance })))).toEqual([]);
				}
			}
			await settle(page);
			const entries = await page.evaluate(async () => {
				const shell = document.querySelector('loam-shell') as unknown as {
					journal: { read(): Promise<unknown[]> };
				};
				return shell.journal.read();
			});
			expect(inText(JSON.stringify(entries))).toEqual([]);
			expect(JSON.stringify(entries)).toContain('app-instance-refresh');

			const storage = await page.evaluate(() =>
				JSON.stringify({ ...localStorage, ...sessionStorage })
			);
			expect(inText(storage)).toEqual([]);
			expect(site.relay?.log.length).toBeGreaterThan(0);
			expect(site.relay?.log.filter((entry) => entry.pageAuthorization !== undefined)).toEqual([]);
			expect(site.relay?.log.flatMap((entry) => entry.pageHeaders)).not.toContain('authorization');
			const policy = await page
				.locator('meta[http-equiv="Content-Security-Policy"]')
				.getAttribute('content');
			expect(policy).toMatch(/connect-src 'self'(;|$)/);
			expect(policy).not.toContain('127.0.0.1');
			expect(notNetwork(errors)).toEqual([]);
			expect(violations).toEqual([]);
			await context.close();
		});
	});

	it('refuses the same prefix twice, with the exact message, and a shell domain', async () => {
		await withSite(
			deploymentFile(
				instanceEntry('work', 'umbel', umbelPackage, work, { prefix: 'umbel', audience: 'team' }),
				instanceEntry('home', 'umbel', umbelPackage, home, { prefix: 'umbel', audience: 'person' }),
				instanceEntry('shelled', 'umbel', umbelPackage, home, {
					prefix: 'layout',
					audience: 'person',
				})
			),
			async (site) => {
				const { page, context } = await openShell(browser, site.origin);
				const { data } = (await kernelCall(page, 'app-instance-list')) as {
					data: {
						instances: Array<{
							instance: string;
							state: string;
							error?: { code: string; message: string };
						}>;
					};
				};
				const of = (instance: string) => data.instances.find((row) => row.instance === instance);
				expect(of('home')?.state).toBe('refused');
				expect(of('home')?.error?.code).toBe('INSTANCE_PREFIX_CONFLICT');
				expect(of('home')?.error?.message).toBe(
					'Command prefix `umbel` is already used by instance `work`; choose another prefix for `home`.'
				);
				expect(of('shelled')?.state).toBe('refused');
				expect(of('shelled')?.error?.code).toBe('INSTANCE_PREFIX_CONFLICT');
				await context.close();
			}
		);
	});

	it('fails a stdio entry, and deployment check reports it as trusted code', async () => {
		const config = deploymentFile(
			instanceEntry('work', 'umbel', umbelPackage, work, { prefix: 'work', audience: 'team' }),
			[
				'[apps.home]',
				'app = "umbel"',
				`package = ${JSON.stringify(umbelPackage)}`,
				'prefix = "home"',
				'audience = "person"',
				'transport = "stdio"',
				'command = ["umbel", "--workspace", "/srv/notes-umbel", "serve", "--stdio"]',
			].join('\n')
		);
		const file = join(directory, 'stdio.toml');
		await writeFile(file, config);
		const check = await loam(['deployment', 'check', file], directory);
		expect(JSON.stringify(check.output)).toContain('STDIO_TRUSTED_CODE');
		await withSite(config, async (site) => {
			const { page, context } = await openShell(browser, site.origin);
			const home = await untilInstance(page, 'home', 'failed');
			expect(home.error?.code).toBe('MOUNT_TRANSPORT_UNAVAILABLE');
			expect(await readFile(join(site.out, 'deployment.json'), 'utf8')).not.toContain(
				'notes-umbel'
			);
			await untilInstance(page, 'work', 'ready');
			await context.close();
		});
	});

	it('says a wrong token is MOUNT_UNAUTHORIZED, without what the refusal named', async () => {
		const wrong = join(directory, 'wrong.token');
		await writeFile(wrong, 'not-the-token\n', { mode: 0o600 });
		await withSite(
			deploymentFile(
				instanceEntry(
					'work',
					'umbel',
					umbelPackage,
					{ url: work.url, tokenFile: wrong },
					{ prefix: 'work', audience: 'team' }
				)
			),
			async (site) => {
				const { page, context, errors } = await openShell(browser, site.origin);
				const row = await untilInstance(page, 'work', 'failed');
				expect(row.error?.code).toBe('MOUNT_UNAUTHORIZED');
				await settle(page);
				const entries = await journal(page);
				// Umbel's 401 body names its token file. That text reaches neither the page's result nor the journal.
				expect(JSON.stringify(entries)).not.toContain('http.token');
				expect(JSON.stringify(row)).not.toContain('http.token');
				expect(notNetwork(errors)).toEqual([]);
				await context.close();
			}
		);
	});

	it('reports a stopped instance, skips it, keeps the other working, and recovers', async () => {
		await withSite(twoInstances(), async (site) => {
			const { page, errors, violations, context } = await openShell(browser, site.origin);
			await untilInstance(page, 'work', 'ready');
			await untilInstance(page, 'home', 'ready');
			await openApp(page, 'work');

			await work.stop();
			const refresh = (await kernelCall(page, 'app-instance-refresh', { instance: 'work' })) as {
				error?: { code: string; suggestion: string };
			};
			expect(refresh.error?.code).toBe('MOUNT_UNREACHABLE');
			expect((await untilInstance(page, 'work', 'failed')).error?.code).toBe('MOUNT_UNREACHABLE');
			await surfacesIdle(page);
			// The console re-read on its own: this call was an agent's or the kernel's, not its Refresh button.
			await page.locator('loam-console .notice.failure').waitFor();
			expect(await page.locator('loam-console .notice.failure').textContent()).toContain(
				'MOUNT_UNREACHABLE'
			);
			// The last good commands stay listed, and a call says why it cannot run.
			const during = (await kernelCall(page, 'work-hello-greet', { name: 'Ada' })) as {
				error?: { code: string };
			};
			expect(during.error?.code).toBe('MOUNT_UNREACHABLE');
			const other = (await kernelCall(page, 'home-hello-greet', { name: 'Ada' })) as {
				success: boolean;
			};
			expect(other.success).toBe(true);

			await work.restart();
			const again = (await agentCall(page, 'app-instance-refresh', { instance: 'work' })) as {
				success: boolean;
			};
			expect(again.success).toBe(true);
			await untilInstance(page, 'work', 'ready');
			await surfacesIdle(page);
			await page.locator('loam-console .notice.failure').waitFor({ state: 'detached' });
			await page.locator('loam-console violet-option[value="work-hello-greet"]').click();
			const { result, labels } = await runFromConsole(page);
			expect(labels).toContain('Untrusted: from work');
			expect(result).toContain('Hello,');
			expect(notNetwork(errors)).toEqual([]);
			expect(violations).toEqual([]);
			await context.close();
		});
	});

	it('shows no relay as unreachable: a deployment has nothing on the route in phase 1', async () => {
		const site = await serveDeployment({
			config: deploymentFile(
				instanceEntry('work', 'umbel', umbelPackage, work, { prefix: 'work', audience: 'team' })
			),
		});
		const { page, errors, context } = await openShell(browser, site.origin);
		const row = await untilInstance(page, 'work', 'failed');
		expect(row.error?.code).toBe('MOUNT_UNREACHABLE');
		expect(notNetwork(errors)).toEqual([]);
		await context.close();
		await site.close();
	});

	it("shows D55's notice in a team instance's console", async () => {
		await withSite(twoInstances(), async (site) => {
			const { page, context } = await openShell(browser, site.origin);
			await untilInstance(page, 'work', 'ready');
			await openApp(page, 'work');
			expect(await page.locator('loam-console .notice').allTextContents()).toContain(
				"Umbel sees one principal for every member of this instance's projects. Mount it only where each of them may read all of it."
			);
			await openApp(page, 'home');
			expect(await page.locator('loam-console .notice').allTextContents()).not.toContain(
				"Umbel sees one principal for every member of this instance's projects. Mount it only where each of them may read all of it."
			);
			await context.close();
		});
	});

	it('leaves the relay out of what a deployment serves', async () => {
		const source = fileURLToPath(new URL('../../src', import.meta.url));
		for (const root of [source, DIST]) {
			for (const file of await filesUnder(resolve(root))) {
				const text = await readFile(file, 'utf8').catch(() => '');
				expect(text.includes('createMountRelay'), file).toBe(false);
				expect(text.includes('mount-relay'), file).toBe(false);
			}
		}
	});
});

describe('A hostile server, through the same relay (D41, D65)', () => {
	it('renders what it says as text, and widens nothing by what it claims', async () => {
		const server = await startHostileServer();
		const hostilePackage = umbelPackage;
		try {
			await withSite(
				deploymentFile(
					[
						'[apps.bad]',
						'app = "umbel"',
						`package = ${JSON.stringify(hostilePackage)}`,
						'prefix = "bad"',
						'audience = "person"',
						'transport = "http"',
						`url = ${JSON.stringify(server.url)}`,
						'[apps.bad.commands."bad-nothing"]',
						'expose = { palette = true }',
					].join('\n')
				),
				async (site) => {
					const { page, errors, violations, context } = await openShell(browser, site.origin);
					const booted = Date.now();
					await untilInstance(page, 'bad', 'ready');
					// A catastrophic `pattern` in an `outputSchema` it lists runs nowhere: discovery lists no tools.
					expect(Date.now() - booted).toBeLessThan(5_000);
					await openApp(page, 'bad');
					const rows = await rowsOf(page);
					expect(rows).toEqual(
						expect.arrayContaining([
							'bad-bad-read',
							'bad-bad-approval',
							'bad-bad-forged',
							'bad-bad-text',
						])
					);
					for (const hidden of ['bad-bad-unreported', 'bad-bad-mutation', 'bad-bad-destructive']) {
						expect(rows).not.toContain(hidden);
						const refused = (await kernelCall(page, hidden)) as { error?: { code: string } };
						expect(refused.error?.code).toBe('COMMAND_NOT_EXPOSED');
					}
					expect(rows.filter((row) => row.includes('secret') || row.includes('gone'))).toEqual([]);
					expect(rows.filter((row) => row.includes('closed'))).toEqual([]);
					// A tool that would be the shell's own takes the prefix, as `bad-app-list`, and no shell name.
					expect(rows).toContain('bad-app-list');
					const { data } = (await kernelCall(page, 'app-instance-list')) as {
						data: { instances: Array<{ hidden: number; warnings: Array<{ code: string }> }> };
					};
					const instance = data.instances[0];
					expect(instance?.hidden).toBe(3);
					expect(instance?.warnings.map(({ code }) => code)).toEqual(
						expect.arrayContaining(['MOUNT_TOOL_UNNAMEABLE', 'INSTANCE_OVERRIDE_UNKNOWN'])
					);

					await page.locator('loam-console violet-option[value="bad-bad-approval"]').click();
					await page
						.locator('loam-console .command-flag')
						.filter({ hasText: 'Needs approval' })
						.waitFor();

					// A catastrophic `pattern` is not run in the page: Run answers at once, and the server decides.
					await page.locator('loam-console violet-option[value="bad-bad-read"]').click();
					const field = page
						.locator('loam-console violet-text-field')
						.filter({ hasText: 'text' })
						.locator('input');
					await field.fill(`${'a'.repeat(40)}!`);
					const started = Date.now();
					const read = await runFromConsole(page);
					expect(Date.now() - started).toBeLessThan(5_000);
					expect(read.labels).toContain('Untrusted: from bad');
					expect(read.labels).not.toContain('Untrusted: from shell');
					expect(read.labels.some((label) => label.startsWith('Journal entry 999999'))).toBe(false);

					await page.locator('loam-console violet-option[value="bad-bad-forged"]').click();
					const forged = await runFromConsole(page);
					expect(forged.result).toContain('<img src=x');
					const pwned = await page.evaluate(() => (window as { pwned?: unknown }).pwned);
					expect(pwned).toBeUndefined();
					const markup = await page.evaluate(() => {
						const root = document
							.querySelector('loam-shell')
							?.shadowRoot?.querySelector('loam-main loam-mount')
							?.shadowRoot?.querySelector('loam-console')?.shadowRoot;
						return root ? root.querySelectorAll('img, script').length : -1;
					});
					expect(markup).toBe(0);
					await page.locator('loam-console violet-option[value="bad-bad-text"]').click();
					const invalid = await runFromConsole(page);
					expect(invalid.result).toContain('MOUNT_RESULT_INVALID');

					// A result with no end: the tab reads no more than the limit, and the call answers.
					const huge = (await kernelCall(page, 'bad-bad-huge')) as { error?: { code: string } };
					expect(huge.error?.code).toMatch(/^MOUNT_(RESULT_INVALID|TIMEOUT|UNREACHABLE)$/);
					expect(site.relay?.log.filter(({ method }) => method === 'GET')).toEqual([]);

					await settle(page);
					const entries = await journal(page);
					const call = entries.find(({ command }) => command === 'bad-bad-forged');
					expect(call?.context).toMatchObject({ instance: 'bad', replay: 'recorded' });
					// The server's text is data in the journal; the marks it forged are not.
					expect(notNetwork(errors)).toEqual([]);
					expect(violations).toEqual([]);
					expect(XSS).toContain('onerror');
					await context.close();
				}
			);
		} finally {
			await server.close();
		}
	});
});
