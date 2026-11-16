/**
 * P6-H3 (phase 6 specification, section 19): the provider and bootstrap, on the development profile, in Chromium. A
 * `provider` deployment under `loam-host dev`, at `/loam/`: before bootstrap the shell shows
 * `IDENTITY_ORGANIZATION_UNKNOWN`; `bootstrap --dev` is refused while `dev` runs and, with `dev` stopped, binds the
 * organization and mails the first owner, who joins with a passkey; a second bootstrap before that join sends a new
 * link and ends the first (phase 3's step 4 review, I5), and one after it is `HOST_ALREADY_BOOTSTRAPPED`; `start` on a
 * fresh data directory is `HOST_NOT_BOOTSTRAPPED`; a `stdio` instance refuses the start (D95); the four pages carry
 * `form-action 'self'`; after a restart the origin is the same and a passkey sign-in still works; section 14's
 * `whoami` row; and `scanSecrets` finds nothing. Passkeys are Chromium's virtual authenticator's, through its DevTools
 * `WebAuthn` domain: no real authenticator or platform prompt is involved.
 */

import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { type DevHost, scanSecrets, startDevHost } from '@lushly-dev/loam-host/testing';
import { TEST_RATE_LIMIT } from '@lushly-dev/loam-identity/testing';
import { hashPassword } from 'better-auth/crypto';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	addVirtualAuthenticator,
	hostedProviderDeployment,
	kernelCall,
	launchForDevHost,
	openPage,
	openShell,
	type ShellPage,
	settle,
} from '../browser/harness';
import { hosted, loamHost, writtenPolicy } from './support';

const BASE = '/loam/';
const HTML = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8';
const PASSWORD = 'correct horse battery staple';
const OWNER = 'olu@acme.example';
const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

/**
 * Section 14's `whoami` row: p95 over 500 sequential signed-in requests, the cost of no cookie cache (phase 3's
 * 4.3), enforced in `loam.yml`'s `Hosted development profile` job (`CI=true`), the place section 14 measures; elsewhere
 * a developer's machine under any load, with the measurement logged.
 */
const WHOAMI_P95_MS = process.env.CI === 'true' ? 25 : 250;
const WHOAMI_REQUESTS = 500;

let host: DevHost;
let browser: Browser;
const opened: ShellPage[] = [];
/** The first owner's page, holding the virtual authenticator their passkey lives in. */
let owner: ShellPage;

beforeAll(async () => {
	host = await startDevHost({
		config: hostedProviderDeployment(['passkey', 'password']),
		basePath: BASE,
		// 500 `whoami` reads and several sign-ins from one address: raised explicitly, never off (5.8).
		rateLimit: TEST_RATE_LIMIT,
	});
	browser = await launchForDevHost(host);
}, 120_000);
afterAll(async () => {
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await browser?.close();
	await host?.close();
});

const deploymentOf = (devHost: DevHost) => join(dirname(devHost.data), 'loam.deployment.toml');
const bootstrap = () =>
	loamHost([
		'bootstrap',
		'--dev',
		'--deployment',
		deploymentOf(host),
		'--slug',
		'acme',
		'--name',
		'Acme',
		'--owner-email',
		OWNER,
	]);
const codeOf = (output: Record<string, unknown>) =>
	(output.error as { code?: string } | undefined)?.code;

const shadow = (page: Page, selector: string) => page.locator('loam-shell').locator(selector);
const link = (page: Page) => page.locator('loam-link-page');
const accountOf = (page: Page) =>
	page.evaluate(
		() => (document.querySelector('loam-shell') as unknown as { account: string }).account
	);
const mainHeading = (page: Page) =>
	page.evaluate(
		() =>
			document
				.querySelector('loam-shell')
				?.shadowRoot?.querySelector('loam-main')
				?.shadowRoot?.querySelector('h1')
				?.textContent?.trim() ?? ''
	);

/** The links the sink holds for `email`, oldest first. */
async function linksTo(email: string): Promise<string[]> {
	return (await host.mail())
		.filter((message) => message.to === email)
		.map((message) => /https:\/\/\S+/.exec(message.text)?.[0] as string);
}

/**
 * An account that is nobody's member, written into the provider's database as the provider itself writes one: no
 * account can exist before a bootstrap, since there is no open sign-up (phase 3's 5.6), so this stands for a
 * provider-side change, as the test-only auth host's writable `db()` does.
 */
async function accountWithoutMembership(email: string): Promise<void> {
	const database = new DatabaseSync(join(host.data, 'auth.sqlite'));
	try {
		const now = new Date().toISOString();
		const id = `usr_${email.split('@')[0]}`;
		database
			.prepare(
				'INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)'
			)
			.run(id, 'Dee', email, now, now);
		database
			.prepare(
				'INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
			)
			.run(`acc_${id}`, id, 'credential', id, await hashPassword(PASSWORD), now, now);
	} finally {
		database.close();
	}
}

/** A fresh data directory and its `loam.server.toml`, with the profile's certificate and secret copied in, 0600. */
async function freshServer(): Promise<{ root: string; server: string }> {
	const root = await mkdtemp(join(tmpdir(), 'loam-p6-h3-'));
	const files = join(root, 'files');
	await mkdir(files, { mode: 0o700 });
	for (const [from, to] of [
		['tls/cert.pem', 'cert.pem'],
		['tls/key.pem', 'key.pem'],
		['secrets/auth', 'auth'],
	] as const) {
		await copyFile(join(host.data, from), join(files, to));
		await chmod(join(files, to), 0o600);
	}
	const server = join(root, 'loam.server.toml');
	await writeFile(
		server,
		[
			'server_version = 1',
			`origin = ${JSON.stringify(host.origin)}`,
			'listen = "127.0.0.1:0"',
			'data = "data"',
			'',
			'[tls]',
			'cert_file = "files/cert.pem"',
			'key_file = "files/key.pem"',
			'',
			'[auth]',
			'secret_file = "files/auth"',
			'',
			'[mail]',
			'transport = "sink"',
			'',
		].join('\n')
	);
	return { root, server };
}

describe('P6-H3: the provider and bootstrap', () => {
	it("P6-H3: before bootstrap, a signed-in person's shell shows IDENTITY_ORGANIZATION_UNKNOWN", async () => {
		await accountWithoutMembership('dee@acme.example');
		const page = await openShell(browser, host.root);
		opened.push(page);
		expect(await mainHeading(page.page)).toBe('Sign in to acme');
		const signedIn = (await kernelCall(page.page, 'auth-sign-in', {
			method: 'credentials',
			email: 'dee@acme.example',
			password: PASSWORD,
		})) as { success: boolean; error?: unknown };
		expect(signedIn.success, JSON.stringify(signedIn.error)).toBe(true);
		await expect.poll(() => mainHeading(page.page)).toBe('This workspace is not set up');
		const who = await hosted(host, `${BASE}api/auth/loam/whoami`, {
			headers: {
				origin: host.origin,
				cookie: (await page.context.cookies(host.origin))
					.map(({ name, value }) => `${name}=${value}`)
					.join('; '),
			},
		});
		expect(JSON.parse(who.body)).toMatchObject({ warning: 'IDENTITY_ORGANIZATION_UNKNOWN' });
		expect(page.violations).toEqual([]);
	});

	it('P6-H3: bootstrap --dev is HOST_DATA_LOCKED while dev runs', async () => {
		const { code, output } = await bootstrap();
		expect(code).toBe(1);
		expect(codeOf(output)).toBe('HOST_DATA_LOCKED');
		expect((await linksTo(OWNER)).length).toBe(0);
	});

	it("P6-H3: with dev stopped it binds the organization and mails the first owner's link; again before anyone joins, a new link that ends the first", async () => {
		await host.kill();
		const first = await bootstrap();
		expect(first.code).toBe(0);
		expect(first.output.data).toMatchObject({
			organization: { slug: 'acme' },
			invited: OWNER,
			reissued: false,
		});
		const [link1] = await linksTo(OWNER);
		expect(new URL(link1 as string).pathname).toBe(`${BASE}~/join`);
		const again = await bootstrap();
		expect(again.output.data).toMatchObject({ reissued: true });
		const links = await linksTo(OWNER);
		expect(links).toHaveLength(2);
		await host.restart();
		const lapsed = await openPage(browser, links[0] as string);
		opened.push(lapsed);
		await expect
			.poll(() => link(lapsed.page).locator('h1').textContent())
			.toBe('This link does not work');
	});

	it('P6-H3: the first owner joins with a passkey from the new link; after that, bootstrap is HOST_ALREADY_BOOTSTRAPPED', async () => {
		const url = (await linksTo(OWNER)).at(-1) as string;
		owner = await openPage(browser, url);
		opened.push(owner);
		await addVirtualAuthenticator(owner.page, { userVerified: true });
		await owner.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'link');
		await expect.poll(() => link(owner.page).locator('h1').textContent()).toBe('Join Acme');
		await link(owner.page).locator('#link-name').fill('Olu');
		await link(owner.page).getByRole('button', { name: 'Create a passkey' }).click();
		await expect.poll(() => link(owner.page).locator('h1').textContent()).toBe('Welcome to Acme');
		expect(
			host
				.db()
				.auth.prepare(
					'SELECT m.role AS role FROM member m JOIN user u ON u.id = m.userId WHERE u.email = ?'
				)
				.get(OWNER)
		).toEqual({ role: 'owner' });
		await host.kill();
		const done = await bootstrap();
		expect(done.code).toBe(1);
		expect(codeOf(done.output)).toBe('HOST_ALREADY_BOOTSTRAPPED');
		await host.restart();
	});

	it('P6-H3: after a restart the origin is the same, and a passkey sign-in still works', async () => {
		const before = host.origin;
		await host.restart();
		expect(host.origin).toBe(before);
		await owner.page.goto(host.root);
		await owner.page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		const signedOut = (await kernelCall(owner.page, 'auth-sign-out', {})) as { success: boolean };
		expect(signedOut.success).toBe(true);
		await owner.page.waitForFunction(
			() => (document.querySelector('loam-shell') as unknown as { account: string }).account === ''
		);
		await shadow(owner.page, 'loam-main .sign-in').click();
		await shadow(owner.page, 'loam-sign-in-dialog .passkey').click();
		await expect.poll(() => accountOf(owner.page)).toBe('Olu');
		await settle(owner.page);
		expect(await mainHeading(owner.page)).not.toBe('This workspace is not set up');
		expect(owner.violations).toEqual([]);
	});

	it("P6-H3: the four pages carry form-action 'self' beside 3.5's header; the shell's other pages do not", async () => {
		const policy = `${writtenPolicy(host)}; frame-ancestors 'none'`;
		for (const page of ['~/join', '~/recover', '~/oauth/login', '~/oauth/consent']) {
			const answer = await hosted(host, `${BASE}${page}`, { accept: HTML });
			expect(answer.status, page).toBe(200);
			expect(answer.headers['content-security-policy'], page).toBe(`${policy}; form-action 'self'`);
		}
		for (const page of ['', 'acme', 'acme/~/account']) {
			const answer = await hosted(host, `${BASE}${page}`, { accept: HTML });
			expect(answer.headers['content-security-policy'], page).toBe(policy);
		}
	});

	it('P6-H3: start on a fresh data directory is HOST_NOT_BOOTSTRAPPED, naming the bootstrap; a stdio instance refuses the start (D95)', async () => {
		const { root, server } = await freshServer();
		try {
			const fresh = await loamHost([
				'start',
				'--server',
				server,
				'--deployment',
				deploymentOf(host),
				'--dist',
				DIST,
			]);
			expect(fresh.code).toBe(1);
			expect(codeOf(fresh.output)).toBe('HOST_NOT_BOOTSTRAPPED');
			expect((fresh.output.error as { suggestion: string }).suggestion).toContain(
				'loam-host bootstrap'
			);
			const stdio = join(root, 'stdio.toml');
			await writeFile(
				stdio,
				`${hostedProviderDeployment(['passkey'])}\n[apps.tools]\napp = "tools"\npackage = "./tools"\naudience = "person"\ntransport = "stdio"\ncommand = ["tools"]\n`
			);
			const refused = await loamHost([
				'start',
				'--server',
				server,
				'--deployment',
				stdio,
				'--dist',
				DIST,
			]);
			expect(refused.code).toBe(1);
			expect(codeOf(refused.output)).toBe('DEPLOYMENT_STDIO_TEAM');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("P6-H3: section 14's whoami row: p95 over 500 sequential signed-in requests", async () => {
		const cookie = (await owner.context.cookies(host.origin))
			.map(({ name, value }) => `${name}=${value}`)
			.join('; ');
		const times: number[] = [];
		for (let request = 0; request < WHOAMI_REQUESTS; request++) {
			const started = performance.now();
			const answer = await hosted(host, `${BASE}api/auth/loam/whoami`, {
				headers: { origin: host.origin, cookie },
			});
			times.push(performance.now() - started);
			if (answer.status !== 200) throw new Error(`whoami answered ${answer.status}`);
		}
		const p95 = [...times].sort((a, b) => a - b)[Math.ceil(WHOAMI_REQUESTS * 0.95) - 1] as number;
		// The line section 14's sample is read from in the `Hosted development profile` job.
		console.log(
			`P6-H3 measurement: whoami p95 ${p95.toFixed(1)} ms over ${WHOAMI_REQUESTS} requests`
		);
		expect(p95).toBeLessThanOrEqual(WHOAMI_P95_MS);
	}, 120_000);

	it('P6-H3: scanSecrets finds no auth secret, TLS key or session cookie in the files, the stores, the logs or the pages', async () => {
		const cookies = (await owner.context.cookies(host.origin)).map(({ value }) => value);
		expect(cookies.length).toBeGreaterThan(0);
		const { found } = await scanSecrets(
			host,
			opened.map(({ page }) => page),
			cookies
		);
		expect(found).toEqual([]);
	});
});
