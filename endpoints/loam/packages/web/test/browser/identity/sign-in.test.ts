/**
 * E1, E10, E11 and E15 so far (phase 3 specification, 4.2, 4.6, 5.2, 14 and 18): a person signs in to a `provider`
 * deployment, through a test-only auth host. A real Better Auth 1.7.18 server stands behind `api/auth/` on the shell's
 * own HTTPS origin; it proves no hosted lane (2.4). Passkeys are made by Chromium's virtual authenticator, through its
 * DevTools `WebAuthn` domain: no real authenticator or platform prompt is involved, and the browser's own passkey
 * prompt, which is outside the page, is not tested.
 */

import type { JournalEntry } from '@lushly-dev/afd-core';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	addVirtualAuthenticator,
	axe,
	type DeploymentSite,
	deploymentEntry,
	focused,
	kernelCall,
	launchForDevHost,
	measureFirstPaint,
	openShell,
	packApp,
	providerDeployment,
	type ShellPage,
	serveDeployment,
	serveDist,
	settle,
} from '../harness';

const PASSWORD = 'correct horse battery staple';
const BEA = 'bea@example.com';

/** Every command `provider` mode runs with no session (2.1), as the kernel's `SIGNED_OUT_COMMANDS` lists them. */
const SIGNED_OUT = [
	'auth-sign-in',
	'auth-sign-out',
	'auth-session-get',
	'shell-info-get',
	'appearance-get',
	'appearance-set',
	'layout-get',
	'layout-set',
	'palette-open',
	'palette-close',
	'palette-search',
	'overlay-list',
	'overlay-dismiss',
	'modal-open',
	'toast-show',
	'scope-get',
	'section-get',
	'app-list',
	'workspace-get',
];

let browser: Browser;
let site: DeploymentSite;
/** Bea's passkey as the first test's virtual authenticator made it, with its private key, for the refusal below. */
let beaCredential: unknown;
const opened: ShellPage[] = [];

beforeAll(async () => {
	site = await serveDeployment({
		config: providerDeployment(
			['passkey', 'password'],
			deploymentEntry('hello', await packApp('hello'))
		),
		authHost: {
			organization: { slug: 'acme', name: 'Acme' },
			people: [
				{ email: BEA, name: 'Bea', role: 'member', password: PASSWORD },
				{ email: 'cy@example.com', name: 'Cy', role: 'member', password: PASSWORD },
				{ email: 'dee@example.com', name: 'Dee', role: null, password: PASSWORD },
			],
		},
	});
	browser = await launchForDevHost({ spki: site.spki as string });
});
afterAll(async () => {
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await browser?.close();
	await site?.close();
});

async function open(path = ''): Promise<ShellPage> {
	const page = await openShell(browser, `${site.root}${path}`);
	opened.push(page);
	return page;
}

const shadow = (page: Page, selector: string) => page.locator('loam-shell').locator(selector);

const entriesOf = (page: Page) =>
	page.evaluate(async () => {
		const shell = document.querySelector('loam-shell') as unknown as {
			journal: { read(): Promise<unknown[]> };
		};
		return shell.journal.read();
	}) as Promise<JournalEntry[]>;

const mainHeading = (page: Page) =>
	page.evaluate(
		() =>
			document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main')
				?.shadowRoot?.querySelector('h1')
				?.textContent?.trim() ?? ''
	);

/** The page's account name, or empty signed out, once the shell has read the session again. */
const accountOf = (page: Page) =>
	page.evaluate(
		() => (document.querySelector('loam-shell') as unknown as { account: string }).account
	);

async function signInWithPassword(page: Page, email: string): Promise<void> {
	await shadow(page, 'loam-titlebar .account').click();
	const dialog = shadow(page, 'loam-sign-in-dialog');
	await dialog.locator('#email').fill(email);
	await dialog.locator('#password').fill(PASSWORD);
	await dialog.getByRole('button', { name: 'Sign in with a password' }).click();
	await page.waitForFunction(
		() => (document.querySelector('loam-shell') as unknown as { account: string }).account !== ''
	);
	await settle(page);
}

describe('P3-E1: a person signs in with a passkey, through a test-only auth host', () => {
	it('P3-E1: paints a signed-out page that runs only the signed-out commands, its rail empty', async () => {
		const page = await open();
		expect(await mainHeading(page.page)).toBe('Sign in to acme');
		const apps = (await kernelCall(page.page, 'app-list')) as { data: { apps: unknown[] } };
		expect(apps.data.apps).toEqual([]);
		const search = (await kernelCall(page.page, 'palette-search', { query: '' })) as {
			data: { items: { name: string }[] };
		};
		expect(search.data.items.length).toBeGreaterThan(0);
		for (const item of search.data.items) expect(SIGNED_OUT).toContain(item.name);
		// Everything the chrome ran, journaled, is a signed-out command, and none was refused.
		const entries = await entriesOf(page.page);
		// Boot's own journaled work and `session-settle` are the kernel's, which no person or chrome calls (2.1).
		const own = [
			'workspace-deployment-apply',
			'app-settle',
			'document-trash-expire',
			'session-settle',
		];
		for (const entry of entries.filter((held) => !own.includes(held.command))) {
			expect(SIGNED_OUT, entry.command).toContain(entry.command);
			expect(entry.result.success, entry.command).toBe(true);
		}
		expect(page.errors).toEqual([]);
		expect(page.violations).toEqual([]);
	});

	it('P3-E1: signs in with a password, adds a passkey, signs out, and signs in with the passkey, journaling no credential', async () => {
		const page = await open();
		const authenticator = await addVirtualAuthenticator(page.page, { userVerified: true });
		await signInWithPassword(page.page, BEA);
		expect(await accountOf(page.page)).toBe('Bea');
		const bea = site.authHost?.people[BEA] as string;
		// The actor is the provider's user id.
		const created = (await kernelCall(page.page, 'project-create', { name: 'Atlas' })) as {
			success: boolean;
			error?: unknown;
		};
		expect(created.success, JSON.stringify(created.error)).toBe(true);
		const atlas = (await entriesOf(page.page)).find((entry) => entry.command === 'project-create');
		expect(atlas?.actor).toMatchObject({ kind: 'human', id: bea });
		// A fresh password session of a person with no passkey yet adds their first (5.2, D99).
		const added = (await kernelCall(page.page, 'account-passkey-add', { name: 'Laptop' })) as {
			success: boolean;
			error?: unknown;
		};
		expect(added.success, JSON.stringify(added.error)).toBe(true);
		const credentials = await authenticator.credentials();
		expect(credentials).toHaveLength(1);
		beaCredential = credentials[0];
		// Signed out through the account menu (its "Sign out", after "Account" since step 4).
		await shadow(page.page, 'loam-titlebar .account').click();
		await shadow(page.page, 'loam-account-menu')
			.getByRole('menuitem', { name: 'Sign out' })
			.click();
		await page.page.waitForFunction(
			() => (document.querySelector('loam-shell') as unknown as { account: string }).account === ''
		);
		expect(await mainHeading(page.page)).toBe('Sign in to acme');
		// "Sign in with a passkey", which the virtual authenticator answers with user verification.
		await shadow(page.page, 'loam-main .sign-in').click();
		await shadow(page.page, 'loam-sign-in-dialog .passkey').click();
		await page.page.waitForFunction(
			() =>
				(document.querySelector('loam-shell') as unknown as { account: string }).account === 'Bea'
		);
		await settle(page.page);
		const passkey = (await entriesOf(page.page)).filter(
			(entry) => entry.command === 'auth-sign-in' && entry.result.success
		);
		expect(passkey.at(-1)?.input).toEqual({ method: 'passkey' });
		expect(page.errors).toEqual([]);
		expect(page.violations).toEqual([]);
	});

	it("P3-E1: a reload inside the person's restricted project restores it from the probe", async () => {
		const page = await open();
		await signInWithPassword(page.page, BEA);
		const bea = site.authHost?.people[BEA] as string;
		const made = (await kernelCall(page.page, 'project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: [bea] },
		})) as { success: boolean; data?: { slug: string }; error?: unknown };
		expect(made.success, JSON.stringify(made.error)).toBe(true);
		expect(
			(
				(await kernelCall(page.page, 'scope-set', { project: made.data?.slug })) as {
					success: boolean;
				}
			).success
		).toBe(true);
		await page.page.evaluate(async () => {
			await (
				document.querySelector('loam-shell') as unknown as { kernel: { flush(): Promise<void> } }
			).kernel.flush();
		});
		await page.page.reload();
		await page.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		await page.page.waitForFunction(
			() =>
				(document.querySelector('loam-shell') as unknown as { account: string }).account === 'Bea'
		);
		const scope = (await kernelCall(page.page, 'scope-get')) as {
			data: { project?: { slug: string } };
		};
		expect(scope.data.project?.slug).toBe(made.data?.slug);
	});

	it('P3-E1: refuses a passkey made without user verification, and a failed ceremony keeps focus', async () => {
		const page = await open();
		await signInWithPassword(page.page, 'cy@example.com');
		const careless = await addVirtualAuthenticator(page.page, { userVerified: false });
		const added = (await kernelCall(page.page, 'account-passkey-add', {})) as {
			success: boolean;
		};
		expect(added.success).toBe(false);
		// No passkey of Cy's was stored at the provider.
		const stored = site.authHost
			?.db()
			.prepare('SELECT COUNT(*) AS n FROM passkey WHERE userId = ?')
			.get(site.authHost.people['cy@example.com'] as string) as { n: number };
		expect(stored.n).toBe(0);
		await kernelCall(page.page, 'auth-sign-out');
		await page.page.waitForFunction(
			() => (document.querySelector('loam-shell') as unknown as { account: string }).account === ''
		);
		// Bea's real passkey on an authenticator that cannot verify its user: the provider refuses the assertion,
		// the dialog says why, and focus stays on its button.
		expect(beaCredential).toBeDefined();
		await careless.add(beaCredential);
		await shadow(page.page, 'loam-main .sign-in').click();
		await shadow(page.page, 'loam-sign-in-dialog .passkey').click();
		await expect
			.poll(() => shadow(page.page, 'loam-sign-in-dialog .message').textContent())
			.not.toBe('');
		expect((await focused(page.page)).label).toBe('Sign in with a passkey');
		expect(await accountOf(page.page)).toBe('');
		const refused = (await entriesOf(page.page)).filter(
			(entry) => entry.command === 'auth-sign-in' && !entry.result.success
		);
		expect(refused.at(-1)?.input).toEqual({ method: 'passkey' });
	});

	it('P3-E1: a member of no workspace sees that they are not a member of it', async () => {
		const page = await open();
		await signInWithPassword(page.page, 'dee@example.com');
		await expect.poll(() => mainHeading(page.page)).toBe('You are not a member of acme');
	});
});

describe('P3-E11: the sign-in dialog and the account menu, under axe and by keyboard', () => {
	it('P3-E11: opens the dialog with focus on the passkey button, passes axe, and Escape returns focus', async () => {
		const page = await open();
		await shadow(page.page, 'loam-titlebar .account').focus();
		await page.page.keyboard.press('Enter');
		await shadow(page.page, 'loam-sign-in-dialog dialog[open]').waitFor();
		expect((await focused(page.page)).label).toBe('Sign in with a passkey');
		expect(await axe(page.page)).toEqual([]);
		await page.page.keyboard.press('Escape');
		await expect.poll(async () => (await focused(page.page)).label).toBe('Sign in');
	});

	it('P3-E1: starts the passkey autofill when the dialog opens, only where the browser offers it', async () => {
		for (const offered of [true, false]) {
			const page = await open();
			await page.page.evaluate((offered) => {
				(
					PublicKeyCredential as unknown as { isConditionalMediationAvailable(): Promise<boolean> }
				).isConditionalMediationAvailable = async () => offered;
				const kernel = (
					document.querySelector('loam-shell') as unknown as {
						kernel: { call(name: string, input?: unknown): Promise<unknown> };
					}
				).kernel;
				const call = kernel.call.bind(kernel);
				const asked: unknown[] = [];
				(globalThis as { asked?: unknown[] }).asked = asked;
				// The autofill waits for the person; here it is only recorded, never answered.
				kernel.call = (name, input) => {
					if (name === 'auth-sign-in') asked.push(input);
					return (input as { autoFill?: boolean })?.autoFill
						? new Promise(() => {})
						: call(name, input);
				};
			}, offered);
			await shadow(page.page, 'loam-main .sign-in').click();
			await shadow(page.page, 'loam-sign-in-dialog dialog[open]').waitFor();
			const asked = () => page.page.evaluate(() => (globalThis as { asked?: unknown[] }).asked);
			if (offered) {
				await expect.poll(asked).toEqual([{ method: 'passkey', autoFill: true }]);
				// The autofill waiting holds no focus: "Sign in with a passkey" keeps it.
				expect((await focused(page.page)).label).toBe('Sign in with a passkey');
			} else {
				await settle(page.page);
				expect(await asked()).toEqual([]);
			}
		}
	});

	it('P3-E11: the account menu is a menu button whose menu passes axe and closes on Escape', async () => {
		const page = await open();
		await signInWithPassword(page.page, BEA);
		const button = shadow(page.page, 'loam-titlebar .account');
		await button.focus();
		await page.page.keyboard.press('Enter');
		await shadow(page.page, 'loam-account-menu [role="menu"]').waitFor();
		expect(await button.getAttribute('aria-expanded')).toBe('true');
		expect((await focused(page.page)).role).toBe('menuitem');
		expect(await axe(page.page)).toEqual([]);
		await page.page.keyboard.press('Escape');
		expect(await button.getAttribute('aria-expanded')).toBe('false');
		expect((await focused(page.page)).label).toBe('Bea');
	});
});

describe('P3-E10: budgets in Chromium, so far', () => {
	it("P3-E10: a provider shell's first paint adds only the probe's request to a local shell's", async () => {
		const local = await serveDist();
		try {
			const plain = await openShell(browser, local.origin);
			opened.push(plain);
			const provider = await open();
			const before = new Set(
				(await measureFirstPaint(plain.page)).map((path) => path.replace(/^\//, ''))
			);
			const after = (await measureFirstPaint(provider.page)).map((path) => path.replace(/^\//, ''));
			const added = after.filter(
				(path) => !before.has(path) && !/^(deployment\.json)?$/.test(path)
			);
			expect(added).toEqual(['api/auth/loam/whoami']);
		} finally {
			await local.close();
		}
	});

	it('P3-E10: a provider page loads `auth` in stage B; sign-in and the account menu only when pressed', async () => {
		const page = await open();
		const loaded = () =>
			page.page.evaluate(() =>
				performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname)
			);
		await expect
			.poll(async () => (await loaded()).some((path) => /\/auth-[\w-]+\.js$/.test(path)))
			.toBe(true);
		expect((await loaded()).some((path) => /\/(sign-in|account-menu)-/.test(path))).toBe(false);
	});
});

describe('P3-E15: no secret in the journal or the store, so far', () => {
	it('P3-E15: holds no password, cookie value or token in any journal entry, store row or localStorage value', async () => {
		const page = await open();
		await signInWithPassword(page.page, BEA);
		await kernelCall(page.page, 'session-list');
		const cookies = (await page.context.cookies())
			.map((cookie) => cookie.value)
			.filter((value) => value.length > 8);
		expect(cookies.length).toBeGreaterThan(0);
		const tokens = (
			(site.authHost as NonNullable<DeploymentSite['authHost']>)
				.db()
				.prepare('SELECT token FROM session')
				.all() as { token: string }[]
		).map((row) => row.token);
		const held = await page.page.evaluate(async () => {
			const read = (name: string) =>
				new Promise<string>((resolve, reject) => {
					const request = indexedDB.open(name);
					request.onerror = () => reject(request.error);
					request.onsuccess = async () => {
						const db = request.result;
						const rows: unknown[] = [];
						for (const store of [...db.objectStoreNames]) {
							rows.push(
								await new Promise((done) => {
									const all = db.transaction(store).objectStore(store).getAll();
									all.onsuccess = () => done(all.result);
								})
							);
						}
						db.close();
						resolve(JSON.stringify(rows));
					};
				});
			return [
				await read('loam-journal'),
				await read('loam-store'),
				JSON.stringify({ ...localStorage }),
			].join('\n');
		});
		expect(held).toContain('auth-sign-in');
		for (const secret of [PASSWORD, ...cookies, ...tokens]) expect(held).not.toContain(secret);
		expect(held).not.toMatch(/ipAddress|127\.0\.0\.1/);
	});
});
